'use strict';
(function(global){
  const store=global.KGCanvasWorkspaceStore;
  if(!store)return;
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const state={type:'graph',query:''};

  function toast(message,type='success'){
    const stack=$('fmToastStack');if(!stack){console.info(message);return}
    const item=document.createElement('div');item.className='fm-toast '+(type==='error'?'is-error':'is-success');
    item.innerHTML='<span>'+esc(message)+'</span>';stack.appendChild(item);setTimeout(()=>item.remove(),2200);
  }
  function formatDate(value){
    const date=new Date(Number(value||0));if(!Number.isFinite(date.getTime()))return '—';
    return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(date);
  }
  function workspaceUrl(id){return 'question-workspace.html?workspace='+encodeURIComponent(String(id||''))}
  function all(){return store.listWorkspaces?.()||[]}
  function list(){
    const q=String(state.query||'').trim().toLowerCase();
    return all().filter(item=>!q||[item.title,item.id].join(' ').toLowerCase().includes(q));
  }
  function renderCard(item){
    const article=document.createElement('article');
    article.className='fm-file-card fm-workspace-card';article.dataset.workspaceId=String(item.id);
    article.tabIndex=0;article.setAttribute('role','button');article.setAttribute('aria-label',item.title+'，双击打开');
    article.innerHTML=`<div class="fm-workspace-cover"><div class="fm-workspace-cover-grid"></div><span>▣</span><small>多题画布</small></div>
      <div class="fm-file-meta"><strong class="fm-file-name" title="${esc(item.title)}">${esc(item.title)}</strong>
      <span class="fm-file-date">${esc(formatDate(item.updatedAt))}</span>
      <div class="fm-file-stats"><span><strong>${Number(item.questionCount||0)}</strong> 题目</span><span><strong>${Number(item.synthesisCount||0)}</strong> 归纳</span><span><strong>${Number(item.nodeCount||0)}</strong> 卡片</span></div>
      <div class="fm-workspace-actions"><button type="button" data-workspace-action="rename">重命名</button><button type="button" data-workspace-action="duplicate">复制</button><button type="button" data-workspace-action="delete" class="danger">删除</button></div></div>`;
    return article;
  }
  function render(){
    if(state.type!=='workspace')return;
    const grid=$('fmWorkspaceGrid'),empty=$('fmWorkspaceEmpty'),items=list();if(!grid)return;
    grid.replaceChildren(...items.map(renderCard));grid.hidden=items.length===0;if(empty)empty.hidden=items.length>0;
    if($('fmWorkspaceCount'))$('fmWorkspaceCount').textContent=all().length+' 个画布';
  }
  function updateMode(type,{push=true}={}){
    state.type=type==='workspace'?'workspace':'graph';
    document.body.classList.toggle('fm-workspace-mode',state.type==='workspace');
    if($('fmGraphBrowser'))$('fmGraphBrowser').hidden=state.type==='workspace';
    if($('fmWorkspaceLibrary'))$('fmWorkspaceLibrary').hidden=state.type!=='workspace';
    document.querySelectorAll('[data-fm-file-type]').forEach(button=>{
      const active=button.dataset.fmFileType===state.type;
      button.classList.toggle('is-active',active);button.setAttribute('aria-selected',active?'true':'false');
    });
    if($('fmPageSubtitle'))$('fmPageSubtitle').textContent=state.type==='workspace'?'管理多题归纳画布文件':'管理你的知识图谱文件';
    const primary=$('fmNewFileBtn');if(primary)primary.querySelector('span').textContent=state.type==='workspace'?'新建画布':'新建图谱';
    if(push){const url=new URL(location.href);if(state.type==='workspace')url.searchParams.set('type','workspace');else url.searchParams.delete('type');history.replaceState(null,'',url.pathname+url.search)}
    if(state.type==='workspace')render();
  }
  function create(){
    let title='新建解题画布';
    try{const value=global.prompt?.('请输入画布名称',title);if(value===null)return;title=String(value||title).trim()||title}catch(e){}
    const workspace=store.createWorkspace?.(title,{activate:true});
    if(workspace){toast('已创建多题画布。');global.location.href=workspaceUrl(workspace.id)}
  }
  function rename(id){
    const item=all().find(x=>String(x.id)===String(id));if(!item)return;
    let title=item.title;try{const value=global.prompt?.('请输入新的画布名称',title);if(value===null)return;title=String(value||'').trim()}catch(e){}
    if(!title)return;const saved=store.renameWorkspace?.(id,title);if(saved){toast('画布名称已更新。');render()}
  }
  function duplicate(id){
    const source=store.read?.({workspaceId:id});if(!source)return;
    const created=store.createWorkspace?.((source.title||'未命名画布')+' 副本',{activate:false});if(!created)return;
    const copy=JSON.parse(JSON.stringify(source));copy.id=created.id;copy.title=created.title;copy.userId=created.userId;copy.createdAt=Date.now();copy.updatedAt=Date.now();
    const saved=store.write?.(copy,{reason:'workspace-duplicated'});if(saved){toast('已创建画布副本。');render()}
  }
  function remove(id){
    const item=all().find(x=>String(x.id)===String(id));if(!item)return;
    let ok=true;try{ok=global.confirm?.('删除“'+item.title+'”？只删除多题画布，不删除原题和学习记录。')!==false}catch(e){}
    if(!ok)return;const result=store.deleteWorkspace?.(id);if(result){toast('多题画布已删除。');render()}
  }
  function open(id){store.setActiveWorkspace?.(id);global.location.href=workspaceUrl(id)}

  function bind(){
    document.querySelectorAll('[data-fm-file-type]').forEach(button=>button.addEventListener('click',()=>updateMode(button.dataset.fmFileType)));
    $('fmWorkspaceSearch')?.addEventListener('input',event=>{state.query=String(event.target.value||'');render()});
    document.addEventListener('click',event=>{const button=event.target.closest?.('#fmWorkspaceCreateBtn,#fmWorkspaceEmptyCreate');if(!button)return;event.preventDefault();event.stopImmediatePropagation();create()},true);
    $('fmWorkspaceGrid')?.addEventListener('dblclick',event=>{if(event.target.closest('button'))return;const card=event.target.closest('[data-workspace-id]');if(card)open(card.dataset.workspaceId)});
    $('fmWorkspaceGrid')?.addEventListener('keydown',event=>{const card=event.target.closest('[data-workspace-id]');if(card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();open(card.dataset.workspaceId)}});
    $('fmWorkspaceGrid')?.addEventListener('click',event=>{
      const action=event.target.closest('[data-workspace-action]')?.dataset.workspaceAction,id=event.target.closest('[data-workspace-id]')?.dataset.workspaceId;
      if(!action||!id)return;event.preventDefault();event.stopPropagation();
      if(action==='rename')rename(id);else if(action==='duplicate')duplicate(id);else if(action==='delete')remove(id);
    });
    $('fmNewFileBtn')?.addEventListener('click',event=>{if(state.type!=='workspace')return;event.preventDefault();event.stopImmediatePropagation();create()},true);
    global.addEventListener('kg:workspace-changed',()=>{if(state.type==='workspace')render()});
  }
  bind();
  updateMode(new URL(location.href).searchParams.get('type')==='workspace'?'workspace':'graph',{push:false});
  global.KGFileManagerWorkspaceLibrary={render,updateMode,create,open};
})(window);
