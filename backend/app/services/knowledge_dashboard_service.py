"""Practice freshness from learner-owned answers and frozen question references.

No live question/taxonomy lookup: historical labels stay tied to what the learner
actually practised. Brightness is recency, never a validated mastery score.
"""
from datetime import datetime, timezone
import hashlib
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc
from app.models.training import PracticeSession
from app.services.practice_session_service import _session_question_rows


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


async def get_dashboard(db: AsyncSession, owner: str, *, page=1, page_size=100):
    now = now_utc()
    state = _new_state()
    # Stream all owner history rather than silently limiting the latest sessions.
    # Only compact per-topic accumulators survive a row; response is paginated.
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
    return _result(state, now, page, page_size)
