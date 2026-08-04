'use strict';

/*
 * 深度回忆图模型。
 *
 * 只负责节点、边、层级与连接合法性，不访问 DOM、localStorage 或题目数据。
 * 页面控制器通过该模块完成图规范化和删除，便于独立测试并减少主控制器职责。
 */
(function(global){
  function clean(value){return String(value??'').trim()}
  function cloneNode(node){return node&&typeof node==='object'?{...node}:node}
  function cloneEdge(edge){return edge&&typeof edge==='object'?{...edge}:edge}
  function normalizedTitle(value){return clean(value).replace(/\s+/g,' ').toLocaleLowerCase()}

  function nodeIdentity(node,titleResolver){
    const item=node&&typeof node==='object'?node:{};
    const dataId=clean(item.dataId);
    if(!item.custom&&dataId)return 'data::'+dataId;
    const resolvedTitle=clean(item.title||titleResolver?.(item)||'');
    if(item.custom&&resolvedTitle)return 'custom::'+normalizedTitle(resolvedTitle);
    const instanceId=clean(item.instanceId);
    return dataId?'data::'+dataId:(instanceId?'instance::'+instanceId:'');
  }

  function nodeIdSet(nodes){
    return new Set((Array.isArray(nodes)?nodes:[]).map(node=>clean(node?.instanceId)).filter(Boolean));
  }

  function adjacencyFor(nodes,edges){
    const ids=nodeIdSet(nodes);
    const adjacency=new Map([...ids].map(id=>[id,[]]));
    (Array.isArray(edges)?edges:[]).forEach(edge=>{
      const from=clean(edge?.from),to=clean(edge?.to);
      if(!from||!to||from===to||!ids.has(from)||!ids.has(to))return;
      adjacency.get(from).push(to);
    });
    return adjacency;
  }

  function hasDirectedPathIn(adjacency,from,to){
    from=clean(from);to=clean(to);
    if(!from||!to)return false;
    if(from===to)return true;
    const seen=new Set(),stack=[from];
    while(stack.length){
      const current=stack.pop();
      if(seen.has(current))continue;
      seen.add(current);
      for(const next of adjacency.get(current)||[]){
        if(next===to)return true;
        if(!seen.has(next))stack.push(next);
      }
    }
    return false;
  }

  function hasDirectedPath(nodes,edges,from,to){
    return hasDirectedPathIn(adjacencyFor(nodes,edges),from,to);
  }

  function canConnect(nodes,edges,from,to){
    from=clean(from);to=clean(to);
    if(!from||!to||from===to)return false;
    const ids=nodeIdSet(nodes);
    if(!ids.has(from)||!ids.has(to))return false;
    const list=Array.isArray(edges)?edges:[];
    if(list.some(edge=>clean(edge?.from)===from&&clean(edge?.to)===to))return false;
    const adjacency=adjacencyFor(nodes,list);
    if(hasDirectedPathIn(adjacency,from,to))return false;
    if(hasDirectedPathIn(adjacency,to,from))return false;
    return true;
  }

  function recalculateDepths(nodes,edges){
    const nextNodes=(Array.isArray(nodes)?nodes:[]).map(cloneNode).filter(node=>clean(node?.instanceId));
    const ids=nodeIdSet(nextNodes);
    const incoming=new Map([...ids].map(id=>[id,[]]));
    (Array.isArray(edges)?edges:[]).forEach(edge=>{
      const from=clean(edge?.from),to=clean(edge?.to);
      if(!from||!to||from===to||!ids.has(from)||!ids.has(to))return;
      incoming.get(to).push(from);
    });
    const memo=new Map();
    function depthOf(id,visiting=new Set()){
      if(memo.has(id))return memo.get(id);
      if(visiting.has(id))return 0;
      const parents=incoming.get(id)||[];
      if(!parents.length){memo.set(id,0);return 0}
      const nextVisiting=new Set(visiting);nextVisiting.add(id);
      const depth=1+Math.max(0,...parents.map(parentId=>depthOf(parentId,nextVisiting)));
      memo.set(id,depth);return depth;
    }
    nextNodes.forEach(node=>{
      const id=clean(node.instanceId),parents=incoming.get(id)||[];
      node.depth=depthOf(id);
      node.parentId=parents[0]||null;
    });
    return nextNodes;
  }

  function normalizeGraph(graph={},options={}){
    const sourceNodes=Array.isArray(graph.nodes)?graph.nodes:[];
    const sourceEdges=Array.isArray(graph.edges)?graph.edges:[];
    const titleResolver=typeof options.titleResolver==='function'?options.titleResolver:null;
    const identityToNode=new Map(),instanceToCanonical=new Map(),nodes=[];

    sourceNodes.forEach(raw=>{
      const node=cloneNode(raw);
      const instanceId=clean(node?.instanceId);
      if(!instanceId)return;
      if(instanceToCanonical.has(instanceId))return;
      const identity=nodeIdentity(node,titleResolver)||('instance::'+instanceId);
      const canonical=identityToNode.get(identity);
      if(canonical){instanceToCanonical.set(instanceId,canonical.instanceId);return}
      node.instanceId=instanceId;
      identityToNode.set(identity,node);
      instanceToCanonical.set(instanceId,instanceId);
      nodes.push(node);
    });

    const ids=nodeIdSet(nodes),edges=[],edgeKeys=new Set();
    const adjacency=new Map([...ids].map(id=>[id,[]]));
    sourceEdges.forEach(raw=>{
      const edge=cloneEdge(raw);
      const from=instanceToCanonical.get(clean(edge?.from))||clean(edge?.from);
      const to=instanceToCanonical.get(clean(edge?.to))||clean(edge?.to);
      if(!from||!to||from===to||!ids.has(from)||!ids.has(to))return;
      const key=from+'\u0000'+to;
      if(edgeKeys.has(key))return;
      if(hasDirectedPathIn(adjacency,from,to)||hasDirectedPathIn(adjacency,to,from))return;
      edge.from=from;edge.to=to;
      edges.push(edge);edgeKeys.add(key);adjacency.get(from).push(to);
    });

    const activeId=clean(graph.activeNodeId);
    const activeNodeId=activeId?(instanceToCanonical.get(activeId)||activeId):null;
    return {
      nodes:recalculateDepths(nodes,edges),
      edges,
      activeNodeId:ids.has(activeNodeId)?activeNodeId:null,
      replacements:Object.fromEntries([...instanceToCanonical].filter(([from,to])=>from!==to))
    };
  }

  function removeNode(graph={},instanceId=''){
    const id=clean(instanceId);
    const sourceNodes=Array.isArray(graph.nodes)?graph.nodes:[];
    const removedNode=sourceNodes.find(node=>clean(node?.instanceId)===id)||null;
    if(!removedNode)return {nodes:sourceNodes.map(cloneNode),edges:(Array.isArray(graph.edges)?graph.edges:[]).map(cloneEdge),removedNode:null};
    const nodes=sourceNodes.filter(node=>clean(node?.instanceId)!==id).map(cloneNode);
    const edges=(Array.isArray(graph.edges)?graph.edges:[])
      .filter(edge=>clean(edge?.from)!==id&&clean(edge?.to)!==id)
      .map(cloneEdge);
    return {nodes:recalculateDepths(nodes,edges),edges,removedNode:cloneNode(removedNode)};
  }

  function findReusableNode(nodes,{dataId='',title='',custom=false}={}){
    const list=Array.isArray(nodes)?nodes:[];
    const targetDataId=clean(dataId);
    if(!custom&&targetDataId)return list.find(node=>!node?.custom&&clean(node?.dataId)===targetDataId)||null;
    const targetTitle=normalizedTitle(title);
    if(custom&&targetTitle)return list.find(node=>node?.custom&&normalizedTitle(node?.title)===targetTitle)||null;
    return null;
  }

  const api=Object.freeze({
    normalizedTitle,nodeIdentity,adjacencyFor,hasDirectedPath,canConnect,
    recalculateDepths,normalizeGraph,removeNode,findReusableNode
  });
  global.KGRecallGraphModel=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
