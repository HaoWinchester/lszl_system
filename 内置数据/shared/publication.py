"""Read-only package planning and guarded service-layer publication.

No application import/connection occurs for --check-package. Run DB commands
with the backend virtualenv, from backend/ (or set PYTHONPATH to that directory).
"""
import argparse
import asyncio
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit

LEGACY_PACKAGE = 'pmp8-knowledge-graphs-20261025'
CATEGORIES = {'pmp', 'prince2', 'cspm', 'gaoxiang', 'general'}
SOURCE_KIND = 'builtin-template'


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def validate_origin(origin):
    value = urlsplit(origin)
    if value.scheme != 'http' or value.hostname not in {'localhost', '127.0.0.1', '::1'} or value.username is not None or value.password is not None or value.path or value.query or value.fragment:
        raise ValueError('Only a plain loopback HTTP origin is supported; no HTTP requests or redirects are used')
    try:
        value.port
    except ValueError as exc:
        raise ValueError('Invalid origin port') from exc


def validate_target(target, environment, configured, current=None, *, local=False):
    expected = {'dev': 'kg_graph_dev'} if local else {'uat': 'kg_graph_uat', 'prod': 'kg_graph'}
    database = expected.get(target)
    if not database or environment != target or configured != database or (current is not None and current != database):
        raise ValueError('Refusing publication outside explicitly selected ENV/configured/current database')
    return database


def confined_file(directory, relative):
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise ValueError('Invalid package relative path')
    path = (directory / relative).resolve()
    if not path.is_relative_to(directory) or not path.is_file():
        raise ValueError('Package path escapes directory or file is missing')
    return path


def read_package(directory):
    directory = Path(directory).resolve()
    catalog = json.loads((directory / 'catalog.json').read_text())
    package_id = catalog['packageId']
    if not isinstance(package_id, str) or not package_id or len(package_id) > 55:
        raise ValueError('Invalid package ID')
    graphs, identities, names, keys = [], set(), set(), set()
    for raw in catalog['graphs']:
        item = deepcopy(raw)
        identity, name = item['id'], item['name']
        key = item.get('sourceKey', package_id + ':' + identity)
        if not identity or not name or identity in identities or name in names or key in keys or key != package_id + ':' + identity or len(key) > 64:
            raise ValueError('Duplicate/invalid package identities or source key')
        identities.add(identity); names.add(name); keys.add(key)
        item['sourceKey'] = key
        item['category'] = 'pmp' if package_id == LEGACY_PACKAGE else item['category']
        if item['category'] not in CATEGORIES:
            raise ValueError('Invalid public category')
        path = confined_file(directory, item['file'])
        for file_key, hash_key in [('file', 'sha256'), ('packageFile', 'packageSha256')]:
            if hash_key in item:
                content = confined_file(directory, item[file_key]).read_bytes()
                if hashlib.sha256(content).hexdigest() != item[hash_key]:
                    raise ValueError('Package digest mismatch: ' + identity)
            elif file_key == 'packageFile' and file_key in item:
                confined_file(directory, item[file_key])
        graph = json.loads(path.read_text())
        node_ids = [node['id'] for node in graph['nodes']]
        if len(set(node_ids)) != len(node_ids) or not all(isinstance(n,str) and n for n in node_ids):
            raise ValueError('Duplicate/invalid node IDs')
        if len(node_ids) != item['nodeCount'] or len(graph['links']) != item['linkCount'] or graph['meta']['title'] != name:
            raise ValueError('Graph identity/count mismatch: ' + identity)
        if any(link.get('from') not in node_ids or link.get('to') not in node_ids for link in graph['links']):
            raise ValueError('Invalid link endpoint: ' + identity)
        if graph.get('resources') or any(node.get('content', {}).get('images') or node.get('images') for node in graph['nodes']):
            raise ValueError('Cross-environment package cannot reference private assets')
        if graph.get('meta', {}).get('contentPackageId') != package_id:
            raise ValueError('Graph package identity mismatch')
        graphs.append((item, graph))
    for field, actual in [('graphCount',len(graphs)),('nodeCount',sum(len(g['nodes']) for _,g in graphs)),('linkCount',sum(len(g['links']) for _,g in graphs))]:
        if catalog[field] != actual:
            raise ValueError('Aggregate count mismatch: ' + field)
    return catalog, graphs


