import copy
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from fastapi import HTTPException
from app.services.teacher_assistant_import import build_plan, execute_plan

@pytest.fixture
def anyio_backend():
    return 'asyncio'

@pytest.fixture(autouse=True)
async def isolated_import_database(anyio_backend, monkeypatch):
    # Shared services commit normally to savepoints; every test rolls back its
    # outer transaction so global principle fixtures and mixed papers cannot
    # leak into unrelated tests or migration downgrades later in this process.
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from app.db import session as database_module
    async with database_module.engine.connect() as connection:
        transaction = await connection.begin()
        factory = async_sessionmaker(bind=connection, expire_on_commit=False, join_transaction_mode='create_savepoint')
        monkeypatch.setattr(database_module, 'AsyncSessionLocal', factory)
        try:
            yield
        finally:
            if transaction.is_active:
                await transaction.rollback()


ACTOR = SimpleNamespace(username='teacher', role='teacher')

def question(identifier='q1', answer='a'):
    return {'id': identifier, 'title': '题目', 'type': 'single_choice', 'stemParts': [{'type': 'text', 'text': '题干'}], 'options': [{'id': 'a', 'text': '选项A'}, {'id': 'b', 'text': '选项B'}], 'correctAnswer': answer, 'metadata': {'principleIds': [], 'original': 'preserved'}}

def source(q=None):
    return {'id': 'upload1', 'name': 'test.json', 'extracted': {'kind': 'json', 'data': {'id': 'bank1', 'name': '原题库', 'questions': [q or question()]}, 'sections': [], 'warnings': []}}

@pytest.fixture
def db():
    result = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []), scalar_one_or_none=lambda: None)
    return SimpleNamespace(execute=AsyncMock(return_value=result), get=AsyncMock(return_value=None), commit=AsyncMock(), refresh=AsyncMock(), rollback=AsyncMock())

@pytest.mark.anyio
async def test_json_model_cannot_rewrite_critical_fields(db):
    original = source()
    plan = await build_plan(db, ACTOR, [original], {'items': [{'uploadId': 'upload1', 'questions': [question(answer='b')]}]}, session_id='session')
    assert plan['items'][0]['questions'] == original['extracted']['data']['questions']
    assert plan['settings']['publish'] is False
    assert plan['settings']['allowedRoles'] == []
    assert 'practice_mode' not in plan['settings']['enabledModes']

@pytest.mark.anyio
async def test_missing_answer_blocks(db):
    plan = await build_plan(db, ACTOR, [source(question(answer=None))], {}, session_id='s')
    assert plan['items'][0]['blockers']

@pytest.mark.anyio
async def test_ids_stable_across_revision(db):
    first = await build_plan(db, ACTOR, [source()], {'settings': {'duplicatePolicy': 'independent'}}, session_id='s')
    second = await build_plan(db, ACTOR, [source()], {'settings': {'nameSuffix': '习题课'}}, session_id='s', previous_plan=first)
    assert first['items'][0]['id'] == second['items'][0]['id']
    assert first['items'][0]['bankPayload']['sourceId'] == second['items'][0]['bankPayload']['sourceId']

@pytest.mark.anyio
async def test_old_revision_rejected(db):
    session = SimpleNamespace(id='s', owner_id='teacher', revision=2, plan={}, receipt={})
    with pytest.raises(HTTPException) as error:
        await execute_plan(db, ACTOR, session, 1)
    assert error.value.status_code == 409

@pytest.mark.anyio
async def test_invalid_publish_scope_blocks(db):
    plan = await build_plan(db, ACTOR, [source()], {'settings': {'publish': True, 'allowedRoles': ['superuser'], 'enabledModes': ['shell'], 'accessLevel': 'free'}}, session_id='s')
    assert plan['blockers']

@pytest.mark.anyio
async def test_delete_requires_instruction(db):
    model = {'items': [{'uploadId': 'upload1', 'excludedQuestionIds': ['q1']}]}
    plan = await build_plan(db, ACTOR, [source()], model, session_id='s')
    assert len(plan['items'][0]['questions']) == 1
    model['userInstruction'] = '第1题不要'
    plan = await build_plan(db, ACTOR, [source()], model, session_id='s')
    assert plan['items'][0]['questions'] == []
    assert plan['items'][0]['blockers']

@pytest.mark.anyio
async def test_original_twenty_five_lossless(db):
    root = Path('/Users/menghao/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_d26m6zr7um9k51_e8f7/msg/file/2026-09')
    files = [root / 'PMP_财务绩效域_12题母题整理批次_PrepStudio.json', root / 'PMP_进度绩效域_13题母题整理批次_PrepStudio.json']
    if not all(path.exists() for path in files):
        pytest.skip('Original user fixtures not available on this host')
    sources = [{'id': f'u{i}', 'name': path.name, 'extracted': {'kind': 'json', 'data': json.loads(path.read_text()), 'warnings': [], 'sections': []}} for i, path in enumerate(files)]
    plan = await build_plan(db, ACTOR, sources, {'settings': {'duplicatePolicy': 'independent', 'nameSuffix': '习题课', 'accessLevel': 'free', 'allowedRoles': ['teacher', 'student'], 'enabledModes': ['deep_recall', 'multi_question_canvas']}}, session_id='real')
    assert sum(len(item['questions']) for item in plan['items']) == 25
    for item, original in zip(plan['items'], sources):
        assert item['questions'] == original['extracted']['data']['questions']
        assert '习题课' in item['name']
        assert item['bankPayload']['sourceId'] != original['extracted']['data']['id']

