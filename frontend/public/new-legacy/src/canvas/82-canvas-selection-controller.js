'use strict';

/*
 * CanvasSelectionController v1
 * 统一画布框选、多选、组拖动、对齐、分布与尺寸统一。
 */
(function(global){
  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
  const cloneLayout=layout=>({
    x:finite(layout?.x,0),
    y:finite(layout?.y,0),
    width:Math.max(1,finite(layout?.width,1)),
    height:Math.max(1,finite(layout?.height,1))
  });
  const rectOverlap=(a,b)=>!(a.right<b.left||a.left>b.right||a.bottom<b.top||a.top>b.bottom);

  function create(options={}){
    const viewport=options.viewport;
    const cards=options.cards;
    if(!viewport||!cards)throw new Error('CanvasSelectionController requires viewport and cards');
    const selectionBox=options.selectionBox||null;
    const getZoom=typeof options.getZoom==='function'?options.getZoom:()=>1;
    const isMobile=typeof options.isMobile==='function'?options.isMobile:()=>false;
    const canSelect=typeof options.canSelect==='function'?options.canSelect:()=>true;
    const onSelectionChange=typeof options.onSelectionChange==='function'?options.onSelectionChange:()=>{};
    const onPreview=typeof options.onPreview==='function'?options.onPreview:()=>{};
    const selectedIds=new Set();
    let anchorId='';
    let boxGesture=null;
    let groupGesture=null;

    function layoutOf(record){return record?.layout||record?.node||null}
    function recordById(id){return cards.get?.(String(id||''))||cards.records?.get?.(String(id||''))||null}
    function records(){return cards.list?.()||[...(cards.records?.values?.()||[])]}
    function selectedRecords(){return [...selectedIds].map(recordById).filter(Boolean)}
    function emit(reason='selection'){
      onSelectionChange({reason,ids:[...selectedIds],records:selectedRecords(),anchorId});
    }
    function refresh(reason='refresh'){
      [...selectedIds].forEach(id=>{if(!recordById(id))selectedIds.delete(id)});
      if(anchorId&&!selectedIds.has(anchorId))anchorId=selectedIds.values().next().value||'';
      emit(reason);
      return selectedIds.size;
    }
    function set(ids=[],settings={}){
      selectedIds.clear();
      (ids||[]).map(String).forEach(id=>{if(recordById(id))selectedIds.add(id)});
      const requested=String(settings.anchorId||'');
      anchorId=requested&&selectedIds.has(requested)?requested:(selectedIds.values().next().value||'');
      emit(settings.reason||'set');
      return selectedIds.size;
    }
    function clear(settings={}){return set([],settings)}
    function toggle(id,settings={}){
      id=String(id||'');
      if(!recordById(id))return selectedIds.size;
      if(selectedIds.has(id))selectedIds.delete(id);
      else{selectedIds.add(id);anchorId=id}
      if(anchorId&&!selectedIds.has(anchorId))anchorId=selectedIds.values().next().value||'';
      emit(settings.reason||'toggle');
      return selectedIds.size;
    }
    function captureLayouts(input=selectedRecords()){
      const map={};
      (input||[]).forEach(item=>{
        const record=typeof item==='string'?recordById(item):item;
        const layout=layoutOf(record);
        if(record&&layout)map[String(record.id)]=cloneLayout(layout);
      });
      return map;
    }
    function restoreLayouts(snapshot={},settings={}){
      const changed=[];
      Object.entries(snapshot||{}).forEach(([id,next])=>{
        const record=recordById(id);
        const layout=layoutOf(record);
        if(!record||!layout)return;
        Object.assign(layout,cloneLayout(next));
        cards.apply?.(record);
        changed.push(record);
      });
      if(changed.length)onPreview({reason:settings.reason||'restore',records:changed});
      return changed;
    }
    function localPoint(event){
      const rect=viewport.getBoundingClientRect();
      return {x:event.clientX-rect.left,y:event.clientY-rect.top};
    }
    function normalizedRect(a,b){
      const left=Math.min(a.x,b.x),top=Math.min(a.y,b.y),right=Math.max(a.x,b.x),bottom=Math.max(a.y,b.y);
      return {left,top,right,bottom,width:right-left,height:bottom-top};
    }
    function worldRect(screenRect){
      const zoom=Math.max(.0001,finite(getZoom(),1));
      const worldState=options.getViewportState?.()||{x:0,y:0};
      return {
        left:(screenRect.left-finite(worldState.x,0))/zoom,
        top:(screenRect.top-finite(worldState.y,0))/zoom,
        right:(screenRect.right-finite(worldState.x,0))/zoom,
        bottom:(screenRect.bottom-finite(worldState.y,0))/zoom
      };
    }
    function recordRect(record){
      const layout=layoutOf(record)||{};
      const left=finite(layout.x,0),top=finite(layout.y,0);
      return {left,top,right:left+Math.max(1,finite(layout.width,1)),bottom:top+Math.max(1,finite(layout.height,1))};
    }
    function paintBox(rect){
      if(!selectionBox)return;
      selectionBox.hidden=false;
      selectionBox.style.left=Math.round(rect.left)+'px';
      selectionBox.style.top=Math.round(rect.top)+'px';
      selectionBox.style.width=Math.round(rect.width)+'px';
      selectionBox.style.height=Math.round(rect.height)+'px';
    }
    function hideBox(){if(selectionBox)selectionBox.hidden=true}
    function beginBox(event,settings={}){
      if(isMobile()||event.button!==0||canSelect('box',event)===false)return false;
      if(typeof settings.shouldStart==='function'&&!settings.shouldStart(event))return false;
      const start=localPoint(event);
      boxGesture={
        pointerId:event.pointerId,
        start,
        last:start,
        moved:false,
        additive:!!(settings.additive??(event.ctrlKey||event.metaKey)),
        baseIds:new Set(selectedIds)
      };
      viewport.setPointerCapture?.(event.pointerId);
      paintBox({...start,left:start.x,top:start.y,right:start.x,bottom:start.y,width:0,height:0});
      event.preventDefault?.();
      return true;
    }
    function moveBox(event){
      if(!boxGesture||boxGesture.pointerId!==event.pointerId)return false;
      const current=localPoint(event);
      boxGesture.last=current;
      if(Math.hypot(current.x-boxGesture.start.x,current.y-boxGesture.start.y)>4)boxGesture.moved=true;
      const rect=normalizedRect(boxGesture.start,current);
      paintBox(rect);
      const target=worldRect(rect);
      const hits=records().filter(record=>rectOverlap(recordRect(record),target)).map(record=>String(record.id));
      const next=boxGesture.additive?new Set([...boxGesture.baseIds,...hits]):new Set(hits);
      set([...next],{anchorId:hits.at(-1)||anchorId,reason:'box-preview'});
      event.preventDefault?.();
      return true;
    }
    function endBox(event,settings={}){
      if(!boxGesture||boxGesture.pointerId!==event.pointerId)return null;
      const result={moved:boxGesture.moved,ids:[...selectedIds],cancelled:!!settings.cancelled};
      const original=boxGesture;
      boxGesture=null;
      hideBox();
      try{viewport.releasePointerCapture?.(event.pointerId)}catch(error){}
      if(settings.cancelled)set([...original.baseIds],{reason:'box-cancel'});
      else if(!result.moved&&!original.additive)clear({reason:'box-click-clear'});
      result.ids=[...selectedIds];
      event.preventDefault?.();
      return result;
    }
    function beginGroupDrag(event,input=selectedRecords(),settings={}){
      if(isMobile()||event.button!==0||canSelect('move',event)===false)return false;
      const chosen=(input||[]).map(item=>typeof item==='string'?recordById(item):item).filter(Boolean);
      if(!chosen.length)return false;
      const before=captureLayouts(chosen);
      chosen.forEach(record=>record.element?.classList?.add(settings.activeClass||'is-group-dragging'));
      groupGesture={pointerId:event.pointerId,records:chosen,before,startX:event.clientX,startY:event.clientY,moved:false,activeClass:settings.activeClass||'is-group-dragging'};
      viewport.setPointerCapture?.(event.pointerId);
      event.preventDefault?.();
      return true;
    }
    function moveGroupDrag(event){
      if(!groupGesture||groupGesture.pointerId!==event.pointerId)return false;
      const zoom=Math.max(.0001,finite(getZoom(),1));
      const dx=(event.clientX-groupGesture.startX)/zoom;
      const dy=(event.clientY-groupGesture.startY)/zoom;
      if(Math.abs(dx)+Math.abs(dy)>1.5)groupGesture.moved=true;
      groupGesture.records.forEach(record=>{
        const origin=groupGesture.before[String(record.id)];
        const layout=layoutOf(record);
        if(!origin||!layout)return;
        layout.x=origin.x+dx;
        layout.y=origin.y+dy;
        cards.apply?.(record);
      });
      onPreview({reason:'group-drag',records:groupGesture.records});
      return true;
    }
    function endGroupDrag(event,settings={}){
      if(!groupGesture||groupGesture.pointerId!==event.pointerId)return null;
      const gesture=groupGesture;
      groupGesture=null;
      gesture.records.forEach(record=>record.element?.classList?.remove(gesture.activeClass));
      try{viewport.releasePointerCapture?.(event.pointerId)}catch(error){}
      if(settings.cancelled)restoreLayouts(gesture.before,{reason:'group-drag-cancel'});
      return {
        moved:gesture.moved&&!settings.cancelled,
        cancelled:!!settings.cancelled,
        records:gesture.records,
        before:gesture.before,
        after:captureLayouts(gesture.records)
      };
    }
    function arrange(type,settings={}){
      const chosen=selectedRecords();
      if(chosen.length<2)return null;
      const before=captureLayouts(chosen);
      const layouts=chosen.map(record=>({record,layout:layoutOf(record)})).filter(item=>item.layout);
      const anchor=recordById(settings.anchorId||anchorId)||layouts[0]?.record;
      const anchorLayout=layoutOf(anchor)||layouts[0]?.layout;
      const bounds={
        left:Math.min(...layouts.map(item=>finite(item.layout.x,0))),
        top:Math.min(...layouts.map(item=>finite(item.layout.y,0))),
        right:Math.max(...layouts.map(item=>finite(item.layout.x,0)+finite(item.layout.width,0))),
        bottom:Math.max(...layouts.map(item=>finite(item.layout.y,0)+finite(item.layout.height,0)))
      };
      if(type==='align-left')layouts.forEach(item=>item.layout.x=bounds.left);
      else if(type==='align-center')layouts.forEach(item=>item.layout.x=(bounds.left+bounds.right-item.layout.width)/2);
      else if(type==='align-right')layouts.forEach(item=>item.layout.x=bounds.right-item.layout.width);
      else if(type==='align-top')layouts.forEach(item=>item.layout.y=bounds.top);
      else if(type==='align-middle')layouts.forEach(item=>item.layout.y=(bounds.top+bounds.bottom-item.layout.height)/2);
      else if(type==='align-bottom')layouts.forEach(item=>item.layout.y=bounds.bottom-item.layout.height);
      else if(type==='same-width')layouts.forEach(item=>item.layout.width=anchorLayout.width);
      else if(type==='same-height')layouts.forEach(item=>item.layout.height=anchorLayout.height);
      else if(type==='same-size')layouts.forEach(item=>{item.layout.width=anchorLayout.width;item.layout.height=anchorLayout.height});
      else if(type==='distribute-x'&&layouts.length>=3){
        const sorted=[...layouts].sort((a,b)=>a.layout.x-b.layout.x);
        const totalWidth=sorted.reduce((sum,item)=>sum+item.layout.width,0);
        const gap=((bounds.right-bounds.left)-totalWidth)/(sorted.length-1);
        let cursor=bounds.left;
        sorted.forEach(item=>{item.layout.x=cursor;cursor+=item.layout.width+gap});
      }else if(type==='distribute-y'&&layouts.length>=3){
        const sorted=[...layouts].sort((a,b)=>a.layout.y-b.layout.y);
        const totalHeight=sorted.reduce((sum,item)=>sum+item.layout.height,0);
        const gap=((bounds.bottom-bounds.top)-totalHeight)/(sorted.length-1);
        let cursor=bounds.top;
        sorted.forEach(item=>{item.layout.y=cursor;cursor+=item.layout.height+gap});
      }else return null;
      layouts.forEach(item=>cards.apply?.(item.record));
      onPreview({reason:type,records:chosen});
      return {type,records:chosen,before,after:captureLayouts(chosen),anchorId:String(anchor?.id||'')};
    }
    function cancel(){
      if(groupGesture){
        groupGesture.records.forEach(record=>record.element?.classList?.remove(groupGesture.activeClass));
        restoreLayouts(groupGesture.before,{reason:'cancel'});
        groupGesture=null;
      }
      if(boxGesture)set([...boxGesture.baseIds],{reason:'box-cancel'});
      boxGesture=null;hideBox();
    }

    return Object.freeze({
      selectedIds,
      set,clear,toggle,refresh,
      selectedRecords,
      getAnchorId:()=>anchorId,
      captureLayouts,restoreLayouts,
      beginBox,moveBox,endBox,hasBox:()=>!!boxGesture,
      beginGroupDrag,moveGroupDrag,endGroupDrag,hasGroupDrag:()=>!!groupGesture,
      arrange,cancel
    });
  }

  global.KGCanvasSelectionController=Object.freeze({create});
})(window);
