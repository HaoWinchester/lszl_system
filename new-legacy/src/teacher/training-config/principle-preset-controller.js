'use strict';
(function(global){
  const byId=id=>document.getElementById(id);
  const escapeHTML=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const unique=values=>[...new Set((values||[]).map(String).filter(Boolean))];
  const Difficulty=global.KGDifficultyService||global.KGTeacherDomains?.DifficultyService||{};
  const Principles=global.KGPrincipleRepository;
  const Presets=global.KGSynthesisPresetRepository;
  const PrincipleBinding=global.KGQuestionPrincipleBinding||{};
  let pickerDraft=new Set(),bulkDraft=new Set(),selectedPrincipleIds=new Set(),activePrincipleId='',draftPrincipleId='',principleOpenClickTimer=0;

  function api(){return global.KGQuestionBankAdminAPI||{}}
  function toast(message){const node=byId('qbToast');if(!node)return;node.textContent=message;node.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove('show'),2200)}
  function displayQuestionType(value){const types={single_choice:'单选题',multiple_choice:'多选题',judgment:'判断题',case:'案例题'};return types[String(value||'')]||'题目'}
  function displayDifficulty(value){const levels={easy:'★',medium:'★★',hard:'★★★',基础:'★',中等:'★★',重点:'★★',困难:'★★★'};return levels[String(value||'')]||''}
  function closeDialog(id){const dialog=byId(id);if(dialog?.open)dialog.close();else dialog?.removeAttribute('open')}
  function showDialog(id){const dialog=byId(id);if(!dialog)return false;if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');return true}
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
  function ensurePairedPresets(){
    const created=[];
    (Principles?.list?.({includeInactive:true})||[]).forEach(principle=>{
      if(Presets?.getByPrincipleId?.(principle.id))return;
      const preset=Presets?.upsert?.({id:'preset-'+principle.id,principleId:principle.id,title:'原则：'+principle.name,content:'',status:'draft'});
      if(preset)created.push(preset);
    });
    return created;
  }
  function projectionItems(payload,label){
    if(!payload||typeof payload!=='object'||!Array.isArray(payload.items))throw new Error(`${label}必须包含 items 数组。`);
    return payload.items;
  }
  function normalizePrincipleCardBundle(payload={}){
    if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Error('原则与归纳卡组合必须是 JSON 对象。');
    if(payload.principleCardBundleVersion!==undefined&&Number(payload.principleCardBundleVersion)!==1)throw new Error('原则与归纳卡组合版本必须是 1。');
    if(payload.format&&payload.format!=='kg-principle-card-bundle-v1')throw new Error('不是支持的原则与归纳卡组合文件。');
    const timestamp=Date.now(),principleIds=new Set(),presetIds=new Set(),presetPrincipleIds=new Set();
    const principles=projectionItems(payload.principles||payload.principleRepository,'原则').map((raw,index)=>{
      const id=String(raw?.id||'').trim(),name=String(raw?.name||raw?.title||'').trim();
      if(!id||!name)throw new Error(`第 ${index+1} 条原则缺少 ID 或名称。`);
      if(principleIds.has(id))throw new Error(`原则 ID 重复：${id}`);principleIds.add(id);
      const confusablePrincipleIds=Array.isArray(raw?.confusablePrincipleIds)?raw.confusablePrincipleIds:[];
      return {id,name,status:String(raw?.status||'active')==='inactive'?'inactive':'active',confusablePrincipleIds:unique(confusablePrincipleIds),createdAt:Number(raw?.createdAt||timestamp),updatedAt:Number(raw?.updatedAt||timestamp)};
    });
    const namesById=new Map(principles.map(item=>[item.id,item.name]));
    const synthesisPresets=projectionItems(payload.synthesisPresets||payload.presets||payload.synthesisPresetRepository,'归纳卡').map((raw,index)=>{
      const id=String(raw?.id||'').trim(),principleId=String(raw?.principleId||'').trim();
      if(!id||!principleId)throw new Error(`第 ${index+1} 张归纳卡缺少 ID 或原则。`);
      if(!namesById.has(principleId))throw new Error(`归纳卡引用了不存在的原则：${principleId}`);
      if(presetIds.has(id))throw new Error(`归纳卡 ID 重复：${id}`);
      if(presetPrincipleIds.has(principleId))throw new Error(`原则 ${principleId} 存在重复归纳卡。`);
      presetIds.add(id);presetPrincipleIds.add(principleId);
      const status=String(raw?.status||'draft');
      return {id,principleId,title:'原则：'+namesById.get(principleId),content:String(raw?.content||raw?.description||'').trim(),status:['draft','active','inactive'].includes(status)?status:'draft',version:Math.max(1,Number(raw?.version||1)),createdAt:Number(raw?.createdAt||timestamp),updatedAt:Number(raw?.updatedAt||timestamp)};
    });
    principles.forEach(principle=>{if(!presetPrincipleIds.has(principle.id))throw new Error(`原则 ${principle.id} 缺少对应归纳卡。`)});
    return {principles:{schemaVersion:1,items:principles,updatedAt:timestamp},synthesisPresets:{schemaVersion:1,items:synthesisPresets,updatedAt:timestamp}};
  }
  function currentPrincipleCardBundle(){
    ensurePairedPresets();
    const pair=normalizePrincipleCardBundle({principles:{schemaVersion:1,items:Principles?.list?.({includeInactive:true})||[]},synthesisPresets:{schemaVersion:1,items:Presets?.list?.({includeInactive:true})||[]}});
    return {principleCardBundleVersion:1,format:'kg-principle-card-bundle-v1',generatedBy:'KG Teacher Training Configuration',generatedAt:new Date().toISOString(),...pair};
  }
  function applyPrincipleCardBundle(payload={}){
    const pair=normalizePrincipleCardBundle(payload);
    Principles?.replaceAll?.(pair.principles);Presets?.replaceAll?.(pair.synthesisPresets);
    return pair;
  }
  function downloadPrincipleCardBundle(payload){
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download='kg_principle_card_bundle_v1.json';document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
  }
  function readJsonFile(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>{try{resolve(JSON.parse(String(reader.result||'').replace(/^\ufeff/,'')))}catch(error){reject(error)}};reader.onerror=()=>reject(reader.error||new Error('读取文件失败。'));reader.readAsText(file,'utf-8')})}
  function currentQuestionOptionIds(){return (api().getCurrentQuestion?.()?.options||[]).map(option=>String(option?.id||'').trim()).filter(Boolean)}
  function currentOptionPrincipleMap(){try{const value=JSON.parse(String(byId('questionOptionPrincipleMapInput')?.value||'{}'));return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch(error){return {}}}
  function currentPrincipleBindings(){
    const stem=String(byId('questionStemPrincipleIdsInput')?.value||'').split(',').map(value=>value.trim()).filter(Boolean);
    const optionIds=currentQuestionOptionIds();
    return PrincipleBinding.normalize?.({stemPrincipleIds:stem,optionPrincipleMap:currentOptionPrincipleMap()},optionIds)||{stemPrincipleIds:unique(stem),optionPrincipleMap:currentOptionPrincipleMap(),principleIds:unique(stem)};
  }
  function currentPrincipleIds(){return currentPrincipleBindings().stemPrincipleIds||[]}
  function setCurrentPrincipleIds(ids=[]){
    const bindings=currentPrincipleBindings();
    const next=PrincipleBinding.normalize?.({...bindings,stemPrincipleIds:unique(ids)},currentQuestionOptionIds())||{...bindings,stemPrincipleIds:unique(ids),principleIds:unique(ids)};
    if(byId('questionStemPrincipleIdsInput'))byId('questionStemPrincipleIdsInput').value=(next.stemPrincipleIds||[]).join(',');
    if(byId('questionOptionPrincipleMapInput'))byId('questionOptionPrincipleMapInput').value=JSON.stringify(next.optionPrincipleMap||{});
    if(byId('questionPrincipleIdsInput'))byId('questionPrincipleIdsInput').value=(next.principleIds||[]).join(',');
    renderCurrentPrinciples();
  }
  function renderCurrentPrinciples(){
    const ids=currentPrincipleIds(),items=ids.map(id=>Principles?.get?.(id)).filter(Boolean),summary=byId('qbPrincipleSummary'),chips=byId('qbSelectedPrincipleChips');
    if(summary)summary.textContent=items.length?items.map(item=>item.name).join('、'):'未关联题干 / 通用原则';
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
    const optionIds=(question.options||[]).map(option=>option?.id);
    const bindings=PrincipleBinding.normalize?.(question.metadata||{},optionIds)||{};
    const ids=unique([...(bindings.principleIds||[]),...(question.metadata?.principleIds||[]),...(question.principleIds||[])]);
    return ids.includes(String(item?.id||''))||legacyPrincipleNames(question).includes(String(item?.name||''));
  }
  function questionsForPrinciple(id){
    const item=Principles?.get?.(id);if(!item)return [];
    return (api().getAllQuestions?.({includeDeleted:false})||[]).filter(question=>questionMatchesPrinciple(question,item));
  }
  function openPrincipleQuestionList(id){
    const item=Principles?.get?.(id);if(!item)return toast('原则已不存在。');
    const questions=questionsForPrinciple(id),title=byId('tqPrincipleQuestionListTitle'),hint=byId('tqPrincipleQuestionListHint'),list=byId('tqPrincipleQuestionList');
    if(title)title.textContent=`${item.name} · 所属题目`;
    if(hint)hint.textContent=questions.length?`共 ${questions.length} 道题，双击题目查看完整预览。`:'当前没有题目绑定这条原则。';
    if(list)list.innerHTML=questions.length?questions.map(question=>`<button type="button" class="tq-principle-question-row" data-principle-question-id="${escapeHTML(question.id)}" data-principle-question-bank-id="${escapeHTML(question.bankId||'')}"><strong>${escapeHTML(question.teacherNumber||question.id)} · ${escapeHTML(question.title||'未命名题目')}</strong><span>${escapeHTML(question.bankName||'未命名题库')} · ${escapeHTML(displayQuestionType(question.type))}${displayDifficulty(question.difficulty)?' · '+escapeHTML(displayDifficulty(question.difficulty)):''}</span></button>`).join(''):'<div class="qb-empty">当前没有题目绑定这条原则。</div>';
    showDialog('tqPrincipleQuestionListDialog');
  }
  function principleConflictQuestions(detail={}){
    const grouped=detail?.referenceQuestions;
    if(!grouped||typeof grouped!=='object'||Array.isArray(grouped))return [];
    const seen=new Set(),rows=[];
    Object.keys(grouped).sort().forEach(principleId=>{
      if(!Array.isArray(grouped[principleId]))return;
      grouped[principleId].forEach(raw=>{
        const questionId=String(raw?.questionId||'').trim(),bankId=String(raw?.bankId||'').trim();
        if(!questionId||!bankId)return;
        const key=bankId+'::'+questionId;if(seen.has(key))return;seen.add(key);
        rows.push({questionId,bankId,questionTitle:String(raw?.questionTitle||'未命名题目'),teacherNumber:String(raw?.teacherNumber||''),bankName:String(raw?.bankName||'未命名题库')});
      });
    });
    return rows.sort((left,right)=>left.bankName.localeCompare(right.bankName,'zh-Hans-CN')||left.questionTitle.localeCompare(right.questionTitle,'zh-Hans-CN')||left.questionId.localeCompare(right.questionId));
  }
  function openPrincipleReferenceConflict(detail={}){
    const questions=principleConflictQuestions(detail),title=byId('tqPrincipleQuestionListTitle'),hint=byId('tqPrincipleQuestionListHint'),list=byId('tqPrincipleQuestionList');
    if(!questions.length)return false;
    if(title)title.textContent='原则仍被题目引用';
    if(hint)hint.textContent=`共 ${questions.length} 道题，点击题目可直接定位并解除原则绑定。`;
    if(list)list.innerHTML=questions.map(question=>`<button type="button" class="tq-principle-question-row" data-principle-conflict-link="true" data-principle-question-id="${escapeHTML(question.questionId)}" data-principle-question-bank-id="${escapeHTML(question.bankId)}"><strong>${escapeHTML(question.teacherNumber||question.questionId)} · ${escapeHTML(question.questionTitle)}</strong><span>${escapeHTML(question.bankName)}</span></button>`).join('');
    showDialog('tqPrincipleQuestionListDialog');return true;
  }
  function findQuestionByRef(questionId,bankId=''){
    return (api().getAllQuestions?.({includeDeleted:false})||[]).find(question=>String(question.id)===String(questionId||'')&&(!bankId||String(question.bankId||'')===String(bankId)))||null;
  }
  function openPrincipleQuestionPreview(questionId,bankId=''){
    const question=findQuestionByRef(questionId,bankId);if(!question)return toast('题目已不存在，无法预览。');
    const preview=global.KGTeacherDomains?.QuestionBank?.QuestionPreview?.viewModel?.(question)||null,options=preview?.options||question.options||[],stem=String(preview?.stem||(question.stemParts||[]).map(item=>item?.text||'').join('')).trim(),analysis=String(preview?.analysis??question.analysis??'').trim(),correct=String(question.correctAnswer||options.find(option=>option.correct)?.id||'');
    if(byId('tqPrincipleQuestionPreviewTitle'))byId('tqPrincipleQuestionPreviewTitle').textContent=question.title||'未命名题目';
    if(byId('tqPrincipleQuestionPreviewMeta'))byId('tqPrincipleQuestionPreviewMeta').textContent=[question.teacherNumber,question.bankName,displayQuestionType(question.type),displayDifficulty(question.difficulty)].filter(Boolean).join(' · ');
    if(byId('tqPrincipleQuestionPreviewContent'))byId('tqPrincipleQuestionPreviewContent').innerHTML=`<section><h3>题干</h3><div class="tq-principle-preview-stem">${stem?escapeHTML(stem):'<span class="qb-empty">暂无题干</span>'}</div></section>${options.length?`<section><h3>选项</h3><div class="tq-principle-preview-options">${options.map(option=>`<div class="${option.correct?'correct':''}"><b>${escapeHTML(option.id)}</b><span>${escapeHTML(option.text||'')}</span></div>`).join('')}</div></section>`:''}<section><h3>正确答案</h3><div class="tq-principle-preview-answer">${correct?escapeHTML(correct):'未设置'}</div></section><section><h3>解析</h3><div class="tq-principle-preview-analysis">${analysis?escapeHTML(analysis):'暂无解析'}</div></section>`;
    const edit=byId('tqPrincipleQuestionPreviewEditLink'),url=api().questionBasicInfoUrl?.(question.id,question.bankId)||'';
    if(edit){edit.href=url||'#';edit.hidden=!url;}
    showDialog('tqPrincipleQuestionPreviewDialog');
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
  async function savePrinciple(){
    const name=String(byId('tqPrincipleName')?.value||'').trim();if(!name)return toast('请输入原则名称。');
    const id=String(byId('tqPrincipleId')?.value||'');
    const principleStatus=byId('tqPrincipleStatus')?.value||'active';
    const confusable=[...(byId('tqConfusablePrinciples')?.querySelectorAll('input:checked')||[])].map(input=>input.value);
    // Capture preset values before repository events rerender the editor.
    const presetId=String(byId('tqPresetId')?.value||'');
    const presetContent=String(byId('tqPresetContent')?.value||'').trim();
    const presetStatus=byId('tqPresetStatus')?.value||'draft';
    const principle={id,name,status:principleStatus,confusablePrincipleIds:confusable};
    const preset={id:presetId,principleId:id,title:'原则：'+name,content:presetContent,status:presetStatus};
    try{
      const result=await global.KGTeachingContentApi.savePrinciple(principle,preset);
      applyPrincipleCardBundle(result);const item=Principles?.get?.(id)||Principles?.findByName?.(name);if(!item)throw new Error('服务器未返回保存后的原则');
      draftPrincipleId='';activePrincipleId=item.id;renderPrincipleList();toast('原则与系统预设归纳卡已保存。');
    }catch(error){toast(error?.message||'原则保存失败。')}
  }
  function newPrinciple(){draftPrincipleId='principle-draft-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);activePrincipleId=draftPrincipleId;fillPrincipleEditor(draftPrincipleId);byId('tqPrincipleName')?.focus()}
  function selectedPrinciples(){return [...selectedPrincipleIds]}
  async function postPrincipleOperation(path,body){
    const response=await global.fetch(path,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    let payload={};try{payload=await response.json()}catch(error){}
    if(!response.ok){const detail=payload?.detail||payload;const error=new Error(detail?.message||'操作失败');error.detail=detail;throw error}
    return payload;
  }
  function reloadPrincipleProjection(){
    if(typeof global.location?.reload==='function')return global.location.reload();
    return undefined;
  }
  async function applySelectedPresetStatus(){
    const ids=selectedPrinciples(),status=String(byId('tqBulkPresetStatus')?.value||'draft');
    if(!ids.length)return toast('请先勾选要修改的原则。');
    try{await postPrincipleOperation('/api/v1/content-prep/principles/status',{ids,presetStatus:status});reloadPrincipleProjection();toast(`已更新 ${ids.length} 条原则的预设状态。`)}catch(error){toast(error?.message||'批量修改预设状态失败。')}
  }
  async function exportPrincipleCardBundle(){
    try{ensurePairedPresets();downloadPrincipleCardBundle(currentPrincipleCardBundle());toast('原则与归纳卡组合已导出。')}catch(error){toast('组合导出失败：'+(error?.message||error))}
  }
  async function importPrincipleCardBundle(file){
    if(!file)return;
    try{
      const bundle=normalizePrincipleCardBundle(await readJsonFile(file));
      const payload={principleCardBundleVersion:1,format:'kg-principle-card-bundle-v1',...bundle};
      const result=await postPrincipleOperation('/api/v1/content-prep/principles/import',payload);
      applyPrincipleCardBundle(result.principles&&result.synthesisPresets?result:payload);
      selectedPrincipleIds.clear();activePrincipleId=(result.principles?.items||payload.principles.items)[0]?.id||'';draftPrincipleId='';renderPrincipleList();toast(`已导入 ${payload.principles.items.length} 条原则与归纳卡。`);
    }catch(error){const counts=error?.detail?.referenceCounts||{},total=Object.values(counts).reduce((sum,value)=>sum+Number(value||0),0);toast(total?`导入会删除仍被 ${total} 道题引用的原则，请先重新绑定题目。`:error?.message||'组合导入失败。')}
  }
  async function deleteSelectedPrinciples(){
    const ids=selectedPrinciples();if(!ids.length)return toast('请先勾选要删除的原则。');
    if(!global.confirm?.(`确定删除所选 ${ids.length} 条原则及其系统归纳卡吗？仍被题目引用的原则不会被删除。`))return;
    try{ensurePairedPresets();const result=await postPrincipleOperation('/api/v1/content-prep/principles/delete',{ids});applyPrincipleCardBundle(result);selectedPrincipleIds.clear();activePrincipleId='';draftPrincipleId='';renderPrincipleList();toast(`已删除 ${ids.length} 条原则及其系统归纳卡。`)}catch(error){const counts=error?.detail?.referenceCounts||{},total=Object.values(counts).reduce((sum,value)=>sum+Number(value||0),0);if(total&&openPrincipleReferenceConflict(error?.detail))return;toast(total?`所选原则仍被 ${total} 道题引用，请先解除或重新绑定。`:error?.message||'删除失败。')}
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
    byId('tqPrincipleList')?.addEventListener('click',event=>{const row=event.target.closest('[data-principle-id]');if(!row)return;const id=row.dataset.principleId;clearTimeout(principleOpenClickTimer);principleOpenClickTimer=setTimeout(()=>{draftPrincipleId='';activePrincipleId=id;renderPrincipleList();principleOpenClickTimer=0},180)});
    byId('tqPrincipleList')?.addEventListener('dblclick',event=>{const row=event.target.closest('[data-principle-id]');if(!row)return;event.preventDefault();clearTimeout(principleOpenClickTimer);principleOpenClickTimer=0;openPrincipleQuestionList(row.dataset.principleId)});
    byId('tqSelectAllPrinciples')?.addEventListener('change',event=>{const ids=(Principles?.list?.({includeInactive:true})||[]).map(item=>item.id);selectedPrincipleIds=event.target.checked?new Set(ids):new Set();renderPrincipleList()});
    byId('tqApplyPresetStatusBtn')?.addEventListener('click',()=>{applySelectedPresetStatus()});
    byId('tqDeleteSelectedPrinciplesBtn')?.addEventListener('click',()=>{void deleteSelectedPrinciples()});
    byId('tqExportPrincipleCardBundleBtn')?.addEventListener('click',()=>{void exportPrincipleCardBundle()});
    byId('tqImportPrincipleCardBundleBtn')?.addEventListener('click',()=>byId('tqImportPrincipleCardBundleFile')?.click());
    byId('tqImportPrincipleCardBundleFile')?.addEventListener('change',event=>{const input=event.currentTarget;void importPrincipleCardBundle(input.files?.[0]).finally(()=>{input.value=''})});
    byId('tqPrincipleQuestionListCloseBtn')?.addEventListener('click',()=>closeDialog('tqPrincipleQuestionListDialog'));
    byId('tqPrincipleQuestionPreviewCloseBtn')?.addEventListener('click',()=>closeDialog('tqPrincipleQuestionPreviewDialog'));
    byId('tqPrincipleQuestionList')?.addEventListener('click',event=>{const row=event.target.closest('[data-principle-conflict-link="true"]');if(!row)return;const url=api().questionBasicInfoUrl?.(row.dataset.principleQuestionId,row.dataset.principleQuestionBankId)||'';if(url)global.location.href=url;else toast('题目定位信息不完整，请刷新后重试。')});
    byId('tqPrincipleQuestionList')?.addEventListener('dblclick',event=>{const row=event.target.closest('[data-principle-question-id]');if(!row)return;event.preventDefault();openPrincipleQuestionPreview(row.dataset.principleQuestionId,row.dataset.principleQuestionBankId)});
    byId('tqNewPrincipleBtn')?.addEventListener('click',newPrinciple);byId('tqSavePrincipleBtn')?.addEventListener('click',savePrinciple);
    byId('tqPrincipleName')?.addEventListener('input',()=>{if(byId('tqPresetTitle'))byId('tqPresetTitle').value='原则：'+String(byId('tqPrincipleName').value||'').trim()});
    document.addEventListener('kg-question-form-filled',event=>{const question=event.detail?.question||{};const normalized=PrincipleBinding.normalize?.(question.metadata||{},(question.options||[]).map(option=>option.id))||{};let ids=unique(normalized.stemPrincipleIds||question.metadata?.stemPrincipleIds||question.metadata?.principleIds||question.principleIds||[]);if(!ids.length){const created=legacyPrincipleNames(question).map(name=>Principles?.findByName?.(name)||Principles?.upsert?.({name})).filter(Boolean);ids=created.map(item=>item.id)}setCurrentPrincipleIds(ids);if(byId('questionDifficultyInput'))byId('questionDifficultyInput').value=Difficulty.normalize?.(question.difficulty)||'';renderStarRating();renderPrincipleList()});
    global.addEventListener('kg:principles-changed',()=>{renderCurrentPrinciples();renderPrincipleList()});
    renderStarRating();renderCurrentPrinciples();renderPrincipleList();
    const requested=new URLSearchParams(location.search).get('section');if(requested==='principles')setTimeout(()=>document.querySelector('[data-annotation-tab="principles"]')?.click(),80);
  }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(bind,0));
})(globalThis);
