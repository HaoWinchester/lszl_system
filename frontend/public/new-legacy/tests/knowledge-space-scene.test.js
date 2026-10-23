'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'../src/practice/knowledge-space-scene.js');
const exists=fs.existsSync(file);
test('standalone scene module is available',()=>assert.ok(exists,'knowledge-space-scene.js must exist'));
if(exists){
 const api=require(file);
 const nodes=Object.freeze(Array.from({length:60},(_,i)=>Object.freeze({...(i%2?{id:`topic-${i}`} :{}),title:`考点 ${i}`,subject:i<30?'数学':'英语',taxonomyId:i%3,brightness:i/60})));
 test('deterministic 3D layout preserves caller data and stable missing-id keys',()=>{
  const before=JSON.stringify(nodes),a=api.createModel(nodes),b=api.createModel(nodes);
  assert.deepEqual(a,b);assert.equal(a.points.length,60);assert.ok(new Set(a.points.map(p=>p.z)).size>1);
  assert.ok(new Set(a.points.map(p=>`${p.x},${p.y},${p.z}`)).size>1);assert.equal(new Set(a.points.map(p=>p.key)).size,60);
  assert.equal(JSON.stringify(nodes),before);assert.equal(a.points[0].node,nodes[0]);
  assert.equal(a.points[0].group,'["数学","0",""]');
 });
 test('organization edges only join matching subject and classification',()=>{
  const m=api.createModel(nodes);assert.equal(m.groups.length,6);assert.ok(m.edges.length>0);
  for(const edge of m.edges){const a=m.points[edge.source],b=m.points[edge.target];assert.equal(a.group,b.group);assert.equal(edge.group,a.group)}
 });
 test('bounded gravity converges without nonfinite or collapsed coordinates',()=>{
  const m=api.createModel(nodes),initial=m.points.map(p=>[p.x,p.y,p.z]);let moving=true,steps=0;
  while(moving&&steps<1000){moving=api.stepModel(m);steps++}
  assert.equal(moving,false);assert.ok(steps<1000);assert.ok(steps>1);assert.notDeepEqual(m.points.map(p=>[p.x,p.y,p.z]),initial);
  assert.ok(m.points.every(p=>[p.x,p.y,p.z,p.vx,p.vy,p.vz].every(Number.isFinite)));
  for(let i=0;i<m.points.length;i++)for(let j=0;j<i;j++)assert.ok(Math.hypot(m.points[i].x-m.points[j].x,m.points[i].y-m.points[j].y,m.points[i].z-m.points[j].z)>1);
  const settled=JSON.stringify(m);assert.equal(api.stepModel(m),false);assert.equal(JSON.stringify(m),settled);
 });
 test('empty and single node input are safe',()=>{
  const empty=api.createModel([]);assert.deepEqual(empty.points,[]);assert.equal(api.stepModel(empty),false);
  const single=api.createModel([{title:'唯一考点'}]);let moving=true;for(let i=0;i<1000&&moving;i++)moving=api.stepModel(single);
  assert.equal(moving,false);assert.ok(single.points.every(p=>[p.x,p.y,p.z].every(Number.isFinite)));
  assert.equal(api.mount({host:null,nodes:[]}),null);
 });
 for(const size of [320,1000])test(`all ${size} catalog nodes survive bounded deterministic solving`,()=>{
  const input=Object.freeze(Array.from({length:size},(_,i)=>Object.freeze({id:String(i),parentId:i%40?String(i-1):null,subject:`科目 ${Math.floor(i/40)}`,taxonomyId:Math.floor(i/40),brightness:i%5?.12:1})));
  const before=JSON.stringify(input),started=performance.now(),m=api.createModel(input);
  assert.equal(m.points.length,size);assert.equal(m.edges.length,size-Math.ceil(size/40));
  while(!m.settled&&m.steps<400)api.stepModel(m);
  assert.ok(m.settled);assert.ok(m.steps<=320);
  assert.equal(m.points.length,size);assert.ok(m.points.every((p,i)=>p.node===input[i]&&[p.x,p.y,p.z].every(Number.isFinite)));
  assert.equal(new Set(m.points.map(p=>`${p.x},${p.y},${p.z}`)).size,size);
  assert.equal(JSON.stringify(input),before);
  console.log(`catalog ${size}: ${m.steps} steps, ${(performance.now()-started).toFixed(1)}ms`);
 });
 test('catalog edges use explicit parent references and never invent or cross trees',()=>{
  const input=[
   {id:'child',parentId:'root',subject:'数学',taxonomyId:'a'},
   {id:'root',parentId:null,subject:'数学',taxonomyId:'a'},
   {id:'second-root',parentId:null,subject:'数学',taxonomyId:'a'},
   {id:'orphan',parentId:'missing',subject:'数学',taxonomyId:'a'},
   {id:'cross-tree',parentId:'root',subject:'数学',taxonomyId:'b'},
   {id:'self',parentId:'self',subject:'数学',taxonomyId:'a'},
   {id:'cross-subject',parentId:'root',subject:'英语',taxonomyId:'a'},
  ];
  const m=api.createModel(input);
  assert.deepEqual(m.edges.map(e=>[e.source,e.target]),[[1,0]]);
 });
 test('legacy organization fallback stays within wholly legacy groups',()=>{
  const m=api.createModel([
   {id:'a',subject:'legacy'},{id:'b',subject:'legacy'},{id:'c',subject:'other'},
   {id:'catalog',subject:'mixed',parentId:null},{id:'legacy-mixed',subject:'mixed'},
  ]);
  assert.deepEqual(m.edges.map(e=>[e.source,e.target]),[[0,1]]);
 });
 test('perspective has depth and camera rotation/zoom affect projection',()=>{
  const camera={yaw:0,pitch:0,zoom:1},p={x:100,y:50,z:50},before=JSON.stringify(p);
  const a=api.projectPoint(p,camera,800,500),b=api.projectPoint(p,{...camera,yaw:.5,pitch:.2},800,500),c=api.projectPoint(p,{...camera,zoom:2},800,500);
  assert.notEqual(a.x,b.x);assert.notEqual(a.y,b.y);assert.ok(c.scale>a.scale);assert.ok(c.x-400>a.x-400);
  assert.ok(api.projectPoint({...p,z:-100},camera,800,500).scale>a.scale);assert.equal(JSON.stringify(p),before);
 });
}

