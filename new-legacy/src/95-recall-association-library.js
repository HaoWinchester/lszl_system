'use strict';

/*
 * RecallAssociationLibrary v1
 * 科目级知识联想库。支持 TXT/JSON 解析、合并、检索和每次四个候选分支。
 * 该数据独立于知识树导入导出，不修改知识点稳定 ID 或课程数据。
 */
(function(global){
  const STORAGE_PREFIX='kg_recall_association_library_v1__';
  const AUTH_SESSION_KEY='kg_local_current_user_v1';

  function clone(value){try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
  function clean(value){return String(value??'').trim()}
  function cleanList(value){
    if(Array.isArray(value))return value.map(clean).filter(Boolean);
    return clean(value).split(/[,，、;；|]/).map(clean).filter(Boolean);
  }
  function hash(value){
    let h=2166136261;
    for(const ch of String(value||'')){h^=ch.codePointAt(0);h=Math.imul(h,16777619)}
    return (h>>>0).toString(36);
  }
  function slug(value){
    const ascii=clean(value).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
    return ascii||('n-'+hash(value));
  }
  function nodeId(value){return clean(value).startsWith('recall-')?clean(value):'recall-'+slug(value)}
  function sessionScope(){
    try{
      const username=global.KGAuthCore?.currentUsername?.()||global.localStorage?.getItem(AUTH_SESSION_KEY);
      return username?'user__'+encodeURIComponent(username):'public';
    }catch(error){return 'public'}
  }
  function storageKey(subjectId='PMP'){return STORAGE_PREFIX+'subject__'+encodeURIComponent(clean(subjectId)||'PMP')}
  function legacyStorageKey(subjectId='PMP'){return STORAGE_PREFIX+sessionScope()+'__'+encodeURIComponent(clean(subjectId)||'PMP')}
  function normalizeNode(node,index=0){
    node=node&&typeof node==='object'?node:{title:node};
    const title=clean(node.title||node.name||node.label||node.id||('知识点 '+(index+1)));
    return {
      id:clean(node.id)||nodeId(title),
      title,
      titleEn:clean(node.titleEn||node.en?.title||node.translation?.en?.title||''),
      aliases:[...new Set(cleanList(node.aliases||node.keywords).filter(item=>item!==title))],
      prompt:clean(node.prompt||node.question||''),
      promptEn:clean(node.promptEn||node.en?.prompt||node.translation?.en?.prompt||''),
      hint:clean(node.hint||node.summary||node.description||''),
      hintEn:clean(node.hintEn||node.en?.hint||node.translation?.en?.hint||''),
      priority:Number.isFinite(Number(node.priority))?Number(node.priority):0,
      metadata:node.metadata&&typeof node.metadata==='object'?clone(node.metadata):{}
    };
  }
  function normalizeEdge(edge,index=0){
    edge=edge&&typeof edge==='object'?edge:{};
    return {
      id:clean(edge.id)||('edge-'+hash(clean(edge.from)+'>'+clean(edge.to)+'#'+index)),
      from:clean(edge.from),
      to:clean(edge.to),
      priority:Number.isFinite(Number(edge.priority))?Number(edge.priority):0,
      label:clean(edge.label||'关联'),
      metadata:edge.metadata&&typeof edge.metadata==='object'?clone(edge.metadata):{}
    };
  }
  function normalizeLibrary(payload={}){
    let rawNodes=[];let rawEdges=[];
    if(Array.isArray(payload))rawNodes=payload;
    else if(payload&&typeof payload==='object'){
      const structured=Object.prototype.hasOwnProperty.call(payload,'nodes')||Object.prototype.hasOwnProperty.call(payload,'edges')||Object.prototype.hasOwnProperty.call(payload,'schemaVersion');
      rawNodes=Array.isArray(payload.nodes)?payload.nodes:[];
      rawEdges=Array.isArray(payload.edges)?payload.edges:[];
      if(!structured&&!rawNodes.length&&!rawEdges.length){
        Object.entries(payload).forEach(([from,targets])=>{
          rawNodes.push({title:from});
          cleanList(targets).forEach(to=>{rawNodes.push({title:to});rawEdges.push({from,to})});
        });
      }
    }
    const byId=new Map();const titleToId=new Map();
    rawNodes.map(normalizeNode).forEach(node=>{
      const key=node.id||nodeId(node.title);
      const existing=byId.get(key);
      if(existing){
        existing.aliases=[...new Set([...existing.aliases,...node.aliases])];
        if(node.titleEn)existing.titleEn=node.titleEn;if(node.prompt)existing.prompt=node.prompt;if(node.promptEn)existing.promptEn=node.promptEn;if(node.hint)existing.hint=node.hint;if(node.hintEn)existing.hintEn=node.hintEn;
        existing.priority=Math.max(existing.priority,node.priority);
      }else byId.set(key,{...node,id:key});
    });
    byId.forEach(node=>{titleToId.set(node.title,node.id);node.aliases.forEach(alias=>titleToId.set(alias,node.id))});
    function resolve(value){
      const key=clean(value);if(!key)return '';
      if(byId.has(key))return key;
      if(titleToId.has(key))return titleToId.get(key);
      const created=normalizeNode({title:key},byId.size);byId.set(created.id,created);titleToId.set(created.title,created.id);return created.id;
    }
    const edgeKeys=new Set();const edges=[];
    rawEdges.map(normalizeEdge).forEach(edge=>{
      const from=resolve(edge.from),to=resolve(edge.to);
      if(!from||!to||from===to)return;
      const key=from+'>'+to;if(edgeKeys.has(key))return;edgeKeys.add(key);
      edges.push({...edge,from,to,id:edge.id||('edge-'+hash(key))});
    });
    return {schemaVersion:1,nodes:[...byId.values()],edges,updatedAt:clean(payload.updatedAt)||new Date().toISOString()};
  }
  function parseNodeToken(token){
    const raw=clean(token).replace(/^['"]|['"]$/g,'');
    const match=raw.match(/^(.+?)\s*[\[（(]\s*([^\]）)]+)\s*[\]）)]$/);
    if(!match)return {title:raw,aliases:[]};
    return {title:clean(match[1]),aliases:cleanList(match[2])};
  }
  function parseText(text){
    const raw=clean(text).replace(/^\ufeff/,'');
    if(!raw)return {valid:false,errors:['内容为空。'],warnings:[],library:normalizeLibrary({}),report:{nodeCount:0,edgeCount:0,lineCount:0}};
    if(/^[\[{]/.test(raw)){
      try{
        const library=normalizeLibrary(JSON.parse(raw));
        return {valid:true,errors:[],warnings:[],library,report:{nodeCount:library.nodes.length,edgeCount:library.edges.length,lineCount:raw.split(/\r?\n/).length,format:'json'}};
      }catch(error){return {valid:false,errors:['JSON 解析失败：'+error.message],warnings:[],library:normalizeLibrary({}),report:{nodeCount:0,edgeCount:0,lineCount:raw.split(/\r?\n/).length,format:'json'}}}
    }
    const nodes=[];const edges=[];const warnings=[];let effectiveLines=0;
    raw.split(/\r?\n/).forEach((source,lineIndex)=>{
      const line=clean(source.replace(/\s*(#|\/\/).*$/,''));if(!line)return;
      effectiveLines+=1;
      const stages=line.split(/\s*(?:➡️|➡|→|->|=>)\s*/).map(clean).filter(Boolean);
      if(!stages.length)return;
      if(stages.length===1){
        const token=parseNodeToken(stages[0]);if(token.title)nodes.push(token);else warnings.push('第 '+(lineIndex+1)+' 行没有可识别知识点。');return;
      }
      const groups=stages.map(stage=>stage.split(/[|｜]/).map(parseNodeToken).filter(item=>item.title));
      groups.flat().forEach(node=>nodes.push(node));
      for(let i=0;i<groups.length-1;i++){
        groups[i].forEach(from=>groups[i+1].forEach((to,targetIndex)=>edges.push({from:from.title,to:to.title,priority:Math.max(0,groups[i+1].length-targetIndex)})));
      }
    });
    const library=normalizeLibrary({nodes,edges});
    if(!library.nodes.length)return {valid:false,errors:['没有解析到知识点。请使用“知识点 -> 关联1 | 关联2”格式。'],warnings,library,report:{nodeCount:0,edgeCount:0,lineCount:effectiveLines,format:'txt'}};
    return {valid:true,errors:[],warnings,library,report:{nodeCount:library.nodes.length,edgeCount:library.edges.length,lineCount:effectiveLines,format:'txt'}};
  }
  function findExistingNode(library,node){
    const idx=index(library);if(!node)return null;
    if(node.id&&idx.byId.has(node.id))return idx.byId.get(node.id);
    const direct=resolve(idx.library,node.title);if(direct)return direct;
    for(const alias of node.aliases||[]){const found=resolve(idx.library,alias);if(found)return found}
    return null;
  }
  function reconcileIncoming(base,incoming){
    const a=normalizeLibrary(base),b=normalizeLibrary(incoming),idMap=new Map(),nodes=[];
    b.nodes.forEach(node=>{
      const existing=findExistingNode(a,node);
      if(existing){
        idMap.set(node.id,existing.id);
        nodes.push(normalizeNode({
          ...existing,...node,id:existing.id,title:node.title||existing.title,
          titleEn:node.titleEn||existing.titleEn||'',
          aliases:[...new Set([...(existing.aliases||[]),...(node.aliases||[])])],
          prompt:node.prompt||existing.prompt||'',promptEn:node.promptEn||existing.promptEn||'',
          hint:node.hint||existing.hint||'',hintEn:node.hintEn||existing.hintEn||'',
          metadata:{...(existing.metadata||{}),...(node.metadata||{})}
        }));
      }else{ idMap.set(node.id,node.id);nodes.push(clone(node)) }
    });
    const baseEdgeMap=new Map(a.edges.map(edge=>[edge.from+'>'+edge.to,edge]));
    const edges=b.edges.map(edge=>{
      const from=idMap.get(edge.from)||edge.from,to=idMap.get(edge.to)||edge.to,existing=baseEdgeMap.get(from+'>'+to);
      return normalizeEdge(existing?{
        ...existing,...edge,id:existing.id,from,to,
        label:(edge.label&&edge.label!=='关联')?edge.label:existing.label,
        metadata:{...(existing.metadata||{}),...(edge.metadata||{})}
      }:{...edge,from,to});
    });
    return normalizeLibrary({nodes,edges,updatedAt:b.updatedAt});
  }
  function merge(base,incoming){
    const a=normalizeLibrary(base),b=reconcileIncoming(a,incoming);
    const nodeMap=new Map(a.nodes.map(node=>[node.id,clone(node)]));
    b.nodes.forEach(node=>{
      const existing=nodeMap.get(node.id);
      if(existing){
        existing.title=node.title||existing.title;
        existing.aliases=[...new Set([...existing.aliases,...node.aliases])];
        if(node.titleEn)existing.titleEn=node.titleEn;if(node.prompt)existing.prompt=node.prompt;if(node.promptEn)existing.promptEn=node.promptEn;if(node.hint)existing.hint=node.hint;if(node.hintEn)existing.hintEn=node.hintEn;
        existing.metadata={...(existing.metadata||{}),...(node.metadata||{})};existing.priority=Math.max(existing.priority,node.priority);
      }else nodeMap.set(node.id,clone(node));
    });
    const edgeMap=new Map(a.edges.map(edge=>[edge.from+'>'+edge.to,clone(edge)]));
    b.edges.forEach(edge=>{const key=edge.from+'>'+edge.to,existing=edgeMap.get(key);if(existing)edgeMap.set(key,{...existing,...edge,id:existing.id,label:(edge.label&&edge.label!=='关联')?edge.label:existing.label,metadata:{...(existing.metadata||{}),...(edge.metadata||{})},priority:Math.max(Number(existing.priority)||0,Number(edge.priority)||0)});else edgeMap.set(key,clone(edge))});
    return normalizeLibrary({nodes:[...nodeMap.values()],edges:[...edgeMap.values()]});
  }
  function read(subjectId='PMP'){
    try{
      const primary=global.localStorage?.getItem(storageKey(subjectId));
      if(primary)return normalizeLibrary(JSON.parse(primary)||{});
      const legacy=global.localStorage?.getItem(legacyStorageKey(subjectId));
      if(legacy){const migrated=normalizeLibrary(JSON.parse(legacy)||{});try{global.localStorage?.setItem(storageKey(subjectId),JSON.stringify(migrated))}catch(_){}return migrated}
      return normalizeLibrary({});
    }catch(error){return normalizeLibrary({})}
  }
  function write(subjectId='PMP',library={}){
    const normalized=normalizeLibrary(library);
    try{global.localStorage?.setItem(storageKey(subjectId),JSON.stringify(normalized));return {valid:true,library:normalized}}catch(error){return {valid:false,errors:['保存失败：'+error.message],library:normalized}}
  }
  function saveText(subjectId,text,{mode='merge'}={}){
    const parsed=parseText(text);if(!parsed.valid)return parsed;
    const current=read(subjectId),incoming=reconcileIncoming(current,parsed.library);
    const library=mode==='replace'?incoming:merge(current,incoming);
    const saved=write(subjectId,library);
    return {...parsed,...saved,library:saved.library||library};
  }
  function index(library){
    const normalized=normalizeLibrary(library);const byId=new Map();const lookup=new Map();const outgoing=new Map();
    normalized.nodes.forEach(node=>{byId.set(node.id,node);lookup.set(node.id,node.id);lookup.set(node.title,node.id);if(node.titleEn)lookup.set(node.titleEn,node.id);node.aliases.forEach(alias=>lookup.set(alias,node.id))});
    normalized.edges.forEach(edge=>{if(!outgoing.has(edge.from))outgoing.set(edge.from,[]);outgoing.get(edge.from).push(edge)});
    outgoing.forEach(list=>list.sort((a,b)=>Number(b.priority)-Number(a.priority)||String(byId.get(a.to)?.title||'').localeCompare(String(byId.get(b.to)?.title||''),'zh-CN')));
    return {library:normalized,byId,lookup,outgoing};
  }
  function resolve(library,value){
    const idx=index(library);const key=clean(value);const id=idx.lookup.get(key)||'';return id?idx.byId.get(id)||null:null;
  }
  function choices(library,value,{limit=4,offset=0}={}){
    const idx=index(library);const node=resolve(idx.library,value);if(!node)return {node:null,choices:[],total:0,offset:0,hasMore:false};
    const outgoing=idx.outgoing.get(node.id)||[];const total=outgoing.length;const take=Math.max(1,Number(limit)||4);const start=total?((Number(offset)||0)%total+total)%total:0;
    const selected=[];
    for(let i=0;i<Math.min(take,total);i++){const edge=outgoing[(start+i)%total],target=idx.byId.get(edge.to);if(target)selected.push({text:target.title,textEn:target.titleEn||'',next:target.id,label:edge.label})}
    return {node,choices:selected,total,offset:start,hasMore:total>take,nextOffset:total?((start+take)%total):0};
  }
  function toText(library){
    const idx=index(library);return idx.library.nodes.map(node=>{
      const targets=(idx.outgoing.get(node.id)||[]).map(edge=>idx.byId.get(edge.to)?.title).filter(Boolean);
      const aliases=node.aliases.length?' ['+node.aliases.join(', ')+']':'';
      return targets.length?node.title+aliases+' -> '+targets.join(' | '):node.title+aliases;
    }).join('\n');
  }
  function asRecallNode(subjectId,value,{limit=4,offset=0}={}){
    const result=choices(read(subjectId),value,{limit,offset});if(!result.node)return null;
    return {
      id:result.node.id,title:result.node.title,titleEn:result.node.titleEn||'',
      prompt:result.node.prompt||`看到“${result.node.title}”，你还能联想到哪些知识点？`,promptEn:result.node.promptEn||'',
      hint:result.node.hint||'',hintEn:result.node.hintEn||'',choices:result.choices,totalChoices:result.total,nextOffset:result.nextOffset,hasMore:result.hasMore
    };
  }

  function updateNode(library,patch={}){
    const normalized=normalizeLibrary(library),requestedId=clean(patch.id),existing=requestedId?normalized.nodes.find(node=>node.id===requestedId):null;
    const title=clean(patch.title||existing?.title||'');if(!title)return {valid:false,errors:['知识点中文名称不能为空。'],library:normalized,node:null};
    const id=existing?.id||requestedId||nodeId(title),node=normalizeNode({...existing,...patch,id,title});
    const nodes=normalized.nodes.filter(item=>item.id!==id);nodes.push(node);
    const next=normalizeLibrary({nodes,edges:normalized.edges,updatedAt:new Date().toISOString()});
    return {valid:true,library:next,node:next.nodes.find(item=>item.id===id)||node};
  }
  function setChoices(library,fromValue,targets=[]){
    let normalized=normalizeLibrary(library);const from=resolve(normalized,fromValue);if(!from)return {valid:false,errors:['当前知识点不存在。'],library:normalized};
    const nodes=normalized.nodes.slice(),targetIds=[];
    (Array.isArray(targets)?targets:[]).forEach(target=>{
      const raw=target&&typeof target==='object'?target:{title:target},title=clean(raw.title||raw.text||raw.id);if(!title)return;
      let targetNode=resolve(normalized,raw.id||title);
      if(!targetNode){targetNode=normalizeNode({id:clean(raw.id)||nodeId(title),title,titleEn:clean(raw.titleEn||raw.textEn||'')},nodes.length);nodes.push(targetNode);normalized=normalizeLibrary({nodes,edges:normalized.edges})}
      if(targetNode&&targetNode.id!==from.id&&!targetIds.includes(targetNode.id))targetIds.push(targetNode.id);
    });
    const existingOutgoing=new Map(normalized.edges.filter(edge=>edge.from===from.id).map(edge=>[edge.to,clone(edge)]));
    const keep=normalized.edges.filter(edge=>edge.from!==from.id),count=targetIds.length;
    targetIds.forEach((to,index)=>{const existing=existingOutgoing.get(to);keep.push(existing?{...existing,priority:count-index}:{from:from.id,to,priority:count-index,label:'关联'})});
    const next=normalizeLibrary({nodes:normalized.nodes,edges:keep,updatedAt:new Date().toISOString()});
    return {valid:true,library:next,node:resolve(next,from.id)};
  }
  function saveNode(subjectId='PMP',patch={},targets=[]){
    const updated=updateNode(read(subjectId),patch);if(!updated.valid)return updated;
    const ordered=setChoices(updated.library,updated.node.id,targets);if(!ordered.valid)return ordered;
    const saved=write(subjectId,ordered.library);return {...saved,node:resolve(saved.library||ordered.library,updated.node.id)};
  }

  const api=Object.freeze({storageKey,legacyStorageKey,normalizeLibrary,parseText,merge,read,write,saveText,index,resolve,choices,toText,asRecallNode,nodeId,reconcileIncoming,updateNode,setChoices,saveNode});
  global.KGRecallAssociationLibrary=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
