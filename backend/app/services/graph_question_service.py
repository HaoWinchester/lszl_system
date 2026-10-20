"""Card-scoped authority: all grants originate in server-loaded frozen snapshots."""
from copy import deepcopy
from urllib.parse import urlencode
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.core.security import uid
from app.models.file import GraphFile, FileContent
from app.models.graph_question import GraphQuestionBinding as Binding, GraphQuestionAttempt as Attempt
from app.models.question import Question, QuestionBank
from app.models.user import User
from app.services import question_answer_service as answers, question_catalog_service as catalog
from app.services.question_material_service import freeze_question_resources
from app.services.question_access_service import TEACHING_MANAGER_ROLES
from app.services import teaching_content_revision_service


def fail(code, status=404):
    raise HTTPException(status, detail={'code': code})


def require_editor(user):
    if user.role not in TEACHING_MANAGER_ROLES:
        fail('GRAPH_QUESTION_EDITOR_REQUIRED', 403)


async def card(db, user, file_id, node_id, *, lock=False, expected=None):
    if user.role not in {'admin', 'teacher', 'student'}:
        fail('GRAPH_QUESTION_READER_REQUIRED', 403)
    stmt = select(GraphFile).where(GraphFile.id == file_id, GraphFile.owner_id == user.username, GraphFile.status == 'active')
    if lock:
        stmt = stmt.with_for_update()
    file = await db.scalar(stmt)
    if file is None:
        fail('GRAPH_FILE_NOT_FOUND')
    if expected is not None and expected != file.revision:
        fail('GRAPH_FILE_REVISION_CONFLICT', 409)
    content = await db.get(FileContent, file_id)
    if content is None or not any(isinstance(n, dict) and n.get('id') == node_id for n in content.graph_data.get('nodes', [])):
        fail('GRAPH_NODE_NOT_FOUND')
    return file, content


async def authorized_binding(db, user, file_id, node_id, binding_id, source_version=None, *, lock=False, active=True):
    await card(db, user, file_id, node_id, lock=lock)
    stmt = select(Binding).where(Binding.id == binding_id, Binding.owner_id == user.username, Binding.file_id == file_id, Binding.node_id == node_id)
    if lock:
        stmt = stmt.with_for_update()
    row = await db.scalar(stmt)
    if row is None or (active and row.status != 'active'):
        fail('GRAPH_BINDING_NOT_FOUND')
    if source_version is not None and row.source_version != source_version:
        fail('GRAPH_SNAPSHOT_VERSION_CONFLICT', 409)
    return row


async def freeze_source(db, question_id):
    question = await db.scalar(select(Question).where(Question.id == question_id).with_for_update())
    if question is None or (question.lifecycle or {}).get('deletedAt') or (question.lifecycle or {}).get('status') not in {None, 'active'}:
        fail('QUESTION_NOT_FOUND')
    bank = await db.get(QuestionBank, question.bank_id)
    owner = await db.get(User, bank.owner_id)
    # Authorized cross-bank source, then resolve resources as that source's owner.
    snapshot = deepcopy(catalog.question_to_payload(question))
    await freeze_question_resources(db, owner, snapshot, exact_revision=True)
    return snapshot


def practice_projection(snapshot):
    """Positive projection drops every arbitrary metadata/translation/answer carrier."""
    result = {key: deepcopy(snapshot[key]) for key in ('id', 'title', 'type', 'subject', 'difficulty', 'revision') if key in snapshot}
    result['stemParts'] = [{'text': p.get('text', '')} for p in snapshot.get('stemParts', []) if isinstance(p, dict)]
    result['options'] = [{'id': p.get('id'), 'text': p.get('text', '')} for p in snapshot.get('options', []) if isinstance(p, dict)]
    if snapshot.get('images'):
        result['images'] = deepcopy(snapshot['images'])
    if isinstance(snapshot.get('material'), dict):
        result['material'] = {key: deepcopy(snapshot['material'][key]) for key in ('id', 'revision', 'title', 'text', 'images') if key in snapshot['material']}
    if isinstance(snapshot.get('matching'), dict):
        result['matching'] = {side: [{'id': p.get('id'), 'text': p.get('text', '')} for p in snapshot['matching'].get(side, [])] for side in ('left', 'right')}
    if isinstance(snapshot.get('caseGroup'), dict):
        result['caseGroup'] = {k: deepcopy(snapshot['caseGroup'][k]) for k in ('id', 'order') if k in snapshot['caseGroup']}
    return result


