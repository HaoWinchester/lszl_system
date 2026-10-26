"""Pure guards run without importing the application or connecting to a DB."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('publication', Path(__file__).with_name('publication.py'))

class PublicationGuards(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert SPEC.origin and Path(SPEC.origin).exists(), 'Shared publication helper must exist'
        cls.module = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(cls.module)

    def test_18_and_legacy_categories(self):
        for directory, count, categories in [('项目管理基础图谱',18,{'prince2','cspm','gaoxiang'}), ('PMP8知识图谱',30,{'pmp'})]:
            catalog, graphs = self.module.read_package(ROOT/'内置数据'/directory)
            self.assertEqual(len(graphs),count)
            self.assertEqual({i['category'] for i,g in graphs}, categories)

    def test_duplicate_escape_counts_endpoints_hash_category_assets(self):
        catalog, graphs = self.module.read_package(ROOT/'内置数据/项目管理基础图谱')
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp)
            original=copy.deepcopy(catalog)
            original['graphs']=copy.deepcopy([graphs[0][0]])
            original.update(graphCount=1,nodeCount=11,linkCount=11)
            original['graphs'][0].pop('packageFile',None)
            original['graphs'][0].pop('packageSha256',None)
            original['graphs'][0]['file']='graph.json'
            def check(c,g):
                (directory/'catalog.json').write_text(json.dumps(c))
                (directory/'graph.json').write_text(json.dumps(g))
                with self.assertRaises(ValueError): self.module.read_package(directory)
            c=copy.deepcopy(original); c['graphs']*=2; check(c,graphs[0][1])
            c=copy.deepcopy(original); c['graphs'][0]['file']='../escaped.json'; check(c,graphs[0][1])
            c=copy.deepcopy(original); c['nodeCount']=12; check(c,graphs[0][1])
            for change in ('duplicate','endpoint','assets','hash','category'):
                c=copy.deepcopy(original); g=copy.deepcopy(graphs[0][1]); c['graphs'][0].pop('sha256',None)
                if change=='duplicate':g['nodes'][1]['id']=g['nodes'][0]['id']
                if change=='endpoint':g['links'][0]['to']='absent'
                if change=='assets':g['resources']=[{'id':'private'}]
                if change=='hash':c['graphs'][0]['sha256']='0'*64
                if change=='category':c['graphs'][0]['category']='unknown'
                check(c,g)

    def test_strict_targets_and_local_origins(self):
        for target,env,configured,current in [('uat','dev','kg_graph_dev','kg_graph_dev'),('prod','uat','kg_graph','kg_graph'),('uat','uat','kg_graph_uat','kg_graph'),('dev','dev','kg_graph_dev','kg_graph_dev')]:
            with self.assertRaises(ValueError):self.module.validate_target(target,env,configured,current)
        self.module.validate_target('uat','uat','kg_graph_uat','kg_graph_uat')
        self.module.validate_target('dev','dev','kg_graph_dev','kg_graph_dev',local=True)
        for origin in ['https://localhost','http://example.org','http://localhost/path','http://u@localhost','http://localhost?x=1']:
            with self.assertRaises(ValueError):self.module.validate_origin(origin)
        self.module.validate_origin('http://127.0.0.1:5173')


class BackupGuards(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(cls.module)

    def test_stale_wrong_database_digest_empty_and_naive_evidence(self):
        from datetime import datetime, timezone, timedelta
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp);dump=directory/'dev.dump';dump.write_bytes(b'not-a-dump')
            evidence={'path':str(dump),'database':'kg_graph_dev','createdAt':datetime.now(timezone.utc).isoformat(),'sha256':hashlib.sha256(dump.read_bytes()).hexdigest()}
            for fields in [{'createdAt':(datetime.now(timezone.utc)-timedelta(hours=2)).isoformat()},{'database':'kg_graph_uat'},{'sha256':'0'*64},{'createdAt':datetime.now().isoformat()}]:
                path=directory/'evidence.json';path.write_text(json.dumps(evidence|fields))
                with self.assertRaises(ValueError):self.module.verify_backup(path)
            dump.write_bytes(b'');path.write_text(json.dumps(evidence))
            with self.assertRaises(ValueError):self.module.verify_backup(path)

    def test_symlink_outside_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory=Path(tmp);outside=directory/'outside.json';outside.write_text('{}')
            package=directory/'package';package.mkdir();(package/'graph.json').symlink_to(outside)
            with self.assertRaises(ValueError):self.module.confined_file(package,'graph.json')

class PreciseRoundtrip(unittest.TestCase):
    def test_known_roundtrip_preserves_unknown_and_validates_retained_meta(self):
        module=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(module)
        _,graphs=module.read_package(ROOT/'内置数据/PMP8知识图谱')
        canonical=graphs[0][1];original=copy.deepcopy(canonical)
        actual=copy.deepcopy(canonical)
        for key in module.AUTHORING_META_KEYS:actual['meta'].pop(key)
        actual['defaults']=copy.deepcopy(module.EDITOR_DEFAULTS)
        actual.pop('resources',None)
        actual.update(viewport={'x':2,'y':3,'scale':1},focusMode=True,selectedNodeId='n')
        self.assertTrue(module.semantic_matches(actual,canonical))
        for key,value in [('mindmap',{'rootIds':['edited']}),('unknownGraphField',True),('flashReviews',{'studied':1})]:
            modified=copy.deepcopy(actual);modified[key]=value
            self.assertFalse(module.semantic_matches(modified,canonical),key)
        for key,value in [('edition','edited'),('customNote','edited')]:
            modified=copy.deepcopy(actual);modified['meta'][key]=value
            self.assertFalse(module.semantic_matches(modified,canonical),key)
        for key in module.AUTHORING_META_KEYS:
            modified=copy.deepcopy(actual);modified['meta'][key]=canonical['meta'][key]
            self.assertTrue(module.semantic_matches(modified,canonical),key)
        self.assertEqual(canonical,original)


if __name__=='__main__':unittest.main()