@pytest.mark.anyio
async def test_real_import_publish_and_lost_receipt_recovery():
    from uuid import uuid4
    from sqlalchemy import func, select
    from app.db.session import AsyncSessionLocal
    from app.models.user import User
    from app.models.teacher_assistant import TeacherAssistantSession
    from app.models.question import ExamPaper, QuestionBank, Question
    from app.models.paper_release import PaperRelease
    suffix = uuid4().hex[:12]
    async with AsyncSessionLocal() as database:
        actor = User(username='ta-real-' + suffix, password_hash='test', role='teacher', status='active')
        database.add(actor)
        await database.commit()
        session = TeacherAssistantSession(id='tas-' + suffix, owner_id=actor.username, revision=1)
        model = {'settings': {'duplicatePolicy': 'independent', 'publish': True, 'accessLevel': 'free', 'allowedRoles': ['teacher', 'student'], 'enabledModes': ['deep_recall', 'multi_question_canvas']}}
        session.plan = await build_plan(database, actor, [source()], model, session_id=session.id)
        assert not session.plan['blockers']
        assert not session.plan['items'][0]['blockers']
        database.add(session)
        await database.commit()
        first = await execute_plan(database, actor, session, 1)
        assert first['status'] == 'succeeded', json.dumps(first, ensure_ascii=False)
        identifiers = {key: first['items'][0][key] for key in ('bankId', 'paperId', 'releaseId')}
        # Simulate commits succeeding but no step receipt surviving.
        session.receipt = {}
        await database.commit()
        second = await execute_plan(database, actor, session, 1)
        assert second['status'] == 'succeeded', second
        assert {key: second['items'][0][key] for key in identifiers} == identifiers
        assert await database.scalar(select(func.count()).select_from(QuestionBank).where(QuestionBank.owner_id == actor.username)) == 1
        assert await database.scalar(select(func.count()).select_from(ExamPaper).where(ExamPaper.owner_id == actor.username)) == 1
        assert await database.scalar(select(func.count()).select_from(PaperRelease).where(PaperRelease.paper_id == identifiers['paperId'])) == 1
        stored = await database.get(QuestionBank, identifiers['bankId'])
        assert stored.visibility == 'private'
        release = await database.get(PaperRelease, identifiers['releaseId'])
        assert release.access_level == 'free'
        assert set(release.allowed_roles) == {'teacher', 'student'}
        assert set(release.enabled_modes) == {'deep_recall', 'multi_question_canvas'}

@pytest.mark.anyio
async def test_document_review_must_be_grounded(db):
    q = question()
    q.update(source={'location': '第 1 页'}, needsReview=True)
    document = {'id': 'u', 'name': 'x.pdf', 'extracted': {'kind': 'document', 'data': None, 'sections': [{'location': '第 1 页', 'text': '题干', 'images': []}], 'warnings': ['OCR 需核对']}}
    model = {'settings': {'duplicatePolicy': 'independent'}, 'items': [{'uploadId': 'u', 'questions': [q], 'reviewedQuestionIds': ['q1']}]}
    untrusted = await build_plan(db, ACTOR, [document], model, session_id='s')
    assert untrusted['items'][0]['blockers']
    model['userInstruction'] = '我已核对，确认答案无误'
    reviewed = await build_plan(db, ACTOR, [document], model, session_id='s')
    assert not reviewed['items'][0]['blockers']
    assert reviewed['items'][0]['reviewedQuestionIds'] == ['q1']

@pytest.mark.anyio
async def test_restore_excluded_question_without_upload(db):
    data = source()
    data['extracted']['data']['questions'].append(question('q2'))
    removed = await build_plan(db, ACTOR, [data], {'userInstruction': '第2题不要', 'items': [{'uploadId': 'upload1', 'excludedQuestionIds': ['q2']}]}, session_id='s')
    assert [q['id'] for q in removed['items'][0]['questions']] == ['q1']
    restored = await build_plan(db, ACTOR, [data], {'userInstruction': '恢复第2题', 'items': [{'uploadId': 'upload1', 'selectedQuestionIds': ['q1', 'q2']}]}, session_id='s', previous_plan=removed)
    assert [q['id'] for q in restored['items'][0]['questions']] == ['q1', 'q2']

