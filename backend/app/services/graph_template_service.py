"""Immutable publications. Advisory lock precedes all source reads/file locks.

No graph/snapshot/entitlement from a load or publish body is trusted. All writes
and resource grants are one transaction, using existing flush-only primitives.
"""
from copy import deepcopy
from fastapi import HTTPException
from sqlalchemy import select, or_
from app.core.security import uid
from app.models.file import GraphFile, FileContent
from app.models.user import User
from app.models.subscription import Subscription
from app.models.graph_template import GraphTemplate as Template, GraphTemplateVersion as Version, GraphTemplateLoad as Load
from app.services import teaching_content_revision_service as revisions, graph_question_service as questions, graph_asset_service as assets, file_service, subscription_service


def fail(code, status=404):
    raise HTTPException(status, detail={'code': code})


def reader(user):
    if user.role not in {'admin', 'teacher', 'student'}:
        fail('TEMPLATE_READER_REQUIRED', 403)


def publisher(user):
    if user.role not in {'admin', 'teacher'}:
        fail('TEMPLATE_PUBLISHER_REQUIRED', 403)


def summary(row, user):
    return {'id': row.id, 'name': row.name, 'description': row.description,
            'memberOnly': row.member_only, 'listed': row.listed, 'version': row.current_version,
            'canMaintain': user.role == 'admin' or (user.role == 'teacher' and row.owner_id == user.username)}


async def catalog(db, user):
    reader(user)
    visible = Template.listed.is_(True)
    if user.role == 'admin':
        visible = True
    elif user.role == 'teacher':
        visible = or_(visible, Template.owner_id == user.username)
    rows = (await db.scalars(select(Template).where(visible).order_by(Template.name, Template.id))).all()
    return {'templates': [summary(r, user) for r in rows]}


async def maintain(db, user, template_id):
    publisher(user)
    row = await db.scalar(select(Template).where(Template.id == template_id).with_for_update())
    if not row or (user.role != 'admin' and row.owner_id != user.username):
        fail('TEMPLATE_NOT_FOUND')
    return row


# Positive publication projection preserves supported design/content, never personal
# review/attempt/imported-flashcard state or client-attached question authority.
GRAPH_FIELDS = ('meta', 'defaults', 'mindmap', 'nodes', 'links', 'elements', 'tables', 'resources')
PERSONAL_FIELDS = {'flashReviews', 'learningState', 'learning_state', 'reviewCount', 'rememberCount',
                   'unclearCount', 'lastReviewedAt', 'nextReviewAt', 'lastResult', 'history',
                   'attempts', 'progress', 'mastery', 'selected', 'questionIds', 'questions',
                   'bindings', 'linkedQuestions', 'selectedNodeId', 'selectedLinkId', 'selectedElementId'}


def published_graph(source):
    def clean(value):
        if isinstance(value, dict):
            return {k: clean(v) for k, v in value.items() if k not in PERSONAL_FIELDS}
        if isinstance(value, list):
            return [clean(v) for v in value]
        return value
    graph = clean(deepcopy({k: source[k] for k in GRAPH_FIELDS if k in source}))
    graph.setdefault('nodes', [])
    graph.setdefault('links', [])
    return graph


def remap_graph(source):
    graph = deepcopy(source)
    mapping = {}
    for key in ('nodes', 'links', 'elements', 'tables'):
        for item in graph.get(key, []):
            old = item.get('id')
            if not isinstance(old, str) or not old or old in mapping:
                fail('TEMPLATE_GRAPH_INVALID', 422)
            mapping[old] = uid('gtc_')
            item['id'] = mapping[old]
    for link in graph.get('links', []):
        for endpoint in ('from', 'to'):
            old = link.get(endpoint)
            if old:
                if old not in mapping:
                    fail('TEMPLATE_GRAPH_INVALID', 422)
                link[endpoint] = mapping[old]
            elif not isinstance(link.get(endpoint + 'Point'), dict):
                fail('TEMPLATE_GRAPH_INVALID', 422)
    if isinstance(graph.get('mindmap'), dict):
        graph['mindmap']['rootIds'] = [mapping[r] for r in graph['mindmap'].get('rootIds', []) if r in mapping]
    return graph, mapping


