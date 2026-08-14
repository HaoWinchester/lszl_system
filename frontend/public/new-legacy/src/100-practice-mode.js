'use strict';

/*
 * V9.0-P4.0.2 做题模式渐进危险反馈与导航修复。
 * 只读取公开发布试卷与发布快照，不读取教师草稿，不修改题库原题。
 */
(function(global){
  const Store=global.KGAppStorage||{};
  const Keys=global.KGStorageKeys||{};
  const PUBLISHED_PAPERS_KEY=Keys.PUBLISHED_PAPERS||'kg_exam_papers_published_v1';
  const PUBLISHED_BANKS_KEY=Keys.PUBLISHED_BANKS||'kg_question_banks_published_v1';
  const USER_KEY=Keys.AUTH_CURRENT_USER||'kg_local_current_user_v1';
  const HISTORY_PREFIX='kg_practice_history_v1__';
  const ACTIVE_ATTEMPT_PREFIX='kg_practice_active_attempt_v1__';
  const COUNTS=[10,20,60,180];
  const MAX_HEALTH=3;
  const SCHOLAR_MAX_SECONDS=80;
  const CHECKPOINT_INTERVAL=5;
  const FEEDBACK_DELAY=520;
  const RETIRED_SINGLE_DEEP_NOTICE='单题深学已停用，已为你切换到刷题';

  const $=id=>document.getElementById(id);
  const dom={};
  const state={
    releases:[],selectedPaperId:'',libraryFilter:'all',selectedCount:10,order:'paper',mode:'',questions:[],index:0,
    health:MAX_HEALTH,streak:0,experience:0,correct:0,answered:0,startedAt:0,endedAt:0,
    locked:false,active:false,completed:false,lastSettings:null,timerId:0,deadline:0,
    feedbackTimer:0,popTimer:0,toastTimer:0,abandonedRecorded:false,catalogAvailable:false,retiredNavigation:null,retiredNoticeShown:false
  };

  function clone(value){try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
  function safeJson(raw,fallback){try{const parsed=JSON.parse(raw||'');return parsed==null?fallback:parsed}catch(error){return fallback}}
  function read(key,fallback){try{return Store.readJSON?Store.readJSON(key,fallback):safeJson(global.localStorage?.getItem(key),fallback)}catch(error){return fallback}}
  function write(key,value){try{return Store.writeJSON?Store.writeJSON(key,value):(global.localStorage?.setItem(key,JSON.stringify(value)),true)}catch(error){return false}}
  function text(value){return String(value==null?'':value)}
  function readRetiredModeNavigation(search=global.location?.search||''){
    const params=new URLSearchParams(search);
    if(params.get('retiredMode')!=='single_deep_study')return null;
    return Object.freeze({
      retired:true,paperId:text(params.get('paperId')),releaseId:text(params.get('releaseId')),questionId:text(params.get('questionId')),
      notice:RETIRED_SINGLE_DEEP_NOTICE
    });
  }
  function prioritizeRetiredQuestion(questions,questionId){
    const rows=Array.isArray(questions)?questions.slice():[],target=text(questionId);
    const index=target?rows.findIndex(question=>text(question?.id)===target):-1;
    if(index<=0)return rows;
    return [rows[index],...rows.slice(0,index),...rows.slice(index+1)];
  }
  function escapeHTML(value){return text(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}
  function uid(prefix='practice'){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8)}
  function currentUser(){
    try{return text(global.KGAuthCore?.currentUsername?.()||(Store.readString?Store.readString(USER_KEY,''):global.localStorage?.getItem(USER_KEY))||'guest')}catch(error){return 'guest'}
  }
  function historyKey(){return HISTORY_PREFIX+'user__'+encodeURIComponent(currentUser())}
  function activeAttemptKey(){return ACTIVE_ATTEMPT_PREFIX+'user__'+encodeURIComponent(currentUser())}
  function clearActiveAttempt(){try{global.sessionStorage?.removeItem(activeAttemptKey())}catch(error){}}
  function persistActiveAttempt(indexOverride=null){
    if(!state.active)return;
    const release=selectedRelease();
    const attempt={savedAt:Date.now(),paperId:state.selectedPaperId,releaseId:text(release?.releaseId),paperVersion:Number(release?.version||0),selectedCount:state.selectedCount,order:state.order,mode:state.mode,questions:state.questions,index:indexOverride==null?state.index:indexOverride,health:state.health,streak:state.streak,experience:state.experience,correct:state.correct,answered:state.answered,startedAt:state.startedAt,deadline:state.deadline,lastSettings:state.lastSettings};
    try{global.sessionStorage?.setItem(activeAttemptKey(),JSON.stringify(attempt))}catch(error){}
  }
  function loadActiveAttempt(){
    try{
      const attempt=safeJson(global.sessionStorage?.getItem(activeAttemptKey()),null);
      if(!attempt||Date.now()-Number(attempt.savedAt||0)>12*60*60*1000||!Array.isArray(attempt.questions)||!attempt.questions.length){clearActiveAttempt();return null}
      return attempt;
    }catch(error){return null}
  }
  function formatDuration(ms){
    const total=Math.max(0,Math.floor(Number(ms||0)/1000)),minutes=Math.floor(total/60),seconds=total%60;
    return String(minutes).padStart(2,'0')+':'+String(seconds).padStart(2,'0');
  }
  function stemText(question){
    const parts=Array.isArray(question?.stemParts)?question.stemParts:[];
    return parts.length?parts.map(part=>text(part?.text)).join(''):text(question?.stem||question?.title||'');
  }
  function isDeleted(question){return question?.lifecycle?.status==='deleted'||!!question?.deletedAt}
  function normalizeQuestion(question,ref,index){
    const q=clone(question||{}),rawOptions=Array.isArray(q.options)?q.options:[];
    const correct=text(q.correctAnswer||rawOptions.find(option=>option?.correct)?.id);
    const options=rawOptions.map((option,optionIndex)=>({
      id:text(option?.id||String.fromCharCode(65+optionIndex)),
      text:text(option?.text),
      correct:!!option?.correct||text(option?.id)===correct
    })).filter(option=>option.text);
    const resolvedCorrect=correct||text(options.find(option=>option.correct)?.id);
    return {
      id:text(q.id||ref?.questionId||('q-'+index)),bankId:text(ref?.bankId||q.sourceBankId),
      title:text(q.title||'未命名题目'),stem:stemText(q),options,correctAnswer:resolvedCorrect,
      type:text(q.type||'single_choice'),raw:q
    };
  }
  function resolveRelease(release){
    const refs=(Array.isArray(release?.questions)?release.questions:[]).slice().sort((a,b)=>Number(a?.order||0)-Number(b?.order||0));
    const snapshotMap=new Map((Array.isArray(release?.questionSnapshots)?release.questionSnapshots:[]).map(item=>[text(item?.bankId)+'::'+text(item?.questionId),item?.question]));
    const questions=[];
    refs.forEach((ref,index)=>{
      const raw=snapshotMap.get(text(ref?.bankId)+'::'+text(ref?.questionId));
      if(!raw||isDeleted(raw))return;
      const question=normalizeQuestion(raw,ref,index);
      if(question.stem&&question.options.length>=2&&question.correctAnswer)questions.push(question);
    });
    return {
      id:text(release?.paperId||release?.id),paperId:text(release?.paperId||release?.id),releaseId:text(release?.releaseId||release?.id),version:Number(release?.version||0),
      name:text(release?.name||release?.title||'未命名试卷'),subject:text(release?.subject||'PMP'),description:text(release?.description),publishedAt:Number(release?.publishedAt||0),
      status:text(release?.status||'published'),questions,questionCount:questions.length,configuredCount:refs.length,accessPolicy:release?.accessPolicy||{accessLevel:'free'}
    };
  }
  function practiceModeEnabled(release){
    const policy=global.KGPaperLearningModes;
    if(typeof policy?.supports==='function')return policy.supports(release,'practice_mode');
    const explicit=Array.isArray(release?.enabledModes),version=Number(release?.modeConfigVersion||0);
    const aliases={practice:'practice_mode',recall:'deep_recall','deep-recall':'deep_recall',multi_question:'multi_question_canvas','multi-question':'multi_question_canvas',canvas:'multi_question_canvas',single_deep:'single_deep_study','single-deep':'single_deep_study'};
    const modes=explicit?release.enabledModes.map(text).map(mode=>aliases[mode]||mode).filter(Boolean):[];
    if(!explicit)return true;
    if(!modes.length)return version<2;
    if(version<2&&!modes.includes('practice_mode'))return true;
    return modes.includes('practice_mode');
  }
  function publishedStatus(release){
    const policy=global.KGPaperLearningModes;
    return typeof policy?.isPublishedStatus==='function'?policy.isPublishedStatus(release?.status):['published','active','released'].includes(text(release?.status||'published').toLowerCase());
  }
  function paperAccess(release){
    try{return global.KGPaperAccessService?.inspect?.(release)||release?.access||{allowed:true,accessLevel:'free',state:'free'}}catch(error){return {allowed:false,accessLevel:'member',state:'membership_required',code:'MEMBERSHIP_REQUIRED',message:'当前会员权益无法使用。'}}
  }
  function releaseCatalogFallback(release){
    const normalized=resolveRelease(release),access=paperAccess(release);
    return {...normalized,totalCount:normalized.questionCount,accessPolicy:{accessLevel:access.accessLevel||normalized.accessPolicy?.accessLevel||'free'},access};
  }
  function loadReleases(){
    const repo=global.KGPublishedPaperRepository;
    let rows=[];
    if(typeof repo?.listCatalogEntries==='function')rows=repo.listCatalogEntries({mode:'practice_mode'});
    else{
      const raw=read(PUBLISHED_PAPERS_KEY,[]);
      rows=(Array.isArray(raw)?raw:[]).filter(row=>publishedStatus(row)&&practiceModeEnabled(row)).map(releaseCatalogFallback).filter(row=>row.questionCount);
    }
    const unique=new Map();
    rows.slice().sort((a,b)=>Number(b.publishedAt||0)-Number(a.publishedAt||0)).forEach(row=>{
      const id=text(row.paperId||row.id);
      if(id&&!unique.has(id))unique.set(id,{...row,id,paperId:id,questionCount:Number(row.questionCount||row.totalCount||0),access:paperAccess(row)});
    });
    state.releases=[...unique.values()];
    return state.releases;
  }
  function selectedRelease(){return state.releases.find(row=>row.id===state.selectedPaperId)||state.releases[0]||null}
  function showToast(message){
    if(!dom.toast)return;
    dom.toast.textContent=text(message);dom.toast.hidden=false;
    global.clearTimeout(state.toastTimer);state.toastTimer=global.setTimeout(()=>{dom.toast.hidden=true},2600);
  }
  function openMembership(access=paperAccess(selectedRelease())){
    const user=global.KGAuthCore?.currentUser?.()||null;
    if(!user||access?.code==='LOGIN_REQUIRED'){
      global.KGSharedAuthDialog?.open?.('登录学员账号并开通会员，即可使用全部 VIP 试卷。');
      return false;
    }
    if(typeof global.KGUserCenter?.openSubscriptionDetail==='function'){
      closeAllDrawers();
      global.KGUserCenter.openSubscriptionDetail();
      return false;
    }
    showToast(access?.message||'开通会员即可解锁全部 VIP 试卷。');
    return false;
  }
  function shuffle(items){
    const list=items.slice();
    for(let index=list.length-1;index>0;index--){const swap=Math.floor(Math.random()*(index+1));[list[index],list[swap]]=[list[swap],list[index]]}
    return list;
  }
  function streakBonus(streak){if(streak>=8)return 10;if(streak>=5)return 5;if(streak>=3)return 2;return 0}
  function accuracy(){return state.answered?Math.round(state.correct/state.answered*100):0}
  function elapsed(){return Math.max(0,(state.endedAt||Date.now())-state.startedAt)}
  function remainingSeconds(){return Math.max(0,Math.ceil((state.deadline-Date.now())/1000))}
  function clearTimers(){
    if(state.timerId)global.clearInterval(state.timerId);state.timerId=0;
    if(state.feedbackTimer)global.clearTimeout(state.feedbackTimer);state.feedbackTimer=0;
    if(state.popTimer)global.clearTimeout(state.popTimer);state.popTimer=0;
  }
  function setView(name){
    dom.lobby.hidden=name!=='lobby';dom.game.hidden=name!=='game';dom.checkpoint.hidden=name!=='checkpoint';dom.result.hidden=name!=='result';
    document.body.dataset.practiceView=name;
    if(name!=='game')setDangerVignette(false);
  }
  function renderHeartIcon(){
    try{
      if(typeof global.KGLearningIcons?.render==='function'){
        const icon=global.KGLearningIcons.render('heart',{size:18});
        if(typeof icon==='string'&&icon)return icon;
      }
    }catch(error){}
    return '♥';
  }
  function renderHealth(){
    dom.health.innerHTML=Array.from({length:MAX_HEALTH},(_,index)=>'<span class="practice-heart '+(index<state.health?'active':'')+'" aria-hidden="true">'+renderHeartIcon()+'</span>').join('');
    dom.health.setAttribute('aria-label','剩余血量 '+state.health+' / '+MAX_HEALTH);
  }
  function renderProgress(){
    const total=Math.max(1,state.questions.length),value=Math.max(0,Math.min(100,state.index/total*100));
    dom.progressBar.style.width=value+'%';dom.progressShell.setAttribute('aria-valuenow',String(Math.round(value)));
  }
  function dangerStrength(){
    if(!state.active||state.mode!=='scholar')return 0;
    const remaining=Math.max(0,state.deadline-Date.now());
    if(remaining>20000)return 0;
    const urgency=Math.max(0,Math.min(1,(20000-remaining)/20000));
    return Math.pow(urgency,1.18);
  }
  function setDangerVignette(strength){
    if(!dom.dangerVignette)return;
    const value=Math.max(0,Math.min(1,Number(strength)||0));
    dom.dangerVignette.style.setProperty('--practice-danger-strength',value.toFixed(4));
    dom.dangerVignette.style.opacity=(value*.94).toFixed(4);
    dom.dangerVignette.style.animationDuration=(1.85-value*.68).toFixed(3)+'s';
    dom.dangerVignette.style.boxShadow='inset 0 0 '+Math.round(72+value*88)+'px '+Math.round(10+value*28)+'px rgba(225,29,72,'+(0.16+value*.36).toFixed(3)+')';
    dom.dangerVignette.classList.toggle('is-active',value>0.002);
  }
  function renderTimer(){
    if(state.mode!=='scholar'){setDangerVignette(0);return}
    const seconds=remainingSeconds(),ratio=Math.max(0,Math.min(1,seconds/SCHOLAR_MAX_SECONDS));
    dom.timer.querySelector('strong').textContent=String(seconds);dom.timeBar.style.width=(ratio*100)+'%';
    dom.timeRail.classList.toggle('is-tense',seconds<=40&&seconds>20);dom.timeRail.classList.toggle('is-danger',seconds<=20);
    dom.timeRow.classList.toggle('is-tense',seconds<=40&&seconds>20);dom.timeRow.classList.toggle('is-danger',seconds<=20);
    setDangerVignette(dangerStrength());
  }
  function setScholarSeconds(seconds){state.deadline=Date.now()+Math.max(0,Math.min(SCHOLAR_MAX_SECONDS,Number(seconds)||0))*1000;renderTimer()}
  function showFeedback(message,type='success'){
    dom.feedback.textContent=message;dom.feedback.className='practice-feedback '+type;dom.feedback.hidden=false;
    global.clearTimeout(state.feedbackTimer);state.feedbackTimer=global.setTimeout(()=>{dom.feedback.hidden=true},1400);
  }
  function showRetiredModeNotice(){
    if(!state.retiredNavigation||state.retiredNoticeShown||!dom.retiredNotice)return;
    dom.retiredNotice.textContent=state.retiredNavigation.notice;dom.retiredNotice.hidden=false;state.retiredNoticeShown=true;
  }
  function hideStreakPop(){dom.streakPop.hidden=true;global.clearTimeout(state.popTimer);state.popTimer=0}
  function showStreakPop(message){
    dom.streakPop.textContent=message;dom.streakPop.hidden=false;global.clearTimeout(state.popTimer);state.popTimer=0;
  }
  function renderQuestion(){
    const question=state.questions[state.index];
    if(!question){finishPractice();return}
    state.locked=false;dom.feedback.hidden=true;dom.questionCard.classList.remove('is-timeout');
    dom.questionStem.textContent=question.stem;
    dom.options.innerHTML=question.options.map(option=>'<button type="button" class="practice-option" data-option-id="'+escapeHTML(option.id)+'"><span class="practice-option-key">'+escapeHTML(option.id)+'</span><span>'+escapeHTML(option.text)+'</span></button>').join('');
    dom.options.querySelectorAll('[data-option-id]').forEach(button=>button.addEventListener('click',()=>answer(button.dataset.optionId,button)));
    renderProgress();renderHealth();
    if(state.mode==='scholar')renderTimer();
  }
  function lockOptions(){dom.options.querySelectorAll('button').forEach(button=>button.disabled=true)}
  function revealOptionResult(selectedId,correctId){
    const selected=text(selectedId),correct=text(correctId);
    dom.options.querySelectorAll('[data-option-id]').forEach(button=>{
      button.classList.remove('is-correct','is-wrong');
      const id=text(button.dataset.optionId);
      if(id===correct)button.classList.add('is-correct');
      else if(id===selected)button.classList.add('is-wrong');
    });
  }
  function currentRecord(status){
    const release=selectedRelease();return {
      id:uid('practice-record'),status,mode:state.mode,paperId:text(release?.id),releaseId:text(release?.releaseId),paperVersion:Number(release?.version||0),paperName:text(release?.name),
      requestedCount:Number(state.selectedCount),questionCount:state.questions.length,answeredCount:state.answered,correctCount:state.correct,accuracy:accuracy(),experience:state.experience,
      startedAt:state.startedAt,endedAt:state.endedAt||Date.now(),durationMs:Math.max(0,(state.endedAt||Date.now())-state.startedAt),order:state.order,userId:currentUser()
    };
  }
  function saveRecord(status){
    if(!state.startedAt)return null;
    const record=currentRecord(status),history=read(historyKey(),[]),rows=Array.isArray(history)?history:[];
    write(historyKey(),[record,...rows].slice(0,100));return record;
  }
  function advanceAfterAnswer(){
    state.index+=1;
    if(state.index>=state.questions.length||state.health<=0){finishPractice();return}
    persistActiveAttempt();
    if(state.mode==='challenge'&&state.index%CHECKPOINT_INTERVAL===0){showCheckpoint();return}
    renderQuestion();
  }
  function answer(optionId,button){
    if(!state.active||state.locked)return false;
    const question=state.questions[state.index];if(!question)return false;
    state.locked=true;lockOptions();revealOptionResult(optionId,question.correctAnswer);
    const correct=text(optionId)===text(question.correctAnswer);state.answered+=1;
    if(correct){
      state.correct+=1;state.streak+=1;const bonus=streakBonus(state.streak);state.experience+=10+bonus;
      let healed=false;
      if(state.mode==='challenge'&&state.streak%5===0&&state.health<MAX_HEALTH){state.health+=1;healed=true}
      const beforeSeconds=state.mode==='scholar'?remainingSeconds():0;
      if(state.mode==='scholar')setScholarSeconds(Math.min(SCHOLAR_MAX_SECONDS,beforeSeconds+20));
      const gainedSeconds=state.mode==='scholar'?Math.max(0,remainingSeconds()-beforeSeconds):0;
      if(state.streak>=3)showStreakPop('连胜 ×'+state.streak+(bonus?' · +'+bonus+' 经验':'')+(healed?' · +1 ♥':''));
      showFeedback('正确'+(state.mode==='scholar'?(gainedSeconds?' · +'+gainedSeconds+' 秒':' · 时间已满'):'')+' · +'+(10+bonus)+' 经验','success');
    }else{
      state.streak=0;hideStreakPop();state.health=Math.max(0,state.health-1);
      if(state.mode==='scholar'){
        const after=Math.max(0,remainingSeconds()-20);setScholarSeconds(after>0?after:(state.health>0?40:0));
        showFeedback('错误 · -20 秒 · -1 ♥','danger');
      }else showFeedback('失误 · -1 ♥','danger');
    }
    renderHealth();
    persistActiveAttempt(state.index+1);
    state.feedbackTimer=global.setTimeout(advanceAfterAnswer,FEEDBACK_DELAY);return correct;
  }
  function handleTimeout(){
    if(!state.active||state.mode!=='scholar'||state.locked||remainingSeconds()>0)return;
    state.locked=true;lockOptions();state.answered+=1;state.streak=0;hideStreakPop();state.health=Math.max(0,state.health-1);dom.questionCard.classList.add('is-timeout');
    showFeedback('超时 · -1 ♥','danger');renderHealth();
    if(state.health>0)setScholarSeconds(40);
    persistActiveAttempt(state.index+1);
    state.feedbackTimer=global.setTimeout(advanceAfterAnswer,FEEDBACK_DELAY);
  }
  function timerTick(){renderTimer();handleTimeout()}
  function startTimer(){
    if(state.mode!=='scholar')return;setScholarSeconds(SCHOLAR_MAX_SECONDS);state.timerId=global.setInterval(timerTick,120);
  }
  function resumeTimer(){if(state.mode==='scholar'&&!state.timerId)state.timerId=global.setInterval(timerTick,120)}
  function showCheckpoint(){
    state.locked=true;setView('checkpoint');dom.checkpointStreak.textContent=String(state.streak);dom.checkpointExperience.textContent=String(state.experience);dom.checkpointDuration.textContent=formatDuration(elapsed());
  }
  function continueCheckpoint(){if(!state.active)return;setView('game');renderQuestion();persistActiveAttempt()}
  function finishPractice(){
    if(!state.active)return;
    state.active=false;state.completed=true;state.endedAt=Date.now();clearTimers();hideStreakPop();setDangerVignette(false);renderProgress();
    saveRecord('completed');clearActiveAttempt();dom.resultAccuracy.textContent=accuracy()+'%';dom.resultDuration.textContent=formatDuration(elapsed());dom.resultExperience.textContent=String(state.experience);setView('result');renderHistory();
  }
  function abandonPractice(){
    if(!state.active)return;
    state.active=false;state.endedAt=Date.now();clearTimers();hideStreakPop();setDangerVignette(false);if(!state.abandonedRecorded){saveRecord('abandoned');state.abandonedRecorded=true}clearActiveAttempt();closeExitConfirm();showLobby();
  }
  function startPractice(mode){
    const catalog=selectedRelease(),count=Number(state.selectedCount);
    if(!catalog){syncLobby();return false}
    const access=paperAccess(catalog);
    if(!access.allowed)return openMembership(access);
    const repo=global.KGPublishedPaperRepository;
    let questions=[];
    if(typeof repo?.resolvePublishedPaper==='function'){
      const resolved=repo.resolvePublishedPaper({paperId:catalog.paperId||catalog.id,releaseId:catalog.releaseId},{mode:'practice_mode',respectRole:false});
      if(!resolved?.ok){
        if(['LOGIN_REQUIRED','MEMBERSHIP_REQUIRED'].includes(resolved?.code))return openMembership(resolved.access||access);
        showToast(resolved?.message||'试卷暂时无法打开。');
        return false;
      }
      questions=(resolved.items||[]).map((item,index)=>normalizeQuestion(item.question,item.ref,index)).filter(question=>question.stem&&question.options.length>=2&&question.correctAnswer);
    }else questions=(catalog.questions||[]).slice();
    if(questions.length<count){showToast(`当前试卷可用题目不足 ${count} 道。`);syncLobby();return false}
    clearTimers();hideStreakPop();setDangerVignette(false);
    state.mode=mode==='scholar'?'scholar':'challenge';state.order=dom.orderInputs.find(input=>input.checked)?.value||'paper';
    if(state.order==='random')questions=shuffle(questions);
    if(state.retiredNavigation)questions=prioritizeRetiredQuestion(questions,state.retiredNavigation.questionId);
    state.questions=questions.slice(0,count);
    state.index=0;state.health=MAX_HEALTH;state.streak=0;state.experience=0;state.correct=0;state.answered=0;state.startedAt=Date.now();state.endedAt=0;state.locked=false;state.active=true;state.completed=false;state.abandonedRecorded=false;
    state.lastSettings={paperId:catalog.id,count,order:state.order,mode:state.mode};
    dom.timer.hidden=state.mode!=='scholar';dom.timeRow.hidden=state.mode!=='scholar';
    setView('game');renderQuestion();if(state.mode==='scholar')startTimer();persistActiveAttempt();return true;
  }
  function startAgain(){
    const settings=state.lastSettings;if(!settings){showLobby();return}
    state.selectedPaperId=settings.paperId;state.selectedCount=settings.count;state.order=settings.order;
    if(dom.paperSelect)dom.paperSelect.value=settings.paperId;dom.countInputs.forEach(input=>input.checked=Number(input.value)===settings.count);dom.orderInputs.forEach(input=>input.checked=input.value===settings.order);
    startPractice(settings.mode);
  }
  function openExitConfirm(){if(!state.active)return;dom.exitConfirm.hidden=false;dom.exitConfirm.setAttribute('aria-hidden','false')}
  function closeExitConfirm(){dom.exitConfirm.hidden=true;dom.exitConfirm.setAttribute('aria-hidden','true')}
  function restoreActiveAttempt(){
    const attempt=loadActiveAttempt();if(!attempt)return false;
    const release=state.releases.find(row=>row.id===text(attempt.paperId));
    if(!release||text(release.releaseId)!==text(attempt.releaseId)||Number(release.version)!==Number(attempt.paperVersion)){clearActiveAttempt();return false}
    state.selectedPaperId=text(attempt.paperId);state.selectedCount=Number(attempt.selectedCount)||attempt.questions.length;state.order=text(attempt.order)||'paper';state.mode=attempt.mode==='scholar'?'scholar':'challenge';state.questions=clone(attempt.questions);
    state.index=Math.max(0,Number(attempt.index)||0);state.health=Math.max(0,Number(attempt.health));state.streak=Math.max(0,Number(attempt.streak)||0);state.experience=Math.max(0,Number(attempt.experience)||0);state.correct=Math.max(0,Number(attempt.correct)||0);state.answered=Math.max(0,Number(attempt.answered)||0);state.startedAt=Number(attempt.startedAt)||Date.now();state.deadline=Number(attempt.deadline)||0;state.endedAt=0;state.locked=false;state.active=true;state.completed=false;state.abandonedRecorded=false;state.lastSettings=attempt.lastSettings||{paperId:state.selectedPaperId,count:state.selectedCount,order:state.order,mode:state.mode};
    dom.timer.hidden=state.mode!=='scholar';dom.timeRow.hidden=state.mode!=='scholar';
    if(state.index>=state.questions.length||state.health<=0){finishPractice();return true}
    if(state.mode==='challenge'&&state.index>0&&state.index%CHECKPOINT_INTERVAL===0)showCheckpoint();else{setView('game');renderQuestion()}
    if(state.mode==='scholar'){if(!state.deadline)state.deadline=Date.now()+SCHOLAR_MAX_SECONDS*1000;resumeTimer()}
    return true;
  }
  function completedHistory(){
    const history=read(historyKey(),[]);
    return (Array.isArray(history)?history:[]).filter(item=>item?.status==='completed').slice(0,30);
  }
  function renderHistory(){
    const completed=completedHistory();
    if(dom.historyCount){dom.historyCount.textContent=String(completed.length);dom.historyCount.hidden=!completed.length}
    if(dom.historySummary)dom.historySummary.textContent=completed.length?`最近 ${completed.length} 条完成记录`:'暂无练习记录';
    if(dom.clearHistoryBtn)dom.clearHistoryBtn.disabled=!completed.length;
    if(dom.historyEmpty)dom.historyEmpty.hidden=!!completed.length;
    if(dom.historyList)dom.historyList.innerHTML=completed.map(item=>'<article class="practice-history-row"><strong>'+escapeHTML(item.paperName||'未命名试卷')+'</strong><em>'+(item.mode==='scholar'?'学霸':'挑战')+'</em><span>正确率 '+Number(item.accuracy||0)+'%</span><span>'+formatDuration(item.durationMs)+'</span><span>'+Number(item.experience||0)+' 经验</span></article>').join('');
  }
  function clearHistory(){if(global.confirm&&!global.confirm('清空当前账号的练习记录？'))return;write(historyKey(),[]);renderHistory()}
  function setDrawerOpen(drawer,open,focusTarget=null){
    if(!drawer)return;
    drawer.hidden=!open;drawer.setAttribute('aria-hidden',String(!open));
    document.body?.classList.toggle('is-practice-drawer-open',!!open);
    if(open)global.requestAnimationFrame?.(()=>focusTarget?.focus?.());
  }
  function openPaperDrawer(){renderPaperLibrary();setDrawerOpen(dom.paperDrawer,true,dom.paperDrawerClose)}
  function closePaperDrawer(){setDrawerOpen(dom.paperDrawer,false);dom.libraryMoreBtn?.focus?.()}
  function openHistoryDrawer(){renderHistory();setDrawerOpen(dom.historyDrawer,true,dom.historyCloseBtn)}
  function closeHistoryDrawer(){setDrawerOpen(dom.historyDrawer,false);dom.historyOpenBtn?.focus?.()}
  function closeAllDrawers(){
    if(dom.paperDrawer&&!dom.paperDrawer.hidden)setDrawerOpen(dom.paperDrawer,false);
    if(dom.historyDrawer&&!dom.historyDrawer.hidden)setDrawerOpen(dom.historyDrawer,false);
  }
  function syncCountOptions(){
    const release=selectedRelease(),available=Number(release?.questionCount||release?.totalCount||release?.questions?.length||0),access=release?paperAccess(release):{allowed:false};
    let firstEnabled=0,currentEnabled=false;
    const minimum=dom.countInputs[0];
    if(minimum){minimum.value=String(available>0&&available<COUNTS[0]?available:COUNTS[0]);const label=minimum.closest('label')?.querySelector('span');if(label)label.textContent=available>0&&available<COUNTS[0]?'全部 '+available:String(COUNTS[0])}
    dom.countInputs.forEach(input=>{const count=Number(input.value),enabled=available>=count;input.disabled=!enabled;if(enabled&&!firstEnabled)firstEnabled=count;if(enabled&&count===state.selectedCount)currentEnabled=true});
    if(!currentEnabled)state.selectedCount=firstEnabled||10;
    dom.countInputs.forEach(input=>input.checked=Number(input.value)===state.selectedCount);
    dom.startButtons.forEach(button=>{
      button.disabled=!release||!firstEnabled;
      button.classList.toggle('is-upgrade',!!release&&!access.allowed);
      button.textContent=!release?(button.dataset.defaultLabel||button.textContent):(!access.allowed?'开通会员':button.dataset.defaultLabel||button.textContent);
    });
    dom.setupCard?.classList.toggle('is-vip-locked',!!release&&!access.allowed);
  }
  function syncPaperMeta(){
    const release=selectedRelease();
    if(!release){dom.selectedPaperName.textContent='请选择试卷';dom.paperMeta.textContent='暂无可用发布试卷。';return}
    const access=paperAccess(release),count=Number(release.questionCount||release.totalCount||0);
    dom.selectedPaperName.textContent=release.name;
    dom.paperMeta.textContent=release.subject+' · v'+release.version+' · 可练习 '+count+' 题 · '+(release.accessPolicy?.accessLevel==='member'?(access.allowed?'VIP 已解锁':'VIP 会员专属'):'免费');
  }
  function vipBadge(){return '<span class="practice-vip-badge"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 4.3 4.1L12 4l4.7 6.1L21 6l-2 12H5L3 6Zm4.1 9h9.8l.8-4.8-1.4 1.3L12 6l-4.3 5.5-1.4-1.3.8 4.8Z"/></svg>VIP</span>'}
  function paperCardMarkup(row){
    const access=paperAccess(row),vip=row.accessPolicy?.accessLevel==='member',selected=row.id===state.selectedPaperId,count=Number(row.questionCount||row.totalCount||0);
    return `<button type="button" class="practice-paper-card ${selected?'is-selected':''} ${!access.allowed?'is-locked':''}" data-paper-id="${escapeHTML(row.id)}" aria-pressed="${selected}">${vip?vipBadge():''}<div class="practice-paper-card-head"><span class="practice-paper-subject">${escapeHTML(row.subject||'综合')}</span>${vip?'':'<span class="practice-paper-free">免费</span>'}</div><h2>${escapeHTML(row.name)}</h2><p>${escapeHTML(row.description||'已发布练习试卷')}</p><div class="practice-paper-footer"><span>${count} 题 · v${Number(row.version||0)}</span><span class="practice-paper-access">${vip?(access.allowed?'VIP 已解锁':'会员专属'):'直接练习'}</span></div></button>`;
  }
  function syncSelectedPaperCards(){
    document.querySelectorAll('[data-paper-id]').forEach(button=>{const selected=button.dataset.paperId===state.selectedPaperId;button.classList.toggle('is-selected',selected);button.setAttribute('aria-pressed',String(selected))});
  }
  function selectPaper(paperId,{closeDrawer=false}={}){
    if(!state.releases.some(row=>row.id===paperId))return;
    state.selectedPaperId=paperId;
    if(dom.paperSelect)dom.paperSelect.value=paperId;
    syncSelectedPaperCards();syncCountOptions();syncPaperMeta();
    if(closeDrawer)closePaperDrawer();
  }
  function bindPaperCards(container,{closeDrawer=false}={}){
    container?.querySelectorAll('[data-paper-id]').forEach(button=>button.addEventListener('click',()=>selectPaper(button.dataset.paperId||'',{closeDrawer})));
  }
  function renderPaperLibrary(){
    const rows=state.releases.filter(row=>state.libraryFilter==='all'||row.accessPolicy?.accessLevel===state.libraryFilter);
    dom.filterButtons.forEach(button=>button.classList.toggle('is-active',button.dataset.paperFilter===state.libraryFilter));
    const empty='<div class="practice-paper-empty">当前筛选下暂无试卷。</div>';
    if(dom.paperLibrary){dom.paperLibrary.innerHTML=rows.length?rows.map(paperCardMarkup).join(''):empty;bindPaperCards(dom.paperLibrary)}
    if(dom.paperDrawerLibrary){dom.paperDrawerLibrary.innerHTML=rows.length?rows.map(paperCardMarkup).join(''):empty;bindPaperCards(dom.paperDrawerLibrary,{closeDrawer:true})}
    if(dom.librarySummary)dom.librarySummary.textContent=rows.length?`${rows.length} 份可选试卷 · 横向滚动查看更多`:'当前筛选下暂无试卷';
    if(dom.paperDrawerSummary)dom.paperDrawerSummary.textContent=rows.length?`共 ${rows.length} 份已发布试卷`:'当前筛选下暂无试卷';
  }
  function syncLobby(){
    if(!state.catalogAvailable){
      state.releases=[];state.selectedPaperId='';
      if(dom.empty){dom.empty.hidden=false;const title=dom.empty.querySelector('strong'),detail=dom.empty.querySelector('p');if(title)title.textContent='题目目录暂不可用';if(detail)detail.textContent='请稍后刷新页面重试。'}
      if(dom.setupCard)dom.setupCard.hidden=true;if(dom.modeGrid)dom.modeGrid.hidden=true;
      const library=dom.paperLibrary?.closest('.practice-library');if(library)library.hidden=true;
      renderHistory();return;
    }
    const releases=loadReleases();
    const retiredSelection=state.retiredNavigation&&releases.find(row=>
      (state.retiredNavigation.paperId&&row.id===state.retiredNavigation.paperId&&(!state.retiredNavigation.releaseId||row.releaseId===state.retiredNavigation.releaseId))||
      (!state.retiredNavigation.paperId&&state.retiredNavigation.releaseId&&row.releaseId===state.retiredNavigation.releaseId)
    );
    if(retiredSelection)state.selectedPaperId=retiredSelection.id;
    else if(!releases.some(row=>row.id===state.selectedPaperId))state.selectedPaperId=releases.find(row=>paperAccess(row).allowed)?.id||releases[0]?.id||'';
    if(dom.paperSelect){dom.paperSelect.innerHTML=releases.map(row=>'<option value="'+escapeHTML(row.id)+'">'+escapeHTML(row.name)+'</option>').join('');dom.paperSelect.value=state.selectedPaperId}
    dom.empty.hidden=!!releases.length;dom.setupCard.hidden=!releases.length;dom.modeGrid.hidden=!releases.length;
    const library=dom.paperLibrary?.closest('.practice-library');if(library)library.hidden=!releases.length;
    renderPaperLibrary();syncCountOptions();syncPaperMeta();renderHistory();
  }
  function showLobby(){state.completed=false;hideStreakPop();setDangerVignette(0);setView('lobby');syncLobby()}
  function bind(){
    dom.paperSelect?.addEventListener('change',()=>selectPaper(dom.paperSelect.value));
    dom.filterButtons.forEach(button=>button.addEventListener('click',()=>{state.libraryFilter=button.dataset.paperFilter||'all';renderPaperLibrary()}));
    dom.libraryMoreBtn?.addEventListener('click',openPaperDrawer);dom.paperDrawerClose?.addEventListener('click',closePaperDrawer);
    dom.historyOpenBtn?.addEventListener('click',openHistoryDrawer);dom.historyCloseBtn?.addEventListener('click',closeHistoryDrawer);
    dom.paperDrawer?.addEventListener('click',event=>{if(event.target===dom.paperDrawer)closePaperDrawer()});
    dom.historyDrawer?.addEventListener('click',event=>{if(event.target===dom.historyDrawer)closeHistoryDrawer()});
    dom.countInputs.forEach(input=>input.addEventListener('change',()=>{if(input.checked)state.selectedCount=Number(input.value)}));
    dom.startButtons.forEach(button=>button.addEventListener('click',()=>startPractice(button.dataset.practiceStart)));
    dom.exitBtn.addEventListener('click',openExitConfirm);dom.exitCancel.addEventListener('click',closeExitConfirm);dom.exitConfirmBtn.addEventListener('click',abandonPractice);
    dom.exitConfirm.addEventListener('click',event=>{if(event.target===dom.exitConfirm)closeExitConfirm()});
    dom.checkpointContinue.addEventListener('click',continueCheckpoint);dom.againBtn.addEventListener('click',startAgain);dom.lobbyBtn.addEventListener('click',showLobby);dom.clearHistoryBtn.addEventListener('click',clearHistory);
    document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(!dom.exitConfirm.hidden)closeExitConfirm();else if(dom.paperDrawer&&!dom.paperDrawer.hidden)closePaperDrawer();else if(dom.historyDrawer&&!dom.historyDrawer.hidden)closeHistoryDrawer()});
    global.addEventListener('storage',event=>{if(event.key===PUBLISHED_PAPERS_KEY&&!state.active)syncLobby();if(event.key===USER_KEY&&!state.active)renderHistory()});
    global.addEventListener('kg-auth-session-change',()=>{if(!state.active)syncLobby()});
    global.addEventListener('kg-subscription-change',()=>{if(!state.active)syncLobby()});
    global.addEventListener('kg-subscription-plan-change',()=>{if(!state.active)syncLobby()});
    global.addEventListener('kg:published-papers-changed',()=>{if(!state.active)syncLobby()});
    global.addEventListener('pagehide',()=>{const answering=document.body.dataset.practiceView==='game'&&state.locked;persistActiveAttempt(answering?state.index+1:state.index)});
  }
  function cacheDom(){
    Object.assign(dom,{
      lobby:$('practiceLobby'),game:$('practiceGame'),checkpoint:$('practiceCheckpoint'),result:$('practiceResult'),paperSelect:$('practicePaperSelect'),paperMeta:$('practicePaperMeta'),retiredNotice:$('practiceRetiredModeNotice'),selectedPaperName:$('practiceSelectedPaperName'),paperLibrary:$('practicePaperLibrary'),paperDrawerLibrary:$('practicePaperDrawerLibrary'),filterButtons:[...document.querySelectorAll('[data-paper-filter]')],librarySummary:$('practiceLibrarySummary'),paperDrawerSummary:$('practicePaperDrawerSummary'),libraryMoreBtn:$('practiceLibraryMoreBtn'),paperDrawer:$('practicePaperDrawer'),paperDrawerClose:$('practicePaperDrawerClose'),toast:$('practiceToast'),
      setupCard:document.querySelector('.practice-setup-card'),modeGrid:document.querySelector('.practice-mode-grid'),empty:$('practiceEmpty'),countInputs:[...document.querySelectorAll('[name="practiceCount"]')],orderInputs:[...document.querySelectorAll('[name="practiceOrder"]')],startButtons:[...document.querySelectorAll('[data-practice-start]')],
      progressShell:$('practiceProgressShell'),progressBar:$('practiceProgressBar'),health:$('practiceHealth'),timer:$('practiceTimer'),timeRow:$('practiceTimeRow'),timeRail:$('practiceTimeRail'),timeBar:$('practiceTimeBar'),dangerVignette:$('practiceDangerVignette'),streakPop:$('practiceStreakPop'),feedback:$('practiceFeedback'),questionCard:$('practiceQuestionCard'),questionStem:$('practiceQuestionStem'),options:$('practiceOptions'),
      exitBtn:$('practiceExitBtn'),exitConfirm:$('practiceExitConfirm'),exitCancel:$('practiceExitCancel'),exitConfirmBtn:$('practiceExitConfirmBtn'),checkpointStreak:$('practiceCheckpointStreak'),checkpointExperience:$('practiceCheckpointExperience'),checkpointDuration:$('practiceCheckpointDuration'),checkpointContinue:$('practiceCheckpointContinue'),resultAccuracy:$('practiceResultAccuracy'),resultDuration:$('practiceResultDuration'),resultExperience:$('practiceResultExperience'),againBtn:$('practiceAgainBtn'),lobbyBtn:$('practiceLobbyBtn'),historyOpenBtn:$('practiceHistoryOpenBtn'),historyDrawer:$('practiceHistoryDrawer'),historyCloseBtn:$('practiceHistoryCloseBtn'),historyCount:$('practiceHistoryCount'),historySummary:$('practiceHistorySummary'),historyList:$('practiceHistoryList'),historyEmpty:$('practiceHistoryEmpty'),clearHistoryBtn:$('practiceClearHistoryBtn')
    });
  }
  function snapshot(){return {mode:state.mode,index:state.index,health:state.health,streak:state.streak,experience:state.experience,correct:state.correct,answered:state.answered,remainingSeconds:state.mode==='scholar'?remainingSeconds():null,active:state.active,view:document.body.dataset.practiceView||'',questionCount:state.questions.length}}
  async function init(){
    cacheDom();dom.startButtons.forEach(button=>button.dataset.defaultLabel=button.textContent);bind();
    state.retiredNavigation=readRetiredModeNavigation();
    try{await global.KGQuestionCatalogAdapter.ready;state.catalogAvailable=true}catch(error){state.catalogAvailable=false;console.error(error)}
    syncLobby();showRetiredModeNotice();
    if(state.retiredNavigation){clearActiveAttempt();setView('lobby');return}
    if(state.catalogAvailable&&restoreActiveAttempt())return;setView('lobby');
  }

  const api=Object.freeze({init,startPractice,answerById:id=>answer(id,dom.options.querySelector('[data-option-id="'+CSS.escape(text(id))+'"]')),finishPractice,showLobby,loadReleases,snapshot,constants:Object.freeze({COUNTS:[...COUNTS],MAX_HEALTH,SCHOLAR_MAX_SECONDS,CHECKPOINT_INTERVAL})});
  global.KGPracticeMode=api;
  if(typeof module!=='undefined'&&module.exports)module.exports={streakBonus,formatDuration,resolveRelease,practiceModeEnabled,renderHeartIcon,readRetiredModeNavigation,prioritizeRetiredQuestion,constants:api.constants};
  if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',init,{once:true});
})(typeof window!=='undefined'?window:globalThis);