@pytest.mark.anyio
async def test_real_twenty_five_import_preserves_answers_and_associations():
    from uuid import uuid4
    from sqlalchemy import select
    from app.db.session import AsyncSessionLocal
    from app.models.user import User
    from app.models.teacher_assistant import TeacherAssistantSession
    from app.models.content_prep import Principle
    from app.models.teaching_content import ContentSubject, RecallAssociationLibrary
    from app.models.question import Question
    from app.services import question_service, question_content_service
    root = Path('/Users/menghao/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_d26m6zr7um9k51_e8f7/msg/file/2026-09')
    files = [root / 'PMP_财务绩效域_12题母题整理批次_PrepStudio.json', root / 'PMP_进度绩效域_13题母题整理批次_PrepStudio.json']
    if not all(path.exists() for path in files):
        pytest.skip('Original user fixtures unavailable')
    sources = [{'id': f'u{i}', 'name': path.name, 'extracted': {'kind': 'json', 'data': json.loads(path.read_text()), 'warnings': [], 'sections': []}} for i, path in enumerate(files)]
    questions = [q for uploaded in sources for q in uploaded['extracted']['data']['questions']]
    principles = set()
    nodes = {}
    for q in questions:
        metadata = q.get('metadata') or {}
        principles.update(metadata.get('principleIds') or [])
        principles.update(metadata.get('stemPrincipleIds') or [])
        for values in (metadata.get('optionPrincipleMap') or {}).values():
            principles.update(values)
        for clue in q.get('clues') or []:
            if clue.get('recallNodeId'):
                nodes[clue['recallNodeId']] = {'id': clue['recallNodeId'], 'title': clue.get('text') or clue['recallNodeId']}
    principle_path = root / '原则与归纳卡-V9.0-P4.6.4.35.json'
    bundle = json.loads(principle_path.read_text())
    incoming_principles = {principle['id'] for principle in bundle['principles']}
    sources.append({'id': 'principle-upload', 'name': principle_path.name, 'extracted': {'kind': 'json', 'data': bundle, 'warnings': [], 'sections': []}})
    suffix = uuid4().hex[:12]
    async with AsyncSessionLocal() as database:
        actor = User(username='ta-original-' + suffix, password_hash='test', role='teacher', status='active')
        database.add(actor)
        for identifier in principles - incoming_principles:
            if await database.get(Principle, identifier) is None:
                database.add(Principle(id=identifier, name=identifier, status='active'))
        subject = ContentSubject(id='ta-subject-' + suffix, code='ta-' + suffix, name='Fixture')
        database.add(subject)
        await database.flush()
        database.add(RecallAssociationLibrary(id='ta-library-' + suffix, subject_id=subject.id, nodes=list(nodes.values()), status='published'))
        await database.commit()
        session = TeacherAssistantSession(id='tas-original-' + suffix, owner_id=actor.username, revision=1)
        settings = {'duplicatePolicy': 'independent', 'nameSuffix': '习题课', 'publish': True, 'accessLevel': 'free', 'allowedRoles': ['teacher', 'student'], 'enabledModes': ['deep_recall', 'multi_question_canvas']}
        session.plan = await build_plan(database, actor, sources, {'settings': settings}, session_id=session.id)
        assert not session.plan['blockers']
        assert session.plan['items'][0]['kind'] == 'principles'
        assert all(not item['blockers'] for item in session.plan['items']), session.plan['items']
        database.add(session)
        await database.commit()
        receipt = await execute_plan(database, actor, session, 1)
        assert receipt['status'] == 'succeeded', json.dumps(receipt, ensure_ascii=False)
        imported = (await database.execute(select(Question).where(Question.bank_id.in_([item['bankId'] for item in receipt['items'] if item.get('bankId')])))).scalars().all()
        assert len(imported) == 25
        rebuilt = await build_plan(database, actor, sources, {'settings': settings}, session_id=session.id, previous_plan=session.plan)
        assert rebuilt['questionCount'] == 25
        assert [item['bankPayload']['sourceId'] for item in rebuilt['items'] if item['kind'] == 'questions'] == [item['bankPayload']['sourceId'] for item in session.plan['items'] if item['kind'] == 'questions']
        original_by_id = {q['id']: q for q in questions}
        for stored in imported:
            original_id = stored.content_metadata['teacherAssistantSource']['originalId']
            original = question_content_service.normalize_question_payload(original_by_id[original_id], subject='PMP')
            actual = question_service.question_to_dict(stored)
            for field in ('type', 'correctAnswer', 'correctOptionIds', 'clues', 'concepts', 'reasoningSteps', 'options', 'stemParts'):
                assert actual.get(field) == original.get(field), (original_id, field)
            for field in ('principleIds', 'stemPrincipleIds', 'optionPrincipleMap', 'origin'):
                assert actual['metadata'].get(field) == original['metadata'].get(field), (original_id, field)

@pytest.mark.anyio
async def test_partial_receipt_preserved_and_success_not_replayed(db, monkeypatch):
    from app.services import teacher_assistant_import as importer
    broken = source(question(answer=None))
    working = source()
    working['id'] = 'upload2'
    plan = await build_plan(db, ACTOR, [broken, working], {'settings': {'duplicatePolicy': 'independent'}}, session_id='s')
    session = SimpleNamespace(id='s', owner_id='teacher', revision=1, plan=plan, receipt={})
    bank_source = plan['items'][1]['bankPayload']['sourceId']
    banks = AsyncMock(return_value={'sourceBankIdMap': {bank_source: 'real-bank'}})
    papers = AsyncMock(return_value={'paper': {'id': 'real-paper'}})
    monkeypatch.setattr(importer.question_service, 'import_question_banks', banks)
    monkeypatch.setattr(importer.paper_import_service, 'preflight_package', AsyncMock(return_value={'valid': True, 'payloadHash': 'a' * 64, 'references': [{'bankId': 'b', 'questionId': 'q', 'order': 1, 'score': 1.0}]}))
    monkeypatch.setattr(importer.paper_import_service, 'import_package', papers)
    first = await execute_plan(db, ACTOR, session, 1)
    assert first['status'] == 'partial'
    assert [item['status'] for item in first['items']] == ['blocked', 'succeeded']
    assert session.receipt['items'][1]['bankId'] == 'real-bank'
    await execute_plan(db, ACTOR, session, 1)
    assert banks.await_count == 1
    assert papers.await_count == 1

@pytest.mark.anyio
async def test_cross_teacher_execute_denied(db):
    session = SimpleNamespace(id='s', owner_id='other-teacher', revision=1, plan={}, receipt={})
    with pytest.raises(HTTPException) as error:
        await execute_plan(db, ACTOR, session, 1)
    assert error.value.status_code == 403

@pytest.mark.anyio
async def test_original_principle_bundle_merge_and_response_loss():
    from uuid import uuid4
    from app.db.session import AsyncSessionLocal
    from app.models.user import User
    from app.models.teacher_assistant import TeacherAssistantSession
    from app.models.content_prep import Principle, SynthesisPreset
    from app.services import content_prep_shared_service
    path = Path('/Users/menghao/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_d26m6zr7um9k51_e8f7/msg/file/2026-09/原则与归纳卡-V9.0-P4.6.4.35.json')
    if not path.exists():
        pytest.skip('Original principle bundle unavailable')
    bundle = json.loads(path.read_text())
    assert len(bundle['principles']) == 11
    uploaded = {'id': 'principles-upload', 'name': path.name, 'extracted': {'kind': 'json', 'data': bundle, 'warnings': [], 'sections': []}}
    suffix = uuid4().hex[:12]
    async with AsyncSessionLocal() as database:
        actor = User(username='ta-principles-' + suffix, password_hash='test', role='teacher', status='active')
        database.add(actor)
        await database.commit()
        preview = await content_prep_shared_service.preview_principle_merge(database, bundle)
        resolutions = [{'conflictId': conflict['conflictId'], 'resolution': 'take-incoming'} for conflict in preview['plan']['conflicts']]
        model = {'userInstruction': '这些原则和归纳卡使用新值', 'items': [{'uploadId': uploaded['id'], 'principleResolutions': resolutions}]}
        session = TeacherAssistantSession(id='tas-principles-' + suffix, owner_id=actor.username, revision=1)
        session.plan = await build_plan(database, actor, [uploaded], model, session_id=session.id)
        assert session.plan['items'][0]['kind'] == 'principles'
        assert not session.plan['items'][0]['blockers']
        database.add(session)
        await database.commit()
        first = await execute_plan(database, actor, session, 1)
        assert first['status'] == 'succeeded', first
        session.receipt = {}
        await database.commit()
        second = await execute_plan(database, actor, session, 1)
        assert second['status'] == 'succeeded', second
        for principle in bundle['principles']:
            stored = await database.get(Principle, principle['id'])
            assert stored.name == principle['name']
        for preset in bundle['presets']:
            stored = await database.get(SynthesisPreset, preset['id'])
            assert stored.principle_id == preset['principleId']
            assert stored.content == preset['content']
        assert 'principles' not in second['items'][0]['result']  # receipt does not copy entire shared library

