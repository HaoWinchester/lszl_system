'use strict';
const fs=require('fs'),vm=require('vm'),crypto=require('crypto'),path=require('path');
const root=path.resolve(__dirname,'..');
const currentVersion=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
if(currentVersion!=='v8.6.1.2.1'){console.log('v861121-data-integrity-historical-skip',{currentVersion});process.exit(0)}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'MAINTENANCE_DATA_INTEGRITY_v8.6.1.2.1.json'),'utf8'));
const storage=new Map();
const context={console,Date,URLSearchParams,CustomEvent:function(type,init){this.type=type;this.detail=init?.detail},localStorage:{getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},dispatchEvent(){},KGAuthCore:{currentUsername:()=> 'teacher-zhao',currentUser:()=>({username:'teacher-zhao',displayName:'赵老师',role:'teacher'})}};
context.window=context;vm.createContext(context);
for(const file of ['src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/91-learning-content-core.js','src/93-content-organization-core.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
const core=context.KGLearningContent,org=context.KGContentOrganization;
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
function assert(condition,message){if(!condition)throw new Error(message)}
const activities=Object.keys(core.getActivityLibrary()).sort();
const taxonomies=core.getTaxonomies();
const knowledgeIds=taxonomies.flatMap(t=>t.nodes.map(n=>n.id)).sort();
const courses=core.getCourseDrafts();
const courseNodeIds=courses.flatMap(c=>c.nodes.map(n=>n.id)).sort();
const tasks=org.getLearningTasks().map(x=>x.id).sort();
const papers=org.getPapers().map(x=>x.id).sort();
const actualCounts={activities:activities.length,taxonomies:taxonomies.length,knowledgeNodes:knowledgeIds.length,courses:courses.length,courseNodes:courseNodeIds.length,learningTasks:tasks.length,papers:papers.length};
const actualHashes={activityIds:hash(activities),knowledgePointIds:hash(knowledgeIds),courseNodeIds:hash(courseNodeIds),learningTaskIds:hash(tasks),paperIds:hash(papers)};
assert(JSON.stringify(actualCounts)===JSON.stringify(manifest.counts),'核心数据数量发生变化');
assert(JSON.stringify(actualHashes)===JSON.stringify(manifest.idSetSha256),'稳定 ID 集合发生变化');
for(const [file,expected] of Object.entries(manifest.protectedFileSha256))assert(fileHash(file)===expected,`${file} 不应在布局维护版中变化`);
console.log('v861121-data-integrity-ok',actualCounts);
