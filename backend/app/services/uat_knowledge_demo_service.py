"""Explicit, owner-isolated frozen-session fixtures for the UAT knowledge sky.

These are labelled test records, not backfilled learner history. Existing UAT
papers have no references to the current PMP taxonomy, so publishing or editing
real papers is deliberately unnecessary. The fixtures reuse canonical grading,
reporting and the production knowledge aggregator, without awarding growth.
"""
from datetime import timedelta
from hashlib import sha256
import re

from sqlalchemy import select, text

from app.core.config import settings
from app.core.security import now_utc
from app.models.teaching_content import ContentSubject
from app.models.training import PracticeSession
from app.models.user import User
from app.schemas.user import UserCreate
from app.services import question_answer_service, user_service
from app.services.knowledge_dashboard_service import _catalog_path
from app.services.practice_session_service import _build_report
from app.services.teaching_content_current_service import current_taxonomy

DEFAULT_USERNAME = 'uat-knowledge-demo'
SOURCE = 'uat-knowledge-demo'
NOTE = 'UAT 星空点亮测试数据；非真实学习记录。'
MARKER = 'knowledge-sky-v1'
COUNTS = (1, 5, 20, 1, 5, 20)


def _identity(username, taxonomy, node):
    return 'uat-ks-' + sha256(f'{username}:{taxonomy}:{node}'.encode()).hexdigest()[:40]


async def _selection(db):
    subject = await db.scalar(select(ContentSubject).where(
        ContentSubject.code == 'PMP', ContentSubject.status == 'active'))
    tree = await current_taxonomy(db, subject.id) if subject else None
    if tree is None:
        raise ValueError('Current published PMP taxonomy is required')
    taxonomy, rows = tree
    active = {row.node_id: row for row in rows if row.status == 'active'}
    parents = {row.parent_node_id for row in active.values()}
    categories = {title: [] for title in ('人', '过程', '环境')}
    for row in active.values():
        if row.node_id in parents:
            continue
        _, path = _catalog_path(row, active)
        if len(path) >= 3 and path[1] in categories:
            categories[path[1]].append((row, path))
    selected = []
    for category, leaves in categories.items():
        leaves.sort(key=lambda entry: (entry[0].position, entry[0].node_id))
        if len(leaves) < len(COUNTS):
            raise ValueError(f'PMP category {category} needs six active leaf nodes')
        for index, count in enumerate(COUNTS):
            row, path = leaves[round(index * (len(leaves)-1)/(len(COUNTS)-1))]
            selected.append((category, row.node_id, path, count))
    return taxonomy.id, selected


def _fixture(username, taxonomy, node, path, count, now):
    session_id = _identity(username, taxonomy, node)
    refs, answers = [], {}
    for index in range(count):
        question_id = f'{session_id}-q{index+1:02}'
        snapshot = {
            'id': question_id, 'subject': 'PMP', 'type': 'single_choice',
            'stem': f'[UAT星空演示] {path[-1]} · 测试记录 {index+1}',
            'options': [{'id': 'A', 'text': '演示选项 A'}, {'id': 'B', 'text': '演示选项 B'}],
            'correctAnswer': 'A', 'analysis': NOTE,
            'metadata': {'uatKnowledgeDemo': MARKER, 'knowledge': {
                'taxonomyId': taxonomy, 'primaryNodeId': node, 'pathSnapshot': path}},
        }
        grading = question_answer_service.grade_selection(snapshot, ['A'])
        refs.append({'questionId': question_id, 'bankId': '', 'orderIndex': index,
                     'score': 1, 'questionSnapshot': snapshot})
        accepted = (now-timedelta(minutes=count-index)).isoformat()
        answers[question_id] = {
            'questionId': question_id, 'selectedAnswer': 'A', 'correctAnswer': 'A',
            'correct': grading['correct'], 'acceptedAt': accepted,
            'submittedAt': accepted, 'submissionIndex': index+1,
        }
    return PracticeSession(
        id=session_id, owner_id=username, mode='practice', status='completed',
        question_order=refs, answers=answers, runtime_state={},
        stats={'total': count, 'answered': count, 'correct': count, 'wrong': 0,
               'unanswered': 0, 'experience': 0, 'durationMs': 0, 'uatKnowledgeDemo': MARKER},
        scoring_snapshot={'domainDataComplete': False}, revision=1,
        started_at=now-timedelta(minutes=count), completed_at=now, last_saved_at=now,
    )


