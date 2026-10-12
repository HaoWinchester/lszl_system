'use strict';

(function(global){
  function clone(value){
    try{return JSON.parse(JSON.stringify(value))}catch(error){return value}
  }
  function normalizePort(value){return ['auto','top','right','bottom','left'].includes(value)?value:'auto'}
  function normalizeLinkPorts(link){if(!link||typeof link!=='object')return link;return{...link,fromPort:normalizePort(link.fromPort),toPort:normalizePort(link.toPort)}}
  function hydrate(raw={},options={}){
    const model=global.KGGraphModel;
    const state=raw&&typeof raw==='object'?clone(raw):{};
    const graph=model&&typeof model.normalizeGraph==='function'?model.normalizeGraph(state,options):state;
    if(Array.isArray(graph.links))graph.links=graph.links.map(normalizeLinkPorts);
    return graph;
  }
  function toStorageState(state={},options={}){
    const copy=options.clone===false?state:clone(state||{});
    const model=global.KGGraphModel;
    if(model&&Array.isArray(copy.nodes))copy.nodes=copy.nodes.map(node=>model.normalizeNode(node));
    if(model&&Array.isArray(copy.elements)&&typeof model.normalizeTextElement==='function')copy.elements=copy.elements.map(item=>model.normalizeTextElement(item));
    if(Array.isArray(copy.links))copy.links=copy.links.map(normalizeLinkPorts);
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
  global.KGGraphPersistence=Object.freeze({hydrate,toStorageState,isLegacyNode,migrationSummary,normalizePort,normalizeLinkPorts});
})(typeof window!=='undefined'?window:globalThis);
