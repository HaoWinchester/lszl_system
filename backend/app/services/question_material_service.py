"""Material ownership, immutable revisions and release-scoped asset access."""
from __future__ import annotations
import base64
import binascii
from copy import deepcopy
from io import BytesIO
import warnings
from PIL import Image
from fastapi import HTTPException
from sqlalchemy import or_, select
from app.core.security import uid
from app.models.question_material import QuestionAsset, QuestionMaterial, QuestionMaterialRevision
from app.models.question import Question
from app.models.paper_release import PaperRelease, PaperReleaseQuestion


def fail(code, message, status=422, **details):
    raise HTTPException(status, detail={'code': code, 'message': message, **details})


def material_payload(row):
    return {'id': row.id, 'revision': row.revision, 'title': row.title, 'text': row.text, 'images': deepcopy(row.images)}


def asset_payload(row):
    return {'id': row.id, 'url': f'/api/v1/question-assets/{row.id}', 'alt': row.alt}


async def owned_material(db, user, material_id, *, lock=False):
    stmt = select(QuestionMaterial).where(QuestionMaterial.id == material_id)
    if user.role != 'admin':
        stmt = stmt.where(QuestionMaterial.owner_id == user.username)
    if lock:
        stmt = stmt.with_for_update()
    row = await db.scalar(stmt)
    if row is None:
        fail('MATERIAL_NOT_FOUND', '材料不存在或无权访问', 404)
    return row


async def upload_asset(db, user, data):
    try:
        image_bytes = base64.b64decode(data.data_base64, validate=True)
    except (ValueError, binascii.Error):
        fail('ASSET_INVALID', '图片必须是有效 Base64')
    if not image_bytes or len(image_bytes) > 5 * 1024 * 1024:
        fail('ASSET_SIZE_INVALID', '图片不能超过 5 MiB')
    formats = {'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WEBP'}
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(image_bytes)) as image:
                if image.format != formats.get(data.mime_type) or image.width * image.height > 40_000_000:
                    raise ValueError('format')
                image.verify()
    except Exception:
        fail('ASSET_INVALID', '仅支持有效的 PNG、JPEG、WebP 图片')
    row = QuestionAsset(id=uid('qa_'), owner_id=user.username, filename=data.filename, mime_type=data.mime_type, alt=data.alt, data=image_bytes)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return asset_payload(row)


async def canonical_images(db, user, images):
    result = []
    for image in images:
        if not isinstance(image, dict) or not isinstance(image.get('id'), str):
            fail('ASSET_INVALID', '图片必须引用已上传资源')
        row = await db.get(QuestionAsset, image['id'])
        if row is None or (user.role != 'admin' and row.owner_id != user.username):
            fail('ASSET_NOT_FOUND', '图片不存在或无权使用', 404)
        result.append(asset_payload(row))
    return result


async def save_material(db, user, data, material_id=None, *, commit=True, new_id=None):
    row = await owned_material(db, user, material_id, lock=True) if material_id else None
    if row is not None and data.revision != row.revision:
        fail('MATERIAL_REVISION_CONFLICT', '材料已更新，请刷新后重试', 409, currentRevision=row.revision)
    images = await canonical_images(db, user, data.images)
    if row is None:
        row = QuestionMaterial(id=new_id or uid('qm_'), owner_id=user.username, revision=1)
        db.add(row)
    else:
        row.revision += 1
    row.title, row.text, row.images = data.title, data.text, images
    await db.flush()
    db.add(QuestionMaterialRevision(material_id=row.id, revision=row.revision, snapshot=material_payload(row)))
    if commit:
        await db.commit()
        await db.refresh(row)
    return material_payload(row)


async def delete_material(db, user, material_id, revision):
    row = await owned_material(db, user, material_id, lock=True)
    if revision != row.revision:
        fail('MATERIAL_REVISION_CONFLICT', '材料已更新，请刷新后重试', 409, currentRevision=row.revision)
    question = await db.scalar(select(Question.id).where(Question.content_metadata['_mixedContent']['material']['id'].astext == material_id).limit(1))
    release = await db.scalar(select(PaperReleaseQuestion.release_id).where(PaperReleaseQuestion.snapshot['material']['id'].astext == material_id).limit(1))
    if question or release:
        fail('MATERIAL_REFERENCED', '材料已被题目或发布版本引用，不能删除', 409)
    await db.delete(row)
    await db.commit()


