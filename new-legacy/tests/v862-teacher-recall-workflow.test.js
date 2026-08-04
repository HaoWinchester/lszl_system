'use strict';
const fs=require('fs');const vm=require('vm');const path=require('path');
const ROOT=path.resolve(__dirname,'..');
function assert(condition,message){if(!condition)throw new Error(message)}
const storage=new Map();
global.localStorage={getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
global.KGAuthCore={currentUsername:()=> 'teacher-test'};
const library=require('../src/95-recall-association-library.js');
const sessions=new Map();global.sessionStorage={getItem:key=>sessions.has(key)?sessions.get(key):null,setItem:(key,value)=>sessions.set(key,String(value)),removeItem:key=>sessions.delete(key)};
global.location={href:'https://app.local/learning-path.html?stage=method',search:'?stage=method'};
const navigation=require('../src/94-practice-navigation.js');
const practiceHref=navigation.buildPracticeHref('knowledge-recall.html',{stageId:'method',partId:'environment',entryId:'deep'});
assert(practiceHref.includes('practice=1')&&practiceHref.includes('source=guided-learning')&&practiceHref.includes('return='),'自由练习链接必须携带返回上下文');
navigation.saveContext({stageId:'method',partId:'environment',returnUrl:'learning-path.html?stage=method&part=environment',scrollLeft:480});
assert(navigation.readContext().scrollLeft===480,'应保存学习路径滚动位置');

const parsed=library.parseText('关键干系人 -> 项目章程 | 识别干系人 | 开工大会 | 干系人参与计划 | 沟通管理计划\n项目章程 ➡️ 项目经理角色和职责 ➡️ 团队角色和职责');
assert(parsed.valid,'TXT 联想库应解析成功');
assert(parsed.library.nodes.length===8,'应解析 8 个去重知识点');
assert(parsed.library.edges.length===7,'应解析 7 条关系');
const saved=library.saveText('PMP','关键干系人 -> 项目章程 | 识别干系人 | 开工大会 | 干系人参与计划 | 沟通管理计划\n项目章程 -> 项目经理角色和职责',{mode:'replace'});
assert(saved.valid,'联想库应保存成功');
const first=library.choices(saved.library,'关键干系人',{limit:4,offset:0});
assert(first.choices.length===4&&first.hasMore,'五个分支每次只应显示四个，并允许换一组');
const second=library.choices(saved.library,'关键干系人',{limit:4,offset:first.nextOffset});
assert(second.choices.length===4,'换一组后仍应显示四个');
assert(second.choices.some(item=>!first.choices.some(old=>old.next===item.next)),'换一组应出现新的分支');
const stableBefore=library.resolve(saved.library,'项目章程').id;
const merged=library.saveText('PMP','项目章程 -> 项目的身份证 | 正式授权项目',{mode:'merge'});
assert(merged.valid&&library.resolve(merged.library,'项目章程').id===stableBefore,'合并时已有节点 ID 必须保持稳定');

storage.set('kg_exam_papers_published_v1',JSON.stringify([{
  releaseId:'release-shared',paperId:'paper-shared',name:'教师发布试卷',subject:'PMP',version:1,
  enabledModes:['deep_recall'],questions:[{bankId:'bank-shared',questionId:'q-shared',order:1}],
  questionSnapshots:[{bankId:'bank-shared',bankName:'教师题库',questionId:'q-shared',question:{id:'q-shared',title:'共享原题',stemParts:[{text:'关键干系人题干'}],options:[]}}]
}]));
global.KGAuthCore={currentUsername:()=> 'student-test'};
delete require.cache[require.resolve('../src/59-published-paper-repository.js')];
delete require.cache[require.resolve('../src/96-recall-question-source.js')];
global.KGPublishedPaperRepository=require('../src/59-published-paper-repository.js');
const questionSource=require('../src/96-recall-question-source.js');
assert(questionSource.list().some(paper=>paper.releaseId==='release-shared'&&paper.questions.some(question=>question.id==='q-shared')),'学员应能读取教师发布试卷的冻结题目');

const context={window:{},console,structuredClone:global.structuredClone};context.window=context;
vm.createContext(context);
for(const file of ['src/86-activity-schema-v1.js','src/87-guided-learning-data.js'])vm.runInContext(fs.readFileSync(path.join(ROOT,file),'utf8'),context,{filename:file});
const course=context.KGGuidedLearningData.getCourse();
assert(course.nodes.length===108,'原有 108 个课程节点必须保持不变');
assert(course.parts.length===9,'原有 9 个部分必须保持不变');
course.parts.forEach(part=>{
  assert(Array.isArray(part.practiceEntries)&&part.practiceEntries.length===2,`部分 ${part.id} 应包含两个自由练习入口`);
  assert(part.practiceEntries.some(entry=>entry.type==='deep_recall'),'应有完整版深度回忆入口');
  assert(part.practiceEntries.some(entry=>entry.type==='multi_question_canvas'),'应有完整版多题画布入口');
});
const activityTypes=new Set(Object.values(context.KGGuidedLearningData.getActivityLibrary()).map(activity=>activity.type));
assert(activityTypes.has('deep_recall')&&activityTypes.has('knowledge_graph')&&activityTypes.has('multi_question_induction'),'既有简化深度回忆、知识图谱和多题归纳活动必须保留');
console.log('v862-teacher-recall-workflow-ok',{nodes:course.nodes.length,parts:course.parts.length,practiceEntries:course.parts.reduce((n,p)=>n+p.practiceEntries.length,0),libraryNodes:merged.library.nodes.length,libraryEdges:merged.library.edges.length});
