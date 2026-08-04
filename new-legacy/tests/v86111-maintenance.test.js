'use strict';
const fs=require('fs');
const vm=require('vm');
const storage=new Map();
const context={console,Date,URLSearchParams,CustomEvent:function(type,init){this.type=type;this.detail=init?.detail},localStorage:{getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},dispatchEvent(){},KGAuthCore:{currentUsername:()=> 'teacher-zhao',currentUser:()=>({username:'teacher-zhao',displayName:'赵老师',role:'teacher'})}};
context.window=context;
vm.createContext(context);
for(const file of ['src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/91-knowledge-tree-index.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
const core=context.KGLearningContent,indexApi=context.KGKnowledgeTreeIndex;
function assert(condition,message){if(!condition)throw new Error(message)}

// Large-tree index: 360 nodes, with one six-level branch and a large second level.
const nodes=[{id:'perf-1',taxonomyId:'taxonomy-perf',parentId:null,level:1,title:{zh:'性能根节点',en:''},code:'PERF.1',status:'active',aliases:[],sortOrder:1}];
let lastId='perf-1';
for(let level=2;level<=6;level++){const id=`perf-${level}`;nodes.push({id,taxonomyId:'taxonomy-perf',parentId:lastId,level,title:{zh:`六层分支 ${level}`,en:''},code:`PERF.${level}`,status:'active',aliases:[],sortOrder:1});lastId=id}
for(let i=7;i<=360;i++)nodes.push({id:`perf-${i}`,taxonomyId:'taxonomy-perf',parentId:'perf-1',level:2,title:{zh:`性能节点 ${i}`,en:''},code:`PERF.${i}`,status:'active',aliases:[],sortOrder:i});
const index=indexApi.create({id:'taxonomy-perf',nodes},[]);
assert(index.nodes.length===360,'索引应包含 360 个节点');
assert(index.children(null).length===1,'大知识树应保留单一根节点');
assert(index.search('性能').length>=355,'搜索应覆盖大部分性能节点');
assert(index.path('perf-6').length===6,'路径索引应支持六层');

// Physical delete is allowed only when the branch has no activity references.
let created=core.saveKnowledgeNode('taxonomy-pmp-main',{parentId:'kp-pmp',title:{zh:'临时可删除知识点',en:''}});
assert(created.valid,'应可创建临时知识点');
let deletion=core.deleteKnowledgeNode('taxonomy-pmp-main',created.node.id);
assert(deletion.valid&&deletion.deletedIds.length===1,'无引用叶节点应可删除');

const parentNode=core.saveKnowledgeNode('taxonomy-pmp-main',{parentId:'kp-pmp',title:{zh:'临时父节点',en:''}}).node;
const child=core.saveKnowledgeNode('taxonomy-pmp-main',{parentId:parentNode.id,title:{zh:'临时子节点',en:''}}).node;
const deleteWithoutCascade=core.deleteKnowledgeNode('taxonomy-pmp-main',parentNode.id);
assert(!deleteWithoutCascade.valid&&deleteWithoutCascade.requiresCascade,'含下级节点时应要求级联确认');
deletion=core.deleteKnowledgeNode('taxonomy-pmp-main',parentNode.id,{cascade:true});
assert(deletion.valid&&deletion.deletedIds.includes(child.id),'级联删除应移除完整分支');

const mappedNode=core.saveKnowledgeNode('taxonomy-pmp-main',{parentId:'kp-pmp',title:{zh:'有引用知识点',en:''}}).node;
const activityId=Object.keys(core.getActivityLibrary())[0];
assert(core.mapActivities([activityId],{taxonomyId:'taxonomy-pmp-main',primaryNodeId:mappedNode.id,relatedNodeIds:[]}).valid,'活动应可映射到测试知识点');
const blocked=core.deleteKnowledgeNode('taxonomy-pmp-main',mappedNode.id);
assert(!blocked.valid&&blocked.referencedActivityIds.includes(activityId),'被活动引用的知识点必须阻止物理删除');
assert(core.deprecateKnowledgeNode('taxonomy-pmp-main',mappedNode.id).valid,'被引用知识点应允许安全停用');

console.log('v86111-maintenance-ok',{indexedNodes:index.nodes.length,deletedLeaf:true,cascadeDeleted:deletion.deletedIds.length,referenceBlocked:blocked.referencedActivityIds.length});