def _valid_existing(existing, expected):
    if (existing.owner_id != expected.owner_id or existing.status != 'completed'
            or existing.mode != 'practice' or existing.release_id is not None
            or (existing.stats or {}).get('uatKnowledgeDemo') != MARKER
            or existing.question_order != expected.question_order
            or set(existing.answers or {}) != set(expected.answers)
            or not isinstance(existing.report_snapshot, dict)):
        return False
    return all(isinstance(answer, dict) and answer.get('correct') is True
               and answer.get('acceptedAt') and not answer.get('draft') and not answer.get('timedOut')
               for answer in existing.answers.values())


async def prepare(db, *, username=DEFAULT_USERNAME, password=None, apply=False):
    """Default read-only plan. Apply only creates missing, clearly marked data."""
    if settings.ENV != 'uat':
        raise ValueError('Only the UAT environment may prepare knowledge demo data')
    if not re.fullmatch(r'uat-knowledge-demo(?:-[a-z0-9-]+)?', username) or len(username) > 64:
        raise ValueError('Only a dedicated uat-knowledge-demo account may be used')
    if apply:
        # Serialize the account bootstrap and fixture creation as one transaction.
        await db.execute(text('SELECT pg_advisory_xact_lock(hashtext(:key))'),
                         {'key': f'uat-knowledge-demo:{username}'})
    user = await db.get(User, username)
    if user and (user.source != SOURCE or user.note != NOTE or user.role != 'student'
                 or user.status != 'active'):
        raise ValueError('Existing account identity is not the active dedicated demo seed')
    taxonomy, selected = await _selection(db)
    now = now_utc()
    expected = [_fixture(username, taxonomy, node, path, count, now)
                for _, node, path, count in selected]
    existing = {row.id: row for row in (await db.scalars(select(PracticeSession).where(
        PracticeSession.id.in_([row.id for row in expected])))).all()}
    missing = []
    for row in expected:
        if row.id in existing:
            if not _valid_existing(existing[row.id], row):
                raise ValueError('Existing demo fixture differs; no records will be overwritten')
        else:
            missing.append(row)
    result = {'username': username, 'taxonomyId': taxonomy, 'applied': apply,
              'userToCreate': user is None, 'directNodeCount': len(selected),
              'categories': ['人', '过程', '环境'], 'attemptCounts': sorted(set(COUNTS)),
              'sessionsToAdd': len(missing), 'attemptsToAdd': sum(len(row.answers) for row in missing),
              'existingSessions': len(existing), 'seedMarker': MARKER,
              'brightnessMeaning': 'node-and-descendant-practice-count'}
    if not apply:
        await db.rollback()
        return result
    if user is None:
        if not isinstance(password, str) or len(password) < 8 or len(password) > 128:
            raise ValueError('A password of 8–128 characters is required for a new demo account')
        user = await user_service.create_user(db, UserCreate(
            username=username, password=password, role='student', status='active',
            display_name='UAT星空演示（测试数据）', subject='PMP',
            source=SOURCE, note=NOTE, tags=['UAT测试数据']), actor=SOURCE, commit=False)
    for row in missing:
        report = await _build_report(db, row)
        report.update(paperName='[UAT测试] 星空点亮演示', resultLabel='UAT测试数据摘要',
                      disclaimer=NOTE, completedAt=now.isoformat())
        row.report_snapshot = report
        db.add(row)
    await db.commit()
    return result