@pytest.mark.anyio
async def test_principle_resolution_requires_trusted_direction(db, monkeypatch):
    from app.services import teacher_assistant_import as importer
    conflict = {'conflictId': 'same-id-different-name:p1', 'type': 'same-id-different-name', 'principleId': 'p1', 'incomingName': 'new', 'existingName': 'old'}
    preview = {'plan': {'conflicts': [conflict]}, 'contentRevision': 3}
    monkeypatch.setattr(importer.content_prep_shared_service, 'preview_principle_merge', AsyncMock(return_value=preview))
    uploaded = {'id': 'u', 'name': 'p.json', 'extracted': {'kind': 'json', 'data': {'format': 'pmp-principle-preset-bundle-v1', 'principles': [{'id': 'p1', 'name': 'new'}], 'presets': [{'id': 'preset1', 'principleId': 'p1', 'title': 'card', 'content': 'text'}]}, 'warnings': []}}
    model = {'items': [{'uploadId': 'u', 'principleResolutions': [{'conflictId': conflict['conflictId'], 'resolution': 'take-incoming'}]}], 'userInstruction': '保留现有'}
    rejected = await build_plan(db, ACTOR, [uploaded], model, session_id='s')
    assert rejected['items'][0]['blockers']
    model['items'][0]['principleResolutions'][0]['resolution'] = 'keep-existing'
    approved = await build_plan(db, ACTOR, [uploaded], model, session_id='s')
    assert not approved['items'][0]['blockers']
    assert approved['items'][0]['principleResolutions'][0]['resolution'] == 'keep-existing'
    changed = copy.deepcopy(preview)
    changed['plan']['conflicts'][0]['existingName'] = 'changed after preview'
    monkeypatch.setattr(importer.content_prep_shared_service, 'preview_principle_merge', AsyncMock(return_value=changed))
    session = SimpleNamespace(id='s', owner_id='teacher', revision=1, plan=approved, receipt={})
    receipt = await execute_plan(db, ACTOR, session, 1)
    assert receipt['status'] == 'partial'
    assert '变化' in receipt['items'][0]['error']

@pytest.mark.anyio
async def test_document_images_derive_only_matched_source_section(db, tmp_path, monkeypatch):
    from PIL import Image
    from app.core.config import settings
    monkeypatch.setattr(settings, 'TEACHER_ASSISTANT_STORAGE', str(tmp_path))
    extraction = tmp_path / 's' / 'u' / 'extracted'
    extraction.mkdir(parents=True)
    Image.new('RGB', (20, 20), 'red').save(extraction / 'one.png')
    Image.new('RGB', (20, 20), 'blue').save(extraction / 'two.png')
    q = question()
    q.update(source={'location': '幻灯片 1'}, images=[{'id': 'untrusted-existing-asset'}], sourceImages=['../../secret'])
    uploaded = {'id': 'u', 'name': 'slides.pptx', 'extracted': {'kind': 'document', 'data': None, 'sections': [{'location': '幻灯片 1', 'text': '题干', 'images': ['one.png']}, {'location': '幻灯片 2', 'text': '其他', 'images': ['two.png']}], 'warnings': []}}
    plan = await build_plan(db, ACTOR, [uploaded], {'settings': {'duplicatePolicy': 'independent'}, 'items': [{'uploadId': 'u', 'questions': [q]}]}, session_id='s')
    item = plan['items'][0]
    assert not item['blockers']
    assert [image['filename'] for image in item['questions'][0]['sourceImages']] == ['one.png']
    assert not item['questions'][0].get('images')
    assert item['questions'][0]['sourceImages'][0]['location'] == '幻灯片 1'

@pytest.mark.anyio
async def test_bad_source_image_blocks_preview(db, tmp_path, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, 'TEACHER_ASSISTANT_STORAGE', str(tmp_path))
    extraction = tmp_path / 's' / 'u' / 'extracted'
    extraction.mkdir(parents=True)
    (extraction / 'bad.png').write_bytes(b'not image')
    q = question()
    q['source'] = {'location': '第 1 页'}
    uploaded = {'id': 'u', 'name': 'scan.pdf', 'extracted': {'kind': 'document', 'data': None, 'sections': [{'location': '第 1 页', 'text': 'text', 'images': ['bad.png']}], 'warnings': []}}
    plan = await build_plan(db, ACTOR, [uploaded], {'settings': {'duplicatePolicy': 'independent'}, 'items': [{'uploadId': 'u', 'questions': [q]}]}, session_id='s')
    assert any('图片' in blocker for blocker in plan['items'][0]['blockers'])

