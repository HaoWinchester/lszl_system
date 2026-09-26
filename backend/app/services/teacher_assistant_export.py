"""Standard import-compatible exports with authorized immutable image references."""
from copy import deepcopy
import hashlib
from fastapi import HTTPException
from app.models.question_material import QuestionAsset
from app.services import question_material_service


def _incomplete():
    return HTTPException(409, '含图片的内容尚未完整保存，或图片资源不可用。请先保存草稿，再导出完整含图 JSON；不会省略图片。')


async def standard_json(db, actor, session):
    if session.owner_id != actor.username:
        raise HTTPException(404, '会话不存在')
    plan, receipt = session.plan or {}, session.receipt or {}
    entries = {entry.get('itemId'): entry for entry in receipt.get('items', [])}
    banks, principles, verified = [], [], {}

    async def resolve(asset, digest=None):
        identifier = asset.get('id') if isinstance(asset, dict) else None
        if not isinstance(identifier, str):
            raise _incomplete()
        if identifier not in verified:
            row = await db.get(QuestionAsset, identifier)
            if row is None or not row.data or (actor.role != 'admin' and row.owner_id != actor.username):
                raise _incomplete()
            verified[identifier] = (question_material_service.asset_payload(row), hashlib.sha256(row.data).hexdigest())
        canonical, actual_digest = verified[identifier]
        if digest is not None and digest != actual_digest:
            raise _incomplete()
        return deepcopy(canonical)

    for item in plan.get('items', []):
        if item.get('kind') == 'principles':
            principles.append(deepcopy(item.get('principleBundle', {})))
            continue
        bank = deepcopy(item.get('bankPayload', {}))
        bank['name'] = item.get('name', bank.get('name', '题库'))
        bank['questions'] = deepcopy(item.get('questions', []))
        entry = entries.get(item.get('id')) or {}
        for question in bank['questions']:
            originals = question.pop('sourceImages', [])
            images = [await resolve(asset) for asset in question.get('images', [])]
            if originals:
                if receipt.get('revision') != session.revision or not entry.get('bankId'):
                    raise _incomplete()
                for image in originals:
                    try:
                        key = image['uploadId'] + ':' + image['filename'] + ':' + image['digest']
                        asset = (entry.get('assets') or {})[key]
                    except (KeyError, TypeError):
                        raise _incomplete()
                    canonical = await resolve(asset, image['digest'])
                    if not any(existing['id'] == canonical['id'] for existing in images):
                        images.append(canonical)
            if images:
                question['images'] = images
        banks.append(bank)
    return principles[0] if not banks and len(principles) == 1 else {
        'format': 'teacher-assistant-bundle-v1', 'banks': banks, 'principleBundles': principles}
