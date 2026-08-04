'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');

const html=read('question-workspace.html');
assert(html.includes('styles/account-menu.css'));
assert(html.includes('src/41-account-menu.js'));
assert(html.includes('id="accountMenuShell"'));
assert(html.includes('id="accountMenuSessionBtn"'));
assert(html.includes('id="authLogoutBtn"'));
assert(html.includes('class="account-hidden-trigger"'));
assert(!html.includes('<button class="auth-logout-btn"'));
assert(html.includes('id="qwCanvasSummaryDock"'));
assert(html.indexOf('id="qwCanvasSummaryDock"')>html.indexOf('<main class="qw-canvas-shell"'));
const topActions=(html.match(/<div class="qw-top-actions[\s\S]*?<\/header>/)||[])[0]||'';
assert(!topActions.includes('id="qwNodeCount"'));

const alignBlock=(html.match(/<div class="qw-align-grid">([\s\S]*?)<\/div>/)||[])[1]||'';
assert((alignBlock.match(/data-qw-arrange=/g)||[]).length===8);
assert((alignBlock.match(/<svg /g)||[]).length===8);
['align-left','align-center','align-right','distribute-x','align-top','align-middle','align-bottom','distribute-y'].forEach(key=>assert(alignBlock.includes(`data-qw-arrange="${key}"`)));

const js=read('src/77-multi-question-workspace.js');
assert(js.includes('const live=liveCardLayout(record)'));
assert(js.includes('function diagnosisWorldBounds()'));
assert(js.includes('function isMeaningfullyOutsideWorld(rect,bounds=diagnosisWorldBounds())'));
assert(js.includes("tutorialTrigger.dataset.accountMenuBoundHelp='1'")&&js.includes("tutorialTrigger.addEventListener('click',()=>byId('qwHelpBtn')?.click())"));

const css=read('styles/question-workspace.css');
assert(css.includes('.qw-canvas-summary-dock'));
assert(css.includes('.qw-align-grid button svg'));
assert(css.includes('.qw-top-actions .account-menu-trigger'));
console.log('v862-p2216-multi-question-ui-diagnosis-account-static-ok');
