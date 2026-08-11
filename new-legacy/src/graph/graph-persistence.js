'use strict';

(function(global){
  function clone(value){
    try{return JSON.parse(JSON.stringify(value))}catch(error){return value}
  }
  function hydrate(raw={},options={}){
    const model=global.KGGraphModel;
    const state=raw&&typeof raw==='object'?clone(raw):{};
    if(model&&typeof model.normalizeGraph==='function')return model.normalizeGraph(state,options);
    return state;
  }
  function toStorageState(state={},options={}){
    const copy=options.clone===false?state:clone(state||{});
    const model=global.KGGraphModel;
    if(model&&Array.isArray(copy.nodes))copy.nodes=copy.nodes.map(node=>model.normalizeNode(node));
    if(model&&Array.isArray(copy.elements)&&typeof model.normalizeTextElement==='function')copy.elements=copy.elements.map(item=>model.normalizeTextElement(item));
    if(options.stripTransient!==false){
      copy.selectedNodeId=null;
      copy.selectedLinkId=null;
      copy.selectedElementId=null;
      copy.linkSourceId=null;
    }
    return copy;
  }
  function isLegacyNode(node){return !!(node&&(!node.content||!node.appearance||!node.geometry))}
  function migrationSummary(state={}){
    const nodes=Array.isArray(state.nodes)?state.nodes:[];
    const legacyNodes=nodes.filter(isLegacyNode).length;
    return{nodeCount:nodes.length,legacyNodes,requiresMigration:legacyNodes>0};
  }
  global.KGGraphPersistence=Object.freeze({hydrate,toStorageState,isLegacyNode,migrationSummary});
})(typeof window!=='undefined'?window:globalThis);
