'use strict';

/*
 * CanvasAlignmentController v1
 * 统一移动吸附、坐标索引与屏幕级参考线覆盖层。
 */
(function(global){
  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  const layoutOf=record=>record?.layout||record?.node||record?.geometry||record||null;
  function rectOf(record){
    const layout=layoutOf(record)||{};
    const left=finite(layout.x,finite(layout.left,0)),top=finite(layout.y,finite(layout.top,0));
    const width=Math.max(1,finite(layout.width,finite(layout.w,1))),height=Math.max(1,finite(layout.height,finite(layout.h,1)));
    return {left,top,right:left+width,bottom:top+height,width,height,centerX:left+width/2,centerY:top+height/2};
  }
  function union(rects=[]){
    if(!rects.length)return {left:0,top:0,right:0,bottom:0,width:0,height:0,centerX:0,centerY:0};
    const left=Math.min(...rects.map(r=>r.left)),top=Math.min(...rects.map(r=>r.top)),right=Math.max(...rects.map(r=>r.right)),bottom=Math.max(...rects.map(r=>r.bottom));
    return {left,top,right,bottom,width:right-left,height:bottom-top,centerX:(left+right)/2,centerY:(top+bottom)/2};
  }
  function create(options={}){
    const surface=options.surface||null;
    const host=options.host||surface||null;
    const getZoom=typeof options.getZoom==='function'?options.getZoom:()=>1;
    const getRecords=typeof options.getRecords==='function'?options.getRecords:()=>[];
    const getCanvasBounds=typeof options.getCanvasBounds==='function'?options.getCanvasBounds:()=>null;
    const worldToScreen=typeof options.worldToScreen==='function'?options.worldToScreen:(point=>point);
    const screenThreshold=Math.max(1,finite(options.screenThreshold,7));
    let session=null,root=null,raf=0,pending=null,guideRaf=0,pendingGuides=null;
    function ensureRoot(){
      if(root?.isConnected)return root;
      if(!host||typeof document==='undefined')return null;
      root=document.createElement('div');root.className='uc-alignment-guides';root.hidden=true;root.setAttribute('aria-hidden','true');
      root.innerHTML='<i class="uc-alignment-guide is-vertical"></i><i class="uc-alignment-guide is-horizontal"></i>';
      host.appendChild(root);return root;
    }
    function candidateEntries(records,movingIds){
      const x=[],y=[];
      for(const record of records||[]){
        const id=String(record?.id||'');
        if(!id||movingIds.has(id)||record?.kind==='edge'||record?.type==='edge')continue;
        const r=rectOf(record);
        x.push({value:r.left,role:'left',rect:r,id},{value:r.centerX,role:'center',rect:r,id},{value:r.right,role:'right',rect:r,id});
        y.push({value:r.top,role:'top',rect:r,id},{value:r.centerY,role:'middle',rect:r,id},{value:r.bottom,role:'bottom',rect:r,id});
      }
      const canvas=getCanvasBounds();
      if(canvas){
        const c={left:finite(canvas.left,0),top:finite(canvas.top,0),right:finite(canvas.right,finite(canvas.width,0)),bottom:finite(canvas.bottom,finite(canvas.height,0))};
        c.centerX=(c.left+c.right)/2;c.centerY=(c.top+c.bottom)/2;
        x.push({value:c.centerX,role:'center',rect:c,id:'__canvas__',canvas:true});
        y.push({value:c.centerY,role:'middle',rect:c,id:'__canvas__',canvas:true});
      }
      x.sort((a,b)=>a.value-b.value);y.sort((a,b)=>a.value-b.value);
      return {x,y};
    }
    function begin(records=[],meta={}){
      const chosen=(records||[]).filter(Boolean);
      if(!chosen.length)return false;
      const movingIds=new Set(chosen.map(record=>String(record.id||'')));
      const startRects=chosen.map(rectOf);
      session={records:chosen,movingIds,startBounds:union(startRects),index:candidateEntries(getRecords(),movingIds),meta};
      clearGuides();
      return true;
    }
    function nearest(entries,value,role,threshold){
      if(!entries?.length)return null;
      let low=0,high=entries.length;
      while(low<high){const mid=(low+high)>>1;if(entries[mid].value<value)low=mid+1;else high=mid}
      let best=null;
      const visit=index=>{
        const entry=entries[index];if(!entry||entry.role!==role)return;
        const delta=entry.value-value,abs=Math.abs(delta);
        if(abs<=threshold&&(!best||abs<best.abs))best={...entry,delta,abs};
      };
      for(let index=low-1;index>=0&&value-entries[index].value<=threshold;index--)visit(index);
      for(let index=low;index<entries.length&&entries[index].value-value<=threshold;index++)visit(index);
      return best;
    }
    function resolve(dx=0,dy=0,meta={}){
      if(!session)return {dx,dy,guides:[]};
      if(meta.altKey){clearGuides();return {dx,dy,guides:[],disabled:true}}
      const zoom=Math.max(.0001,finite(getZoom(),1)),threshold=screenThreshold/zoom;
      const raw={...session.startBounds};
      raw.left+=dx;raw.right+=dx;raw.centerX+=dx;raw.top+=dy;raw.bottom+=dy;raw.centerY+=dy;
      const xMatches=[
        nearest(session.index.x,raw.left,'left',threshold),
        nearest(session.index.x,raw.centerX,'center',threshold),
        nearest(session.index.x,raw.right,'right',threshold)
      ].filter(Boolean).sort((a,b)=>a.abs-b.abs);
      const yMatches=[
        nearest(session.index.y,raw.top,'top',threshold),
        nearest(session.index.y,raw.centerY,'middle',threshold),
        nearest(session.index.y,raw.bottom,'bottom',threshold)
      ].filter(Boolean).sort((a,b)=>a.abs-b.abs);
      const xMatch=xMatches[0]||null,yMatch=yMatches[0]||null;
      const nextDx=dx+(xMatch?.delta||0),nextDy=dy+(yMatch?.delta||0);
      const snapped={...session.startBounds};
      snapped.left+=nextDx;snapped.right+=nextDx;snapped.centerX+=nextDx;snapped.top+=nextDy;snapped.bottom+=nextDy;snapped.centerY+=nextDy;
      const guides=[];
      if(xMatch){
        const target=xMatch.rect||snapped;
        guides.push({axis:'x',value:xMatch.value,from:Math.min(snapped.top,finite(target.top,snapped.top)),to:Math.max(snapped.bottom,finite(target.bottom,snapped.bottom)),targetId:xMatch.id,canvas:!!xMatch.canvas});
      }
      if(yMatch){
        const target=yMatch.rect||snapped;
        guides.push({axis:'y',value:yMatch.value,from:Math.min(snapped.left,finite(target.left,snapped.left)),to:Math.max(snapped.right,finite(target.right,snapped.right)),targetId:yMatch.id,canvas:!!yMatch.canvas});
      }
      scheduleGuideRender(guides);
      return {dx:nextDx,dy:nextDy,guides,threshold};
    }
    function scheduleGuideRender(guides=[]){
      pendingGuides=guides;
      if(guideRaf)return true;
      const request=global.requestAnimationFrame||((fn)=>global.setTimeout(fn,16));
      guideRaf=request(()=>{guideRaf=0;const next=pendingGuides||[];pendingGuides=null;renderGuides(next)});
      return true;
    }
    function renderGuides(guides=[]){
      const overlay=ensureRoot();if(!overlay)return false;
      const vertical=overlay.querySelector('.is-vertical'),horizontal=overlay.querySelector('.is-horizontal');
      const xGuide=guides.find(g=>g.axis==='x'),yGuide=guides.find(g=>g.axis==='y');
      if(xGuide){
        const a=worldToScreen({x:xGuide.value,y:xGuide.from}),b=worldToScreen({x:xGuide.value,y:xGuide.to});
        vertical.hidden=false;vertical.style.left=Math.round(a.x)+'px';vertical.style.top=Math.round(Math.min(a.y,b.y))+'px';vertical.style.height=Math.max(1,Math.round(Math.abs(b.y-a.y)))+'px';
      }else vertical.hidden=true;
      if(yGuide){
        const a=worldToScreen({x:yGuide.from,y:yGuide.value}),b=worldToScreen({x:yGuide.to,y:yGuide.value});
        horizontal.hidden=false;horizontal.style.left=Math.round(Math.min(a.x,b.x))+'px';horizontal.style.top=Math.round(a.y)+'px';horizontal.style.width=Math.max(1,Math.round(Math.abs(b.x-a.x)))+'px';
      }else horizontal.hidden=true;
      overlay.hidden=!xGuide&&!yGuide;return true;
    }
    function schedule(dx,dy,meta={},callback=()=>{}){
      pending={dx,dy,meta,callback};
      if(raf)return true;
      const request=global.requestAnimationFrame||((fn)=>global.setTimeout(fn,16));
      raf=request(()=>{raf=0;const task=pending;pending=null;if(!task)return;task.callback(resolve(task.dx,task.dy,task.meta))});
      return true;
    }
    function clearGuides(){pendingGuides=null;if(guideRaf){(global.cancelAnimationFrame||global.clearTimeout)(guideRaf);guideRaf=0}if(root){root.hidden=true;root.querySelectorAll('.uc-alignment-guide').forEach(el=>el.hidden=true)}}
    function end(){session=null;pending=null;if(raf){(global.cancelAnimationFrame||global.clearTimeout)(raf);raf=0}clearGuides();return true}
    function destroy(){end();root?.remove();root=null}
    return Object.freeze({begin,resolve,schedule,end,clearGuides,isActive:()=>!!session,destroy,rectOf,union});
  }
  global.KGCanvasAlignmentController=Object.freeze({create,rectOf,union});
})(typeof window!=='undefined'?window:globalThis);
