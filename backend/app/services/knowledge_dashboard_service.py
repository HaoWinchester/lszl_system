"""Owner-only practice history and its overlay on the current published catalog.

History keeps frozen labels; the universe uses published taxonomy labels and
exact frozen identifiers. Brightness is activity, never a mastery score.
"""
from datetime import datetime, timezone
import hashlib
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc
from app.models.training import PracticeSession
from app.models.teaching_content import ContentSubject
from app.services.practice_session_service import _session_question_rows
from app.services.teaching_content_current_service import current_taxonomy


def _timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        return None


def _label(value):
    return value.strip()[:200] if isinstance(value, str) else ''


def _knowledge(snapshot):
    metadata = snapshot.get('metadata')
    knowledge = metadata.get('knowledge') if isinstance(metadata, dict) else None
    if not isinstance(knowledge, dict):
        return None
    subject = _label(snapshot.get('subject'))
    taxonomy = _label(knowledge.get('taxonomyId'))
    primary = _label(knowledge.get('primaryNodeId') or knowledge.get('nodeId'))
    raw_path = knowledge.get('pathSnapshot')
    path = []
    for part in raw_path if isinstance(raw_path, list) else []:
        label = _label(part.get('zh') or part.get('title') or part.get('name')) if isinstance(part, dict) else _label(part)
        if label:
            path.append(label)
    # An identifier without a label remains identifiable; it is not assigned an
    # invented topic based on a question title, answer, or another user's graph.
    if not taxonomy or not primary:
        return None
    return subject, taxonomy, primary, tuple(path)


def _new_state():
    return {'groups': {}, 'attemptCount': 0, 'recentAttemptCount': 0,
            'unknownAttemptCount': 0, 'lastPracticedAt': None}


def _add_session(state, answers, snapshots, now):
    if not isinstance(answers, dict):
        return
    for question_id, answer in answers.items():
        if question_id not in snapshots or not isinstance(answer, dict):
            continue
        if answer.get('draft') is True or answer.get('timedOut') is True:
            continue
        timestamp = _timestamp(answer.get('acceptedAt'))
        if timestamp is None and isinstance(answer.get('correct'), bool):
            timestamp = _timestamp(answer.get('submittedAt'))
        # Do not fabricate dates from last_saved_at (opening/saving is not an answer).
        if timestamp is None or timestamp > now:
            continue
        state['attemptCount'] += 1
        if (now-timestamp).total_seconds() <= 7*86400:
            state['recentAttemptCount'] += 1
        state['lastPracticedAt'] = max(state['lastPracticedAt'] or timestamp, timestamp)
        snapshot = snapshots[question_id]
        key = _knowledge(snapshot if isinstance(snapshot, dict) else {})
        if key is None:
            state['unknownAttemptCount'] += 1
            continue
        group = state['groups'].setdefault(key, {'attemptCount': 0, 'last': timestamp})
        group['attemptCount'] += 1
        group['last'] = max(group['last'], timestamp)


def _result(state, now, page, page_size):
    groups = sorted(state['groups'].items(), key=lambda item: (-item[1]['last'].timestamp(), item[0]))
    nodes = []
    for (subject, taxonomy, primary, path), group in groups[(page-1)*page_size:page*page_size]:
        age = max(0, (now-group['last']).total_seconds()/86400)
        key = json.dumps([subject, taxonomy, primary, path], ensure_ascii=False)
        nodes.append({'id': hashlib.sha256(key.encode()).hexdigest()[:24],
                      'subject': subject, 'taxonomyId': taxonomy, 'primaryNodeId': primary,
                      'path': list(path), 'title': path[-1] if path else primary,
                      'attemptCount': group['attemptCount'],
                      'lastPracticedAt': group['last'].isoformat(),
                      'brightness': round(max(.2, 1-.8*age/30), 4)})
    return {'nodes': nodes, 'topicCount': len(groups), 'attemptCount': state['attemptCount'],
            'recentAttemptCount': state['recentAttemptCount'], 'unknownAttemptCount': state['unknownAttemptCount'],
            'lastPracticedAt': state['lastPracticedAt'].isoformat() if state['lastPracticedAt'] else None,
            'now': now.isoformat(), 'page': page, 'pageSize': page_size,
            'hasMore': page*page_size < len(groups), 'brightnessMeaning': 'practice-recency',
            'dimAfterDays': 30}


def aggregate_sessions(rows, *, now=None, page=1, page_size=100):
    """Pure aggregation entry for frozen snapshots; totals cover every input row."""
    now = now or now_utc()
    state = _new_state()
    for answers, snapshots in rows:
        _add_session(state, answers, snapshots, now)
    return _result(state, now, page, page_size)