@pytest.mark.anyio
async def test_published_source_image_survives_conversation_delete(tmp_path, monkeypatch):
    from uuid import uuid4
    from PIL import Image
    import shutil
    from sqlalchemy import func, select
    from app.core.config import settings
    from app.db.session import AsyncSessionLocal
    from app.models.user import User
    from app.models.teacher_assistant import TeacherAssistantSession
    from app.models.question_material import QuestionAsset
    from app.models.paper_release import PaperReleaseQuestion
    from app.services import question_material_service
    monkeypatch.setattr(settings, 'TEACHER_ASSISTANT_STORAGE', str(tmp_path))
    suffix = uuid4().hex[:12]
    sid = 'tas-image-' + suffix
    extraction = tmp_path / sid / 'diagram-upload' / 'extracted'
    extraction.mkdir(parents=True)
    Image.new('RGB', (80, 40), 'green').save(extraction / 'diagram.bmp')  # bounded conversion to PNG
    q = question()
    q['source'] = {'location': '幻灯片 1'}
    uploaded = {'id': 'diagram-upload', 'name': 'slides.pptx', 'extracted': {'kind': 'document', 'data': None, 'sections': [{'location': '幻灯片 1', 'text': '题干', 'images': ['diagram.bmp']}], 'warnings': []}}
    async with AsyncSessionLocal() as database:
        teacher = User(username='ta-image-' + suffix, password_hash='test', role='teacher', status='active')
        student = User(username='ta-student-' + suffix, password_hash='test', role='student', status='active')
        other_teacher = User(username='ta-other-' + suffix, password_hash='test', role='teacher', status='active')
        database.add_all([teacher, student, other_teacher])
        await database.commit()
        session = TeacherAssistantSession(id=sid, owner_id=teacher.username, revision=1)
        model = {'settings': {'duplicatePolicy': 'independent', 'publish': True, 'accessLevel': 'free', 'allowedRoles': ['student'], 'enabledModes': ['deep_recall', 'multi_question_canvas']}, 'items': [{'uploadId': uploaded['id'], 'questions': [q]}]}
        session.plan = await build_plan(database, teacher, [uploaded], model, session_id=sid)
        assert not session.plan['items'][0]['blockers']
        database.add(session)
        await database.commit()
        from app.services import paper_release_service
        publish = paper_release_service.publish
        async def fail_publish(*args, **kwargs):
            raise HTTPException(status_code=503, detail='temporary publication failure')
        monkeypatch.setattr(paper_release_service, 'publish', fail_publish)
        failed = await execute_plan(database, teacher, session, 1)
        assert failed['status'] == 'partial'
        assert failed['items'][0]['bankId'] and failed['items'][0]['paperReady']
        monkeypatch.setattr(paper_release_service, 'publish', publish)
        (extraction / 'diagram.bmp').unlink()
        first = await execute_plan(database, teacher, session, 1)
        assert first['status'] == 'succeeded', json.dumps(first, ensure_ascii=False)
        assets = first['items'][0]['assets']
        assert len(assets) == 1
        asset_id = next(iter(assets.values()))['id']
        snapshot = (await database.execute(select(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id == first['items'][0]['releaseId']))).scalar_one()
        assert snapshot.snapshot['images'][0]['id'] == asset_id
        assert snapshot.snapshot['images'][0]['url'] == f'/api/v1/question-assets/{asset_id}'
        Image.new('RGB', (80, 40), 'green').save(extraction / 'diagram.bmp')
        session.receipt = {}
        await database.commit()
        replay = await execute_plan(database, teacher, session, 1)
        assert replay['status'] == 'succeeded', replay
        assert next(iter(replay['items'][0]['assets'].values()))['id'] == asset_id
        assert await database.scalar(select(func.count()).select_from(QuestionAsset).where(QuestionAsset.owner_id == teacher.username)) == 1
        await database.delete(session)
        await database.commit()
        shutil.rmtree(tmp_path / sid)
        await database.refresh(student)
        await database.refresh(other_teacher)
        granted = await question_material_service.authorized_asset(database, student, asset_id)
        assert granted.mime_type == 'image/png'
        assert granted.data.startswith(b'\x89PNG')
        with pytest.raises(HTTPException) as denied:
            await question_material_service.authorized_asset(database, other_teacher, asset_id)
        assert denied.value.status_code == 404

@pytest.mark.anyio
@pytest.mark.parametrize('malformed', [
    {'settings': {'publish': 'false', 'directPublish': 'true'}},
    {'settings': {'allowedRoles': [{'role': 'student'}]}},
    {'settings': {'enabledModes': [False]}},
    {'settings': {'names': {'upload1': {'name': 'unsafe'}}}},
    {'settings': {'nameSuffix': ['suffix']}},
    {'settings': []},
    {'items': {'uploadId': 'upload1'}},
    {'items': [False]},
    {'blockers': 'not-array'},
    {'blockers': [{'message': 'bad'}]},
])
async def test_malformed_model_blocks_before_execution(db, malformed):
    plan = await build_plan(db, ACTOR, [source()], malformed, session_id='s')
    assert plan['blockers']
    assert plan['settings']['publish'] is False
    session = SimpleNamespace(id='s', owner_id='teacher', revision=1, plan=plan, receipt={})
    with pytest.raises(HTTPException) as error:
        await execute_plan(db, ACTOR, session, 1)
    assert error.value.status_code == 422
    assert db.commit.await_count == 0

@pytest.mark.anyio
async def test_raw_json_cannot_turn_source_images_into_server_file_access(db, monkeypatch):
    from app.services import teacher_assistant_import as importer
    q = question()
    q['sourceImages'] = [{'uploadId': '../../../../private', 'filename': 'secret.png', 'digest': 'forged', 'mimeType': 'image/png', 'location': 'forged'}]
    plan = await build_plan(db, ACTOR, [source(q)], {'settings': {'duplicatePolicy': 'independent'}}, session_id='s')
    assert plan['items'][0]['sourceKind'] == 'json'
    image_reader = AsyncMock(side_effect=AssertionError('raw JSON must not read extraction files'))
    monkeypatch.setattr(importer, '_ensure_source_asset', image_reader)
    bank_source = plan['items'][0]['bankPayload']['sourceId']
    monkeypatch.setattr(importer.question_service, 'import_question_banks', AsyncMock(return_value={'sourceBankIdMap': {bank_source: 'b'}}))
    monkeypatch.setattr(importer.paper_import_service, 'preflight_package', AsyncMock(return_value={'valid': True, 'payloadHash': 'a' * 64, 'references': [{'bankId': 'b', 'questionId': 'q', 'order': 1, 'score': 1.0}]}))
    monkeypatch.setattr(importer.paper_import_service, 'import_package', AsyncMock(return_value={'paper': {'id': 'p'}}))
    session = SimpleNamespace(id='s', owner_id='teacher', revision=1, plan=plan, receipt={})
    receipt = await execute_plan(db, ACTOR, session, 1)
    assert receipt['status'] == 'succeeded'
    assert image_reader.await_count == 0

