'use strict';

/*
 * CanvasEdgeSelectionGeometry v1
 * 画布关系线路径与框选矩形的轻量命中检测。
 */
(function(global){
  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  function normalizeRect(rect={}){
    const left=Math.min(finite(rect.left),finite(rect.right));
    const right=Math.max(finite(rect.left),finite(rect.right));
    const top=Math.min(finite(rect.top),finite(rect.bottom));
    const bottom=Math.max(finite(rect.top),finite(rect.bottom));
    return {left,top,right,bottom,width:right-left,height:bottom-top};
  }
  function rectsOverlap(a,b){
    a=normalizeRect(a);b=normalizeRect(b);
    return !(a.right<b.left||a.left>b.right||a.bottom<b.top||a.top>b.bottom);
  }
  function pointInRect(point,rect){
    rect=normalizeRect(rect);
    const x=finite(point?.x),y=finite(point?.y);
    return x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom;
  }
  function orientation(a,b,c){
    const value=(finite(b.y)-finite(a.y))*(finite(c.x)-finite(b.x))-(finite(b.x)-finite(a.x))*(finite(c.y)-finite(b.y));
    if(Math.abs(value)<1e-7)return 0;
    return value>0?1:2;
  }
  function onSegment(a,b,c){
    return finite(b.x)<=Math.max(finite(a.x),finite(c.x))+1e-7&&finite(b.x)+1e-7>=Math.min(finite(a.x),finite(c.x))&&finite(b.y)<=Math.max(finite(a.y),finite(c.y))+1e-7&&finite(b.y)+1e-7>=Math.min(finite(a.y),finite(c.y));
  }
  function segmentsIntersect(a,b,c,d){
    const o1=orientation(a,b,c),o2=orientation(a,b,d),o3=orientation(c,d,a),o4=orientation(c,d,b);
    if(o1!==o2&&o3!==o4)return true;
    if(o1===0&&onSegment(a,c,b))return true;
    if(o2===0&&onSegment(a,d,b))return true;
    if(o3===0&&onSegment(c,a,d))return true;
    if(o4===0&&onSegment(c,b,d))return true;
    return false;
  }
  function segmentIntersectsRect(a,b,rect){
    rect=normalizeRect(rect);
    if(pointInRect(a,rect)||pointInRect(b,rect))return true;
    const p1={x:rect.left,y:rect.top},p2={x:rect.right,y:rect.top},p3={x:rect.right,y:rect.bottom},p4={x:rect.left,y:rect.bottom};
    return segmentsIntersect(a,b,p1,p2)||segmentsIntersect(a,b,p2,p3)||segmentsIntersect(a,b,p3,p4)||segmentsIntersect(a,b,p4,p1);
  }
  function pathBounds(path){
    try{
      const box=path?.getBBox?.();
      if(box&&[box.x,box.y,box.width,box.height].every(Number.isFinite))return {left:box.x,top:box.y,right:box.x+box.width,bottom:box.y+box.height};
    }catch(error){}
    return null;
  }
  function pathIntersectsRect(path,rect,options={}){
    if(!path||typeof path.getTotalLength!=='function'||typeof path.getPointAtLength!=='function')return false;
    rect=normalizeRect(rect);
    const bounds=pathBounds(path);
    if(bounds&&!rectsOverlap(bounds,rect))return false;
    let length=0;
    try{length=Math.max(0,Number(path.getTotalLength())||0)}catch(error){return false}
    if(length===0){
      try{return pointInRect(path.getPointAtLength(0),rect)}catch(error){return false}
    }
    const minSamples=Math.max(4,Math.round(finite(options.minSamples,8)));
    const maxSamples=Math.max(minSamples,Math.round(finite(options.maxSamples,64)));
    const sampleSpacing=Math.max(12,finite(options.sampleSpacing,48));
    const samples=Math.max(minSamples,Math.min(maxSamples,Math.ceil(length/sampleSpacing)));
    let previous=null;
    for(let index=0;index<=samples;index++){
      let point=null;
      try{point=path.getPointAtLength(length*index/samples)}catch(error){return false}
      if(pointInRect(point,rect))return true;
      if(previous&&segmentIntersectsRect(previous,point,rect))return true;
      previous=point;
    }
    return false;
  }
  function collectPathIds(entries,rect,options={}){
    const ids=[];
    for(const entry of entries||[]){
      const id=String(entry?.id||'');
      const path=entry?.path||entry?.element||null;
      if(id&&pathIntersectsRect(path,rect,options))ids.push(id);
    }
    return ids;
  }
  global.KGCanvasEdgeSelectionGeometry=Object.freeze({normalizeRect,rectsOverlap,pointInRect,segmentIntersectsRect,pathIntersectsRect,collectPathIds});
})(window);
