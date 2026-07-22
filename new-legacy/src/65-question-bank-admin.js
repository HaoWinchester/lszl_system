'use strict';

(function(){
  const $ = id => document.getElementById(id);
  const STORAGE_PREFIX = 'kg_question_banks_v1__';
  const CURRENT_PREFIX = 'kg_question_current_v1__';
  const PAPER_PREFIX = 'kg_exam_papers_v1__';
  const PAPER_CURRENT_PREFIX = 'kg_exam_current_v1__';
  const AUTH_SESSION_KEY = 'kg_local_current_user_v1';
  const DEEP_RECALL_KEY = 'kg_deep_recall_current_question_v1';
  const DEMO_SUPPRESSED_PREFIX = 'kg_question_bank_demo_suppressed_v1__';
  const DEMO_BANK_ID = 'bank-pmp-demo';
  const DEMO_QUESTION_ID = 'pmp-agile-change-001';
  const QUESTION_PAGE_SIZE = 20;
  const BANK_PAGE_SIZE = 8;
  const COGNITIVE_PAGE_SIZE = 10;

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

  let state = {
    banks: [],
    selectedBankId: '',
    selectedQuestionId: '',
    papers: [],
    selectedPaperId: '',
    subjectFilter: 'ALL',
    bankPage: 1,
    activeSidebarTab: 'banks',
    activeAnnotationTab: 'clues',
    activeLayoutNav: 'banks',
    activeMainTab: 'banks',
    questionSearch: '',
    questionGroupMode: 'topic',
    questionPage: 1,
    cluePage: 1,
    conceptPage: 1,
    collapsedQuestionGroups: {},
    editingClueId: '',
    editingConceptId: '',
    pendingKeywordSelection: null,
    dirty: false
  };

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
  function cleanList(value){
    if(Array.isArray(value)) return value.map(x => String(x).trim()).filter(Boolean);
    return String(value || '').split(/[,，、;；|]/).map(x => x.trim()).filter(Boolean);
  }
  function subjectMeta(id){
    return SUBJECTS.find(s => s.id === id || s.name === id) || SUBJECTS.find(s => s.id === 'CUSTOM');
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
  function currentKey(){
    return CURRENT_PREFIX + sessionScope();
  }
  function papersKey(){
    return PAPER_PREFIX + sessionScope();
  }
  function currentPaperKey(){
    return PAPER_CURRENT_PREFIX + sessionScope();
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
    return '当前空间：' + decodeURIComponent(scope.replace(/^user__/, '')) + ' 的本地题库';
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
      type:String(clue.type || 'core'),
      clueRole:String(clue.clueRole || clue.role || 'true'),
      sourceType:String(clue.sourceType || (sourceOptionId ? 'option' : 'stem')),
      sourceOptionId,
      conceptIds:Array.isArray(clue.conceptIds) ? clue.conceptIds.map(String) : cleanList(clue.conceptIds),
      explain:String(clue.explain || clue.description || '')
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
      title:String(question.title || '未命名题目'),
      type:String(question.type || 'single_choice'),
      subject:String(question.subject || ''),
      difficulty:String(question.difficulty || ''),
      domain:String(question.domain || ''),
      topic:String(question.topic || ''),
      tags:Array.isArray(question.tags) ? question.tags.map(String) : cleanList(question.tags),
      stemParts:stemParts.map(p => ({text:String(p && p.text || ''), ...(p && p.clue ? {clue:String(p.clue)} : {})})),
      options,
      correctAnswer,
      analysis:String(question.analysis || ''),
      clues:Array.isArray(question.clues) ? question.clues.map(normalizeClue).filter(c => c.text) : [],
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
    return {
      id:String(bank.id || bank.bankId || ('bank-' + Date.now().toString(36) + '-' + index)),
      name:String(bank.name || bank.bankName || subject + ' 题库'),
      subject,
      description:String(bank.description || ''),
      version:String(bank.version || '1.0'),
      visibility:String(bank.visibility || 'private'),
      createdAt:Number(bank.createdAt || Date.now()),
      updatedAt:Number(bank.updatedAt || Date.now()),
      questions:Array.isArray(bank.questions) ? bank.questions.map((q,i) => normalizeQuestion({...q, subject:q.subject || subject}, i)) : []
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
  function currentPaper(){
    return state.papers.find(p => p.id === state.selectedPaperId) || state.papers[0] || null;
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
      (bank.questions || []).forEach(question => {
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

  function loadBanks(){
    try{
      const raw = localStorage.getItem(banksKey());
      const parsed = JSON.parse(raw || 'null');
      if(Array.isArray(parsed) && parsed.length){
        const ensured = ensureEmbeddedPmpExample(parsed);
        if(ensured.changed) saveBanks(ensured.banks, {silent:true});
        return ensured.banks;
      }
    }catch(e){
      console.warn(e);
    }
    const seeded = ensureEmbeddedPmpExample(starterBanks()).banks;
    saveBanks(seeded, {silent:true});
    return seeded;
  }
  function saveBanks(nextBanks=state.banks, options={}){
    state.banks = (nextBanks || []).map(normalizeBank);
    try{
      localStorage.setItem(banksKey(), JSON.stringify(state.banks));
      state.dirty = false;
      if(!options.silent) toast('已保存到本地题库。');
    }catch(e){
      alert('保存失败：' + (e.message || e));
    }
  }
  function currentBank(){
    return state.banks.find(b => b.id === state.selectedBankId) || filteredBanks()[0] || state.banks[0] || null;
  }
  function currentQuestion(){
    const bank = currentBank();
    if(!bank) return null;
    return bank.questions.find(q => q.id === state.selectedQuestionId) || bank.questions[0] || null;
  }
  function filteredBanks(){
    return state.subjectFilter === 'ALL'
      ? state.banks
      : state.banks.filter(b => b.subject === state.subjectFilter);
  }
  function selectBank(bankId){
    const bank = state.banks.find(b => b.id === bankId);
    if(!bank) return;
    state.selectedBankId = bank.id;
    const bankIndexInFilter = filteredBanks().findIndex(item => item.id === bank.id);
    if(bankIndexInFilter >= 0) state.bankPage = Math.max(1, Math.ceil((bankIndexInFilter + 1) / BANK_PAGE_SIZE));
    state.selectedQuestionId = bank.questions[0]?.id || '';
    state.cluePage = 1;
    state.conceptPage = 1;
    state.editingClueId = '';
    state.editingConceptId = '';
    state.activeSidebarTab = 'questions';
    state.activeLayoutNav = 'questions';
    state.collapsedQuestionGroups = {};
    state.questionPage = 1;
    render();
  }
  function selectQuestion(questionId){
    const bank = currentBank();
    if(!bank) return;
    const question = bank.questions.find(q => q.id === questionId);
    if(!question) return;
    state.selectedQuestionId = question.id;
    state.cluePage = 1;
    state.conceptPage = 1;
    state.editingClueId = '';
    state.editingConceptId = '';
    render();
  }

  function init(){
    if(window.KGRolePermissions){
      window.KGRolePermissions.applyTheme();
      window.KGRolePermissions.decoratePermissionElements();
      if(!window.KGRolePermissions.can('accessQuestionBank')){
        window.KGRolePermissions.renderPermissionDenied(document.querySelector('.qb-app') || document.body, '题库管理与组卷发布仅限管理员、教师/教研角色访问。学员请进入考题训练，或联系管理员调整角色。');
        return;
      }
    }
    initStaticControls();
    state.banks = loadBanks();
    state.papers = loadPapers();
    state.selectedPaperId = state.papers[0]?.id || '';
    state.selectedBankId = state.banks[0]?.id || '';
    state.selectedQuestionId = state.banks[0]?.questions[0]?.id || '';
    render();
  }

  function initStaticControls(){
    $('qbScopeInfo').textContent = scopeLabel();

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
          else addBank(state.subjectFilter);
        });
      });
    }

    $('qbAddBankBtn').addEventListener('click', () => addBank(state.subjectFilter === 'ALL' ? 'PMP' : state.subjectFilter));
    $('qbAddQuestionBtn').addEventListener('click', addQuestion);
    $('qbSaveBankBtn').addEventListener('click', saveBankForm);
    $('qbSaveQuestionBtn').addEventListener('click', saveQuestionForm);
    $('qbCloneQuestionBtn').addEventListener('click', cloneQuestion);
    $('qbDeleteQuestionBtn').addEventListener('click', deleteQuestion);
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
    renderQuestionList();
    fillBankForm();
    fillQuestionForm();
    renderStatusCard();
    renderCompletion();
    renderPaperManager();
  }

  function setMainTab(tab){
    const active = ['banks','papers','base'].includes(tab) ? tab : 'banks';
    state.activeMainTab = active;
    state.activeLayoutNav = active;
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
    state.activeAnnotationTab = ['clues','concepts','reasoning'].includes(tab) ? tab : 'clues';
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
    if(['clues','concepts','reasoning'].includes(section)){
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
    const active = ['clues','concepts','reasoning'].includes(state.activeAnnotationTab) ? state.activeAnnotationTab : 'clues';
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
              <small>${escapeHTML(b.subject)} · ${b.questions.length} 题 · ${escapeHTML(b.version || '1.0')}</small>
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
  function renderQuestionList(){
    const list = $('qbQuestionList');
    const count = $('qbQuestionCount');
    const search = $('qbQuestionSearch');
    const groupMode = $('qbQuestionGroupMode');
    const pager = $('qbQuestionPager');
    if(search && search.value !== state.questionSearch) search.value = state.questionSearch || '';
    if(groupMode && groupMode.value !== state.questionGroupMode) groupMode.value = state.questionGroupMode || 'topic';
    const bank = currentBank();
    if(count) count.textContent = bank ? `${bank.questions.length} 题` : '0 题';
    if(!list) return;
    if(!bank){
      list.innerHTML = '<div class="qb-empty">请先创建题库。</div>';
      if(pager){ pager.hidden = true; pager.innerHTML = ''; }
      return;
    }
    if(!bank.questions.length){
      list.innerHTML = '<div class="qb-empty">当前题库没有题目，点击“+ 新题”开始录入。</div>';
      if(pager){ pager.hidden = true; pager.innerHTML = ''; }
      return;
    }
    const keyword = String(state.questionSearch || '').trim().toLowerCase();
    const visible = bank.questions.map((q, index) => ({q, index})).filter(item => !keyword || questionSearchText(item.q).includes(keyword));
    if(count) count.textContent = keyword ? `${visible.length} / ${bank.questions.length} 题` : `${bank.questions.length} 题`;
    if(!visible.length){
      list.innerHTML = '<div class="qb-empty">没有匹配的题目。可以换一个关键词，或切换归集方式。</div>';
      if(pager){ pager.hidden = true; pager.innerHTML = ''; }
      return;
    }
    const pageCount = clampQuestionPage(visible.length);
    const startIndex = (state.questionPage - 1) * QUESTION_PAGE_SIZE;
    const pageItems = visible.slice(startIndex, startIndex + QUESTION_PAGE_SIZE);
    const groups = new Map();
    pageItems.forEach(item => {
      const key = questionGroupKey(item.q);
      if(!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
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
              return `
                <button type="button" class="qb-list-item question ${q.id === state.selectedQuestionId ? 'active' : ''}" data-question-id="${escapeHTML(q.id)}" title="双击进入题目基本信息">
                  <strong>${index + 1}. ${escapeHTML(q.title)}</strong>
                  <small>${escapeHTML(q.topic || q.domain || '未分类')} · ${escapeHTML(q.difficulty || '难度未设')} · 完成 ${completion}% · 双击编辑基础信息</small>
                </button>
              `;
            }).join('')}
          </div>
        </section>
      `;
    }).join('');
    updateQuestionPager(bank.questions.length, visible.length, pageCount);
    list.querySelectorAll('[data-question-group]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.questionGroup;
        state.collapsedQuestionGroups[key] = !state.collapsedQuestionGroups[key];
        renderQuestionList();
      });
    });
    list.querySelectorAll('[data-question-id]').forEach(btn => {
      btn.addEventListener('click', event => {
        selectQuestion(btn.dataset.questionId);
        if(event.detail >= 2) handleLayoutNav('base');
      });
      btn.addEventListener('dblclick', () => handleLayoutNav('base'));
    });
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
    $('bankDescription').value = bank ? bank.description : '';
    $('bankCustomSubject').value = bank && !SUBJECTS.some(s => s.id === bank.subject) ? bank.subject : '';
    toggleCustomSubject();
  }
  function fillQuestionForm(){
    const q = currentQuestion();
    const disabled = !q;
    ['questionTitleInput','questionTypeInput','questionDifficultyInput','questionDomainInput','questionTopicInput','questionTagsInput','questionStemInput','questionAnalysisInput'].forEach(id => {
      const el = $(id);
      if(el) el.disabled = disabled;
    });
    if(!q){
      $('questionTitleInput').value = '';
      $('questionTypeInput').value = 'single_choice';
      $('questionDifficultyInput').value = '';
      $('questionDomainInput').value = '';
      $('questionTopicInput').value = '';
      $('questionTagsInput').value = '';
      $('questionStemInput').value = '';
      $('questionAnalysisInput').value = '';
      $('qbOptionsEditor').innerHTML = '<div class="qb-empty">请选择或新增一道题目。</div>';
      $('qbClueList').innerHTML = '';
      $('qbConceptList').innerHTML = '';
      const cluePager = $('qbCluePager');
      const conceptPager = $('qbConceptPager');
      if(cluePager){ cluePager.hidden = true; cluePager.innerHTML = ''; }
      if(conceptPager){ conceptPager.hidden = true; conceptPager.innerHTML = ''; }
      $('qbReasoningList').innerHTML = '';
      return;
    }
    $('questionTitleInput').value = q.title || '';
    $('questionTypeInput').value = q.type || 'single_choice';
    $('questionDifficultyInput').value = q.difficulty || '';
    $('questionDomainInput').value = q.domain || '';
    $('questionTopicInput').value = q.topic || '';
    $('questionTagsInput').value = (q.tags || []).join(',');
    $('questionStemInput').value = stemText(q);
    $('questionAnalysisInput').value = q.analysis || '';
    renderOptions();
    updateClueOptionSelect();
    updateClueSourceWrap();
    renderClues();
    renderConcepts();
    renderReasoning();
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


  function renderPaperManager(){
    renderPaperList();
    fillPaperForm();
    renderPaperQuotaList();
    renderPaperQuestionList();
  }
  function renderPaperList(){
    const list = $('qbPaperList');
    if(!list) return;
    if(!state.papers.length){
      list.innerHTML = '<div class="qb-empty">还没有试卷。点击“+ 新试卷”后，可按 PMP 十大知识领域配额组卷。</div>';
      return;
    }
    list.innerHTML = state.papers.map((p, paperIndex) => {
      const integrity = paperIntegrity(p);
      const status = p.status === 'published' ? '已发布' : '草稿';
      return `
        <button type="button" class="qb-list-item paper ${p.id === state.selectedPaperId ? 'active' : ''}" data-paper-id="${escapeHTML(p.id)}">
          <span class="qb-paper-order">${paperIndex + 1}</span>
          <span class="qb-paper-text">
            <strong>${escapeHTML(p.name)}</strong>
            <small>${escapeHTML(p.subject)} · 已组 ${integrity.configuredCount}/目标 ${integrity.targetCount} 题 · 前端可用 ${integrity.validCount} 题</small>
          </span>
          <span class="qb-paper-state ${p.status === 'published' ? 'published' : 'draft'}">${escapeHTML(status)}</span>
        </button>
      `;
    }).join('');
    list.querySelectorAll('[data-paper-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.selectedPaperId = btn.dataset.paperId;
        renderPaperManager();
      });
    });
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
    if($('paperDescriptionInput')) $('paperDescriptionInput').value = paper ? paper.description || '' : '';
    const meta = $('qbPaperMeta');
    if(meta){
      if(!paper){
        meta.innerHTML = '<div class="qb-empty">新建或选择一套试卷后，可维护组卷规则并发布。</div>';
      }else{
        const integrity = paperIntegrity(paper);
        const published = paper.status === 'published';
        meta.innerHTML = `
          <span class="qb-badge ${published ? 'current' : ''}">${published ? '已发布：前端可见' : '草稿：仅后台可见'}</span>
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
    if(publishBtn) publishBtn.textContent = paper && paper.status === 'published' ? '取消发布' : '发布试卷';
  }
  function readPaperFormInto(paper){
    if(!paper) return null;
    paper.name = $('paperNameInput')?.value.trim() || paper.name || '未命名试卷';
    paper.subject = $('paperSubjectInput')?.value || paper.subject || 'PMP';
    paper.totalCount = Math.max(1, Number($('paperTotalInput')?.value || paper.totalCount || 180));
    paper.description = $('paperDescriptionInput')?.value.trim() || '';
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
    savePapers(state.papers);
    handleLayoutNav('papers');
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
    const list = $('qbPaperQuestionList');
    const count = $('qbPaperQuestionCount');
    if(!list) return;
    const paper = currentPaper();
    const refs = paper ? (paper.questions || []) : [];
    if(count) count.textContent = `${refs.length} 题`;
    if(!paper){
      list.innerHTML = '<div class="qb-empty">暂无试卷。</div>';
      return;
    }
    if(!refs.length){
      list.innerHTML = '<div class="qb-empty">尚未组卷。设置领域配额后点击“按配额组卷”。</div>';
      return;
    }
    list.innerHTML = refs.map((ref, index) => {
      const {bank, question} = paperQuestionLookup(ref);
      return `
        <article class="qb-paper-question-row">
          <span>${index + 1}</span>
          <div>
            <strong>${escapeHTML(question ? question.title : '题目已不存在')}</strong>
            <small>${escapeHTML(bank ? bank.name : '未知题库')} · ${escapeHTML(question ? questionDomainKey(question) : '')} · ${escapeHTML(question ? question.difficulty || '难度未设' : '')}</small>
          </div>
          <button type="button" class="danger" data-paper-remove="${index}">移除</button>
        </article>
      `;
    }).join('');
    list.querySelectorAll('[data-paper-remove]').forEach(btn => {
      btn.addEventListener('click', () => removePaperQuestion(Number(btn.dataset.paperRemove)));
    });
  }
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
    let paper = currentPaper();
    if(!paper){ addPaper(); paper = currentPaper(); }
    readPaperFormInto(paper);
    const quotas = paper.quotas || {};
    const selected = [];
    const used = new Set();
    const candidates = paperCandidates(paper.subject);
    Object.entries(quotas).forEach(([domain, quota]) => {
      const rows = shuffleRows(candidates.filter(row => row.domain === domain));
      rows.slice(0, Math.max(0, Number(quota || 0))).forEach(row => {
        const key = row.bank.id + '::' + row.question.id;
        if(used.has(key)) return;
        used.add(key);
        selected.push({bankId:row.bank.id, questionId:row.question.id, order:selected.length + 1, score:1});
      });
    });
    const target = Math.max(1, Number(paper.totalCount || 180));
    if(selected.length < target){
      shuffleRows(candidates).forEach(row => {
        if(selected.length >= target) return;
        const key = row.bank.id + '::' + row.question.id;
        if(used.has(key)) return;
        used.add(key);
        selected.push({bankId:row.bank.id, questionId:row.question.id, order:selected.length + 1, score:1});
      });
    }
    paper.questions = selected.map((ref, i) => ({...ref, order:i + 1}));
    paper.updatedAt = Date.now();
    savePapers(state.papers, {silent:true});
    renderPaperManager();
    const shortage = selected.length < target ? `，当前题量不足目标 ${target}，实际组入 ${selected.length} 题` : '';
    toast(`已完成组卷${shortage}。`);
  }
  function togglePublishPaper(){
    if(window.KGRolePermissions && !window.KGRolePermissions.can('publishPapers')){
      toast('当前角色无试卷发布权限。');
      return;
    }
    const paper = currentPaper();
    if(!paper) return toast('请先新建试卷。');
    readPaperFormInto(paper);
    if(!(paper.questions || []).length){
      toast('请先组卷后再发布。');
      return;
    }
    const integrity = paperIntegrity(paper);
    if(paper.status !== 'published' && integrity.missingCount){
      toast(`试卷中有 ${integrity.missingCount} 道题目引用已失效，请先移除失效题目或重新组卷。`);
      return;
    }
    if(paper.status !== 'published' && integrity.duplicateCount){
      toast(`试卷中有 ${integrity.duplicateCount} 个重复题目引用，请先重新组卷。`);
      return;
    }
    if(paper.status === 'published'){
      paper.status = 'draft';
      paper.publishedAt = 0;
      setCurrentPaper(null);
      toast('已取消发布，前端不再显示该试卷。');
    }else{
      paper.status = 'published';
      paper.publishedAt = Date.now();
      setCurrentPaper(paper);
      toast('试卷已发布，首页考题训练可选择该试卷。');
    }
    paper.updatedAt = Date.now();
    savePapers(state.papers, {silent:true});
    renderPaperManager();
  }
  function removePaperQuestion(index){
    const paper = currentPaper();
    if(!paper) return;
    paper.questions.splice(index, 1);
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
    if(paper.status === 'published') setCurrentPaper(null);
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
  function saveBankForm(){
    const bank = currentBank();
    if(!bank) return;
    const selectedSubject = $('bankSubject').value;
    bank.subject = selectedSubject === 'CUSTOM' ? ($('bankCustomSubject').value.trim() || '自定义科目') : selectedSubject;
    bank.name = $('bankName').value.trim() || bank.subject + ' 题库';
    bank.version = $('bankVersion').value.trim() || '1.0';
    bank.description = $('bankDescription').value.trim();
    bank.updatedAt = Date.now();
    bank.questions.forEach(q => { q.subject = q.subject || bank.subject; });
    saveBanks();
    const track=(global.KGFeatureAnalytics&&global.KGFeatureAnalytics.track)||function(){};track('question_bank','key_action','bank_saved');track('question_bank','outcome','bank_saved');
    render();
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
  function collectReasoningFromDom(){
    const rows = Array.from(document.querySelectorAll('#qbReasoningList [data-reasoning-index]'));
    return rows.map((row, index) => ({
      id:currentQuestion().reasoningSteps[index]?.id || safeId('rs'),
      title:row.querySelector('.rs-title').value.trim() || '推理步骤 ' + (index + 1),
      content:row.querySelector('.rs-content').value.trim(),
      relatedKeywords:cleanList(row.querySelector('.rs-keywords').value),
      relatedKnowledgePoints:cleanList(row.querySelector('.rs-kps').value),
      recallQuestion:row.querySelector('.rs-question').value.trim()
    }));
  }
  function saveQuestionForm(options={}){
    const bank = currentBank();
    const q = currentQuestion();
    if(!bank || !q) return false;
    q.title = $('questionTitleInput').value.trim() || '未命名题目';
    q.type = $('questionTypeInput').value || 'single_choice';
    q.subject = bank.subject;
    q.difficulty = $('questionDifficultyInput').value;
    q.domain = $('questionDomainInput').value.trim();
    q.topic = $('questionTopicInput').value.trim();
    q.tags = cleanList($('questionTagsInput').value);
    q.analysis = $('questionAnalysisInput').value.trim();
    q.options = collectOptionsFromDom().map((o,i) => normalizeOption(o,i,''));
    const correct = document.querySelector('input[name="correctOption"]:checked')?.value || q.options.find(o => o.correct)?.id || q.options[0]?.id || '';
    q.correctAnswer = correct;
    q.options.forEach(o => { o.correct = o.id === correct; });
    const rawStem = $('questionStemInput').value;
    q.stemParts = rebuildStemParts(rawStem, stemClues(q.clues));
    q.reasoningSteps = collectReasoningFromDom().map(normalizeReasoningStep);
    q.status = {
      contentReady:!!(rawStem.trim() && q.options.length >= 2 && q.correctAnswer),
      keywordsReady:q.clues.length > 0,
      knowledgeReady:q.concepts.length > 0,
      reasoningReady:q.reasoningSteps.length > 0,
      published:q.status && q.status.published || false
    };
    bank.updatedAt = Date.now();
    saveBanks(state.banks, {silent:options.silent});
    if(!options.silent){const track=(global.KGFeatureAnalytics&&global.KGFeatureAnalytics.track)||function(){};track('question_bank','key_action','question_saved');track('question_bank','outcome','question_saved');render()}
    return true;
  }

  function addBank(subject='PMP'){
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
    state.banks.push(bank);
    state.selectedBankId = bank.id;
    state.selectedQuestionId = '';
    state.cluePage = 1;
    state.conceptPage = 1;
    state.questionPage = 1;
    state.subjectFilter = subjectId;
    state.bankPage = Math.max(1, Math.ceil(filteredBanks().length / BANK_PAGE_SIZE));
    state.activeSidebarTab = 'banks';
    state.activeLayoutNav = 'banks';
    const filter = $('qbSubjectFilter');
    if(filter) filter.value = subjectId;
    saveBanks();
    render();
  }
  function addQuestion(){
    const bank = currentBank();
    if(!bank) return addBank('PMP');
    const q = emptyQuestion(bank.subject);
    bank.questions.push(q);
    state.selectedQuestionId = q.id;
    state.cluePage = 1;
    state.conceptPage = 1;
    state.questionPage = Math.max(1, Math.ceil(bank.questions.length / QUESTION_PAGE_SIZE));
    state.activeSidebarTab = 'questions';
    state.activeLayoutNav = 'questions';
    bank.updatedAt = Date.now();
    saveBanks();
    render();
  }
  function cloneQuestion(){
    const bank = currentBank();
    const q = currentQuestion();
    if(!bank || !q) return;
    const copied = normalizeQuestion({...clone(q), id:safeId('q'), title:q.title + '（副本）'});
    bank.questions.push(copied);
    state.selectedQuestionId = copied.id;
    state.cluePage = 1;
    state.conceptPage = 1;
    state.questionPage = Math.max(1, Math.ceil(bank.questions.length / QUESTION_PAGE_SIZE));
    bank.updatedAt = Date.now();
    saveBanks();
    render();
  }
  function deleteQuestion(){
    const bank = currentBank();
    const q = currentQuestion();
    if(!bank || !q) return;
    if(!confirm('确定删除这道题吗？此操作只影响当前浏览器本地题库。')) return;
    if(isDemoQuestion(q) || isDemoBank(bank)) suppressDemoExample();
    const index = bank.questions.findIndex(item => item.id === q.id);
    if(index >= 0) bank.questions.splice(index,1);
    state.selectedQuestionId = bank.questions[Math.max(0,index-1)]?.id || bank.questions[0]?.id || '';
    state.cluePage = 1;
    state.conceptPage = 1;
    state.questionPage = Math.max(1, Math.min(state.questionPage || 1, Math.ceil(bank.questions.length / QUESTION_PAGE_SIZE) || 1));
    bank.updatedAt = Date.now();
    saveBanks();
    render();
  }
  function isDemoBank(bank){
    return !!bank && (bank.id === DEMO_BANK_ID || bank.visibility === 'public-demo' || (bank.subject === 'PMP' && /示例|演示|demo/i.test(bank.name || '')));
  }
  function isDemoQuestion(question){
    return !!question && String(question.id || '') === DEMO_QUESTION_ID;
  }
  function deleteCurrentBank(){
    const bank = currentBank();
    if(!bank) return;
    deleteBankById(bank.id);
  }
  function deleteBankById(bankId){
    const bank = state.banks.find(b => b.id === bankId);
    if(!bank) return;
    const message = `确定删除题库“${bank.name}”吗？\n\n将删除该题库下 ${bank.questions.length} 道题。此操作只影响当前浏览器本地题库。`;
    if(!confirm(message)) return;
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

  function addOption(){
    if(!currentQuestion()) return;
    if(!saveQuestionForm({silent:true})) return;
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
  function editClue(clueId){
    if(!saveQuestionForm({silent:true})) return;
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
  function addClue(){
    if(!currentQuestion()) return;
    if(!saveQuestionForm({silent:true})) return;
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
    ['conceptIdInput','conceptTitleInput','conceptCategoryInput','conceptKeywordsInput','conceptSummaryInput','conceptNotesInput','conceptRuleInput'].forEach(id => $(id).value = '');
    $('conceptLevelInput').value = '基础';
    $('conceptColorInput').value = '#7c3aed';
    $('qbAddConceptBtn').textContent = '添加知识点';
    $('qbCancelConceptEditBtn').hidden = true;
  }
  function editConcept(conceptId){
    if(!saveQuestionForm({silent:true})) return;
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
  function addConcept(){
    if(!currentQuestion()) return;
    if(!saveQuestionForm({silent:true})) return;
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

  function addReasoningStep(){
    setAnnotationTab('reasoning');
    if(!currentQuestion()) return;
    if(!saveQuestionForm({silent:true})) return;
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
  }
  function saveFloatingKeyword(){
    const selection = state.pendingKeywordSelection;
    if(!selection){
      toast('没有可保存的选中文本。');
      return;
    }
    if(!saveQuestionForm({silent:true})) return;
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

  function setCurrentTrainingQuestion(){
    if(!saveQuestionForm({silent:true})) return;
    const bank = currentBank();
    const q = currentQuestion();
    if(!bank || !q) return;
    const index = bank.questions.findIndex(item => item.id === q.id);
    try{
      localStorage.setItem(currentKey(), JSON.stringify({bankId:bank.id, index:Math.max(0,index)}));
      toast('已设为当前训练题。回到首页打开“考题训练”即可使用。');
    }catch(e){
      alert('设置失败：' + (e.message || e));
    }
  }
  function previewDeepRecall(){
    if(!saveQuestionForm({silent:true})) return;
    const q = currentQuestion();
    if(!q) return;
    try{
      const payloadQuestion=clone(q);
      payloadQuestion.sourceBankId=bank?.id || '';
      payloadQuestion.sourceQuestionId=q.id || '';
      localStorage.setItem(DEEP_RECALL_KEY, JSON.stringify({question:payloadQuestion, savedAt:Date.now(), source:'question-bank-admin', sourceBankId:bank?.id || '', sourceQuestionId:q.id || ''}));
    }catch(e){}
    window.open('knowledge-recall.html?questionId=' + encodeURIComponent(q.id || 'current'), '_blank');
  }
  function exportCurrentBank(){
    saveQuestionForm({silent:true});
    const bank = currentBank();
    if(!bank) return;
    downloadJson((bank.name || '题库') + '.json', bank);
  }
  function exportBankById(bankId){
    saveQuestionForm({silent:true});
    const bank = state.banks.find(b => b.id === bankId);
    if(!bank) return;
    downloadJson((bank.name || '题库') + '.json', bank);
  }
  function exportAllBanks(){
    saveQuestionForm({silent:true});
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

  document.addEventListener('DOMContentLoaded', init);
})();