# Historical editor roundtrip observed in the exact 2026-10-26 dev audit.
# Frozen compatibility data: do not load mutable frontend defaults at runtime.
EDITOR_DEFAULTS = {'nodeSize': '',
 'linkColor': '#2563eb',
 'linkStyle': 'solid',
 'nodeColor': '#64748b',
 'nodeFontSize': 15,
 'linkPathStyle': 'curve',
 'nodeCardStyle': 'standard',
 'nodeFillColor': '#ffffff',
 'nodeFontStyle': 'normal',
 'nodeTextAlign': 'center',
 'nodeTextColor': '#0f172a',
 'nodeUnderline': False,
 'nodeFontFamily': 'system',
 'nodeFontWeight': 'bold',
 'nodeLineHeight': 1.25,
 'flashSwipeSpeed': 2,
 'nodeBorderColor': '#cbd5e1',
 'nodeBorderStyle': 'solid',
 'nodeBorderWidth': 1,
 'nodeFillOpacity': 1,
 'nodeBorderOpacity': 1,
 'nodeBorderVisible': True,
 'nodeLetterSpacing': 0,
 'nodeStrikeThrough': False,
 'textElementFontSize': 20,
 'textElementFontStyle': 'normal',
 'textElementTextAlign': 'center',
 'textElementTextColor': '#0f172a',
 'textElementUnderline': False,
 'textElementFontFamily': 'system',
 'textElementFontWeight': 'bold',
 'textElementLineHeight': 1.45,
 'nodeTextBackgroundColor': '#ffffff',
 'textElementLetterSpacing': 0,
 'textElementStrikeThrough': False,
 'nodeTextBackgroundOpacity': 0,
 'textElementTextBackgroundColor': '#ffffff',
 'textElementTextBackgroundOpacity': 0}
AUTHORING_META_KEYS = {'contentPackageId', 'topicId', 'edition', 'sourceUrls', 'contentNote', 'layout', 'visualRevision'}
EDITOR_UI_FIELDS = {'viewport', 'focusMode', 'linkSourceId', 'selectedNodeId', 'selectedLinkId', 'selectedElementId'}
EMPTY_STUDY_FIELDS = {'flashReviews': {}, 'importedFlashcards': [], 'learningState': {},
                      'learning_state': {}, 'history': [], 'attempts': [], 'progress': {}, 'mastery': {}}


def semantic_matches(actual, canonical):
    """Accept only audited editor additions/omissions; retain every other field.

    Missing known authoring metadata is allowed, but retained values must equal
    the canonical package. Unknown meta, mindmap and unknown graph fields survive
    comparison. Nonempty personal study content is never reclassified as builtin.
    """
    actual, canonical = deepcopy(actual), deepcopy(canonical)
    for graph in (actual, canonical):
        for key in EDITOR_UI_FIELDS:
            graph.pop(key, None)
        for key, empty in EMPTY_STUDY_FIELDS.items():
            if key in graph:
                if graph[key] != empty:
                    return False
                graph.pop(key)
        for key in ('nodes', 'links', 'elements', 'tables', 'strokes', 'resources'):
            graph.setdefault(key, [])
    actual_meta, canonical_meta = actual.get('meta', {}), canonical.get('meta', {})
    if not isinstance(actual_meta, dict) or not isinstance(canonical_meta, dict):
        return False
    for key in AUTHORING_META_KEYS:
        if key in actual_meta and (key not in canonical_meta or actual_meta[key] != canonical_meta[key]):
            return False
        actual_meta.pop(key, None)
        canonical_meta.pop(key, None)
    # The only accepted defaults addition is the complete audited 37-field map.
    # Preserve any canonical defaults and compare them normally when present.
    if 'defaults' not in canonical and 'defaults' in actual:
        if fingerprint(actual['defaults']) != fingerprint(EDITOR_DEFAULTS):
            return False
        actual.pop('defaults')
    return actual == canonical


def verify_backup(evidence_path):
    if not evidence_path:
        raise ValueError('--apply repair requires --backup-evidence from a fresh verified dev dump')
    evidence = json.loads(Path(evidence_path).read_text())
    dump = Path(evidence['path']).resolve()
    created = datetime.fromisoformat(evidence['createdAt'].replace('Z','+00:00'))
    if created.tzinfo is None:
        raise ValueError('Backup creation time must include UTC offset')
    age = (datetime.now(timezone.utc) - created).total_seconds()
    if evidence['database'] != 'kg_graph_dev' or created.tzinfo is None or not 0 <= age <= 3600 or not dump.is_file() or dump.stat().st_size == 0 or hashlib.sha256(dump.read_bytes()).hexdigest() != evidence['sha256']:
        raise ValueError('Backup evidence must match nonempty dev dump created in last hour')
    if abs(dump.stat().st_mtime - created.timestamp()) > 300:
        raise ValueError('Dump timestamp does not match evidence')
    listing = subprocess.run(['pg_restore','--list',str(dump)], check=True, capture_output=True, text=True).stdout
    if ';     dbname: kg_graph_dev' not in listing.splitlines():
        raise ValueError('Backup archive is not a kg_graph_dev database dump')
    return str(dump)