def binding_payload(row, *, practice=True):
    result = {'id': row.id, 'questionId': row.question_id, 'questionRevision': row.question_revision, 'sourceVersion': row.source_version, 'orderIndex': row.order_index, 'status': row.status}
    if practice:
        snapshot = practice_projection(row.snapshot)
        params = urlencode({'fileId': row.file_id, 'nodeId': row.node_id, 'bindingId': row.id, 'sourceVersion': row.source_version})
        for image in list(snapshot.get('images', [])) + list((snapshot.get('material') or {}).get('images', [])):
            image['url'] = f"/api/v1/question-assets/{image['id']}?{params}"
        result['question'] = snapshot
    return result


async def list_bindings(db, user, file_id, node_id):
    await card(db, user, file_id, node_id)
    rows = (await db.scalars(select(Binding).where(Binding.owner_id == user.username, Binding.file_id == file_id, Binding.node_id == node_id, Binding.status == 'active').order_by(Binding.order_index, Binding.id))).all()
    return {'bindings': [binding_payload(r) for r in rows]}


async def write_card_bindings(db, user, file_id, node_id, question_ids):
    """Write within a caller-owned teaching lock/file lock transaction; never commit."""
    ids = list(dict.fromkeys(question_ids))
    rows = (await db.scalars(select(Binding).where(Binding.file_id == file_id, Binding.node_id == node_id).with_for_update())).all()
    existing = {r.question_id: r for r in rows}
    for row in rows:
        if row.question_id not in ids:
            row.status = 'revoked'
    for index, question_id in enumerate(ids):
        row = existing.get(question_id)
        if row is None:
            snapshot = await freeze_source(db, question_id)
            row = Binding(id=uid('gqb_'), owner_id=user.username, file_id=file_id, node_id=node_id, question_id=question_id, question_revision=snapshot['revision'], source_version=uid('gqv_'), order_index=index, created_by=user.username, snapshot=snapshot, status='active')
            db.add(row)
        elif row.status != 'active':
            # Regrant is explicit and freezes the current source, never revives a stale version.
            row.snapshot = await freeze_source(db, question_id)
            row.question_revision = row.snapshot['revision']
            row.source_version = uid('gqv_')
            row.status = 'active'
        row.order_index = index


async def set_bindings(db, user, file_id, node_id, data):
    require_editor(user)
    await teaching_content_revision_service.acquire_lock(db)
    file, content = await card(db, user, file_id, node_id, lock=True, expected=data.expected_file_revision)
    await write_card_bindings(db, user, file_id, node_id, data.question_ids)
    file.revision += 1
    content.revision = file.revision
    revision = file.revision
    await db.commit()
    return {**await list_bindings(db, user, file_id, node_id), 'fileRevision': revision}


async def revise_binding(db, user, file_id, node_id, binding_id, data, *, refresh=False):
    require_editor(user)
    await teaching_content_revision_service.acquire_lock(db)
    file, content = await card(db, user, file_id, node_id, lock=True, expected=data.expected_file_revision)
    row = await authorized_binding(db, user, file_id, node_id, binding_id, data.source_version, lock=True)
    if refresh:
        row.snapshot = await freeze_source(db, row.question_id)
        row.question_revision = row.snapshot['revision']
        row.source_version = uid('gqv_')
    else:
        row.status = 'revoked'
    file.revision += 1
    content.revision = file.revision
    result = {'binding': binding_payload(row), 'fileRevision': file.revision}
    await db.commit()
    return result


def normalize_selection(snapshot, data):
    if snapshot.get('type') == 'matching':
        if data.selected_option_ids is not None:
            fail('GRAPH_SELECTION_INVALID', 422)
        try:
            return {'selectedPairs': answers.validate_selected_pairs(snapshot, data.selected_pairs)}
        except (ValueError, KeyError, TypeError):
            fail('GRAPH_SELECTION_INVALID', 422)
    if data.selected_pairs is not None or not isinstance(data.selected_option_ids, list) or not data.selected_option_ids:
        fail('GRAPH_SELECTION_INVALID', 422)
    allowed = [str(o['id']) for o in snapshot.get('options', [])]
    if any(v not in allowed for v in data.selected_option_ids) or len(data.selected_option_ids) != len(set(data.selected_option_ids)):
        fail('GRAPH_SELECTION_INVALID', 422)
    if snapshot.get('type') != 'multiple_choice' and len(data.selected_option_ids) != 1:
        fail('GRAPH_SELECTION_INVALID', 422)
    return {'selectedOptionIds': answers.normalize_option_ids(data.selected_option_ids, allowed)}


def attempt_payload(row):
    return {'id': row.id, 'bindingId': row.binding_id, 'sourceVersion': row.source_version, 'questionRevision': row.question_revision, 'requestId': row.request_id, 'selection': row.selection, 'correct': row.result['correct'], 'submittedAt': row.submitted_at.isoformat()}


