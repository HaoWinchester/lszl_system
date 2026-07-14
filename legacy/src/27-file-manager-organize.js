'use strict';
/* v8.4.7 标签创建二级菜单延迟隐藏与内联管理。 */
(function(global){
  const store=global.KGGraphFileStore,$=id=>document.getElementById(id);
  let api=null,pickerItems=[],editingTagId='',createCloseTimer=null;

  const esc=value=>String(value??'').replace(/[&<>\'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const editIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>';
  const deleteIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m7 7 1 13h8l1-13"/><path d="M10 11v5M14 11v5"/></svg>';
  const checkIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7"/></svg>';
  const closeIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';

  function owner(){return api&&api.owner?api.owner():(store&&store.currentOwner?store.currentOwner():'guest')}
  function tags(){return store&&store.listTags?store.listTags({owner:owner()}):[]}
  function files(){return api&&api.files?api.files():[]}
  function notify(message,type='success'){if(api&&api.toast)api.toast(message,type)}
  function refresh(){if(api&&api.refresh)api.refresh()}
  function tagColor(name){const tag=tags().find(item=>item.name===name);return tag&&tag.color||'#64748b'}
  function searchTerm(){return $('fmTagSearchInput')?.value||''}

  function cancelCreateClose(){clearTimeout(createCloseTimer);createCloseTimer=null}
  function scheduleCreateClose(delay=300){cancelCreateClose();createCloseTimer=setTimeout(()=>setCreateOpen(false),delay)}
  function setCreateOpen(open){
    cancelCreateClose();const entry=$('fmTagCreateEntry'),button=$('fmQuickCreateTagBtn');
    if(entry)entry.classList.toggle('is-open',!!open);
    if(button)button.setAttribute('aria-expanded',String(!!open));
    if(open){editingTagId='';renderPicker(searchTerm())}
  }
  function closePicker(){const p=$('fmTagPicker');if(p)p.hidden=true;editingTagId='';setCreateOpen(false)}
  function closeAll(){closePicker()}
  function selectedFiles(){return pickerItems.filter(item=>item.kind==='file')}
  function currentTagName(){
    const selected=selectedFiles(),records=files();if(!selected.length)return'';
    const names=selected.map(item=>{const f=records.find(x=>x.id===item.id);return f&&f.tags&&f.tags[0]||''});
    return names.every(name=>name===names[0])?names[0]:null;
  }
  function applyTag(name){
    const selected=selectedFiles();if(!selected.length)return false;let ok=true;
    selected.forEach(item=>{if(!store.setFileTags(item.id,name?[name]:[],{owner:owner(),emit:false}))ok=false});
    if(!ok){notify(store.getLastError&&store.getLastError()||'标签更新失败。','error');return false}
    notify(name?`已标记为“${name}”，并加入我的收藏。`:'已取消标签，并退出我的收藏。');
    closePicker();refresh();return true;
  }

  function editPanelHtml(tag){
    return `<div class="fm-tag-inline-editor" data-tag-editor="${esc(tag.id)}">
      <div class="fm-tag-inline-fields">
        <input class="fm-tag-inline-name" maxlength="40" value="${esc(tag.name)}" aria-label="标签名称">
        <input class="fm-tag-inline-color" type="color" value="${esc(tag.color||'#64748b')}" aria-label="${esc(tag.name)}颜色">
        <button class="fm-tag-inline-save" type="button" data-tag-save="${esc(tag.id)}" aria-label="保存标签" title="保存">${checkIcon}</button>
        <button class="fm-tag-inline-cancel" type="button" data-tag-cancel aria-label="取消编辑" title="取消">${closeIcon}</button>
      </div>
    </div>`;
  }
  function choiceHtml({tag,active,empty=false}){
    const name=tag&&tag.name||'',color=tag&&tag.color||'#94a3b8';
    if(empty)return `<div class="fm-tag-choice-row is-none"><button type="button" class="fm-tag-choice${active?' is-active':''} is-none" data-tag-name=""><i style="--tag-color:${esc(color)}"></i><span>不打标签</span></button></div>`;
    const editing=editingTagId===tag.id;
    return `<div class="fm-tag-choice-row${editing?' is-editing':''}" data-tag-row="${esc(tag.id)}">
      <button type="button" class="fm-tag-choice${active?' is-active':''}" data-tag-name="${esc(name)}"><i style="--tag-color:${esc(color)}"></i><span>${esc(name)}</span></button>
      <div class="fm-tag-row-actions" aria-label="${esc(name)}标签操作">
        <button type="button" data-tag-edit="${esc(tag.id)}" aria-label="编辑${esc(name)}标签" title="编辑标签">${editIcon}</button>
        <button type="button" data-tag-delete="${esc(tag.id)}" class="is-danger" aria-label="删除${esc(name)}标签" title="删除标签">${deleteIcon}</button>
      </div>
      ${editing?editPanelHtml(tag):''}
    </div>`;
  }
  function renderPicker(query=''){
    const host=$('fmTagPickerList');if(!host)return;
    const current=currentTagName(),term=query.trim().toLowerCase(),all=tags().filter(tag=>tag.name.toLowerCase().includes(term));
    host.innerHTML=choiceHtml({tag:null,active:current==='',empty:true})+
      (all.length?all.map(tag=>choiceHtml({tag,active:current===tag.name})).join(''):'<p class="fm-organize-empty">没有匹配标签。</p>');
  }
  function positionPopover(pop,anchor){
    const rect=anchor&&anchor.getBoundingClientRect?anchor.getBoundingClientRect():{left:innerWidth/2,top:innerHeight/2,bottom:innerHeight/2};
    requestAnimationFrame(()=>{
      const r=pop.getBoundingClientRect();
      let left=Math.min(innerWidth-r.width-10,Math.max(10,rect.left));
      let top=Math.min(innerHeight-r.height-10,Math.max(10,rect.bottom+7));
      if(top<rect.bottom&&rect.top-r.height>8)top=rect.top-r.height-7;
      pop.style.left=left+'px';pop.style.top=top+'px';
      const entry=$('fmTagCreateEntry');if(entry)entry.classList.toggle('opens-left',left+r.width+250>innerWidth);
    });
  }
  function openTagPicker(items,anchor){
    pickerItems=(items||[]).filter(item=>item&&item.kind==='file');
    if(!pickerItems.length){notify('请选择至少一个图谱文件。','error');return}
    const search=$('fmTagSearchInput');if(search)search.value='';
    editingTagId='';setCreateOpen(false);renderPicker();
    const pop=$('fmTagPicker');pop.hidden=false;positionPopover(pop,anchor);
    setTimeout(()=>search&&search.focus(),0);
  }
  function createInlineTag(){
    const name=$('fmInlineTagName').value.trim(),color=$('fmInlineTagColor').value;
    if(!name){$('fmInlineTagName').focus();return}
    const created=store.createTag(name,color,{owner:owner()});
    if(!created){notify(store.getLastError&&store.getLastError()||'创建标签失败。','error');return}
    $('fmInlineTagName').value='';applyTag(created.name);
  }
  function beginEdit(id){
    editingTagId=id;setCreateOpen(false);renderPicker(searchTerm());
    setTimeout(()=>{const input=document.querySelector(`[data-tag-editor="${CSS.escape(id)}"] .fm-tag-inline-name`);if(input){input.focus();input.select()}},0);
  }
  function cancelEdit(){editingTagId='';renderPicker(searchTerm())}
  function saveEdit(id){
    const editor=document.querySelector(`[data-tag-editor="${CSS.escape(id)}"]`);if(!editor)return;
    const name=editor.querySelector('.fm-tag-inline-name').value.trim(),color=editor.querySelector('.fm-tag-inline-color').value;
    if(!name){editor.querySelector('.fm-tag-inline-name').focus();return}
    const updated=store.updateTag(id,{name,color},{owner:owner()});
    if(!updated){notify(store.getLastError&&store.getLastError()||'保存标签失败。','error');return}
    editingTagId='';notify('标签已更新。');refresh();renderPicker(searchTerm());
  }
  function removeTag(id){
    const tag=tags().find(item=>item.id===id);if(!tag)return;
    if(!confirm(`删除标签“${tag.name}”？相关文件将取消该标签并退出我的收藏。`))return;
    if(!store.deleteTag(id,{owner:owner()})){notify(store.getLastError&&store.getLastError()||'删除标签失败。','error');return}
    if(editingTagId===id)editingTagId='';
    notify('标签已删除。');refresh();renderPicker(searchTerm());
  }

  function init(options){
    api=options||{};
    $('fmTagPickerList')?.addEventListener('click',event=>{
      const edit=event.target.closest('[data-tag-edit]');if(edit){event.preventDefault();event.stopPropagation();beginEdit(edit.dataset.tagEdit);return}
      const del=event.target.closest('[data-tag-delete]');if(del){event.preventDefault();event.stopPropagation();removeTag(del.dataset.tagDelete);return}
      const save=event.target.closest('[data-tag-save]');if(save){event.preventDefault();event.stopPropagation();saveEdit(save.dataset.tagSave);return}
      if(event.target.closest('[data-tag-cancel]')){event.preventDefault();event.stopPropagation();cancelEdit();return}
      const button=event.target.closest('[data-tag-name]');if(button)applyTag(button.dataset.tagName||'');
    });
    $('fmTagPickerList')?.addEventListener('keydown',event=>{
      const editor=event.target.closest('.fm-tag-inline-editor');if(!editor)return;
      if(event.key==='Enter'&&event.target.classList.contains('fm-tag-inline-name')){event.preventDefault();saveEdit(editor.dataset.tagEditor)}
      else if(event.key==='Escape'){event.preventDefault();cancelEdit()}
    });
    $('fmTagSearchInput')?.addEventListener('input',event=>{editingTagId='';renderPicker(event.target.value)});
    $('fmQuickCreateTagBtn')?.addEventListener('click',event=>{event.preventDefault();setCreateOpen(!$('fmTagCreateEntry').classList.contains('is-open'));if($('fmTagCreateEntry').classList.contains('is-open'))setTimeout(()=>$('fmInlineTagName')?.focus(),0)});
    const createEntry=$('fmTagCreateEntry'),createSubmenu=$('fmTagCreateSubmenu');
    createEntry?.addEventListener('pointerenter',()=>setCreateOpen(true));
    createEntry?.addEventListener('pointerleave',()=>scheduleCreateClose(320));
    createSubmenu?.addEventListener('pointerenter',cancelCreateClose);
    createSubmenu?.addEventListener('pointerleave',()=>scheduleCreateClose(320));
    $('fmInlineTagCreateBtn')?.addEventListener('click',createInlineTag);
    $('fmInlineTagName')?.addEventListener('keydown',event=>{
      if(event.key==='Enter'){event.preventDefault();createInlineTag()}
      else if(event.key==='Escape'){event.preventDefault();setCreateOpen(false);$('fmQuickCreateTagBtn')?.focus()}
    });
    document.querySelectorAll('[data-close-organize]').forEach(button=>button.addEventListener('click',closeAll));
    document.addEventListener('pointerdown',event=>{
      if(!event.target.closest('#fmTagPicker,[data-menu-action="tags"],[data-info-action="tags"],#fmBatchTagBtn,[data-tag-file]'))closePicker();
    },{capture:true});
  }
  global.KGFileManagerOrganize={init,openTagPicker,tagColor,closeAll};
})(window);
