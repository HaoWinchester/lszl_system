'use strict';

/*
 * CanvasKernel v1
 * 统一画布底座：策略、视口和卡片控制器。业务控制器只负责学习流程或多题工作区语义。
 */
(function(global){
  const instances=new Map();

  function create(options={}){
    const id=String(options.id||'canvas-'+Date.now().toString(36));
    const policy=options.policy&&typeof options.policy.can==='function'
      ?options.policy
      :global.KGCanvasPolicy?.create?.(options.policy||{})||null;
    if(!policy)throw new Error('CanvasKernel requires KGCanvasPolicy');

    const plugins=new Map();
    const pluginCleanups=new Map();
    function callPlugins(hook,payload){
      plugins.forEach(plugin=>{
        try{plugin?.[hook]?.(payload)}catch(error){
          console.error('CanvasKernel plugin hook failed',plugin?.id||'anonymous',hook,error);
        }
      });
    }

    const viewport=global.KGCanvasViewportController?.create?.({
      viewport:options.viewport,
      world:options.world,
      initial:options.initialViewport,
      mobile:!!options.mobile,
      minZoom:options.minZoom,
      maxZoom:options.maxZoom,
      gridPrefix:options.gridPrefix,
      gridLodAttribute:options.gridLodAttribute,
      smoothClass:options.smoothClass,
      persistDelay:options.persistDelay,
      baseWorldGrid:options.baseWorldGrid,
      minGridScreen:options.minGridScreen,
      maxGridScreen:options.maxGridScreen,
      majorGridMultiple:options.majorGridMultiple,
      policy,
      onApply:options.onViewportApply,
      onPersist:options.onViewportPersist,
      afterApply:options.afterViewportApply
    });
    if(!viewport)throw new Error('CanvasKernel requires KGCanvasViewportController');

    const cards=global.KGCanvasCardController?.create?.({
      viewport:options.viewport,
      policy,
      getZoom:()=>viewport.getState().zoom,
      isMobile:()=>viewport.getState().mobile,
      minWidth:options.minCardWidth,
      minHeight:options.minCardHeight,
      maxWidth:options.maxCardWidth,
      maxHeight:options.maxCardHeight,
      onLayoutChange:options.onCardLayoutChange,
      applyLayout:options.applyCardLayout,
      onAfterApply:options.afterCardApply,
      resolveMovement:options.resolveCardMovement
    });
    if(!cards)throw new Error('CanvasKernel requires KGCanvasCardController');

    const history=options.history===false?null:global.KGCanvasHistoryController?.create?.({
      limit:options.historyLimit,
      onChange:options.onHistoryChange
    })||null;
    const selection=options.selection===false?null:global.KGCanvasSelectionController?.create?.({
      viewport:options.viewport,
      cards,
      selectionBox:options.selectionBox,
      getZoom:()=>viewport.getState().zoom,
      getViewportState:()=>viewport.getState(),
      isMobile:()=>viewport.getState().mobile,
      canSelect:options.canSelectCards||(()=>policy.can('cardMove')!==false),
      isInteractionUI:options.isSelectionInteractionUI,
      onSelectionChange:options.onSelectionChange,
      onPreview:options.onSelectionPreview,
      resolveMovement:options.resolveSelectionMovement
    })||null;

    let destroyed=false;
    const api={
      id,
      policy,
      viewport,
      cards,
      selection,
      history,
      use(plugin={}){
        const pluginId=String(plugin.id||plugin.name||'plugin-'+(plugins.size+1));
        if(plugins.has(pluginId))return false;
        const normalized={...plugin,id:pluginId};
        plugins.set(pluginId,normalized);
        let cleanup=null;
        try{
          cleanup=normalized.setup?.({
            kernel:api,
            policy,
            viewport,
            cards
          });
        }catch(error){
          plugins.delete(pluginId);
          throw error;
        }
        if(typeof cleanup==='function')pluginCleanups.set(pluginId,cleanup);
        try{normalized.onInstalled?.({kernel:api,pluginId})}catch(error){
          console.error('CanvasKernel plugin install hook failed',pluginId,error);
        }
        return pluginId;
      },
      removePlugin(pluginId){
        pluginId=String(pluginId||'');
        if(!plugins.has(pluginId))return false;
        try{pluginCleanups.get(pluginId)?.()}catch(error){
          console.error('CanvasKernel plugin cleanup failed',pluginId,error);
        }
        pluginCleanups.delete(pluginId);
        plugins.delete(pluginId);
        return true;
      },
      setPolicy(next={}){
        const value=policy.update(next);
        callPlugins('onPolicyChanged',{kernel:api,policy:value});
        return value;
      },
      replacePolicy(next={}){
        const value=policy.replace(next);
        callPlugins('onPolicyChanged',{kernel:api,policy:value});
        return value;
      },
      setMobile(mobile){
        cards.cancelDrag();
        const next=viewport.setMobile(mobile);
        cards.applyAll();
        callPlugins('onResponsiveChanged',{kernel:api,mobile:!!mobile,viewport:next});
        return next;
      },
      registerCard(input){
        const record=cards.register(input);
        if(record)callPlugins('onCardRegistered',{kernel:api,record});
        return record;
      },
      unregisterCard(cardId,opts){
        const record=cards.get(cardId);
        const removed=cards.unregister(cardId,opts);
        if(removed)callPlugins('onCardUnregistered',{kernel:api,record,cardId:String(cardId||'')});
        return removed;
      },
      getState(){
        return {
          id,
          policy:policy.value,
          viewport:viewport.getState(),
          cardCount:cards.records.size,
          selectedCardCount:selection?.selectedIds?.size||0,
          history:history?.getState?.()||null,
          plugins:[...plugins.keys()],
          destroyed
        };
      },
      destroy(){
        if(destroyed)return false;
        destroyed=true;
        callPlugins('onDestroy',{kernel:api});
        [...plugins.keys()].forEach(api.removePlugin);
        selection?.cancel?.();
        history?.clear?.();
        viewport.destroy();
        cards.clear();
        instances.delete(id);
        try{
          global.dispatchEvent(new CustomEvent('kg:canvas-kernel-destroyed',{detail:{id}}));
        }catch(e){}
        return true;
      }
    };
    const frozen=Object.freeze(api);
    instances.set(id,frozen);
    (Array.isArray(options.plugins)?options.plugins:[]).forEach(plugin=>frozen.use(plugin));
    try{
      global.dispatchEvent(new CustomEvent('kg:canvas-kernel-created',{
        detail:{
          id,
          workspaceType:policy.value.workspaceType,
          plugins:frozen.getState().plugins
        }
      }));
    }catch(e){}
    return frozen;
  }

  global.KGCanvasKernel=Object.freeze({
    create,
    get:id=>instances.get(String(id||''))||null,
    list:()=>[...instances.values()],
    destroy:id=>instances.get(String(id||''))?.destroy?.()||false
  });
})(window);
