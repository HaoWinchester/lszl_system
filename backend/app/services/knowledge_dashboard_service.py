"""Owner-only practice history and its overlay on the current published catalog.

History keeps frozen labels and recency brightness; the universe uses published
taxonomy labels, exact frozen identifiers and completed-practice proficiency.
"""
from datetime import datetime, timezone
import hashlib
import heapq
import json

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc
from app.models.training import PracticeSession
from app.models.teaching_content import ContentSubject, ContentTaxonomy
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.services import paper_release_service
from app.services.question_preview_service import practice_projection
from app.services.practice_session_service import _session_question_rows
from app.services.teaching_content_current_service import current_taxonomy


async def get_knowledge_questions(db: AsyncSession, user, taxonomy_id: str, node_id: str,
                                 *, page=1, page_size=10):
    """Read-only previews from accessible current publications, never live banks."""
    taxonomy = await db.get(ContentTaxonomy, taxonomy_id)
    subject = await db.get(ContentSubject, taxonomy.subject_id) if taxonomy else None
    current = await current_taxonomy(db, subject.id) if subject and subject.status == 'active' else None
    if not current or current[0].id != taxonomy_id or not any(
            node.node_id == node_id and node.status == 'active' for node in current[1]):
        raise HTTPException(status_code=404, detail='知识点不存在或未发布')

    knowledge = PaperReleaseQuestion.snapshot['metadata']['knowledge']
    identity = func.coalesce(func.nullif(knowledge['primaryNodeId'].astext, ''), knowledge['nodeId'].astext)
    association = (knowledge['taxonomyId'].astext == taxonomy_id, identity == node_id)
    releases = (await db.scalars(select(PaperRelease).join(PaperReleaseQuestion).where(
        PaperRelease.status == paper_release_service.ACTIVE_STATUS, *association).distinct())).all()
    entitled = await paper_release_service.entitlement_for_request(db, user)
    accessible = {release.id: release for release in releases
                  if set(release.enabled_modes or []) & paper_release_service.VALID_MODES
                  and paper_release_service.can_access_with_entitlement(user, release, entitled)}
    query = select(PaperReleaseQuestion).where(
        PaperReleaseQuestion.release_id.in_(accessible), *association)
    total = int(await db.scalar(select(func.count()).select_from(query.subquery())) or 0)
    rows = (await db.scalars(query.order_by(PaperReleaseQuestion.release_id, PaperReleaseQuestion.order_index)
                             .offset((page-1)*page_size).limit(page_size))).all()
    questions = []
    for row in rows:
        snapshot = row.snapshot or {}
        preview = practice_projection(snapshot)
        stem = ''.join(str(part.get('text') or '') for part in preview.get('stemParts', []))
        questions.append({**preview, 'questionId': row.question_id, 'releaseId': row.release_id,
                          'paperId': accessible[row.release_id].paper_id,
                          'paperName': accessible[row.release_id].name,
                          'order': row.order_index+1,
                          'stem': stem or str(snapshot.get('stem') or snapshot.get('title') or '')})
    return {'questions': questions, 'total': total, 'page': page, 'pageSize': page_size,
            'hasMore': page*page_size < total}


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
    return {'groups': {}, 'grades': {}, 'attemptCount': 0, 'recentAttemptCount': 0,
            'unknownAttemptCount': 0, 'lastPracticedAt': None}


def _add_session(state, answers, snapshots, now, *, session_status=None, session_id=''):
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
        # This is the persisted server result, never a fresh guess from the
        # frozen answer or a client field. Active/paused history stays practiced.
        if session_status != 'completed' or not isinstance(answer.get('correct'), bool):
            continue
        _, taxonomy, primary, _ = key
        grades = state['grades'].setdefault((taxonomy, primary), {
            'gradedAttemptCount': 0, 'correctCount': 0, 'recent': []})
        grades['gradedAttemptCount'] += 1
        grades['correctCount'] += int(answer['correct'])
        record = (timestamp, session_id, question_id, answer['correct'])
        # Keep only the latest twenty for each exact catalog identity, even
        # when sessions or frozen path variants arrive in a different order.
        if len(grades['recent']) < 20:
            heapq.heappush(grades['recent'], record)
        else:
            heapq.heappushpop(grades['recent'], record)


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
        _add_session(state, session.answers, snapshots, now,
                     session_status=session.status, session_id=session.id)
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


def _proficiency(grades, practiced):
    recent = sorted(grades['recent']) if grades else []
    count = grades['gradedAttemptCount'] if grades else 0
    recent_correct = sum(int(record[3]) for record in recent)
    accuracy = recent_correct/len(recent) if recent else None
    streak = 0
    for record in reversed(recent):
        if not record[3]:
            break
        streak += 1
    score = round(100*(.8*accuracy+.2*min(streak/5, 1))*(.25+.75*min(count/10, 1)), 1) if count else None
    level = ('unpracticed' if not practiced else 'pending' if score is None else
             'developing' if score < 40 else 'familiar' if score < 75 else 'proficient')
    return {
        'proficiencyScore': score, 'proficiencyLevel': level,
        'gradedAttemptCount': count, 'correctCount': grades['correctCount'] if grades else 0,
        'recentGradedAttemptCount': len(recent), 'recentCorrectCount': recent_correct,
        'recentAccuracy': accuracy, 'correctStreak': streak,
        'brightness': .12 if not practiced else .2 if score is None else round(.2+.8*score/100, 4),
    }


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
                **_proficiency(state['grades'].get((taxonomy.id, row.node_id)), practiced),
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
        'now': now.isoformat(), 'brightnessMeaning': 'practice-proficiency',
    }
