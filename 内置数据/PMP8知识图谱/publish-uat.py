"""Publish this authored package as free templates, using existing services.

Default is read-only UAT planning. Production requires --environment prod.
Every target requires its exact ENV and database; --apply enables writes.
Existing publications are reused only when their immutable content matches;
name/content conflicts stop the run instead of replacing any user's template.
"""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import sys

PACKAGE = Path(__file__).resolve().parent
SOURCE_KIND = 'builtin-template'
FOLDER_NAME = 'PMP8 · 基础模板源文件'


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def validate_target(target, actual_environment, database):
    expected_database = {'uat': 'kg_graph_uat', 'prod': 'kg_graph'}.get(target)
    if expected_database is None or actual_environment != target or database != expected_database:
        raise ValueError('Refusing publication outside the explicitly selected environment/database')
    return expected_database


def read_package():
    catalog = json.loads((PACKAGE/'catalog.json').read_text())
    if catalog['graphCount'] != 30 or len(catalog['graphs']) != 30:
        raise ValueError('Expected the complete 30-template package')
    graphs = []
    for item in catalog['graphs']:
        path = (PACKAGE/item['file']).resolve()
        if not path.is_relative_to(PACKAGE):
            raise ValueError('Package path escapes its directory')
        graph = json.loads(path.read_text())
        ids = {node['id'] for node in graph['nodes']}
        if len(ids) != item['nodeCount'] or len(graph['links']) != item['linkCount']:
            raise ValueError('Graph count mismatch: '+item['id'])
        if graph['meta']['title'] != item['name'] or any(link['from'] not in ids or link['to'] not in ids for link in graph['links']):
            raise ValueError('Invalid graph identity/endpoints: '+item['id'])
        if graph.get('resources') or any(node.get('content', {}).get('images') for node in graph['nodes']):
            raise ValueError('This cross-environment package must not reference private assets')
        graphs.append((item, graph))
    if len({item['id'] for item, _ in graphs}) != 30 or len({item['name'] for item, _ in graphs}) != 30:
        raise ValueError('Duplicate package identities')
    return catalog, graphs


async def run(args, catalog, graphs):
    # This script is copied into the running backend's working directory/context.
    sys.path.insert(0, str(Path.cwd()))
    from sqlalchemy import select, text
    from sqlalchemy.engine import make_url
    from app.core.config import settings
    from app.db.session import AsyncSessionLocal, engine
    from app.models.user import User
    from app.models.file import GraphFile, FileContent, Folder
    from app.models.graph_template import GraphTemplate, GraphTemplateVersion
    from app.schemas.graph_template import PublicationInput
    from app.services import file_service, graph_template_service as templates

    database = validate_target(args.environment, settings.ENV, make_url(settings.DATABASE_URL).database)
    try:
        async with AsyncSessionLocal() as db:
            validate_target(args.environment, settings.ENV, await db.scalar(text('select current_database()')))
            user = await db.get(User, args.owner)
            if not user or user.role != 'admin' or user.status != 'active':
                raise ValueError('An existing active administrator is required')
            # Validate the complete batch and every conflict before any mutation.
            plan = []
            for item, graph in graphs:
                templates.remap_graph(graph)
                file_service.validate_graph_tables(graph)
                file_service.validate_graph_strokes(graph)
                key = catalog['packageId']+':'+item['id']
                sources = (await db.scalars(select(GraphFile).where(GraphFile.owner_id == user.username, GraphFile.source == SOURCE_KIND, GraphFile.source_file_id == key))).all()
                rows = (await db.scalars(select(GraphTemplate).where(GraphTemplate.name == item['name']))).all()
                if len(sources) > 1 or len(rows) > 1:
                    raise ValueError('Ambiguous existing source/publication: '+item['name'])
                source, row = (sources[0] if sources else None), (rows[0] if rows else None)
                digest = fingerprint(templates.published_graph(graph))
                if row:
                    version = await db.scalar(select(GraphTemplateVersion).where(GraphTemplateVersion.template_id == row.id, GraphTemplateVersion.version == row.current_version))
                    if row.owner_id != user.username or not source or not version or version.source_file_id != source.id or fingerprint(version.graph_data) != digest or row.member_only or not row.listed:
                        raise ValueError('Existing template differs; no overwrite allowed: '+item['name'])
                elif source:
                    content = await db.get(FileContent, source.id)
                    if source.status != 'active' or not content or fingerprint(templates.published_graph(content.graph_data)) != digest:
                        raise ValueError('Existing source differs; no overwrite allowed: '+item['name'])
                plan.append({'topicId': item['id'], 'name': item['name'], 'action': 'unchanged' if row else 'create', 'sourceKey': key, 'fileId': source.id if source else None, 'templateId': row.id if row else None, 'sha256': digest})
            result = {'environment': args.environment, 'database': database, 'packageId': catalog['packageId'], 'owner': user.username, 'apply': args.apply, 'created': 0, 'unchanged': sum(p['action'] == 'unchanged' for p in plan), 'templates': plan}
            if args.apply:
                folders = (await db.scalars(select(Folder).where(Folder.owner_id == user.username, Folder.name == FOLDER_NAME, Folder.status == 'active'))).all()
                if len(folders) > 1:
                    raise ValueError('Ambiguous template source folder')
                folder = folders[0] if folders else await file_service.create_folder(db, user.username, FOLDER_NAME)
                for (item, graph), entry in zip(graphs, plan):
                    if entry['action'] == 'create':
                        source = await db.get(GraphFile, entry['fileId']) if entry['fileId'] else await file_service.create_file(db, user.username, name=item['name'], graph_data=graph, folder_id=folder.id, source=SOURCE_KIND, source_file_id=entry['sourceKey'])
                        if source is None:
                            raise ValueError('Failed to create source file: '+item['name'])
                        entry['fileId'] = source.id
                        published = await templates.publish(db, user, PublicationInput(sourceFileId=source.id, expectedFileRevision=source.revision, name=item['name'], description='基础模板 · PMBOK 第八版原创学习图谱 · '+item['description']+'。含情境自测、处理思路和易错辨析。加载后可独立编辑。', memberOnly=False))
                        entry['templateId'] = published['template']['id']
                        result['created'] += 1
                    preview = await templates.preview(db, user, entry['templateId'])
                    if len(preview['preview']['nodes']) != item['nodeCount'] or preview['template']['memberOnly'] or not preview['template']['listed']:
                        raise ValueError('Published template preview/visibility mismatch: '+item['name'])
                    entry['version'] = preview['template']['version']
            if args.report:
                Path(args.report).write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
            return result
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--owner', default='admin')
    parser.add_argument('--environment', choices=('uat', 'prod'), default='uat')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--check-package', action='store_true')
    parser.add_argument('--report')
    args = parser.parse_args()
    catalog, graphs = read_package()
    if args.check_package:
        result = {'graphs': len(graphs), 'nodes': sum(len(g['nodes']) for _, g in graphs), 'links': sum(len(g['links']) for _, g in graphs)}
    else:
        result = asyncio.run(run(args, catalog, graphs))
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
