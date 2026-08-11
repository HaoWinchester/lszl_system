'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');

const index=read('index.html');
assert(index.includes('styles/home-interaction-modes-p4330.css'));
assert(index.includes('src/27-home-interaction-modes.js'));

const modes=read('src/27-home-interaction-modes.js');
for(const token of ['阅读模式','高效模式','专业模式','home-graph-canvasMinimapDock','dock.insertBefore(root,dock.firstChild)','mobileForced:isPhone()'])assert(modes.includes(token),token);
assert(/efficient:Object\.freeze\([\s\S]*?boxSelect:true,multiSelect:true/.test(modes),'efficient box/multi selection');
assert(/resolvedMode\(\)\{return isPhone\(\)\?MODES\.READING:preferredDesktopMode\}/.test(modes),'mobile forced reading');
assert(modes.includes("next===MODES.READING||next===MODES.EFFICIENT?true:readProfessionalFlow()"),'reading/efficient flow default');

const toolbar=read('src/19-home-toolbar-registry.js');
assert(toolbar.includes('MODE_TOOL_IDS'));
assert(toolbar.includes('setMode'));
assert(toolbar.includes('reading: new Set'));
assert(toolbar.includes('efficient: new Set'));

const editor=read('src/10-graph-editor.js');
for(const token of [
  "graphModeAllows('boxSelect')",
  "graphModeAllows('multiSelect')",
  "graphModeAllows('edgeMove')",
  "graphModeAllows('edgeAdvanced')",
  "graphModeAllows('connections')",
  'nodeGrowthHoverNodeId',
  'setNodeGrowthHoverNode(card.dataset.nodeId)',
  'window.KGGraphFlowMode',
  'window.KGGraphModeRuntime'
])assert(editor.includes(token),token);

const css=read('styles/home-interaction-modes-p4330.css');
assert(css.includes('body[data-graph-interaction-mode="reading"] .edge-hit'));
assert(css.includes('body[data-graph-interaction-mode="efficient"] .edge-control-layer'));
assert(css.includes('body.graph-phone-reading .graph-mode-switcher'));
console.log('v90-p4330-home-interaction-modes-ok');
