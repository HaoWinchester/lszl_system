'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');

const html=read('question-workspace.html');
assert(!html.includes('id="qwWorkspaceSelect"'));
assert(html.includes('id="qwWorkspaceTabbar"'));
assert(html.includes('id="qwWorkspaceTabs"'));
assert(html.includes('id="qwWorkspaceListBtn"'));assert(html.includes('href="file-manager.html?type=workspace"'));
assert(html.includes('id="qwCreateWorkspaceBtn"'));
assert(!html.includes('id="qwWorkspaceActionsMenu"'));
assert(html.includes('src/78-multi-question-workspace-tabs.js'));

const tabs=read('src/78-multi-question-workspace-tabs.js');
assert(tabs.includes("CLOSED_KEY='kg_multi_workspace_closed_tabs_v1__'"));
assert(tabs.includes("tab.classList.add('is-dragging')"));
assert(tabs.includes('function closeWorkspace(id)'));
assert(tabs.includes('function reorderVisible(dragId,targetId,side)'));

const store=read('src/65-canvas-workspace-store.js');
assert(store.includes('function reorderWorkspaces(workspaceIds=[],options={})'));
assert(store.includes('reorderWorkspaces,'));
assert(!store.includes(".sort((a,b)=>Number(b.updatedAt)-Number(a.updatedAt))"));

const controller=read('src/77-multi-question-workspace.js');
assert(controller.includes('global.KGMultiQuestionWorkspaceTabs?.render?.'));
assert(controller.includes('onReorder:ids=>store()?.reorderWorkspaces?.(ids)'));

const css=read('styles/question-workspace.css');
assert(css.includes('v8.6.2 P2.2.12 — Knowledge-Graph-style multi-question workspace tabs'));
assert(css.includes('.qw-workspace-tab.is-active::after'));
assert(css.includes('.qw-workspace-tab-close'));
console.log('v862-p2212-workspace-tabs-static-ok');
