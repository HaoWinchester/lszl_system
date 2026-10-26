"""Server-authoritative cross-file fragment paste.

Advisory lock precedes all source/target reads and row locks (T13 lock order).
Only server-read bindings create new grants; client question fields are stripped.
Target merge, asset cloning, binding clones and the revision bump are one transaction.
"""
from copy import deepcopy
from fastapi import HTTPException
from sqlalchemy import select
from app.core.security import uid, now_utc
from app.models.file import GraphFile, FileContent
from app.models.subscription import Subscription
from app.schemas.graph_fragment import GraphFragmentInput
from app.services import teaching_content_revision_service as revisions, graph_question_service as questions, \
    graph_asset_service as assets, file_service, subscription_service
from app.services.graph_template_service import PERSONAL_FIELDS

PASTE_ID_PREFIXES = {'nodes': 'n', 'links': 'l', 'elements': 't', 'tables': 't'}
# Client-attached question authority is never accepted; bindings come from the source file only.
STRIPPED_NODE_FIELDS = ('questionIds', 'questions', 'bindings', 'linkedQuestions')


def _remap_card_groups(nodes):
    """Each paste owns its group identities; partial singleton copies are ungrouped."""
    members = {}
    for node in nodes:
        group = node.pop('groupId', None)
        if isinstance(group, str) and group.strip():
            members.setdefault(group.strip()[:120], []).append(node)
    for group_nodes in members.values():
        if len(group_nodes) < 2:
            continue
        new_id = uid('g')
        for node in group_nodes:
            node['groupId'] = new_id


def fail(code, status=404):
    raise HTTPException(status, detail={'code': code})


def _strip_personal(value):
    if isinstance(value, dict):
        return {k: _strip_personal(v) for k, v in value.items()
                if k not in PERSONAL_FIELDS and k not in STRIPPED_NODE_FIELDS}
    if isinstance(value, list):
        return [_strip_personal(v) for v in value]
    return value


def _merge_offset(item, offset):
    if not offset:
        return
    dx, dy = offset.get('x', 0), offset.get('y', 0)
    for holder in (item, item.get('geometry')):
        if isinstance(holder, dict):
            for field in ('x', 'y'):
                if isinstance(holder.get(field), (int, float)):
                    holder[field] = holder[field] + dx if field == 'x' else holder[field] + dy
    for key in ('curveControls', 'waypoints'):
        for point in item.get(key) or []:
            if isinstance(point, dict):
                point['x'] = point.get('x', 0) + dx
                point['y'] = point.get('y', 0) + dy
    for key in ('fromPoint', 'toPoint'):
        point = item.get(key)
        if isinstance(point, dict):
            point['x'] = point.get('x', 0) + dx
            point['y'] = point.get('y', 0) + dy


async def paste_fragment(db, user, target_file_id, data):
    """Merge a validated fragment into an existing owned file with inherited bindings."""
    await revisions.acquire_lock(db)  # MUST precede every source/target read or row lock.
    fragment: GraphFragmentInput = data.fragment
    target = await db.scalar(select(GraphFile).where(
        GraphFile.id == target_file_id, file_service.personal_file_predicate(user.username),
        GraphFile.status == 'active').with_for_update())
    if not target:
        fail('GRAPH_FILE_NOT_FOUND')
    content = await db.get(FileContent, target_file_id)
    if not content:
        fail('GRAPH_FILE_NOT_FOUND')
    current_revision = max(1, int(target.revision or 1))
    if data.expected_file_revision is not None and data.expected_file_revision != current_revision:
        fail('GRAPH_FILE_REVISION_CONFLICT', 409)
    graph = deepcopy(content.graph_data if isinstance(content.graph_data, dict) else {})

    # Node quota follows template loads: entitlement bypass for teacher/admin, 50 free students.
    paid = subscription_service.entitlements_for(user.role, await db.get(Subscription, user.username))['allExamPapers']
    quota = 2500 if paid else 50
    if len(graph.get('nodes') or []) + len(fragment.nodes) > quota:
        fail('GRAPH_NODE_QUOTA_EXCEEDED', 422)

    # Server-read source bindings are the only grant path; a stale source revision is 409.
    descriptors = {}
    if fragment.source and fragment.source.file_id:
        source = await db.scalar(select(GraphFile).where(
            GraphFile.id == fragment.source.file_id, GraphFile.owner_id == user.username,
            GraphFile.status == 'active'))
        if not source:
            fail('GRAPH_FILE_NOT_FOUND')
        if fragment.source.revision is not None and fragment.source.revision != source.revision:
            fail('GRAPH_FRAGMENT_SOURCE_STALE', 409)
        for node_id in fragment.source.node_ids[:2500]:
            exported = await questions.export_card_bindings(db, user, fragment.source.file_id, node_id)
            if exported:
                descriptors[node_id] = exported

    clean = _strip_personal(fragment.model_dump(by_alias=True, exclude_none=True))
    # tables 不随片段复制（UI 复制入口不选表格；跨文件表格经模板/另存承载），入口即丢弃。
    payload = {'nodes': clean['nodes'], 'links': clean['links'],
               'elements': clean['elements'], 'tables': [],
               'resources': clean.get('resources') or []}
    # 同 owner 粘贴沿用 duplicate_file 模式：校验归属后复用原 assetId，不复制 blob。
    await assets.validate_graph_assets(db, user.username, payload)

    existing_ids = {item.get('id') for key in PASTE_ID_PREFIXES for item in (graph.get(key) or [])}
    id_map = {}
    for key, prefix in PASTE_ID_PREFIXES.items():
        for item in payload[key]:
            new_id = uid(prefix)
            while new_id in existing_ids:
                new_id = uid(prefix)
            existing_ids.add(new_id)
            id_map[item['id']] = new_id
            item['id'] = new_id
            _merge_offset(item, data.offset)
    for link in payload['links']:
        extra = link
        link['from'] = id_map.get(extra.get('from'), extra.get('from'))
        link['to'] = id_map.get(extra.get('to'), extra.get('to'))

    _remap_card_groups(payload['nodes'])
    graph.setdefault('nodes', []).extend(payload['nodes'])
    graph.setdefault('links', []).extend(payload['links'])
    graph.setdefault('elements', []).extend(payload['elements'])
    # tables/resources 不在片段合并范围（表格由 T18 持久化管道承载，片段复制不携带）。

    next_revision = current_revision + 1
    content.graph_data = graph
    content.revision = next_revision
    content.saved_at = now_utc()
    target.node_count = len(graph.get('nodes') or [])
    target.link_count = len(graph.get('links') or [])
    target.byte_size = file_service._byte_size(graph)
    target.revision = next_revision
    target.structure_hash = file_service._structure_hash(graph)
    await db.flush()

    bindings = []
    for old_id, exported in descriptors.items():
        new_id = id_map.get(old_id)
        if not new_id:
            continue
        rows = await questions.clone_card_bindings(db, user.username, target_file_id, new_id, exported)
        bindings.append({'nodeId': new_id, 'bindings': [
            {'id': row.id, 'questionId': row.question_id, 'sourceVersion': row.source_version} for row in rows]})
    try:
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    await db.refresh(target)
    # tables/resources 不在合并范围（见上），也不进返回值，防止前端误用。
    return {'fragment': {'nodes': payload['nodes'], 'links': payload['links'],
                         'elements': payload['elements']},
            'idMap': id_map, 'fileRevision': next_revision, 'bindings': bindings}
