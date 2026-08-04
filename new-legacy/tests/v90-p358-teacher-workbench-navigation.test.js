'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');

assert.equal(read('VERSION').trim(),'v9.0-p4.1.1');
assert(read('src/admin/00-admin-core.js').includes("VERSION='9.0-p4.1.1'"));

const adminPages=['admin-console.html','admin-subjects.html','teacher-workbench.html','question-bank.html','paper-management.html','course-admin.html','user-management.html','feedback-management.html','message-management.html','admin-operations.html','admin-settings.html','system-settings.html'];
for(const file of adminPages){
  const html=read(file);
  assert.equal((html.match(/data-admin-nav=/g)||[]).length,9,`${file} primary nav count`);
  assert(html.includes('data-admin-nav="teacher" href="teacher-workbench.html">教师工作台</a>'),`${file} teacher entry`);
  assert(!html.includes('data-admin-nav="questions"'),`${file} legacy question primary entry`);
  assert(!html.includes('data-admin-nav="papers"'),`${file} legacy paper primary entry`);
}

const workbench=read('teacher-workbench.html');
assert(workbench.includes('data-admin-context="teacher"'));
assert.equal((workbench.match(/data-workflow-card=/g)||[]).length,3);
assert(workbench.includes('data-workflow-card="papers"'));
assert(workbench.includes('<b>3</b><strong>管理试卷</strong>'));
assert(workbench.includes('href="paper-management.html">试卷管理</a>'));
assert(!workbench.includes('data-workflow-card="courses"'));
assert(!workbench.includes('>课程设置</a>'));
assert(workbench.includes('id="wbPaperDraftCount"')&&workbench.includes('id="wbPublishedPaperCount"'));

const question=read('question-bank.html');
assert(question.includes('data-admin-context="teacher"'));
assert(question.includes('<a href="paper-management.html">试卷管理</a>'));
assert(question.includes('<b>3</b>管理试卷'));
assert(!question.includes('<b>3</b>设置课程'));

const paper=read('paper-management.html');
assert(paper.includes('data-admin-context="teacher"'));
assert(paper.includes('<header class="tw-topbar pm-shell-topbar">'));
assert(paper.includes('<a class="active" href="paper-management.html">试卷管理</a>'));
assert(paper.includes('<a class="tw-step active" href="paper-management.html"><b>3</b>管理试卷</a>'));

const course=read('course-admin.html');
assert(course.includes('<h1>课程与任务</h1>'));
assert(!course.includes('<header class="tw-topbar">'));
assert(!course.includes('<section class="tw-workflow"'));
assert(!course.includes('data-config-view="papers"'));
assert(!course.includes('data-config-panel="papers"'));
assert(course.includes('data-config-view="courses"')&&course.includes('data-config-view="tasks"'));

const workbenchApp=read('src/91-teacher-workbench-app.js');
assert(workbenchApp.includes("kg_exam_papers_v1__"));
assert(workbenchApp.includes("wbPaperDraftCount"));
assert(workbenchApp.includes("wbPublishedPaperCount"));
assert(workbenchApp.includes("paper-management.html"));
assert(!workbenchApp.includes('getCourseDrafts()'));
assert(read('src/97-teacher-question-workflow.js').includes('下一步：试卷管理'));
assert(read('src/39-global-shortcuts.js').includes('label:"教师工作台", href:"teacher-workbench.html"'));

console.log('v90-p358-teacher-workbench-navigation-static-ok');
