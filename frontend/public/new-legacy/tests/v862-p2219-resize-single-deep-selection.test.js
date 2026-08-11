'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');

const html=read('question-workspace.html');
assert(html.includes('styles/question-workspace-p2219.css'));

const css=read('styles/question-workspace-p2219.css');
assert(css.includes('.qw-card-width-resize::after'));
assert(css.includes('height:80px!important'));

const workspace=read('src/77-multi-question-workspace.js');
assert(!workspace.includes("singleDeepPendingNodeId:''"));
assert(!workspace.includes("qwOpenSingleDeepBtn"));
assert(!workspace.includes("new URL('question-training.html'"));
assert(!workspace.includes("preferredQuestionNodeForSingleDeep,"));
assert(!workspace.includes("captureSingleDeepTarget,"));

const navigator=read('src/66-question-navigator.js');
assert(navigator.includes("function findQuestion(questionId,bankId='',paperId='',releaseId='')"));
assert(navigator.includes("function switchToQuestion(questionId,bankId='',paperId='',releaseId='')"));
assert(navigator.includes('function applyIncomingQuestionTarget()'));
assert(navigator.includes("params.get('questionId')"));
assert(navigator.includes("params.get('paperId')"));
assert(navigator.includes("params.get('releaseId')"));
assert(navigator.includes('setTimeout(applyIncomingQuestionTarget,0)'));

console.log('v862-p2219-resize-single-deep-selection-static-ok');
