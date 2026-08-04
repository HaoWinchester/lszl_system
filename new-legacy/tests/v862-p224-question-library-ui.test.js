"use strict";
const fs=require('fs'),path=require('path'),assert=require('assert');const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const kr=read('knowledge-recall.html'),qw=read('question-workspace.html'),qt=read('question-training.html'),pages=[kr,qw,qt];
assert(kr.includes('id="krCloseQuestionDrawerBtn"'));assert(qw.includes('id="qwQuestionDrawerClose"'));assert(qt.includes('id="qtQuestionDrawerClose"'));
pages.forEach(html=>{assert(html.includes('lp-question-library-close'));assert(html.includes('data-question-language="zh" aria-pressed="true">中</button>'));assert(html.includes('data-question-language="bilingual" aria-pressed="false">中英</button>'));assert(!html.includes('>中文</button>'));assert(!html.includes('>中英对照</button>'));assert(!html.includes('英文仅供对照'));});
assert(!qw.includes('英文仅作为中文题目的对照展示'));
assert(read('src/86-knowledge-recall.js').includes("$('krCloseQuestionDrawerBtn')?.addEventListener('click'"));assert(read('src/77-multi-question-workspace.js').includes("byId('qwQuestionDrawerClose')?.addEventListener('click',closeQuestionDrawer)"));assert(read('src/66-question-navigator.js').includes("byId('qtQuestionDrawerClose')?.addEventListener('click',close)"));
const css=read('styles/learning-practice-shell.css');assert(css.includes('v8.6.2 P2.2.4 — close control and unified left slide animation'));assert(css.includes('transition:transform .18s ease,visibility 0s linear .18s!important'));console.log('v862-p224-question-library-ui-static-ok');