async def freeze_question_resources(db, user, snapshot):
    """Resolve every requested version through server-owned immutable resources."""
    if snapshot.get('images'):
        snapshot['images'] = await canonical_images(db, user, snapshot['images'])
    material = snapshot.get('material')
    if material is not None:
        if not isinstance(material, dict) or not isinstance(material.get('revision'), int):
            fail('MATERIAL_INVALID', '材料引用必须包含 id 和 revision')
        row = await owned_material(db, user, str(material.get('id') or ''))
        revision = await db.get(QuestionMaterialRevision, (row.id, row.revision))
        if revision is None:
            fail('MATERIAL_REVISION_NOT_FOUND', '材料版本不存在', 404)
        snapshot['material'] = deepcopy(revision.snapshot)
    return snapshot


async def authorized_asset(db, user, asset_id):
    row = await db.get(QuestionAsset, asset_id)
    if row is None:
        fail('ASSET_NOT_FOUND', '图片不存在或无权访问', 404)
    if user.role == 'admin' or (user.role == 'teacher' and row.owner_id == user.username):
        return row
    # Only releases actually referencing this asset grant learner access.
    query = select(PaperRelease).join(PaperReleaseQuestion, PaperRelease.id == PaperReleaseQuestion.release_id).where(
        PaperRelease.status.in_(['published', 'superseded']),
        or_(PaperReleaseQuestion.snapshot['images'].contains([{'id': asset_id}]),
            PaperReleaseQuestion.snapshot['material']['images'].contains([{'id': asset_id}]))).distinct()
    from app.services import paper_release_service
    entitled = await paper_release_service.entitlement_for_request(db, user)
    for release in (await db.scalars(query)).all():
        if paper_release_service.can_access_with_entitlement(user, release, entitled):
            return row
    fail('ASSET_NOT_FOUND', '图片不存在或无权访问', 404)


async def hydrate_current_materials(db, snapshots):
    """Refresh editable catalog views in one query; releases stay immutable."""
    ids = {snapshot['material'].get('id') for snapshot in snapshots if isinstance(snapshot.get('material'), dict)}
    if not ids:
        return snapshots
    rows = (await db.scalars(select(QuestionMaterial).where(QuestionMaterial.id.in_(ids)))).all()
    current = {row.id: material_payload(row) for row in rows}
    for snapshot in snapshots:
        material = snapshot.get('material')
        if isinstance(material, dict) and material.get('id') in current:
            snapshot['material'] = deepcopy(current[material['id']])
    return snapshots


async def normalize_question_resources(db, user, normalized):
    """Prepare a canonical material edit without mutating either resource."""
    command = normalized.pop('materialEdit', None)
    if command is not None:
        from pydantic import ValidationError
        from app.schemas.question_material import MaterialEditInput
        try:
            edit = MaterialEditInput.model_validate(command)
        except ValidationError as error:
            fail('MATERIAL_INVALID', '材料编辑内容无效')
        row = await owned_material(db, user, edit.id) if edit.id else None
        if row is not None and edit.revision != row.revision:
            fail('MATERIAL_REVISION_CONFLICT', '材料已更新，请刷新后重试', 409, currentRevision=row.revision)
        images = await canonical_images(db, user, edit.images)
        material = {'id': row.id if row else uid('qm_'), 'revision': row.revision + 1 if row else 1,
                    'title': edit.title, 'text': edit.text, 'images': images}
        normalized['material'] = material
        if isinstance(normalized.get('caseGroup'), dict):
            normalized['caseGroup'] = {**normalized['caseGroup'], 'id': material['id']}
        normalized['_materialEdit'] = {'existingId': row.id if row else None, 'snapshot': material,
                                       'revision': edit.revision}
        if normalized.get('images'):
            normalized['images'] = await canonical_images(db, user, normalized['images'])
    elif any(normalized.get(key) for key in ('images', 'material', 'caseGroup')):
        await freeze_question_resources(db, user, normalized)
    else:
        return
    extensions = normalized.setdefault('metadata', {}).setdefault('_mixedContent', {})
    extensions.update({key: deepcopy(normalized[key]) for key in ('images', 'material', 'caseGroup', 'matching') if normalized.get(key) is not None})


async def apply_question_material_edit(db, user, normalized):
    """Called after question validation/CAS; the caller owns the transaction."""
    command = normalized.get('_materialEdit')
    if not command:
        return
    from app.schemas.question_material import MaterialInput
    snapshot = command['snapshot']
    edit = MaterialInput(title=snapshot['title'], text=snapshot['text'], images=snapshot['images'], revision=command['revision'])
    await save_material(db, user, edit, command['existingId'], commit=False, new_id=snapshot['id'])
