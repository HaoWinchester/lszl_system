'use strict';
(function(global){
  const MAX_STEPS=320,CELL=75,DEFAULT_CAMERA={yaw:.24,pitch:-.12,zoom:1};
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  const categoryPath=node=>(Array.isArray(node.path)?node.path.slice(0,-1).map(String):[]).filter(value=>value.trim()&&value!==String(node.subject||''));
  const groupKey=node=>JSON.stringify([String(node.subject||''),String(node.taxonomyId??''),categoryPath(node)[0]||'']);
  function classificationLabel(nodes){
    const paths=nodes.map(categoryPath),common=[];
    for(let i=0;i<(paths[0]?.length||0)&&paths.every(path=>path[i]===paths[0][i]);i++)common.push(paths[0][i]);
    const name=nodes[0]?.taxonomyName||nodes[0]?.categoryName||common.filter(value=>value.trim()).join(' / ')||'未分类';
    return `${nodes[0]?.subject||'科目未标注'} · ${name}`;
  }
  function semanticView(model,zoomRatio,group=''){
    if(zoomRatio<1.35)return {mode:'clusters',items:model.groups.filter(item=>!group||item.key===group).map(item=>({...item,count:item.indices.length}))};
    return {mode:'points',items:model.points.filter(point=>!group||point.group===group)};
  }
  function createModel(nodes){
    const points=[],edges=[],groups=[],byKey=new Map();
    for(const [index,node] of (Array.isArray(nodes)?nodes:[]).entries()){
      const key=groupKey(node);let group=byKey.get(key);
      if(!group){group={key,subject:String(node.subject||''),taxonomyId:String(node.taxonomyId??''),indices:[],x:0,y:0,z:0};groups.push(group);byKey.set(key,group)}
      group.indices.push(index);
      points.push({node,index,key:node.id==null?`index:${index}`:`id:${String(node.id)}:${index}`,group:key,x:0,y:0,z:0,vx:0,vy:0,vz:0});
    }
    const catalogKey=(node,id)=>JSON.stringify([String(node.subject||''),String(node.taxonomyId??''),String(id)]),catalogIds=new Map();
    for(const point of points)if(point.node.id!=null){const key=catalogKey(point.node,point.node.id);catalogIds.set(key,catalogIds.has(key)?null:point.index)}
    groups.forEach((group,i)=>{
      group.label=classificationLabel(group.indices.map(index=>points[index].node));
      const angle=i*2.399963229728653,radius=groups.length===1?0:Math.min(185,80+groups.length*10);
      group.x=Math.cos(angle)*radius;group.y=Math.sin(angle)*radius*.7;group.z=Math.sin(angle*.7)*80;
      const catalog=group.indices.some(index=>Object.prototype.hasOwnProperty.call(points[index].node,'parentId'));
      group.indices.forEach((index,j)=>{
        const p=points[index],a=j*2.399963229728653,r=group.indices.length===1?18:30+Math.sqrt(j)*15;
        p.x=group.x+Math.cos(a)*r;p.y=group.y+Math.sin(a)*r;p.z=group.z+Math.cos(j*1.71)*r*.8;
        if(catalog){
          const parent=p.node.parentId,source=parent==null?null:catalogIds.get(catalogKey(p.node,parent));
          if(source!=null&&source!==index)edges.push({source,target:index,group:group.key});
        }else if(j)edges.push({source:group.indices[j-1],target:index,group:group.key});
      });
    });
    return {points,edges,groups,steps:0,quiet:0,settled:points.length===0};
  }
  function stepModel(model){
    if(model.settled)return false;
    const {points,groups,edges}=model,centers=new Map(groups.map(group=>[group.key,group]));
    for(const p of points){const c=centers.get(p.group);p.vx+=(c.x-p.x)*.006;p.vy+=(c.y-p.y)*.006;p.vz+=(c.z-p.z)*.006}
    // Visit only the 27 neighboring cells; insert after visiting so each pair acts once.
    const buckets=new Map();
    for(const a of points){
      const x=Math.floor(a.x/CELL),y=Math.floor(a.y/CELL),z=Math.floor(a.z/CELL);
      for(let ox=-1;ox<=1;ox++)for(let oy=-1;oy<=1;oy++)for(let oz=-1;oz<=1;oz++){
        const neighbors=buckets.get(`${x+ox},${y+oy},${z+oz}`);if(!neighbors)continue;
        for(const b of neighbors){
          const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z,squared=dx*dx+dy*dy+dz*dz;
          if(squared>=CELL*CELL)continue;
          const d=Math.max(1,Math.sqrt(squared)),force=Math.min(1.6,(CELL-d)*.035)/d;
          a.vx+=dx*force;a.vy+=dy*force;a.vz+=dz*force;b.vx-=dx*force;b.vy-=dy*force;b.vz-=dz*force;
        }
      }
      const key=`${x},${y},${z}`;let bucket=buckets.get(key);if(!bucket){bucket=[];buckets.set(key,bucket)}bucket.push(a);
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
  function mount({host,nodes,onSelect,onGroup}={}){
    if(!host?.ownerDocument?.createElement||!host.appendChild)return null;
    const document=host.ownerDocument,win=document.defaultView||global,canvas=document.createElement('canvas');
    let ctx;try{ctx=canvas.getContext('2d')}catch(error){return null}if(!ctx)return null;
    canvas.className='kg-knowledge-space-canvas';canvas.setAttribute('role','img');canvas.setAttribute('aria-label','知识点三维知识星空，考点详情可通过列表选择');
    canvas.style.cssText='display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab';host.appendChild(canvas);
    const model=createModel(nodes),camera={...DEFAULT_CAMERA},pointers=new Map(),listeners=[];
    const motion=win.matchMedia?.('(prefers-reduced-motion: reduce)');
    let width=0,height=0,raf=0,destroyed=false,selected=null,group='',dirty=true,intersecting=true,reduced=!!motion?.matches;
    let inertiaX=0,inertiaY=0,pinching=false,pinchDistance=0,autoFit=true,baseZoom=1;
    const viewCenter={x:0,y:0,z:0},overviewCenter={x:0,y:0,z:0};
    function visible(){return !destroyed&&!document.hidden&&intersecting&&host.isConnected&&width>0&&height>0&&host.getClientRects().length>0&&win.getComputedStyle(host).visibility!=='hidden'}
    function relative(point){return {x:point.x-viewCenter.x,y:point.y-viewCenter.y,z:point.z-viewCenter.z}}
    // Fit once on mount/settlement and reset; explicit camera changes opt out until reset.
    function fitDefault(){
      if(!model.points.length||width<=0||height<=0)return;
      for(const axis of ['x','y','z']){const values=model.points.map(point=>point[axis]);viewCenter[axis]=(Math.min(...values)+Math.max(...values))/2}
      Object.assign(overviewCenter,viewCenter);
      const projected=model.points.map(point=>projectPoint(relative(point),{...DEFAULT_CAMERA},width,height));
      const extentX=Math.max(...projected.map(point=>Math.abs(point.x-width/2))),extentY=Math.max(...projected.map(point=>Math.abs(point.y-height/2)));
      const padding=Math.max(24,Math.min(width,height)*.12);
      camera.zoom=clamp(Math.min(Math.max(1,width/2-padding)/Math.max(1,extentX),Math.max(1,height/2-padding)/Math.max(1,extentY)),.45,3);baseZoom=camera.zoom;
    }
    function positions(){return model.points.map(point=>({...projectPoint(relative(point),camera,width,height),index:point.index,key:point.key,group:point.group,visible:!group||point.group===group}))}
    function clusterPositions(){return model.groups.filter(item=>!group||item.key===group).map(item=>({...item,count:item.indices.length,...projectPoint(relative(item),camera,width,height)}))}
    function stop(){if(raf)win.cancelAnimationFrame(raf);raf=0}
    function request(){if(!destroyed&&!raf&&visible()&&(dirty||!model.settled||(!reduced&&pointers.size===0&&Math.abs(inertiaX)+Math.abs(inertiaY)>.02)))raf=win.requestAnimationFrame(frame)}
    function mark(){dirty=true;request()}
    function draw(){
      ctx.clearRect(0,0,width,height);ctx.fillStyle='#060b16';ctx.fillRect(0,0,width,height);
      // Tiny unconnected background dots are decoration, never selectable business nodes.
      ctx.fillStyle='rgba(179,203,244,.28)';
      for(let i=0;i<70;i++){const x=((i*173.71)%997)/997*width,y=((i*237.29)%991)/991*height;ctx.fillRect(x,y,i%5===0?1.3:.7,i%5===0?1.3:.7)}
      const projected=positions();ctx.lineWidth=.8;
      for(const edge of model.edges){const a=projected[edge.source],b=projected[edge.target];if(!a.visible||!b.visible)continue;ctx.strokeStyle='rgba(117,161,218,.22)';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}
      for(const p of projected.filter(p=>p.visible).sort((a,b)=>b.depth-a.depth)){
        const node=model.points[p.index].node,value=Number(node.brightness),brightness=Number.isFinite(value)?clamp(value,.12,1):.12,radius=clamp(4*p.scale,2.5,9),halo=radius*5;
        const glow=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,halo);glow.addColorStop(0,`rgba(143,199,255,${brightness*.45})`);glow.addColorStop(1,'rgba(72,139,255,0)');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(p.x,p.y,halo,0,Math.PI*2);ctx.fill();
        ctx.fillStyle=`rgba(190,224,255,${.3+brightness*.7})`;ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.fill();
        if(p.index===selected){ctx.strokeStyle='#e1c594';ctx.lineWidth=1.3;ctx.beginPath();ctx.arc(p.x,p.y,radius+7,0,Math.PI*2);ctx.stroke()}
        if(p.index===selected||projected.length<=12){ctx.font='12px system-ui, sans-serif';ctx.textAlign='center';ctx.fillStyle=p.index===selected?'#f3dfba':'#a2b5d0';const title=String(node.title||'未命名考点');ctx.fillText(title.length>22?title.slice(0,21)+'…':title,p.x,p.y+radius+23,Math.max(30,width-20))}
      }
      if(semanticView(model,camera.zoom/baseZoom,group).mode==='clusters'){
        for(const cluster of clusterPositions()){
          const radius=18+Math.min(12,Math.sqrt(cluster.count)*2);
          ctx.fillStyle='rgba(23,48,78,.75)';ctx.strokeStyle='#82b8ea';ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(cluster.x,cluster.y,radius,0,Math.PI*2);ctx.fill();ctx.stroke();
          ctx.font='13px system-ui, sans-serif';ctx.textAlign='center';ctx.fillStyle='#e1efff';ctx.fillText(String(cluster.count),cluster.x,cluster.y+4);
          ctx.fillText(cluster.label,cluster.x,cluster.y+radius+22,Math.max(80,width-24));
        }
      }

    }
    function frame(){
      raf=0;if(!visible())return;
      if(!model.settled){for(let i=0;i<3&&!model.settled;i++)stepModel(model);if(model.settled&&autoFit)fitDefault();dirty=true}
      if(!reduced&&pointers.size===0&&(Math.abs(inertiaX)+Math.abs(inertiaY)>.02)){applyRotation(inertiaX,inertiaY);inertiaX*=.88;inertiaY*=.88;dirty=true}
      else if(reduced){inertiaX=0;inertiaY=0}
      if(dirty){draw();dirty=false}request();
    }
    function resize(){
      if(destroyed)return;
      const rect=host.getBoundingClientRect();width=Math.max(0,rect.width-host.clientLeft*2);height=Math.max(0,rect.height-host.clientTop*2);
      const dpr=Math.min(2,win.devicePixelRatio||1);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);if(autoFit)fitDefault();mark();if(!visible())stop();
    }
    function applyRotation(dx,dy){camera.yaw+=dx*.006;camera.pitch=clamp(camera.pitch+dy*.006,-1.35,1.35)}
    function rotate(dx,dy){if(destroyed||!Number.isFinite(dx)||!Number.isFinite(dy))return;autoFit=false;applyRotation(dx,dy);mark()}
    function zoomBy(factor){if(destroyed||!Number.isFinite(factor)||factor<=0)return;autoFit=false;camera.zoom=clamp(camera.zoom*factor,.45,9);if(camera.zoom/baseZoom<1.35&&group){group='';Object.assign(viewCenter,overviewCenter);onGroup?.('')}mark()}
    function select(index){if(destroyed||!Number.isInteger(index)||!model.points[index])return;selected=index;camera.zoom=Math.max(camera.zoom,baseZoom*1.5);autoFit=false;mark()}
    function focusGroup(key){if(destroyed)return;group=String(key||'');const target=model.groups.find(item=>item.key===group);if(target){autoFit=false;Object.assign(viewCenter,{x:target.x,y:target.y,z:target.z});camera.zoom=Math.min(9,baseZoom*1.6)}else if(!group)Object.assign(viewCenter,overviewCenter);mark()}
    function reset(){if(destroyed)return;Object.assign(camera,DEFAULT_CAMERA);autoFit=true;fitDefault();group='';inertiaX=inertiaY=0;mark()}
    function listen(target,type,handler,options){target.addEventListener(type,handler,options);listeners.push(()=>target.removeEventListener(type,handler,options))}
    function distance(){const values=[...pointers.values()];return values.length<2?0:Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y)}
    function releasePointers(){for(const id of pointers.keys()){try{if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id)}catch(error){/* Detached pointers need no release. */}}pointers.clear();pinching=false;pinchDistance=0;inertiaX=inertiaY=0;canvas.style.cursor='grab'}
    listen(canvas,'pointerdown',event=>{
      if(event.pointerType==='mouse'&&event.button!==0)return;
      inertiaX=inertiaY=0;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,moved:false,touch:event.pointerType==='touch',direction:''});
      try{canvas.setPointerCapture(event.pointerId)}catch(error){/* Capture may be unavailable after a cancelled contact. */}
      if(pointers.size>1){pinching=true;pinchDistance=distance();for(const point of pointers.values())point.moved=true}canvas.style.cursor='grabbing';
    });
    listen(canvas,'pointermove',event=>{
      const point=pointers.get(event.pointerId);if(!point)return;
      const dx=event.clientX-point.x,dy=event.clientY-point.y;point.x=event.clientX;point.y=event.clientY;
      if(Math.hypot(point.x-point.startX,point.y-point.startY)>5)point.moved=true;
      if(pointers.size>1){const next=distance();if(pinchDistance>0)zoomBy(next/pinchDistance);pinchDistance=next;return}
      if(pinching)return;
      if(point.touch&&point.moved&&!point.direction)point.direction=Math.abs(point.x-point.startX)>Math.abs(point.y-point.startY)?'horizontal':'vertical';
      if(point.touch&&point.direction!=='horizontal')return;
      if(point.moved){const vertical=point.touch?0:dy;rotate(dx,vertical);inertiaX=reduced?0:dx;inertiaY=reduced?0:vertical}
    });
    function finish(event,cancelled){
      const point=pointers.get(event.pointerId);if(!point)return;
      const click=!cancelled&&!pinching&&!point.moved&&Math.hypot(event.clientX-point.startX,event.clientY-point.startY)<=5;
      pointers.delete(event.pointerId);try{if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId)}catch(error){/* Already released by the browser. */}
      if(click){const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
        if(semanticView(model,camera.zoom/baseZoom,group).mode==='clusters'){
          const cluster=clusterPositions().filter(p=>Math.hypot(p.x-x,p.y-y)<=34).sort((a,b)=>a.depth-b.depth)[0];
          if(cluster){focusGroup(cluster.key);onGroup?.(cluster.key)}return;
        }
        const hit=positions().filter(p=>p.visible&&Math.hypot(p.x-x,p.y-y)<=Math.max(12,7*p.scale)).sort((a,b)=>a.depth-b.depth)[0];
        if(hit){select(hit.index);if(typeof onSelect==='function')onSelect(model.points[hit.index].node,hit.index)}
      }
      if(cancelled){inertiaX=inertiaY=0;for(const p of pointers.values())p.moved=true}
      if(!pointers.size){pinching=false;pinchDistance=0;canvas.style.cursor='grab';request()}else{for(const p of pointers.values())p.moved=true}
    }
    listen(canvas,'pointerup',event=>finish(event,false));listen(canvas,'pointercancel',event=>finish(event,true));
    listen(canvas,'lostpointercapture',event=>{if(pointers.has(event.pointerId))finish(event,true)});
    listen(canvas,'wheel',event=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();zoomBy(Math.exp(clamp(-event.deltaY*.0015,-1,1)))},{passive:false});
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
    function snapshot(){return {camera:{...camera},positions:positions(),mode:semanticView(model,camera.zoom/baseZoom,group).mode,clusters:clusterPositions(),selected,group,settled:model.settled,running:!!raf,destroyed}}
    resize();return Object.freeze({select,focusGroup,rotate,zoomBy,reset,destroy,snapshot});
  }
  const api=Object.freeze({createModel,stepModel,projectPoint,groupKey,classificationLabel,semanticView,mount});
  global.KGKnowledgeSpaceScene=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
