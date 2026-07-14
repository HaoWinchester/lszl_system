'use strict';

/*
 * v8.1：文件页签只读取 v2 索引元数据；打开文件时才读取图谱正文。
 * 关闭只移除页签，不删除图谱文件；关闭状态按用户保存在当前浏览器会话中。
 */
(function(global){
  let initialized=false;
  const closedByOwner=new Map();
  const CLOSED_TABS_KEY='kg_graph_closed_tabs_v1';
  const $id=id=>document.getElementById(id);

  function sessionStore(){
    try{return global.sessionStorage||null}catch(err){return null}
  }
  function readClosedRegistry(){
    const storage=sessionStore();if(!storage)return {};
    try{
      const parsed=JSON.parse(storage.getItem(CLOSED_TABS_KEY)||'{}');
      return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
    }catch(err){return {}}
  }
  function writeClosedRegistry(registry){
    const storage=sessionStore();if(!storage)return false;
    try{storage.setItem(CLOSED_TABS_KEY,JSON.stringify(registry||{}));return true}catch(err){return false}
  }
  function loadClosed(ownerKey){
    const registry=readClosedRegistry(),values=Array.isArray(registry[ownerKey])?registry[ownerKey]:[];
    return new Set(values.map(String).filter(Boolean));
  }
  function persistClosed(ownerKey,set){
    const registry=readClosedRegistry(),values=[...set].map(String).filter(Boolean);
    if(values.length)registry[ownerKey]=values;else delete registry[ownerKey];
    writeClosedRegistry(registry);
  }

  function owner(){
    const store=global.KGGraphFileStore;
    return store&&store.currentOwner?store.currentOwner():'guest';
  }
  function closedSet(){
    const key=owner();
    if(!closedByOwner.has(key))closedByOwner.set(key,loadClosed(key));
    return closedByOwner.get(key);
  }
  function persistCurrentClosed(){persistClosed(owner(),closedSet())}
  function markOpen(id){
    if(!id)return;
    const closed=closedSet();
    if(closed.delete(String(id)))persistCurrentClosed();
  }
  function markClosed(id){
    if(!id)return;
    const closed=closedSet();
    if(!closed.has(String(id))){closed.add(String(id));persistCurrentClosed()}
  }
  function forgetClosed(id){
    if(!id)return;
    const closed=closedSet();
    if(closed.delete(String(id)))persistCurrentClosed();
  }
  function canCreate(){
    if(typeof global.authRequire==='function')return global.authRequire('登录后才能新建图谱文件。','editGraph');
    return true;
  }
  function currentFile(){const store=global.KGGraphFileStore;return store&&store.getCurrentFileMeta?store.getCurrentFileMeta():(store&&store.getCurrentFile?store.getCurrentFile():null)}
  function visibleFiles(){
    const store=global.KGGraphFileStore;
    if(!store)return [];
    const currentId=store.getCurrentFileId(),closed=closedSet();
    // 当前文件必须始终可见，避免外部打开文件后页签仍处于关闭状态。
    if(currentId&&closed.delete(String(currentId)))persistCurrentClosed();
    return store.listFiles().filter(file=>!closed.has(String(file.id)));
  }
  function renderSaveState(detail){
    const el=$id('graphSaveState');if(!el)return;
    const status=detail||(global.KGGraphFileAutosave&&global.KGGraphFileAutosave.status?global.KGGraphFileAutosave.status():{});
    const saving=!!status.saving,dirty=!!status.dirty,error=!!status.lastError;
    el.classList.toggle('is-dirty',dirty&&!saving&&!error);
    el.classList.toggle('is-saving',saving);
    el.classList.toggle('is-error',error);
    el.disabled=saving;
    el.setAttribute('aria-busy',saving?'true':'false');
    const text=error?'保存失败':saving?'保存中':dirty?'有未保存修改':'已保存';
    el.setAttribute('aria-label',`立即保存。当前状态：${text}`);
    el.title=saving?'正在保存…':`${text}。点击立即保存（Ctrl+S / Command+S）`;
    const label=el.querySelector('.graph-save-state-text');if(label)label.textContent=text;
  }
  function manualSave(){
    const autosave=global.KGGraphFileAutosave;
    if(!autosave||typeof autosave.saveNow!=='function'){
      if(typeof global.showStatus==='function')global.showStatus('保存功能尚未就绪。');
      return false;
    }
    const status=typeof autosave.status==='function'?autosave.status():{};
    if(status.saving)return false;
    const hadChanges=typeof autosave.isDirty==='function'?autosave.isDirty():!!status.dirty;
    const ok=autosave.saveNow({force:true,silent:false,reason:'manual-save'});
    if(typeof global.showStatus==='function'){
      if(ok)global.showStatus(hadChanges?'图谱已保存。':'当前内容已保存。');
      else global.showStatus((typeof autosave.status==='function'&&autosave.status().lastError)||'图谱保存失败。');
    }
    return ok;
  }
  function updateCurrentFileDisplay(){
    const file=currentFile(),fallback=(typeof state!=='undefined'&&state.meta&&state.meta.title)||'知识点关系图谱';
    const name=file&&file.name||fallback;
    const title=$id('appTitle');if(title){title.textContent=name;title.title=name}
    const display=$id('graphMetaDisplay');if(display)display.setAttribute('aria-label',`当前图谱：${name}。单击修改标题，双击查看文件信息`);
  }
  function renderTabs(options={}){
    const host=$id('graphFileTabs'),store=global.KGGraphFileStore;if(!host||!store)return;
    const files=visibleFiles(),currentId=store.getCurrentFileId(),previousScroll=host.scrollLeft;
    const frag=document.createDocumentFragment();
    files.forEach(file=>{
      const tab=document.createElement('div');
      tab.className='graph-file-tab'+(file.id===currentId?' is-active':'');tab.dataset.fileId=file.id;
      tab.draggable=true;
      tab.setAttribute('role','tab');tab.setAttribute('aria-selected',file.id===currentId?'true':'false');tab.tabIndex=file.id===currentId?0:-1;
      tab.title=file.name;tab.setAttribute('aria-label',`${file.name}${file.id===currentId?'，当前文件':''}。可拖拽调整顺序`);
      const label=document.createElement('span');label.className='graph-file-tab-title';label.textContent=file.name;
      const close=document.createElement('button');close.type='button';close.className='graph-file-tab-close';close.dataset.closeFileId=file.id;
      close.draggable=false;close.textContent='×';close.title=`关闭“${file.name}”页签`;close.setAttribute('aria-label',`关闭“${file.name}”页签`);
      tab.append(label,close);frag.appendChild(tab);
    });
    host.replaceChildren(frag);updateCurrentFileDisplay();renderSaveState();
    if(options.scrollActive===false)host.scrollLeft=previousScroll;
    else requestAnimationFrame(()=>{const active=host.querySelector('.graph-file-tab.is-active');if(active)active.scrollIntoView({block:'nearest',inline:'nearest'})});
  }
  function applyFile(file){
    if(!file||!file.graphData)return false;
    try{
      state=typeof global.sanitizeState==='function'?global.sanitizeState(file.graphData):file.graphData;
    }catch(err){console.warn('[KGGraphFileTabs] invalid graph file:',err);return false}
    try{if(typeof selectedNodeIds!=='undefined'&&selectedNodeIds&&typeof selectedNodeIds.clear==='function')selectedNodeIds.clear()}catch(err){}
    try{lastSavedSnapshot=JSON.stringify(typeof global.saveableState==='function'?global.saveableState():file.graphData)}catch(err){lastSavedSnapshot=''}
    if(global.KGGraphFileAutosave&&global.KGGraphFileAutosave.clearDirty)global.KGGraphFileAutosave.clearDirty('file-opened');
    if(typeof global.render==='function')global.render();
    renderTabs();
    return true;
  }
  function openFile(id){
    const store=global.KGGraphFileStore;if(!store||!id)return false;
    markOpen(id);
    if(id===store.getCurrentFileId()){renderTabs();return true}
    const autosave=global.KGGraphFileAutosave;
    if(autosave&&autosave.saveBeforeSwitch&&!autosave.saveBeforeSwitch()){
      if(typeof global.showStatus==='function')global.showStatus('当前图谱保存失败，已取消切换。');
      return false;
    }
    const previousId=store.getCurrentFileId(),file=store.openFile(id,{emit:false});
    if(!file){if(typeof global.showStatus==='function')global.showStatus(store.getLastError&&store.getLastError()||'图谱文件打开失败。');return false}
    const ok=applyFile(file);
    if(!ok){if(previousId)store.openFile(previousId,{emit:false});renderTabs();if(typeof global.showStatus==='function')global.showStatus('图谱文件内容异常，已取消切换。');return false}
    global.dispatchEvent(new CustomEvent('kg-graph-current-file-change',{detail:{owner:store.currentOwner?store.currentOwner():'',id:file.id}}));
    if(typeof global.showStatus==='function')global.showStatus(`已切换到“${file.name}”。`);
    return ok;
  }
  let tabDrag=null;
  function clearDragVisual(host){
    (host||$id('graphFileTabs'))?.querySelectorAll?.('.graph-file-tab').forEach(tab=>tab.classList.remove('is-dragging','drag-before','drag-after','drag-shift-left','drag-shift-right'));
  }
  function endTabDrag(host){
    if(host)host.classList.remove('drag-active');
    clearDragVisual(host);
  }
  function tabInsertSide(tab,clientX){
    const rect=tab.getBoundingClientRect();
    return clientX<rect.left+rect.width/2?'before':'after';
  }
  function applyTabDragPreview(host,dragId,target,side){
    if(!host||!dragId)return;
    const tabs=[...host.querySelectorAll('.graph-file-tab')];
    tabs.forEach(tab=>tab.classList.remove('drag-before','drag-after','drag-shift-left','drag-shift-right'));
    if(!target||!host.contains(target)||String(target.dataset.fileId)===String(dragId))return;
    target.classList.add(side==='before'?'drag-before':'drag-after');
    const sourceIndex=tabs.findIndex(tab=>String(tab.dataset.fileId)===String(dragId));
    const targetIndex=tabs.indexOf(target);
    if(sourceIndex<0||targetIndex<0||sourceIndex===targetIndex)return;
    if(sourceIndex<targetIndex){
      const end=targetIndex-(side==='before'?1:0);
      tabs.forEach((tab,index)=>{if(index>sourceIndex&&index<=end)tab.classList.add('drag-shift-left')});
    }else{
      const start=targetIndex+(side==='after'?1:0);
      tabs.forEach((tab,index)=>{if(index>=start&&index<sourceIndex)tab.classList.add('drag-shift-right')});
    }
  }
  function reorderVisibleTabs(dragId,targetId,side){
    const store=global.KGGraphFileStore;if(!store||typeof store.reorderFiles!=='function'||!dragId)return false;
    const ids=visibleFiles().map(file=>String(file.id)),from=ids.indexOf(String(dragId));
    if(from<0)return false;
    ids.splice(from,1);
    if(targetId){
      let to=ids.indexOf(String(targetId));
      if(to<0)to=ids.length;
      if(side==='after')to+=1;
      ids.splice(Math.max(0,Math.min(ids.length,to)),0,String(dragId));
    }else{
      ids.push(String(dragId));
    }
    const result=store.reorderFiles(ids);
    if(!result){if(typeof global.showStatus==='function')global.showStatus(store.getLastError&&store.getLastError()||'页签排序保存失败。');return false}
    renderTabs({scrollActive:false});
    if(typeof global.showStatus==='function')global.showStatus('已调整图谱页签顺序。');
    return true;
  }
  function closeFile(id){
    const store=global.KGGraphFileStore;if(!store||!id)return false;
    const files=visibleFiles(),index=files.findIndex(file=>String(file.id)===String(id));
    if(index<0)return false;
    const target=files[index],currentId=store.getCurrentFileId(),isCurrent=String(currentId)===String(id);
    if(files.length<=1){
      // 文件管理器已经成为图谱文件的统一入口，因此允许关闭最后一个页签。
      // 最后一个可见页签必然是当前编辑文件；离开前必须先完成保存。
      const autosave=global.KGGraphFileAutosave;
      if(autosave&&autosave.saveBeforeSwitch&&!autosave.saveBeforeSwitch()){
        if(typeof global.showStatus==='function')global.showStatus('当前图谱保存失败，已取消关闭。');
        return false;
      }
      markClosed(id);
      if(typeof global.showStatus==='function')global.showStatus(`已关闭“${target.name}”页签，正在返回文件管理。`);
      global.location.href='file-manager.html';
      return true;
    }
    if(!isCurrent){
      markClosed(id);renderTabs({scrollActive:false});
      if(typeof global.showStatus==='function')global.showStatus(`已关闭“${target.name}”页签，图谱文件未删除。`);
      return true;
    }
    const autosave=global.KGGraphFileAutosave;
    if(autosave&&autosave.saveBeforeSwitch&&!autosave.saveBeforeSwitch()){
      if(typeof global.showStatus==='function')global.showStatus('当前图谱保存失败，已取消关闭。');
      return false;
    }
    const next=files[index+1]||files[index-1];
    if(!next)return false;
    markClosed(id);
    const file=store.openFile(next.id,{emit:false});
    if(!file||!applyFile(file)){
      markOpen(id);
      if(currentId)store.openFile(currentId,{emit:false});
      renderTabs();
      if(typeof global.showStatus==='function')global.showStatus('关闭页签失败，已恢复原文件。');
      return false;
    }
    global.dispatchEvent(new CustomEvent('kg-graph-current-file-change',{detail:{owner:store.currentOwner?store.currentOwner():'',id:file.id}}));
    if(typeof global.showStatus==='function')global.showStatus(`已关闭“${target.name}”页签，图谱文件未删除。`);
    return true;
  }
  function createFile(){
    if(!canCreate())return null;
    const store=global.KGGraphFileStore;if(!store)return null;
    const input=global.prompt('请输入新图谱文件名称：','新图谱文件');
    if(input===null)return null;
    const name=(String(input||'').trim()||'新图谱文件').slice(0,100);
    const blank=typeof global.templateState==='function'?global.templateState('blank'):{meta:{title:name,subject:'自定义学科',audience:'学员',description:''},nodes:[],links:[]};
    if(blank.meta)blank.meta.title=name;
    const autosave=global.KGGraphFileAutosave;if(autosave&&autosave.saveBeforeSwitch&&!autosave.saveBeforeSwitch())return null;
    const previousId=store.getCurrentFileId(),file=store.createFile({name,graphData:blank},{makeCurrent:true});
    if(!file){if(typeof global.showStatus==='function')global.showStatus(store.getLastError&&store.getLastError()||'新建图谱失败，本地存储空间可能已满。');return null}
    markOpen(file.id);
    if(!applyFile(file)){
      store.deleteFile(file.id,{emit:false,permanent:true});if(previousId)store.openFile(previousId,{emit:false});renderTabs();
      if(typeof global.showStatus==='function')global.showStatus('新图谱初始化失败，已恢复原图谱。');return null
    }
    if(typeof global.showStatus==='function')global.showStatus(`已新建图谱“${file.name}”。`);
    return file;
  }
  function bind(){
    const tabs=$id('graphFileTabs'),add=$id('graphFileAddBtn'),home=$id('graphFileHomeBtn');
    if(tabs&&!tabs.dataset.bound){
      tabs.dataset.bound='1';
      tabs.addEventListener('click',event=>{
        if(tabs.dataset.dragSuppress==='1'){event.preventDefault();event.stopPropagation();tabs.dataset.dragSuppress='';return}
        const close=event.target.closest('.graph-file-tab-close');
        if(close){event.preventDefault();event.stopPropagation();closeFile(close.dataset.closeFileId);return}
        const tab=event.target.closest('.graph-file-tab');if(tab)openFile(tab.dataset.fileId);
      });
      tabs.addEventListener('keydown',event=>{
        const tab=event.target.closest('.graph-file-tab');
        if(!tab||event.target.closest('.graph-file-tab-close'))return;
        if(event.key==='Enter'||event.key===' '){event.preventDefault();openFile(tab.dataset.fileId)}
        if((event.key==='Delete'||event.key==='Backspace')&&event.altKey){event.preventDefault();closeFile(tab.dataset.fileId)}
      });
      tabs.addEventListener('dragstart',event=>{
        const tab=event.target.closest('.graph-file-tab');
        if(!tab||event.target.closest('.graph-file-tab-close')){event.preventDefault();return}
        tabDrag={id:String(tab.dataset.fileId||''),moved:false};
        tabs.classList.add('drag-active');
        try{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',tabDrag.id)}catch(err){}
        requestAnimationFrame(()=>tab.classList.add('is-dragging'));
      });
      tabs.addEventListener('dragover',event=>{
        if(!tabDrag)return;
        const tab=event.target.closest('.graph-file-tab');
        if(!tab||!tabs.contains(tab)){
          event.preventDefault();
          applyTabDragPreview(tabs,tabDrag.id,null,'after');
          return;
        }
        if(String(tab.dataset.fileId)===tabDrag.id)return;
        event.preventDefault();
        tabDrag.moved=true;
        const side=tabInsertSide(tab,event.clientX);
        applyTabDragPreview(tabs,tabDrag.id,tab,side);
        try{event.dataTransfer.dropEffect='move'}catch(err){}
      });
      tabs.addEventListener('drop',event=>{
        if(!tabDrag)return;
        event.preventDefault();
        const tab=event.target.closest('.graph-file-tab'),targetId=tab&&tabs.contains(tab)?String(tab.dataset.fileId||''):'',side=tab?tabInsertSide(tab,event.clientX):'after';
        const dragId=tabDrag.id;
        const moved=targetId!==dragId&&reorderVisibleTabs(dragId,targetId,side);
        if(moved)tabs.dataset.dragSuppress='1';
        tabDrag=null;
        endTabDrag(tabs);
      });
      tabs.addEventListener('dragend',()=>{
        if(tabDrag&&tabDrag.moved)tabs.dataset.dragSuppress='1';
        tabDrag=null;
        endTabDrag(tabs);
      });
    }
    if(add&&!add.dataset.bound){add.dataset.bound='1';add.addEventListener('click',createFile)}
    const saveButton=$id('graphSaveState');
    if(saveButton&&!saveButton.dataset.bound){
      saveButton.dataset.bound='1';
      saveButton.addEventListener('click',manualSave);
    }
    if(document.documentElement.dataset.graphManualSaveShortcutBound!=='1'){
      document.documentElement.dataset.graphManualSaveShortcutBound='1';
      global.addEventListener('keydown',event=>{
        if(!(event.ctrlKey||event.metaKey)||event.altKey||String(event.key||'').toLowerCase()!=='s')return;
        event.preventDefault();
        manualSave();
      });
    }
    if(home&&!home.dataset.bound){
      home.dataset.bound='1';
      home.addEventListener('click',()=>{
        const autosave=global.KGGraphFileAutosave;
        if(autosave&&typeof autosave.saveBeforeSwitch==='function'&&!autosave.saveBeforeSwitch()){
          if(typeof global.showStatus==='function')global.showStatus('当前图谱保存失败，已取消进入文件管理。');
          return;
        }
        global.location.href='file-manager.html';
      })
    }
    global.addEventListener('kg-graph-file-change',event=>{
      const detail=event.detail||{};
      if((detail.action==='delete'||detail.action==='delete-permanent'||detail.action==='trash')&&detail.id)forgetClosed(detail.id);
      if((detail.action==='create'||detail.action==='open')&&detail.file)markOpen(detail.file.id);
      renderTabs({scrollActive:false});
    });
    global.addEventListener('kg-graph-current-file-change',event=>{const id=event.detail&&event.detail.id;if(id)markOpen(id);renderTabs()});
    global.addEventListener('kg-graph-autosave-status',event=>renderSaveState(event.detail||{}));
    global.addEventListener('kg-graph-file-error',event=>{const message=event.detail&&event.detail.message;if(message&&typeof global.showStatus==='function')global.showStatus(message)});
  }
  function init(){if(initialized)return;initialized=true;bind();renderTabs()}
  function refresh(){renderTabs()}

  global.KGGraphFileTabs={init,refresh,renderTabs,openFile,closeFile,createFile,manualSave,updateCurrentFileDisplay};
})(window);
