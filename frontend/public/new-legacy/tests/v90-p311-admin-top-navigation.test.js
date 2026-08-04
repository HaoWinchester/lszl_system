
'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const pages=['admin-console.html','admin-subjects.html','admin-operations.html','admin-settings.html','teacher-workbench.html','question-bank.html','paper-management.html','course-admin.html','user-management.html','feedback-management.html','message-management.html','system-settings.html'];
const hrefs=['admin-console.html','admin-subjects.html','teacher-workbench.html','course-admin.html','user-management.html','feedback-management.html','message-management.html','admin-operations.html','admin-settings.html'];
for(const page of pages){
  const html=read(page);
  const nav=html.match(/<nav class="admin-context-nav"[\s\S]*?<\/nav>/);
  assert(nav,`${page}: top nav missing`);
  assert.equal((nav[0].match(/data-admin-nav=/g)||[]).length,9,`${page}: wrong nav link count`);
  for(const href of hrefs)assert(nav[0].includes(`href="${href}"`),`${page}: missing ${href}`);
  assert(!nav[0].includes('>管理后台</a>'),`${page}: duplicate management-home link remains`);
}
for(const page of pages.slice(0,4)){
  const html=read(page);
  assert(!html.includes('class="admin-sidebar"'),`${page}: left primary navigation remains`);
  assert(html.indexOf('class="admin-context-nav"')<html.indexOf('class="admin-topbar"'),`${page}: top nav order changed`);
}
const css=read('styles/admin-console.css');
assert(css.includes('.admin-app-shell{display:block'), 'admin shell must use full-width block layout');
assert(css.includes('.admin-sidebar{display:none!important}'), 'legacy primary sidebar must stay hidden');
console.log('v90-p311-admin-top-navigation-ok');
