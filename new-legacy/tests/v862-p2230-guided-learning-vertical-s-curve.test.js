'use strict';
const fs=require('fs');
const layout=require('../src/89-guided-learning-path-layout.js');
function assert(condition,message){if(!condition)throw new Error(message)}
const nodes=Array.from({length:12},(_,index)=>({id:'n'+(index+1),order:index+1}));
const entries=[
  {id:'deep',targetNodeOrder:4,searchRadius:1,afterNodeOrder:3},
  {id:'multi',targetNodeOrder:9,searchRadius:1,afterNodeOrder:8}
];
const result=layout.createPartLayout(nodes,entries,{top:122,gap:154,bottom:132,amplitudePercent:20});
assert(result.nodePositions.length===12,'纵向布局必须保留全部 12 个正式节点');
assert(result.entryPositions.length===2,'应独立布局两个自由练习入口');
assert(result.entryPositions[0].anchorOrder===4,'第一个入口应在第 3～5 节点候选区间吸附到第 4 个转折节点');
assert(result.entryPositions[1].anchorOrder===10,'第二个入口应在第 8～10 节点候选区间吸附到第 10 个转折节点');
assert(result.entryPositions[0].side==='right','第 4 个节点位于曲线左侧，入口应放在右侧空白区');
assert(result.entryPositions[1].side==='left','第 10 个节点位于曲线右侧，入口应放在左侧空白区');
assert(result.entryPositions[0].top===result.nodePositions[3].top,'入口应与锚点节点水平对齐');
assert(result.entryPositions[1].top===result.nodePositions[9].top,'第二入口应与锚点节点水平对齐');
assert(result.nodePositions[3].leftPercent<50&&result.nodePositions[9].leftPercent>50,'S 曲线应包含左右转折点');
assert(result.height===1948,'12 节点路径高度应由固定纵向间距一次性计算');
assert(/^M /.test(result.curvePath)&&result.curvePath.includes(' C '),'应生成单条平滑 SVG S 曲线路径');
const override=layout.choosePracticeAnchor(nodes,{anchorNodeOrder:5,targetNodeOrder:4,searchRadius:2});
assert(override.order===5,'特殊部分应允许人工覆盖锚点节点');
const app=fs.readFileSync('src/89-guided-learning-app.js','utf8');
const css=fs.readFileSync('styles/guided-learning-path.css','utf8');
const html=fs.readFileSync('learning-path.html','utf8');
const data=fs.readFileSync('src/87-guided-learning-data.js','utf8');
assert(app.includes("SCROLL_KEY_PREFIX='kg_guided_path_scroll_v3__'"),'纵向路径应使用新的滚动位置存储版本');
assert(app.includes('scroller.scrollTop')&&!app.includes('scroller.scrollLeft'),'学习路径控制器应完整切换到纵向滚动');
assert(app.includes('data-gl-practice-anchor'),'入口 DOM 应暴露实际吸附锚点，便于测试与维护');
assert(css.includes('overflow-x:hidden;overflow-y:auto')&&css.includes('touch-action:pan-y'),'路径容器应使用原生纵向滚动');
assert(css.includes('.gl-part-path-curve'),'纵向路径应渲染轻量单条 SVG 曲线');
assert(html.indexOf('89-guided-learning-path-layout.js')<html.indexOf('89-guided-learning-app.js'),'纯布局模块必须在页面控制器之前加载');
assert(/targetNodeOrder:4,searchRadius:1/.test(data)&&/targetNodeOrder:9,searchRadius:1/.test(data),'两个入口应声明目标区间，而不是占用正式节点槽位');
console.log('v862-p2230-guided-learning-vertical-s-curve-ok');
