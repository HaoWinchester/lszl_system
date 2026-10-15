'use strict';

(function(global){
  const point=(x,y)=>({x,y});
  function curvePoint(start,end,controls,t){
    const u=1-t,a=u*u*u,b=3*u*u*t,c=3*u*t*t,d=t*t*t;
    return point(a*start.x+b*controls[0].x+c*controls[1].x+d*end.x,
      a*start.y+b*controls[0].y+c*controls[1].y+d*end.y);
  }
  function curveHandles(start,controls,end){return[curvePoint(start,end,controls,1/3),curvePoint(start,end,controls,2/3)]}
  function controlsFromHandles(start,handles,end){
    // At t=1/3 and 2/3, the two unknown controls have coefficients
    // [4/9, 2/9] and [2/9, 4/9]. Invert that fixed 2x2 system.
    const residual=(handle,a,b)=>point(handle.x-a*start.x-b*end.x,handle.y-a*start.y-b*end.y);
    const first=residual(handles[0],8/27,1/27),second=residual(handles[1],1/27,8/27);
    return[point(3*first.x-1.5*second.x,3*first.y-1.5*second.y),
      point(3*second.x-1.5*first.x,3*second.y-1.5*first.y)];
  }
  // 折线拖动方向锁定（对齐博思白板）：中间段只能沿自身方向滑动——
  // 两个以上路径点时以首末路径点构成的中间段主导轴为准；单路径点时以整体 a→b 主导轴的垂直方向为准。
  function constrainWaypointDrag(start,end,waypoints,index,point){
    if(!waypoints?.length||index<0||index>=waypoints.length||!point)return point;
    let free;
    if(waypoints.length>=2){
      const first=waypoints[0],last=waypoints[waypoints.length-1];
      free=Math.abs(last.x-first.x)>=Math.abs(last.y-first.y)?'y':'x';
    }else{
      free=Math.abs(end.x-start.x)>=Math.abs(end.y-start.y)?'y':'x';
    }
    return free==='x'?{x:point.x,y:waypoints[index].y}:{x:waypoints[index].x,y:point.y};
  }
  function moveRoute(route,startDelta,endDelta){
    const deltaA=startDelta,deltaB=endDelta,before=[route.start,route.end];
    const axis=point(before[1].x-before[0].x,before[1].y-before[0].y),length2=axis.x*axis.x+axis.y*axis.y;
    const move=(value,index,total)=>{
      if(deltaA.x===deltaB.x&&deltaA.y===deltaB.y)return point(value.x+deltaA.x,value.y+deltaA.y);
      const t=length2>1e-12?Math.max(0,Math.min(1,((value.x-before[0].x)*axis.x+(value.y-before[0].y)*axis.y)/length2)):(index+1)/(total+1);
      return point(value.x+deltaA.x*(1-t)+deltaB.x*t,value.y+deltaA.y*(1-t)+deltaB.y*t);
    };
    const result={...route,start:point(route.start.x+deltaA.x,route.start.y+deltaA.y),end:point(route.end.x+deltaB.x,route.end.y+deltaB.y)};
    for(const key of ['curveControls','waypoints'])if(Array.isArray(route[key]))result[key]=route[key].map((value,index,all)=>move(value,index,all.length));
    if(route.fromPoint)result.fromPoint=point(route.fromPoint.x+deltaA.x,route.fromPoint.y+deltaA.y);
    if(route.toPoint)result.toPoint=point(route.toPoint.x+deltaB.x,route.toPoint.y+deltaB.y);
    return result;
  }
  function portDirection(port){
    switch(port){case 'top':return point(0,-1);case 'right':return point(1,0);case 'bottom':return point(0,1);case 'left':return point(-1,0);default:return null}
  }
  function portPoint(nodeGeometry,port,oppositeCenter){
    const {x,y,width,height,cardStyle='standard'}=nodeGeometry;
    const center=point(x+width/2,y+height/2);
    const ray=portDirection(port)||point(oppositeCenter.x-center.x,oppositeCenter.y-center.y);
    if(Math.hypot(ray.x,ray.y)<.001)return center;
    if(cardStyle==='circle'){
      const rx=Math.max(1,width/2),ry=Math.max(1,height/2),t=1/Math.sqrt(ray.x*ray.x/(rx*rx)+ray.y*ray.y/(ry*ry));
      return point(center.x+ray.x*t,center.y+ray.y*t);
    }
    if(cardStyle==='triangle'){
      const vertices=[point(center.x,y),point(x+width,y+height),point(x,y+height)];
      let best=null;
      for(let i=0;i<vertices.length;i++){
        const a=vertices[i],b=vertices[(i+1)%vertices.length],segment=point(b.x-a.x,b.y-a.y),offset=point(a.x-center.x,a.y-center.y);
        const cross=(a,b)=>a.x*b.y-a.y*b.x,denominator=cross(ray,segment);
        if(Math.abs(denominator)<1e-9)continue;
        const t=cross(offset,segment)/denominator,u=cross(offset,ray)/denominator;
        if(t>=0&&u>=0&&u<=1&&(best===null||t<best))best=t;
      }
      return best===null?center:point(center.x+ray.x*best,center.y+ray.y*best);
    }
    return Math.abs(ray.x)>=Math.abs(ray.y)
      ?point(center.x+Math.sign(ray.x||1)*width/2,center.y)
      :point(center.x,center.y+Math.sign(ray.y||1)*height/2);
  }
  const api=Object.freeze({curveHandles,controlsFromHandles,constrainWaypointDrag,moveRoute,portPoint,portDirection});
  global.KGGraphEdgeGeometry=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
