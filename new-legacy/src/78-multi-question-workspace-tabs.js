'use strict';

/*
 * v8.6.2 P2.2.12
 * Multi-question workspace tabs mirror the Knowledge Graph file-tab interaction:
 * active tab, close-without-delete, drag reorder, add, current-tab menu and reopen list.
 */
(function(global){
  let options={};
  let bound=false;
  let tabDrag=null;
  const CLOSED_KEY='kg_multi_workspace_closed_tabs_v1__';
  const byId=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function ownerKey(){return String(options.ownerKey||'guest')}
  function storageKey(){return CLOSED_KEY+encodeURIComponent(ownerKey())}
  function readClosed(){
    try{
      const raw=JSON.parse(sessionStorage.getItem(storageKey())||'[]');
      return new Set((Array.isArray(raw)?raw:[]).map(String).filter(Boolean));
    }catch(e){return new Set()}
  }
  function writeClosed(set){
    try{sessionStorage.setItem(storageKey(),JSON.stringify([...set]))}catch(e){}
  }
  function markOpen(id){const set=readClosed();if(set.delete(String(id)))writeClosed(set)}
  function markClosed(id){const set=readClosed();set.add(String(id));writeClosed(set)}
  function forgetClosed(id){const set=readClosed();if(set.delete(String(id)))writeClosed(set)}

  function all(){return Array.isArray(options.workspaces)?options.workspaces:[]}
  function active(){return String(options.activeWorkspaceId||'')}
  function visible(){
    const current=active();
    const closed=readClosed();
    if(current&&closed.delete(current))writeClosed(closed);
    return all().filter(item=>!closed.has(String(item.id)));
  }
  function setOptions(next={}){
    options={...options,...next,workspaces:Array.isArray(next.workspaces)?next.workspaces:(options.workspaces||[])};
  }

  function renderList(){
    const host=byId('qwWorkspaceList');if(!host)return;
    const closed=readClosed(),current=active(),workspaces=all();
    host.innerHTML=workspaces.length?workspaces.map(item=>{
      const id=String(item.id||''),isCurrent=id===current,isClosed=closed.has(id);
      return `<button type="button" class="qw-workspace-list-item ${isCurrent?'is-current':''}" data-qw-open-workspace="${esc(id)}">
        <span><strong>${esc(item.title||'未命名画布')}</strong><small>${Number(item.nodeCount||0)} 题${isClosed?' · 已关闭页签':''}</small></span>
        <em>${isCurrent?'当前':isClosed?'打开':'切换'}</em>
      </button>`;
    }).join(''):'<div class="qw-workspace-list-empty">暂无画布。</div>';
  }

  function render(optionsPatch={}){
    setOptions(optionsPatch);
    const host=byId('qwWorkspaceTabs');if(!host)return [];
    const scrollActive=optionsPatch.scrollActive!==false;
    const list=visible(),current=active(),previousScroll=host.scrollLeft;
    host.innerHTML=list.map(item=>{
      const id=String(item.id||''),isActive=id===current;
      return `<div class="qw-workspace-tab ${isActive?'is-active':''}" role="tab" aria-selected="${isActive?'true':'false'}" tabindex="${isActive?'0':'-1'}" draggable="true" data-workspace-id="${esc(id)}" title="${esc(item.title||'未命名画布')} · ${Number(item.nodeCount||0)} 题">
        <span class="qw-workspace-tab-title">${esc(item.title||'未命名画布')}</span>
        <button type="button" class="qw-workspace-tab-close" data-close-workspace-id="${esc(id)}" title="关闭“${esc(item.title||'未命名画布')}”页签" aria-label="关闭“${esc(item.title||'未命名画布')}”页签">×</button>
      </div>`;
    }).join('');
    renderList();
    requestAnimationFrame(()=>{
      host.scrollLeft=previousScroll;
      if(scrollActive)host.querySelector('.qw-workspace-tab.is-active')?.scrollIntoView?.({block:'nearest',inline:'nearest'});
    });
    return list;
  }

  function openWorkspace(id){
    id=String(id||'');if(!id)return false;
    markOpen(id);
    byId('qwWorkspaceListPopover')?.setAttribute('hidden','');
    if(id===active()){render({scrollActive:true});return true}
    options.onOpen?.(id);
    return true;
  }

  function closeWorkspace(id){
    id=String(id||'');if(!id)return false;
    const list=visible(),index=list.findIndex(item=>String(item.id)===id);
    if(index<0)return false;
    if(list.length<=1){
      const closed=readClosed();
      const hidden=all().find(item=>String(item.id)!==id&&closed.has(String(item.id)));
      if(hidden){
        markClosed(id);markOpen(hidden.id);options.onOpen?.(String(hidden.id));return true;
      }
      options.onNotify?.('至少保留一个画布页签。');
      return false;
    }
    if(id!==active()){
      markClosed(id);render();options.onNotify?.('已关闭画布页签，画布内容未删除。');return true;
    }
    const next=list[index+1]||list[index-1];
    markClosed(id);markOpen(next.id);options.onOpen?.(String(next.id));
    return true;
  }

  function reorderVisible(dragId,targetId,side){
    const currentVisible=visible().map(item=>String(item.id));
    const from=currentVisible.indexOf(String(dragId));
    if(from<0)return false;
    currentVisible.splice(from,1);
    let to=currentVisible.indexOf(String(targetId));
    if(to<0)to=currentVisible.length;
    if(side==='after')to+=1;
    currentVisible.splice(Math.max(0,Math.min(currentVisible.length,to)),0,String(dragId));

    const visibleSet=new Set(currentVisible),allIds=all().map(item=>String(item.id));
    let cursor=0;
    const merged=allIds.map(id=>visibleSet.has(id)?currentVisible[cursor++]:id);
    options.onReorder?.(merged);
    options.onNotify?.('已调整画布页签顺序。');
    return true;
  }

  function dragSide(tab,clientX){
    const rect=tab.getBoundingClientRect();
    return clientX<rect.left+rect.width/2?'before':'after';
  }
  function clearDrag(){
    byId('qwWorkspaceTabs')?.querySelectorAll('.qw-workspace-tab').forEach(tab=>tab.classList.remove('is-dragging','drag-before','drag-after'));
  }

  function toggleList(){return false}

  function bind(){
    if(bound)return;bound=true;
    const host=byId('qwWorkspaceTabs');
    host?.addEventListener('click',event=>{
      const close=event.target.closest?.('[data-close-workspace-id]');
      if(close){event.stopPropagation();closeWorkspace(close.dataset.closeWorkspaceId);return}
      const tab=event.target.closest?.('[data-workspace-id]');
      if(tab)openWorkspace(tab.dataset.workspaceId);
    });
    host?.addEventListener('dblclick',event=>{
      const tab=event.target.closest?.('[data-workspace-id]');
      if(!tab||event.target.closest?.('.qw-workspace-tab-close'))return;
      event.preventDefault();openWorkspace(tab.dataset.workspaceId);options.onRename?.(String(tab.dataset.workspaceId));
    });
    host?.addEventListener('dragstart',event=>{
      const tab=event.target.closest?.('.qw-workspace-tab');
      if(!tab||event.target.closest?.('button'))return;
      tabDrag={id:String(tab.dataset.workspaceId||'')};
      tab.classList.add('is-dragging');
      event.dataTransfer?.setData('text/plain',tabDrag.id);
      if(event.dataTransfer)event.dataTransfer.effectAllowed='move';
    });
    host?.addEventListener('dragover',event=>{
      if(!tabDrag)return;
      const target=event.target.closest?.('.qw-workspace-tab');if(!target)return;
      event.preventDefault();clearDrag();
      const source=[...host.querySelectorAll('.qw-workspace-tab')].find(item=>String(item.dataset.workspaceId)===tabDrag.id);
      source?.classList.add('is-dragging');
      if(String(target.dataset.workspaceId)!==tabDrag.id)target.classList.add(dragSide(target,event.clientX)==='before'?'drag-before':'drag-after');
    });
    host?.addEventListener('drop',event=>{
      if(!tabDrag)return;
      const target=event.target.closest?.('.qw-workspace-tab');
      if(target){event.preventDefault();reorderVisible(tabDrag.id,target.dataset.workspaceId,dragSide(target,event.clientX))}
      tabDrag=null;clearDrag();
    });
    host?.addEventListener('dragend',()=>{tabDrag=null;clearDrag()});

    byId('qwCreateWorkspaceBtn')?.addEventListener('click',()=>{
      const created=options.onCreate?.();
      if(created?.id)markOpen(created.id);
    });
  }

  function forget(id){forgetClosed(id)}
  function reopen(id){markOpen(id);render()}
  function getState(){return {closed:[...readClosed()],activeWorkspaceId:active(),visible:visible().map(item=>String(item.id))}}

  bind();
  global.KGMultiQuestionWorkspaceTabs=Object.freeze({render,forget,reopen,getState});
})(window);
