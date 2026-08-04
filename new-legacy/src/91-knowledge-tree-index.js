'use strict';

(function(global){
  function clean(value){return String(value??'').trim()}
  function create(taxonomy,activities=[]){
    const source=taxonomy&&typeof taxonomy==='object'?taxonomy:{nodes:[]};
    const nodes=(Array.isArray(source.nodes)?source.nodes:[]).slice().sort((a,b)=>Number(a.level||0)-Number(b.level||0)||Number(a.sortOrder||0)-Number(b.sortOrder||0)||String(a.title?.zh||'').localeCompare(String(b.title?.zh||''),'zh-CN'));
    const byId=new Map(nodes.map(node=>[String(node.id),node]));
    const byParent=new Map();
    nodes.forEach(node=>{const key=node.parentId?String(node.parentId):'';if(!byParent.has(key))byParent.set(key,[]);byParent.get(key).push(node)});
    byParent.forEach(list=>list.sort((a,b)=>Number(a.sortOrder||0)-Number(b.sortOrder||0)||String(a.title?.zh||'').localeCompare(String(b.title?.zh||''),'zh-CN')));

    const pathCache=new Map();
    const descendantCache=new Map();
    const searchText=new Map();
    const directCounts=new Map();
    (activities||[]).forEach(activity=>{const id=activity?.metadata?.knowledge?.primaryNodeId;if(id)directCounts.set(String(id),(directCounts.get(String(id))||0)+1)});

    function node(nodeId){return byId.get(String(nodeId||''))||null}
    function children(parentId=null){return (byParent.get(parentId?String(parentId):'')||[]).slice()}
    function path(nodeId){
      const key=String(nodeId||'');if(pathCache.has(key))return pathCache.get(key).slice();
      const result=[];const seen=new Set();let current=node(key);
      while(current&&!seen.has(current.id)){seen.add(current.id);result.unshift(current);current=current.parentId?node(current.parentId):null}
      pathCache.set(key,result);return result.slice();
    }
    function pathLabel(nodeId,separator=' > '){return path(nodeId).map(item=>item.title?.zh||item.id).join(separator)}
    function descendants(nodeId){
      const key=String(nodeId||'');if(descendantCache.has(key))return descendantCache.get(key).slice();
      const result=[];const queue=[key];
      while(queue.length){const parent=queue.shift();children(parent).forEach(item=>{result.push(item.id);queue.push(item.id)})}
      descendantCache.set(key,result);return result.slice();
    }
    function searchable(nodeRecord){
      const key=String(nodeRecord?.id||'');if(searchText.has(key))return searchText.get(key);
      const value=[nodeRecord?.id,nodeRecord?.code,nodeRecord?.title?.zh,nodeRecord?.title?.en,...(nodeRecord?.aliases||[]),pathLabel(key)].join(' ').toLowerCase();searchText.set(key,value);return value;
    }
    function matches(nodeRecord,query=''){const keyword=clean(query).toLowerCase();return !keyword||searchable(nodeRecord).includes(keyword)}
    function branchMatches(nodeId,query=''){
      const keyword=clean(query).toLowerCase();if(!keyword)return true;const current=node(nodeId);if(current&&searchable(current).includes(keyword))return true;return descendants(nodeId).some(id=>searchable(node(id)).includes(keyword));
    }
    function search(query=''){const keyword=clean(query).toLowerCase();return nodes.filter(item=>!keyword||searchable(item).includes(keyword)).map(item=>({...item,path:pathLabel(item.id)}))}
    function directActivityCount(nodeId){return directCounts.get(String(nodeId||''))||0}

    return Object.freeze({taxonomy:source,nodes,byId,node,children,path,pathLabel,descendants,matches,branchMatches,search,directActivityCount});
  }

  global.KGKnowledgeTreeIndex=Object.freeze({create});
})(window);
