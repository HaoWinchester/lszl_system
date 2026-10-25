// Content authoring utility: reuse the editor's canonical graph model.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import {arrange} from './layout.mjs';
await import('../../new-legacy/src/graph/graph-model.js');
const model=globalThis.KGGraphModel;
const dir=path.dirname(fileURLToPath(import.meta.url));
const source=readFileSync(path.join(dir,'topics.txt'),'utf8');
const topics=[];
for(const line of source.split('\n').map(v=>v.trim()).filter(Boolean)){
  if(line.startsWith('# ')){
    const [id,title,category,layout]=line.slice(2).split('|');
    topics.push({id,title,category,layout,concepts:[],relations:[]});
  }else{
    const topic=topics.at(-1);assert(topic,'Missing topic header');
    if(line.startsWith('@')){const [pair,type,note]=line.slice(1).split('|');topic.relations.push({pair:pair.split('>').map(Number),type,note})}
    else if(line.startsWith('?')){const [question,answer,pitfall]=line.slice(1).split('|');topic.scenario={question,answer,pitfall}}
    else{const [title,description,notes]=line.split('|');assert(title&&description&&notes,line);topic.concepts.push({title,description,notes})}
  }
}
assert.equal(topics.length,30);
const graphDir=path.join(dir,'graphs');mkdirSync(graphDir,{recursive:true});
globalThis.window=globalThis;
await import('../../new-legacy/src/21-home-package-service.js');
const catalog=[];
const packageDir=path.join(dir,'packages');mkdirSync(packageDir,{recursive:true});
for(const topic of topics){
  assert.equal(topic.concepts.length,7,topic.title);assert(topic.scenario?.answer);
  const prefix='pmp8-'+topic.id;
  const node=(key,title,description,notes,xy,fill,level='重点')=>model.normalizeNode({
    id:prefix+'-'+key,content:{title,description,notes,category:topic.category+' · '+topic.title,level,keywords:[title,topic.title,'PMBOK第八版'].join(',')},
    appearance:{...model.DEFAULT_APPEARANCE,size:'big',cardStyle:'standard',color:fill,fillColor:'#ffffff',borderColor:fill,borderWidth:2,fontSize:18,textColor:'#0f172a'},
    geometry:{x:Math.round(xy[0]),y:Math.round(xy[1]),width:160,height:166}
  });
  const description='围绕“'+topic.title+'”学习概念、关系与应用。点击卡片查看说明和学习提示，再用情境题检查理解。';
  const nodes=[node('root',topic.title,description,'建议顺序：主题 → 概念卡片 → 关系连线 → 情境自测 → 处理思路 → 易错辨析。此为原创学习图谱，中文名称为学习用表述，不是 PMI 官方译文。',[0,0],'#2563eb'),
    ...topic.concepts.map((c,i)=>node('c'+i,c.title,c.description,c.notes,[0,0],'#2563eb')),
    node('case','情境自测',topic.scenario.question,'先说出依据与下一步行动，再查看“处理思路”。这是学习情境，不是 PMP 官方试题。',[300,800],'#b45309','中等'),
    node('answer','处理思路',topic.scenario.answer,'结合项目情境、已知事实和授权边界判断。不要把本例处理思路视为适用于所有问题的固定口诀。',[650,800],'#15803d'),
    node('pitfall','易错辨析',topic.scenario.pitfall,'回到图谱中的概念与连线，说明这种判断为什么可能不成立。',[1000,800],'#be123c','易错点')];
  const arranged=arrange(topic,nodes,model);
  const links=arranged.links;
  const graph={meta:{title:'PMP8 · '+topic.id+' '+topic.title,subject:'PMP / PMBOK® Guide 第八版',audience:'PMP 学习者 / 项目管理课堂',description,contentPackageId:'pmp8-knowledge-graphs-20261025',topicId:topic.id,edition:'PMBOK Guide Eighth Edition',sourceUrls:['https://www.pmi.org/standards/pmbok'],contentNote:'依据官方公开框架编排的原创教学内容；应用专题不作为官方章目或 PMP 考纲完整映射。',layout:arranged.layout,visualRevision:2},
    viewport:{x:40,y:70,scale:.85},nodes,links,elements:[],tables:[],resources:[],strokes:[],flashReviews:{},importedFlashcards:[]};
  const ids=new Set(nodes.map(n=>n.id));assert.equal(ids.size,nodes.length);
  assert(links.every(l=>ids.has(l.from)&&ids.has(l.to)));
  assert(nodes.every(n=>Number.isFinite(n.x)&&n.content.description&&n.content.notes));
  const reached=new Set([nodes[0].id]);for(let i=0;i<nodes.length;i++)for(const l of links)if(reached.has(l.from))reached.add(l.to);assert.equal(reached.size,nodes.length);
  for(let a=0;a<nodes.length;a++)for(let b=a+1;b<nodes.length;b++){const p=nodes[a].geometry,q=nodes[b].geometry;assert(!(p.x<q.x+q.width&&p.x+p.width>q.x&&p.y<q.y+q.height&&p.y+p.height>q.y),topic.title+' overlapping cards')}
  const filename=topic.id+'-'+topic.title+'.json';
  writeFileSync(path.join(graphDir,filename),JSON.stringify(graph,null,2)+'\n');
  const learningPackage=globalThis.KGHomePackageService.buildPackageBlob(graph);
  writeFileSync(path.join(packageDir,topic.id+'-'+topic.title+'-学习包.zip'),Buffer.from(await learningPackage.blob.arrayBuffer()));
  catalog.push({id:topic.id,name:graph.meta.title,category:topic.category,layout:topic.layout,file:'graphs/'+filename,nodeCount:nodes.length,linkCount:links.length,visualLayout:arranged.layout,description:topic.concepts.map(c=>c.title).join('、')});
}
const manifest={schemaVersion:'pmp8-knowledge-graph-catalog-v1',packageId:'pmp8-knowledge-graphs-20261025',createdAt:'2026-10-25',sourceUrls:['https://www.pmi.org/standards/pmbok'],graphCount:catalog.length,nodeCount:catalog.reduce((s,g)=>s+g.nodeCount,0),linkCount:catalog.reduce((s,g)=>s+g.linkCount,0),graphs:catalog};
writeFileSync(path.join(dir,'catalog.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({graphs:manifest.graphCount,nodes:manifest.nodeCount,links:manifest.linkCount,layouts:[...new Set(catalog.map(g=>g.layout))],validation:'IDs, content, finite geometry, endpoints, connectivity, no overlapping cards'}));
