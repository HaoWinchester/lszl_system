'use strict';

(function(global){
  const MODES=new Set(['left','center-x','right','top','center-y','bottom','distribute-x','distribute-y']);
  function create(options={}){
    const model=options.model||global.KGGraphModel;
    const graph=()=>typeof options.getGraph==='function'?options.getGraph():null;
    const history=options.history||null;
    function uniqueNodes(ids){
      const target=graph();if(!target||!model)return[];
      const wanted=new Set(Array.isArray(ids)?ids:[...ids||[]]);
      return (target.nodes||[]).filter(node=>node&&wanted.has(node.id));
    }
    function bounds(node){const g=model.geometryOf(node);return{x:g.x,y:g.y,w:g.width,h:g.height,right:g.x+g.width,bottom:g.y+g.height,cx:g.x+g.width/2,cy:g.y+g.height/2}}
    function align(ids,mode,label){
      if(!MODES.has(mode))return{ok:false,reason:'unsupported'};
      const nodes=uniqueNodes(ids),required=mode.startsWith('distribute-')?3:2;
      if(nodes.length<required)return{ok:false,reason:'insufficient',required,count:nodes.length};
      const work=()=>{
        const entries=nodes.map(node=>({node,b:bounds(node)}));
        if(mode==='left'){const target=Math.min(...entries.map(i=>i.b.x));entries.forEach(i=>model.updateGeometry(i.node,{x:target}))}
        else if(mode==='center-x'){const target=entries.reduce((sum,i)=>sum+i.b.cx,0)/entries.length;entries.forEach(i=>model.updateGeometry(i.node,{x:Math.round(target-i.b.w/2)}))}
        else if(mode==='right'){const target=Math.max(...entries.map(i=>i.b.right));entries.forEach(i=>model.updateGeometry(i.node,{x:Math.round(target-i.b.w)}))}
        else if(mode==='top'){const target=Math.min(...entries.map(i=>i.b.y));entries.forEach(i=>model.updateGeometry(i.node,{y:target}))}
        else if(mode==='center-y'){const target=entries.reduce((sum,i)=>sum+i.b.cy,0)/entries.length;entries.forEach(i=>model.updateGeometry(i.node,{y:Math.round(target-i.b.h/2)}))}
        else if(mode==='bottom'){const target=Math.max(...entries.map(i=>i.b.bottom));entries.forEach(i=>model.updateGeometry(i.node,{y:Math.round(target-i.b.h)}))}
        else if(mode==='distribute-x'){
          entries.sort((a,b)=>a.b.x-b.b.x);const first=entries[0],last=entries[entries.length-1];const totalWidth=entries.reduce((sum,i)=>sum+i.b.w,0);const gap=(last.b.right-first.b.x-totalWidth)/(entries.length-1);let cursor=first.b.x;
          entries.forEach((item,index)=>{if(index===0||index===entries.length-1)return;cursor+=entries[index-1].b.w+gap;model.updateGeometry(item.node,{x:Math.round(cursor)})});
        }else if(mode==='distribute-y'){
          entries.sort((a,b)=>a.b.y-b.b.y);const first=entries[0],last=entries[entries.length-1];const totalHeight=entries.reduce((sum,i)=>sum+i.b.h,0);const gap=(last.b.bottom-first.b.y-totalHeight)/(entries.length-1);let cursor=first.b.y;
          entries.forEach((item,index)=>{if(index===0||index===entries.length-1)return;cursor+=entries[index-1].b.h+gap;model.updateGeometry(item.node,{y:Math.round(cursor)})});
        }
        return nodes.map(node=>node.id);
      };
      const changed=history&&typeof history.run==='function'?history.run(label||'对齐节点',work):work();
      const changedIds=Array.isArray(changed)?changed:nodes.map(node=>node.id);
      if(changedIds.length&&typeof options.onChange==='function')options.onChange({mode,ids:changedIds,renderMode:'geometry'});
      return{ok:true,ids:changedIds};
    }
    return Object.freeze({align,modes:MODES});
  }
  global.KGGraphNodeAlignmentController=Object.freeze({create,MODES});
})(typeof window!=='undefined'?window:globalThis);
