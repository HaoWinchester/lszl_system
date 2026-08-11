'use strict';
(function(global){
  const byId=id=>document.getElementById(id);
  const escapeHTML=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const unique=values=>[...new Set((values||[]).map(String).filter(Boolean))];
  const Difficulty=global.KGDifficultyService||global.KGTeacherDomains?.DifficultyService||{};
  const Principles=global.KGPrincipleRepository;
  const Presets=global.KGSynthesisPresetRepository;
  let pickerDraft=new Set(),bulkDraft=new Set(),selectedPrincipleIds=new Set(),activePrincipleId='',draftPrincipleId='';

  function api(){return global.KGQuestionBankAdminAPI||{}}
  function toast(message){const node=byId('qbToast');if(!node)return;node.textContent=message;node.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove('show'),2200)}
  function legacyPrincipleNames(question={}){
    const metadata=question.metadata||{};
    const explicit=[question.principleTag,question.ruleTag,question.strategyTag,metadata.principleTag,metadata.ruleTag,metadata.strategyTag]
      .map(value=>String(value||'').trim()).filter(Boolean)
      .map(value=>value.replace(/^(?:原则|做题原则|原则标签|principle|rule|strategy)\s*[:：-]?\s*/i,'').trim());
    const tagged=(Array.isArray(question.tags)?question.tags:[]).map(value=>{
      if(value&&typeof value==='object'){
        const type=String(value.type||value.kind||value.category||'');
        return /principle|rule|strategy|原则|策略/i.test(type)?String(value.name||value.label||value.title||value.value||'').trim():'';
      }
      const text=String(value||'').trim();
      return /^(?:原则|做题原则|原则标签|principle|rule|strategy)\s*[:：-]/i.test(text)?text.replace(/^(?:原则|做题原则|原则标签|principle|rule|strategy)\s*[:：-]\s*/i,'').trim():'';
    });
    return unique([...explicit,...tagged].filter(Boolean));
  }
  function seedPrinciples(){
    const questions=api().getAllQuestions?.({includeDeleted:true})||[];
    const names=questions.flatMap(legacyPrincipleNames);
    Principles?.ensureFromLabels?.(names);
    return questions;
  }
  function currentPrincipleIds(){return unique(String(byId('questionPrincipleIdsInput')?.value||'').split(',').map(value=>value.trim()))}
  function setCurrentPrincipleIds(ids=[]){const next=unique(ids);if(byId('questionPrincipleIdsInput'))byId('questionPrincipleIdsInput').value=next.join(',');renderCurrentPrinciples()}
  function renderCurrentPrinciples(){
    const ids=currentPrincipleIds(),items=ids.map(id=>Principles?.get?.(id)).filter(Boolean),summary=byId('qbPrincipleSummary'),chips=byId('qbSelectedPrincipleChips');
    if(summary)summary.textContent=items.length?items.map(item=>item.name).join('、'):'未关联原则';
    if(chips)chips.innerHTML=items.length?items.map(item=>`<span class="qb-selected-chip">${escapeHTML(item.name)}<button type="button" data-remove-principle="${escapeHTML(item.id)}" aria-label="移除 ${escapeHTML(item.name)}">×</button></span>`).join(''):'';
  }
  function renderStarRating(){
    const value=Difficulty.normalize?.(byId('questionDifficultyInput')?.value)||'';
    const rank={easy:1,medium:2,hard:3}[value]||0;
    byId('questionDifficultyStars')?.querySelectorAll('[data-difficulty]').forEach(button=>{const target={easy:1,medium:2,hard:3}[button.dataset.difficulty]||0;button.classList.toggle('active',target>0&&target<=rank);button.setAttribute('aria-checked',String(target===rank))});
  }
  function setDifficulty(value){const select=byId('questionDifficultyInput');if(!select)return;select.value=Difficulty.normalize?.(value)||'';select.dispatchEvent(new Event('change',{bubbles:true}));renderStarRating()}
  function principleOptionsMarkup(selected=new Set()){
    const items=Principles?.list?.()||[];
    return items.length?items.map(item=>`<label><input type="checkbox" value="${escapeHTML(item.id)}" ${selected.has(item.id)?'checked':''}/><span>${escapeHTML(item.name)}</span></label>`).join(''):'<div class="qb-empty">还没有原则。请先到训练配置创建。</div>';
  }
  function openPicker(){pickerDraft=new Set(currentPrincipleIds());const wrap=byId('qbPrinciplePickerOptions');if(wrap)wrap.innerHTML=principleOptionsMarkup(pickerDraft);const dialog=byId('qbPrinciplePickerDialog');dialog?.showModal?dialog.showModal():dialog?.setAttribute('open','')}
  function openBulkPrinciples(){bulkDraft=new Set();const wrap=byId('qbBulkPrincipleOptions');if(wrap)wrap.innerHTML=principleOptionsMarkup(bulkDraft);const dialog=byId('qbBulkPrincipleDialog');dialog?.showModal?dialog.showModal():dialog?.setAttribute('open','')}
  function selectedFromWrap(id){return [...(byId(id)?.querySelectorAll('input[type="checkbox"]:checked')||[])].map(input=>String(input.value||''))}
  function questionMatchesPrinciple(question,item){
    const ids=unique(question.metadata?.principleIds||question.principleIds||[]);
    return ids.includes(String(item?.id||''))||legacyPrincipleNames(question).includes(String(item?.name||''));
  }
  function questionCountByPrinciple(id,questions){const item=Principles?.get?.(id);return questions.filter(question=>questionMatchesPrinciple(question,item)).length}
  function renderPrincipleList(){
    const list=byId('tqPrincipleList');if(!list)return;
    const questions=seedPrinciples(),items=Principles?.list?.({includeInactive:true})||[];
    const availableIds=new Set(items.map(item=>item.id));
    selectedPrincipleIds=new Set([...selectedPrincipleIds].filter(id=>availableIds.has(id)));
    if(activePrincipleId!==draftPrincipleId&&!availableIds.has(activePrincipleId))activePrincipleId='';
    if(!activePrincipleId&&items[0])activePrincipleId=items[0].id;
    const selectAll=byId('tqSelectAllPrinciples');if(selectAll){selectAll.checked=items.length>0&&items.every(item=>selectedPrincipleIds.has(item.id));selectAll.indeterminate=selectedPrincipleIds.size>0&&selectedPrincipleIds.size<items.length}
    list.innerHTML=items.length?items.map(item=>{
      const linked=questions.filter(question=>questionMatchesPrinciple(question,item));
      const counts={easy:0,medium:0,hard:0};linked.forEach(question=>{const key=Difficulty.normalize?.(question.difficulty)||'';if(counts[key]!==undefined)counts[key]+=1});
      const preset=Presets?.getByPrincipleId?.(item.id)||null;
      return `<div class="tq-principle-row ${item.id===activePrincipleId?'active':''}"><label class="tq-principle-select"><input type="checkbox" data-principle-select="${escapeHTML(item.id)}" ${selectedPrincipleIds.has(item.id)?'checked':''} aria-label="选择原则 ${escapeHTML(item.name)}"/></label><button type="button" class="tq-principle-open" data-principle-id="${escapeHTML(item.id)}"><strong>${escapeHTML(item.name)}</strong><span>题目 ${linked.length} · ★ ${counts.easy} · ★★ ${counts.medium} · ★★★ ${counts.hard}</span><small>${preset?.status==='active'?'预设已启用':preset?'预设草稿':'未配置预设'}${item.status==='inactive'?' · 已停用':''}</small></button></div>`;
    }).join(''):'<div class="qb-empty">尚未创建原则。</div>';
    fillPrincipleEditor(activePrincipleId);
  }
  function fillPrincipleEditor(id){
    const isDraft=!!id&&id===draftPrincipleId;
    const item=Principles?.get?.(id)||null,preset=item?Presets?.getByPrincipleId?.(item.id):null;
    activePrincipleId=item?.id||(isDraft?id:'');
    if(byId('tqPrincipleId'))byId('tqPrincipleId').value=item?.id||(isDraft?id:'');
    if(byId('tqPrincipleName'))byId('tqPrincipleName').value=item?.name||'';
    if(byId('tqPrincipleStatus'))byId('tqPrincipleStatus').value=item?.status||'active';
    if(byId('tqPresetId'))byId('tqPresetId').value=preset?.id||'';
    if(byId('tqPresetTitle'))byId('tqPresetTitle').value=item?'原则：'+item.name:'';
    if(byId('tqPresetContent'))byId('tqPresetContent').value=preset?.content||'';
    if(byId('tqPresetStatus'))byId('tqPresetStatus').value=preset?.status||'draft';
    const confusable=byId('tqConfusablePrinciples');if(confusable){
      const selected=new Set(item?.confusablePrincipleIds||[]),others=(Principles?.list?.()||[]).filter(candidate=>candidate.id!==item?.id);
      confusable.innerHTML=item&&others.length?others.map(candidate=>`<label><input type="checkbox" value="${escapeHTML(candidate.id)}" ${selected.has(candidate.id)?'checked':''}/><span>${escapeHTML(candidate.name)}</span></label>`).join(''):'<small>创建多个原则后可选择易混淆原则。</small>';
    }
  }
  function savePrinciple(){
    const name=String(byId('tqPrincipleName')?.value||'').trim();if(!name)return toast('请输入原则名称。');
    const id=String(byId('tqPrincipleId')?.value||'');
    const principleStatus=byId('tqPrincipleStatus')?.value||'active';
    const confusable=[...(byId('tqConfusablePrinciples')?.querySelectorAll('input:checked')||[])].map(input=>input.value);
    // Capture preset values before repository events rerender the editor.
    const presetId=String(byId('tqPresetId')?.value||'');
    const presetContent=String(byId('tqPresetContent')?.value||'').trim();
    const presetStatus=byId('tqPresetStatus')?.value||'draft';
    const item=Principles?.upsert?.({id,name,status:principleStatus,confusablePrincipleIds:confusable});if(!item)return toast('原则保存失败。');
    Presets?.upsert?.({id:presetId,principleId:item.id,title:'原则：'+item.name,content:presetContent,status:presetStatus});
    draftPrincipleId='';activePrincipleId=item.id;renderPrincipleList();toast('原则与系统预设归纳卡已保存。');
  }
  function newPrinciple(){draftPrincipleId='principle-draft-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);activePrincipleId=draftPrincipleId;fillPrincipleEditor(draftPrincipleId);byId('tqPrincipleName')?.focus()}
  function selectedPrinciples(){return [...selectedPrincipleIds]}
  async function postPrincipleOperation(path,body){
    await global.KGServerStateStorage?.flush?.();
    const response=await global.fetch(path,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    let payload={};try{payload=await response.json()}catch(error){}
    if(!response.ok){const detail=payload?.detail||payload;const error=new Error(detail?.message||'操作失败');error.detail=detail;throw error}
    await global.KGServerStateStorage?.refresh?.();
    return payload;
  }
  async function applySelectedPresetStatus(){
    const ids=selectedPrinciples(),status=String(byId('tqBulkPresetStatus')?.value||'draft');
    if(!ids.length)return toast('请先勾选要修改的原则。');
    try{await postPrincipleOperation('/api/v1/content-prep/principles/status',{ids,presetStatus:status});renderPrincipleList();toast(`已更新 ${ids.length} 条原则的预设状态。`)}catch(error){toast(error?.message||'批量修改预设状态失败。')}
  }
  async function archiveSelectedPrinciples(){
    const ids=selectedPrinciples();if(!ids.length)return toast('请先勾选要归档的原则。');
    if(!global.confirm?.(`确定归档所选 ${ids.length} 条原则及其系统归纳卡吗？已被题目引用的原则不会被归档。`))return;
    try{await postPrincipleOperation('/api/v1/content-prep/principles/archive',{ids});selectedPrincipleIds.clear();renderPrincipleList();toast(`已归档 ${ids.length} 条原则及其系统归纳卡。`)}catch(error){const counts=error?.detail?.referenceCounts||{};const total=Object.values(counts).reduce((sum,value)=>sum+Number(value||0),0);toast(total?`所选原则仍被 ${total} 道题引用，请先解除或重新绑定。`:error?.message||'归档失败。')}
  }
  function bind(){
    seedPrinciples();
    byId('questionDifficultyStars')?.addEventListener('click',event=>{const button=event.target.closest('[data-difficulty]');if(button)setDifficulty(button.dataset.difficulty)});
    byId('qbPrinciplePickerBtn')?.addEventListener('click',openPicker);
    byId('qbSelectedPrincipleChips')?.addEventListener('click',event=>{const button=event.target.closest('[data-remove-principle]');if(button)setCurrentPrincipleIds(currentPrincipleIds().filter(id=>id!==button.dataset.removePrinciple))});
    byId('qbPrinciplePickerConfirmBtn')?.addEventListener('click',()=>{setCurrentPrincipleIds(selectedFromWrap('qbPrinciplePickerOptions'));byId('qbPrinciplePickerDialog')?.close()});
    byId('qbPrinciplePickerManageBtn')?.addEventListener('click',()=>{location.href='question-bank.html?mode=simple&step=training&section=principles'});
    byId('qbBulkDifficultyBtn')?.addEventListener('click',()=>{const dialog=byId('qbBulkDifficultyDialog');dialog?.showModal?dialog.showModal():dialog?.setAttribute('open','')});
    byId('qbBulkDifficultyDialog')?.addEventListener('click',event=>{const button=event.target.closest('[data-bulk-difficulty]');if(!button)return;const response=api().bulkPatchSelectedQuestions?.({difficulty:button.dataset.bulkDifficulty});if(response?.valid){byId('qbBulkDifficultyDialog')?.close();toast(`已为 ${response.updated} 道题设置难度。`)}else toast(response?.error||'请先选择题目。')});
    byId('qbBulkPrinciplesBtn')?.addEventListener('click',openBulkPrinciples);
    byId('qbBulkPrincipleConfirmBtn')?.addEventListener('click',()=>{const ids=selectedFromWrap('qbBulkPrincipleOptions');const response=api().bulkPatchSelectedQuestions?.({principleIds:ids});if(response?.valid){byId('qbBulkPrincipleDialog')?.close();toast(`已更新 ${response.updated} 道题的原则关联。`)}else toast(response?.error||'请先选择题目。')});
    byId('tqPrincipleList')?.addEventListener('change',event=>{const checkbox=event.target.closest('[data-principle-select]');if(!checkbox)return;const id=checkbox.dataset.principleSelect;if(checkbox.checked)selectedPrincipleIds.add(id);else selectedPrincipleIds.delete(id);renderPrincipleList()});
    byId('tqPrincipleList')?.addEventListener('click',event=>{const row=event.target.closest('[data-principle-id]');if(!row)return;draftPrincipleId='';activePrincipleId=row.dataset.principleId;renderPrincipleList()});
    byId('tqSelectAllPrinciples')?.addEventListener('change',event=>{const ids=(Principles?.list?.({includeInactive:true})||[]).map(item=>item.id);selectedPrincipleIds=event.target.checked?new Set(ids):new Set();renderPrincipleList()});
    byId('tqApplyPresetStatusBtn')?.addEventListener('click',()=>{applySelectedPresetStatus()});
    byId('tqArchiveSelectedPrinciplesBtn')?.addEventListener('click',()=>{archiveSelectedPrinciples()});
    byId('tqNewPrincipleBtn')?.addEventListener('click',newPrinciple);byId('tqSavePrincipleBtn')?.addEventListener('click',savePrinciple);
    byId('tqPrincipleName')?.addEventListener('input',()=>{if(byId('tqPresetTitle'))byId('tqPresetTitle').value='原则：'+String(byId('tqPrincipleName').value||'').trim()});
    document.addEventListener('kg-question-form-filled',event=>{const question=event.detail?.question||{};let ids=unique(question.metadata?.principleIds||question.principleIds||[]);if(!ids.length){const created=legacyPrincipleNames(question).map(name=>Principles?.findByName?.(name)||Principles?.upsert?.({name})).filter(Boolean);ids=created.map(item=>item.id)}setCurrentPrincipleIds(ids);if(byId('questionDifficultyInput'))byId('questionDifficultyInput').value=Difficulty.normalize?.(question.difficulty)||'';renderStarRating();renderPrincipleList()});
    global.addEventListener('kg:principles-changed',()=>{renderCurrentPrinciples();renderPrincipleList()});
    renderStarRating();renderCurrentPrinciples();renderPrincipleList();
    const requested=new URLSearchParams(location.search).get('section');if(requested==='principles')setTimeout(()=>document.querySelector('[data-annotation-tab="principles"]')?.click(),80);
  }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(bind,0));
})(globalThis);
