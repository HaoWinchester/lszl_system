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


  function polylineBounds(points=[]){
    const clean=(Array.isArray(points)?points:[]).filter(point=>point&&Number.isFinite(Number(point.x))&&Number.isFinite(Number(point.y)));
    if(!clean.length)return null;
    let left=finite(clean[0].x),right=left,top=finite(clean[0].y),bottom=top;
    for(const point of clean){const x=finite(point.x),y=finite(point.y);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}
    return{left,top,right,bottom,width:right-left,height:bottom-top};
  }
  function polylineIntersectsRect(points,rect){
    const clean=(Array.isArray(points)?points:[]).filter(point=>point&&Number.isFinite(Number(point.x))&&Number.isFinite(Number(point.y)));
    if(!clean.length)return false;rect=normalizeRect(rect);const bounds=polylineBounds(clean);if(bounds&&!rectsOverlap(bounds,rect))return false;
    if(clean.length===1)return pointInRect(clean[0],rect);
    for(let index=1;index<clean.length;index++)if(segmentIntersectsRect(clean[index-1],clean[index],rect))return true;
    return false;
  }
  function createPolylineIndex(entries=[],options={}){
    const cellSize=Math.max(64,finite(options.cellSize,320)),cells=new Map(),indexed=[],key=(x,y)=>x+':'+y;
    for(const entry of entries||[]){
      const id=String(entry?.id||''),points=Array.isArray(entry?.points)?entry.points:[],bounds=entry?.bounds?normalizeRect(entry.bounds):polylineBounds(points);if(!id||!points.length||!bounds)continue;
      const item={id,points,bounds};indexed.push(item);const x1=Math.floor(bounds.left/cellSize),x2=Math.floor(bounds.right/cellSize),y1=Math.floor(bounds.top/cellSize),y2=Math.floor(bounds.bottom/cellSize);
      for(let x=x1;x<=x2;x++)for(let y=y1;y<=y2;y++){const k=key(x,y);if(!cells.has(k))cells.set(k,[]);cells.get(k).push(item)}
    }
    function query(rect){
      rect=normalizeRect(rect);const found=new Map(),x1=Math.floor(rect.left/cellSize),x2=Math.floor(rect.right/cellSize),y1=Math.floor(rect.top/cellSize),y2=Math.floor(rect.bottom/cellSize);
      for(let x=x1;x<=x2;x++)for(let y=y1;y<=y2;y++)for(const item of cells.get(key(x,y))||[])if(rectsOverlap(item.bounds,rect))found.set(item.id,item);
      return[...found.values()];
    }
    return Object.freeze({cellSize,size:indexed.length,query,entries:()=>[...indexed]});
  }
  function collectPolylineIds(entries,rect,options={}){
    const ids=[],source=options.index?.query?options.index.query(rect):(entries||[]);
    for(const entry of source){const id=String(entry?.id||''),points=entry?.points||[],bounds=entry?.bounds||polylineBounds(points);if(bounds&&!rectsOverlap(bounds,rect))continue;if(id&&polylineIntersectsRect(points,rect))ids.push(id)}
    return ids;
  }

  function createPathIndex(entries=[],options={}){
    const cellSize=Math.max(64,finite(options.cellSize,320));
    const cells=new Map(),indexed=[];
    const key=(x,y)=>x+':'+y;
    for(const entry of entries||[]){
      const id=String(entry?.id||''),path=entry?.path||entry?.element||null,bounds=pathBounds(path);
      if(!id||!path||!bounds)continue;
      const item={id,path,bounds};indexed.push(item);
      const x1=Math.floor(bounds.left/cellSize),x2=Math.floor(bounds.right/cellSize),y1=Math.floor(bounds.top/cellSize),y2=Math.floor(bounds.bottom/cellSize);
      for(let x=x1;x<=x2;x++)for(let y=y1;y<=y2;y++){
        const k=key(x,y);if(!cells.has(k))cells.set(k,[]);cells.get(k).push(item);
      }
    }
    function query(rect){
      rect=normalizeRect(rect);
      const found=new Map(),x1=Math.floor(rect.left/cellSize),x2=Math.floor(rect.right/cellSize),y1=Math.floor(rect.top/cellSize),y2=Math.floor(rect.bottom/cellSize);
      for(let x=x1;x<=x2;x++)for(let y=y1;y<=y2;y++)for(const item of cells.get(key(x,y))||[]){
        if(rectsOverlap(item.bounds,rect))found.set(item.id,item);
      }
      return [...found.values()];
    }
    return Object.freeze({cellSize,size:indexed.length,query,entries:()=>[...indexed]});
  }

  function collectPathIds(entries,rect,options={}){
    const ids=[];
    const source=options.index?.query?options.index.query(rect):(entries||[]);
    for(const entry of source){
      const id=String(entry?.id||'');
      const path=entry?.path||entry?.element||null;
      const bounds=entry?.bounds||pathBounds(path);
      if(bounds&&!rectsOverlap(bounds,rect))continue;
      if(id&&pathIntersectsRect(path,rect,options))ids.push(id);
    }
    return ids;
  }
  global.KGCanvasEdgeSelectionGeometry=Object.freeze({normalizeRect,rectsOverlap,pointInRect,segmentIntersectsRect,pathBounds,pathIntersectsRect,polylineBounds,polylineIntersectsRect,createPathIndex,collectPathIds,createPolylineIndex,collectPolylineIds});
})(window);
