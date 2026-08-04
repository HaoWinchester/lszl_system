'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');const text=file=>fs.readFileSync(path.join(root,file),'utf8');
function assert(condition,message){if(!condition)throw new Error(message)}
const qhtml=text('question-bank.html'),chtml=text('course-admin.html'),qapp=text('src/97-teacher-question-workflow.js'),capp=text('src/91-course-admin-app.js'),service=text('src/98-teacher-workflow-p2-services.js'),qcss=text('styles/teacher-question-workflow.css'),ccss=text('styles/teacher-course-workflow.css');
['tqPasteModeHint','tqBatchOptions','tqImportValidOnly','tqSkipDuplicates'].forEach(id=>assert(qhtml.includes(`id="${id}"`),`批量录题控件缺失：${id}`));
['caBatchToolsBtn','caRecentBtn','caValidationBtn','caBatchToolsDialog','caRecentDialog','caValidationDialog','caOutlineInput'].forEach(id=>assert(chtml.includes(`id="${id}"`),`课程 P2 控件缺失：${id}`));
assert(service.includes('parseQuestionBatch'),'多题解析服务缺失');assert(service.includes('parseCourseOutline'),'课程大纲解析服务缺失');assert(service.includes('COURSE_TEMPLATES'),'学习模板定义缺失');
assert(qapp.includes('applyBatchQuestions'),'批量题目写入流程缺失');assert(capp.includes('function applyTemplate'),'批量套用模板逻辑缺失');assert(capp.includes('function cloneCurrentStructure'),'批量复制结构逻辑缺失');assert(capp.includes('function renderRecent'),'最近编辑逻辑缺失');assert(capp.includes('function renderValidationDialog'),'课程检查面板逻辑缺失');
assert(qcss.includes('v8.6.2 P2')&&ccss.includes('v8.6.2 P2'),'P2 样式标记缺失');
console.log('v862-p2-teacher-efficiency-ok',{batchQuestions:true,templates:true,copy:true,outline:true,recent:true,validation:true});
