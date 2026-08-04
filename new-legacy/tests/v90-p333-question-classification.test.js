'use strict';
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');

assert(/^v9\.0-(?:p3\.3\.(?:3(?:\.\d+)?|4|5)|p3\.4|p3\.5(?:\.[12345678])?|p4\.0(?:\.[123])?|p4\.1(?:\.1)?)$/.test(read('VERSION').trim()));
assert(/VERSION='9\.0-(?:p3\.3\.(?:3(?:\.\d+)?|4|5)|p3\.4|p3\.5(?:\.[12345678])?|p4\.0(?:\.[123])?|p4\.1(?:\.1)?)'/.test(read('src/admin/00-admin-core.js')));

const html=read('question-bank.html');
assert(!html.includes('data-question-workspace="entry"'),'题目管理不应继续保留重复录入中心页签');
assert(!html.includes('id="questionEntryFrame"'),'题目管理不应继续嵌入旧录入中心');
assert(html.includes('id="qbClassificationBar"'),'题目内容页缺少顶部分类信息栏');
assert(html.includes('id="qbKnowledgePickerDialog"'),'缺少主要知识点悬浮选择器');
assert(html.includes('id="qbTagPickerDialog"'),'缺少层级标签悬浮选择器');
assert(html.includes('id="questionSubjectInput" disabled'),'所属科目应由当前题库决定');
assert(/id="questionTagsInput"[^>]*type="hidden"/.test(html),'旧标签文本框应隐藏并由层级标签选择器维护');
assert(html.includes('src/98-question-classification.js'),'题目分类控制器未加载');
assert(html.includes('src/91-learning-content-core.js'),'题目管理未加载当前知识树数据服务');
assert(html.indexOf('id="qbClassificationBar"')<html.indexOf('id="questionTeacherNumber"'),'分类信息栏必须位于题目基本信息顶部');

const studio=read('question-studio/index.html');
assert(studio.includes("question-bank.html?mode=simple&step=questions&view=content&entry=paste"),'旧录入地址没有归入唯一题目内容入口');
assert(studio.includes('旧学习活动设计器（兼容）'),'旧活动设计器应明确降级为兼容入口');
assert(read('teacher-workbench.html').includes('新建考试题目'),'工作台应指向唯一正式录题入口');

const service=read('src/98-teacher-workflow-p2-services.js');
for(const field of ['【科目】','【知识点】','【标签】'])assert(service.includes(field),`录题模板缺少 ${field}`);
const workflow=read('src/97-teacher-question-workflow.js');
assert(workflow.includes('Classification.resolveTemplate'),'模板解析没有接入知识点识别');
assert(workflow.includes('knowledgeMetadataFromResolution'),'解析结果没有写入正式题目知识归属');

const memory=new Map();
const localStorage={getItem:k=>memory.has(k)?memory.get(k):null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k),clear:()=>memory.clear(),key:i=>[...memory.keys()][i]||null,get length(){return memory.size}};
const document={readyState:'loading',addEventListener(){},getElementById(){return null}};
const window={localStorage,crypto:{randomUUID:()=>Math.random().toString(36).slice(2)},document};window.window=window;
const context={window,document,globalThis:window,console,Date,Math,JSON,Set,Map,Object,Array,String,Number,Boolean,Error,TypeError,URL,URLSearchParams,CustomEvent:function(){}};vm.createContext(context);
const load=file=>vm.runInContext(read(file),context,{filename:file});
load('src/91-learning-content-core.js');
load('src/98-question-classification.js');
const C=window.KGQuestionClassification;
let resolved=C.resolveTemplate({subject:'PMP',knowledge:'PMP/敏捷方法',tags:['阶段测试','核心题']},'PMP');
assert.equal(resolved.matchStatus,'matched');
assert.equal(resolved.primaryNodeId,'kp-pmp-agile');
assert.equal(resolved.mappingStatus,'confirmed');
assert.deepEqual(Array.from(resolved.tags),['阶段测试','核心题']);
resolved=C.resolveTemplate({subject:'ACP',knowledge:'PMP/敏捷方法'},'PMP');
assert.equal(resolved.subjectStatus,'mismatch');
assert(resolved.warnings.some(item=>item.includes('题库科目不一致')));
resolved=C.resolveTemplate({subject:'PMP',knowledge:'不存在的知识点'},'PMP');
assert.equal(resolved.mappingStatus,'unmapped');
assert.equal(resolved.matchStatus,'unmatched');

memory.set('kg_question_banks_v1__public',JSON.stringify([{id:'bank-1',name:'PMP 正式题库',subject:'PMP',questions:[{id:'q-1',title:'敏捷题',metadata:{knowledge:{taxonomyId:'taxonomy-pmp-main',taxonomyVersion:1,primaryNodeId:'kp-pmp-agile',mappingStatus:'confirmed'}}}]}]));
load('src/admin/00-admin-core.js');
load('src/admin/30-reference-index-service.js');
const refs=new window.KGReferenceIndexService({content:window.KGLearningContent});
const nodeRefs=refs.referencesForNode('kp-pmp-agile');
assert(nodeRefs.some(item=>item.kind==='question'&&item.questionId==='q-1'),'正式题目知识点引用没有进入安全删除索引');
const subjectUsage=refs.subjectUsage('subject-pmp');
assert.equal(subjectUsage.counts.question_bank,1);
assert.equal(subjectUsage.counts.question,1);
console.log('v90-p333-question-classification-ok');
