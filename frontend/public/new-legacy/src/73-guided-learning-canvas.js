'use strict';

/*
 * PMP 单题深学引导式画布
 * v8.4.27.2：动态进度轨道、画布题目坞与跨题工作区。
 */
(function(){
  const byId=id=>document.getElementById(id);
  const STEP_META={
    1:{tab:'question',title:'先独立作答',hint:'请选择答案和信心程度，不必先寻找关键词。',next:'锁定答案，找关键词',summary:'先凭自己的判断作答，避免提示提前泄露解题方向。'},
    2:{tab:'question',title:'识别决定性关键词',hint:'点击题干中真正影响答案的词句，至少锁定一条线索。',next:'进入局部知识网',summary:'找出题目中的场景、时间点、角色与行动约束。'},
    3:{tab:'graph',title:'回忆局部知识网',hint:'点击关键词和知识节点，至少提炼出一条判断规则。',next:'查看破题思路',summary:'沿着“关键词 → 知识点 → 判断规则”走通本题最短路径。'},
    4:{tab:'notes',title:'把题做透',hint:'检查正确答案、错误选项诱导点，以及下次可复用的判断原则。',next:'用一句话复述',summary:'用结构化复盘理解为什么正确，以及其他选项错在哪里。'},
    5:{tab:'recap',title:'用一句话带走原则',hint:'不用追求标准答案，只写下你下次准备如何判断。',next:'完成本轮',summary:'主动复述一次，让破题原则从“看懂”变成“能调取”。'}
  };
  const state={step:1,maxVisited:1,mode:'guided',confidence:'',startedAt:Date.now(),completed:false,runtimeKey:'',timer:null,referenceVisible:false,renderedMaxVisited:0,renderedCompleted:false};
  const flow=()=>window.KGFlowOrchestrator||null;
  let recapTimer=null;
  let pendingRecap=null;
  const questions=()=>window.KGQuestionRepository||null;

  function currentQuestionKey(){
    const repo=questions();
    if(repo?.currentId)return String(repo.currentId());
    try{return String(PMP_QUESTION_MVP?.sourceQuestionId||PMP_QUESTION_MVP?.id||PMP_QUESTION_MVP?.title||'current')}catch(e){return 'current'}
  }
  function currentUserKey(){
    try{return window.KGLearningSessionStore?.currentUserId?.()||'guest'}catch(e){return 'guest'}
  }
  function currentRuntimeKey(){return currentUserKey()+'::'+currentQuestionKey()}
  function formatDuration(seconds){
    seconds=Math.max(0,Math.floor(Number(seconds)||0));
    const m=Math.floor(seconds/60),s=seconds%60;
    return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  }
  function elapsedSeconds(){return Math.max(0,Math.round((Date.now()-state.startedAt)/1000))}
  function notify(message){
    if(typeof showStatus==='function')showStatus(message);
    else console.info(message);
  }
  function canTrain(message){
    if(typeof qCanOperateCurrentQuestion==='function')return qCanOperateCurrentQuestion(message||'登录后才能继续本轮学习。');
    return true;
  }
  function getRuleText(){
    try{
      const kp=typeof qKeyPathConfig==='function'?qKeyPathConfig():null;
      if(kp?.ruleText)return String(kp.ruleText);
      const concept=(PMP_QUESTION_MVP?.concepts||[]).find(c=>c?.rule||c?.judgementRule||c?.notes);
      return String(concept?.rule||concept?.judgementRule||concept?.notes||concept?.summary||'先识别场景和角色责任，再选择最符合题意的下一步行动。');
    }catch(e){return '先识别场景和角色责任，再选择最符合题意的下一步行动。'}
  }
  function applySession(session){
    if(!session)return false;
    state.step=Math.max(1,Math.min(5,Number(session.currentStep||1)));
    state.maxVisited=Math.max(state.step,Math.min(5,Number(session.maxVisited||state.step)));
    state.mode=session.mode==='explore'?'explore':'guided';
    state.confidence=String(session.confidence||'');
    state.startedAt=Number(session.startedAt||Date.now());
    state.completed=session.status==='completed';
    const recap=byId('qtRecapInput');
    if(recap)recap.value=String(session.conclusion?.learnerSummary||'');
    document.querySelectorAll('input[name="qtConfidence"]').forEach(input=>{input.checked=input.value===state.confidence});
    renderCompletionSummary(session);
    return true;
  }
  function renderCompletionSummary(session){
    const complete=byId('qtCompleteSummary');
    if(!complete)return;
    if(!session||session.status!=='completed'){
      complete.hidden=true;
      complete.innerHTML='';
      return;
    }
    complete.hidden=false;
    complete.innerHTML='<strong>本轮完成 · '+formatDuration(session.durationSeconds||elapsedSeconds())+'</strong><span>'+(session.answer?.isCorrect?'答案判断正确。':'这次遇到了一个值得复习的误判。')+' 你已经完成关键词识别、局部知识网回忆和一句话复述。</span>';
  }
  function resetFallbackState(){
    state.step=1;
    state.maxVisited=1;
    state.mode='guided';
    state.confidence='';
    state.startedAt=Date.now();
    state.completed=false;
    state.referenceVisible=false;
    const input=byId('qtRecapInput');if(input)input.value='';
    document.querySelectorAll('input[name="qtConfidence"]').forEach(input=>input.checked=false);
    renderCompletionSummary(null);
  }
  function syncQuestion(options={}){
    const nextKey=currentRuntimeKey();
    if(state.runtimeKey===nextKey&&!options.force)return false;
    const changed=!!state.runtimeKey&&state.runtimeKey!==nextKey;
    state.runtimeKey=nextKey;
    state.referenceVisible=false;
    state.renderedMaxVisited=0;
    state.renderedCompleted=false;
    const orchestrator=flow();
    if(orchestrator){
      const session=orchestrator.switchQuestion({restartCompleted:options.restartCompleted===undefined?false:!!options.restartCompleted});
      orchestrator.restoreLegacyState(session);
      applySession(session);
    }else resetFallbackState();
    return true;
  }
  function persistFlow(extra={}){
    const orchestrator=flow();
    if(!orchestrator)return null;
    return orchestrator.updateFlow({
      currentStep:state.step,
      maxVisited:state.maxVisited,
      confidence:state.confidence,
      ...extra
    });
  }
  function setPanelVisibility(){
    const tab=STEP_META[state.step].tab;
    if(typeof qSetCaseTab==='function')qSetCaseTab(tab);
    window.KGInfiniteLearningCanvas?.syncFlowState?.({
      step:state.step,
      maxVisited:state.maxVisited,
      mode:state.mode,
      completed:state.completed
    },{focus:false});
  }
  function renderStepper(){
    const workflow=byId('qtWorkflow');
    const completedMilestones=state.completed?4:Math.max(0,Math.min(4,state.maxVisited-1));
    const progress=Math.round((completedMilestones/4)*100);
    if(workflow){
      workflow.style.setProperty('--qt-progress',progress+'%');
      workflow.setAttribute('aria-label','单题深学进度：已完成 '+progress+'%');
      workflow.dataset.progress=String(progress);
    }
    const previousMax=state.renderedMaxVisited;
    const shouldAnimate=previousMax>0&&state.maxVisited>previousMax;
    document.querySelectorAll('.qt-workflow-step').forEach(btn=>{
      const n=Number(btn.dataset.qtStep||0);
      const active=n===state.step&&!state.completed;
      const done=state.completed||n<state.maxVisited;
      btn.classList.toggle('active',active);
      btn.classList.toggle('done',done);
      btn.setAttribute('aria-current',active?'step':'false');
      btn.disabled=state.mode!=='explore'&&n>state.maxVisited;
      if(shouldAnimate&&n===state.maxVisited-1){
        btn.classList.remove('qt-step-complete-pop');
        requestAnimationFrame(()=>{
          btn.classList.add('qt-step-complete-pop');
          setTimeout(()=>btn.classList.remove('qt-step-complete-pop'),580);
        });
      }
      if(state.completed&&!state.renderedCompleted&&n===5){
        btn.classList.remove('qt-step-complete-pop');
        requestAnimationFrame(()=>{
          btn.classList.add('qt-step-complete-pop');
          setTimeout(()=>btn.classList.remove('qt-step-complete-pop'),580);
        });
      }
    });
    state.renderedMaxVisited=state.maxVisited;
    state.renderedCompleted=state.completed;
  }
  function renderRecapHint(){
    const el=byId('qtRecapSuggestions');if(!el)return;
    if(!state.referenceVisible){
      el.innerHTML='<button type="button" class="qt-hint-toggle" id="qtShowReferenceBtn">想不起来？查看参考原则</button>';
      byId('qtShowReferenceBtn')?.addEventListener('click',()=>{state.referenceVisible=true;renderRecapHint()});
      return;
    }
    const rule=getRuleText();
    el.innerHTML='<div class="qt-reference-rule"><strong>参考原则：</strong><br>'+escapeGuided(rule)+'<br><button type="button" id="qtUseReferenceBtn">以此为基础修改</button></div>';
    byId('qtUseReferenceBtn')?.addEventListener('click',()=>{
      const input=byId('qtRecapInput');
      if(input){
        input.value=rule;
        input.focus();
        input.setSelectionRange(input.value.length,input.value.length);
        flow()?.saveConclusion?.(rule);
      }
    });
  }
  function escapeGuided(value){
    return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  }
  function updateGuidedUI(){
    syncQuestion();
    document.body.dataset.qtStep=String(state.step);
    const meta=STEP_META[state.step];
    const title=byId('qtDockTitle'),hint=byId('qtDockHint'),next=byId('qtNextStepBtn'),back=byId('qtBackStepBtn'),summary=byId('qtStepSummary'),questionHint=byId('qtQuestionHint');
    if(title)title.textContent=state.completed?'本轮已完成':meta.title;
    if(hint)hint.textContent=state.completed?'你已经完成一次“题目—知识网—破题原则”的完整闭环。':meta.hint;
    if(summary)summary.textContent=meta.summary;
    if(next){next.textContent='继续';next.setAttribute('aria-label',state.completed?'继续下一题':'继续下一步');}
    if(back){back.hidden=false;back.disabled=state.step===1||state.completed;}
    if(questionHint){
      questionHint.textContent=state.step===1?'先独立选择答案。进入下一步后，题干关键词才可以点击。':'请点击题干中你认为真正决定答案的关键词；背景信息不一定都是有效线索。';
    }
    const answerLocked=state.mode==='guided'&&state.step!==1;
    const group=byId('qtConfidenceGroup');if(group)group.classList.toggle('qt-stage-locked',answerLocked);
    const options=byId('qOptions');if(options)options.classList.toggle('qt-stage-locked',answerLocked);
    setPanelVisibility();
    renderStepper();
    if(state.step===5)renderRecapHint();
    const active=document.querySelector('.qt-workflow-step.active');
    if(active&&active.scrollIntoView&&window.innerWidth<900)active.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
  }
  function goStep(step,options={}){
    state.step=Math.max(1,Math.min(5,Number(step)||1));
    state.maxVisited=Math.max(state.maxVisited,state.step);
    persistFlow();
    updateGuidedUI();
    window.KGInfiniteLearningCanvas?.focusStep?.(state.step,{persist:options.persistViewport!==false});
  }
  function validateStep(){
    if(state.step===1){
      const cardValidation=window.KGCardRuntime?.validate?.('answer-card');
      if(cardValidation&&cardValidation.valid===false){
        notify(cardValidation.errors?.[0]?.message||'请先完成独立作答。');
        return false;
      }
      if(!cardValidation){
        if(typeof qMvpState==='undefined'||!qMvpState.selected){notify('请先选择一个答案。');return false}
        if(!state.confidence){notify('请选择这次判断的信心程度。');return false}
      }
    }
    if(state.step===2){
      if(typeof qMvpState==='undefined'||!qMvpState.found||qMvpState.found.size<1){notify('请至少找出一条决定答案的关键词。');return false}
    }
    if(state.step===3){
      const count=typeof qRuleDoneCount==='function'?qRuleDoneCount():1;
      if(count<1){notify('请点击知识节点，至少提炼出一条判断规则。');return false}
    }
    if(state.step===5){
      const recap=String(byId('qtRecapInput')?.value||'').trim();
      if(recap.length<6){notify('请用一句话写下你准备带走的判断原则。');return false}
    }
    return true;
  }
  function prepareStep(nextStep){
    if(nextStep===3){
      if(typeof qMvpState!=='undefined')qMvpState.graph=true;
      flow()?.captureLegacyState?.({force:true});
      if(typeof renderQuestionTrainer==='function')renderQuestionTrainer();
    }
    if(nextStep===4&&typeof qMvpState!=='undefined'&&!qMvpState.submitted){
      if(typeof submitQuestionAnswer==='function')submitQuestionAnswer();
      flow()?.captureLegacyState?.({force:true});
    }
  }
  function fallbackCompletion(){
    const recap=String(byId('qtRecapInput')?.value||'').trim();
    const correct=typeof qMvpState!=='undefined'&&String(qMvpState.selected)===String(PMP_QUESTION_MVP?.correctAnswer||'');
    return {
      id:'round-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),
      userId:currentUserKey(),questionId:currentQuestionKey(),questionTitle:String(PMP_QUESTION_MVP?.title||''),
      selectedAnswer:String(qMvpState?.selected||''),correctAnswer:String(PMP_QUESTION_MVP?.correctAnswer||''),isCorrect:correct,
      confidence:state.confidence,foundClues:qMvpState?.found?.size||0,recap,durationSeconds:elapsedSeconds(),completedAt:Date.now()
    };
  }
  function finishRound(){
    const recap=String(byId('qtRecapInput')?.value||'').trim();
    const result=flow()?.completeCurrent?.({recap,durationSeconds:elapsedSeconds()});
    const record=result?.record||fallbackCompletion();
    const session=result?.session;
    state.completed=true;
    if(session)applySession(session);
    else{
      const el=byId('qtCompleteSummary');
      if(el){
        el.hidden=false;
        el.innerHTML='<strong>本轮完成 · '+formatDuration(record.durationSeconds)+'</strong><span>'+(record.isCorrect?'答案判断正确。':'这次遇到了一个值得复习的误判。')+' 你已经完成关键词识别、局部知识网回忆和一句话复述。</span>';
      }
    }
    updateGuidedUI();
    notify('本轮学习已完成。');
  }
  function nextAction(){
    if(state.completed){
      if(typeof qbNext==='function')qbNext(1);
      setTimeout(()=>{syncQuestion({force:true,restartCompleted:true});updateGuidedUI()},0);
      return;
    }
    if(!canTrain('登录后才能继续本轮单题深学。'))return;
    flow()?.captureLegacyState?.({force:true});
    if(!validateStep())return;
    if(state.step===5){finishRound();return}
    const next=state.step+1;
    prepareStep(next);
    goStep(next);
  }
  function persistRecapSnapshot(snapshot){
    if(!snapshot)return null;
    const orchestrator=flow();
    if(orchestrator?.saveConclusionFor)return orchestrator.saveConclusionFor(snapshot.questionId,snapshot.userId,snapshot.value);
    if(snapshot.runtimeKey===currentRuntimeKey())return orchestrator?.saveConclusion?.(snapshot.value);
    return null;
  }
  function flushPendingConclusion(){
    if(recapTimer){clearTimeout(recapTimer);recapTimer=null}
    const snapshot=pendingRecap;pendingRecap=null;
    return persistRecapSnapshot(snapshot);
  }
  window.KGGuidedLearningCanvas=Object.assign(window.KGGuidedLearningCanvas||{},{flushPendingConclusion});
  function bindEvents(){
    byId('qtNextStepBtn')?.addEventListener('click',nextAction);
    byId('qtBackStepBtn')?.addEventListener('click',()=>{if(state.step>1)goStep(state.step-1)});
    document.querySelectorAll('.qt-workflow-step').forEach(btn=>btn.addEventListener('click',()=>{
      const n=Number(btn.dataset.qtStep||0);
      if(!n)return;
      if(state.mode==='explore'){
        window.KGInfiniteLearningCanvas?.focusStep?.(n);
        return;
      }
      if(n<=state.maxVisited&&!state.completed)goStep(n);
    }));
    document.querySelectorAll('input[name="qtConfidence"]').forEach(input=>input.addEventListener('change',()=>{
      state.confidence=input.value;
      persistFlow();
    }));
    byId('qtRecapInput')?.addEventListener('input',event=>{
      clearTimeout(recapTimer);
      pendingRecap={
        runtimeKey:currentRuntimeKey(),
        questionId:currentQuestionKey(),
        userId:currentUserKey(),
        value:String(event.currentTarget?.value||'')
      };
      recapTimer=setTimeout(()=>{recapTimer=null;const snapshot=pendingRecap;pendingRecap=null;persistRecapSnapshot(snapshot)},300);
    });
    window.addEventListener('beforeunload',flushPendingConclusion);
    window.addEventListener('kg:learning-session-reset',event=>{
      state.runtimeKey='';
      const session=event.detail?.session;
      if(session)applySession(session);
      else syncQuestion({force:true});
      updateGuidedUI();
    });
    window.addEventListener('kg:learning-session-updated',event=>{
      const session=event.detail?.session;
      if(!session||String(session.questionId)!==currentQuestionKey())return;
      applySession(session);
      updateGuidedUI();
    });
    window.addEventListener('kg:learning-session-changed',event=>{
      const session=event.detail?.session;
      if(!session||String(session.questionId)!==currentQuestionKey())return;
      applySession(session);
      updateGuidedUI();
    });
    window.addEventListener('kg:canvas-card-activated',event=>{
      const step=Number(event.detail?.step||0);
      if(!step)return;
      if(state.mode==='explore'){
        window.KGInfiniteLearningCanvas?.focusStep?.(step,{persist:false});
        return;
      }
      if(step<=state.maxVisited&&!state.completed)goStep(step,{persistViewport:false});
    });
  }
  function wrapLegacyRender(){
    if(typeof renderQuestionTrainer!=='function'||renderQuestionTrainer.__qtGuidedWrapped)return;
    const original=renderQuestionTrainer;
    const wrapped=function(){
      syncQuestion();
      const result=original.apply(this,arguments);
      flow()?.captureLegacyState?.();
      setTimeout(updateGuidedUI,0);
      return result;
    };
    wrapped.__qtGuidedWrapped=true;
    renderQuestionTrainer=wrapped;
  }
  function init(){
    if(!document.body.classList.contains('question-training-page'))return;
    wrapLegacyRender();
    bindEvents();
    const restored=syncQuestion({force:true,restartCompleted:false});
    if(restored&&typeof renderQuestionTrainer==='function')renderQuestionTrainer();
    updateGuidedUI();
    if(state.mode==='guided')setTimeout(()=>window.KGInfiniteLearningCanvas?.focusStep?.(state.step,{instant:true,persist:false}),0);
  }
  document.addEventListener('DOMContentLoaded',init);
})();
