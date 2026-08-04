'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const text=file=>fs.readFileSync(path.join(root,file),'utf8');
function assert(condition,message){if(!condition)throw new Error(message)}

const workbench=text('teacher-workbench.html');
assert((workbench.match(/data-workflow-card=/g)||[]).length===3,'教师工作台应只有三个主要任务');
assert(workbench.includes('管理题目')&&workbench.includes('配置训练')&&workbench.includes('管理试卷'),'三步工作流文案缺失');
assert(!workbench.includes('录入活动'),'教师首页不应继续暴露旧“录入活动”流程');
assert(workbench.includes('高级工具与兼容入口'),'高级工具应默认收纳');

const question=text('question-bank.html');
assert(question.includes('styles/teacher-question-workflow.css'),'题目工作流样式未接入');
assert(question.includes('src/97-teacher-question-workflow.js'),'题目工作流控制器未接入');
assert(question.includes('data-tq-step="questions"')&&question.includes('data-tq-step="training"'),'题目与训练步骤入口缺失');

const course=text('course-admin.html');
assert(course.includes('caSimpleGuide'),'课程五步引导缺失');
assert(!course.includes('class="tw-topbar"')&&!course.includes('class="tw-workflow"'),'课程与任务应脱离教师工作台三步外壳');
assert(course.includes('<h1>课程与任务</h1>')&&course.includes('data-config-view="courses"')&&course.includes('data-config-view="tasks"'),'课程与任务独立页面结构不完整');
assert(course.includes('styles/teacher-course-workflow.css')&&course.includes('src/97-teacher-course-workflow.js'),'课程简化模式资源未接入');

const pathApp=text('src/89-guided-learning-app.js');
assert(pathApp.includes('gl-practice-image'),'自由练习入口应直接渲染图片');
assert(!pathApp.includes('gl-practice-copy'),'自由练习入口不应渲染文字信息块');
const pathCss=text('styles/guided-learning-path.css');
assert(pathCss.includes('background:transparent')&&pathCss.includes('box-shadow:none'),'自由练习入口应取消背景框和卡片阴影');

console.log('v862-teacher-workflow-ok',{mainTasks:3,courseSteps:5,imageOnlyPracticeEntry:true});
