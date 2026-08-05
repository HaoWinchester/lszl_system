'use strict';
(function(global){
  let options={},bound=false,titleInput=null;
  let status={dirty:false,saving:false,lastError:''};
  const byId=id=>document.getElementById(id);
  function workspace(){return options.getWorkspace?.()||null}
  function shortTitle(value,limit=12){
    const chars=Array.from(String(value||''));
    return chars.slice(0,Math.max(1,Number(limit)||12)).join('');
  }
  function escapeHTML(value){
    return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function searchableNodes(){
    const current=workspace(),nodes=current?.nodes&&typeof current.nodes==='object'?Object.values(current.nodes):[];
    return nodes.map(node=>{
      const type=String(node?.nodeType||'')==='synthesis-card'?'归纳卡':'题目';
      const title=String(node?.title||node?.stemSummary||node?.questionId||'未命名');
      const detail=String(node?.nodeType==='synthesis-card'?(node?.content||''):(node?.stemSummary||node?.topic||''));
      const tags=Array.isArray(node?.tags)?node.tags.map(String):[];
      const haystack=[title,detail,node?.topic,node?.difficulty,node?.questionId,...tags].join(' ').toLowerCase();
      return {id:String(node?.id||''),type,title,detail,tags,haystack};
    }).filter(item=>item.id);
  }
  function closeSearch(){
    const panel=byId('qwWorkspaceGlobalSearchPanel');if(panel)panel.hidden=true;
    byId('qwWorkspaceGlobalSearchBtn')?.setAttribute('aria-expanded','false');
  }
  function renderSearchResults(query=''){
    const host=byId('qwWorkspaceGlobalSearchResults'),meta=byId('qwWorkspaceGlobalSearchMeta');if(!host)return [];
    const term=String(query||'').trim().toLowerCase();
    const all=searchableNodes();
    const items=(term?all.filter(item=>item.haystack.includes(term)):all).slice(0,40);
    if(meta)meta.textContent=term?`找到 ${items.length} 项 · 当前画布共 ${all.length} 张卡片`:`当前画布 · ${all.length} 张卡片`;
    host.innerHTML=items.length?items.map(item=>`<button type="button" class="qw-workspace-global-search-result" role="option" data-qw-search-node="${escapeHTML(item.id)}"><span class="kind">${escapeHTML(item.type)}</span><span class="copy"><strong>${escapeHTML(item.title)}</strong>${item.detail?`<small>${escapeHTML(item.detail)}</small>`:''}</span></button>`).join(''):'<div class="qw-workspace-global-search-empty">没有匹配内容。</div>';
    return items;
  }
  function positionSearchPanel(){
    const panel=byId('qwWorkspaceGlobalSearchPanel'),button=byId('qwWorkspaceGlobalSearchBtn');
    if(!panel||panel.hidden||!button)return false;
    const margin=10,rect=button.getBoundingClientRect();
    const viewportWidth=Math.max(320,global.innerWidth||document.documentElement.clientWidth||320);
    const viewportHeight=Math.max(320,global.innerHeight||document.documentElement.clientHeight||320);
    const width=Math.min(390,viewportWidth-margin*2);
    panel.style.width=width+'px';
    panel.style.maxWidth=width+'px';
    panel.style.left=Math.min(Math.max(margin,rect.right-width),Math.max(margin,viewportWidth-width-margin))+'px';
    panel.style.right='auto';
    panel.style.top=Math.min(rect.bottom+7,viewportHeight-120)+'px';
    requestAnimationFrame(()=>{
      if(panel.hidden)return;
      const measured=panel.getBoundingClientRect();
      let top=rect.bottom+7;
      if(top+measured.height>viewportHeight-margin)top=Math.max(margin,rect.top-measured.height-7);
      panel.style.top=Math.max(margin,Math.min(top,viewportHeight-measured.height-margin))+'px';
    });
    return true;
  }
  function openSearch(){
    const panel=byId('qwWorkspaceGlobalSearchPanel'),input=byId('qwWorkspaceGlobalSearchInput');if(!panel)return false;
    panel.hidden=false;byId('qwWorkspaceGlobalSearchBtn')?.setAttribute('aria-expanded','true');
    renderSearchResults(input?.value||'');positionSearchPanel();
    requestAnimationFrame(()=>{positionSearchPanel();input?.focus();input?.select?.()});
    return true;
  }
  function renderSaveState(next){
    if(next)status={...status,...next};
    const el=byId('qwWorkspaceSaveState');if(!el)return status;
    const saving=!!status.saving,dirty=!!status.dirty,error=!!status.lastError;
    el.classList.toggle('is-dirty',dirty&&!saving&&!error);
    el.classList.toggle('is-saving',saving);
    el.classList.toggle('is-error',error);
    el.disabled=saving;el.setAttribute('aria-busy',saving?'true':'false');
    const text=error?'保存失败':saving?'保存中':dirty?'有未保存修改':'已保存';
    el.setAttribute('aria-label',`立即保存。当前状态：${text}`);
    el.title=saving?'正在保存…':`${text}。点击立即保存（Ctrl+S / Command+S）`;
    const label=el.querySelector('.qw-workspace-save-state-text');if(label)label.textContent=text;
    return status;
  }
  const markDirty=()=>renderSaveState({dirty:true,saving:false,lastError:''});
  const markSaving=()=>renderSaveState({dirty:true,saving:true,lastError:''});
  const markSaved=()=>renderSaveState({dirty:false,saving:false,lastError:''});
  const markError=error=>renderSaveState({dirty:true,saving:false,lastError:String(error?.message||error||'保存失败')});
  function render(current=workspace()){
    const chip=byId('qwWorkspaceChip');if(!chip)return current;
    const title=String(current?.title||'未命名画布');
    chip.textContent=shortTitle(title,12);
    chip.dataset.fullTitle=title;
    chip.title=title+' · 双击修改画布名称';
    chip.setAttribute('aria-label',`当前画布：${title}。双击修改名称`);
    if(!byId('qwWorkspaceGlobalSearchPanel')?.hidden)renderSearchResults(byId('qwWorkspaceGlobalSearchInput')?.value||'');
    return current;
  }
  function finishTitleEdit(commit=true){
    const chip=titleInput;if(!chip)return null;titleInput=null;
    const original=String(chip.dataset.originalTitle||'');
    const value=String(chip.innerText||chip.textContent||'').trim();
    chip.removeAttribute('contenteditable');
    chip.classList.remove('is-inline-editing');
    chip.removeAttribute('data-original-title');
    if(!commit||!value||value===original){
      chip.textContent=original||workspace()?.title||'未命名画布';
      render();
      return null;
    }
    markSaving();
    try{
      const renamed=options.onRename?.(value);
      if(!renamed){markError('名称保存失败');render();return null}
      render(renamed);markSaved();
      options.onNotify?.('画布名称已保存。');
      return renamed;
    }catch(error){
      markError(error);render();options.onNotify?.('画布名称保存失败。');return null;
    }
  }
  function placeCaretAtEnd(element){
    try{
      const range=document.createRange(),selection=global.getSelection();
      range.selectNodeContents(element);range.collapse(false);
      selection.removeAllRanges();selection.addRange(range);
    }catch(e){}
  }
  function openTitleEdit(){
    const chip=byId('qwWorkspaceChip'),current=workspace();
    if(titleInput)return titleInput;
    if(options.canEdit&&!options.canEdit())return null;
    if(!chip||!current)return null;
    titleInput=chip;
    chip.dataset.originalTitle=String(current.title||chip.dataset.fullTitle||chip.textContent||'');
    chip.textContent=chip.dataset.originalTitle;
    chip.contentEditable='true';
    chip.classList.add('is-inline-editing');
    chip.focus();placeCaretAtEnd(chip);
    return chip;
  }
  async function manualSave(){
    if(status.saving)return false;markSaving();
    try{
      const saved=await options.onSave?.();
      if(!saved){markError('保存失败');options.onNotify?.('当前画布保存失败。');return false}
      render(saved===true?workspace():saved);markSaved();options.onNotify?.('当前画布已保存。');return true;
    }catch(error){markError(error);options.onNotify?.('当前画布保存失败。');return false}
  }
  function bind(){
    if(bound)return;bound=true;
    const chip=byId('qwWorkspaceChip');
    chip?.addEventListener('dblclick',event=>{event.preventDefault();event.stopPropagation();openTitleEdit()});
    chip?.addEventListener('keydown',event=>{
      if(!chip.isContentEditable)return;
      if(event.key==='Enter'){event.preventDefault();event.stopPropagation();finishTitleEdit(true)}
      else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finishTitleEdit(false)}
    });
    chip?.addEventListener('blur',()=>{if(chip.isContentEditable)finishTitleEdit(true)});
    byId('qwWorkspaceGlobalSearchBtn')?.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();
      const panel=byId('qwWorkspaceGlobalSearchPanel');
      if(panel?.hidden)openSearch();else closeSearch();
    });
    byId('qwWorkspaceGlobalSearchClose')?.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();closeSearch()});
    byId('qwWorkspaceGlobalSearchInput')?.addEventListener('input',event=>renderSearchResults(event.target.value));
    byId('qwWorkspaceGlobalSearchInput')?.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeSearch();byId('qwWorkspaceGlobalSearchBtn')?.focus()}});
    byId('qwWorkspaceGlobalSearchResults')?.addEventListener('click',event=>{
      const button=event.target.closest?.('[data-qw-search-node]');if(!button)return;
      const nodeId=String(button.dataset.qwSearchNode||'');
      global.KGMultiQuestionWorkspace?.selectNodes?.([nodeId]);
      global.KGMultiQuestionWorkspace?.focusNode?.(nodeId,{zoom:1});
      closeSearch();
    });
    document.addEventListener('pointerdown',event=>{
      const panel=byId('qwWorkspaceGlobalSearchPanel'),bar=byId('qwWorkspaceFilebar');
      if(panel&&!panel.hidden&&!bar?.contains(event.target))closeSearch();
    },true);
    global.addEventListener?.('resize',()=>{if(!byId('qwWorkspaceGlobalSearchPanel')?.hidden)positionSearchPanel()});
    global.addEventListener?.('scroll',()=>{if(!byId('qwWorkspaceGlobalSearchPanel')?.hidden)positionSearchPanel()},{passive:true,capture:true});
    byId('qwWorkspaceSaveState')?.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();manualSave()});
    document.addEventListener('keydown',event=>{
      if(!(event.ctrlKey||event.metaKey)||String(event.key||'').toLowerCase()!=='s')return;
      const target=event.target;if(target?.matches?.('input,textarea,select,[contenteditable="true"]'))return;
      event.preventDefault();manualSave();
    });
  }
  function configure(next={}){options={...options,...next};bind();render();renderSaveState();return api}
  function getStatus(){return {...status}}
  const api=Object.freeze({configure,render,renderSaveState,markDirty,markSaving,markSaved,markError,manualSave,openTitleEdit,openSearch,closeSearch,positionSearchPanel,renderSearchResults,shortTitle,getStatus});
  global.KGMultiQuestionWorkspaceFilebar=api;
})(window);