async def _owner_state(db: AsyncSession, owner: str, now):
    """Read every owner session using one frozen-answer validity policy."""
    state = _new_state()
    # Stream all owner history rather than silently limiting the latest sessions.
    # Only compact per-topic accumulators survive a row.
    sessions = await db.stream_scalars(select(PracticeSession).where(
        PracticeSession.owner_id == owner).execution_options(yield_per=100))
    async for session in sessions:
        if not session.answers:
            continue
        rows = await _session_question_rows(db, session)
        snapshots = {qid: row.snapshot for qid, row in rows.items()}
        # Missing frozen data is reported honestly as unknown, without live reads.
        for ref in session.question_order or []:
            if isinstance(ref, dict) and isinstance(ref.get('questionId'), str):
                snapshots.setdefault(ref['questionId'], {})
        _add_session(state, session.answers, snapshots, now)
    return state


async def get_dashboard(db: AsyncSession, owner: str, *, page=1, page_size=100):
    now = now_utc()
    state = await _owner_state(db, owner, now)
    return _result(state, now, page, page_size)


def _catalog_id(taxonomy_id, node_id):
    key = json.dumps([taxonomy_id, node_id], ensure_ascii=False)
    return hashlib.sha256(key.encode()).hexdigest()[:24]


def _catalog_path(node, nodes):
    """Keep only active in-tree parents; broken/cyclic ancestry becomes a root."""
    chain, seen = [], set()
    current = node
    while current is not None:
        if current.node_id in seen:
            return None, [node.title]
        seen.add(current.node_id)
        chain.append(current.title)
        parent = current.parent_node_id
        if parent and parent not in nodes:
            # An immediate missing parent is a root. Descendants can still
            # follow the valid portion of their published ancestry.
            break
        current = nodes.get(parent)
    parent = node.parent_node_id if node.parent_node_id in nodes else None
    return parent, list(reversed(chain))


async def get_universe(db: AsyncSession, owner: str):
    """Return every active node in each active subject's current published tree."""
    now = now_utc()
    state = await _owner_state(db, owner, now)
    # Frozen path/subject labels may change without changing node identity.
    overlay = {}
    for (_, taxonomy_id, node_id, _), group in state['groups'].items():
        key = (taxonomy_id, node_id)
        total = overlay.setdefault(key, {'attemptCount': 0, 'last': group['last']})
        total['attemptCount'] += group['attemptCount']
        total['last'] = max(total['last'], group['last'])

    nodes, subjects = [], []
    mapped_attempt_count = 0
    subject_rows = (await db.scalars(select(ContentSubject).where(
        ContentSubject.status == 'active').order_by(ContentSubject.code, ContentSubject.id))).all()
    for subject in subject_rows:
        selected = await current_taxonomy(db, subject.id)
        if selected is None:
            continue
        taxonomy, rows = selected
        active = {row.node_id: row for row in rows if row.status == 'active'}
        practiced_count = 0
        for row in active.values():
            group = overlay.get((taxonomy.id, row.node_id))
            practiced = group is not None
            practiced_count += int(practiced)
            attempt_count = group['attemptCount'] if practiced else 0
            mapped_attempt_count += attempt_count
            last = group['last'] if practiced else None
            age = max(0, (now-last).total_seconds()/86400) if practiced else 0
            parent, path = _catalog_path(row, active)
            nodes.append({
                'id': _catalog_id(taxonomy.id, row.node_id),
                'subject': subject.code, 'subjectId': subject.id,
                'taxonomyId': taxonomy.id, 'taxonomyTitle': taxonomy.title,
                'primaryNodeId': row.node_id,
                'parentNodeId': parent,
                'parentId': _catalog_id(taxonomy.id, parent) if parent else None,
                'path': path, 'title': row.title, 'practiced': practiced,
                'attemptCount': attempt_count,
                'lastPracticedAt': last.isoformat() if last else None,
                'brightness': round(max(.4, 1-.6*age/30), 4) if practiced else .12,
            })
        subjects.append({'id': subject.id, 'code': subject.code, 'name': subject.name,
                         'topicCount': len(active), 'practicedTopicCount': practiced_count,
                         'unpracticedTopicCount': len(active)-practiced_count})

    practiced_count = sum(subject['practicedTopicCount'] for subject in subjects)
    return {
        'nodes': nodes, 'subjects': subjects, 'topicCount': len(nodes),
        'practicedTopicCount': practiced_count,
        'unpracticedTopicCount': len(nodes)-practiced_count,
        'attemptCount': state['attemptCount'], 'recentAttemptCount': state['recentAttemptCount'],
        'unknownAttemptCount': state['unknownAttemptCount'],
        'unmappedAttemptCount': state['attemptCount']-state['unknownAttemptCount']-mapped_attempt_count,
        'lastPracticedAt': state['lastPracticedAt'].isoformat() if state['lastPracticedAt'] else None,
        'now': now.isoformat(), 'brightnessMeaning': 'practice-activity', 'dimAfterDays': 30,
    }
