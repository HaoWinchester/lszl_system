'use strict';
(function(global){
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
  function resize(start,handle,delta={},limits={}){
    const w=clamp(start.width+(handle.includes('e')?delta.x||0:handle.includes('w')?-(delta.x||0):0),limits.minWidth??40,limits.maxWidth??4000);
    const h=clamp(start.height+(handle.includes('s')?delta.y||0:handle.includes('n')?-(delta.y||0):0),limits.minHeight??24,limits.maxHeight??4000);
    return {x:handle.includes('w')?start.x+start.width-w:start.x,y:handle.includes('n')?start.y+start.height-h:start.y,width:w,height:h,fontSize:clamp(start.fontSize*Math.sqrt(w*h/(start.width*start.height)),6,288)};
  }
  const api=Object.freeze({resize});global.KGTextBoxGeometry=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