test('semantic zoom retains stable named classification clusters and reveals every point at detail scale',()=>{
 const api=require(file),input=[
  {id:'a',subject:'数学',taxonomyId:'opaque',path:['代数','方程','一次方程']},
  {id:'b',subject:'数学',taxonomyId:'opaque',path:['代数','方程','二次方程']},
  {id:'c',subject:'英语',taxonomyId:'other',path:['阅读','主旨']},
 ];
 const model=api.createModel(input);
 assert.equal(model.groups[0].label,'数学 · 代数 / 方程');
 assert.equal(api.semanticView(model,.8).mode,'clusters');
 assert.deepEqual(api.semanticView(model,.8).items.map(item=>item.count),[2,1]);
 assert.equal(api.semanticView(model,1.5).mode,'points');
 assert.deepEqual(api.semanticView(model,1.5).items.map(item=>item.index),[0,1,2]);
 assert.deepEqual(api.semanticView(model,1.5,model.groups[0].key).items.map(item=>item.index),[0,1]);
 assert.deepEqual(api.createModel(input).groups,model.groups);
 assert.ok(!model.groups[0].label.includes('opaque'));
});

test('one published tree separates readable top-level categories and preserves numeric zero classification identity',()=>{
 const api=require(file),model=api.createModel([
  {id:'a',subject:'PMP',taxonomyId:0,path:['PMP','人','团队','考点A']},
  {id:'b',subject:'PMP',taxonomyId:0,path:['PMP','人','领导','考点B']},
  {id:'c',subject:'PMP',taxonomyId:0,path:['PMP','过程','风险','考点C']},
  {id:'d',subject:'PMP',taxonomyId:null,path:['PMP','人','团队','考点D']},
 ]);
 assert.equal(model.groups.length,3);
 assert.deepEqual(model.groups.map(g=>g.indices),[[0,1],[2],[3]]);
 assert.equal(model.groups[0].label,'PMP · 人');
 assert.equal(model.groups[1].label,'PMP · 过程 / 风险');
 assert.notEqual(model.points[0].group,model.points[3].group);
});
test('catalog parent edges survive semantic category boundaries within the same tree',()=>{
 const model=require(file).createModel([{id:'root',parentId:null,subject:'A',taxonomyId:1,path:['A']},{id:'child',parentId:'root',subject:'A',taxonomyId:1,path:['A','Child']}]);
 assert.equal(model.groups.length,2);assert.deepEqual(model.edges.map(e=>[e.source,e.target]),[[0,1]]);
});
test('published category roots group with descendants while subject root has an explicit overview label',()=>{
 const api=require(file),nodes=[
  {id:'r',parentId:null,subject:'PMP',taxonomyId:1,path:['PMP']},
  {id:'people',parentId:'r',subject:'PMP',taxonomyId:1,path:['PMP','人']},
  {id:'child',parentId:'people',subject:'PMP',taxonomyId:1,path:['PMP','人','团队']},
  {id:'process',parentId:'r',subject:'PMP',taxonomyId:1,path:['PMP','过程']},
 ];
 const model=api.createModel(nodes);
 assert.equal(api.groupKey(nodes[1]),api.groupKey(nodes[2]));
 assert.deepEqual(model.groups.map(g=>g.indices),[[0],[1,2],[3]]);
 assert.deepEqual(model.groups.map(g=>g.label),['PMP · 科目总览','PMP · 人','PMP · 过程']);
 assert.equal(api.groupKey({subject:'PMP',path:['PMP','人']}),'["PMP","",""]');
});

