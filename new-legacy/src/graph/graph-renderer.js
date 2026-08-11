'use strict';

(function(global){
  function create(callbacks={}){
    const counts={full:0,viewport:0,content:0,appearance:0,geometry:0,selection:0,edges:0,header:0};
    const call=(name,options)=>{if(typeof callbacks[name]==='function')callbacks[name](options||{})};
    function render(mode='full',options={}){
      const kind=mode||'full';if(!(kind in counts))counts[kind]=0;counts[kind]++;
      if(kind==='viewport'){call('applyViewport',options)}
      else if(kind==='content'){call('renderHeader',options);if(callbacks.updateCardContent&&options.ids)call('updateCardContent',options);else call('renderCards',options);call('renderDetails',options);call('renderQuickActions',options)}
      else if(kind==='appearance'){call('renderHeader',options);if(callbacks.updateCardAppearance&&options.ids)call('updateCardAppearance',options);else call('renderCards',options);call('renderDetails',options);call('renderQuickActions',options)}
      else if(kind==='geometry'){if(callbacks.updateCardGeometry&&options.ids)call('updateCardGeometry',options);else{call('renderEdges',options);call('renderCards',options)}call('renderDetails',options);call('renderQuickActions',options)}
      else if(kind==='selection'){call('syncModes',options);call('renderHeader',options);call('refreshCardClasses',options);call('refreshEdgeClasses',options);call('renderDetails',options);call('renderQuickActions',options)}
      else if(kind==='edges'){call('renderEdges',options);call('renderDetails',options)}
      else if(kind==='header'){call('renderHeader',options);call('renderQuickActions',options)}
      else{call('syncModes',options);call('applyViewport',options);call('renderHeader',options);call('renderEdges',options);call('renderCards',options);call('renderDetails',options);call('renderEdgeStylePanel',options);call('renderQuickActions',options)}
      if(options.persist&&typeof callbacks.persist==='function')callbacks.persist(options);
      return true;
    }
    function diagnostics(){return{...counts}}
    return Object.freeze({render,diagnostics});
  }
  global.KGGraphRenderer=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