@pytest.mark.anyio
async def test_cancel_guard_stops_after_committed_bank_before_paper():
    import asyncio
    from uuid import uuid4
    from sqlalchemy import select,func
    from app.db.session import AsyncSessionLocal
    from app.models.user import User
    from app.models.teacher_assistant import TeacherAssistantSession
    from app.models.question import QuestionBank,ExamPaper
    from app.services import teacher_assistant_import as imports
    async with AsyncSessionLocal() as database:
        actor=User(username='ta-cancel-'+uuid4().hex[:10],password_hash='test',role='teacher',status='active')
        database.add(actor);await database.commit()
        session=TeacherAssistantSession(id='tas-'+uuid4().hex,owner_id=actor.username,revision=1)
        session.plan=await imports.build_plan(database,actor,[source()],{'settings':{'duplicatePolicy':'independent','publish':False}},session_id=session.id)
        database.add(session);await database.commit()
        async def cancelled_after_bank():
            if session.receipt and any(i.get('bankId') for i in session.receipt.get('items',[])):
                raise asyncio.CancelledError()
        with pytest.raises(asyncio.CancelledError):
            await imports.execute_plan(database,actor,session,1,before_step=cancelled_after_bank)
        assert await database.scalar(select(func.count()).select_from(QuestionBank).where(QuestionBank.owner_id==actor.username))==1
        assert await database.scalar(select(func.count()).select_from(ExamPaper).where(ExamPaper.owner_id==actor.username))==0

@pytest.mark.anyio
async def test_teacher_correction_requires_instruction_and_persists(db):
    uploaded = source(question(answer=None))
    command = {'uploadId': 'upload1', 'questionPatches': [{'questionId': 'q1', 'patch': {'correctAnswer': 'b', 'analysis': '教师更正'}}]}
    rejected = await build_plan(db, ACTOR, [uploaded], {'settings': {'duplicatePolicy': 'independent'}, 'items': [command]}, session_id='s')
    assert rejected['items'][0]['questions'][0]['correctAnswer'] is None
    assert rejected['items'][0]['blockers']
    corrected = await build_plan(db, ACTOR, [uploaded], {'settings': {'duplicatePolicy': 'independent'}, 'items': [command], 'userInstruction': '第1题答案更正为b并补充解析'}, session_id='s')
    assert not corrected['items'][0]['blockers']
    assert corrected['items'][0]['questions'][0]['correctAnswer'] == 'b'
    assert corrected['items'][0]['sourceOriginalQuestions'][0]['correctAnswer'] is None
    assert corrected['items'][0]['bankPayload']['questions'][0]['metadata']['teacherAssistantCorrection']['kind'] == 'teacher_correction'
    persisted = await build_plan(db, ACTOR, [uploaded], {'settings': {'nameSuffix': '习题课'}}, session_id='s', previous_plan=corrected)
    assert persisted['items'][0]['questions'][0]['correctAnswer'] == 'b'
    assert not persisted['items'][0]['blockers']
    repeated = await build_plan(db, ACTOR, [uploaded], {'items': [command], 'userInstruction': '请保留原答案，不要修改'}, session_id='s', previous_plan=corrected)
    assert not repeated['items'][0]['blockers']
    assert repeated['items'][0]['correctionProvenance'] == corrected['items'][0]['correctionProvenance']
    forbidden = {**command, 'questionPatches': [{'questionId': 'q1', 'patch': {'metadata': {'principleIds': ['forged']}}}]}
    blocked = await build_plan(db, ACTOR, [uploaded], {'items': [forbidden], 'userInstruction': '更正关联'}, session_id='s')
    assert any('未授权字段' in blocker for blocker in blocked['items'][0]['blockers'])

@pytest.mark.anyio
async def test_combined_export_reupload_includes_questions_and_principles(db, monkeypatch):
    from app.services import teacher_assistant_import as importer
    monkeypatch.setattr(importer.content_prep_shared_service, 'preview_principle_merge', AsyncMock(return_value={'plan': {'conflicts': []}, 'contentRevision': 1}))
    root = Path('/Users/menghao/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_d26m6zr7um9k51_e8f7/msg/file/2026-09')
    paths = [root / 'PMP_财务绩效域_12题母题整理批次_PrepStudio.json', root / 'PMP_进度绩效域_13题母题整理批次_PrepStudio.json', root / '原则与归纳卡-V9.0-P4.6.4.35.json']
    if not all(path.exists() for path in paths):
        pytest.skip('Original combined fixtures unavailable')
    payload = {'format': 'teacher-assistant-bundle-v1', 'banks': [json.loads(path.read_text()) for path in paths[:2]], 'principleBundles': [json.loads(paths[2].read_text())]}
    uploaded = {'id': 'combined', 'name': 'combined.json', 'extracted': {'kind': 'json', 'data': payload, 'warnings': [], 'sections': []}}
    plan = await build_plan(db, ACTOR, [uploaded], {'settings': {'duplicatePolicy': 'independent'}}, session_id='s')
    assert plan['questionCount'] == 25
    assert len(plan['items']) == 3
    assert plan['items'][0]['kind'] == 'principles'
    assert len(plan['items'][0]['principleBundle']['principles']['items']) == 11
    assert all(item['source']['uploadId'] == 'combined' for item in plan['items'])
    for item, original in zip(plan['items'][1:], payload['banks']):
        assert item['questions'] == original['questions']
        assert item['name'] == original['name']

