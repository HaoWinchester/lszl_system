'use strict';

(function(){
  const Parser=window.QuestionStudioParser;
  const Schema=window.KGActivitySchemaV1;
  const Taxonomy=window.QuestionStudioKnowledgeTaxonomy;
  const Sync=window.QuestionStudioSync;
  const DRAFT_KEY='question_studio_draft_v021';
  const BACKUP_KEY='question_studio_backups_v021';
  const LEGACY_DRAFT_KEY='question_studio_draft_v020';
  const OLDER_DRAFT_KEY='question_studio_draft_v010';
  const LEGACY_BACKUP_KEY='question_studio_backups_v020';
  const OLDER_BACKUP_KEY='question_studio_backups_v010';
  const MAX_BACKUPS=10;
  const TYPE_LABELS={single_choice:'单项选择',keyword_recognition:'关键词识别',open_response:'开放表达',ordering:'排序',matching:'连线配对'};
  const TYPE_ORDER=Object.keys(TYPE_LABELS);
  const $=id=>document.getElementById(id);
  const clean=value=>String(value??'').trim();
  const SUBJECT_PREF_KEY='kg_teacher_workbench_subject_v1';
  const RECENT_KNOWLEDGE_KEY='question_studio_recent_knowledge_v1';
  const FAVORITE_KNOWLEDGE_KEY='question_studio_favorite_knowledge_v1';
  const preferredSubject=clean(localStorage.getItem(SUBJECT_PREF_KEY));
  const state={activities:[],currentIndex:-1,rawText:'',parserIssues:[],previewLanguage:'zh',previewState:new Map(),saveTimer:null,dirty:false,batchSubjectId:Taxonomy.subjects().some(item=>item.id===preferredSubject)?preferredSubject:'subject-pmp',batchTaxonomyId:'taxonomy-pmp-main',batchKnowledgeNodeId:'',picker:{mode:'batch',tab:'browse',subjectId:'subject-pmp',taxonomyId:'',parentId:null,selectedNodeId:'',query:''}};
  const clone=value=>{try{return JSON.parse(JSON.stringify(value))}catch(error){return value}};
  const escapeHTML=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  function toast(message){const el=$('qsToast');el.textContent=String(message||'');el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2600)}
  function runtimeFor(type){return Parser.RUNTIME[type]||'unknown'}
  function adapterFor(type){return Parser.ADAPTER[type]||'unknown'}
  function batchTaxonomy(){return Taxonomy.defaultTaxonomy(state.batchSubjectId)}
  function knowledgeDefaults(){const taxonomy=batchTaxonomy();return {subjectId:state.batchSubjectId,taxonomyId:taxonomy?.id||'',taxonomyVersion:Number(taxonomy?.version)||1,primaryNodeId:state.batchKnowledgeNodeId||null,relatedNodeIds:[],mappingStatus:state.batchKnowledgeNodeId?'confirmed':'unmapped',pathSnapshot:state.batchKnowledgeNodeId?Taxonomy.path(taxonomy?.id,state.batchKnowledgeNodeId).map(node=>node.title):[]}}
  function applyKnowledge(activity,subjectId=state.batchSubjectId,primaryNodeId=state.batchKnowledgeNodeId,taxonomyId=''){
    const taxonomy=Taxonomy.taxonomy(taxonomyId)||Taxonomy.defaultTaxonomy(subjectId);activity.metadata=activity.metadata||{};activity.metadata.subjectId=subjectId;activity.metadata.knowledge={...(activity.metadata.knowledge||{}),taxonomyId:taxonomy?.id||'',taxonomyVersion:Number(taxonomy?.version)||1,primaryNodeId:primaryNodeId||null,relatedNodeIds:Array.isArray(activity.metadata.knowledge?.relatedNodeIds)?activity.metadata.knowledge.relatedNodeIds:[],mappingStatus:primaryNodeId?'confirmed':'unmapped',pathSnapshot:primaryNodeId?Taxonomy.path(taxonomy?.id,primaryNodeId).map(node=>node.title):[]};return activity
  }
  function knowledgeValidation(activity){const errors=[],warnings=[];const subjectId=clean(activity?.metadata?.subjectId),knowledge=activity?.metadata?.knowledge||{};if(!subjectId)errors.push('必须选择科目。');if(!clean(knowledge.taxonomyId))errors.push('必须选择知识树。');if(!clean(knowledge.primaryNodeId))errors.push('必须选择主知识点。');else if(!Taxonomy.validMapping(subjectId,knowledge.taxonomyId,knowledge.primaryNodeId))errors.push('主知识点与科目/知识树不一致。');if(Number(knowledge.taxonomyVersion||0)<1)errors.push('知识树版本无效。');return {valid:errors.length===0,errors,warnings}}
  function renderBatchSelectors(){
    const subjects=Taxonomy.subjects();$('qsBatchSubject').innerHTML=subjects.map(item=>`<option value="${escapeHTML(item.id)}" ${item.id===state.batchSubjectId?'selected':''}>${escapeHTML(item.name)}</option>`).join('');
    const taxonomy=batchTaxonomy();state.batchTaxonomyId=taxonomy?.id||'';const nodes=Taxonomy.nodes(state.batchTaxonomyId);if(state.batchKnowledgeNodeId&&!nodes.some(node=>node.id===state.batchKnowledgeNodeId))state.batchKnowledgeNodeId='';
    $('qsBatchKnowledge').innerHTML='<option value="">请选择默认主知识点</option>'+nodes.map(node=>`<option value="${escapeHTML(node.id)}" ${node.id===state.batchKnowledgeNodeId?'selected':''}>${escapeHTML(Taxonomy.pathLabel(state.batchTaxonomyId,node.id))}</option>`).join('');
    $('qsBatchKnowledge').value=state.batchKnowledgeNodeId||'';$('qsBatchKnowledgeLabel').textContent=state.batchKnowledgeNodeId?Taxonomy.pathLabel(state.batchTaxonomyId,state.batchKnowledgeNodeId):'请选择默认主知识点';
    localStorage.setItem(SUBJECT_PREF_KEY,state.batchSubjectId);const user=Sync.currentUser?.()||{name:'本地教师'};$('qsShellAccount').textContent=user.name||user.id||'本地教师';
    const mode=Sync.mode();$('qsModeState').textContent=mode==='server'?'在线服务器直连':mode==='offline-file'?'离线文件模式 · 使用 JSON 备份':'同源浏览器活动库直连';$('qsSubmitLibraryBtn').disabled=mode==='offline-file';$('qsSubmitLibraryBtn').title=mode==='offline-file'?'运行 serve.py 或部署服务器后可一键提交':'';
  }
  function readKnowledgeList(key){try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value:[]}catch(error){return []}}
  function writeKnowledgeList(key,list){localStorage.setItem(key,JSON.stringify((list||[]).slice(0,30)))}
  function recentKnowledge(){return readKnowledgeList(RECENT_KNOWLEDGE_KEY)}
  function favoriteKnowledge(){return readKnowledgeList(FAVORITE_KNOWLEDGE_KEY)}
  function rememberKnowledge(subjectId,taxonomyId,nodeId){const list=recentKnowledge().filter(item=>!(item.taxonomyId===taxonomyId&&item.nodeId===nodeId));list.unshift({subjectId,taxonomyId,nodeId,usedAt:new Date().toISOString()});writeKnowledgeList(RECENT_KNOWLEDGE_KEY,list)}
  function pickerActivity(){return state.picker.mode==='activity'?current():null}
  function openKnowledgePicker(mode='batch'){
    state.picker.mode=mode;state.picker.tab='browse';state.picker.query='';state.picker.parentId=null;
    if(mode==='activity'){const activity=current();if(!activity)return;state.picker.subjectId=activity.metadata?.subjectId||state.batchSubjectId;state.picker.taxonomyId=activity.metadata?.knowledge?.taxonomyId||Taxonomy.defaultTaxonomy(state.picker.subjectId)?.id||'';state.picker.selectedNodeId=activity.metadata?.knowledge?.primaryNodeId||''}
    else{state.picker.subjectId=state.batchSubjectId;state.picker.taxonomyId=state.batchTaxonomyId||Taxonomy.defaultTaxonomy(state.batchSubjectId)?.id||'';state.picker.selectedNodeId=state.batchKnowledgeNodeId||''}
    $('qsPickerSearch').value='';renderKnowledgePicker();$('qsKnowledgeDialog').showModal();setTimeout(()=>$('qsPickerSearch').focus(),40)
  }
  function pickerSubjectOptions(){return Taxonomy.subjects().map(item=>`<option value="${escapeHTML(item.id)}" ${item.id===state.picker.subjectId?'selected':''}>${escapeHTML(item.name)}</option>`).join('')}
  function pickerTaxonomyOptions(){return Taxonomy.taxonomies(state.picker.subjectId).map(item=>`<option value="${escapeHTML(item.id)}" ${item.id===state.picker.taxonomyId?'selected':''}>${escapeHTML(item.name)} · v${item.version}</option>`).join('')}
  function pickerEntries(){
    const q=clean(state.picker.query);if(q)return Taxonomy.search(state.picker.taxonomyId,q).slice(0,80);
    if(state.picker.tab==='recent'){const ids=recentKnowledge().filter(item=>item.taxonomyId===state.picker.taxonomyId).map(item=>item.nodeId);const byId=new Map(Taxonomy.nodes(state.picker.taxonomyId).map(node=>[node.id,node]));return ids.map(id=>byId.get(id)).filter(Boolean)}
    if(state.picker.tab==='favorite'){const ids=favoriteKnowledge().filter(item=>item.taxonomyId===state.picker.taxonomyId).map(item=>item.nodeId);const byId=new Map(Taxonomy.nodes(state.picker.taxonomyId).map(node=>[node.id,node]));return ids.map(id=>byId.get(id)).filter(Boolean)}
    return Taxonomy.children(state.picker.taxonomyId,state.picker.parentId);
  }
  function renderKnowledgePicker(){
    $('qsPickerSubject').innerHTML=pickerSubjectOptions();const taxonomies=Taxonomy.taxonomies(state.picker.subjectId);if(!taxonomies.some(item=>item.id===state.picker.taxonomyId))state.picker.taxonomyId=taxonomies[0]?.id||'';$('qsPickerTaxonomy').innerHTML=pickerTaxonomyOptions();
    document.querySelectorAll('[data-picker-tab]').forEach(button=>button.classList.toggle('active',button.dataset.pickerTab===state.picker.tab));
    const parentPath=state.picker.parentId?Taxonomy.path(state.picker.taxonomyId,state.picker.parentId):[];$('qsPickerBreadcrumb').innerHTML=`<button type="button" data-picker-parent="">全部</button>${parentPath.map(node=>`<span>›</span><button type="button" data-picker-parent="${escapeHTML(node.id)}">${escapeHTML(node.title)}</button>`).join('')}`;
    const favorites=new Set(favoriteKnowledge().filter(item=>item.taxonomyId===state.picker.taxonomyId).map(item=>item.nodeId));const entries=pickerEntries();
    $('qsPickerResults').innerHTML=entries.length?entries.map(node=>{const childCount=Taxonomy.children(state.picker.taxonomyId,node.id).length;const path=Taxonomy.pathLabel(state.picker.taxonomyId,node.id);return `<article class="qs-picker-row ${node.id===state.picker.selectedNodeId?'selected':''}"><button type="button" class="qs-picker-select" data-picker-node="${escapeHTML(node.id)}"><strong>${escapeHTML(node.title)}</strong><small>${escapeHTML(path)}</small><em>${escapeHTML(node.code||'L'+node.level)}</em></button><button type="button" class="qs-picker-star ${favorites.has(node.id)?'active':''}" data-picker-star="${escapeHTML(node.id)}" title="收藏">${favorites.has(node.id)?'★':'☆'}</button>${childCount?`<button type="button" class="qs-picker-open" data-picker-open="${escapeHTML(node.id)}">下级 ${childCount} ›</button>`:''}</article>`}).join(''):`<div class="qs-empty qs-picker-empty">${state.picker.tab==='recent'?'暂无最近使用记录。':state.picker.tab==='favorite'?'暂无收藏知识点。':'当前层级没有知识点。'}</div>`;
    const selected=state.picker.selectedNodeId;$('qsPickerSelected').textContent=selected?`已选择：${Taxonomy.pathLabel(state.picker.taxonomyId,selected)}`:'尚未选择知识点';const favorite=favoriteKnowledge().some(item=>item.taxonomyId===state.picker.taxonomyId&&item.nodeId===selected);$('qsPickerFavoriteBtn').textContent=favorite?'★ 取消收藏':'☆ 收藏当前';$('qsPickerFavoriteBtn').disabled=!selected;
  }
  function toggleFavorite(nodeId=state.picker.selectedNodeId){if(!nodeId)return;let list=favoriteKnowledge();const index=list.findIndex(item=>item.taxonomyId===state.picker.taxonomyId&&item.nodeId===nodeId);if(index>=0)list.splice(index,1);else list.unshift({subjectId:state.picker.subjectId,taxonomyId:state.picker.taxonomyId,nodeId});writeKnowledgeList(FAVORITE_KNOWLEDGE_KEY,list);renderKnowledgePicker()}
  function confirmKnowledgePicker(){const nodeId=state.picker.selectedNodeId;if(!nodeId)return toast('请先选择主知识点。');const taxonomy=Taxonomy.taxonomy(state.picker.taxonomyId);if(!taxonomy)return toast('知识树不存在。');if(state.picker.mode==='batch'){state.batchSubjectId=state.picker.subjectId;state.batchTaxonomyId=state.picker.taxonomyId;state.batchKnowledgeNodeId=nodeId;renderBatchSelectors()}else{const activity=pickerActivity();if(!activity)return;activity.metadata=activity.metadata||{};activity.metadata.subjectId=state.picker.subjectId;activity.metadata.knowledge={...(activity.metadata.knowledge||{}),taxonomyId:state.picker.taxonomyId,taxonomyVersion:Number(taxonomy.version)||1,primaryNodeId:nodeId,relatedNodeIds:Array.isArray(activity.metadata.knowledge?.relatedNodeIds)?activity.metadata.knowledge.relatedNodeIds:[],mappingStatus:'confirmed',pathSnapshot:Taxonomy.path(state.picker.taxonomyId,nodeId).map(node=>node.title)}}rememberKnowledge(state.picker.subjectId,state.picker.taxonomyId,nodeId);$('qsKnowledgeDialog').close();renderAll();scheduleSave();toast('主知识点已选择。')}
  function blankActivity(type='single_choice',common={}){
    const id=common.id||`activity-${Date.now().toString(36)}`;
    const base={
      id,type,schemaVersion:1,content:{zh:{},en:null},answer:{},
      explanation:{zh:{short:'',detailed:'',incorrect:'',general:''},en:null},
      assessment:{language:'zh'},config:{},
      metadata:{stage:'',part:'',topic:'',tags:[],author:'',source:'question-studio-v0.2.1.2',runtimeType:runtimeFor(type),adapter:adapterFor(type),translationStatus:'zh_only',subjectId:state.batchSubjectId,knowledge:knowledgeDefaults()}
    };
    if(type==='single_choice'){
      base.content.zh={stem:'',options:[{id:'A',text:''},{id:'B',text:''}]};base.answer={optionId:'A'};
    }else if(type==='keyword_recognition'){
      base.content.zh={instruction:'请选择符合要求的关键词或语句。',segments:[{id:'segment-1',text:''}],hints:[]};base.answer={segmentIds:['segment-1'],requiredSelectionCount:1};
    }else if(type==='ordering'){
      base.content.zh={instruction:'请按照正确顺序排列。',items:[{id:'item-1',text:''},{id:'item-2',text:''}],hints:[]};base.answer={itemIds:['item-1','item-2']};base.config={displayOrder:['item-2','item-1']};
    }else if(type==='matching'){
      base.content.zh={instruction:'请完成全部配对。',pairs:[{id:'pair-1',left:'',right:''}]};base.answer={matches:[{leftId:'pair-1',rightId:'pair-1'}]};base.config={rightOrder:['pair-1']};
    }else if(type==='open_response'){
      base.content.zh={prompt:'请使用中文作答。',placeholder:'',referenceAnswer:''};base.answer={evaluationMode:'concept_match',minLength:10,maxLength:300,acceptedConcepts:{zh:[{id:'concept-1',acceptedExpressions:[''],missingHint:''}]}};
    }
    if(common.metadata)base.metadata={...base.metadata,...clone(common.metadata)};
    if(common.explanation)base.explanation=clone(common.explanation);
    return base;
  }
  function current(){return state.activities[state.currentIndex]||null}
  function getPath(source,path){return String(path||'').split('.').reduce((value,key)=>value==null?undefined:value[key],source)}
  function setPath(source,path,value){
    const keys=String(path||'').split('.');let target=source;
    keys.forEach((key,index)=>{
      const last=index===keys.length-1;
      if(last){target[key]=value;return}
      const next=keys[index+1];
      if(target[key]==null||typeof target[key]!=='object')target[key]=/^\d+$/.test(next)?[]:{};
      target=target[key];
    });
  }
  function hasContent(value){
    if(value==null)return false;
    if(typeof value==='string')return Boolean(clean(value));
    if(Array.isArray(value))return value.some(hasContent);
    if(typeof value==='object')return Object.values(value).some(hasContent);
    return false;
  }
  function normalizeActivity(activity){
    activity.schemaVersion=1;
    activity.assessment={language:'zh'};
    activity.metadata=activity.metadata&&typeof activity.metadata==='object'?activity.metadata:{};
    activity.metadata.runtimeType=runtimeFor(activity.type);
    activity.metadata.adapter=adapterFor(activity.type);
    activity.metadata.source=activity.metadata.source||'question-studio-v0.2.1.2';
    if(!activity.metadata.subjectId)activity.metadata.subjectId=state.batchSubjectId;
    if(!activity.metadata.knowledge||typeof activity.metadata.knowledge!=='object')applyKnowledge(activity,activity.metadata.subjectId,'');
    else{const taxonomy=Taxonomy.taxonomy(activity.metadata.knowledge.taxonomyId)||Taxonomy.defaultTaxonomy(activity.metadata.subjectId);activity.metadata.knowledge.taxonomyId=taxonomy?.id||'';activity.metadata.knowledge.taxonomyVersion=Number(activity.metadata.knowledge.taxonomyVersion)||Number(taxonomy?.version)||1;activity.metadata.knowledge.primaryNodeId=activity.metadata.knowledge.primaryNodeId||null;activity.metadata.knowledge.relatedNodeIds=Array.isArray(activity.metadata.knowledge.relatedNodeIds)?activity.metadata.knowledge.relatedNodeIds:[];activity.metadata.knowledge.mappingStatus=activity.metadata.knowledge.primaryNodeId?'confirmed':'unmapped';activity.metadata.knowledge.pathSnapshot=activity.metadata.knowledge.primaryNodeId?Taxonomy.path(activity.metadata.knowledge.taxonomyId,activity.metadata.knowledge.primaryNodeId).map(node=>node.title):[];}
    activity.metadata.translationStatus=hasContent(activity.content?.en)?'bilingual':'zh_only';
    activity.metadata.tags=Array.isArray(activity.metadata.tags)?activity.metadata.tags:[];
    activity.explanation=activity.explanation&&typeof activity.explanation==='object'?activity.explanation:{zh:{},en:null};
    activity.explanation.zh=activity.explanation.zh&&typeof activity.explanation.zh==='object'?activity.explanation.zh:{};
    if(activity.explanation.en&&typeof activity.explanation.en==='object'&&!hasContent(activity.explanation.en))activity.explanation.en=null;
    if(activity.content?.en&&typeof activity.content.en==='object'){
      const en=activity.content.en,zh=activity.content?.zh||{};
      const sync=(key,fields)=>{
        if(!Array.isArray(en[key]))return;
        const byId=new Map(en[key].map((item,index)=>[String(item?.id||zh[key]?.[index]?.id||''),item||{}]));
        en[key]=(zh[key]||[]).map((item,index)=>{
          const peer=byId.get(String(item.id))||en[key][index]||{};
          const next={id:String(item.id)};fields.forEach(field=>next[field]=String(peer?.[field]||''));return next;
        });
      };
      if(activity.type==='single_choice')sync('options',['text']);
      if(activity.type==='keyword_recognition')sync('segments',['text']);
      if(activity.type==='ordering')sync('items',['text']);
      if(activity.type==='matching')sync('pairs',['left','right']);
      if(!hasContent(en))activity.content.en=null;
    }
    if(activity.type==='keyword_recognition')activity.answer.requiredSelectionCount=(activity.answer.segmentIds||[]).length;
    if(activity.type==='matching'){
      const ids=(activity.content?.zh?.pairs||[]).map(item=>String(item.id));
      activity.answer={matches:ids.map(id=>({leftId:id,rightId:id}))};
      activity.config={rightOrder:(activity.config?.rightOrder||ids.slice().reverse()).filter(id=>ids.includes(String(id)))};
      if(activity.config.rightOrder.length!==ids.length)activity.config.rightOrder=ids.slice().reverse();
    }
    return activity;
  }
  function validationFor(activity){if(!activity)return {valid:false,errors:['没有活动。'],warnings:[]};const schema=Schema.validate(normalizeActivity(activity)),knowledge=knowledgeValidation(activity);return {valid:schema.valid&&knowledge.valid,errors:[...schema.errors,...knowledge.errors],warnings:[...schema.warnings,...knowledge.warnings]}}
  function libraryValidation(){
    const library={};const duplicateIds=[];
    state.activities.forEach(activity=>{if(library[activity.id])duplicateIds.push(activity.id);else library[activity.id]=activity});
    const validation=Schema.validateLibrary(library);
    const knowledgeErrors=[];state.activities.forEach(activity=>knowledgeValidation(activity).errors.forEach(message=>knowledgeErrors.push({activityId:activity.id,message})));
    const errors=[...duplicateIds.map(id=>({activityId:id,message:'活动 ID 重复。'})),...validation.errors,...knowledgeErrors];
    return {valid:errors.length===0,errors,warnings:validation.warnings,library};
  }
  function displayTitle(activity){
    if(!activity)return '未命名活动';
    const zh=activity.content?.zh||{};
    return clean(zh.stem||zh.prompt||zh.instruction||activity.metadata?.topic)||activity.id||'未命名活动';
  }
  function renderQuestionLocator(){
    const locator=$('qsQuestionLocator'),previous=$('qsPrevActivityBtn'),next=$('qsNextActivityBtn');
    if(!locator||!previous||!next)return;
    if(!state.activities.length){
      locator.innerHTML='<option value="">暂无试题</option>';locator.value='';locator.disabled=true;previous.disabled=true;next.disabled=true;return;
    }
    locator.disabled=false;
    locator.innerHTML=state.activities.map((activity,index)=>`<option value="${index}">${index+1}. ${escapeHTML(displayTitle(activity))}</option>`).join('');
    locator.value=String(Math.max(0,state.currentIndex));
    previous.disabled=state.currentIndex<=0;
    next.disabled=state.currentIndex>=state.activities.length-1;
  }
  function selectActivity(index){
    const nextIndex=Math.min(Math.max(0,Number(index)||0),Math.max(0,state.activities.length-1));
    if(!state.activities.length)return;
    state.currentIndex=nextIndex;renderAll();
    const editor=$('qsEditor');if(editor)editor.scrollTop=0;
  }
  function renderActivityList(){
    const list=$('qsActivityList');
    if(!state.activities.length){list.innerHTML='<div class="qs-empty">尚无活动。</div>';renderQuestionLocator();return}
    list.innerHTML=state.activities.map((activity,index)=>{
      const validation=validationFor(activity);
      const status=validation.errors.length?'error':validation.warnings.length?'warning':'';
      return `<button type="button" class="qs-activity-item ${index===state.currentIndex?'active':''}" data-select-index="${index}"><span class="qs-activity-number">${index+1}</span><span class="qs-activity-copy"><strong>${escapeHTML(displayTitle(activity))}</strong><small>${escapeHTML(TYPE_LABELS[activity.type]||activity.type)} · ${escapeHTML(activity.id||'无 ID')}</small></span><i class="qs-status-dot ${status}" title="${validation.errors.length} 个错误，${validation.warnings.length} 个警告"></i></button>`;
    }).join('');
    renderQuestionLocator();
  }
  function field(label,path,value,options={}){
    const full=options.full?' full':'';
    const type=options.type||'text';
    const attrs=`data-field="${escapeHTML(path)}"${options.number?' data-number="1"':''}${options.transform?` data-transform="${escapeHTML(options.transform)}"`:''}`;
    if(options.textarea)return `<label class="qs-field${full}"><span>${escapeHTML(label)}</span><textarea ${attrs} placeholder="${escapeHTML(options.placeholder||'')}">${escapeHTML(value||'')}</textarea>${options.help?`<small>${escapeHTML(options.help)}</small>`:''}</label>`;
    return `<label class="qs-field${full}"><span>${escapeHTML(label)}</span><input type="${type}" ${attrs} value="${escapeHTML(value??'')}" placeholder="${escapeHTML(options.placeholder||'')}"${options.min!==undefined?` min="${options.min}"`:''}${options.max!==undefined?` max="${options.max}"`:''}/>${options.help?`<small>${escapeHTML(options.help)}</small>`:''}</label>`;
  }
  function section(title,body,action=''){return `<section class="qs-form-section"><header><h3>${escapeHTML(title)}</h3>${action}</header>${body}</section>`}
  function commonEditor(activity){
    const typeOptions=TYPE_ORDER.map(type=>`<option value="${type}" ${activity.type===type?'selected':''}>${TYPE_LABELS[type]}</option>`).join('');
    const subjects=Taxonomy.subjects();const subjectId=activity.metadata?.subjectId||state.batchSubjectId;const taxonomies=Taxonomy.taxonomies(subjectId);const knowledge=activity.metadata?.knowledge||{};const taxonomyId=knowledge.taxonomyId||Taxonomy.defaultTaxonomy(subjectId)?.id||'';
    const subjectOptions=subjects.map(item=>`<option value="${escapeHTML(item.id)}" ${item.id===subjectId?'selected':''}>${escapeHTML(item.name)}</option>`).join('');
    const taxonomyOptions=taxonomies.map(item=>`<option value="${escapeHTML(item.id)}" ${item.id===taxonomyId?'selected':''}>${escapeHTML(item.name)} · v${item.version}</option>`).join('');
    const path=knowledge.primaryNodeId?Taxonomy.pathLabel(taxonomyId,knowledge.primaryNodeId):'待归类';
    const body=`<div class="qs-grid three">
      ${field('稳定活动 ID','id',activity.id,{help:'导入活动库后用于长期引用，不建议随意修改。'})}
      <label class="qs-field"><span>活动类型</span><select data-action="change-type">${typeOptions}</select></label>
      ${field('主题','metadata.topic',activity.metadata?.topic||'')}
      <label class="qs-field"><span>科目</span><select data-action="knowledge-subject">${subjectOptions}</select></label>
      <label class="qs-field"><span>知识树</span><select data-action="knowledge-taxonomy">${taxonomyOptions}</select></label>
      <label class="qs-field"><span>主知识点</span><button type="button" class="qs-knowledge-button qs-inline-knowledge" data-action="choose-knowledge"><span>${escapeHTML(path)}</span><b>${knowledge.primaryNodeId?'更换':'选择'}</b></button><small>支持搜索、最近使用、收藏和分级浏览。</small></label>
      ${field('阶段（可选）','metadata.stage',activity.metadata?.stage||'')}
      ${field('部分（可选）','metadata.part',activity.metadata?.part||'')}
      ${field('标签','metadata.tags',(activity.metadata?.tags||[]).join(', '),{transform:'list'})}
      <div class="qs-knowledge-summary"><strong>当前归属</strong><span>${escapeHTML(path)}</span>${knowledge.primaryNodeId?`<button type="button" data-action="choose-knowledge">重新选择</button>`:''}</div>
    </div>`;
    return section('基础信息与知识点归属',body);
  }
  function explanationEditor(activity){
    return section('解析与反馈',`<div class="qs-grid">
      ${field('中文解析','explanation.zh.general',activity.explanation?.zh?.general||activity.explanation?.zh?.detailed||'',{textarea:true,full:true})}
      ${field('英文展示解析','explanation.en.general',activity.explanation?.en?.general||activity.explanation?.en?.detailed||'',{textarea:true,full:true,help:'仅用于展示，不参与判定。'})}
      ${field('中文错误反馈','explanation.zh.incorrect',activity.explanation?.zh?.incorrect||'',{textarea:true})}
      ${field('英文错误反馈展示','explanation.en.incorrect',activity.explanation?.en?.incorrect||'',{textarea:true})}
    </div>`);
  }
  function choiceEditor(activity){
    const zh=activity.content.zh,en=activity.content.en||{};
    const enById=new Map((en.options||[]).map(item=>[String(item.id),item]));
    const rows=(zh.options||[]).map((item,index)=>{
      const peer=enById.get(String(item.id))||{};
      return `<div class="qs-row"><input data-field="content.zh.options.${index}.id" value="${escapeHTML(item.id)}" aria-label="选项 ID"/><textarea data-field="content.zh.options.${index}.text" aria-label="中文选项">${escapeHTML(item.text||'')}</textarea><textarea data-field="content.en.options.${index}.text" data-peer-id="${escapeHTML(item.id)}" aria-label="英文选项">${escapeHTML(peer.text||'')}</textarea><button type="button" class="remove" data-action="remove-row" data-kind="option" data-index="${index}" title="删除">×</button></div>`;
    }).join('');
    const answerOptions=(zh.options||[]).map(item=>`<option value="${escapeHTML(item.id)}" ${String(activity.answer.optionId)===String(item.id)?'selected':''}>${escapeHTML(item.id)}</option>`).join('');
    return section('单项选择内容',`<div class="qs-grid">${field('中文题干','content.zh.stem',zh.stem||'',{textarea:true,full:true})}${field('英文题干展示','content.en.stem',en.stem||'',{textarea:true,full:true})}</div><div class="qs-table">${rows}</div><div class="qs-grid"><label class="qs-field"><span>正确答案 ID</span><select data-field="answer.optionId">${answerOptions}</select></label></div>`,`<button type="button" data-action="add-row" data-kind="option">＋ 添加选项</button>`);
  }
  function keywordEditor(activity){
    const zh=activity.content.zh,en=activity.content.en||{};const enById=new Map((en.segments||[]).map(item=>[String(item.id),item]));const answers=new Set((activity.answer.segmentIds||[]).map(String));
    const rows=(zh.segments||[]).map((item,index)=>{const peer=enById.get(String(item.id))||{};return `<div class="qs-row"><input data-field="content.zh.segments.${index}.id" value="${escapeHTML(item.id)}" aria-label="分段 ID"/><textarea data-field="content.zh.segments.${index}.text" aria-label="中文分段">${escapeHTML(item.text||'')}</textarea><textarea data-field="content.en.segments.${index}.text" aria-label="英文分段">${escapeHTML(peer.text||'')}</textarea><button type="button" class="remove" data-action="remove-row" data-kind="segment" data-index="${index}">×</button></div>`}).join('');
    const picks=(zh.segments||[]).map(item=>`<label class="qs-check"><input type="checkbox" data-action="keyword-answer" value="${escapeHTML(item.id)}" ${answers.has(String(item.id))?'checked':''}/><span>${escapeHTML(item.id)}</span></label>`).join('');
    return section('关键词识别内容',`<div class="qs-grid">${field('中文操作说明','content.zh.instruction',zh.instruction||'',{textarea:true,full:true})}${field('英文操作说明展示','content.en.instruction',en.instruction||'',{textarea:true,full:true})}</div><div class="qs-table">${rows}</div><div class="qs-field"><span>正确 segmentId</span><div class="qs-answer-picks">${picks}</div></div>`,`<button type="button" data-action="add-row" data-kind="segment">＋ 添加分段</button>`);
  }
  function orderingEditor(activity){
    const zh=activity.content.zh,en=activity.content.en||{};const enById=new Map((en.items||[]).map(item=>[String(item.id),item]));
    const order=(activity.answer.itemIds||[]).map(String);const byId=new Map((zh.items||[]).map(item=>[String(item.id),item]));
    const ordered=order.map(id=>byId.get(id)).filter(Boolean);(zh.items||[]).forEach(item=>{if(!order.includes(String(item.id)))ordered.push(item)});
    const rows=ordered.map((item,index)=>{const originalIndex=(zh.items||[]).findIndex(candidate=>String(candidate.id)===String(item.id));const peer=enById.get(String(item.id))||{};return `<div class="qs-order-item"><button type="button" data-action="move-order" data-direction="-1" data-id="${escapeHTML(item.id)}" ${index===0?'disabled':''}>↑</button><button type="button" data-action="move-order" data-direction="1" data-id="${escapeHTML(item.id)}" ${index===ordered.length-1?'disabled':''}>↓</button><input data-field="content.zh.items.${originalIndex}.id" value="${escapeHTML(item.id)}"/><textarea data-field="content.zh.items.${originalIndex}.text">${escapeHTML(item.text||'')}</textarea><textarea data-field="content.en.items.${originalIndex}.text">${escapeHTML(peer.text||'')}</textarea><button type="button" class="remove" data-action="remove-row" data-kind="item" data-index="${originalIndex}">×</button></div>`}).join('');
    return section('排序内容（当前行顺序即正确答案）',`<div class="qs-grid">${field('中文操作说明','content.zh.instruction',zh.instruction||'',{textarea:true,full:true})}${field('英文操作说明展示','content.en.instruction',en.instruction||'',{textarea:true,full:true})}</div><div class="qs-order-list">${rows}</div>`,`<button type="button" data-action="add-row" data-kind="item">＋ 添加排序项</button>`);
  }
  function matchingEditor(activity){
    const zh=activity.content.zh,en=activity.content.en||{};const enById=new Map((en.pairs||[]).map(item=>[String(item.id),item]));
    const rows=(zh.pairs||[]).map((item,index)=>{const peer=enById.get(String(item.id))||{};return `<div class="qs-row matching"><input data-field="content.zh.pairs.${index}.id" value="${escapeHTML(item.id)}"/><textarea data-field="content.zh.pairs.${index}.left">${escapeHTML(item.left||'')}</textarea><textarea data-field="content.zh.pairs.${index}.right">${escapeHTML(item.right||'')}</textarea><textarea data-field="content.en.pairs.${index}.left">${escapeHTML(peer.left||'')}</textarea><textarea data-field="content.en.pairs.${index}.right">${escapeHTML(peer.right||'')}</textarea><button type="button" class="remove" data-action="remove-row" data-kind="pair" data-index="${index}">×</button></div>`}).join('');
    return section('连线配对内容',`<div class="qs-grid">${field('中文操作说明','content.zh.instruction',zh.instruction||'',{textarea:true,full:true})}${field('英文操作说明展示','content.en.instruction',en.instruction||'',{textarea:true,full:true})}</div><div class="qs-table">${rows}</div>`,`<button type="button" data-action="add-row" data-kind="pair">＋ 添加配对</button>`);
  }
  function openEditor(activity){
    const zh=activity.content.zh,en=activity.content.en||{};const concepts=activity.answer.acceptedConcepts?.zh||[];
    const rows=concepts.map((item,index)=>`<div class="qs-row concept"><input data-field="answer.acceptedConcepts.zh.${index}.id" value="${escapeHTML(item.id)}"/><textarea data-field="answer.acceptedConcepts.zh.${index}.acceptedExpressions" data-transform="list-lines">${escapeHTML((item.acceptedExpressions||[]).join('\n'))}</textarea><textarea data-field="answer.acceptedConcepts.zh.${index}.missingHint">${escapeHTML(item.missingHint||'')}</textarea><button type="button" class="remove" data-action="remove-row" data-kind="concept" data-index="${index}">×</button></div>`).join('');
    return section('开放表达内容',`<div class="qs-grid">${field('中文题目','content.zh.prompt',zh.prompt||'',{textarea:true,full:true})}${field('英文题目展示','content.en.prompt',en.prompt||'',{textarea:true,full:true})}${field('中文输入提示','content.zh.placeholder',zh.placeholder||'')}${field('英文输入提示展示','content.en.placeholder',en.placeholder||'')}${field('中文参考答案','content.zh.referenceAnswer',zh.referenceAnswer||'',{textarea:true})}${field('英文参考答案展示','content.en.referenceAnswer',en.referenceAnswer||'',{textarea:true})}${field('最少字数','answer.minLength',activity.answer.minLength||10,{type:'number',number:true,min:1})}${field('最多字数','answer.maxLength',activity.answer.maxLength||300,{type:'number',number:true,min:20})}</div><div class="qs-table">${rows}</div>`,`<button type="button" data-action="add-row" data-kind="concept">＋ 添加中文判定要点</button>`);
  }
  function renderEditor(){
    const activity=current();const editor=$('qsEditor');$('qsCurrentIndex').textContent=activity?`${state.currentIndex+1} / ${state.activities.length}`:'0 / 0';
    if(!activity){editor.innerHTML='<div class="qs-empty">请先解析文本或新增活动。</div>';return}
    let typeSection='';
    if(activity.type==='single_choice')typeSection=choiceEditor(activity);
    if(activity.type==='keyword_recognition')typeSection=keywordEditor(activity);
    if(activity.type==='ordering')typeSection=orderingEditor(activity);
    if(activity.type==='matching')typeSection=matchingEditor(activity);
    if(activity.type==='open_response')typeSection=openEditor(activity);
    editor.innerHTML=commonEditor(activity)+typeSection+explanationEditor(activity)+`<section class="qs-form-section"><header><h3>活动操作</h3></header><button type="button" class="danger" data-action="delete-activity">删除当前活动</button></section>`;
  }
  function displayPair(zh,en){return {zh:clean(zh),en:clean(en)}}
  function enLine(pair){return state.previewLanguage==='bilingual'&&pair.en&&pair.en!==pair.zh?`<span class="qs-en">${escapeHTML(pair.en)}</span>`:''}
  function localizedArray(zhItems,enItems){const byId=new Map((enItems||[]).map(item=>[String(item.id),item]));return (zhItems||[]).map(item=>({id:String(item.id),zh:item,en:byId.get(String(item.id))||{}}))}
  function previewState(activity){
    const key=activity.id||String(state.currentIndex);let value=state.previewState.get(key);
    if(!value||value.type!==activity.type){
      value={type:activity.type,selected:'',segments:new Set(),order:(activity.config?.displayOrder||activity.answer?.itemIds||[]).map(String),matches:{},text:''};state.previewState.set(key,value);
    }
    return value;
  }
  function renderPreview(){
    const activity=current();const box=$('qsPreview');$('qsLanguageNote').hidden=state.previewLanguage!=='bilingual';
    document.querySelectorAll('[data-preview-language]').forEach(button=>button.classList.toggle('active',button.dataset.previewLanguage===state.previewLanguage));
    if(!activity){box.innerHTML='<div class="qs-empty">选择活动后显示预览。</div>';return}
    normalizeActivity(activity);const ps=previewState(activity);const zh=activity.content.zh||{},en=activity.content.en||{};let body='';
    if(activity.type==='single_choice'){
      const items=localizedArray(zh.options,en.options);body=`<h3>${escapeHTML(zh.stem||'未填写题干')}${enLine(displayPair(zh.stem,en.stem))}</h3><div class="qs-preview-options">${items.map(item=>`<button type="button" class="qs-preview-option ${ps.selected===item.id?'selected':''}" data-preview-choice="${escapeHTML(item.id)}"><strong>${escapeHTML(item.id)}</strong> · ${escapeHTML(item.zh.text||'')}${enLine(displayPair(item.zh.text,item.en.text))}</button>`).join('')}</div>`;
    }else if(activity.type==='keyword_recognition'){
      const items=localizedArray(zh.segments,en.segments);body=`<h3>${escapeHTML(zh.instruction||'关键词识别')}${enLine(displayPair(zh.instruction,en.instruction))}</h3><div class="qs-preview-segments">${items.map(item=>`<button type="button" class="qs-preview-segment ${ps.segments.has(item.id)?'selected':''}" data-preview-segment="${escapeHTML(item.id)}">${escapeHTML(item.zh.text||'')}${enLine(displayPair(item.zh.text,item.en.text))}</button>`).join('')}</div>`;
    }else if(activity.type==='ordering'){
      const items=localizedArray(zh.items,en.items);const byId=new Map(items.map(item=>[item.id,item]));const order=ps.order.filter(id=>byId.has(id));items.forEach(item=>{if(!order.includes(item.id))order.push(item.id)});ps.order=order;
      body=`<h3>${escapeHTML(zh.instruction||'排序')}${enLine(displayPair(zh.instruction,en.instruction))}</h3><div class="qs-preview-order">${order.map((id,index)=>{const item=byId.get(id);return `<div class="qs-preview-order-item"><span>${index+1}. ${escapeHTML(item.zh.text||'')}${enLine(displayPair(item.zh.text,item.en.text))}</span><button type="button" data-preview-order="-1" data-id="${escapeHTML(id)}" ${index===0?'disabled':''}>↑</button><button type="button" data-preview-order="1" data-id="${escapeHTML(id)}" ${index===order.length-1?'disabled':''}>↓</button></div>`}).join('')}</div>`;
    }else if(activity.type==='matching'){
      const items=localizedArray(zh.pairs,en.pairs);const rightOrder=(activity.config?.rightOrder||items.map(item=>item.id)).filter(id=>items.some(item=>item.id===String(id)));const byId=new Map(items.map(item=>[item.id,item]));
      body=`<h3>${escapeHTML(zh.instruction||'配对')}${enLine(displayPair(zh.instruction,en.instruction))}</h3><div class="qs-preview-match">${items.map(item=>`<label class="qs-preview-match-row"><span>${escapeHTML(item.zh.left||'')}${enLine(displayPair(item.zh.left,item.en.left))}</span><select data-preview-match="${escapeHTML(item.id)}"><option value="">请选择</option>${rightOrder.map(id=>{const right=byId.get(String(id));return `<option value="${escapeHTML(id)}" ${String(ps.matches[item.id]||'')===String(id)?'selected':''}>${escapeHTML(right?.zh?.right||'')}</option>`}).join('')}</select></label>`).join('')}</div>`;
    }else if(activity.type==='open_response'){
      body=`<h3>${escapeHTML(zh.prompt||'开放表达')}${enLine(displayPair(zh.prompt,en.prompt))}</h3><textarea id="qsPreviewOpenText" placeholder="${escapeHTML(zh.placeholder||'请使用中文作答')}">${escapeHTML(ps.text||'')}</textarea>`;
    }
    const explanation=activity.explanation?.zh?.general||activity.explanation?.zh?.detailed||'';const explanationEn=activity.explanation?.en?.general||activity.explanation?.en?.detailed||'';
    box.innerHTML=`<article class="qs-preview-card">${body}<div class="qs-preview-actions"><button type="button" class="primary" data-preview-check>检查答案</button><button type="button" data-preview-reset>重置</button></div><div class="qs-preview-result" id="qsPreviewResult"></div>${explanation?`<details><summary>查看解析</summary><p>${escapeHTML(explanation)}${enLine(displayPair(explanation,explanationEn))}</p></details>`:''}</article>`;
  }
  function evaluatePreview(){
    const activity=current();if(!activity)return;const ps=previewState(activity);let correct=false,message='';
    if(activity.type==='single_choice'){correct=ps.selected===String(activity.answer.optionId||'');message=ps.selected?'答案已提交。':'请先选择答案。'}
    else if(activity.type==='keyword_recognition'){const expected=[...(activity.answer.segmentIds||[])].map(String).sort();const actual=[...ps.segments].sort();correct=expected.length===actual.length&&expected.every((id,index)=>id===actual[index]);message=actual.length?'已检查所选关键词。':'请先选择关键词。'}
    else if(activity.type==='ordering'){const expected=(activity.answer.itemIds||[]).map(String);correct=expected.length===ps.order.length&&expected.every((id,index)=>id===ps.order[index]);message='已检查当前顺序。'}
    else if(activity.type==='matching'){const matches=activity.answer.matches||[];correct=matches.length>0&&matches.every(match=>String(ps.matches[match.leftId]||'')===String(match.rightId));message='已检查全部配对。'}
    else if(activity.type==='open_response'){
      const text=clean(ps.text);const concepts=activity.answer.acceptedConcepts?.zh||[];const found=concepts.filter(concept=>(concept.acceptedExpressions||[]).some(expr=>clean(expr)&&text.includes(clean(expr))));correct=text.length>=Number(activity.answer.minLength||1)&&found.length===concepts.length;message=`已识别 ${found.length}/${concepts.length} 个中文要点。`;
    }
    const result=$('qsPreviewResult');result.className=`qs-preview-result ${correct?'correct':'incorrect'}`;result.textContent=(correct?'✓ 正确。':'✕ 尚未通过。')+' '+message;
  }
  function resetPreview(){const activity=current();if(!activity)return;state.previewState.delete(activity.id||String(state.currentIndex));renderPreview()}
  function renderDiagnostics(){
    const currentActivity=current();const validation=currentActivity?validationFor(currentActivity):{errors:[],warnings:[]};const library=libraryValidation();
    const parserCurrent=state.parserIssues.filter(issue=>issue.index===state.currentIndex);const errors=[...validation.errors,...parserCurrent.filter(issue=>issue.level==='error').map(issue=>issue.message)];const warnings=[...validation.warnings,...parserCurrent.filter(issue=>issue.level==='warning').map(issue=>issue.message)];
    $('qsValidationSummary').textContent=`当前：${errors.length} 个错误 · ${warnings.length} 个警告｜全部：${library.errors.length} 个错误 · ${library.warnings.length} 个警告`;
    const rows=[];errors.forEach(message=>rows.push(`<p class="error">错误：${escapeHTML(message)}</p>`));warnings.forEach(message=>rows.push(`<p class="warning">警告：${escapeHTML(message)}</p>`));
    if(!rows.length)rows.push('<p class="ok">当前活动通过校验，可以导出。</p>');$('qsDiagnostics').innerHTML=rows.join('');
  }
  function renderAll(){renderActivityList();renderEditor();renderPreview();renderDiagnostics()}
  function scheduleSave(){state.dirty=true;$('qsSaveState').textContent='有未保存修改';clearTimeout(state.saveTimer);state.saveTimer=setTimeout(()=>saveDraft(false),700)}
  function draftPayload(){return {version:'0.2.1.2',savedAt:new Date().toISOString(),activities:state.activities,currentIndex:state.currentIndex,rawText:$('qsRawText').value,packageId:$('qsPackageId').value,packageVersion:Number($('qsPackageVersion').value)||1,author:$('qsAuthor').value,batchSubjectId:state.batchSubjectId,batchKnowledgeNodeId:state.batchKnowledgeNodeId}}
  function saveDraft(explicit=true){
    try{localStorage.setItem(DRAFT_KEY,JSON.stringify(draftPayload()));state.dirty=false;$('qsSaveState').textContent='草稿已保存 '+new Date().toLocaleTimeString();if(explicit)toast('草稿已保存到本机浏览器。')}catch(error){toast('草稿保存失败：'+error.message)}
  }
  function loadDraft(){
    try{let payload=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');if(!payload)payload=JSON.parse(localStorage.getItem(LEGACY_DRAFT_KEY)||'null');if(!payload)payload=JSON.parse(localStorage.getItem(OLDER_DRAFT_KEY)||'null');if(!payload||!Array.isArray(payload.activities))return false;state.batchSubjectId=payload.batchSubjectId||'subject-pmp';state.batchKnowledgeNodeId=payload.batchKnowledgeNodeId||'';renderBatchSelectors();state.activities=payload.activities.map(normalizeActivity);state.currentIndex=Math.min(Math.max(0,Number(payload.currentIndex)||0),Math.max(0,state.activities.length-1));$('qsRawText').value=payload.rawText||'';$('qsPackageId').value=payload.packageId||'question-studio-package';$('qsPackageVersion').value=payload.packageVersion||1;$('qsAuthor').value=payload.author||'';$('qsSaveState').textContent='已恢复本地草稿';return true}catch(error){return false}
  }
  function backups(){try{const current=JSON.parse(localStorage.getItem(BACKUP_KEY)||'[]');if(current.length)return current;const legacy=JSON.parse(localStorage.getItem(LEGACY_BACKUP_KEY)||'[]');if(legacy.length)return legacy;return JSON.parse(localStorage.getItem(OLDER_BACKUP_KEY)||'[]')}catch(error){return []}}
  function renderBackups(){const select=$('qsBackupSelect');const list=backups();select.innerHTML=list.length?'<option value="">请选择备份</option>'+list.map((item,index)=>`<option value="${index}">${escapeHTML(new Date(item.savedAt).toLocaleString())} · ${item.activities.length} 个活动</option>`).join(''):'<option value="">暂无备份</option>'}
  function createBackup(){try{const list=backups();list.unshift(draftPayload());localStorage.setItem(BACKUP_KEY,JSON.stringify(list.slice(0,MAX_BACKUPS)));renderBackups();toast('已创建离线备份。')}catch(error){toast('创建备份失败：'+error.message)}}
  function restoreBackup(){const index=Number($('qsBackupSelect').value);const list=backups();if(!Number.isInteger(index)||!list[index]){toast('请先选择一个备份。');return}if(!confirm('恢复备份将覆盖当前未保存内容，是否继续？'))return;const payload=list[index];state.batchSubjectId=payload.batchSubjectId||state.batchSubjectId;state.batchKnowledgeNodeId=payload.batchKnowledgeNodeId||'';renderBatchSelectors();state.activities=(payload.activities||[]).map(normalizeActivity);state.currentIndex=Math.min(Math.max(0,Number(payload.currentIndex)||0),Math.max(0,state.activities.length-1));$('qsRawText').value=payload.rawText||'';$('qsPackageId').value=payload.packageId||'question-studio-package';$('qsPackageVersion').value=payload.packageVersion||1;$('qsAuthor').value=payload.author||'';renderAll();saveDraft(false);toast('备份已恢复。')}
  function downloadJSON(value,filename){const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function exportPackage(){
    const validation=libraryValidation();if(!state.activities.length){toast('没有可导出的活动。');return}if(!validation.valid){toast('仍有错误，请先查看校验结果。');return}
    const payload=Schema.createPackage(validation.library,{packageId:clean($('qsPackageId').value)||'question-studio-package',packageVersion:Number($('qsPackageVersion').value)||1,author:$('qsAuthor').value});downloadJSON(payload,`${payload.packageId}-v${payload.packageVersion}.json`);createBackup();toast('标准活动包已导出。')
  }
  function exportCurrent(){const activity=current();if(!activity)return toast('没有当前活动。');const validation=validationFor(activity);if(!validation.valid)return toast('当前活动仍有错误。');downloadJSON(activity,`${activity.id}.json`);toast('当前活动 JSON 已导出。')}
  function parseRaw(){
    const raw=$('qsRawText').value;if(!clean(raw)){toast('请先粘贴题目文本。');return}if(state.activities.length&&!confirm('重新解析会替换当前活动列表，是否继续？'))return;
    const result=Parser.parseBatch(raw);state.activities=result.activities.map(activity=>normalizeActivity(applyKnowledge(activity)));state.currentIndex=state.activities.length?0:-1;state.parserIssues=[...result.errors.map(item=>({...item,level:'error'})),...result.warnings.map(item=>({...item,level:'warning'}))];state.previewState.clear();renderAll();scheduleSave();toast(`已解析 ${state.activities.length} 个活动。`)
  }
  function parseImportedJSON(text){
    let data;try{data=JSON.parse(text)}catch(error){throw new Error('文件不是有效 JSON。')}
    if(data&&Array.isArray(data.activities)){
      const parsed=Schema.parsePackage(data);if(!parsed.valid)throw new Error(parsed.errors.join('；'));return Object.values(parsed.library);
    }
    const list=Array.isArray(data)?data:[data];const errors=[];list.forEach((activity,index)=>{const validation=Schema.validate(activity);if(!validation.valid)errors.push(`第 ${index+1} 项：${validation.errors.join('；')}`)});if(errors.length)throw new Error(errors.join('\n'));return list;
  }
  async function importFile(file){
    if(!file)return;try{const incoming=parseImportedJSON(await file.text());const existing=new Map(state.activities.map(activity=>[activity.id,activity]));let conflicts=0;incoming.forEach(activity=>{if(existing.has(activity.id)){conflicts++;existing.set(activity.id,normalizeActivity(activity))}else existing.set(activity.id,normalizeActivity(activity))});if(conflicts&&!confirm(`发现 ${conflicts} 个同 ID 活动。确定用导入内容替换当前内容吗？`))return;state.activities=[...existing.values()];state.currentIndex=state.activities.length?0:-1;state.parserIssues=[];renderAll();scheduleSave();toast(`已导入 ${incoming.length} 个活动。`)}catch(error){toast('导入失败：'+error.message)}finally{$('qsImportFile').value=''}
  }
  function convertType(nextType){const activity=current();if(!activity||activity.type===nextType)return;const replacement=blankActivity(nextType,{id:activity.id,metadata:activity.metadata,explanation:activity.explanation});state.activities[state.currentIndex]=replacement;state.previewState.delete(activity.id);renderAll();scheduleSave()}
  function ensureLocaleArray(activity,key){
    if(!activity.content.en||typeof activity.content.en!=='object')activity.content.en={};if(!Array.isArray(activity.content.en[key]))activity.content.en[key]=[];return activity.content.en[key];
  }
  function addRow(kind){const activity=current();if(!activity)return;
    if(kind==='option'){const zh=activity.content.zh.options;const id=String.fromCharCode(65+zh.length);zh.push({id,text:''});ensureLocaleArray(activity,'options').push({id,text:''});if(!activity.answer.optionId)activity.answer.optionId=id}
    if(kind==='segment'){const zh=activity.content.zh.segments;const id=`segment-${zh.length+1}`;zh.push({id,text:''});ensureLocaleArray(activity,'segments').push({id,text:''})}
    if(kind==='item'){const zh=activity.content.zh.items;const id=`item-${zh.length+1}`;zh.push({id,text:''});ensureLocaleArray(activity,'items').push({id,text:''});activity.answer.itemIds.push(id);activity.config.displayOrder=[...activity.answer.itemIds].reverse()}
    if(kind==='pair'){const zh=activity.content.zh.pairs;const id=`pair-${zh.length+1}`;zh.push({id,left:'',right:''});ensureLocaleArray(activity,'pairs').push({id,left:'',right:''})}
    if(kind==='concept'){const list=activity.answer.acceptedConcepts.zh;list.push({id:`concept-${list.length+1}`,acceptedExpressions:[''],missingHint:''})}
    normalizeActivity(activity);renderAll();scheduleSave()
  }
  function removeRow(kind,index){const activity=current();if(!activity)return;index=Number(index);
    if(kind==='option'){const removed=activity.content.zh.options.splice(index,1)[0];activity.content.en?.options?.splice(index,1);if(String(activity.answer.optionId)===String(removed?.id))activity.answer.optionId=activity.content.zh.options[0]?.id||''}
    if(kind==='segment'){const removed=activity.content.zh.segments.splice(index,1)[0];activity.content.en?.segments?.splice(index,1);activity.answer.segmentIds=(activity.answer.segmentIds||[]).filter(id=>String(id)!==String(removed?.id))}
    if(kind==='item'){const removed=activity.content.zh.items.splice(index,1)[0];activity.content.en?.items?.splice(index,1);activity.answer.itemIds=(activity.answer.itemIds||[]).filter(id=>String(id)!==String(removed?.id));activity.config.displayOrder=(activity.config.displayOrder||[]).filter(id=>String(id)!==String(removed?.id))}
    if(kind==='pair'){activity.content.zh.pairs.splice(index,1);activity.content.en?.pairs?.splice(index,1)}
    if(kind==='concept'){activity.answer.acceptedConcepts.zh.splice(index,1)}
    normalizeActivity(activity);renderAll();scheduleSave()
  }
  function moveOrder(id,direction){const activity=current();const order=activity.answer.itemIds.map(String);const index=order.indexOf(String(id));const target=index+Number(direction);if(index<0||target<0||target>=order.length)return;[order[index],order[target]]=[order[target],order[index]];activity.answer.itemIds=order;activity.config.displayOrder=[...order].reverse();renderAll();scheduleSave()}
  function handleEditorInput(event){const fieldEl=event.target.closest('[data-field]');if(!fieldEl)return;const activity=current();if(!activity)return;let value=fieldEl.value;if(fieldEl.dataset.number)value=Number(value)||0;if(fieldEl.dataset.transform==='list')value=value.split(/[,，;；\n]+/).map(clean).filter(Boolean);if(fieldEl.dataset.transform==='list-lines')value=value.split(/\n|[,，;；]+/).map(clean).filter(Boolean);setPath(activity,fieldEl.dataset.field,value);normalizeActivity(activity);renderActivityList();renderPreview();renderDiagnostics();scheduleSave()}
  function handleEditorChange(event){
    const subjectSelect=event.target.closest('[data-action="knowledge-subject"]');if(subjectSelect){const activity=current();applyKnowledge(activity,subjectSelect.value,'');renderAll();scheduleSave();return}
    const taxonomySelect=event.target.closest('[data-action="knowledge-taxonomy"]');if(taxonomySelect){const activity=current();activity.metadata.knowledge.taxonomyId=taxonomySelect.value;activity.metadata.knowledge.taxonomyVersion=Number(Taxonomy.taxonomy(taxonomySelect.value)?.version)||1;activity.metadata.knowledge.primaryNodeId=null;activity.metadata.knowledge.mappingStatus='unmapped';activity.metadata.knowledge.pathSnapshot=[];renderAll();scheduleSave();return}
    const primarySelect=event.target.closest('[data-action="knowledge-primary"]');if(primarySelect){const activity=current();activity.metadata.knowledge.primaryNodeId=primarySelect.value||null;activity.metadata.knowledge.mappingStatus=primarySelect.value?'confirmed':'unmapped';activity.metadata.knowledge.pathSnapshot=primarySelect.value?Taxonomy.path(activity.metadata.knowledge.taxonomyId,primarySelect.value).map(node=>node.title):[];renderAll();scheduleSave();return}
    const typeSelect=event.target.closest('[data-action="change-type"]');if(typeSelect){convertType(typeSelect.value);return}
    const keyword=event.target.closest('[data-action="keyword-answer"]');if(keyword){const activity=current();const set=new Set((activity.answer.segmentIds||[]).map(String));if(keyword.checked)set.add(keyword.value);else set.delete(keyword.value);activity.answer.segmentIds=[...set];normalizeActivity(activity);renderEditor();renderPreview();renderDiagnostics();renderActivityList();scheduleSave();return}
    handleEditorInput(event)
  }
  function applyBatchKnowledge(){if(!state.activities.length)return toast('当前没有活动。');if(!state.batchKnowledgeNodeId)return toast('请先选择本批默认知识点。');state.activities.forEach(activity=>applyKnowledge(activity,state.batchSubjectId,state.batchKnowledgeNodeId,state.batchTaxonomyId));renderAll();scheduleSave();toast(`已将知识点应用到 ${state.activities.length} 个活动。`)}
  async function submitLibrary(){
    const validation=libraryValidation();
    if(!state.activities.length){state.dirty=true;$('qsSaveState').textContent='服务器未保存';toast('没有可提交的活动。');return false}
    if(!validation.valid){state.dirty=true;$('qsSaveState').textContent='服务器未保存 · 请先修正校验错误';toast('仍有错误，请先完成知识点归属并查看校验结果。');return false}
    try{
      const result=await Sync.submit(state.activities),summary=result.summary||{};
      state.dirty=false;$('qsSaveState').textContent='已保存到服务器 '+new Date().toLocaleTimeString();
      toast(`已提交活动库：新增 ${summary.created||0}，更新 ${summary.updated||0}，未变 ${summary.unchanged||0}。`);createBackup();return true
    }catch(error){
      state.dirty=true;$('qsSaveState').textContent='服务器未保存 · 本机草稿已保留';toast('提交失败：'+error.message);return false
    }
  }
  async function saveAndSubmit(){saveDraft(false);await submitLibrary()}
  function bind(){
    $('qsParseBtn').addEventListener('click',parseRaw);$('qsSampleBtn').addEventListener('click',()=>{$('qsRawText').value=Parser.SAMPLE;toast('示例模板已载入，点击“解析文本”。')});
    $('qsNewBtn').addEventListener('click',()=>{if((state.activities.length||clean($('qsRawText').value))&&!confirm('新建会清空当前内容，是否继续？'))return;state.activities=[];state.currentIndex=-1;state.parserIssues=[];state.previewState.clear();$('qsRawText').value='';renderAll();scheduleSave()});
    $('qsAddActivityBtn').addEventListener('click',()=>{state.activities.push(blankActivity());state.currentIndex=state.activities.length-1;renderAll();scheduleSave()});
    $('qsActivityList').addEventListener('click',event=>{const button=event.target.closest('[data-select-index]');if(!button)return;selectActivity(button.dataset.selectIndex)});$('qsQuestionLocator').addEventListener('change',event=>selectActivity(event.target.value));$('qsPrevActivityBtn').addEventListener('click',()=>selectActivity(state.currentIndex-1));$('qsNextActivityBtn').addEventListener('click',()=>selectActivity(state.currentIndex+1));
    $('qsEditor').addEventListener('input',handleEditorInput);$('qsEditor').addEventListener('change',handleEditorChange);$('qsEditor').addEventListener('click',event=>{const action=event.target.closest('[data-action]');if(!action)return;const name=action.dataset.action;if(name==='add-row')addRow(action.dataset.kind);if(name==='remove-row')removeRow(action.dataset.kind,action.dataset.index);if(name==='move-order')moveOrder(action.dataset.id,action.dataset.direction);if(name==='choose-knowledge')openKnowledgePicker('activity');if(name==='delete-activity'){if(!confirm('删除当前活动？'))return;state.activities.splice(state.currentIndex,1);state.currentIndex=Math.min(state.currentIndex,state.activities.length-1);renderAll();scheduleSave()}});
    document.querySelectorAll('[data-preview-language]').forEach(button=>button.addEventListener('click',()=>{state.previewLanguage=button.dataset.previewLanguage;renderPreview()}));
    $('qsPreview').addEventListener('click',event=>{const activity=current();if(!activity)return;const ps=previewState(activity);const choice=event.target.closest('[data-preview-choice]');if(choice){ps.selected=choice.dataset.previewChoice;renderPreview();return}const segment=event.target.closest('[data-preview-segment]');if(segment){const id=segment.dataset.previewSegment;if(ps.segments.has(id))ps.segments.delete(id);else ps.segments.add(id);renderPreview();return}const order=event.target.closest('[data-preview-order]');if(order){const index=ps.order.indexOf(order.dataset.id),target=index+Number(order.dataset.previewOrder);if(index>=0&&target>=0&&target<ps.order.length)[ps.order[index],ps.order[target]]=[ps.order[target],ps.order[index]];renderPreview();return}if(event.target.closest('[data-preview-check]'))evaluatePreview();if(event.target.closest('[data-preview-reset]'))resetPreview()});
    $('qsPreview').addEventListener('change',event=>{const activity=current();if(!activity)return;const ps=previewState(activity);const match=event.target.closest('[data-preview-match]');if(match)ps.matches[match.dataset.previewMatch]=match.value});
    $('qsPreview').addEventListener('input',event=>{const activity=current();if(!activity)return;if(event.target.id==='qsPreviewOpenText')previewState(activity).text=event.target.value});
    $('qsBatchSubject').addEventListener('change',event=>{state.batchSubjectId=event.target.value;state.batchKnowledgeNodeId='';localStorage.setItem(SUBJECT_PREF_KEY,state.batchSubjectId);renderBatchSelectors();scheduleSave()});$('qsBatchKnowledgeBtn').addEventListener('click',()=>openKnowledgePicker('batch'));$('qsApplyKnowledgeBtn').addEventListener('click',applyBatchKnowledge);
    $('qsPickerSubject').addEventListener('change',event=>{state.picker.subjectId=event.target.value;state.picker.taxonomyId=Taxonomy.defaultTaxonomy(state.picker.subjectId)?.id||'';state.picker.parentId=null;state.picker.selectedNodeId='';renderKnowledgePicker()});
    $('qsPickerTaxonomy').addEventListener('change',event=>{state.picker.taxonomyId=event.target.value;state.picker.parentId=null;state.picker.selectedNodeId='';renderKnowledgePicker()});
    $('qsPickerSearch').addEventListener('input',event=>{state.picker.query=event.target.value;renderKnowledgePicker()});
    document.querySelectorAll('[data-picker-tab]').forEach(button=>button.addEventListener('click',()=>{state.picker.tab=button.dataset.pickerTab;state.picker.query='';$('qsPickerSearch').value='';state.picker.parentId=null;renderKnowledgePicker()}));
    $('qsPickerBreadcrumb').addEventListener('click',event=>{const button=event.target.closest('[data-picker-parent]');if(!button)return;state.picker.parentId=button.dataset.pickerParent||null;state.picker.query='';$('qsPickerSearch').value='';renderKnowledgePicker()});
    $('qsPickerResults').addEventListener('click',event=>{const star=event.target.closest('[data-picker-star]');if(star){toggleFavorite(star.dataset.pickerStar);return}const open=event.target.closest('[data-picker-open]');if(open){state.picker.parentId=open.dataset.pickerOpen;state.picker.query='';$('qsPickerSearch').value='';renderKnowledgePicker();return}const select=event.target.closest('[data-picker-node]');if(select){state.picker.selectedNodeId=select.dataset.pickerNode;renderKnowledgePicker()}});
    $('qsPickerFavoriteBtn').addEventListener('click',()=>toggleFavorite());$('qsPickerConfirmBtn').addEventListener('click',confirmKnowledgePicker);
    $('qsSaveDraftBtn').addEventListener('click',saveAndSubmit);$('qsBackupBtn').addEventListener('click',createBackup);$('qsRestoreBackupBtn').addEventListener('click',restoreBackup);$('qsExportBtn').addEventListener('click',exportPackage);$('qsExportCurrentBtn').addEventListener('click',exportCurrent);$('qsSubmitLibraryBtn').addEventListener('click',submitLibrary);
    $('qsImportBtn').addEventListener('click',()=>$('qsImportFile').click());$('qsImportFile').addEventListener('change',event=>importFile(event.target.files?.[0]));
    ['qsPackageId','qsPackageVersion','qsAuthor','qsRawText'].forEach(id=>$(id).addEventListener('input',scheduleSave));
    window.addEventListener('beforeunload',()=>{if(state.dirty)saveDraft(false)});
  }
  function init(){renderBatchSelectors();bind();renderBackups();if(!loadDraft()){$('qsRawText').value=Parser.SAMPLE;$('qsSaveState').textContent='已载入示例模板';}renderAll()}
  document.addEventListener('DOMContentLoaded',init);
})();
