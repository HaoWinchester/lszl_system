'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');

const html=read('question-workspace.html');
assert(html.includes('styles/question-workspace-p2218.css'));
assert(!html.includes('id="qwOpenSingleDeepBtn"'));
assert(html.includes('data-qw-selection-action="tidy"'));
assert(!html.includes('id="qwRepairBoundsBtn"'));
assert(html.includes('title="检查重叠、异常尺寸与分组布局"'));

const controller=read('src/77-multi-question-workspace.js');
assert(controller.includes('function tidySelectedCards()'));
assert(controller.includes("persistLayoutSnapshot(proposed,'local-tidy-selection')"));
assert(controller.includes("pushLayoutHistory('局部整理'"));
assert(controller.includes("if(action==='tidy')"));
assert(!controller.includes('function openSingleDeepStudy()'));
assert(!controller.includes("new URL('question-training.html'"));
const diagnose=controller.slice(controller.indexOf('function runLayoutDiagnosis'),controller.indexOf('function scheduleLayoutDiagnosis'));
assert(diagnose.includes('const outOfBounds=[],oversized=[]'));
assert(!diagnose.includes('isMeaningfullyOutsideWorld('));
assert(!diagnose.includes("'卡片超出画布'"));

const filebar=read('src/79-multi-question-workspace-filebar.js');
assert(filebar.includes('function positionSearchPanel()'));
assert(filebar.includes('viewportWidth-width-margin'));
assert(filebar.includes('viewportHeight-measured.height-margin'));

const css=read('styles/question-workspace-p2218.css');
assert(css.includes('#qwWorkspaceGlobalSearchPanel'));
assert(css.includes('position:fixed!important'));
assert(css.includes('#qwQuestionDrawer.lp-question-library-compact'));
assert(css.includes('width:min(360px,calc(100vw - 8px))!important'));
assert(css.includes('top:var(--lp-shell-height,64px)!important'));
assert(!css.includes('#qwOpenSingleDeepBtn'));

console.log('v862-p2218-multi-question-refinements-static-ok');
