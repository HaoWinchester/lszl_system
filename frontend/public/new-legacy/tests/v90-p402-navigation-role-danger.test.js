'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const practice=read('src/100-practice-mode.js');
const style=read('styles/practice-mode.css');
const shortcuts=read('src/39-global-shortcuts.js');
assert.match(read('VERSION').trim(),/^v9\.0-p4\.1\.\d+$/);
for(const file of ['index.html','question-workspace.html','knowledge-recall.html']){
  const source=read(file);
  assert(!source.includes("location.replace('practice-mode.html"),`${file} still redirects to practice`);
}
/* 知识巩固暂不开放：大厅入口以 hidden 保留（页面与直链仍可用），恢复开放时移除 hidden 即可。 */
assert(read('index.html').includes('<button hidden class="learning-entry-card entry-practice" data-destination="practice-mode.html" data-learning-entry-choice="知识巩固"'));
assert(read('practice-mode.html').includes('href="index.html">自由</a>'));
assert(shortcuts.includes('label:"多题画布"'));
assert(!shortcuts.includes('allowWhenNoAdmin:true'));
assert(shortcuts.includes('role === "guest" || role === "viewer" || role === "student"'));
assert(shortcuts.includes('item.id === "workspace" || item.id === "recall"'));
assert(practice.includes('function dangerStrength()'));
assert(practice.includes('Math.pow(urgency,1.18)'));
assert(practice.includes("dom.dangerVignette.style.opacity=(value*.94).toFixed(4)"));
assert(style.includes('transition:opacity .24s linear'));
assert(style.includes('.practice-danger-vignette::before'));
assert(style.includes('animation:practiceDangerBreath'));
console.log('v90-p402-navigation-role-danger-ok');
