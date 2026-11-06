"""Published knowledge-node audio metadata and bounded authenticated delivery."""
from hashlib import sha256
import json
from pathlib import PurePath
from urllib.parse import quote

from fastapi import HTTPException
from sqlalchemy import func, select

from app.core.http_range import RangeNotSatisfiable, byte_range
from app.core.security import uid
from app.models.knowledge_audio import KnowledgeAudio
from app.models.teaching_content import ContentSubject, ContentTaxonomy, TaxonomyNode, TeachingContentAudit
from app.models.user import User
from app.services import teaching_content_current_service, teaching_content_revision_service

MAX_AUDIO_BYTES = 64 * 1024 * 1024
SUMMARY_COLUMNS = (KnowledgeAudio.id, KnowledgeAudio.title, KnowledgeAudio.mime_type,
                   KnowledgeAudio.byte_length, KnowledgeAudio.duration_ms)


def missing():
    raise HTTPException(404, detail='知识点讲解不存在或当前不可用')


def summary(row):
    return {'id': row.id, 'title': row.title, 'mimeType': row.mime_type,
            'byteLength': row.byte_length, 'durationMs': row.duration_ms,
            'contentUrl': f'/api/v1/learning/knowledge-audios/{row.id}/content'}


async def authorized_node(db, taxonomy_id, node_id):
    """Authorize a current published node using only the required columns."""
    subject_id = await db.scalar(select(ContentTaxonomy.subject_id)
        .join(ContentSubject, ContentSubject.id == ContentTaxonomy.subject_id)
        .join(TaxonomyNode, TaxonomyNode.taxonomy_id == ContentTaxonomy.id)
        .where(ContentTaxonomy.id == taxonomy_id, ContentTaxonomy.status == 'published',
               ContentSubject.status == 'active', TaxonomyNode.node_id == node_id,
               TaxonomyNode.status == 'active'))
    if subject_id is None or await teaching_content_current_service.current_taxonomy_id(db, subject_id) != taxonomy_id:
        missing()


async def audio_counts(db, taxonomy_id):
    """Read count-only discovery hints for a caller's already resolved tree."""
    rows = (await db.execute(select(KnowledgeAudio.node_id, func.count(KnowledgeAudio.id))
        .where(KnowledgeAudio.taxonomy_id == taxonomy_id).group_by(KnowledgeAudio.node_id))).all()
    return {node_id: count for node_id, count in rows}


async def list_audios(db, taxonomy_id, node_id, *, offset=0, limit=20):
    if type(offset) is not int or offset < 0 or type(limit) is not int or not 1 <= limit <= 100:
        raise HTTPException(422, detail='音频分页参数无效')
    await teaching_content_revision_service.acquire_read_lock(db)
    await authorized_node(db, taxonomy_id, node_id)
    where = (KnowledgeAudio.taxonomy_id == taxonomy_id, KnowledgeAudio.node_id == node_id)
    total = await db.scalar(select(func.count(KnowledgeAudio.id)).where(*where))
    rows = (await db.execute(select(*SUMMARY_COLUMNS).where(*where)
        .order_by(KnowledgeAudio.created_at, KnowledgeAudio.id).offset(offset).limit(limit))).all()
    return {'items': [summary(row) for row in rows], 'total': total, 'offset': offset, 'limit': limit}