async def submit(db, user, file_id, node_id, binding_id, data):
    # Join the cleanup reference lock, then serialize revoke/refresh and retry.
    await teaching_content_revision_service.acquire_lock(db)
    row = await authorized_binding(db, user, file_id, node_id, binding_id, data.source_version, lock=True)
    selection = normalize_selection(row.snapshot, data)
    previous = await db.scalar(select(Attempt).where(Attempt.owner_id == user.username, Attempt.request_id == data.request_id))
    if previous:
        if (previous.binding_id, previous.source_version, previous.selection) != (row.id, row.source_version, selection):
            fail('GRAPH_REQUEST_ID_CONFLICT', 409)
        return {'attempt': attempt_payload(previous)}
    result = answers.grade_selection(row.snapshot, selection.get('selectedPairs') if row.snapshot.get('type') == 'matching' else selection['selectedOptionIds'])
    attempt = Attempt(id=uid('gqa_'), owner_id=user.username, binding_id=row.id, file_id=file_id, node_id=node_id, source_version=row.source_version, question_revision=row.question_revision, request_id=data.request_id, selection=selection, result=result, snapshot=deepcopy(row.snapshot))
    db.add(attempt)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        fail('GRAPH_REQUEST_ID_CONFLICT', 409)
    await db.refresh(attempt)
    return {'attempt': attempt_payload(attempt)}


async def history(db, user, attempt_id):
    if user.role not in {'admin', 'teacher', 'student'}:
        fail('GRAPH_QUESTION_READER_REQUIRED', 403)
    row = await db.scalar(select(Attempt).where(Attempt.id == attempt_id, Attempt.owner_id == user.username))
    if row is None:
        fail('GRAPH_ATTEMPT_NOT_FOUND')
    # Historical record is retained after file/node removal and explicit revoke.
    snapshot = deepcopy(row.snapshot)
    params = urlencode({'fileId': row.file_id, 'nodeId': row.node_id, 'bindingId': row.binding_id, 'sourceVersion': row.source_version, 'attemptId': row.id})
    for image in list(snapshot.get('images', [])) + list((snapshot.get('material') or {}).get('images', [])):
        image['url'] = f"/api/v1/question-assets/{image['id']}?{params}"
    return {'attempt': attempt_payload(row), 'result': deepcopy(row.result), 'analysis': row.snapshot.get('analysis', ''), 'question': snapshot}


async def authorized_asset(db, user, asset_id, file_id, node_id, binding_id, source_version, attempt_id=None):
    if attempt_id is not None:
        if user.role not in {'admin', 'teacher', 'student'}:
            fail('GRAPH_QUESTION_READER_REQUIRED', 403)
        row = await db.scalar(select(Attempt).where(Attempt.id == attempt_id, Attempt.owner_id == user.username, Attempt.file_id == file_id, Attempt.node_id == node_id, Attempt.binding_id == binding_id, Attempt.source_version == source_version))
        if row is None:
            fail('GRAPH_ATTEMPT_NOT_FOUND')
    else:
        row = await authorized_binding(db, user, file_id, node_id, binding_id, source_version)
    images = list(row.snapshot.get('images', [])) + list((row.snapshot.get('material') or {}).get('images', []))
    if not any(image.get('id') == asset_id for image in images):
        fail('ASSET_NOT_FOUND')


async def export_card_bindings(db, user, file_id, node_id):
    """Trusted server use only: authorize owned live card, return immutable descriptors."""
    await card(db, user, file_id, node_id)
    rows = (await db.scalars(select(Binding).where(Binding.owner_id == user.username, Binding.file_id == file_id, Binding.node_id == node_id, Binding.status == 'active').order_by(Binding.order_index))).all()
    return [{'questionId': r.question_id, 'questionRevision': r.question_revision, 'snapshot': deepcopy(r.snapshot)} for r in rows]


async def clone_card_bindings(db, target_owner, target_file_id, target_node_id, trusted_bindings):
    """Flush only. Caller authorizes immutable source and owns transaction; never HTTP input."""
    await teaching_content_revision_service.acquire_lock(db)
    file = await db.get(GraphFile, target_file_id)
    content = await db.get(FileContent, target_file_id)
    if file is None or file.owner_id != target_owner or file.status != 'active' or content is None or not any(n.get('id') == target_node_id for n in content.graph_data.get('nodes', [])):
        fail('GRAPH_NODE_NOT_FOUND')
    result = []
    for index, source in enumerate(trusted_bindings):
        row = Binding(id=uid('gqb_'), owner_id=target_owner, file_id=target_file_id, node_id=target_node_id, question_id=source['questionId'], question_revision=source['questionRevision'], source_version=uid('gqv_'), order_index=index, created_by=target_owner, snapshot=deepcopy(source['snapshot']), status='active')
        db.add(row)
        result.append(row)
    await db.flush()
    return result
