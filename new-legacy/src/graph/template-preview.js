/* Read-only template drawing. No editor state, HTML content, or remote assets. */
(function(global){
  'use strict';
  const NS='http://www.w3.org/2000/svg';
  function svg(tag,attrs={}){const node=document.createElementNS(NS,tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));return node}
  function bounds(nodes){
    if(!nodes.length)return {x:0,y:0,width:800,height:500};
    const x=Math.min(...nodes.map(n=>n.x))-40,y=Math.min(...nodes.map(n=>n.y))-40;
    return {x,y,width:Math.max(160,Math.max(...nodes.map(n=>n.x+n.width))-x+40),height:Math.max(100,Math.max(...nodes.map(n=>n.y+n.height))-y+40)};
  }
  function mount(container,projection,{interactive=false,onScale=()=>{}}={}){
    const nodes=projection.nodes||[],byId=new Map(nodes.map(n=>[n.id,n]));
    const root=svg('svg',{'aria-label':'模板图谱预览',role:'img',preserveAspectRatio:'xMidYMid meet'}),world=svg('g');root.append(world);container.replaceChildren(root);
    for(const link of projection.links||[]){const a=byId.get(link.from),b=byId.get(link.to);if(!a||!b)continue;const ax=a.x+a.width/2,ay=a.y+a.height/2,bx=b.x+b.width/2,by=b.y+b.height/2,mx=(ax+bx)/2;world.append(svg('path',{d:`M${ax} ${ay} C${mx} ${ay} ${mx} ${by} ${bx} ${by}`,stroke:link.color,'stroke-width':2,fill:'none'}))}
    for(const node of nodes){
      const group=svg('g');group.append(svg('rect',{x:node.x,y:node.y,width:node.width,height:node.height,rx:10,fill:node.fill,stroke:'#dbe2ec'}));
      const text=svg('text',{x:node.x+14,y:node.y+26,fill:node.color,'font-size':14,'font-family':'system-ui, PingFang SC, sans-serif'});
      const chars=Array.from(node.title||'未命名知识点'),lineLength=Math.max(3,Math.floor((node.width-28)/14)),lines=Math.max(1,Math.min(5,Math.floor((node.height-20)/22)));
      for(let i=0;i<lines&&i*lineLength<chars.length;i++){const span=svg('tspan',{x:node.x+14,dy:i?22:0});span.textContent=chars.slice(i*lineLength,(i+1)*lineLength).join('')+(i===lines-1&&chars.length>(i+1)*lineLength?'…':'');text.append(span)}group.append(text);world.append(group);
    }
    const initial=bounds(nodes);let view={...initial},drag=null;
    function render(){root.setAttribute('viewBox',`${view.x} ${view.y} ${view.width} ${view.height}`);onScale(initial.width/view.width)}
    function fit(){view={...initial};render()}
    function zoom(factor,clientX,clientY){const rect=root.getBoundingClientRect(),scale=Math.min(rect.width/view.width,rect.height/view.height),px=clientX??rect.left+rect.width/2,py=clientY??rect.top+rect.height/2,worldX=view.x+(px-rect.left-(rect.width-view.width*scale)/2)/scale,worldY=view.y+(py-rect.top-(rect.height-view.height*scale)/2)/scale;const next=Math.min(8,Math.max(.15,initial.width/view.width*factor)),ratio=(initial.width/next)/view.width;view={x:worldX-(worldX-view.x)*ratio,y:worldY-(worldY-view.y)*ratio,width:view.width*ratio,height:view.height*ratio};render()}
    const abort=new AbortController(),options={signal:abort.signal};
    if(interactive){
      root.addEventListener('wheel',event=>{event.preventDefault();zoom(Math.exp(-event.deltaY*.002),event.clientX,event.clientY)},{...options,passive:false});
      root.addEventListener('pointerdown',event=>{if(event.button!==0)return;const rect=root.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,view:{...view},scale:Math.min(rect.width/view.width,rect.height/view.height)};root.setPointerCapture(event.pointerId);root.classList.add('is-panning')},options);
      root.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;view={...drag.view,x:drag.view.x-(event.clientX-drag.x)/drag.scale,y:drag.view.y-(event.clientY-drag.y)/drag.scale};render()},options);
      const end=()=>{drag=null;root.classList.remove('is-panning')};root.addEventListener('pointerup',end,options);root.addEventListener('pointercancel',end,options);
    }
    fit();return {fit,zoom:factor=>zoom(factor),destroy(){abort.abort();root.remove()}};
  }
  global.KGTemplatePreview={mount,bounds};
  if(typeof module==='object'&&module.exports)module.exports={bounds};
})(typeof window!=='undefined'?window:globalThis);
