"""Create missing original learning templates through the normal publisher.

Stable publication IDs are seed identities, never a reason to overwrite an
administrator's edits, listing decision, source file or existing copies.
"""
import json
import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.graph_template import GraphTemplate
from app.models.user import User
from app.schemas.graph_template import PublicationInput
from app.services import file_service, graph_template_service, teaching_content_revision_service

SEED_PATH = Path(__file__).parents[1] / 'seed/builtin_graph_templates/adult_frameworks_v1.json'
TOPICS = {'management', 'logic', 'relationships', 'classics'}


def load_bundle(path=SEED_PATH):
    payload = json.loads(Path(path).read_text(encoding='utf-8'))
    if not isinstance(payload, dict) or payload.get('schemaVersion') != 1:
        raise ValueError('内置图谱模板版本无效')
    templates = payload.get('templates')
    if not isinstance(templates, list) or len(templates) != 4:
        raise ValueError('内置图谱模板应包含四个原创主题')
    if {item.get('topic') for item in templates if isinstance(item, dict)} != TOPICS:
        raise ValueError('内置图谱模板主题无效')
    for item in templates:
        topic = item['topic']
        if item.get('id') != f'builtin-adult-{topic}-v1' or item.get('rights') != 'original-framework':
            raise ValueError('内置图谱模板标识或原创来源无效')
        if not isinstance(item.get('name'), str) or not item['name'].strip():
            raise ValueError('内置图谱模板名称不能为空')
        graph = item.get('graphData')
        if not isinstance(graph, dict) or (graph.get('meta') or {}).get('contentOrigin') != 'original-framework':
            raise ValueError('内置图谱模板需要原创内容声明')
        nodes, links = graph.get('nodes'), graph.get('links')
        if not isinstance(nodes, list) or not 10 <= len(nodes) <= 50 or not all(isinstance(node, dict) for node in nodes):
            raise ValueError('内置图谱模板卡牌数应在10至50之间')
        ids = {node.get('id') for node in nodes if isinstance(node.get('id'), str) and node['id']}
        if len(ids) != len(nodes):
            raise ValueError('内置图谱模板卡牌ID重复或缺失')
        for node in nodes:
            content = node.get('content')
            if not isinstance(content, dict) or not all(isinstance(content.get(field), str) and content[field].strip() for field in ('title', 'summary', 'notes')):
                raise ValueError('内置图谱模板卡牌缺少解释或练习')
            if any(key in node or key in content for key in ('questionIds', 'questions', 'bindings', 'images', 'assets')):
                raise ValueError('内置图谱模板不得包含私人题目或外部资源')
        if not isinstance(links, list) or not all(isinstance(link, dict) and link.get('from') in ids and link.get('to') in ids for link in links):
            raise ValueError('内置图谱模板连线引用无效')
        graph_template_service.remap_graph(graph)
    return templates


async def sync_builtin_graph_templates(db: AsyncSession):
    templates = load_bundle()  # Validate every package before any write.
    owner = await db.scalar(select(User).where(User.role == 'admin', User.status == 'active').order_by(User.created_at, User.username).limit(1))
    summary = {'created': 0, 'unchanged': 0}
    if owner is None:
        return {**summary, 'skipped': len(templates)}
    owner_id = owner.username
    for item in templates:
        # Publication commits release this lock; reacquire before each identity
        # check so concurrent application starts cannot duplicate source files.
        await teaching_content_revision_service.acquire_lock(db)
        if await db.get(GraphTemplate, item['id']) is not None:
            summary['unchanged'] += 1
            continue
        await db.refresh(owner)
        source = await file_service.create_file(db, owner_id, name=item['name'], graph_data=item['graphData'],
                                                source='builtin-template', source_file_id=item['id'], commit=False)
        db.add(GraphTemplate(id=item['id'], owner_id=owner_id, name=item['name'], description=item.get('description', ''),
                             current_version=0, member_only=False, listed=True))
        await db.flush()
        await graph_template_service.publish(db, owner, PublicationInput(sourceFileId=source.id,
            expectedFileRevision=source.revision, name=item['name'], description=item.get('description', ''), memberOnly=False), item['id'])
        summary['created'] += 1
    return summary


async def seed_builtin_graph_templates():
    """Best-effort startup seed, matching the existing teaching-content startup."""
    from app.db.session import AsyncSessionLocal
    logger = logging.getLogger('app')
    try:
        async with AsyncSessionLocal() as db:
            summary = await sync_builtin_graph_templates(db)
        logger.info('Built-in graph templates synced: %s', summary)
    except Exception:
        logger.exception('Built-in graph template sync failed')
