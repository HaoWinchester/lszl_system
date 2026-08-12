'use strict';

/*
 * V9.0-P4.0.2 做题模式渐进危险反馈与导航修复。
 * 只读取公开发布试卷与发布快照，不读取教师草稿，不修改题库原题。
 */
(function(global){
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
    feedbackTimer:0,popTimer:0,toastTimer:0,abandonedRecorded:false,catalogAvailable:false,retiredNavigation:null,retiredNoticeShown:false,
    remediationPending:false,verification:null
  };

  function clone(value){try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
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
  function hasAuthenticatedUser(){
    try{return !!global.KGAuthCore?.currentUser?.()}catch(error){return false}
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
    const knowledge=q?.metadata?.knowledge||q?.knowledge||{};
    const path=Array.isArray(knowledge.pathSnapshot)?knowledge.pathSnapshot:[];
    return {
      id:text(q.id||ref?.questionId||('q-'+index)),bankId:text(ref?.bankId||q.sourceBankId),
      title:text(q.title||'未命名题目'),stem:stemText(q),options,correctAnswer:resolvedCorrect,
      type:text(q.type||'single_choice'),raw:q,
      knowledge:{taxonomyId:text(knowledge.taxonomyId),nodeId:text(knowledge.primaryNodeId||knowledge.nodeId),title:text(path[path.length-1]||knowledge.title||q.topic),path}
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
      const raw=[];
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
  function practiceApi(){return global.KGPracticeLearningApi||null}
  function getMistakeStats(){try{return practiceApi()?.stats?.()||{active:0,pending:0,needsRemediation:0,mastered:0}}catch(error){return {active:0,pending:0,needsRemediation:0,mastered:0}}}
  function activeMistakeRecords(){try{return practiceApi()?.active?.()||[]}catch(error){return []}}
  function questionFromMistake(record,index){
    const question=normalizeQuestion(record?.questionSnapshot||{}, {bankId:record?.bankId,questionId:record?.questionId}, index);
    question.mistakeId=text(record?.id);question.mistakeStatus=text(record?.status);question.sourceReleaseId=text(record?.releaseId);return question;
  }
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
  function clearVerification(){
    state.verification=null;
    if(dom.verificationBanner)dom.verificationBanner.hidden=true;
    delete document.body.dataset.practicePhase;
  }
  function hideRemediation(){
    state.remediationPending=false;
    if(dom.remediationPanel)dom.remediationPanel.hidden=true;
    if(dom.remediationExplanation){dom.remediationExplanation.hidden=true;dom.remediationExplanation.textContent=''}
  }
  function remediationExplanation(question){return text(question?.raw?.analysis||question?.raw?.explanation||'')}
  function showRemediation(question,{verificationFailed=false,recoveredCorrect=false}={}){
    if(!dom.remediationPanel||!question)return;
    const title=text(question?.knowledge?.title||question?.knowledge?.nodeId||'核心知识点');
    dom.remediationKnowledge.textContent=title;
    dom.remediationMessage.textContent=verificationFailed
      ? '验证题未通过，说明这个知识点还不稳定。请再次查看题目解析后继续补救。'
      : recoveredCorrect
        ? '原错题已经答对。请再做一道同知识点的不同题，确认不是只记住了答案。'
        : '这道题在复仇模式中再次答错。先看解析并重新建立判断规则，再做同知识点验证题。';
    const explanation=remediationExplanation(question);
    if(dom.remediationReviewBtn)dom.remediationReviewBtn.hidden=!explanation;
    if(dom.remediationExplanation)dom.remediationExplanation.textContent=explanation;
    if(dom.remediationContinueBtn)dom.remediationContinueBtn.textContent='开始验证';
    state.remediationPending=true;dom.remediationPanel.hidden=false;
  }
  function toggleRemediationExplanation(){
    if(!dom.remediationExplanation)return;
    const opening=dom.remediationExplanation.hidden;dom.remediationExplanation.hidden=!opening;
    if(dom.remediationReviewBtn)dom.remediationReviewBtn.textContent=opening?'收起题目解析':'查看题目解析';
  }
  function renderVerificationBanner(){
    if(!dom.verificationBanner)return;
    const verification=state.verification;dom.verificationBanner.hidden=!verification?.active;
    if(!verification?.active)return;
    if(dom.verificationKnowledge)dom.verificationKnowledge.textContent=text(verification.sourceQuestion?.knowledge?.title||'核心知识点');
    if(dom.verificationMessage)dom.verificationMessage.textContent='这不是原错题。请用新的题干重新判断，验证刚才补救的知识是否真正掌握。';
  }
  async function startRemediationVerification(){
    if(!state.active||state.mode!=='revenge'||!state.remediationPending)return false;
    const sourceQuestion=state.questions[state.index],api=practiceApi();
    if(!sourceQuestion?.mistakeId||!api)return false;
    try{
      await api.remediationReviewed(sourceQuestion.mistakeId);
      const candidate=await api.verificationCandidate(sourceQuestion.mistakeId);
      if(!candidate?.available){showToast(candidate?.message||'当前没有可用的同知识点验证题。');return false}
      const question=normalizeQuestion(candidate.question,{bankId:candidate.question.bankId,questionId:candidate.question.id},0);
      if(!question.stem||question.options.length<2||!question.correctAnswer){showToast('验证题内容不完整，请稍后再试。');return false}
      state.verification={active:true,sourceQuestion,question};hideRemediation();document.body.dataset.practicePhase='verification';renderQuestion();return true;
    }catch(error){showToast(text(error?.message||'补救验证暂时不可用，请稍后重试。'));return false}
  }
  function finishRemediationVerification(correct){
    const verification=state.verification;if(!verification?.active)return;
    const sourceQuestion=verification.sourceQuestion;clearVerification();
    if(correct){advanceAfterAnswer();return}
    renderQuestion();state.locked=true;lockOptions();showRemediation(sourceQuestion,{verificationFailed:true});
  }
  async function recordMistake(question,{selectedAnswer='',reason='wrong'}={}){
    if(!question||state.mode==='revenge')return null;
    const release=selectedRelease(),api=practiceApi();if(!api||!hasAuthenticatedUser())return null;
    try{return await api.upsertWrong({questionId:question.id,bankId:question.bankId,paperId:text(release?.id),releaseId:text(release?.releaseId),paperVersion:Number(release?.version||0),paperName:text(release?.name),sourceMode:state.mode,languageMode:'zh',selectedAnswer:selectedAnswer||reason})}catch(error){showToast('错题未能保存，请检查网络后重试。');return null}
  }
  function practiceSessionPayload(status){
    const release=selectedRelease(),settings=state.lastSettings||{},paperId=text(settings.paperId||release?.id);
    return {
      mode:state.mode||'challenge',paperId,paperName:text(release?.name||(state.mode==='revenge'?'复仇错题':'练习试卷')),
      answered:state.answered,correct:state.correct,experience:state.experience,durationMs:elapsed(),status
    };
  }
  function recordCompletedSession(status){
    const api=practiceApi();if(!api||!hasAuthenticatedUser())return;
    api.recordSession(practiceSessionPayload(status)).then(()=>{
      if(!dom.historyDrawer?.hidden)renderHistory();
    }).catch(()=>{});
  }
  function historyModeLabel(mode){return ({challenge:'挑战模式',scholar:'学霸模式',revenge:'复仇模式'})[text(mode)]||'练习'}
  function formatHistoryTime(value){
    const date=new Date(value);if(Number.isNaN(date.getTime()))return '刚刚';
    return date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  }
  async function renderHistory(){
    const api=practiceApi();if(!api||!hasAuthenticatedUser()){
      if(dom.historyList)dom.historyList.innerHTML='';if(dom.historyEmpty)dom.historyEmpty.hidden=false;
      if(dom.historySummary)dom.historySummary.textContent='登录后可查看你的学习记录';if(dom.clearHistoryBtn)dom.clearHistoryBtn.disabled=true;
      if(dom.historyCount)dom.historyCount.hidden=true;return;
    }
    try{
      const records=await api.listSessions();
      if(dom.historyList)dom.historyList.innerHTML=records.map(record=>{
        const answered=Math.max(0,Number(record?.answered)||0),correct=Math.max(0,Number(record?.correct)||0),rate=answered?Math.round(correct/answered*100):0;
        return '<article class="practice-history-row"><div><strong>'+escapeHTML(text(record?.paperName||'未命名练习'))+'</strong><span>'+escapeHTML(historyModeLabel(record?.mode))+' · '+escapeHTML(formatHistoryTime(record?.createdAt))+'</span></div><span>正确率 '+rate+'%</span><em>'+escapeHTML(text(record?.status)==='abandoned'?'已退出':'已完成')+'</em></article>';
      }).join('');
      if(dom.historyEmpty)dom.historyEmpty.hidden=records.length>0;
      if(dom.historySummary)dom.historySummary.textContent=records.length?'最近 '+records.length+' 条记录':'暂无练习记录';
      if(dom.clearHistoryBtn)dom.clearHistoryBtn.disabled=!records.length;
      if(dom.historyCount){dom.historyCount.textContent=String(records.length);dom.historyCount.hidden=!records.length}
    }catch(error){
      if(dom.historyList)dom.historyList.innerHTML='';if(dom.historyEmpty){dom.historyEmpty.hidden=false;dom.historyEmpty.textContent='学习记录暂时无法读取，请稍后重试。'}
    }
  }
  async function clearHistory(){
    const api=practiceApi();if(!api||!hasAuthenticatedUser())return;
    try{await api.clearSessions();await renderHistory();showToast('学习记录已清空。')}catch(error){showToast('学习记录未能清空，请稍后重试。')}
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
    const question=state.verification?.active?state.verification.question:state.questions[state.index];
    if(!question){finishPractice();return}
    state.locked=false;dom.feedback.hidden=true;hideRemediation();dom.questionCard.classList.remove('is-timeout');
    dom.questionStem.textContent=question.stem;
    dom.options.innerHTML=question.options.map(option=>'<button type="button" class="practice-option" data-option-id="'+escapeHTML(option.id)+'"><span class="practice-option-key">'+escapeHTML(option.id)+'</span><span>'+escapeHTML(option.text)+'</span></button>').join('');
    dom.options.querySelectorAll('[data-option-id]').forEach(button=>button.addEventListener('click',()=>answer(button.dataset.optionId,button)));
    renderProgress();renderHealth();renderVerificationBanner();
    if(state.mode==='scholar')renderTimer();
  }
  function lockOptions(){dom.options.querySelectorAll('button').forEach(button=>button.disabled=true)}
  function animateOption(button,correct){if(!button)return;button.classList.remove('is-correct','is-wrong');void button.offsetWidth;button.classList.add(correct?'is-correct':'is-wrong')}
  function advanceAfterAnswer(){
    state.index+=1;
    if(state.index>=state.questions.length||state.health<=0){finishPractice();return}
    if(state.mode==='challenge'&&state.index%CHECKPOINT_INTERVAL===0){showCheckpoint();return}
    renderQuestion();
  }
  function answer(optionId,button){
    if(!state.active||state.locked)return false;
    const question=state.verification?.active?state.verification.question:state.questions[state.index];if(!question)return false;
    state.locked=true;lockOptions();
    const correct=text(optionId)===text(question.correctAnswer);animateOption(button,correct);state.answered+=1;
    if(state.verification?.active){
      const verification=state.verification,api=practiceApi();
      if(correct){state.correct+=1;state.experience+=5}else{const correctButton=dom.options.querySelector('[data-option-id="'+CSS.escape(text(question.correctAnswer))+'"]');if(correctButton)correctButton.classList.add('is-correct')}
      Promise.resolve(api?.verify?.(verification.sourceQuestion.mistakeId,{questionId:question.id,selectedAnswer:optionId})).then(result=>{
        verification.sourceQuestion.mistakeStatus=text(result?.mistake?.status||verification.sourceQuestion.mistakeStatus);
        showFeedback(correct?'验证通过 · 明日再验证':'验证未通过 · 继续补救',correct?'success':'danger');
        state.feedbackTimer=global.setTimeout(()=>finishRemediationVerification(correct),correct?900:620);
      }).catch(error=>{showFeedback('验证未保存，请稍后重试','danger');state.locked=false;dom.options.querySelectorAll('button').forEach(item=>item.disabled=false)});
      renderHealth();return correct;
    }
    if(state.mode==='revenge'){
      const api=practiceApi();
      Promise.resolve(api?.answerRevenge?.(question.mistakeId,{correct,selectedAnswer:optionId})).then(updated=>{
        question.mistakeStatus=text(updated?.status||question.mistakeStatus);
        if(correct){state.correct+=1;state.streak+=1;state.experience+=10+streakBonus(state.streak);if(question.mistakeStatus==='needs_remediation'){showFeedback('原错题已答对 · 还需新题验证','success');state.feedbackTimer=global.setTimeout(()=>showRemediation(question,{recoveredCorrect:true}),FEEDBACK_DELAY)}else{showFeedback(question.mistakeStatus==='mastered'?'彻底掌握 · 复仇成功':'复仇成功 · 将安排再次验证','success');state.feedbackTimer=global.setTimeout(advanceAfterAnswer,FEEDBACK_DELAY)}}
        else{state.streak=0;hideStreakPop();const correctButton=dom.options.querySelector('[data-option-id="'+CSS.escape(text(question.correctAnswer))+'"]');if(correctButton)correctButton.classList.add('is-correct');showFeedback('再次答错 · 需要知识补救','danger');showRemediation(question)}
      }).catch(error=>{showFeedback('错题状态未保存，请稍后重试。','danger');state.locked=false;dom.options.querySelectorAll('button').forEach(item=>item.disabled=false)});
      renderHealth();return correct;
    }
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
      recordMistake(question,{selectedAnswer:optionId});state.streak=0;hideStreakPop();state.health=Math.max(0,state.health-1);
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
    state.locked=true;lockOptions();state.answered+=1;recordMistake(state.questions[state.index],{reason:'timeout'});state.streak=0;hideStreakPop();state.health=Math.max(0,state.health-1);dom.questionCard.classList.add('is-timeout');
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
    state.active=false;state.completed=true;state.endedAt=Date.now();clearTimers();hideStreakPop();hideRemediation();clearVerification();setDangerVignette(false);renderProgress();
    recordCompletedSession('completed');dom.resultAccuracy.textContent=accuracy()+'%';dom.resultDuration.textContent=formatDuration(elapsed());dom.resultExperience.textContent=String(state.experience);setView('result');
  }
  function abandonPractice(){
    if(!state.active)return;
    state.active=false;state.endedAt=Date.now();clearTimers();hideStreakPop();hideRemediation();clearVerification();setDangerVignette(false);state.abandonedRecorded=true;recordCompletedSession('abandoned');closeExitConfirm();showLobby();
  }
  function startRevenge(){
    const records=activeMistakeRecords();
    if(!records.length){showToast('暂无待复仇错题，先去挑战或学霸模式练习吧。');return false}
    const questions=records.map(questionFromMistake).filter(question=>question.stem&&question.options.length>=2&&question.correctAnswer);
    if(!questions.length){showToast('错题内容暂不可用，请稍后刷新重试。');return false}
    const count=Math.min(Math.max(1,Number(state.selectedCount)||10),questions.length);
    clearTimers();hideStreakPop();hideRemediation();clearVerification();setDangerVignette(false);
    state.mode='revenge';state.order='weakness_first';state.questions=questions.slice(0,count);state.index=0;state.health=MAX_HEALTH;state.streak=0;state.experience=0;state.correct=0;state.answered=0;state.startedAt=Date.now();state.endedAt=0;state.locked=false;state.active=true;state.completed=false;state.abandonedRecorded=false;
    state.lastSettings={paperId:'',count,order:'weakness_first',mode:'revenge'};document.body.dataset.practiceMode='revenge';dom.timer.hidden=true;dom.timeRow.hidden=true;dom.health.hidden=true;
    setView('game');renderQuestion();return true;
  }
  function startPractice(mode){
    if(mode==='revenge')return startRevenge();
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
    clearTimers();hideStreakPop();hideRemediation();clearVerification();setDangerVignette(false);
    state.mode=mode==='scholar'?'scholar':'challenge';document.body.dataset.practiceMode=state.mode;state.order=dom.orderInputs.find(input=>input.checked)?.value||'paper';
    if(state.order==='random')questions=shuffle(questions);
    if(state.retiredNavigation)questions=prioritizeRetiredQuestion(questions,state.retiredNavigation.questionId);
    state.questions=questions.slice(0,count);
    state.index=0;state.health=MAX_HEALTH;state.streak=0;state.experience=0;state.correct=0;state.answered=0;state.startedAt=Date.now();state.endedAt=0;state.locked=false;state.active=true;state.completed=false;state.abandonedRecorded=false;
    state.lastSettings={paperId:catalog.id,count,order:state.order,mode:state.mode};
    dom.timer.hidden=state.mode!=='scholar';dom.timeRow.hidden=state.mode!=='scholar';
    setView('game');renderQuestion();if(state.mode==='scholar')startTimer();return true;
  }
  function startAgain(){
    const settings=state.lastSettings;if(!settings){showLobby();return}
    state.selectedPaperId=settings.paperId;state.selectedCount=settings.count;state.order=settings.order;
    if(settings.mode==='revenge'){startPractice('revenge');return}
    if(dom.paperSelect)dom.paperSelect.value=settings.paperId;dom.countInputs.forEach(input=>input.checked=Number(input.value)===settings.count);dom.orderInputs.forEach(input=>input.checked=input.value===settings.order);
    startPractice(settings.mode);
  }
  function openExitConfirm(){if(!state.active)return;dom.exitConfirm.hidden=false;dom.exitConfirm.setAttribute('aria-hidden','false')}
  function closeExitConfirm(){dom.exitConfirm.hidden=true;dom.exitConfirm.setAttribute('aria-hidden','true')}
  function setDrawerOpen(drawer,open,focusTarget=null){
    if(!drawer)return;
    drawer.hidden=!open;drawer.setAttribute('aria-hidden',String(!open));
    document.body?.classList.toggle('is-practice-drawer-open',!!open);
    if(open)global.requestAnimationFrame?.(()=>focusTarget?.focus?.());
  }
  function openPaperDrawer(){renderPaperLibrary();setDrawerOpen(dom.paperDrawer,true,dom.paperDrawerClose)}
  function closePaperDrawer(){setDrawerOpen(dom.paperDrawer,false);dom.libraryMoreBtn?.focus?.()}
  function openHistoryDrawer(){setDrawerOpen(dom.historyDrawer,true,dom.historyCloseBtn);renderHistory()}
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
      const revenge=button.dataset.practiceStart==='revenge',revengeAvailable=getMistakeStats().active>0;
      button.disabled=revenge?!revengeAvailable:(!release||!firstEnabled);
      button.classList.toggle('is-upgrade',!!release&&!access.allowed);
      button.textContent=revenge?(revengeAvailable?(button.dataset.defaultLabel||'开始复仇'):'暂无错题'):( !release?(button.dataset.defaultLabel||button.textContent):(!access.allowed?'开通会员':button.dataset.defaultLabel||button.textContent));
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
      return;
    }
    const releases=loadReleases();
    const retiredSelection=state.retiredNavigation&&releases.find(row=>
      (state.retiredNavigation.paperId&&row.id===state.retiredNavigation.paperId&&(!state.retiredNavigation.releaseId||row.releaseId===state.retiredNavigation.releaseId))||
      (!state.retiredNavigation.paperId&&state.retiredNavigation.releaseId&&row.releaseId===state.retiredNavigation.releaseId)
    );
    if(retiredSelection)state.selectedPaperId=retiredSelection.id;
    else if(!releases.some(row=>row.id===state.selectedPaperId))state.selectedPaperId=releases.find(row=>paperAccess(row).allowed)?.id||releases[0]?.id||'';
    if(dom.paperSelect){dom.paperSelect.innerHTML=releases.map(row=>'<option value="'+escapeHTML(row.id)+'">'+escapeHTML(row.name)+'</option>').join('');dom.paperSelect.value=state.selectedPaperId}
    const revengeAvailable=getMistakeStats().active>0;
    dom.empty.hidden=!!releases.length||revengeAvailable;dom.setupCard.hidden=!releases.length;dom.modeGrid.hidden=!releases.length&&!revengeAvailable;
    const library=dom.paperLibrary?.closest('.practice-library');if(library)library.hidden=!releases.length;
    renderPaperLibrary();syncCountOptions();syncPaperMeta();syncRevengeStats();
  }
  function syncRevengeStats(){
    const stats=getMistakeStats();
    if(dom.revengePendingCount)dom.revengePendingCount.textContent=String(stats.pending||0);
    if(dom.revengeRemediationCount)dom.revengeRemediationCount.textContent=String(stats.needsRemediation||0);
    if(dom.revengeMasteredCount)dom.revengeMasteredCount.textContent=String(stats.mastered||0);
  }
  function showLobby(){state.completed=false;hideStreakPop();hideRemediation();clearVerification();setDangerVignette(0);delete document.body.dataset.practiceMode;setView('lobby');syncLobby()}
  function bind(){
    dom.paperSelect?.addEventListener('change',()=>selectPaper(dom.paperSelect.value));
    dom.filterButtons.forEach(button=>button.addEventListener('click',()=>{state.libraryFilter=button.dataset.paperFilter||'all';renderPaperLibrary()}));
    dom.libraryMoreBtn?.addEventListener('click',openPaperDrawer);dom.paperDrawerClose?.addEventListener('click',closePaperDrawer);
    dom.historyOpenBtn?.addEventListener('click',openHistoryDrawer);dom.historyCloseBtn?.addEventListener('click',closeHistoryDrawer);dom.clearHistoryBtn?.addEventListener('click',clearHistory);
    dom.paperDrawer?.addEventListener('click',event=>{if(event.target===dom.paperDrawer)closePaperDrawer()});
    dom.historyDrawer?.addEventListener('click',event=>{if(event.target===dom.historyDrawer)closeHistoryDrawer()});
    dom.countInputs.forEach(input=>input.addEventListener('change',()=>{if(input.checked)state.selectedCount=Number(input.value)}));
    dom.startButtons.forEach(button=>button.addEventListener('click',()=>startPractice(button.dataset.practiceStart)));
    dom.exitBtn.addEventListener('click',openExitConfirm);dom.exitCancel.addEventListener('click',closeExitConfirm);dom.exitConfirmBtn.addEventListener('click',abandonPractice);
    dom.exitConfirm.addEventListener('click',event=>{if(event.target===dom.exitConfirm)closeExitConfirm()});
    dom.checkpointContinue.addEventListener('click',continueCheckpoint);dom.againBtn.addEventListener('click',startAgain);dom.lobbyBtn.addEventListener('click',showLobby);dom.remediationContinueBtn?.addEventListener('click',startRemediationVerification);dom.remediationReviewBtn?.addEventListener('click',toggleRemediationExplanation);
    document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(!dom.exitConfirm.hidden)closeExitConfirm();else if(dom.paperDrawer&&!dom.paperDrawer.hidden)closePaperDrawer();else if(dom.historyDrawer&&!dom.historyDrawer.hidden)closeHistoryDrawer()});
    global.addEventListener('kg-auth-session-change',()=>{if(!state.active)syncLobby()});
    global.addEventListener('kg-subscription-change',()=>{if(!state.active)syncLobby()});
    global.addEventListener('kg-subscription-plan-change',()=>{if(!state.active)syncLobby()});
    global.addEventListener('kg:published-papers-changed',()=>{if(!state.active)syncLobby()});
    global.addEventListener('kg-practice-mistakes-change',()=>{if(!state.active)syncLobby()});
  }
  function cacheDom(){
    Object.assign(dom,{
      lobby:$('practiceLobby'),game:$('practiceGame'),checkpoint:$('practiceCheckpoint'),result:$('practiceResult'),paperSelect:$('practicePaperSelect'),paperMeta:$('practicePaperMeta'),retiredNotice:$('practiceRetiredModeNotice'),selectedPaperName:$('practiceSelectedPaperName'),paperLibrary:$('practicePaperLibrary'),paperDrawerLibrary:$('practicePaperDrawerLibrary'),filterButtons:[...document.querySelectorAll('[data-paper-filter]')],librarySummary:$('practiceLibrarySummary'),paperDrawerSummary:$('practicePaperDrawerSummary'),libraryMoreBtn:$('practiceLibraryMoreBtn'),paperDrawer:$('practicePaperDrawer'),paperDrawerClose:$('practicePaperDrawerClose'),toast:$('practiceToast'),
      setupCard:document.querySelector('.practice-setup-card'),modeGrid:document.querySelector('.practice-mode-grid'),empty:$('practiceEmpty'),countInputs:[...document.querySelectorAll('[name="practiceCount"]')],orderInputs:[...document.querySelectorAll('[name="practiceOrder"]')],startButtons:[...document.querySelectorAll('[data-practice-start]')],revengePendingCount:$('practiceRevengePendingCount'),revengeRemediationCount:$('practiceRevengeRemediationCount'),revengeMasteredCount:$('practiceRevengeMasteredCount'),
      progressShell:$('practiceProgressShell'),progressBar:$('practiceProgressBar'),health:$('practiceHealth'),timer:$('practiceTimer'),timeRow:$('practiceTimeRow'),timeRail:$('practiceTimeRail'),timeBar:$('practiceTimeBar'),dangerVignette:$('practiceDangerVignette'),streakPop:$('practiceStreakPop'),feedback:$('practiceFeedback'),verificationBanner:$('practiceVerificationBanner'),verificationKnowledge:$('practiceVerificationKnowledge'),verificationMessage:$('practiceVerificationMessage'),questionCard:$('practiceQuestionCard'),questionStem:$('practiceQuestionStem'),options:$('practiceOptions'),remediationPanel:$('practiceRemediationPanel'),remediationKnowledge:$('practiceRemediationKnowledge'),remediationMessage:$('practiceRemediationMessage'),remediationReviewBtn:$('practiceRemediationReviewBtn'),remediationContinueBtn:$('practiceRemediationContinueBtn'),remediationExplanation:$('practiceRemediationExplanation'),
      exitBtn:$('practiceExitBtn'),exitConfirm:$('practiceExitConfirm'),exitCancel:$('practiceExitCancel'),exitConfirmBtn:$('practiceExitConfirmBtn'),checkpointStreak:$('practiceCheckpointStreak'),checkpointExperience:$('practiceCheckpointExperience'),checkpointDuration:$('practiceCheckpointDuration'),checkpointContinue:$('practiceCheckpointContinue'),resultAccuracy:$('practiceResultAccuracy'),resultDuration:$('practiceResultDuration'),resultExperience:$('practiceResultExperience'),againBtn:$('practiceAgainBtn'),lobbyBtn:$('practiceLobbyBtn'),historyOpenBtn:$('practiceHistoryOpenBtn'),historyCount:$('practiceHistoryCount'),historyDrawer:$('practiceHistoryDrawer'),historyCloseBtn:$('practiceHistoryCloseBtn'),historySummary:$('practiceHistorySummary'),historyList:$('practiceHistoryList'),historyEmpty:$('practiceHistoryEmpty'),clearHistoryBtn:$('practiceClearHistoryBtn')
    });
  }
  function snapshot(){return {mode:state.mode,index:state.index,health:state.health,streak:state.streak,experience:state.experience,correct:state.correct,answered:state.answered,remainingSeconds:state.mode==='scholar'?remainingSeconds():null,active:state.active,view:document.body.dataset.practiceView||'',questionCount:state.questions.length}}
  async function init(){
    cacheDom();dom.startButtons.forEach(button=>button.dataset.defaultLabel=button.textContent);bind();
    state.retiredNavigation=readRetiredModeNavigation();
    try{await global.KGQuestionCatalogAdapter.ready;state.catalogAvailable=true}catch(error){state.catalogAvailable=false;console.error(error)}
    syncLobby();showRetiredModeNotice();
    if(state.retiredNavigation){setView('lobby');return}
    setView('lobby');
  }

  const api=Object.freeze({init,startPractice,answerById:id=>answer(id,dom.options.querySelector('[data-option-id="'+CSS.escape(text(id))+'"]')),finishPractice,showLobby,loadReleases,snapshot,constants:Object.freeze({COUNTS:[...COUNTS],MAX_HEALTH,SCHOLAR_MAX_SECONDS,CHECKPOINT_INTERVAL})});
  global.KGPracticeMode=api;
  if(typeof module!=='undefined'&&module.exports)module.exports={streakBonus,formatDuration,resolveRelease,practiceModeEnabled,renderHeartIcon,readRetiredModeNavigation,prioritizeRetiredQuestion,constants:api.constants};
  if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',init,{once:true});
})(typeof window!=='undefined'?window:globalThis);
