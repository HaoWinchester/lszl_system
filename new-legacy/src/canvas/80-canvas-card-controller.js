'use strict';

/*
 * CanvasCardController v1
 * 统一卡片注册、布局应用、边界计算和拖动手势。
 */
(function(global){
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;

  function normalizeLayout(layout={},constraints={}){
    const minWidth=Math.max(40,finite(constraints.minWidth,260));
    const minHeight=Math.max(40,finite(constraints.minHeight,170));
    const maxWidth=Math.max(minWidth,finite(constraints.maxWidth,1400));
    const maxHeight=Math.max(minHeight,finite(constraints.maxHeight,1000));
    return {
      x:finite(layout.x,0),
      y:finite(layout.y,0),
      width:clamp(finite(layout.width,360),minWidth,maxWidth),
      height:clamp(finite(layout.height,240),minHeight,maxHeight)
    };
  }
  function create(options={}){
    const records=new Map();
    const viewport=options.viewport||null;
    const getZoom=typeof options.getZoom==='function'?options.getZoom:()=>1;
    const isMobile=typeof options.isMobile==='function'?options.isMobile:()=>false;
    const onLayoutChange=typeof options.onLayoutChange==='function'?options.onLayoutChange:()=>{};
    const customApply=typeof options.applyLayout==='function'?options.applyLayout:null;
    const onAfterApply=typeof options.onAfterApply==='function'?options.onAfterApply:()=>{};
    const policyApi=options.policy&&typeof options.policy.can==='function'
      ?options.policy
      :global.KGCanvasPolicy?.create?.(options.policy||{})||{can:()=>true,allowsCardType:()=>true};
    let dragGesture=null;

    function recordLayout(record){
      return record?.layout||record?.node||null;
    }
    function syncLayout(record,next){
      const target=recordLayout(record);
      if(!target)return null;
      Object.assign(target,next);
      return target;
    }
    function constraintsFor(element={},record={}){
      const dataset=element.dataset||{};
      return {
        minWidth:finite(record.minWidth,finite(dataset.minWidth,options.minWidth||260)),
        minHeight:finite(record.minHeight,finite(dataset.minHeight,options.minHeight||170)),
        maxWidth:finite(record.maxWidth,finite(dataset.maxWidth,options.maxWidth||1400)),
        maxHeight:finite(record.maxHeight,finite(dataset.maxHeight,options.maxHeight||1000))
      };
    }
    function apply(record){
      if(!record?.element)return false;
      const layout=recordLayout(record);
      if(!layout)return false;
      if(customApply){
        customApply(record,{layout,isMobile:isMobile()});
      }else if(isMobile()){
        record.element.style.left='';
        record.element.style.top='';
        record.element.style.width='';
        record.element.style.height='';
      }else{
        record.element.style.left=finite(layout.x,0)+'px';
        record.element.style.top=finite(layout.y,0)+'px';
        record.element.style.width=Math.max(1,finite(layout.width,360))+'px';
        record.element.style.height=Math.max(1,finite(layout.height,240))+'px';
      }
      onAfterApply(record);
      return true;
    }
    function register(input={}){
      const id=String(input.id||input.element?.dataset?.canvasCard||input.element?.dataset?.nodeId||'');
      if(!id||!input.element)return null;
      const cardType=String(input.cardType||input.kind||'card');
      if(policyApi.allowsCardType&&policyApi.allowsCardType(cardType)===false)return null;
      const existing=records.get(id);
      const base=normalizeLayout(input.layout||input.node||existing?.layout||existing?.node||{},constraintsFor(input.element,input));
      const record=existing||{};
      Object.assign(record,input,{
        id,
        cardType,
        kind:String(input.kind||cardType),
        element:input.element
      });
      if(input.node){
        record.node=input.node;
        Object.assign(record.node,base);
        record.layout=record.node;
      }else{
        record.layout=input.layout||record.layout||base;
        Object.assign(record.layout,base);
      }
      records.set(id,record);
      apply(record);
      return record;
    }
    function unregister(id,{removeElement=false}={}){
      const record=records.get(String(id||''));
      if(!record)return false;
      records.delete(record.id);
      if(removeElement)record.element?.remove?.();
      return true;
    }
    function clear({removeElements=false}={}){
      if(removeElements)records.forEach(record=>record.element?.remove?.());
      records.clear();
      dragGesture=null;
    }
    function get(id){return records.get(String(id||''))||null}
    function list(filter){
      const result=[...records.values()];
      return typeof filter==='function'?result.filter(filter):result;
    }
    function update(id,nextLayout={},updateOptions={}){
      const record=get(id);
      if(!record)return null;
      const normalized=normalizeLayout(
        {...recordLayout(record),...nextLayout},
        constraintsFor(record.element,record)
      );
      syncLayout(record,normalized);
      apply(record);
      if(updateOptions.persist)onLayoutChange(record,{reason:updateOptions.reason||'update'});
      return record;
    }
    function applyAll(filter){
      list(filter).forEach(apply);
    }
    function bounds(filter){
      const selected=list(filter).filter(record=>{
        const layout=recordLayout(record);
        return layout&&Number.isFinite(Number(layout.x))&&Number.isFinite(Number(layout.y));
      });
      if(!selected.length)return null;
      const left=Math.min(...selected.map(record=>finite(recordLayout(record).x,0)));
      const top=Math.min(...selected.map(record=>finite(recordLayout(record).y,0)));
      const right=Math.max(...selected.map(record=>{
        const layout=recordLayout(record);
        return finite(layout.x,0)+Math.max(1,finite(layout.width,1));
      }));
      const bottom=Math.max(...selected.map(record=>{
        const layout=recordLayout(record);
        return finite(layout.y,0)+Math.max(1,finite(layout.height,1));
      }));
      return {left,top,right,bottom,width:right-left,height:bottom-top};
    }
    function beginDrag(event,recordOrId,dragOptions={}){
      if(isMobile()||policyApi.can('cardMove')===false||event.button!==0)return false;
      const record=typeof recordOrId==='string'?get(recordOrId):recordOrId;
      const layout=recordLayout(record);
      if(!record||!layout)return false;
      if(typeof dragOptions.shouldStart==='function'&&!dragOptions.shouldStart(event,record))return false;
      dragGesture={
        pointerId:event.pointerId,
        startX:event.clientX,
        startY:event.clientY,
        originX:finite(layout.x,0),
        originY:finite(layout.y,0),
        record,
        moved:false
      };
      record.element?.classList?.add(String(dragOptions.activeClass||'is-dragging'));
      viewport?.setPointerCapture?.(event.pointerId);
      event.preventDefault?.();
      return true;
    }
    function moveDrag(event){
      if(!dragGesture||dragGesture.pointerId!==event.pointerId)return false;
      const zoom=Math.max(.0001,finite(getZoom(),1));
      const dx=(event.clientX-dragGesture.startX)/zoom;
      const dy=(event.clientY-dragGesture.startY)/zoom;
      if(Math.abs(dx)+Math.abs(dy)>1.5)dragGesture.moved=true;
      syncLayout(dragGesture.record,{
        ...recordLayout(dragGesture.record),
        x:dragGesture.originX+dx,
        y:dragGesture.originY+dy
      });
      apply(dragGesture.record);
      return true;
    }
    function endDrag(event,endOptions={}){
      if(!dragGesture||dragGesture.pointerId!==event.pointerId)return null;
      const result={record:dragGesture.record,moved:dragGesture.moved};
      dragGesture.record.element?.classList?.remove(String(endOptions.activeClass||'is-dragging'));
      dragGesture=null;
      if(endOptions.persist!==false)onLayoutChange(result.record,{reason:endOptions.reason||'drag'});
      return result;
    }
    function cancelDrag(){
      if(!dragGesture)return false;
      dragGesture.record.element?.classList?.remove('is-dragging');
      dragGesture=null;
      return true;
    }

    return Object.freeze({
      records,
      register,
      unregister,
      clear,
      get,
      list,
      update,
      apply,
      applyAll,
      bounds,
      beginDrag,
      moveDrag,
      endDrag,
      cancelDrag,
      hasDrag:()=>!!dragGesture,
      getDrag:()=>dragGesture?{record:dragGesture.record,moved:dragGesture.moved}:null,
      normalizeLayout
    });
  }

  global.KGCanvasCardController=Object.freeze({
    normalizeLayout,
    create
  });
})(window);