async def administrator(db, owner):
    from app.models.user import User
    user = await db.get(User, owner)
    if not user or user.role != 'admin' or user.status != 'active':
        raise ValueError('Existing active administrator required')
    return user


async def plan_publication(db, user, catalog, graphs):
    from sqlalchemy import select, or_
    from app.models.file import GraphFile, FileContent, Folder
    from app.models.graph_template import GraphTemplate, GraphTemplateVersion
    from app.services import file_service, graph_template_service as templates
    from app.services import teaching_content_revision_service as revisions
    # Even read-only plans follow the service lock order before domain row locks.
    await revisions.acquire_lock(db)
    folder_name = catalog['packageId'] + ' · 模板源'
    folders = (await db.scalars(select(Folder).where(Folder.owner_id == user.username, Folder.name == folder_name))).all()
    if len(folders)>1 or (folders and (folders[0].status != 'active' or folders[0].parent_id is not None)):
        raise ValueError('Conflicting template source folder')
    plan=[]
    for item,graph in graphs:
        templates.remap_graph(graph)
        file_service.validate_graph_tables(graph); file_service.validate_graph_strokes(graph)
        sources = (await db.scalars(select(GraphFile).where(or_(GraphFile.source_file_id == item['sourceKey'], (GraphFile.owner_id == user.username) & (GraphFile.name == item['name']) & (GraphFile.source != 'template'))).with_for_update())).all()
        source_template_ids = []
        if sources:
            source_template_ids = list((await db.scalars(select(GraphTemplateVersion.template_id).where(
                GraphTemplateVersion.source_file_id.in_([source.id for source in sources])).distinct())).all())
        # Historical bindings are identities too: renaming or moving a current
        # version must never let a package source produce another publication.
        rows = (await db.scalars(select(GraphTemplate).where(or_(
            GraphTemplate.name == item['name'], GraphTemplate.id.in_(source_template_ids))).with_for_update())).all()
        if len(sources)>1 or len(rows)>1:
            raise ValueError('Ambiguous source/publication: '+item['name'])
        source = sources[0] if sources else None
        row = rows[0] if rows else None
        digest = fingerprint(templates.published_graph(graph))
        if source:
            content = await db.get(FileContent,source.id)
            source_matches = content is not None and (semantic_matches(content.graph_data, graph) if catalog['packageId'] == LEGACY_PACKAGE else fingerprint(templates.published_graph(content.graph_data)) == digest)
            if source.owner_id != user.username or source.source != SOURCE_KIND or source.source_file_id != item['sourceKey'] or source.status != 'active' or source.name != item['name'] or not source_matches or content.learning_state:
                raise ValueError('Existing source differs; refusing overwrite: '+item['name'])
        if row:
            version = await db.scalar(select(GraphTemplateVersion).where(GraphTemplateVersion.template_id == row.id, GraphTemplateVersion.version == row.current_version))
            snapshot_matches = version is not None and (fingerprint(version.graph_data) == digest or (catalog['packageId'] == LEGACY_PACKAGE and version.graph_data.get('meta', {}).get('contentPackageId') == catalog['packageId'] and semantic_matches(version.graph_data, graph)))
            if row.name != item['name'] or row.owner_id != user.username or not source or not version or version.source_file_id != source.id or version.asset_owner != user.username or not snapshot_matches or any(version.bindings.values()) or row.member_only or not row.listed:
                raise ValueError('Existing publication differs; refusing overwrite: '+item['name'])
        plan.append({'topicId':item['id'],'name':item['name'],'sourceKey':item['sourceKey'],'sha256':digest,'fileId':source.id if source else None,'templateId':row.id if row else None,'action':'create' if not row else ('category' if row.category != item['category'] else 'unchanged')})
    return folder_name, folders[0].id if folders else None, plan


