'use strict';
const fs=require('fs');
const path=require('path');
const assert=require('assert');
const ROOT=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

assert(/^v9\.0-(?:p3\.3\.(?:3(?:\.\d+)?|4|5)|p3\.4|p3\.5(?:\.[12345678])?|p4\.0(?:\.[123])?|p4\.1(?:\.1)?)$/.test(read('VERSION').trim()));
const graphCss=read('styles/main.css');
const workspaceCss=read('styles/question-workspace.css');
assert(/\.edge-hit\{[^}]*stroke-width:28[^}]*vector-effect:non-scaling-stroke/.test(graphCss),'graph edge hit area must use non-scaling stroke');
assert(/\.qw-edge-layer \.qw-edge-hit\{[^}]*stroke-width:18[^}]*vector-effect:non-scaling-stroke/.test(workspaceCss),'workspace edge hit area must use non-scaling stroke');
assert(read('src/10-graph-editor.js').includes('deleteGraphBatchSelection'),'P2.2.37 graph batch deletion must remain');
assert(read('src/77-multi-question-workspace.js').includes('deleteWorkspaceBatchSelection'),'P2.2.37 workspace batch deletion must remain');
console.log('v862-p2238-legacy-freeze-ok');