@pytest.mark.anyio
@pytest.mark.parametrize('instruction', ['请保留原答案，不要修改', '不改答案', '原题原答案照搬', '不要修改', '只改名称不改题目'])
async def test_preserve_instruction_cannot_authorize_model_answer_patch(db, instruction):
    model = {'settings': {'duplicatePolicy': 'independent'}, 'userInstruction': instruction, 'items': [{'uploadId': 'upload1', 'questionPatches': [{'questionId': 'q1', 'patch': {'correctAnswer': 'b'}}]}]}
    plan = await build_plan(db, ACTOR, [source()], model, session_id='s')
    assert plan['items'][0]['questions'][0]['correctAnswer'] == 'a'
    assert plan['items'][0]['blockers']

@pytest.mark.anyio
async def test_answer_patch_synchronizes_option_flags(db):
    q = question()
    q['options'][0]['correct'] = True
    q['options'][1]['correct'] = False
    model = {'settings': {'duplicatePolicy': 'independent'}, 'userInstruction': '第一题答案改为 B', 'items': [{'uploadId': 'upload1', 'questionPatches': [{'questionId': 'q1', 'patch': {'correctAnswer': 'B'}}]}]}
    plan = await build_plan(db, ACTOR, [source(q)], model, session_id='s')
    assert not plan['items'][0]['blockers']
    effective = plan['items'][0]['questions'][0]
    assert effective['correctAnswer'] == 'b'
    assert [option['correct'] for option in effective['options']] == [False, True]
    assert plan['items'][0]['sourceOriginalQuestions'][0]['options'][0]['correct'] is True

@pytest.mark.anyio
async def test_real_draft_publish_edit_and_revision_response_loss():
    from uuid import uuid4
    from sqlalchemy import func, select
    from app.db.session import AsyncSessionLocal
    from app.models.user import User
    from app.models.teacher_assistant import TeacherAssistantSession
    from app.models.question import ExamPaper, Question, QuestionBank
    from app.models.paper_release import PaperRelease, PaperReleaseQuestion
    suffix = uuid4().hex[:12]
    async with AsyncSessionLocal() as database:
        actor = User(username='ta-lifecycle-' + suffix, password_hash='test', role='teacher', status='active')
        database.add(actor)
        await database.commit()
        session = TeacherAssistantSession(id='tas-lifecycle-' + suffix, owner_id=actor.username, revision=1)
        initial = await build_plan(database, actor, [source()], {'settings': {'duplicatePolicy': 'independent'}}, session_id=session.id)
        session.plan = initial
        database.add(session)
        await database.commit()
        draft = await execute_plan(database, actor, session, 1)
        assert draft['status'] == 'succeeded', draft
        assert not draft['items'][0].get('releaseId')
        settings = {'publish': True, 'accessLevel': 'free', 'allowedRoles': ['student'], 'enabledModes': ['deep_recall', 'multi_question_canvas']}
        publish_plan = await build_plan(database, actor, [source()], {'settings': settings, 'userInstruction': '发布给免费学员'}, session_id=session.id, previous_plan=initial)
        assert publish_plan['items'][0]['existingObjects']['bankId'] == draft['items'][0]['bankId']
        assert publish_plan['items'][0]['existingObjects']['paperId'] == draft['items'][0]['paperId']
        session.plan, session.revision = publish_plan, 2
        await database.commit()
        published = await execute_plan(database, actor, session, 2)
        assert published['status'] == 'succeeded', json.dumps(published, ensure_ascii=False)
        assert published['items'][0]['paperId'] == draft['items'][0]['paperId']
        first_release = published['items'][0]['releaseId']
        session.receipt = {}
        await database.commit()
        replay = await execute_plan(database, actor, session, 2)
        assert replay['status'] == 'succeeded', replay
        assert replay['items'][0]['releaseId'] == first_release
        edited_plan = await build_plan(database, actor, [source()], {'settings': {'names': {'upload1': '新版习题课'}}, 'userInstruction': '名称改成新版习题课，第一题答案改为b', 'items': [{'uploadId': 'upload1', 'questionPatches': [{'questionId': 'q1', 'patch': {'correctAnswer': 'b'}}]}]}, session_id=session.id, previous_plan=publish_plan)
        assert not edited_plan['items'][0]['blockers'], edited_plan['items'][0]['blockers']
        session.plan, session.revision = edited_plan, 3
        await database.commit()
        edited = await execute_plan(database, actor, session, 3)
        assert edited['status'] == 'succeeded', json.dumps(edited, ensure_ascii=False)
        assert edited['items'][0]['paperId'] == draft['items'][0]['paperId']
        assert edited['items'][0]['releaseId'] != first_release
        paper = await database.get(ExamPaper, draft['items'][0]['paperId'])
        assert paper.name == '新版习题课'
        question_row = (await database.execute(select(Question).where(Question.bank_id == draft['items'][0]['bankId']))).scalar_one()
        assert question_row.correct_answer == 'b'
        old_snapshot = (await database.execute(select(PaperReleaseQuestion).where(PaperReleaseQuestion.release_id == first_release))).scalar_one().snapshot
        assert old_snapshot['correctAnswer'] == 'a'
        session.receipt = {}
        await database.commit()
        final = await execute_plan(database, actor, session, 3)
        assert final['status'] == 'succeeded', final
        assert final['items'][0]['releaseId'] == edited['items'][0]['releaseId']
        assert await database.scalar(select(func.count()).select_from(ExamPaper).where(ExamPaper.owner_id == actor.username)) == 1
        assert await database.scalar(select(func.count()).select_from(QuestionBank).where(QuestionBank.owner_id == actor.username)) == 1
        assert await database.scalar(select(func.count()).select_from(PaperRelease).where(PaperRelease.paper_id == paper.id)) == 2