async def publish(db, user, data, template_id=None):
    publisher(user)
    await revisions.acquire_lock(db)  # MUST precede maintain/source/export/row locks.
    row = await maintain(db, user, template_id) if template_id else None
    file = await db.scalar(select(GraphFile).where(GraphFile.id == data.source_file_id, GraphFile.owner_id == user.username, GraphFile.status == 'active').with_for_update())
    if not file:
        fail('GRAPH_FILE_NOT_FOUND')
    if file.revision != data.expected_file_revision:
        fail('GRAPH_FILE_REVISION_CONFLICT', 409)
    content = await db.get(FileContent, file.id)
    if not content:
        fail('GRAPH_FILE_NOT_FOUND')
    graph = published_graph(content.graph_data)
    remap_graph(graph)  # Reject malformed source before producing a publication.
    descriptors = {}
    for node in graph['nodes']:
        descriptors[node['id']] = await questions.export_card_bindings(db, user, file.id, node['id'])
    # Snapshot each resource independently: no future source edits or deletion alter it.
    graph, _ = await assets.clone_graph_assets(db, user.username, user.username, graph)
    if row is None:
        row = Template(id=uid('gt_'), owner_id=user.username, current_version=0)
        db.add(row)
    row.name, row.description, row.member_only, row.listed = data.name, data.description, data.member_only, True
    row.current_version += 1
    await db.flush()
    db.add(Version(id=uid('gtv_'), template_id=row.id, version=row.current_version,
                   source_file_id=file.id, source_revision=file.revision, asset_owner=user.username,
                   graph_data=graph, bindings=descriptors))
    await db.commit()
    await db.refresh(row)
    return {'template': summary(row, user)}


async def set_listing(db, user, template_id, data):
    await revisions.acquire_lock(db)
    row = await maintain(db, user, template_id)
    row.listed = data.listed
    await db.commit()
    await db.refresh(row)
    return {'template': summary(row, user)}


async def preview(db, user, template_id):
    reader(user)
    row = await db.get(Template, template_id)
    if row is None or (not row.listed and not summary(row, user)['canMaintain']):
        fail('TEMPLATE_NOT_FOUND')
    # Description only; no graph, image URL, question snapshots or answer keys.
    return {'template': summary(row, user)}


async def load(db, user, template_id, data):
    reader(user)
    await revisions.acquire_lock(db)  # Also serializes receipts/retries/cleanup.
    await db.scalar(select(User).where(User.username == user.username).with_for_update())
    previous = await db.scalar(select(Load).where(Load.owner_id == user.username, Load.request_id == data.request_id))
    if previous:
        if (previous.template_id, previous.version) != (template_id, data.version):
            fail('TEMPLATE_REQUEST_ID_CONFLICT', 409)
        # Existing legal copies retain their grant after expiration/downlisting.
        return {'fileId': previous.file_id, 'version': previous.version, 'idMap': previous.id_map}
    row = await db.scalar(select(Template).where(Template.id == template_id).with_for_update())
    if row is None or not row.listed:
        fail('TEMPLATE_NOT_AVAILABLE')
    paid = subscription_service.entitlements_for(user.role, await db.get(Subscription, user.username))['allExamPapers']
    if row.member_only and not paid:
        fail('TEMPLATE_MEMBERSHIP_REQUIRED', 403)
    version = await db.scalar(select(Version).where(Version.template_id == row.id, Version.version == data.version))
    if version is None:
        fail('TEMPLATE_VERSION_NOT_FOUND')
    if len(version.graph_data.get('nodes', [])) > (2500 if paid else 50):
        fail('TEMPLATE_NODE_QUOTA_EXCEEDED', 422)
    try:
        graph, mapping = remap_graph(version.graph_data)
        graph, _ = await assets.clone_graph_assets(db, version.asset_owner, user.username, graph)
        file = await file_service.create_file(db, user.username, name=row.name, graph_data=graph, source='template', source_file_id=row.id, commit=False)
        # New target is invisible until commit. No existing target row is read/locked.
        for node_id, bindings in version.bindings.items():
            if bindings:
                await questions.clone_card_bindings(db, user.username, file.id, mapping[node_id], bindings)
        file_id = file.id
        db.add(Load(id=uid('gtl_'), owner_id=user.username, request_id=data.request_id,
                    template_id=row.id, version=version.version, file_id=file_id, id_map=mapping))
        await db.commit()
        await db.refresh(file)
        return {'fileId': file.id, 'version': data.version, 'idMap': mapping}
    except BaseException:
        await db.rollback()
        raise
