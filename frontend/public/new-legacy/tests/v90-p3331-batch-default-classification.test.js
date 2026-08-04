'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');

const currentVersion=read('VERSION').trim();
assert(/^v9\.0-(?:p3\.3\.(?:3(?:\.\d+)?|4|5)|p3\.4|p3\.5(?:\.[12345678])?|p4\.0(?:\.[123])?|p4\.1(?:\.1)?)$/.test(currentVersion),`Unexpected P3.3 line version: ${currentVersion}`);
const html=read('question-bank.html');
for(const id of ['tqBatchDefaultEditBtn','tqBatchDefaultKnowledgeLabel','tqBatchDefaultTagsLabel','tqBatchClassificationDialog','tqBatchKnowledgeColumns','tqBatchTagOptionList']){
  assert(html.includes(`id="${id}"`),`缺少批量分类控件 ${id}`);
}
assert(html.includes('单题模板已填写的知识点或标签优先'),'批次默认优先级说明缺失');
const workflow=read('src/97-teacher-question-workflow.js');
for(const token of ['batchDefaults','resolveBatchClassification','item-override','batch-default','修改分类','恢复模板 / 批次规则'])assert(workflow.includes(token),`批量分类逻辑缺少 ${token}`);
assert(workflow.includes("tags:unique(resolution?.tags||result.tags||[])"),'批次有效标签没有写入正式题目');
assert(workflow.includes("!explicitKnowledge&&batchDefaults.knowledgeMode==='node'"),'单题模板知识点优先级没有落实');
assert(workflow.includes("!explicitTags&&batchDefaults.tags.length"),'单题模板标签优先级没有落实');

// 批量下载模板应保留可选分类字段，但默认不预填示例分类值。
global.QuestionStudioParser=require(path.resolve(ROOT,'question-studio/question-studio-parser.js'));
require(path.resolve(ROOT,'src/98-teacher-workflow-p2-services.js'));
const S=global.KGTeacherWorkflowP2;
const batch=S.parseQuestionBatch(S.TEMPLATE_TEXTS.batch);
assert.equal(batch.total,2);assert.equal(batch.validCount,2);
for(const item of batch.items){
  assert.equal(item.subject,'');assert.equal(item.knowledge,'');assert.deepEqual(item.tags,[]);
}
assert(S.TEMPLATE_TEXTS.batch.includes('【知识点】')&&S.TEMPLATE_TEXTS.batch.includes('【标签】'));
console.log('v90-p3331-batch-default-classification-ok');
