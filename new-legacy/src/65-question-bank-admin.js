'use strict';

(function(){
  const $ = id => document.getElementById(id);
  const Catalog = window.KGQuestionCatalogAdapter;
  const CatalogEditor = window.KGQuestionCatalogEditController;
  const STORAGE_PREFIX = 'kg_question_banks_v1__';
  const CURRENT_PREFIX = 'kg_question_current_v1__';
  const PAPER_PREFIX = 'kg_exam_papers_v1__';
  const PAPER_CURRENT_PREFIX = 'kg_exam_current_v1__';
  const PAPER_CATEGORY_PREFIX = 'kg_exam_paper_categories_v1__';
  const PUBLISHED_BANKS_KEY = 'kg_question_banks_published_v1';
  const PUBLISHED_PAPERS_KEY = 'kg_exam_papers_published_v1';
  const PAPER_RELEASE_HISTORY_KEY = 'kg_exam_paper_release_history_v1';
  const AUTH_SESSION_KEY = 'kg_local_current_user_v1';
  const DEEP_RECALL_KEY = 'kg_deep_recall_current_question_v1';
  const DEMO_SUPPRESSED_PREFIX = 'kg_question_bank_demo_suppressed_v1__';
  const TAG_CONFIG_KEY = 'kg_question_tag_names_v1';
  const ADMIN_AUDIT_KEY = 'kg_admin_audit_log_v1';
  const PAPER_WORKSPACE_LAYOUT_KEY = 'kg_paper_workspace_layout_v1';
  const QUESTION_LIBRARY_WORKSPACE_LAYOUT_KEY = 'kg_question_library_workspace_layout_v1';
  const DEMO_BANK_ID = 'bank-pmp-demo';
  const DEMO_QUESTION_ID = 'pmp-agile-change-001';
  const QUESTION_PAGE_SIZE = 20;
  const BANK_PAGE_SIZE = 8;
  const COGNITIVE_PAGE_SIZE = 10;
  const PAPER_CANDIDATE_PAGE_SIZE = 20;
  const PAPER_LIST_PAGE_SIZE = 18;

  const SUBJECTS = [
    {
      id:'PMP',
      name:'PMP',
      fullName:'Project Management Professional',
      label:'PMP 项目管理专业人士',
      color:'#2563eb',
      focus:['项目管理原则','绩效域','预测型/敏捷/混合','情景判断']
    },
    {
      id:'CSPM',
      name:'CSPM',
      fullName:'项目管理专业人员能力评价',
      label:'CSPM 项目管理能力评价',
      color:'#7c3aed',
      focus:['项目治理','复杂项目','组织级能力','标准化实践']
    },
    {
      id:'P2',
      name:'P2',
      fullName:'PRINCE2 / P2',
      label:'P2 / PRINCE2',
      color:'#0f766e',
      focus:['商业论证','组织角色','阶段控制','例外管理']
    },
    {
      id:'ACP',
      name:'ACP',
      fullName:'Agile Certified Practitioner',
      label:'ACP 敏捷项目管理',
      color:'#16a34a',
      focus:['敏捷心态','价值交付','团队协作','持续改进']
    },
    {
      id:'NPDP',
      name:'NPDP',
      fullName:'New Product Development Professional',
      label:'NPDP 产品经理国际资格',
      color:'#db2777',
      focus:['新产品战略','组合管理','市场研究','产品生命周期']
    },
    {
      id:'PgMP',
      name:'PgMP',
      fullName:'Program Management Professional',
      label:'PgMP 项目集管理',
      color:'#ea580c',
      focus:['收益管理','治理','干系人','项目集生命周期'],
      future:true
    },
    {
      id:'PfMP',
      name:'PfMP',
      fullName:'Portfolio Management Professional',
      label:'PfMP 项目组合管理',
      color:'#0891b2',
      focus:['战略对齐','组合治理','资源配置','价值最大化'],
      future:true
    },
    {
      id:'CUSTOM',
      name:'自定义',
      fullName:'Custom Subject',
      label:'自定义科目',
      color:'#64748b',
      focus:['可扩展认证','内部课程','专题题库']
    }
  ];
  const DEFAULT_SUBJECTS = new Set(['PMP','CSPM','P2','ACP','NPDP']);
  function isTrainingConfigurationStep(){try{const params=new URLSearchParams(location.search||'');return params.get('step')==='training'||document.body?.dataset?.qbWorkflowStep==='training'}catch(error){return false}}

  let state = {
    banks: [],
    selectedBankId: '',
    selectedQuestionId: '',
    papers: [],
    paperCategories: [],
    selectedPaperId: '',
    selectedPaperIds:new Set(),
    currentPaperPageIds:[],
    paperCategoryFilter:'ALL',
    paperListStatus:'ALL',
    paperListSearch:'',
    paperListPage:1,
    subjectFilter: 'ALL',
    bankPage: 1,
    activeSidebarTab: 'banks',
    activeAnnotationTab: 'recall',
    activeLayoutNav: 'banks',
    activeMainTab: 'banks',
    questionSearch: '',
    questionGroupMode: 'topic',
    questionLifecycleFilter: 'active',
    questionPage: 1,
    selectedQuestionIds: new Set(),
    currentPageQuestionIds: [],
    bulkKnowledgeDraftId: '',
    bulkTagDraft: new Set(),
    pendingSafeDeleteIds: [],
    pendingPermanentDeleteIds: [],
    cluePage: 1,
    conceptPage: 1,
    collapsedQuestionGroups: {},
    editingClueId: '',
    editingConceptId: '',
    pendingKeywordSelection: null,
    dirty: false,
    serverCatalogNewerRevision: 0,
    serverCatalogLocalDraft: null,
    serverCatalogConflictReason: '',
    catalogPendingClueTouched: false,
    catalogPendingConceptTouched: false,
    catalogPendingFloatingClueTouched: false,
    recallLibraryPreview:null,
    recallNodeEditId:'',
    recallNodeDraftChoices:[],
    recallNodeDragIndex:-1,
    paperCandidateSearch:'',
    paperCandidateBankId:'ALL',
    paperCandidatePage:1,
    currentPaperCandidateKeys:[],
    selectedPaperCandidateKeys:new Set(),
    selectedPaperQuestionKeys:new Set(),
    paperWorkspaceMode:'split',
    paperPaneRatio:0.5,
    paperPreviewRef:null,
    paperPreviewAnchor:null,
    paperPreviewSource:'',
    paperPreviewClickTimer:0,
    libraryWorkspaceMode:'split',
    libraryPaneRatio:0.42,
    libraryPreviewRef:null,
    libraryPreviewAnchor:null,
    libraryPreviewClickTimer:0
  };
  let catalogUiReady=false;
  const CATALOG_EDITOR_FIELD_IDS=new Set([
    'bankSubject','bankCustomSubject','bankName','bankVersion','bankVisibility','bankDescription',
    'questionTitleInput','questionTitleEnInput','questionTypeInput','questionDifficultyInput',
    'questionDomainInput','questionTopicInput','questionTagsInput','questionPrincipleIdsInput',
    'questionStemInput','questionStemEnInput','questionAnalysisInput','questionAnalysisEnInput',
    'qbRecallKeywordsInput','qbRecallBindingsInput','qbRecallLibraryText','qbRecallNodeTitle','qbRecallNodeTitleEn',
    'qbRecallNodePrompt','qbRecallNodePromptEn','qbRecallNodeHint','qbRecallNodeHintEn','qbRecallCandidateInput',
    'clueTextInput','clueTypeInput','clueRoleInput','clueSourceInput','clueOptionIdInput','clueConceptIdsInput','clueExplainInput',
    'conceptIdInput','conceptTitleInput','conceptCategoryInput','conceptLevelInput','conceptKeywordsInput','conceptColorInput',
    'conceptSummaryInput','conceptNotesInput','conceptRuleInput','floatingClueTextInput','floatingClueTypeInput',
    'floatingClueRoleInput','floatingClueConceptIdsInput','floatingClueExplainInput'
  ]);

  function escapeHTML(value){
    return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }
  function safeId(prefix='id'){
    const c = globalThis.crypto;
    return prefix + '-' + (c && c.randomUUID ? c.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  }
  function clone(obj){
    return JSON.parse(JSON.stringify(obj));
  }
  function normalizeQuestionLifecycle(question){
    const raw=question?.lifecycle&&typeof question.lifecycle==='object'?question.lifecycle:{};
    const status=raw.status==='deleted'||question?.deletedAt?'deleted':'active';
    return {
      status,
      deletedAt:status==='deleted'?String(raw.deletedAt||question?.deletedAt||''):'',
      deletedBy:status==='deleted'&&raw.deletedBy&&typeof raw.deletedBy==='object'?clone(raw.deletedBy):null,
      deletedBatchId:status==='deleted'?String(raw.deletedBatchId||''):'',
      restoredAt:String(raw.restoredAt||''),
      restoredBy:raw.restoredBy&&typeof raw.restoredBy==='object'?clone(raw.restoredBy):null
    };
  }
  function isQuestionDeleted(question){return normalizeQuestionLifecycle(question).status==='deleted'}
  function activeQuestions(bank){return (bank?.questions||[]).filter(question=>!isQuestionDeleted(question))}
  function questionMatchesLifecycle(question,filter=state.questionLifecycleFilter){
    if(filter==='deleted')return isQuestionDeleted(question);
    if(isQuestionDeleted(question))return false;
    if(filter==='unclassified')return !String(question?.metadata?.knowledge?.primaryNodeId||'');
    return true;
  }
  function clearQuestionSelection(){state.selectedQuestionIds=new Set();state.currentPageQuestionIds=[]}
  function selectedQuestions(){
    const bank=currentBank();if(!bank)return [];
    return [...state.selectedQuestionIds].map(id=>bank.questions.find(question=>question.id===id)).filter(Boolean);
  }
  function currentActor(){
    const user=window.KGAuthCore?.currentUser?.({includeInactive:true})||null;
    return {id:String(user?.id||user?.username||currentUsername()||'local-teacher'),name:String(user?.displayName||user?.name||user?.username||currentUsername()||'本地教师'),role:String(user?.role||'teacher')};
  }
  function recordQuestionAudit(action,question,before,after,batchId,summary,status='success',extra={}){
    const record={id:safeId('audit'),schemaVersion:1,at:new Date().toISOString(),actor:currentActor(),action:String(action||'question.update'),entityType:'question',entityId:String(question?.id||''),status,summary:String(summary||''),transactionId:String(batchId||''),metadata:{questionId:String(question?.id||''),teacherNumber:String(question?.teacherNumber||''),bankId:String(currentBank()?.id||''),batchId:String(batchId||''),originalClassification:clone(before),newClassification:clone(after),...clone(extra||{})}};
    try{const rows=JSON.parse(localStorage.getItem(ADMIN_AUDIT_KEY)||'[]');localStorage.setItem(ADMIN_AUDIT_KEY,JSON.stringify([record,...(Array.isArray(rows)?rows:[])].slice(0,500)))}catch(error){console.warn('题目审计记录保存失败',error)}
    return record;
  }
  function cleanList(value){
    if(Array.isArray(value)) return value.map(x => String(x).trim()).filter(Boolean);
    return String(value || '').split(/[,，、;；|]/).map(x => x.trim()).filter(Boolean);
  }
  function canonicalTagName(value){
    let current=String(value||'').trim();if(!current)return '';
    try{const config=JSON.parse(localStorage.getItem(TAG_CONFIG_KEY)||'{}');const aliases=config?.aliases&&typeof config.aliases==='object'?config.aliases:{};const visited=new Set();while(aliases[current]&&!visited.has(current)){visited.add(current);current=String(aliases[current]||current).trim()||current}}catch(e){}
    return current;
  }
  function canonicalTags(value){return [...new Set(cleanList(value).map(canonicalTagName).filter(Boolean))]}
  function subjectMeta(id){
    return SUBJECTS.find(s => s.id === id || s.name === id) || SUBJECTS.find(s => s.id === 'CUSTOM');
  }
  function normalizeQuestionKnowledge(question,subject){
    const raw=question?.metadata?.knowledge&&typeof question.metadata.knowledge==='object'?question.metadata.knowledge:{};
    const subjectRecord=window.KGLearningContent?.subjectById?.(subject)||window.KGLearningContent?.subjectById?.(String(subject||'').toUpperCase());
    const taxonomy=window.KGLearningContent?.defaultTaxonomyForSubject?.(subjectRecord?.id||subject);
    const taxonomyId=String(raw.taxonomyId||taxonomy?.id||'');
    const primaryNodeId=String(raw.primaryNodeId||'');
    const node=primaryNodeId&&taxonomyId?window.KGLearningContent?.nodeById?.(taxonomyId,primaryNodeId):null;
    return {
      taxonomyId,
      taxonomyVersion:Number(raw.taxonomyVersion)||Number(taxonomy?.version)||1,
      primaryNodeId:node?.id||null,
      relatedNodeIds:[],
      mappingStatus:node?String(raw.mappingStatus||'confirmed'):'unmapped',
      mappingSource:String(raw.mappingSource||''),
      pathSnapshot:node?(Array.isArray(raw.pathSnapshot)&&raw.pathSnapshot.length?raw.pathSnapshot:window.KGLearningContent?.pathForNode?.(taxonomyId,node.id)?.map(item=>item.title?.zh||item.id)||[]):[],
      confirmedAt:String(raw.confirmedAt||''),
      confirmedBy:raw.confirmedBy&&typeof raw.confirmedBy==='object'?clone(raw.confirmedBy):null
    };
  }
  function sessionScope(){
    try{
      const username = window.KGAuthCore?.currentUsername?.() || localStorage.getItem(AUTH_SESSION_KEY);
      return username ? 'user__' + encodeURIComponent(username) : 'public';
    }catch(e){
      return 'public';
    }
  }
  function banksKey(){
    return STORAGE_PREFIX + sessionScope();
  }
  function currentUsername(){
    try{return String(window.KGAuthCore?.currentUsername?.() || localStorage.getItem(AUTH_SESSION_KEY) || 'local-teacher')}catch(e){return 'local-teacher'}
  }
  function currentKey(){
    return CURRENT_PREFIX + sessionScope();
  }
  function papersKey(){
    return PAPER_PREFIX + sessionScope();
  }
  function currentPaperKey(){
    return PAPER_CURRENT_PREFIX + sessionScope();
  }
  function paperCategoriesKey(){
    return PAPER_CATEGORY_PREFIX + sessionScope();
  }
  function demoSuppressedKey(){
    return DEMO_SUPPRESSED_PREFIX + sessionScope();
  }
  function isDemoSuppressed(){
    try{
      return localStorage.getItem(demoSuppressedKey()) === '1';
    }catch(e){
      return false;
    }
  }
  function suppressDemoExample(){
    try{
      localStorage.setItem(demoSuppressedKey(), '1');
    }catch(e){}
  }
  function scopeLabel(){
    const scope = sessionScope();
    if(scope === 'public') return '当前空间：公共/未登录本地数据';
    return '当前空间：' + decodeURIComponent(scope.replace(/^user__/, '')) + ' 的账号题库';
  }

  function emptyQuestion(subject='PMP'){
    return normalizeQuestion({
      id:safeId('q'),
      title:'未命名项目管理情景题',
      type:'single_choice',
      subject,
      difficulty:'中等',
      domain:'',
      topic:'',
      tags:[],
      stemParts:[{text:'请在这里输入题干，然后在题干中选中文本标记关键词。'}],
      options:[
        {id:'A',text:'选项 A',trap:''},
        {id:'B',text:'选项 B',trap:''},
        {id:'C',text:'选项 C',trap:'',correct:true},
        {id:'D',text:'选项 D',trap:''}
      ],
      correctAnswer:'C',
      analysis:'',
      clues:[],
      concepts:[],
      reasoningSteps:[],
      metadata:{knowledge:normalizeQuestionKnowledge({},subject),classificationHistory:[]},
      status:{contentReady:false,keywordsReady:false,knowledgeReady:false,reasoningReady:false,published:false}
    });
  }

  function demoQuestion(){
    const fallback = window.PMP_QUESTION_MVP ? clone(window.PMP_QUESTION_MVP) : emptyQuestion('PMP');
    fallback.subject = fallback.subject || 'PMP';
    fallback.type = fallback.type || 'single_choice';
    fallback.analysis = fallback.analysis || '该题的核心是识别敏捷环境、迭代中期和新需求优先级判断，不能未经评估直接把新功能塞进当前迭代。';
    fallback.reasoningSteps = fallback.reasoningSteps || [
      {
        id:safeId('rs'),
        title:'识别项目环境',
        content:'题干明确是敏捷团队，因此优先使用敏捷需求管理和产品待办列表思维。',
        relatedKeywords:['敏捷团队'],
        relatedKnowledgePoints:['agile-change'],
        recallQuestion:'为什么这道题不能先套用预测型变更控制流程？'
      },
      {
        id:safeId('rs'),
        title:'识别关键冲突',
        content:'客户提出高价值功能，但当前迭代承诺可能受影响，说明需要评估价值和优先级。',
        relatedKeywords:['新的高价值功能','当前迭代承诺的工作可能无法完成'],
        relatedKnowledgePoints:['product-backlog','iteration-goal'],
        recallQuestion:'高价值是否意味着必须立即加入当前迭代？'
      },
      {
        id:safeId('rs'),
        title:'匹配角色与动作',
        content:'产品负责人负责产品待办列表和优先级，因此应与产品负责人讨论，而不是直接命令团队加班。',
        relatedKeywords:['立即加入当前迭代'],
        relatedKnowledgePoints:['product-owner'],
        recallQuestion:'这个场景中产品负责人为什么是关键角色？'
      }
    ];
    return normalizeQuestion(fallback);
  }

  function starterBanks(){
    const now = Date.now();
    return [
      {
        id:DEMO_BANK_ID,
        name:'PMP 敏捷场景题示例题库',
        subject:'PMP',
        description:'内置演示题库：用于体验题干关键词、知识点绑定、推理步骤和深度回忆预览。',
        version:'1.0',
        visibility:'public-demo',
        createdAt:now,
        updatedAt:now,
        questions:[demoQuestion()]
      },
      {
        id:'bank-cspm-starter',
        name:'CSPM 项目管理能力题库',
        subject:'CSPM',
        description:'CSPM 项目管理能力、项目治理、复杂项目和组织级能力的题库占位，可直接新增题目。',
        version:'1.0',
        visibility:'private',
        createdAt:now,
        updatedAt:now,
        questions:[]
      },
      {
        id:'bank-p2-starter',
        name:'P2 / PRINCE2 过程与主题题库',
        subject:'P2',
        description:'P2 / PRINCE2 商业论证、组织、阶段控制、例外管理等主题题库占位。',
        version:'1.0',
        visibility:'private',
        createdAt:now,
        updatedAt:now,
        questions:[]
      },
      {
        id:'bank-acp-starter',
        name:'ACP 敏捷项目管理题库',
        subject:'ACP',
        description:'ACP 敏捷心态、价值交付、团队协作和持续改进题库占位。',
        version:'1.0',
        visibility:'private',
        createdAt:now,
        updatedAt:now,
        questions:[]
      },
      {
        id:'bank-npdp-starter',
        name:'NPDP 新产品开发题库',
        subject:'NPDP',
        description:'NPDP 新产品战略、组合管理、市场研究和产品生命周期题库占位。',
        version:'1.0',
        visibility:'private',
        createdAt:now,
        updatedAt:now,
        questions:[]
      }
    ].map(normalizeBank);
  }

  function normalizeOption(option, index, correctAnswer){
    const id = String(option && option.id || String.fromCharCode(65 + index));
    return {
      id,
      text:String(option && option.text || ''),
      trap:String(option && option.trap || ''),
      correct:!!(option && option.correct) || String(correctAnswer || '') === id
    };
  }
  function normalizeClue(clue, index){
    clue = clue && typeof clue === 'object' ? clue : {};
    const text = String(clue.text || clue.keyword || '');
    const sourceOptionId = String(clue.sourceOptionId || clue.optionId || '');
    return {
      id:String(clue.id || slugify(text) || ('clue-' + index)),
      text,
      textEn:String(clue.textEn || clue.englishText || clue.translation?.en?.text || ''),
      type:String(clue.type || 'core'),
      clueRole:String(clue.clueRole || clue.role || 'true'),
      sourceType:String(clue.sourceType || (sourceOptionId ? 'option' : 'stem')),
      sourceOptionId,
      conceptIds:Array.isArray(clue.conceptIds) ? clue.conceptIds.map(String) : cleanList(clue.conceptIds),
      explain:String(clue.explain || clue.description || ''),
      recallNodeId:String(clue.recallNodeId || clue.entryNodeId || ''),
      recallEntryLabel:String(clue.recallEntryLabel || clue.entryLabel || ''),
      sourceMode:String(clue.sourceMode || ''),
      matchLocations:Array.isArray(clue.matchLocations)?clue.matchLocations.map(item=>({field:String(item?.field||''),optionId:String(item?.optionId||''),count:Math.max(1,Number(item?.count)||1)})).filter(item=>item.field):[]
    };
  }
  function normalizeConcept(concept, index){
    concept = concept && typeof concept === 'object' ? concept : {};
    const title = String(concept.title || concept.name || '');
    return {
      id:String(concept.id || slugify(title) || ('concept-' + index)),
      title,
      color:String(concept.color || '#7c3aed'),
      category:String(concept.category || ''),
      level:String(concept.level || '重点'),
      keywords:String(Array.isArray(concept.keywords) ? concept.keywords.join(',') : concept.keywords || ''),
      summary:String(concept.summary || concept.explanation || ''),
      notes:String(concept.notes || concept.mnemonic || ''),
      rule:String(concept.rule || '')
    };
  }
  function normalizeReasoningStep(step, index){
    step = step && typeof step === 'object' ? step : {};
    return {
      id:String(step.id || ('rs-' + Date.now().toString(36) + '-' + index)),
      title:String(step.title || '推理步骤 ' + (index + 1)),
      content:String(step.content || step.description || ''),
      relatedKeywords:Array.isArray(step.relatedKeywords) ? step.relatedKeywords.map(String) : cleanList(step.relatedKeywords),
      relatedKnowledgePoints:Array.isArray(step.relatedKnowledgePoints) ? step.relatedKnowledgePoints.map(String) : cleanList(step.relatedKnowledgePoints),
      recallQuestion:String(step.recallQuestion || '')
    };
  }
  function normalizeTranslationOption(option, index){
    option=option&&typeof option==='object'?option:{};
    return {id:String(option.id||String.fromCharCode(65+index)),text:String(option.text||option.value||'')};
  }
  function normalizeTranslations(question){
    const source=question?.translations&&typeof question.translations==='object'?question.translations:{};
    const enSource=source.en||question?.translation?.en||question?.english||question?.en||question?.content?.en||{};
    const stemParts=Array.isArray(enSource.stemParts)?enSource.stemParts:(enSource.stem?[{text:enSource.stem}]:[]);
    const options=Array.isArray(enSource.options)?enSource.options.map(normalizeTranslationOption):[];
    const en={
      title:String(enSource.title||question?.titleEn||question?.englishTitle||''),
      stemParts:stemParts.map(part=>({text:String(part?.text||''),...(part?.clue?{clue:String(part.clue)}:{})})),
      options,
      analysis:String(enSource.analysis||enSource.explanation||question?.analysisEn||question?.explanationEn||'')
    };
    const hasEnglish=Boolean(en.title||en.analysis||en.stemParts.some(part=>part.text)||en.options.some(option=>option.text));
    return hasEnglish?{...source,en}:source;
  }
  function subjectNumberPrefix(subject){
    const prefix=String(subject||'PMP').toUpperCase().replace(/[^A-Z0-9]+/g,'').slice(0,8);
    return prefix||'Q';
  }
  function ensureTeacherNumbers(questions,subject){
    const prefix=subjectNumberPrefix(subject);let max=0;const used=new Set();
    (questions||[]).forEach(question=>{const value=String(question.teacherNumber||question.displayNumber||'').trim();const match=value.match(new RegExp('^'+prefix+'-(\\d+)$','i'));if(match)max=Math.max(max,Number(match[1])||0);if(value)used.add(value.toUpperCase())});
    (questions||[]).forEach(question=>{if(String(question.teacherNumber||'').trim())return;let value='';do{max+=1;value=prefix+'-'+String(max).padStart(6,'0')}while(used.has(value));question.teacherNumber=value;used.add(value)});
    return questions;
  }
  function ensureGlobalTeacherNumbers(banks){
    const states=new Map();
    (banks||[]).forEach(bank=>{
      const subject=String(bank.subject||'PMP'),prefix=subjectNumberPrefix(subject);if(!states.has(subject))states.set(subject,{prefix,max:0,used:new Set()});const info=states.get(subject);
      (bank.questions||[]).forEach(question=>{const value=String(question.teacherNumber||'').trim().toUpperCase();const match=value.match(new RegExp('^'+prefix+'-(\d+)$','i'));if(match&&!info.used.has(value)){info.max=Math.max(info.max,Number(match[1])||0);info.used.add(value)}else question.teacherNumber=''});
    });
    (banks||[]).forEach(bank=>{const subject=String(bank.subject||'PMP'),info=states.get(subject);(bank.questions||[]).forEach(question=>{if(question.teacherNumber)return;let value='';do{info.max+=1;value=info.prefix+'-'+String(info.max).padStart(6,'0')}while(info.used.has(value));question.teacherNumber=value;info.used.add(value)})});
    return banks;
  }
  function nextTeacherNumber(subject){
    const prefix=subjectNumberPrefix(subject);let max=0;
    state.banks.forEach(bank=>(bank.questions||[]).forEach(question=>{const match=String(question.teacherNumber||'').match(new RegExp('^'+prefix+'-(\\d+)$','i'));if(match)max=Math.max(max,Number(match[1])||0)}));
    return prefix+'-'+String(max+1).padStart(6,'0');
  }
  function englishStemText(question){return (question?.translations?.en?.stemParts||[]).map(part=>part?.text||'').join('')}

  function normalizeQuestion(question, index=0){
    question = question && typeof question === 'object' ? question : {};
    const stemParts = Array.isArray(question.stemParts) ? question.stemParts : [{text:String(question.stem || '')}];
    const correct = String(question.correctAnswer || '');
    const options = Array.isArray(question.options) ? question.options.map((o,i) => normalizeOption(o,i,correct)) : [];
    const detectedCorrect = options.find(o => o.correct);
    const correctAnswer = String(question.correctAnswer || detectedCorrect?.id || options[0]?.id || '');
    options.forEach(o => { o.correct = o.id === correctAnswer || o.correct && !correctAnswer; });
    return {
      ...question,
      id:String(question.id || ('q-' + Date.now().toString(36) + '-' + index)),
      teacherNumber:String(question.teacherNumber || question.displayNumber || ''),
      title:String(question.title || '未命名题目'),
      type:String(question.type || 'single_choice'),
      subject:String(question.subject || ''),
      difficulty:String(question.difficulty || ''),
      domain:String(question.domain || ''),
      topic:String(question.topic || ''),
      tags:canonicalTags(question.tags),
      lifecycle:normalizeQuestionLifecycle(question),
      stemParts:stemParts.map(p => ({text:String(p && p.text || ''), ...(p && p.clue ? {clue:String(p.clue)} : {})})),
      options,
      correctAnswer,
      analysis:String(question.analysis || ''),
      translations:normalizeTranslations(question),
      metadata:{...(question.metadata&&typeof question.metadata==='object'?question.metadata:{}),tagPaths:Array.isArray(question.metadata?.tagPaths)?question.metadata.tagPaths.map(item=>item&&typeof item==='object'?{...item,label:canonicalTagName(item.label)}:item):[],translationStatus:String(question.metadata?.translationStatus || (normalizeTranslations(question).en?'bilingual':'zh_only')),knowledge:normalizeQuestionKnowledge(question,String(question.subject||'')),classificationHistory:Array.isArray(question.metadata?.classificationHistory)?question.metadata.classificationHistory.slice(-50):[]},
      clues:Array.isArray(question.clues) ? question.clues.map(normalizeClue).filter(c => c.text || c.textEn) : [],
      concepts:Array.isArray(question.concepts) ? question.concepts.map(normalizeConcept).filter(c => c.title) : [],
      reasoningSteps:Array.isArray(question.reasoningSteps) ? question.reasoningSteps.map(normalizeReasoningStep) : [],
      status:{
        contentReady:!!(question.status && question.status.contentReady),
        keywordsReady:!!(question.status && question.status.keywordsReady),
        knowledgeReady:!!(question.status && question.status.knowledgeReady),
        reasoningReady:!!(question.status && question.status.reasoningReady),
        published:!!(question.status && question.status.published)
      }
    };
  }
  function normalizeBank(bank, index=0){
    bank = bank && typeof bank === 'object' ? bank : {};
    const subject = String(bank.subject || 'PMP');
    const questions=ensureTeacherNumbers(Array.isArray(bank.questions) ? bank.questions.map((q,i) => normalizeQuestion({...q, subject:q.subject || subject}, i)) : [],subject);
    return {
      ...bank,
      id:String(bank.id || bank.bankId || ('bank-' + Date.now().toString(36) + '-' + index)),
      name:String(bank.name || bank.bankName || subject + ' 题库'),
      subject,
      description:String(bank.description || ''),
      version:String(bank.version || '1.0'),
      visibility:String(bank.visibility || 'private'),
      revision:Math.max(0,Number(bank.revision || 0)),
      ownerId:String(bank.ownerId || ''),
      accessMode:String(bank.accessMode || ''),
      createdBy:String(bank.createdBy || ''),
      updatedBy:String(bank.updatedBy || ''),
      publishedBy:String(bank.publishedBy || ''),
      publishedAt:Number(bank.publishedAt || 0),
      createdAt:Number(bank.createdAt || Date.now()),
      updatedAt:Number(bank.updatedAt || Date.now()),
      questions
    };
  }

  function normalizePaper(paper, index=0){
    paper = paper && typeof paper === 'object' ? paper : {};
    const subject = String(paper.subject || 'PMP');
    const rawQuestions = Array.isArray(paper.questions) ? paper.questions : (Array.isArray(paper.questionRefs) ? paper.questionRefs : []);
    const questions = rawQuestions.map((item, i) => ({
      bankId:String(item.bankId || item.sourceBankId || ''),
      questionId:String(item.questionId || item.id || ''),
      order:Number(item.order || i + 1),
      score:Number(item.score || 1)
    })).filter(item => item.bankId && item.questionId).sort((a,b) => a.order - b.order);
    const quotas = paper.quotas && typeof paper.quotas === 'object' ? paper.quotas : {};
    return {
      id:String(paper.id || ('paper-' + Date.now().toString(36) + '-' + index)),
      name:String(paper.name || subject + ' 综合训练试卷'),
      subject,
      description:String(paper.description || ''),
      totalCount:Number(paper.totalCount || paper.targetCount || 180),
      status:String(paper.status || 'draft'),
      createdAt:Number(paper.createdAt || Date.now()),
      updatedAt:Number(paper.updatedAt || Date.now()),
      publishedAt:paper.publishedAt ? Number(paper.publishedAt) : 0,
      publishedVersion:Math.max(0, Number(paper.publishedVersion || paper.releaseVersion || 0)),
      publishedReleaseId:String(paper.publishedReleaseId || ''),
      enabledModes:[...new Set((Array.isArray(paper.enabledModes) ? paper.enabledModes : ['deep_recall','multi_question_canvas','single_deep_study']).map(String).filter(mode => ['deep_recall','multi_question_canvas','single_deep_study'].includes(mode)))],
      purpose:String(paper.purpose || 'learning'),
      categoryId:String(paper.categoryId || ''),
      archivedAt:Number(paper.archivedAt || 0),
      quotas:Object.fromEntries(Object.entries(quotas).map(([k,v]) => [String(k), Math.max(0, Number(v || 0))])),
      questions
    };
  }

  function loadPapers(){
    try{
      const raw = localStorage.getItem(papersKey());
      const parsed = JSON.parse(raw || 'null');
      if(Array.isArray(parsed)) return parsed.map(normalizePaper);
    }catch(e){
      console.warn(e);
    }
    return [];
  }
  function savePapers(nextPapers=state.papers, options={}){
    state.papers = (nextPapers || []).map(normalizePaper);
    try{
      localStorage.setItem(papersKey(), JSON.stringify(state.papers));
      if(!options.silent) toast('试卷已保存。');
    }catch(e){
      alert('保存试卷失败：' + (e.message || e));
    }
  }
  function normalizePaperCategory(category,index=0){
    category=category&&typeof category==='object'?category:{};
    return {id:String(category.id||('paper-category-'+index)),name:String(category.name||`分类 ${index+1}`).trim()||`分类 ${index+1}`,createdAt:Number(category.createdAt||Date.now()),updatedAt:Number(category.updatedAt||Date.now())};
  }
  function loadPaperCategories(){
    try{const parsed=JSON.parse(localStorage.getItem(paperCategoriesKey())||'[]');return Array.isArray(parsed)?parsed.map(normalizePaperCategory):[]}catch(error){console.warn('读取试卷分类失败',error);return []}
  }
  function savePaperCategories(rows=state.paperCategories){
    state.paperCategories=(rows||[]).map(normalizePaperCategory);
    try{localStorage.setItem(paperCategoriesKey(),JSON.stringify(state.paperCategories));return true}catch(error){alert('保存试卷分类失败：'+(error.message||error));return false}
  }
  function paperCategoryName(categoryId){
    if(!categoryId)return '未分类';
    return state.paperCategories.find(item=>item.id===categoryId)?.name||'未分类';
  }
  function paperStatusKey(paper){
    if(paper?.status==='archived')return 'archived';
    return Number(paper?.publishedVersion||0)>0?'published':'draft';
  }
  function filteredPapers(){
    const keyword=String(state.paperListSearch||'').trim().toLowerCase();
    return state.papers.filter(paper=>{
      if(state.paperCategoryFilter==='UNCATEGORIZED'&&paper.categoryId)return false;
      if(state.paperCategoryFilter!=='ALL'&&state.paperCategoryFilter!=='UNCATEGORIZED'&&paper.categoryId!==state.paperCategoryFilter)return false;
      if(state.paperListStatus!=='ALL'&&paperStatusKey(paper)!==state.paperListStatus)return false;
      if(keyword&&!String([paper.name,paper.subject,paper.description,paperCategoryName(paper.categoryId)].join(' ')).toLowerCase().includes(keyword))return false;
      return true;
    }).sort((a,b)=>Number(b.updatedAt||0)-Number(a.updatedAt||0));
  }
  function paperPageRows(){
    const rows=filteredPapers(),pages=Math.max(1,Math.ceil(rows.length/PAPER_LIST_PAGE_SIZE));state.paperListPage=Math.min(Math.max(1,state.paperListPage),pages);const start=(state.paperListPage-1)*PAPER_LIST_PAGE_SIZE;return {rows,pageRows:rows.slice(start,start+PAPER_LIST_PAGE_SIZE),pages,start};
  }
  function ensureSelectedPaperVisible(){
    const rows=filteredPapers();if(!rows.length){state.selectedPaperId='';return}
    if(!rows.some(item=>item.id===state.selectedPaperId))state.selectedPaperId=rows[0].id;
  }
  function currentPaper(){
    const selected=state.papers.find(p=>p.id===state.selectedPaperId);if(selected)return selected;
    if(document.body?.dataset?.paperManagementPage==='true'&&!state.selectedPaperId)return null;
    return state.papers[0]||null;
  }
  function paperQuestionLookup(ref){
    const bank = state.banks.find(b => b.id === ref.bankId);
    const question = bank && (bank.questions || []).find(q => q.id === ref.questionId);
    return {bank, question};
  }
  function paperIntegrity(paper){
    const refs = Array.isArray(paper && paper.questions) ? paper.questions : [];
    let validCount = 0;
    let missingCount = 0;
    const duplicateKeys = new Set();
    let duplicateCount = 0;
    refs.forEach(ref => {
      const key = String(ref.bankId || '') + '::' + String(ref.questionId || '');
      if(duplicateKeys.has(key)) duplicateCount += 1;
      duplicateKeys.add(key);
      const found = paperQuestionLookup(ref);
      if(found.bank && found.question) validCount += 1;
      else missingCount += 1;
    });
    return {
      configuredCount:refs.length,
      validCount,
      missingCount,
      duplicateCount,
      targetCount:Number(paper && paper.totalCount || refs.length || 0)
    };
  }
  function questionDomainKey(question){
    return String(question.domain || question.topic || '未设置领域');
  }
  function paperCandidates(subject){
    const rows = [];
    state.banks.forEach(bank => {
      if(subject && bank.subject !== subject) return;
      (bank.questions || []).filter(question=>!isQuestionDeleted(question)).forEach(question => {
        rows.push({
          bank,
          question,
          domain:questionDomainKey(question),
          completion:completionInfo(question).score
        });
      });
    });
    return rows;
  }
  function paperDomainStats(subject){
    const stats = new Map();
    paperCandidates(subject).forEach(row => {
      const key = row.domain;
      if(!stats.has(key)) stats.set(key, {domain:key, count:0, complete:0});
      const item = stats.get(key);
      item.count += 1;
      if(row.completion >= 50) item.complete += 1;
    });
    return Array.from(stats.values()).sort((a,b) => a.domain.localeCompare(b.domain, 'zh-Hans-CN'));
  }
  function setCurrentPaper(paper){
    try{
      if(paper && paper.status === 'published') localStorage.setItem(currentPaperKey(), JSON.stringify({paperId:paper.id, index:0, savedAt:Date.now()}));
      else localStorage.removeItem(currentPaperKey());
    }catch(e){}
  }

  function paperRefKey(ref){return String(ref?.bankId||'')+'::'+String(ref?.questionId||'')}
  function loadPublishedPaperCatalog(){
    try{const parsed=JSON.parse(localStorage.getItem(PUBLISHED_PAPERS_KEY)||'[]');return Array.isArray(parsed)?parsed:[]}catch(error){return []}
  }
  function savePublishedPaperCatalog(rows){
    try{localStorage.setItem(PUBLISHED_PAPERS_KEY,JSON.stringify(Array.isArray(rows)?rows:[]));window.dispatchEvent?.(new CustomEvent('kg:published-papers-changed'));return true}catch(error){console.warn('发布试卷目录保存失败',error);return false}
  }
  function buildPaperRelease(paper){
    const version=Math.max(0,Number(paper.publishedVersion||0))+1;
    const releaseId=String(paper.id)+'-v'+version+'-'+Date.now().toString(36);
    const snapshots=(paper.questions||[]).map(ref=>{
      const found=paperQuestionLookup(ref);
      if(!found.bank||!found.question)return null;
      return {bankId:String(ref.bankId),bankName:String(found.bank.name||'未命名题库'),bankSubject:String(found.bank.subject||paper.subject||'PMP'),questionId:String(ref.questionId),question:clone(found.question)};
    }).filter(Boolean);
    return {
      id:releaseId,paperId:String(paper.id),version,name:String(paper.name||'未命名试卷'),title:String(paper.name||'未命名试卷'),subject:String(paper.subject||'PMP'),description:String(paper.description||''),categoryId:String(paper.categoryId||''),categoryName:paperCategoryName(paper.categoryId),purpose:'learning',status:'published',
      enabledModes:[...(paper.enabledModes||[])],publishedAt:Date.now(),publishedBy:currentActor(),
      totalCount:(paper.questions||[]).length,questions:(paper.questions||[]).map((ref,index)=>({...clone(ref),order:index+1})),questionSnapshots:snapshots
    };
  }
  function publishPaperRelease(paper){
    const release=buildPaperRelease(paper);
    const current=loadPublishedPaperCatalog().filter(item=>String(item?.paperId||item?.id||'')!==String(paper.id));
    if(!savePublishedPaperCatalog([release,...current]))return null;
    try{const history=JSON.parse(localStorage.getItem(PAPER_RELEASE_HISTORY_KEY)||'[]');localStorage.setItem(PAPER_RELEASE_HISTORY_KEY,JSON.stringify([release,...(Array.isArray(history)?history:[])].slice(0,500)))}catch(error){}
    paper.status='published';paper.publishedAt=release.publishedAt;paper.publishedVersion=release.version;paper.publishedReleaseId=release.id;paper.archivedAt=0;
    return release;
  }
  function withdrawPaperRelease(paper){
    const current=loadPublishedPaperCatalog().filter(item=>String(item?.paperId||item?.id||'')!==String(paper?.id||''));
    savePublishedPaperCatalog(current);
  }

  function slugify(value){
    const s = String(value || '').trim();
    if(!s) return '';
    const ascii = s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
    if(ascii) return ascii.slice(0,60);
    let hash = 2166136261;
    for(let i=0;i<s.length;i++){
      hash ^= s.charCodeAt(i);
      hash += (hash<<1) + (hash<<4) + (hash<<7) + (hash<<8) + (hash<<24);
    }
    return 'kw-' + (hash >>> 0).toString(36);
  }
  function stemText(question){
    return (question && Array.isArray(question.stemParts) ? question.stemParts : []).map(p => p.text || '').join('');
  }
  function stemClues(clues){
    return (clues || []).filter(c => !c.sourceType || c.sourceType === 'stem');
  }
  function clueSourceLabel(clue){
    if(!clue || clue.sourceType !== 'option') return '题干';
    return '选项 ' + (clue.sourceOptionId || '?');
  }
  function rebuildStemParts(text, clues){
    text = String(text || '');
    const candidates = (clues || []).filter(c => c.text).map(c => {
      const index = text.indexOf(c.text);
      return index >= 0 ? {id:c.id, text:c.text, start:index, end:index + c.text.length} : null;
    }).filter(Boolean).sort((a,b) => a.start - b.start || b.end - a.end);
    const accepted = [];
    let cursor = 0;
    for(const item of candidates){
      if(item.start < cursor) continue;
      accepted.push(item);
      cursor = item.end;
    }
    const parts = [];
    cursor = 0;
    accepted.forEach(item => {
      if(item.start > cursor) parts.push({text:text.slice(cursor,item.start)});
      parts.push({text:text.slice(item.start,item.end), clue:item.id});
      cursor = item.end;
    });
    if(cursor < text.length) parts.push({text:text.slice(cursor)});
    return parts.length ? parts : [{text}];
  }

  function recallLibraryApi(){return window.KGRecallAssociationLibrary||null}
  function countOccurrences(text,phrase){
    const source=String(text||''),term=String(phrase||'');if(!term)return 0;
    let count=0,index=0;while((index=source.indexOf(term,index))>=0){count+=1;index+=Math.max(1,term.length)}return count;
  }
  function keywordLocations(question,keyword){
    const locations=[];const stemCount=countOccurrences(stemText(question),keyword);
    if(stemCount)locations.push({field:'stem',optionId:'',count:stemCount});
    (question?.options||[]).forEach(option=>{const count=countOccurrences(option.text,keyword);if(count)locations.push({field:'option',optionId:String(option.id||''),count})});
    return locations;
  }
  function parseRecallBindings(value){
    const map=new Map();String(value||'').split(/\r?\n/).forEach(line=>{
      const parts=line.split(/\s*(?:➡️|➡|→|->|=>)\s*/).map(item=>item.trim()).filter(Boolean);
      if(parts.length>=2)map.set(parts[0],parts[1]);
    });return map;
  }
  function recallKeywords(question){return [...new Set((question?.clues||[]).map(clue=>String(clue.text||'').trim()).filter(Boolean))]}
  function recallBindingLabel(subjectId,nodeId){
    if(!nodeId)return '';
    const node=recallLibraryApi()?.resolve?.(recallLibraryApi().read(subjectId),nodeId);
    return node?.title||nodeId;
  }
  function focusRecallBindingEditor(keyword,binding){
    const input=$('qbRecallBindingsInput');if(!input)return;
    const separator=/\s*(?:➡️|➡|→|->|=>)\s*/;
    let lines=String(input.value||'').split(/\r?\n/);
    if(lines.length===1&&!lines[0].trim())lines=[];
    let lineIndex=lines.findIndex(line=>{const parts=line.split(separator);return parts.length>=2&&String(parts[0]||'').trim()===keyword});
    if(lineIndex<0){lines.push(`${keyword} -> ${binding||keyword}`);lineIndex=lines.length-1}
    input.value=lines.join('\n');
    const line=lines[lineIndex]||'';const arrow=line.match(/(?:➡️|➡|→|->|=>)/);
    const lineStart=lines.slice(0,lineIndex).reduce((total,item)=>total+item.length+1,0);
    let valueStart=lineStart+(arrow?arrow.index+arrow[0].length:line.length);
    while(valueStart<input.value.length&&/\s/.test(input.value[valueStart]))valueStart+=1;
    const valueEnd=lineStart+line.length;
    input.focus();input.setSelectionRange(valueStart,valueEnd);input.scrollIntoView({behavior:'smooth',block:'center'});
  }
  function renderRecallConfig(){
    const q=currentQuestion(),bank=currentBank();
    const keywordsInput=$('qbRecallKeywordsInput'),bindingsInput=$('qbRecallBindingsInput'),status=$('qbRecallConfigStatus'),report=$('qbRecallLibraryReport');
    if(!keywordsInput||!bindingsInput||!status)return;
    if(!q||!bank){keywordsInput.value='';bindingsInput.value='';status.innerHTML='<div class="qb-empty">请先选择一道题目。</div>';return}
    const keywords=recallKeywords(q),api=recallLibraryApi(),library=api?.read?.(bank.subject);
    keywordsInput.value=keywords.join('\n');
    bindingsInput.value=keywords.map(keyword=>{
      const clue=(q.clues||[]).find(item=>item.text===keyword);
      return keyword+' -> '+(recallBindingLabel(bank.subject,clue?.recallNodeId)||keyword);
    }).join('\n');
    const cards=keywords.map((keyword,index)=>{
      const clue=(q.clues||[]).find(item=>item.text===keyword)||{};
      const locations=keywordLocations(q,keyword);
      const locationText=locations.length?locations.map(item=>item.field==='stem'?`题干 ${item.count} 处`:`选项 ${item.optionId} ${item.count} 处`).join('、'):'未在题干或选项中找到';
      const binding=recallBindingLabel(bank.subject,clue.recallNodeId)||keyword;
      const branch=api?.choices?.(library,clue.recallNodeId||keyword,{limit:4})||{node:null,total:0};
      const branchText=branch.node?(branch.total?`已配置 ${branch.total} 个后续分支`:'已存在知识点，暂无后续分支；学员可自由输入'):'联想库未收录；学员可自由输入';
      return `<article class="qb-recall-status-card ${locations.length?'is-found':'is-missing'}"><div class="qb-recall-status-card-head"><strong>${escapeHTML(keyword)}</strong><span>${escapeHTML(locationText)}</span></div><div class="qb-recall-entry">入口：<b>${escapeHTML(binding)}</b></div><small class="qb-recall-branch">${escapeHTML(branchText)}</small><div class="qb-recall-status-card-actions"><button type="button" data-edit-recall-binding="${index}">编辑入口</button></div></article>`;
    }).join('');
    status.innerHTML=cards||'<div class="qb-empty">尚未设置可点击关键词。输入后点击“同步关键词与入口”。</div>';
    status.querySelectorAll('[data-edit-recall-binding]').forEach(button=>button.addEventListener('click',()=>{const index=Number(button.dataset.editRecallBinding);const keyword=keywords[index];if(!keyword)return;const clue=(q.clues||[]).find(item=>item.text===keyword)||{};focusRecallBindingEditor(keyword,recallBindingLabel(bank.subject,clue.recallNodeId)||keyword)}));
    if(report&&!state.recallLibraryPreview){
      report.textContent=library?`当前 ${bank.subject} 联想库：${library.nodes.length} 个知识点，${library.edges.length} 条关系。`:'联想库服务未加载。';
    }
    refreshRecallNodeSelector();
  }
  async function syncRecallConfig(){
    const keywordValue=String($('qbRecallKeywordsInput')?.value||'');
    const bindingValue=String($('qbRecallBindingsInput')?.value||'');
    if(!await saveQuestionForm({silent:true}))return;
    const q=currentQuestion(),bank=currentBank();if(!q||!bank)return;
    const keywords=keywordValue.split(/[\r\n,，、;；|]+/).map(item=>item.trim()).filter(Boolean).filter((item,index,list)=>list.indexOf(item)===index);
    const bindings=parseRecallBindings(bindingValue);
    const existing=new Map((q.clues||[]).map(clue=>[String(clue.text),clue]));
    const advanced=(q.clues||[]).filter(clue=>clue.sourceMode!=='quick'&&!keywords.includes(clue.text));
    const quick=[];const missing=[];
    keywords.forEach((keyword,index)=>{
      const locations=keywordLocations(q,keyword);if(!locations.length){missing.push(keyword);return}
      const previous=existing.get(keyword)||{};
      const entry=String(bindings.get(keyword)||previous.recallNodeId||keyword).trim();
      const resolved=recallLibraryApi()?.resolve?.(recallLibraryApi().read(bank.subject),entry);
      const first=locations[0];
      quick.push(normalizeClue({...previous,id:previous.id||slugify(keyword)||safeId('clue'),text:keyword,type:previous.type||'core',clueRole:previous.clueRole||'true',sourceType:first.field==='option'?'option':'stem',sourceOptionId:first.optionId||'',recallNodeId:resolved?.id||entry,sourceMode:'quick',matchLocations:locations},index));
    });
    q.clues=[...advanced,...quick];
    q.stemParts=rebuildStemParts(stemText(q),stemClues(q.clues));
    q.status={...(q.status||{}),keywordsReady:q.clues.length>0};
    saveBanks(state.banks,{silent:true});render();
    toast(missing.length?`已同步 ${quick.length} 个关键词；${missing.length} 个未找到：${missing.join('、')}`:`已同步 ${quick.length} 个关键词与知识入口。`);
  }
  function parseRecallLibrary(save){
    const api=recallLibraryApi(),bank=currentBank(),text=$('qbRecallLibraryText')?.value||'';if(!api||!bank)return;
    const parsed=api.parseText(text);state.recallLibraryPreview=parsed;
    const report=$('qbRecallLibraryReport');
    if(!parsed.valid){if(report)report.innerHTML='<strong>解析失败</strong><span>'+escapeHTML((parsed.errors||[]).join('；'))+'</span>';return}
    if(save){
      const mode=$('qbRecallLibraryMode')?.value||'merge';
      const result=api.saveText(bank.subject,text,{mode});state.recallLibraryPreview=result;
      if(!result.valid){if(report)report.innerHTML='<strong>保存失败</strong><span>'+escapeHTML((result.errors||[]).join('；'))+'</span>';return}
      if(report)report.innerHTML=`<strong>已保存 ${escapeHTML(bank.subject)} 联想库</strong><span>${result.library.nodes.length} 个知识点 · ${result.library.edges.length} 条关系 · ${mode==='replace'?'替换':'合并'}模式</span>`;
      refreshRecallNodeSelector();toast('知识联想库已保存。');return;
    }
    if(report)report.innerHTML=`<strong>解析通过</strong><span>${parsed.report.nodeCount} 个知识点 · ${parsed.report.edgeCount} 条关系 · ${parsed.report.lineCount} 行 · 尚未保存</span>`;
  }
  function loadRecallLibraryEditor(){
    const api=recallLibraryApi(),bank=currentBank();if(!api||!bank)return;
    $('qbRecallLibraryText').value=api.toText(api.read(bank.subject));state.recallLibraryPreview=null;parseRecallLibrary(false);refreshRecallNodeSelector();
  }
  function importRecallLibraryFile(file){
    if(!file)return;const reader=new FileReader();reader.onload=()=>{$('qbRecallLibraryText').value=String(reader.result||'').replace(/^\ufeff/,'');parseRecallLibrary(false);$('qbRecallLibraryFile').value=''};reader.onerror=()=>toast('读取联想库文件失败。');reader.readAsText(file,'utf-8');
  }

  function recallStudioLibrary(){const api=recallLibraryApi(),bank=currentBank();return api&&bank?api.read(bank.subject):null}
  function recallStudioNode(id){const library=recallStudioLibrary();return library?.nodes?.find(node=>String(node.id)===String(id))||null}
  function recallStudioChoices(id){const api=recallLibraryApi(),library=recallStudioLibrary();if(!api||!library||!id)return [];return (api.choices(library,id,{limit:999})?.choices||[]).map(item=>({id:item.next,title:item.text,titleEn:item.textEn||''}))}
  function fillRecallNodeFields(node){const map={qbRecallNodeTitle:node?.title||'',qbRecallNodeTitleEn:node?.titleEn||'',qbRecallNodePrompt:node?.prompt||'',qbRecallNodePromptEn:node?.promptEn||'',qbRecallNodeHint:node?.hint||'',qbRecallNodeHintEn:node?.hintEn||''};Object.entries(map).forEach(([id,value])=>{const el=$(id);if(el)el.value=value})}
  function refreshRecallNodeSelector(preferredId){
    const select=$('qbRecallNodeSelect'),suggestions=$('qbRecallNodeSuggestions'),library=recallStudioLibrary();if(!select||!library)return;
    const nodes=(library.nodes||[]).slice().sort((a,b)=>String(a.title||'').localeCompare(String(b.title||''),'zh-CN'));
    if(suggestions)suggestions.innerHTML=nodes.map(node=>`<option value="${escapeHTML(node.title)}">${escapeHTML(node.titleEn||node.id)}</option>`).join('');
    select.innerHTML=nodes.length?nodes.map(node=>`<option value="${escapeHTML(node.id)}">${escapeHTML(node.title)}${node.titleEn?' / '+escapeHTML(node.titleEn):''}</option>`).join(''):'<option value="">暂无节点</option>';
    let next=String(preferredId||state.recallNodeEditId||'');if(!nodes.some(node=>node.id===next)){const q=currentQuestion(),firstClue=(q?.clues||[]).find(clue=>clue.recallNodeId),resolved=firstClue?recallLibraryApi()?.resolve?.(library,firstClue.recallNodeId):null;next=resolved?.id||nodes[0]?.id||''}
    select.value=next;if(next&&next!==state.recallNodeEditId)loadRecallNodeStudio(next);else if(!next){state.recallNodeEditId='';state.recallNodeDraftChoices=[];fillRecallNodeFields(null);renderRecallNodeCandidates();renderRecallNodePreview()}
  }
  function loadRecallNodeStudio(id){const node=recallStudioNode(id);state.recallNodeEditId=node?.id||'';state.recallNodeDraftChoices=node?recallStudioChoices(node.id):[];const select=$('qbRecallNodeSelect');if(select&&node)select.value=node.id;fillRecallNodeFields(node);renderRecallNodeCandidates();renderRecallNodePreview()}
  function startNewRecallNode(){state.recallNodeEditId='';state.recallNodeDraftChoices=[];const select=$('qbRecallNodeSelect');if(select)select.value='';fillRecallNodeFields(null);renderRecallNodeCandidates();renderRecallNodePreview();$('qbRecallNodeTitle')?.focus()}
  function recallNodeDraftFromInputs(){return {id:state.recallNodeEditId||'',title:String($('qbRecallNodeTitle')?.value||'').trim(),titleEn:String($('qbRecallNodeTitleEn')?.value||'').trim(),prompt:String($('qbRecallNodePrompt')?.value||'').trim(),promptEn:String($('qbRecallNodePromptEn')?.value||'').trim(),hint:String($('qbRecallNodeHint')?.value||'').trim(),hintEn:String($('qbRecallNodeHintEn')?.value||'').trim()}}
  function renderRecallNodeCandidates(){
    const host=$('qbRecallCandidateList');if(!host)return;const items=state.recallNodeDraftChoices||[];
    host.innerHTML=items.length?items.map((item,index)=>`<div class="qb-recall-candidate-row" draggable="true" data-recall-candidate-index="${index}"><span class="qb-recall-candidate-grip" title="拖动排序">⋮⋮</span><span class="qb-recall-candidate-copy"><strong>${escapeHTML(item.title||item.id)}</strong><small>${escapeHTML(item.titleEn||item.id||'')}</small></span><span class="qb-recall-candidate-actions"><button type="button" data-recall-candidate-up="${index}" title="上移">↑</button><button type="button" data-recall-candidate-down="${index}" title="下移">↓</button><button type="button" data-recall-candidate-remove="${index}" title="移除">×</button></span></div>`).join(''):'<div class="qb-empty">暂无预设分支。保存后学员仍可使用“添加我的回忆”。</div>';
    host.querySelectorAll('[data-recall-candidate-up]').forEach(button=>button.onclick=()=>moveRecallCandidate(Number(button.dataset.recallCandidateUp),-1));host.querySelectorAll('[data-recall-candidate-down]').forEach(button=>button.onclick=()=>moveRecallCandidate(Number(button.dataset.recallCandidateDown),1));host.querySelectorAll('[data-recall-candidate-remove]').forEach(button=>button.onclick=()=>{state.recallNodeDraftChoices.splice(Number(button.dataset.recallCandidateRemove),1);renderRecallNodeCandidates();renderRecallNodePreview()});
    host.querySelectorAll('[data-recall-candidate-index]').forEach(row=>{row.addEventListener('dragstart',event=>{state.recallNodeDragIndex=Number(row.dataset.recallCandidateIndex);row.classList.add('is-dragging');event.dataTransfer?.setData('text/plain',String(state.recallNodeDragIndex))});row.addEventListener('dragend',()=>{state.recallNodeDragIndex=-1;row.classList.remove('is-dragging')});row.addEventListener('dragover',event=>event.preventDefault());row.addEventListener('drop',event=>{event.preventDefault();const from=state.recallNodeDragIndex,to=Number(row.dataset.recallCandidateIndex);if(from<0||from===to)return;const [moved]=state.recallNodeDraftChoices.splice(from,1);state.recallNodeDraftChoices.splice(to,0,moved);renderRecallNodeCandidates();renderRecallNodePreview()})});
  }
  function moveRecallCandidate(index,delta){const target=index+delta,items=state.recallNodeDraftChoices;if(index<0||target<0||index>=items.length||target>=items.length)return;[items[index],items[target]]=[items[target],items[index]];renderRecallNodeCandidates();renderRecallNodePreview()}
  function addRecallCandidate(){const input=$('qbRecallCandidateInput'),value=String(input?.value||'').trim();if(!value)return;const api=recallLibraryApi(),library=recallStudioLibrary(),resolved=api?.resolve?.(library,value),candidate=resolved?{id:resolved.id,title:resolved.title,titleEn:resolved.titleEn||''}:{id:api?.nodeId?.(value)||'',title:value,titleEn:''};if(!(state.recallNodeDraftChoices||[]).some(item=>String(item.id||item.title)===String(candidate.id||candidate.title)))state.recallNodeDraftChoices.push(candidate);if(input)input.value='';renderRecallNodeCandidates();renderRecallNodePreview()}
  function renderRecallNodePreview(){const host=$('qbRecallNodePreview');if(!host)return;const draft=recallNodeDraftFromInputs(),items=(state.recallNodeDraftChoices||[]).slice(0,4),title=draft.title||'当前知识点';host.innerHTML=`<h4>${escapeHTML(title)}${draft.titleEn?`<span class="en">${escapeHTML(draft.titleEn)}</span>`:''}</h4><p>${escapeHTML(draft.prompt||`看到“${title}”，你还能联想到哪些知识点？`)}${draft.promptEn?`<span class="en">${escapeHTML(draft.promptEn)}</span>`:''}</p>${draft.hint||draft.hintEn?`<p class="hint"><strong>轻提示：</strong>${escapeHTML(draft.hint||'')}${draft.hintEn?`<span class="en">${escapeHTML(draft.hintEn)}</span>`:''}</p>`:''}${items.length?`<div class="choices">${items.map(item=>`<div class="choice">${escapeHTML(item.title||item.id)}${item.titleEn?`<span class="en">${escapeHTML(item.titleEn)}</span>`:''}</div>`).join('')}</div>`:'<div class="empty">暂无预设分支；学员可以添加自己的回忆。</div>'}`}
  function saveRecallNodeStudio(){const api=recallLibraryApi(),bank=currentBank(),draft=recallNodeDraftFromInputs();if(!api||!bank)return;if(!draft.title){toast('请填写知识点中文名称。');$('qbRecallNodeTitle')?.focus();return}const result=api.saveNode?.(bank.subject,draft,state.recallNodeDraftChoices||[]);if(!result?.valid){toast((result?.errors||['保存节点失败。']).join('；'));return}state.recallNodeEditId=result.node?.id||draft.id||'';const library=result.library||api.read(bank.subject);$('qbRecallLibraryText').value=api.toText(library);state.recallLibraryPreview=null;const report=$('qbRecallLibraryReport');if(report)report.innerHTML=`<strong>节点已保存</strong><span>${library.nodes.length} 个知识点 · ${library.edges.length} 条关系 · 稳定 ID：${escapeHTML(state.recallNodeEditId)}</span>`;refreshRecallNodeSelector(state.recallNodeEditId);loadRecallNodeStudio(state.recallNodeEditId);renderRecallConfig();toast('知识联想节点已保存。')}

  function nextOptionId(options){
    const used = new Set((options || []).map(o => String(o.id || '').trim()).filter(Boolean));
    for(let i=0;i<26;i++){
      const id = String.fromCharCode(65 + i);
      if(!used.has(id)) return id;
    }
    let index = 1;
    while(used.has('X' + index)) index++;
    return 'X' + index;
  }

  function ensureEmbeddedPmpExample(banks){
    const next = (banks || []).map(normalizeBank);
    if(isDemoSuppressed()) return {banks:next, changed:false};
    const demo = demoQuestion();
    const demoId = String(demo.id || DEMO_QUESTION_ID);
    let changed = false;
    let demoBank = next.find(b => b.id === DEMO_BANK_ID) || next.find(b => b.subject === 'PMP' && /示例|演示|demo/i.test(b.name || ''));
    const alreadyExists = next.some(b => (b.questions || []).some(q => String(q.id) === demoId));
    if(!demoBank){
      demoBank = normalizeBank({
        id:DEMO_BANK_ID,
        name:'PMP 敏捷场景题示例题库',
        subject:'PMP',
        description:'内置 PMP 示例题：用于体验题干关键词、知识点绑定、推理步骤和深度回忆预览。',
        version:'1.0',
        visibility:'public-demo',
        createdAt:Date.now(),
        updatedAt:Date.now(),
        questions:[]
      });
      next.unshift(demoBank);
      changed = true;
    }
    if(!alreadyExists){
      demoBank.questions = [demo, ...(demoBank.questions || [])];
      demoBank.updatedAt = Date.now();
      changed = true;
    }
    return {banks:next, changed};
  }

  function loadLegacyBanksForMigrationPreview(){
    try{
      const raw=localStorage.getItem(banksKey());
      const parsed=JSON.parse(raw||'null');
      return Array.isArray(parsed)?ensureGlobalTeacherNumbers(parsed.map(normalizeBank)):[];
    }catch(error){console.warn(error);return []}
  }
  function loadBanks(){
    if(Catalog){
      const snapshot=Catalog.snapshot(),questions=Array.isArray(snapshot.questions)?snapshot.questions:[];
      return ensureGlobalTeacherNumbers((snapshot.banks||[]).map((bank,index)=>normalizeBank({...bank,questions:questions.filter(question=>String(question.bankId)===String(bank.id))},index)));
    }
    if(document.body?.dataset?.questionCatalogMigrationPreview==='true')return loadLegacyBanksForMigrationPreview();
    console.warn('题目目录适配器未加载，正式题库不会读取 Runtime State 回退数据。');
    return [];
  }
  function saveBanks(nextBanks=state.banks, options={}){
    state.banks=ensureGlobalTeacherNumbers((nextBanks||[]).map(normalizeBank));
    state.dirty=true;
    if(!options.silent)toast('已更新当前编辑草稿，请使用对应保存按钮提交到题库。');
    return true;
  }
  function reloadBanksFromCatalog(selectedBankId=state.selectedBankId,selectedQuestionId=state.selectedQuestionId){
    state.banks=loadBanks();
    state.selectedBankId=state.banks.some(bank=>bank.id===selectedBankId)?selectedBankId:(state.banks[0]?.id||'');
    const bank=state.banks.find(item=>item.id===state.selectedBankId);
    state.selectedQuestionId=bank?.questions.some(question=>question.id===selectedQuestionId)?selectedQuestionId:(bank?.questions.find(question=>!isQuestionDeleted(question))?.id||'');
    state.dirty=false;
    state.serverCatalogNewerRevision=0;
    state.serverCatalogLocalDraft=null;
    state.serverCatalogConflictReason='';
    state.catalogPendingClueTouched=false;
    state.catalogPendingConceptTouched=false;
    state.catalogPendingFloatingClueTouched=false;
    return bank||null;
  }
  function isCatalogEditorField(target){
    if(!target)return false;
    if(CATALOG_EDITOR_FIELD_IDS.has(String(target.id||'')))return true;
    return !!target.closest?.('#qbOptionsEditor,#qbOptionsEditorEn,#qbClueList,#qbConceptList,#qbReasoningList,#qbRecallConfigPanel');
  }
  function markCatalogEditorDirty(event){
    if(!isCatalogEditorField(event?.target))return;
    state.dirty=true;
    const targetId=String(event?.target?.id||'');
    if(/^clue[A-Z]/.test(targetId))state.catalogPendingClueTouched=true;
    if(/^floatingClue/.test(targetId))state.catalogPendingFloatingClueTouched=true;
    if(/^concept[A-Z]/.test(targetId))state.catalogPendingConceptTouched=true;
    const local=state.serverCatalogLocalDraft;
    if(local?.question&&local.bank){
      local.pendingSubforms.clueTouched=state.catalogPendingClueTouched;
      local.pendingSubforms.conceptTouched=state.catalogPendingConceptTouched;
      local.pendingSubforms.floatingClueTouched=state.catalogPendingFloatingClueTouched;
      const collected=collectQuestionDraftFromDom(local.question,local.bank,{includePendingSubforms:true,pendingSubforms:local.pendingSubforms});
      if(collected?.draft)local.question=collected.draft;
    }
  }
  function captureServerCatalogLocalDraft(){
    if(state.serverCatalogLocalDraft)return state.serverCatalogLocalDraft;
    const bank=currentBank(),question=currentQuestion();
    const local={
      bankId:String(bank?.id||state.selectedBankId||''),questionId:String(question?.id||state.selectedQuestionId||''),
      activeSidebarTab:state.activeSidebarTab,bank:bank?clone(bank):null,question:question?clone(question):null,
      pendingSubforms:{clueTouched:state.catalogPendingClueTouched,conceptTouched:state.catalogPendingConceptTouched,floatingClueTouched:state.catalogPendingFloatingClueTouched}
    };
    state.serverCatalogLocalDraft=local;
    const collected=question&&bank?collectQuestionDraftFromDom(question,bank,{includePendingSubforms:true,pendingSubforms:local.pendingSubforms}):null;
    if(collected?.draft)local.question=collected.draft;
    return local;
  }
  function markServerCatalogDraftConflict(reason){
    state.serverCatalogConflictReason=String(reason||'服务器中的原编辑对象已变化，不能自动合并。');
    renderServerCatalogNewerNotice();
    toast(`${state.serverCatalogConflictReason} 请复制草稿为新题或导出后处理。`);
    try{window.dispatchEvent(new CustomEvent('kg:question-editor-conflict-copy-required',{detail:{reason:state.serverCatalogConflictReason,draft:clone(state.serverCatalogLocalDraft)}}))}catch(error){}
    return false;
  }
  function copyServerCatalogLocalDraft(){
    const local=state.serverCatalogLocalDraft,targetBank=state.banks.find(bank=>bank.id===local?.bankId)||currentBank();
    if(!local?.question||!targetBank)return markServerCatalogDraftConflict('原题库已删除，当前页面无法放置草稿副本。');
    const copy=clone(local.question);copy.id=safeId('q');copy.title=`${copy.title||'未命名题目'}（冲突副本）`;
    delete copy.revision;delete copy.contentHash;delete copy.createdAt;delete copy.updatedAt;
    targetBank.questions.push(normalizeQuestion(copy,targetBank.questions.length));
    state.selectedBankId=targetBank.id;state.selectedQuestionId=copy.id;state.serverCatalogConflictReason='';state.serverCatalogNewerRevision=0;state.serverCatalogLocalDraft=null;state.catalogPendingClueTouched=false;state.catalogPendingConceptTouched=false;state.catalogPendingFloatingClueTouched=false;
    saveBanks(state.banks,{silent:true});render();toast('已将未提交内容复制为本地新题，请检查后保存到服务器。');return true;
  }
  function refreshReadOnlyCatalogViews(){
    const selectedBankId=state.selectedBankId,selectedQuestionId=state.selectedQuestionId;
    state.banks=loadBanks();
    state.selectedBankId=state.banks.some(bank=>bank.id===selectedBankId)?selectedBankId:(state.banks[0]?.id||'');
    const bank=state.banks.find(item=>item.id===state.selectedBankId);
    state.selectedQuestionId=bank?.questions.some(question=>question.id===selectedQuestionId)?selectedQuestionId:(bank?.questions.find(question=>!isQuestionDeleted(question))?.id||'');
    const local=state.serverCatalogLocalDraft,originalBank=state.banks.find(item=>item.id===local?.bankId);
    if(local&&!originalBank)state.serverCatalogConflictReason='服务器中的原题库已删除，不能自动合并。';
    else if(local&&local.activeSidebarTab!=='banks'&&!originalBank?.questions.some(question=>question.id===local.questionId))state.serverCatalogConflictReason='服务器中的原题目已删除或移动，不能自动合并。';
    renderBankList();renderTrainingBankSelect();renderSubjectChipState();renderQuestionList();renderStatusCard();renderCompletion();renderServerCatalogNewerNotice();
  }
  async function applyServerCatalogRefresh(options={}){
    const mode=String(options.mode||'reload');
    if(mode==='merge'){
      const local=state.serverCatalogLocalDraft;
      if(!local)return false;
      if(local.pendingSubforms?.incompleteReason){toast(local.pendingSubforms.incompleteReason);return false}
      const remoteBank=state.banks.find(bank=>bank.id===local.bankId);
      if(!remoteBank)return markServerCatalogDraftConflict('服务器中的原题库已删除，不能自动合并。');
      state.selectedBankId=remoteBank.id;
      let merged;
      if(local.activeSidebarTab==='banks')merged=await saveBankForm({allowServerMerge:true});
      else{
        const questionIndex=remoteBank.questions.findIndex(question=>question.id===local.questionId);
        if(questionIndex<0)return markServerCatalogDraftConflict('服务器中的原题目已删除或移动，不能自动合并。');
        const remoteQuestion=remoteBank.questions[questionIndex],localQuestion=clone(local.question);
        remoteBank.questions[questionIndex]=normalizeQuestion({...localQuestion,revision:remoteQuestion.revision,contentHash:remoteQuestion.contentHash,creatorId:remoteQuestion.creatorId},questionIndex);
        state.selectedQuestionId=local.questionId;
        merged=await saveQuestionForm({allowServerMerge:true});
      }
      if(merged)toast('已将当前表单合并到服务器新版本。');
      return !!merged;
    }
    const bankId=state.serverCatalogLocalDraft?.bankId||state.selectedBankId,questionId=state.serverCatalogLocalDraft?.questionId||state.selectedQuestionId;
    reloadBanksFromCatalog(bankId,questionId);
    if(CatalogEditor)await CatalogEditor.open(currentQuestion());
    render();CatalogEditor?.applyReadonlyState(CatalogEditor.status().readonly);toast('已重新载入服务器版本。');
    try{window.dispatchEvent(new CustomEvent('kg:question-editor-server-applied',{detail:{mode:'reload'}}))}catch(error){}
    return true;
  }
  async function handleQuestionCatalogChanged(event){
    if(!catalogUiReady||event?.detail?.source!=='remote')return;
    const revision=Number(event.detail?.snapshot?.contentRevision||0);
    if(document.body?.dataset?.paperManagementPage==='true'){state.banks=loadBanks();renderPaperManager();return}
    if(!state.dirty){
      const bankId=state.selectedBankId,questionId=state.selectedQuestionId;
      reloadBanksFromCatalog(bankId,questionId);
      if(CatalogEditor)await CatalogEditor.open(currentQuestion());
      render();CatalogEditor?.applyReadonlyState(CatalogEditor.status().readonly);return;
    }
    captureServerCatalogLocalDraft();
    state.serverCatalogNewerRevision=Math.max(state.serverCatalogNewerRevision,Number.isSafeInteger(revision)?revision:0);
    refreshReadOnlyCatalogViews();state.dirty=true;renderBankList();renderQuestionList();renderServerCatalogNewerNotice();
    toast('服务器有新版本，当前表单未覆盖；请选择重新载入/合并。');
    try{window.dispatchEvent(new CustomEvent('kg:question-editor-server-newer',{detail:{revision:state.serverCatalogNewerRevision,requiresExplicitReload:true}}))}catch(error){}
  }
  function currentBank(){
    const selected=state.banks.find(b=>b.id===state.selectedBankId);
    if(selected&&(state.subjectFilter==='ALL'||selected.subject===state.subjectFilter))return selected;
    const visible=filteredBanks()[0];
    if(visible)return visible;
    return state.subjectFilter==='ALL'?(state.banks[0]||null):null;
  }
  function currentQuestion(){
    const bank = currentBank();
    if(!bank) return null;
    const selected=bank.questions.find(q => q.id === state.selectedQuestionId);
    if(selected&&questionMatchesLifecycle(selected))return selected;
    return bank.questions.find(question=>questionMatchesLifecycle(question)) || null;
  }
  function filteredBanks(){
    return state.subjectFilter === 'ALL'
      ? state.banks
      : state.banks.filter(b => b.subject === state.subjectFilter);
  }
  async function selectBank(bankId){
    closeLibraryQuestionPreview();
    const bank = state.banks.find(b => b.id === bankId);
    if(!bank) return;
    state.selectedBankId = bank.id;
    const bankIndexInFilter = filteredBanks().findIndex(item => item.id === bank.id);
    if(bankIndexInFilter >= 0) state.bankPage = Math.max(1, Math.ceil((bankIndexInFilter + 1) / BANK_PAGE_SIZE));
    state.selectedQuestionId = bank.questions.find(question=>questionMatchesLifecycle(question))?.id || '';
    state.cluePage = 1;
    state.conceptPage = 1;
    state.editingClueId = '';
    state.editingConceptId = '';
    state.activeSidebarTab = 'questions';
    state.activeLayoutNav = 'questions';
    state.collapsedQuestionGroups = {};
    state.questionPage = 1;
    clearQuestionSelection();
    if(CatalogEditor)await CatalogEditor.open(currentQuestion());
    render();
    CatalogEditor?.applyReadonlyState(CatalogEditor.status().readonly);
  }
  async function selectQuestion(questionId){
    const bank = currentBank();
    if(!bank) return;
    const before=clone(bank);
    const question = bank.questions.find(q => q.id === questionId);
    if(!question||!questionMatchesLifecycle(question)) return;
    state.selectedQuestionId = question.id;
    state.cluePage = 1;
    state.conceptPage = 1;
    state.editingClueId = '';
    state.editingConceptId = '';
    if(CatalogEditor)await CatalogEditor.open(question);
    render();
    CatalogEditor?.applyReadonlyState(CatalogEditor.status().readonly);
  }

  function applyQuestionEditorDeepLink(){
    let params;try{params=new URLSearchParams(location.search||'')}catch(error){return false}
    const bankId=String(params.get('bankId')||''),questionId=String(params.get('questionId')||'');
    if(!bankId||!questionId)return false;
    const bank=state.banks.find(item=>String(item.id)===bankId),question=bank?.questions?.find(item=>String(item.id)===questionId);
    if(!bank||!question)return false;
    state.selectedBankId=bank.id;state.selectedQuestionId=question.id;state.subjectFilter='ALL';state.activeSidebarTab='questions';state.activeMainTab='base';state.activeLayoutNav='base';state.questionLifecycleFilter=isQuestionDeleted(question)?'deleted':'active';state.questionPage=1;clearQuestionSelection();
    const bankIndex=state.banks.findIndex(item=>item.id===bank.id);if(bankIndex>=0)state.bankPage=Math.max(1,Math.ceil((bankIndex+1)/BANK_PAGE_SIZE));
    return true;
  }

  async function init(){
    if(document.body?.dataset?.paperManagementPage === 'true') return initPaperManagementPage();
    if(window.KGRolePermissions){
      window.KGRolePermissions.applyTheme();
      window.KGRolePermissions.decoratePermissionElements();
      if(!window.KGRolePermissions.can('accessQuestionBank')){
        window.KGRolePermissions.renderPermissionDenied(document.querySelector('.qb-app') || document.body, '教师工作台仅限管理员、教师/教研角色访问。学员请进入考题训练，或联系管理员调整角色。');
        return;
      }
    }
    if(!Catalog){alert('题目目录服务未加载，请刷新页面后重试。');return}
    try{await Catalog.ready}catch(error){alert('题目目录加载失败：'+(error.message||error));return}
    initStaticControls();
    initLibraryWorkspaceControls();
    state.banks = loadBanks();
    state.papers = loadPapers();
    state.selectedPaperId = state.papers[0]?.id || '';
    state.selectedBankId = state.banks[0]?.id || '';
    state.selectedQuestionId = state.banks[0]?.questions.find(question=>!isQuestionDeleted(question))?.id || '';
    if(isTrainingConfigurationStep()&&state.banks[0]?.subject)state.subjectFilter=state.banks[0].subject;
    applyQuestionEditorDeepLink();
    if(CatalogEditor)await CatalogEditor.open(currentQuestion());
    render();
    CatalogEditor?.applyReadonlyState(CatalogEditor.status().readonly);
    catalogUiReady=true;
  }

  async function initPaperManagementPage(){
    if(window.KGRolePermissions){
      window.KGRolePermissions.applyTheme();
      window.KGRolePermissions.decoratePermissionElements();
      if(!window.KGRolePermissions.can('accessQuestionBank')){
        window.KGRolePermissions.renderPermissionDenied(document.querySelector('.qb-app')||document.body,'试卷管理仅限管理员、教师/教研角色访问。');
        return;
      }
    }
    if(!Catalog){alert('题目目录服务未加载，请刷新页面后重试。');return}
    try{await Catalog.ready}catch(error){alert('题目目录加载失败：'+(error.message||error));return}
    state.banks=loadBanks();state.papers=loadPapers();state.paperCategories=loadPaperCategories();state.selectedPaperId=state.papers[0]?.id||'';
    const on=(id,event,handler)=>$(id)?.addEventListener(event,handler);
    on('qbAddPaperBtn','click',addPaper);on('qbSavePaperBtn','click',savePaperForm);on('qbBuildPaperBtn','click',buildCurrentPaper);on('qbPublishPaperBtn','click',togglePublishPaper);on('qbArchivePaperBtn','click',archiveCurrentPaper);on('qbDeletePaperBtn','click',deleteCurrentPaper);on('qbExportPaperBtn','click',exportCurrentPaper);on('qbAutoQuotaBtn','click',autoDistributeQuota);on('qbClearQuotaBtn','click',clearPaperQuota);
    on('qbAddPaperCategoryBtn','click',addPaperCategory);on('qbPaperListSearch','input',event=>applyPaperCatalogFilter({search:String(event.currentTarget.value||'')}));on('qbPaperStatusFilter','change',event=>applyPaperCatalogFilter({status:String(event.currentTarget.value||'ALL')}));on('qbPaperListSelectPage','change',toggleSelectPaperPage);on('qbPaperBulkMoveCategoryBtn','click',moveSelectedPapersToCategory);on('qbPaperBulkArchiveBtn','click',archiveSelectedPapers);on('qbPaperBulkDeleteDraftBtn','click',deleteSelectedPaperDrafts);
    on('paperSubjectInput','change',()=>{savePaperForm({silent:true,skipRender:true});state.paperCandidatePage=1;state.selectedPaperCandidateKeys=new Set();renderPaperManager()});
    on('paperCategoryInput','change',()=>savePaperForm({silent:true}));
    on('qbPaperCandidateSearch','input',event=>{state.paperCandidateSearch=String(event.currentTarget.value||'').trim();state.paperCandidatePage=1;state.selectedPaperCandidateKeys=new Set();renderPaperCandidateList()});
    on('qbPaperCandidateBankFilter','change',event=>{state.paperCandidateBankId=String(event.currentTarget.value||'ALL');state.paperCandidatePage=1;state.selectedPaperCandidateKeys=new Set();renderPaperCandidateList()});
    on('qbSelectPaperCandidatesPage','change',toggleSelectPaperCandidatePage);on('qbAddSelectedToPaperBtn','click',addSelectedCandidatesToPaper);
    on('qbPaperPreviewSelectAll','change',toggleSelectPaperPreview);on('qbPaperBulkRemoveBtn','click',removeSelectedPaperQuestions);
    on('qbQuestionPreviewCloseBtn','click',closePaperQuestionPreview);on('qbQuestionPreviewEditBtn','click',openQuestionEditorFromPreview);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&isPaperQuestionPreviewOpen())closePaperQuestionPreview()});
    window.addEventListener('resize',positionPaperQuestionPreview,{passive:true});document.addEventListener('scroll',positionPaperQuestionPreview,true);
    initPaperWorkspaceControls();
    renderPaperManager();
    catalogUiReady=true;
  }

  function initStaticControls(){
    $('qbScopeInfo').textContent = scopeLabel();
    $('qbLibraryQuestionPreviewCloseBtn')?.addEventListener('click',closeLibraryQuestionPreview);
    $('qbLibraryQuestionPreviewEditBtn')?.addEventListener('click',editLibraryQuestionFromPreview);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&isLibraryQuestionPreviewOpen())closeLibraryQuestionPreview()});
    window.addEventListener('resize',positionLibraryQuestionPreview,{passive:true});
    document.addEventListener('scroll',positionLibraryQuestionPreview,true);
    document.addEventListener('kg-training-workspace-resized',()=>{if(isLibraryQuestionPreviewOpen())requestAnimationFrame(positionLibraryQuestionPreview)});

    document.querySelectorAll('[data-qb-tab]').forEach(btn => {
      btn.addEventListener('click', () => setSidebarTab(btn.dataset.qbTab));
    });
    document.querySelectorAll('[data-main-tab]').forEach(btn => {
      btn.addEventListener('click', () => setMainTab(btn.dataset.mainTab));
    });
    document.querySelectorAll('[data-layout-nav]').forEach(btn => {
      btn.addEventListener('click', () => handleLayoutNav(btn.dataset.layoutNav));
    });
    document.querySelectorAll('[data-annotation-tab]').forEach(btn => {
      btn.addEventListener('click', () => setAnnotationTab(btn.dataset.annotationTab));
    });

    const questionSearch = $('qbQuestionSearch');
    if(questionSearch){
      questionSearch.addEventListener('input', () => {
        state.questionSearch = questionSearch.value.trim();
        state.questionPage = 1;
        renderQuestionList();
        renderLayoutNav();
      });
    }
    const questionGroupMode = $('qbQuestionGroupMode');
    if(questionGroupMode){
      questionGroupMode.addEventListener('change', () => {
        state.questionGroupMode = questionGroupMode.value || 'topic';
        state.collapsedQuestionGroups = {};
        state.questionPage = 1;
        renderQuestionList();
      });
    }

    const lifecycleFilter=$('qbQuestionLifecycleFilter');
    if(lifecycleFilter){
      lifecycleFilter.addEventListener('change',()=>{
        state.questionLifecycleFilter=['active','unclassified','deleted'].includes(lifecycleFilter.value)?lifecycleFilter.value:'active';
        state.questionPage=1;state.collapsedQuestionGroups={};clearQuestionSelection();
        const bank=currentBank();state.selectedQuestionId=bank?.questions.find(question=>questionMatchesLifecycle(question))?.id||'';
        render();
      });
    }

    const filter = $('qbSubjectFilter');
    if(filter){
      filter.innerHTML = '<option value="ALL">全部科目</option>' + SUBJECTS
        .filter(s => s.id !== 'CUSTOM')
        .map(s => `<option value="${escapeHTML(s.id)}">${escapeHTML(s.label)}${s.future ? '（扩展）' : ''}</option>`)
        .join('');
      filter.addEventListener('change', () => {
        state.subjectFilter = filter.value;
        state.bankPage = 1;
        const first = filteredBanks()[0];
        if(first) selectBank(first.id);
        else render();
      });
    }

    const trainingBankSelect=$('qbTrainingBankSelect');
    if(trainingBankSelect){
      trainingBankSelect.addEventListener('change',()=>{
        const bank=state.banks.find(item=>item.id===String(trainingBankSelect.value||''));
        if(!bank)return;
        state.subjectFilter=bank.subject;
        state.bankPage=1;
        if(filter)filter.value=state.subjectFilter;
        selectBank(bank.id);
      });
    }

    const chips = $('qbSubjectChips');
    if(chips){
      chips.innerHTML = SUBJECTS.filter(s => s.id !== 'CUSTOM').map(s => `
        <button type="button" class="qb-subject-chip ${DEFAULT_SUBJECTS.has(s.id) ? 'default' : 'future'}" data-subject="${escapeHTML(s.id)}" style="--chip:${escapeHTML(s.color)}">
          <strong>${escapeHTML(s.name)}</strong>
          <span>${escapeHTML(s.future ? '可扩展' : '默认')}</span>
        </button>
      `).join('');
      chips.querySelectorAll('[data-subject]').forEach(btn => {
        btn.addEventListener('click', () => {
          state.subjectFilter = btn.dataset.subject;
          state.bankPage = 1;
          if(filter) filter.value = state.subjectFilter;
          const existing = state.banks.find(b => b.subject === state.subjectFilter);
          if(existing) selectBank(existing.id);
          else if(isTrainingConfigurationStep()){
            state.selectedBankId='';state.selectedQuestionId='';clearQuestionSelection();render();toast(`${state.subjectFilter} 暂无题库，请先在题目管理中创建。`);
          }else addBank(state.subjectFilter);
        });
      });
    }

    $('qbAddBankBtn').addEventListener('click', () => addBank(state.subjectFilter === 'ALL' ? 'PMP' : state.subjectFilter));
    $('qbAddQuestionBtn').addEventListener('click', addQuestion);
    $('qbSaveBankBtn').addEventListener('click', saveBankForm);
    $('qbSaveQuestionBtn').addEventListener('click', saveQuestionForm);
    $('qbCloneQuestionBtn').addEventListener('click', cloneQuestion);
    $('qbDeleteQuestionBtn').addEventListener('click', deleteQuestion);
    $('qbSelectPageQuestions')?.addEventListener('change',toggleSelectCurrentPage);
    $('qbBulkKnowledgeBtn')?.addEventListener('click',openBulkKnowledgeDialog);
    $('qbBulkUnclassifiedBtn')?.addEventListener('click',()=>bulkMoveKnowledge(null));
    $('qbBulkTagsBtn')?.addEventListener('click',openBulkTagDialog);
    $('qbBulkDeleteBtn')?.addEventListener('click',()=>openSafeDeleteDialog([...state.selectedQuestionIds]));
    $('qbBulkRestoreBtn')?.addEventListener('click',()=>restoreQuestionIds([...state.selectedQuestionIds]));
    $('qbBulkPermanentDeleteBtn')?.addEventListener('click',()=>openPermanentDeleteDialog([...state.selectedQuestionIds]));
    $('qbBulkKnowledgeSearchInput')?.addEventListener('input',renderBulkKnowledgeSearch);
    $('qbBulkKnowledgeConfirmBtn')?.addEventListener('click',()=>bulkMoveKnowledge(state.bulkKnowledgeDraftId));
    $('qbBulkKnowledgeUnmappedBtn')?.addEventListener('click',()=>bulkMoveKnowledge(null));
    $('qbBulkTagClearBtn')?.addEventListener('click',()=>{state.bulkTagDraft=new Set();renderBulkTagDialog()});
    $('qbBulkCustomTagInput')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();const value=String(event.currentTarget.value||'').trim();if(value){state.bulkTagDraft.add(canonicalTagName(value));event.currentTarget.value='';renderBulkTagDialog()}}});
    $('qbBulkTagConfirmBtn')?.addEventListener('click',applyBulkTags);
    $('qbSafeDeleteConfirmBtn')?.addEventListener('click',confirmSafeDelete);
    $('qbPermanentDeleteAcknowledge')?.addEventListener('change',event=>{const button=$('qbPermanentDeleteConfirmBtn');if(button)button.disabled=!event.currentTarget.checked});
    $('qbPermanentDeleteConfirmBtn')?.addEventListener('click',confirmPermanentDelete);
    $('qbDeleteBankBtn')?.addEventListener('click', deleteCurrentBank);
    $('qbAddOptionBtn').addEventListener('click', addOption);
    $('qbAddSelectedKeywordBtn').addEventListener('click', addSelectedKeyword);
    $('qbAddClueBtn').addEventListener('click', addClue);
    $('qbAddConceptBtn').addEventListener('click', addConcept);
    $('qbAddReasoningBtn').addEventListener('click', addReasoningStep);
    $('qbImportBtn').addEventListener('click', () => $('qbImportFile').click());
    $('qbImportFile').addEventListener('change', e => importJson(e.target.files && e.target.files[0]));
    $('qbExportBtn').addEventListener('click', exportCurrentBank);
    $('qbExportAllBtn')?.addEventListener('click', exportAllBanks);
    $('qbInspectorExportCurrentBtn')?.addEventListener('click', exportCurrentBank);
    $('qbInspectorExportAllBtn')?.addEventListener('click', exportAllBanks);
    $('qbInspectorDeleteBankBtn')?.addEventListener('click', deleteCurrentBank);
    $('qbInspectorPaperNavBtn')?.addEventListener('click', () => handleLayoutNav('papers'));
    $('qbAddPaperBtn')?.addEventListener('click', addPaper);
    $('qbSavePaperBtn')?.addEventListener('click', savePaperForm);
    $('qbBuildPaperBtn')?.addEventListener('click', buildCurrentPaper);
    $('qbPublishPaperBtn')?.addEventListener('click', togglePublishPaper);
    $('qbDeletePaperBtn')?.addEventListener('click', deleteCurrentPaper);
    $('qbExportPaperBtn')?.addEventListener('click', exportCurrentPaper);
    $('qbAutoQuotaBtn')?.addEventListener('click', autoDistributeQuota);
    $('qbClearQuotaBtn')?.addEventListener('click', clearPaperQuota);
    $('paperSubjectInput')?.addEventListener('change', () => { savePaperForm({silent:true, skipRender:true}); renderPaperManager(); });
    $('qbTemplateBtn').addEventListener('click', downloadTemplate);
    $('qbSetCurrentBtn').addEventListener('click', setCurrentTrainingQuestion);
    $('qbPreviewRecallBtn').addEventListener('click', previewDeepRecall);
    $('qbRecallPreviewBtn')?.addEventListener('click', previewDeepRecall);
    $('qbSyncRecallConfigBtn')?.addEventListener('click', syncRecallConfig);
    $('qbParseRecallLibraryBtn')?.addEventListener('click', () => parseRecallLibrary(false));
    $('qbSaveRecallLibraryBtn')?.addEventListener('click', () => parseRecallLibrary(true));
    $('qbLoadRecallLibraryBtn')?.addEventListener('click', loadRecallLibraryEditor);
    $('qbImportRecallLibraryBtn')?.addEventListener('click', () => $('qbRecallLibraryFile')?.click());
    $('qbRecallLibraryFile')?.addEventListener('change', event => importRecallLibraryFile(event.target.files?.[0]));
    $('qbRecallNodeSelect')?.addEventListener('change', event => loadRecallNodeStudio(String(event.target.value||'')));
    $('qbRecallNewNodeBtn')?.addEventListener('click', startNewRecallNode);
    $('qbRecallSaveNodeBtn')?.addEventListener('click', saveRecallNodeStudio);
    $('qbRecallAddCandidateBtn')?.addEventListener('click', addRecallCandidate);
    $('qbRecallCandidateInput')?.addEventListener('keydown', event => {if(event.key==='Enter'){event.preventDefault();addRecallCandidate()}});
    ['qbRecallNodeTitle','qbRecallNodeTitleEn','qbRecallNodePrompt','qbRecallNodePromptEn','qbRecallNodeHint','qbRecallNodeHintEn'].forEach(id => $(id)?.addEventListener('input', renderRecallNodePreview));
    $('bankSubject').addEventListener('change', toggleCustomSubject);
    $('clueSourceInput').addEventListener('change', updateClueSourceWrap);
    $('qbCancelClueEditBtn').addEventListener('click', resetClueForm);
    $('qbCancelConceptEditBtn').addEventListener('click', resetConceptForm);
    initSelectionKeywordTools();
  }

  function render(){
    renderSidebarTabs();
    renderMainTabs();
    renderAnnotationTabs();
    renderLayoutNav();
    renderSubjectLibrary();
    renderBankList();
    renderTrainingBankSelect();
    renderSubjectChipState();
    renderQuestionList();
    fillBankForm();
    fillQuestionForm();
    renderRecallConfig();
    renderStatusCard();
    renderCompletion();
    renderPaperManager();
    requestAnimationFrame(applyLibraryPaneRatio);
  }

  function setMainTab(tab){
    const active = ['banks','papers','base'].includes(tab) ? tab : 'banks';
    state.activeMainTab = active;
    state.activeLayoutNav = active;
    if(active!=='banks')closeLibraryQuestionPreview();
    if(active === 'banks' && !['banks','questions'].includes(state.activeSidebarTab)){
      state.activeSidebarTab = 'banks';
    }
    renderMainTabs();
    renderLayoutNav();
  }

  function renderMainTabs(){
    const active = ['banks','papers','base'].includes(state.activeMainTab) ? state.activeMainTab : 'banks';
    state.activeMainTab = active;
    document.querySelectorAll('[data-main-tab]').forEach(btn => {
      const isActive = btn.dataset.mainTab === active;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('[data-main-tab-panel]').forEach(panel => {
      const isActive = panel.dataset.mainTabPanel === active;
      panel.hidden = !isActive;
      panel.classList.toggle('active', isActive);
    });
  }

  function setSidebarTab(tab){
    state.activeSidebarTab = tab === 'questions' ? 'questions' : 'banks';
    state.activeMainTab = 'banks';
    state.activeLayoutNav = 'banks';
    renderSidebarTabs();
    renderMainTabs();
    renderLayoutNav();
  }

  function setAnnotationTab(tab){
    state.activeAnnotationTab = ['recall','clues','concepts','reasoning'].includes(tab) ? tab : 'recall';
    state.activeLayoutNav = state.activeAnnotationTab;
    renderAnnotationTabs();
    renderLayoutNav();
  }

  function handleLayoutNav(target){
    const section = String(target || 'banks');
    if(section === 'banks'){
      setSidebarTab('banks');
      $('qbMainWorkspace')?.scrollIntoView({behavior:'smooth', block:'start'});
      return;
    }
    if(section === 'questions'){
      setSidebarTab('questions');
      $('qbQuestionTabPanel')?.scrollIntoView({behavior:'smooth', block:'start'});
      return;
    }
    if(section === 'base'){
      setMainTab('base');
      state.activeLayoutNav = 'base';
      renderLayoutNav();
      $('qbMainWorkspace')?.scrollIntoView({behavior:'smooth', block:'start'});
      return;
    }
    if(['recall','clues','concepts','reasoning'].includes(section)){
      setAnnotationTab(section);
      $('qbAnnotationCard')?.scrollIntoView({behavior:'smooth', block:'start'});
      return;
    }
    if(section === 'papers'){
      setMainTab('papers');
      state.activeLayoutNav = 'papers';
      renderLayoutNav();
      $('qbMainWorkspace')?.scrollIntoView({behavior:'smooth', block:'start'});
      return;
    }
    if(section === 'completion'){
      state.activeLayoutNav = 'completion';
      renderLayoutNav();
      $('qbCompletionPanel')?.scrollIntoView({behavior:'smooth', block:'center'});
    }
  }

  function renderLayoutNav(){
    const active = state.activeLayoutNav || state.activeMainTab || 'banks';
    document.querySelectorAll('[data-layout-nav]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layoutNav === active);
    });
  }

  function renderAnnotationTabs(){
    const active = ['recall','clues','concepts','reasoning'].includes(state.activeAnnotationTab) ? state.activeAnnotationTab : 'recall';
    state.activeAnnotationTab = active;
    document.querySelectorAll('[data-annotation-tab]').forEach(btn => {
      const isActive = btn.dataset.annotationTab === active;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('[data-annotation-panel]').forEach(panel => {
      const isActive = panel.dataset.annotationPanel === active;
      panel.hidden = !isActive;
      panel.classList.toggle('active', isActive);
    });
  }

  function renderSidebarTabs(){
    const active = state.activeSidebarTab === 'questions' ? 'questions' : 'banks';
    document.querySelectorAll('[data-qb-tab]').forEach(btn => {
      const isActive = btn.dataset.qbTab === active;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    const bankPanel = $('qbBankTabPanel');
    const questionPanel = $('qbQuestionTabPanel');
    if(bankPanel){
      bankPanel.hidden = false;
      bankPanel.classList.add('active');
      bankPanel.classList.toggle('focus', active === 'banks');
    }
    if(questionPanel){
      questionPanel.hidden = false;
      questionPanel.classList.add('active');
      questionPanel.classList.toggle('focus', active === 'questions');
    }
  }

  function bankStatsBySubject(){
    const stats = new Map();
    SUBJECTS.filter(s => s.id !== 'CUSTOM').forEach(s => {
      stats.set(s.id, {banks:0, questions:0});
    });
    state.banks.forEach(bank => {
      const key = SUBJECTS.some(s => s.id === bank.subject) ? bank.subject : 'CUSTOM';
      if(!stats.has(key)) stats.set(key, {banks:0, questions:0});
      const item = stats.get(key);
      item.banks += 1;
      item.questions += (bank.questions || []).length;
    });
    return stats;
  }

  function subjectActionLabel(subject, stats){
    if((stats.banks || 0) > 0) return `${stats.banks} 个题库 / ${stats.questions || 0} 道题`;
    return subject.future ? '未启用，可一键创建' : '暂无题库，可直接新建';
  }

  function renderSubjectLibrary(){
    const el = $('qbSubjectLibrary');
    if(!el) return;
    const stats = bankStatsBySubject();
    el.innerHTML = SUBJECTS.filter(s => s.id !== 'CUSTOM').map(s => {
      const item = stats.get(s.id) || {banks:0, questions:0};
      const hasBank = item.banks > 0;
      return `
        <article class="qb-subject-row ${state.subjectFilter === s.id ? 'active' : ''}">
          <span class="dot" style="--dot:${escapeHTML(s.color)}"></span>
          <div class="subject-row-main">
            <strong>${escapeHTML(s.label)}</strong>
            <p>${escapeHTML(subjectActionLabel(s, item))}</p>
            <small>${escapeHTML(s.focus.join(' · '))}</small>
            <div class="subject-row-actions">
              <button type="button" data-subject-filter="${escapeHTML(s.id)}">${hasBank ? '筛选' : '查看'}</button>
              <button type="button" class="primary" data-subject-new="${escapeHTML(s.id)}">${hasBank ? '新建题库' : (s.future ? '启用科目' : '创建题库')}</button>
            </div>
          </div>
        </article>
      `;
    }).join('');
    el.querySelectorAll('[data-subject-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.subjectFilter = btn.dataset.subjectFilter;
        state.bankPage = 1;
        const filter = $('qbSubjectFilter');
        if(filter) filter.value = state.subjectFilter;
        const first = filteredBanks()[0];
        if(first) selectBank(first.id);
        else render();
      });
    });
    el.querySelectorAll('[data-subject-new]').forEach(btn => {
      btn.addEventListener('click', () => addBank(btn.dataset.subjectNew));
    });
  }

  function bankPageCount(total){
    return Math.max(1, Math.ceil((Number(total) || 0) / BANK_PAGE_SIZE));
  }
  function clampBankPage(total){
    const pages = bankPageCount(total);
    state.bankPage = Math.max(1, Math.min(Number(state.bankPage) || 1, pages));
    return pages;
  }
  function updateBankPager(total, pageCount){
    const pager = $('qbBankPager');
    if(!pager) return;
    if(!total){
      pager.hidden = true;
      pager.innerHTML = '';
      return;
    }
    const page = Math.max(1, Math.min(Number(state.bankPage) || 1, pageCount || 1));
    const start = (page - 1) * BANK_PAGE_SIZE + 1;
    const end = Math.min(total, page * BANK_PAGE_SIZE);
    const disabledPrev = page <= 1 ? 'disabled' : '';
    const disabledNext = page >= pageCount ? 'disabled' : '';
    pager.hidden = false;
    pager.innerHTML = `
      <div class="qb-page-info">
        <strong>第 ${page} / ${pageCount} 页</strong>
        <span>共 ${total} 个题库 · 当前显示 ${start}-${end} 个 · 每页 ${BANK_PAGE_SIZE} 个</span>
      </div>
      <div class="qb-page-actions" aria-label="题库分页">
        <button type="button" data-bank-page="first" ${disabledPrev}>首页</button>
        <button type="button" data-bank-page="prev" ${disabledPrev}>上一页</button>
        <label>
          <span>跳至</span>
          <input id="qbBankPageInput" type="number" min="1" max="${pageCount}" value="${page}" />
        </label>
        <button type="button" data-bank-page="next" ${disabledNext}>下一页</button>
        <button type="button" data-bank-page="last" ${disabledNext}>末页</button>
      </div>
    `;
    pager.querySelectorAll('[data-bank-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.bankPage;
        if(action === 'first') state.bankPage = 1;
        else if(action === 'prev') state.bankPage = Math.max(1, page - 1);
        else if(action === 'next') state.bankPage = Math.min(pageCount, page + 1);
        else if(action === 'last') state.bankPage = pageCount;
        renderBankList();
      });
    });
    const input = $('qbBankPageInput');
    if(input){
      const go = () => {
        const next = Math.max(1, Math.min(pageCount, Number(input.value) || page));
        if(next !== page){
          state.bankPage = next;
          renderBankList();
        }else{
          input.value = String(page);
        }
      };
      input.addEventListener('change', go);
      input.addEventListener('keydown', event => {
        if(event.key === 'Enter') go();
      });
    }
  }

  function renderSubjectChipState(){
    document.querySelectorAll('#qbSubjectChips [data-subject]').forEach(button=>{
      const active=String(button.dataset.subject||'')===String(state.subjectFilter||'');
      button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
    });
  }

  function renderTrainingBankSelect(){
    const select=$('qbTrainingBankSelect');
    if(!select)return;
    const activeSubject=state.subjectFilter==='ALL'?(currentBank()?.subject||state.banks[0]?.subject||'PMP'):state.subjectFilter;
    if(state.subjectFilter==='ALL'&&isTrainingConfigurationStep())state.subjectFilter=activeSubject;
    const banks=state.banks.filter(bank=>bank.subject===activeSubject).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'zh-CN'));
    select.dataset.subject=activeSubject;
    if(!banks.length){
      select.innerHTML=`<option value="">${escapeHTML(activeSubject)} 暂无题库，请先在题目管理中创建</option>`;
      select.disabled=true;
      return;
    }
    select.innerHTML=banks.map(bank=>`<option value="${escapeHTML(bank.id)}">${escapeHTML(bank.name)} · ${activeQuestions(bank).length} 题</option>`).join('');
    select.disabled=false;
    const bank=currentBank();
    const next=bank&&banks.some(item=>item.id===bank.id)?bank:banks[0];
    if(next){select.value=next.id;if(state.selectedBankId!==next.id){state.selectedBankId=next.id;state.selectedQuestionId=next.questions.find(question=>questionMatchesLifecycle(question))?.id||''}}
  }

  function renderBankList(){
    const list = $('qbBankList');
    const pager = $('qbBankPager');
    const banks = filteredBanks();
    if(!list) return;
    if(!banks.length){
      list.innerHTML = '<div class="qb-empty">该科目还没有题库，点击“+ 新题库”创建。</div>';
      if(pager){ pager.hidden = true; pager.innerHTML = ''; }
      return;
    }
    const pageCount = clampBankPage(banks.length);
    const startIndex = (state.bankPage - 1) * BANK_PAGE_SIZE;
    const pageItems = banks.slice(startIndex, startIndex + BANK_PAGE_SIZE);
    list.innerHTML = pageItems.map((b, pageIndex) => {
      const bankIndex = startIndex + pageIndex;
      const meta = subjectMeta(b.subject);
      const isActive = b.id === state.selectedBankId;
      return `
        <article class="qb-bank-list-card ${isActive ? 'active' : ''}">
          <button type="button" class="qb-bank-select" data-bank-id="${escapeHTML(b.id)}">
            <span class="qb-bank-order">${bankIndex + 1}</span>
            <span class="subject-dot" style="--dot:${escapeHTML(meta.color)}"></span>
            <span>
              <strong>${escapeHTML(b.name)}</strong>
              <small>${escapeHTML(b.subject)} · ${b.questions.length} 题 · ${escapeHTML(b.version || '1.0')} · ${b.visibility==='published'?'学员可见':'仅教师'}</small>
            </span>
          </button>
          <div class="qb-bank-row-actions">
            <button type="button" data-bank-export="${escapeHTML(b.id)}">导出</button>
            <button type="button" class="danger" data-bank-delete="${escapeHTML(b.id)}">删除</button>
          </div>
        </article>
      `;
    }).join('');
    updateBankPager(banks.length, pageCount);
    list.querySelectorAll('[data-bank-id]').forEach(btn => {
      btn.addEventListener('click', () => selectBank(btn.dataset.bankId));
    });
    list.querySelectorAll('[data-bank-export]').forEach(btn => {
      btn.addEventListener('click', () => exportBankById(btn.dataset.bankExport));
    });
    list.querySelectorAll('[data-bank-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteBankById(btn.dataset.bankDelete));
    });
  }
  function questionTypeLabel(type){
    return ({
      single_choice:'单选题',
      multiple_choice:'多选题',
      scenario:'情景题',
      case_analysis:'案例分析题'
    })[type] || type || '未设置题型';
  }
  function questionGroupKey(q){
    const mode = state.questionGroupMode || 'topic';
    if(mode === 'domain') return q.domain || '未设置知识领域';
    if(mode === 'difficulty') return q.difficulty || '未设置难度';
    if(mode === 'type') return questionTypeLabel(q.type);
    return q.topic || q.domain || '未设置章节 / 主题';
  }
  function questionSearchText(q){
    return [
      q.title, stemText(q), q.domain, q.topic, q.difficulty, q.type,
      (q.tags || []).join(' '),
      (q.options || []).map(o => [o.id, o.text, o.trap].join(' ')).join(' '),
      (q.clues || []).map(c => c.text).join(' '),
      (q.concepts || []).map(c => [c.id,c.title,c.category].join(' ')).join(' ')
    ].join(' ').toLowerCase();
  }
  function questionPageCount(total){
    return Math.max(1, Math.ceil((Number(total) || 0) / QUESTION_PAGE_SIZE));
  }
  function clampQuestionPage(total){
    const pages = questionPageCount(total);
    state.questionPage = Math.max(1, Math.min(Number(state.questionPage) || 1, pages));
    return pages;
  }
  function updateQuestionPager(total, filtered, pageCount){
    const pager = $('qbQuestionPager');
    if(!pager) return;
    if(!total || !filtered){
      pager.hidden = true;
      pager.innerHTML = '';
      return;
    }
    const page = Math.max(1, Math.min(Number(state.questionPage) || 1, pageCount || 1));
    const start = (page - 1) * QUESTION_PAGE_SIZE + 1;
    const end = Math.min(filtered, page * QUESTION_PAGE_SIZE);
    const disabledPrev = page <= 1 ? 'disabled' : '';
    const disabledNext = page >= pageCount ? 'disabled' : '';
    const filterText = filtered === total ? `共 ${total} 题` : `匹配 ${filtered} / 共 ${total} 题`;
    pager.hidden = false;
    pager.innerHTML = `
      <div class="qb-page-info">
        <strong>第 ${page} / ${pageCount} 页</strong>
        <span>${filterText} · 当前显示 ${start}-${end} 题 · 每页 ${QUESTION_PAGE_SIZE} 题</span>
      </div>
      <div class="qb-page-actions" aria-label="题目分页">
        <button type="button" data-question-page="first" ${disabledPrev}>首页</button>
        <button type="button" data-question-page="prev" ${disabledPrev}>上一页</button>
        <label>
          <span>跳至</span>
          <input id="qbQuestionPageInput" type="number" min="1" max="${pageCount}" value="${page}" />
        </label>
        <button type="button" data-question-page="next" ${disabledNext}>下一页</button>
        <button type="button" data-question-page="last" ${disabledNext}>末页</button>
      </div>
    `;
    pager.querySelectorAll('[data-question-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.questionPage;
        if(action === 'first') state.questionPage = 1;
        else if(action === 'prev') state.questionPage = Math.max(1, page - 1);
        else if(action === 'next') state.questionPage = Math.min(pageCount, page + 1);
        else if(action === 'last') state.questionPage = pageCount;
        renderQuestionList();
      });
    });
    const input = $('qbQuestionPageInput');
    if(input){
      const go = () => {
        const next = Math.max(1, Math.min(pageCount, Number(input.value) || page));
        if(next !== page){
          state.questionPage = next;
          renderQuestionList();
        }else{
          input.value = String(page);
        }
      };
      input.addEventListener('change', go);
      input.addEventListener('keydown', event => {
        if(event.key === 'Enter') go();
      });
    }
  }
  function lifecycleViewLabel(){
    return state.questionLifecycleFilter==='deleted'?'已删除题目':state.questionLifecycleFilter==='unclassified'?'待分类':'正常题目';
  }
  function questionKnowledgeLabel(question){
    const knowledge=question?.metadata?.knowledge||{};
    return knowledge.primaryNodeId?(Array.isArray(knowledge.pathSnapshot)&&knowledge.pathSnapshot.length?knowledge.pathSnapshot.join(' > '):knowledge.primaryNodeId):'待分类';
  }
  function renderBulkToolbar(){
    const toolbar=$('qbBulkToolbar'),pageSelection=$('qbPageSelection'),selectPage=$('qbSelectPageQuestions');
    const selected=selectedQuestions();
    if(pageSelection)pageSelection.hidden=!state.currentPageQuestionIds.length;
    if(selectPage){
      const selectedOnPage=state.currentPageQuestionIds.filter(id=>state.selectedQuestionIds.has(id)).length;
      selectPage.checked=!!state.currentPageQuestionIds.length&&selectedOnPage===state.currentPageQuestionIds.length;
      selectPage.indeterminate=selectedOnPage>0&&selectedOnPage<state.currentPageQuestionIds.length;
    }
    if(toolbar)toolbar.hidden=!selected.length;
    if($('qbBulkSelectionCount'))$('qbBulkSelectionCount').textContent=`已选择 ${selected.length} 道题`;
    if($('qbBulkSelectionHint'))$('qbBulkSelectionHint').textContent=`${lifecycleViewLabel()} · 仅当前页`;
    const deletedView=state.questionLifecycleFilter==='deleted';
    if($('qbBulkActiveActions'))$('qbBulkActiveActions').hidden=deletedView;
    if($('qbBulkDeletedActions'))$('qbBulkDeletedActions').hidden=!deletedView;
  }
  function toggleSelectCurrentPage(event){
    const checked=!!event?.currentTarget?.checked;
    state.selectedQuestionIds=new Set(checked?state.currentPageQuestionIds:[]);
    renderQuestionList();
  }
  function questionRowActionIcon(kind){
    const icons={
      edit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>',
      knowledge:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="m7 7.2 3 3M17 7.2l-3 3M7 16.8l3-3M17 16.8l-3-3"/></svg>',
      unclassified:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h6l2 2h8v10H4z"/><path d="M12 11v4M10 13h4"/></svg>',
      delete:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>',
      restore:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/></svg>',
      permanent:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M9 6V4h6v2M8 6l1 14h6l1-14"/><path d="m10 11 4 4M14 11l-4 4"/></svg>'
    };
    return icons[kind]||'';
  }
  function questionActionButton(kind,attribute,id,label,danger=false){
    return `<button type="button" class="qb-question-icon-action${danger?' danger':''}" ${attribute}="${escapeHTML(id)}" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}">${questionRowActionIcon(kind)}</button>`;
  }

  function renderQuestionList(){
    const list = $('qbQuestionList');
    const count = $('qbQuestionCount');
    const search = $('qbQuestionSearch');
    const groupMode = $('qbQuestionGroupMode');
    const lifecycleFilter=$('qbQuestionLifecycleFilter');
    const pager = $('qbQuestionPager');
    if(search && search.value !== state.questionSearch) search.value = state.questionSearch || '';
    if(groupMode && groupMode.value !== state.questionGroupMode) groupMode.value = state.questionGroupMode || 'topic';
    if(lifecycleFilter&&lifecycleFilter.value!==state.questionLifecycleFilter)lifecycleFilter.value=state.questionLifecycleFilter;
    const bank = currentBank();
    if(!list) return;
    if(!bank){
      if(count)count.textContent='0 题';
      list.innerHTML = '<div class="qb-empty">请先创建题库。</div>';
      state.currentPageQuestionIds=[];clearQuestionSelection();closeLibraryQuestionPreview();renderBulkToolbar();
      if(pager){ pager.hidden = true; pager.innerHTML = ''; }
      return;
    }
    const lifecycleRows=bank.questions.map((q,index)=>({q,index})).filter(item=>questionMatchesLifecycle(item.q));
    if(count)count.textContent=`${lifecycleRows.length} 题 · ${lifecycleViewLabel()}`;
    if(!lifecycleRows.length){
      const emptyText=state.questionLifecycleFilter==='deleted'?'当前题库没有已删除题目。':state.questionLifecycleFilter==='unclassified'?'当前题库没有待分类题目。':'当前题库没有正常题目，点击“+ 新题”开始录入。';
      list.innerHTML = `<div class="qb-empty">${emptyText}</div>`;
      state.currentPageQuestionIds=[];clearQuestionSelection();closeLibraryQuestionPreview();renderBulkToolbar();
      if(pager){ pager.hidden = true; pager.innerHTML = ''; }
      return;
    }
    const keyword = String(state.questionSearch || '').trim().toLowerCase();
    const visible = lifecycleRows.filter(item => !keyword || questionSearchText(item.q).includes(keyword));
    if(count) count.textContent = keyword ? `${visible.length} / ${lifecycleRows.length} 题 · ${lifecycleViewLabel()}` : `${lifecycleRows.length} 题 · ${lifecycleViewLabel()}`;
    if(!visible.length){
      list.innerHTML = '<div class="qb-empty">没有匹配的题目。可以换一个关键词，或切换状态与归集方式。</div>';
      state.currentPageQuestionIds=[];clearQuestionSelection();closeLibraryQuestionPreview();renderBulkToolbar();
      if(pager){ pager.hidden = true; pager.innerHTML = ''; }
      return;
    }
    const pageCount = clampQuestionPage(visible.length);
    const startIndex = (state.questionPage - 1) * QUESTION_PAGE_SIZE;
    const pageItems = visible.slice(startIndex, startIndex + QUESTION_PAGE_SIZE);
    state.currentPageQuestionIds=pageItems.map(item=>item.q.id);
    state.selectedQuestionIds=new Set([...state.selectedQuestionIds].filter(id=>state.currentPageQuestionIds.includes(id)));
    const groups = new Map();
    pageItems.forEach(item => {
      const key = questionGroupKey(item.q);
      if(!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    const deletedView=state.questionLifecycleFilter==='deleted';
    list.innerHTML = Array.from(groups.entries()).map(([key, items]) => {
      const collapsed = !!state.collapsedQuestionGroups[key];
      return `
        <section class="qb-question-group">
          <button type="button" class="qb-question-group-head" data-question-group="${escapeHTML(key)}">
            <span>${escapeHTML(key)}</span>
            <small>本页 ${items.length} 题</small>
            <b>${collapsed ? '展开' : '收起'}</b>
          </button>
          <div class="qb-question-group-body" ${collapsed ? 'hidden' : ''}>
            ${items.map(({q, index}) => {
              const completion = completionInfo(q).score;
              const checked=state.selectedQuestionIds.has(q.id);
              const lifecycle=normalizeQuestionLifecycle(q);
              const actionHtml=deletedView
                ? questionActionButton('restore','data-question-restore',q.id,'恢复题目')+questionActionButton('permanent','data-question-permanent',q.id,'永久删除',true)
                : questionActionButton('edit','data-question-edit',q.id,'编辑题目')+questionActionButton('knowledge','data-question-knowledge',q.id,'修改主要知识点')+questionActionButton('unclassified','data-question-unclassified',q.id,'移入待分类')+questionActionButton('delete','data-question-delete',q.id,'删除题目',true);
              const statusText=deletedView?`已删除 ${lifecycle.deletedAt?new Date(lifecycle.deletedAt).toLocaleString('zh-CN'):''}`:`${q.metadata?.translationStatus==='bilingual'?'中英双语':'仅中文'} · ${questionKnowledgeLabel(q)} · ${q.difficulty||'难度未设'} · 完成 ${completion}%`;
              return `
                <article class="qb-question-row ${q.id === state.selectedQuestionId ? 'active' : ''} ${checked?'selected':''} ${deletedView?'deleted':''}" data-question-row="${escapeHTML(q.id)}" data-library-question-preview="${escapeHTML(q.id)}" title="双击打开或关闭题目预览；预览打开后单击其他题目可切换">
                  <label class="qb-question-select" title="选择本题"><input type="checkbox" data-question-select="${escapeHTML(q.id)}" ${checked?'checked':''}/></label>
                  <button type="button" class="qb-question-main" data-question-id="${escapeHTML(q.id)}" title="单击选择题目；双击打开或关闭悬浮预览">
                    <strong>${escapeHTML(q.teacherNumber||String(index+1))} · ${escapeHTML(q.title)}</strong>
                    <small>${escapeHTML(statusText)}</small>
                  </button>
                  <div class="qb-question-row-actions">${actionHtml}</div>
                </article>
              `;
            }).join('')}
          </div>
        </section>
      `;
    }).join('');
    updateQuestionPager(lifecycleRows.length, visible.length, pageCount);
    list.querySelectorAll('[data-question-group]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.questionGroup;
        state.collapsedQuestionGroups[key] = !state.collapsedQuestionGroups[key];
        renderQuestionList();
      });
    });
    list.querySelectorAll('[data-question-select]').forEach(input=>input.addEventListener('change',event=>{
      const id=input.dataset.questionSelect;if(event.currentTarget.checked)state.selectedQuestionIds.add(id);else state.selectedQuestionIds.delete(id);renderQuestionList();
    }));
    list.querySelectorAll('[data-library-question-preview]').forEach(bindLibraryQuestionPreviewRow);
    list.querySelectorAll('[data-question-edit]').forEach(btn=>btn.addEventListener('click',()=>{selectQuestion(btn.dataset.questionEdit);handleLayoutNav('base')}));
    list.querySelectorAll('[data-question-knowledge]').forEach(btn=>btn.addEventListener('click',()=>{selectQuestion(btn.dataset.questionKnowledge);setTimeout(()=>$('qbKnowledgePickerBtn')?.click(),0)}));
    list.querySelectorAll('[data-question-unclassified]').forEach(btn=>btn.addEventListener('click',()=>{state.selectedQuestionIds=new Set([btn.dataset.questionUnclassified]);bulkMoveKnowledge(null)}));
    list.querySelectorAll('[data-question-delete]').forEach(btn=>btn.addEventListener('click',()=>openSafeDeleteDialog([btn.dataset.questionDelete])));
    list.querySelectorAll('[data-question-restore]').forEach(btn=>btn.addEventListener('click',()=>restoreQuestionIds([btn.dataset.questionRestore])));
    list.querySelectorAll('[data-question-permanent]').forEach(btn=>btn.addEventListener('click',()=>openPermanentDeleteDialog([btn.dataset.questionPermanent])));
    refreshLibraryQuestionPreviewAnchor();
    renderBulkToolbar();
  }
  function fillSubjectSelect(select, value){
    select.innerHTML = SUBJECTS.map(s => `<option value="${escapeHTML(s.id)}">${escapeHTML(s.label)}${s.future ? '（扩展）' : ''}</option>`).join('');
    const known = SUBJECTS.some(s => s.id === value);
    select.value = known ? value : 'CUSTOM';
  }
  function fillBankForm(){
    const bank = currentBank();
    fillSubjectSelect($('bankSubject'), bank ? bank.subject : 'PMP');
    $('bankName').value = bank ? bank.name : '';
    $('bankVersion').value = bank ? bank.version : '';
    $('bankVisibility').value = bank && bank.visibility === 'published' ? 'published' : 'private';
    $('bankDescription').value = bank ? bank.description : '';
    $('bankCustomSubject').value = bank && !SUBJECTS.some(s => s.id === bank.subject) ? bank.subject : '';
    toggleCustomSubject();
  }
  function fillQuestionForm(){
    const q = currentQuestion();
    const disabled = !q;
    ['questionTitleInput','questionTitleEnInput','questionTypeInput','questionDifficultyInput','questionDomainInput','questionTopicInput','questionTagsInput','questionStemInput','questionStemEnInput','questionAnalysisInput','questionAnalysisEnInput'].forEach(id => {
      const el = $(id);
      if(el) el.disabled = disabled;
    });
    if(!q){
      $('questionTitleInput').value = '';
      if($('questionTitleEnInput'))$('questionTitleEnInput').value='';
      if($('questionTeacherNumber'))$('questionTeacherNumber').textContent='保存后自动生成';
      if($('questionTranslationStatus'))$('questionTranslationStatus').textContent='仅中文';
      $('questionTypeInput').value = 'single_choice';
      $('questionDifficultyInput').value = '';
      $('questionDomainInput').value = '';
      $('questionTopicInput').value = '';
      $('questionTagsInput').value = '';
      $('questionStemInput').value = '';
      if($('questionStemEnInput'))$('questionStemEnInput').value='';
      $('questionAnalysisInput').value = '';
      if($('questionAnalysisEnInput'))$('questionAnalysisEnInput').value='';
      $('qbOptionsEditor').innerHTML = '<div class="qb-empty">请选择或新增一道题目。</div>';
      if($('qbOptionsEditorEn'))$('qbOptionsEditorEn').innerHTML='<div class="qb-empty">请选择或新增一道题目。</div>';
      $('qbClueList').innerHTML = '';
      $('qbConceptList').innerHTML = '';
      const cluePager = $('qbCluePager');
      const conceptPager = $('qbConceptPager');
      if(cluePager){ cluePager.hidden = true; cluePager.innerHTML = ''; }
      if(conceptPager){ conceptPager.hidden = true; conceptPager.innerHTML = ''; }
      $('qbReasoningList').innerHTML = '';
      document.dispatchEvent(new CustomEvent('kg-question-form-filled',{detail:{question:null,bank:clone(currentBank())}}));
      return;
    }
    $('questionTitleInput').value = q.title || '';
    const english=q.translations?.en||{};
    if($('questionTitleEnInput'))$('questionTitleEnInput').value=english.title||'';
    if($('questionTeacherNumber'))$('questionTeacherNumber').textContent=q.teacherNumber||'保存后自动生成';
    if($('questionTranslationStatus'))$('questionTranslationStatus').textContent=q.metadata?.translationStatus==='bilingual'?'中英双语':(q.metadata?.translationStatus==='en_only'?'仅英文':'仅中文');
    $('questionTypeInput').value = q.type || 'single_choice';
    $('questionDifficultyInput').value = q.difficulty || '';
    $('questionDomainInput').value = q.domain || '';
    $('questionTopicInput').value = q.topic || '';
    $('questionTagsInput').value = (q.tags || []).join(',');
    $('questionStemInput').value = stemText(q);
    if($('questionStemEnInput'))$('questionStemEnInput').value=englishStemText(q);
    $('questionAnalysisInput').value = q.analysis || '';
    if($('questionAnalysisEnInput'))$('questionAnalysisEnInput').value=english.analysis||'';
    renderOptions();
    renderEnglishOptions();
    updateClueOptionSelect();
    updateClueSourceWrap();
    renderClues();
    renderConcepts();
    renderReasoning();
    document.dispatchEvent(new CustomEvent('kg-question-form-filled',{detail:{question:clone(q),bank:clone(currentBank())}}));
  }
  function renderOptions(){
    const q = currentQuestion();
    const wrap = $('qbOptionsEditor');
    if(!q || !wrap) return;
    wrap.innerHTML = (q.options || []).map((o, i) => `
      <div class="qb-option-row" data-index="${i}" data-option-id="${escapeHTML(o.id)}">
        <label class="radio">
          <input type="radio" name="correctOption" value="${escapeHTML(o.id)}" ${o.id === q.correctAnswer ? 'checked' : ''} />
          正确
        </label>
        <input class="option-id" value="${escapeHTML(o.id)}" aria-label="选项编号" />
        <input class="option-text keyword-source" value="${escapeHTML(o.text)}" placeholder="选项内容（可选中文本标记关键词）" />
        <input class="option-trap" value="${escapeHTML(o.trap || '')}" placeholder="错误原因 / 干扰项说明" />
        <button type="button" class="danger option-remove">删除</button>
      </div>
    `).join('');
    wrap.querySelectorAll('.option-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        const row = e.target.closest('[data-index]');
        const index = Number(row.dataset.index);
        q.options.splice(index,1);
        if(!q.options.some(o => o.id === q.correctAnswer)) q.correctAnswer = q.options[0]?.id || '';
        saveBanks(state.banks, {silent:true});
        render();
        toast('已删除选项。');
      });
    });
  }
  function renderEnglishOptions(){
    const q=currentQuestion(),wrap=$('qbOptionsEditorEn');if(!wrap)return;
    if(!q){wrap.innerHTML='<div class="qb-empty">请选择或新增一道题目。</div>';return}
    const english=q.translations?.en||{};const byId=new Map((english.options||[]).map(item=>[String(item.id||''),item]));
    wrap.innerHTML=(q.options||[]).map((option,index)=>{const id=String(option.id||String.fromCharCode(65+index));const peer=byId.get(id)||{};return `<div class="qb-option-row tq-option-en-row" data-en-index="${index}" data-en-option-id="${escapeHTML(id)}"><input class="option-id-en" value="${escapeHTML(id)}" aria-label="English option id" readonly/><input class="option-text-en" value="${escapeHTML(peer.text||'')}" placeholder="English option ${escapeHTML(id)}"/></div>`}).join('');
  }

  function cognitivePageCount(total){
    return Math.max(1, Math.ceil((Number(total) || 0) / COGNITIVE_PAGE_SIZE));
  }
  function clampCognitivePage(kind, total){
    const pages = cognitivePageCount(total);
    const key = kind === 'concept' ? 'conceptPage' : 'cluePage';
    state[key] = Math.max(1, Math.min(Number(state[key]) || 1, pages));
    return pages;
  }
  function updateCognitivePager(kind, total, pageCount){
    const isConcept = kind === 'concept';
    const pager = $(isConcept ? 'qbConceptPager' : 'qbCluePager');
    if(!pager) return;
    if(!total){
      pager.hidden = true;
      pager.innerHTML = '';
      return;
    }
    const key = isConcept ? 'conceptPage' : 'cluePage';
    const page = Math.max(1, Math.min(Number(state[key]) || 1, pageCount || 1));
    const start = (page - 1) * COGNITIVE_PAGE_SIZE + 1;
    const end = Math.min(total, page * COGNITIVE_PAGE_SIZE);
    const disabledPrev = page <= 1 ? 'disabled' : '';
    const disabledNext = page >= pageCount ? 'disabled' : '';
    const label = isConcept ? '知识点' : '关键词';
    const dataName = isConcept ? 'concept' : 'clue';
    pager.hidden = false;
    pager.innerHTML = `
      <div class="qb-page-info">
        <strong>第 ${page} / ${pageCount} 页</strong>
        <span>共 ${total} 个${label} · 当前显示 ${start}-${end} 个 · 每页 ${COGNITIVE_PAGE_SIZE} 个</span>
      </div>
      <div class="qb-page-actions" aria-label="${label}分页">
        <button type="button" data-${dataName}-page="first" ${disabledPrev}>首页</button>
        <button type="button" data-${dataName}-page="prev" ${disabledPrev}>上一页</button>
        <label>
          <span>跳至</span>
          <input id="${isConcept ? 'qbConceptPageInput' : 'qbCluePageInput'}" type="number" min="1" max="${pageCount}" value="${page}" />
        </label>
        <button type="button" data-${dataName}-page="next" ${disabledNext}>下一页</button>
        <button type="button" data-${dataName}-page="last" ${disabledNext}>末页</button>
      </div>
    `;
    pager.querySelectorAll(`[data-${dataName}-page]`).forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset[`${dataName}Page`];
        if(action === 'first') state[key] = 1;
        else if(action === 'prev') state[key] = Math.max(1, page - 1);
        else if(action === 'next') state[key] = Math.min(pageCount, page + 1);
        else if(action === 'last') state[key] = pageCount;
        isConcept ? renderConcepts() : renderClues();
      });
    });
    const input = $(isConcept ? 'qbConceptPageInput' : 'qbCluePageInput');
    if(input){
      const go = () => {
        const next = Math.max(1, Math.min(pageCount, Number(input.value) || page));
        if(next !== page){
          state[key] = next;
          isConcept ? renderConcepts() : renderClues();
        }else{
          input.value = String(page);
        }
      };
      input.addEventListener('change', go);
      input.addEventListener('keydown', event => {
        if(event.key === 'Enter') go();
      });
    }
  }

  function renderClues(){
    const q = currentQuestion();
    const wrap = $('qbClueList');
    const pager = $('qbCluePager');
    if(!q || !wrap) return;
    q.clues = Array.isArray(q.clues) ? q.clues : [];
    if(!q.clues.length){
      wrap.innerHTML = '<div class="qb-empty">暂未标记关键词。可在题干或选项中选中文本，点击浮出的“标记关键词”按钮快速标注。</div>';
      if(pager){ pager.hidden = true; pager.innerHTML = ''; }
      return;
    }
    const pageCount = clampCognitivePage('clue', q.clues.length);
    const startIndex = (state.cluePage - 1) * COGNITIVE_PAGE_SIZE;
    const pageItems = q.clues.slice(startIndex, startIndex + COGNITIVE_PAGE_SIZE);
    wrap.innerHTML = pageItems.map((c, pageIndex) => {
      const index = startIndex + pageIndex;
      return `
        <article class="qb-token-card">
          <div>
            <span class="source-badge">来源：${escapeHTML(clueSourceLabel(c))}</span>
            <strong>${escapeHTML(c.text)}</strong>
            <span>${escapeHTML(clueTypeLabel(c.type))} · ${escapeHTML(clueRoleLabel(c.clueRole))}</span>
            <p>${escapeHTML(c.explain || '暂无解释')}</p>
            <small>关联知识点：${escapeHTML((c.conceptIds || []).join('、') || '未绑定')}</small>
          </div>
          <div class="qb-token-actions">
            <button type="button" data-edit-clue="${escapeHTML(c.id)}">编辑</button>
            <button type="button" class="danger" data-remove-clue="${index}">删除</button>
          </div>
        </article>
      `;
    }).join('');
    updateCognitivePager('clue', q.clues.length, pageCount);
    wrap.querySelectorAll('[data-edit-clue]').forEach(btn => {
      btn.addEventListener('click', () => editClue(btn.dataset.editClue));
    });
    wrap.querySelectorAll('[data-remove-clue]').forEach(btn => {
      btn.addEventListener('click', () => {
        q.clues.splice(Number(btn.dataset.removeClue),1);
        q.stemParts = rebuildStemParts(stemText(q), stemClues(q.clues));
        state.cluePage = Math.max(1, Math.min(state.cluePage || 1, Math.ceil(q.clues.length / COGNITIVE_PAGE_SIZE) || 1));
        if(state.editingClueId && !q.clues.some(c => c.id === state.editingClueId)) resetClueForm();
        saveBanks(state.banks, {silent:true});
        render();
        toast('已删除关键词。');
      });
    });
  }
  function renderConcepts(){
    const q = currentQuestion();
    const wrap = $('qbConceptList');
    const pager = $('qbConceptPager');
    if(!q || !wrap) return;
    q.concepts = Array.isArray(q.concepts) ? q.concepts : [];
    if(!q.concepts.length){
      wrap.innerHTML = '<div class="qb-empty">暂未绑定知识点。建议至少绑定 1 个主知识点。</div>';
      if(pager){ pager.hidden = true; pager.innerHTML = ''; }
      return;
    }
    const pageCount = clampCognitivePage('concept', q.concepts.length);
    const startIndex = (state.conceptPage - 1) * COGNITIVE_PAGE_SIZE;
    const pageItems = q.concepts.slice(startIndex, startIndex + COGNITIVE_PAGE_SIZE);
    wrap.innerHTML = pageItems.map((c, pageIndex) => {
      const index = startIndex + pageIndex;
      return `
        <article class="qb-concept-card">
          <span class="concept-color" style="--concept:${escapeHTML(c.color || '#7c3aed')}"></span>
          <div>
            <strong>${escapeHTML(c.title)}</strong>
            <small>ID：${escapeHTML(c.id)} · ${escapeHTML(c.category || '未分类')} · ${escapeHTML(c.level || '重点')}</small>
            <p>${escapeHTML(c.summary || '暂无说明')}</p>
            ${c.rule ? `<p class="rule">规则：${escapeHTML(c.rule)}</p>` : ''}
          </div>
          <div class="qb-concept-actions">
            <button type="button" data-edit-concept="${escapeHTML(c.id)}">编辑</button>
            <button type="button" class="danger" data-remove-concept="${index}">删除</button>
          </div>
        </article>
      `;
    }).join('');
    updateCognitivePager('concept', q.concepts.length, pageCount);
    wrap.querySelectorAll('[data-edit-concept]').forEach(btn => {
      btn.addEventListener('click', () => editConcept(btn.dataset.editConcept));
    });
    wrap.querySelectorAll('[data-remove-concept]').forEach(btn => {
      btn.addEventListener('click', () => {
        q.concepts.splice(Number(btn.dataset.removeConcept),1);
        state.conceptPage = Math.max(1, Math.min(state.conceptPage || 1, Math.ceil(q.concepts.length / COGNITIVE_PAGE_SIZE) || 1));
        if(state.editingConceptId && !q.concepts.some(c => c.id === state.editingConceptId)) resetConceptForm();
        saveBanks(state.banks, {silent:true});
        render();
        toast('已删除知识点。');
      });
    });
  }

  function renderReasoning(){
    const q = currentQuestion();
    const wrap = $('qbReasoningList');
    if(!q || !wrap) return;
    if(!q.reasoningSteps.length){
      wrap.innerHTML = '<div class="qb-empty">暂未拆解推理步骤。建议按照“识别线索 → 调用知识点 → 排除干扰 → 得出答案”录入。</div>';
      return;
    }
    wrap.innerHTML = q.reasoningSteps.map((step, index) => `
      <article class="qb-reasoning-card" data-reasoning-index="${index}">
        <div class="step-number">${index + 1}</div>
        <div class="step-fields">
          <label class="qb-field">
            <span>步骤标题</span>
            <input class="rs-title" value="${escapeHTML(step.title)}" />
          </label>
          <label class="qb-field">
            <span>推理说明</span>
            <textarea class="rs-content" rows="2">${escapeHTML(step.content)}</textarea>
          </label>
          <div class="qb-grid two tight">
            <label class="qb-field">
              <span>关联关键词</span>
              <input class="rs-keywords" value="${escapeHTML((step.relatedKeywords || []).join(','))}" />
            </label>
            <label class="qb-field">
              <span>关联知识点 ID</span>
              <input class="rs-kps" value="${escapeHTML((step.relatedKnowledgePoints || []).join(','))}" />
            </label>
          </div>
          <label class="qb-field">
            <span>回忆提问</span>
            <input class="rs-question" value="${escapeHTML(step.recallQuestion || '')}" placeholder="例如：为什么这个线索会指向产品负责人？" />
          </label>
        </div>
        <button type="button" class="danger" data-remove-reasoning="${index}">删除</button>
      </article>
    `).join('');
    wrap.querySelectorAll('[data-remove-reasoning]').forEach(btn => {
      btn.addEventListener('click', () => {
        q.reasoningSteps.splice(Number(btn.dataset.removeReasoning),1);
        saveBanks(state.banks, {silent:true});
        render();
        toast('已删除推理步骤。');
      });
    });
  }
  function renderStatusCard(){
    const bank = currentBank();
    const q = currentQuestion();
    const panel = $('qbStatusCard');
    if(!panel) return;
    if(!bank){
      panel.innerHTML = '<div class="qb-empty">暂无题库。</div>';
      return;
    }
    const meta = subjectMeta(bank.subject);
    panel.innerHTML = `
      <div class="status-main">
        <span class="big-dot" style="--dot:${escapeHTML(meta.color)}"></span>
        <div>
          <strong>${escapeHTML(bank.name)}</strong>
          <p>${escapeHTML(meta.label)} · 当前${bank.questions.length}题${q ? ' · 正在编辑：' + escapeHTML(q.title) : ''}</p>
        </div>
      </div>
      <div class="status-actions">
        <span>${escapeHTML(scopeLabel())}</span>
      </div>
    `;
    renderServerCatalogNewerNotice();
  }
  function renderServerCatalogNewerNotice(){
    const panel=$('qbStatusCard');
    if(!panel)return;
    const existing=$('qbServerCatalogNewerNotice');
    if(!state.serverCatalogNewerRevision){existing?.remove();return}
    const notice=existing||document.createElement('div');
    notice.id='qbServerCatalogNewerNotice';notice.className='status-actions';
    const message=state.serverCatalogConflictReason||'服务器有新版本 · 当前表单未覆盖，请显式重新载入/合并';
    notice.innerHTML=`<span>${escapeHTML(message)}</span><button type="button" data-server-catalog-action="reload">重新载入</button>${state.serverCatalogConflictReason?'<button type="button" data-server-catalog-action="copy">复制草稿为新题</button>':'<button type="button" data-server-catalog-action="merge">合并当前表单</button>'}`;
    if(!existing)panel.appendChild(notice);
    notice.querySelectorAll('[data-server-catalog-action]').forEach(button=>button.addEventListener('click',()=>button.dataset.serverCatalogAction==='copy'?copyServerCatalogLocalDraft():applyServerCatalogRefresh({mode:button.dataset.serverCatalogAction})));
  }
  function completionInfo(q){
    const content = !!(q && stemText(q).trim() && (q.options || []).length >= 2 && q.correctAnswer);
    const keywords = !!(q && (q.clues || []).length);
    const knowledge = !!(q && (q.concepts || []).length);
    const reasoning = !!(q && (q.reasoningSteps || []).length);
    const checks = [
      ['题目内容', content],
      ['关键词', keywords],
      ['知识点', knowledge],
      ['推理逻辑', reasoning]
    ];
    const score = Math.round(checks.filter(x => x[1]).length / checks.length * 100);
    return {checks, score};
  }
  function completionTarget(label){
    return ({'题目内容':'base','关键词':'clues','知识点':'concepts','推理逻辑':'reasoning'})[label] || 'base';
  }
  function renderCompletion(){
    const q = currentQuestion();
    const wrap = $('qbCompletionPanel');
    if(!wrap) return;
    if(!q){
      wrap.innerHTML = '<div class="qb-empty">选择题目后显示完成度。</div>';
      return;
    }
    const info = completionInfo(q);
    wrap.innerHTML = `
      <div class="progress-ring" style="--score:${info.score}%">
        <div class="progress-ring-center">
          <strong>${info.score}%</strong>
          <span>完成</span>
        </div>
      </div>
      <div class="completion-list">
        ${info.checks.map(([label, ok]) => `
          <button type="button" class="completion-item ${ok ? 'done' : 'missing'}" data-completion-target="${escapeHTML(completionTarget(label))}">
            <span class="${ok ? 'ok' : 'todo'}"></span>
            <strong>${escapeHTML(label)}</strong>
            <em>${ok ? '已完成' : '去补齐'}</em>
          </button>
        `).join('')}
      </div>
    `;
    wrap.querySelectorAll('[data-completion-target]').forEach(btn => {
      btn.addEventListener('click', () => handleLayoutNav(btn.dataset.completionTarget));
    });
  }

  function libraryPaneSvg(kind,target='banks'){
    if(kind==='restore')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9H4V4M15 9h5V4M9 15H4v5M15 15h5v5"/></svg>';
    if(kind==='expand')return target==='banks'?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';
    if(kind==='maximize')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5M3 8l6-6M21 8l-6-6M3 16l6 6M21 16l-6 6"/></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';
  }
  function persistLibraryWorkspaceLayout(){
    try{localStorage.setItem(QUESTION_LIBRARY_WORKSPACE_LAYOUT_KEY,JSON.stringify({ratio:state.libraryPaneRatio}))}catch(error){}
  }
  function applyLibraryPaneRatio(){
    const workbench=$('qbLibraryWorkbench'),banks=$('qbBankTabPanel'),questions=$('qbQuestionTabPanel'),splitter=$('qbLibrarySplitter');if(!workbench||!banks||!questions)return;
    const ratio=Math.min(.75,Math.max(.25,Number(state.libraryPaneRatio)||.42));state.libraryPaneRatio=ratio;
    if(state.libraryWorkspaceMode==='split'&&workbench.clientWidth>0){
      const available=Math.max(0,workbench.clientWidth-(splitter?.offsetWidth||12));
      banks.style.flex=`0 0 ${Math.round(available*ratio)}px`;questions.style.flex='1 1 0';
    }else{banks.style.removeProperty('flex');questions.style.removeProperty('flex')}
    if(splitter){splitter.setAttribute('aria-valuenow',String(Math.round(ratio*100)));splitter.setAttribute('aria-valuetext',`题库区 ${Math.round(ratio*100)}%，题目区 ${Math.round((1-ratio)*100)}%`)}
    if(isLibraryQuestionPreviewOpen())requestAnimationFrame(positionLibraryQuestionPreview);
  }
  function setLibraryWorkspaceMode(mode='split'){
    const allowed=new Set(['split','banks-max','questions-max','banks-collapsed','questions-collapsed']);state.libraryWorkspaceMode=allowed.has(mode)?mode:'split';
    const workbench=$('qbLibraryWorkbench');if(!workbench)return;workbench.dataset.mode=state.libraryWorkspaceMode;
    document.querySelectorAll('[data-library-pane-action="maximize"]').forEach(btn=>{const target=String(btn.dataset.libraryPaneTarget||''),active=state.libraryWorkspaceMode===target+'-max';btn.innerHTML=libraryPaneSvg(active?'restore':'maximize',target);btn.title=active?'恢复左右分栏':`放大${target==='banks'?'题库区':'题目区'}`;btn.setAttribute('aria-label',btn.title);btn.setAttribute('aria-pressed',active?'true':'false')});
    document.querySelectorAll('[data-library-pane-action="collapse"]').forEach(btn=>{const target=String(btn.dataset.libraryPaneTarget||''),active=state.libraryWorkspaceMode===target+'-collapsed';btn.innerHTML=libraryPaneSvg(active?'expand':'collapse',target);btn.title=active?`展开${target==='banks'?'题库区':'题目区'}`:`收起${target==='banks'?'题库区':'题目区'}`;btn.setAttribute('aria-label',btn.title);btn.setAttribute('aria-expanded',active?'false':'true')});
    requestAnimationFrame(applyLibraryPaneRatio);
  }
  function initLibraryWorkspaceControls(){
    try{const saved=JSON.parse(localStorage.getItem(QUESTION_LIBRARY_WORKSPACE_LAYOUT_KEY)||'{}');if(Number(saved.ratio)>0)state.libraryPaneRatio=Math.min(.75,Math.max(.25,Number(saved.ratio)))}catch(error){}
    document.querySelectorAll('[data-library-pane-action]').forEach(btn=>btn.addEventListener('click',()=>{const target=String(btn.dataset.libraryPaneTarget||''),action=String(btn.dataset.libraryPaneAction||'');if(action==='maximize')setLibraryWorkspaceMode(state.libraryWorkspaceMode===target+'-max'?'split':target+'-max');if(action==='collapse')setLibraryWorkspaceMode(state.libraryWorkspaceMode===target+'-collapsed'?'split':target+'-collapsed')}));
    const workbench=$('qbLibraryWorkbench'),splitter=$('qbLibrarySplitter');
    if(splitter&&workbench){
      let dragging=false;
      const update=clientX=>{const rect=workbench.getBoundingClientRect(),available=Math.max(1,rect.width-splitter.offsetWidth);state.libraryPaneRatio=Math.min(.75,Math.max(.25,(clientX-rect.left)/available));applyLibraryPaneRatio()};
      splitter.addEventListener('pointerdown',event=>{if(state.libraryWorkspaceMode!=='split')return;dragging=true;splitter.classList.add('dragging');splitter.setPointerCapture?.(event.pointerId);update(event.clientX);event.preventDefault()});
      splitter.addEventListener('pointermove',event=>{if(dragging)update(event.clientX)});
      const finish=event=>{if(!dragging)return;dragging=false;splitter.classList.remove('dragging');try{splitter.releasePointerCapture?.(event.pointerId)}catch(error){}persistLibraryWorkspaceLayout()};
      splitter.addEventListener('pointerup',finish);splitter.addEventListener('pointercancel',finish);
      splitter.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();if(event.key==='Home')state.libraryPaneRatio=.25;else if(event.key==='End')state.libraryPaneRatio=.75;else state.libraryPaneRatio=Math.min(.75,Math.max(.25,state.libraryPaneRatio+(event.key==='ArrowRight'?.02:-.02)));applyLibraryPaneRatio();persistLibraryWorkspaceLayout()});
    }
    window.addEventListener('resize',applyLibraryPaneRatio,{passive:true});setLibraryWorkspaceMode('split');
  }
  function isLibraryQuestionPreviewOpen(){const popover=$('qbLibraryQuestionPreviewPopover');return !!(popover&&!popover.hidden)}
  function libraryPreviewKey(){return String(state.libraryPreviewRef?.questionId||'')}
  function positionLibraryQuestionPreview(){
    const popover=$('qbLibraryQuestionPreviewPopover'),anchor=state.libraryPreviewAnchor;if(!popover||popover.hidden||!anchor?.isConnected)return;
    const rect=anchor.getBoundingClientRect(),vw=document.documentElement.clientWidth||window.innerWidth,vh=document.documentElement.clientHeight||window.innerHeight;if(rect.bottom<0||rect.top>vh||rect.right<0||rect.left>vw){closeLibraryQuestionPreview();return}
    const gap=13,margin=10,width=popover.offsetWidth||500,height=popover.offsetHeight||520,spaces={right:vw-rect.right,left:rect.left,bottom:vh-rect.bottom,top:rect.top};let placement='right';
    if(spaces.right>=width+gap)placement='right';else if(spaces.left>=width+gap)placement='left';else if(spaces.bottom>=Math.min(height,430)+gap)placement='bottom';else if(spaces.top>=Math.min(height,430)+gap)placement='top';else placement=spaces.right>=spaces.left?'right':'left';
    let left=margin,top=margin,arrowOffset=44;
    if(placement==='right'||placement==='left'){left=placement==='right'?rect.right+gap:rect.left-width-gap;left=Math.min(Math.max(margin,left),Math.max(margin,vw-width-margin));top=Math.min(Math.max(margin,rect.top+rect.height/2-height/2),Math.max(margin,vh-height-margin));arrowOffset=Math.min(Math.max(22,rect.top+rect.height/2-top-7),Math.max(22,height-30))}
    else{top=placement==='bottom'?rect.bottom+gap:rect.top-height-gap;left=Math.min(Math.max(margin,rect.left+rect.width/2-width/2),Math.max(margin,vw-width-margin));arrowOffset=Math.min(Math.max(22,rect.left+rect.width/2-left-7),Math.max(22,width-30))}
    popover.dataset.placement=placement;popover.style.left=`${Math.round(left)}px`;popover.style.top=`${Math.round(top)}px`;popover.style.setProperty('--qb-library-arrow-offset',`${Math.round(arrowOffset)}px`);
  }
  function markLibraryQuestionPreviewAnchor(){document.querySelectorAll('[data-library-question-preview].library-preview-active').forEach(row=>row.classList.remove('library-preview-active'));if(state.libraryPreviewAnchor?.isConnected)state.libraryPreviewAnchor.classList.add('library-preview-active')}
  function refreshLibraryQuestionPreviewAnchor(){
    if(!isLibraryQuestionPreviewOpen()||!state.libraryPreviewRef)return;const key=String(state.libraryPreviewRef.questionId||''),escaped=globalThis.CSS?.escape?CSS.escape(key):key.replace(/["\\]/g,'\\$&'),next=document.querySelector(`[data-library-question-preview="${escaped}"]`);if(next){state.libraryPreviewAnchor=next;markLibraryQuestionPreviewAnchor();requestAnimationFrame(positionLibraryQuestionPreview)}else closeLibraryQuestionPreview();
  }
  function openLibraryQuestionPreview(questionId,anchor,options={}){
    const bank=currentBank(),question=bank?.questions?.find(item=>String(item.id)===String(questionId||'')),popover=$('qbLibraryQuestionPreviewPopover'),same=isLibraryQuestionPreviewOpen()&&libraryPreviewKey()===String(questionId||'');if(options.toggleSame&&same){closeLibraryQuestionPreview();return}if(!bank||!question||!popover)return toast('题目已不存在，无法预览。');
    state.libraryPreviewRef={bankId:bank.id,questionId:question.id};state.libraryPreviewAnchor=anchor||state.libraryPreviewAnchor;state.selectedQuestionId=question.id;
    fillQuestionForm();renderRecallConfig();renderStatusCard();renderCompletion();
    document.querySelectorAll('[data-question-row]').forEach(row=>row.classList.toggle('active',String(row.dataset.questionRow||'')===String(question.id)));
    $('qbLibraryQuestionPreviewTitle').textContent=question.title||'未命名题目';const tags=(question.tags||[]).slice(0,5),knowledge=questionKnowledgeLabel(question);$('qbLibraryQuestionPreviewMeta').innerHTML=[question.teacherNumber,bank.name,questionTypeLabel(question.type),question.difficulty||'难度未设',knowledge,...tags].filter(Boolean).map(item=>`<span>${escapeHTML(item)}</span>`).join('');
    const stem=stemText(question).trim(),optionsList=question.options||[],correct=String(question.correctAnswer||optionsList.find(option=>option.correct)?.id||''),analysis=String(question.analysis||'').trim();
    $('qbLibraryQuestionPreviewContent').innerHTML=`<section class="qb-library-preview-block"><h3>题干</h3><div class="qb-library-preview-stem">${stem?escapeHTML(stem):'<span class="qb-library-preview-empty">暂无题干</span>'}</div></section>${optionsList.length?`<section class="qb-library-preview-block"><h3>选项</h3><div class="qb-library-preview-options">${optionsList.map(option=>`<div class="qb-library-preview-option ${String(option.id)===correct||option.correct?'correct':''}"><b>${escapeHTML(option.id)}</b><span>${escapeHTML(option.text||'')}</span></div>`).join('')}</div></section>`:''}<section class="qb-library-preview-block"><h3>正确答案</h3><div class="qb-library-preview-answer">${correct?escapeHTML(correct):'<span class="qb-library-preview-empty">未设置</span>'}</div></section><section class="qb-library-preview-block"><h3>解析</h3><div class="qb-library-preview-analysis">${analysis?escapeHTML(analysis):'<span class="qb-library-preview-empty">暂无解析</span>'}</div></section>`;
    const editBtn=$('qbLibraryQuestionPreviewEditBtn');if(editBtn)editBtn.hidden=isQuestionDeleted(question);popover.hidden=false;markLibraryQuestionPreviewAnchor();requestAnimationFrame(positionLibraryQuestionPreview);
  }
  function closeLibraryQuestionPreview(){if(state.libraryPreviewClickTimer){clearTimeout(state.libraryPreviewClickTimer);state.libraryPreviewClickTimer=0}const popover=$('qbLibraryQuestionPreviewPopover');if(popover)popover.hidden=true;document.querySelectorAll('[data-library-question-preview].library-preview-active').forEach(row=>row.classList.remove('library-preview-active'));state.libraryPreviewAnchor=null;state.libraryPreviewRef=null}
  function bindLibraryQuestionPreviewRow(row){
    const key=String(row.dataset.libraryQuestionPreview||'');
    row.addEventListener('click',event=>{if(event.target.closest('input,a,select')||event.target.closest('.qb-question-row-actions'))return;if(state.libraryPreviewClickTimer)clearTimeout(state.libraryPreviewClickTimer);if(isLibraryQuestionPreviewOpen()){if(libraryPreviewKey()===key)return;state.libraryPreviewClickTimer=setTimeout(()=>{state.libraryPreviewClickTimer=0;openLibraryQuestionPreview(key,row,{toggleSame:false})},220)}else state.libraryPreviewClickTimer=setTimeout(()=>{state.libraryPreviewClickTimer=0;selectQuestion(key)},220)});
    row.addEventListener('dblclick',event=>{if(event.target.closest('input,a,select')||event.target.closest('.qb-question-row-actions'))return;event.preventDefault();if(state.libraryPreviewClickTimer){clearTimeout(state.libraryPreviewClickTimer);state.libraryPreviewClickTimer=0}openLibraryQuestionPreview(key,row,{toggleSame:true})});
  }
  function editLibraryQuestionFromPreview(){const ref=state.libraryPreviewRef;if(!ref)return;closeLibraryQuestionPreview();const bank=state.banks.find(item=>String(item.id)===String(ref.bankId)),question=bank?.questions?.find(item=>String(item.id)===String(ref.questionId));if(!bank||!question)return toast('题目已不存在，无法编辑。');state.selectedBankId=bank.id;state.selectedQuestionId=question.id;state.questionLifecycleFilter=isQuestionDeleted(question)?'deleted':'active';state.activeMainTab='base';state.activeLayoutNav='base';render();$('qbMainWorkspace')?.scrollIntoView({behavior:'smooth',block:'start'})}

  function paperPaneSvg(kind,target='picker'){
    if(kind==='restore')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 9H4V4M15 9h5V4M9 15H4v5M15 15h5v5"/></svg>';
    if(kind==='expand')return target==='picker'?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';
    if(kind==='maximize')return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5M3 8l6-6M21 8l-6-6M3 16l6 6M21 16l-6 6"/></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>';
  }
  function persistPaperWorkspaceLayout(){
    try{localStorage.setItem(PAPER_WORKSPACE_LAYOUT_KEY,JSON.stringify({ratio:state.paperPaneRatio}))}catch(error){}
  }
  function applyPaperPaneRatio(){
    const workbench=$('pmQuestionWorkbench'),picker=$('pmQuestionPickerPane'),preview=$('pmPreviewPane'),splitter=$('pmPaneSplitter');if(!workbench||!picker||!preview)return;
    const ratio=Math.min(.72,Math.max(.28,Number(state.paperPaneRatio)||.5));state.paperPaneRatio=ratio;
    if(state.paperWorkspaceMode==='split'){
      const available=Math.max(0,workbench.clientWidth-(splitter?.offsetWidth||12));
      picker.style.flex=`0 0 ${Math.round(available*ratio)}px`;preview.style.flex='1 1 0';
    }else{
      picker.style.removeProperty('flex');preview.style.removeProperty('flex');
    }
    if(splitter){splitter.setAttribute('aria-valuenow',String(Math.round(ratio*100)));splitter.setAttribute('aria-valuetext',`题库选择区 ${Math.round(ratio*100)}%，试卷预览区 ${Math.round((1-ratio)*100)}%`)}
    if(isPaperQuestionPreviewOpen())requestAnimationFrame(positionPaperQuestionPreview);
  }
  function setPaperWorkspaceMode(mode='split'){
    const allowed=new Set(['split','picker-max','preview-max','picker-collapsed','preview-collapsed']);
    state.paperWorkspaceMode=allowed.has(mode)?mode:'split';
    const workbench=$('pmQuestionWorkbench');if(!workbench)return;
    workbench.dataset.mode=state.paperWorkspaceMode;
    document.querySelectorAll('[data-pane-action="maximize"]').forEach(btn=>{
      const target=String(btn.dataset.paneTarget||''),active=state.paperWorkspaceMode===target+'-max';
      btn.innerHTML=paperPaneSvg(active?'restore':'maximize',target);
      btn.title=active?'恢复左右分栏':`放大${target==='picker'?'题库选择区':'试卷预览区'}`;
      btn.setAttribute('aria-label',btn.title);btn.setAttribute('aria-pressed',active?'true':'false');
    });
    document.querySelectorAll('[data-pane-action="collapse"]').forEach(btn=>{
      const target=String(btn.dataset.paneTarget||''),active=state.paperWorkspaceMode===target+'-collapsed';
      btn.innerHTML=paperPaneSvg(active?'expand':'collapse',target);
      btn.title=active?`展开${target==='picker'?'题库选择区':'试卷预览区'}`:`收起${target==='picker'?'题库选择区':'试卷预览区'}`;
      btn.setAttribute('aria-label',btn.title);btn.setAttribute('aria-expanded',active?'false':'true');
    });
    requestAnimationFrame(applyPaperPaneRatio);
  }
  function initPaperWorkspaceControls(){
    try{
      const saved=JSON.parse(localStorage.getItem(PAPER_WORKSPACE_LAYOUT_KEY)||'{}');
      if(Number(saved.ratio)>0)state.paperPaneRatio=Math.min(.72,Math.max(.28,Number(saved.ratio)));
    }catch(error){}
    document.querySelectorAll('[data-pane-action]').forEach(btn=>btn.addEventListener('click',()=>{
      const target=String(btn.dataset.paneTarget||''),action=String(btn.dataset.paneAction||'');
      if(action==='maximize')setPaperWorkspaceMode(state.paperWorkspaceMode===target+'-max'?'split':target+'-max');
      if(action==='collapse')setPaperWorkspaceMode(state.paperWorkspaceMode===target+'-collapsed'?'split':target+'-collapsed');
    }));
    const workbench=$('pmQuestionWorkbench'),splitter=$('pmPaneSplitter');
    if(splitter&&workbench){
      let dragging=false;
      const update=clientX=>{
        const rect=workbench.getBoundingClientRect(),available=Math.max(1,rect.width-splitter.offsetWidth);
        state.paperPaneRatio=Math.min(.72,Math.max(.28,(clientX-rect.left)/available));applyPaperPaneRatio();
      };
      splitter.addEventListener('pointerdown',event=>{
        if(state.paperWorkspaceMode!=='split')return;
        dragging=true;splitter.classList.add('dragging');splitter.setPointerCapture?.(event.pointerId);update(event.clientX);event.preventDefault();
      });
      splitter.addEventListener('pointermove',event=>{if(dragging)update(event.clientX)});
      const finish=event=>{
        if(!dragging)return;dragging=false;splitter.classList.remove('dragging');
        try{splitter.releasePointerCapture?.(event.pointerId)}catch(error){}
        persistPaperWorkspaceLayout();
      };
      splitter.addEventListener('pointerup',finish);splitter.addEventListener('pointercancel',finish);
      splitter.addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();
        if(event.key==='Home')state.paperPaneRatio=.28;
        else if(event.key==='End')state.paperPaneRatio=.72;
        else state.paperPaneRatio=Math.min(.72,Math.max(.28,state.paperPaneRatio+(event.key==='ArrowRight'?.02:-.02)));
        applyPaperPaneRatio();persistPaperWorkspaceLayout();
      });
    }
    window.addEventListener('resize',applyPaperPaneRatio,{passive:true});setPaperWorkspaceMode('split');
  }
  function questionTypeLabel(type){
    return ({single_choice:'单选题',multiple_choice:'多选题',true_false:'判断题',short_answer:'简答题'}[String(type||'')]||String(type||'题目'));
  }
  function isPaperQuestionPreviewOpen(){
    const popover=$('qbQuestionPreviewPopover');return !!(popover&&!popover.hidden);
  }
  function paperPreviewKey(){return state.paperPreviewRef?paperRefKey(state.paperPreviewRef):''}
  function positionPaperQuestionPreview(){
    const popover=$('qbQuestionPreviewPopover'),anchor=state.paperPreviewAnchor;if(!popover||popover.hidden||!anchor?.isConnected)return;
    const rect=anchor.getBoundingClientRect(),vw=document.documentElement.clientWidth||window.innerWidth,vh=document.documentElement.clientHeight||window.innerHeight;
    if(rect.bottom<0||rect.top>vh||rect.right<0||rect.left>vw){closePaperQuestionPreview();return}
    const gap=13,margin=10,width=popover.offsetWidth||500,height=popover.offsetHeight||520;
    const spaces={right:vw-rect.right,left:rect.left,bottom:vh-rect.bottom,top:rect.top};
    let placement='right';
    if(spaces.right>=width+gap)placement='right';else if(spaces.left>=width+gap)placement='left';else if(spaces.bottom>=Math.min(height,430)+gap)placement='bottom';else if(spaces.top>=Math.min(height,430)+gap)placement='top';else placement=spaces.right>=spaces.left?'right':'left';
    let left=margin,top=margin,arrowOffset=44;
    if(placement==='right'||placement==='left'){
      left=placement==='right'?rect.right+gap:rect.left-width-gap;left=Math.min(Math.max(margin,left),Math.max(margin,vw-width-margin));
      top=Math.min(Math.max(margin,rect.top+rect.height/2-height/2),Math.max(margin,vh-height-margin));
      arrowOffset=Math.min(Math.max(22,rect.top+rect.height/2-top-7),Math.max(22,height-30));
    }else{
      top=placement==='bottom'?rect.bottom+gap:rect.top-height-gap;
      left=Math.min(Math.max(margin,rect.left+rect.width/2-width/2),Math.max(margin,vw-width-margin));
      arrowOffset=Math.min(Math.max(22,rect.left+rect.width/2-left-7),Math.max(22,width-30));
    }
    popover.dataset.placement=placement;popover.style.left=`${Math.round(left)}px`;popover.style.top=`${Math.round(top)}px`;popover.style.setProperty('--pm-arrow-offset',`${Math.round(arrowOffset)}px`);
  }
  function markPaperPreviewAnchor(){
    document.querySelectorAll('[data-question-preview].preview-active').forEach(row=>row.classList.remove('preview-active'));
    if(state.paperPreviewAnchor?.isConnected)state.paperPreviewAnchor.classList.add('preview-active');
  }
  function refreshPaperPreviewAnchor(){
    if(!isPaperQuestionPreviewOpen()||!state.paperPreviewRef)return;
    const key=CSS.escape(paperPreviewKey()),source=CSS.escape(state.paperPreviewSource||'');
    const selector=source?`[data-question-preview="${key}"][data-preview-source="${source}"]`:`[data-question-preview="${key}"]`;
    const next=document.querySelector(selector)||document.querySelector(`[data-question-preview="${key}"]`);
    if(next){state.paperPreviewAnchor=next;markPaperPreviewAnchor();requestAnimationFrame(positionPaperQuestionPreview)}else closePaperQuestionPreview();
  }
  function openPaperQuestionPreview(value,anchor,options={}){
    const ref=typeof value==='string'?(()=>{const [bankId,questionId]=value.split('::');return {bankId,questionId}})():value;
    const found=paperQuestionLookup(ref||{}),popover=$('qbQuestionPreviewPopover'),nextKey=paperRefKey(ref||{}),same=isPaperQuestionPreviewOpen()&&paperPreviewKey()===nextKey;
    if(options.toggleSame&&same){closePaperQuestionPreview();return}
    if(!found.bank||!found.question||!popover)return toast('题目已不存在，无法预览。');
    const {bank,question}=found;state.paperPreviewRef={bankId:bank.id,questionId:question.id};state.paperPreviewAnchor=anchor||state.paperPreviewAnchor;state.paperPreviewSource=String(anchor?.dataset?.previewSource||state.paperPreviewSource||'');
    $('qbQuestionPreviewTitle').textContent=question.title||'未命名题目';
    const knowledge=questionDomainKey(question),tags=(question.tags||[]).slice(0,5);
    $('qbQuestionPreviewMeta').innerHTML=[question.teacherNumber,bank.name,questionTypeLabel(question.type),question.difficulty||'难度未设',knowledge,...tags].filter(Boolean).map(item=>`<span>${escapeHTML(item)}</span>`).join('');
    const stem=stemText(question).trim(),optionsList=(question.options||[]),correct=String(question.correctAnswer||optionsList.find(option=>option.correct)?.id||''),analysis=String(question.analysis||'').trim();
    $('qbQuestionPreviewContent').innerHTML=`<section class="pm-preview-block"><h3>题干</h3><div class="pm-preview-stem">${stem?escapeHTML(stem):'<span class="pm-preview-empty">暂无题干</span>'}</div></section>${optionsList.length?`<section class="pm-preview-block"><h3>选项</h3><div class="pm-preview-options">${optionsList.map(option=>`<div class="pm-preview-option ${String(option.id)===correct||option.correct?'correct':''}"><b>${escapeHTML(option.id)}</b><span>${escapeHTML(option.text||'')}</span></div>`).join('')}</div></section>`:''}<section class="pm-preview-block"><h3>正确答案</h3><div class="pm-preview-answer">${correct?escapeHTML(correct):'<span class="pm-preview-empty">未设置</span>'}</div></section><section class="pm-preview-block"><h3>解析</h3><div class="pm-preview-analysis">${analysis?escapeHTML(analysis):'<span class="pm-preview-empty">暂无解析</span>'}</div></section>`;
    popover.hidden=false;markPaperPreviewAnchor();requestAnimationFrame(positionPaperQuestionPreview);
  }
  function closePaperQuestionPreview(){
    if(state.paperPreviewClickTimer){clearTimeout(state.paperPreviewClickTimer);state.paperPreviewClickTimer=0}
    const popover=$('qbQuestionPreviewPopover');if(popover)popover.hidden=true;
    document.querySelectorAll('[data-question-preview].preview-active').forEach(row=>row.classList.remove('preview-active'));
    state.paperPreviewAnchor=null;state.paperPreviewSource='';state.paperPreviewRef=null;
  }
  function bindPaperPreviewRow(row){
    const key=String(row.dataset.questionPreview||'');
    row.addEventListener('click',event=>{
      if(event.target.closest('button,input,a,select'))return;
      if(!isPaperQuestionPreviewOpen()||paperPreviewKey()===key)return;
      if(state.paperPreviewClickTimer)clearTimeout(state.paperPreviewClickTimer);
      state.paperPreviewClickTimer=setTimeout(()=>{state.paperPreviewClickTimer=0;openPaperQuestionPreview(key,row,{toggleSame:false})},220);
    });
    row.addEventListener('dblclick',event=>{
      if(event.target.closest('button,input,a,select'))return;
      event.preventDefault();if(state.paperPreviewClickTimer){clearTimeout(state.paperPreviewClickTimer);state.paperPreviewClickTimer=0}
      openPaperQuestionPreview(key,row,{toggleSame:true});
    });
  }
  function openQuestionEditorFromPreview(){
    const ref=state.paperPreviewRef;if(!ref)return;
    const url=new URL('question-bank.html',document.baseURI||location.href);url.searchParams.set('bankId',ref.bankId);url.searchParams.set('questionId',ref.questionId);url.searchParams.set('view','base');
    window.open(url.href,'_blank','noopener');
  }

  function renderPaperManager(){
    renderPaperCategoryList();
    renderPaperList();
    fillPaperForm();
    renderPaperQuotaList();
    renderPaperCandidateList();
    renderPaperQuestionList();
    refreshPaperPreviewAnchor();
  }
  function renderPaperCategoryList(){
    const wrap=$('qbPaperCategoryList'),summary=$('qbPaperCategorySummary');if(!wrap)return;
    const counts=new Map();state.papers.forEach(paper=>counts.set(paper.categoryId||'',(counts.get(paper.categoryId||'')||0)+1));
    if(summary)summary.textContent=`${state.paperCategories.length} 个分类`;
    const fixed=[{id:'ALL',name:'全部试卷',count:state.papers.length},{id:'UNCATEGORIZED',name:'未分类',count:counts.get('')||0}];
    const rows=[...fixed,...state.paperCategories.map(category=>({id:category.id,name:category.name,count:counts.get(category.id)||0,custom:true}))];
    wrap.innerHTML=rows.map(row=>`<div class="pm-paper-category-row ${state.paperCategoryFilter===row.id?'active':''}"><button class="pm-paper-category-main" type="button" data-paper-category-id="${escapeHTML(row.id)}"><span>${escapeHTML(row.name)}</span><em>${row.count}</em></button>${row.custom?`<span class="pm-paper-category-actions"><button type="button" data-paper-category-rename="${escapeHTML(row.id)}" title="重命名分类" aria-label="重命名分类">✎</button><button type="button" class="danger" data-paper-category-delete="${escapeHTML(row.id)}" title="删除分类" aria-label="删除分类">×</button></span>`:''}</div>`).join('');
    wrap.querySelectorAll('[data-paper-category-id]').forEach(btn=>btn.addEventListener('click',()=>applyPaperCatalogFilter({category:String(btn.dataset.paperCategoryId||'ALL')})));
    wrap.querySelectorAll('[data-paper-category-rename]').forEach(btn=>btn.addEventListener('click',()=>renamePaperCategory(String(btn.dataset.paperCategoryRename||''))));
    wrap.querySelectorAll('[data-paper-category-delete]').forEach(btn=>btn.addEventListener('click',()=>deletePaperCategory(String(btn.dataset.paperCategoryDelete||''))));
  }
  function renderPaperList(){
    const list=$('qbPaperList'),pager=$('qbPaperListPager');if(!list)return;
    const {rows,pageRows,pages,start}=paperPageRows();state.currentPaperPageIds=pageRows.map(paper=>paper.id);
    const visibleIds=new Set(state.papers.map(paper=>paper.id));state.selectedPaperIds=new Set([...state.selectedPaperIds].filter(id=>visibleIds.has(id)));
    const search=$('qbPaperListSearch'),status=$('qbPaperStatusFilter');if(search&&search.value!==state.paperListSearch)search.value=state.paperListSearch;if(status)status.value=state.paperListStatus;
    const selectPage=$('qbPaperListSelectPage');if(selectPage){selectPage.checked=pageRows.length>0&&pageRows.every(paper=>state.selectedPaperIds.has(paper.id));selectPage.indeterminate=pageRows.some(paper=>state.selectedPaperIds.has(paper.id))&&!selectPage.checked}
    const bulk=$('qbPaperListBulkToolbar'),selectedCount=$('qbPaperListSelectedCount'),bulkCategory=$('qbPaperBulkCategorySelect');if(bulk)bulk.hidden=state.selectedPaperIds.size===0;if(selectedCount)selectedCount.textContent=`已选择 ${state.selectedPaperIds.size} 张试卷`;if(bulkCategory){const current=bulkCategory.value;bulkCategory.innerHTML='<option value="">未分类</option>'+state.paperCategories.map(category=>`<option value="${escapeHTML(category.id)}">${escapeHTML(category.name)}</option>`).join('');bulkCategory.value=state.paperCategories.some(item=>item.id===current)?current:''}
    if(!rows.length){list.innerHTML='<div class="qb-empty">当前分类或筛选下没有试卷。可新建试卷，或切换到“全部试卷”。</div>';if(pager)pager.hidden=true;return}
    list.innerHTML=pageRows.map((paper,index)=>{const integrity=paperIntegrity(paper),statusLabel=paper.status==='archived'?'已归档':(paper.publishedVersion>0?`已发布 v${paper.publishedVersion}`:'草稿'),checked=state.selectedPaperIds.has(paper.id);return `<article class="qb-list-item paper ${paper.id===state.selectedPaperId?'active':''} ${checked?'selected':''}" data-paper-id="${escapeHTML(paper.id)}" tabindex="0"><label class="pm-paper-list-check"><input type="checkbox" data-paper-list-check="${escapeHTML(paper.id)}" ${checked?'checked':''}/><span class="sr-only">选择试卷 ${escapeHTML(paper.name)}</span></label><span class="qb-paper-order">${start+index+1}</span><span class="qb-paper-text"><strong>${escapeHTML(paper.name)}</strong><small>${escapeHTML(paper.subject)} · ${escapeHTML(paperCategoryName(paper.categoryId))} · 已组 ${integrity.configuredCount}/目标 ${integrity.targetCount} 题</small></span><span class="qb-paper-state ${paper.status==='archived'?'archived':(paper.publishedVersion>0?'published':'draft')}">${escapeHTML(statusLabel)}</span></article>`}).join('');
    list.querySelectorAll('[data-paper-list-check]').forEach(input=>input.addEventListener('change',event=>{event.stopPropagation();const id=String(input.dataset.paperListCheck||'');if(input.checked)state.selectedPaperIds.add(id);else state.selectedPaperIds.delete(id);renderPaperList()}));
    list.querySelectorAll('[data-paper-id]').forEach(row=>{const select=()=>{const id=String(row.dataset.paperId||'');if(id===state.selectedPaperId)return;closePaperQuestionPreview();state.selectedPaperId=id;state.selectedPaperQuestionKeys=new Set();state.selectedPaperCandidateKeys=new Set();renderPaperManager()};row.addEventListener('click',event=>{if(event.target.closest('input,label,button,select,a'))return;select()});row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select()}})});
    if(pager){pager.hidden=pages<=1;pager.innerHTML=pages<=1?'':`<button type="button" data-paper-list-page="${state.paperListPage-1}" ${state.paperListPage<=1?'disabled':''}>上一页</button><span>${state.paperListPage} / ${pages} · ${rows.length} 张</span><button type="button" data-paper-list-page="${state.paperListPage+1}" ${state.paperListPage>=pages?'disabled':''}>下一页</button>`;pager.querySelectorAll('[data-paper-list-page]').forEach(btn=>btn.addEventListener('click',()=>{state.paperListPage=Number(btn.dataset.paperListPage||1);state.selectedPaperIds=new Set();renderPaperList()}))}
  }
  function applyPaperCatalogFilter(next={}){
    if(Object.prototype.hasOwnProperty.call(next,'category'))state.paperCategoryFilter=String(next.category||'ALL');
    if(Object.prototype.hasOwnProperty.call(next,'status'))state.paperListStatus=String(next.status||'ALL');
    if(Object.prototype.hasOwnProperty.call(next,'search'))state.paperListSearch=String(next.search||'');
    state.paperListPage=1;state.selectedPaperIds=new Set();closePaperQuestionPreview();ensureSelectedPaperVisible();renderPaperManager();
  }
  function addPaperCategory(){
    const name=String(prompt('请输入试卷分类名称：','')||'').trim();if(!name)return;if(state.paperCategories.some(item=>item.name===name))return toast('已存在同名分类。');const category=normalizePaperCategory({id:safeId('paper-category'),name});state.paperCategories.push(category);savePaperCategories();state.paperCategoryFilter=category.id;state.paperListPage=1;state.selectedPaperId='';state.selectedPaperIds=new Set();closePaperQuestionPreview();renderPaperManager();toast(`已创建分类“${name}”。`)
  }
  function renamePaperCategory(categoryId){
    const category=state.paperCategories.find(item=>item.id===categoryId);if(!category)return;const name=String(prompt('修改分类名称：',category.name)||'').trim();if(!name||name===category.name)return;if(state.paperCategories.some(item=>item.id!==category.id&&item.name===name))return toast('已存在同名分类。');category.name=name;category.updatedAt=Date.now();savePaperCategories();renderPaperManager();toast('分类名称已更新。')
  }
  function deletePaperCategory(categoryId){
    const category=state.paperCategories.find(item=>item.id===categoryId);if(!category)return;const count=state.papers.filter(paper=>paper.categoryId===categoryId).length;if(!confirm(`确定删除分类“${category.name}”吗？

分类中的 ${count} 张试卷将移入“未分类”，试卷不会被删除。`))return;state.papers.forEach(paper=>{if(paper.categoryId===categoryId){paper.categoryId='';paper.updatedAt=Date.now()}});state.paperCategories=state.paperCategories.filter(item=>item.id!==categoryId);if(state.paperCategoryFilter===categoryId)state.paperCategoryFilter='UNCATEGORIZED';savePaperCategories();savePapers(state.papers,{silent:true});renderPaperManager();toast('分类已删除，原试卷已移入未分类。')
  }
  function toggleSelectPaperPage(event){state.selectedPaperIds=event.currentTarget.checked?new Set(state.currentPaperPageIds):new Set();renderPaperList()}
  function moveSelectedPapersToCategory(){
    if(!state.selectedPaperIds.size)return;const categoryId=$('qbPaperBulkCategorySelect')?.value||'',categoryName=paperCategoryName(categoryId),count=state.selectedPaperIds.size;state.papers.forEach(paper=>{if(state.selectedPaperIds.has(paper.id)){paper.categoryId=categoryId;paper.updatedAt=Date.now()}});savePapers(state.papers,{silent:true});state.selectedPaperIds=new Set();ensureSelectedPaperVisible();renderPaperManager();toast(`已将 ${count} 张试卷移动到“${categoryName}”。`)
  }
  function archiveSelectedPapers(){
    const selected=state.papers.filter(paper=>state.selectedPaperIds.has(paper.id)&&paper.status!=='archived');if(!selected.length)return toast('选中的试卷均已归档。');if(!confirm(`确定归档选中的 ${selected.length} 张试卷吗？

已发布试卷将从学员端下架，历史发布记录仍保留。`))return;const currentId=currentPaper()?.id||'';selected.forEach(paper=>{if(paper.publishedVersion>0)withdrawPaperRelease(paper);paper.status='archived';paper.archivedAt=Date.now();paper.updatedAt=Date.now()});if(selected.some(paper=>paper.id===currentId))setCurrentPaper(null);savePapers(state.papers,{silent:true});state.selectedPaperIds=new Set();ensureSelectedPaperVisible();renderPaperManager();toast(`已归档 ${selected.length} 张试卷。`)
  }
  function deleteSelectedPaperDrafts(){
    const selected=state.papers.filter(paper=>state.selectedPaperIds.has(paper.id)),deletable=selected.filter(paper=>paperStatusKey(paper)==='draft'),protectedCount=selected.length-deletable.length;if(!deletable.length)return toast('选中项中没有可删除的草稿；已发布或已归档试卷受到保护。');if(!confirm(`即将删除 ${deletable.length} 张草稿${protectedCount?`，另有 ${protectedCount} 张受保护试卷会跳过`:''}。

只删除试卷配置，不会删除题库原题。`))return;const ids=new Set(deletable.map(paper=>paper.id));state.papers=state.papers.filter(paper=>!ids.has(paper.id));state.selectedPaperIds=new Set();savePapers(state.papers,{silent:true});ensureSelectedPaperVisible();renderPaperManager();toast(`已删除 ${deletable.length} 张草稿${protectedCount?`，跳过 ${protectedCount} 张受保护试卷`:''}。`)
  }
  function fillPaperForm(){
    const paper = currentPaper();
    const subjectSelect = $('paperSubjectInput');
    if(subjectSelect){
      subjectSelect.innerHTML = SUBJECTS.filter(s => s.id !== 'CUSTOM').map(s => `<option value="${escapeHTML(s.id)}">${escapeHTML(s.label)}${s.future ? '（扩展）' : ''}</option>`).join('');
      subjectSelect.value = paper ? paper.subject : (state.subjectFilter === 'ALL' ? 'PMP' : state.subjectFilter);
    }
    if($('paperNameInput')) $('paperNameInput').value = paper ? paper.name : '';
    if($('paperTotalInput')) $('paperTotalInput').value = paper ? paper.totalCount || 180 : 180;
    const categorySelect=$('paperCategoryInput');if(categorySelect){categorySelect.innerHTML='<option value="">未分类</option>'+state.paperCategories.map(item=>`<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)}</option>`).join('');categorySelect.value=paper?.categoryId||''}
    if($('paperDescriptionInput')) $('paperDescriptionInput').value = paper ? paper.description || '' : '';
    document.querySelectorAll('[data-paper-mode]').forEach(input=>{input.checked=!!paper&&(paper.enabledModes||[]).includes(String(input.dataset.paperMode||''))});
    const meta = $('qbPaperMeta');
    if(meta){
      if(!paper){
        meta.innerHTML = '<div class="qb-empty">新建或选择一套试卷后，可维护组卷规则并发布。</div>';
      }else{
        const integrity = paperIntegrity(paper);
        const published = Number(paper.publishedVersion||0)>0;
        meta.innerHTML = `
          <span class="qb-badge ${published ? 'current' : ''}">${published ? `已发布 v${paper.publishedVersion}：学员端读取发布快照` : '草稿：仅后台可见'}</span>
          <span class="qb-badge">已组 ${integrity.configuredCount} 题</span>
          <span class="qb-badge">目标 ${integrity.targetCount} 题</span>
          <span class="qb-badge ${integrity.missingCount ? 'warn' : ''}">前端可用 ${integrity.validCount} 题</span>
          ${integrity.missingCount ? `<span class="qb-badge warn">失效引用 ${integrity.missingCount} 题</span>` : ''}
          ${integrity.duplicateCount ? `<span class="qb-badge warn">重复引用 ${integrity.duplicateCount} 题</span>` : ''}
          ${paper.publishedAt ? `<span class="qb-badge">发布时间 ${new Date(paper.publishedAt).toLocaleString()}</span>` : ''}
        `;
      }
    }
    const publishBtn = $('qbPublishPaperBtn');
    if(publishBtn) publishBtn.textContent = paper && paper.publishedVersion > 0 ? '发布新版本' : '发布试卷';
  }
  function readPaperFormInto(paper){
    if(!paper) return null;
    paper.name = $('paperNameInput')?.value.trim() || paper.name || '未命名试卷';
    paper.subject = $('paperSubjectInput')?.value || paper.subject || 'PMP';
    paper.totalCount = Math.max(1, Number($('paperTotalInput')?.value || paper.totalCount || 180));
    paper.categoryId = $('paperCategoryInput')?.value || '';
    paper.description = $('paperDescriptionInput')?.value.trim() || '';
    paper.enabledModes=Array.from(document.querySelectorAll('[data-paper-mode]:checked')).map(input=>String(input.dataset.paperMode||'')).filter(Boolean);
    if(!paper.enabledModes.length)paper.enabledModes=['deep_recall','multi_question_canvas','single_deep_study'];
    paper.quotas = collectPaperQuotaFromDom();
    paper.updatedAt = Date.now();
    return paper;
  }
  function savePaperForm(options={}){
    let paper = currentPaper();
    if(!paper){
      paper = createPaperObject(state.subjectFilter === 'ALL' ? 'PMP' : state.subjectFilter);
      state.papers.push(paper);
      state.selectedPaperId = paper.id;
    }
    readPaperFormInto(paper);
    savePapers(state.papers, {silent:options.silent});
    if(!options.skipRender) renderPaperManager();
    return true;
  }
  function createPaperObject(subject='PMP'){
    const meta = subjectMeta(subject);
    return normalizePaper({
      id:safeId('paper'),
      name:`${meta.name} 综合训练试卷`,
      subject,
      description:`从 ${meta.label} 多个题库/知识领域中抽题组成综合训练。`,
      totalCount:180,
      categoryId:state.paperCategoryFilter!=='ALL'&&state.paperCategoryFilter!=='UNCATEGORIZED'?state.paperCategoryFilter:'',
      status:'draft',
      quotas:{},
      questions:[]
    });
  }
  function addPaper(){
    const subject = state.subjectFilter === 'ALL' ? (currentBank()?.subject || 'PMP') : state.subjectFilter;
    const paper = createPaperObject(subject);
    state.papers.push(paper);
    state.selectedPaperId = paper.id;
    state.paperListPage=1;state.selectedPaperIds=new Set();
    savePapers(state.papers);
    if(document.body?.dataset?.paperManagementPage!=='true')handleLayoutNav('papers');
    renderPaperManager();
  }
  function collectPaperQuotaFromDom(){
    const rows = Array.from(document.querySelectorAll('#qbPaperQuotaList [data-domain]'));
    const quotas = {};
    rows.forEach(row => {
      const domain = row.dataset.domain || '';
      const value = Math.max(0, Number(row.querySelector('input')?.value || 0));
      if(domain && value > 0) quotas[domain] = value;
    });
    return quotas;
  }
  function renderPaperQuotaList(){
    const wrap = $('qbPaperQuotaList');
    if(!wrap) return;
    const paper = currentPaper();
    const subject = $('paperSubjectInput')?.value || paper?.subject || 'PMP';
    const stats = paperDomainStats(subject);
    const quotas = paper ? paper.quotas || {} : {};
    if(!stats.length){
      wrap.innerHTML = '<div class="qb-empty">该科目暂无题目。请先在对应科目题库中录入或导入题目。</div>';
      return;
    }
    wrap.innerHTML = stats.map(item => `
      <div class="qb-quota-row" data-domain="${escapeHTML(item.domain)}">
        <div>
          <strong>${escapeHTML(item.domain)}</strong>
          <small>可用 ${item.count} 题 · 标注≥50% ${item.complete} 题</small>
        </div>
        <input type="number" min="0" max="${item.count}" value="${escapeHTML(quotas[item.domain] || 0)}" />
      </div>
    `).join('');
  }
  function renderPaperQuestionList(){
    const list=$('qbPaperQuestionList'),count=$('qbPaperQuestionCount');if(!list)return;
    const paper=currentPaper(),refs=paper?(paper.questions||[]):[];if(count)count.textContent=`${refs.length} 题`;
    const validKeys=new Set(refs.map(paperRefKey));state.selectedPaperQuestionKeys=new Set([...state.selectedPaperQuestionKeys].filter(key=>validKeys.has(key)));
    const toolbar=$('qbPaperPreviewBulkToolbar'),bulkCount=$('qbPaperPreviewSelectedCount'),selectAll=$('qbPaperPreviewSelectAll');
    if(toolbar)toolbar.hidden=state.selectedPaperQuestionKeys.size===0;if(bulkCount)bulkCount.textContent=`已选择 ${state.selectedPaperQuestionKeys.size} 道题`;
    if(selectAll){selectAll.checked=refs.length>0&&refs.every(ref=>state.selectedPaperQuestionKeys.has(paperRefKey(ref)));selectAll.indeterminate=state.selectedPaperQuestionKeys.size>0&&!selectAll.checked}
    if(!paper){list.innerHTML='<div class="qb-empty">暂无试卷。</div>';return}
    if(!refs.length){list.innerHTML='<div class="qb-empty">尚未选题。可从上方题库选择器手动加入，或使用按配额补充。</div>';return}
    list.innerHTML=refs.map((ref,index)=>{const {bank,question}=paperQuestionLookup(ref),key=paperRefKey(ref),checked=state.selectedPaperQuestionKeys.has(key);return `
      <article class="qb-paper-question-row ${checked?'selected':''}" data-question-preview="${escapeHTML(key)}" data-preview-source="preview" title="双击打开或关闭预览；预览打开后单击其他题目可切换">
        <label class="qb-paper-question-check"><input type="checkbox" data-paper-preview-check="${escapeHTML(key)}" ${checked?'checked':''}/><span class="sr-only">选择第 ${index+1} 题</span></label>
        <span>${index+1}</span><div><strong>${escapeHTML(question?question.title:'题目已不存在')}</strong><small>${escapeHTML(bank?bank.name:'未知题库')} · ${escapeHTML(question?questionDomainKey(question):'')} · ${escapeHTML(question?question.difficulty||'难度未设':'')}</small></div>
        <div class="qb-paper-row-actions"><button type="button" data-paper-move="${index}" data-direction="-1" ${index===0?'disabled':''} aria-label="上移">↑</button><button type="button" data-paper-move="${index}" data-direction="1" ${index===refs.length-1?'disabled':''} aria-label="下移">↓</button><button type="button" class="danger" data-paper-remove="${index}">移除</button></div>
      </article>`}).join('');
    list.querySelectorAll('[data-paper-preview-check]').forEach(input=>input.addEventListener('change',()=>{const key=String(input.dataset.paperPreviewCheck||'');if(input.checked)state.selectedPaperQuestionKeys.add(key);else state.selectedPaperQuestionKeys.delete(key);renderPaperQuestionList()}));
    list.querySelectorAll('[data-question-preview]').forEach(bindPaperPreviewRow);
    refreshPaperPreviewAnchor();
    list.querySelectorAll('[data-paper-remove]').forEach(btn=>btn.addEventListener('click',()=>removePaperQuestion(Number(btn.dataset.paperRemove))));
    list.querySelectorAll('[data-paper-move]').forEach(btn=>btn.addEventListener('click',()=>movePaperQuestion(Number(btn.dataset.paperMove),Number(btn.dataset.direction))));
  }
  function toggleSelectPaperPreview(event){const paper=currentPaper(),checked=!!event.currentTarget.checked;if(!paper)return;state.selectedPaperQuestionKeys=checked?new Set((paper.questions||[]).map(paperRefKey)):new Set();renderPaperQuestionList()}
  function removeSelectedPaperQuestions(){const paper=currentPaper(),keys=state.selectedPaperQuestionKeys;if(!paper||!keys.size)return;const count=keys.size;if(state.paperPreviewRef&&keys.has(paperPreviewKey()))closePaperQuestionPreview();if(!confirm(`确定从试卷中移除选中的 ${count} 道题吗？\n\n只移除试卷引用，不会删除题库原题。`))return;paper.questions=(paper.questions||[]).filter(ref=>!keys.has(paperRefKey(ref)));paper.questions.forEach((ref,index)=>{ref.order=index+1});paper.updatedAt=Date.now();state.selectedPaperQuestionKeys=new Set();savePapers(state.papers,{silent:true});renderPaperManager();toast(`已从试卷移除 ${count} 道题。`)}
  function movePaperQuestion(index,direction){const paper=currentPaper(),target=index+direction;if(!paper||index<0||target<0||target>=paper.questions.length)return;[paper.questions[index],paper.questions[target]]=[paper.questions[target],paper.questions[index]];paper.questions.forEach((ref,i)=>{ref.order=i+1});paper.updatedAt=Date.now();savePapers(state.papers,{silent:true});renderPaperQuestionList()}

  function renderPaperCandidateList(){
    const wrap=$('qbPaperCandidateList');if(!wrap)return;const paper=currentPaper(),subject=$('paperSubjectInput')?.value||paper?.subject||'PMP';
    const bankFilter=$('qbPaperCandidateBankFilter');if(bankFilter){const banks=state.banks.filter(bank=>bank.subject===subject);bankFilter.innerHTML='<option value="ALL">全部题库</option>'+banks.map(bank=>`<option value="${escapeHTML(bank.id)}">${escapeHTML(bank.name)}</option>`).join('');if(!banks.some(bank=>bank.id===state.paperCandidateBankId))state.paperCandidateBankId='ALL';bankFilter.value=state.paperCandidateBankId}
    if(!paper){wrap.innerHTML='<div class="qb-empty">请先新建或选择试卷。</div>';return}
    const keyword=String(state.paperCandidateSearch||'').toLowerCase(),existing=new Set((paper.questions||[]).map(paperRefKey));
    const rows=paperCandidates(subject).filter(row=>state.paperCandidateBankId==='ALL'||row.bank.id===state.paperCandidateBankId).filter(row=>{if(!keyword)return true;const text=[row.question.title,stemText(row.question),row.question.domain,row.question.topic,row.question.difficulty,...(row.question.tags||[])].join(' ').toLowerCase();return text.includes(keyword)});
    const pages=Math.max(1,Math.ceil(rows.length/PAPER_CANDIDATE_PAGE_SIZE));state.paperCandidatePage=Math.min(Math.max(1,state.paperCandidatePage),pages);const start=(state.paperCandidatePage-1)*PAPER_CANDIDATE_PAGE_SIZE,pageRows=rows.slice(start,start+PAPER_CANDIDATE_PAGE_SIZE);state.currentPaperCandidateKeys=pageRows.map(row=>paperRefKey({bankId:row.bank.id,questionId:row.question.id}));
    const selectAll=$('qbSelectPaperCandidatesPage');if(selectAll){selectAll.checked=pageRows.length>0&&pageRows.every(row=>state.selectedPaperCandidateKeys.has(paperRefKey({bankId:row.bank.id,questionId:row.question.id})));selectAll.indeterminate=pageRows.some(row=>state.selectedPaperCandidateKeys.has(paperRefKey({bankId:row.bank.id,questionId:row.question.id})))&&!selectAll.checked}
    const count=$('qbPaperCandidateSelectionCount');if(count)count.textContent=`已选择 ${state.selectedPaperCandidateKeys.size} 道题`;
    if(!pageRows.length){wrap.innerHTML='<div class="qb-empty">当前筛选下没有可用题目。</div>'}else wrap.innerHTML=pageRows.map((row,index)=>{const key=paperRefKey({bankId:row.bank.id,questionId:row.question.id}),added=existing.has(key),checked=state.selectedPaperCandidateKeys.has(key);return `<article class="qb-paper-candidate-row ${added?'added':''}" data-question-preview="${escapeHTML(key)}" data-preview-source="candidate" title="双击打开或关闭预览；预览打开后单击其他题目可切换"><label class="pm-paper-candidate-check"><input type="checkbox" data-paper-candidate="${escapeHTML(key)}" ${checked?'checked':''} ${added?'disabled':''}/><span class="sr-only">选择题目 ${escapeHTML(row.question.title||'未命名题目')}</span></label><span class="qb-paper-candidate-number">${start+index+1}</span><span><strong>${escapeHTML(row.question.title||'未命名题目')}</strong><small>${escapeHTML(row.bank.name)} · ${escapeHTML(questionDomainKey(row.question))} · ${escapeHTML(row.question.difficulty||'难度未设')}</small></span><em>${added?'已加入':'可加入'}</em></article>`}).join('');
    wrap.querySelectorAll('[data-paper-candidate]').forEach(input=>input.addEventListener('change',()=>{const key=String(input.dataset.paperCandidate||'');if(input.checked)state.selectedPaperCandidateKeys.add(key);else state.selectedPaperCandidateKeys.delete(key);renderPaperCandidateList()}));
    wrap.querySelectorAll('[data-question-preview]').forEach(bindPaperPreviewRow);
    refreshPaperPreviewAnchor();
    const pager=$('qbPaperCandidatePager');if(pager){pager.hidden=pages<=1;pager.innerHTML=pages<=1?'':`<button type="button" data-paper-page="${state.paperCandidatePage-1}" ${state.paperCandidatePage<=1?'disabled':''}>上一页</button><span>${state.paperCandidatePage} / ${pages} · ${rows.length} 题</span><button type="button" data-paper-page="${state.paperCandidatePage+1}" ${state.paperCandidatePage>=pages?'disabled':''}>下一页</button>`;pager.querySelectorAll('[data-paper-page]').forEach(btn=>btn.addEventListener('click',()=>{state.paperCandidatePage=Number(btn.dataset.paperPage||1);state.selectedPaperCandidateKeys=new Set();renderPaperCandidateList()}))}
  }
  function toggleSelectPaperCandidatePage(event){const checked=!!event.currentTarget.checked;state.selectedPaperCandidateKeys=checked?new Set(state.currentPaperCandidateKeys.filter(key=>{const paper=currentPaper();return !(paper?.questions||[]).some(ref=>paperRefKey(ref)===key)})):new Set();renderPaperCandidateList()}
  function addSelectedCandidatesToPaper(){const paper=currentPaper();if(!paper)return toast('请先新建试卷。');const selected=state.selectedPaperCandidateKeys;if(!selected.size)return toast('请先选择当前页题目。');const existing=new Set((paper.questions||[]).map(paperRefKey));let added=0;selected.forEach(key=>{if(existing.has(key))return;const [bankId,questionId]=key.split('::');if(!bankId||!questionId)return;paper.questions.push({bankId,questionId,order:paper.questions.length+1,score:1});existing.add(key);added+=1});paper.totalCount=Math.max(Number(paper.totalCount||0),paper.questions.length);paper.updatedAt=Date.now();state.selectedPaperCandidateKeys=new Set();savePapers(state.papers,{silent:true});renderPaperManager();toast(`已加入 ${added} 道题。`)}

  function autoDistributeQuota(){
    let paper = currentPaper();
    if(!paper){ addPaper(); paper = currentPaper(); }
    readPaperFormInto(paper);
    const stats = paperDomainStats(paper.subject).filter(item => item.count > 0);
    if(!stats.length) return toast('该科目暂无可组卷题目。');
    const total = Math.min(paper.totalCount || 180, stats.reduce((sum,item) => sum + item.count, 0));
    let remain = total;
    const quotas = {};
    stats.forEach((item, index) => {
      const leftCount = stats.slice(index).reduce((sum,x) => sum + x.count, 0);
      let value = index === stats.length - 1 ? remain : Math.round(total * item.count / Math.max(1, leftCount + stats.slice(0,index).reduce((sum,x)=>sum+x.count,0)));
      value = Math.min(item.count, Math.max(0, value));
      if(value > remain) value = remain;
      quotas[item.domain] = value;
      remain -= value;
    });
    let i = 0;
    while(remain > 0 && stats.length){
      const item = stats[i % stats.length];
      if((quotas[item.domain] || 0) < item.count){ quotas[item.domain] += 1; remain -= 1; }
      i += 1;
      if(i > stats.length * 400) break;
    }
    paper.quotas = quotas;
    savePapers(state.papers, {silent:true});
    renderPaperManager();
    toast('已按当前可用题量自动分配配额。');
  }
  function clearPaperQuota(){
    const paper = currentPaper();
    if(!paper) return;
    paper.quotas = {};
    savePapers(state.papers, {silent:true});
    renderPaperManager();
  }
  function shuffleRows(rows){
    const next = rows.slice();
    for(let i=next.length-1;i>0;i--){
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j], next[i]];
    }
    return next;
  }
  function buildCurrentPaper(){
    let paper=currentPaper();if(!paper){addPaper();paper=currentPaper()}
    readPaperFormInto(paper);const quotas=paper.quotas||{},candidates=paperCandidates(paper.subject);
    const selected=(paper.questions||[]).filter(ref=>{const found=paperQuestionLookup(ref);return !!(found.bank&&found.question)}).map((ref,index)=>({...ref,order:index+1}));
    const used=new Set(selected.map(paperRefKey));
    const existingByDomain=new Map();selected.forEach(ref=>{const found=paperQuestionLookup(ref);const domain=found.question?questionDomainKey(found.question):'';if(domain)existingByDomain.set(domain,(existingByDomain.get(domain)||0)+1)});
    Object.entries(quotas).forEach(([domain,quota])=>{let need=Math.max(0,Number(quota||0)-(existingByDomain.get(domain)||0));if(!need)return;for(const row of shuffleRows(candidates.filter(item=>item.domain===domain))){if(need<=0)break;const key=paperRefKey({bankId:row.bank.id,questionId:row.question.id});if(used.has(key))continue;used.add(key);selected.push({bankId:row.bank.id,questionId:row.question.id,order:selected.length+1,score:1});need-=1}});
    const target=Math.max(selected.length,Math.max(1,Number(paper.totalCount||180)));if(selected.length<target){for(const row of shuffleRows(candidates)){if(selected.length>=target)break;const key=paperRefKey({bankId:row.bank.id,questionId:row.question.id});if(used.has(key))continue;used.add(key);selected.push({bankId:row.bank.id,questionId:row.question.id,order:selected.length+1,score:1})}}
    paper.questions=selected.map((ref,index)=>({...ref,order:index+1}));paper.updatedAt=Date.now();savePapers(state.papers,{silent:true});renderPaperManager();const shortage=selected.length<target?`，当前题量不足目标 ${target}，实际 ${selected.length} 题`:'';toast(`已按配额补充题目${shortage}。`)
  }
  function togglePublishPaper(){
    if(window.KGRolePermissions&&!window.KGRolePermissions.can('publishPapers'))return toast('当前角色无试卷发布权限。');
    const paper=currentPaper();if(!paper)return toast('请先新建试卷。');readPaperFormInto(paper);
    if(!(paper.questions||[]).length)return toast('请先从题库选择题目后再发布。');
    const integrity=paperIntegrity(paper);if(integrity.missingCount)return toast(`试卷中有 ${integrity.missingCount} 道题目引用已失效，请先移除。`);if(integrity.duplicateCount)return toast(`试卷中有 ${integrity.duplicateCount} 个重复题目引用，请先处理。`);
    if(!(paper.enabledModes||[]).length)return toast('请保留默认发布范围。');
    const release=publishPaperRelease(paper);if(!release)return toast('发布失败，请检查浏览器存储空间。');paper.updatedAt=Date.now();savePapers(state.papers,{silent:true});setCurrentPaper(paper);renderPaperManager();toast(`已发布 v${release.version}，学员可在独立做题模式中使用。`);
  }
  function archiveCurrentPaper(){const paper=currentPaper();if(!paper)return;if(!confirm(`确定归档试卷“${paper.name}”吗？\n\n归档后学员端不再显示，历史发布记录仍保留。`))return;withdrawPaperRelease(paper);paper.status='archived';paper.archivedAt=Date.now();paper.updatedAt=Date.now();setCurrentPaper(null);savePapers(state.papers,{silent:true});renderPaperManager();toast('试卷已归档。')}
  function removePaperQuestion(index){
    const paper = currentPaper();
    if(!paper) return;
    const removed=paper.questions[index];
    paper.questions.splice(index, 1);
    if(removed){state.selectedPaperQuestionKeys.delete(paperRefKey(removed));if(paperPreviewKey()===paperRefKey(removed))closePaperQuestionPreview()}
    paper.questions.forEach((ref, i) => { ref.order = i + 1; });
    paper.updatedAt = Date.now();
    savePapers(state.papers, {silent:true});
    renderPaperManager();
  }
  function deleteCurrentPaper(){
    const paper = currentPaper();
    if(!paper) return;
    if(!confirm(`确定删除试卷“${paper.name}”吗？\n\n不会删除原题库题目，只删除这套试卷配置。`)) return;
    const index = state.papers.findIndex(p => p.id === paper.id);
    if(index >= 0) state.papers.splice(index, 1);
    state.selectedPaperId = state.papers[Math.max(0, index - 1)]?.id || state.papers[0]?.id || '';
    if(paper.publishedVersion>0){withdrawPaperRelease(paper);setCurrentPaper(null);}
    savePapers(state.papers, {silent:true});
    renderPaperManager();
    toast('已删除试卷。');
  }
  function exportCurrentPaper(){
    savePaperForm({silent:true, skipRender:true});
    const paper = currentPaper();
    if(!paper) return;
    downloadJson((paper.name || '试卷') + '.json', paper);
  }

  function toggleCustomSubject(){
    const isCustom = $('bankSubject').value === 'CUSTOM';
    $('customSubjectWrap').hidden = !isCustom;
  }
  async function saveBankForm(options={}){
    const bank = currentBank();
    if(!bank) return;
    if(state.serverCatalogNewerRevision&&!options.allowServerMerge){toast('服务器有新版本，请先选择重新载入或合并。');return false}
    const selectedSubject = $('bankSubject').value;
    const customSubject=$('bankCustomSubject').value.trim(),bankName=$('bankName').value.trim();
    if(selectedSubject==='CUSTOM'&&!customSubject){$('bankCustomSubject').focus();toast('自定义科目不能为空。');return}
    if(!bankName){$('bankName').focus();toast('题库名称不能为空。');return}
    bank.subject = selectedSubject === 'CUSTOM' ? customSubject : selectedSubject;
    bank.name = bankName;
    bank.version = $('bankVersion').value.trim() || '1.0';
    const nextVisibility=$('bankVisibility')?.value==='published'?'published':'private';
    bank.visibility=nextVisibility;
    bank.publishedAt=nextVisibility==='published'?(Number(bank.publishedAt)||Date.now()):0;
    bank.description = $('bankDescription').value.trim();
    bank.updatedAt = Date.now();
    bank.questions.forEach(q => { q.subject = q.subject || bank.subject; });
    try{
      await Catalog.saveBank({id:bank.id,name:bank.name,subject:bank.subject,description:bank.description,version:bank.version,visibility:bank.visibility,revision:bank.revision});
      reloadBanksFromCatalog(bank.id,state.selectedQuestionId);render();CatalogEditor?.applyReadonlyState(CatalogEditor.status().readonly);
      toast(nextVisibility==='published'?'题库已保存并发布给学员。':'题库已保存，仅教师自己可见。');return true;
    }catch(error){Object.assign(bank,before);render();alert('题库保存失败：'+(error.message||error));return false}
  }
  function collectOptionsFromDom(){
    const rows = Array.from(document.querySelectorAll('#qbOptionsEditor .qb-option-row'));
    const correct = document.querySelector('input[name="correctOption"]:checked')?.value || '';
    return rows.map((row, index) => {
      const id = row.querySelector('.option-id').value.trim() || String.fromCharCode(65 + index);
      return {
        id,
        text:row.querySelector('.option-text').value.trim(),
        trap:row.querySelector('.option-trap').value.trim(),
        correct:id === correct
      };
    }).filter(o => o.id || o.text);
  }
  function collectEnglishOptionsFromDom(){
    return Array.from(document.querySelectorAll('#qbOptionsEditorEn .tq-option-en-row')).map((row,index)=>({id:String(row.dataset.enOptionId||String.fromCharCode(65+index)),text:row.querySelector('.option-text-en')?.value.trim()||''}));
  }

  function collectReasoningFromDom(question=currentQuestion()){
    const rows = Array.from(document.querySelectorAll('#qbReasoningList [data-reasoning-index]'));
    return rows.map((row, index) => ({
      id:question?.reasoningSteps?.[index]?.id || safeId('rs'),
      title:row.querySelector('.rs-title').value.trim() || '推理步骤 ' + (index + 1),
      content:row.querySelector('.rs-content').value.trim(),
      relatedKeywords:cleanList(row.querySelector('.rs-keywords').value),
      relatedKnowledgePoints:cleanList(row.querySelector('.rs-kps').value),
      recallQuestion:row.querySelector('.rs-question').value.trim()
    }));
  }
  function applyPendingCognitiveSubforms(draft,pendingSubforms={}){
    const clueText=String($('clueTextInput')?.value||'').trim();
    const clueHasPartial=Boolean(pendingSubforms.clueTouched||clueText||String($('clueConceptIdsInput')?.value||'').trim()||String($('clueExplainInput')?.value||'').trim());
    const floatingClueText=String($('floatingClueTextInput')?.value||'').trim();
    const floatingClueHasPartial=Boolean(pendingSubforms.floatingClueTouched||floatingClueText||String($('floatingClueConceptIdsInput')?.value||'').trim()||String($('floatingClueExplainInput')?.value||'').trim());
    const conceptTitle=String($('conceptTitleInput')?.value||'').trim();
    const conceptHasPartial=Boolean(pendingSubforms.conceptTouched||conceptTitle||['conceptIdInput','conceptCategoryInput','conceptKeywordsInput','conceptSummaryInput','conceptNotesInput','conceptRuleInput'].some(id=>String($(id)?.value||'').trim()));
    pendingSubforms.incompleteReason=!clueText&&clueHasPartial?'关键词子表单尚未填写关键词，不能合并。':(!floatingClueText&&floatingClueHasPartial?'悬浮关键词子表单尚未填写关键词，不能合并。':(!conceptTitle&&conceptHasPartial?'知识点子表单尚未填写名称，不能合并。':''));
    if(clueText){
      draft.clues=Array.isArray(draft.clues)?draft.clues:[];
      const sourceType=$('clueSourceInput')?.value==='option'?'option':'stem';
      const pendingClueId=state.editingClueId||pendingSubforms.clueId||(pendingSubforms.clueId=safeId('clue-pending'));
      const clue=normalizeClue({id:pendingClueId,text:clueText,type:$('clueTypeInput')?.value||'core',clueRole:$('clueRoleInput')?.value||'true',sourceType,sourceOptionId:sourceType==='option'?String($('clueOptionIdInput')?.value||''):'',conceptIds:cleanList($('clueConceptIdsInput')?.value),explain:String($('clueExplainInput')?.value||'').trim()},draft.clues.length);
      const index=draft.clues.findIndex(item=>item.id===pendingClueId);if(index>=0)draft.clues[index]=clue;else draft.clues.push(clue);
    }
    if(floatingClueText){
      draft.clues=Array.isArray(draft.clues)?draft.clues:[];
      const pendingFloatingId=pendingSubforms.floatingClueId||(pendingSubforms.floatingClueId=safeId('clue-floating-pending')),selection=state.pendingKeywordSelection||{};
      const clue=normalizeClue({id:pendingFloatingId,text:floatingClueText,type:$('floatingClueTypeInput')?.value||'core',clueRole:$('floatingClueRoleInput')?.value||'true',sourceType:selection.sourceType==='option'?'option':'stem',sourceOptionId:selection.sourceType==='option'?String(selection.sourceOptionId||''):'',conceptIds:cleanList($('floatingClueConceptIdsInput')?.value),explain:String($('floatingClueExplainInput')?.value||'').trim()},draft.clues.length);
      const index=draft.clues.findIndex(item=>item.id===pendingFloatingId);if(index>=0)draft.clues[index]=clue;else draft.clues.push(clue);
    }
    if(conceptTitle){
      draft.concepts=Array.isArray(draft.concepts)?draft.concepts:[];
      const pendingConceptId=state.editingConceptId||pendingSubforms.conceptId||(pendingSubforms.conceptId=safeId('concept-pending'));
      const requestedConceptId=String($('conceptIdInput')?.value||'').trim()||pendingConceptId;
      const concept=normalizeConcept({id:requestedConceptId,title:conceptTitle,category:String($('conceptCategoryInput')?.value||'').trim(),level:$('conceptLevelInput')?.value||'基础',keywords:String($('conceptKeywordsInput')?.value||'').trim(),color:$('conceptColorInput')?.value||'#7c3aed',summary:String($('conceptSummaryInput')?.value||'').trim(),notes:String($('conceptNotesInput')?.value||'').trim(),rule:String($('conceptRuleInput')?.value||'').trim()},draft.concepts.length);
      let index=draft.concepts.findIndex(item=>item.id===requestedConceptId);if(index<0&&pendingSubforms.conceptAppliedId)index=draft.concepts.findIndex(item=>item.id===pendingSubforms.conceptAppliedId);
      if(index>=0)draft.concepts[index]=concept;else draft.concepts.push(concept);pendingSubforms.conceptAppliedId=requestedConceptId;
    }
    const recallKeywords=String($('qbRecallKeywordsInput')?.value||'').split(/[\r\n,，、;；|]+/).map(value=>value.trim()).filter(Boolean);
    const recallBindings=parseRecallBindings(String($('qbRecallBindingsInput')?.value||''));
    if(recallKeywords.length){
      draft.clues=Array.isArray(draft.clues)?draft.clues:[];
      const existing=new Map(draft.clues.map(clue=>[String(clue.text),clue])),advanced=draft.clues.filter(clue=>clue.sourceMode!=='quick'&&!recallKeywords.includes(clue.text));
      const quick=recallKeywords.map((keyword,index)=>normalizeClue({...existing.get(keyword),id:existing.get(keyword)?.id||slugify(keyword)||safeId('clue'),text:keyword,type:existing.get(keyword)?.type||'core',clueRole:existing.get(keyword)?.clueRole||'true',recallNodeId:String(recallBindings.get(keyword)||existing.get(keyword)?.recallNodeId||keyword),sourceMode:'quick'},index));
      draft.clues=[...advanced,...quick];
    }
    draft.stemParts=rebuildStemParts(stemText(draft),stemClues(draft.clues));return draft;
  }
  function collectQuestionDraftFromDom(q=currentQuestion(),bank=currentBank(),options={}){
    if(!bank||!q)return null;
    const draft=clone(q);
    draft.title=$('questionTitleInput').value.trim()||(String($('questionStemInput').value||'').replace(/\s+/g,' ').slice(0,36)||'未命名题目');
    draft.teacherNumber=draft.teacherNumber||nextTeacherNumber(bank.subject);draft.type=$('questionTypeInput').value||'single_choice';draft.subject=bank.subject;draft.difficulty=$('questionDifficultyInput').value;
    draft.domain=$('questionDomainInput').value.trim();draft.topic=$('questionTopicInput').value.trim();draft.tags=cleanList($('questionTagsInput').value);draft.analysis=$('questionAnalysisInput').value.trim();
    draft.options=collectOptionsFromDom().map((o,i)=>normalizeOption(o,i,''));
    const correct=document.querySelector('input[name="correctOption"]:checked')?.value||draft.options.find(o=>o.correct)?.id||draft.options[0]?.id||'';
    draft.correctAnswer=correct;draft.options.forEach(o=>{o.correct=o.id===correct});
    const rawStem=$('questionStemInput').value;draft.stemParts=rebuildStemParts(rawStem,stemClues(draft.clues));
    const reasoningSteps=collectReasoningFromDom(q).map(normalizeReasoningStep);draft.reasoningSteps=reasoningSteps;
    const enTitle=$('questionTitleEnInput')?.value.trim()||'',enStem=$('questionStemEnInput')?.value||'',enAnalysis=$('questionAnalysisEnInput')?.value.trim()||'',enOptions=collectEnglishOptionsFromDom();
    const hasEnglish=Boolean(enTitle||enStem.trim()||enAnalysis||enOptions.some(option=>option.text));
    if(hasEnglish)draft.translations={...(draft.translations||{}),en:{title:enTitle,stemParts:[{text:enStem}],options:enOptions,analysis:enAnalysis}};
    else if(draft.translations?.en){draft.translations={...(draft.translations||{})};delete draft.translations.en}
    draft.metadata={...(draft.metadata||{}),principleIds:[...new Set(String($('questionPrincipleIdsInput')?.value||'').split(',').map(value=>value.trim()).filter(Boolean))],translationStatus:hasEnglish?'bilingual':'zh_only'};
    if(options.includePendingSubforms)applyPendingCognitiveSubforms(draft,options.pendingSubforms||{});
    return {draft,rawStem,reasoningSteps};
  }
  async function saveQuestionForm(options={}){
    const bank = currentBank();
    const q = currentQuestion();
    if(!bank || !q) return false;
    if(state.serverCatalogNewerRevision&&!options.allowServerMerge){if(!options.silent)toast('服务器有新版本，请先选择重新载入或合并。');return false}
    const collected=collectQuestionDraftFromDom(q,bank);if(!collected)return false;
    const {draft,rawStem}=collected,previousBanks=clone(state.banks);
    draft.status = {
      contentReady:!!(rawStem.trim() && draft.options.length >= 2 && draft.correctAnswer),
      keywordsReady:draft.clues.length > 0,
      knowledgeReady:!!draft.metadata?.knowledge?.primaryNodeId || draft.concepts.length > 0,
      reasoningReady:draft.reasoningSteps.length > 0,
      published:draft.status && draft.status.published || false
    };
    try{
      const saved=await CatalogEditor.save({...draft,id:q.id,bankId:bank.id,revision:q.revision,creatorId:q.creatorId},{bankId:bank.id,baseRevision:q.revision,creatorId:q.creatorId});
      reloadBanksFromCatalog(bank.id,saved?.id||q.id);
      if(!options.silent){render();CatalogEditor.applyReadonlyState(CatalogEditor.status().readonly);toast('题目已保存到服务器题库。')}
      return true;
    }catch(error){state.banks=previousBanks.map(normalizeBank);if(!options.silent)render();alert('题目保存失败：'+(error.message||error));return false}
  }

  function activeTaxonomyForCurrentBank(){
    const bank=currentBank();if(!bank)return {subject:null,taxonomy:null};
    const subject=window.KGQuestionClassification?.subjectForBank?.(bank.subject)||window.KGLearningContent?.subjectById?.(bank.subject)||window.KGLearningContent?.subjectById?.(String(bank.subject||'').toUpperCase())||null;
    const taxonomy=subject?window.KGLearningContent?.defaultTaxonomyForSubject?.(subject.id):null;
    return {subject,taxonomy};
  }
  function isSelectableKnowledgeNode(node){return !!node&&!['deprecated','disabled','inactive','archived'].includes(String(node.status||'active').toLowerCase())}
  function bulkKnowledgePath(taxonomy,nodeId){return taxonomy&&nodeId?(window.KGLearningContent?.pathForNode?.(taxonomy.id,nodeId)||[]):[]}
  function bulkKnowledgePathLabel(taxonomy,nodeId){return bulkKnowledgePath(taxonomy,nodeId).map(node=>node.title?.zh||node.id).join(' > ')}
  function bulkKnowledgeChildren(taxonomy,parentId){return (taxonomy?.nodes||[]).filter(node=>(node.parentId||null)===(parentId||null)&&isSelectableKnowledgeNode(node)).sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)||String(a.title?.zh||a.id).localeCompare(String(b.title?.zh||b.id),'zh-CN'))}
  function renderBulkKnowledgeDialog(){
    const {subject,taxonomy}=activeTaxonomyForCurrentBank();
    if($('qbBulkKnowledgeSubjectLabel'))$('qbBulkKnowledgeSubjectLabel').textContent=subject?`${subject.code} · ${subject.name?.zh||''}`:'未找到科目';
    if($('qbBulkKnowledgeTaxonomyLabel'))$('qbBulkKnowledgeTaxonomyLabel').textContent=taxonomy?`${taxonomy.name?.zh||taxonomy.id} · ${taxonomy.versionLabel||`v${taxonomy.version}.0`}`:'没有当前知识树';
    if($('qbBulkKnowledgeContext'))$('qbBulkKnowledgeContext').textContent=`将修改 ${selectedQuestions().length} 道题的分类，不复制题目，也不改变题目 ID。`;
    const ids=state.bulkKnowledgeDraftId?bulkKnowledgePath(taxonomy,state.bulkKnowledgeDraftId).map(node=>node.id):[];
    const breadcrumb=$('qbBulkKnowledgeBreadcrumb');
    if(breadcrumb){breadcrumb.innerHTML=ids.length?ids.map((id,index)=>`<button type="button" data-bulk-knowledge-crumb="${escapeHTML(id)}">${escapeHTML(window.KGLearningContent?.nodeById?.(taxonomy.id,id)?.title?.zh||id)}</button>${index<ids.length-1?'<i>›</i>':''}`).join(''):'<span class="qb-knowledge-column-empty">尚未选择路径</span>';breadcrumb.querySelectorAll('[data-bulk-knowledge-crumb]').forEach(button=>button.addEventListener('click',()=>{state.bulkKnowledgeDraftId=button.dataset.bulkKnowledgeCrumb;renderBulkKnowledgeDialog()}))}
    const columns=$('qbBulkKnowledgeColumns');
    if(columns){
      const parents=[null,...ids],html=[];
      parents.forEach((parentId,index)=>{const rows=bulkKnowledgeChildren(taxonomy,parentId);if(!rows.length)return;const activeId=ids[index]||'';html.push(`<section class="qb-knowledge-column"><strong>第 ${index+1} 层</strong>${rows.map(node=>{const hasChildren=bulkKnowledgeChildren(taxonomy,node.id).length>0;return `<button type="button" class="qb-knowledge-node ${activeId===node.id?'active':''} ${state.bulkKnowledgeDraftId===node.id?'selected':''}" data-bulk-knowledge-node="${escapeHTML(node.id)}"><span class="radio"></span><span class="copy"><b>${escapeHTML(node.title?.zh||node.id)}</b><small>${escapeHTML(node.code||`L${node.level}`)}</small></span><span class="arrow">${hasChildren?'›':''}</span></button>`}).join('')}</section>`)});
      columns.innerHTML=html.join('')||'<div class="qb-knowledge-column-empty">当前知识树没有未停用的可选知识点。</div>';
      columns.querySelectorAll('[data-bulk-knowledge-node]').forEach(button=>button.addEventListener('click',()=>{state.bulkKnowledgeDraftId=button.dataset.bulkKnowledgeNode;renderBulkKnowledgeDialog()}));
      requestAnimationFrame(()=>{columns.scrollLeft=columns.scrollWidth});
    }
    const node=state.bulkKnowledgeDraftId&&taxonomy?window.KGLearningContent?.nodeById?.(taxonomy.id,state.bulkKnowledgeDraftId):null;
    if($('qbBulkKnowledgeDraftSelection'))$('qbBulkKnowledgeDraftSelection').textContent=node&&isSelectableKnowledgeNode(node)?bulkKnowledgePathLabel(taxonomy,node.id):'尚未选择知识点';
    if($('qbBulkKnowledgeConfirmBtn'))$('qbBulkKnowledgeConfirmBtn').disabled=!(node&&isSelectableKnowledgeNode(node));
    renderBulkKnowledgeSearch();
  }
  function renderBulkKnowledgeSearch(){
    const input=$('qbBulkKnowledgeSearchInput'),results=$('qbBulkKnowledgeSearchResults'),columns=$('qbBulkKnowledgeColumns');if(!input||!results||!columns)return;
    const {taxonomy}=activeTaxonomyForCurrentBank(),query=String(input.value||'').trim();
    if(!query){results.hidden=true;columns.hidden=false;return}
    const token=query.toLowerCase().replace(/[＞>\/\\|｜]+/g,'>').replace(/[\s　]+/g,'');
    const rows=(taxonomy?.nodes||[]).filter(isSelectableKnowledgeNode).filter(node=>{const aliases=[node.title?.zh,node.title?.en,node.code,...(node.aliases||[]),bulkKnowledgePathLabel(taxonomy,node.id)];return aliases.some(value=>String(value||'').toLowerCase().replace(/[＞>\/\\|｜]+/g,'>').replace(/[\s　]+/g,'').includes(token))}).slice(0,80);
    results.innerHTML=rows.length?rows.map(node=>`<button type="button" data-bulk-knowledge-search="${escapeHTML(node.id)}"><b>${escapeHTML(node.title?.zh||node.id)}</b><small>${escapeHTML(bulkKnowledgePathLabel(taxonomy,node.id))}${node.code?` · ${escapeHTML(node.code)}`:''}</small></button>`).join(''):'<div class="qb-knowledge-column-empty">没有匹配的未停用知识点。</div>';
    results.hidden=false;columns.hidden=true;results.querySelectorAll('[data-bulk-knowledge-search]').forEach(button=>button.addEventListener('click',()=>{state.bulkKnowledgeDraftId=button.dataset.bulkKnowledgeSearch;input.value='';renderBulkKnowledgeDialog()}));
  }
  function openBulkKnowledgeDialog(){
    if(!selectedQuestions().length)return toast('请先选择当前页题目。');
    state.bulkKnowledgeDraftId='';if($('qbBulkKnowledgeSearchInput'))$('qbBulkKnowledgeSearchInput').value='';renderBulkKnowledgeDialog();
    const dialog=$('qbBulkKnowledgeDialog');dialog?.showModal?dialog.showModal():dialog?.setAttribute('open','');
  }
  function classificationHistoryEntry(kind,before,after,source,batchId){return {id:safeId('classification'),kind,source,at:new Date().toISOString(),actor:currentActor(),batchId,before:clone(before),after:clone(after)}}
  function knowledgeAfterForNode(question,nodeId,source,batchId){
    const {subject,taxonomy}=activeTaxonomyForCurrentBank();
    const node=nodeId&&taxonomy?window.KGLearningContent?.nodeById?.(taxonomy.id,nodeId):null;
    if(node&&!isSelectableKnowledgeNode(node))return null;
    return {taxonomyId:taxonomy?.id||'',taxonomyVersion:Number(taxonomy?.version)||1,primaryNodeId:node?.id||null,relatedNodeIds:[],mappingStatus:node?'confirmed':'unmapped',mappingSource:source,pathSnapshot:node?bulkKnowledgePath(taxonomy,node.id).map(item=>item.title?.zh||item.id):[],confirmedAt:node?new Date().toISOString():'',confirmedBy:node?currentActor():null,batchId,subjectId:subject?.id||''};
  }
  function bulkMoveKnowledge(nodeId){
    const questions=selectedQuestions();if(!questions.length)return toast('请先选择当前页题目。');
    const {taxonomy}=activeTaxonomyForCurrentBank();const node=nodeId&&taxonomy?window.KGLearningContent?.nodeById?.(taxonomy.id,nodeId):null;
    if(nodeId&&(!node||!isSelectableKnowledgeNode(node)))return toast('目标知识点不存在或已停用。');
    const batchId=safeId('batch-knowledge'),bank=currentBank();
    questions.forEach(question=>{const before=clone(question.metadata?.knowledge||{}),after=knowledgeAfterForNode(question,nodeId,nodeId?'bulk-move':'bulk-unclassified',batchId);question.metadata={...(question.metadata||{}),knowledge:after,classificationHistory:[...(question.metadata?.classificationHistory||[]),classificationHistoryEntry('knowledge',before,after,nodeId?'bulk-move':'bulk-unclassified',batchId)].slice(-50)};question.status={...(question.status||{}),knowledgeReady:!!after.primaryNodeId};recordQuestionAudit(nodeId?'question.knowledge.bulk_update':'question.unclassified.bulk_move',question,before,after,batchId,nodeId?`批量修改题目主要知识点：${question.title}`:`批量移入待分类：${question.title}`)});
    if(bank)bank.updatedAt=Date.now();saveBanks(state.banks,{silent:true});clearQuestionSelection();$('qbBulkKnowledgeDialog')?.close();render();toast(nodeId?`已批量修改 ${questions.length} 道题的主要知识点。`:`已将 ${questions.length} 道题移入待分类。`);
  }
  function tagPathsFor(tags){
    const groups=window.KGQuestionClassification?.TAG_GROUPS||[];const paths=[];
    groups.forEach(group=>(group.categories||[]).forEach(category=>(category.options||[]).forEach(option=>{if(tags.includes(option))paths.push({groupId:group.id,group:group.label,categoryId:category.id,category:category.label,label:option})})));
    return paths;
  }
  function renderBulkTagDialog(){
    const groups=window.KGQuestionClassification?.TAG_GROUPS||[],host=$('qbBulkTagOptions');
    if(host){host.innerHTML=groups.map(group=>`<section><h3>${escapeHTML(group.label)}</h3>${(group.categories||[]).map(category=>`<h4>${escapeHTML(category.label)}</h4><div class="options">${(category.options||[]).map(option=>`<label><input type="checkbox" data-bulk-tag-option="${escapeHTML(option)}" ${state.bulkTagDraft.has(option)?'checked':''}/><span>${escapeHTML(option)}</span></label>`).join('')}</div>`).join('')}</section>`).join('');host.querySelectorAll('[data-bulk-tag-option]').forEach(input=>input.addEventListener('change',()=>{input.checked?state.bulkTagDraft.add(input.dataset.bulkTagOption):state.bulkTagDraft.delete(input.dataset.bulkTagOption);renderBulkTagChips()}))}
    renderBulkTagChips();
  }
  function renderBulkTagChips(){const host=$('qbBulkTagDraftChips');if(host)host.innerHTML=[...state.bulkTagDraft].map(tag=>`<button type="button" data-bulk-tag-remove="${escapeHTML(tag)}">${escapeHTML(tag)} <b>×</b></button>`).join('')||'<small>尚未选择标签</small>';host?.querySelectorAll('[data-bulk-tag-remove]').forEach(button=>button.addEventListener('click',()=>{state.bulkTagDraft.delete(button.dataset.bulkTagRemove);renderBulkTagDialog()}))}
  function openBulkTagDialog(){if(!selectedQuestions().length)return toast('请先选择当前页题目。');state.bulkTagDraft=new Set();document.querySelector('input[name="qbBulkTagMode"][value="add"]')?.click();renderBulkTagDialog();const dialog=$('qbBulkTagDialog');dialog?.showModal?dialog.showModal():dialog?.setAttribute('open','')}
  function applyBulkTags(){
    const questions=selectedQuestions(),chosen=[...state.bulkTagDraft].map(canonicalTagName).filter(Boolean);if(!questions.length)return toast('请先选择当前页题目。');if(!chosen.length)return toast('请至少选择一个标签。');
    const mode=document.querySelector('input[name="qbBulkTagMode"]:checked')?.value==='remove'?'remove':'add',batchId=safeId('batch-tags'),bank=currentBank();
    questions.forEach(question=>{const before=canonicalTags(question.tags||[]);const after=mode==='remove'?before.filter(tag=>!chosen.includes(tag)):[...new Set([...before,...chosen])];question.tags=after;question.metadata={...(question.metadata||{}),tagPaths:tagPathsFor(after),classificationHistory:[...(question.metadata?.classificationHistory||[]),classificationHistoryEntry('tags',before,after,mode==='remove'?'bulk-remove':'bulk-add',batchId)].slice(-50)};recordQuestionAudit('question.tags.bulk_set',question,before,after,batchId,`${mode==='remove'?'批量移除':'批量增加'}题目标签：${question.title}`, 'success',{mode,tags:chosen})});
    if(bank)bank.updatedAt=Date.now();saveBanks(state.banks,{silent:true});clearQuestionSelection();$('qbBulkTagDialog')?.close();render();toast(`已为 ${questions.length} 道题${mode==='remove'?'移除':'增加'}标签。`);
  }
  function storageJson(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch(error){return null}}
  function directQuestionRefMatch(value,questionId,bankId){
    if(!value||typeof value!=='object')return false;
    const target=String(questionId),qids=[value.questionId,value.sourceQuestionId,value.originalQuestionId].filter(item=>item!=null).map(String);
    const arrayMatch=['questionIds','sourceQuestionIds','originalQuestionIds'].some(key=>Array.isArray(value[key])&&value[key].map(String).includes(target));
    if(!qids.includes(target)&&!arrayMatch)return false;
    const bids=[value.bankId,value.sourceBankId].filter(item=>item!=null).map(String);
    return !bids.length||bids.includes(String(bankId));
  }
  function countQuestionRefs(value,questionId,bankId,seen=new Set()){
    if(value==null||typeof value!=='object'||seen.has(value))return 0;seen.add(value);let count=directQuestionRefMatch(value,questionId,bankId)?1:0;
    if(Array.isArray(value)){value.forEach(item=>{count+=countQuestionRefs(item,questionId,bankId,seen)})}else Object.values(value).forEach(item=>{count+=countQuestionRefs(item,questionId,bankId,seen)});return count;
  }
  function referenceSummaryForQuestion(question,bank=currentBank()){
    const summary={paperRefs:0,courseTaskRefs:0,answerRefs:0,total:0,protected:false};const qid=String(question?.id||''),bid=String(bank?.id||'');if(!qid)return summary;
    try{for(let index=0;index<localStorage.length;index++){const key=String(localStorage.key(index)||'');if(!key||key.startsWith(STORAGE_PREFIX)||key===ADMIN_AUDIT_KEY||key.startsWith(CURRENT_PREFIX)||key.startsWith(PAPER_CURRENT_PREFIX)||key===DEEP_RECALL_KEY)continue;const value=storageJson(key);if(value==null)continue;const matches=countQuestionRefs(value,qid,bid);if(!matches)continue;if(key.startsWith(PAPER_PREFIX)||key===PUBLISHED_PAPERS_KEY||key===PAPER_RELEASE_HISTORY_KEY)summary.paperRefs+=matches;else if(/course|learning_task|assignment|task/i.test(key))summary.courseTaskRefs+=matches;else if(/learning_sessions|learning_events|learning_rounds|answer|score|stat|result|attempt|progress/i.test(key))summary.answerRefs+=matches}}
    catch(error){console.warn('题目引用检查失败',error)}
    summary.total=summary.paperRefs+summary.courseTaskRefs+summary.answerRefs;summary.protected=summary.total>0;return summary;
  }
  function aggregateReferenceSummary(ids){
    const bank=currentBank(),rows=ids.map(id=>bank?.questions.find(question=>question.id===id)).filter(Boolean).map(question=>({question,refs:referenceSummaryForQuestion(question,bank)}));
    return {rows,paperQuestions:rows.filter(row=>row.refs.paperRefs>0).length,courseQuestions:rows.filter(row=>row.refs.courseTaskRefs>0).length,answerQuestions:rows.filter(row=>row.refs.answerRefs>0).length,protectedQuestions:rows.filter(row=>row.refs.protected).length};
  }
  function openSafeDeleteDialog(ids){
    const bank=currentBank(),valid=[...new Set(ids.map(String))].filter(id=>{const question=bank?.questions.find(item=>item.id===id);return question&&!isQuestionDeleted(question)});if(!valid.length)return toast('没有可删除的正常题目。');
    state.pendingSafeDeleteIds=valid;const summary=aggregateReferenceSummary(valid);if($('qbSafeDeleteTitle'))$('qbSafeDeleteTitle').textContent=valid.length===1?'删除题目':`即将删除 ${valid.length} 道题`;
    if($('qbSafeDeleteSummary'))$('qbSafeDeleteSummary').innerHTML=`<strong>${valid.length===1?'安全删除后仍可恢复':`即将删除 ${valid.length} 道题`}</strong><div class="row"><span>已有试卷引用</span><b>${summary.paperQuestions} 道</b></div><div class="row"><span>已有课程或任务引用</span><b>${summary.courseQuestions} 道</b></div><div class="row"><span>存在答题、成绩或统计记录</span><b>${summary.answerQuestions} 道</b></div>`;
    const dialog=$('qbSafeDeleteDialog');dialog?.showModal?dialog.showModal():dialog?.setAttribute('open','');
  }
  async function persistCatalogQuestionChanges(questions,selectedBankId,selectedQuestionId){
    for(const question of questions){const lockState=await CatalogEditor.open(question);if(lockState.readonly)throw new Error('题目正在由其他人编辑');await CatalogEditor.save(question,{bankId:question.bankId||selectedBankId,baseRevision:question.revision,creatorId:question.creatorId})}
    reloadBanksFromCatalog(selectedBankId,selectedQuestionId);if(currentQuestion())await CatalogEditor.open(currentQuestion());else await CatalogEditor.release();
  }
  async function confirmSafeDelete(){
    const bank=currentBank(),ids=state.pendingSafeDeleteIds.slice(),batchId=safeId('batch-delete'),now=new Date().toISOString(),actor=currentActor();let changed=0;
    ids.forEach(id=>{const question=bank?.questions.find(item=>item.id===id);if(!question||isQuestionDeleted(question))return;if(isDemoQuestion(question)||isDemoBank(bank))suppressDemoExample();const before=clone(question.lifecycle||normalizeQuestionLifecycle(question));const after={status:'deleted',deletedAt:now,deletedBy:actor,deletedBatchId:batchId,restoredAt:'',restoredBy:null};question.lifecycle=after;recordQuestionAudit(ids.length>1?'question.safe_delete.bulk':'question.safe_delete',question,before,after,batchId,`安全删除题目：${question.title}`,'success',{references:referenceSummaryForQuestion(question,bank)});changed+=1});
    if(bank&&changed)bank.updatedAt=Date.now();try{await persistCatalogQuestionChanges(bank.questions.filter(question=>ids.includes(question.id)),bank.id,state.selectedQuestionId)}catch(error){alert('删除保存失败：'+(error.message||error));return}state.pendingSafeDeleteIds=[];clearQuestionSelection();state.selectedQuestionId=currentBank()?.questions.find(question=>questionMatchesLifecycle(question))?.id||'';$('qbSafeDeleteDialog')?.close();render();toast(`已安全删除 ${changed} 道题，可在“已删除题目”中恢复。`);
  }
  async function restoreQuestionIds(ids){
    const bank=currentBank(),batchId=safeId('batch-restore'),actor=currentActor(),now=new Date().toISOString();let changed=0;
    [...new Set(ids.map(String))].forEach(id=>{const question=bank?.questions.find(item=>item.id===id);if(!question||!isQuestionDeleted(question))return;const before=clone(question.lifecycle),after={...normalizeQuestionLifecycle(question),status:'active',deletedAt:'',deletedBy:null,deletedBatchId:'',restoredAt:now,restoredBy:actor};question.lifecycle=after;recordQuestionAudit(ids.length>1?'question.restore.bulk':'question.restore',question,before,after,batchId,`恢复题目：${question.title}`);changed+=1});
    if(bank&&changed)bank.updatedAt=Date.now();try{await persistCatalogQuestionChanges(bank.questions.filter(question=>ids.includes(question.id)),bank.id,state.selectedQuestionId)}catch(error){alert('恢复保存失败：'+(error.message||error));return}clearQuestionSelection();state.selectedQuestionId=currentBank()?.questions.find(question=>questionMatchesLifecycle(question))?.id||'';render();toast(`已恢复 ${changed} 道题。`);
  }
  function openPermanentDeleteDialog(ids){
    const bank=currentBank(),valid=[...new Set(ids.map(String))].filter(id=>{const question=bank?.questions.find(item=>item.id===id);return question&&isQuestionDeleted(question)});if(!valid.length)return toast('请先选择已删除题目。');
    state.pendingPermanentDeleteIds=valid;const summary=aggregateReferenceSummary(valid),deletable=valid.length-summary.protectedQuestions;
    if($('qbPermanentDeleteSummary'))$('qbPermanentDeleteSummary').innerHTML=`<strong>逐题引用检查结果</strong><div class="row"><span>选中题目</span><b>${valid.length} 道</b></div><div class="row"><span>可永久删除</span><b>${deletable} 道</b></div><div class="row protected"><span>受引用保护，不会删除</span><b>${summary.protectedQuestions} 道</b></div><div class="row"><span>试卷引用</span><b>${summary.paperQuestions} 道</b></div><div class="row"><span>课程或任务引用</span><b>${summary.courseQuestions} 道</b></div><div class="row"><span>答题、成绩或统计记录</span><b>${summary.answerQuestions} 道</b></div>`;
    if($('qbPermanentDeleteAcknowledge'))$('qbPermanentDeleteAcknowledge').checked=false;if($('qbPermanentDeleteConfirmBtn'))$('qbPermanentDeleteConfirmBtn').disabled=true;
    const dialog=$('qbPermanentDeleteDialog');dialog?.showModal?dialog.showModal():dialog?.setAttribute('open','');
  }
  async function confirmPermanentDelete(){
    const bank=currentBank(),ids=state.pendingPermanentDeleteIds.slice(),batchId=safeId('batch-permanent-delete'),deletedIds=[];let deleted=0,protectedCount=0;
    ids.forEach(id=>{const index=bank?.questions.findIndex(item=>item.id===id)??-1;if(index<0)return;const question=bank.questions[index];if(!isQuestionDeleted(question))return;const refs=referenceSummaryForQuestion(question,bank);if(refs.protected){recordQuestionAudit('question.permanent_delete',question,question.lifecycle,null,batchId,`永久删除受保护：${question.title}`,'failed',{references:refs,reason:'business_reference_protected'});protectedCount+=1;return}recordQuestionAudit('question.permanent_delete',question,question.lifecycle,null,batchId,`永久删除题目：${question.title}`,'success',{references:refs});bank.questions.splice(index,1);deleted+=1;deletedIds.push(question.id)});
    try{for(const id of deletedIds){const question=Catalog.question(id);if(!question)continue;const lockState=await CatalogEditor.open(question);if(lockState.readonly)throw new Error('题目正在由其他人编辑');await Catalog.deleteQuestion(id);await CatalogEditor.release({forgetOnly:true})}}catch(error){reloadBanksFromCatalog(bank.id,'');render();alert('永久删除失败：'+(error.message||error));return}reloadBanksFromCatalog(bank.id,'');state.pendingPermanentDeleteIds=[];clearQuestionSelection();state.selectedQuestionId=currentBank()?.questions.find(question=>questionMatchesLifecycle(question))?.id||'';$('qbPermanentDeleteDialog')?.close();render();toast(`已永久删除 ${deleted} 道题${protectedCount?`，${protectedCount} 道受业务引用保护未删除`:''}。`);
  }

  async function addBank(subject='PMP'){
    const subjectId = subject === 'ALL' ? 'PMP' : subject;
    const meta = subjectMeta(subjectId);
    const bank = normalizeBank({
      id:safeId('bank'),
      name:`${meta.name} 新题库`,
      subject:subjectId,
      description:`${meta.label} 题库。可维护题目、关键词、知识点和推理逻辑。`,
      version:'1.0',
      visibility:'private',
      questions:[]
    });
    try{
      const created=await Catalog.saveBank(bank);reloadBanksFromCatalog(created?.id||'','');
      state.cluePage=1;state.conceptPage=1;state.questionPage=1;state.subjectFilter=subjectId;state.activeSidebarTab='banks';state.activeLayoutNav='banks';
      const filter=$('qbSubjectFilter');if(filter)filter.value=subjectId;render();toast('已创建题库。');return created;
    }catch(error){alert('题库创建失败：'+(error.message||error));return null}
  }
  async function addQuestion(){
    const bank=currentBank();if(!bank){await addBank('PMP');return}
    const q=emptyQuestion(bank.subject);q.lifecycle=normalizeQuestionLifecycle({});q.teacherNumber=nextTeacherNumber(bank.subject);
    try{const created=await Catalog.saveQuestion(q,{bankId:bank.id});reloadBanksFromCatalog(bank.id,created?.id||'');state.activeSidebarTab='questions';state.activeLayoutNav='questions';if(CatalogEditor)await CatalogEditor.open(currentQuestion());render();CatalogEditor?.applyReadonlyState(CatalogEditor.status().readonly);toast('已创建题目并进入服务器题库。');return created}
    catch(error){alert('题目创建失败：'+(error.message||error));return null}
  }
  async function cloneQuestion(){
    const bank=currentBank(),q=currentQuestion();if(!bank||!q)return;
    const copied=normalizeQuestion({...clone(q),id:safeId('q'),teacherNumber:nextTeacherNumber(bank.subject),title:q.title+'（副本）',lifecycle:{status:'active'}});
    delete copied.revision;delete copied.contentHash;delete copied.createdAt;delete copied.updatedAt;
    try{const created=await Catalog.saveQuestion(copied,{bankId:bank.id});reloadBanksFromCatalog(bank.id,created?.id||'');if(CatalogEditor)await CatalogEditor.open(currentQuestion());render();CatalogEditor?.applyReadonlyState(CatalogEditor.status().readonly);toast('已复制为服务器题库中的新题。');return created}
    catch(error){alert('复制题目失败：'+(error.message||error));return null}
  }
  function deleteQuestion(){
    const q=currentQuestion();if(!q)return;openSafeDeleteDialog([q.id]);
  }
  function isDemoBank(bank){
    return !!bank && (bank.id === DEMO_BANK_ID || bank.visibility === 'public-demo' || (bank.subject === 'PMP' && /示例|演示|demo/i.test(bank.name || '')));
  }
  function isDemoQuestion(question){
    return !!question && String(question.id || '') === DEMO_QUESTION_ID;
  }
  async function deleteCurrentBank(){
    const bank = currentBank();
    if(!bank) return;
    await deleteBankById(bank.id);
  }
  async function deleteBankById(bankId){
    const bank = state.banks.find(b => b.id === bankId);
    if(!bank) return;
    const referenced=(bank.questions||[]).map(question=>({question,refs:questionReferenceSummary(question,bank)})).filter(row=>row.refs.protected);
    if(referenced.length){
      const paperCount=referenced.filter(row=>row.refs.paperRefs>0).length;
      const courseCount=referenced.filter(row=>row.refs.courseTaskRefs>0).length;
      const answerCount=referenced.filter(row=>row.refs.answerRefs>0).length;
      alert(`该题库暂不能删除。

共有 ${referenced.length} 道题存在业务引用：
试卷引用 ${paperCount} 道
课程或任务引用 ${courseCount} 道
答题、成绩或统计引用 ${answerCount} 道

请保留题库，或先在题目层使用安全删除。`);
      return;
    }
    const message = `确定永久删除题库“${bank.name}”吗？

将物理删除该题库下 ${bank.questions.length} 道无业务引用题目。${bank.visibility==='published'?'该题库也会从学员的自由练习列表中撤下。':'此操作只影响当前教师题库。'}

此操作不可恢复。`;
    if(!confirm(message)) return;
    try{await Catalog.deleteBank(bank.id)}catch(error){alert('题库删除失败：'+(error.message||error));return false}
    if(isDemoBank(bank) || (bank.questions || []).some(isDemoQuestion)) suppressDemoExample();
    const filteredBefore = filteredBanks();
    const filteredIndex = filteredBefore.findIndex(b => b.id === bank.id);
    const index = state.banks.findIndex(b => b.id === bank.id);
    if(index >= 0) state.banks.splice(index, 1);
    const filteredAfter = filteredBanks();
    const fallbackIndex = Math.max(0, Math.min(filteredIndex, filteredAfter.length - 1));
    const nextBank = filteredAfter[fallbackIndex] || state.banks[Math.max(0, index - 1)] || state.banks[0] || null;
    state.selectedBankId = nextBank ? nextBank.id : '';
    state.selectedQuestionId = nextBank && nextBank.questions[0] ? nextBank.questions[0].id : '';
    state.cluePage = 1;
    state.conceptPage = 1;
    state.bankPage = Math.max(1, Math.min(state.bankPage || 1, Math.ceil(filteredAfter.length / BANK_PAGE_SIZE) || 1));
    state.questionPage = 1;
    state.editingClueId = '';
    state.editingConceptId = '';
    saveBanks();
    render();
    toast('已删除题库。');
  }

  async function addOption(){
    if(!currentQuestion()) return;
    if(!await saveQuestionForm({silent:true})) return;
    const q = currentQuestion();
    if(!q) return;
    q.options = Array.isArray(q.options) ? q.options : [];
    const nextId = nextOptionId(q.options);
    q.options.push({id:nextId,text:'',trap:'',correct:false});
    if(!q.correctAnswer && q.options.length) q.correctAnswer = q.options[0].id;
    saveBanks(state.banks, {silent:true});
    render();
    setTimeout(() => {
      const rows = document.querySelectorAll('#qbOptionsEditor .qb-option-row');
      const row = rows[rows.length - 1];
      const input = row && row.querySelector('.option-text');
      if(input) input.focus();
    }, 0);
    toast('已添加选项。');
  }
  function updateClueOptionSelect(selectedValue=''){
    const select = $('clueOptionIdInput');
    if(!select) return;
    const q = currentQuestion();
    const domOptions = collectOptionsFromDom();
    const options = domOptions.length ? domOptions : (q && q.options || []);
    select.innerHTML = (options || []).map((o, i) => {
      const id = String(o.id || String.fromCharCode(65 + i));
      const text = String(o.text || '').slice(0, 28);
      return `<option value="${escapeHTML(id)}">${escapeHTML(id)}${text ? '：' + escapeHTML(text) : ''}</option>`;
    }).join('') || '<option value="">暂无选项</option>';
    if(selectedValue && Array.from(select.options).some(o => o.value === selectedValue)) select.value = selectedValue;
  }
  function updateClueSourceWrap(){
    const source = $('clueSourceInput')?.value || 'stem';
    const wrap = $('clueOptionSourceWrap');
    if(wrap) wrap.hidden = source !== 'option';
    updateClueOptionSelect($('clueOptionIdInput')?.value || '');
  }
  function selectedTextFromTarget(target){
    if(!target || typeof target.selectionStart !== 'number' || typeof target.selectionEnd !== 'number') return null;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    if(end <= start) return null;
    const text = String(target.value || '').slice(start, end).trim();
    if(!text) return null;
    if(target.id === 'questionStemInput'){
      return {text, sourceType:'stem', sourceOptionId:'', target};
    }
    if(target.classList && target.classList.contains('option-text')){
      const row = target.closest('.qb-option-row');
      const optionId = row?.querySelector('.option-id')?.value.trim() || row?.dataset.optionId || '';
      return {text, sourceType:'option', sourceOptionId:optionId, target};
    }
    return null;
  }
  function selectionSourceLabel(selection){
    return selection && selection.sourceType === 'option' ? `选项 ${selection.sourceOptionId || '?'}` : '题干';
  }
  function fillClueFormFromSelection(selection){
    if(!selection) return;
    $('clueTextInput').value = selection.text;
    $('clueSourceInput').value = selection.sourceType === 'option' ? 'option' : 'stem';
    updateClueOptionSelect(selection.sourceOptionId || '');
    if(selection.sourceType === 'option') $('clueOptionIdInput').value = selection.sourceOptionId || $('clueOptionIdInput').value;
    updateClueSourceWrap();
    $('clueExplainInput').focus();
  }
  function resetClueForm(){
    state.editingClueId = '';
    state.catalogPendingClueTouched=false;
    if(state.serverCatalogLocalDraft?.pendingSubforms){
      delete state.serverCatalogLocalDraft.pendingSubforms.clueId;
      state.serverCatalogLocalDraft.pendingSubforms.clueTouched=false;
      state.serverCatalogLocalDraft.pendingSubforms.incompleteReason='';
    }
    $('clueTextInput').value = '';
    $('clueTypeInput').value = 'core';
    $('clueRoleInput').value = 'true';
    $('clueSourceInput').value = 'stem';
    $('clueConceptIdsInput').value = '';
    $('clueExplainInput').value = '';
    updateClueSourceWrap();
    $('qbAddClueBtn').textContent = '添加关键词';
    $('qbCancelClueEditBtn').hidden = true;
  }
  function addSelectedKeyword(){
    const selection = selectedTextFromTarget(document.activeElement) || state.pendingKeywordSelection || selectedTextFromTarget($('questionStemInput'));
    if(!selection){
      toast('请先在题干或选项中选中一段关键词。');
      return;
    }
    fillClueFormFromSelection(selection);
    toast('已带入选中文本，可补充类型和解释后保存。');
  }
  async function editClue(clueId){
    if(!await saveQuestionForm({silent:true})) return;
    const q = currentQuestion();
    const clue = q && q.clues.find(c => c.id === clueId);
    if(!clue) return;
    state.editingClueId = clue.id;
    setAnnotationTab('clues');
    $('clueTextInput').value = clue.text || '';
    $('clueTypeInput').value = clue.type || 'core';
    $('clueRoleInput').value = clue.clueRole || 'true';
    $('clueSourceInput').value = clue.sourceType === 'option' ? 'option' : 'stem';
    updateClueOptionSelect(clue.sourceOptionId || '');
    if(clue.sourceType === 'option') $('clueOptionIdInput').value = clue.sourceOptionId || $('clueOptionIdInput').value;
    $('clueConceptIdsInput').value = (clue.conceptIds || []).join(',');
    $('clueExplainInput').value = clue.explain || '';
    updateClueSourceWrap();
    $('qbAddClueBtn').textContent = '保存关键词修改';
    $('qbCancelClueEditBtn').hidden = false;
    $('clueTextInput').focus();
    $('clueTextInput').scrollIntoView({behavior:'smooth', block:'center'});
    toast('正在编辑关键词。');
  }
  async function addClue(){
    if(!currentQuestion()) return;
    if(!await saveQuestionForm({silent:true})) return;
    const q = currentQuestion();
    if(!q) return;
    const text = $('clueTextInput').value.trim();
    if(!text){
      toast('请填写关键词。');
      return;
    }
    q.clues = Array.isArray(q.clues) ? q.clues : [];
    const isEditing = !!state.editingClueId;
    const sourceType = $('clueSourceInput').value === 'option' ? 'option' : 'stem';
    const sourceOptionId = sourceType === 'option' ? ($('clueOptionIdInput').value || '') : '';
    const clue = normalizeClue({
      id:isEditing ? state.editingClueId : (slugify(text) || safeId('clue')),
      text,
      type:$('clueTypeInput').value,
      clueRole:$('clueRoleInput').value,
      sourceType,
      sourceOptionId,
      conceptIds:cleanList($('clueConceptIdsInput').value),
      explain:$('clueExplainInput').value.trim()
    }, q.clues.length);
    const duplicate = q.clues.find(c => c.id !== state.editingClueId && (c.id === clue.id || (c.text === clue.text && c.sourceType === clue.sourceType && c.sourceOptionId === clue.sourceOptionId)));
    if(duplicate && !isEditing){
      clue.id = clue.id + '-' + (q.clues.length + 1);
    }else if(duplicate && isEditing){
      toast('已有相同来源的同名关键词，请调整后再保存。');
      return;
    }
    if(isEditing){
      const index = q.clues.findIndex(c => c.id === state.editingClueId);
      if(index >= 0) q.clues[index] = clue;
      else q.clues.push(clue);
    }else{
      q.clues.push(clue);
    }
    q.stemParts = rebuildStemParts($('questionStemInput').value, stemClues(q.clues));
    state.cluePage = isEditing
      ? Math.max(1, Math.min(state.cluePage || 1, Math.ceil(q.clues.length / COGNITIVE_PAGE_SIZE) || 1))
      : Math.max(1, Math.ceil(q.clues.length / COGNITIVE_PAGE_SIZE));
    resetClueForm();
    saveBanks(state.banks, {silent:true});
    render();
    toast(isEditing ? '已保存关键词修改。' : '已添加关键词。');
  }
  function resetConceptForm(){
    state.editingConceptId = '';
    state.catalogPendingConceptTouched=false;
    if(state.serverCatalogLocalDraft?.pendingSubforms){
      delete state.serverCatalogLocalDraft.pendingSubforms.conceptId;
      delete state.serverCatalogLocalDraft.pendingSubforms.conceptAppliedId;
      state.serverCatalogLocalDraft.pendingSubforms.conceptTouched=false;
      state.serverCatalogLocalDraft.pendingSubforms.incompleteReason='';
    }
    ['conceptIdInput','conceptTitleInput','conceptCategoryInput','conceptKeywordsInput','conceptSummaryInput','conceptNotesInput','conceptRuleInput'].forEach(id => $(id).value = '');
    $('conceptLevelInput').value = '基础';
    $('conceptColorInput').value = '#7c3aed';
    $('qbAddConceptBtn').textContent = '添加知识点';
    $('qbCancelConceptEditBtn').hidden = true;
  }
  async function editConcept(conceptId){
    if(!await saveQuestionForm({silent:true})) return;
    const q = currentQuestion();
    const concept = q && q.concepts.find(c => c.id === conceptId);
    if(!concept) return;
    state.editingConceptId = concept.id;
    setAnnotationTab('concepts');
    $('conceptIdInput').value = concept.id || '';
    $('conceptTitleInput').value = concept.title || '';
    $('conceptCategoryInput').value = concept.category || '';
    $('conceptLevelInput').value = concept.level || '重点';
    $('conceptKeywordsInput').value = concept.keywords || '';
    $('conceptColorInput').value = concept.color || '#7c3aed';
    $('conceptSummaryInput').value = concept.summary || '';
    $('conceptNotesInput').value = concept.notes || '';
    $('conceptRuleInput').value = concept.rule || '';
    $('qbAddConceptBtn').textContent = '保存知识点修改';
    $('qbCancelConceptEditBtn').hidden = false;
    $('conceptTitleInput').focus();
    $('conceptTitleInput').scrollIntoView({behavior:'smooth', block:'center'});
    toast('正在编辑知识点。');
  }
  async function addConcept(){
    if(!currentQuestion()) return;
    if(!await saveQuestionForm({silent:true})) return;
    const q = currentQuestion();
    if(!q) return;
    const title = $('conceptTitleInput').value.trim();
    if(!title){
      toast('请填写知识点名称。');
      return;
    }
    q.concepts = Array.isArray(q.concepts) ? q.concepts : [];
    const isEditing = !!state.editingConceptId;
    let id = $('conceptIdInput').value.trim() || slugify(title) || safeId('concept');
    const duplicate = q.concepts.find(c => c.id !== state.editingConceptId && c.id === id);
    if(duplicate && !isEditing) id = id + '-' + (q.concepts.length + 1);
    else if(duplicate && isEditing){
      toast('已有相同 ID 的知识点，请调整后再保存。');
      return;
    }
    const concept = normalizeConcept({
      id,
      title,
      category:$('conceptCategoryInput').value.trim(),
      level:$('conceptLevelInput').value,
      keywords:$('conceptKeywordsInput').value.trim(),
      color:$('conceptColorInput').value || '#7c3aed',
      summary:$('conceptSummaryInput').value.trim(),
      notes:$('conceptNotesInput').value.trim(),
      rule:$('conceptRuleInput').value.trim()
    }, q.concepts.length);
    if(isEditing){
      const index = q.concepts.findIndex(c => c.id === state.editingConceptId);
      if(index >= 0) q.concepts[index] = concept;
      else q.concepts.push(concept);
    }else{
      q.concepts.push(concept);
    }
    state.conceptPage = isEditing
      ? Math.max(1, Math.min(state.conceptPage || 1, Math.ceil(q.concepts.length / COGNITIVE_PAGE_SIZE) || 1))
      : Math.max(1, Math.ceil(q.concepts.length / COGNITIVE_PAGE_SIZE));
    resetConceptForm();
    saveBanks(state.banks, {silent:true});
    render();
    toast(isEditing ? '已保存知识点修改。' : '已添加知识点。');
  }

  async function addReasoningStep(){
    setAnnotationTab('reasoning');
    if(!currentQuestion()) return;
    if(!await saveQuestionForm({silent:true})) return;
    const q = currentQuestion();
    if(!q) return;
    q.reasoningSteps = Array.isArray(q.reasoningSteps) ? q.reasoningSteps : [];
    q.reasoningSteps.push(normalizeReasoningStep({
      id:safeId('rs'),
      title:'推理步骤 ' + (q.reasoningSteps.length + 1),
      content:'',
      relatedKeywords:[],
      relatedKnowledgePoints:[],
      recallQuestion:''
    }, q.reasoningSteps.length));
    saveBanks(state.banks, {silent:true});
    render();
    toast('已添加推理步骤。');
  }

  function initSelectionKeywordTools(){
    const mark = $('qbSelectionMark');
    const panel = $('qbFloatingKeywordPanel');
    const closeBtn = $('floatingKeywordCloseBtn');
    const saveBtn = $('floatingKeywordSaveBtn');
    if(mark){
      mark.addEventListener('click', () => openFloatingKeywordPanel());
    }
    if(closeBtn) closeBtn.addEventListener('click', hideFloatingKeywordPanel);
    if(saveBtn) saveBtn.addEventListener('click', saveFloatingKeyword);

    const detect = e => {
      const target = e.target;
      if(panel && (panel.contains(target) || mark.contains(target))) return;
      setTimeout(() => {
        const selection = selectedTextFromTarget(target) || selectedTextFromTarget(document.activeElement);
        if(selection) showSelectionMark(selection);
      }, 0);
    };
    document.addEventListener('mouseup', detect);
    document.addEventListener('keyup', e => {
      if(e.key && ['Shift','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)) detect(e);
    });
    document.addEventListener('selectionchange', () => {
      const active = document.activeElement;
      if(active && (active.id === 'questionStemInput' || active.classList?.contains('option-text'))){
        const selection = selectedTextFromTarget(active);
        if(selection) showSelectionMark(selection);
      }
    });
    document.addEventListener('mousedown', e => {
      if(mark && mark.contains(e.target)) return;
      if(panel && panel.contains(e.target)) return;
      if(e.target && (e.target.id === 'questionStemInput' || e.target.classList?.contains('option-text'))) return;
      hideSelectionMark();
      hideFloatingKeywordPanel();
    });
  }
  function showSelectionMark(selection){
    const mark = $('qbSelectionMark');
    if(!mark || !selection || !selection.target) return;
    state.pendingKeywordSelection = selection;
    const rect = selection.target.getBoundingClientRect();
    const left = Math.max(12, Math.min(window.innerWidth - 132, rect.right - 132));
    const top = rect.top > 56 ? rect.top - 42 : Math.min(window.innerHeight - 44, rect.bottom + 8);
    mark.style.left = left + 'px';
    mark.style.top = top + 'px';
    mark.hidden = false;
  }
  function hideSelectionMark(){
    const mark = $('qbSelectionMark');
    if(mark) mark.hidden = true;
  }
  function positionFloatingPanel(anchorRect){
    const panel = $('qbFloatingKeywordPanel');
    if(!panel || !anchorRect) return;
    const width = Math.min(360, window.innerWidth - 28);
    const left = Math.max(14, Math.min(window.innerWidth - width - 14, anchorRect.right - width));
    const topCandidate = anchorRect.bottom + 10;
    const top = topCandidate + 360 > window.innerHeight ? Math.max(14, anchorRect.top - 372) : topCandidate;
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }
  function openFloatingKeywordPanel(){
    const selection = state.pendingKeywordSelection;
    if(!selection){
      toast('请先在题干或选项中选中文本。');
      return;
    }
    const panel = $('qbFloatingKeywordPanel');
    if(!panel) return;
    $('floatingClueTextInput').value = selection.text || '';
    $('floatingClueTypeInput').value = selection.sourceType === 'option' ? 'trap' : 'core';
    $('floatingClueRoleInput').value = selection.sourceType === 'option' ? 'decoy' : 'true';
    $('floatingClueConceptIdsInput').value = '';
    $('floatingClueExplainInput').value = '';
    $('floatingClueSourceLabel').textContent = '来源：' + selectionSourceLabel(selection);
    const mark = $('qbSelectionMark');
    positionFloatingPanel((mark && !mark.hidden ? mark : selection.target).getBoundingClientRect());
    panel.hidden = false;
    hideSelectionMark();
    $('floatingClueExplainInput').focus();
  }
  function hideFloatingKeywordPanel(){
    const panel = $('qbFloatingKeywordPanel');
    if(panel) panel.hidden = true;
    state.catalogPendingFloatingClueTouched=false;
    if(state.serverCatalogLocalDraft?.pendingSubforms){
      delete state.serverCatalogLocalDraft.pendingSubforms.floatingClueId;
      state.serverCatalogLocalDraft.pendingSubforms.floatingClueTouched=false;
      state.serverCatalogLocalDraft.pendingSubforms.incompleteReason='';
    }
  }
  async function saveFloatingKeyword(){
    const selection = state.pendingKeywordSelection;
    if(!selection){
      toast('没有可保存的选中文本。');
      return;
    }
    if(!await saveQuestionForm({silent:true})) return;
    const q = currentQuestion();
    if(!q) return;
    const text = $('floatingClueTextInput').value.trim();
    if(!text){
      toast('关键词不能为空。');
      return;
    }
    q.clues = Array.isArray(q.clues) ? q.clues : [];
    const clue = normalizeClue({
      id:slugify(text) || safeId('clue'),
      text,
      type:$('floatingClueTypeInput').value,
      clueRole:$('floatingClueRoleInput').value,
      sourceType:selection.sourceType === 'option' ? 'option' : 'stem',
      sourceOptionId:selection.sourceType === 'option' ? selection.sourceOptionId : '',
      conceptIds:cleanList($('floatingClueConceptIdsInput').value),
      explain:$('floatingClueExplainInput').value.trim()
    }, q.clues.length);
    const duplicate = q.clues.find(c => c.text === clue.text && c.sourceType === clue.sourceType && c.sourceOptionId === clue.sourceOptionId);
    if(duplicate){
      toast('该来源中已有相同关键词。');
      return;
    }
    if(q.clues.some(c => c.id === clue.id)) clue.id = clue.id + '-' + (q.clues.length + 1);
    q.clues.push(clue);
    q.stemParts = rebuildStemParts($('questionStemInput').value, stemClues(q.clues));
    state.cluePage = Math.max(1, Math.ceil(q.clues.length / COGNITIVE_PAGE_SIZE));
    saveBanks(state.banks, {silent:true});
    hideFloatingKeywordPanel();
    state.pendingKeywordSelection = null;
    render();
    toast('已保存选中文本为关键词。');
  }

  async function setCurrentTrainingQuestion(){
    if(!await saveQuestionForm({silent:true})) return;
    const bank = currentBank();
    const q = currentQuestion();
    if(!bank || !q) return;
    if(isQuestionDeleted(q))return toast('已删除题目不能设为新的训练题。');
    const index = bank.questions.findIndex(item => item.id === q.id);
    try{
      localStorage.setItem(currentKey(), JSON.stringify({bankId:bank.id, index:Math.max(0,index)}));
      toast('已设为当前训练题。回到首页打开“考题训练”即可使用。');
    }catch(e){
      alert('设置失败：' + (e.message || e));
    }
  }
  async function previewDeepRecall(){
    if(!await saveQuestionForm({silent:true})) return;
    const bank = currentBank();
    const q = currentQuestion();
    if(!bank || !q) return;
    try{
      const payloadQuestion=clone(q);
      payloadQuestion.sourceBankId=bank?.id || '';
      payloadQuestion.sourceQuestionId=q.id || '';
      payloadQuestion.subject=payloadQuestion.subject||bank.subject||'PMP';
      localStorage.setItem(DEEP_RECALL_KEY, JSON.stringify({question:payloadQuestion, savedAt:Date.now(), source:'question-bank-admin', sourceBankId:bank?.id || '', sourceQuestionId:q.id || '', userId:window.KGAuthCore?.currentUsername?.()||localStorage.getItem(AUTH_SESSION_KEY)||'guest'}));
    }catch(e){}
    window.open('knowledge-recall.html?bankId=' + encodeURIComponent(bank.id||'') + '&questionId=' + encodeURIComponent(q.id || 'current'), '_blank');
  }
  async function exportCurrentBank(){
    await saveQuestionForm({silent:true});
    const bank = currentBank();
    if(!bank) return;
    downloadJson((bank.name || '题库') + '.json', bank);
  }
  async function exportBankById(bankId){
    await saveQuestionForm({silent:true});
    const bank = state.banks.find(b => b.id === bankId);
    if(!bank) return;
    downloadJson((bank.name || '题库') + '.json', bank);
  }
  async function exportAllBanks(){
    await saveQuestionForm({silent:true});
    const payload = {
      id:'all-project-management-question-banks',
      name:'全部项目管理类题库',
      exportedAt:new Date().toISOString(),
      scope:scopeLabel(),
      banks:state.banks,
      papers:state.papers
    };
    downloadJson('全部项目管理类题库.json', payload);
  }
  function downloadTemplate(){
    const template = normalizeBank({
      id:'bank-template-project-management',
      name:'项目管理类题库模板',
      subject:'PMP',
      description:'可复制后修改 subject 为 PMP / CSPM / P2 / ACP / NPDP / PgMP 等。',
      version:'1.0',
      visibility:'template',
      questions:[demoQuestion()]
    });
    downloadJson('项目管理类题库认知标注模板.json', template);
  }
  function importJson(file){
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const raw = String(reader.result || '').replace(/^\ufeff/,'');
        const data = JSON.parse(raw);
        const incoming = Array.isArray(data) ? data.map(normalizeBank) : (Array.isArray(data.banks) ? data.banks.map(normalizeBank) : [normalizeBank(data)]);
        incoming.forEach(bank => {
          if(state.banks.some(b => b.id === bank.id)) bank.id = bank.id + '-' + Date.now().toString(36);
          state.banks.push(bank);
        });
        if(Array.isArray(data.papers)){
          data.papers.map(normalizePaper).forEach(paper => {
            if(state.papers.some(p => p.id === paper.id)) paper.id = paper.id + '-' + Date.now().toString(36);
            state.papers.push(paper);
          });
          savePapers(state.papers, {silent:true});
        }
        const last = incoming[incoming.length - 1];
        state.selectedBankId = last.id;
        state.selectedQuestionId = last.questions[0]?.id || '';
        state.cluePage = 1;
        state.conceptPage = 1;
        state.questionPage = 1;
        saveBanks();
        render();
        toast(`已导入 ${incoming.length} 个题库${Array.isArray(data.papers) ? '，并导入 ' + data.papers.length + ' 套试卷' : ''}。`);
      }catch(e){
        alert('导入失败：' + (e.message || e));
      }finally{
        $('qbImportFile').value = '';
      }
    };
    reader.readAsText(file, 'utf-8');
  }
  function downloadJson(filename, obj){
    const blob = new Blob([JSON.stringify(obj, null, 2)], {type:'application/json;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 120);
  }
  function toast(message){
    const el = $('qbToast');
    if(!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function clueTypeLabel(type){
    return ({
      core:'核心概念',
      condition:'条件限制',
      direction:'考察方向',
      action:'动作线索',
      trap:'干扰信息',
      role:'角色',
      time:'时间点',
      method:'方法环境',
      change:'变更线索',
      constraint:'约束'
    })[type] || type || '关键词';
  }
  function clueRoleLabel(role){
    return ({true:'有效线索', decoy:'诱导线索', context:'背景信息'})[role] || role || '线索';
  }

  function normalizedStemForDuplicate(question){return stemText(question).replace(/\s+/g,'').toLowerCase()}
  function normalizedEnglishStemForDuplicate(question){return englishStemText(question).replace(/\s+/g,'').toLowerCase()}
  function bulkAddQuestions(items, options={}){
    const bank=state.banks.find(item=>item.id===String(options.bankId||''))||currentBank();
    if(!bank)return {valid:false,added:[],duplicates:[],errors:['请先选择题库。']};
    const incoming=Array.isArray(items)?items:[];const skipDuplicates=options.skipDuplicates!==false;
    const knownIds=new Set(bank.questions.map(item=>item.id));const knownStems=new Set(bank.questions.map(normalizedStemForDuplicate).filter(Boolean));const knownEnglishStems=new Set(bank.questions.map(normalizedEnglishStemForDuplicate).filter(Boolean));
    let nextNumber=Number(nextTeacherNumber(bank.subject).split('-').pop())||1;const prefix=subjectNumberPrefix(bank.subject);
    const added=[],duplicates=[],errors=[];
    incoming.forEach((raw,index)=>{
      try{
        const question=normalizeQuestion({...raw,subject:raw?.subject||bank.subject},index);
        const normalizedStem=normalizedStemForDuplicate(question),normalizedEnglishStem=normalizedEnglishStemForDuplicate(question);
        if(skipDuplicates&&((normalizedStem&&knownStems.has(normalizedStem))||(normalizedEnglishStem&&knownEnglishStems.has(normalizedEnglishStem)))){duplicates.push({index:index+1,title:question.title,reason:'中英文题干重复'});return}
        if(!question.teacherNumber){question.teacherNumber=prefix+'-'+String(nextNumber).padStart(6,'0');nextNumber+=1}
        if(knownIds.has(question.id))question.id=safeId('q');
        while(knownIds.has(question.id))question.id=safeId('q');
        knownIds.add(question.id);if(normalizedStem)knownStems.add(normalizedStem);if(normalizedEnglishStem)knownEnglishStems.add(normalizedEnglishStem);bank.questions.push(question);added.push(question);
      }catch(error){errors.push(`第 ${index+1} 题：${error?.message||error}`)}
    });
    if(added.length){bank.updatedAt=Date.now();saveBanks(state.banks,{silent:true});state.selectedBankId=bank.id;state.selectedQuestionId=added[added.length-1].id;state.activeSidebarTab='questions';state.activeMainTab='banks';state.questionPage=Math.max(1,Math.ceil(bank.questions.length/QUESTION_PAGE_SIZE));render()}
    if(options.notify!==false)toast(`已导入 ${added.length} 道题${duplicates.length?`，跳过 ${duplicates.length} 道重复题`:''}${errors.length?`，${errors.length} 道失败`:''}。`);
    return {valid:errors.length===0,added:clone(added),duplicates,errors,bankId:bank.id};
  }
  function updateCurrentQuestion(patch={}){
    const bank=currentBank(),question=currentQuestion();if(!bank||!question)return {valid:false,error:'请先选择题目。'};
    Object.assign(question,normalizeQuestion({...question,...clone(patch),id:question.id,teacherNumber:question.teacherNumber||nextTeacherNumber(bank.subject)}));bank.updatedAt=Date.now();saveBanks(state.banks,{silent:true});render();return {valid:true,question:clone(currentQuestion())};
  }
  function renameTagAcrossQuestions(oldName,newName){
    const from=String(oldName||'').trim(),to=String(newName||'').trim();
    if(!from||!to)return {valid:false,error:'标签名称不能为空。',updatedQuestions:0};
    if(from===to)return {valid:true,updatedQuestions:0};
    let updatedQuestions=0;
    state.banks.forEach(bank=>{
      let bankChanged=false;
      (bank.questions||[]).forEach(question=>{
        const tags=Array.isArray(question.tags)?question.tags.map(String):[];
        if(!tags.includes(from))return;
        question.tags=[...new Set(tags.map(tag=>tag===from?to:tag).filter(Boolean))];
        const metadata=question.metadata&&typeof question.metadata==='object'?question.metadata:{};
        if(Array.isArray(metadata.tagPaths)){
          metadata.tagPaths=metadata.tagPaths.map(item=>item&&item.label===from?{...item,label:to}:item);
        }
        question.metadata=metadata;
        updatedQuestions+=1;bankChanged=true;
      });
      if(bankChanged)bank.updatedAt=Date.now();
    });
    if(updatedQuestions){saveBanks(state.banks,{silent:true});render()}
    return {valid:true,updatedQuestions};
  }
  globalThis.KGQuestionBankAdminAPI=Object.freeze({
    getCurrentBank:()=>clone(currentBank()),
    getCurrentQuestion:()=>clone(currentQuestion()),
    getAllQuestions:(options={})=>clone(state.banks.flatMap(bank=>(bank.questions||[]).filter(question=>options.includeDeleted===true||!isQuestionDeleted(question)).map(question=>({bankId:bank.id,bankName:bank.name,...question})))),
    updateCurrentQuestion,
    renameTagAcrossQuestions,
    bulkAddQuestions,
    recordQuestionAudit:(action,before,after,options={})=>{const question=currentQuestion();if(!question)return null;return recordQuestionAudit(action,question,before,after,options.batchId||safeId('batch-single'),options.summary||`题目分类变更：${question.title}`,options.status||'success',options.metadata||{})},
    isQuestionDeleted:question=>isQuestionDeleted(question),
    referenceSummaryForQuestion:(questionId,bankId='')=>{const bank=state.banks.find(item=>item.id===String(bankId||''))||currentBank();const question=bank?.questions.find(item=>item.id===String(questionId||''));return clone(referenceSummaryForQuestion(question,bank))},
    getServerCatalogRefreshState:()=>({dirty:state.dirty,revision:state.serverCatalogNewerRevision,conflictReason:state.serverCatalogConflictReason,requiresExplicitReload:state.serverCatalogNewerRevision>0}),
    exportServerCatalogLocalDraft:()=>clone(state.serverCatalogLocalDraft),
    copyServerCatalogLocalDraft,
    applyServerCatalogRefresh
  });

  document.addEventListener('input',markCatalogEditorDirty,true);
  document.addEventListener('change',markCatalogEditorDirty,true);
  window.addEventListener('kg:question-catalog-changed',handleQuestionCatalogChanged);
  window.addEventListener('pagehide',()=>window.removeEventListener?.('kg:question-catalog-changed',handleQuestionCatalogChanged));
  window.addEventListener('beforeunload',()=>{if(CatalogEditor)CatalogEditor.release({keepalive:true})});
  document.addEventListener('DOMContentLoaded', init);
})();
