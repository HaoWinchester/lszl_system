'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');

const js=read('src/39-global-shortcuts.js');
assert(js.includes('id:"workspace", label:"多题画布", href:"question-workspace.html"'));
assert(!js.includes('label:"考题训练", href:"question-training.html"'));
assert(js.includes('workspace: \'<svg'));
assert(js.includes('icon:ICONS.workspace'));

const css=read('styles/global-shortcuts.css');
assert(css.includes('v8.6.2 P2.2.10 — compact icon-only global shortcut bar'));
assert(css.includes('.kg-global-shortcuts-link span{display:none!important}'));
assert(css.includes('width:54px!important'));assert(css.includes('box-sizing:border-box!important'));
assert(css.includes('.kg-global-shortcuts-link.workspace'));
console.log('v862-p2210-compact-global-shortcuts-static-ok');
