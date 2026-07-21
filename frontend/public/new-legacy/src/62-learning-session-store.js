'use strict';

/*
 * LearningSessionStore
 * 当前阶段使用 localStorage 作为适配器，但所有学习会话读写集中在本模块。
 * 后续可无感替换为 IndexedDB / API，而不改五张学习卡。
 */
(function(global){
  const STORAGE_PREFIX='kg_learning_sessions_v2__';
  const MAX_SESSIONS_PER_USER=120;

  function now(){return Date.now()}
  function clone(value){
    if(value===undefined)return undefined;
    try{return JSON.parse(JSON.stringify(value))}catch(e){return value}
  }
  function currentUserId(){
    try{
      if(typeof authCurrentUser!=='undefined'&&authCurrentUser?.username)return String(authCurrentUser.username);
    }catch(e){}
    try{
      const runtime=global.KGAuthRuntime;
      if(runtime&&typeof runtime.currentUsername==='function')return String(runtime.currentUsername()||'guest');
    }catch(e){}
    return 'guest';
  }
  function key(userId=currentUserId()){
    return STORAGE_PREFIX+encodeURIComponent(String(userId||'guest'));
  }
  function readBucket(userId=currentUserId()){
    try{
      const value=JSON.parse(window.KGServerStateStorage.getItem(key(userId))||'null');
      if(value&&typeof value==='object'&&!Array.isArray(value)){
        value.sessions=value.sessions&&typeof value.sessions==='object'?value.sessions:{};
        return value;
      }
    }catch(e){console.warn('学习会话读取失败',e)}
    return {version:2,userId:String(userId||'guest'),sessions:{},updatedAt:0};
  }
  function writeBucket(bucket,userId=currentUserId()){
    bucket=clone(bucket)||{};
    bucket.version=2;
    bucket.userId=String(userId||bucket.userId||'guest');
    bucket.updatedAt=now();
    bucket.sessions=bucket.sessions&&typeof bucket.sessions==='object'?bucket.sessions:{};
    const entries=Object.entries(bucket.sessions).sort((a,b)=>Number(b[1]?.updatedAt||0)-Number(a[1]?.updatedAt||0));
    bucket.sessions=Object.fromEntries(entries.slice(0,MAX_SESSIONS_PER_USER));
    window.KGServerStateStorage.setItem(key(bucket.userId),JSON.stringify(bucket));
    return clone(bucket);
  }
  function createSession(context={},options={}){
    const startedAt=now();
    const userId=String(options.userId||context.userId||currentUserId());
    const questionId=String(context.questionId||context.id||'current');
    return {
      schemaVersion:2,
      id:'session-'+startedAt.toString(36)+'-'+Math.random().toString(36).slice(2,8),
      attempt:Number(options.attempt||1),
      userId,
      questionId,
      questionRevision:String(context.questionRevision||context.revision||'1'),
      questionTitle:String(context.questionTitle||context.title||''),
      bankId:String(context.bankId||''),
      mode:String(options.mode||'guided'),
      status:'active',
      currentStep:1,
      maxVisited:1,
      confidence:'',
      startedAt,
      updatedAt:startedAt,
      completedAt:null,
      durationSeconds:0,
      answer:{
        selectedOptionId:'',
        correctAnswerId:String(context.correctAnswerId||''),
        submitted:false,
        isCorrect:null
      },
      activation:{
        selectedKeywordIds:[],
        restoredKnowledgeIds:[]
      },
      network:{
        graphVisible:false,
        recallDone:{},
        ruleDone:{},
        trapDone:{},
        answerUnlocked:false,
        lockedAnswer:''
      },
      conclusion:{
        learnerSummary:'',
        savedPrincipleId:''
      },
      canvas:{
        viewport:{x:0,y:0,zoom:1},
        cards:{}
      }
    };
  }
  function normalize(session,context={}){
    if(!session||typeof session!=='object')return createSession(context);
    const base=createSession({
      ...context,
      questionId:session.questionId||context.questionId,
      questionTitle:session.questionTitle||context.questionTitle,
      questionRevision:session.questionRevision||context.questionRevision,
      bankId:session.bankId||context.bankId,
      correctAnswerId:session.answer?.correctAnswerId||context.correctAnswerId
    },{userId:session.userId,attempt:session.attempt,mode:session.mode});
    return {
      ...base,
      ...clone(session),
      answer:{...base.answer,...clone(session.answer||{})},
      activation:{...base.activation,...clone(session.activation||{})},
      network:{...base.network,...clone(session.network||{})},
      conclusion:{...base.conclusion,...clone(session.conclusion||{})},
      canvas:{
        ...base.canvas,
        ...clone(session.canvas||{}),
        viewport:{...base.canvas.viewport,...clone(session.canvas?.viewport||{})},
        cards:{...clone(session.canvas?.cards||{})}
      },
      currentStep:Math.max(1,Math.min(5,Number(session.currentStep||1))),
      maxVisited:Math.max(1,Math.min(5,Number(session.maxVisited||session.currentStep||1))),
      updatedAt:Number(session.updatedAt||base.updatedAt)
    };
  }
  function get(questionId,userId=currentUserId()){
    const bucket=readBucket(userId);
    const raw=bucket.sessions[String(questionId||'current')];
    return raw?normalize(raw):null;
  }
  function save(session){
    const normalized=normalize({...clone(session),updatedAt:now()});
    const bucket=readBucket(normalized.userId);
    bucket.sessions[normalized.questionId]=normalized;
    writeBucket(bucket,normalized.userId);
    return clone(normalized);
  }
  function ensure(context={},options={}){
    const userId=String(options.userId||context.userId||currentUserId());
    const questionId=String(context.questionId||context.id||'current');
    const existing=get(questionId,userId);
    if(existing&&!(options.restartCompleted&&existing.status==='completed'))return existing;
    const attempt=existing?Number(existing.attempt||1)+1:1;
    return save(createSession(context,{...options,userId,attempt}));
  }
  function update(questionId,updater,userId=currentUserId()){
    const current=get(questionId,userId);
    if(!current)return null;
    const draft=clone(current);
    let next;
    if(typeof updater==='function')next=updater(draft)||draft;
    else next={...draft,...clone(updater||{})};
    next.updatedAt=now();
    return save(next);
  }
  function restart(context={},options={}){
    const userId=String(options.userId||context.userId||currentUserId());
    const questionId=String(context.questionId||context.id||'current');
    const existing=get(questionId,userId);
    return save(createSession(context,{...options,userId,attempt:Number(existing?.attempt||0)+1}));
  }
  function remove(questionId,userId=currentUserId()){
    const bucket=readBucket(userId);
    delete bucket.sessions[String(questionId||'current')];
    writeBucket(bucket,userId);
  }
  function list(userId=currentUserId()){
    const bucket=readBucket(userId);
    return Object.values(bucket.sessions).map(s=>normalize(s)).sort((a,b)=>Number(b.updatedAt)-Number(a.updatedAt));
  }

  global.KGLearningSessionStore=Object.freeze({
    STORAGE_PREFIX,
    currentUserId,
    create:createSession,
    normalize,
    get,
    save,
    ensure,
    update,
    restart,
    remove,
    list
  });
})(window);
