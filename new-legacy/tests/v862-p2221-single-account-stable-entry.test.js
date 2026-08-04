'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');

const html=read('question-training.html');
assert(html.includes('styles/account-menu.css'));
assert(html.includes('styles/question-training-p2221.css'));
assert(html.includes('src/41-account-menu.js'));
assert(html.includes('id="accountMenuShell"'));
assert(html.includes('id="accountMenuSessionBtn"'));
assert(html.includes('class="account-hidden-trigger" hidden id="authLogoutBtn"'));
assert(!html.includes('<button class="auth-logout-btn"'));
assert(html.includes("document.documentElement.classList.add('qt-canvas-initial-pending')"));

const canvas=read('src/74-infinite-learning-canvas.js');
assert(canvas.includes('function scheduleFirstCardEntryFocus('));
assert(canvas.includes("focusStep(1,{instant:true,persist:false,highlight:false"));
assert(canvas.includes("restoreFromSession(event.detail?.session,{restoreViewport:false})"));
assert(canvas.includes("scheduleFirstCardEntryFocus('learning-session-changed')"));
assert(canvas.includes("scheduleFirstCardEntryFocus('learning-session-reset')"));
assert(canvas.includes("scheduleFirstCardEntryFocus('question-changed')"));
assert(canvas.includes("applyResponsiveMode(true,{focus:false})"));
assert(canvas.includes("restoreFromSession(undefined,{restoreViewport:false})"));
assert(canvas.includes("scheduleFirstCardEntryFocus('initial-entry',{delay:0})"));
assert(canvas.includes("document.documentElement?.classList?.remove?.('qt-canvas-initial-pending')"));
assert(canvas.includes("!state.entryFocusPending&&!document.body.classList.contains('qt-question-switching')"));

const handlers=canvas.slice(canvas.indexOf("kg:learning-session-changed"),canvas.indexOf("function init()"));
assert(!handlers.includes("focusStep(state.step"),'question/session change handlers must not jump to saved current step');

const css=read('styles/question-training-p2221.css');
assert(css.includes('.qt-topbar .account-menu-trigger'));
assert(css.includes('html.qt-canvas-initial-pending'));
assert(css.includes('.qt-canvas-entry-focusing #qtCanvasWorld'));
assert(css.includes('@keyframes qt-canvas-step1-reveal'));

console.log('v862-p2221-single-account-stable-entry-static-ok');
