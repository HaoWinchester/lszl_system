"""Read-only ranked previews; signed, revision-checked atomic card question append."""
import re
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from fastapi import HTTPException
from sqlalchemy import String, case, cast, func, or_, select
from app.core.config import settings
from app.models.question import Question, QuestionBank
from app.models.graph_question import GraphQuestionBinding as Binding
from app.services import graph_question_service as cards, teaching_content_revision_service

PREVIEW_SECONDS = 900
MAX_ADDITIONS = 2000
MAX_BINDINGS_PER_CARD = 100


def error(code, message, status=422):
    raise HTTPException(status, detail={'code': code, 'message': message})


def serializer():
    return URLSafeTimedSerializer(settings.SECRET_KEY, salt='graph-question-batch-v1')


def node_terms(node):
    content = node.get('content') if isinstance(node.get('content'), dict) else {}
    title = str(content.get('title') or node.get('title') or '').strip()
    keywords = content.get('keywords') or node.get('keywords') or ''
    parts = keywords if isinstance(keywords, list) else re.split(r'[,，、;；\n]+', str(keywords))
    terms = list(dict.fromkeys(str(t).strip()[:200] for t in [title, *parts] if str(t).strip()))[:12]
    return title, terms


async def load_graph(db, user, file_id, node_ids, revision, *, lock=False):
    file, content = await cards.card(db, user, file_id, node_ids[0], lock=lock, expected=revision)
    nodes = {n['id']: n for n in content.graph_data.get('nodes', []) if isinstance(n, dict) and n.get('id')}
    if any(n not in nodes for n in node_ids):
        cards.fail('GRAPH_NODE_NOT_FOUND')
    return file, content, nodes


async def active_bindings(db, file_id, node_ids):
    rows = (await db.scalars(select(Binding).where(Binding.file_id == file_id, Binding.node_id.in_(node_ids), Binding.status == 'active').order_by(Binding.order_index, Binding.id))).all()
    result = {n: [] for n in node_ids}
    for row in rows:
        result[row.node_id].append(row.question_id)
    return result


async def candidates(db, node, existing, count, subject):
    title, terms = node_terms(node)
    limit = min(count, max(0, MAX_BINDINGS_PER_CARD-len(existing)))
    if not terms or not limit:
        return []
    title_hits, knowledge_hits, stem_hits = [], [], []
    for term in terms:
        pattern = '%' + term.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        title_hits.append(Question.title.ilike(pattern, escape='\\'))
        knowledge_hits.append(or_(cast(Question.concepts, String).ilike(pattern, escape='\\'), cast(Question.tags, String).ilike(pattern, escape='\\')))
        stem_hits.append(cast(Question.stem_parts, String).ilike(pattern, escape='\\'))
    title_hit, knowledge_hit, stem_hit = or_(*title_hits), or_(*knowledge_hits), or_(*stem_hits)
    rank = case((func.lower(Question.title) == title.lower(), 0), (knowledge_hit, 1), (title_hit, 2), else_=3)
    stmt = select(Question, QuestionBank.name, rank.label('rank')).join(QuestionBank, QuestionBank.id == Question.bank_id).where(
        func.coalesce(Question.lifecycle['deletedAt'].astext, '') == '',
        func.coalesce(Question.lifecycle['status'].astext, 'active') == 'active',
        Question.type.in_(['single_choice', 'multiple_choice', 'matching']),
        or_(title_hit, knowledge_hit, stem_hit), Question.id.notin_(existing))
    if subject:
        stmt = stmt.where(func.coalesce(Question.subject, QuestionBank.subject) == subject)
    rows = (await db.execute(stmt.order_by(rank, Question.id).limit(limit))).all()
    return [{'id': q.id, 'revision': q.revision, 'title': q.title, 'bankName': bank, 'stem': ' '.join(str(p.get('text', '')) if isinstance(p, dict) else str(p) for p in q.stem_parts or [])[:300], 'matchReason': ['标题精确匹配', '知识点／标签匹配', '标题匹配', '题干匹配'][ranked]} for q, bank, ranked in rows]


