"""Immutable owner assets. Graph JSON never grants asset ownership."""
import base64
import binascii
from copy import deepcopy
from fastapi import HTTPException
from sqlalchemy import select
from app.core.image_validation import validate_image_bytes
from app.core.security import uid
from app.models.graph_asset import GraphAsset
from app.models.file import GraphFile, FileContent, ACTIVE


def missing():
    raise HTTPException(404, detail={'code': 'GRAPH_ASSET_NOT_FOUND', 'message': '图片不存在或无权访问'})


def references(graph):
    """Only content.images is the graph media contract; retain duplicate references."""
    result = []
    for node in graph.get('nodes', []):
        images = (node.get('content') or {}).get('images', [])
        if not isinstance(images, list):
            raise HTTPException(422, detail='content.images 必须是数组')
        notes = (node.get('content') or {}).get('notes', node.get('notes', ''))
        if not isinstance(notes, str) or len(notes) > 100000:
            raise HTTPException(422, detail='备注超过 100000 字符或格式无效')
        for image in images:
            if not isinstance(image, dict) or not isinstance(image.get('assetId'), str) or not image['assetId']:
                raise HTTPException(422, detail='图片必须引用 assetId')
            result.append(image['assetId'])
    return result


async def validate_graph_assets(db, owner, graph):
    ids = set(references(graph))
    if ids:
        found = set((await db.scalars(select(GraphAsset.id).where(GraphAsset.id.in_(ids), GraphAsset.owner_id == owner))).all())
        if found != ids:
            missing()


async def create_asset(db, owner, *, image_bytes, mime_type, filename='', alt='', commit=False):
    """Transaction primitive for import: flush only unless explicitly committed."""
    width, height = validate_image_bytes(image_bytes, mime_type)
    row = GraphAsset(id=uid('ga_'), owner_id=owner, filename=filename, mime_type=mime_type, alt=alt, data=image_bytes)
    db.add(row)
    await db.flush()
    if commit:
        await db.commit()
        await db.refresh(row)
    return {'assetId': row.id, 'alt': alt, 'width': width, 'height': height}


async def upload_asset(db, user, data):
    try:
        raw = base64.b64decode(data.data_base64, validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(422, detail='图片必须是有效 Base64')
    return await create_asset(db, user.username, image_bytes=raw, mime_type=data.mime_type, filename=data.filename, alt=data.alt, commit=True)


async def authorized_asset(db, owner, asset_id, file_id):
    file = await db.scalar(select(GraphFile).where(GraphFile.id == file_id, GraphFile.owner_id == owner, GraphFile.status == ACTIVE))
    row = await db.scalar(select(GraphAsset).where(GraphAsset.id == asset_id, GraphAsset.owner_id == owner))
    content = await db.get(FileContent, file_id) if file else None
    if row is None or content is None or asset_id not in references(content.graph_data):
        missing()
    return row


async def clone_graph_assets(db, source_owner, target_owner, trusted_graph):
    """Caller MUST authorize the server-loaded source/template before calling.

    No commit: remap each unique immutable blob once inside caller transaction.
    Never expose this primitive directly to user-submitted JSON.
    """
    graph = deepcopy(trusted_graph)
    await validate_graph_assets(db, source_owner, graph)
    mapping = {}
    for asset_id in dict.fromkeys(references(graph)):
        row = await db.get(GraphAsset, asset_id)
        clone = await create_asset(db, target_owner, image_bytes=row.data, mime_type=row.mime_type, filename=row.filename, alt=row.alt)
        mapping[asset_id] = clone['assetId']
    for node in graph.get('nodes', []):
        for image in (node.get('content') or {}).get('images', []):
            image['assetId'] = mapping[image['assetId']]
    return graph, mapping
