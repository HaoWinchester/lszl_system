'use strict';
(function(global){
  const FORMAT='kg-graph-fragment',MIME='application/x-kg-graph-fragment+json';
  // Match the existing graph sanitizer; table integration retains its provisional limit.
  const COLLECTION_LIMITS=Object.freeze({nodes:2500,links:5000,elements:1500,tables:2500});
  function clone(value){return JSON.parse(JSON.stringify(value))}
  function validate(value){
    if(!value||value.format!==FORMAT||value.version!==1)throw new Error('Unsupported graph fragment');
    if(!value.source||!Array.isArray(value.source.nodeIds)||value.source.nodeIds.some(id=>typeof id!=='string'))throw new Error('Invalid fragment source');
    const ids=new Set();
    for(const key of ['nodes','links','elements','tables']){
      if(!Array.isArray(value[key])||value[key].length>COLLECTION_LIMITS[key])throw new Error('Invalid fragment collection');
      for(const item of value[key]){
        if(!item||typeof item!=='object'||typeof item.id!=='string'||!item.id||ids.has(item.id))throw new Error('Invalid fragment id');
        ids.add(item.id);
        for(const position of [item,item.geometry].filter(Boolean))for(const field of ['x','y','width','height'])if(position[field]!==undefined&&!Number.isFinite(position[field]))throw new Error('Invalid fragment coordinate');
        for(const key of ['fromPoint','toPoint'])if(item[key]!==undefined&&(!item[key]||!Number.isFinite(item[key].x)||!Number.isFinite(item[key].y)))throw new Error('Invalid fragment endpoint');
        for(const key of ['curveControls','waypoints'])if(item[key]!==undefined&&(!Array.isArray(item[key])||item[key].some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))))throw new Error('Invalid fragment route');
      }
    }
    const nodes=new Set(value.nodes.map(n=>n.id));
    for(const link of value.links)if(!nodes.has(link.from)||!nodes.has(link.to))throw new Error('Fragment contains external link');
    if(!Array.isArray(value.resources))throw new Error('Invalid fragment resources');
    return value;
  }
  function capture(graph,selection={}){
    const nodes=new Set(selection.nodeIds||[]),elements=new Set(selection.elementIds||[]),tables=new Set(selection.tableIds||[]);
    const selectedNodes=(graph.nodes||[]).filter(n=>nodes.has(n.id));
    const selectedElements=(graph.elements||[]).filter(e=>elements.has(e.id)),selectedTables=(graph.tables||[]).filter(t=>tables.has(t.id));
    const references=new Set();
    function collect(value){if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if((key==='resourceId'||key==='assetId')&&typeof item==='string')references.add(item);else if(key==='resourceIds'&&Array.isArray(item))item.forEach(id=>references.add(id));else if(item&&typeof item==='object')collect(item)}}
    [selectedNodes,selectedElements,selectedTables].forEach(collect);
    return validate(clone({format:FORMAT,version:1,nodes:selectedNodes,links:(graph.links||[]).filter(l=>nodes.has(l.from)&&nodes.has(l.to)),elements:selectedElements,tables:selectedTables,resources:(graph.resources||[]).filter(r=>references.has(typeof r==='string'?r:r.id)),source:{fileId:graph.fileId||null,nodeIds:selectedNodes.map(n=>n.id),revision:graph.revision??null}}));
  }
  function remap(value,{idFactory,offset={x:0,y:0}}={}){
    validate(value);if(typeof idFactory!=='function')throw new Error('Missing fragment id factory');
    const fragment=clone(value),idMap=Object.create(null),used=new Set([...value.nodes,...value.links,...value.elements,...value.tables].map(x=>x.id));
    const dx=Number(offset.x)||0,dy=Number(offset.y)||0;
    function move(p){if(!p)return; if(Number.isFinite(p.x))p.x+=dx;if(Number.isFinite(p.y))p.y+=dy}
    for(const key of ['nodes','links','elements','tables'])for(const item of fragment[key]){
      const id=idFactory(key,item.id);if(typeof id!=='string'||!id||used.has(id))throw new Error('Fragment id collision');used.add(id);idMap[item.id]=id;item.id=id;
      if(key!=='links'){move(item);move(item.geometry)}
    }
    for(const link of fragment.links){link.from=idMap[link.from];link.to=idMap[link.to];for(const key of ['curveControls','waypoints'])for(const p of link[key]||[])move(p);move(link.fromPoint);move(link.toPoint)}
    return{fragment,idMap};
  }
  function parse(text){try{if(typeof text!=='string'||text.length>8*1024*1024)return null;return validate(JSON.parse(text))}catch(error){return null}}
  const api=Object.freeze({capture,remap,parse,validate,format:FORMAT,mime:MIME});global.KGGraphFragment=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