class BatchSession:
    """Keep trusted services' commit/refresh boundaries inside one batch transaction.

    Services still validate and flush normally; final commit belongs to the caller.
    This preserves the existing advisory/row locks until the complete batch succeeds.
    """
    def __init__(self, session):
        self.session = session

    def __getattr__(self, name):
        return getattr(self.session, name)

    async def commit(self):
        await self.session.flush()


async def apply_publication(db, user, catalog, graphs, *, apply=False):
    try:
        return await _apply_publication(db, user, catalog, graphs, apply=apply)
    except BaseException:
        await db.rollback()
        raise


async def _apply_publication(db, user, catalog, graphs, *, apply=False):
    from app.models.file import GraphFile
    from app.models.graph_template import GraphTemplate
    from app.schemas.graph_template import PublicationInput
    from app.services import file_service, graph_template_service as templates
    folder_name, folder_id, plan = await plan_publication(db,user,catalog,graphs)
    result={'packageId':catalog['packageId'],'owner':user.username,'apply':apply,'created':0,'categoriesUpdated':0,'unchanged':sum(p['action']=='unchanged' for p in plan),'templates':plan}
    if not apply:
        return result
    batch = BatchSession(db)
    if not folder_id and any(p['action']=='create' and not p['fileId'] for p in plan):
        folder_id = (await file_service.create_folder(batch,user.username,folder_name)).id
    for (item,graph),entry in zip(graphs,plan):
        if entry['action']=='category':
            row=await db.get(GraphTemplate,entry['templateId']); row.category=item['category']
            await db.flush()
            result['categoriesUpdated']+=1
        elif entry['action']=='create':
            source = await db.get(GraphFile,entry['fileId']) if entry['fileId'] else await file_service.create_file(batch,user.username,name=item['name'],graph_data=graph,folder_id=folder_id,source=SOURCE_KIND,source_file_id=entry['sourceKey'])
            published=await templates.publish(batch,user,PublicationInput(sourceFileId=source.id,expectedFileRevision=source.revision,name=item['name'],description='基础模板 · 原创教学图谱 · '+item['description']+'。含情境自测、处理思路和易错辨析。加载后可独立编辑。',category=item['category'],memberOnly=False))
            entry['fileId']=source.id; entry['templateId']=published['template']['id']; result['created']+=1
    await db.commit()
    return result


async def repair_receipt(db, user, catalog, graphs, receipt, *, apply=False, backup_evidence=None):
    from sqlalchemy import select, update
    from app.models.file import GraphFile, FileContent
    from app.models.graph_template import GraphTemplate, GraphTemplateVersion
    if catalog['packageId'] != LEGACY_PACKAGE or receipt.get('username') != user.username:
        raise ValueError('Repair requires exact legacy package and receipt owner')
    validate_origin(receipt['baseUrl'])
    if apply:
        verify_backup(backup_evidence)
    from app.services import teaching_content_revision_service as revisions
    await revisions.acquire_lock(db)
    rows=receipt.get('graphs',[])
    if len(rows)!=len(graphs) or any(len({r.get(key) for r in rows})!=len(rows) or any(not r.get(key) for r in rows) for key in ('id','fileId','templateId')):
        raise ValueError('Incomplete or duplicate repair receipt identities')
    by_id={r['id']:r for r in rows}
    if set(by_id)!={i['id'] for i,g in graphs}:raise ValueError('Receipt topic IDs differ')
    plan=[]
    for item,graph in graphs:
        receipt_row=by_id[item['id']]
        source=await db.get(GraphFile,receipt_row['fileId'],with_for_update=True)
        template=await db.get(GraphTemplate,receipt_row['templateId'],with_for_update=True)
        content=await db.get(FileContent,receipt_row['fileId'])
        versions=(await db.scalars(select(GraphTemplateVersion).where(GraphTemplateVersion.template_id==receipt_row['templateId']))).all()
        version=next((v for v in versions if v.version==receipt_row.get('version')),None)
        if not source or not template or not content or not version or template.current_version!=version.version or source.owner_id!=user.username or template.owner_id!=user.username or version.asset_owner!=user.username or any(version.bindings.values()) or source.name!=item['name'] or template.name!=item['name'] or receipt_row.get('name')!=item['name'] or source.folder_id!=receipt.get('folderId') or source.status!='active' or source.source not in {'imported',SOURCE_KIND} or source.source_file_id not in {None,item['sourceKey']} or version.source_file_id!=source.id or any(v.source_file_id!=source.id for v in versions) or version.graph_data.get('meta',{}).get('contentPackageId')!=catalog['packageId'] or not semantic_matches(version.graph_data,graph) or not semantic_matches(content.graph_data,graph) or content.learning_state:
            raise ValueError('Receipt/source/snapshot mismatch: '+item['name'])
        collisions=(await db.scalars(select(GraphFile).where(GraphFile.source_file_id==item['sourceKey'],GraphFile.id!=source.id))).all()
        names=(await db.scalars(select(GraphTemplate).where(GraphTemplate.name==item['name']))).all()
        bound_templates=set((await db.scalars(select(GraphTemplateVersion.template_id).where(GraphTemplateVersion.source_file_id==source.id))).all())
        if collisions or len(names)!=1 or bound_templates!={template.id}:raise ValueError('Repair source/publication collision: '+item['name'])
        changed=source.source!=SOURCE_KIND or source.source_file_id!=item['sourceKey'] or template.category!=item['category']
        plan.append({'topicId':item['id'],'fileId':source.id,'templateId':template.id,'sourceKey':item['sourceKey'],'category':item['category'],'action':'repair' if changed else 'unchanged'})
    if apply:
        for p in plan:
            if p['action']=='repair':
                # Explicit updated_at prevents SQLAlchemy's onupdate changing timestamps.
                await db.execute(update(GraphFile).where(GraphFile.id==p['fileId']).values(source=SOURCE_KIND,source_file_id=p['sourceKey'],updated_at=GraphFile.updated_at))
                await db.execute(update(GraphTemplate).where(GraphTemplate.id==p['templateId']).values(category=p['category']))
        await db.commit()
    return {'packageId':catalog['packageId'],'apply':apply,'repaired':sum(p['action']=='repair' for p in plan) if apply else 0,'templates':plan}


