"""Read-only acceptance checks for authored graph snapshots and learning ZIPs.

Run: python3 -m unittest discover -s 内置数据/shared -p 'test_*.py' -v
"""
import hashlib
import json
from pathlib import Path
import subprocess
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / '内置数据'


class AuthoredPackages(unittest.TestCase):
    def test_all_48_graphs_packages_content_identity_and_connectivity(self):
        total = 0
        for directory, expected in [('PMP8知识图谱', 30), ('项目管理基础图谱', 18)]:
            package = DATA / directory
            catalog = json.loads((package/'catalog.json').read_text())
            self.assertEqual(len(catalog['graphs']), expected)
            self.assertEqual(catalog['graphCount'], expected)
            self.assertEqual(len({r['id'] for r in catalog['graphs']}), expected)
            self.assertEqual(len({r['name'] for r in catalog['graphs']}), expected)
            for row in catalog['graphs']:
                with self.subTest(package=directory, topic=row['id']):
                    raw = (package/row['file']).read_bytes()
                    graph = json.loads(raw)
                    self.assertEqual(len(graph['nodes']), 11)
                    self.assertEqual(row['nodeCount'], 11)
                    self.assertEqual(len(graph['links']), row['linkCount'])
                    self.assertTrue(graph['meta']['sourceUrls'])
                    ids = {n['id'] for n in graph['nodes']}
                    self.assertEqual(len(ids), 11)
                    for n in graph['nodes']:
                        for key in ('title', 'description', 'notes'):
                            self.assertTrue(n['content'][key].strip())
                        self.assertEqual(n['notes'], n['content']['notes'])
                    reached = {graph['nodes'][0]['id']}
                    for _ in graph['nodes']:
                        for edge in graph['links']:
                            self.assertIn(edge['from'], ids)
                            self.assertIn(edge['to'], ids)
                            self.assertTrue(edge['note'].strip())
                            if edge['from'] in reached:
                                reached.add(edge['to'])
                    self.assertEqual(reached, ids)
                    filename = row.get('packageFile', row['file'].replace('graphs/', 'packages/').replace('.json', '-学习包.zip'))
                    zip_path = package/filename
                    with zipfile.ZipFile(zip_path) as archive:
                        self.assertIsNone(archive.testzip())
                        self.assertEqual(set(archive.namelist()), {'manifest.json', 'graph.json', 'README.txt'})
                        self.assertEqual(json.loads(archive.read('graph.json')), graph)
                        manifest = json.loads(archive.read('manifest.json'))
                        self.assertEqual(manifest['nodeCount'], 11)
                        self.assertEqual(manifest['linkCount'], row['linkCount'])
                        self.assertEqual(manifest['title'], row['name'])
                    if expected == 18:
                        self.assertEqual(hashlib.sha256(raw).hexdigest(), row['sha256'])
                        self.assertEqual(hashlib.sha256(zip_path.read_bytes()).hexdigest(), row['packageSha256'])
                        self.assertEqual(row['sourceKey'], catalog['packageId']+':'+row['id'])
                        self.assertEqual(row['category'], graph['meta']['category'])
                        self.assertEqual(graph['meta']['sourceKey'], row['sourceKey'])
                    total += 1
        self.assertEqual(total, 48)

    def test_existing_pmp_graph_zip_catalog_bytes_equal_accepted_git_objects(self):
        files = subprocess.check_output(['git', 'ls-tree', '-rz', '--name-only', 'd631e115', '--', '内置数据/PMP8知识图谱', '内置数据/PMP8-30套知识图谱.zip'], cwd=ROOT).decode().strip('\0').split('\0')
        checked = 0
        for filename in files:
            if '/graphs/' in filename or '/packages/' in filename or filename.endswith('/catalog.json') or filename.endswith('.zip'):
                self.assertEqual((ROOT/filename).read_bytes(), subprocess.check_output(['git', 'show', 'd631e115:'+filename], cwd=ROOT), filename)
                checked += 1
        self.assertEqual(checked, 62)


if __name__ == '__main__':
    unittest.main()
