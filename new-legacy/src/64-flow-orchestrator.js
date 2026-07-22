'use strict';

/*
 * FlowOrchestrator
 * 负责当前题目、学习会话、旧 qMvpState 和五步流程之间的协调。
 * UI 只发命令，不直接决定持久化方式。
 */
(function(global){
  const sessions=global.KGLearningSessionStore;
  const events=global.KGLearningEventRepository;
  const questions=global.KGQuestionRepository;
  let active=null;
  let runtimeKey='';
  let lastCapturedSignature='';

  function clone(value){
    if(value===undefined)return undefined;
    try{return JSON.parse(JSON.stringify(value))}catch(e){return value}
  }
  function userId(){return sessions?.currentUserId?.()||'guest'}
  function descriptor(){
    const d=questions?.descriptor?.()||{};
    const q=d.question||{};
    return {
      questionId:String(d.id||q.sourceQuestionId||q.id||q.title||'current'),
      questionRevision:String(d.revision||q.version||q.updatedAt||'1'),
      questionTitle:String(d.title||q.title||''),
      bankId:String(d.bankId||q.sourceBankId||''),
      correctAnswerId:String(q.correctAnswer||'')
    };
  }
  function makeRuntimeKey(context=descriptor()){
    return userId()+'::'+String(context.questionId||'current');
  }
  function event(type,payload={},session=active){
    if(!events?.append)return null;
    return events.append(type,payload,{
      userId:session?.userId||userId(),
      sessionId:session?.id||'',
      questionId:session?.questionId||descriptor().questionId
    });
  }
  function useSession(session,reason='restore'){
    active=clone(session);
    runtimeKey=makeRuntimeKey(active);
    lastCapturedSignature='';
    if(active)event(reason==='start'?'SESSION_STARTED':'SESSION_RESTORED',{
      step:active.currentStep,
      status:active.status,
      attempt:active.attempt
    },active);
    try{global.dispatchEvent(new CustomEvent('kg:learning-session-changed',{detail:{reason,session:clone(active)}}))}catch(e){}
    return clone(active);
  }
  function ensureCurrent(options={}){
    if(!sessions)return null;
    const context=descriptor();
    const nextRuntimeKey=makeRuntimeKey(context);
    if(active&&runtimeKey===nextRuntimeKey&&!options.force)return clone(active);
    const existing=sessions.get(context.questionId,userId());
    const session=sessions.ensure(context,{restartCompleted:!!options.restartCompleted,userId:userId()});
    const reason=existing&&session.id===existing.id?'restore':'start';
    return useSession(session,reason);
  }
  function switchQuestion(options={}){
    const context=descriptor();
    const changed=runtimeKey&&runtimeKey!==makeRuntimeKey(context);
    return ensureCurrent({
      force:true,
      restartCompleted:options.restartCompleted===undefined?!!changed:!!options.restartCompleted
    });
  }
  function persist(mutator,eventType='',eventPayload={}){
    const current=ensureCurrent();
    if(!current||!sessions)return null;
    const saved=sessions.update(current.questionId,draft=>{
      const next=typeof mutator==='function'?(mutator(draft)||draft):{...draft,...clone(mutator||{})};
      next.updatedAt=Date.now();
      return next;
    },current.userId);
    active=saved;
    runtimeKey=makeRuntimeKey(saved);
    if(eventType)event(eventType,eventPayload,saved);
    try{global.dispatchEvent(new CustomEvent('kg:learning-session-updated',{detail:{session:clone(saved),eventType}}))}catch(e){}
    return clone(saved);
  }
  function updateFlow(flow={}){
    const previous=ensureCurrent()||{};
    const step=Math.max(1,Math.min(5,Number(flow.currentStep||previous.currentStep||1)));
    const maxVisited=Math.max(step,Math.min(5,Number(flow.maxVisited||previous.maxVisited||step)));
    const confidence=flow.confidence===undefined?previous.confidence:String(flow.confidence||'');
    const changedStep=step!==previous.currentStep;
    const changedConfidence=confidence!==previous.confidence;
    return persist(draft=>{
      draft.currentStep=step;
      draft.maxVisited=maxVisited;
      draft.confidence=confidence;
      if(flow.mode)draft.mode=String(flow.mode);
      if(flow.learnerSummary!==undefined)draft.conclusion.learnerSummary=String(flow.learnerSummary||'');
      return draft;
    },changedStep?'STEP_CHANGED':(changedConfidence?'CONFIDENCE_SELECTED':''),changedStep?{
      from:previous.currentStep,to:step
    }:(changedConfidence?{confidence}:{}));
  }
  function legacySnapshot(){
    try{
      if(typeof qMvpState==='undefined'||!qMvpState)return null;
      const reasoning=qMvpState.reasoning||{};
      return {
        selectedOptionId:String(qMvpState.selected||''),
        submitted:!!qMvpState.submitted,
        selectedKeywordIds:[...(qMvpState.found instanceof Set?qMvpState.found:new Set(Array.isArray(qMvpState.found)?qMvpState.found:[]))].map(String),
        graphVisible:!!qMvpState.graph,
        recallDone:clone(reasoning.recallDone||{}),
        ruleDone:clone(reasoning.ruleDone||{}),
        trapDone:clone(reasoning.trapDone||{}),
        answerUnlocked:!!reasoning.answerUnlocked,
        lockedAnswer:String(reasoning.lockedAnswer||'')
      };
    }catch(e){return null}
  }
  function captureLegacyState(options={}){
    const snapshot=legacySnapshot();
    if(!snapshot)return ensureCurrent();
    const session=ensureCurrent();
    const signature=JSON.stringify(snapshot);
    if(signature===lastCapturedSignature&&!options.force)return clone(session);
    const previous=clone(session);
    const saved=persist(draft=>{
      draft.answer.selectedOptionId=snapshot.selectedOptionId;
      draft.answer.submitted=snapshot.submitted;
      draft.answer.correctAnswerId=String(draft.answer.correctAnswerId||descriptor().correctAnswerId||'');
      draft.answer.isCorrect=snapshot.submitted?String(snapshot.selectedOptionId)===String(draft.answer.correctAnswerId):null;
      draft.activation.selectedKeywordIds=snapshot.selectedKeywordIds;
      draft.network.graphVisible=snapshot.graphVisible;
      draft.network.recallDone=snapshot.recallDone;
      draft.network.ruleDone=snapshot.ruleDone;
      draft.network.trapDone=snapshot.trapDone;
      draft.network.answerUnlocked=snapshot.answerUnlocked;
      draft.network.lockedAnswer=snapshot.lockedAnswer;
      return draft;
    });
    lastCapturedSignature=signature;
    if(previous){
      if(previous.answer.selectedOptionId!==snapshot.selectedOptionId&&snapshot.selectedOptionId){
        event('ANSWER_SELECTED',{optionId:snapshot.selectedOptionId},saved);
      }
      const oldKeywords=JSON.stringify(previous.activation?.selectedKeywordIds||[]);
      const newKeywords=JSON.stringify(snapshot.selectedKeywordIds);
      if(oldKeywords!==newKeywords){
        event('KEYWORD_SELECTION_CHANGED',{keywordIds:snapshot.selectedKeywordIds},saved);
      }
      const oldProgress=JSON.stringify(previous.network||{});
      const newProgress=JSON.stringify(saved.network||{});
      if(oldProgress!==newProgress){
        event('KNOWLEDGE_PROGRESS_CHANGED',{
          graphVisible:saved.network.graphVisible,
          recallCount:Object.values(saved.network.recallDone||{}).filter(Boolean).length,
          ruleCount:Object.values(saved.network.ruleDone||{}).filter(Boolean).length,
          trapCount:Object.values(saved.network.trapDone||{}).filter(Boolean).length
        },saved);
      }
      if(!previous.answer.submitted&&saved.answer.submitted){
        event('ANSWER_SUBMITTED',{
          selectedOptionId:saved.answer.selectedOptionId,
          correctAnswerId:saved.answer.correctAnswerId,
          isCorrect:saved.answer.isCorrect,
          confidence:saved.confidence
        },saved);
        const track=(global.KGFeatureAnalytics&&global.KGFeatureAnalytics.track)||function(){};
        track('training','key_action','answer_submitted');
        track('training','outcome',saved.answer.isCorrect?'answer_correct':'answer_incorrect');
      }
    }
    return saved;
  }
  function restoreLegacyState(session=ensureCurrent()){
    if(!session)return false;
    try{
      if(typeof qMvpState==='undefined')return false;
      qMvpState={
        found:new Set((session.activation?.selectedKeywordIds||[]).map(String)),
        selected:session.answer?.selectedOptionId||null,
        submitted:!!session.answer?.submitted,
        graph:!!session.network?.graphVisible,
        reasoning:{
          recallDone:clone(session.network?.recallDone||{}),
          ruleDone:clone(session.network?.ruleDone||{}),
          trapDone:clone(session.network?.trapDone||{}),
          answerUnlocked:!!session.network?.answerUnlocked,
          lockedAnswer:String(session.network?.lockedAnswer||'')
        }
      };
      lastCapturedSignature=JSON.stringify(legacySnapshot());
      return true;
    }catch(e){console.warn('旧训练状态恢复失败',e);return false}
  }
  function saveConclusion(summary){
    return persist(draft=>{
      draft.conclusion.learnerSummary=String(summary||'').trim();
      return draft;
    },'CONCLUSION_UPDATED',{length:String(summary||'').trim().length});
  }
  function completeCurrent(options={}){
    const recap=String(options.recap??active?.conclusion?.learnerSummary??'').trim();
    captureLegacyState({force:true});
    const before=ensureCurrent();
    const completedAt=Date.now();
    const durationSeconds=Math.max(0,Number(options.durationSeconds||Math.round((completedAt-Number(before.startedAt||completedAt))/1000)));
    const saved=persist(draft=>{
      draft.status='completed';
      draft.currentStep=5;
      draft.maxVisited=5;
      draft.completedAt=completedAt;
      draft.durationSeconds=durationSeconds;
      draft.conclusion.learnerSummary=recap;
      return draft;
    });
    const record={
      id:'round-'+completedAt.toString(36)+'-'+Math.random().toString(36).slice(2,7),
      sessionId:saved.id,
      userId:saved.userId,
      questionId:saved.questionId,
      questionTitle:saved.questionTitle,
      selectedAnswer:String(saved.answer.selectedOptionId||''),
      correctAnswer:String(saved.answer.correctAnswerId||''),
      isCorrect:!!saved.answer.isCorrect,
      confidence:String(saved.confidence||''),
      foundClues:(saved.activation.selectedKeywordIds||[]).length,
      recap,
      durationSeconds,
      completedAt
    };
    events?.saveRoundSummary?.(record);
    return {session:clone(saved),record};
  }
  function resetCurrentSession(){
    const context=descriptor();
    const restarted=sessions?.restart?.(context,{userId:userId(),mode:active?.mode||'guided'});
    useSession(restarted,'start');
    restoreLegacyState(restarted);
    try{global.dispatchEvent(new CustomEvent('kg:learning-session-reset',{detail:{session:clone(restarted)}}))}catch(e){}
    return clone(restarted);
  }
  function setMode(mode){
    mode=mode==='explore'?'explore':'guided';
    return persist(draft=>{draft.mode=mode;return draft},'LEARNING_MODE_CHANGED',{mode});
  }
  function dispatchCommand(command={}){
    const type=String(command.type||'');
    const payload=command.payload&&typeof command.payload==='object'?command.payload:{};
    let result={ok:true,type};

    if(type==='ANSWER_SELECTED'){
      const optionId=String(payload.optionId||'');
      if(!optionId)return {ok:false,type,error:'ANSWER_REQUIRED'};
      try{
        if(typeof qCanOperateCurrentQuestion==='function'&&!qCanOperateCurrentQuestion('当前角色不能选择这道题的答案。')){
          return {ok:false,type,error:'PERMISSION_DENIED'};
        }
        if(typeof qEnsureReasoningState==='function')qEnsureReasoningState();
        if(typeof qMvpState!=='undefined'){
          if(qMvpState.submitted)return {ok:false,type,error:'ANSWER_ALREADY_SUBMITTED'};
          qMvpState.selected=optionId;
        }
      }catch(error){return {ok:false,type,error:String(error?.message||error)}}
      const session=captureLegacyState({force:true});
      result={ok:true,type,session,optionId};
    }else if(type==='KEYWORD_TOGGLED'){
      const keywordId=String(payload.keywordId||'');
      if(!keywordId)return {ok:false,type,error:'KEYWORD_REQUIRED'};
      try{
        if(typeof qCanOperateCurrentQuestion==='function'&&!qCanOperateCurrentQuestion('当前角色不能操作这道题的关键词。')){
          return {ok:false,type,error:'PERMISSION_DENIED'};
        }
        if(typeof qEnsureReasoningState==='function')qEnsureReasoningState();
        if(typeof qMvpState!=='undefined'){
          if(!(qMvpState.found instanceof Set))qMvpState.found=new Set(qMvpState.found||[]);
          if(qMvpState.found.has(keywordId))qMvpState.found.delete(keywordId);
          else qMvpState.found.add(keywordId);
        }
      }catch(error){return {ok:false,type,error:String(error?.message||error)}}
      const session=captureLegacyState({force:true});
      result={ok:true,type,session,keywordId,selected:!!qMvpState?.found?.has?.(keywordId)};
    }else if(type==='CONFIDENCE_SELECTED'){
      const confidence=String(payload.confidence||'');
      if(!['low','medium','high'].includes(confidence))return {ok:false,type,error:'INVALID_CONFIDENCE'};
      const session=updateFlow({confidence});
      result={ok:true,type,session,confidence};
    }else if(type==='ANSWER_CARD_RESET'){
      const session=resetCurrentSession();
      result={ok:true,type,session};
    }else if(type==='LEARNING_MODE_CHANGED'){
      const session=setMode(payload.mode);
      result={ok:true,type,session};
    }else if(type==='CANVAS_VIEWPORT_UPDATED'){
      const viewport=payload.viewport&&typeof payload.viewport==='object'?payload.viewport:{};
      const session=persist(draft=>{
        draft.canvas=draft.canvas&&typeof draft.canvas==='object'?draft.canvas:{viewport:{x:0,y:0,zoom:1},cards:{}};
        draft.canvas.viewport={
          x:Number(viewport.x||0),
          y:Number(viewport.y||0),
          zoom:Math.max(.01,Math.min(4,Number(viewport.zoom||1)))
        };
        return draft;
      },'CANVAS_VIEWPORT_UPDATED',{viewport});
      result={ok:true,type,session};
    }else if(type==='CARD_POSITION_UPDATED'){
      const cardId=String(payload.cardId||'');
      const layout=payload.layout&&typeof payload.layout==='object'?payload.layout:{};
      if(!cardId)return {ok:false,type,error:'CARD_ID_REQUIRED'};
      const session=persist(draft=>{
        draft.canvas=draft.canvas&&typeof draft.canvas==='object'?draft.canvas:{viewport:{x:0,y:0,zoom:1},cards:{}};
        draft.canvas.cards=draft.canvas.cards&&typeof draft.canvas.cards==='object'?draft.canvas.cards:{};
        draft.canvas.cards[cardId]={
          x:Number(layout.x||0),
          y:Number(layout.y||0),
          width:Math.max(320,Number(layout.width||720)),
          height:Math.max(280,Number(layout.height||560))
        };
        return draft;
      },'CARD_POSITION_UPDATED',{cardId,layout});
      result={ok:true,type,session,cardId};
    }else if(type==='CANVAS_LAYOUT_RESET'){
      const cards=payload.cards&&typeof payload.cards==='object'?payload.cards:{};
      const session=persist(draft=>{
        draft.canvas=draft.canvas&&typeof draft.canvas==='object'?draft.canvas:{viewport:{x:0,y:0,zoom:1},cards:{}};
        draft.canvas.cards=clone(cards)||{};
        return draft;
      },'CANVAS_LAYOUT_RESET',{cardCount:Object.keys(cards).length});
      result={ok:true,type,session};
    }else{
      event('UNHANDLED_LEARNING_COMMAND',{type,payload,sourceCardId:command.sourceCardId||''},active);
      result={ok:false,type,error:'UNHANDLED_COMMAND'};
    }

    try{
      global.dispatchEvent(new CustomEvent('kg:learning-command-handled',{detail:{command:clone(command),result:clone(result)}}));
    }catch(e){}
    return result;
  }
  function current(){return clone(ensureCurrent())}

  global.KGFlowOrchestrator=Object.freeze({
    current,
    ensureCurrent,
    switchQuestion,
    updateFlow,
    captureLegacyState,
    restoreLegacyState,
    saveConclusion,
    completeCurrent,
    resetCurrentSession,
    setMode,
    dispatchCommand,
    recordEvent:event
  });
})(window);
