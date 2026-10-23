'use strict';

/*
 * KGGraphEdgeBundle · 多线汇总自动重叠（render-only）。
 *
 * 需求：多条关系线汇入同一节点/近似平行穿行时自动合成整齐的一条线（此前靠手动拖路径点对齐）。
 * 两阶段纯函数规划，调用方（10-graph-editor）把结果作为渲染期覆盖应用：
 *  1) endpoints  端点收拢：同一节点、同一方向扇区汇入/汇出的多条边共享同一附件点；
 *  2) channels   通道对齐：自动派生的折线（未存 waypoints、无显式端口）近似平行的中间段
 *                吸附到共享通道坐标，使平行主干段完全重合。
 * 关键约束：绝不回写 link.waypoints/fromPort/toPort 等持久数据，撤销/保存/导出不受影响。
 */
(function(global){
  const SECTORS=['right','bottom-right','bottom','bottom-left','left','top-left','top','top-right'];
  const MERGE_DISTANCE=24;
  function sectorOf(from,to){
    const dx=to.x-from.x,dy=to.y-from.y;
    if(!Number.isFinite(dx)||!Number.isFinite(dy)||(Math.abs(dx)<1e-9&&Math.abs(dy)<1e-9))return null;
    return SECTORS[((Math.round(Math.atan2(dy,dx)/(Math.PI/4))%8)+8)%8];
  }
  // 端点收拢：key = 节点 id + 方向扇区；组内共享点取各端点坐标的中位数（确定性、不引入随机偏移）。
  function bundleEndpoints(items){
    const collect=side=>{
      const groups=new Map();
      for(const item of items){
        const nodeId=side==='to'?item.toId:item.fromId,self=side==='to'?item.cb:item.ca,other=side==='to'?item.ca:item.cb;
        const point=side==='to'?item.b:item.a;
        if(!nodeId||!point||!self||!other)continue;
        if(side==='to'?item.hasToPort:item.hasFromPort)continue; // 显式端口优先，不收拢
        const sector=sectorOf(other,self);if(!sector)continue;
        const key=nodeId+'|'+sector;
        if(!groups.has(key))groups.set(key,[]);
        groups.get(key).push({id:item.id,point});
      }
      const overrides=new Map();
      for(const group of groups.values()){
        if(group.length<2)continue;
        const xs=group.map(g=>g.point.x).sort((m,n)=>m-n),ys=group.map(g=>g.point.y).sort((m,n)=>m-n);
        const shared={x:xs[Math.floor(xs.length/2)],y:ys[Math.floor(ys.length/2)]};
        for(const g of group)overrides.set(g.id,shared);
      }
      return overrides;
    };
    const map=new Map();
    for(const [id,point] of collect('from'))map.set(id,{from:point});
    for(const [id,point] of collect('to'))map.set(id,{...(map.get(id)||{}),to:point});
    return map;
  }
  // 通道对齐：value 相差 ≤ 阈值且区间 [lo,hi] 有重叠的平行主干归为一簇，吸附到簇内中位数。
  function snapChannels(trunks){
    const byAxis=new Map();
    for(const trunk of trunks){
      if(!byAxis.has(trunk.axis))byAxis.set(trunk.axis,[]);
      byAxis.get(trunk.axis).push(trunk);
    }
    const result=new Map();
    for(const [,list] of byAxis){
      const sorted=[...list].sort((m,n)=>m.value-n.value),cluster=[];
      const flush=()=>{
        if(cluster.length>=2&&new Set(cluster.map(t=>t.edgeId??t.id)).size>=2){
          const values=cluster.map(t=>t.value).sort((m,n)=>m-n);
          const channel=values[Math.floor(values.length/2)];
          for(const t of cluster)result.set(t.id,channel);
        }
        cluster.length=0;
      };
      for(const trunk of sorted){
        if(cluster.length&&Math.abs(trunk.value-cluster[0].value)>MERGE_DISTANCE){flush();cluster.push(trunk);continue}
        const overlap=cluster.every(t=>Math.min(t.hi,trunk.hi)>=Math.max(t.lo,trunk.lo));
        if(overlap)cluster.push(trunk);else{flush();cluster.push(trunk)}
      }
      flush();
    }
    return result;
  }
  function plan(items){
    const endpoints=bundleEndpoints(Array.isArray(items)?items:[]);
    const trunks=[];
    for(const item of Array.isArray(items)?items:[]){
      if(item.pathStyle!=='elbow'||item.hasStoredWaypoints||item.hasFromPort||item.hasToPort)continue;
      const a=item.a,b=item.b;if(!a||!b)continue;
      const horizontal=Math.abs(item.cb.x-item.ca.x)>=Math.abs(item.cb.y-item.ca.y);
      trunks.push({id:item.id,axis:horizontal?'x':'y',
        value:horizontal?(a.x+b.x)/2:(a.y+b.y)/2,
        lo:horizontal?Math.min(a.y,b.y):Math.min(a.x,b.x),
        hi:horizontal?Math.max(a.y,b.y):Math.max(a.x,b.x)});
    }
    const segments=[],segmentChannels=new Map();
    for(const item of Array.isArray(items)?items:[]){
      if(item.pathStyle!=='elbow'||!Array.isArray(item.waypoints))continue;
      const guides=global.KGGraphEdgeGeometry?.orthogonalWaypoints?global.KGGraphEdgeGeometry.orthogonalWaypoints(item.a,item.b,item.waypoints,item.fromPort,item.toPort):item.waypoints;
      for(let i=0;i<guides.length-1;i++){
        const a=guides[i],b=guides[i+1];
        if(a.x===b.x&&a.y!==b.y)segments.push({id:JSON.stringify([item.id,i]),edgeId:item.id,index:i,start:a,end:b,axis:'x',value:a.x,lo:Math.min(a.y,b.y),hi:Math.max(a.y,b.y)});
        else if(a.y===b.y&&a.x!==b.x)segments.push({id:JSON.stringify([item.id,i]),edgeId:item.id,index:i,start:a,end:b,axis:'y',value:a.y,lo:Math.min(a.x,b.x),hi:Math.max(a.x,b.x)});
      }
    }
    const snapped=snapChannels(segments);
    for(const segment of segments){
      if(!snapped.has(segment.id))continue;
      if(!segmentChannels.has(segment.edgeId))segmentChannels.set(segment.edgeId,[]);
      segmentChannels.get(segment.edgeId).push({index:segment.index,axis:segment.axis,value:snapped.get(segment.id),start:segment.start,end:segment.end});
    }
    return {endpoints,channels:snapChannels(trunks),segmentChannels};
  }
  const api=Object.freeze({plan,sectorOf,snapChannels,MERGE_DISTANCE});
  global.KGGraphEdgeBundle=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
