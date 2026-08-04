'use strict';

/*
 * V9.0-P4.0.2 做题模式渐进危险反馈与导航修复。
 * 只读取公开发布试卷与发布快照，不读取教师草稿，不修改题库原题。
 */
(function(global){
  const PUBLISHED_PAPERS_KEY='kg_exam_papers_published_v1';
  const PUBLISHED_BANKS_KEY='kg_question_banks_published_v1';
  const USER_KEY='kg_local_current_user_v1';
  const HISTORY_PREFIX='kg_practice_history_v1__';
  const COUNTS=[10,20,60,180];
  const MAX_HEALTH=3;
  const SCHOLAR_MAX_SECONDS=80;
  const CHECKPOINT_INTERVAL=5;
  const FEEDBACK_DELAY=520;

  const $=id=>document.getElementById(id);
  const dom={};
  const state={
    releases:[],selectedPaperId:'',selectedCount:10,order:'paper',mode:'',questions:[],index:0,
    health:MAX_HEALTH,streak:0,experience:0,correct:0,answered:0,startedAt:0,endedAt:0,
    locked:false,active:false,completed:false,lastSettings:null,timerId:0,deadline:0,
    feedbackTimer:0,popTimer:0,abandonedRecorded:false
  };

  function clone(value){try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
  function safeJson(raw,fallback){try{const parsed=JSON.parse(raw||'');return parsed==null?fallback:parsed}catch(error){return fallback}}
  function read(key,fallback){try{return safeJson(global.localStorage?.getItem(key),fallback)}catch(error){return fallback}}
  function write(key,value){try{global.localStorage?.setItem(key,JSON.stringify(value));return true}catch(error){return false}}
  function text(value){return String(value==null?'':value)}
  function escapeHTML(value){return text(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}
  function uid(prefix='practice'){return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8)}
  function currentUser(){
    try{return text(global.KGAuthCore?.currentUsername?.()||global.localStorage?.getItem(USER_KEY)||'guest')}catch(error){return 'guest'}
  }
  function historyKey(){return HISTORY_PREFIX+'user__'+encodeURIComponent(currentUser())}
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
  function publicBankQuestionMap(){
    const map=new Map(),banks=read(PUBLISHED_BANKS_KEY,[]);
    (Array.isArray(banks)?banks:[]).forEach(bank=>(Array.isArray(bank?.questions)?bank.questions:[]).forEach(question=>{
      if(!question||isDeleted(question))return;
      map.set(text(bank.id)+'::'+text(question.id),question);
    }));
    return map;
  }
  function resolveRelease(release){
    const snapshotMap=new Map((Array.isArray(release?.questionSnapshots)?release.questionSnapshots:[]).map(item=>[text(item?.bankId)+'::'+text(item?.questionId),item?.question]));
    const bankMap=publicBankQuestionMap();
    const refs=(Array.isArray(release?.questions)?release.questions:[]).slice().sort((a,b)=>Number(a?.order||0)-Number(b?.order||0));
    const questions=[];
    refs.forEach((ref,index)=>{
      const key=text(ref?.bankId)+'::'+text(ref?.questionId),raw=snapshotMap.get(key)||bankMap.get(key);
      if(!raw||isDeleted(raw))return;
      const question=normalizeQuestion(raw,ref,index);
      if(question.stem&&question.options.length>=2&&question.correctAnswer)questions.push(question);
    });
    return {
      id:text(release?.paperId||release?.id),releaseId:text(release?.id||release?.releaseId),version:Number(release?.version||0),
      name:text(release?.name||release?.title||'未命名试卷'),subject:text(release?.subject||'PMP'),publishedAt:Number(release?.publishedAt||0),
      status:text(release?.status||'published'),questions,configuredCount:refs.length
    };
  }
  function loadReleases(){
    const rows=read(PUBLISHED_PAPERS_KEY,[]),normalized=(Array.isArray(rows)?rows:[]).filter(row=>text(row?.status||'published')==='published').map(resolveRelease).filter(row=>row.questions.length);
    const unique=new Map();
    normalized.sort((a,b)=>b.publishedAt-a.publishedAt).forEach(row=>{if(!unique.has(row.id))unique.set(row.id,row)});
    state.releases=[...unique.values()];
    return state.releases;
  }
  function selectedRelease(){return state.releases.find(row=>row.id===state.selectedPaperId)||state.releases[0]||null}
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
  function animateOption(button,correct){if(!button)return;button.classList.remove('is-correct','is-wrong');void button.offsetWidth;button.classList.add(correct?'is-correct':'is-wrong')}
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
    if(state.mode==='challenge'&&state.index%CHECKPOINT_INTERVAL===0){showCheckpoint();return}
    renderQuestion();
  }
  function answer(optionId,button){
    if(!state.active||state.locked)return false;
    const question=state.questions[state.index];if(!question)return false;
    state.locked=true;lockOptions();
    const correct=text(optionId)===text(question.correctAnswer);animateOption(button,correct);state.answered+=1;
    if(correct){
      state.correct+=1;state.streak+=1;const bonus=streakBonus(state.streak);state.experience+=10+bonus;
      let healed=false;
      if(state.mode==='challenge'&&state.streak%5===0&&state.health<MAX_HEALTH){state.health+=1;healed=true}
      if(state.mode==='scholar')setScholarSeconds(Math.min(SCHOLAR_MAX_SECONDS,remainingSeconds()+20));
      if(state.streak>=3)showStreakPop('连胜 ×'+state.streak+(bonus?' · +'+bonus+' 经验':'')+(healed?' · +1 ♥':''));
      showFeedback('正确'+(state.mode==='scholar'?' · +20 秒':'')+' · +'+(10+bonus)+' 经验','success');
    }else{
      state.streak=0;hideStreakPop();state.health=Math.max(0,state.health-1);
      if(state.mode==='scholar'){
        const after=Math.max(0,remainingSeconds()-20);setScholarSeconds(after>0?after:(state.health>0?40:0));
        showFeedback('错误 · -20 秒 · -1 ♥','danger');
      }else showFeedback('失误 · -1 ♥','danger');
    }
    renderHealth();
    state.feedbackTimer=global.setTimeout(advanceAfterAnswer,FEEDBACK_DELAY);return correct;
  }
  function handleTimeout(){
    if(!state.active||state.mode!=='scholar'||state.locked||remainingSeconds()>0)return;
    state.locked=true;lockOptions();state.answered+=1;state.streak=0;hideStreakPop();state.health=Math.max(0,state.health-1);dom.questionCard.classList.add('is-timeout');
    showFeedback('超时 · -1 ♥','danger');renderHealth();
    if(state.health>0)setScholarSeconds(40);
    state.feedbackTimer=global.setTimeout(advanceAfterAnswer,FEEDBACK_DELAY);
  }
  function timerTick(){renderTimer();handleTimeout()}
  function startTimer(){
    if(state.mode!=='scholar')return;setScholarSeconds(SCHOLAR_MAX_SECONDS);state.timerId=global.setInterval(timerTick,120);
  }
  function showCheckpoint(){
    state.locked=true;setView('checkpoint');dom.checkpointStreak.textContent=String(state.streak);dom.checkpointExperience.textContent=String(state.experience);dom.checkpointDuration.textContent=formatDuration(elapsed());
  }
  function continueCheckpoint(){if(!state.active)return;setView('game');renderQuestion()}
  function finishPractice(){
    if(!state.active)return;
    state.active=false;state.completed=true;state.endedAt=Date.now();clearTimers();hideStreakPop();setDangerVignette(false);renderProgress();
    saveRecord('completed');dom.resultAccuracy.textContent=accuracy()+'%';dom.resultDuration.textContent=formatDuration(elapsed());dom.resultExperience.textContent=String(state.experience);setView('result');renderHistory();
  }
  function abandonPractice(){
    if(!state.active)return;
    state.active=false;state.endedAt=Date.now();clearTimers();hideStreakPop();setDangerVignette(false);if(!state.abandonedRecorded){saveRecord('abandoned');state.abandonedRecorded=true}closeExitConfirm();showLobby();
  }
  function startPractice(mode){
    const release=selectedRelease(),count=Number(state.selectedCount);
    if(!release||release.questions.length<count){syncLobby();return false}
    clearTimers();hideStreakPop();setDangerVignette(false);
    state.mode=mode==='scholar'?'scholar':'challenge';state.order=dom.orderInputs.find(input=>input.checked)?.value||'paper';
    let questions=release.questions.slice();if(state.order==='random')questions=shuffle(questions);state.questions=questions.slice(0,count);
    state.index=0;state.health=MAX_HEALTH;state.streak=0;state.experience=0;state.correct=0;state.answered=0;state.startedAt=Date.now();state.endedAt=0;state.locked=false;state.active=true;state.completed=false;state.abandonedRecorded=false;
    state.lastSettings={paperId:release.id,count,order:state.order,mode:state.mode};
    dom.timer.hidden=state.mode!=='scholar';dom.timeRow.hidden=state.mode!=='scholar';
    setView('game');renderQuestion();if(state.mode==='scholar')startTimer();return true;
  }
  function startAgain(){
    const settings=state.lastSettings;if(!settings){showLobby();return}
    state.selectedPaperId=settings.paperId;state.selectedCount=settings.count;state.order=settings.order;
    dom.paperSelect.value=settings.paperId;dom.countInputs.forEach(input=>input.checked=Number(input.value)===settings.count);dom.orderInputs.forEach(input=>input.checked=input.value===settings.order);
    startPractice(settings.mode);
  }
  function openExitConfirm(){if(!state.active)return;dom.exitConfirm.hidden=false;dom.exitConfirm.setAttribute('aria-hidden','false')}
  function closeExitConfirm(){dom.exitConfirm.hidden=true;dom.exitConfirm.setAttribute('aria-hidden','true')}
  function renderHistory(){
    const history=read(historyKey(),[]),completed=(Array.isArray(history)?history:[]).filter(item=>item?.status==='completed').slice(0,6);
    dom.historySection.hidden=!completed.length;
    dom.historyList.innerHTML=completed.map(item=>'<article class="practice-history-row"><strong>'+escapeHTML(item.paperName||'未命名试卷')+'</strong><em>'+(item.mode==='scholar'?'学霸':'挑战')+'</em><span>正确率 '+Number(item.accuracy||0)+'%</span><span>'+formatDuration(item.durationMs)+'</span><span>'+Number(item.experience||0)+' 经验</span></article>').join('');
  }
  function clearHistory(){if(global.confirm&&!global.confirm('清空当前账号的练习记录？'))return;write(historyKey(),[]);renderHistory()}
  function syncCountOptions(){
    const release=selectedRelease(),available=release?.questions.length||0;let firstEnabled=0,currentEnabled=false;
    dom.countInputs.forEach(input=>{const count=Number(input.value),enabled=available>=count;input.disabled=!enabled;if(enabled&&!firstEnabled)firstEnabled=count;if(enabled&&count===state.selectedCount)currentEnabled=true});
    if(!currentEnabled)state.selectedCount=firstEnabled||10;
    dom.countInputs.forEach(input=>input.checked=Number(input.value)===state.selectedCount);
    dom.startButtons.forEach(button=>button.disabled=!release||!firstEnabled);
  }
  function syncPaperMeta(){
    const release=selectedRelease();
    if(!release){dom.paperMeta.textContent='暂无可用发布试卷。';return}
    dom.paperMeta.textContent=release.subject+' · 已发布 v'+release.version+' · 可练习 '+release.questions.length+' 题';
  }
  function syncLobby(){
    const releases=loadReleases();
    if(!releases.some(row=>row.id===state.selectedPaperId))state.selectedPaperId=releases[0]?.id||'';
    dom.paperSelect.innerHTML=releases.length?releases.map(row=>'<option value="'+escapeHTML(row.id)+'">'+escapeHTML(row.name)+' · '+row.questions.length+' 题</option>').join(''):'<option value="">暂无已发布试卷</option>';
    dom.paperSelect.value=state.selectedPaperId;dom.paperSelect.disabled=!releases.length;dom.empty.hidden=!!releases.length;dom.setupCard.hidden=!releases.length;dom.modeGrid.hidden=!releases.length;
    syncCountOptions();syncPaperMeta();renderHistory();
  }
  function showLobby(){state.completed=false;hideStreakPop();setDangerVignette(0);setView('lobby');syncLobby()}
  function bind(){
    dom.paperSelect.addEventListener('change',()=>{state.selectedPaperId=dom.paperSelect.value;syncCountOptions();syncPaperMeta()});
    dom.countInputs.forEach(input=>input.addEventListener('change',()=>{if(input.checked)state.selectedCount=Number(input.value)}));
    dom.startButtons.forEach(button=>button.addEventListener('click',()=>startPractice(button.dataset.practiceStart)));
    dom.exitBtn.addEventListener('click',openExitConfirm);dom.exitCancel.addEventListener('click',closeExitConfirm);dom.exitConfirmBtn.addEventListener('click',abandonPractice);
    dom.exitConfirm.addEventListener('click',event=>{if(event.target===dom.exitConfirm)closeExitConfirm()});
    dom.checkpointContinue.addEventListener('click',continueCheckpoint);dom.againBtn.addEventListener('click',startAgain);dom.lobbyBtn.addEventListener('click',showLobby);dom.clearHistoryBtn.addEventListener('click',clearHistory);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!dom.exitConfirm.hidden)closeExitConfirm()});
    global.addEventListener('storage',event=>{if(event.key===PUBLISHED_PAPERS_KEY&&!state.active)syncLobby();if(event.key===USER_KEY&&!state.active)renderHistory()});
    global.addEventListener('kg-auth-session-change',()=>{if(!state.active)renderHistory()});
    global.addEventListener('pagehide',()=>{if(state.active&&!state.abandonedRecorded){state.endedAt=Date.now();saveRecord('abandoned');state.abandonedRecorded=true}});
  }
  function cacheDom(){
    Object.assign(dom,{
      lobby:$('practiceLobby'),game:$('practiceGame'),checkpoint:$('practiceCheckpoint'),result:$('practiceResult'),paperSelect:$('practicePaperSelect'),paperMeta:$('practicePaperMeta'),
      setupCard:document.querySelector('.practice-setup-card'),modeGrid:document.querySelector('.practice-mode-grid'),empty:$('practiceEmpty'),countInputs:[...document.querySelectorAll('[name="practiceCount"]')],orderInputs:[...document.querySelectorAll('[name="practiceOrder"]')],startButtons:[...document.querySelectorAll('[data-practice-start]')],
      progressShell:$('practiceProgressShell'),progressBar:$('practiceProgressBar'),health:$('practiceHealth'),timer:$('practiceTimer'),timeRow:$('practiceTimeRow'),timeRail:$('practiceTimeRail'),timeBar:$('practiceTimeBar'),dangerVignette:$('practiceDangerVignette'),streakPop:$('practiceStreakPop'),feedback:$('practiceFeedback'),questionCard:$('practiceQuestionCard'),questionStem:$('practiceQuestionStem'),options:$('practiceOptions'),
      exitBtn:$('practiceExitBtn'),exitConfirm:$('practiceExitConfirm'),exitCancel:$('practiceExitCancel'),exitConfirmBtn:$('practiceExitConfirmBtn'),checkpointStreak:$('practiceCheckpointStreak'),checkpointExperience:$('practiceCheckpointExperience'),checkpointDuration:$('practiceCheckpointDuration'),checkpointContinue:$('practiceCheckpointContinue'),resultAccuracy:$('practiceResultAccuracy'),resultDuration:$('practiceResultDuration'),resultExperience:$('practiceResultExperience'),againBtn:$('practiceAgainBtn'),lobbyBtn:$('practiceLobbyBtn'),historySection:$('practiceHistorySection'),historyList:$('practiceHistoryList'),clearHistoryBtn:$('practiceClearHistoryBtn')
    });
  }
  function snapshot(){return {mode:state.mode,index:state.index,health:state.health,streak:state.streak,experience:state.experience,correct:state.correct,answered:state.answered,remainingSeconds:state.mode==='scholar'?remainingSeconds():null,active:state.active,view:document.body.dataset.practiceView||'',questionCount:state.questions.length}}
  function init(){cacheDom();bind();syncLobby();setView('lobby')}

  const api=Object.freeze({init,startPractice,answerById:id=>answer(id,dom.options.querySelector('[data-option-id="'+CSS.escape(text(id))+'"]')),finishPractice,showLobby,loadReleases,snapshot,constants:Object.freeze({COUNTS:[...COUNTS],MAX_HEALTH,SCHOLAR_MAX_SECONDS,CHECKPOINT_INTERVAL})});
  global.KGPracticeMode=api;
  if(typeof module!=='undefined'&&module.exports)module.exports={streakBonus,formatDuration,resolveRelease,renderHeartIcon,constants:api.constants};
  if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',init,{once:true});
})(typeof window!=='undefined'?window:globalThis);
