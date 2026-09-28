'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const pages=['teacher-workbench.html','question-bank.html','paper-management.html'];
test('daily pages share one opt-in shell, preserve navigation and load it after business scripts',()=>{
  for(const page of pages){
    const html=read(page);
    assert.match(html,/data-teacher-daily="true"/);
    assert.equal((html.match(/src="src\/teacher\/shared\/workspace-shell.js"/g)||[]).length,1);
    assert.match(html,/styles\/teacher-daily-workspace.css/);
    assert.equal((html.match(/data-admin-nav=/g)||[]).length,9);
    for(const href of ['teacher-workbench.html','step=questions','step=training','paper-management.html'])assert.ok(html.includes(href));
    const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(ids).size,ids.length,`${page}: duplicate IDs`);
    assert.ok(html.lastIndexOf('src/teacher/shared/workspace-shell.js')>html.lastIndexOf('src/admin/48-admin-context-nav.js'));
  }
});
test('paper primary actions stay direct while all secondary business actions remain reachable',()=>{
  const html=read('paper-management.html');
  const more=html.match(/<details class="tw-more-actions">([\s\S]*?)<\/details>/)[1];
  for(const id of ['qbAddPaperBtn','qbSavePaperBtn','qbPublishPaperBtn']){
    assert.ok(html.includes(`id="${id}"`));assert.ok(!more.includes(`id="${id}"`));
  }
  for(const id of ['qbImportBankBtn','qbImportPaperBtn','qbComposePapersBtn','qbBuildPaperBtn','qbWithdrawPaperBtn','qbArchivePaperBtn','qbUnarchivePaperBtn','qbDeletePaperBtn'])assert.ok(more.includes(`id="${id}"`));
});
test('loading metrics are not fabricated zeroes and help is collapsed by default',()=>{
  const html=read('teacher-workbench.html');
  for(const id of ['wbQuestionCount','wbTrainingPendingCount','wbPaperDraftCount','wbPublishedPaperCount'])assert.ok(html.includes(`id="${id}">—`));
  assert.match(html,/<details class="wb-section wb-help-section">/);
  assert.match(html,/id="wbNextDescription" role="status" aria-live="polite"/);
});
test('analytics navigation is created only for admins and removed after role changes',()=>{
  const vm=require('node:vm');
  const events=new Map();
  let user={role:'teacher'};
  const links=[];
  const nav={querySelector:()=>links[0]||null,append:link=>links.push(link)};
  const document={
    readyState:'complete',body:{dataset:{teacherDaily:'true'},classList:{add(){}}},
    querySelector:selector=>selector==='.admin-context-nav'?nav:null,
    querySelectorAll:()=>[],addEventListener(){},
    createElement:()=>({dataset:{},remove(){links.splice(links.indexOf(this),1)}}),
  };
  vm.runInNewContext(read('src/teacher/shared/workspace-shell.js'),{document,window:{
    KGAuthCore:{currentUser:()=>user},addEventListener:(event,fn)=>events.set(event,fn),
  }});
  assert.equal(links.length,0,'teacher must not receive analysis link');
  user={role:'admin'};events.get('kg-auth-session-change')();
  assert.equal(links[0].href,'system-settings.html?tab=analytics');
  assert.equal(links[0].textContent,'学员使用分析');
  events.get('kg-auth-session-change')();assert.equal(links.length,1,'no duplicate link');
  user={role:'teacher'};events.get('kg-auth-session-change')();assert.equal(links.length,0);
  user=null;events.get('kg-auth-session-change')();assert.equal(links.length,0);
});
