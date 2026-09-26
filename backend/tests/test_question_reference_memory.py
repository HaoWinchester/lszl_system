"""Reference reads must not multiply unused release JSON by question count."""
import asyncio
import json
import tracemalloc
from uuid import uuid4

import pytest
from sqlalchemy import event

from app.db.session import AsyncSessionLocal, engine
from app.models.user import User
from app.models.question import QuestionBank, Question, ExamPaper, PaperQuestion
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.services.question_cleanup_reference_service import (
    complete_relational_reference_snapshot, inventory_question_references, _sha256,
)


@pytest.mark.parametrize('inventory', [False, True], ids=['reference-snapshot', 'cleanup-inventory'])
def test_reference_reads_do_not_materialize_unused_published_payloads(inventory):
    async def scenario():
        suffix = uuid4().hex[:12]
        owner, bank_id, question_id = f'mem-{suffix}', f'b-{suffix}', f'q-{suffix}'
        release_id, paper_id = f'r-{suffix}', f'p-{suffix}'
        count = 132  # Cross the cleanup cursor's 100-row batch boundary.
        snapshot = {'id': question_id, 'bankId': bank_id, 'title': '历史题', 'payload': 's' * 4096}
        async with AsyncSessionLocal() as db:
            db.add(User(username=owner, password_hash='unused', role='teacher', status='active'))
            await db.flush()
            db.add(QuestionBank(id=bank_id, owner_id=owner, name='引用题库', subject='PMP'))
            await db.flush()
            db.add(Question(id=question_id, bank_id=bank_id, title='引用题', teacher_number='MEM-1', content_metadata={'knowledge': {'primaryNodeId': 'node-1'}}, analysis='a' * 1024 * 1024))
            db.add(ExamPaper(id=paper_id, owner_id=owner, name='草稿', subject='PMP', status='draft'))
            db.add(PaperRelease(id=release_id, paper_id=paper_id, version=3, status='withdrawn', name='历史发布', subject='PMP', publisher_id=owner, question_count=count, source_payload={'unused': 'x' * 1024 * 1024}))
            await db.flush()
            db.add(PaperQuestion(paper_id=paper_id, question_id=question_id, order_index=0, score=2))
            db.add_all([PaperReleaseQuestion(release_id=release_id, order_index=i, bank_id=bank_id, question_id=question_id, snapshot=snapshot) for i in range(count)])
            await db.flush()
            statements = []
            def record(conn, cursor, statement, parameters, context, executemany):
                if statement.lstrip().upper().startswith('SELECT'):
                    statements.append(statement)
            event.listen(engine.sync_engine, 'before_cursor_execute', record)
            tracemalloc.start()
            try:
                if inventory:
                    refs, history = await inventory_question_references(db)
                    matching = [r for r in refs if r.container_id == release_id]
                    assert len(matching) == count
                    assert all(r.repair_action == 'preserve_historical_snapshot' for r in matching)
                    assert _sha256(snapshot) in json.dumps(history)
                else:
                    result = await complete_relational_reference_snapshot(db, owner_id=owner)
                    assert result['banks'][0]['questions'][0]['metadata'] == {'knowledge': {'primaryNodeId': 'node-1'}}
                    assert result['papers'][0]['sections'][0]['items'] == [{'questionId': question_id, 'order': 1, 'score': 2.0}]
                    assert result['releases'][0]['status'] == 'withdrawn'
                    assert len(result['releases'][0]['sections'][0]['items']) == count
                    assert result['releases'][0]['sections'][0]['items'][-1]['order'] == count
                _, peak = tracemalloc.get_traced_memory()
            finally:
                tracemalloc.stop()
                event.remove(engine.sync_engine, 'before_cursor_execute', record)
            # The global cleanup inventory also hashes the built-in recall seed
            # (about 8 MiB). The bad release join alone allocates over 132 MiB.
            assert peak < 16 * 1024 * 1024, f'Reference query allocated {peak / 1024 / 1024:.1f} MiB'
            assert all('paper_releases.source_payload' not in sql for sql in statements)
            if not inventory:
                assert all('paper_release_questions.snapshot' not in sql for sql in statements)
                assert all('questions.analysis' not in sql for sql in statements)
            await db.rollback()
    asyncio.run(scenario())