async def content(db, audio_id, *, range_header=None, head=False, if_range=None):
    await teaching_content_revision_service.acquire_read_lock(db)
    row = (await db.execute(select(KnowledgeAudio.id, KnowledgeAudio.taxonomy_id,
        KnowledgeAudio.node_id, KnowledgeAudio.mime_type, KnowledgeAudio.byte_length,
        KnowledgeAudio.filename, KnowledgeAudio.sha256).where(KnowledgeAudio.id == audio_id))).one_or_none()
    if row is None:
        missing()
    await authorized_node(db, row.taxonomy_id, row.node_id)
    etag = '"'+row.sha256+'"'
    # HEAD describes the complete representation and never reads binary data.
    requested = None if head or if_range is not None and if_range != etag else range_header
    try:
        start, end, partial = byte_range(requested, row.byte_length)
    except RangeNotSatisfiable:
        raise HTTPException(416, detail='音频请求范围无效', headers={
            'Content-Range': f'bytes */{row.byte_length}', 'Accept-Ranges': 'bytes'})
    length = end-start+1
    headers = {'Accept-Ranges': 'bytes', 'Content-Length': str(length), 'ETag': etag,
               'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
               'Content-Disposition': "inline; filename*=UTF-8''"+quote(row.filename, safe='')}
    if partial:
        headers['Content-Range'] = f'bytes {start}-{end}/{row.byte_length}'
    # PostgreSQL slices BYTEA before transfer; a one-byte probe never loads a file.
    body = b'' if head else await db.scalar(select(func.substr(
        KnowledgeAudio.data, start+1, length)).where(KnowledgeAudio.id == audio_id))
    return {'content': body, 'status_code': 206 if partial else 200,
            'media_type': row.mime_type, 'headers': headers}


async def import_audio(db, *, actor, taxonomy_id, node_id, title, filename,
                       data, duration_ms, expected_sha256=None, apply=False):
    """Plan by default; atomically add immutable content only for active editors."""
    editor = (await db.execute(select(User.role, User.status).where(User.username == actor))).one_or_none()
    if editor is None or editor.status != 'active' or editor.role not in ('admin', 'teacher'):
        raise HTTPException(403, detail='仅管理员或老师可以导入知识点讲解')
    if not isinstance(data, bytes) or not 16 <= len(data) <= MAX_AUDIO_BYTES or data[4:8] != b'ftyp':
        raise HTTPException(422, detail='需要不超过64MB的原始M4A音频文件')
    if not isinstance(title, str) or not title.strip() or len(title.strip()) > 240:
        raise HTTPException(422, detail='讲解标题必须为1到240个字符')
    if not isinstance(filename, str) or PurePath(filename).name != filename or not filename.lower().endswith('.m4a') or len(filename) > 200:
        raise HTTPException(422, detail='原始文件名必须是有效M4A文件名')
    if type(duration_ms) is not int or not 0 < duration_ms <= 43_200_000:
        raise HTTPException(422, detail='音频时长必须为1毫秒到12小时')
    digest = sha256(data).hexdigest()
    if expected_sha256 is not None and expected_sha256.lower() != digest:
        raise HTTPException(422, detail='音频SHA256与预期不一致')
    if apply:
        await teaching_content_revision_service.acquire_lock(db)
    else:
        await teaching_content_revision_service.acquire_read_lock(db)
    await authorized_node(db, taxonomy_id, node_id)
    identity = json.dumps([taxonomy_id, node_id, digest], separators=(',', ':'), ensure_ascii=False)
    identifier = 'ka_'+sha256(identity.encode()).hexdigest()[:48]
    existing = (await db.execute(select(*SUMMARY_COLUMNS).where(KnowledgeAudio.id == identifier))).one_or_none()
    created = False
    row = existing
    if row is None:
        row = KnowledgeAudio(id=identifier, taxonomy_id=taxonomy_id, node_id=node_id,
            title=title.strip(), filename=filename, mime_type='audio/mp4', byte_length=len(data),
            duration_ms=duration_ms, sha256=digest, data=data, created_by=actor)
        if apply:
            db.add(row)
            await db.flush()
            db.add(TeachingContentAudit(id=uid('kaa_'), entity_type='knowledge_audio',
                entity_id=identifier, action='created', actor_username=actor,
                after={**summary(row), 'taxonomyId': taxonomy_id, 'nodeId': node_id, 'sha256': digest}))
            await teaching_content_revision_service.bump(db, actor, [{
                'entityType': 'knowledge_audio', 'entityId': identifier, 'action': 'created'}])
            created = True
    resource = {**summary(row), 'sha256': digest}
    result = {'applied': apply, 'created': created, 'wouldCreate': existing is None,
              'taxonomyId': taxonomy_id, 'nodeId': node_id, 'resource': resource}
    if apply:
        await db.commit()
        if created:
            await db.refresh(row, attribute_names=['id', 'title', 'mime_type', 'byte_length', 'duration_ms'])
    else:
        await db.rollback()
    return result