async def run(args,catalog,graphs):
    sys.path.insert(0,str(Path.cwd()))
    from sqlalchemy import text
    from sqlalchemy.engine import make_url
    from app.core.config import settings
    from app.db.session import AsyncSessionLocal,engine
    local=args.local
    if local:
        validate_origin(args.base_url)
        if os.environ.get('ENV') != 'dev':
            raise ValueError('Local tooling requires explicit ENV=dev in process environment')
    configured_url=make_url(settings.DATABASE_URL)
    if local and (configured_url.query.get('host') or configured_url.host) not in {None, '/tmp', 'localhost', '127.0.0.1', '::1'}:
        raise ValueError('Local tooling refuses offhost database configuration')
    database=validate_target(args.environment,settings.ENV,configured_url.database,local=local)
    try:
        async with AsyncSessionLocal() as db:
            validate_target(args.environment,settings.ENV,database,await db.scalar(text('select current_database()')),local=local)
            user=await administrator(db,args.owner)
            if args.repair_receipt:
                result=await repair_receipt(db,user,catalog,graphs,json.loads(Path(args.repair_receipt).read_text()),apply=args.apply,backup_evidence=args.backup_evidence)
            else:result=await apply_publication(db,user,catalog,graphs,apply=args.apply)
            result.update(environment=args.environment,database=database)
            return result
    finally:await engine.dispose()


def main(default_package=None, *, local=False):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package',default=str(default_package) if default_package else None,required=default_package is None)
    parser.add_argument('--owner','--username',default='admin')
    parser.add_argument('--environment',choices=('dev',) if local else ('uat','prod'),default='dev' if local else 'uat')
    parser.add_argument('--apply',action='store_true'); parser.add_argument('--check-package',action='store_true'); parser.add_argument('--report')
    parser.add_argument('--base-url',default='http://127.0.0.1:5173')
    parser.set_defaults(repair_receipt=None)
    if local:parser.add_argument('--repair-receipt')
    parser.add_argument('--backup-evidence');parser.add_argument('--refresh-visuals',action='store_true')
    args=parser.parse_args();args.local=local
    if args.refresh_visuals:parser.error('--refresh-visuals is obsolete for hidden library sources; authored changes require reviewed package/version publication')
    if args.repair_receipt and not local:parser.error('Receipt repair is local-only')
    catalog,graphs=read_package(args.package)
    result={'packageId':catalog['packageId'],'graphs':len(graphs),'nodes':sum(len(g['nodes']) for _,g in graphs),'links':sum(len(g['links']) for _,g in graphs)} if args.check_package else asyncio.run(run(args,catalog,graphs))
    if args.report:Path(args.report).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':main()
