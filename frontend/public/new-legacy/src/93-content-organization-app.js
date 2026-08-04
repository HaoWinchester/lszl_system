'use strict';

(function(){
  const Core=window.KGLearningContent;
  const Org=window.KGContentOrganization;
  const Center=()=>window.KGContentCenterApp;
  if(!Core||!Org)return;
  const $=id=>document.getElementById(id);
  const clean=value=>String(value??'').trim();
  const escapeHTML=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  let metaTargets=[],collectionTargets=[];

  function subjectId(){return Center()?.getSubjectId?.()||'subject-pmp'}
  function notify(message){Center()?.toast?.(message)}
  function renderSummary(){
    const summary=Org.summary();const el=$('ccOrganizationSummary');if(!el)return;
    el.innerHTML=`<span>标签 ${summary.tags}</span><span>题集 ${summary.collections}</span><span>收藏 ${summary.favorites}</span><span>试卷 ${summary.papers}</span><span>学习任务 ${summary.tasks}</span>`;
  }
  function renderTags(){
    const list=Org.getTags({subjectId:subjectId()});const box=$('ccTagList');if(!box)return;
    box.innerHTML=list.length?list.map(tag=>`<article class="cc-org-item"><div><strong>${escapeHTML(tag.name)}</strong><small>${escapeHTML(tag.description||'无说明')}</small></div><div><button type="button" data-filter-tag="${escapeHTML(tag.id)}">筛选</button><button type="button" data-edit-tag="${escapeHTML(tag.id)}">编辑</button><button type="button" class="danger" data-delete-tag="${escapeHTML(tag.id)}">删除</button></div></article>`).join(''):'<div class="cc-empty small">还没有标签。</div>';
  }
  function renderCollections(){
    const list=Org.getCollections({subjectId:subjectId()});const box=$('ccCollectionList');if(!box)return;
    box.innerHTML=list.length?list.map(item=>`<article class="cc-org-item"><div><strong>${escapeHTML(item.title)}</strong><small>${item.type==='favorites'?'系统收藏夹':escapeHTML(item.description||'普通题集')} · ${item.activityIds.length} 项</small></div><div><button type="button" data-open-collection="${escapeHTML(item.id)}">查看</button>${item.type==='favorites'?'':`<button type="button" data-edit-collection="${escapeHTML(item.id)}">编辑</button><button type="button" class="danger" data-delete-collection="${escapeHTML(item.id)}">删除</button>`}</div></article>`).join(''):'<div class="cc-empty small">还没有题集。</div>';
  }
  function render(){renderSummary();renderTags();renderCollections()}

  function openTag(tagId=''){
    const tag=Org.getTags().find(item=>item.id===tagId)||null;
    $('ccTagDialogTitle').textContent=tag?'编辑标签':'新建标签';$('ccTagId').value=tag?.id||'';$('ccTagName').value=tag?.name||'';$('ccTagDescription').value=tag?.description||'';$('ccTagDialog').showModal();requestAnimationFrame(()=>$('ccTagName').focus());
  }
  function saveTag(){
    const name=clean($('ccTagName').value);if(!name)return notify('请输入标签名称。');
    const existing=Org.getTags().find(item=>item.id===$('ccTagId').value)||{};const result=Org.saveTag({...existing,id:$('ccTagId').value||undefined,name,description:clean($('ccTagDescription').value),subjectId:subjectId()});
    if(!result.valid)return notify('标签保存失败。');$('ccTagDialog').close();render();Center()?.rerender?.();notify('标签已保存。');
  }
  function removeTag(id){
    const tag=Org.getTags().find(item=>item.id===id);if(!tag)return;if(!confirm(`删除标签“${tag.name}”？`))return;const result=Org.deleteTag(id);if(!result.valid)return notify(result.errors.join('；'));const filter=$('ccTagFilter');if(filter?.value===id){filter.value='';filter.dispatchEvent(new Event('change'))}render();Center()?.rerender?.();notify('标签已删除。');
  }

  function openMeta(ids){
    if(!ids?.length)return notify('请先选择活动。');metaTargets=[...ids];$('ccMetaTargetInfo').textContent=`将为 ${ids.length} 个活动设置属性。留空的字段保持不变。`;$('ccMetaDifficulty').value='';$('ccMetaTime').value='';$('ccMetaReview').value='';$('ccMetaTagMode').value='add';document.querySelectorAll('[data-meta-purpose]').forEach(input=>input.checked=false);
    const tags=Org.getTags({subjectId:subjectId(),status:'active'});$('ccMetaTags').innerHTML=tags.length?tags.map(tag=>`<label><input type="checkbox" value="${escapeHTML(tag.id)}" data-meta-tag />${escapeHTML(tag.name)}</label>`).join(''):'<span class="cc-muted">暂无标签，可先在下方创建。</span>';
    $('ccMetaDialog').showModal();
  }
  function saveMeta(){
    const patch={};const difficulty=$('ccMetaDifficulty').value,time=clean($('ccMetaTime').value),reviewStatus=$('ccMetaReview').value;
    if(difficulty)patch.difficulty=difficulty;if(time!=='')patch.estimatedTimeSeconds=Math.max(0,Number(time)||0);if(reviewStatus)patch.reviewStatus=reviewStatus;
    const purposes=[...document.querySelectorAll('[data-meta-purpose]:checked')].map(input=>input.value);if(purposes.length)patch.usagePurposes=purposes;
    const tagIds=[...document.querySelectorAll('[data-meta-tag]:checked')].map(input=>input.value),tagMode=$('ccMetaTagMode').value;if(tagIds.length){if(tagMode==='remove')patch.removeTagIds=tagIds;else if(tagMode==='replace')patch.tagIds=tagIds;else patch.addTagIds=tagIds}
    if(!Object.keys(patch).length)return notify('请至少设置一个属性。');const result=Org.updateActivityOrganization(metaTargets,patch);if(!result.valid)return notify('部分活动保存失败。');$('ccMetaDialog').close();Center()?.clearSelection?.();render();notify(`已更新 ${metaTargets.length} 个活动。`);
  }

  function openCollection(ids){
    if(!ids?.length)return notify('请先选择活动。');collectionTargets=[...ids];$('ccCollectionTargetInfo').textContent=`将 ${ids.length} 个活动加入题集。`;
    const list=Org.getCollections({subjectId:subjectId(),status:'active'}).filter(item=>item.type==='collection');$('ccCollectionSelect').innerHTML='<option value="">请选择现有题集</option>'+list.map(item=>`<option value="${escapeHTML(item.id)}">${escapeHTML(item.title)}（${item.activityIds.length}）</option>`).join('');$('ccCollectionNewTitle').value='';$('ccCollectionNewDescription').value='';$('ccCollectionDialog').showModal();
  }
  function confirmCollection(){
    let id=$('ccCollectionSelect').value;const title=clean($('ccCollectionNewTitle').value);
    if(title){const result=Org.saveCollection({title,description:clean($('ccCollectionNewDescription').value),subjectId:subjectId(),type:'collection',activityIds:[]});if(!result.valid)return notify('题集创建失败。');id=result.collection.id}
    if(!id)return notify('请选择题集，或输入新题集名称。');const result=Org.addActivitiesToCollection(id,collectionTargets);if(!result.valid)return notify(result.errors?.join('；')||'加入题集失败。');$('ccCollectionDialog').close();Center()?.clearSelection?.();render();notify(`已将 ${collectionTargets.length} 个活动加入题集。`);
  }
  function newCollection(){
    collectionTargets=[];$('ccCollectionTargetInfo').textContent='创建一个空题集，稍后可从活动库批量加入。';
    const list=Org.getCollections({subjectId:subjectId(),status:'active'}).filter(item=>item.type==='collection');$('ccCollectionSelect').innerHTML='<option value="">不选择现有题集</option>'+list.map(item=>`<option value="${escapeHTML(item.id)}">${escapeHTML(item.title)}（${item.activityIds.length}）</option>`).join('');$('ccCollectionSelect').value='';$('ccCollectionNewTitle').value='';$('ccCollectionNewDescription').value='';$('ccCollectionDialog').showModal();requestAnimationFrame(()=>$('ccCollectionNewTitle').focus());
  }
  function editCollection(id){
    const item=Org.getCollections().find(collection=>collection.id===id);if(!item)return;const title=prompt('题集名称',item.title);if(title===null)return;const description=prompt('题集说明',item.description||'');if(description===null)return;Org.saveCollection({...item,title:clean(title)||item.title,description:clean(description)});render();Center()?.rerender?.();notify('题集已更新。');
  }
  function removeCollection(id){const item=Org.getCollections().find(collection=>collection.id===id);if(!item)return;if(!confirm(`删除题集“${item.title}”？不会删除原活动。`))return;const result=Org.deleteCollection(id);if(!result.valid)return notify(result.errors.join('；'));Center()?.setCollectionFilter?.('');render();Center()?.rerender?.();notify('题集已删除。')}
  function createEmptyCollection(){
    const title=clean($('ccCollectionNewTitle').value);if(!title)return notify('请输入新题集名称。');const result=Org.saveCollection({title,description:clean($('ccCollectionNewDescription').value),subjectId:subjectId(),type:'collection',activityIds:collectionTargets});$('ccCollectionDialog').close();render();Center()?.rerender?.();notify(collectionTargets.length?'题集已创建并加入活动。':'空题集已创建。');return result;
  }

  function createPaperFromActivities(ids){
    if(!ids?.length)return notify('请先选择活动。');const title=prompt('请输入试卷名称','新建手动试卷');if(title===null)return;
    const paper=Org.normalizePaper({title:clean(title)||'新建手动试卷',subjectId:subjectId(),sections:[{title:'试题',items:ids.map((activityId,index)=>({activityId,score:1,order:index+1}))}]});const result=Org.savePaper(paper);if(!result.valid)return notify(result.errors.join('；'));location.href=`paper-management.html&paper=${encodeURIComponent(result.paper.id)}`;
  }

  function bind(){
    $('ccNewTagBtn')?.addEventListener('click',()=>openTag());$('ccSaveTagBtn')?.addEventListener('click',saveTag);$('ccConfirmMetaBtn')?.addEventListener('click',saveMeta);$('ccConfirmCollectionBtn')?.addEventListener('click',()=>{if(!$('ccCollectionSelect').value&&clean($('ccCollectionNewTitle').value))return createEmptyCollection();confirmCollection()});$('ccNewCollectionBtn')?.addEventListener('click',newCollection);
    $('ccTagList')?.addEventListener('click',event=>{const filter=event.target.closest('[data-filter-tag]');if(filter){$('ccTagFilter').value=filter.dataset.filterTag;$('ccTagFilter').dispatchEvent(new Event('change'));return}const edit=event.target.closest('[data-edit-tag]');if(edit)return openTag(edit.dataset.editTag);const remove=event.target.closest('[data-delete-tag]');if(remove)removeTag(remove.dataset.deleteTag)});
    $('ccCollectionList')?.addEventListener('click',event=>{const open=event.target.closest('[data-open-collection]');if(open)return Center()?.setCollectionFilter?.(open.dataset.openCollection);const edit=event.target.closest('[data-edit-collection]');if(edit)return editCollection(edit.dataset.editCollection);const remove=event.target.closest('[data-delete-collection]');if(remove)removeCollection(remove.dataset.deleteCollection)});
  }

  window.KGContentOrganizationUI=Object.freeze({render,openMeta,openCollection,createPaperFromActivities});
  document.addEventListener('DOMContentLoaded',()=>{bind();render()});
})();