test('label layout covers every visible member deterministically and hides far text',()=>{
 const api=require(file),points=Array.from({length:1000},(_,index)=>({index,x:40+index%10,y:40+index%8,visible:true}));
 const options={points,width:800,height:600,zoomRatio:1.5,enabled:true,title:index=>`考点 ${index}`};
 const started=performance.now(),labels=api.layoutLabels(options);
 assert.ok(performance.now()-started<100,'1000-member label layout stays below 100ms');
 assert.ok(labels.every(label=>label.x-label.width/2>=0&&label.x+label.width/2<=options.width&&label.y>=0&&label.y<=options.height));
 assert.deepEqual(labels,api.layoutLabels(options));
 assert.deepEqual(labels.flatMap(label=>label.indices).sort((a,b)=>a-b),points.map(p=>p.index));
 assert.ok(labels.some(label=>label.indices.length>1&&label.text.includes(String(label.indices.length))));
 assert.deepEqual(api.layoutLabels({...options,zoomRatio:.74}),[]);
 assert.deepEqual(api.layoutLabels({...options,enabled:false}),[]);
});

test('settled categories retain separate bounded neighborhoods despite cross-category parents',()=>{
 const api=require(file),nodes=Array.from({length:300},(_,i)=>({id:String(i),parentId:i?String(i-1):null,subject:'PMP',taxonomyId:1,path:['PMP',['人','过程','环境'][Math.floor(i/100)],String(i)]})),model=api.createModel(nodes);
 while(!model.settled)api.stepModel(model);
 for(const g of model.groups)for(const p of model.points.filter(p=>p.group===g.key))assert.ok(Math.hypot(p.x-g.x,p.y-g.y)<=g.radius+1);
 for(let i=0;i<model.groups.length;i++)for(let j=0;j<i;j++){const a=model.groups[i],b=model.groups[j];assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>a.radius+b.radius+50)}
 assert.equal(model.points.length,300);assert.equal(model.edges.length,299);
});
test('nearby label aggregation never mixes semantic categories or creates distant leaders',()=>{
 const api=require(file),points=[{index:0,group:'a',x:120,y:240,visible:true},{index:1,group:'b',x:121,y:241,visible:true},{index:2,group:'a',x:130,y:245,visible:true}];
 const labels=api.layoutLabels({points,width:800,height:600,zoomRatio:1.5,enabled:true,title:i=>String(i)});
 assert.equal(labels.length,2);for(const label of labels){assert.equal(new Set(label.indices.map(i=>points[i].group)).size,1);assert.ok(Math.hypot(label.x-label.anchorX,label.y-label.anchorY)<60)}
});

test('foreground-safe label band keeps exact visible coverage while clamping and merging edge labels',()=>{
 const api=require(file),points=Array.from({length:80},(_,index)=>({index,group:index%2?'a':'b',visible:true,x:200+index%8,y:index<40?20+index:540+index%20}));
 const labels=api.layoutLabels({points,width:800,height:600,zoomRatio:1.5,enabled:true,labelTop:180,labelBottom:420,title:i=>String(i)});
 assert.ok(labels.every(label=>label.y>=180&&label.y<=420));
 assert.deepEqual(labels.flatMap(label=>label.indices).sort((a,b)=>a-b),points.map(p=>p.index));
 for(const label of labels)assert.equal(new Set(label.indices.map(i=>points[i].group)).size,1);
});
