'use strict';
(function(global){
  const directions=['right','left','bilateral','down'];
  function compute(graph,{rootIds=[],direction='right',scopeIds}={}){
    if(!directions.includes(direction))throw new Error('未知布局方向');
    const scope=scopeIds==null?null:new Set(scopeIds),nodes=graph.nodes.filter(n=>!scope||scope.has(n.id)),map=new Map(nodes.map(n=>[n.id,n]));
    const links=(graph.links||[]).filter(l=>map.has(l.from)&&map.has(l.to)),adj=new Map(nodes.map(n=>[n.id,[]])),incoming=new Map(nodes.map(n=>[n.id,0]));
    for(const l of links){adj.get(l.from).push({id:l.to,link:l});adj.get(l.to).push({id:l.from,link:l});incoming.set(l.to,incoming.get(l.to)+1)}
    const requested=[...new Set(rootIds)].filter(id=>map.has(id)),visited=new Set(),treeEdges=[],children=new Map(nodes.map(n=>[n.id,[]])),roots=[];
    for(const n of nodes){if(visited.has(n.id))continue;const component=[],seen=new Set([n.id]),queue=[n.id];for(let i=0;i<queue.length;i++){const id=queue[i];component.push(id);for(const e of adj.get(id))if(!seen.has(e.id)){seen.add(e.id);queue.push(e.id)}}
      const hierarchyLinks=links.filter(l=>l.hierarchy===true&&seen.has(l.from)&&seen.has(l.to));
      const hierarchyNodes=new Set(hierarchyLinks.flatMap(l=>[l.from,l.to]));
      const hierarchyChildren=new Set(hierarchyLinks.map(l=>l.to));
      let root=requested.find(id=>seen.has(id));if(!root){const candidates=hierarchyLinks.length?component.filter(id=>hierarchyNodes.has(id)&&!hierarchyChildren.has(id)):component.filter(id=>incoming.get(id)===0);if(candidates.length!==1&&component.length>1)throw new Error('请为普通关系图指定根节点');root=candidates[0]||component[0]}
      roots.push(root);visited.add(root);const walk=[root];let cursor=0;
      const attach=(id,e)=>{visited.add(e.id);children.get(id).push(e.id);treeEdges.push(e.link);walk.push(e.id)};
      // Exhaust declared hierarchy descendants before admitting an ordinary shortcut.
      const descendHierarchy=()=>{for(;cursor<walk.length;cursor++){const id=walk[cursor];for(const e of adj.get(id))if(e.link.from===id&&e.link.hierarchy===true&&!visited.has(e.id))attach(id,e)}};
      descendHierarchy();
      while(component.some(id=>!visited.has(id))){
        let candidate=null;
        // Preserve an unvisited declared parent even when an ordinary shortcut appears first.
        for(const allowReservedChild of [false,true]){
          for(const outgoing of [true,false]){
            for(const id of walk){
              const edge=adj.get(id).find(e=>!visited.has(e.id)&&(!outgoing||e.link.from===id)&&(allowReservedChild||!hierarchyLinks.some(l=>l.to===e.id&&!visited.has(l.from))));
              if(edge){candidate={id,edge};break}
            }
            if(candidate)break;
          }
          if(candidate)break;
        }
        if(!candidate)break;
        attach(candidate.id,candidate.edge);descendHierarchy();
      }
    }
    const geometry=n=>global.KGGraphModel?global.KGGraphModel.geometryOf(n):{x:n.x||0,y:n.y||0,width:n.geometry?.width||128,height:n.geometry?.height||132};
    const dims=new Map(nodes.map(n=>[n.id,geometry(n)])),down=direction==='down',size=new Map(),weights=new Map();
    function measure(id){const g=dims.get(id),cs=children.get(id);let sum=0,w=1;for(const c of cs){sum+=measure(c);w+=weights.get(c)}sum+=Math.max(0,cs.length-1)*32;weights.set(id,w);const value=Math.max(down?g.width:g.height,sum);size.set(id,value);return value}
    roots.forEach(measure);const positions={},anchor=roots.length?dims.get(roots[0]):{x:0,y:0};let regionY=anchor.y;
    function place(id,axis,cross,sign){const g=dims.get(id);positions[id]=down?{x:Math.round(cross-g.width/2),y:Math.round(axis)}:{x:Math.round(sign>0?axis:axis-g.width),y:Math.round(cross-g.height/2)};let offset=cross-(children.get(id).reduce((s,c)=>s+size.get(c),0)+Math.max(0,children.get(id).length-1)*32)/2;for(const c of children.get(id)){const cg=dims.get(c);place(c,axis+sign*((down?g.height:g.width)+80),offset+size.get(c)/2,sign);offset+=size.get(c)+32}}
    for(const root of roots){const g=dims.get(root),center=regionY+size.get(root)/2;if(direction==='bilateral'){positions[root]={x:anchor.x,y:Math.round(center-g.height/2)};const sides=[[],[]],loads=[0,0];for(const c of children.get(root)){const side=loads[0]<=loads[1]?0:1;sides[side].push(c);loads[side]+=weights.get(c)}for(let side=0;side<2;side++){const cs=sides[side],span=cs.reduce((s,c)=>s+size.get(c),0)+Math.max(0,cs.length-1)*32;let off=center-span/2;for(const c of cs){place(c,side===0?anchor.x+g.width+80:anchor.x-80,off+size.get(c)/2,side===0?1:-1);off+=size.get(c)+32}}}else place(root,down?regionY:direction==='left'?anchor.x+g.width:anchor.x,down?anchor.x+size.get(root)/2:center,direction==='left'?-1:1);regionY=Math.max(...Object.values(positions).map(p=>p.y))+Math.max(...nodes.map(n=>dims.get(n.id).height))+120}
    // Keep the first root fixed so reapplying a layout is idempotent.
    if(roots.length){const p=positions[roots[0]],dx=anchor.x-p.x,dy=anchor.y-p.y;Object.values(positions).forEach(p=>{p.x+=dx;p.y+=dy})}
    const tree=new Set(treeEdges);return{positions,treeEdges,crossEdges:(graph.links||[]).filter(l=>!tree.has(l)),rootIds:roots,direction};
  }
  function apply(graph,options={}){
    const result=compute(graph,options),model=options.model||global.KGGraphModel;
    const map=new Map(graph.nodes.map(n=>[n.id,n])),endpoint=options.endpoints;
    const snapshots=endpoint?(graph.links||[]).filter(l=>l.curveControls||l.waypoints).map(link=>{const p=endpoint(link,map);return p?{link,route:{...link,start:{...p.a},end:{...p.b}}}:null}).filter(Boolean):[];
    for(const [id,p] of Object.entries(result.positions))model.updateGeometry(map.get(id),p);
    for(const {link,route} of snapshots){const p=endpoint(link,map);if(!p)continue;const moved=global.KGGraphEdgeGeometry.moveRoute(route,{x:p.a.x-route.start.x,y:p.a.y-route.start.y},{x:p.b.x-route.end.x,y:p.b.y-route.end.y});if(moved.curveControls)link.curveControls=moved.curveControls;if(moved.waypoints)link.waypoints=moved.waypoints}
    graph.mindmap={...(graph.mindmap||{}),rootIds:result.rootIds,direction:result.direction,schemaVersion:1};return result;
  }
  global.KGGraphMindmapLayout=Object.freeze({directions,compute,apply});if(typeof module!=='undefined')module.exports=global.KGGraphMindmapLayout;
})(typeof window!=='undefined'?window:globalThis);
