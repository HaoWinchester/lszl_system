"""Immutable publications. Advisory lock precedes all source reads/file locks.

No graph/snapshot/entitlement from a load or publish body is trusted. All writes
and resource grants are one transaction, using existing flush-only primitives.
"""
from copy import deepcopy
import math
import re
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
GRAPH_FIELDS = ('meta', 'defaults', 'mindmap', 'nodes', 'links', 'elements', 'tables', 'resources', 'strokes')
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
    # Ink IDs have their own namespace: they may match a card ID, but never
    # participate in question binding grants or the node/link idMap.
    for stroke in graph.get('strokes', []):
        stroke['id'] = uid('gts_')
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
    try:
        file_service.validate_graph_strokes(graph)
    except file_service.GraphStrokesInvalid:
        fail('GRAPH_STROKES_INVALID', 422)
    remap_graph(graph)  # Reject malformed source before producing a publication.
    try:
        file_service.validate_graph_tables(graph)
    except file_service.GraphTablesInvalid:
        fail('GRAPH_TABLES_INVALID', 422)
    descriptors = {}
    for node in graph['nodes']:
        descriptors[node['id']] = await questions.export_card_bindings(db, user, file.id, node['id'])
    # Snapshot each resource independently: no future source edits or deletion alter it.
    graph, _ = await assets.clone_graph_assets(db, user.username, user.username, graph)
    if row is None:
        row = Template(id=uid('gt_'), owner_id=user.username, current_version=0, listed=True)
        db.add(row)
    # 发布新版本不改变上下架状态；已下架的模板保持下架，由显式 set_listing 重新公开。
    row.name, row.description, row.member_only = data.name, data.description, data.member_only
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
    version = await db.scalar(select(Version).where(Version.template_id == row.id, Version.version == row.current_version))
    if version is None:
        fail('TEMPLATE_VERSION_NOT_FOUND')
    return {'template': summary(row, user), 'preview': preview_projection(version.graph_data, version.version)}


