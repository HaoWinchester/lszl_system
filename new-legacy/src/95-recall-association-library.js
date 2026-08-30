'use strict';

/*
 * RecallAssociationLibrary v1
 * 科目级知识联想库。支持 TXT/JSON 解析、合并、检索和每次四个候选分支。
 * 该数据独立于知识树导入导出，不修改知识点稳定 ID 或课程数据。
 */
(function(global){
  const indexCache=new WeakMap();
  let sessionBinding=null;

  function clone(value){try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
  function clean(value){return String(value??'').trim()}
  function lookupKey(value){return clean(value).toLocaleLowerCase()}
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
  function storageKey(subjectId='PMP'){return 'teaching-content-api:recall:'+encodeURIComponent(clean(subjectId)||'PMP')}
  function legacyStorageKey(subjectId='PMP'){return storageKey(subjectId)}
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
    if(sessionBinding)return sessionBinding.library;
    return normalizeLibrary(global.KGTeachingContentApi?.readResource?.('recallLibrary',{})||{});
  }
  function write(subjectId='PMP',library={}){
    if(sessionBinding)return {valid:false,errors:['当前为学员只读联想库快照，不能修改正式 Recall 数据。'],library:sessionBinding.library};
    const normalized=normalizeLibrary(library);
    global.KGTeachingContentApi?.stageResource?.('recallLibrary',normalized);
    return {valid:true,library:normalized};
  }
  function saveText(subjectId,text,{mode='merge'}={}){
    const parsed=parseText(text);if(!parsed.valid)return parsed;
    const current=read(subjectId),incoming=reconcileIncoming(current,parsed.library);
    const library=mode==='replace'?incoming:merge(current,incoming);
    const saved=write(subjectId,library);
    return {...parsed,...saved,library:saved.library||library};
  }
  function index(library){
    if(library&&typeof library==='object'){
      const cached=indexCache.get(library);if(cached)return cached;
    }
    const normalized=normalizeLibrary(library);const byId=new Map();const lookup=new Map();const outgoing=new Map();
    normalized.nodes.forEach(node=>{byId.set(node.id,node);lookup.set(lookupKey(node.id),node.id);lookup.set(lookupKey(node.title),node.id);if(node.titleEn)lookup.set(lookupKey(node.titleEn),node.id);node.aliases.forEach(alias=>lookup.set(lookupKey(alias),node.id))});
    normalized.edges.forEach(edge=>{if(!outgoing.has(edge.from))outgoing.set(edge.from,[]);outgoing.get(edge.from).push(edge)});
    outgoing.forEach(list=>list.sort((a,b)=>Number(b.priority)-Number(a.priority)||String(byId.get(a.to)?.title||'').localeCompare(String(byId.get(b.to)?.title||''),'zh-CN')));
    const result={library:normalized,byId,lookup,outgoing};
    if(library&&typeof library==='object')indexCache.set(library,result);
    indexCache.set(normalized,result);
    return result;
  }
  function resolve(library,value){
    const idx=index(library);const key=lookupKey(value);
    const exact=idx.lookup.get(key)||'';if(exact)return idx.byId.get(exact)||null;
    // P4.5.32 子串兜底：关键词不是任何标题/别名的全等项时（如“进度”），退化为模糊匹配。
    // 优先级：③标题/别名以关键词开头（“进度”→“进度基准”，同档词更短者优先）
    //        ②互相包含（“基线范围”含“范围”类；关键词包含节点名时节点名更长更精确）
    //        ①关键词的子串（长度≥2，从长到短）再走一遍上述匹配（“超出范围”→“范围”→“范围基准”）
    if(!key)return null;
    const best={id:'',rank:-1,termLen:0,edges:-1};
    const pick=(term,nodeId,rank)=>{
      const edges=(idx.outgoing.get(nodeId)||[]).length;
      // 开头匹配(rank2)/子串开头(rank1)偏好短词(更直接的概念)；
      // 互相包含(rank0,term⊂key)偏好长词(更精确)；其余按出边数多者。
      const better=rank>best.rank
        ||(rank===best.rank&&((rank===0?term.length>best.termLen:term.length<best.termLen)
          ||(term.length===best.termLen&&edges>best.edges)));
      if(best.id===''||better){best.id=nodeId;best.rank=rank;best.termLen=term.length;best.edges=edges}
    };
    const matchTerm=(term,nodeId,rank)=>{
      if(term.startsWith(key))pick(term,nodeId,rank+2);
      else if(term.includes(key)||key.includes(term))pick(term,nodeId,rank);
    };
    idx.library.nodes.forEach(node=>{
      for(const raw of [node.title,node.titleEn,...(node.aliases||[])]){
        const term=lookupKey(raw);if(!term||term===key)continue;
        matchTerm(term,node.id,0);
      }
    });
    if(best.id===''){
      for(let len=key.length-1;len>=2&&!best.id;len--){
        for(let i=0;i+len<=key.length;i++){
          const part=key.slice(i,i+len);
          idx.library.nodes.forEach(node=>{
            for(const raw of [node.title,...(node.aliases||[])]){
              const term=lookupKey(raw);if(!term||term===part)continue;
              if(term.startsWith(part))pick(term,node.id,1);
              else if(term.includes(part)||part.includes(term))pick(term,node.id,0.5);
            }
          });
        }
      }
    }
    return best.id?idx.byId.get(best.id)||null:null;
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

  function setSessionLibrary(library={},contentHash=''){
    const normalized=normalizeLibrary(library);
    sessionBinding={library:normalized,contentHash:clean(contentHash)};
    return normalized;
  }
  function clearSessionLibrary(){sessionBinding=null}
  function sessionInfo(){return sessionBinding?{contentHash:sessionBinding.contentHash,library:sessionBinding.library}:null}

  /* 深度回忆会话使用服务端快照；管理端发布统一走关系型联想库 API。 */
  async function readServer(subjectId='PMP'){
    const data=await global.KGTeachingContentApi.bootstrap(clean(subjectId)||'PMP');
    const library=data?.recallLibrary;
    return library&&typeof library==='object'?{...normalizeLibrary(library),id:clean(library.id),subjectId:clean(library.subjectId),version:Number(library.version)||1,status:clean(library.status)||'published',contentRevision:Number(data?.contentRevision)||0}:null;
  }
  async function writeServer(subjectId='PMP',library={}){
    const subject=clean(subjectId)||'PMP';
    const current=await global.KGTeachingContentApi.bootstrap(subject);
    const revision=Number(current?.contentRevision)||0;
    const identity=current?.recallLibrary&&typeof current.recallLibrary==='object'?current.recallLibrary:{};
    const recallLibrary={...normalizeLibrary(library),id:clean(identity.id),subjectId:clean(identity.subjectId)||subject,version:Number(identity.version)||1,status:clean(identity.status)||'published'};
    const savedIdentity=await global.KGTeachingContentApi.saveRecallLibrary(subject,recallLibrary)||recallLibrary;
    const saved=global.KGTeachingContentApi.snapshot();
    return {valid:true,revision:Number(saved?.contentRevision)||revision+1,identity:{id:clean(savedIdentity.id),subjectId:clean(savedIdentity.subjectId)||subject,version:Number(savedIdentity.version)||1,status:clean(savedIdentity.status)||'published'},library:normalizeLibrary(savedIdentity)};
  }

  const api=Object.freeze({storageKey,legacyStorageKey,normalizeLibrary,parseText,merge,read,write,saveText,index,resolve,choices,toText,asRecallNode,nodeId,reconcileIncoming,updateNode,setChoices,saveNode,setSessionLibrary,clearSessionLibrary,sessionInfo,readServer,writeServer});
  global.KGRecallAssociationLibrary=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
