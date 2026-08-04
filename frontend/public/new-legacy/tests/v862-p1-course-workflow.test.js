'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const text=file=>fs.readFileSync(path.join(root,file),'utf8');
function assert(condition,message){if(!condition)throw new Error(message)}

const html=text('course-admin.html');
const app=text('src/91-course-admin-app.js');
const css=text('styles/teacher-course-workflow.css');
const questionWorkflow=text('src/97-teacher-question-workflow.js');

['caStageSelector','caStructureSearch','caStructureFilter','caJumpIncompleteBtn','caJumpIssueBtn','caOpenChapterPreviewBtn','caChapterPreviewDialog'].forEach(id=>assert(html.includes(`id="${id}"`),`P1 控件缺失：${id}`));
assert(app.includes("kg_course_admin_workspace_v862_p1"),'课程编辑位置持久化键缺失');
assert(app.includes('function renderSearchResults'),'全课程搜索定位逻辑缺失');
assert(app.includes('function jumpByStatus'),'待配置/问题跳转逻辑缺失');
assert(app.includes('function renderChapterDialog'),'独立章节预览逻辑缺失');
assert(app.includes('const current=ensureCurrentStage()'),'结构树应按当前阶段渲染');
assert(css.includes('v8.6.2 P1'),'P1 样式标记缺失');
assert(css.includes('.ca-structure-search-results'),'搜索结果样式缺失');
assert(questionWorkflow.includes('admin-subjects.html'),'训练配置页应提供知识树管理入口');
console.log('v862-p1-course-workflow-ok',{stageSelector:true,search:true,statusJump:true,chapterPreview:true,workspaceRestore:true});