def preview_projection(graph, version):
    """Allowlisted public drawing data, without card bodies, grants or asset URLs."""
    def finite(value):
        return isinstance(value, (int, float)) and not isinstance(value, bool) and (not isinstance(value, float) or math.isfinite(value))

    def number(value, default=0, minimum=-100000, maximum=100000):
        return max(minimum, min(maximum, value)) if finite(value) else default

    def text(value, limit=200):
        return re.sub(r'<[^>]*>', '', value)[:limit] if isinstance(value, str) else ''

    def hex_color(value):
        if not isinstance(value, str) or not re.fullmatch(r'#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?', value):
            return None
        return ('#' + ''.join(char * 2 for char in value[1:]) if len(value) == 4 else value).lower()

    def color(default, *values):
        return next((clean for value in values if (clean := hex_color(value)) is not None), default)

    def enum(value, allowed, default):
        return value if isinstance(value, str) and value in allowed else default

    def point(value):
        if not isinstance(value, dict) or not finite(value.get('x')) or not finite(value.get('y')):
            return None
        return {'x': number(value['x']), 'y': number(value['y'])}

    def points(value, maximum):
        return [clean for raw in value[:maximum] if (clean := point(raw)) is not None] if isinstance(value, list) else []

    def port(value):
        sides = {'top', 'right', 'bottom', 'left'}
        if isinstance(value, dict) and isinstance(value.get('side'), str) and value['side'] in sides:
            return {'side': value['side'], 'offset': number(value.get('offset'), 0.5, 0, 1)}
        return enum(value, sides | {'auto'}, 'auto')

    appearance_enums = {
        'cardStyle': {'standard', 'sticky', 'rounded', 'rectangle', 'circle', 'triangle'},
        'size': {'', 'small', 'big'}, 'textAlign': {'left', 'center', 'right'},
        'fontFamily': {'system', 'sans', 'serif', 'kai', 'mono'},
        'fontWeight': {'normal', 'bold'}, 'fontStyle': {'normal', 'italic'},
        'borderStyle': {'solid', 'dashed', 'dotted'},
    }
    appearance_colors = {'color', 'headerIconColor', 'headerFillColor', 'bodyFillColor', 'headerTextColor',
                         'bodyTextColor', 'fillColor', 'borderColor', 'textColor', 'textBackgroundColor'}
    appearance_numbers = {'fontSize': (6, 288), 'borderWidth': (0, 8), 'fillOpacity': (0, 1),
                          'borderOpacity': (0, 1), 'textBackgroundOpacity': (0, 1), 'lineHeight': (0.8, 3)}
    appearance_booleans = {'regionColorsCustomized', 'borderVisible', 'surfaceCustomized', 'underline', 'strikeThrough'}
    size_dimensions = {'small': (104, 110), 'big': (160, 166)}
    themes = {'wire', 'blue', 'branches', 'mono', 'paper', 'capsule'}

    node_fields = appearance_enums.keys() | appearance_colors | appearance_numbers.keys() | appearance_booleans
    appearance_numbers['letterSpacing'] = (-1, 8)

    def project_appearance(raw, fields):
        raw_appearance = raw.get('appearance') if isinstance(raw.get('appearance'), dict) else {}
        appearance = {}
        # Preserve only explicit visual fields. The shared card renderer supplies
        # shape-specific defaults; populating generic defaults would change them.
        for key in fields:
            value = raw_appearance.get(key, raw.get(key))
            if key == 'cardStyle' and value == 'text':
                value = 'rounded'
            if key == 'fontSize' and isinstance(value, str):
                value = {'small': 13, 'medium': 15, 'large': 20, 'xlarge': 26}.get(value)
            if key in appearance_enums and isinstance(value, str) and value in appearance_enums[key]:
                appearance[key] = value
            elif key in appearance_colors and (clean := hex_color(value)) is not None:
                appearance[key] = clean
            elif key in appearance_numbers and finite(value):
                minimum, maximum = appearance_numbers[key]
                appearance[key] = number(value, minimum, minimum, maximum)
            elif key in appearance_booleans and isinstance(value, bool):
                appearance[key] = value
        return appearance

    nodes, ids = [], set()
    for node in (graph.get('nodes') if isinstance(graph.get('nodes'), list) else [])[:500]:
        if not isinstance(node, dict):
            continue
        identity = text(node.get('id'), 100)
        if not identity or identity in ids:
            continue
        ids.add(identity)
        style = node.get('style') if isinstance(node.get('style'), dict) else {}
        content = node.get('content') if isinstance(node.get('content'), dict) else {}
        geometry = node.get('geometry') if isinstance(node.get('geometry'), dict) else {}
        appearance = project_appearance(node, node_fields)
        width, height = size_dimensions.get(appearance.get('size'), (128, 132))
        projected = {'id': identity, 'title': text(content.get('title', node.get('title'))),
                     'x': number(geometry.get('x', node.get('x'))), 'y': number(geometry.get('y', node.get('y'))),
                     'width': number(geometry.get('width', node.get('w', node.get('width'))), width, 48, 1000),
                     'height': number(geometry.get('height', node.get('h', node.get('height'))), height, 40, 1000),
                     'fill': color('#ffffff', appearance.get('bodyFillColor'), appearance.get('fillColor'), style.get('bg'), style.get('background')),
                     'color': color('#243247', appearance.get('bodyTextColor'), appearance.get('textColor'), style.get('color')),
                     'appearance': appearance}
        theme = node.get('mindmapTheme')
        if isinstance(theme, dict) and isinstance(theme.get('id'), str) and theme['id'] in themes:
            projected['mindmapTheme'] = {'id': theme['id']}
        nodes.append(projected)
    links = []
    for index, link in enumerate((graph.get('links') if isinstance(graph.get('links'), list) else [])[:1000]):
        if not isinstance(link, dict):
            continue
        endpoints, free_points = {}, {}
        for side in ('from', 'to'):
            reference = link.get(side)
            if reference in (None, ''):
                clean = point(link.get(side + 'Point'))
                if clean is None:
                    break
                endpoints[side] = ''
                free_points[side + 'Point'] = clean
            elif isinstance(reference, str) and reference in ids:
                endpoints[side] = reference
            else:
                break
        if len(endpoints) != 2:
            continue
        style = link.get('style') if isinstance(link.get('style'), dict) else {}
        width = number(link.get('strokeWidth', link.get('width')), 4, 1, 8)
        projected = {'id': text(link.get('id'), 100) or 'preview-link-' + str(index), **endpoints,
                     'label': text(link.get('label') or link.get('type'), 80),
                     'color': color('#2563eb', link.get('color'), style.get('color')),
                     'pathStyle': enum(link.get('pathStyle'), {'curve', 'straight', 'elbow'}, 'curve'),
                     'lineStyle': enum(link.get('lineStyle'), {'solid', 'dashed', 'dotted'}, 'solid'),
                     'strokeWidth': width, 'width': width,
                     'arrowStyle': enum(link.get('arrowStyle'), {'none', 'end', 'both'}, 'none'),
                     'fromPort': port(link.get('fromPort')), 'toPort': port(link.get('toPort')), **free_points}
        controls, waypoints = points(link.get('curveControls'), 2), points(link.get('waypoints'), 64)
        if len(controls) == 2:
            projected['curveControls'] = controls
        if waypoints:
            projected['waypoints'] = waypoints
        if isinstance(link.get('hierarchy'), bool):
            projected['hierarchy'] = link['hierarchy']
        links.append(projected)
    result = {'version': version, 'nodes': nodes, 'links': links}
    elements, element_ids = [], set()
    text_fields = {'textColor', 'textBackgroundColor', 'textBackgroundOpacity', 'textAlign', 'fontSize',
                   'fontFamily', 'fontWeight', 'fontStyle', 'underline', 'strikeThrough', 'lineHeight', 'letterSpacing'}
    for item in (graph.get('elements') if isinstance(graph.get('elements'), list) else [])[:500]:
        if not isinstance(item, dict):
            continue
        content = item.get('content') if isinstance(item.get('content'), dict) else {}
        kind = item.get('elementType', item.get('type'))
        if kind != 'text' and not (kind is None and isinstance(content.get('text', item.get('text')), str)):
            continue
        identity = text(item.get('id'), 100)
        if not identity or identity in element_ids:
            continue
        element_ids.add(identity)
        raw_geometry = item.get('geometry') if isinstance(item.get('geometry'), dict) else {}
        geometry = {'x': number(raw_geometry.get('x', item.get('x'))),
                    'y': number(raw_geometry.get('y', item.get('y'))),
                    'width': number(raw_geometry.get('width', item.get('width')), 220, 24, 10000),
                    'height': number(raw_geometry.get('height', item.get('height')), 72, 24, 10000)}
        manual = raw_geometry.get('manualSize', item.get('manualSize'))
        if isinstance(manual, bool):
            geometry['manualSize'] = manual
        elements.append({'id': identity, 'type': 'text', 'elementType': 'text',
                         'text': text(content.get('text', item.get('text')), 3000),
                         **{key: geometry[key] for key in ('x', 'y', 'width', 'height')},
                         'geometry': geometry, 'appearance': project_appearance(item, text_fields)})
    if elements:
        result['elements'] = elements

    from app.schemas.canvas_ink import validate_strokes
    strokes, stroke_ids, total_points = [], set(), 0
    base_fields = {'id', 'tool', 'color', 'width', 'points', 'opacity'}
    for raw in (graph.get('strokes') if isinstance(graph.get('strokes'), list) else [])[:2000]:
        if not isinstance(raw, dict) or not isinstance(raw.get('tool'), str) or raw['tool'] not in {'pen', 'highlighter', 'text'}:
            continue
        fields = base_fields | ({'text', 'bold', 'boxWidth', 'boxHeight'} if raw['tool'] == 'text' else set())
        candidate = {key: raw[key] for key in fields if key in raw}
        candidate['id'] = text(candidate.get('id'), 100)
        if candidate['id'] in stroke_ids:
            continue
        if raw['tool'] == 'text' and isinstance(candidate.get('text'), str):
            candidate['text'] = text(candidate['text'], 500)
        raw_points = candidate.get('points')
        if isinstance(raw_points, list) and total_points + len(raw_points) > 100000:
            continue
        try:
            clean = validate_strokes([candidate])[0]
        except (ValueError, TypeError):
            continue
        stroke_ids.add(clean['id'])
        total_points += len(clean['points'])
        strokes.append(clean)
        if total_points == 100000:
            break
    if strokes:
        result['strokes'] = strokes
    return result


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
        try:
            file_service.validate_graph_tables(version.graph_data)
            file_service.validate_graph_strokes(version.graph_data)
        except file_service.GraphTablesInvalid:
            fail('GRAPH_TABLES_INVALID', 422)
        except file_service.GraphStrokesInvalid:
            fail('GRAPH_STROKES_INVALID', 422)
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
