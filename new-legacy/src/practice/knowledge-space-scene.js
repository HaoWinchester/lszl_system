'use strict';
(function(global){
  const LIMIT=60,MAX_STEPS=320,DEFAULT_CAMERA={yaw:.24,pitch:-.12,zoom:1};
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  const groupKey=node=>JSON.stringify([String(node.subject||''),String(node.taxonomyId||'')]);
  function createModel(nodes){
    const points=[],edges=[],groups=[],byKey=new Map();
    for(const [index,node] of (Array.isArray(nodes)?nodes:[]).slice(0,LIMIT).entries()){
      const key=groupKey(node);let group=byKey.get(key);
      if(!group){group={key,subject:String(node.subject||''),taxonomyId:String(node.taxonomyId||''),indices:[],x:0,y:0,z:0};groups.push(group);byKey.set(key,group)}
      group.indices.push(index);
      points.push({node,index,key:node.id==null?`index:${index}`:`id:${String(node.id)}:${index}`,group:key,x:0,y:0,z:0,vx:0,vy:0,vz:0});
    }
    groups.forEach((group,i)=>{
      const angle=i*2.399963229728653,radius=groups.length===1?0:Math.min(185,80+groups.length*10);
      group.x=Math.cos(angle)*radius;group.y=Math.sin(angle)*radius*.7;group.z=Math.sin(angle*.7)*80;
      group.indices.forEach((index,j)=>{
        const p=points[index],a=j*2.399963229728653,r=group.indices.length===1?18:30+Math.sqrt(j)*15;
        p.x=group.x+Math.cos(a)*r;p.y=group.y+Math.sin(a)*r;p.z=group.z+Math.cos(j*1.71)*r*.8;
        if(j)edges.push({source:group.indices[j-1],target:index,group:group.key});
      });
    });
    return {points,edges,groups,steps:0,quiet:0,settled:points.length===0};
  }
  function stepModel(model){
    if(model.settled)return false;
    const {points,groups,edges}=model,centers=new Map(groups.map(group=>[group.key,group]));
    for(const p of points){const c=centers.get(p.group);p.vx+=(c.x-p.x)*.006;p.vy+=(c.y-p.y)*.006;p.vz+=(c.z-p.z)*.006}
    // The page cap and finite solve budget bound this short-range all-pairs repulsion.
    for(let i=0;i<points.length;i++)for(let j=0;j<i;j++){
      const a=points[i],b=points[j],dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z,d=Math.max(1,Math.hypot(dx,dy,dz));
      if(d>=75)continue;
      const force=Math.min(1.6,(75-d)*.035)/d;
      a.vx+=dx*force;a.vy+=dy*force;a.vz+=dz*force;b.vx-=dx*force;b.vy-=dy*force;b.vz-=dz*force;
    }
    for(const edge of edges){
      const a=points[edge.source],b=points[edge.target],dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,d=Math.max(1,Math.hypot(dx,dy,dz)),f=(d-48)*.003/d;
      a.vx+=dx*f;a.vy+=dy*f;a.vz+=dz*f;b.vx-=dx*f;b.vy-=dy*f;b.vz-=dz*f;
    }
    let speed=0;
    for(const p of points){for(const axis of ['x','y','z']){const velocity='v'+axis;p[velocity]=clamp(p[velocity]*.81,-5,5);p[axis]+=p[velocity]}speed=Math.max(speed,Math.hypot(p.vx,p.vy,p.vz))}
    model.steps++;model.quiet=speed<.035?model.quiet+1:0;
    if(model.steps>=MAX_STEPS||model.quiet>=12){model.settled=true;for(const p of points)p.vx=p.vy=p.vz=0}
    return !model.settled;
  }
  function projectPoint(point,camera,width,height){
    const cy=Math.cos(camera.yaw),sy=Math.sin(camera.yaw),cp=Math.cos(camera.pitch),sp=Math.sin(camera.pitch);
    const x=point.x*cy-point.z*sy,z=point.x*sy+point.z*cy,y=point.y*cp-z*sp,rz=point.y*sp+z*cp;
    const depth=Math.max(120,700+rz),scale=700/depth*Math.min(width,height)/650*camera.zoom;
    return {x:width/2+x*scale,y:height/2+y*scale,scale,depth};
  }
  function mount({host,nodes,onSelect}={}){
    if(!host?.ownerDocument?.createElement||!host.appendChild)return null;
    const document=host.ownerDocument,win=document.defaultView||global,canvas=document.createElement('canvas');
    let ctx;try{ctx=canvas.getContext('2d')}catch(error){return null}if(!ctx)return null;
    canvas.className='kg-knowledge-space-canvas';canvas.setAttribute('role','img');canvas.setAttribute('aria-label','本页考点三维知识星空，考点详情可通过列表选择');
    canvas.style.cssText='display:block;width:100%;height:100%;touch-action:none;cursor:grab';host.appendChild(canvas);
    const model=createModel(nodes),camera={...DEFAULT_CAMERA},pointers=new Map(),listeners=[];
    const motion=win.matchMedia?.('(prefers-reduced-motion: reduce)');
    let width=0,height=0,raf=0,destroyed=false,selected=null,group='',dirty=true,intersecting=true,reduced=!!motion?.matches;
    let inertiaX=0,inertiaY=0,pinching=false,pinchDistance=0;
    function visible(){return !destroyed&&!document.hidden&&intersecting&&host.isConnected&&width>0&&height>0&&host.getClientRects().length>0&&win.getComputedStyle(host).visibility!=='hidden'}
    function positions(){return model.points.map(point=>({...projectPoint(point,camera,width,height),index:point.index,key:point.key,group:point.group,visible:!group||point.group===group}))}
    function stop(){if(raf)win.cancelAnimationFrame(raf);raf=0}
    function request(){if(!destroyed&&!raf&&visible()&&(dirty||!model.settled||Math.abs(inertiaX)+Math.abs(inertiaY)>.02))raf=win.requestAnimationFrame(frame)}
    function mark(){dirty=true;request()}
    function draw(){
      ctx.clearRect(0,0,width,height);ctx.fillStyle='#060b16';ctx.fillRect(0,0,width,height);
      // Tiny unconnected background dots are decoration, never selectable business nodes.
      ctx.fillStyle='rgba(179,203,244,.28)';
      for(let i=0;i<70;i++){const x=((i*173.71)%997)/997*width,y=((i*237.29)%991)/991*height;ctx.fillRect(x,y,i%5===0?1.3:.7,i%5===0?1.3:.7)}
      const projected=positions();ctx.lineWidth=.8;
      for(const edge of model.edges){const a=projected[edge.source],b=projected[edge.target];if(!a.visible||!b.visible)continue;ctx.strokeStyle='rgba(117,161,218,.22)';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}
      for(const p of projected.filter(p=>p.visible).sort((a,b)=>b.depth-a.depth)){
        const node=model.points[p.index].node,brightness=clamp(Number(node.brightness)||.2,.2,1),radius=clamp(4*p.scale,2.5,9),halo=radius*5;
        const glow=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,halo);glow.addColorStop(0,`rgba(143,199,255,${brightness*.45})`);glow.addColorStop(1,'rgba(72,139,255,0)');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(p.x,p.y,halo,0,Math.PI*2);ctx.fill();
        ctx.fillStyle=`rgba(190,224,255,${.3+brightness*.7})`;ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fill();
        if(p.index===selected){ctx.strokeStyle='#e1c594';ctx.lineWidth=1.3;ctx.beginPath();ctx.arc(p.x,p.y,radius+7,0,Math.PI*2);ctx.stroke()}
        if(p.index===selected||projected.length<=12){ctx.font='12px system-ui, sans-serif';ctx.textAlign='center';ctx.fillStyle=p.index===selected?'#f3dfba':'#a2b5d0';const title=String(node.title||'未命名考点');ctx.fillText(title.length>22?title.slice(0,21)+'…':title,p.x,p.y+radius+23,Math.max(30,width-20))}
      }
    }
    function frame(){
      raf=0;if(!visible())return;
      if(!model.settled){for(let i=0;i<3&&!model.settled;i++)stepModel(model);dirty=true}
      if(!reduced&&pointers.size===0&&(Math.abs(inertiaX)+Math.abs(inertiaY)>.02)){applyRotation(inertiaX,inertiaY);inertiaX*=.88;inertiaY*=.88;dirty=true}
      else if(reduced){inertiaX=0;inertiaY=0}
      if(dirty){draw();dirty=false}request();
    }
    function resize(){
      if(destroyed)return;
      const rect=host.getBoundingClientRect();width=Math.max(0,rect.width-host.clientLeft*2);height=Math.max(0,rect.height-host.clientTop*2);
      const dpr=Math.min(2,win.devicePixelRatio||1);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);mark();if(!visible())stop();
    }
    function applyRotation(dx,dy){camera.yaw+=dx*.006;camera.pitch=clamp(camera.pitch+dy*.006,-1.35,1.35)}
    function rotate(dx,dy){if(destroyed||!Number.isFinite(dx)||!Number.isFinite(dy))return;applyRotation(dx,dy);mark()}
    function zoomBy(factor){if(destroyed||!Number.isFinite(factor)||factor<=0)return;camera.zoom=clamp(camera.zoom*factor,.45,3);mark()}
    function select(index){if(destroyed||!Number.isInteger(index)||!model.points[index])return;selected=index;mark()}
    function focusGroup(key){if(destroyed)return;group=String(key||'');mark()}
    function reset(){if(destroyed)return;Object.assign(camera,DEFAULT_CAMERA);group='';inertiaX=inertiaY=0;mark()}
    function listen(target,type,handler,options){target.addEventListener(type,handler,options);listeners.push(()=>target.removeEventListener(type,handler,options))}
    function distance(){const values=[...pointers.values()];return values.length<2?0:Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y)}
    function releasePointers(){for(const id of pointers.keys()){try{if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id)}catch(error){/* Detached pointers need no release. */}}pointers.clear();pinching=false;pinchDistance=0;inertiaX=inertiaY=0;canvas.style.cursor='grab'}
    listen(canvas,'pointerdown',event=>{
      if(event.pointerType==='mouse'&&event.button!==0)return;
      inertiaX=inertiaY=0;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,moved:false});
      try{canvas.setPointerCapture(event.pointerId)}catch(error){/* Capture may be unavailable after a cancelled contact. */}
      if(pointers.size>1){pinching=true;pinchDistance=distance();for(const point of pointers.values())point.moved=true}canvas.style.cursor='grabbing';
    });
    listen(canvas,'pointermove',event=>{
      const point=pointers.get(event.pointerId);if(!point)return;
      const dx=event.clientX-point.x,dy=event.clientY-point.y;point.x=event.clientX;point.y=event.clientY;
      if(Math.hypot(point.x-point.startX,point.y-point.startY)>5)point.moved=true;
      if(pointers.size>1){const next=distance();if(pinchDistance>0)zoomBy(next/pinchDistance);pinchDistance=next;return}
      if(point.moved){rotate(dx,dy);inertiaX=reduced?0:dx;inertiaY=reduced?0:dy}
    });
    function finish(event,cancelled){
      const point=pointers.get(event.pointerId);if(!point)return;
      const click=!cancelled&&!pinching&&!point.moved&&Math.hypot(event.clientX-point.startX,event.clientY-point.startY)<=5;
      pointers.delete(event.pointerId);try{if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId)}catch(error){/* Already released by the browser. */}
      if(click){const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
        const hit=positions().filter(p=>p.visible&&Math.hypot(p.x-x,p.y-y)<=Math.max(12,7*p.scale)).sort((a,b)=>a.depth-b.depth)[0];
        if(hit){select(hit.index);if(typeof onSelect==='function')onSelect(model.points[hit.index].node,hit.index)}
      }
      if(cancelled){inertiaX=inertiaY=0;for(const p of pointers.values())p.moved=true}
      if(!pointers.size){pinching=false;pinchDistance=0;canvas.style.cursor='grab';request()}else{for(const p of pointers.values())p.moved=true}
    }
    listen(canvas,'pointerup',event=>finish(event,false));listen(canvas,'pointercancel',event=>finish(event,true));
    listen(canvas,'lostpointercapture',event=>{if(pointers.has(event.pointerId))finish(event,true)});
    listen(canvas,'wheel',event=>{event.preventDefault();zoomBy(Math.exp(clamp(-event.deltaY*.0015,-1,1)))},{passive:false});
    listen(document,'visibilitychange',()=>{if(document.hidden){stop();releasePointers()}else mark()});
    listen(win,'pagehide',destroy);
    if(motion){const changed=()=>{reduced=motion.matches;if(reduced)inertiaX=inertiaY=0;mark()};listen(motion,'change',changed)}
    const resizeObserver=win.ResizeObserver?new win.ResizeObserver(resize):null;resizeObserver?.observe(host);
    if(!resizeObserver)listen(win,'resize',resize);
    const intersectionObserver=win.IntersectionObserver?new win.IntersectionObserver(entries=>{intersecting=entries[0]?.isIntersecting!==false;if(intersecting)mark();else{stop();releasePointers()}}):null;intersectionObserver?.observe(host);
    // Dialog open/close and CSS visibility changes may not change intersection or size.
    const visibilityObserver=win.MutationObserver?new win.MutationObserver(()=>{if(visible())mark();else{stop();releasePointers()}}):null;
    for(let element=host;element&&visibilityObserver;element=element.parentElement)visibilityObserver.observe(element,{attributes:true,attributeFilter:['style','class','hidden','open']});
    function destroy(){if(destroyed)return;destroyed=true;stop();releasePointers();resizeObserver?.disconnect();intersectionObserver?.disconnect();visibilityObserver?.disconnect();for(const remove of listeners)remove();canvas.remove()}
    function snapshot(){return {camera:{...camera},positions:positions(),selected,group,settled:model.settled,running:!!raf,destroyed}}
    resize();return Object.freeze({select,focusGroup,rotate,zoomBy,reset,destroy,snapshot});
  }
  const api=Object.freeze({createModel,stepModel,projectPoint,mount});
  global.KGKnowledgeSpaceScene=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
