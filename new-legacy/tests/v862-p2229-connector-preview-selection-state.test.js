'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');

const graph=read('src/10-graph-editor.js');
assert(graph.includes('const NODE_GROWTH_PREVIEW_DELAY=280'));
assert(graph.includes('function scheduleNodeGrowthPreview(dir,handle)'));
assert(graph.includes('function cancelNodeGrowthPreviewDelay()'));
assert(graph.includes("hideNodeGrowthPreview({render:false})"));
assert(graph.includes("removeNodeGrowthPreviewElements()"));
assert(graph.includes("pointerenter',()=>{if(!isNodeGrowthConnectDragActive())scheduleNodeGrowthPreview"));

const workspaceCss=read('styles/question-workspace.css');
assert(workspaceCss.includes('.qw-question-card:hover:not(.is-selected):not(.is-dragging)'));
assert(workspaceCss.includes('outline:2px solid #ef4444'));

console.log('v862-p2229-connector-preview-selection-state-static-ok');
