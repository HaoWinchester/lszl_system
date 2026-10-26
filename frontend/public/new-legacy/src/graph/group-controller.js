'use strict';
(function(global){
  // Membership lives on the card, so existing graph storage/history carries it.
  const groupId=node=>typeof node?.groupId==='string'?node.groupId.trim().slice(0,120):'';
  const locked=node=>!!(node?.interaction?.locked??node?.locked);
  function expand(nodes,ids){
    const selected=new Set(ids||[]),groups=new Set(nodes.filter(n=>selected.has(n.id)).map(groupId).filter(Boolean));
    return nodes.filter(n=>selected.has(n.id)||groups.has(groupId(n))).map(n=>n.id);
  }
  function normalize(nodes){
    const counts=new Map();for(const n of nodes){const id=groupId(n);if(id){n.groupId=id;counts.set(id,(counts.get(id)||0)+1)}else delete n.groupId}
    for(const n of nodes)if(counts.get(n.groupId)<2)delete n.groupId;
    return nodes;
  }
  function combine(nodes,ids,idFactory){
    const members=new Set(expand(nodes,ids)),chosen=nodes.filter(n=>members.has(n.id));
    if(chosen.length<2||chosen.some(locked))return false;
    const id=idFactory();if(typeof id!=='string'||!id||id.length>120||nodes.some(n=>n.id===id||groupId(n)===id))return false;
    for(const n of chosen)n.groupId=id;normalize(nodes);return true;
  }
  function ungroup(nodes,ids){
    const members=new Set(expand(nodes,ids)),chosen=nodes.filter(n=>members.has(n.id));
    if(chosen.some(locked)||!chosen.some(groupId))return false;
    for(const n of chosen)delete n.groupId;return true;
  }
  function remap(nodes,idFactory){
    normalize(nodes);const ids=new Map();
    for(const n of nodes){const old=groupId(n);if(!old)continue;if(!ids.has(old))ids.set(old,idFactory('groups',old));n.groupId=ids.get(old)}
    return nodes;
  }
  const api=Object.freeze({expand,normalize,combine,ungroup,remap,groupId});global.KGGraphGroups=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
