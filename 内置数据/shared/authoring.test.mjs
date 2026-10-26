import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCatalog} from './authoring.mjs';
test('foundation package has 18 unique, complete, source-backed graphs in three categories',async()=>{
 const {config,topics}=await import('../项目管理基础图谱/topics.mjs');
 const result=await buildCatalog(config,topics,{write:false});
 assert.equal(result.catalog.graphCount,18);assert.equal(result.catalog.nodeCount,198);
 assert.deepEqual([...new Set(result.catalog.graphs.map(g=>g.category))],['prince2','cspm','gaoxiang']);
 assert.equal(new Set(result.catalog.graphs.map(g=>g.sourceKey)).size,18);
 for(const graph of result.graphs){assert.equal(graph.nodes.length,11);assert(graph.meta.sourceUrls.length);for(const n of graph.nodes){assert(n.content.description.length>=16);assert(n.content.notes.length>=16)}}
});
test('all 48 graphs use unobstructed noncrossing canonical editor routes',async()=>{
 const {validateLayout}=await import('./validate-layout.mjs');
 const {fileURLToPath}=await import('node:url');
 let count=0;
 for(const name of ['PMP8知识图谱','项目管理基础图谱']){
  const report=validateLayout(fileURLToPath(new URL('../'+name+'/',import.meta.url)),{writeReport:false});
  assert.equal(report.cardObstructions,0);assert.equal(report.edgeCrossings,0);count+=report.totalGraphs;
 }
 assert.equal(count,48);
});
test('authoring rejects duplicate identities and escaping topic filenames',async()=>{
 const {config,topics}=await import('../项目管理基础图谱/topics.mjs');
 await assert.rejects(buildCatalog(config,[topics[0],topics[0],...topics.slice(2)],{write:false}),/Duplicate/);
 await assert.rejects(buildCatalog(config,[{...topics[0],id:'../escape'},...topics.slice(1)],{write:false}),/Unsafe/);
});
test('shared pipeline reproduces all 30 immutable PMP graph objects',async()=>{
 const {parseTopics}=await import('./authoring.mjs');
 const {fileURLToPath}=await import('node:url');
 const directory=new URL('../PMP8知识图谱/',import.meta.url);
 const {catalog,graphs}=await buildCatalog({directory,expectedCount:30},parseTopics(fileURLToPath(directory)),{write:false});
 const saved=JSON.parse(readFileSync(new URL('catalog.json',directory)));
 assert.deepEqual(catalog,saved);
 graphs.forEach((g,i)=>assert.deepEqual(g,JSON.parse(readFileSync(new URL(saved.graphs[i].file,directory)))));
});
