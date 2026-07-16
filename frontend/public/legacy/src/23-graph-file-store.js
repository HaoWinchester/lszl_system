'use strict';

/*
 * 图谱文件库 v2：轻量索引 + 独立内容存储。
 *
 * 目标：
 * - 列表、排序、重命名不再读取/重写所有图谱正文；
 * - 兼容 v1 kg_graph_file_library_v1 与早期 kg_home_file_library_v1；
 * - 提供 schemaVersion、revision、容量统计、回收站与永久删除；
 * - 保持原 KGGraphFileStore 公开 API，降低上层改造成本；
 * - v8.1：现有导入、导出、页签和标题编辑接入 v2 文件模型。
 */
(function(global){
  const SCHEMA_VERSION=2;
  const INDEX_KEY='kg_graph_file_index_v2';
  const CONTENT_PREFIX='kg_graph_file_content_v2__';
  const CURRENT_FILE_KEY='kg_graph_current_file_v2';
  const TAGS_KEY='kg_graph_file_tags_v2';
  const FOLDERS_KEY='kg_graph_folders_v1';
  const MIGRATION_KEY='kg_graph_file_migration_v2';
  const RECENT_MIGRATION_KEY='kg_graph_recent_opened_migration_v1';
  const LEGACY_FILES_KEY='kg_graph_file_library_v1';
  const LEGACY_CURRENT_KEY='kg_graph_current_file_v1';
  const LEGACY_TAGS_KEY='kg_graph_file_tags_v1';
  const LEGACY_HOME_KEY='kg_home_file_library_v1';
  const MAX_FILES_PER_OWNER=200;
  const TRASH_RETENTION_DAYS=30;
  const OPEN_TOUCH_DELAY_MS=1200;
  const PREVIEW_VERSION=1;
  const PREVIEW_MAX_NODES=18;
  const PREVIEW_MAX_LINKS=30;
  let lastError='',openedTouchTimer=null;
  const openedTouchQueue=new Map();

  function storage(){return global.KGAppStorage||null}
  function emitError(message,error){
    lastError=String(message||'图谱文件操作失败');
    if(error)console.warn('[KGGraphFileStore] '+lastError,error);
    try{global.dispatchEvent(new CustomEvent('kg-graph-file-error',{detail:{message:lastError,error:error||null}}))}catch(err){}
    return false;
  }
  function clearError(){lastError=''}
  function getLastError(){return lastError}
  function readJSON(key,fallback){
    const appStore=storage();
    if(appStore&&typeof appStore.readJSON==='function')return appStore.readJSON(key,fallback);
    try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback}catch(err){console.warn('[KGGraphFileStore] read failed:',key,err);return fallback}
  }
  function writeJSON(key,value){
    const appStore=storage();
    try{
      if(appStore&&typeof appStore.writeJSON==='function')return appStore.writeJSON(key,value)===true;
      localStorage.setItem(key,JSON.stringify(value));return true;
    }catch(err){console.warn('[KGGraphFileStore] write failed:',key,err);return false}
  }
  function removeKey(key){
    const appStore=storage();
    try{
      if(appStore&&typeof appStore.remove==='function')return appStore.remove(key)!==false;
      if(appStore&&typeof appStore.removeKey==='function')return appStore.removeKey(key)!==false;
      localStorage.removeItem(key);return true;
    }catch(err){return false}
  }
  function clone(value){
    if(value==null)return value;
    try{return typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value))}
    catch(err){return JSON.parse(JSON.stringify(value))}
  }
  function uid(prefix='graph'){
    const c=global.crypto;
    return prefix+'_'+(c&&c.randomUUID?c.randomUUID():Math.random().toString(36).slice(2)+Date.now().toString(36));
  }
  function cleanText(value,fallback='',max=120){
    const text=String(value??fallback).trim()||String(fallback||'');
    return text.slice(0,max);
  }
  function currentOwner(){
    try{
      const auth=global.KGAuthCore;
      if(auth&&typeof auth.currentUsername==='function')return auth.currentUsername()||'guest';
      if(global.KGAuthRuntime&&typeof global.KGAuthRuntime.currentUsername==='function')return global.KGAuthRuntime.currentUsername()||'guest';
    }catch(err){}
    return 'guest';
  }
  function safeGraphData(data){
    const copy=clone(data&&typeof data==='object'?data:{});
    try{return typeof global.sanitizeState==='function'?global.sanitizeState(copy):copy}catch(err){return copy}
  }
  function emptyLearningState(){return{flashcards:{},deepRecall:{},questionTraining:{}}}
  function normalizeLearningState(value){
    const base=emptyLearningState(),source=value&&typeof value==='object'?clone(value):{};
    return{...base,...source,flashcards:source.flashcards&&typeof source.flashcards==='object'?source.flashcards:{},deepRecall:source.deepRecall&&typeof source.deepRecall==='object'?source.deepRecall:{},questionTraining:source.questionTraining&&typeof source.questionTraining==='object'?source.questionTraining:{}};
  }
  function normalizeTags(tags){return[...new Set((Array.isArray(tags)?tags:[]).map(item=>cleanText(item,'',40)).filter(Boolean))].slice(0,1)}
  function utf8Bytes(value){
    const text=typeof value==='string'?value:JSON.stringify(value==null?null:value);
    try{return new TextEncoder().encode(text).length}catch(err){return unescape(encodeURIComponent(text)).length}
  }
  function previewHash(value){let h=2166136261;for(const ch of String(value||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
  function previewColor(value,fallback='#64748b'){
    const color=String(value||'').trim();
    return /^#[0-9a-f]{6}$/i.test(color)?color:/^#[0-9a-f]{3}$/i.test(color)?'#'+color.slice(1).split('').map(ch=>ch+ch).join(''):fallback;
  }
  function previewPalette(seed=''){
    const palettes=[
      ['#8b5cf6','#60a5fa','#f4efff'],['#2563eb','#22c55e','#eef8ff'],['#db2777','#f59e0b','#fff1f7'],
      ['#0891b2','#8b5cf6','#ecfbff'],['#16a34a','#14b8a6','#eefbf5'],['#7c3aed','#ec4899','#f8f0ff']
    ];
    return palettes[previewHash(seed)%palettes.length].slice();
  }
  function graphPreviewStructureHash(graphData){
    const graph=graphData&&typeof graphData==='object'?graphData:{},nodes=Array.isArray(graph.nodes)?graph.nodes:[],links=Array.isArray(graph.links)?graph.links:[];
    let h=2166136261;
    const mix=value=>{for(const ch of String(value==null?'':value)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}h^=124;h=Math.imul(h,16777619)};
    mix(nodes.length);mix(links.length);
    nodes.forEach((node,index)=>{mix(node&&node.id||index);mix(node&&node.x);mix(node&&node.y);mix(node&&node.size);mix(node&&node.color);mix(node&&node.title)});
    links.forEach((link,index)=>{mix(link&&link.id||index);mix(link&&link.from);mix(link&&link.to);mix(link&&link.color)});
    return (h>>>0).toString(36);
  }
  function normalizePreview(raw){
    if(!raw||typeof raw!=='object'||Number(raw.version)!==PREVIEW_VERSION)return null;
    const palette=Array.isArray(raw.palette)?raw.palette.slice(0,3).map((color,index)=>previewColor(color,previewPalette('fallback')[index])):previewPalette('fallback');
    const nodes=(Array.isArray(raw.nodes)?raw.nodes:[]).slice(0,PREVIEW_MAX_NODES).map((node,index)=>{
      const x=Number(node&&node.x),y=Number(node&&node.y),r=Number(node&&node.r);
      return{id:cleanText(node&&node.id,'p'+index,80),x:Math.max(5,Math.min(195,Number.isFinite(x)?x:100)),y:Math.max(7,Math.min(103,Number.isFinite(y)?y:55)),
        r:Math.max(2.6,Math.min(8,Number.isFinite(r)?r:4)),color:previewColor(node&&node.color,palette[index%2]),label:cleanText(node&&node.label,'',12)};
    });
    const links=(Array.isArray(raw.links)?raw.links:[]).slice(0,PREVIEW_MAX_LINKS).map(link=>({
      from:Math.max(0,Math.floor(Number(link&&link.from)||0)),to:Math.max(0,Math.floor(Number(link&&link.to)||0)),color:previewColor(link&&link.color,palette[0])
    })).filter(link=>link.from<nodes.length&&link.to<nodes.length&&link.from!==link.to);
    return{version:PREVIEW_VERSION,graphRevision:Math.max(0,Number(raw.graphRevision)||0),structureHash:cleanText(raw.structureHash,'',32),palette,nodes,links};
  }
  function buildGraphPreview(graphData,seed='',graphRevision=0){
    const graph=graphData&&typeof graphData==='object'?graphData:{},allNodes=Array.isArray(graph.nodes)?graph.nodes:[],allLinks=Array.isArray(graph.links)?graph.links:[],palette=previewPalette(seed||graph.meta&&graph.meta.title||'graph'),structureHash=graphPreviewStructureHash(graph);
    if(!allNodes.length){
      const hash=previewHash(seed||'empty'),count=8,nodes=[];
      for(let i=0;i<count;i++){
        const angle=((i/count)*Math.PI*2)+((hash%360)*Math.PI/180),radius=i===0?0:27+(i%3)*8;
        nodes.push({id:'empty-'+i,x:100+Math.cos(angle)*radius*1.45,y:55+Math.sin(angle)*radius*.72,r:i===0?6.8:3.5+(i%2),color:i%3===0?palette[1]:palette[0],label:i<2?(i===0?'新图谱':'知识点'):''});
      }
      const links=[];for(let i=1;i<count;i++)links.push({from:0,to:i,color:palette[i%2]});
      return normalizePreview({version:PREVIEW_VERSION,graphRevision,structureHash,palette,nodes,links});
    }
    const degree=new Map(allNodes.map(node=>[String(node&&node.id||''),0]));
    allLinks.forEach(link=>{const from=String(link&&link.from||''),to=String(link&&link.to||'');if(degree.has(from))degree.set(from,degree.get(from)+1);if(degree.has(to))degree.set(to,degree.get(to)+1)});
    let selected=allNodes.map((node,index)=>({node,index,degree:degree.get(String(node&&node.id||''))||0}));
    if(selected.length>PREVIEW_MAX_NODES){
      const ranked=selected.slice().sort((a,b)=>b.degree-a.degree||a.index-b.index),picked=ranked.slice(0,Math.min(11,PREVIEW_MAX_NODES)),pickedIndex=new Set(picked.map(item=>item.index));
      const remaining=selected.filter(item=>!pickedIndex.has(item.index)),slots=PREVIEW_MAX_NODES-picked.length;
      for(let i=0;i<slots&&remaining.length;i++)picked.push(remaining[Math.min(remaining.length-1,Math.floor(i*remaining.length/slots))]);
      selected=picked.sort((a,b)=>a.index-b.index);
    }
    const selectedIds=new Map(selected.map((item,index)=>[String(item.node&&item.node.id||item.index),index]));
    const rawPositions=selected.map(item=>({x:Number(item.node&&item.node.x),y:Number(item.node&&item.node.y)})),valid=rawPositions.filter(pos=>Number.isFinite(pos.x)&&Number.isFinite(pos.y));
    const minX=valid.length?Math.min(...valid.map(pos=>pos.x)):0,maxX=valid.length?Math.max(...valid.map(pos=>pos.x)):0,minY=valid.length?Math.min(...valid.map(pos=>pos.y)):0,maxY=valid.length?Math.max(...valid.map(pos=>pos.y)):0;
    const spreadX=maxX-minX,spreadY=maxY-minY,hasLayout=valid.length===selected.length&&(spreadX>4||spreadY>4),hash=previewHash(seed||'graph');
    const maxDegree=Math.max(1,...selected.map(item=>item.degree));
    const nodes=selected.map((item,index)=>{
      let x,y;
      if(hasLayout){
        const scale=Math.min(156/Math.max(1,spreadX),76/Math.max(1,spreadY));
        const width=spreadX*scale,height=spreadY*scale;
        x=100-width/2+(Number(item.node.x)-minX)*scale;y=55-height/2+(Number(item.node.y)-minY)*scale;
      }else{
        const main=index===0,angle=((index/Math.max(1,selected.length))*Math.PI*2)+((hash%360)*Math.PI/180),ring=main?0:28+(index%3)*8;
        x=100+Math.cos(angle)*ring*1.55;y=55+Math.sin(angle)*ring*.72;
      }
      const importance=item.degree/maxDegree,r=3.1+importance*3.7+(index===0?.5:0),label=item.degree>=Math.max(2,maxDegree*.55)||index<2?cleanText(item.node&&item.node.title,'',7):'';
      return{id:cleanText(item.node&&item.node.id,'p'+index,80),x,y,r,color:previewColor(item.node&&item.node.color,index%3===0?palette[1]:palette[0]),label};
    });
    const links=[];
    for(const link of allLinks){
      const from=selectedIds.get(String(link&&link.from||'')),to=selectedIds.get(String(link&&link.to||''));
      if(from===undefined||to===undefined||from===to)continue;
      links.push({from,to,color:previewColor(link&&link.color,palette[0])});if(links.length>=PREVIEW_MAX_LINKS)break;
    }
    if(!links.length&&nodes.length>1)for(let i=1;i<nodes.length;i++)links.push({from:Math.max(0,Math.floor((i-1)/2)),to:i,color:palette[i%2]});
    return normalizePreview({version:PREVIEW_VERSION,graphRevision,structureHash,palette,nodes,links});
  }
  function contentKey(owner,id){return CONTENT_PREFIX+encodeURIComponent(cleanText(owner,'guest',120))+'__'+encodeURIComponent(cleanText(id,'',120))}
  function fileSortKey(file){const order=Number(file&&file.order);return Number.isFinite(order)?order:Number(file&&file.createdAt)||0}
  function sortOwnerFiles(files){return files.slice().sort((a,b)=>fileSortKey(a)-fileSortKey(b)||(Number(a.createdAt)||0)-(Number(b.createdAt)||0)||String(a.id).localeCompare(String(b.id)))}
  function normalizeIndexEntry(file,fallbackId=''){
    if(!file||typeof file!=='object')return null;
    const now=Date.now(),id=cleanText(file.id,fallbackId||uid('graph'),120),owner=cleanText(file.owner,currentOwner(),120);
    const createdAt=Number(file.createdAt)||now,updatedAt=Number(file.updatedAt)||now;
    const hasLastOpenedAt=Object.prototype.hasOwnProperty.call(file,'lastOpenedAt');
    const lastOpenedAt=hasLastOpenedAt?Math.max(0,Number(file.lastOpenedAt)||0):updatedAt;
    return{
      schemaVersion:SCHEMA_VERSION,id,owner,
      name:cleanText(file.name,'我的知识图谱',100),description:cleanText(file.description,'',500),tags:normalizeTags(file.tags&&file.tags.length?file.tags:(file.favorite===true?['收藏']:[])),favorite:normalizeTags(file.tags&&file.tags.length?file.tags:(file.favorite===true?['收藏']:[])).length>0,folderId:cleanText(file.folderId,'',120)||null,restoreFolderId:cleanText(file.restoreFolderId,'',120)||null,
      createdAt,updatedAt,lastOpenedAt,
      order:Number.isFinite(Number(file.order))?Number(file.order):null,status:file.status==='trashed'?'trashed':'active',deletedAt:file.status==='trashed'?(Number(file.deletedAt)||now):null,
      nodeCount:Math.max(0,Number(file.nodeCount)||0),linkCount:Math.max(0,Number(file.linkCount)||0),byteSize:Math.max(0,Number(file.byteSize)||0),
      revision:Math.max(1,Number(file.revision)||1),source:cleanText(file.source,'local',40),sourceFileId:cleanText(file.sourceFileId,'',120),
      preview:normalizePreview(file.preview),contentKey:contentKey(owner,id)
    };
  }
  function normalizeContent(raw,options={}){
    const source=raw&&typeof raw==='object'?raw:{};
    const graphData=options.sanitize===false?clone(source.graphData||{}):safeGraphData(source.graphData||{});
    return{schemaVersion:SCHEMA_VERSION,graphData,learningState:normalizeLearningState(source.learningState),revision:Math.max(1,Number(source.revision)||1),savedAt:Number(source.savedAt)||Date.now()};
  }
  function readIndex(){
    const raw=readJSON(INDEX_KEY,[]),seen=new Set(),out=[];
    (Array.isArray(raw)?raw:[]).forEach((item,index)=>{
      const file=normalizeIndexEntry(item,'graph_recovered_'+index);if(!file)return;
      const composite=file.owner+'\n'+file.id;if(seen.has(composite))return;seen.add(composite);out.push(file);
    });
    return out;
  }
  function writeIndex(entries){
    const normalized=[],counts=new Map();
    (Array.isArray(entries)?entries:[]).forEach((item,index)=>{const file=normalizeIndexEntry(item,'graph_recovered_'+index);if(!file)return;normalized.push(file);counts.set(file.owner,(counts.get(file.owner)||0)+1)});
    for(const [owner,count] of counts)if(count>MAX_FILES_PER_OWNER)return emitError(`账号“${owner}”的图谱文件数量已达到上限（${MAX_FILES_PER_OWNER} 个）。`);
    if(!writeJSON(INDEX_KEY,normalized))return emitError('图谱文件索引写入失败，本地存储空间可能已满。');
    clearError();return true;
  }
  function readContent(entry,options={}){
    if(!entry)return null;
    const raw=readJSON(entry.contentKey||contentKey(entry.owner,entry.id),null);
    if(!raw||typeof raw!=='object')return null;
    return normalizeContent(raw,{sanitize:options.sanitize===true});
  }
  function writeContent(entry,content,options={}){
    const normalized=normalizeContent(content,{sanitize:options.sanitize===true});
    if(!writeJSON(entry.contentKey||contentKey(entry.owner,entry.id),normalized))return emitError('图谱文件内容写入失败，本地存储空间可能已满。');
    return normalized;
  }
  function hydrate(entry,options={}){
    const content=readContent(entry,options);if(!content)return null;
    return clone({...entry,graphData:content.graphData,learningState:content.learningState,revision:Math.max(entry.revision||1,content.revision||1)});
  }
  function objectMap(raw){const out=Object.create(null);if(raw&&typeof raw==='object'&&!Array.isArray(raw))Object.keys(raw).forEach(key=>{out[key]=raw[key]});return out}
  function currentMap(){return objectMap(readJSON(CURRENT_FILE_KEY,{}))}
  function emit(action,file,extra={}){try{global.dispatchEvent(new CustomEvent('kg-graph-file-change',{detail:{action,file:file?clone(file):null,...extra}}))}catch(err){}}
  function queueKey(owner,id){return cleanText(owner,'guest',120)+'\n'+cleanText(id,'',120)}
  function flushOpenedTouches(options={}){
    if(openedTouchTimer){clearTimeout(openedTouchTimer);openedTouchTimer=null}
    if(!openedTouchQueue.size)return 0;
    const pending=new Map(openedTouchQueue);openedTouchQueue.clear();
    const index=readIndex();let changed=0;
    index.forEach((file,i)=>{
      const touchedAt=pending.get(queueKey(file.owner,file.id));
      if(touchedAt&&file.status==='active'&&Number(file.lastOpenedAt)!==Number(touchedAt)){
        index[i]=normalizeIndexEntry({...file,lastOpenedAt:Number(touchedAt)||Date.now()});
        changed+=1;
      }
    });
    if(!changed)return 0;
    if(!writeIndex(index)){
      pending.forEach((time,key)=>openedTouchQueue.set(key,time));
      return 0;
    }
    clearError();
    if(options.emit!==false)emit('touch-opened',null,{count:changed});
    return changed;
  }
  function scheduleOpenedTouch(id,owner=currentOwner(),openedAt=Date.now(),options={}){
    if(options.touchOpened===false)return false;
    openedTouchQueue.set(queueKey(owner,id),Number(openedAt)||Date.now());
    if(openedTouchTimer)clearTimeout(openedTouchTimer);
    openedTouchTimer=setTimeout(()=>flushOpenedTouches({emit:true}),OPEN_TOUCH_DELAY_MS);
    return true;
  }
  function touchFileOpened(id,options={}){
    const owner=options.owner||currentOwner(),openedAt=options.openedAt||Date.now();
    if(options.defer!==false)return scheduleOpenedTouch(id,owner,openedAt,options);
    openedTouchQueue.set(queueKey(owner,id),openedAt);
    return flushOpenedTouches(options)>0;
  }

  function migrateV1(){
    const marker=readJSON(MIGRATION_KEY,null);if(marker&&Number(marker.schemaVersion)>=SCHEMA_VERSION)return true;
    if(readIndex().length){writeJSON(MIGRATION_KEY,{schemaVersion:SCHEMA_VERSION,migratedAt:Date.now(),source:'existing-v2'});return true}
    const oldFiles=readJSON(LEGACY_FILES_KEY,[]),homeFiles=readJSON(LEGACY_HOME_KEY,[]),candidates=[];
    (Array.isArray(oldFiles)?oldFiles:[]).forEach(file=>{if(file&&file.graphData)candidates.push({...file,source:file.source||'v1-migration'})});
    (Array.isArray(homeFiles)?homeFiles:[]).forEach(record=>{if(record&&record.snapshot)candidates.push({id:record.id,owner:record.owner,name:record.title,description:record.description,graphData:record.snapshot,createdAt:record.createdAt,updatedAt:record.updatedAt,lastOpenedAt:record.updatedAt,source:'home-library-migration'})});
    const index=[],written=[];
    try{
      candidates.forEach((source,i)=>{
        const owner=cleanText(source.owner,currentOwner(),120),idBase=cleanText(source.id,'graph_migrated_'+i,120);let id=idBase,n=2;
        while(index.some(file=>file.owner===owner&&file.id===id))id=cleanText(idBase+'_'+n++,'',120);
        const graphData=safeGraphData(source.graphData),learningState=normalizeLearningState(source.learningState),revision=Math.max(1,Number(source.revision)||1);
        const entry=normalizeIndexEntry({...source,id,owner,name:source.name||(graphData.meta&&graphData.meta.title)||'我的知识图谱',nodeCount:Array.isArray(graphData.nodes)?graphData.nodes.length:0,linkCount:Array.isArray(graphData.links)?graphData.links.length:0,byteSize:utf8Bytes({graphData,learningState}),revision,status:'active'});
        const content={schemaVersion:SCHEMA_VERSION,graphData,learningState,revision,savedAt:entry.updatedAt};
        if(!writeJSON(entry.contentKey,content))throw new Error('迁移图谱内容失败');
        written.push(entry.contentKey);index.push(entry);
      });
      if(!writeIndex(index))throw new Error(lastError||'迁移图谱索引失败');
      const oldCurrent=objectMap(readJSON(LEGACY_CURRENT_KEY,{}));if(Object.keys(oldCurrent).length)writeJSON(CURRENT_FILE_KEY,oldCurrent);
      const oldTags=objectMap(readJSON(LEGACY_TAGS_KEY,{}));if(Object.keys(oldTags).length)writeJSON(TAGS_KEY,oldTags);
      if(!writeJSON(MIGRATION_KEY,{schemaVersion:SCHEMA_VERSION,migratedAt:Date.now(),legacyFileCount:(Array.isArray(oldFiles)?oldFiles.length:0),homeFileCount:(Array.isArray(homeFiles)?homeFiles.length:0)}))throw new Error('迁移标记写入失败');
      clearError();return true;
    }catch(err){
      written.forEach(removeKey);
      // 若索引已成功写入但迁移标记失败，必须同时回滚索引，避免留下指向已删除内容的损坏记录。
      removeKey(INDEX_KEY);
      removeKey(MIGRATION_KEY);
      emitError('旧版图谱文件库迁移失败。',err);return false
    }
  }
  function migrateRecentOpenedSemantics(){
    const marker=readJSON(RECENT_MIGRATION_KEY,null);if(marker&&marker.done)return true;
    const index=readIndex(),currents=currentMap();let changed=0;
    index.forEach((file,i)=>{
      const source=String(file.source||''),createdAt=Number(file.createdAt)||0,lastOpenedAt=Number(file.lastOpenedAt)||0;
      const createdButNotOpened=(source==='package-import'||source==='duplicate')&&file.id!==currents[file.owner]&&lastOpenedAt>0&&Math.abs(lastOpenedAt-createdAt)<=10;
      if(createdButNotOpened){index[i]=normalizeIndexEntry({...file,lastOpenedAt:0});changed+=1}
    });
    if(changed&&!writeIndex(index))return false;
    writeJSON(RECENT_MIGRATION_KEY,{done:true,migratedAt:Date.now(),updated:changed});
    return true;
  }
  function ensureMigrated(){return migrateV1()&&migrateRecentOpenedSemantics()}

  function setCurrentFileId(id,owner=currentOwner(),options={}){
    ensureMigrated();id=cleanText(id,'',120);owner=cleanText(owner,'guest',120);
    if(id&&!options.allowMissing&&!readIndex().some(file=>file.owner===owner&&file.id===id&&file.status==='active')){emitError('要打开的图谱文件不存在。');return null}
    const map=currentMap();if(id)map[owner]=id;else delete map[owner];
    if(!writeJSON(CURRENT_FILE_KEY,map)){emitError('当前图谱标记写入失败，本地存储空间可能已满。');return null}
    clearError();if(options.emit!==false)global.dispatchEvent(new CustomEvent('kg-graph-current-file-change',{detail:{owner,id}}));return id;
  }
  function getCurrentFileId(owner=currentOwner()){
    ensureMigrated();owner=cleanText(owner,'guest',120);const files=sortOwnerFiles(readIndex().filter(file=>file.owner===owner&&file.status==='active')),id=cleanText(currentMap()[owner],'',120);
    if(id&&files.some(file=>file.id===id))return id;
    const first=files[0];if(first){setCurrentFileId(first.id,owner,{emit:false});return first.id}return '';
  }
  function listFiles(options={}){
    ensureMigrated();const owner=options.owner===false?null:(options.owner||currentOwner());let files=readIndex();
    if(owner)files=files.filter(file=>file.owner===owner);
    if(options.includeTrash!==true)files=files.filter(file=>file.status==='active');
    else if(options.status)files=files.filter(file=>file.status===options.status);
    const keyword=cleanText(options.keyword,'',120).toLowerCase();if(keyword)files=files.filter(file=>[file.name,file.description,...file.tags].join(' ').toLowerCase().includes(keyword));
    return clone(sortOwnerFiles(files));
  }
  function getFileMeta(id,owner=currentOwner(),options={}){
    ensureMigrated();const entry=readIndex().find(item=>item.id===id&&item.owner===owner&&(options.includeTrash||item.status==='active'));return entry?clone(entry):null;
  }
  function getCurrentFileMeta(owner=currentOwner()){const id=getCurrentFileId(owner);return id?getFileMeta(id,owner):null}
  function getFile(id,owner=currentOwner(),options={}){
    const entry=getFileMeta(id,owner,options);if(!entry)return null;
    const file=hydrate(entry,{sanitize:options.sanitize===true});
    if(!file){emitError('图谱文件内容缺失或损坏。');return null}
    clearError();return file;
  }
  function getCurrentFile(owner=currentOwner()){const id=getCurrentFileId(owner);return id?getFile(id,owner):null}
  function createFile(input={},options={}){
    ensureMigrated();if(typeof input==='string')input={name:input};
    const owner=cleanText(options.owner||input.owner||currentOwner(),'guest',120),index=readIndex();
    if(input.folderId&&!validActiveFolder(cleanText(input.folderId,'',120),owner)){emitError('目标文件夹不存在或已在回收站。');return null}
    if(index.filter(file=>file.owner===owner).length>=MAX_FILES_PER_OWNER){emitError(`每个账号最多创建 ${MAX_FILES_PER_OWNER} 个图谱文件。`);return null}
    const now=Date.now(),graphData=safeGraphData(input.graphData??options.graphData??{}),learningState=normalizeLearningState(input.learningState),usedIds=new Set(index.filter(f=>f.owner===owner).map(f=>f.id));
    const ownerFiles=sortOwnerFiles(index.filter(file=>file.owner===owner&&file.status==='active')),lastOrder=ownerFiles.reduce((max,file)=>Math.max(max,fileSortKey(file)),0),makeCurrent=options.makeCurrent!==false;
    const hasInputLastOpened=Object.prototype.hasOwnProperty.call(input,'lastOpenedAt'),lastOpenedAt=hasInputLastOpened?Math.max(0,Number(input.lastOpenedAt)||0):(makeCurrent?now:0);
    let id=cleanText(input.id,'',120)||uid('graph');while(usedIds.has(id))id=uid('graph');
    const revision=Math.max(1,Number(input.revision)||1),content={schemaVersion:SCHEMA_VERSION,graphData,learningState,revision,savedAt:now};
    const entry=normalizeIndexEntry({id,owner,name:input.name||(graphData.meta&&graphData.meta.title)||'新图谱文件',description:input.description,tags:input.tags,favorite:input.favorite===true,folderId:input.folderId,createdAt:input.createdAt||now,updatedAt:input.updatedAt||now,lastOpenedAt,order:Number.isFinite(Number(input.order))?Number(input.order):lastOrder+1000,status:'active',nodeCount:Array.isArray(graphData.nodes)?graphData.nodes.length:0,linkCount:Array.isArray(graphData.links)?graphData.links.length:0,byteSize:utf8Bytes(content),revision,preview:buildGraphPreview(graphData,id,revision),source:input.source||options.source||'created',sourceFileId:input.sourceFileId});
    if(!writeContent(entry,content,{sanitize:false}))return null;
    index.push(entry);if(!writeIndex(index)){removeKey(entry.contentKey);return null}
    if(options.makeCurrent!==false&&setCurrentFileId(entry.id,owner,{emit:false})===null){removeKey(entry.contentKey);writeIndex(index.filter(f=>!(f.owner===owner&&f.id===entry.id)));return null}
    const file=hydrate(entry);clearError();if(options.emit!==false){emit('create',file,{owner});if(options.makeCurrent!==false)global.dispatchEvent(new CustomEvent('kg-graph-current-file-change',{detail:{owner,id:entry.id}}))}return file;
  }
  function saveFile(id,graphData,options={}){
    ensureMigrated();const owner=options.owner||currentOwner(),index=readIndex(),position=index.findIndex(file=>file.id===id&&file.owner===owner&&file.status==='active');
    if(position<0){emitError('要保存的图谱文件不存在。');return null}
    const current=index[position],oldContent=readContent(current)||normalizeContent({graphData:{},learningState:emptyLearningState()}),now=Date.now();
    const nextGraph=graphData===undefined?oldContent.graphData:(options.sanitize===true?safeGraphData(graphData):clone(graphData));
    if(options.name!==undefined&&options.syncGraphTitle!==false){
      if(!nextGraph.meta||typeof nextGraph.meta!=='object')nextGraph.meta={};
      nextGraph.meta.title=cleanText(options.name,'未命名图谱',100);
    }
    const nextLearning=options.learningState===undefined?oldContent.learningState:normalizeLearningState(options.learningState),revision=Math.max(current.revision||1,oldContent.revision||1)+1;
    const content={schemaVersion:SCHEMA_VERSION,graphData:nextGraph,learningState:nextLearning,revision,savedAt:now};
    if(!writeContent(current,content,{sanitize:false}))return null;
    const structureHash=graphPreviewStructureHash(nextGraph),preview=current.preview&&current.preview.structureHash===structureHash?current.preview:buildGraphPreview(nextGraph,current.id,revision);
    const next=normalizeIndexEntry({...current,name:options.name===undefined?current.name:options.name,tags:options.tags===undefined?current.tags:options.tags,updatedAt:options.updatedAt||now,lastOpenedAt:options.touchOpened===false?current.lastOpenedAt:(options.lastOpenedAt||current.lastOpenedAt||now),nodeCount:Array.isArray(nextGraph.nodes)?nextGraph.nodes.length:0,linkCount:Array.isArray(nextGraph.links)?nextGraph.links.length:0,byteSize:utf8Bytes(content),revision,preview});
    index[position]=next;if(!writeIndex(index)){writeJSON(current.contentKey,oldContent);return null}
    const file=hydrate(next);clearError();if(options.emit!==false)emit('save',file,{owner});return file;
  }
  function openFile(id,options={}){
    ensureMigrated();const owner=options.owner||currentOwner(),index=readIndex(),position=index.findIndex(file=>file.id===id&&file.owner===owner&&file.status==='active');
    if(position<0){emitError('要打开的图谱文件不存在。');return null}
    const openedAt=Date.now(),entry=normalizeIndexEntry({...index[position],lastOpenedAt:openedAt});
    const file=hydrate(entry);if(!file){emitError('图谱文件内容缺失或损坏。');return null}
    if(setCurrentFileId(id,owner,{emit:false})===null)return null;
    scheduleOpenedTouch(id,owner,openedAt,options);
    clearError();if(options.emit!==false){emit('open',file,{owner});global.dispatchEvent(new CustomEvent('kg-graph-current-file-change',{detail:{owner,id}}))}return file;
  }
  function patchIndexFile(id,patch,options={}){
    const owner=options.owner||currentOwner(),index=readIndex(),position=index.findIndex(file=>file.id===id&&file.owner===owner&&(options.includeTrash||file.status==='active'));
    if(position<0)return null;const next=normalizeIndexEntry({...index[position],...patch});index[position]=next;if(!writeIndex(index))return null;return next;
  }
  function renameFile(id,name,options={}){
    const owner=options.owner||currentOwner(),index=readIndex(),position=index.findIndex(file=>file.id===id&&file.owner===owner&&(options.includeTrash||file.status==='active'));
    if(position<0){emitError('要重命名的图谱文件不存在。');return null}
    const previous=index[position],safeName=cleanText(name,'未命名图谱',100),now=Date.now();
    let content=readContent(previous),oldContent=content?clone(content):null;
    if(!content&&options.syncGraphTitle!==false){emitError('图谱文件内容缺失或损坏，无法同步重命名。');return null}
    if(content&&options.syncGraphTitle!==false){
      const graphData=clone(content.graphData||{});if(!graphData.meta||typeof graphData.meta!=='object')graphData.meta={};graphData.meta.title=safeName;
      content={...content,graphData,revision:Math.max(Number(content.revision)||1,Number(previous.revision)||1)+1,savedAt:now};
      if(!writeContent(previous,content,{sanitize:false}))return null;
    }
    const nextRevision=content?Math.max(Number(previous.revision)||1,Number(content.revision)||1):previous.revision;
    const entry=normalizeIndexEntry({...previous,name:safeName,updatedAt:now,revision:nextRevision,preview:previous.preview});
    index[position]=entry;
    if(!writeIndex(index)){if(oldContent)writeJSON(previous.contentKey,oldContent);return null}
    const file=hydrate(entry)||clone(entry);clearError();if(options.emit!==false)emit('rename',file,{owner:entry.owner});return file;
  }
  function duplicateFile(id,options={}){
    const source=getFile(id,options.owner||currentOwner(),{includeTrash:!!options.includeTrash});if(!source){emitError('要复制的图谱文件不存在。');return null}
    const now=Date.now(),makeCurrent=options.makeCurrent!==false;
    return createFile({...source,id:uid('graph'),name:options.name||source.name+' 副本',createdAt:now,updatedAt:now,lastOpenedAt:makeCurrent?now:0,source:'duplicate',sourceFileId:source.id},{owner:source.owner,makeCurrent});
  }
  function deleteFile(id,options={}){
    ensureMigrated();const owner=options.owner||currentOwner(),index=readIndex(),position=index.findIndex(file=>file.id===id&&file.owner===owner&&(options.permanent||file.status==='active'));
    if(position<0){emitError('要删除的图谱文件不存在。');return false}
    const target=index[position],currentId=getCurrentFileId(owner);
    if(options.permanent===true){
      index.splice(position,1);if(!writeIndex(index))return false;if(!removeKey(target.contentKey))console.warn('[KGGraphFileStore] orphan content cleanup failed:',target.contentKey);
    }else{
      index[position]=normalizeIndexEntry({...target,status:'trashed',restoreFolderId:target.folderId||target.restoreFolderId||null,folderId:null,deletedAt:Date.now(),updatedAt:Date.now()});if(!writeIndex(index))return false;
    }
    if(currentId===id){const remaining=sortOwnerFiles(index.filter(file=>file.owner===owner&&file.status==='active'));setCurrentFileId(remaining[0]&&remaining[0].id||'',owner,{emit:false,allowMissing:true})}
    clearError();if(options.emit!==false){emit(options.permanent?'delete-permanent':'trash',target,{owner,id});if(currentId===id)global.dispatchEvent(new CustomEvent('kg-graph-current-file-change',{detail:{owner,id:getCurrentFileId(owner)}}))}return true;
  }
  function restoreFile(id,options={}){
    const owner=options.owner||currentOwner(),previous=getFileMeta(id,owner,{includeTrash:true});
    if(!previous||previous.status!=='trashed'){emitError('要恢复的图谱文件不存在。');return null}
    const content=readContent(previous);if(!content){emitError('图谱文件内容缺失或损坏，无法恢复。');return null}
    const now=Date.now(),makeCurrent=options.makeCurrent===true,desiredFolderId=previous.restoreFolderId||previous.folderId,restoredFolderId=desiredFolderId&&validActiveFolder(desiredFolderId,owner)?desiredFolderId:null,entry=patchIndexFile(id,{status:'active',deletedAt:null,folderId:restoredFolderId,restoreFolderId:null,updatedAt:now,lastOpenedAt:makeCurrent?now:previous.lastOpenedAt},{owner,includeTrash:true});
    if(!entry){emitError('图谱文件恢复失败，本地存储空间可能已满。');return null}
    if(makeCurrent&&setCurrentFileId(id,owner,{emit:false})===null){patchIndexFile(id,previous,{owner,includeTrash:true});return null}
    const file=clone({...entry,graphData:content.graphData,learningState:content.learningState,revision:Math.max(entry.revision||1,content.revision||1)});
    clearError();if(options.emit!==false)emit('restore',file,{owner});return file;
  }
  function emptyTrash(options={}){
    ensureMigrated();const owner=options.owner||currentOwner(),index=readIndex(),targets=index.filter(file=>(options.owner===false||file.owner===owner)&&file.status==='trashed'),keep=index.filter(file=>!targets.includes(file)),folders=readFolders(),folderTargets=folders.filter(folder=>(options.owner===false||folder.owner===owner)&&folder.status==='trashed'),folderKeep=folders.filter(folder=>!folderTargets.includes(folder));
    if(!targets.length&&!folderTargets.length)return 0;
    if(!writeIndex(keep))return 0;
    if(!writeFolders(folderKeep)){writeIndex(index);return 0}
    targets.forEach(file=>{if(!removeKey(file.contentKey))console.warn('[KGGraphFileStore] orphan content cleanup failed:',file.contentKey)});
    clearError();if(options.emit!==false)emit('empty-trash',null,{owner,count:targets.length,folderCount:folderTargets.length});return targets.length+folderTargets.length;
  }
  function purgeExpiredTrash(options={}){
    const cutoff=Date.now()-(Math.max(1,Number(options.days)||TRASH_RETENTION_DAYS)*86400000),owner=options.owner||currentOwner(),index=readIndex(),targets=index.filter(file=>(options.owner===false||file.owner===owner)&&file.status==='trashed'&&Number(file.deletedAt)<=cutoff);
    if(!targets.length)return 0;const keys=new Set(targets.map(file=>file.owner+'\n'+file.id));if(!writeIndex(index.filter(file=>!keys.has(file.owner+'\n'+file.id))))return 0;targets.forEach(file=>{if(!removeKey(file.contentKey))console.warn('[KGGraphFileStore] orphan content cleanup failed:',file.contentKey)});return targets.length;
  }
  function reorderFiles(orderedIds,options={}){
    const owner=options.owner||currentOwner(),index=readIndex(),ownerFiles=sortOwnerFiles(index.filter(file=>file.owner===owner&&file.status==='active')),existing=new Set(ownerFiles.map(file=>String(file.id))),seen=new Set(),cleanIds=[];
    (Array.isArray(orderedIds)?orderedIds:[]).forEach(id=>{const value=cleanText(id,'',120);if(value&&existing.has(value)&&!seen.has(value)){seen.add(value);cleanIds.push(value)}});
    const finalIds=[...cleanIds,...ownerFiles.map(file=>String(file.id)).filter(id=>!seen.has(id))];if(!finalIds.length)return [];
    finalIds.forEach((id,i)=>{const p=index.findIndex(file=>file.owner===owner&&String(file.id)===id);if(p>=0)index[p]=normalizeIndexEntry({...index[p],order:(i+1)*1000})});
    if(!writeIndex(index))return null;clearError();const ordered=listFiles({owner});if(options.emit!==false)emit('reorder',null,{owner,orderedIds:finalIds});return ordered;
  }
  function setFileTags(id,tags,options={}){
    const normalized=normalizeTags(tags);const entry=patchIndexFile(id,{tags:normalized,favorite:normalized.length>0,updatedAt:Date.now()},options);if(!entry){emitError('要设置标签的图谱文件不存在。');return null}const file=hydrate(entry);clearError();if(options.emit!==false)emit('tags',file,{owner:entry.owner});return file;
  }
  function getFileTags(id,options={}){const file=listFiles({owner:options.owner||currentOwner(),includeTrash:true}).find(item=>item.id===id);return file?clone(file.tags):[]}
  function setFileFavorite(id,favorite,options={}){
    const current=listFiles({owner:options.owner||currentOwner(),includeTrash:true}).find(item=>item.id===id);if(!current){emitError('要收藏的图谱文件不存在。');return null}
    const nextTags=favorite===true?(current.tags.length?current.tags:['收藏']):[];
    const entry=patchIndexFile(id,{tags:normalizeTags(nextTags),favorite:nextTags.length>0,updatedAt:Date.now()},options);if(!entry)return null;
    clearError();if(options.emit!==false)emit('favorite-file',entry,{owner:entry.owner,favorite:entry.favorite});return clone(entry);
  }
  function readTagMap(){return objectMap(readJSON(TAGS_KEY,{}))}
  function listTags(options={}){
    const owner=options.owner||currentOwner(),map=readTagMap(),records=Array.isArray(map[owner])?map[owner]:[],fromFiles=listFiles({owner,includeTrash:true}).flatMap(file=>file.tags).map(name=>({id:'tag_'+name,name,color:''})),merged=new Map();
    [...records,...fromFiles].forEach(tag=>{const name=cleanText(tag&&tag.name||tag,'',40);if(name&&!merged.has(name.toLowerCase()))merged.set(name.toLowerCase(),{id:cleanText(tag&&tag.id,'tag_'+name,120),name,color:cleanText(tag&&tag.color,'',20)})});return clone([...merged.values()]);
  }
  function createTag(name,color='',options={}){
    const owner=options.owner||currentOwner(),safeName=cleanText(name,'',40);if(!safeName)return null;const map=readTagMap(),list=listTags({owner});let tag=list.find(item=>item.name.toLowerCase()===safeName.toLowerCase());
    if(!tag){tag={id:uid('tag'),name:safeName,color:cleanText(color,'',20)};list.push(tag)}map[owner]=list;if(!writeJSON(TAGS_KEY,map)){emitError('文件标签写入失败，本地存储空间可能已满。');return null}clearError();if(options.emit!==false)emit('tag-create',null,{owner,tag:clone(tag)});return clone(tag);
  }
  function updateTag(nameOrId,patch={},options={}){
    const owner=options.owner||currentOwner(),list=listTags({owner}),target=list.find(tag=>tag.id===nameOrId||tag.name===nameOrId);if(!target){emitError('标签不存在。');return null}
    const nextName=cleanText(patch.name===undefined?target.name:patch.name,'',40),nextColor=cleanText(patch.color===undefined?target.color:patch.color,'',20);if(!nextName){emitError('标签名称不能为空。');return null}
    if(list.some(tag=>tag.id!==target.id&&tag.name.toLowerCase()===nextName.toLowerCase())){emitError('已存在同名标签。');return null}
    const index=readIndex(),map=readTagMap(),beforeIndex=clone(index),beforeMap=clone(map);
    index.forEach((file,i)=>{if(file.owner===owner&&file.tags.includes(target.name))index[i]=normalizeIndexEntry({...file,tags:file.tags.map(name=>name===target.name?nextName:name),updatedAt:Date.now()})});
    map[owner]=list.map(tag=>tag.id===target.id?{...tag,name:nextName,color:nextColor}:tag);
    if(!writeIndex(index))return null;if(!writeJSON(TAGS_KEY,map)){writeIndex(beforeIndex);writeJSON(TAGS_KEY,beforeMap);emitError('标签更新失败，本地存储空间可能已满。');return null}
    const updated=map[owner].find(tag=>tag.id===target.id);clearError();if(options.emit!==false)emit('tag-update',null,{owner,tag:clone(updated),previous:target});return clone(updated);
  }
  function deleteTag(nameOrId,options={}){
    const owner=options.owner||currentOwner(),list=listTags({owner}),target=list.find(tag=>tag.id===nameOrId||tag.name===nameOrId);if(!target)return false;
    const index=readIndex(),map=readTagMap();index.forEach((file,i)=>{if(file.owner===owner&&file.tags.includes(target.name))index[i]=normalizeIndexEntry({...file,tags:file.tags.filter(name=>name!==target.name)})});
    if(!writeIndex(index))return false;map[owner]=list.filter(tag=>tag.id!==target.id);if(!writeJSON(TAGS_KEY,map)){emitError('文件标签删除失败，本地存储空间可能已满。');return false}clearError();if(options.emit!==false)emit('tag-delete',null,{owner,tag:target});return true;
  }

  function normalizeFolder(raw={},ownerFallback=currentOwner()){
    const now=Date.now();
    return{
      schemaVersion:1,
      id:cleanText(raw.id,uid('folder'),120),
      owner:cleanText(raw.owner,ownerFallback,120)||'guest',
      name:cleanText(raw.name,'新建文件夹',100),
      favorite:false,
      parentId:cleanText(raw.parentId,'',120)||null,
      restoreParentId:cleanText(raw.restoreParentId,'',120)||null,
      createdAt:Math.max(0,Number(raw.createdAt)||now),
      updatedAt:Math.max(0,Number(raw.updatedAt)||now),
      order:Number.isFinite(Number(raw.order))?Number(raw.order):now,
      status:raw.status==='trashed'?'trashed':'active',
      deletedAt:raw.status==='trashed'?Math.max(0,Number(raw.deletedAt)||now):null
    };
  }
  function readFolders(){
    const raw=readJSON(FOLDERS_KEY,[]);return(Array.isArray(raw)?raw:[]).map(item=>normalizeFolder(item,item&&item.owner||'guest'));
  }
  function writeFolders(folders){
    if(!writeJSON(FOLDERS_KEY,(Array.isArray(folders)?folders:[]).map(item=>normalizeFolder(item,item&&item.owner||'guest'))))return emitError('文件夹信息写入失败，本地存储空间可能已满。');
    return true;
  }
  function listFolders(options={}){
    const owner=options.owner||currentOwner(),includeTrash=options.includeTrash===true,status=options.status;
    return clone(readFolders().filter(folder=>folder.owner===owner&&(includeTrash||(status?folder.status===status:folder.status==='active'))).sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0)||(Number(a.createdAt)||0)-(Number(b.createdAt)||0)));
  }
  function getFolder(id,options={}){
    const owner=options.owner||currentOwner();return clone(readFolders().find(folder=>folder.owner===owner&&folder.id===id&&(options.includeTrash||folder.status==='active'))||null);
  }
  function validActiveFolder(folderId,owner,folders=readFolders()){
    if(!folderId)return true;return folders.some(folder=>folder.owner===owner&&folder.id===folderId&&folder.status==='active');
  }
  function createFolder(input={},options={}){
    const owner=options.owner||currentOwner(),folders=readFolders(),parentId=cleanText(input.parentId,'',120)||null;
    if(parentId&&!validActiveFolder(parentId,owner,folders)){emitError('目标文件夹不存在或已在回收站。');return null}
    const siblings=folders.filter(folder=>folder.owner===owner&&folder.status==='active'&&folder.parentId===parentId),lastOrder=siblings.reduce((max,item)=>Math.max(max,Number(item.order)||0),0),now=Date.now();
    const folder=normalizeFolder({id:input.id||uid('folder'),owner,name:input.name||'新建文件夹',favorite:false,parentId,createdAt:input.createdAt||now,updatedAt:now,order:Number.isFinite(Number(input.order))?Number(input.order):lastOrder+1000,status:'active'},owner);
    folders.push(folder);if(!writeFolders(folders))return null;clearError();if(options.emit!==false)emit('folder-create',null,{owner,folder:clone(folder)});return clone(folder);
  }
  function renameFolder(id,name,options={}){
    const owner=options.owner||currentOwner(),folders=readFolders(),position=folders.findIndex(folder=>folder.owner===owner&&folder.id===id&&(options.includeTrash||folder.status==='active'));
    if(position<0){emitError('要重命名的文件夹不存在。');return null}
    folders[position]=normalizeFolder({...folders[position],name:cleanText(name,'未命名文件夹',100),updatedAt:Date.now()},owner);
    if(!writeFolders(folders))return null;clearError();if(options.emit!==false)emit('folder-rename',null,{owner,folder:clone(folders[position])});return clone(folders[position]);
  }
  function setFolderFavorite(id,favorite,options={}){
    emitError('文件夹不支持收藏或标签。');return null;
  }
  function moveFile(id,folderId,options={}){
    const owner=options.owner||currentOwner(),folders=readFolders(),targetId=cleanText(folderId,'',120)||null;
    if(targetId&&!validActiveFolder(targetId,owner,folders)){emitError('目标文件夹不存在或已在回收站。');return null}
    const entry=patchIndexFile(id,{folderId:targetId,updatedAt:Date.now()},{owner,includeTrash:!!options.includeTrash});
    if(!entry){emitError('要移动的图谱文件不存在。');return null}const file=hydrate(entry);clearError();if(options.emit!==false)emit('move',file,{owner,folderId:targetId});return file;
  }
  function folderDescendantIds(id,owner,folders=readFolders()){
    const result=new Set(),queue=[id];while(queue.length){const parent=queue.shift();folders.forEach(folder=>{if(folder.owner===owner&&folder.parentId===parent&&!result.has(folder.id)){result.add(folder.id);queue.push(folder.id)}})}return result;
  }
  function moveFolder(id,parentId,options={}){
    const owner=options.owner||currentOwner(),folders=readFolders(),position=folders.findIndex(folder=>folder.owner===owner&&folder.id===id&&folder.status==='active'),targetId=cleanText(parentId,'',120)||null;
    if(position<0){emitError('要移动的文件夹不存在。');return null}if(targetId===id){emitError('文件夹不能移动到自身。');return null}
    if(targetId&&!validActiveFolder(targetId,owner,folders)){emitError('目标文件夹不存在或已在回收站。');return null}
    if(targetId&&folderDescendantIds(id,owner,folders).has(targetId)){emitError('文件夹不能移动到自己的子文件夹中。');return null}
    folders[position]=normalizeFolder({...folders[position],parentId:targetId,updatedAt:Date.now()},owner);if(!writeFolders(folders))return null;clearError();if(options.emit!==false)emit('folder-move',null,{owner,folder:clone(folders[position]),parentId:targetId});return clone(folders[position]);
  }
  function trashFolder(id,options={}){
    const owner=options.owner||currentOwner(),originalFolders=readFolders(),folders=clone(originalFolders),root=folders.find(folder=>folder.owner===owner&&folder.id===id&&folder.status==='active');if(!root){emitError('要删除的文件夹不存在。');return false}
    const affected=new Set([id,...folderDescendantIds(id,owner,folders)]),now=Date.now(),originalIndex=readIndex(),index=clone(originalIndex);
    folders.forEach((folder,i)=>{if(folder.owner===owner&&affected.has(folder.id))folders[i]=normalizeFolder({...folder,status:'trashed',deletedAt:now,updatedAt:now,parentId:folder.id===id?null:folder.parentId,restoreParentId:folder.id===id?folder.parentId:folder.restoreParentId},owner)});
    index.forEach((file,i)=>{if(file.owner===owner&&file.status==='active'&&file.folderId&&affected.has(file.folderId))index[i]=normalizeIndexEntry({...file,status:'trashed',deletedAt:now,updatedAt:now})});
    if(!writeFolders(folders))return false;if(!writeIndex(index)){writeFolders(originalFolders);emitError('文件夹内容移动到回收站失败。');return false}
    const currentId=getCurrentFileId(owner),currentWasTrashed=index.some(file=>file.owner===owner&&file.id===currentId&&file.status==='trashed');if(currentWasTrashed){const remaining=sortOwnerFiles(index.filter(file=>file.owner===owner&&file.status==='active'));setCurrentFileId(remaining[0]&&remaining[0].id||'',owner,{emit:false,allowMissing:true})}
    clearError();if(options.emit!==false){emit('folder-trash',null,{owner,id,folderIds:[...affected]});if(currentWasTrashed)global.dispatchEvent(new CustomEvent('kg-graph-current-file-change',{detail:{owner,id:getCurrentFileId(owner)}}))}return true;
  }
  function restoreFolder(id,options={}){
    const owner=options.owner||currentOwner(),originalFolders=readFolders(),folders=clone(originalFolders),root=folders.find(folder=>folder.owner===owner&&folder.id===id&&folder.status==='trashed');if(!root){emitError('要恢复的文件夹不存在。');return null}
    const affected=new Set([id,...folderDescendantIds(id,owner,folders)]),now=Date.now(),originalIndex=readIndex(),index=clone(originalIndex),desiredParent=root.restoreParentId||root.parentId,parentOk=!desiredParent||folders.some(folder=>folder.owner===owner&&folder.id===desiredParent&&folder.status==='active');
    folders.forEach((folder,i)=>{if(folder.owner===owner&&affected.has(folder.id))folders[i]=normalizeFolder({...folder,status:'active',deletedAt:null,updatedAt:now,parentId:folder.id===id?(parentOk?desiredParent:null):folder.parentId,restoreParentId:folder.id===id?null:folder.restoreParentId},owner)});
    index.forEach((file,i)=>{if(file.owner===owner&&file.status==='trashed'&&file.folderId&&affected.has(file.folderId))index[i]=normalizeIndexEntry({...file,status:'active',deletedAt:null,updatedAt:now})});
    if(!writeFolders(folders))return null;if(!writeIndex(index)){writeFolders(originalFolders);emitError('文件夹内容恢复失败。');return null}
    const restored=folders.find(folder=>folder.owner===owner&&folder.id===id);clearError();if(options.emit!==false)emit('folder-restore',null,{owner,folder:clone(restored)});return clone(restored);
  }
  function deleteFolderPermanently(id,options={}){
    const owner=options.owner||currentOwner(),folders=readFolders(),root=folders.find(folder=>folder.owner===owner&&folder.id===id&&folder.status==='trashed');if(!root){emitError('要永久删除的文件夹不存在。');return false}
    const affected=new Set([id,...folderDescendantIds(id,owner,folders)]),index=readIndex(),files=index.filter(file=>file.owner===owner&&file.folderId&&affected.has(file.folderId));
    if(files.length){emitError('文件夹中仍有文件，请先删除其中的文件或清空回收站。');return false}
    if(!writeFolders(folders.filter(folder=>!(folder.owner===owner&&affected.has(folder.id)))))return false;clearError();if(options.emit!==false)emit('folder-delete-permanent',null,{owner,id});return true;
  }
  function emptyFolderTrash(options={}){
    const owner=options.owner||currentOwner(),folders=readFolders(),targets=folders.filter(folder=>folder.owner===owner&&folder.status==='trashed');if(!targets.length)return 0;
    if(!writeFolders(folders.filter(folder=>!(folder.owner===owner&&folder.status==='trashed'))))return 0;return targets.length;
  }

  function legacyKey(){try{if(typeof global.currentStoreKey==='function')return global.currentStoreKey()}catch(err){}return ''}
  function readLegacyGraph(key=legacyKey()){
    if(!key)return null;try{const appStore=storage(),data=appStore&&typeof appStore.readJSON==='function'?appStore.readJSON(key,null):JSON.parse(localStorage.getItem(key)||'null');return data&&typeof data==='object'?safeGraphData(data):null}catch(err){return null}
  }
  function migrateLegacyGraph(options={}){
    const owner=options.owner||currentOwner(),existing=listFiles({owner});if(existing.length)return getCurrentFile(owner)||existing[0];const graphData=options.graphData||readLegacyGraph(options.legacyKey);if(!graphData)return null;
    return createFile({name:options.name||(graphData.meta&&graphData.meta.title)||'我的知识图谱',graphData,source:'legacy-single-migration'},{owner,makeCurrent:true});
  }
  function ensureInitialized(options={}){
    ensureMigrated();purgeExpiredTrash({owner:options.owner||currentOwner()});const owner=options.owner||currentOwner(),files=listFiles({owner});
    if(!files.length){const migrated=migrateLegacyGraph({...options,owner});if(migrated)return migrated;if(options.fallbackGraphData)return createFile({name:options.fallbackName||(options.fallbackGraphData.meta&&options.fallbackGraphData.meta.title)||'我的知识图谱',graphData:options.fallbackGraphData,source:'initial'},{owner,makeCurrent:true});return null}
    const current=getCurrentFile(owner)||files[0];if(current){setCurrentFileId(current.id,owner,{emit:false});if(options.touchOpened!==false)scheduleOpenedTouch(current.id,owner,Date.now(),{touchOpened:true})}return current;
  }
  function getStorageStats(options={}){
    ensureMigrated();const owner=options.owner===false?null:(options.owner||currentOwner()),files=readIndex().filter(file=>!owner||file.owner===owner),active=files.filter(file=>file.status==='active'),trashed=files.filter(file=>file.status==='trashed');
    return{schemaVersion:SCHEMA_VERSION,count:active.length,trashCount:trashed.length,totalCount:files.length,byteSize:files.reduce((sum,file)=>sum+(Number(file.byteSize)||0),0),activeByteSize:active.reduce((sum,file)=>sum+(Number(file.byteSize)||0),0),trashByteSize:trashed.reduce((sum,file)=>sum+(Number(file.byteSize)||0),0),nodeCount:active.reduce((sum,file)=>sum+(Number(file.nodeCount)||0),0),linkCount:active.reduce((sum,file)=>sum+(Number(file.linkCount)||0),0)};
  }
  async function estimateStorage(options={}){
    const stats=getStorageStats(options),result={...stats,usage:null,quota:null,available:null,ratio:null};
    try{if(global.navigator&&navigator.storage&&typeof navigator.storage.estimate==='function'){const estimate=await navigator.storage.estimate();result.usage=Number(estimate.usage)||0;result.quota=Number(estimate.quota)||0;result.available=Math.max(0,result.quota-result.usage);result.ratio=result.quota?result.usage/result.quota:null}}catch(err){}
    return result;
  }
  function refreshFilePreviews(options={}){
    ensureMigrated();const owner=options.owner===false?null:(options.owner||currentOwner()),includeTrash=options.includeTrash!==false,index=readIndex();let changed=0,checked=0;
    index.forEach((entry,position)=>{
      if(owner&&entry.owner!==owner)return;if(!includeTrash&&entry.status==='trashed')return;
      if(options.maxCount&&checked>=Number(options.maxCount))return;
      const content=readContent(entry);if(!content)return;
      const structureHash=graphPreviewStructureHash(content.graphData);
      if(options.force!==true&&entry.preview&&entry.preview.structureHash===structureHash)return;
      if(options.maxCount&&checked>=Number(options.maxCount))return;checked+=1;
      index[position]=normalizeIndexEntry({...entry,preview:buildGraphPreview(content.graphData,entry.id,entry.revision)});changed+=1;
    });
    if(!changed)return 0;
    if(!writeIndex(index))return 0;
    clearError();if(options.emit!==false)emit('preview-refresh',null,{owner,count:changed});return changed;
  }
  function verifyIntegrity(options={}){
    ensureMigrated();const owner=options.owner===false?null:(options.owner||currentOwner()),files=readIndex().filter(file=>!owner||file.owner===owner),missing=[];
    files.forEach(file=>{if(!readJSON(file.contentKey,null))missing.push({id:file.id,owner:file.owner,name:file.name})});return{ok:missing.length===0,checked:files.length,missing};
  }

  try{global.addEventListener('pagehide',()=>flushOpenedTouches({emit:false}));global.addEventListener('beforeunload',()=>flushOpenedTouches({emit:false}))}catch(err){}
  ensureMigrated();
  global.KGGraphFileStore={
    SCHEMA_VERSION,INDEX_KEY,CONTENT_PREFIX,CURRENT_FILE_KEY,TAGS_KEY,FOLDERS_KEY,MIGRATION_KEY,RECENT_MIGRATION_KEY,FILES_KEY:INDEX_KEY,MAX_FILES_PER_OWNER,TRASH_RETENTION_DAYS,OPEN_TOUCH_DELAY_MS,PREVIEW_VERSION,PREVIEW_MAX_NODES,PREVIEW_MAX_LINKS,
    currentOwner,listFiles,getFileMeta,getCurrentFileMeta,getFile,getCurrentFile,createFile,openFile,saveFile,renameFile,deleteFile,restoreFile,emptyTrash,purgeExpiredTrash,duplicateFile,reorderFiles,
    setFileTags,getFileTags,setFileFavorite,listTags,createTag,updateTag,deleteTag,listFolders,getFolder,createFolder,renameFolder,setFolderFavorite,moveFile,moveFolder,trashFolder,restoreFolder,deleteFolderPermanently,emptyFolderTrash,setCurrentFileId,getCurrentFileId,migrateLegacyGraph,ensureInitialized,readLegacyGraph,getLastError,
    getStorageStats,estimateStorage,verifyIntegrity,contentKey,touchFileOpened,flushOpenedTouches,buildGraphPreview,graphPreviewStructureHash,refreshFilePreviews
  };
})(window);
