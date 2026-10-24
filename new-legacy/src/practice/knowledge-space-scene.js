'use strict';
(function(global){
  const TAU=Math.PI*2,DEFAULT_CAMERA={yaw:.10,pitch:-.02,zoom:1};
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  let tooltipSequence=0;
  function isSubjectOverviewNode(node){return !!node&&Object.prototype.hasOwnProperty.call(node,'parentId')&&node.parentId===null&&!!String(node.subject||'').trim()&&Array.isArray(node.path)&&node.path.length===1&&node.path[0]===node.subject}
  function categoryPath(node){
    const path=Array.isArray(node.path)?node.path.map(String):[],subject=String(node.subject||'');
    const parents=path.slice(0,-1).filter(value=>value.trim()&&value!==subject);
    if(!parents.length&&Object.prototype.hasOwnProperty.call(node,'parentId')){
      const own=path.at(-1);if(own?.trim()&&own!==subject)return [own];
    }
    return parents;
  }
  const groupKey=node=>JSON.stringify([String(node.subject||''),String(node.taxonomyId??''),categoryPath(node)[0]||'']);
  function categoryColor(key){const name=JSON.parse(key||'["","",""]')[2];return name==='人'?'#ffd58b':name==='环境'?'#80f0b8':'#8bdcff'}
  function rotateLocal(point,center,phase,scale=1){const x=point.x-center.x,y=point.y-center.y,z=point.z-center.z,c=Math.cos(phase),s=Math.sin(phase);return {x:center.x+(x*c-z*s)*scale,y:center.y+y*scale,z:center.z+(x*s+z*c)*scale}}
  // A circumscribed 24-sided cylinder contains every local Y rotation, including between samples.
  function rotationEnvelope(model){return model.groups.flatMap(center=>{const members=center.indices.map(index=>model.points[index]),radius=Math.max(...members.map(p=>Math.hypot(p.x-center.x,p.z-center.z)))/Math.cos(Math.PI/24),ys=members.map(p=>p.y);return Array.from({length:24},(_,i)=>i*Math.PI/12).flatMap(angle=>[Math.min(...ys),Math.max(...ys)].map(y=>({group:center.key,x:center.x+Math.cos(angle)*radius,y,z:center.z+Math.sin(angle)*radius})))})}
  function classificationLabel(nodes){
    const paths=nodes.map(categoryPath),common=[];
    for(let i=0;i<(paths[0]?.length||0)&&paths.every(path=>path[i]===paths[0][i]);i++)common.push(paths[0][i]);
    const subjectOverview=nodes.length&&nodes.every(node=>Object.prototype.hasOwnProperty.call(node,'parentId')&&!categoryPath(node).length&&Array.isArray(node.path)&&node.path.includes(String(node.subject||'')));
    const name=nodes[0]?.taxonomyName||nodes[0]?.categoryName||common.filter(value=>value.trim()).join(' / ')||(subjectOverview?'科目总览':'未分类');
    return `${nodes[0]?.subject||'科目未标注'} · ${name}`;
  }
  function semanticView(model,zoomRatio,group=''){
    if(zoomRatio<1.35)return {mode:'clusters',items:model.groups.filter(item=>!group||item.key===group).map(item=>({...item,count:item.indices.length}))};
    return {mode:'points',items:model.points.filter(point=>!group||point.group===group)};
  }
  // Aggregate nearby members within their semantic category, preserving exact coverage.
  function layoutLabels({points,width,height,zoomRatio,enabled,title,labelTop=14,labelBottom=height-14}){
    if(!enabled||zoomRatio<1.35||width<24||height<24)return [];
    const bins=new Map(),cell=100,minY=clamp(labelTop,14,height-14),maxY=clamp(labelBottom,minY,height-14),labelY=bin=>clamp(bin.sumY/bin.indices.length+18,minY,maxY);
    for(const point of points){
      if(!point.visible||point.x<0||point.y<0||point.x>width||point.y>height)continue;
      const key=JSON.stringify([point.group||'',Math.floor(point.x/cell),Math.floor(point.y/64)]);
      if(!bins.has(key))bins.set(key,{group:point.group,indices:[],sumX:0,sumY:0});const bin=bins.get(key);bin.indices.push(point.index);bin.sumX+=point.x;bin.sumY+=point.y;
    }
    const local=[...bins.values()];
    for(let i=0;i<local.length;i++)for(let j=i+1;j<local.length;j++){
      const a=local[i],b=local[j];
      if(a.group===b.group&&Math.abs(a.sumX/a.indices.length-b.sumX/b.indices.length)<188&&Math.abs(labelY(a)-labelY(b))<28){a.indices.push(...b.indices);a.sumX+=b.sumX;a.sumY+=b.sumY;local.splice(j,1);j=i}
    }
    return local.map(bin=>{const anchorX=bin.sumX/bin.indices.length,anchorY=bin.sumY/bin.indices.length,w=Math.min(180,width-16);return {anchorX,anchorY,indices:bin.indices,x:clamp(anchorX,w/2+4,width-w/2-4),y:clamp(anchorY+18,minY,maxY),width:w,text:bin.indices.length===1?String(title(bin.indices[0])):`${bin.indices.length} 个考点 · ${title(bin.indices[0])} 等`}});
  }
  function createModel(nodes){
    const points=[],edges=[],groups=[],byKey=new Map();
    for(const [index,node] of (Array.isArray(nodes)?nodes:[]).filter(node=>!isSubjectOverviewNode(node)).entries()){
      const key=groupKey(node);let group=byKey.get(key);
      if(!group){group={key,subject:String(node.subject||''),taxonomyId:String(node.taxonomyId??''),indices:[],x:0,y:0,z:0};groups.push(group);byKey.set(key,group)}
      group.indices.push(index);
      points.push({node,index,key:node.id==null?`index:${index}`:`id:${String(node.id)}:${index}`,group:key,x:0,y:0,z:0,vx:0,vy:0,vz:0});
    }
    const catalogKey=(node,id)=>JSON.stringify([String(node.subject||''),String(node.taxonomyId??''),String(id)]),catalogIds=new Map();
    for(const point of points)if(point.node.id!=null){const key=catalogKey(point.node,point.node.id);catalogIds.set(key,catalogIds.has(key)?null:point.index)}
    const three=groups.length===3&&['人','过程','环境'].every(name=>groups.some(g=>JSON.parse(g.key)[2]===name))&&new Set(groups.map(g=>JSON.stringify([g.subject,g.taxonomyId]))).size===1;
    // Original moduleCenters / nodes (original-reference.html:301–311): geometric
    // elliptical constellations. The catalog supplies membership and real edges.
    groups.forEach((group,i)=>{
      const name=JSON.parse(group.key)[2],a=-1.45+i*(TAU/Math.max(1,groups.length));
      group.label=classificationLabel(group.indices.map(index=>points[index].node));
      group.x=three?(name==='过程'?0:name==='人'?-190:190):Math.cos(a)*240;
      group.y=three?(name==='过程'?-55:290):Math.sin(a)*200;group.z=0;
      group.radius=three&&name==='过程'?270:130;group.depth=200;
      const branchNames=[...new Set(group.indices.map(index=>{const n=points[index].node;return (Array.isArray(n.path)?n.path:[]).filter(v=>v!==n.subject)[1]||''}).filter(Boolean))];
      const branches=new Map(branchNames.map((name,bi)=>[name,{name,indices:[],angle:-1.45+bi*TAU/branchNames.length}]));
      for(const index of group.indices){const point=points[index],path=(Array.isArray(point.node.path)?point.node.path:[]).filter(v=>v!==point.node.subject);
        const branch=branches.get(path[1]);if(branch)branch.indices.push(index);else Object.assign(point,{x:group.x,y:group.y,z:group.z});
      }
      for(const [bi,branch] of [...branches.values()].entries()){
        const extent=three&&name==='过程'?205:75,c={x:group.x+Math.cos(branch.angle)*extent,y:group.y+Math.sin(branch.angle)*extent*.76,z:Math.sin(branch.angle*1.72)*150};
        branch.center=c;branch.group=group.key;
        const byParent=new Map();for(const index of branch.indices){const point=points[index],parent=point.node.parentId;if(!byParent.has(parent))byParent.set(parent,[]);byParent.get(parent).push(index)}
        const placed=new Set(),branchIds=new Set(branch.indices.map(index=>points[index].node.id));
        const roots=branch.indices.filter(index=>!branchIds.has(points[index].node.parentId));
        // Iterative traversal also handles deep, cyclic and duplicate-id catalogs.
        const queue=roots.map((index,j)=>({index,center:c,depth:roots.length===1?0:1,local:j,total:roots.length}));
        const drain=()=>{for(let cursor=0;cursor<queue.length;cursor++){
          const {index,center,depth,local,total}=queue[cursor];if(placed.has(index))continue;placed.add(index);
          const point=points[index],a=local*TAU/Math.max(3,total)+bi*.29,rr=depth===0?0:depth===1?62:Math.max(10,30/Math.pow(1.65,depth-2));
          Object.assign(point,{x:center.x+Math.cos(a)*rr,y:center.y+Math.sin(a)*rr*.66,z:center.z+Math.sin(a*1.37)*rr*.85});
          const children=catalogIds.get(catalogKey(point.node,point.node.id))===index?(byParent.get(point.node.id)||[]):[];children.forEach((child,j)=>{if(!placed.has(child))queue.push({index:child,center:point,depth:depth+1,local:j,total:children.length})});
        }queue.length=0};drain();
        // Cycles have no roots: give each unvisited component a real selectable position.
        const remaining=branch.indices.filter(index=>!placed.has(index));remaining.forEach((index,j)=>{if(!placed.has(index)){queue.push({index,center:c,depth:1,local:j,total:remaining.length});drain()}});

      }
      // Non-catalog data uses the same original polygon vocabulary, without fake edges.
      const loose=group.indices.filter(index=>!Object.prototype.hasOwnProperty.call(points[index].node,'parentId')||(!Array.isArray(points[index].node.path)||!points[index].node.path.length));
      loose.forEach((index,j)=>{const a=j*TAU/Math.max(5,loose.length),rr=72+(j%2)*18;Object.assign(points[index],{x:group.x+Math.cos(a)*rr,y:group.y+Math.sin(a)*rr*.66,z:group.z+Math.sin(a*1.37)*70})});
      if(three&&name!=='过程')for(const point of [...group.indices.map(index=>points[index]),...[...branches.values()].map(branch=>branch.center)])for(const axis of ['x','y','z'])point[axis]=group[axis]+(point[axis]-group[axis])*.78;
      group.layoutScale=three?1:Math.min(1,3/groups.length);
      if(group.layoutScale<1)for(const point of [...group.indices.map(index=>points[index]),...[...branches.values()].map(branch=>branch.center)])for(const axis of ['x','y','z'])point[axis]=group[axis]+(point[axis]-group[axis])*group.layoutScale;
      group.branches=[...branches.values()];
      for(const index of group.indices){const point=points[index],parent=point.node.parentId,source=parent==null?null:catalogIds.get(catalogKey(point.node,parent));if(source!=null&&source!==index)edges.push({source,target:index,group:group.key})}
    });
    return {points,edges,groups,steps:0,quiet:0,settled:true};
  }
  // A static constellation has no force solver. Retain the public settling API.
  function stepModel(){return false}
  // Verbatim original rot(), original-reference.html:332–335.
  function rot(x,y,z,ax,ay){
    const cy=Math.cos(ay),sy=Math.sin(ay),x1=x*cy+z*sy,z1=-x*sy+z*cy;
    const cx=Math.cos(ax),sx=Math.sin(ax);return {x:x1,y:y*cx-z1*sx,z:y*sx+z1*cx};
  }
  function projectPoint(point,camera,width,height){
    const p=rot(point.x,point.y,point.z,camera.pitch,camera.yaw),W=width,H=height,zoom=900/camera.zoom;
    // Original project(), lines 336–339. Phones shift the origin and uniformly
    // change camera distance; never independently stretch x/y or compress insets.
    const f=Math.min(W,H)*1.05,z=p.z+zoom,sc=f/Math.max(240,z);
    return {x:W*(W<=960?.50:.69)+p.x*sc,y:H*(W<=960?.60:.50)+p.y*sc,scale:sc,depth:z};
  }
  function mount({host,nodes,onSelect,onGroup,insets,autoRotate=false,onAutoRotateChange}={}){
    if(!host?.ownerDocument?.createElement||!host.appendChild)return null;
    const document=host.ownerDocument,win=document.defaultView||global,canvas=document.createElement('canvas');
    let ctx;try{ctx=canvas.getContext('2d')}catch(error){return null}if(!ctx)return null;
    canvas.className='kg-knowledge-space-canvas';canvas.setAttribute('role','img');canvas.setAttribute('aria-label','知识点三维知识星空，考点详情可通过列表选择');
    canvas.style.cssText='display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab';host.appendChild(canvas);
    const tooltip=document.createElement('div'),tooltipMeta=document.createElement('small'),tooltipTitle=document.createElement('strong');
    tooltip.className='kg-knowledge-tooltip';tooltip.id=`kg-knowledge-hover-${++tooltipSequence}`;tooltip.setAttribute('role','tooltip');tooltip.hidden=true;tooltip.append(tooltipMeta,tooltipTitle);
    (host.closest('dialog')||host).appendChild(tooltip);
    const model=createModel(nodes),centers=new Map(model.groups.map(item=>[item.key,item])),camera={...DEFAULT_CAMERA},pointers=new Map(),listeners=[];
    const motion=win.matchMedia?.('(prefers-reduced-motion: reduce)');
    let labelsVisible=false,safeInsets={},autoEnabled=!!autoRotate&&!motion?.matches,phase=0,lastFrame=0,resumeTimer=0,pauseUntil=0,rotationPaused=false;
    const now=()=>win.performance.now();
    function clearWake(){if(resumeTimer)win.clearTimeout(resumeTimer);resumeTimer=0}
    function automatic(){return autoEnabled&&!rotationPaused&&!pointers.size&&now()>=pauseUntil}
    function wake(){clearWake();if(autoEnabled&&!rotationPaused&&!pointers.size&&visible()&&pauseUntil>now())resumeTimer=win.setTimeout(()=>{resumeTimer=0;lastFrame=0;mark()},pauseUntil-now())}
    function pauseInteraction(){pauseUntil=now()+3000;lastFrame=0;wake()}
    function setAutoRotate(value){if(destroyed)return;autoEnabled=!!value;lastFrame=0;clearWake();onAutoRotateChange?.(autoEnabled);if(autoEnabled){wake();mark()}else if(model.settled&&!dirty&&!inertiaX&&!inertiaY)stop()}
    function setRotationPaused(value){if(destroyed)return;rotationPaused=!!value;lastFrame=0;clearWake();if(rotationPaused){clearHover();stop()}else{wake();mark()}}
    let width=0,height=0,raf=0,destroyed=false,selected=null,group='',dirty=true,intersecting=true,reduced=!!motion?.matches;
    let inertiaX=0,inertiaY=0,pinching=false,pinchDistance=0,autoFit=true,baseZoom=1,interiorScale=1,hoverPointer=null;
    const viewCenter={x:0,y:0,z:0},overviewCenter={x:0,y:0,z:0};
    function visible(){return !destroyed&&!document.hidden&&intersecting&&host.isConnected&&width>0&&height>0&&host.getClientRects().length>0&&win.getComputedStyle(host).visibility!=='hidden'}
    function project(point){return projectPoint(relative(point),camera,width,height)}
    function displayPoint(point){const center=centers.get(point.group);return center?rotateLocal(point,center,phase,interiorScale):point}
    function relative(point){const displayed=displayPoint(point);return {x:displayed.x-viewCenter.x,y:displayed.y-viewCenter.y,z:displayed.z-viewCenter.z}}
    function fitDefault(){
      Object.assign(viewCenter,{x:0,y:0,z:0});Object.assign(overviewCenter,viewCenter);
      camera.zoom=width<=650?.88:width<=960?1.05:1;baseZoom=camera.zoom;
    }
    function positions(){safeInsets=insets?.()||{};return model.points.map(point=>({...project(point),index:point.index,key:point.key,group:point.group,visible:!group||point.group===group}))}
    function clusterPositions(){return model.groups.filter(item=>!group||item.key===group).map(item=>({...item,count:item.indices.length,...project(item)}))}
    // Hover and click share projection/depth picking, so the shown title matches the selected point.
    function pickNode(x,y){return positions().filter(p=>p.visible&&Math.hypot(p.x-x,p.y-y)<=Math.max(12,7*p.scale)).sort((a,b)=>a.depth-b.depth)[0]}
    function hideTooltip(){tooltip.hidden=true;canvas.removeAttribute('aria-describedby')}
    function clearHover(){hoverPointer=null;hideTooltip()}
    function updateHover(){
      if(!hoverPointer||rotationPaused||pointers.size||win.innerWidth<=700||!visible()){hideTooltip();return}
      const rect=canvas.getBoundingClientRect(),x=hoverPointer.x-rect.left,y=hoverPointer.y-rect.top;
      const hit=x>=0&&x<=width&&y>=0&&y<=height?pickNode(x,y):null;
      if(!hit){hideTooltip();return}
      const point=model.points[hit.index],node=point.node,raw=Number(node.relatedAttemptCount??node.attemptCount),count=Number.isFinite(raw)&&raw>0?raw:0;
      tooltipMeta.textContent=`${String(hit.index+1).padStart(2,'0')} · ${centers.get(point.group).label} · 累计练习 ${count} 次`;
      tooltipTitle.textContent=String(node.title||'未命名考点');tooltip.hidden=false;canvas.setAttribute('aria-describedby',tooltip.id);
      const tip=tooltip.getBoundingClientRect();
      tooltip.style.left=clamp(hoverPointer.x+16,8,Math.max(8,win.innerWidth-tip.width-8))+'px';
      tooltip.style.top=clamp(hoverPointer.y+16,8,Math.max(8,win.innerHeight-tip.height-8))+'px';
    }
    function stop(){if(raf)win.cancelAnimationFrame(raf);raf=0;lastFrame=0;clearWake()}
    function request(){if(!destroyed&&!raf&&visible()&&(dirty||!model.settled||automatic()||(!reduced&&pointers.size===0&&Math.abs(inertiaX)+Math.abs(inertiaY)>.02)))raf=win.requestAnimationFrame(frame)}
    function mark(){dirty=true;request()}
    // Verbatim distributions from original-reference.html:322–323, stable per mount.
    const stars=Array.from({length:350},()=>({x:(Math.random()*2-1)*1000,y:(Math.random()*2-1)*700,z:(Math.random()*2-1)*700,a:.12+Math.random()*.55,s:.3+Math.random()*1.4}));
    const dust=Array.from({length:180},()=>({x:(Math.random()*2-1)*560,y:(Math.random()*2-1)*330,z:(Math.random()*2-1)*430,a:.08+Math.random()*.32}));
    function hexrgba(hex,a){const n=parseInt(hex.slice(1),16);return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`}
    function draw(){
      const W=width,H=height,yaw=camera.yaw+phase,pitch=camera.pitch,t=phase*12;
      ctx.clearRect(0,0,W,H);
      // Original draw atmosphere, stars, dust and perspective grid (lines 461–480).
      const glow=ctx.createRadialGradient(W*.69,H*.5,30,W*.69,H*.5,Math.max(W,H)*.55);
      glow.addColorStop(0,"rgba(72,137,207,.085)");glow.addColorStop(.42,"rgba(18,46,78,.035)");glow.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);
      const backgroundProject=p=>projectPoint(p,{yaw:0,pitch:0,zoom:camera.zoom},W,H);
      for(const s of stars){
        const r=rot(s.x,s.y,s.z,pitch*.16,yaw*.12),p=backgroundProject({x:r.x,y:r.y,z:r.z+120});
        const a=s.a*Math.max(.12,Math.min(1,p.scale*.85));ctx.fillStyle=`rgba(181,211,239,${a})`;ctx.fillRect(p.x,p.y,s.s,s.s);
      }
      for(const d of dust){
        const r=rot(d.x,d.y,d.z,pitch,yaw),p=backgroundProject(r);
        ctx.fillStyle=`rgba(121,169,214,${d.a*Math.min(1,p.scale)})`;ctx.fillRect(p.x,p.y,1,1);
      }
      ctx.save();ctx.globalAlpha=.12;ctx.strokeStyle="rgba(106,161,218,.34)";ctx.lineWidth=.65;
      const gy=H*.77;for(let i=-8;i<=8;i++){ctx.beginPath();ctx.moveTo(W*.69,gy);ctx.lineTo(W*.69+i*95,H);ctx.stroke()}
      for(let j=0;j<6;j++){const y=gy+(H-gy)*(j/6);ctx.beginPath();ctx.moveTo(W*.36,y);ctx.lineTo(W,y);ctx.stroke()}ctx.restore();
      const projected=positions();ctx.lineWidth=.75;ctx.textAlign='start';
      for(const edge of model.edges){const a=projected[edge.source],b=projected[edge.target];if(!a.visible||!b.visible)continue;
        const on=Number(model.points[a.index].node.relatedAttemptCount)>0&&Number(model.points[b.index].node.relatedAttemptCount)>0;
        ctx.strokeStyle=on?hexrgba(categoryColor(a.group),.26):"rgba(123,153,186,.07)";
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      }
      // Original depth sorting, radii, opacity, category glows and double selection rings.
      // The adapter's logarithmic practice brightness replaces mastered/locked business state.
      for(const n of projected.filter(p=>p.visible).sort((a,b)=>b.depth-a.depth)){
        const node=model.points[n.index].node,value=Number(node.brightness),brightness=Number.isFinite(value)?clamp(value,.12,1):.12;
        const on=brightness>.12,sel=n.index===selected,rr=Math.max(2.6,5.1*n.scale),a=Math.max(.2,Math.min(1,1.18-n.depth/1800)),color=categoryColor(n.group);
        if(on){
          const gr=rr*(sel?6.3:4.3),g=ctx.createRadialGradient(n.x,n.y,0,n.x,n.y,gr);g.addColorStop(0,hexrgba(color,.38*brightness));g.addColorStop(.2,hexrgba(color,.11*brightness));g.addColorStop(1,hexrgba(color,0));
          ctx.fillStyle=g;ctx.beginPath();ctx.arc(n.x,n.y,gr,0,TAU);ctx.fill();
        }
        if(sel){
          ctx.strokeStyle=hexrgba(color,.7);ctx.lineWidth=1;ctx.beginPath();ctx.arc(n.x,n.y,rr*3.1+Math.sin(t*3)*1.5,0,TAU);ctx.stroke();
          ctx.strokeStyle=hexrgba(color,.14);ctx.beginPath();ctx.arc(n.x,n.y,rr*5.2+Math.cos(t*2.6)*2,0,TAU);ctx.stroke();
        }
        ctx.shadowBlur=on?13*brightness:0;ctx.shadowColor=on?color:"transparent";ctx.fillStyle=on?hexrgba(color,.92*a*brightness):`rgba(98,108,120,${.7*a})`;
        ctx.beginPath();ctx.arc(n.x,n.y,rr*(sel?1.34:1),0,TAU);ctx.fill();ctx.shadowBlur=0;
        if(sel&&camera.zoom/baseZoom>=.75){ctx.font=`${Math.max(7,8.5*n.scale)}px ui-monospace,monospace`;ctx.fillStyle=on?hexrgba("#dceeff",.58):"rgba(130,143,157,.36)";ctx.fillText(String(n.index+1).padStart(2,"0"),n.x+rr*1.7,n.y-rr*1.1)}
      }
      if(camera.zoom/baseZoom>=.75&&(!labelsVisible||semanticView(model,camera.zoom/baseZoom,group).mode==='clusters')){
        for(const cluster of clusterPositions()){
          ctx.font='600 11px ui-sans-serif,system-ui';ctx.fillStyle=hexrgba(categoryColor(cluster.key),.62);
          ctx.fillText(`${cluster.label} · ${cluster.count}`,cluster.x+12,cluster.y-17,Math.max(80,width-24));
        }
        for(const category of model.groups.filter(item=>!group||item.key===group))for(const [i,branch] of category.branches.entries()){
          const p=project({...branch.center,group:category.key});if(p.x<(W<=960?12:W*.37)||p.x>W-30||p.y<95||p.y>H-85)continue;
          ctx.font=`600 ${Math.max(8,10*p.scale)}px ui-sans-serif,system-ui`;ctx.fillStyle=hexrgba(categoryColor(category.key),.28);ctx.fillText(`${String(i+1).padStart(2,'0')} ${branch.name}`,p.x+12,p.y-17);
        }
      }
      for(const label of labelLayout()){
        ctx.font='12px system-ui, sans-serif';ctx.textAlign='center';ctx.strokeStyle='rgba(151,184,224,.45)';ctx.lineWidth=.7;if(Math.hypot(label.anchorX-label.x,label.anchorY-label.y)<=60){ctx.beginPath();ctx.moveTo(label.anchorX,label.anchorY);ctx.lineTo(label.x,label.y);ctx.stroke()}ctx.fillStyle='rgba(6,11,20,.78)';const backing=Math.min(label.width,ctx.measureText(label.text).width+12);ctx.fillRect(label.x-backing/2,label.y-10,backing,20);ctx.fillStyle='#dbeaff';
        let text=label.text;while(text.length>1&&ctx.measureText(text).width>label.width-8)text=text.slice(0,-2)+'…';
        // Counts remain explicit even when a long representative name is shortened.

        ctx.fillText(text,label.x,label.y+4,label.width-8);
      }
    }
    function labelLayout(){return layoutLabels({points:positions(),width,height,zoomRatio:camera.zoom/baseZoom,enabled:labelsVisible,labelTop:(safeInsets.top||0)+8,labelBottom:height-(safeInsets.bottom||0)-8,title:index=>model.points[index].node.title||'未命名考点'})}
    function setLabelsVisible(value){pauseInteraction();labelsVisible=!!value;if(labelsVisible&&camera.zoom/baseZoom<1.35){autoFit=false;camera.zoom=baseZoom*1.5}mark()}
    function frame(timestamp){
      raf=0;if(!visible()){lastFrame=0;return}
      if(automatic()){if(lastFrame){phase+=Math.min(64,Math.max(0,timestamp-lastFrame))*Math.PI*2/540000;dirty=true}lastFrame=timestamp}else lastFrame=0;
      if(!model.settled){for(let i=0;i<3&&!model.settled;i++)stepModel(model);if(model.settled&&autoFit)fitDefault();dirty=true}
      if(!reduced&&pointers.size===0&&(Math.abs(inertiaX)+Math.abs(inertiaY)>.02)){applyRotation(inertiaX,inertiaY);inertiaX*=.88;inertiaY*=.88;dirty=true}
      else if(reduced){inertiaX=0;inertiaY=0}
      if(dirty){draw();dirty=false}updateHover();request();
    }
    function resize(){
      if(destroyed)return;
      const rect=host.getBoundingClientRect();width=Math.max(0,rect.width-host.clientLeft*2);height=Math.max(0,rect.height-host.clientTop*2);
      const dpr=Math.min(2,win.devicePixelRatio||1);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);if(autoFit)fitDefault();mark();if(!visible())stop();
    }
    function applyRotation(dx,dy){camera.yaw+=dx*.006;camera.pitch=clamp(camera.pitch+dy*.006,-1.35,1.35)}
    function rotate(dx,dy){if(destroyed||!Number.isFinite(dx)||!Number.isFinite(dy))return;pauseInteraction();autoFit=false;applyRotation(dx,dy);mark()}
    function zoomBy(factor){if(destroyed||!Number.isFinite(factor)||factor<=0)return;pauseInteraction();autoFit=false;camera.zoom=clamp(camera.zoom*factor,Math.min(.45,baseZoom*.35),9);if(camera.zoom/baseZoom<1.35&&group){group='';Object.assign(viewCenter,overviewCenter);onGroup?.('')}mark()}
    function select(index,reveal=true){if(destroyed||!Number.isInteger(index)||!model.points[index])return;pauseInteraction();selected=index;if(reveal){camera.zoom=Math.max(camera.zoom,baseZoom*1.5);autoFit=false}mark()}
    function focusGroup(key){if(destroyed)return;pauseInteraction();group=String(key||'');const target=model.groups.find(item=>item.key===group);if(target){autoFit=false;Object.assign(viewCenter,{x:target.x,y:target.y,z:target.z});camera.zoom=Math.min(9,baseZoom*Math.max(1.6,1.6/target.layoutScale))}else if(!group)Object.assign(viewCenter,overviewCenter);mark()}
    function reset(){if(destroyed)return;pauseInteraction();phase=0;Object.assign(camera,DEFAULT_CAMERA);autoFit=true;fitDefault();group='';inertiaX=inertiaY=0;mark()}
    function listen(target,type,handler,options){target.addEventListener(type,handler,options);listeners.push(()=>target.removeEventListener(type,handler,options))}
    function distance(){const values=[...pointers.values()];return values.length<2?0:Math.hypot(values[0].x-values[1].x,values[0].y-values[1].y)}
    function releasePointers(){clearHover();for(const id of pointers.keys()){try{if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id)}catch(error){/* Detached pointers need no release. */}}pointers.clear();pinching=false;pinchDistance=0;inertiaX=inertiaY=0;canvas.style.cursor='grab'}
    listen(canvas,'pointerdown',event=>{
      if(event.pointerType==='mouse'&&event.button!==0)return;
      if(event.pointerType==='touch')clearHover();else hoverPointer={x:event.clientX,y:event.clientY};hideTooltip();
      pauseInteraction();clearWake();inertiaX=inertiaY=0;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,moved:false,touch:event.pointerType==='touch',direction:''});
      try{canvas.setPointerCapture(event.pointerId)}catch(error){/* Capture may be unavailable after a cancelled contact. */}
      if(pointers.size>1){pinching=true;pinchDistance=distance();for(const point of pointers.values())point.moved=true}canvas.style.cursor='grabbing';
    });
    listen(canvas,'pointermove',event=>{
      if(event.pointerType!=='touch')hoverPointer={x:event.clientX,y:event.clientY};
      const point=pointers.get(event.pointerId);if(!point){updateHover();return}hideTooltip();
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
      pointers.delete(event.pointerId);pauseInteraction();try{if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId)}catch(error){/* Already released by the browser. */}
      if(click){const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
        if(semanticView(model,camera.zoom/baseZoom,group).mode==='clusters'){
          const cluster=clusterPositions().filter(p=>Math.hypot(p.x-x,p.y-y)<=34).sort((a,b)=>a.depth-b.depth)[0];
          if(cluster){focusGroup(cluster.key);onGroup?.(cluster.key);return;}
        }
        const hit=pickNode(x,y);
        if(hit){select(hit.index);if(typeof onSelect==='function')onSelect(model.points[hit.index].node,hit.index)}
      }
      if(cancelled){inertiaX=inertiaY=0;for(const p of pointers.values())p.moved=true}
      if(!pointers.size){pinching=false;pinchDistance=0;canvas.style.cursor='grab';request()}else{for(const p of pointers.values())p.moved=true}
    }
    listen(canvas,'pointerup',event=>finish(event,false));listen(canvas,'pointercancel',event=>finish(event,true));
    listen(canvas,'lostpointercapture',event=>{if(pointers.has(event.pointerId))finish(event,true)});
    listen(canvas,'dblclick',()=>{reset();onGroup?.('')});
    listen(canvas,'pointerleave',clearHover);listen(win,'blur',clearHover);listen(document,'scroll',clearHover,true);
    listen(canvas,'wheel',event=>{pauseInteraction();event.preventDefault();zoomBy(Math.exp(clamp(-event.deltaY*.0015,-1,1)))},{passive:false});
    listen(document,'visibilitychange',()=>{if(document.hidden){stop();releasePointers()}else{lastFrame=0;wake();mark()}});
    listen(win,'pagehide',destroy);
    if(motion){const changed=()=>{reduced=motion.matches;if(reduced){inertiaX=inertiaY=0;setAutoRotate(false)}mark()};listen(motion,'change',changed)}
    const resizeObserver=win.ResizeObserver?new win.ResizeObserver(resize):null;resizeObserver?.observe(host);
    if(!resizeObserver)listen(win,'resize',resize);
    const intersectionObserver=win.IntersectionObserver?new win.IntersectionObserver(entries=>{intersecting=entries[0]?.isIntersecting!==false;if(intersecting){wake();mark()}else{stop();releasePointers()}}):null;intersectionObserver?.observe(host);
    // Dialog open/close and CSS visibility changes may not change intersection or size.
    const visibilityObserver=win.MutationObserver?new win.MutationObserver(()=>{if(visible()){wake();mark()}else{stop();releasePointers()}}):null;
    for(let element=host;element&&visibilityObserver;element=element.parentElement)visibilityObserver.observe(element,{attributes:true,attributeFilter:['style','class','hidden','open']});
    function destroy(){if(destroyed)return;destroyed=true;stop();releasePointers();resizeObserver?.disconnect();intersectionObserver?.disconnect();visibilityObserver?.disconnect();for(const remove of listeners)remove();tooltip.remove();canvas.remove()}
    function snapshot(){return {autoRotate:autoEnabled,rotationPaused,phase,resumePending:!!resumeTimer,labelsVisible,labels:labelLayout(),textHidden:camera.zoom/baseZoom<.75,camera:{...camera},positions:positions(),mode:semanticView(model,camera.zoom/baseZoom,group).mode,clusters:clusterPositions(),selected,group,settled:model.settled,running:!!raf,destroyed}}
    resize();return Object.freeze({setAutoRotate,setRotationPaused,setLabelsVisible,select,focusGroup,rotate,zoomBy,reset,destroy,snapshot});
  }
  const api=Object.freeze({categoryColor,rotateLocal,rotationEnvelope,isSubjectOverviewNode,createModel,stepModel,projectPoint,groupKey,classificationLabel,semanticView,layoutLabels,mount});
  global.KGKnowledgeSpaceScene=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
