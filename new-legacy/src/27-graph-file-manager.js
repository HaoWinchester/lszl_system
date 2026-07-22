'use strict';

/*
 * v8.4.22 文件管理器：文件卡片布局与操作状态修复。
 * - 独立页面，仅用 v2 索引渲染文件列表；
 * - 支持新建、打开、重命名、复制、导入、导出与回收站；
 * - 支持搜索、排序、网格/列表视图、详情和存储统计；
 * - 支持浅色/深色主题，并保留用户选择。
 */
(function(global){
  const THEME_KEY='kg_file_manager_theme_v1';
  const LAYOUT_KEY='kg_file_manager_layout_v1';
  const SORT_KEY='kg_file_manager_sort_v1';
  const RECENT_FOLDER_KEY='kg_file_manager_recent_folders_v1';
  const DETAILS_KEY='kg_file_manager_details_open_v1';
  const SIDEBAR_COLLAPSED_KEY='kg_file_manager_sidebar_collapsed_v1';
  const FOLDER_SECTION_COLLAPSED_KEY='kg_file_manager_folder_section_collapsed_v1';
  const MAX_IMPORT_NODES=2500;
  const MAX_IMPORT_LINKS=5000;
  const store=global.KGGraphFileStore;
  const packages=global.KGHomePackageService;
  const auth=global.KGAuthCore||{};
  const roles=global.KGRolePermissions||{};
  const $=id=>document.getElementById(id);
  const state={
    view:'files',
    filter:'all',
    tagFilter:'',
    tags:[],
    layout:readSetting(LAYOUT_KEY,'grid')==='list'?'list':'grid',
    sort:readSetting(SORT_KEY,'updated-desc'),
    query:'',
    selectedId:'',
    activeFiles:[],
    trashFiles:[],
    folders:[],
    trashFolders:[],
    currentFolderId:null,
    selectedType:'file',
    modalHandler:null,
    busy:false,
    navigating:false,
    previewBackfillRunning:false,
    previewObserver:null,
    renameSession:null,
    storageRequestId:0,
    selectedItems:new Set(),
    dragPayload:null,
    recentFolders:[],
    undoMove:null,
    selectionMode:false,
    detailsOpen:readSetting(DETAILS_KEY,'0')==='1',
    submenuTimer:null,
    integrityResult:null,
    integrityOwner:'',
    integrityScheduled:false,
    initialSelectionDone:false,
    sidebarCollapsed:readSetting(SIDEBAR_COLLAPSED_KEY,'0')==='1',
    folderSectionCollapsed:readSetting(FOLDER_SECTION_COLLAPSED_KEY,'0')==='1',
    showAllFiles:true,
    expandedFolders:new Set()
  };

  const ICONS={
    open:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6H5V6h6"/></svg>',
    rename:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 16-1 5 5-1L19 9l-4-4Z"/><path d="m13.5 6.5 4 4"/></svg>',
    duplicate:'<svg aria-hidden="true" viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5H5v11h3"/></svg>',
    export:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/></svg>',
    trash:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/><path d="M10 11v5M14 11v5"/></svg>',
    restore:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 9V4h5"/><path d="M5 5a8 8 0 1 1-1 9"/><path d="M9 12h6"/></svg>',
    delete:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg>',
    folder:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 7h7l2 2h9v10H3Z"/><path d="M3 7V5h7l2 2"/></svg>',
    move:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 7h7l2 2h9v10H3Z"/><path d="M9 14h7M13 11l3 3-3 3"/></svg>',
    info:'<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/></svg>',
    favorite:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/></svg>',
    tag:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 12V5h7l11 11-5 5Z"/><circle cx="7.5" cy="8.5" r="1"/></svg>'
  };

  function readSetting(key,fallback=''){
    try{return global.KGAppStorage&&global.KGAppStorage.readString?global.KGAppStorage.readString(key,fallback):(localStorage.getItem(key)||fallback)}catch(err){return fallback}
  }
  function writeSetting(key,value){
    try{
      if(global.KGAppStorage&&global.KGAppStorage.writeString)return global.KGAppStorage.writeString(key,value);
      localStorage.setItem(key,value);return true;
    }catch(err){return false}
  }
  function cleanName(value,fallback='未命名图谱'){
    return (String(value??'').trim()||fallback).replace(/[\u0000-\u001f]/g,'').slice(0,100);
  }
  function currentOwner(){return store&&store.currentOwner?store.currentOwner():'guest'}
  function currentUser(){try{return auth.currentUser?auth.currentUser():null}catch(err){return null}}
  function isMobileReadonly(){return !!(global.matchMedia&&global.matchMedia('(max-width: 800px)').matches)}
  function canEdit(){if(isMobileReadonly())return false;return roles&&typeof roles.can==='function'?roles.can('editGraph'):!!currentUser()}
  function requireEdit(message='当前身份没有编辑图谱文件的权限。'){
    if(isMobileReadonly()){toast('移动端暂仅支持查看，文件管理与图谱编辑请使用电脑端。','error');return false}
    if(canEdit())return true;
    toast(message+' 请返回编辑器登录或切换账号。','error');
    return false;
  }
  function escapeHTML(value){return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
  function formatBytes(value){
    let bytes=Math.max(0,Number(value)||0);
    if(bytes<1024)return Math.round(bytes)+' B';
    const units=['KB','MB','GB','TB'];let i=-1;
    do{bytes/=1024;i++}while(bytes>=1024&&i<units.length-1);
    return `${bytes>=100?bytes.toFixed(0):bytes>=10?bytes.toFixed(1):bytes.toFixed(2)} ${units[i]}`;
  }
  function formatDate(value,withTime=true){
    const date=new Date(Number(value)||0);if(!Number(value)||Number.isNaN(date.getTime()))return '—';
    try{return date.toLocaleString('zh-CN',withTime?{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}:{year:'numeric',month:'2-digit',day:'2-digit'})}catch(err){return '—'}
  }
  let coverSerial=0;
  const COVER_PALETTES=[
    ['#7968e7','#aa9cf2','#eeeafd'],
    ['#438fc5','#7dbbe0','#e6f3fa'],
    ['#4f9b8c','#86c2b4','#e7f4ef'],
    ['#6277ca','#9cabdf','#ebeff9'],
    ['#4d939e','#84bdc4','#e6f3f4'],
    ['#9070d1','#baa1e4','#f0eafb']
  ];
  function stableCoverHash(file){
    const preview=file&&file.preview||{},source=[
      file&&file.id||'',file&&file.name||'',preview.structureHash||'',
      file&&file.nodeCount||preview.nodes&&preview.nodes.length||0,
      file&&file.linkCount||preview.links&&preview.links.length||0
    ].join('|');
    let h=2166136261;
    for(let i=0;i<source.length;i++){
      h^=source.charCodeAt(i);
      h=Math.imul(h,16777619);
      h^=h>>>13;
    }
    return (h^(h>>>16))>>>0;
  }

  function decorativeFallback(hash,palette){
    const count=8+(hash%4),nodes=[{x:100,y:55,r:6.6,label:'',degree:count-1}];
    for(let i=1;i<count;i++){
      const angle=(i-1)/(count-1)*Math.PI*2+((hash%180)*Math.PI/180);
      const ring=i%3,rx=35+ring*8,ry=25+ring*5;
      nodes.push({x:100+Math.cos(angle)*rx,y:55+Math.sin(angle)*ry,r:3+(i%3)*.45,label:'',degree:1});
    }
    const links=[];for(let i=1;i<count;i++)links.push({from:0,to:i});
    return{nodes,links,palette};
  }
  function prepareCoverPreview(file,hash,palette){
    const preview=file&&file.preview,rawNodes=preview&&Array.isArray(preview.nodes)?preview.nodes:[],rawLinks=preview&&Array.isArray(preview.links)?preview.links:[];
    if(!rawNodes.length)return decorativeFallback(hash,palette);
    const nodes=rawNodes.slice(0,14).map((node,index)=>({
      x:Number.isFinite(Number(node.x))?Number(node.x):100,
      y:Number.isFinite(Number(node.y))?Number(node.y):55,
      r:Math.max(2.7,Math.min(6.5,Number(node.r)||3.8)),
      label:String(node.label||'').trim().slice(0,8),
      degree:0,
      source:index
    }));
    const links=rawLinks.slice(0,20).map(link=>({from:Number(link.from),to:Number(link.to)}))
      .filter(link=>Number.isInteger(link.from)&&Number.isInteger(link.to)&&link.from>=0&&link.to>=0&&link.from<nodes.length&&link.to<nodes.length&&link.from!==link.to);
    links.forEach(link=>{nodes[link.from].degree++;nodes[link.to].degree++});
    const xs=nodes.map(n=>n.x).sort((a,b)=>a-b),ys=nodes.map(n=>n.y).sort((a,b)=>a-b);
    const q=(arr,p)=>arr[Math.max(0,Math.min(arr.length-1,Math.floor((arr.length-1)*p)))];
    const minX=q(xs,.05),maxX=q(xs,.95),minY=q(ys,.05),maxY=q(ys,.95),spanX=Math.max(1,maxX-minX),spanY=Math.max(1,maxY-minY);
    nodes.forEach((node,index)=>{
      node.x=24+Math.max(0,Math.min(1,(node.x-minX)/spanX))*152;
      node.y=16+Math.max(0,Math.min(1,(node.y-minY)/spanY))*78;
      const wobble=((hash>>>(index%24))&3)-1.5;
      node.x+=wobble*.8;node.y+=((((hash+index*17)>>>3)&3)-1.5)*.45;
    });
    for(let pass=0;pass<5;pass++){
      for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
        const a=nodes[i],b=nodes[j],dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy)||.01,minDist=a.r+b.r+5;
        if(dist<minDist){const push=(minDist-dist)*.18,ux=dx/dist,uy=dy/dist;a.x-=ux*push;a.y-=uy*push;b.x+=ux*push;b.y+=uy*push}
      }
    }
    nodes.forEach(node=>{node.x=Math.max(12,Math.min(188,node.x));node.y=Math.max(12,Math.min(98,node.y))});
    return{nodes,links,palette};
  }
  function coverHTML(file){
    const hash=stableCoverHash(file);
    const palette=COVER_PALETTES[(hash+(file&&file.nodeCount||0)+(file&&file.linkCount||0))%COVER_PALETTES.length];
    const data=prepareCoverPreview(file,hash,palette),nodes=data.nodes,links=data.links;
    const accentA=palette[0],accentB=palette[1],bgA=palette[2],token=`fmCover${(++coverSerial).toString(36)}${hash.toString(36)}`;
    const maxDegree=Math.max(1,...nodes.map(node=>node.degree||0));
    const ranked=nodes.map((node,index)=>({index,score:(node.degree||0)*10+node.r}))
      .sort((a,b)=>b.score-a.score);
    const primarySet=new Set(ranked.slice(0,Math.min(3,nodes.length)).map(item=>item.index));
    const lineMarkup=links.map((link,index)=>{
      const a=nodes[link.from],b=nodes[link.to],primary=primarySet.has(link.from)||primarySet.has(link.to);
      const seed=(hash^(index*2654435761))>>>0,bend=((seed%9)-4)*.36,mx=(a.x+b.x)/2,my=(a.y+b.y)/2+bend;
      return `<path class="fm-cover-edge${primary?' is-primary':''}" d="M${a.x.toFixed(1)} ${a.y.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}"/>`;
    }).join('');
    const nodeMarkup=nodes.map((node,index)=>{
      const importance=(node.degree||0)/maxDegree,main=primarySet.has(index);
      const color=((hash>>>(index%24))&1)?accentB:accentA;
      const radius=Math.max(2.7,Math.min(6.2,node.r*.82+importance*1.7+(main?.55:0)));
      return `<circle class="fm-cover-node${main?' is-primary':''}" style="--node:${escapeHTML(color)}" cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="${radius.toFixed(1)}"/>`;
    }).join('');
    return `<div class="fm-file-cover" style="--cover-a:${escapeHTML(accentA)};--cover-b:${escapeHTML(accentB)};--cover-bg:${escapeHTML(bgA)}"><svg aria-hidden="true" viewBox="0 0 200 110" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="${token}Bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${escapeHTML(bgA)}"/><stop offset=".62" stop-color="${escapeHTML(accentB)}" stop-opacity=".055"/><stop offset="1" stop-color="${escapeHTML(accentA)}" stop-opacity=".11"/></linearGradient></defs><rect width="200" height="110" fill="url(#${token}Bg)"/><g class="fm-cover-network">${lineMarkup}${nodeMarkup}</g></svg></div>`;
  }
  function coverPlaceholderHTML(file){
    const hash=stableCoverHash(file);
    const palette=COVER_PALETTES[(hash+(file&&file.nodeCount||0)+(file&&file.linkCount||0))%COVER_PALETTES.length];
    const accentA=palette[0],accentB=palette[1],bgA=palette[2];
    return `<div class="fm-file-cover fm-file-cover-lazy fm-file-cover-placeholder" data-preview-file="${escapeHTML(file&&file.id||'')}" style="--cover-a:${escapeHTML(accentA)};--cover-b:${escapeHTML(accentB)};--cover-bg:${escapeHTML(bgA)}"><span class="fm-cover-loading" aria-hidden="true"></span></div>`;
  }

  function disconnectPreviewObserver(){
    if(state.previewObserver){state.previewObserver.disconnect();state.previewObserver=null}
  }
  function hydrateCover(element){
    if(!element||!element.isConnected)return;
    const file=[...state.activeFiles,...state.trashFiles].find(item=>item.id===element.dataset.previewFile);if(!file)return;
    const template=document.createElement('template');template.innerHTML=coverHTML(file).trim();const cover=template.content.firstElementChild;if(cover)element.replaceWith(cover);
  }
  function observeLazyPreviews(){
    disconnectPreviewObserver();const covers=[...document.querySelectorAll('#fmFileGrid .fm-file-cover-lazy')];if(!covers.length)return;
    if(typeof global.IntersectionObserver!=='function'){covers.forEach(hydrateCover);return}
    state.previewObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)return;state.previewObserver&&state.previewObserver.unobserve(entry.target);hydrateCover(entry.target)}),{root:null,rootMargin:'180px 0px',threshold:.01});
    covers.forEach(cover=>state.previewObserver.observe(cover));
  }
  function indexedName(base,index,maxLength=100){
    const clean=cleanName(base),suffix=` (${Math.max(2,Number(index)||2)})`,head=clean.slice(0,Math.max(1,maxLength-suffix.length)).trimEnd();
    return (head+suffix).slice(0,maxLength);
  }
  function uniqueNameFromSet(base,names){
    const clean=cleanName(base),used=names instanceof Set?names:new Set();
    if(!used.has(clean.toLowerCase()))return clean;
    for(let index=2;index<10000;index++){
      const candidate=indexedName(clean,index);
      if(!used.has(candidate.toLowerCase()))return candidate;
    }
    return indexedName(clean,Date.now());
  }
  function uniqueName(base,excludeId=''){
    const names=new Set([...state.activeFiles,...state.trashFiles].filter(file=>file.id!==excludeId).map(file=>String(file.name).toLowerCase()));
    return uniqueNameFromSet(base,names);
  }
  function blankGraph(name){
    return{
      meta:{title:name,subject:'自定义学科',audience:'学员',description:'点击“新增知识点”开始创建。'},
      viewport:{x:260,y:170,scale:1},
      defaults:{nodeSize:'',nodeColor:'#64748b',linkStyle:'solid',linkPathStyle:'curve',linkColor:'#2563eb',flashSwipeSpeed:2},
      focusMode:false,selectedNodeId:null,selectedLinkId:null,linkSourceId:null,nodes:[],links:[],importedFlashcards:[],flashReviews:{}
    };
  }
  function normalizeImportedGraph(raw){
    let source=raw&&raw.graphData&&typeof raw.graphData==='object'?raw.graphData:raw;
    if(!source||typeof source!=='object'||Array.isArray(source))throw new Error('文件内容不是有效的知识图谱对象。');
    if(!Array.isArray(source.nodes)||!Array.isArray(source.links))throw new Error('文件缺少 nodes 或 links 数组，不是受支持的知识图谱文件。');
    const nodes=source.nodes,links=source.links;
    if(nodes.length>MAX_IMPORT_NODES)throw new Error(`节点数量超过 ${MAX_IMPORT_NODES} 个限制。`);
    if(links.length>MAX_IMPORT_LINKS)throw new Error(`关系数量超过 ${MAX_IMPORT_LINKS} 条限制。`);
    const graph={...source};
    graph.meta={...(source.meta&&typeof source.meta==='object'?source.meta:{}),title:cleanName(source.meta&&source.meta.title||raw&&raw.name||'导入的知识图谱')};
    graph.nodes=nodes;graph.links=links;
    return graph;
  }
  function toast(message,type='success',duration=3000,action=null){
    const host=$('fmToastStack');if(!host)return;
    const item=document.createElement('div');item.className='fm-toast '+(type==='error'?'is-error':'is-success');
    const text=document.createElement('span');text.textContent=String(message||'');item.appendChild(text);
    if(action&&typeof action.handler==='function'){
      const button=document.createElement('button');button.type='button';button.className='fm-toast-action';button.textContent=action.label||'撤销';
      button.addEventListener('click',()=>{button.disabled=true;Promise.resolve(action.handler()).finally(()=>item.remove())});item.appendChild(button);
    }
    host.appendChild(item);setTimeout(()=>{if(!item.isConnected)return;item.style.opacity='0';item.style.transform='translateY(6px)';setTimeout(()=>item.remove(),180)},duration);
  }
  function itemKey(kind,id){return `${kind}:${String(id||'')}`}
  function selectedPayload(){
    const list=[];state.selectedItems.forEach(key=>{const [kind,...rest]=key.split(':');const id=rest.join(':');if(kind==='file'&&state.activeFiles.some(item=>item.id===id))list.push({kind,id});else if(kind==='folder'&&state.folders.some(item=>item.id===id))list.push({kind,id})});
    if(!list.length&&state.selectedId)list.push({kind:state.selectedType,id:state.selectedId});
    const selectedFolders=new Set(list.filter(item=>item.kind==='folder').map(item=>item.id));
    return list.filter(item=>{
      let parentId=null;
      if(item.kind==='folder'){const folder=state.folders.find(entry=>entry.id===item.id);parentId=folder&&folder.parentId||null}
      else{const file=state.activeFiles.find(entry=>entry.id===item.id);parentId=file&&file.folderId||null}
      let guard=0;while(parentId&&guard++<50){if(selectedFolders.has(parentId))return false;const parent=state.folders.find(entry=>entry.id===parentId);parentId=parent&&parent.parentId||null}
      return true;
    });
  }

  function validItemKeys(){
    const keys=new Set();
    const files=state.view==='trash'?state.trashFiles:state.activeFiles;
    const folders=state.view==='trash'?state.trashFolders:state.folders;
    files.forEach(item=>keys.add(itemKey('file',item.id)));
    folders.forEach(item=>keys.add(itemKey('folder',item.id)));
    return keys;
  }
  function pruneSelection(){
    const valid=validItemKeys();
    state.selectedItems=new Set([...state.selectedItems].filter(key=>valid.has(key)));
  }
  function isIllegalDropTarget(items,targetId){
    const target=String(targetId||'');
    if(!target)return false;
    const payload=Array.isArray(items)?items:[];
    const draggedFolders=new Set(payload.filter(item=>item&&item.kind==='folder').map(item=>String(item.id||'')));
    if(draggedFolders.has(target))return true;
    let cursor=state.folders.find(folder=>folder.id===target),guard=0;
    while(cursor&&guard++<100){
      if(draggedFolders.has(String(cursor.id)))return true;
      cursor=cursor.parentId?state.folders.find(folder=>folder.id===cursor.parentId):null;
    }
    return false;
  }
  function scheduleIntegrityCheck({force=false}={}){
    if(!store||typeof store.verifyIntegrity!=='function')return;
    const owner=currentOwner();
    if(!force&&state.integrityResult&&state.integrityOwner===owner)return;
    if(state.integrityScheduled)return;
    state.integrityScheduled=true;
    const run=()=>{
      state.integrityScheduled=false;
      const requestOwner=currentOwner();
      try{
        const result=store.verifyIntegrity({owner:requestOwner});
        if(requestOwner!==currentOwner())return;
        state.integrityResult=result;state.integrityOwner=requestOwner;renderIntegrity();
      }catch(err){console.warn('[KGGraphFileManager] integrity check failed',err)}
    };
    if(typeof global.requestIdleCallback==='function')global.requestIdleCallback(run,{timeout:1400});else setTimeout(run,80);
  }

  function readRecentFolders(){try{const raw=JSON.parse(readSetting(RECENT_FOLDER_KEY,'[]'));state.recentFolders=Array.isArray(raw)?raw.map(String).slice(0,4):[]}catch(err){state.recentFolders=[]}}
  function rememberFolder(folderId){const id=String(folderId||'');state.recentFolders=[id,...state.recentFolders.filter(item=>item!==id)].slice(0,4);writeSetting(RECENT_FOLDER_KEY,JSON.stringify(state.recentFolders))}

  function setBusy(value){
    state.busy=!!value;document.body.classList.toggle('is-busy',state.busy);document.body.setAttribute('aria-busy',String(state.busy));
  }

  function filteredFiles(){
    let files=state.view==='trash'?state.trashFiles.slice():state.activeFiles.slice();
    if(state.view==='files'&&!state.query&&!state.showAllFiles)files=files.filter(file=>(file.folderId||null)===(state.currentFolderId||null));
    if(state.view==='trash'&&!state.query&&!state.showAllFiles)files=files.filter(file=>(file.folderId||null)===(state.currentFolderId||null));
    if(state.view==='recent')files=files.filter(file=>Number(file.lastOpenedAt)>0);
    if(state.view==='favorites')files=files.filter(file=>Array.isArray(file.tags)&&file.tags.length>0);
    if(state.filter==='created')files=files.filter(file=>!['import','imported','package-import'].includes(String(file.source||'')));
    if(state.filter==='tagged')files=files.filter(file=>Array.isArray(file.tags)&&file.tags.length);
    if(state.tagFilter)files=files.filter(file=>Array.isArray(file.tags)&&file.tags.includes(state.tagFilter));
    const query=state.query.trim().toLowerCase();
    if(query)files=files.filter(file=>[file.name,file.description,...(file.tags||[])].join(' ').toLowerCase().includes(query));
    const sort=state.view==='recent'?'opened-desc':state.sort;
    const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
    files.sort((a,b)=>{
      if(sort==='name-asc')return collator.compare(a.name,b.name);
      if(sort==='size-desc')return (Number(b.byteSize)||0)-(Number(a.byteSize)||0)||(Number(b.updatedAt)||0)-(Number(a.updatedAt)||0);
      if(sort==='created-desc')return (Number(b.createdAt)||0)-(Number(a.createdAt)||0);
      if(sort==='opened-desc')return (Number(b.lastOpenedAt)||0)-(Number(a.lastOpenedAt)||0);
      return (Number(b.updatedAt)||0)-(Number(a.updatedAt)||0);
    });
    return state.view==='recent'?files.slice(0,24):files;
  }
  function refreshData(options={}){
    if(!store)return;
    state.activeFiles=store.listFiles({owner:currentOwner()});
    state.trashFiles=store.listFiles({owner:currentOwner(),includeTrash:true,status:'trashed'});
    state.folders=store.listFolders?store.listFolders({owner:currentOwner()}):[];
    state.trashFolders=store.listFolders?store.listFolders({owner:currentOwner(),includeTrash:true,status:'trashed'}):[];
    state.tags=store.listTags?store.listTags({owner:currentOwner()}):[];
    if(state.tagFilter&&!state.tags.some(tag=>tag.name===state.tagFilter))state.tagFilter='';
    const selectedPool=state.selectedType==='folder'?[...state.folders,...state.trashFolders]:[...state.activeFiles,...state.trashFiles];
    if(state.selectedId&&!selectedPool.some(item=>item.id===state.selectedId)){state.selectedId='';state.selectedType='file'}
    if(state.currentFolderId){const pool=state.view==='trash'?state.trashFolders:state.folders;if(!pool.some(folder=>folder.id===state.currentFolderId)){state.currentFolderId=null;state.showAllFiles=true;}}
    pruneSelection();
    if(state.view==='favorites'){
      const favoriteKeys=new Set(state.activeFiles.filter(item=>item.tags&&item.tags.length).map(item=>itemKey('file',item.id)));
      state.selectedItems=new Set([...state.selectedItems].filter(key=>favoriteKeys.has(key)));
      if(state.selectedId&&!favoriteKeys.has(itemKey(state.selectedType,state.selectedId))){state.selectedId='';state.selectedType='file'}
    }
    if(!state.initialSelectionDone){
      state.initialSelectionDone=true;
      const currentId=store.getCurrentFileId?store.getCurrentFileId(currentOwner()):'';
      const current=state.activeFiles.find(file=>file.id===currentId);
      if(current){state.view='files';state.currentFolderId=current.folderId||null;state.showAllFiles=false;state.selectedType='file';state.selectedId=current.id;state.selectedItems=new Set([itemKey('file',current.id)]);}
    }
    render();
    refreshStorage();
    scheduleIntegrityCheck({force:!!options.forceIntegrity});
    if(options.previews!==false)schedulePreviewBackfill();
    if(options.toast)toast(options.toast);
  }
  function schedulePreviewBackfill(){
    if(state.previewBackfillRunning||!store||typeof store.refreshFilePreviews!=='function')return;
    const files=[...state.activeFiles,...state.trashFiles],missing=files.some(file=>!file.preview||!file.preview.structureHash);
    if(!missing)return;
    state.previewBackfillRunning=true;
    const run=()=>{
      let changed=0;
      try{
        changed=store.refreshFilePreviews({owner:currentOwner(),includeTrash:true,maxCount:8,emit:false});
        if(changed)refreshData({previews:false});
      }catch(err){console.warn('[KGGraphFileManager] preview backfill failed',err)}
      finally{state.previewBackfillRunning=false;if(changed)schedulePreviewBackfill()}
    };
    if(typeof global.requestIdleCallback==='function')global.requestIdleCallback(run,{timeout:900});else setTimeout(run,30);
  }
  async function refreshStorage(){
    if(!store)return;
    const requestId=++state.storageRequestId,owner=currentOwner();
    let stats;
    try{stats=await store.estimateStorage({owner})}catch(err){
      if(requestId===state.storageRequestId&&owner===currentOwner())console.warn('[KGGraphFileManager] storage estimate failed',err);
      return;
    }
    if(requestId!==state.storageRequestId||owner!==currentOwner())return;
    const usage=stats.usage==null?stats.byteSize:stats.usage,quota=Number(stats.quota)||0,ratio=quota?usage/quota:null;
    $('fmStorageUsed').textContent=formatBytes(usage);
    $('fmStorageQuota').textContent=quota?`共 ${formatBytes(quota)}`:'图谱文件库';
    $('fmStorageBar').style.width=`${Math.min(100,Math.max(usage>0&&!quota?2:0,(ratio||0)*100))}%`;
    $('fmStorageRatio').textContent=ratio==null?'浏览器未提供可用配额':`${(ratio*100).toFixed(ratio<.01?2:1)}% 已使用`;
    $('fmActiveBytes').textContent=formatBytes(stats.activeByteSize);
    $('fmTrashBytes').textContent=formatBytes(stats.trashByteSize);
    $('fmGraphTotals').textContent=`${stats.nodeCount} / ${stats.linkCount}`;
  }
  function updateHeader(){
    const configs={
      files:['文件管理','管理你的知识图谱文件'],
      recent:['最近打开','快速回到近期使用的图谱'],
      favorites:['我的收藏','按标签集中查看收藏的图谱文件'],
      trash:['回收站','恢复文件或将其永久删除']
    };
    const config=configs[state.view];$('fmPageTitle').textContent=config[0];$('fmPageSubtitle').textContent=config[1];
    document.querySelectorAll('.fm-nav-item').forEach(button=>button.classList.toggle('is-active',button.dataset.view===state.view));
    $('fmEmptyTrashBtn').hidden=state.view!=='trash'||(state.trashFiles.length===0&&state.trashFolders.length===0);
    $('fmImportBtn').hidden=state.view==='trash';
    $('fmSortSelect').disabled=state.view==='recent';
  }
  function renderCounts(){
    $('fmRecentCount').textContent=Math.min(24,state.activeFiles.filter(file=>file.lastOpenedAt).length);
    $('fmFavoriteCount').textContent=state.activeFiles.filter(file=>file.tags&&file.tags.length).length;
    $('fmTrashCount').textContent=state.trashFiles.length+state.trashFolders.length;
    const base=state.view==='trash'?state.trashFiles:state.view==='recent'?state.activeFiles.filter(file=>file.lastOpenedAt).slice(0,24):state.view==='favorites'?state.activeFiles.filter(file=>file.tags&&file.tags.length):state.activeFiles;
    $('fmAllCount').textContent=base.length;
    $('fmCreatedCount').textContent=base.filter(file=>!['import','imported','package-import'].includes(String(file.source||''))).length;
    $('fmTaggedCount').textContent=base.filter(file=>file.tags&&file.tags.length).length;
  }

  function folderChildren(folderId,{trash=false}={}){
    const list=trash?state.trashFolders:state.folders;return list.filter(folder=>(folder.parentId||null)===(folderId||null));
  }
  function currentFolder(){return state.folders.find(folder=>folder.id===state.currentFolderId)||state.trashFolders.find(folder=>folder.id===state.currentFolderId)||null}
  function renderBreadcrumbs(){
    const host=$('fmBreadcrumbBar');if(!host)return;host.replaceChildren();
    if(state.view==='recent'||state.view==='favorites'||(state.view==='files'&&state.showAllFiles)){host.hidden=true;return}host.hidden=false;
    const root=document.createElement('button');root.type='button';root.dataset.folderPath='';root.textContent=state.view==='trash'?'回收站':'未分类文件';host.appendChild(root);
    const folders=state.view==='trash'?state.trashFolders:state.folders,path=[];let id=state.currentFolderId,guard=0;
    while(id&&guard++<30){const folder=folders.find(item=>item.id===id);if(!folder)break;path.unshift(folder);id=folder.parentId}
    path.forEach(folder=>{const sep=document.createElement('span');sep.textContent='›';sep.setAttribute('aria-hidden','true');host.appendChild(sep);const button=document.createElement('button');button.type='button';button.dataset.folderPath=folder.id;button.textContent=folder.name;host.appendChild(button)});
    const last=host.querySelector('button:last-of-type');if(last){last.disabled=true;last.setAttribute('aria-current','page')}
  }
  function childFolderCard(folder,{trash=false}={}){
    const card=document.createElement('article'),childFolders=folderChildren(folder.id,{trash}).length,filePool=trash?state.trashFiles:state.activeFiles,childFiles=filePool.filter(file=>file.folderId===folder.id).length;
    card.className='fm-child-folder-card';card.dataset.childFolderId=folder.id;card.tabIndex=0;card.draggable=!trash;card.setAttribute('role','button');card.setAttribute('aria-label',`${folder.name}，打开文件夹`);
    card.innerHTML=`<span class="fm-child-folder-icon">${ICONS.folder}</span><div class="fm-child-folder-meta"><strong title="${escapeHTML(folder.name)}">${escapeHTML(folder.name)}</strong><span>子文件夹 ${childFolders} / 文件 ${childFiles}</span></div><button class="fm-child-folder-menu" type="button" data-child-folder-menu="${escapeHTML(folder.id)}" aria-label="${escapeHTML(folder.name)}的更多操作">···</button>`;
    return card;
  }

  function fileCard(file,currentId){
    const card=document.createElement('article');
    card.className='fm-file-card'+(state.selectedItems.has(itemKey('file',file.id))||state.selectedId===file.id?' is-selected':'');
    card.dataset.fileId=file.id;card.draggable=state.view!=='trash';card.tabIndex=0;card.setAttribute('role','button');card.setAttribute('aria-label',`${file.name}，双击打开`);
    const coverBadge=state.view==='trash'?'<span class="fm-trash-badge">回收站</span>':'';
    const currentBadge=state.view!=='trash'&&file.id===currentId?'<span class="fm-current-badge">当前打开</span>':'';
    const organizer=global.KGFileManagerOrganize,tagName=file.tags&&file.tags[0]||'',tagColor=organizer&&organizer.tagColor?organizer.tagColor(tagName):'#64748b';
    const tagButton=state.view!=='trash'?`<button class="fm-card-tag-dot ${tagName?'is-tagged':'is-empty'}" type="button" data-tag-file="${escapeHTML(file.id)}" style="--tag-color:${escapeHTML(tagColor)}" aria-label="${tagName?'标签：'+escapeHTML(tagName)+'，点击更换':'未设置标签，点击添加'}" title="${tagName?escapeHTML(tagName):'添加标签'}"></button>`:'';
    const cover=state.layout==='list'?'':coverPlaceholderHTML(file),coverBlock=state.layout==='list'?'':`<div class="fm-file-cover-shell">${cover}${coverBadge}</div>`;
    card.innerHTML=`<button class="fm-select-mark" type="button" data-select-kind="file" data-select-id="${escapeHTML(file.id)}" aria-label="选择 ${escapeHTML(file.name)}">✓</button>${coverBlock}${currentBadge}<button class="fm-file-menu-btn" type="button" data-menu-file="${escapeHTML(file.id)}" aria-label="${escapeHTML(file.name)}的更多操作">···</button><div class="fm-file-meta"><div class="fm-file-title-cell"><strong class="fm-file-name" title="${escapeHTML(file.name)}">${escapeHTML(file.name)}</strong>${file.id===currentId&&state.view!=='trash'?'<span class="fm-list-current-badge">当前打开</span>':''}</div><span class="fm-file-date">${formatDate(file.updatedAt)}</span><div class="fm-file-stats"><span><strong>${Number(file.nodeCount)||0}</strong> 节点</span><span><strong>${Number(file.linkCount)||0}</strong> 关系</span><span class="fm-file-size">${formatBytes(file.byteSize)}</span></div>${tagButton}<span class="fm-list-node-count">${Number(file.nodeCount)||0}</span><span class="fm-list-link-count">${Number(file.linkCount)||0}</span><span class="fm-list-size">${formatBytes(file.byteSize)}</span><span class="fm-list-tag-cell">${tagButton}</span></div>`;
    return card;
  }
  function renderFiles(){
    const grid=$('fmFileGrid'),empty=$('fmEmptyState'),files=filteredFiles(),currentId=store.getCurrentFileId(currentOwner()),folderSection=$('fmChildFolderSection'),folderGrid=$('fmChildFolderGrid'),fileSection=$('fmFileSection'),listHeader=$('fmListHeader');
    const showFolders=(state.view==='files'||state.view==='trash')&&!state.query&&!state.tagFilter,trash=state.view==='trash';
    const folders=showFolders?folderChildren(state.currentFolderId,{trash}).sort((a,b)=>new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'}).compare(a.name,b.name)):[];
    if(folderSection&&folderGrid){
      folderSection.hidden=!showFolders;
      folderGrid.replaceChildren();
      folders.forEach(folder=>folderGrid.appendChild(childFolderCard(folder,{trash})));
      $('fmChildFolderTitle').textContent=`文件夹（${folders.length}）`;
      const add=$('fmChildFolderAdd'),toggle=$('fmChildFolderToggle');if(add)add.hidden=trash;if(toggle)toggle.hidden=folders.length===0;
      if(folders.length)applyFolderSectionCollapsed(state.folderSectionCollapsed,{persist:false});
      else{folderSection.classList.remove('is-collapsed');folderGrid.hidden=false}
    }
    $('fmFileSectionTitle').textContent=`文件数（${files.length}）`;
    grid.classList.toggle('is-list',state.layout==='list');
    if(listHeader)listHeader.hidden=state.layout!=='list'||(!files.length&&state.view!=='files');
    grid.replaceChildren();
    const mayCreate=state.view==='files'&&!state.query&&state.filter==='all'&&!state.tagFilter;
    if(mayCreate){
      const create=document.createElement('button');create.type='button';create.className='fm-create-card';create.dataset.createFile='1';
      create.innerHTML='<div><span class="fm-create-plus">＋</span><strong>开始创作</strong><p>创建新的知识图谱</p></div>';grid.appendChild(create);
    }
    files.forEach(file=>grid.appendChild(fileCard(file,currentId)));
    const hasFileCards=files.length>0||mayCreate,hasContent=hasFileCards||folders.length>0;
    grid.hidden=!hasFileCards;
    if(fileSection)fileSection.hidden=!hasFileCards&&!folders.length;
    empty.hidden=hasContent;
    if(!hasContent){
      const query=state.query.trim();
      if(query){$('fmEmptyTitle').textContent='没有找到匹配文件';$('fmEmptyText').textContent='尝试更换关键词或清除筛选条件。';$('fmEmptyAction').textContent='清除搜索';$('fmEmptyAction').dataset.emptyAction='clear'}
      else if(state.view==='trash'){$('fmEmptyTitle').textContent='回收站为空';$('fmEmptyText').textContent='删除的文件会暂存在这里，默认保留 30 天。';$('fmEmptyAction').textContent='返回全部文件';$('fmEmptyAction').dataset.emptyAction='files'}
      else if(state.view==='favorites'){$('fmEmptyTitle').textContent='还没有收藏文件';$('fmEmptyText').textContent='给图谱文件添加标签后，它会自动出现在我的收藏中。';$('fmEmptyAction').textContent='返回全部文件';$('fmEmptyAction').dataset.emptyAction='files'}
      else{$('fmEmptyTitle').textContent=state.view==='recent'?'还没有最近打开的文件':'还没有图谱文件';$('fmEmptyText').textContent='创建一个新图谱，或导入已有学习包。';$('fmEmptyAction').textContent='新建图谱';$('fmEmptyAction').dataset.emptyAction='create'}
    }
    $('fmResultCount').textContent=`共 ${folders.length} 个文件夹，${files.length} 个图谱文件${state.selectedItems.size?` · 已选择 ${state.selectedItems.size} 项`:''}`;
    renderBreadcrumbs();
    observeLazyPreviews();
  }

  function selectedFile(){return state.selectedType==='file'?[...state.activeFiles,...state.trashFiles].find(file=>file.id===state.selectedId)||null:null}
  function selectedFolder(){return state.selectedType==='folder'?[...state.folders,...state.trashFolders].find(folder=>folder.id===state.selectedId)||null:null}
  function actionButton(label,action,className=''){const button=document.createElement('button');button.type='button';button.dataset.infoAction=action;button.className=className;button.textContent=label;return button}
  function setDetailsOpen(open,{persist=true}={}){
    state.detailsOpen=!!open;
    const drawer=$('fmDetailsDrawer'),backdrop=$('fmDrawerBackdrop'),button=$('fmDetailsBtn');
    if(drawer){drawer.classList.toggle('is-open',state.detailsOpen);drawer.setAttribute('aria-hidden',String(!state.detailsOpen))}
    if(backdrop)backdrop.hidden=!state.detailsOpen;
    if(button){button.classList.toggle('is-active',state.detailsOpen);button.setAttribute('aria-pressed',String(state.detailsOpen))}
    if(persist)writeSetting(DETAILS_KEY,state.detailsOpen?'1':'0');
  }
  function toggleDetails(){
    if(!state.selectedId&&!state.detailsOpen){toast('请先选择一个文件或文件夹。','error');return}
    setDetailsOpen(!state.detailsOpen);
  }
  function renderSelectionSummary(item,isFolder){
    const bar=$('fmSelectionSummary');if(!bar)return;
    bar.hidden=!item;if(!item)return;
    $('fmSummaryName').textContent=item.name;
    $('fmSummaryMeta').textContent=isFolder?`${folderChildren(item.id,{trash:item.status==='trashed'}).length} 个子文件夹 · 更新于 ${formatDate(item.updatedAt)}`:`${Number(item.nodeCount)||0} 个节点 · ${Number(item.linkCount)||0} 条关系 · ${formatBytes(item.byteSize)} · 更新于 ${formatDate(item.updatedAt)}`;
  }
  function renderInspector(){
    const file=selectedFile(),folder=selectedFolder(),item=file||folder,empty=$('fmInfoEmpty'),body=$('fmInfoBody'),close=$('fmCloseSelectionBtn');
    empty.hidden=!!item;body.hidden=!item;close.hidden=!item;
    const isFolder=!!folder;renderSelectionSummary(item,isFolder);if(!item)return;$('fmInfoKind').textContent=isFolder?'文件夹':'图谱文件';$('fmInfoName').textContent=item.name;
    $('fmInfoUpdated').textContent=formatDate(item.updatedAt);$('fmInfoCreated').textContent=formatDate(item.createdAt);
    $('fmInfoNodesRow').hidden=isFolder;$('fmInfoLinksRow').hidden=isFolder;$('fmInfoSizeRow').hidden=isFolder;$('fmInfoChildrenRow').hidden=!isFolder;
    if(file){$('fmInfoNodes').textContent=String(Number(file.nodeCount)||0);$('fmInfoLinks').textContent=String(Number(file.linkCount)||0);$('fmInfoSize').textContent=formatBytes(file.byteSize)}
    if(folder){const childFolders=folderChildren(folder.id,{trash:folder.status==='trashed'}).length,childFiles=(folder.status==='trashed'?state.trashFiles:state.activeFiles).filter(entry=>entry.folderId===folder.id).length;$('fmInfoChildren').textContent=`${childFolders} 个文件夹，${childFiles} 个文件`}
    $('fmInfoCurrent').hidden=isFolder||file.status==='trashed'||file.id!==store.getCurrentFileId(currentOwner());
    const tags=$('fmInfoTags');tags.replaceChildren();if(file)(file.tags||[]).forEach(tag=>{const span=document.createElement('span');span.className='fm-tag';span.textContent=tag;span.style.setProperty('--tag-color',global.KGFileManagerOrganize&&global.KGFileManagerOrganize.tagColor?global.KGFileManagerOrganize.tagColor(tag):'#64748b');tags.appendChild(span)});tags.hidden=isFolder||!(file&&file.tags&&file.tags.length);
    const actions=$('fmInfoActions');actions.replaceChildren();
    if(isFolder){if(folder.status==='trashed')actions.append(actionButton('恢复','folder-restore','is-primary'),actionButton('永久删除','folder-permanent','is-danger'));else actions.append(actionButton('打开','folder-open','is-primary'),actionButton('重命名','folder-rename'),actionButton('移动到','folder-move'),actionButton('移入回收站','folder-trash','is-danger'))}
    else if(file.status==='trashed')actions.append(actionButton('恢复','restore','is-primary'),actionButton('永久删除','permanent','is-danger'));
    else actions.append(actionButton('打开','open','is-primary'),actionButton(file.tags&&file.tags.length?'更换标签':'添加标签','tags'),actionButton('重命名','rename'),actionButton('移动到','move'),actionButton('复制','duplicate'),actionButton('导出','export'),actionButton('移入回收站','trash','is-danger'));
  }
  function renderIntegrity(){
    const el=$('fmIntegrityStatus');if(!el)return;
    const result=state.integrityOwner===currentOwner()?state.integrityResult:null;
    if(!result){el.textContent='等待空闲检查';el.style.color='';return}
    el.textContent=result.ok?'文件索引正常':`${result.missing.length} 个文件内容缺失`;
    el.style.color=result.ok?'':'var(--fm-danger)';
  }
  function captureInlineRename(){
    const session=state.renameSession;if(!session)return null;
    const input=session.input;
    return{id:session.id,kind:session.kind||'file',value:String(input&&input.value||session.originalName),selectionStart:input&&input.selectionStart,selectionEnd:input&&input.selectionEnd};
  }
  function restoreInlineRename(snapshot){
    if(!snapshot)return;
    const file=snapshot.kind==='folder'?[...state.folders,...state.trashFolders].find(item=>item.id===snapshot.id):[...state.activeFiles,...state.trashFiles].find(item=>item.id===snapshot.id);
    if(!file){toast('正在重命名的项目已不存在，编辑已取消。','error');return}
    const card=[...document.querySelectorAll('#fmFileGrid .fm-file-card')].find(item=>(snapshot.kind==='folder'?item.dataset.folderId:item.dataset.fileId)===String(snapshot.id));
    if(!card)return;
    if(!beginInlineRename(file,card,{value:snapshot.value,selectAll:false,kind:snapshot.kind}))return;
    const input=state.renameSession&&state.renameSession.input;if(!input)return;
    requestAnimationFrame(()=>{
      if(!input.isConnected)return;input.focus();
      const start=Number.isInteger(snapshot.selectionStart)?snapshot.selectionStart:input.value.length;
      const end=Number.isInteger(snapshot.selectionEnd)?snapshot.selectionEnd:start;
      try{input.setSelectionRange(Math.min(start,input.value.length),Math.min(end,input.value.length))}catch(err){}
    });
  }
  function renderTagFilters(){
    const button=$('fmFavoriteTagsBtn'),popover=$('fmFavoriteTagsPopover'),list=$('fmFavoriteTagsList'),title=$('fmFavoriteTagsTitle'),label=$('fmFavoriteTagsBtnLabel');
    if(button)button.hidden=state.view!=='favorites';
    if(label)label.textContent=state.tagFilter||'全部标签';
    if(title)title.textContent=`全部标签（${state.tags.length}）`;
    if(!list)return;list.replaceChildren();
    const all=document.createElement('button');all.type='button';all.dataset.favoriteTag='';all.className='fm-favorite-tag-item'+(!state.tagFilter?' is-active':'');
    all.innerHTML=`<span class="fm-favorite-tag-star">★</span><span>全部标签</span><b>${state.activeFiles.filter(file=>file.tags&&file.tags.length).length}</b>`;list.appendChild(all);
    state.tags.forEach(tag=>{const count=state.activeFiles.filter(file=>file.tags&&file.tags.includes(tag.name)).length,entry=document.createElement('button');entry.type='button';entry.dataset.favoriteTag=tag.name;entry.className='fm-favorite-tag-item'+(state.tagFilter===tag.name?' is-active':'');entry.title=tag.name;entry.innerHTML=`<i style="--tag-color:${escapeHTML(tag.color||'#64748b')}"></i><span>${escapeHTML(tag.name)}</span><b>${count}</b>`;list.appendChild(entry)});
    if(popover&&!popover.hidden&&state.view!=='favorites')popover.hidden=true;
  }
  function positionFavoriteTagsPopover(){
    const pop=$('fmFavoriteTagsPopover'),anchor=$('fmFavoriteTagsBtn');if(!pop||!anchor)return;
    const a=anchor.getBoundingClientRect();pop.hidden=false;requestAnimationFrame(()=>{const r=pop.getBoundingClientRect();let left=Math.min(innerWidth-r.width-10,Math.max(10,a.left));let top=Math.min(innerHeight-r.height-10,a.bottom+7);if(top<a.bottom&&a.top-r.height>8)top=a.top-r.height-7;pop.style.left=left+'px';pop.style.top=Math.max(10,top)+'px'});
  }
  function closeFavoriteTagsPopover(){const pop=$('fmFavoriteTagsPopover');if(pop)pop.hidden=true;const form=$('fmFavoriteTagCreateForm');if(form)form.hidden=true}
  function setFavoriteTagCreateOpen(open){const form=$('fmFavoriteTagCreateForm');if(!form)return;form.hidden=!open;if(open)setTimeout(()=>$('fmFavoriteTagName')?.focus(),0)}
  function createFavoriteTag(){
    if(!requireEdit())return;const name=$('fmFavoriteTagName').value.trim(),color=$('fmFavoriteTagColor').value;if(!name){$('fmFavoriteTagName').focus();return}
    const created=store.createTag(name,color,{owner:currentOwner()});if(!created){toast(store.getLastError&&store.getLastError()||'创建标签失败。','error');return}
    $('fmFavoriteTagName').value='';setFavoriteTagCreateOpen(false);state.tagFilter=created.name;refreshData({toast:'标签已创建。'});positionFavoriteTagsPopover();
  }
  function applySidebarCollapsed(collapsed,{persist=true}={}){
    state.sidebarCollapsed=!!collapsed;const app=$('fileManagerApp'),button=$('fmSidebarCollapseBtn');if(app)app.classList.toggle('is-sidebar-collapsed',state.sidebarCollapsed);
    if(button){button.setAttribute('aria-label',state.sidebarCollapsed?'展开侧栏':'收起侧栏');button.title=state.sidebarCollapsed?'展开侧栏':'收起侧栏'}
    if(persist)writeSetting(SIDEBAR_COLLAPSED_KEY,state.sidebarCollapsed?'1':'0');
  }
  function applyFolderSectionCollapsed(collapsed,{persist=true}={}){
    state.folderSectionCollapsed=!!collapsed;
    const section=$('fmChildFolderSection'),grid=$('fmChildFolderGrid'),button=$('fmChildFolderToggle');
    if(section)section.classList.toggle('is-collapsed',state.folderSectionCollapsed);
    if(grid)grid.hidden=state.folderSectionCollapsed;
    if(button){
      button.setAttribute('aria-expanded',String(!state.folderSectionCollapsed));
      button.setAttribute('aria-label',state.folderSectionCollapsed?'展开文件夹区域':'收起文件夹区域');
      button.title=state.folderSectionCollapsed?'展开文件夹区域':'收起文件夹区域';
    }
    if(persist)writeSetting(FOLDER_SECTION_COLLAPSED_KEY,state.folderSectionCollapsed?'1':'0');
  }

  function folderAncestors(id,list=state.folders){
    const path=[];let current=String(id||''),guard=0;
    while(current&&guard++<40){const folder=list.find(item=>item.id===current);if(!folder)break;path.unshift(folder);current=folder.parentId||''}
    return path;
  }
  function ensureCurrentFolderVisible(){
    folderAncestors(state.currentFolderId,state.view==='trash'?state.trashFolders:state.folders).forEach(folder=>state.expandedFolders.add(folder.id));
  }
  function folderTreeRow(folder,depth,{trash=false}={}){
    const children=folderChildren(folder.id,{trash}),expanded=state.expandedFolders.has(folder.id),browsing=state.view==='files'||state.view==='trash',selected=browsing&&!state.showAllFiles&&state.currentFolderId===folder.id;
    const row=document.createElement('div');row.className='fm-folder-tree-row'+(selected?' is-active':'');row.dataset.folderTreeId=folder.id;row.dataset.depth=String(depth);row.draggable=!trash;
    row.style.setProperty('--tree-depth',String(depth));row.setAttribute('role','treeitem');row.setAttribute('aria-level',String(depth+2));row.setAttribute('aria-selected',String(selected));
    if(children.length)row.setAttribute('aria-expanded',String(expanded));
    row.innerHTML=`<button class="fm-folder-tree-toggle${children.length?'':' is-placeholder'}" type="button" data-folder-toggle="${escapeHTML(folder.id)}" aria-label="${expanded?'折叠':'展开'} ${escapeHTML(folder.name)}">${children.length?'›':''}</button><button class="fm-folder-tree-open" type="button" data-folder-open="${escapeHTML(folder.id)}" title="${escapeHTML(folder.name)}">${ICONS.folder}<span>${escapeHTML(folder.name)}</span></button><button class="fm-folder-tree-menu" type="button" data-folder-tree-menu="${escapeHTML(folder.id)}" aria-label="${escapeHTML(folder.name)}的更多操作" title="更多操作">···</button>`;
    return row;
  }
  function appendFolderBranch(host,parentId,depth,{trash=false}={}){
    folderChildren(parentId,{trash}).sort((a,b)=>new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'}).compare(a.name,b.name)).forEach(folder=>{
      host.appendChild(folderTreeRow(folder,depth,{trash}));
      if(state.expandedFolders.has(folder.id))appendFolderBranch(host,folder.id,depth+1,{trash});
    });
  }
  function renderFolderTree(){
    const nav=$('fmFolderNav'),host=$('fmFolderTree'),add=$('fmFolderNavAdd');if(!nav||!host)return;
    const trash=state.view==='trash',browsing=state.view==='files'||trash;nav.hidden=false;
    if(add)add.hidden=trash;
    ensureCurrentFolderVisible();host.replaceChildren();
    const folderPool=trash?state.trashFolders:state.folders;
    const all=document.createElement('button');all.type='button';all.className='fm-folder-tree-static'+(browsing&&state.showAllFiles?' is-active':'');all.dataset.folderOpen='__all__';all.setAttribute('role','treeitem');all.innerHTML=`${ICONS.folder}<span>${trash?'回收站全部文件':'全部文件'}</span>`;host.appendChild(all);
    const uncategorized=document.createElement('button');uncategorized.type='button';uncategorized.className='fm-folder-tree-static'+(browsing&&!state.showAllFiles&&!state.currentFolderId?' is-active':'');uncategorized.dataset.folderOpen='';uncategorized.setAttribute('role','treeitem');uncategorized.innerHTML=`<span class="fm-folder-tree-unknown">?</span><span>未分类文件</span>`;host.appendChild(uncategorized);
    const divider=document.createElement('div');divider.className='fm-folder-tree-divider';host.appendChild(divider);
    appendFolderBranch(host,null,0,{trash});
    if(!folderPool.length){const empty=document.createElement('p');empty.className='fm-folder-tree-empty';empty.textContent=trash?'回收站中暂无文件夹':'暂无文件夹';host.appendChild(empty)}
  }

  function render(){
    const pendingRename=captureInlineRename();
    if(state.renameSession)finishInlineRename(state.renameSession,{cancel:true});
    updateHeader();renderCounts();renderTagFilters();renderFolderTree();renderFiles();renderInspector();renderIntegrity();
    $('fmGridBtn').classList.toggle('is-active',state.layout==='grid');$('fmListBtn').classList.toggle('is-active',state.layout==='list');
    $('fmSortSelect').value=state.sort;
    updateSelectionModeUI();
    restoreInlineRename(pendingRename);
  }

  function updateSelectionModeUI(){
    document.body.classList.toggle('is-selection-mode',state.selectionMode);
    const count=state.selectedItems.size,bar=$('fmBatchBar'),countEl=$('fmBatchCount'),toggle=$('fmSelectionModeBtn');
    if(toggle){toggle.classList.toggle('is-active',state.selectionMode);toggle.textContent=state.selectionMode?'完成':'选择'}
    if(bar)bar.hidden=!state.selectionMode;
    if(countEl)countEl.textContent=`已选择 ${count} 项`;
    const move=$('fmBatchMoveBtn'),trash=$('fmBatchTrashBtn'),exportBtn=$('fmBatchExportBtn'),tag=$('fmBatchTagBtn');
    if(move)move.disabled=!count||state.view==='trash';
    if(trash)trash.disabled=!count||state.view==='trash';
    if(exportBtn)exportBtn.disabled=!count||!selectedPayload().some(item=>item.kind==='file');
    if(tag)tag.disabled=!count||!selectedPayload().some(item=>item.kind==='file')||state.view==='trash';
  }
  function syncSelectionUI(){
    document.querySelectorAll('#fmFileGrid .fm-file-card').forEach(card=>{const id=card.dataset.fileId;card.classList.toggle('is-selected',state.selectedItems.has(itemKey('file',id))||(state.selectedType==='file'&&id===state.selectedId))});
    renderInspector();updateSelectionModeUI();
  }
  function selectItem(kind,id,{toggle=false,add=false}={}){
    id=String(id||'');const key=itemKey(kind,id);
    if(toggle){state.selectedItems.has(key)?state.selectedItems.delete(key):state.selectedItems.add(key)}else if(add)state.selectedItems.add(key);else{state.selectedItems.clear();state.selectedItems.add(key)}
    state.selectedType=kind;state.selectedId=id;syncSelectionUI();
  }
  function selectFile(id,options){selectItem('file',id,options)}
  function selectFolder(id,options){selectItem('folder',id,options)}
  function openFolder(id){const value=String(id??'');if(state.view!=='trash'){state.view='files';state.tagFilter=''}state.showAllFiles=value==='__all__';state.currentFolderId=state.showAllFiles?null:(value||null);if(state.currentFolderId)folderAncestors(state.currentFolderId).forEach(folder=>state.expandedFolders.add(folder.id));state.selectedId='';state.selectedType='file';state.selectedItems.clear();state.selectionMode=false;state.query='';$('fmSearchInput').value='';closeFavoriteTagsPopover();render()}
  function openFile(id){
    if(state.navigating)return;
    const file=store.openFile(id,{owner:currentOwner()});
    if(!file){toast(store.getLastError&&store.getLastError()||'图谱文件打开失败。','error');return}
    state.navigating=true;location.href='index.html';
  }
  function openCreateModal(){
    if(!requireEdit('登录后才能新建图谱文件。'))return;
    const name=uniqueName('新图谱文件');
    openModal({title:'新建图谱',description:'创建一个空白知识图谱文件，并进入编辑器。',name,submitLabel:'创建并打开',onSubmit:value=>{
      const safe=uniqueName(value||name),file=store.createFile({name:safe,graphData:blankGraph(safe),source:'created',folderId:state.currentFolderId},{owner:currentOwner(),makeCurrent:true});
      if(!file)throw new Error(store.getLastError&&store.getLastError()||'新建图谱失败。');
      location.href='index.html';
    }});
  }
  function beginInlineRename(file,card,{value=file&&file.name||'',selectAll=true,kind='file'}={}){
    if(!file||!card)return false;
    const nameElement=card.querySelector('.fm-file-name');if(!nameElement)return false;
    const input=document.createElement('input');input.type='text';input.className='fm-file-name-input';input.value=value;input.maxLength=100;input.setAttribute('aria-label',`重命名 ${file.name}`);input.autocomplete='off';input.spellcheck=false;
    state.renameSession={id:file.id,file,card,input,nameElement,originalName:file.name,kind,finishing:false};
    card.classList.add('is-renaming');card.setAttribute('aria-label',`${file.name}，正在重命名`);nameElement.replaceWith(input);
    requestAnimationFrame(()=>{if(!input.isConnected)return;input.focus();if(selectAll)input.select()});
    return true;
  }
  function renameFile(id){
    if(!requireEdit())return false;
    const file=[...state.activeFiles,...state.trashFiles].find(item=>item.id===id);if(!file)return false;
    const card=[...document.querySelectorAll('#fmFileGrid .fm-file-card')].find(item=>item.dataset.fileId===String(id));
    if(!card){toast('当前文件卡片不可见，请清除搜索或筛选后再重命名。','error');return false}
    if(state.renameSession&&state.renameSession.id===id){state.renameSession.input.focus();state.renameSession.input.select();return true}
    if(state.renameSession)commitInlineRename();
    return beginInlineRename(file,card);
  }
  function finishInlineRename(session,{cancel=false}={}){
    if(!session||session.finishing)return false;session.finishing=true;
    const {card,input,originalName}=session;state.renameSession=null;
    const name=document.createElement('strong');name.className='fm-file-name';name.title=originalName;name.textContent=originalName;
    if(input&&input.isConnected)input.replaceWith(name);card&&card.classList.remove('is-renaming');
    if(card)card.setAttribute('aria-label',`${originalName}，双击打开`);
    if(cancel)return true;
    const raw=String(input&&input.value||'').trim();
    if(!raw){toast('文件名不能为空，已保留原名称。','error');return false}
    const isFolder=session.kind==='folder',nextName=isFolder?uniqueFolderName(raw,session.id,session.file.parentId):uniqueName(raw,session.id);
    if(nextName===originalName)return true;
    const renamed=isFolder?store.renameFolder(session.id,nextName,{owner:currentOwner(),includeTrash:session.file.status==='trashed',emit:false}):store.renameFile(session.id,nextName,{owner:currentOwner(),includeTrash:session.file.status==='trashed',emit:false});
    if(!renamed){toast(store.getLastError&&store.getLastError()||'重命名失败。','error');return false}
    const local=(isFolder?[...state.folders,...state.trashFolders]:[...state.activeFiles,...state.trashFiles]).find(item=>item.id===session.id);if(local)Object.assign(local,renamed,{graphData:undefined,learningState:undefined});
    name.textContent=nextName;name.title=nextName;if(card)card.setAttribute('aria-label',`${nextName}，双击打开`);
    if(state.selectedId===session.id){$('fmInfoName').textContent=nextName;$('fmInfoUpdated').textContent=formatDate(renamed.updatedAt)}
    toast(nextName!==raw?`文件已重命名为“${nextName}”。`:'文件已重命名。');return true;
  }
  function commitInlineRename(options={}){return finishInlineRename(state.renameSession,options)}

  function openCreateFolder(){
    if(!requireEdit('登录后才能新建文件夹。'))return;
    openModal({title:'新建文件夹',description:'在当前位置创建文件夹。',name:uniqueFolderName('新建文件夹'),nameLabel:'文件夹名称',submitLabel:'创建',onSubmit:value=>{const folder=store.createFolder({name:uniqueFolderName(value||'新建文件夹'),parentId:state.currentFolderId},{owner:currentOwner()});if(!folder)throw new Error(store.getLastError&&store.getLastError()||'新建文件夹失败。');state.selectedType='folder';state.selectedId=folder.id;refreshData({toast:'文件夹已创建。'})}});
  }
  function uniqueFolderName(base,excludeId='',parentId=state.currentFolderId){
    const names=new Set([...state.folders,...state.trashFolders].filter(folder=>folder.id!==excludeId&&(folder.parentId||null)===(parentId||null)).map(folder=>folder.name.toLowerCase()));return uniqueNameFromSet(base,names);
  }
  function renameFolder(id){
    if(!requireEdit())return false;const folder=[...state.folders,...state.trashFolders].find(item=>item.id===id);if(!folder)return false;
    openModal({title:'重命名文件夹',description:'修改文件夹名称。',name:folder.name,nameLabel:'文件夹名称',submitLabel:'保存',onSubmit:value=>{
      const nextName=uniqueFolderName(value||folder.name,folder.id,folder.parentId);
      const renamed=store.renameFolder(folder.id,nextName,{owner:currentOwner(),includeTrash:folder.status==='trashed'});
      if(!renamed)throw new Error(store.getLastError&&store.getLastError()||'重命名失败。');
      refreshData({toast:nextName!==value?`文件夹已重命名为“${nextName}”。`:'文件夹已重命名。'});
    }});return true;
  }
  function folderOptions(excludeId=''){
    const descendants=new Set();if(excludeId){const queue=[excludeId];while(queue.length){const parent=queue.shift();state.folders.forEach(folder=>{if(folder.parentId===parent&&!descendants.has(folder.id)){descendants.add(folder.id);queue.push(folder.id)}})}}
    const items=[{id:'',name:'全部文件'}],walk=(parentId,depth)=>state.folders.filter(folder=>(folder.parentId||null)===(parentId||null)&&folder.id!==excludeId&&!descendants.has(folder.id)).forEach(folder=>{items.push({id:folder.id,name:'　'.repeat(depth)+folder.name});walk(folder.id,depth+1)});walk(null,0);return items;
  }
  function moveItems(items,targetId,{announce=true}={}){
    if(!requireEdit()||!Array.isArray(items)||!items.length)return false;targetId=targetId||null;
    const snapshots=items.map(item=>{const source=item.kind==='folder'?state.folders.find(x=>x.id===item.id):state.activeFiles.find(x=>x.id===item.id);return source?{...item,from:item.kind==='folder'?(source.parentId||null):(source.folderId||null),name:source.name}:null}).filter(Boolean);
    const moved=[];
    for(const item of snapshots){const result=item.kind==='folder'?store.moveFolder(item.id,targetId,{owner:currentOwner()}):store.moveFile(item.id,targetId,{owner:currentOwner()});if(!result){for(const done of moved.reverse())done.kind==='folder'?store.moveFolder(done.id,done.from,{owner:currentOwner()}):store.moveFile(done.id,done.from,{owner:currentOwner()});toast(store.getLastError&&store.getLastError()||'移动失败。','error');return false}moved.push(item)}
    rememberFolder(targetId);state.selectedItems.clear();state.undoMove={items:moved,targetId};refreshData();
    if(announce){const target=targetId?state.folders.find(folder=>folder.id===targetId):null;toast(`已移动 ${moved.length} 个项目到${target?'“'+target.name+'”':'根目录'}。`,'success',5200,{label:'撤销',handler:()=>undoLastMove()})}
    return true;
  }
  function undoLastMove(){const undo=state.undoMove;if(!undo)return false;state.undoMove=null;let ok=true;for(const item of undo.items){const result=item.kind==='folder'?store.moveFolder(item.id,item.from,{owner:currentOwner()}):store.moveFile(item.id,item.from,{owner:currentOwner()});if(!result)ok=false}refreshData({toast:ok?'已撤销移动。':'部分项目撤销失败。'});return ok}
  function openMoveDialog(kind,id){
    if(!requireEdit())return;const item=kind==='folder'?state.folders.find(folder=>folder.id===id):state.activeFiles.find(file=>file.id===id);if(!item)return;
    const items=state.selectedItems.has(itemKey(kind,id))?selectedPayload():[{kind,id}];
    openModal({title:'选择其他位置',description:`为 ${items.length} 个项目选择目标文件夹。`,hideName:true,showMove:true,moveValue:item.parentId||item.folderId||'',moveOptions:folderOptions(items.length===1&&kind==='folder'?id:''),submitLabel:'移动',onSubmit:()=>{const target=$('fmMoveTarget').value||null;if(!moveItems(items,target))throw new Error(store.getLastError&&store.getLastError()||'移动失败。')}})
  }
  function trashFolder(id){if(!requireEdit())return;const folder=state.folders.find(item=>item.id===id);if(!folder)return;openModal({title:'移入回收站',description:'文件夹及其中内容可在回收站恢复。',warning:`确定将“${folder.name}”及其中内容移入回收站吗？`,hideName:true,submitLabel:'移入回收站',danger:true,onSubmit:()=>{if(!store.trashFolder(id,{owner:currentOwner()}))throw new Error(store.getLastError&&store.getLastError()||'删除文件夹失败。');state.selectedId='';state.currentFolderId=null;refreshData({toast:'文件夹已移入回收站。'})}})}
  function restoreFolder(id){if(!requireEdit())return;const previous=state.trashFolders.find(folder=>folder.id===id),expectedParent=previous&&(previous.restoreParentId||previous.parentId)||null;const result=store.restoreFolder(id,{owner:currentOwner()});if(!result){toast(store.getLastError&&store.getLastError()||'恢复文件夹失败。','error');return}const fellBackToRoot=!!expectedParent&&!result.parentId;state.view='files';state.currentFolderId=result.id;state.showAllFiles=false;state.selectedType='folder';state.selectedId=result.id;state.expandedFolders.add(result.id);folderAncestors(result.id).forEach(folder=>state.expandedFolders.add(folder.id));refreshData({toast:fellBackToRoot?'原位置不可用，文件夹已恢复到根目录。':'文件夹及其中内容已恢复。'})}
  function permanentlyDeleteFolder(id){if(!requireEdit())return;const folder=state.trashFolders.find(item=>item.id===id);if(!folder)return;openModal({title:'永久删除文件夹',description:'仅空文件夹可以单独永久删除。',warning:`确定永久删除“${folder.name}”吗？`,hideName:true,submitLabel:'永久删除',danger:true,onSubmit:()=>{if(!store.deleteFolderPermanently(id,{owner:currentOwner()}))throw new Error(store.getLastError&&store.getLastError()||'永久删除文件夹失败。');refreshData({toast:'文件夹已永久删除。'})}})}
  function duplicateFile(id){
    if(!requireEdit())return;const source=state.activeFiles.find(file=>file.id===id);if(!source)return;
    const copy=store.duplicateFile(id,{owner:currentOwner(),name:uniqueName(source.name+' 副本'),makeCurrent:false});
    if(!copy){toast(store.getLastError&&store.getLastError()||'创建副本失败。','error');return}
    state.view='files';state.selectedId=copy.id;refreshData({toast:'已创建图谱副本。'});
  }
  function trashFile(id){
    if(!requireEdit())return;const file=state.activeFiles.find(item=>item.id===id);if(!file)return;
    openModal({title:'移入回收站',description:'文件可在回收站中恢复。',warning:`确定将“${file.name}”移入回收站吗？`,hideName:true,submitLabel:'移入回收站',danger:true,onSubmit:()=>{
      if(!store.deleteFile(id,{owner:currentOwner()}))throw new Error(store.getLastError&&store.getLastError()||'删除失败。');
      state.selectedId='';
      refreshData({toast:'文件已移入回收站。'});
    }});
  }
  function restoreFile(id){
    if(!requireEdit())return;
    const previous=state.trashFiles.find(file=>file.id===id),expectedFolder=previous&&(previous.restoreFolderId||previous.folderId)||null;
    const restored=store.restoreFile(id,{owner:currentOwner(),makeCurrent:false});
    if(!restored){toast(store.getLastError&&store.getLastError()||'恢复失败。','error');return}
    const fellBackToRoot=!!expectedFolder&&!restored.folderId;
    state.view='files';state.currentFolderId=restored.folderId||null;state.showAllFiles=false;state.selectedType='file';state.selectedId=restored.id;state.selectedItems=new Set([itemKey('file',restored.id)]);
    if(restored.folderId)folderAncestors(restored.folderId).forEach(folder=>state.expandedFolders.add(folder.id));
    refreshData({toast:fellBackToRoot?'原文件夹不可用，文件已恢复到根目录。':restored.folderId?'文件已恢复到原文件夹。':'文件已恢复到根目录。'});
  }
  function permanentlyDelete(id){
    if(!requireEdit())return;const file=state.trashFiles.find(item=>item.id===id);if(!file)return;
    openModal({title:'永久删除文件',description:'此操作无法撤销。',warning:`“${file.name}”及其图谱内容将被永久删除。`,hideName:true,submitLabel:'永久删除',danger:true,onSubmit:()=>{
      if(!store.deleteFile(id,{owner:currentOwner(),permanent:true}))throw new Error(store.getLastError&&store.getLastError()||'永久删除失败。');
      refreshData({toast:'文件已永久删除。'});
    }});
  }
  function emptyTrash(){
    if(!requireEdit())return;
    openModal({title:'清空回收站',description:'此操作无法撤销。',warning:`将永久删除回收站中的 ${state.trashFolders.length} 个文件夹和 ${state.trashFiles.length} 个文件。`,hideName:true,submitLabel:'全部永久删除',danger:true,onSubmit:()=>{
      const count=store.emptyTrash({owner:currentOwner()});
      if(!count&&(state.trashFiles.length||state.trashFolders.length))throw new Error(store.getLastError&&store.getLastError()||'清空回收站失败。');
      state.selectedId='';
      refreshData({toast:`已永久删除 ${count} 个文件。`});
    }});
  }
  function exportFile(id){
    const file=store.getFile(id,currentOwner());
    if(!file||!file.graphData){toast(store.getLastError&&store.getLastError()||'读取文件内容失败。','error');return}
    try{packages.downloadPackage(file.graphData,{filename:packages.safeFileBase(file.name)+'-学习包.zip'});toast('学习包已开始下载。')}catch(err){toast('导出失败：'+err.message,'error')}
  }
  async function importFiles(fileList){
    if(state.busy)return;
    if(!requireEdit('登录后才能导入图谱文件。'))return;
    const files=[...fileList||[]];if(!files.length)return;
    setBusy(true);let success=0;const errors=[];
    try{
      const reservedNames=new Set([...state.activeFiles,...state.trashFiles].map(file=>String(file.name).toLowerCase()));
      const reserveUnique=base=>{
        const candidate=uniqueNameFromSet(base,reservedNames);
        reservedNames.add(candidate.toLowerCase());return candidate;
      };
      for(const inputFile of files){
        try{
          const raw=await packages.parseFile(inputFile),graph=normalizeImportedGraph(raw),base=graph.meta&&graph.meta.title||String(inputFile.name||'导入的图谱').replace(/\.(zip|json)$/i,''),name=reserveUnique(base);
          graph.meta.title=name;
          const created=store.createFile({name,graphData:graph,source:'package-import',sourceFileId:raw&&raw.id||'',folderId:state.currentFolderId},{owner:currentOwner(),makeCurrent:false,emit:false});
          if(!created)throw new Error(store.getLastError&&store.getLastError()||'文件库写入失败。');
          success++;
        }catch(err){errors.push(`${inputFile.name||'未命名文件'}：${err.message||err}`)}
      }
    }finally{setBusy(false);$('fmFileInput').value=''}
    state.view='files';state.filter='all';state.query='';$('fmSearchInput').value='';refreshData();
    if(success)toast(`成功导入 ${success} 个图谱文件。`);
    if(errors.length)toast(errors.slice(0,3).join('\n')+(errors.length>3?`\n另有 ${errors.length-3} 个错误。`:''),'error',6500);
  }


  function setSelectionMode(enabled){
    state.selectionMode=!!enabled;
    if(!state.selectionMode){state.selectedItems.clear();state.selectedId='';state.selectedType='file'}
    syncSelectionUI();
  }
  function openBatchMoveDialog(){
    const items=selectedPayload();if(!items.length)return;
    const first=items[0],source=first.kind==='folder'?state.folders.find(x=>x.id===first.id):state.activeFiles.find(x=>x.id===first.id);
    openModal({title:'选择其他位置',description:`为 ${items.length} 个项目选择目标文件夹。`,hideName:true,showMove:true,moveValue:source&&(source.parentId||source.folderId)||'',moveOptions:folderOptions(items.length===1&&first.kind==='folder'?first.id:''),submitLabel:'移动',onSubmit:()=>{const target=$('fmMoveTarget').value||null;if(!moveItems(items,target))throw new Error(store.getLastError&&store.getLastError()||'移动失败。');setSelectionMode(false)}})
  }
  function batchTrash(){
    const items=selectedPayload();if(!items.length||!requireEdit())return;
    openModal({title:'批量移入回收站',description:`将选中的 ${items.length} 个项目移入回收站。`,warning:'文件夹会连同其中内容一起移入回收站。',hideName:true,submitLabel:'移入回收站',danger:true,onSubmit:()=>{
      const done=[];for(const item of items){const ok=item.kind==='folder'?store.trashFolder(item.id,{owner:currentOwner()}):store.deleteFile(item.id,{owner:currentOwner()});if(!ok){for(const previous of done.reverse()){if(previous.kind==='folder')store.restoreFolder(previous.id,{owner:currentOwner()});else store.restoreFile(previous.id,{owner:currentOwner(),makeCurrent:false})}throw new Error(store.getLastError&&store.getLastError()||'批量删除失败。')}done.push(item)}
      setSelectionMode(false);refreshData({toast:`已将 ${done.length} 个项目移入回收站。`});
    }});
  }
  function batchExport(){
    const files=selectedPayload().filter(item=>item.kind==='file');if(!files.length)return;
    let count=0;for(const item of files){const file=store.getFile(item.id,currentOwner());if(file&&file.graphData){try{packages.downloadPackage(file.graphData,{filename:packages.safeFileBase(file.name)+'-学习包.zip'});count++}catch(err){}}}
    toast(count?`已开始导出 ${count} 个图谱文件。`:'没有可导出的图谱文件。',count?'success':'error');
  }


  function folderMenuItems(folder){
    if(folder.status==='trashed')return[['folder-restore','恢复',ICONS.restore,''],['separator'],['folder-permanent','永久删除',ICONS.delete,'is-danger']];
    return[['folder-open','打开',ICONS.open,''],['folder-rename','重命名',ICONS.rename,''],['details','查看详情',ICONS.info,''],['folder-move','移动到',ICONS.move,''],['separator'],['folder-trash','移入回收站',ICONS.trash,'is-danger']];
  }
  function menuItems(file){
    if(!file)return[];
    if(file.status==='trashed')return[
      ['restore','恢复',ICONS.restore,''],['separator'],['permanent','永久删除',ICONS.delete,'is-danger']
    ];
    return[
      ['open','打开',ICONS.open,''],['tags',file.tags&&file.tags.length?'更换标签':'添加标签',ICONS.tag,''],['rename','重命名',ICONS.rename,''],['details','查看详情',ICONS.info,''],['move','移动到',ICONS.move,''],['duplicate','创建副本',ICONS.duplicate,''],['export','导出学习包',ICONS.export,''],['separator'],['trash','移入回收站',ICONS.trash,'is-danger']
    ];
  }
  function buildMoveSubmenu(item,type,anchor){
    const submenu=$('fmMoveSubmenu');submenu.replaceChildren();submenu.dataset.fileId=type==='file'?item.id:'';submenu.dataset.folderId=type==='folder'?item.id:'';submenu.dataset.itemType=type;
    const heading=document.createElement('div');heading.className='fm-submenu-heading';heading.textContent='移动到';submenu.appendChild(heading);
    const recent=[{id:'',name:'根目录'},...state.recentFolders.filter(Boolean).map(id=>state.folders.find(folder=>folder.id===id)).filter(Boolean)].filter((folder,index,array)=>array.findIndex(entry=>entry.id===folder.id)===index).slice(0,4);
    recent.forEach(folder=>{const button=document.createElement('button');button.type='button';button.dataset.menuAction=`quick-move:${folder.id}`;button.innerHTML=ICONS.folder+`<span>${escapeHTML(folder.name)}</span>`;submenu.appendChild(button)});
    submenu.appendChild(document.createElement('hr'));
    const other=document.createElement('button');other.type='button';other.dataset.menuAction=type==='folder'?'folder-move':'move';other.innerHTML=ICONS.move+'<span>选择其他位置…</span>';submenu.appendChild(other);
    submenu.hidden=false;const a=anchor.getBoundingClientRect(),rect=submenu.getBoundingClientRect();let left=a.right+6;if(left+rect.width>innerWidth-8)left=a.left-rect.width-6;submenu.style.left=`${Math.max(8,left)}px`;submenu.style.top=`${Math.max(8,Math.min(innerHeight-rect.height-8,a.top-6))}px`;
  }
  function scheduleCloseMoveSubmenu(){clearTimeout(state.submenuTimer);state.submenuTimer=setTimeout(()=>{$('fmMoveSubmenu').hidden=true},180)}
  function openContextMenu(item,x,y,type='file',{preferRight=true,preferBelow=true}={}){
    const menu=$('fmContextMenu');$('fmMoveSubmenu').hidden=true;menu.replaceChildren();menu.dataset.fileId=type==='file'?item.id:'';menu.dataset.folderId=type==='folder'?item.id:'';menu.dataset.itemType=type;
    const entries=type==='folder'?folderMenuItems(item):menuItems(item);
    entries.forEach(entry=>{
      if(entry[0]==='separator'){menu.appendChild(document.createElement('hr'));return}
      const button=document.createElement('button');button.type='button';button.dataset.menuAction=entry[0];button.className=entry[3];button.innerHTML=entry[2]+`<span>${entry[1]}</span>`;
      if((entry[0]==='move'||entry[0]==='folder-move')&&item.status!=='trashed'){button.dataset.submenuTrigger='move';button.classList.add('fm-menu-parent');button.insertAdjacentHTML('beforeend','<b aria-hidden="true">›</b>');button.addEventListener('mouseenter',()=>{clearTimeout(state.submenuTimer);buildMoveSubmenu(item,type,button)});}
      menu.appendChild(button);
    });
    menu.hidden=false;
    const rect=menu.getBoundingClientRect(),gap=7;
    let left=preferRight?x+gap:x-rect.width-gap;
    let top=preferBelow?y+gap:y-rect.height-gap;
    if(left+rect.width>innerWidth-8)left=x-rect.width-gap;
    if(left<8)left=Math.min(innerWidth-rect.width-8,Math.max(8,x+gap));
    if(top+rect.height>innerHeight-8)top=y-rect.height-gap;
    if(top<8)top=Math.min(innerHeight-rect.height-8,Math.max(8,y+gap));
    menu.style.left=`${Math.max(8,left)}px`;
    menu.style.top=`${Math.max(8,top)}px`;
  }

  function menuButtons(menu){return [...menu.querySelectorAll('button:not([disabled])')]}
  function focusMenuRelative(menu,current,delta){const buttons=menuButtons(menu);if(!buttons.length)return;const index=Math.max(0,buttons.indexOf(current));buttons[(index+delta+buttons.length)%buttons.length].focus()}
  function handleContextMenuKeydown(event){
    const button=event.target.closest('button');if(!button)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();focusMenuRelative(event.currentTarget,button,event.key==='ArrowDown'?1:-1);return}
    if(event.key==='Home'||event.key==='End'){event.preventDefault();const buttons=menuButtons(event.currentTarget);if(buttons.length)buttons[event.key==='Home'?0:buttons.length-1].focus();return}
    if(event.currentTarget===$('fmContextMenu')&&event.key==='ArrowRight'&&button.dataset.submenuTrigger){event.preventDefault();button.click();requestAnimationFrame(()=>{const first=menuButtons($('fmMoveSubmenu'))[0];if(first)first.focus()});return}
    if(event.currentTarget===$('fmMoveSubmenu')&&event.key==='ArrowLeft'){event.preventDefault();$('fmMoveSubmenu').hidden=true;const parent=$('fmContextMenu').querySelector('[data-submenu-trigger="move"]');if(parent)parent.focus();return}
    if(event.key==='Escape'){event.preventDefault();closeContextMenu()}
  }

  function closeContextMenu(){clearTimeout(state.submenuTimer);$('fmContextMenu').hidden=true;$('fmMoveSubmenu').hidden=true;$('fmContextMenu').dataset.fileId='';$('fmContextMenu').dataset.folderId='';$('fmContextMenu').dataset.itemType=''}
  function runAction(action,id){
    if(state.busy)return;
    const actionKind=$('fmContextMenu').dataset.itemType||state.selectedType;
    closeContextMenu();
    if(action==='details'){setDetailsOpen(true);renderInspector();}
    else if(action==='tags'){const organizer=global.KGFileManagerOrganize;if(organizer)organizer.openTagPicker(state.selectedItems.has(itemKey(actionKind,id))?selectedPayload():[{kind:actionKind,id}],$('fmDetailsBtn'));}
    else if(action.startsWith('quick-move:')){const target=action.slice(11)||null;const kind=actionKind;moveItems(state.selectedItems.has(itemKey(kind,id))?selectedPayload():[{kind,id}],target);}
    else if(action==='open')openFile(id);
    else if(action==='rename')renameFile(id);
    else if(action==='move')openMoveDialog('file',id);
    else if(action==='folder-open')openFolder(id);
    else if(action==='folder-rename')renameFolder(id);
    else if(action==='folder-move')openMoveDialog('folder',id);
    else if(action==='folder-trash')trashFolder(id);
    else if(action==='folder-restore')restoreFolder(id);
    else if(action==='folder-permanent')permanentlyDeleteFolder(id);
    else if(action==='duplicate')duplicateFile(id);
    else if(action==='export')exportFile(id);
    else if(action==='trash')trashFile(id);
    else if(action==='restore')restoreFile(id);
    else if(action==='permanent')permanentlyDelete(id);
  }

  function openModal(config){
    const backdrop=$('fmModalBackdrop'),form=$('fmModal'),field=$('fmNameField'),moveField=$('fmMoveField'),warning=$('fmModalWarning'),input=$('fmModalName'),submit=$('fmModalSubmit');
    $('fmModalTitle').textContent=config.title||'确认操作';$('fmModalDescription').textContent=config.description||'';
    field.hidden=!!config.hideName;moveField.hidden=!config.showMove;input.value=config.name||'';$('fmNameFieldLabel').textContent=config.nameLabel||'文件名称';
    if(config.showMove){const select=$('fmMoveTarget');select.replaceChildren();(config.moveOptions||[]).forEach(option=>{const el=document.createElement('option');el.value=option.id;el.textContent=option.name;select.appendChild(el)});select.value=config.moveValue||''}
    warning.hidden=!config.warning;warning.textContent=config.warning||'';
    submit.textContent=config.submitLabel||'确定';submit.style.background=config.danger?'var(--fm-danger)':'';
    state.modalHandler=config.onSubmit||null;backdrop.hidden=false;document.body.style.overflow='hidden';
    requestAnimationFrame(()=>{if(!field.hidden){input.focus();input.select()}else if(!moveField.hidden)$('fmMoveTarget').focus();else submit.focus()});
  }
  function closeModal(){state.modalHandler=null;$('fmModalBackdrop').hidden=true;$('fmMoveField').hidden=true;document.body.style.overflow='';$('fmModalSubmit').style.background=''}
  async function submitModal(event){
    event.preventDefault();if(!state.modalHandler||state.busy)return;
    const input=$('fmModalName'),field=$('fmNameField'),value=cleanName(input.value);
    if(!field.hidden&&!input.value.trim()){input.focus();toast('请输入文件名称。','error');return}
    setBusy(true);
    try{await state.modalHandler(value);const track=(global.KGFeatureAnalytics&&global.KGFeatureAnalytics.track)||function(){};track('files','key_action','library_saved');track('files','outcome','library_saved');closeModal()}catch(err){toast(err.message||String(err),'error')}finally{setBusy(false)}
  }
  function applyTheme(theme){
    theme=theme==='dark'?'dark':'light';document.documentElement.dataset.theme=theme;writeSetting(THEME_KEY,theme);$('fmThemeBtn').title=theme==='dark'?'切换到浅色主题':'切换到深色主题';
  }
  function initTheme(){
    const saved=readSetting(THEME_KEY,''),preferred=global.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';applyTheme(saved||preferred);
  }
  function setLayout(layout){state.layout=layout==='list'?'list':'grid';writeSetting(LAYOUT_KEY,state.layout);renderFiles();$('fmGridBtn').classList.toggle('is-active',state.layout==='grid');$('fmListBtn').classList.toggle('is-active',state.layout==='list')}
  const ROLE_LABELS={admin:'管理员',teacher:'教师',student:'学员',viewer:'访客'};
  function setAccountMenu(open,{focusFirst=false}={}){
    const menu=$('fmAccountMenu'),avatar=$('fmAvatar');if(!menu||!avatar)return;
    open=!!open;menu.hidden=!open;avatar.setAttribute('aria-expanded',String(open));$('fmAccountShell').classList.toggle('is-open',open);
    if(open&&focusFirst)requestAnimationFrame(()=>{const first=menu.querySelector('a,button');if(first)first.focus()});
  }
  function updateIdentity(){
    try{if(roles.applyTheme)roles.applyTheme()}catch(err){}
    const user=currentUser(),label=user&&(user.displayName||user.username)||'访客',role=user?ROLE_LABELS[user.role]||user.role||'用户':'未登录';
    const initial=label.trim().charAt(0)||'访';$('fmOwnerLabel').textContent=user?`${label}的文件空间`:'访客空间';$('fmAvatar').textContent=initial;$('fmAccountAvatar').textContent=initial;$('fmAvatar').title=`${label} · ${role}`;$('fmAvatar').setAttribute('aria-label',`账号菜单：${label}`);
    $('fmAccountName').textContent=label;$('fmAccountMeta').textContent=user?`${role}${user.username&&user.username!==label?' · '+user.username:''}`:'返回编辑器可登录账号';
    $('fmUserManagementLink').hidden=!(user&&user.role==='admin');$('fmAccountSessionBtn').textContent=user?'退出登录':'返回编辑器登录';$('fmAccountSessionBtn').classList.toggle('is-danger',!!user);
  }
  function accountSessionAction(){
    const user=currentUser();setAccountMenu(false);
    if(!user){location.href='index.html';return}
    try{if(auth&&typeof auth.clearSession==='function')auth.clearSession();else localStorage.removeItem('kg_local_current_user_v1');toast('已退出当前账号。')}catch(err){toast('退出登录失败。','error')}
  }
  function clearFolderDragState(){
    state.dragPayload=null;
    document.querySelectorAll('.fm-folder-tree-row.is-dragging,.fm-folder-tree .is-drop-target,.fm-folder-tree .is-drop-forbidden,.fm-child-folder-card.is-dragging,.fm-child-folder-card.is-drop-target,.fm-child-folder-card.is-drop-forbidden').forEach(el=>{el.classList.remove('is-dragging','is-drop-target','is-drop-forbidden');delete el.dataset.dropHint});
  }
  function setFolderDropHint(target,id,{illegal=false,uncategorized=false}={}){
    if(!target)return;
    const folder=id?state.folders.find(item=>item.id===id):null;
    target.dataset.dropHint=illegal?(uncategorized?'不能放入未分类文件':'不能移动到此位置'):(folder?`移动到“${folder.name}”`:'移动到根目录');
  }
  function bind(){
    $('fmNewFileBtn').addEventListener('click',openCreateModal);$('fmFolderNavAdd')?.addEventListener('click',openCreateFolder);
    $('fmChildFolderAdd')?.addEventListener('click',openCreateFolder);
    $('fmChildFolderToggle')?.addEventListener('click',()=>applyFolderSectionCollapsed(!state.folderSectionCollapsed));
    $('fmSidebarScroll')?.addEventListener('scroll',()=>{closeContextMenu();closeFavoriteTagsPopover();global.KGFileManagerOrganize&&global.KGFileManagerOrganize.closeAll&&global.KGFileManagerOrganize.closeAll()},{passive:true});
    $('fmFolderTree')?.addEventListener('click',event=>{
      const toggle=event.target.closest('[data-folder-toggle]');if(toggle){event.preventDefault();event.stopPropagation();const id=toggle.dataset.folderToggle;state.expandedFolders.has(id)?state.expandedFolders.delete(id):state.expandedFolders.add(id);renderFolderTree();return}
      const menu=event.target.closest('[data-folder-tree-menu]');if(menu){event.preventDefault();event.stopPropagation();const folder=[...state.folders,...state.trashFolders].find(item=>item.id===menu.dataset.folderTreeMenu);if(folder){selectFolder(folder.id);const rect=menu.getBoundingClientRect();openContextMenu(folder,rect.right,rect.bottom,'folder')}return}
      const open=event.target.closest('[data-folder-open]');if(open)openFolder(open.dataset.folderOpen);
    });
    $('fmFolderTree')?.addEventListener('contextmenu',event=>{const row=event.target.closest('[data-folder-tree-id]');if(!row)return;event.preventDefault();const folder=[...state.folders,...state.trashFolders].find(item=>item.id===row.dataset.folderTreeId);if(folder){selectFolder(folder.id);openContextMenu(folder,event.clientX,event.clientY,'folder')}});
    $('fmFolderTree')?.addEventListener('dragstart',event=>{
      const row=event.target.closest('[data-folder-tree-id]');
      if(!row||state.view==='trash'||isMobileReadonly()||event.target.closest('[data-folder-toggle],[data-folder-tree-menu]')){event.preventDefault();return}
      const id=row.dataset.folderTreeId,folder=state.folders.find(item=>item.id===id);
      if(!folder){event.preventDefault();return}
      state.dragPayload=[{kind:'folder',id}];
      event.dataTransfer.effectAllowed='move';
      event.dataTransfer.setData('text/plain',JSON.stringify(state.dragPayload));
      requestAnimationFrame(()=>row.classList.add('is-dragging'));
    });
    $('fmFolderTree')?.addEventListener('dragend',clearFolderDragState);
    $('fmFolderTree')?.addEventListener('dragover',event=>{
      if(!state.dragPayload||state.view==='trash')return;
      const target=event.target.closest('[data-folder-open]'),isUncategorized=!!(target&&target.dataset.folderOpen===''),hasFolder=state.dragPayload.some(item=>item&&item.kind==='folder');
      const id=target?(target.dataset.folderOpen==='__all__'?null:(target.dataset.folderOpen||null)):null;
      const illegal=(isUncategorized&&hasFolder)||isIllegalDropTarget(state.dragPayload,id);
      event.preventDefault();event.dataTransfer.dropEffect=illegal?'none':'move';
      document.querySelectorAll('.fm-folder-tree .is-drop-target,.fm-folder-tree .is-drop-forbidden').forEach(el=>{if(el!==target){el.classList.remove('is-drop-target','is-drop-forbidden');delete el.dataset.dropHint}});
      if(target){target.classList.toggle('is-drop-target',!illegal);target.classList.toggle('is-drop-forbidden',illegal);setFolderDropHint(target,id,{illegal,uncategorized:isUncategorized})}
    });
    $('fmFolderTree')?.addEventListener('dragleave',event=>{
      const target=event.target.closest('[data-folder-open]');
      if(target&&!target.contains(event.relatedTarget)){target.classList.remove('is-drop-target','is-drop-forbidden');delete target.dataset.dropHint}
      if(!event.currentTarget.contains(event.relatedTarget))document.querySelectorAll('.fm-folder-tree .is-drop-target,.fm-folder-tree .is-drop-forbidden').forEach(el=>{el.classList.remove('is-drop-target','is-drop-forbidden');delete el.dataset.dropHint});
    });
    $('fmFolderTree')?.addEventListener('drop',event=>{
      if(!state.dragPayload||state.view==='trash')return;
      event.preventDefault();
      const payload=state.dragPayload.slice(),target=event.target.closest('[data-folder-open]'),isUncategorized=!!(target&&target.dataset.folderOpen===''),hasFolder=payload.some(item=>item&&item.kind==='folder');
      const id=target?(target.dataset.folderOpen==='__all__'?null:(target.dataset.folderOpen||null)):null;
      const illegal=(isUncategorized&&hasFolder)||isIllegalDropTarget(payload,id);
      try{
        if(illegal){toast(isUncategorized?'文件夹不能放入“未分类文件”。':'不能移动到自身或自己的子文件夹。','error');return}
        const dragged=payload.length===1&&payload[0].kind==='folder'?state.folders.find(folder=>folder.id===payload[0].id):null;
        if(dragged&&(dragged.parentId||null)===(id||null)){toast('文件夹已在该位置。');return}
        if(moveItems(payload,id)&&id)state.expandedFolders.add(id);
      }finally{
        clearFolderDragState();
      }
    });
    $('fmEmptyAction').addEventListener('click',()=>{const action=$('fmEmptyAction').dataset.emptyAction;if(action==='clear'){state.query='';$('fmSearchInput').value='';render()}else if(action==='files'){state.view='files';render()}else openCreateModal()});
    document.querySelectorAll('.fm-nav-item').forEach(button=>{button.addEventListener('click',()=>{state.view=button.dataset.view;if(state.view!=='favorites')state.tagFilter='';state.currentFolderId=null;state.showAllFiles=true;state.selectedId='';state.selectedType='file';state.selectedItems.clear();state.selectionMode=false;closeContextMenu();render()});});
    document.querySelectorAll('.fm-filter-tabs button').forEach(button=>button.addEventListener('click',()=>{state.filter=button.dataset.filter;document.querySelectorAll('.fm-filter-tabs button').forEach(item=>item.classList.toggle('is-active',item===button));renderFiles()}));
    $('fmFavoriteTagsBtn')?.addEventListener('click',event=>{event.stopPropagation();const pop=$('fmFavoriteTagsPopover');if(pop.hidden)positionFavoriteTagsPopover();else closeFavoriteTagsPopover()});
    $('fmFavoriteTagsList')?.addEventListener('click',event=>{const button=event.target.closest('[data-favorite-tag]');if(!button)return;state.tagFilter=button.dataset.favoriteTag||'';state.view='favorites';state.currentFolderId=null;state.showAllFiles=true;state.selectedId='';state.selectedItems.clear();closeFavoriteTagsPopover();render()});
    $('fmFavoriteTagsCreate')?.addEventListener('click',event=>{event.stopPropagation();setFavoriteTagCreateOpen($('fmFavoriteTagCreateForm').hidden)});
    $('fmFavoriteTagConfirm')?.addEventListener('click',createFavoriteTag);
    $('fmFavoriteTagName')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();createFavoriteTag()}else if(event.key==='Escape'){event.preventDefault();setFavoriteTagCreateOpen(false)}});
    $('fmSidebarCollapseBtn')?.addEventListener('click',()=>applySidebarCollapsed(!state.sidebarCollapsed));
    $('fmSearchInput').addEventListener('input',event=>{state.query=event.target.value;renderFiles()});
    $('fmSortSelect').addEventListener('change',event=>{state.sort=event.target.value;writeSetting(SORT_KEY,state.sort);renderFiles()});
    $('fmGridBtn').addEventListener('click',()=>setLayout('grid'));$('fmListBtn').addEventListener('click',()=>setLayout('list'));
    $('fmSelectionModeBtn').addEventListener('click',()=>setSelectionMode(!state.selectionMode));$('fmBatchCancelBtn').addEventListener('click',()=>setSelectionMode(false));$('fmBatchTagBtn').addEventListener('click',event=>global.KGFileManagerOrganize&&global.KGFileManagerOrganize.openTagPicker(selectedPayload(),event.currentTarget));$('fmBatchMoveBtn').addEventListener('click',openBatchMoveDialog);$('fmBatchTrashBtn').addEventListener('click',batchTrash);$('fmBatchExportBtn').addEventListener('click',batchExport);
    $('fmRefreshBtn').addEventListener('click',()=>refreshData({toast:'文件列表已刷新。',forceIntegrity:true}));
    $('fmThemeBtn').addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
    $('fmMobileReadonlyClose')?.addEventListener('click',()=>{$('fmMobileReadonlyNotice').hidden=true});
    if(global.matchMedia){const mobileQuery=global.matchMedia('(max-width: 800px)');const onMobileChange=()=>syncMobileReadonly();if(mobileQuery.addEventListener)mobileQuery.addEventListener('change',onMobileChange);else if(mobileQuery.addListener)mobileQuery.addListener(onMobileChange)}
    $('fmAvatar').addEventListener('click',event=>{event.stopPropagation();setAccountMenu($('fmAccountMenu').hidden)});
    $('fmAvatar').addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();setAccountMenu(true,{focusFirst:true})}});
    $('fmAccountSessionBtn').addEventListener('click',accountSessionAction);
    $('fmImportBtn').addEventListener('click',()=>{if(requireEdit('登录后才能导入图谱文件。'))$('fmFileInput').click()});$('fmFileInput').addEventListener('change',event=>importFiles(event.target.files));
    $('fmEmptyTrashBtn').addEventListener('click',emptyTrash);$('fmCloseSelectionBtn').addEventListener('click',()=>{state.selectedId='';state.selectedType='file';syncSelectionUI()});$('fmDetailsBtn').addEventListener('click',toggleDetails);$('fmSummaryDetailsBtn').addEventListener('click',()=>setDetailsOpen(true));$('fmCloseDetailsBtn').addEventListener('click',()=>setDetailsOpen(false));$('fmDrawerBackdrop').addEventListener('click',()=>setDetailsOpen(false));
    $('fmChildFolderGrid')?.addEventListener('click',event=>{
      const menu=event.target.closest('[data-child-folder-menu]');if(menu){event.preventDefault();event.stopPropagation();const folder=[...state.folders,...state.trashFolders].find(item=>item.id===menu.dataset.childFolderMenu);if(folder){selectFolder(folder.id);const rect=menu.getBoundingClientRect();openContextMenu(folder,rect.right,rect.bottom,'folder')}return}
      const card=event.target.closest('[data-child-folder-id]');if(card)openFolder(card.dataset.childFolderId);
    });
    $('fmChildFolderGrid')?.addEventListener('keydown',event=>{const card=event.target.closest('[data-child-folder-id]');if(card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();openFolder(card.dataset.childFolderId)}});
    $('fmChildFolderGrid')?.addEventListener('contextmenu',event=>{const card=event.target.closest('[data-child-folder-id]');if(!card)return;event.preventDefault();const folder=[...state.folders,...state.trashFolders].find(item=>item.id===card.dataset.childFolderId);if(folder){selectFolder(folder.id);openContextMenu(folder,event.clientX,event.clientY,'folder')}});
    $('fmChildFolderGrid')?.addEventListener('dragstart',event=>{
      const card=event.target.closest('[data-child-folder-id]');if(!card||state.view==='trash'||isMobileReadonly()||event.target.closest('[data-child-folder-menu]')){event.preventDefault();return}
      const id=card.dataset.childFolderId,folder=state.folders.find(item=>item.id===id);if(!folder){event.preventDefault();return}
      state.dragPayload=[{kind:'folder',id}];event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',JSON.stringify(state.dragPayload));requestAnimationFrame(()=>card.classList.add('is-dragging'));
    });
    $('fmChildFolderGrid')?.addEventListener('dragend',clearFolderDragState);
    $('fmChildFolderGrid')?.addEventListener('dragover',event=>{
      if(!state.dragPayload||state.view==='trash')return;const card=event.target.closest('[data-child-folder-id]');if(!card)return;
      const id=card.dataset.childFolderId,illegal=isIllegalDropTarget(state.dragPayload,id);event.preventDefault();event.dataTransfer.dropEffect=illegal?'none':'move';card.classList.toggle('is-drop-target',!illegal);card.classList.toggle('is-drop-forbidden',illegal);setFolderDropHint(card,id,{illegal});
    });
    $('fmChildFolderGrid')?.addEventListener('dragleave',event=>{const card=event.target.closest('[data-child-folder-id]');if(card&&!card.contains(event.relatedTarget)){card.classList.remove('is-drop-target','is-drop-forbidden');delete card.dataset.dropHint}});
    $('fmChildFolderGrid')?.addEventListener('drop',event=>{
      if(!state.dragPayload||state.view==='trash')return;const card=event.target.closest('[data-child-folder-id]');if(!card)return;event.preventDefault();
      const payload=state.dragPayload.slice(),id=card.dataset.childFolderId,illegal=isIllegalDropTarget(payload,id);
      try{if(illegal){toast('不能移动到自身或自己的子文件夹。','error');return}const dragged=payload.length===1&&payload[0].kind==='folder'?state.folders.find(folder=>folder.id===payload[0].id):null;if(dragged&&(dragged.parentId||null)===id){toast('文件夹已在该位置。');return}if(moveItems(payload,id))state.expandedFolders.add(id)}finally{clearFolderDragState()}
    });
    $('fmFileGrid').addEventListener('click',event=>{
      const tagButton=event.target.closest('[data-tag-file]');if(tagButton){event.preventDefault();event.stopPropagation();const file=state.activeFiles.find(item=>item.id===tagButton.dataset.tagFile);if(file)global.KGFileManagerOrganize&&global.KGFileManagerOrganize.openTagPicker([{kind:'file',id:file.id}],tagButton);return}
      if(event.target.closest('.fm-file-name-input'))return;
      const create=event.target.closest('[data-create-file]');if(create){openCreateModal();return}
      const menuButton=event.target.closest('[data-menu-file]');if(menuButton){event.stopPropagation();const file=[...state.activeFiles,...state.trashFiles].find(item=>item.id===menuButton.dataset.menuFile);if(file){const rect=menuButton.getBoundingClientRect();selectFile(file.id);openContextMenu(file,rect.right,rect.bottom)}return}
      const mark=event.target.closest('[data-select-kind][data-select-id]');if(mark){event.preventDefault();event.stopPropagation();selectItem(mark.dataset.selectKind,mark.dataset.selectId,{toggle:true});return}
      const card=event.target.closest('.fm-file-card');if(card){const options=state.selectionMode?{toggle:true}:{toggle:event.ctrlKey||event.metaKey,add:event.shiftKey};selectFile(card.dataset.fileId,options)}
    });
    $('fmFileGrid').addEventListener('dblclick',event=>{if(state.selectionMode||event.target.closest('[data-menu-file],[data-tag-file],.fm-file-name-input,.fm-select-mark'))return;const card=event.target.closest('.fm-file-card');if(card&&!card.classList.contains('is-renaming')&&state.view!=='trash')openFile(card.dataset.fileId)});
    $('fmFileGrid').addEventListener('keydown',event=>{
      const input=event.target.closest('.fm-file-name-input');
      if(input){
        if(event.key==='Enter'){event.preventDefault();commitInlineRename()}
        else if(event.key==='Escape'){event.preventDefault();commitInlineRename({cancel:true})}
        return;
      }
      if(event.target.closest('[data-menu-file]'))return;const card=event.target.closest('.fm-file-card');if(card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();if(state.view!=='trash')openFile(card.dataset.fileId)}
    });
    $('fmFileGrid').addEventListener('focusout',event=>{if(event.target.matches('.fm-file-name-input'))setTimeout(()=>{if(state.renameSession&&state.renameSession.input===event.target&&!event.target.matches(':focus'))commitInlineRename()},0)});
    $('fmFileGrid').addEventListener('dragstart',event=>{const card=event.target.closest('.fm-file-card');if(!card||state.view==='trash'||card.classList.contains('is-renaming')||isMobileReadonly())return;const id=card.dataset.fileId;if(!state.selectedItems.has(itemKey('file',id)))selectFile(id);state.dragPayload=selectedPayload();event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',JSON.stringify(state.dragPayload));requestAnimationFrame(()=>card.classList.add('is-dragging'))});
    $('fmFileGrid').addEventListener('dragend',()=>{state.dragPayload=null;document.querySelectorAll('.is-dragging,.is-drop-target,.is-drop-forbidden').forEach(el=>el.classList.remove('is-dragging','is-drop-target','is-drop-forbidden'))});
    $('fmFileGrid').addEventListener('contextmenu',event=>{const card=event.target.closest('.fm-file-card');if(!card)return;event.preventDefault();const file=[...state.activeFiles,...state.trashFiles].find(item=>item.id===card.dataset.fileId);if(file){const key=itemKey('file',file.id);if(!state.selectedItems.has(key))selectFile(file.id);else{state.selectedType='file';state.selectedId=file.id;syncSelectionUI()}openContextMenu(file,event.clientX,event.clientY)}});
    $('fmContextMenu').addEventListener('click',event=>{const button=event.target.closest('[data-menu-action]');if(!button)return;if(button.dataset.submenuTrigger){event.preventDefault();const type=$('fmContextMenu').dataset.itemType||'file',id=type==='folder'?$('fmContextMenu').dataset.folderId:$('fmContextMenu').dataset.fileId,item=type==='folder'?[...state.folders,...state.trashFolders].find(entry=>entry.id===id):[...state.activeFiles,...state.trashFiles].find(entry=>entry.id===id);if(item)buildMoveSubmenu(item,type,button);return}const menu=$('fmContextMenu');runAction(button.dataset.menuAction,menu.dataset.itemType==='folder'?menu.dataset.folderId:menu.dataset.fileId)});
    $('fmContextMenu').addEventListener('mouseleave',scheduleCloseMoveSubmenu);$('fmMoveSubmenu').addEventListener('mouseenter',()=>clearTimeout(state.submenuTimer));$('fmMoveSubmenu').addEventListener('mouseleave',scheduleCloseMoveSubmenu);$('fmMoveSubmenu').addEventListener('click',event=>{const button=event.target.closest('[data-menu-action]');if(!button)return;const menu=$('fmMoveSubmenu');runAction(button.dataset.menuAction,menu.dataset.itemType==='folder'?menu.dataset.folderId:menu.dataset.fileId)});
    $('fmContextMenu').addEventListener('keydown',handleContextMenuKeydown);$('fmMoveSubmenu').addEventListener('keydown',handleContextMenuKeydown);
    $('fmBreadcrumbBar').addEventListener('click',event=>{const button=event.target.closest('[data-folder-path]');if(button&&!button.disabled)openFolder(button.dataset.folderPath)});
    $('fmBreadcrumbBar').addEventListener('dragover',event=>{const button=event.target.closest('[data-folder-path]');if(button&&state.dragPayload){const target=button.dataset.folderPath||null,illegal=isIllegalDropTarget(state.dragPayload,target);event.preventDefault();event.dataTransfer.dropEffect=illegal?'none':'move';button.classList.toggle('is-drop-target',!illegal);button.classList.toggle('is-drop-forbidden',illegal)}});
    $('fmBreadcrumbBar').addEventListener('dragleave',event=>{const button=event.target.closest('[data-folder-path]');if(button&&!button.contains(event.relatedTarget))button.classList.remove('is-drop-target','is-drop-forbidden')});
    $('fmBreadcrumbBar').addEventListener('drop',event=>{const button=event.target.closest('[data-folder-path]');if(!button||!state.dragPayload)return;event.preventDefault();const target=button.dataset.folderPath||null,illegal=isIllegalDropTarget(state.dragPayload,target);button.classList.remove('is-drop-target','is-drop-forbidden');if(illegal){toast('不能移动到自身或自己的子文件夹。','error');return}moveItems(state.dragPayload,target)});
    $('fmInfoActions').addEventListener('click',event=>{const button=event.target.closest('[data-info-action]');if(button&&state.selectedId)runAction(button.dataset.infoAction,state.selectedId)});
    $('fmModalClose').addEventListener('click',closeModal);$('fmModalCancel').addEventListener('click',closeModal);$('fmModal').addEventListener('submit',submitModal);$('fmModalBackdrop').addEventListener('mousedown',event=>{if(event.target===$('fmModalBackdrop'))closeModal()});
    document.addEventListener('pointerdown',event=>{if(state.renameSession&&!event.target.closest('.fm-file-name-input')&&!event.target.closest('[data-menu-action="rename"],[data-info-action="rename"]'))commitInlineRename()},{capture:true});
    document.addEventListener('click',event=>{if(!event.target.closest('#fmContextMenu,#fmMoveSubmenu')&&!event.target.closest('[data-menu-file],[data-menu-folder],[data-folder-tree-menu]'))closeContextMenu();if(!event.target.closest('#fmAccountShell'))setAccountMenu(false);if(!event.target.closest('#fmFavoriteTagsPopover,#fmFavoriteTagsBtn'))closeFavoriteTagsPopover()});
    document.addEventListener('keydown',event=>{
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();$('fmSearchInput').focus();$('fmSearchInput').select()}
      if(event.altKey&&event.key==='Enter'){event.preventDefault();toggleDetails()}
      if(event.key==='Escape'&&!state.busy){if(!$('fmModalBackdrop').hidden)closeModal();else if(state.detailsOpen)setDetailsOpen(false);else if(state.selectionMode)setSelectionMode(false);else{closeContextMenu();closeFavoriteTagsPopover();setAccountMenu(false)}}
    });
    const refreshOwner=()=>{state.selectedId='';state.currentFolderId=null;state.showAllFiles=true;state.tagFilter='';state.selectedItems.clear();state.selectionMode=false;state.initialSelectionDone=false;state.integrityResult=null;state.integrityOwner='';setAccountMenu(false);updateIdentity();try{store.purgeExpiredTrash({owner:currentOwner()})}catch(err){}refreshData()};
    global.addEventListener('kg-graph-file-change',()=>refreshData());
    global.addEventListener('kg-auth-session-change',refreshOwner);
    global.addEventListener('kg-auth-users-change',refreshOwner);
    global.addEventListener('storage',event=>{
      const key=String(event.key||'');
      if(key==='kg_local_current_user_v1'||key==='kg_local_users_v1')refreshOwner();
      else if(key.startsWith('kg_graph_'))refreshData();
    });
  }
  function syncMobileReadonly(){
    const mobile=isMobileReadonly(),notice=$('fmMobileReadonlyNotice');document.body.classList.toggle('is-mobile-readonly',mobile);
    if(notice)notice.hidden=!mobile;
  }
  function init(){
    if(!store||!packages){document.body.innerHTML='<p style="padding:24px">文件管理模块加载失败，请返回编辑器重试。</p>';return}
    initTheme();readRecentFolders();syncMobileReadonly();applySidebarCollapsed(state.sidebarCollapsed,{persist:false});applyFolderSectionCollapsed(state.folderSectionCollapsed,{persist:false});updateIdentity();bind();setDetailsOpen(state.detailsOpen,{persist:false});
    if(global.KGFileManagerOrganize)global.KGFileManagerOrganize.init({owner:currentOwner,refresh:refreshData,toast,files:()=>[...state.activeFiles,...state.trashFiles],folders:()=>[...state.folders,...state.trashFolders]});
    try{store.purgeExpiredTrash({owner:currentOwner()})}catch(err){}
    refreshData();
  }

  global.KGGraphFileManager={
    refresh:refreshData,
    openFile,
    importFiles,
    exportFile,
    normalizeImportedGraph,
    makeUniqueName(base,names=[]){return uniqueNameFromSet(base,new Set((Array.isArray(names)?names:[]).map(name=>String(name).toLowerCase())))},
    setView(view){if(['files','recent','favorites','trash'].includes(view)){state.view=view;if(view!=='favorites')state.tagFilter='';state.currentFolderId=null;state.showAllFiles=true;state.selectedId='';render();return true}return false},
    setLayout,
    getState(){return{view:state.view,filter:state.filter,layout:state.layout,sort:state.sort,query:state.query,selectedId:state.selectedId,activeCount:state.activeFiles.length,trashCount:state.trashFiles.length,folderCount:state.folders.length,currentFolderId:state.currentFolderId,selectedCount:state.selectedItems.size}}
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
