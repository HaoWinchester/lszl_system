'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const navHrefs=['admin-console.html','admin-subjects.html','teacher-workbench.html','course-admin.html','user-management.html','feedback-management.html','message-management.html','admin-operations.html','admin-settings.html'];

assert(/^v9\.0-(?:p3\.3\.(?:3(?:\.\d+)?|4|5)|p3\.4|p3\.5(?:\.[12345678])?|p4\.0(?:\.[123])?|p4\.1(?:\.1)?)$/.test(read('VERSION').trim()));

const workbench=read('teacher-workbench.html');
assert(workbench.includes('styles/admin-context-nav.css'),'工作台缺少统一顶部导航样式');
assert(workbench.includes('class="teacher-admin-shell" data-admin-context="teacher"'),'工作台应挂载教师后台统一外壳并高亮教师工作台');
assert(workbench.includes('src/admin/48-admin-context-nav.js'),'工作台缺少顶部导航激活脚本');
const adminNav=workbench.match(/<nav class="admin-context-nav"[\s\S]*?<\/nav>/);
assert(adminNav,'工作台缺少管理后台顶部导航');
assert.equal((adminNav[0].match(/data-admin-nav=/g)||[]).length,9,'工作台顶部导航必须保持九项');
for(const href of navHrefs)assert(adminNav[0].includes(`href="${href}"`),`工作台顶部导航缺少 ${href}`);

function teacherTabs(html,file){
  const match=html.match(/<nav class="tw-tabs"[\s\S]*?<\/nav>/);
  assert(match,`${file} 缺少教师主导航`);
  return match[0];
}
for(const file of ['teacher-workbench.html','question-bank.html','paper-management.html']){
  const tabs=teacherTabs(read(file),file);
  assert.equal((tabs.match(/<a\b/g)||[]).length,4,`${file} 教师主导航应保持四项`);
  assert(!/>管理端<\/a>/.test(tabs),`${file} 教师主导航不应重复显示管理端入口`);
}

const css=read('styles/admin-context-nav.css');
assert(css.includes('body.teacher-admin-shell>.admin-context-nav{position:sticky;top:0;z-index:80}'),'教师工作流顶部导航必须固定在页面最上方');
assert(css.includes('body.teacher-admin-shell>.tw-topbar{top:42px}'),'工作台工具栏必须吸附在顶部导航下方');
const course=read('course-admin.html');
assert(!course.includes('<header class="tw-topbar">')&&!course.includes('<section class="tw-workflow"'),'课程与任务必须保持独立页面');
assert(!course.includes('data-config-panel="papers"'),'课程与任务不得继续嵌入旧试卷管理');
assert(!css.includes('.admin-context-nav + .admin-topbar{top:42px}'),'普通管理后台布局不应被教师工作流修复改写');
console.log('v90-p331-navigation-shell-fix-ok');