@pytest.mark.anyio
@pytest.mark.parametrize('external_edit', ['paper', 'question'])
async def test_real_external_revision_conflict_blocks_owned_update(external_edit):
    from uuid import uuid4
    from sqlalchemy import select
    from app.db.session import AsyncSessionLocal
    from app.models.user import User
    from app.models.teacher_assistant import TeacherAssistantSession
    from app.models.question import ExamPaper, Question
    suffix = uuid4().hex[:12]
    async with AsyncSessionLocal() as database:
        actor = User(username='ta-stale-' + suffix, password_hash='test', role='teacher', status='active')
        database.add(actor)
        await database.commit()
        session = TeacherAssistantSession(id='tas-stale-' + suffix, owner_id=actor.username, revision=1)
        initial = await build_plan(database, actor, [source()], {'settings': {'duplicatePolicy': 'independent'}}, session_id=session.id)
        session.plan = initial
        database.add(session)
        await database.commit()
        draft = await execute_plan(database, actor, session, 1)
        assert draft['status'] == 'succeeded'
        changed = await build_plan(database, actor, [source()], {'settings': {'names': {'upload1': '已审批的新名称'}}, 'userInstruction': '第一题答案改为b', 'items': [{'uploadId': 'upload1', 'questionPatches': [{'questionId': 'q1', 'patch': {'correctAnswer': 'b'}}]}]}, session_id=session.id, previous_plan=initial)
        session.plan, session.revision = changed, 2
        paper = await database.get(ExamPaper, draft['items'][0]['paperId'])
        question_row = (await database.execute(select(Question).where(Question.bank_id == draft['items'][0]['bankId']))).scalar_one()
        if external_edit == 'paper':
            paper.name = '外部操作已修改'
            paper.revision += 1
        else:
            question_row.revision += 1
            question_row.content_hash = 'external-edited-hash'
        await database.commit()
        receipt = await execute_plan(database, actor, session, 2)
        assert receipt['status'] == 'partial'
        assert receipt['items'][0]['errorStatus'] == 409, receipt
        assert receipt['items'][0]['errorCode'] in {'PAPER_REVISION_CONFLICT', 'QUESTION_BANK_REVISION_CONFLICT'}
        await database.refresh(question_row)
        assert question_row.correct_answer == 'a'

@pytest.mark.anyio
async def test_real_draft_rename_and_correction_replace_same_objects():
    from uuid import uuid4
    from sqlalchemy import select
    from app.db.session import AsyncSessionLocal
    from app.models.user import User
    from app.models.teacher_assistant import TeacherAssistantSession
    from app.models.question import ExamPaper, Question
    suffix = uuid4().hex[:12]
    async with AsyncSessionLocal() as database:
        actor = User(username='ta-draft-edit-' + suffix, password_hash='test', role='teacher', status='active')
        database.add(actor)
        await database.commit()
        session = TeacherAssistantSession(id='tas-draft-edit-' + suffix, owner_id=actor.username, revision=1)
        first_plan = await build_plan(database, actor, [source()], {'settings': {'duplicatePolicy': 'independent'}}, session_id=session.id)
        session.plan = first_plan
        database.add(session)
        await database.commit()
        first = await execute_plan(database, actor, session, 1)
        second_plan = await build_plan(database, actor, [source()], {'settings': {'nameSuffix': '习题课'}, 'userInstruction': '第一题答案改为b', 'items': [{'uploadId': 'upload1', 'questionPatches': [{'questionId': 'q1', 'patch': {'correctAnswer': 'b'}}]}]}, session_id=session.id, previous_plan=first_plan)
        session.plan, session.revision = second_plan, 2
        await database.commit()
        second = await execute_plan(database, actor, session, 2)
        assert second['status'] == 'succeeded', json.dumps(second, ensure_ascii=False)
        assert second['items'][0]['bankId'] == first['items'][0]['bankId']
        assert second['items'][0]['paperId'] == first['items'][0]['paperId']
        assert not second['items'][0].get('releaseId')
        paper = await database.get(ExamPaper, second['items'][0]['paperId'])
        assert paper.name.endswith('习题课') and paper.status == 'draft'
        q = (await database.execute(select(Question).where(Question.bank_id == second['items'][0]['bankId']))).scalar_one()
        assert q.correct_answer == 'b'

@pytest.mark.anyio
@pytest.mark.parametrize('changed_object', ['question', 'paper'])
async def test_publication_rechecks_committed_preview_after_last_guard(changed_object):
    from uuid import uuid4
    from sqlalchemy import select, func
    from app.db.session import AsyncSessionLocal
    from app.models.user import User
    from app.models.teacher_assistant import TeacherAssistantSession
    from app.models.question import Question, ExamPaper
    from app.models.paper_release import PaperRelease
    suffix = uuid4().hex[:12]
    async with AsyncSessionLocal() as database:
        actor = User(username='ta-publish-race-' + suffix, password_hash='test', role='teacher', status='active')
        database.add(actor)
        await database.commit()
        session = TeacherAssistantSession(id='tas-race-' + suffix, owner_id=actor.username, revision=1)
        model = {'settings': {'duplicatePolicy': 'independent', 'publish': True, 'accessLevel': 'free', 'allowedRoles': ['student'], 'enabledModes': ['deep_recall']}}
        session.plan = await build_plan(database, actor, [source()], model, session_id=session.id)
        database.add(session)
        await database.commit()
        mutated = False
        async def external_edit_after_paper_checkpoint():
            nonlocal mutated
            entry = (session.receipt or {}).get('items', [{}])[0]
            if mutated or not entry.get('paperReady'):
                return
            mutated = True
            async with AsyncSessionLocal() as another_tab:
                if changed_object == 'question':
                    row = (await another_tab.execute(select(Question).where(Question.bank_id == entry['bankId']))).scalar_one()
                    row.correct_answer = 'b'
                    row.revision += 1
                    row.content_hash = 'changed-after-preview'
                else:
                    row = await another_tab.get(ExamPaper, entry['paperId'])
                    row.name = '未预览的外部名称'
                    row.revision += 1
                await another_tab.commit()
        receipt = await execute_plan(database, actor, session, 1, before_step=external_edit_after_paper_checkpoint)
        assert mutated
        assert receipt['status'] == 'partial', receipt
        assert receipt['items'][0]['errorStatus'] == 409
        assert receipt['items'][0]['errorCode'] in {'QUESTION_PREVIEW_CHANGED', 'PAPER_PREVIEW_CHANGED'}
        assert await database.scalar(select(func.count()).select_from(PaperRelease).where(PaperRelease.paper_id == receipt['items'][0]['paperId'])) == 0
