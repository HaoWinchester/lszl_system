'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');

const html=read('question-workspace.html');
assert(html.includes('href="file-manager.html?type=workspace"'));
assert(!html.includes('id="qwArrangeSelect"'));
assert(!html.includes('id="qwCreateGroupBtn"'));
assert(!html.includes('id="qwConnectBtn"'));
assert(html.includes('data-qw-selection-action="align-menu"'));
assert(html.includes('data-qw-selection-action="group-menu"'));
assert(html.includes('data-qw-selection-action="connect"'));
assert(html.includes('data-qw-selection-action="delete"'));

const controller=read('src/77-multi-question-workspace.js');
assert(controller.includes('function connectorHandlesMarkup()'));
assert(controller.includes('function beginConnectorDrag(event)'));
assert(controller.includes('function moveConnectorDrag(event)'));
assert(controller.includes('function createQuickEdge(sourceId,targetId)'));
assert(controller.includes("label:''"));
assert(controller.includes('function deleteSelectedCards()'));
assert(controller.includes("event.key==='Delete'||event.key==='Backspace'"));
assert(controller.includes('function assignSelectionToGroup(groupId)'));
assert(controller.includes("data-qw-arrange"));

const store=read('src/65-canvas-workspace-store.js');
assert(store.includes("label:hasLabel?String(edge.label??''):''"));
assert(!store.includes("const defaultLabels={same:'同类'"));

const filebar=read('src/79-multi-question-workspace-filebar.js');
assert(filebar.includes("addEventListener('dblclick'"));
assert(filebar.includes("contentEditable='true'"));
assert(!filebar.includes("document.createElement('input')"));

const fm=read('file-manager.html'),fmjs=read('src/80-file-manager-workspace-library.js');
assert(fm.includes('data-fm-file-type="workspace"'));
assert(fm.includes('id="fmWorkspaceLibrary"'));
assert(fm.includes('src/65-canvas-workspace-store.js'));
assert(fm.includes('src/80-file-manager-workspace-library.js'));
assert(fmjs.includes("question-workspace.html?workspace="));
assert(fmjs.includes("data-workspace-action=\"duplicate\""));

const css=read('styles/question-workspace.css');
assert(css.includes('.qw-card-connector.is-top'));
assert(css.includes('.qw-card-connector.is-right'));
assert(css.includes('.qw-selection-toolbar-pro'));
assert(css.includes('.qw-align-grid'));
console.log('v862-p2214-canvas-interaction-upgrade-static-ok');
