'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('question-training.html');
assert(html.includes('id="qtQuestionResetBtn"'));
assert(html.includes('class="qt-question-reset-btn"'));
assert(html.indexOf('id="qtFontScaleBtn"') < html.indexOf('id="qtQuestionResetBtn"'));
assert(html.indexOf('id="qtQuestionResetBtn"') < html.indexOf('id="qtCanvasFocusBtn"'));

const canvas=read('src/74-infinite-learning-canvas.js');
assert(canvas.includes("byId('qtQuestionResetBtn')?.addEventListener('click'"));
assert(canvas.includes("if(typeof resetQuestionTrainer==='function')resetQuestionTrainer()"));
assert(canvas.includes("if(state.completed)return 'done'"));

const css=read('styles/learning-practice-shell.css');
assert(css.includes('v8.6.2 P2.2.9 — current-question reset + strong completed-card header'));
assert(css.includes('.qt-canvas-card.done .qt-canvas-card-header'));
assert(css.includes('background:#16a34a!important'));
assert(css.includes('.qt-canvas-card.done .qt-canvas-card-status::before'));
console.log('v862-p229-question-reset-completed-header-static-ok');
