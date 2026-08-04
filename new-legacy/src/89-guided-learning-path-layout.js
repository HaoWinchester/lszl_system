'use strict';

/*
 * GuidedLearningPathLayout v1
 * 纵向 S 曲线坐标、辅助练习入口锚点选择与 SVG 路径生成。
 */
(function(global){
  const CURVE_RATIOS=Object.freeze([0,-.46,-.81,-1,-.81,-.46,0,.46,.81,1,.81,.46]);
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

  function curveRatio(index){
    const safe=Math.max(0,Math.floor(Number(index)||0));
    return Number(CURVE_RATIOS[safe%CURVE_RATIOS.length])||0;
  }

  function nodeOrder(node,index){
    const value=Number(node?.order);
    return Number.isFinite(value)&&value>0?Math.round(value):index+1;
  }

  function practiceTargetOrder(entry,total){
    const explicit=Number(entry?.anchorNodeOrder);
    if(Number.isFinite(explicit)&&explicit>=1)return clamp(Math.round(explicit),1,total);
    const configured=Number(entry?.targetNodeOrder);
    if(Number.isFinite(configured)&&configured>=1)return clamp(Math.round(configured),1,total);
    const progress=Number(entry?.targetProgress);
    if(Number.isFinite(progress)&&progress>=0)return clamp(Math.round(1+clamp(progress,0,1)*(total-1)),1,total);
    const after=Number(entry?.afterNodeOrder);
    if(Number.isFinite(after))return clamp(Math.round(after)+1,1,total);
    return clamp(Math.round(total*.35),1,total);
  }

  function choosePracticeAnchor(nodes,entry,usedOrders=[],options={}){
    const list=Array.isArray(nodes)?nodes:[];
    const total=Math.max(1,list.length);
    const target=practiceTargetOrder(entry,total);
    const hasExplicit=Number.isFinite(Number(entry?.anchorNodeOrder))&&Number(entry?.anchorNodeOrder)>=1;
    const radius=hasExplicit?0:clamp(Math.round(Number(entry?.searchRadius??options.searchRadius??1)||1),0,4);
    const used=new Set((usedOrders||[]).map(value=>Number(value)));
    const candidates=list.map((node,index)=>({node,index,order:nodeOrder(node,index),ratio:curveRatio(index)}))
      .filter(candidate=>Math.abs(candidate.order-target)<=radius);
    const pool=candidates.length?candidates:list.map((node,index)=>({node,index,order:nodeOrder(node,index),ratio:curveRatio(index)}));
    pool.sort((a,b)=>{
      const score=item=>Math.abs(item.ratio)*100-Math.abs(item.order-target)*9-(used.has(item.order)?180:0)-([...used].some(order=>Math.abs(order-item.order)<2)?18:0);
      return score(b)-score(a)||Math.abs(a.order-target)-Math.abs(b.order-target)||a.order-b.order;
    });
    const selected=pool[0]||{node:list[0]||null,index:0,order:1,ratio:curveRatio(0)};
    const configuredSide=String(entry?.side||'').toLowerCase();
    const side=configuredSide==='left'||configuredSide==='right'?configuredSide:(selected.ratio>=0?'left':'right');
    return {...selected,targetOrder:target,side};
  }

  function smoothPath(points){
    const list=(points||[]).filter(point=>Number.isFinite(point?.x)&&Number.isFinite(point?.y));
    if(!list.length)return '';
    if(list.length===1)return `M ${list[0].x.toFixed(2)} ${list[0].y.toFixed(2)}`;
    let d=`M ${list[0].x.toFixed(2)} ${list[0].y.toFixed(2)}`;
    for(let index=0;index<list.length-1;index+=1){
      const p0=list[Math.max(0,index-1)];
      const p1=list[index];
      const p2=list[index+1];
      const p3=list[Math.min(list.length-1,index+2)];
      const c1x=p1.x+(p2.x-p0.x)/6;
      const c1y=p1.y+(p2.y-p0.y)/6;
      const c2x=p2.x-(p3.x-p1.x)/6;
      const c2y=p2.y-(p3.y-p1.y)/6;
      d+=` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
    }
    return d;
  }

  function createPartLayout(nodes,entries,options={}){
    const list=Array.isArray(nodes)?nodes:[];
    const top=Math.max(88,Number(options.top)||122);
    const gap=Math.max(118,Number(options.gap)||154);
    const bottom=Math.max(96,Number(options.bottom)||132);
    const amplitude=Math.max(12,Math.min(30,Number(options.amplitudePercent)||20));
    const height=Math.max(420,Math.round(top+Math.max(0,list.length-1)*gap+bottom));
    const nodePositions=list.map((node,index)=>{
      const ratio=curveRatio(index);
      return {node,index,order:nodeOrder(node,index),ratio,leftPercent:50+ratio*amplitude,top:top+index*gap};
    });
    const usedOrders=[];
    const entryPositions=(Array.isArray(entries)?entries:[]).map(entry=>{
      const anchor=choosePracticeAnchor(list,entry,usedOrders,options);
      usedOrders.push(anchor.order);
      const position=nodePositions[anchor.index]||nodePositions[0]||{top,leftPercent:50,ratio:0,order:1};
      return {entry,anchorOrder:anchor.order,anchorIndex:anchor.index,targetOrder:anchor.targetOrder,side:anchor.side,top:position.top};
    });
    const curvePoints=nodePositions.map(position=>({x:position.leftPercent*10,y:position.top}));
    return {height,top,gap,bottom,amplitude,nodePositions,entryPositions,curvePath:smoothPath(curvePoints),viewBox:`0 0 1000 ${height}`};
  }

  const api=Object.freeze({CURVE_RATIOS,curveRatio,practiceTargetOrder,choosePracticeAnchor,smoothPath,createPartLayout});
  global.KGGuidedLearningPathLayout=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