async def preview(db, user, file_id, data):
    cards.require_editor(user)
    ids = list(dict.fromkeys(data.node_ids))
    file, content, nodes = await load_graph(db, user, file_id, ids, data.expected_file_revision)
    existing = await active_bindings(db, file_id, ids)
    subject = (content.graph_data.get('meta') or {}).get('subject')
    result, total = [], 0
    for node_id in ids:
        found = await candidates(db, nodes[node_id], existing[node_id], data.count_per_card, subject)
        total += len(found)
        if total > MAX_ADDITIONS:
            error('GRAPH_BATCH_TOO_LARGE', '本次新增超过2000题，请减少卡片数量或每卡题数。')
        title, _ = node_terms(nodes[node_id])
        result.append({'nodeId': node_id, 'title': title or '未命名卡片', 'existingCount': len(existing[node_id]), 'requestedCount': data.count_per_card, 'questions': found, 'shortfall': data.count_per_card-len(found)})
    payload = {'owner': user.username, 'file': file_id, 'revision': file.revision, 'cards': {row['nodeId']: {q['id']: q['revision'] for q in row['questions']} for row in result}}
    return {'fileRevision': file.revision, 'previewToken': serializer().dumps(payload), 'cards': result}


async def apply(db, user, file_id, data):
    cards.require_editor(user)
    try:
        payload = serializer().loads(data.preview_token, max_age=PREVIEW_SECONDS)
    except (SignatureExpired, BadSignature):
        error('GRAPH_BATCH_PREVIEW_INVALID', '预览已过期或无效，请重新匹配。')
    if payload.get('owner') != user.username or payload.get('file') != file_id:
        error('GRAPH_BATCH_PREVIEW_INVALID', '预览不属于当前账号或图谱，请重新匹配。')
    selected = {}
    for row in data.selections:
        if row.node_id in selected:
            error('GRAPH_BATCH_SELECTION_INVALID', '卡片选择重复，请重新匹配。')
        allowed = payload['cards'].get(row.node_id)
        ids = list(dict.fromkeys(row.question_ids))
        if allowed is None or any(q not in allowed for q in ids):
            error('GRAPH_BATCH_SELECTION_INVALID', '只能添加本次预览中的题目，请重新匹配。')
        selected[row.node_id] = ids
    if not any(selected.values()):
        error('GRAPH_BATCH_SELECTION_EMPTY', '请至少选择一道匹配题目。')
    await teaching_content_revision_service.acquire_lock(db)
    file, content, _ = await load_graph(db, user, file_id, list(selected), payload['revision'], lock=True)
    # Validate every selected source before any writes; all grants share one transaction.
    revisions = {q: payload['cards'][n][q] for n, ids in selected.items() for q in ids}
    sources = (await db.scalars(select(Question).where(Question.id.in_(revisions)).order_by(Question.id).with_for_update())).all()
    if len(sources) != len(revisions) or any(q.revision != revisions[q.id] or (q.lifecycle or {}).get('deletedAt') or (q.lifecycle or {}).get('status') not in (None, 'active') for q in sources):
        error('GRAPH_BATCH_SOURCE_CHANGED', '题库内容已变化，请重新匹配。', 409)
    existing = await active_bindings(db, file_id, list(selected))
    added, result = 0, []
    for node_id, question_ids in selected.items():
        ids = list(dict.fromkeys([*existing[node_id], *question_ids]))
        if len(ids) > MAX_BINDINGS_PER_CARD:
            error('GRAPH_BATCH_CARD_FULL', '卡片题目已达到100题，请减少选择。', 409)
        count = len(ids)-len(existing[node_id])
        if count:
            await cards.write_card_bindings(db, user, file_id, node_id, ids)
        added += count
        result.append({'nodeId': node_id, 'addedCount': count})
    file.revision += 1
    content.revision = file.revision
    revision = file.revision
    await db.commit()
    return {'fileRevision': revision, 'addedCount': added, 'cards': result}
