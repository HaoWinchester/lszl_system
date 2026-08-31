'use strict';

(function(){
  const params=new URLSearchParams(location.search);
  const requestedMode=params.get('mode')||document.body?.dataset?.qbWorkflowMode||'';
  const requestedStep=params.get('step')||document.body?.dataset?.qbWorkflowStep||'';
  const mode=requestedMode==='advanced'?'advanced':'simple';
  const step=requestedStep==='training'?'training':'questions';
  const byId=id=>document.getElementById(id);
  const escapeHTML=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const P2=window.KGTeacherWorkflowP2;
  const Classification=window.KGQuestionClassification;
  let pasteMode='single',parsedQuestion=null,parsedBatch=null,editorLanguage='zh',batchPreviewIndex=0;
  const Core=window.KGLearningContent;
  const unique=values=>[...new Set((values||[]).map(value=>String(value??'').trim()).filter(Boolean))];
  const batchDefaults={knowledgeMode:'auto',knowledge:null,tags:[]};
  const batchEditor={mode:'defaults',itemIndex:-1,tab:'knowledge',knowledgeMode:'auto',knowledgeId:'',tags:new Set(),tagGroupId:'usage',tagCategoryId:'stage'};
  const TRAINING_WORKSPACE_LAYOUT_KEY='kg_question_training_workspace_layout_v1';
  const TRAINING_FILTERS_COLLAPSED_KEY='kg_question_training_filters_collapsed_v1';
  const TrainingWorkspaceLayout=window.KGTeacherDomains?.TrainingConfig?.WorkspaceLayout?.create?.({key:TRAINING_WORKSPACE_LAYOUT_KEY,store:window.KGAppStorage})||null;
  let trainingWorkspaceRatio=.40;
  let trainingWorkspaceLeftHeight=880;
  let trainingPreviewHeight=380;
  let trainingFiltersCollapsed=true;

  function click(selector){const node=document.querySelector(selector);if(node)node.click()}
  function setText(selector,text){const node=document.querySelector(selector);if(node)node.textContent=text}
  function clean(value){return String(value??'').trim()}
  function batchContext(){
    const bank=window.KGQuestionBankAdminAPI?.getCurrentBank?.()||null;
    const subject=Classification?.subjectForBank?.(bank?.subject||'')||null;
    const taxonomy=subject&&Core?.defaultTaxonomyForSubject?.(subject.id)||null;
    return {bank,subject,taxonomy};
  }
  function resolutionFromNode(nodeId,source='batch-default'){
    const {bank,subject,taxonomy}=batchContext();const node=taxonomy&&nodeId?Core?.nodeById?.(taxonomy.id,nodeId):null;
    return {subjectId:subject?.id||'',subjectCode:subject?.code||bank?.subject||'',subjectStatus:'bank_default',taxonomyId:taxonomy?.id||'',taxonomyVersion:Number(taxonomy?.version)||1,requestedKnowledge:'',matchStatus:node?'matched':'empty',primaryNodeId:node?.id||null,mappingStatus:node?'confirmed':'unmapped',mappingSource:source,pathSnapshot:node?Core.pathForNode(taxonomy.id,node.id).map(item=>item.title?.zh||item.id):[],candidates:[],tags:[],warnings:[]};
  }
  function baseParserWarnings(result){if(!Array.isArray(result._classificationBaseWarnings))result._classificationBaseWarnings=[...(result.warnings||[])];return result._classificationBaseWarnings}
  function sameTags(a,b){const left=unique(a).slice().sort(),right=unique(b).slice().sort();return left.length===right.length&&left.every((item,index)=>item===right[index])}
  function resolveBatchClassification(result,{ignoreOverride=false}={}){
    if(!result||!Classification?.resolveTemplate)return null;
    const {bank}=batchContext();const base=Classification.resolveTemplate(result,bank?.subject||'');
    const explicitKnowledge=!!clean(result.knowledge||result.knowledgePath||result.primaryKnowledge||'');
    const explicitTags=Array.isArray(result.tags)&&result.tags.length>0;
    const override=!ignoreOverride&&result._batchClassificationOverride||null;
    let resolution={...base,tags:unique(base.tags||[])};
    let knowledgeSource=explicitKnowledge?'template':'none',tagSource=explicitTags?'template':'none';
    if(override?.knowledgeMode==='node'&&override.knowledge?.primaryNodeId){resolution={...resolution,...override.knowledge,mappingSource:'item-override'};knowledgeSource='item-override'}
    else if(override?.knowledgeMode==='unmapped'){resolution={...resolution,primaryNodeId:null,mappingStatus:'unmapped',mappingSource:'item-override-unmapped',pathSnapshot:[],matchStatus:'empty',requestedKnowledge:''};knowledgeSource='item-override'}
    else if(!explicitKnowledge&&batchDefaults.knowledgeMode==='node'&&batchDefaults.knowledge?.primaryNodeId){resolution={...resolution,...batchDefaults.knowledge,mappingSource:'batch-default'};knowledgeSource='batch-default'}
    else if(!explicitKnowledge&&batchDefaults.knowledgeMode==='unmapped'){resolution={...resolution,primaryNodeId:null,mappingStatus:'unmapped',mappingSource:'batch-default-unmapped',pathSnapshot:[],matchStatus:'empty',requestedKnowledge:''};knowledgeSource='batch-default'}
    if(override&&Object.prototype.hasOwnProperty.call(override,'tags')){resolution.tags=unique(override.tags);tagSource='item-override'}
    else if(!explicitTags&&batchDefaults.tags.length){resolution.tags=unique(batchDefaults.tags);tagSource='batch-default'}
    resolution.effectiveKnowledgeSource=knowledgeSource;resolution.effectiveTagSource=tagSource;
    let warnings=[...(base.warnings||[])];
    if(knowledgeSource==='item-override'||knowledgeSource==='batch-default')warnings=warnings.filter(message=>!/^知识点“/.test(message)&&!/^当前科目没有可用知识树/.test(message));
    result.classification=resolution;result.warnings=[...new Set([...baseParserWarnings(result),...warnings])];return resolution;
  }
  function resolveClassification(result,batchMode=false){
    if(!result||!Classification?.resolveTemplate)return null;
    if(batchMode)return resolveBatchClassification(result);
    const bank=window.KGQuestionBankAdminAPI?.getCurrentBank?.();const resolution=Classification.resolveTemplate(result,bank?.subject||'');
    result.classification=resolution;result.warnings=[...new Set([...baseParserWarnings(result),...(resolution.warnings||[])])];return resolution;
  }
  function sourceLabel(value){return value==='item-override'?'单题覆盖':value==='batch-default'?'批次默认':value==='template'?'模板':'自动'}
  function classificationSummary(result){
    const item=result?.classification;if(!item)return '<span>未解析分类字段</span>';
    const subject=item.subjectCode||'—',knowledgeSource=sourceLabel(item.effectiveKnowledgeSource),tagSource=sourceLabel(item.effectiveTagSource);
    if(item.primaryNodeId)return `<span>科目 ${escapeHTML(subject)} · ${escapeHTML((item.pathSnapshot||[]).join(' > '))} · ${item.tags?.length||0} 个标签</span><em>知识点：${escapeHTML(knowledgeSource)} · 标签：${escapeHTML(tagSource)}</em>`;
    if(item.requestedKnowledge)return `<span>科目 ${escapeHTML(subject)} · 知识点待确认：${escapeHTML(item.requestedKnowledge)} · ${item.tags?.length||0} 个标签</span><em>知识点：${escapeHTML(knowledgeSource)} · 标签：${escapeHTML(tagSource)}</em>`;
    return `<span>科目 ${escapeHTML(subject)} · 待分类 · ${item.tags?.length||0} 个标签</span><em>知识点：${escapeHTML(knowledgeSource)} · 标签：${escapeHTML(tagSource)}</em>`;
  }

  function insertGuide(){
    const topbar=document.querySelector('.qb-topbar');if(!topbar)return;
    const guide=document.createElement('section');guide.className='tq-step-guide';guide.id='tqStepGuide';
    if(step==='training'){
      guide.innerHTML='<div class="tq-step-guide-copy"><strong>第 2 步：为当前原题配置训练</strong><span>左侧核对当前题目，右侧输入可点击关键词和知识联想入口。没有预设分支时，学员仍可使用现有自由输入卡牌。</span></div><div class="tq-step-guide-actions"><a href="question-bank.html?mode=simple&step=questions">返回题目管理</a><a href="admin-subjects.html" target="_blank" rel="noopener">管理知识树</a><button type="button" id="tqSaveTrainingBtn">保存当前配置</button><a class="primary" href="paper-management.html">下一步：试卷管理</a></div>';
    }else{
      guide.innerHTML='<div class="tq-step-guide-copy"><strong>第 1 步：维护完整考试原题</strong><span>可以逐题粘贴校对，也可以一次粘贴多道题批量入库；解析前不会修改题库。</span></div><div class="tq-step-guide-actions"><button type="button" id="tqNewQuestionBtn">＋ 新建题目</button><button type="button" id="tqOpenQuestionBtn">编辑当前题目</button><a class="primary" href="question-bank.html?mode=simple&step=training">下一步：配置训练</a></div>';
    }
    topbar.insertAdjacentElement('afterend',guide);
  }

  function updateShell(){
    document.querySelectorAll('[data-tq-step]').forEach(link=>link.classList.toggle('active',link.dataset.tqStep===step));
    document.querySelectorAll('[data-tq-step-flow]').forEach(link=>{const current=link.dataset.tqStepFlow;link.classList.toggle('active',current===step);link.classList.toggle('done',step==='training'&&current==='questions')});
  }

  function trainingWorkspaceBounds(available){
    const safe=Math.max(1,Number(available)||1);
    const minimum=Math.max(.28,Math.min(.48,330/safe));
    const maximum=Math.min(.68,Math.max(.52,1-(430/safe)));
    return minimum<=maximum?{minimum,maximum}:{minimum:.42,maximum:.58};
  }
  function applyTrainingWorkspaceRatio(){
    const editor=document.querySelector('body.qb-training-step .qb-editor'),splitter=byId('tqTrainingWorkspaceSplitter');
    if(!editor||!splitter)return;
    if(window.innerWidth<=1080){
      editor.style.removeProperty('grid-template-columns');
      splitter.setAttribute('aria-hidden','true');
      return;
    }
    splitter.removeAttribute('aria-hidden');
    const splitterWidth=splitter.offsetWidth||14,available=Math.max(1,editor.clientWidth-splitterWidth),bounds=trainingWorkspaceBounds(available);
    trainingWorkspaceRatio=Math.min(bounds.maximum,Math.max(bounds.minimum,Number(trainingWorkspaceRatio)||.40));
    const left=Math.round(available*trainingWorkspaceRatio);
    editor.style.gridTemplateColumns=`${left}px ${splitterWidth}px minmax(0,1fr)`;
    splitter.setAttribute('aria-valuemin',String(Math.round(bounds.minimum*100)));
    splitter.setAttribute('aria-valuemax',String(Math.round(bounds.maximum*100)));
    splitter.setAttribute('aria-valuenow',String(Math.round(trainingWorkspaceRatio*100)));
    splitter.setAttribute('aria-valuetext',`题目区域 ${Math.round(trainingWorkspaceRatio*100)}%，训练配置区域 ${Math.round((1-trainingWorkspaceRatio)*100)}%`);
    document.dispatchEvent(new CustomEvent('kg-training-workspace-resized',{detail:{ratio:trainingWorkspaceRatio}}));
  }
  function persistTrainingWorkspaceLayout(patch={}){
    const next={ratio:trainingWorkspaceRatio,leftHeight:trainingWorkspaceLeftHeight,previewHeight:trainingPreviewHeight,...patch};
    if(TrainingWorkspaceLayout){TrainingWorkspaceLayout.save(next);return}
    try{localStorage.setItem(TRAINING_WORKSPACE_LAYOUT_KEY,JSON.stringify({...next,updatedAt:Date.now()}))}catch(error){}
  }
  function persistTrainingWorkspaceRatio(){persistTrainingWorkspaceLayout({ratio:trainingWorkspaceRatio})}
  function initTrainingWorkspaceSplitter(){
    const editor=document.querySelector('body.qb-training-step .qb-editor'),splitter=byId('tqTrainingWorkspaceSplitter');if(!editor||!splitter)return;
    try{const saved=TrainingWorkspaceLayout?TrainingWorkspaceLayout.read():JSON.parse(localStorage.getItem(TRAINING_WORKSPACE_LAYOUT_KEY)||'{}');if(Number(saved.ratio)>0)trainingWorkspaceRatio=Number(saved.ratio);if(Number(saved.leftHeight)>0)trainingWorkspaceLeftHeight=Number(saved.leftHeight);if(Number(saved.previewHeight)>0)trainingPreviewHeight=Number(saved.previewHeight)}catch(error){}
    let dragging=false;
    const update=clientX=>{const rect=editor.getBoundingClientRect(),available=Math.max(1,rect.width-(splitter.offsetWidth||14)),bounds=trainingWorkspaceBounds(available);trainingWorkspaceRatio=Math.min(bounds.maximum,Math.max(bounds.minimum,(clientX-rect.left)/available));applyTrainingWorkspaceRatio()};
    splitter.addEventListener('pointerdown',event=>{if(window.innerWidth<=1080)return;dragging=true;splitter.classList.add('dragging');splitter.setPointerCapture?.(event.pointerId);update(event.clientX);event.preventDefault()});
    splitter.addEventListener('pointermove',event=>{if(dragging)update(event.clientX)});
    const finish=event=>{if(!dragging)return;dragging=false;splitter.classList.remove('dragging');try{splitter.releasePointerCapture?.(event.pointerId)}catch(error){}persistTrainingWorkspaceRatio()};
    splitter.addEventListener('pointerup',finish);splitter.addEventListener('pointercancel',finish);
    splitter.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||window.innerWidth<=1080)return;event.preventDefault();const available=Math.max(1,editor.clientWidth-(splitter.offsetWidth||14)),bounds=trainingWorkspaceBounds(available);if(event.key==='Home')trainingWorkspaceRatio=bounds.minimum;else if(event.key==='End')trainingWorkspaceRatio=bounds.maximum;else trainingWorkspaceRatio=Math.min(bounds.maximum,Math.max(bounds.minimum,trainingWorkspaceRatio+(event.key==='ArrowRight'?.02:-.02)));applyTrainingWorkspaceRatio();persistTrainingWorkspaceRatio()});
    window.addEventListener('resize',applyTrainingWorkspaceRatio,{passive:true});
    requestAnimationFrame(applyTrainingWorkspaceRatio);
  }

  function trainingHeightBounds(){
    const minimum=720,maximum=1600;
    return {minimum,maximum};
  }
  function trainingPreviewBounds(){
    const workspace=byId('qbMainWorkspace'),panel=byId('qbQuestionTabPanel');
    const available=Math.max(600,workspace?.clientHeight||trainingWorkspaceLeftHeight);
    const header=panel?.querySelector('.qb-management-pane-head')?.offsetHeight||54;
    const minimum=240;
    const maximum=Math.max(minimum,available-header-330-24);
    return {minimum,maximum:Math.min(900,maximum)};
  }
  function applyTrainingWorkspaceHeights(){
    const workspace=byId('qbMainWorkspace'),widthSplitter=byId('tqTrainingWorkspaceSplitter'),workspaceHandle=byId('tqTrainingWorkspaceHeightSplitter'),preview=byId('tqTrainingPreview'),previewHandle=byId('tqTrainingPreviewSplitter');
    if(!workspace||!preview)return;
    if(window.innerWidth<=1080){
      workspace.style.removeProperty('--tq-training-left-height');
      preview.style.removeProperty('--tq-training-preview-height');
      workspaceHandle?.setAttribute('aria-hidden','true');previewHandle?.setAttribute('aria-hidden','true');
      return;
    }
    const heightBounds=trainingHeightBounds();trainingWorkspaceLeftHeight=Math.min(heightBounds.maximum,Math.max(heightBounds.minimum,Number(trainingWorkspaceLeftHeight)||880));
    workspace.style.setProperty('--tq-training-left-height',`${Math.round(trainingWorkspaceLeftHeight)}px`);
    widthSplitter?.style.setProperty('--tq-training-left-height',`${Math.round(trainingWorkspaceLeftHeight)}px`);
    const previewBounds=trainingPreviewBounds();trainingPreviewHeight=Math.min(previewBounds.maximum,Math.max(previewBounds.minimum,Number(trainingPreviewHeight)||380));
    preview.style.setProperty('--tq-training-preview-height',`${Math.round(trainingPreviewHeight)}px`);
    if(workspaceHandle){workspaceHandle.removeAttribute('aria-hidden');workspaceHandle.setAttribute('aria-valuemin',String(heightBounds.minimum));workspaceHandle.setAttribute('aria-valuemax',String(heightBounds.maximum));workspaceHandle.setAttribute('aria-valuenow',String(Math.round(trainingWorkspaceLeftHeight)));workspaceHandle.setAttribute('aria-valuetext',`题目工作区 ${Math.round(trainingWorkspaceLeftHeight)} 像素`)}
    if(previewHandle){previewHandle.removeAttribute('aria-hidden');previewHandle.setAttribute('aria-valuemin',String(Math.round(previewBounds.minimum)));previewHandle.setAttribute('aria-valuemax',String(Math.round(previewBounds.maximum)));previewHandle.setAttribute('aria-valuenow',String(Math.round(trainingPreviewHeight)));previewHandle.setAttribute('aria-valuetext',`题目预览 ${Math.round(trainingPreviewHeight)} 像素`)}
    document.dispatchEvent(new CustomEvent('kg-training-workspace-height-resized',{detail:{leftHeight:trainingWorkspaceLeftHeight,previewHeight:trainingPreviewHeight}}));
  }
  function bindTrainingHeightHandle(handle,{getValue,setValue,bounds,defaultValue}){
    if(!handle)return;let dragging=false,startY=0,startValue=0;
    const update=clientY=>{const range=bounds();setValue(Math.min(range.maximum,Math.max(range.minimum,startValue+(clientY-startY))));applyTrainingWorkspaceHeights()};
    handle.addEventListener('pointerdown',event=>{if(window.innerWidth<=1080)return;dragging=true;startY=event.clientY;startValue=getValue();handle.classList.add('dragging');document.documentElement.classList.add('tq-training-row-resizing');handle.setPointerCapture?.(event.pointerId);event.preventDefault()});
    handle.addEventListener('pointermove',event=>{if(dragging)update(event.clientY)});
    const finish=event=>{if(!dragging)return;dragging=false;handle.classList.remove('dragging');document.documentElement.classList.remove('tq-training-row-resizing');try{handle.releasePointerCapture?.(event.pointerId)}catch(error){}persistTrainingWorkspaceLayout()};
    handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);
    const reset=()=>{setValue(defaultValue);applyTrainingWorkspaceHeights();persistTrainingWorkspaceLayout()};
    handle.addEventListener('dblclick',event=>{event.preventDefault();reset()});
    handle.addEventListener('keydown',event=>{if(window.innerWidth<=1080||!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End','Enter'].includes(event.key))return;event.preventDefault();const range=bounds(),step=event.key.startsWith('Page')?64:20;if(event.key==='Home')setValue(range.minimum);else if(event.key==='End')setValue(range.maximum);else if(event.key==='Enter'){reset();return}else setValue(Math.min(range.maximum,Math.max(range.minimum,getValue()+(event.key==='ArrowDown'||event.key==='PageDown'?step:-step))));applyTrainingWorkspaceHeights();persistTrainingWorkspaceLayout()});
  }
  function initTrainingHeightSplitters(){
    const workspace=byId('qbMainWorkspace'),preview=byId('tqTrainingPreview');if(!workspace||!preview)return;
    let workspaceHandle=byId('tqTrainingWorkspaceHeightSplitter');if(!workspaceHandle){workspaceHandle=document.createElement('div');workspaceHandle.id='tqTrainingWorkspaceHeightSplitter';workspaceHandle.className='tq-training-height-splitter tq-training-workspace-height-splitter';workspaceHandle.setAttribute('role','separator');workspaceHandle.setAttribute('tabindex','0');workspaceHandle.setAttribute('aria-orientation','horizontal');workspaceHandle.setAttribute('aria-label','拖动调整左侧题目工作区高度；双击恢复默认高度');workspaceHandle.innerHTML='<span></span>';workspace.appendChild(workspaceHandle)}
    let previewHandle=byId('tqTrainingPreviewSplitter');if(!previewHandle){previewHandle=document.createElement('div');previewHandle.id='tqTrainingPreviewSplitter';previewHandle.className='tq-training-height-splitter tq-training-preview-splitter';previewHandle.setAttribute('role','separator');previewHandle.setAttribute('tabindex','0');previewHandle.setAttribute('aria-orientation','horizontal');previewHandle.setAttribute('aria-label','拖动调整题目列表与题目预览高度；双击恢复默认高度');previewHandle.innerHTML='<span></span>';preview.insertAdjacentElement('beforebegin',previewHandle)}
    bindTrainingHeightHandle(workspaceHandle,{getValue:()=>trainingWorkspaceLeftHeight,setValue:value=>{trainingWorkspaceLeftHeight=value},bounds:trainingHeightBounds,defaultValue:880});
    bindTrainingHeightHandle(previewHandle,{getValue:()=>trainingPreviewHeight,setValue:value=>{trainingPreviewHeight=value},bounds:trainingPreviewBounds,defaultValue:380});
    window.addEventListener('resize',applyTrainingWorkspaceHeights,{passive:true});requestAnimationFrame(applyTrainingWorkspaceHeights);
  }

  function trainingFilterSummaryText(){
    const bank=byId('qbTrainingBankSelect')?.selectedOptions?.[0]?.textContent?.trim()||'尚未选择题库';
    const lifecycle=byId('qbQuestionLifecycleFilter')?.selectedOptions?.[0]?.textContent?.trim()||'正常题目';
    const group=byId('qbQuestionGroupMode')?.selectedOptions?.[0]?.textContent?.trim()||'章节 / 主题';
    const search=clean(byId('qbQuestionSearch')?.value);
    return [bank,lifecycle,group,search?`搜索：${search}`:''].filter(Boolean).join(' · ');
  }
  function refreshTrainingFilterSummary(){
    const summary=byId('tqTrainingFilterSummary');if(!summary)return;
    const text=trainingFilterSummaryText();const copy=summary.querySelector('span');if(copy)copy.textContent=text;summary.title=text;
  }
  function applyTrainingFiltersCollapsed(next,{persist=true}={}){
    trainingFiltersCollapsed=!!next;document.body.classList.toggle('tq-training-filters-collapsed',trainingFiltersCollapsed);
    const toggle=byId('tqTrainingFilterToggle'),tools=document.querySelector('body.qb-training-step .qb-question-tools'),summary=byId('tqTrainingFilterSummary');
    if(toggle){toggle.setAttribute('aria-expanded',String(!trainingFiltersCollapsed));toggle.setAttribute('aria-label',trainingFiltersCollapsed?'展开题目筛选':'收起题目筛选');toggle.title=trainingFiltersCollapsed?'展开题目筛选':'收起题目筛选';toggle.classList.toggle('active',!trainingFiltersCollapsed)}
    if(tools)tools.setAttribute('aria-hidden',String(trainingFiltersCollapsed));if(summary)summary.hidden=!trainingFiltersCollapsed;
    if(persist){try{localStorage.setItem(TRAINING_FILTERS_COLLAPSED_KEY,trainingFiltersCollapsed?'1':'0')}catch(error){}}
    refreshTrainingFilterSummary();
  }
  function installTrainingFilterToggle(){
    const controls=document.querySelector('#qbQuestionTabPanel .qb-management-pane-controls'),body=byId('qbQuestionPaneBody'),tools=body?.querySelector('.qb-question-tools');if(!controls||!body||!tools||byId('tqTrainingFilterToggle'))return;
    const toggle=document.createElement('button');toggle.type='button';toggle.id='tqTrainingFilterToggle';toggle.className='tq-training-filter-toggle';toggle.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10"></path><path d="M18 7h2"></path><circle cx="16" cy="7" r="2"></circle><path d="M4 17h2"></path><path d="M10 17h10"></path><circle cx="8" cy="17" r="2"></circle></svg>';controls.prepend(toggle);
    const summary=document.createElement('button');summary.type='button';summary.id='tqTrainingFilterSummary';summary.className='tq-training-filter-summary';summary.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16"></path><path d="M7 12h10"></path><path d="M10 18h4"></path></svg><span></span><b>展开</b>';tools.insertAdjacentElement('afterend',summary);
    try{const saved=localStorage.getItem(TRAINING_FILTERS_COLLAPSED_KEY);trainingFiltersCollapsed=saved===null?true:saved!=='0'}catch(error){trainingFiltersCollapsed=true}
    toggle.addEventListener('click',()=>applyTrainingFiltersCollapsed(!trainingFiltersCollapsed));summary.addEventListener('click',()=>applyTrainingFiltersCollapsed(false));
    ['qbTrainingBankSelect','qbQuestionLifecycleFilter','qbQuestionGroupMode'].forEach(id=>byId(id)?.addEventListener('change',refreshTrainingFilterSummary));byId('qbQuestionSearch')?.addEventListener('input',refreshTrainingFilterSummary);
    const bankSelect=byId('qbTrainingBankSelect');if(bankSelect)new MutationObserver(refreshTrainingFilterSummary).observe(bankSelect,{childList:true,subtree:true,attributes:true});
    document.addEventListener('click',event=>{if(event.target.closest('#qbSubjectChips,[data-question-id]'))setTimeout(refreshTrainingFilterSummary,0)});
    applyTrainingFiltersCollapsed(trainingFiltersCollapsed,{persist:false});setTimeout(refreshTrainingFilterSummary,0);
  }

  function setEntryMode(next){
    const manual=next==='manual';document.body.classList.toggle('tq-manual-entry',manual);
    document.querySelectorAll('[data-tq-entry-mode]').forEach(button=>{const active=button.dataset.tqEntryMode===next;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active))});
    if(!manual)requestAnimationFrame(()=>byId('tqPasteInput')?.focus());
  }

  function setPasteMode(next){
    pasteMode=next==='batch'?'batch':'single';parsedQuestion=null;parsedBatch=null;
    document.querySelectorAll('[data-tq-paste-mode]').forEach(button=>{const active=button.dataset.tqPasteMode===pasteMode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});
    const batch=pasteMode==='batch';
    if(byId('tqPasteLabel'))byId('tqPasteLabel').textContent=batch?'一次粘贴多道双语单选题':'粘贴完整单选题';
    if(byId('tqPasteModeHint'))byId('tqPasteModeHint').textContent=batch?'推荐使用“===== 下一题 =====”分隔；解析通过后批量加入当前题库。':'适合逐题校对并立即进入中文、English 或中英对照编辑。';
    if(byId('tqPasteHelp'))byId('tqPasteHelp').textContent=batch?'支持双语批量模板、题号、连续题目和分隔线；未填写的知识点和标签可继承本批次默认分类，单题模板字段优先。':'支持标准双语模板、仅中文模板和原有 A/B/C/D 普通文本；模板可显式填写科目、知识点和标签。解析前不会写入题库。';
    if(byId('tqBatchOptions'))byId('tqBatchOptions').hidden=!batch;if(batch)refreshBatchDefaultSummary();
    if(byId('tqApplyParsedBtn'))byId('tqApplyParsedBtn').textContent=batch?'批量导入题库':'确认并进入编辑';
    resetParseResult(false);
  }

  function parseSingle(raw){return P2?.parseQuestion?.(raw)||{stem:'',options:[],answer:'',analysis:'',warnings:[],errors:['批量解析服务未加载。']}}
  function parseBatch(raw){return P2?.parseQuestionBatch?.(raw)||{items:[],total:0,validCount:0,invalidCount:0}}

  function languageLabel(value){return value==='bilingual'?'中英双语':value==='en_only'?'仅英文':'仅中文'}
  function locationLabel(items=[]){return items.length?items.map(item=>item.field==='stem'?`题干 ${item.count} 处`:`选项 ${item.optionId} ${item.count} 处`).join('、'):'未找到'}
  function previewDetailMarkup(result){
    const errors=Array.isArray(result?.errors)?result.errors:[],warnings=Array.isArray(result?.warnings)?result.warnings:[],options=Array.isArray(result?.options)?result.options:[],keywords=Array.isArray(result?.keywords)?result.keywords:[];
    const optionRows=options.map(option=>`<span class="tq-parse-option ${option.id===result.answer?'correct':''}"><em>${escapeHTML(option.id)}</em><span class="tq-bilingual-summary"><span>${escapeHTML(option.text||'—')}</span>${option.textEn?`<small>${escapeHTML(option.textEn)}</small>`:''}</span></span>`).join('')||'<span>—</span>';
    const keywordRows=keywords.length?`<div class="tq-parse-row"><b>关键词（${keywords.length}）</b><div class="tq-keyword-summary">${keywords.map(item=>`<article><b>${escapeHTML(item.zh||'—')}${item.en?` ｜ ${escapeHTML(item.en)}`:''}</b><small>中文：${escapeHTML(locationLabel(item.locationsZh))}${item.en?`；English：${escapeHTML(locationLabel(item.locationsEn))}`:''}${item.entry?`；入口：${escapeHTML(item.entry)}`:''}</small></article>`).join('')}</div></div>`:'';
    return `${errors.length?`<div class="tq-parse-errors">${errors.map(item=>`<span>• ${escapeHTML(item)}</span>`).join('')}</div>`:''}${warnings.length?`<div class="tq-parse-warnings">${warnings.map(item=>`<span>• ${escapeHTML(item)}</span>`).join('')}</div>`:''}<div class="tq-parse-row"><b>语言</b><span>${escapeHTML(languageLabel(result.language))}</span></div><div class="tq-parse-row"><b>题干</b><span class="tq-bilingual-summary"><span>${escapeHTML(result.stem||'—')}</span>${result.stemEn?`<small>${escapeHTML(result.stemEn)}</small>`:''}</span></div><div class="tq-parse-row"><b>选项</b>${optionRows}</div><div class="tq-parse-row"><b>正确答案</b><span>${escapeHTML(result.answer||'—')}</span></div><div class="tq-parse-row"><b>解析</b><span class="tq-bilingual-summary"><span>${escapeHTML(result.analysis||'—')}</span>${result.analysisEn?`<small>${escapeHTML(result.analysisEn)}</small>`:''}</span></div><div class="tq-parse-row tq-classification-preview"><b>分类</b>${classificationSummary(result)}</div>${keywordRows}`;
  }
  function renderSingleResult(result){
    const wrap=byId('tqParseResult'),summary=byId('tqParseSummary'),apply=byId('tqApplyParsedBtn');if(!wrap||!summary||!apply)return;
    resolveClassification(result,false);parsedQuestion=result;parsedBatch=null;const valid=!result.errors.length;summary.textContent=valid?`${languageLabel(result.language)} · ${result.options.length} 个选项 · A-D 完整 · 答案 ${result.answer}`:`需要处理 ${result.errors.length} 个问题`;apply.disabled=!valid;
    wrap.innerHTML=`<div class="tq-parse-block">${previewDetailMarkup(result)}</div>`;
  }

  function batchImportEnabled(){
    if(!parsedBatch?.validCount)return false;
    return parsedBatch.invalidCount===0||!!byId('tqImportValidOnly')?.checked;
  }
  function updateBatchApplyState(){const button=byId('tqApplyParsedBtn');if(!button)return;button.disabled=!batchImportEnabled();button.textContent=parsedBatch?.validCount?`导入 ${parsedBatch.validCount} 道通过题目`:'批量导入题库'}
  function setBatchPreviewIndex(index,{focus=false}={}){
    if(!parsedBatch?.items?.length){batchPreviewIndex=0;return}
    batchPreviewIndex=Math.max(0,Math.min(Number(index)||0,parsedBatch.items.length-1));
    const wrap=byId('tqParseResult');if(!wrap)return;
    wrap.querySelectorAll('[data-tq-batch-item-index]').forEach(article=>{const active=Number(article.dataset.tqBatchItemIndex)===batchPreviewIndex;article.hidden=!active;article.classList.toggle('active',active)});
    wrap.querySelectorAll('[data-tq-batch-jump]').forEach(button=>{const active=Number(button.dataset.tqBatchJump)===batchPreviewIndex;button.classList.toggle('active',active);button.setAttribute('aria-current',active?'true':'false')});
    const position=wrap.querySelector('[data-tq-batch-position]');if(position)position.textContent=`第 ${batchPreviewIndex+1} / ${parsedBatch.items.length} 题`;
    const prev=wrap.querySelector('[data-tq-batch-prev]'),next=wrap.querySelector('[data-tq-batch-next]');if(prev)prev.disabled=batchPreviewIndex===0;if(next)next.disabled=batchPreviewIndex===parsedBatch.items.length-1;
    const result=wrap.querySelector('.tq-batch-result');if(result)result.scrollTop=0;if(focus)wrap.querySelector(`[data-tq-batch-jump="${batchPreviewIndex}"]`)?.focus();
  }
  function renderBatchResult(result){
    const wrap=byId('tqParseResult'),summary=byId('tqParseSummary');if(!wrap||!summary)return;(result.items||[]).forEach(item=>resolveClassification(item,true));parsedBatch=result;parsedQuestion=null;batchPreviewIndex=Math.min(batchPreviewIndex,Math.max(0,(result.items?.length||1)-1));
    summary.textContent=`共 ${result.total} 道 · 通过 ${result.validCount} · 需处理 ${result.invalidCount}`;
    if(!result.items.length){wrap.innerHTML='<div class="tq-parse-empty">没有识别到可拆分的题目。请使用“===== 下一题 =====”单独占一行分隔每道题。</div>';updateBatchApplyState();return}
    const nav=`<div class="tq-batch-preview-nav"><button type="button" data-tq-batch-prev aria-label="上一题">‹ 上一题</button><strong data-tq-batch-position>第 ${batchPreviewIndex+1} / ${result.items.length} 题</strong><button type="button" data-tq-batch-next aria-label="下一题">下一题 ›</button></div><div class="tq-batch-preview-tabs" role="tablist" aria-label="解析题目切换">${result.items.map((item,arrayIndex)=>`<button type="button" data-tq-batch-jump="${arrayIndex}" role="tab" title="第 ${item.index} 题"><span>${item.index}</span><em>${item.errors.length?'需处理':'通过'}</em></button>`).join('')}</div>`;
    wrap.innerHTML=`${nav}<div class="tq-batch-result">${result.items.map((item,arrayIndex)=>`<article class="tq-batch-item ${item.errors.length?'invalid':'valid'}" data-tq-batch-item-index="${arrayIndex}"><div class="tq-batch-item-head"><b>第 ${item.index} 题 · ${escapeHTML(languageLabel(item.language))}</b><span>${item.errors.length?`${item.errors.length} 个问题`:`答案 ${escapeHTML(item.answer)} · ${item.keywords?.length||0} 个关键词`}</span></div><div class="tq-parse-block tq-batch-full-preview">${previewDetailMarkup(item)}</div><button type="button" class="tq-batch-edit-classification" data-tq-batch-edit="${arrayIndex}">修改分类</button></article>`).join('')}</div>`;
    wrap.querySelectorAll('[data-tq-batch-edit]').forEach(button=>button.addEventListener('click',()=>openBatchClassificationEditor('item',Number(button.dataset.tqBatchEdit))));
    wrap.querySelector('[data-tq-batch-prev]')?.addEventListener('click',()=>setBatchPreviewIndex(batchPreviewIndex-1,{focus:true}));wrap.querySelector('[data-tq-batch-next]')?.addEventListener('click',()=>setBatchPreviewIndex(batchPreviewIndex+1,{focus:true}));wrap.querySelectorAll('[data-tq-batch-jump]').forEach(button=>button.addEventListener('click',()=>setBatchPreviewIndex(Number(button.dataset.tqBatchJump))));
    setBatchPreviewIndex(batchPreviewIndex);updateBatchApplyState();
  }

  function parseCurrentPaste(){const raw=byId('tqPasteInput')?.value||'';if(pasteMode==='batch'){batchPreviewIndex=0;renderBatchResult(parseBatch(raw))}else renderSingleResult(parseSingle(raw))}

  function refreshBatchDefaultSummary(){
    const {subject}=batchContext();const subjectNode=byId('tqBatchDefaultSubject'),knowledgeNode=byId('tqBatchDefaultKnowledgeLabel'),tagsNode=byId('tqBatchDefaultTagsLabel');
    if(subjectNode)subjectNode.textContent=subject?`${subject.code} · ${subject.name?.zh||''}`:'当前题库';
    if(knowledgeNode)knowledgeNode.textContent=batchDefaults.knowledgeMode==='node'&&batchDefaults.knowledge?.primaryNodeId?(batchDefaults.knowledge.pathSnapshot||[]).join(' > '):batchDefaults.knowledgeMode==='unmapped'?'默认待分类':'未设置（模板优先）';
    if(tagsNode)tagsNode.textContent=batchDefaults.tags.length?batchDefaults.tags.join('、'):'未设置（模板优先）';
  }
  function rerenderBatchAfterClassification(){refreshBatchDefaultSummary();if(parsedBatch)renderBatchResult(parsedBatch)}
  function batchTaxonomy(){return batchContext().taxonomy}
  function batchKnowledgeNodes(){const taxonomy=batchTaxonomy();return taxonomy?Core?.nodesForTaxonomy?.(taxonomy.id)||[]:[]}
  function batchKnowledgePath(nodeId){const taxonomy=batchTaxonomy();return taxonomy&&nodeId?Core?.pathForNode?.(taxonomy.id,nodeId)||[]:[]}
  function renderBatchKnowledgePicker(){
    const taxonomy=batchTaxonomy(),columns=byId('tqBatchKnowledgeColumns'),selection=byId('tqBatchKnowledgeSelection');if(!columns||!selection)return;
    if(!taxonomy){columns.innerHTML='<div class="tq-batch-picker-empty">当前科目没有可用知识树。</div>';selection.textContent='待分类';return}
    const nodes=batchKnowledgeNodes().filter(node=>node.status!=='deprecated');const byParent=new Map();nodes.forEach(node=>{const key=node.parentId||'';if(!byParent.has(key))byParent.set(key,[]);byParent.get(key).push(node)});byParent.forEach(list=>list.sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)||(a.title?.zh||'').localeCompare(b.title?.zh||'','zh-CN')));
    const path=batchEditor.knowledgeId?batchKnowledgePath(batchEditor.knowledgeId):[];const columnParents=['',...path.map(node=>node.id)];const selectedIds=new Set(path.map(node=>node.id));
    columns.innerHTML=columnParents.map((parentId,index)=>{const list=byParent.get(parentId)||[];if(!list.length)return '';return `<div class="tq-batch-knowledge-column"><strong>第 ${index+1} 层</strong>${list.map(node=>`<button type="button" class="${selectedIds.has(node.id)?'selected':''}" data-tq-batch-node="${escapeHTML(node.id)}"><span>${escapeHTML(node.title?.zh||node.id)}</span><small>${escapeHTML(node.code||'')}</small></button>`).join('')}</div>`}).join('')||'<div class="tq-batch-picker-empty">没有可选知识点。</div>';
    columns.querySelectorAll('[data-tq-batch-node]').forEach(button=>button.addEventListener('click',()=>{batchEditor.knowledgeMode='node';batchEditor.knowledgeId=button.dataset.tqBatchNode;renderBatchKnowledgePicker()}));
    selection.textContent=batchEditor.knowledgeMode==='node'&&batchEditor.knowledgeId?batchKnowledgePath(batchEditor.knowledgeId).map(node=>node.title?.zh||node.id).join(' > '):'待分类';
  }
  function renderBatchKnowledgeSearch(){
    const input=byId('tqBatchKnowledgeSearch'),wrap=byId('tqBatchKnowledgeSearchResults'),taxonomy=batchTaxonomy();if(!input||!wrap)return;const query=clean(input.value);if(!query||!taxonomy){wrap.hidden=true;wrap.innerHTML='';return}
    const results=(Core?.searchNodes?.(taxonomy.id,query)||[]).filter(node=>node.status!=='deprecated').slice(0,24);wrap.hidden=false;wrap.innerHTML=results.length?results.map(node=>`<button type="button" data-tq-batch-search-node="${escapeHTML(node.id)}"><b>${escapeHTML(node.title?.zh||node.id)}</b><span>${escapeHTML(node.path||'')}</span></button>`).join(''):'<div class="tq-batch-picker-empty">没有匹配的知识点。</div>';
    wrap.querySelectorAll('[data-tq-batch-search-node]').forEach(button=>button.addEventListener('click',()=>{batchEditor.knowledgeMode='node';batchEditor.knowledgeId=button.dataset.tqBatchSearchNode;input.value='';renderBatchKnowledgeSearch();renderBatchKnowledgePicker()}));
  }
  function currentTagGroup(){return Classification?.TAG_GROUPS?.find(group=>group.id===batchEditor.tagGroupId)||Classification?.TAG_GROUPS?.[0]}
  function currentTagCategory(){const group=currentTagGroup();return group?.categories?.find(category=>category.id===batchEditor.tagCategoryId)||group?.categories?.[0]}
  function renderBatchTagPicker(){
    const groups=byId('tqBatchTagGroupList'),categories=byId('tqBatchTagCategoryList'),options=byId('tqBatchTagOptionList'),chips=byId('tqBatchTagChips');if(!groups||!categories||!options||!chips)return;const tagGroups=Classification?.TAG_GROUPS||[],group=currentTagGroup(),category=currentTagCategory();if(!group||!category)return;
    groups.innerHTML=tagGroups.map(item=>`<button type="button" class="${item.id===group.id?'active':''}" data-tq-batch-tag-group="${escapeHTML(item.id)}"><span>${escapeHTML(item.label)}</span><b>›</b></button>`).join('');categories.innerHTML=group.categories.map(item=>`<button type="button" class="${item.id===category.id?'active':''}" data-tq-batch-tag-category="${escapeHTML(item.id)}"><span>${escapeHTML(item.label)}</span><b>›</b></button>`).join('');options.innerHTML=category.options.map(option=>`<label><input type="checkbox" data-tq-batch-tag-option="${escapeHTML(option)}" ${batchEditor.tags.has(option)?'checked':''}/><span>${escapeHTML(option)}</span></label>`).join('');chips.innerHTML=batchEditor.tags.size?[...batchEditor.tags].map(tag=>`<span>${escapeHTML(tag)}</span>`).join(''):'<small>未选择默认标签</small>';
    groups.querySelectorAll('[data-tq-batch-tag-group]').forEach(button=>button.addEventListener('click',()=>{batchEditor.tagGroupId=button.dataset.tqBatchTagGroup;batchEditor.tagCategoryId=currentTagGroup()?.categories?.[0]?.id||'';renderBatchTagPicker()}));categories.querySelectorAll('[data-tq-batch-tag-category]').forEach(button=>button.addEventListener('click',()=>{batchEditor.tagCategoryId=button.dataset.tqBatchTagCategory;renderBatchTagPicker()}));options.querySelectorAll('[data-tq-batch-tag-option]').forEach(input=>input.addEventListener('change',()=>{input.checked?batchEditor.tags.add(input.dataset.tqBatchTagOption):batchEditor.tags.delete(input.dataset.tqBatchTagOption);renderBatchTagPicker()}));
  }
  function setBatchEditorTab(tab){batchEditor.tab=tab==='tags'?'tags':'knowledge';document.querySelectorAll('[data-tq-batch-class-tab]').forEach(button=>{const active=button.dataset.tqBatchClassTab===batchEditor.tab;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active))});if(byId('tqBatchKnowledgePane'))byId('tqBatchKnowledgePane').hidden=batchEditor.tab!=='knowledge';if(byId('tqBatchTagsPane'))byId('tqBatchTagsPane').hidden=batchEditor.tab!=='tags'}
  function openBatchClassificationEditor(mode='defaults',itemIndex=-1){
    batchEditor.mode=mode;batchEditor.itemIndex=itemIndex;batchEditor.tab='knowledge';const item=mode==='item'?parsedBatch?.items?.[itemIndex]:null;const effective=item?resolveBatchClassification(item):null;
    if(mode==='defaults'){batchEditor.knowledgeMode=batchDefaults.knowledgeMode;batchEditor.knowledgeId=batchDefaults.knowledge?.primaryNodeId||'';batchEditor.tags=new Set(batchDefaults.tags)}else{batchEditor.knowledgeMode=effective?.primaryNodeId?'node':'unmapped';batchEditor.knowledgeId=effective?.primaryNodeId||'';batchEditor.tags=new Set(effective?.tags||[])}
    const title=byId('tqBatchClassificationTitle'),context=byId('tqBatchClassificationContext'),subject=byId('tqBatchClassificationSubject'),reset=byId('tqBatchClassificationResetBtn');const ctx=batchContext();if(title)title.textContent=mode==='defaults'?'本批次默认分类':`第 ${item?.index||itemIndex+1} 题分类`;if(context)context.textContent=mode==='defaults'?'未填写单题分类字段时自动继承；模板字段仍优先。':'修改后仅覆盖这一题，不影响本批其他题目。';if(subject)subject.textContent=ctx.subject?`${ctx.subject.code} · ${ctx.subject.name?.zh||''}`:'当前题库';if(reset)reset.textContent=mode==='defaults'?'清除本批默认':'恢复模板 / 批次规则';
    if(byId('tqBatchKnowledgeSearch'))byId('tqBatchKnowledgeSearch').value='';if(byId('tqBatchCustomTagInput'))byId('tqBatchCustomTagInput').value='';setBatchEditorTab('knowledge');renderBatchKnowledgeSearch();renderBatchKnowledgePicker();renderBatchTagPicker();const dialog=byId('tqBatchClassificationDialog');dialog?.showModal?dialog.showModal():dialog?.setAttribute('open','');
  }
  function applyBatchClassificationEditor(){
    const dialog=byId('tqBatchClassificationDialog');if(batchEditor.mode==='defaults'){
      batchDefaults.knowledgeMode=batchEditor.knowledgeMode;batchDefaults.knowledge=batchEditor.knowledgeMode==='node'&&batchEditor.knowledgeId?resolutionFromNode(batchEditor.knowledgeId,'batch-default'):null;batchDefaults.tags=unique([...batchEditor.tags]);dialog?.close();rerenderBatchAfterClassification();return;
    }
    const item=parsedBatch?.items?.[batchEditor.itemIndex];if(!item)return;const automatic=resolveBatchClassification(item,{ignoreOverride:true});const override={};const selectedKnowledgeId=batchEditor.knowledgeMode==='node'?batchEditor.knowledgeId:'';
    if((automatic?.primaryNodeId||'')!==selectedKnowledgeId){override.knowledgeMode=selectedKnowledgeId?'node':'unmapped';override.knowledge=selectedKnowledgeId?resolutionFromNode(selectedKnowledgeId,'item-override'):null}
    if(!sameTags(automatic?.tags||[],[...batchEditor.tags]))override.tags=unique([...batchEditor.tags]);
    if(Object.keys(override).length)item._batchClassificationOverride=override;else delete item._batchClassificationOverride;dialog?.close();renderBatchResult(parsedBatch);
  }
  function resetBatchClassificationEditor(){
    const dialog=byId('tqBatchClassificationDialog');if(batchEditor.mode==='defaults'){batchDefaults.knowledgeMode='auto';batchDefaults.knowledge=null;batchDefaults.tags=[];dialog?.close();rerenderBatchAfterClassification();return}
    const item=parsedBatch?.items?.[batchEditor.itemIndex];if(item)delete item._batchClassificationOverride;dialog?.close();renderBatchResult(parsedBatch);
  }
  function addBatchCustomTag(){const input=byId('tqBatchCustomTagInput'),value=clean(input?.value);if(!value)return;if(input)input.value='';batchEditor.tags.add(value);renderBatchTagPicker()}

  function keywordId(item,index){
    const seed=clean(item.zh||item.en||`keyword-${index+1}`).toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g,'-').replace(/^-+|-+$/g,'').slice(0,28);
    return `clue-${seed||index+1}-${index+1}`;
  }
  function parsedToQuestion(result){
    const plain=(result.stem||result.stemEn||'').replace(/\s+/g,' ');
    const keywords=(result.keywords||[]).map((item,index)=>({...item,id:keywordId(item,index)}));
    const clues=keywords.map(item=>({id:item.id,text:item.zh||item.en,textEn:item.en||'',type:'core',clueRole:'true',sourceType:item.locationsZh?.[0]?.field||'stem',sourceOptionId:item.locationsZh?.[0]?.optionId||'',conceptIds:[],explain:'',recallNodeId:item.entry||item.zh||item.en,recallEntryLabel:item.entry||'',sourceMode:'p2.1-bilingual-import',matchLocations:item.locationsZh||[]}));
    const resolution=result.classification||resolveClassification(result,pasteMode==='batch');const knowledge=Classification?.knowledgeMetadataFromResolution?.(resolution)||{taxonomyId:'',taxonomyVersion:1,primaryNodeId:null,relatedNodeIds:[],mappingStatus:'unmapped',pathSnapshot:[]};
    const type=result.type==='multiple_choice'?'multiple_choice':'single_choice',correctOptionIds=type==='multiple_choice'?(result.correctOptionIds||[]):[];
    const question={title:result.title||plain.slice(0,48)+(plain.length>48?'…':''),type,subject:resolution?.subjectCode||'',difficulty:'中等',domain:'',topic:result.topic||'',tags:unique(resolution?.tags||result.tags||[]),stemParts:P2?.markStemParts?.(result.stem||result.stemEn,keywords,'zh')||[{text:result.stem||result.stemEn}],options:result.options.map(option=>({id:option.id,text:option.text||option.textEn,trap:'',correct:type==='multiple_choice'?correctOptionIds.includes(option.id):option.id===result.answer})),correctAnswer:type==='multiple_choice'?null:result.answer,correctOptionIds,analysis:result.analysis||'',clues,concepts:[],reasoningSteps:[],metadata:{translationStatus:result.language,subjectId:resolution?.subjectId||'',knowledge,classificationImport:{subject:result.subject||'',knowledge:result.knowledge||'',matchStatus:resolution?.matchStatus||'empty',importedAt:new Date().toISOString()},bilingualKeywordMappings:keywords.map(item=>({zh:item.zh,en:item.en,entry:item.entry}))},status:{contentReady:true,keywordsReady:clues.length>0,knowledgeReady:!!knowledge.primaryNodeId,reasoningReady:false,published:false}};
    if(result.language==='bilingual'||result.language==='en_only')question.translations={en:{title:result.titleEn||'',stemParts:P2?.markStemParts?.(result.stemEn,keywords,'en')||[{text:result.stemEn}],options:result.options.map(option=>({id:option.id,text:option.textEn||''})),analysis:result.analysisEn||''}};
    return question;
  }
  async function applySingleQuestion(){
    const result=parsedQuestion;if(!result||result.errors.length)return;const api=window.KGQuestionBankAdminAPI;if(!api)return;
    const question=parsedToQuestion(result),current=api.getCurrentQuestion?.();
    const placeholder=current&&!current.status?.contentReady&&(/未命名|新题/.test(current.title||'')||String((current.stemParts||[]).map(item=>item.text||'').join('')).includes('请在这里输入题干'));
    const saved=placeholder?api.updateCurrentQuestion?.(question):await api.bulkAddQuestions?.([question]);
    if(saved?.duplicates?.length){byId('tqParseSummary').textContent='发现题干完全重复，未新建题目。';return}
    setEntryMode('manual');setEditorLanguage(result.language==='bilingual'?'bilingual':'zh');setTimeout(()=>{click('[data-main-tab="base"]');byId('questionStemInput')?.scrollIntoView({behavior:'smooth',block:'center'})},0);
  }

  async function applyBatchQuestions(){
    if(!batchImportEnabled())return;const api=window.KGQuestionBankAdminAPI;if(!api?.bulkAddQuestions)return;
    const items=parsedBatch.items.filter(item=>!item.errors.length).map(parsedToQuestion);const result=await api.bulkAddQuestions(items);
    if(result.added?.length){resetPaste();click('[data-qb-tab="questions"]');setEntryMode('manual')}
  }
  async function applyParsed(){if(pasteMode==='batch')await applyBatchQuestions();else await applySingleQuestion()}

  function resetParseResult(clear=true){
    if(clear&&byId('tqPasteInput'))byId('tqPasteInput').value='';parsedQuestion=null;parsedBatch=null;batchPreviewIndex=0;
    if(byId('tqParseSummary'))byId('tqParseSummary').textContent='等待粘贴题目';if(byId('tqParseResult'))byId('tqParseResult').innerHTML='<div class="tq-parse-empty">粘贴后点击“解析”，系统会识别中英文题干、A-D、答案、解析、科目、知识点、标签和可选关键词。</div>';
    if(byId('tqApplyParsedBtn')){byId('tqApplyParsedBtn').disabled=true;byId('tqApplyParsedBtn').textContent=pasteMode==='batch'?'批量导入题库':'确认并进入编辑'}
  }
  function resetPaste(){resetParseResult(true)}

  function selectedTemplate(){const key=byId('tqTemplateSelect')?.value||'bilingual';return P2?.TEMPLATE_FILES?.[key]||P2?.TEMPLATE_FILES?.bilingual}
  function downloadTemplate(){const template=selectedTemplate();if(!template)return;const blob=new Blob(['\ufeff'+template.text],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=template.filename;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),0)}
  async function copyTemplate(){const template=selectedTemplate();if(!template)return;try{await navigator.clipboard.writeText(template.text)}catch(error){const area=document.createElement('textarea');area.value=template.text;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove()}const old=byId('tqCopyTemplateBtn')?.textContent;if(byId('tqCopyTemplateBtn')){byId('tqCopyTemplateBtn').textContent='已复制';setTimeout(()=>{if(byId('tqCopyTemplateBtn'))byId('tqCopyTemplateBtn').textContent=old||'复制模板'},1200)}}
  function showTemplateExample(){const details=byId('tqTemplateExample'),pre=byId('tqTemplateExampleText');if(!details||!pre)return;pre.textContent=P2?.TEMPLATE_TEXTS?.example||'';details.hidden=false;details.open=true;details.scrollIntoView({behavior:'smooth',block:'nearest'})}
  function setEditorLanguage(next){editorLanguage=['zh','en','bilingual'].includes(next)?next:'zh';document.body.classList.toggle('tq-editor-lang-en',editorLanguage==='en');document.body.classList.toggle('tq-editor-lang-bilingual',editorLanguage==='bilingual');document.querySelectorAll('[data-tq-editor-language]').forEach(button=>{const active=button.dataset.tqEditorLanguage===editorLanguage;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))})}

  function replaceTagName(values,oldName,newName){return unique((values||[]).map(tag=>tag===oldName?newName:tag))}
  function applyTagRenameToParsedItem(item,oldName,newName){
    if(!item)return;item.tags=replaceTagName(item.tags,oldName,newName);
    if(item.classification)item.classification.tags=replaceTagName(item.classification.tags,oldName,newName);
    if(item._batchClassificationOverride&&Object.prototype.hasOwnProperty.call(item._batchClassificationOverride,'tags'))item._batchClassificationOverride.tags=replaceTagName(item._batchClassificationOverride.tags,oldName,newName);
  }
  function handleTagRename(event){
    const oldName=clean(event?.detail?.oldName),newName=clean(event?.detail?.newName);if(!oldName||!newName||oldName===newName)return;
    batchDefaults.tags=replaceTagName(batchDefaults.tags,oldName,newName);batchEditor.tags=new Set(replaceTagName([...batchEditor.tags],oldName,newName));
    applyTagRenameToParsedItem(parsedQuestion,oldName,newName);(parsedBatch?.items||[]).forEach(item=>applyTagRenameToParsedItem(item,oldName,newName));
    if(parsedBatch)rerenderBatchAfterClassification();else if(parsedQuestion)renderSingleResult(parsedQuestion);else refreshBatchDefaultSummary();
  }

  function bindQuickEntry(){
    document.querySelectorAll('[data-tq-entry-mode]').forEach(button=>button.addEventListener('click',()=>setEntryMode(button.dataset.tqEntryMode)));
    document.querySelectorAll('[data-tq-paste-mode]').forEach(button=>button.addEventListener('click',()=>setPasteMode(button.dataset.tqPasteMode)));
    byId('tqParseBtn')?.addEventListener('click',parseCurrentPaste);byId('tqApplyParsedBtn')?.addEventListener('click',applyParsed);byId('tqClearPasteBtn')?.addEventListener('click',resetPaste);byId('tqImportValidOnly')?.addEventListener('change',updateBatchApplyState);
    byId('tqBatchDefaultEditBtn')?.addEventListener('click',()=>openBatchClassificationEditor('defaults'));byId('tqBatchDefaultsClearBtn')?.addEventListener('click',()=>{batchDefaults.knowledgeMode='auto';batchDefaults.knowledge=null;batchDefaults.tags=[];rerenderBatchAfterClassification()});
    document.querySelectorAll('[data-tq-batch-class-tab]').forEach(button=>button.addEventListener('click',()=>setBatchEditorTab(button.dataset.tqBatchClassTab)));byId('tqBatchKnowledgeSearch')?.addEventListener('input',renderBatchKnowledgeSearch);byId('tqBatchKnowledgeUnmappedBtn')?.addEventListener('click',()=>{batchEditor.knowledgeMode='unmapped';batchEditor.knowledgeId='';renderBatchKnowledgePicker()});byId('tqBatchClassificationApplyBtn')?.addEventListener('click',applyBatchClassificationEditor);byId('tqBatchClassificationResetBtn')?.addEventListener('click',resetBatchClassificationEditor);byId('tqBatchCustomTagInput')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();addBatchCustomTag()}});
    byId('tqDownloadTemplateBtn')?.addEventListener('click',downloadTemplate);byId('tqCopyTemplateBtn')?.addEventListener('click',copyTemplate);byId('tqShowTemplateExampleBtn')?.addEventListener('click',showTemplateExample);
    document.querySelectorAll('[data-tq-editor-language]').forEach(button=>button.addEventListener('click',()=>setEditorLanguage(button.dataset.tqEditorLanguage)));
    byId('tqPasteInput')?.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();parseCurrentPaste()}});
    setPasteMode('single');setEditorLanguage('zh');
  }

  function installTrainingPreview(){
    const panel=byId('qbQuestionTabPanel');if(!panel||byId('tqTrainingPreview'))return;const preview=document.createElement('section');preview.className='tq-training-preview';preview.id='tqTrainingPreview';preview.setAttribute('aria-label','当前题目的题干、选项与解析预览');panel.appendChild(preview);
    const update=()=>{
      const stem=clean(byId('questionStemInput')?.value)||'从上方题目列表选择一道题目。';
      const correct=new Set([...document.querySelectorAll('#qbOptionsEditor input[name="correctOption"]:checked')].map(input=>clean(input.value)));
      const options=[...document.querySelectorAll('#qbOptionsEditor .qb-option-row')].map(row=>({id:clean(row.querySelector('.option-id')?.value),text:clean(row.querySelector('.option-text')?.value)})).filter(item=>item.id||item.text);
      const analysis=clean(byId('questionAnalysisInput')?.value);
      preview.innerHTML=`<div class="tq-training-preview-head"><div><span>题目预览</span><strong>题干、选项与解析</strong></div><em>随当前题目即时更新</em></div><div class="tq-training-preview-scroll"><section class="tq-training-preview-section"><h4>题干</h4><p class="tq-training-stem">${escapeHTML(stem)}</p></section><section class="tq-training-preview-section"><h4>选项</h4><div class="tq-training-options">${options.length?options.map(item=>`<div class="tq-training-option ${correct.has(item.id)?'correct':''}"><b>${escapeHTML(item.id)}</b><span>${escapeHTML(item.text)}</span>${correct.has(item.id)?'<em>正确答案</em>':''}</div>`).join(''):'<div class="tq-training-preview-empty">尚未设置选项。</div>'}</div></section><section class="tq-training-preview-section tq-training-analysis"><h4>解析</h4><p>${analysis?escapeHTML(analysis):'尚未填写解析。'}</p></section></div>`;
    };
    document.addEventListener('click',event=>{if(event.target.closest('[data-question-id],#qbAddQuestionBtn'))setTimeout(update,0)});document.addEventListener('kg-question-form-filled',()=>setTimeout(update,0));
    const optionWrap=byId('qbOptionsEditor');if(optionWrap){new MutationObserver(update).observe(optionWrap,{childList:true,subtree:true,attributes:true,attributeFilter:['checked']});optionWrap.addEventListener('input',update);optionWrap.addEventListener('change',update)}
    byId('questionStemInput')?.addEventListener('input',update);byId('questionAnalysisInput')?.addEventListener('input',update);setTimeout(update,0);
  }

  function configureSimple(){
    document.body.classList.add('qb-simple-mode',step==='training'?'qb-training-step':'qb-question-step');updateShell();const advanced=byId('tqAdvancedLink');if(advanced)advanced.href='question-bank.html?mode=advanced&step='+encodeURIComponent(step);
    setText('.qb-brand h1',step==='training'?'训练配置':'题目管理');setText('.qb-brand p',step==='training'?'先在顶部选择科目，再从该科目的题库中核对原题；右侧只维护当前题目的关键词与知识联想入口。':'逐题或批量粘贴完整单选题，校对后保存；训练和课程继续引用同一题目。');
    document.querySelector('[data-main-tab="banks"]')?.replaceChildren(document.createTextNode('题库与题目'));document.querySelector('[data-main-tab="base"]')?.replaceChildren(document.createTextNode('题目内容'));insertGuide();bindQuickEntry();
    if(step==='training'){
      const strip=document.querySelector('.qb-subject-strip>div');if(strip){const title=strip.querySelector('strong'),hint=strip.querySelector('span');if(title)title.textContent='选择训练科目';if(hint)hint.textContent='点击科目按钮切换；当前科目使用深灰色底纹，题库下拉框只显示该科目的题库。'}
      click('[data-layout-nav="questions"]');click('[data-annotation-tab="recall"]');installTrainingFilterToggle();installTrainingPreview();initTrainingWorkspaceSplitter();initTrainingHeightSplitters();byId('tqSaveTrainingBtn')?.addEventListener('click',()=>byId('qbSyncRecallConfigBtn')?.click())
    }
    else{const requestedView=params.get('view'),requestedEntry=params.get('entry');click(requestedView==='content'?'[data-main-tab="base"]':'[data-main-tab="banks"]');const startNew=()=>{click('[data-main-tab="base"]');setEntryMode('paste');setPasteMode('single');resetPaste()};byId('tqNewQuestionBtn')?.addEventListener('click',startNew);byId('tqOpenQuestionBtn')?.addEventListener('click',()=>{click('[data-main-tab="base"]');setEntryMode('manual')});byId('qbAddQuestionBtn')?.addEventListener('click',()=>setTimeout(()=>{click('[data-main-tab="base"]');setEntryMode('paste');setPasteMode('single');resetPaste()},0));setEntryMode(requestedEntry==='manual'?'manual':'paste');if(requestedView==='content'&&requestedEntry!=='manual')requestAnimationFrame(()=>byId('tqPasteInput')?.focus())}
  }
  function configureAdvanced(){document.body.classList.add('qb-advanced-mode');const advanced=byId('tqAdvancedLink');if(advanced){advanced.textContent='返回简化工作流';advanced.href='question-bank.html?mode=simple&step='+encodeURIComponent(step)}document.querySelectorAll('[data-tq-step],[data-tq-step-flow]').forEach(link=>link.classList.remove('active','done'))}
  document.addEventListener('kg-tag-renamed',handleTagRename);
  document.addEventListener('DOMContentLoaded',()=>mode==='simple'?configureSimple():configureAdvanced());
})();
