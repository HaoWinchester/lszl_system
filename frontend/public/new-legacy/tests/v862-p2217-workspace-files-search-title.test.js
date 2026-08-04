'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');

const html=read('question-workspace.html');
assert(!html.includes('id="qwWorkspaceActionsMenu"'));
assert(!html.includes('id="qwRenameWorkspaceBtn"'));
assert(!html.includes('id="qwDeleteWorkspaceBtn"'));
assert(html.includes('id="qwWorkspaceGlobalSearchBtn"'));
assert(html.includes('id="qwWorkspaceGlobalSearchPanel"'));
assert(html.includes('id="qwWorkspaceGlobalSearchInput"'));
assert(html.includes('id="qwWorkspaceGlobalSearchResults"'));

const filebar=read('src/79-multi-question-workspace-filebar.js');
assert(filebar.includes('function shortTitle(value,limit=12)'));
assert(filebar.includes('function searchableNodes()'));
assert(filebar.includes('function openSearch()'));
assert(filebar.includes('slice(0,40)'));
assert(filebar.includes('KGMultiQuestionWorkspace?.focusNode?.'));
assert(filebar.includes('chip.textContent=shortTitle(title,12)'));

const store=read('src/65-canvas-workspace-store.js');
assert(store.includes('global.KGAuthCore?.currentUsername?.()'));
assert(store.includes("if(username&&String(username)!=='guest')"));

const css=read('styles/question-workspace.css');
assert(css.includes('v8.6.2 P2.2.17 — compact filename + global canvas search'));
assert(css.includes('max-width:12em!important'));
assert(css.includes('.qw-workspace-global-search-btn'));
assert(css.includes('.qw-workspace-global-search-panel'));

console.log('v862-p2217-workspace-files-search-title-static-ok');
