"""Import authored graphs into the local Files/Template APIs; never deploys code.

Usage: PMP8_LOCAL_PASSWORD=... python3 import-local.py --username admin
Only loopback addresses are allowed. Existing matching files are reused;
conflicting names or changed content stop the import rather than overwrite data.
"""
import argparse
import getpass
import http.cookiejar
import json
import os
import subprocess
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:5173')
    parser.add_argument('--username', default='admin')
    parser.add_argument('--refresh-visuals', action='store_true', help='Update only authored graph layout/style, preserve existing card content, publish a new template version.')
    args = parser.parse_args()
    url = urllib.parse.urlsplit(args.base_url)
    if url.scheme != 'http' or url.hostname not in {'127.0.0.1', 'localhost', '::1'} or url.path or url.query or url.fragment or url.username:
        parser.error('Only a plain loopback HTTP origin is supported.')
    jar = http.cookiejar.CookieJar()
    class LocalRedirects(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            if urllib.parse.urlsplit(newurl).netloc != url.netloc:
                raise RuntimeError('Refusing redirect away from local origin')
            return super().redirect_request(req, fp, code, msg, headers, newurl)
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), LocalRedirects())

    def api(method, route, body=None):
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        req = urllib.request.Request(args.base_url+route, data=data, method=method, headers={'Content-Type': 'application/json'})
        try:
            with client.open(req, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f'{method} {route}: HTTP {error.code}: {error.read().decode()[:300]}') from None

    assert api('GET', '/api/v1/health')['db'] == 'ok'
    password = os.environ.get('PMP8_LOCAL_PASSWORD') or getpass.getpass('Local account password: ')
    actor = api('POST', '/api/v1/auth/login', {'username': args.username, 'password': password, 'acceptedTermsVersion': '2026-08-13-v1'})['user']
    if actor['role'] not in {'admin', 'teacher'}:
        raise RuntimeError('A local teacher or administrator is required to publish templates.')
    directory = Path(__file__).resolve().parent
    catalog = json.loads((directory/'catalog.json').read_text())
    if args.refresh_visuals:
        subprocess.run(['node', str(directory/'validate-layout.mjs')], check=True, capture_output=True)
    folder_name = 'PMP8 · 30套知识图谱'
    folders = api('GET', '/api/v1/files/folders')['folders']
    folder = next((f for f in folders if f['name'] == folder_name), None)
    if folder is None:
        folder = api('POST', '/api/v1/files/folders', {'name': folder_name})['folder']
    templates = api('GET', '/api/v1/graph-templates')['templates']
    receipt = {'baseUrl': args.base_url, 'username': args.username, 'folderId': folder['id'], 'graphs': []}
    visual_backup = []
    if args.refresh_visuals:
        for item in catalog['graphs']:
            previous = next((g for g in json.loads((directory.parents[1]/'docs/local-preview/pmp8/local-import.json').read_text())['graphs'] if g['id'] == item['id']), None)
            if previous is None:
                raise RuntimeError('Missing local authoring receipt: '+item['name'])
            saved = api('GET', '/api/v1/files/'+previous['fileId'])
            if saved['meta']['folderId'] != folder['id']:
                raise RuntimeError('Authored file moved; refusing automatic refresh: '+item['name'])
            visual_backup.append({'topicId': item['id'], 'fileId': previous['fileId'], 'payload': saved})
        backup_path = directory.parents[1]/'docs/local-preview/pmp8/before-visual-revision.json'
        if not backup_path.exists():
            backup_path.write_text(json.dumps(visual_backup, ensure_ascii=False, indent=2)+'\n')
    for item in catalog['graphs']:
        graph = json.loads((directory/item['file']).read_text())
        visual_changed = False
        query = urllib.parse.urlencode({'folder_id': folder['id'], 'query': item['name'], 'page_size': 100})
        matches = [f for f in api('GET', '/api/v1/files?'+query)['files'] if f['name'] == item['name']]
        if len(matches) > 1:
            raise RuntimeError('Ambiguous existing graph: '+item['name'])
        if matches:
            file = matches[0]
            existing = api('GET', '/api/v1/files/'+file['id'])['graphData']
            if args.refresh_visuals:
                existing_nodes = {n['id']: n for n in existing['nodes']}
                if set(existing_nodes) != {n['id'] for n in graph['nodes']}:
                    raise RuntimeError('Card set was edited; refusing visual refresh: '+item['name'])
                # Preserve existing content, resources, and personal state. Only
                # authored positions/appearance and relation routes are replaced.
                updated = dict(existing)
                updated['nodes'] = [{**existing_nodes[n['id']], **{key: value for key, value in n.items() if key not in {'content','title','summary','notes','category','level','keywords','highlightTerms'}}} for n in graph['nodes']]
                updated['links'] = graph['links']
                updated['meta'] = {**graph['meta'], **existing.get('meta', {}), 'visualRevision': 2, 'layout': graph['meta']['layout']}
                updated['viewport'] = graph['viewport']
                visual_changed = any(any(existing_nodes[n['id']].get(section, {}).get(k) != v for section in ('geometry', 'appearance') for k,v in n[section].items()) for n in graph['nodes']) or len(existing['links']) != len(graph['links']) or any(any(old.get(k) != v for k,v in new.items()) for old,new in zip(existing['links'], graph['links']))
                if visual_changed:
                    file = api('PUT', '/api/v1/files/'+file['id'], {'graphData': updated, 'expectedRevision': file['revision']})['file']
            else:
                for field in ('nodes', 'links'):
                    if existing[field] != graph[field]:
                        raise RuntimeError('Existing graph differs; refusing overwrite: '+item['name'])
        else:
            file = api('POST', '/api/v1/files', {'name': item['name'], 'folderId': folder['id'], 'graphData': graph, 'source': 'imported'})['file']
        template = next((t for t in templates if t['name'] == item['name']), None)
        if template is None:
            template = api('POST', '/api/v1/graph-templates', {'sourceFileId': file['id'], 'expectedFileRevision': file['revision'], 'name': item['name'], 'description': 'PMBOK 第八版原创学习图谱 · '+item['description']+'。含情境自测、处理思路和易错辨析。', 'memberOnly': False})['template']
        elif not template['canMaintain']:
            raise RuntimeError('Existing template is maintained by another publisher: '+item['name'])
        if args.refresh_visuals and visual_changed and template is not None:
            template = api('POST', '/api/v1/graph-templates/'+template['id']+'/versions', {'sourceFileId': file['id'], 'expectedFileRevision': file['revision'], 'name': item['name'], 'description': 'PMBOK 第八版原创学习图谱 · 布局与配色修订。'+item['description'], 'memberOnly': False})['template']
        projection = api('GET', '/api/v1/graph-templates/'+template['id'])['preview']
        assert len(projection['nodes']) == item['nodeCount'], item['name']
        receipt['graphs'].append({'id': item['id'], 'name': item['name'], 'fileId': file['id'], 'templateId': template['id'], 'version': template['version']})
        print(item['id']+' imported and preview verified')
    # Opening position is personal preference; select the authored overview.
    api('PUT', '/api/v1/files/current', {'fileId': receipt['graphs'][0]['fileId']})
    output = directory.parents[1]/'docs/local-preview/pmp8/local-import.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2)+'\n')
    print(f'Imported {len(receipt["graphs"])} local graphs and templates; receipt: {output}')


if __name__ == '__main__':
    main()
