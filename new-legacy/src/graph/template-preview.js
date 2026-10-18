/* Read-only template drawing. No editor state, HTML content, or remote assets. */
(function(global){
  'use strict';
  const NS='http://www.w3.org/2000/svg';let sequence=0;
  function svg(tag,attrs={}){const node=document.createElementNS(NS,tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));return node}
  function bounds(nodes){
    if(!nodes.length)return {x:0,y:0,width:800,height:500};
    const x=Math.min(...nodes.map(n=>n.x))-40,y=Math.min(...nodes.map(n=>n.y))-40;
    return {x,y,width:Math.max(160,Math.max(...nodes.map(n=>n.x+n.width))-x+40),height:Math.max(100,Math.max(...nodes.map(n=>n.y+n.height))-y+40)};
  }
  function mount(container,projection,{interactive=false,onScale=()=>{}}={}){
    const root=svg('svg',{'aria-label':'模板图谱预览',role:'img',preserveAspectRatio:'xMidYMid meet'}),world=svg('g');root.append(world);container.replaceChildren(root);
    const markerId='template-arrow-'+(++sequence),scene=global.KGGraphRenderer.readonly(projection,{svg:root,markerId});
    root.style.color=scene.color;
    const boxes=[];
    for(const edge of scene.edges){world.append(edge.element);const b=edge.bounds;boxes.push({x:b.left,y:b.top,width:b.width,height:b.height})}
    for(const {element,bounds:box} of [...scene.cards,...scene.texts]){
      const pad=40,frame=svg('foreignObject',{x:box.x-pad,y:box.y-pad,width:box.width+pad*2,height:box.height+pad*2});
      const host=document.createElementNS('http://www.w3.org/1999/xhtml','div');host.className='template-preview-object';host.style.cssText='position:relative;width:100%;height:100%;pointer-events:none';
      element.style.left=pad+'px';element.style.top=pad+'px';element.setAttribute('aria-hidden','true');host.append(element);frame.append(host);world.append(frame);boxes.push(box);
    }
    if(projection.strokes?.length){
      const ink=global.KGCanvasInk,strokes=ink.normalize(projection.strokes),measure=document.createElement('canvas').getContext('2d');
      for(const stroke of strokes)world.append(ink.svgStroke(stroke,document,measure));
      const box=ink.bounds(strokes,measure);if(box)boxes.push(box);
    }
    const initial=bounds(boxes);let view={...initial},drag=null;
    function render(){root.setAttribute('viewBox',`${view.x} ${view.y} ${view.width} ${view.height}`);onScale(initial.width/view.width)}
    function fit(){view={...initial};render()}
    function zoom(factor,clientX,clientY){const rect=root.getBoundingClientRect(),scale=Math.min(rect.width/view.width,rect.height/view.height),px=clientX??rect.left+rect.width/2,py=clientY??rect.top+rect.height/2,worldX=view.x+(px-rect.left-(rect.width-view.width*scale)/2)/scale,worldY=view.y+(py-rect.top-(rect.height-view.height*scale)/2)/scale;const next=Math.min(8,Math.max(.15,initial.width/view.width*factor)),ratio=(initial.width/next)/view.width;view={x:worldX-(worldX-view.x)*ratio,y:worldY-(worldY-view.y)*ratio,width:view.width*ratio,height:view.height*ratio};render()}
    const abort=new AbortController(),options={signal:abort.signal};
    if(interactive){
      root.addEventListener('wheel',event=>{event.preventDefault();event.stopPropagation();zoom(Math.exp(-event.deltaY*.002),event.clientX,event.clientY)},{...options,passive:false});
      root.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();const rect=root.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,view:{...view},scale:Math.min(rect.width/view.width,rect.height/view.height)};root.setPointerCapture(event.pointerId);root.classList.add('is-panning')},options);
      root.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;view={...drag.view,x:drag.view.x-(event.clientX-drag.x)/drag.scale,y:drag.view.y-(event.clientY-drag.y)/drag.scale};render()},options);
      const end=()=>{drag=null;root.classList.remove('is-panning')};root.addEventListener('pointerup',end,options);root.addEventListener('pointercancel',end,options);root.addEventListener('lostpointercapture',end,options);
    }
    fit();return {fit,zoom:factor=>zoom(factor),destroy(){abort.abort();root.remove()}};
  }
  global.KGTemplatePreview={mount,bounds};
  if(typeof module==='object'&&module.exports)module.exports={bounds};
})(typeof window!=='undefined'?window:globalThis);
