const fs=require('fs');
function assert(cond,msg){if(!cond)throw new Error(msg)}
const kr=fs.readFileSync('src/86-knowledge-recall.js','utf8');

assert(kr.includes('function resolveAssociationNode(value)'), 'manual association resolver missing');
assert(kr.includes('const resolved=resolveAssociationNode(normalized);'), 'manual input must resolve published association library');
assert(kr.includes("createChildFromChoice(parent,{text:resolved.title,next:resolved.id},choiceIndex)"), 'resolved manual input must reuse system choice flow');

assert(kr.includes('function ancestorDataIdSet(node)'), 'ancestor filter helper missing');
assert(kr.includes('const blocked=ancestorDataIdSet(node),seen=new Set();'), 'guide choices must filter ancestor ids');

assert(!kr.includes('id="krCustomBtn"'), '添加我的回忆 button must be removed');
assert(!kr.includes('id="krCenterNodeBtn"'), '居中此节点 button must be removed');
assert(kr.includes('id="krCustomForm"><input'), 'custom input form must always be visible');
assert(kr.includes('id="krCustomSaveBtn" type="button">生成</button>'), '生成 button must remain');

assert(kr.includes('id="krMoreChoicesBtn" type="button"'), '换一组 button must always render');
assert(kr.includes("choicePage.canRotate?'':' disabled aria-disabled=\"true\"'"), '换一组 must preserve layout while disabling when no second group');
assert(kr.includes('没有更多推荐了，输入你想到的知识点继续。'), 'empty state copy must match continuity UX');

console.log('v90-p4512-deep-recall-flow-continuity-ok');
