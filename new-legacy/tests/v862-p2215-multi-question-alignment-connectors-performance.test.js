'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');

const html=read('question-workspace.html');
assert(html.includes('data-qw-selection-color="#ffffff"'));
assert(html.includes('<select id="qwSynthesisColor"><option value="#ffffff">白色</option>'));
assert(html.includes('<select id="qwGroupColor"><option value="#ffffff">白色</option>'));

const js=read('src/77-multi-question-workspace.js');
assert(js.includes("const CARD_COLORS=['#ffffff'"));
assert(js.includes("function suppressSelectionToolbarForMotion(kind='drag')"));
assert(js.includes("suppressSelectionToolbarForMotion('pan')"));
assert(js.includes("suppressSelectionToolbarForMotion('card-drag')"));
assert(js.includes("suppressSelectionToolbarForMotion('group-card-drag')"));
assert(js.includes("suppressSelectionToolbarForMotion('group-container-drag')"));
assert(js.includes('if(state.selectionToolbarSuppressed)'));
assert(js.includes('return false;'));

const css=read('styles/question-workspace.css');
assert(css.includes('v8.6.2 P2.2.15 — filebar alignment / white preset / drag performance / external connectors'));
assert(css.includes('.qw-overlay-left>.qw-tool-btn'));
assert(css.includes('.qw-overlay-left>.qw-workspace-filebar'));
assert(css.includes('[data-node-id].show-connectors .qw-card-connector'));
assert(css.includes('top:-18px!important'));
assert(css.includes('right:-18px!important'));
assert(css.includes('bottom:-18px!important'));
assert(css.includes('left:-18px!important'));
assert(css.includes('body.qw-selection-toolbar-motion .qw-selection-toolbar'));
assert(css.includes('body.qw-selection-toolbar-motion .qw-card-connector'));

console.log('v862-p2215-multi-question-alignment-connectors-performance-static-ok');
