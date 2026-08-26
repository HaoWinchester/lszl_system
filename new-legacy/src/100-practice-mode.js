'use strict';

/*
 * V9.0-P4.0.2 做题模式渐进危险反馈与导航修复。
 * 只读取公开发布试卷与发布快照，不读取教师草稿，不修改题库原题。
 */
(function(global){
  const COUNTS=[10,20,60,180];
  const MAX_HEALTH=3;
  const SCHOLAR_MAX_SECONDS=60;
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
    remediationPending:false,verification:null,practiceAnswers:{},entryStartingMode:'',
    session:null,report:null,answerSheet:null,mobileAnswerSheet:null,pendingSelection:'',submitting:false,resumeLookupToken:0
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
    // 发布试卷目录由 KGPaperReleaseApi 异步预取；载入前 rows 为空，
    // 载入完成后 adapter 广播 kg:published-papers-changed → syncLobby 重渲染（见下方监听）
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
  function normalizedSession(session){
    return global.KGPracticeSessionCore?.normalizeSession?.(session)||clone(session||{});
  }
  function sessionQuestions(session){
    return (Array.isArray(session?.questions)?session.questions:[]).map((item,index)=>normalizeQuestion(item?.question||{},item,index)).filter(question=>question.stem&&question.options.length>=2&&question.correctAnswer);
  }
  function sessionAnswer(question){return state.session?.answers?.[question?.id]||null}
  function runtimeState(){
    const remainingMs=state.mode==='scholar'?Math.max(0,state.deadline-Date.now()):undefined;
    const runtime={currentIndex:Math.max(0,state.index),health:Math.max(0,Number(state.health)||0),streak:Math.max(0,Number(state.streak)||0),maxStreak:Math.max(0,Number(state.maxStreak)||0),experience:Math.max(0,Number(state.experience)||0),durationMs:elapsed(),languageMode:languageMode(),autoExplain:autoExplainEnabled()};
    if(remainingMs!==undefined)runtime.remainingMs=Math.round(remainingMs);
    return runtime;
  }
  function answerSheetSession(){
    if(state.session)return normalizedSession(state.session);
    return normalizedSession({questions:state.questions.map(question=>({questionId:question.id,question:question.raw})),answers:Object.fromEntries(Object.entries(state.practiceAnswers).map(([index,answer])=>[state.questions[Number(index)]?.id,{selectedAnswer:answer.selected,correct:answer.correct}]).filter(([id])=>id)),runtimeState:{currentIndex:state.index}});
  }
  function renderAnswerSheet(){
    const session=answerSheetSession(),currentId=state.questions[state.index]?.id||'';
    const stats=state.answerSheet?.render?.(session,currentId);
    state.mobileAnswerSheet?.render?.(session,currentId);
    if(dom.answerSheetMobileCount){dom.answerSheetMobileCount.textContent=(stats?.answered||0)+'/'+(stats?.total||state.questions.length||0)}
  }
  function handleSessionError(error,{allowRetry=false}={}){
    if(Number(error?.status)===409){clearTimers();state.locked=true;showFeedback('进度已在另一页更新','danger');showToast('请加载最新进度后继续做题。');return false}
    if(allowRetry){state.locked=false;dom.options.querySelectorAll('button').forEach(item=>item.disabled=false)}
    showFeedback('进度保存失败，请重试。','danger');return false;
  }
  async function persistCurrentIndex(){
    const api=practiceApi();if(!state.session||typeof api?.updateState!=='function')return true;
    try{state.session=normalizedSession(await api.updateState(state.session.id,{revision:state.session.revision,runtimeState:runtimeState()}));renderAnswerSheet();return true}
    catch(error){return handleSessionError(error)}
  }
  function navigateToQuestionId(questionId){
    const index=state.questions.findIndex(question=>question.id===text(questionId));if(index<0||!state.active)return false;
    state.index=index;state.locked=false;dom.feedback.hidden=true;hideRemediation();clearVerification();renderQuestion();persistCurrentIndex();
    closeAnswerSheetDrawer();return true;
  }
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
    if(name!=='game'){setDangerVignette(false);if(dom.questionNav)dom.questionNav.hidden=true}
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
  function challengeInitialHealth(questionCount){
    // 挑战 V2：初始生命 = max(3, ceil(题数 × 30%))；答错 -1，归零仅判失败不中断
    return Math.max(3,Math.ceil(Number(questionCount||0)*0.3));
  }
  function scholarInitialHealth(questionCount){
    // 学霸 V2（高水平稳定挑战）：初始生命 = max(3, ceil(题数 × 10%))；归零立即结束
    return Math.max(3,Math.ceil(Number(questionCount||0)*0.1));
  }
  function renderHealth(){
    if(state.mode==='revenge'){dom.health.hidden=true;return}
    dom.health.hidden=false;
    const total=Number(state.maxHealth||MAX_HEALTH);
    if(total<=10){
      dom.health.innerHTML=Array.from({length:total},(_,index)=>'<span class="practice-heart '+(index<state.health?'active':'')+'" aria-hidden="true">'+renderHeartIcon()+'</span>').join('');
    }else{
      // 大生命值试卷改为紧凑计数显示，避免顶栏被几十颗心挤爆
      dom.health.innerHTML='<span class="practice-heart active" aria-hidden="true">'+renderHeartIcon()+'</span><span class="practice-health-count">'+state.health+'/'+total+'</span>';
    }
    dom.health.setAttribute('aria-label','剩余血量 '+state.health+' / '+total);
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
    const msLeft=Math.max(0,state.deadline-Date.now());
    const seconds=msLeft/1000,ratio=Math.max(0,Math.min(1,seconds/SCHOLAR_MAX_SECONDS));
    // 毫秒级显示（0.1s 精度）与进度条同行，避免秒级跳变的卡顿感
    if(dom.timerMs)dom.timerMs.textContent=(Math.floor(seconds*10)/10).toFixed(1);
    dom.timeBar.style.width=(ratio*100)+'%';
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
  function remediationExplanation(question){
    const raw=question?.raw||{};
    const view=questionLanguageView(question);
    if(view&&view.explanation){
      const markup=escapeHTML(languageText(view.explanation))+englishLine(view.explanation);
      return markup||'';
    }
    return text(raw.analysis||raw.explanation||'')
  }
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
    // 复仇新规则：补救面板出现时自动展开题目解析（答错即见正确答案与解析）
    if(dom.remediationExplanation){
      if(explanation){dom.remediationExplanation.innerHTML=explanation;dom.remediationExplanation.hidden=false}
      else dom.remediationExplanation.hidden=true;
    }
    if(dom.remediationReviewBtn){dom.remediationReviewBtn.hidden=!explanation;dom.remediationReviewBtn.textContent=explanation?'收起题目解析':'查看题目解析'}
    if(dom.remediationContinueBtn){dom.remediationContinueBtn.textContent='开始验证';dom.remediationContinueBtn.hidden=true}
    state.remediationPending=true;dom.remediationPanel.hidden=false;
  }
  function toggleRemediationExplanation(){
    if(!dom.remediationExplanation)return;
    const opening=dom.remediationExplanation.hidden;dom.remediationExplanation.hidden=!opening;
    if(dom.remediationReviewBtn)dom.remediationReviewBtn.textContent=opening?'收起题目解析':'查看题目解析';
    // 展开解析后平滑滚到可见位置（页面允许滚屏）
    if(opening)dom.remediationExplanation.scrollIntoView({behavior:'smooth',block:'nearest'});
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
  function standardAnswerPayload(question,selectedAnswer){
    const release=selectedRelease();
    return {questionId:question.id,bankId:question.bankId,paperId:text(release?.id),releaseId:text(release?.releaseId),paperVersion:Number(release?.version||0),paperName:text(release?.name),sourceMode:state.mode,languageMode:'zh',selectedAnswer:text(selectedAnswer)};
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
      refreshExperiencePanel();
    }).catch(()=>{});
  }
  function historyModeLabel(mode){return ({challenge:'挑战模式',scholar:'学霸模式',revenge:'复仇模式',practice:'练习模式'})[text(mode)]||'练习'}
  function row_paperId(rawId){return text(rawId).replace('__','')}
  function startPaperFromHistory(paperId){
    // 点击学习记录直接进入该试卷练习模式（试卷仍需在发布目录中）
    loadReleases();
    const release=state.releases.find(row=>row.id===paperId||row.paperId===paperId);
    if(!release){showToast('该试卷已不在当前发布目录，无法继续练习。');return}
    state.selectedPaperId=release.id;
    closeHistoryDrawer();
    startPractice('practice');
  }
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
      // 以试卷为记录单位：同卷重复练习只更新次数/最近时间/最近成绩，不新增行
      const byPaper=new Map();
      records.forEach(record=>{
        const paperId=text(record?.paperId)||('__'+text(record?.paperName||'未命名练习'));
        const answered=Math.max(0,Number(record?.answered)||0),correct=Math.max(0,Number(record?.correct)||0);
        const rate=answered?Math.round(correct/answered*100):0;
        const created=Number(new Date(record?.createdAt||0).getTime())||0;
        const row=byPaper.get(paperId);
        if(row){
          row.count+=1;
          if(created>=row.lastAt){row.lastAt=created;row.lastRate=rate;row.paperName=text(record?.paperName)||row.paperName}
        }else byPaper.set(paperId,{paperId:row_paperId(paperId),paperName:text(record?.paperName||'未命名练习'),count:1,lastAt:created,lastRate:rate});
      });
      const papers=[...byPaper.values()].sort((a,b)=>b.lastAt-a.lastAt);
      if(dom.historyList){
        dom.historyList.innerHTML=papers.map(paper=>'<article class="practice-history-row is-paper" data-history-paper="'+escapeHTML(paper.paperId)+'" tabindex="0" role="button" aria-label="练习试卷 '+escapeHTML(paper.paperName)+'"><div><strong>'+escapeHTML(paper.paperName)+'</strong><span>练习 '+paper.count+' 次 · 最近 '+escapeHTML(formatHistoryTime(paper.lastAt))+'</span></div><span>最近正确率 '+paper.lastRate+'%</span><em>进入练习模式</em></article>').join('');
        dom.historyList.querySelectorAll('[data-history-paper]').forEach(row=>{
          row.addEventListener('click',()=>startPaperFromHistory(row.dataset.historyPaper));
        });
      }
      if(dom.historyEmpty)dom.historyEmpty.hidden=papers.length>0;
      if(dom.historySummary)dom.historySummary.textContent=papers.length?'共练习过 '+papers.length+' 份试卷':'暂无练习记录';
      if(dom.clearHistoryBtn)dom.clearHistoryBtn.disabled=!papers.length;
      if(dom.historyCount){dom.historyCount.textContent=String(papers.length);dom.historyCount.hidden=!papers.length}
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
  function languageMode(){
    try{return global.KGActivitySchemaV1?.getLanguageMode?.()||'zh'}catch(error){return 'zh'}
  }
  function languageText(display){
    // 三态取文案：en 缺英文回落中文（录入标准保证双语，不做更复杂降级）
    const lang=languageMode();
    const helpers=global.KGFreeModeLanguage;
    if(helpers?.displayText)return helpers.displayText(display,lang);
    return String(display?.zh||'');
  }
  function englishLine(display){
    if(languageMode()!=='bilingual')return '';
    const helpers=global.KGFreeModeLanguage;
    const text=helpers?.englishLineText?helpers.englishLineText(display):(display?.hasEnglish?String(display.en||''):'');
    return text?'<span class="practice-bilingual-en">'+escapeHTML(text)+'</span>':'';
  }
  function questionLanguageView(question){
    const helpers=global.KGFreeModeLanguage;
    return helpers?.questionView?.(question.raw||question,languageMode())||null;
  }
  function autoExplainEnabled(){
    try{return global.KGActivitySchemaV1?.getPracticeAutoExplain?.()!==false}catch(error){return true}
  }
  function renderPracticeExplanation(question,correct){
    const panel=$('practiceExplanationPanel');if(!panel)return;
    const head=$('practiceExplanationHead'),body=$('practiceExplanationBody');
    const view=questionLanguageView(question);
    const correctText='正确答案：'+text(question.correctAnswer);
    const explanationMarkup=view?escapeHTML(languageText(view.explanation))+englishLine(view.explanation):escapeHTML(text(question?.raw?.analysis||question?.raw?.explanation||'暂无解析'));
    if(head){head.textContent=(correct?'回答正确':'回答错误')+' · '+correctText;head.className='practice-explanation-head '+(correct?'is-correct':'is-wrong')}
    if(body)body.innerHTML='<p class="practice-answer-line">'+escapeHTML(correctText)+'</p>'+explanationMarkup;
    panel.hidden=false;
    panel.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function renderQuestion(){
    const question=state.verification?.active?state.verification.question:state.questions[state.index];
    if(!question){finishPractice();return}
    const savedAnswer=sessionAnswer(question);
    const practiceAnswered=savedAnswer?{selected:text(savedAnswer.selectedAnswer),correct:savedAnswer.correct===true}:state.mode==='practice'?state.practiceAnswers[state.index]:null;
    state.locked=false;dom.feedback.hidden=true;hideRemediation();dom.questionCard.classList.remove('is-timeout');
    if($('practiceExplanationPanel'))$('practiceExplanationPanel').hidden=true;
    const view=questionLanguageView(question);
    if(view){
      dom.questionStem.innerHTML=escapeHTML(languageText(view.stem))+englishLine(view.stem);
      dom.options.innerHTML=question.options.map(option=>{
        const display=view.options.find(item=>item.id===option.id)?.display||{zh:option.text,en:''};
        return '<button type="button" class="practice-option" data-option-id="'+escapeHTML(option.id)+'"><span class="practice-option-key">'+escapeHTML(option.id)+'</span><span>'+escapeHTML(languageText(display))+englishLine(display)+'</span></button>';
      }).join('');
    }else{
      dom.questionStem.textContent=question.stem;
      dom.options.innerHTML=question.options.map(option=>'<button type="button" class="practice-option" data-option-id="'+escapeHTML(option.id)+'"><span class="practice-option-key">'+escapeHTML(option.id)+'</span><span>'+escapeHTML(option.text)+'</span></button>').join('');
    }
    dom.options.querySelectorAll('[data-option-id]').forEach(button=>button.addEventListener('click',()=>answer(button.dataset.optionId,button)));
    if(practiceAnswered){
      state.locked=true;lockOptions();
      revealOptionResult(practiceAnswered.selected,question.correctAnswer);
      renderPracticeExplanation(question,practiceAnswered.correct);
    }
    renderProgress();renderHealth();renderVerificationBanner();
    updateQuestionNav();
    renderAnswerSheet();
    if(state.mode==='scholar')renderTimer();
  }
  function updateQuestionNav(){
    // 三种模式都可通过底部按钮、滑动和答题卡自由跳题。
    if(!dom.questionNav)return;
    const navMode=state.active;
    dom.questionNav.hidden=!navMode;
    // 自动解析开关仅练习模式可用（复仇模式解析由"答错才触发"规则驱动，不受开关控制）
    const autoToggle=document.querySelector('.practice-explanation-toggle');
    if(autoToggle)autoToggle.hidden=state.mode!=='practice';
    if(!navMode)return;
    dom.questionPos.textContent=(state.index+1)+' / '+state.questions.length;
    if(dom.prevBtn)dom.prevBtn.disabled=state.index<=0;
    if(dom.nextBtn)dom.nextBtn.disabled=state.index>=state.questions.length-1;
  }
  function switchQuestion(delta){
    if(!state.active)return false;
    const next=state.index+Number(delta);
    if(next<0||next>=state.questions.length)return false;
    global.clearTimeout(state.feedbackTimer);state.feedbackTimer=0;
    state.index=next;state.locked=false;
    dom.feedback.hidden=true;hideRemediation();clearVerification();
    renderQuestion();
    persistCurrentIndex();
    return true;
  }
  function lockOptions(){dom.options.querySelectorAll('button').forEach(button=>button.disabled=true)}
  function revealOptionResult(selectedId,correctId){
    const selected=text(selectedId),correct=text(correctId);
    dom.options.querySelectorAll('[data-option-id]').forEach(button=>{
      button.classList.remove('is-correct','is-wrong');
      const optionId=text(button.dataset.optionId);
      if(optionId===correct)button.classList.add('is-correct');
      else if(optionId===selected)button.classList.add('is-wrong');
    });
  }
  function advanceAfterAnswer(){
    state.index+=1;
    if(state.index>=state.questions.length){finishPractice();return}
    if(state.health<=0&&state.mode!=='challenge'){finishPractice();return}
    // 挑战 V2：生命归零仅判定挑战失败（弹窗提示），不中断试卷
    if(state.mode==='challenge'&&state.health<=0&&!state.challengeFailedShown){state.challengeFailedShown=true;showChallengeFailDialog()}
    if(state.mode==='challenge'&&state.index%CHECKPOINT_INTERVAL===0){showCheckpoint();return}
    renderQuestion();
  }
  async function answer(optionId,button){
    if(!state.active||state.locked)return false;
    const question=state.verification?.active?state.verification.question:state.questions[state.index];if(!question)return false;
    state.locked=true;lockOptions();
    let correct=text(optionId)===text(question.correctAnswer);
    if(state.session&&!state.verification?.active){
      const api=practiceApi();
      button?.classList.add('is-pending');state.pendingSelection=text(optionId);
      try{
        const result=await api.answerSession(state.session.id,{revision:state.session.revision,questionId:question.id,selectedAnswer:text(optionId)});
        state.session=normalizedSession(result?.session);correct=result?.answer?.correct===true;
        state.pendingSelection='';button?.classList.remove('is-pending');
      }catch(error){
        button?.classList.add('is-pending');
        return handleSessionError(error,{allowRetry:Number(error?.status)!==409});
      }
    }else if(!state.verification?.active&&state.mode!=='revenge'&&hasAuthenticatedUser()){
      const api=practiceApi();
      if(typeof api?.answer!=='function'){showFeedback('作答服务暂不可用，请刷新后重试。','danger');state.locked=false;dom.options.querySelectorAll('button').forEach(item=>item.disabled=false);return false}
      try{
        const result=await api.answer(standardAnswerPayload(question,optionId));
        correct=Boolean(result?.correct);
        question.mistakeStatus=text(result?.mistake?.status||question.mistakeStatus);
      }catch(error){
        showFeedback('作答未保存，请检查网络后重试。','danger');state.locked=false;dom.options.querySelectorAll('button').forEach(item=>item.disabled=false);return false;
      }
    }
    revealOptionResult(optionId,question.correctAnswer);
    if(!state.session&&!state.verification?.active)state.practiceAnswers[state.index]={selected:text(optionId),correct};
    state.answered=state.session?Number(state.session.stats?.answered||0):state.answered+1;
    state.correct=state.session?Math.max(0,Number(state.session.stats?.correct||0)-(correct?1:0)):state.correct;
    if(state.session)renderPracticeExplanation(question,correct);
    renderAnswerSheet();
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
        // 复仇交互原则：答错才触发解析与补救；答对只给成功反馈并继续。
        // 是否真正掌握交给后续不同题目的验证机制判断，不在答对时强弹解析。
        if(correct){
          state.correct+=1;state.streak+=1;state.experience+=10+streakBonus(state.streak);
          if(question.mistakeStatus==='needs_remediation'){
            // 已处 needs_remediation 的题重新答对：后台保留"仍需新题验证"状态，直接进入验证题
            showFeedback('原错题已答对 · 直接进入新题验证','success');
            state.remediationPending=true;
            state.feedbackTimer=global.setTimeout(()=>{startRemediationVerification()},FEEDBACK_DELAY+400);
          }else{
            showFeedback(question.mistakeStatus==='mastered'?'彻底掌握 · 复仇成功':'复仇成功 · 将安排再次验证','success');
            state.feedbackTimer=global.setTimeout(advanceAfterAnswer,FEEDBACK_DELAY);
          }
        }else{
          state.streak=0;hideStreakPop();
          const correctButton=dom.options.querySelector('[data-option-id="'+CSS.escape(text(question.correctAnswer))+'"]');if(correctButton)correctButton.classList.add('is-correct');
          showFeedback('再次答错 · 需要知识补救','danger');
          showRemediation(question);
        }
      }).catch(error=>{showFeedback('错题状态未保存，请稍后重试。','danger');state.locked=false;dom.options.querySelectorAll('button').forEach(item=>item.disabled=false)});
      renderHealth();return correct;
    }
    if(state.mode==='practice'){
      // 练习模式：无生命/计时压力；作答后即时反馈答案与解析，切题由底部导航/滑动驱动
      state.practiceAnswers[state.index]={selected:text(optionId),correct};
      state.locked=true;lockOptions();
      if(correct){state.correct+=1;state.streak+=1;state.experience+=10+streakBonus(state.streak)}
      else state.streak=0;
      showFeedback(correct?'回答正确':'回答错误',correct?'success':'danger');
      if(autoExplainEnabled())renderPracticeExplanation(question,correct);
      else{
        // 自动解析关闭时提供手动查看入口
        const panel=$('practiceExplanationPanel'),actions=$('practiceExplanationActions');
        if(panel&&actions){
          panel.hidden=false;
          $('practiceExplanationHead').textContent=correct?'回答正确':'回答错误';
          $('practiceExplanationHead').className='practice-explanation-head '+(correct?'is-correct':'is-wrong');
          $('practiceExplanationBody').textContent='';
          actions.innerHTML='';
          const btn=document.createElement('button');btn.type='button';btn.textContent='查看解析';
          btn.addEventListener('click',()=>renderPracticeExplanation(question,correct));
          actions.appendChild(btn);
        }
      }
      updateQuestionNav();
      // 最后一题答完自动交卷（记录会话）
      if(state.index>=state.questions.length-1){
        state.feedbackTimer=global.setTimeout(()=>{finishPractice()},1200);
      }
      return correct;
    }
    if(correct){
      state.correct+=1;state.streak+=1;state.maxStreak=Math.max(state.maxStreak||0,state.streak);const bonus=streakBonus(state.streak);state.experience+=10+bonus;
      let healed=false;
      // 学霸 V2：连续答对 5 题回血 1 点，不超过初始生命上限
      if(state.mode==='scholar'&&state.streak%5===0&&state.health<state.maxHealth){state.health+=1;healed=true}
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
    const allAnswered=state.session&&Number(state.session.stats?.unanswered||0)===0;
    state.feedbackTimer=global.setTimeout(allAnswered?finishPractice:advanceAfterAnswer,FEEDBACK_DELAY);return correct;
  }
  function handleTimeout(){
    if(!state.active||state.mode!=='scholar'||state.locked||remainingSeconds()>0)return;
    state.locked=true;lockOptions();state.answered+=1;recordMistake(state.questions[state.index],{reason:'timeout'});state.streak=0;hideStreakPop();state.health=Math.max(0,state.health-1);dom.questionCard.classList.add('is-timeout');
    showFeedback('超时 · -1 ♥','danger');renderHealth();
    if(state.health>0)setScholarSeconds(40);
    state.feedbackTimer=global.setTimeout(advanceAfterAnswer,FEEDBACK_DELAY);
  }
  function timerTick(){renderTimer();handleTimeout()}
  function startTimer({resume=false}={}){
    if(state.mode!=='scholar')return;if(!resume)setScholarSeconds(SCHOLAR_MAX_SECONDS);state.timerId=global.setInterval(timerTick,50);
  }
  function showCheckpoint(){
    state.locked=true;setView('checkpoint');dom.checkpointStreak.textContent=String(state.streak);dom.checkpointExperience.textContent=String(state.experience);dom.checkpointDuration.textContent=formatDuration(elapsed());
  }
  function continueCheckpoint(){if(!state.active)return;setView('game');renderQuestion()}
  function showChallengeFailDialog(){
    if(!dom.failBackdrop)return;
    dom.failBackdrop.hidden=false;
    const continueBtn=dom.failContinueBtn;
    if(continueBtn)continueBtn.focus();
  }
  function closeChallengeFailDialog(){if(dom.failBackdrop)dom.failBackdrop.hidden=true}
  async function finishPractice(){
    if(!state.active||state.submitting)return false;
    if(state.session){
      state.submitting=true;
      try{
        const api=practiceApi();
        const completed=await api.completeSession(state.session.id,{revision:state.session.revision,runtimeState:runtimeState()});
        state.session=normalizedSession(completed?.session);state.report=clone(completed?.report||null);
      }catch(error){state.submitting=false;handleSessionError(error);return false}
      state.submitting=false;
    }
    state.active=false;state.completed=true;state.endedAt=Date.now();clearTimers();hideStreakPop();hideRemediation();clearVerification();setDangerVignette(false);renderProgress();closeChallengeFailDialog();
    if(!state.session)recordCompletedSession('completed');dom.resultAccuracy.textContent=(state.report?.scorePercent??accuracy())+'%';dom.resultDuration.textContent=formatDuration(state.report?.durationMs??elapsed());dom.resultExperience.textContent=String(state.experience);
    // 挑战 V2 结果页双展示：试卷完成结果 + 挑战模式结果（独立判定：生命值 > 0 为成功）
    // 学霸 V2：生命归零立即结束判定失败，结果含完成状态/剩余生命/最高连胜
    if(dom.challengeOutcome){
      const isChallenge=state.mode==='challenge';
      const isScholar=state.mode==='scholar';
      dom.challengeOutcome.hidden=!(isChallenge||isScholar);
      if(isChallenge){
        const success=state.health>0;
        dom.challengeResult.textContent=success?'挑战成功':'挑战失败';
        dom.challengeResult.className=success?'is-success':'is-failed';
        dom.challengeDetail.textContent='剩余生命 '+state.health+' / '+(state.maxHealth||MAX_HEALTH);
      }else if(isScholar){
        const success=state.health>0;
        const completed=state.index>=state.questions.length;
        dom.challengeResult.textContent=success?'学霸挑战成功':'学霸挑战失败';
        dom.challengeResult.className=success?'is-success':'is-failed';
        dom.challengeDetail.textContent=(completed?'已完成全部题目':'完成 '+state.index+' / '+state.questions.length+' 题')+' · 剩余生命 '+state.health+' / '+(state.maxHealth||MAX_HEALTH)+' · 最高连胜 '+(state.maxStreak||0);
      }
    }
    setView('result');
    return true;
  }
  async function abandonPractice(){
    if(!state.active)return false;
    if(state.session){
      try{const api=practiceApi();state.session=normalizedSession(await api.abandonSession(state.session.id,{revision:state.session.revision,runtimeState:runtimeState()}))}
      catch(error){handleSessionError(error,{allowRetry:true});return false}
    }
    state.active=false;state.endedAt=Date.now();clearTimers();hideStreakPop();hideRemediation();clearVerification();setDangerVignette(false);state.abandonedRecorded=true;if(!state.session)recordCompletedSession('abandoned');closeExitConfirm();showLobby();return true;
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
  function setEntryStarting(mode,starting,{focus=false}={}){
    const activeMode=starting?String(mode||''):String(state.entryStartingMode||mode||'');
    state.entryStartingMode=starting?activeMode:'';
    const button=dom.startButtons.find(item=>item.dataset.practiceStart===activeMode);
    if(!button)return;
    button.setAttribute('aria-busy',String(!!starting));
    if(starting)button.disabled=true;
    else{
      syncCountOptions();
      if(focus&&!button.disabled)button.focus();
    }
  }
  function restoreServerSession(session,catalog){
    state.session=normalizedSession(session);state.report=null;state.mode=state.session.mode;state.questions=sessionQuestions(state.session);
    const runtime=state.session.runtimeState||{},stats=state.session.stats||{};
    state.index=Math.max(0,Math.min(state.questions.length-1,Number(runtime.currentIndex)||0));
    state.maxHealth=state.mode==='challenge'?challengeInitialHealth(state.questions.length):state.mode==='scholar'?scholarInitialHealth(state.questions.length):MAX_HEALTH;
    state.health=Number.isInteger(runtime.health)?runtime.health:state.maxHealth;state.streak=Math.max(0,Number(runtime.streak)||0);state.maxStreak=Math.max(0,Number(runtime.maxStreak)||0);state.experience=Math.max(0,Number(runtime.experience??stats.experience)||0);state.correct=Math.max(0,Number(stats.correct)||0);state.answered=Math.max(0,Number(stats.answered)||0);
    state.startedAt=Date.now()-Math.max(0,Number(stats.durationMs)||0);state.endedAt=0;state.locked=false;state.active=true;state.completed=false;state.abandonedRecorded=false;state.practiceAnswers={};state.challengeFailedShown=false;
    state.lastSettings={paperId:catalog.id,count:state.questions.length,order:text(runtime.order||state.order||'paper'),mode:state.mode};document.body.dataset.practiceMode=state.mode;
    if(state.mode==='scholar')state.deadline=Date.now()+Math.max(0,Number(runtime.remainingMs)||SCHOLAR_MAX_SECONDS*1000);
    dom.timer.hidden=true;dom.timeRow.hidden=state.mode!=='scholar';dom.health.hidden=false;
    setView('game');renderQuestion();if(state.mode==='scholar')startTimer({resume:true});
    return true;
  }
  async function startPractice(mode){
    const challenge=mode==='challenge';
    const loadingEntry=mode!=='revenge';
    if(loadingEntry&&state.entryStartingMode)return false;
    if(mode==='revenge')return startRevenge();
    const catalog=selectedRelease(),count=Number(state.selectedCount);
    if(!catalog){syncLobby();return false}
    const access=paperAccess(catalog);
    if(!access.allowed)return openMembership(access);
    let restoreFocus=false;
    if(loadingEntry){
      setEntryStarting(mode,true);
      global.KGLearningLoading?.show?.({title:challenge?'正在准备挑战':'正在进入练习模式',message:'正在读取试题…'});
    }
    try{
      const api=practiceApi();
      if(hasAuthenticatedUser()&&typeof api?.startSession==='function'){
        const releaseId=text(catalog.releaseId),paperId=text(catalog.paperId||catalog.id),order=dom.orderInputs.find(input=>input.checked)?.value||'paper';
        const active=await api.getActiveSessions({releaseId,mode});
        const session=active[0]?await api.getSession(active[0].id):await api.startSession({paperId,releaseId,mode,count,order});
        state.order=order;
        return restoreServerSession(session,catalog);
      }
      const repo=global.KGPublishedPaperRepository;
      let questions=[];
      if(typeof repo?.resolvePublishedPaper==='function'){
        const resolved=await repo.resolvePublishedPaper({paperId:catalog.paperId||catalog.id,releaseId:catalog.releaseId},{mode:'practice_mode',respectRole:false});
        if(!resolved?.ok){
          if(['LOGIN_REQUIRED','MEMBERSHIP_REQUIRED'].includes(resolved?.code))return openMembership(resolved.access||access);
          restoreFocus=true;
          showToast(resolved?.message||'试卷暂时无法打开。');
          return false;
        }
        questions=(resolved.items||[]).map((item,index)=>normalizeQuestion(item.question,item.ref,index)).filter(question=>question.stem&&question.options.length>=2&&question.correctAnswer);
      }else questions=(catalog.questions||[]).slice();
      if(questions.length<count){restoreFocus=true;showToast(`当前试卷可用题目不足 ${count} 道。`);syncLobby();return false}
      clearTimers();hideStreakPop();hideRemediation();clearVerification();setDangerVignette(false);
      state.session=null;state.report=null;
      state.mode=mode==='scholar'?'scholar':mode==='practice'?'practice':'challenge';document.body.dataset.practiceMode=state.mode;state.order=dom.orderInputs.find(input=>input.checked)?.value||'paper';
      if(state.order==='random')questions=shuffle(questions);
      if(state.retiredNavigation)questions=prioritizeRetiredQuestion(questions,state.retiredNavigation.questionId);
      state.questions=questions.slice(0,count);
      state.index=0;state.maxHealth=state.mode==='challenge'?challengeInitialHealth(state.questions.length):state.mode==='scholar'?scholarInitialHealth(state.questions.length):MAX_HEALTH;state.health=state.maxHealth;state.challengeFailedShown=false;state.practiceAnswers={};state.streak=0;state.maxStreak=0;state.experience=0;state.correct=0;state.answered=0;state.startedAt=Date.now();state.endedAt=0;state.locked=false;state.active=true;state.completed=false;state.abandonedRecorded=false;
      state.lastSettings={paperId:catalog.id,count,order:state.order,mode:state.mode};
      dom.timer.hidden=true;dom.timeRow.hidden=state.mode!=='scholar';dom.health.hidden=state.mode==='practice';
      setView('game');renderQuestion();if(state.mode==='scholar')startTimer();return true;
    }catch(error){
      if(!loadingEntry)throw error;
      restoreFocus=true;
      showToast('试题读取失败，请稍后重试。');
      return false;
    }finally{
      if(loadingEntry){
        global.KGLearningLoading?.hide?.();
        setEntryStarting(mode,false,{focus:restoreFocus});
      }
    }
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
  function openAnswerSheetDrawer(){renderAnswerSheet();setDrawerOpen(dom.answerSheetDrawer,true,dom.answerSheetDrawerClose);dom.answerSheetMobileBtn?.setAttribute('aria-expanded','true')}
  function closeAnswerSheetDrawer(){setDrawerOpen(dom.answerSheetDrawer,false);dom.answerSheetMobileBtn?.setAttribute('aria-expanded','false')}
  function openSubmitConfirm(){
    const stats=global.KGPracticeSessionCore?.answerSheetStats?.(answerSheetSession())||{unanswered:0};
    if(!stats.unanswered){finishPractice();return}
    if(dom.submitMessage)dom.submitMessage.textContent=`还有 ${stats.unanswered} 题未作答，未答题将按 0 分计入模拟成绩。`;
    dom.submitConfirm.hidden=false;dom.submitConfirm.setAttribute('aria-hidden','false');
  }
  function closeSubmitConfirm(){dom.submitConfirm.hidden=true;dom.submitConfirm.setAttribute('aria-hidden','true')}
  function returnToFirstUnanswered(){
    const session=answerSheetSession(),question=(session.questions||[]).find(item=>global.KGPracticeSessionCore?.questionStatus?.(session,item.questionId)==='unanswered');
    closeSubmitConfirm();if(question)navigateToQuestionId(question.questionId);
  }
  async function saveAndExit(){
    if(!state.active||!state.session){showToast('当前练习无法保存，请继续作答或放弃。');return false}
    try{const api=practiceApi();state.session=normalizedSession(await api.pauseSession(state.session.id,{revision:state.session.revision,runtimeState:runtimeState()}))}
    catch(error){handleSessionError(error,{allowRetry:true});return false}
    state.active=false;clearTimers();closeExitConfirm();showLobby();return true;
  }
  function closeAllDrawers(){
    if(dom.paperDrawer&&!dom.paperDrawer.hidden)setDrawerOpen(dom.paperDrawer,false);
    if(dom.historyDrawer&&!dom.historyDrawer.hidden)setDrawerOpen(dom.historyDrawer,false);
    if(dom.answerSheetDrawer&&!dom.answerSheetDrawer.hidden)closeAnswerSheetDrawer();
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
  async function syncResumableButtons(){
    const release=selectedRelease(),api=practiceApi(),token=++state.resumeLookupToken;
    if(!release||!hasAuthenticatedUser()||typeof api?.getActiveSessions!=='function')return;
    try{
      const rows=(await Promise.all(['challenge','scholar','revenge'].map(async mode=>({mode,sessions:await api.getActiveSessions({releaseId:release.releaseId,mode})}))));
      if(token!==state.resumeLookupToken||release.id!==selectedRelease()?.id)return;
      rows.forEach(({mode,sessions})=>{
        const button=dom.startButtons.find(item=>item.dataset.practiceStart===mode),session=sessions[0];if(!button||!session)return;
        const stats=session.stats||{};button.disabled=false;button.textContent='继续上次练习 '+Number(stats.answered||0)+'/'+Number(stats.total||0);
      });
    }catch(error){}
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
    syncSelectedPaperCards();syncCountOptions();syncPaperMeta();syncResumableButtons();
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
    // 练习模式不依赖题库目录，试卷数据已包含题目快照
    // if(!state.catalogAvailable){
    //   state.releases=[];state.selectedPaperId='';
    //   if(dom.empty){dom.empty.hidden=false;const title=dom.empty.querySelector('strong'),detail=dom.empty.querySelector('p');if(title)title.textContent='题目目录暂不可用';if(detail)detail.textContent='请稍后刷新页面重试。'}
    //   if(dom.setupCard)dom.setupCard.hidden=true;if(dom.modeGrid)dom.modeGrid.hidden=true;
    //   const library=dom.paperLibrary?.closest('.practice-library');if(library)library.hidden=true;
    //   return;
    // }
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
    renderPaperLibrary();syncCountOptions();syncPaperMeta();syncRevengeStats();syncResumableButtons();
  }
  function syncRevengeStats(){
    const stats=getMistakeStats();
    if(dom.revengePendingCount)dom.revengePendingCount.textContent=String(stats.pending||0);
    if(dom.revengeRemediationCount)dom.revengeRemediationCount.textContent=String(stats.needsRemediation||0);
    if(dom.revengeMasteredCount)dom.revengeMasteredCount.textContent=String(stats.mastered||0);
  }
  // ---- 做题经验面板（仅统计做题系统产生的经验；数据来自 practice.session 事件聚合）----
  function expChartMarkup(daily){
    const values=daily.map(day=>Number(day.experience)||0);
    const max=Math.max(10,...values);
    const width=236,height=84,pad=6;
    const stepX=values.length>1?(width-pad*2)/(values.length-1):0;
    const points=values.map((value,index)=>({
      x:pad+index*stepX,
      y:height-pad-(value/max)*(height-pad*2)
    }));
    const polyline=points.map(point=>point.x.toFixed(1)+','+point.y.toFixed(1)).join(' ');
    const circles=points.map((point,index)=>'<circle cx="'+point.x.toFixed(1)+'" cy="'+point.y.toFixed(1)+'" r="2.6"><title>'+(daily[index].date.slice(5))+' · '+values[index]+' 经验</title></circle>').join('');
    const area='M'+pad+','+(height-pad)+' L'+polyline.replace(/ /g,' L')+' L'+(width-pad)+','+(height-pad)+' Z';
    return '<polygon points="'+points.map(p=>p.x.toFixed(1)+','+p.y.toFixed(1)).join(' ')+' '+(width-pad)+','+(height-pad)+' '+pad+','+(height-pad)+'" fill="rgba(109,40,217,.08)"/><polyline points="'+polyline+'"/>'+circles;
  }
  function positionExperiencePanel(){
    // PC 端把面板锚定到大厅左侧空白，顶部与试卷库对齐（按实际布局计算，皮肤可能改变主区宽度）
    const panel=$('practiceExpPanel');
    if(!panel)return;
    if(!global.matchMedia?.('(max-width:1720px)').matches){
      const main=document.querySelector('.practice-main');
      const shelf=document.querySelector('.practice-library-shelf')||document.querySelector('.practice-lobby-head');
      const left=main?Math.max(12,Math.round(main.getBoundingClientRect().left-294)):12;
      const top=shelf?Math.max(70,Math.round(shelf.getBoundingClientRect().top)):150;
      panel.style.left=left+'px';
      panel.style.top=top+'px';
    }else{panel.style.left='';panel.style.top=''}
  }
  function refreshExperiencePanel(){
    const panel=$('practiceExpPanel'),fab=$('practiceExpFab');
    if(!panel)return;
    if(!hasAuthenticatedUser()){panel.hidden=true;if(fab)fab.hidden=true;return}
    fetch('/api/v1/learning/practice/experience-summary',{credentials:'include'}).then(r=>{if(!r.ok)throw new Error('xp summary '+r.status);return r.json()}).then(data=>{
      const total=$('practiceExpTotal'),week=$('practiceExpWeek'),chart=$('practiceExpChart'),chartX=$('practiceExpChartX');
      if(total)total.textContent=String(Number(data.totalExperience)||0);
      if(week)week.textContent=String(Number(data.weekExperience)||0);
      const daily=Array.isArray(data.daily)?data.daily.slice(-7):[];
      if(chart)chart.innerHTML=daily.length?expChartMarkup(daily):'';
      const WEEKDAY_LABELS=['周日','周一','周二','周三','周四','周五','周六'];
      if(chartX)chartX.innerHTML=daily.map(day=>{
        const parsed=new Date(day.date+'T00:00:00');
        const label=Number.isNaN(parsed.getTime())?day.date.slice(5):WEEKDAY_LABELS[parsed.getDay()];
        return '<span>'+escapeHTML(label)+'</span>';
      }).join('');
      const compact=global.matchMedia?.('(max-width:1720px)').matches;
      positionExperiencePanel();
      if(fab){
        fab.hidden=false;
        fab.setAttribute('aria-expanded',String(document.body.classList.contains('is-exp-panel-open')));
      }
      panel.hidden=compact?!document.body.classList.contains('is-exp-panel-open'):false;
    }).catch(()=>{panel.hidden=true;if(fab)fab.hidden=true});
  }
  function showLobby(){state.completed=false;hideStreakPop();hideRemediation();clearVerification();setDangerVignette(0);delete document.body.dataset.practiceMode;setView('lobby');syncLobby();refreshExperiencePanel()}
  function bind(){
    dom.paperSelect?.addEventListener('change',()=>selectPaper(dom.paperSelect.value));
    dom.filterButtons.forEach(button=>button.addEventListener('click',()=>{state.libraryFilter=button.dataset.paperFilter||'all';renderPaperLibrary()}));
    dom.libraryMoreBtn?.addEventListener('click',openPaperDrawer);dom.paperDrawerClose?.addEventListener('click',closePaperDrawer);
    dom.historyOpenBtn?.addEventListener('click',openHistoryDrawer);dom.historyCloseBtn?.addEventListener('click',closeHistoryDrawer);dom.clearHistoryBtn?.addEventListener('click',clearHistory);
    // 经验面板：窄屏 FAB 展开/收起；窗口尺寸变化时重算显示模式
    const expFab=$('practiceExpFab');
    expFab?.addEventListener('click',()=>{
      const open=document.body.classList.toggle('is-exp-panel-open');
      expFab.setAttribute('aria-expanded',String(open));
      const panel=$('practiceExpPanel');
      if(panel)panel.hidden=!open;
    });
    global.addEventListener('resize',()=>{if(document.body.dataset.practiceView==='lobby'){positionExperiencePanel();refreshExperiencePanel()}});
    dom.paperDrawer?.addEventListener('click',event=>{if(event.target===dom.paperDrawer)closePaperDrawer()});
    dom.historyDrawer?.addEventListener('click',event=>{if(event.target===dom.historyDrawer)closeHistoryDrawer()});
    dom.countInputs.forEach(input=>input.addEventListener('change',()=>{if(input.checked)state.selectedCount=Number(input.value)}));
    dom.startButtons.forEach(button=>button.addEventListener('click',()=>startPractice(button.dataset.practiceStart)));
    dom.exitBtn.addEventListener('click',openExitConfirm);dom.exitCancel.addEventListener('click',closeExitConfirm);dom.saveExitBtn?.addEventListener('click',saveAndExit);dom.abandonBtn?.addEventListener('click',abandonPractice);
    dom.exitConfirm.addEventListener('click',event=>{if(event.target===dom.exitConfirm)closeExitConfirm()});
    dom.answerSheetMobileBtn?.addEventListener('click',openAnswerSheetDrawer);dom.answerSheetDrawerClose?.addEventListener('click',closeAnswerSheetDrawer);dom.answerSheetDrawer?.addEventListener('click',event=>{if(event.target===dom.answerSheetDrawer)closeAnswerSheetDrawer()});
    dom.submitReturnBtn?.addEventListener('click',returnToFirstUnanswered);dom.submitAnywayBtn?.addEventListener('click',()=>{closeSubmitConfirm();finishPractice()});dom.submitConfirm?.addEventListener('click',event=>{if(event.target===dom.submitConfirm)closeSubmitConfirm()});
    dom.checkpointContinue.addEventListener('click',continueCheckpoint);dom.againBtn.addEventListener('click',startAgain);dom.lobbyBtn.addEventListener('click',showLobby);dom.remediationContinueBtn?.addEventListener('click',startRemediationVerification);dom.remediationReviewBtn?.addEventListener('click',toggleRemediationExplanation);
    // 挑战 V2：生命归零失败弹窗（退回大厅 / 继续作答）
    dom.failLobbyBtn?.addEventListener('click',()=>{closeChallengeFailDialog();abandonPractice()});
    dom.failContinueBtn?.addEventListener('click',closeChallengeFailDialog);
    // 复仇模式：底部按钮 + 触屏左右滑动切题
    dom.prevBtn?.addEventListener('click',()=>switchQuestion(-1));
    dom.nextBtn?.addEventListener('click',()=>switchQuestion(1));
    // 语言单按钮循环切换：中 → EN → 双 → 中
    const languageCycle=$('practiceLanguageCycle');
    const LANGUAGE_CYCLE=['zh','en','bilingual'];
    const LANGUAGE_LABELS={zh:'中',en:'EN',bilingual:'双'};
    const LANGUAGE_NAMES={zh:'中文',en:'English',bilingual:'双语对照'};
    const syncLanguageCycle=()=>{
      if(!languageCycle)return;
      const current=languageMode();
      languageCycle.textContent=LANGUAGE_LABELS[current]||'中';
      const next=LANGUAGE_CYCLE[(LANGUAGE_CYCLE.indexOf(current)+1)%LANGUAGE_CYCLE.length];
      languageCycle.title='题目显示语言：'+LANGUAGE_NAMES[current]+'（点击切换为'+LANGUAGE_NAMES[next]+'）';
      languageCycle.setAttribute('aria-label','当前'+LANGUAGE_NAMES[current]+'，点击切换为'+LANGUAGE_NAMES[next]);
    };
    if(languageCycle)languageCycle.addEventListener('click',()=>{
      const next=LANGUAGE_CYCLE[(LANGUAGE_CYCLE.indexOf(languageMode())+1)%LANGUAGE_CYCLE.length];
      global.KGActivitySchemaV1?.setLanguageMode?.(next);
    });
    global.addEventListener('kg:question-language-mode',syncLanguageCycle);
    syncLanguageCycle();
    const autoExplain=$('practiceAutoExplain');
    if(autoExplain){
      autoExplain.checked=autoExplainEnabled();
      autoExplain.addEventListener('change',()=>{
        try{global.KGActivitySchemaV1?.setPracticeAutoExplain?.(autoExplain.checked)}catch(error){}
      });
    }
    if(dom.questionCard){
      let swipeStartX=0,swipeStartY=0;
      dom.questionCard.addEventListener('touchstart',event=>{const t=event.touches[0];swipeStartX=t.clientX;swipeStartY=t.clientY},{passive:true});
      dom.questionCard.addEventListener('touchend',event=>{
        const t=event.changedTouches[0],dx=t.clientX-swipeStartX,dy=t.clientY-swipeStartY;
        if(Math.abs(dx)>48&&Math.abs(dx)>Math.abs(dy)*1.4)switchQuestion(dx<0?1:-1);
      },{passive:true});
    }
    document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(!dom.submitConfirm.hidden)closeSubmitConfirm();else if(!dom.exitConfirm.hidden)closeExitConfirm();else if(dom.answerSheetDrawer&&!dom.answerSheetDrawer.hidden)closeAnswerSheetDrawer();else if(dom.paperDrawer&&!dom.paperDrawer.hidden)closePaperDrawer();else if(dom.historyDrawer&&!dom.historyDrawer.hidden)closeHistoryDrawer()});
    global.addEventListener('kg-auth-session-change',()=>{if(!state.active)syncLobby();if(!state.active)refreshExperiencePanel()});
    global.addEventListener('kg-subscription-change',()=>{if(!state.active)syncLobby()});
    global.addEventListener('kg-subscription-plan-change',()=>{if(!state.active)syncLobby()});
    global.addEventListener('kg:published-papers-changed',()=>{if(!state.active)syncLobby()});
    // 三态语言切换即时重渲染当前题（作答与判题不受影响）
    global.addEventListener('kg:question-language-mode',()=>{if(state.active)try{renderQuestion()}catch(error){}});
    global.addEventListener('kg-practice-mistakes-change',()=>{if(!state.active)syncLobby()});
  }
  function cacheDom(){
    Object.assign(dom,{
      lobby:$('practiceLobby'),game:$('practiceGame'),checkpoint:$('practiceCheckpoint'),result:$('practiceResult'),paperSelect:$('practicePaperSelect'),paperMeta:$('practicePaperMeta'),retiredNotice:$('practiceRetiredModeNotice'),selectedPaperName:$('practiceSelectedPaperName'),paperLibrary:$('practicePaperLibrary'),paperDrawerLibrary:$('practicePaperDrawerLibrary'),filterButtons:[...document.querySelectorAll('[data-paper-filter]')],librarySummary:$('practiceLibrarySummary'),paperDrawerSummary:$('practicePaperDrawerSummary'),libraryMoreBtn:$('practiceLibraryMoreBtn'),paperDrawer:$('practicePaperDrawer'),paperDrawerClose:$('practicePaperDrawerClose'),toast:$('practiceToast'),
      setupCard:document.querySelector('.practice-setup-card'),modeGrid:document.querySelector('.practice-mode-grid'),empty:$('practiceEmpty'),countInputs:[...document.querySelectorAll('[name="practiceCount"]')],orderInputs:[...document.querySelectorAll('[name="practiceOrder"]')],startButtons:[...document.querySelectorAll('[data-practice-start]')],revengePendingCount:$('practiceRevengePendingCount'),revengeRemediationCount:$('practiceRevengeRemediationCount'),revengeMasteredCount:$('practiceRevengeMasteredCount'),
      progressShell:$('practiceProgressShell'),progressBar:$('practiceProgressBar'),health:$('practiceHealth'),timer:$('practiceTimer'),timeRow:$('practiceTimeRow'),timeRail:$('practiceTimeRail'),timeBar:$('practiceTimeBar'),timerMs:$('practiceTimerMs'),dangerVignette:$('practiceDangerVignette'),streakPop:$('practiceStreakPop'),feedback:$('practiceFeedback'),verificationBanner:$('practiceVerificationBanner'),verificationKnowledge:$('practiceVerificationKnowledge'),verificationMessage:$('practiceVerificationMessage'),questionCard:$('practiceQuestionCard'),questionStem:$('practiceQuestionStem'),options:$('practiceOptions'),questionNav:$('practiceQuestionNav'),prevBtn:$('practicePrevBtn'),nextBtn:$('practiceNextBtn'),questionPos:$('practiceQuestionPos'),remediationPanel:$('practiceRemediationPanel'),remediationKnowledge:$('practiceRemediationKnowledge'),remediationMessage:$('practiceRemediationMessage'),remediationReviewBtn:$('practiceRemediationReviewBtn'),remediationContinueBtn:$('practiceRemediationContinueBtn'),remediationExplanation:$('practiceRemediationExplanation'),
      exitBtn:$('practiceExitBtn'),exitConfirm:$('practiceExitConfirm'),exitCancel:$('practiceExitCancel'),exitConfirmBtn:$('practiceExitConfirmBtn'),saveExitBtn:$('practiceSaveExitBtn'),abandonBtn:$('practiceAbandonBtn'),answerSheetRoot:$('practiceAnswerSheet'),answerSheetMobileRoot:$('practiceAnswerSheetMobile'),answerSheetMobileBtn:$('practiceAnswerSheetMobileBtn'),answerSheetMobileCount:document.querySelector('#practiceAnswerSheetMobileBtn span'),answerSheetDrawer:$('practiceAnswerSheetDrawer'),answerSheetDrawerClose:$('practiceAnswerSheetDrawerClose'),submitConfirm:$('practiceSubmitConfirm'),submitMessage:$('practiceSubmitMessage'),submitReturnBtn:$('practiceSubmitReturnBtn'),submitAnywayBtn:$('practiceSubmitAnywayBtn'),checkpointStreak:$('practiceCheckpointStreak'),checkpointExperience:$('practiceCheckpointExperience'),checkpointDuration:$('practiceCheckpointDuration'),checkpointContinue:$('practiceCheckpointContinue'),resultAccuracy:$('practiceResultAccuracy'),resultDuration:$('practiceResultDuration'),resultExperience:$('practiceResultExperience'),challengeOutcome:$('practiceChallengeOutcome'),challengeResult:$('practiceChallengeResult'),challengeDetail:$('practiceChallengeDetail'),failBackdrop:$('practiceFailBackdrop'),failLobbyBtn:$('practiceFailLobbyBtn'),failContinueBtn:$('practiceFailContinueBtn'),againBtn:$('practiceAgainBtn'),lobbyBtn:$('practiceLobbyBtn'),historyOpenBtn:$('practiceHistoryOpenBtn'),historyCount:$('practiceHistoryCount'),historyDrawer:$('practiceHistoryDrawer'),historyCloseBtn:$('practiceHistoryCloseBtn'),historySummary:$('practiceHistorySummary'),historyList:$('practiceHistoryList'),historyEmpty:$('practiceHistoryEmpty'),clearHistoryBtn:$('practiceClearHistoryBtn')
    });
  }
  function snapshot(){return {mode:state.mode,index:state.index,health:state.health,streak:state.streak,experience:state.experience,correct:state.correct,answered:state.answered,remainingSeconds:state.mode==='scholar'?remainingSeconds():null,active:state.active,view:document.body.dataset.practiceView||'',questionCount:state.questions.length}}
  async function init(){
    cacheDom();
    const answerSheetOptions={onNavigate:navigateToQuestionId,onSubmit:openSubmitConfirm};
    if(global.KGPracticeAnswerSheet?.mount){
      state.answerSheet=global.KGPracticeAnswerSheet.mount(dom.answerSheetRoot,answerSheetOptions);
      state.mobileAnswerSheet=global.KGPracticeAnswerSheet.mount(dom.answerSheetMobileRoot,answerSheetOptions);
    }
    dom.startButtons.forEach(button=>button.dataset.defaultLabel=button.textContent);bind();
    state.retiredNavigation=readRetiredModeNavigation();
    // P4.5.38：不阻塞等待 catalog ready，先显示 UI，数据异步加载（性能优化）
    const catalogPromise=global.KGQuestionCatalogAdapter?.ready||Promise.resolve();
    catalogPromise.then(()=>{state.catalogAvailable=true;syncLobby()}).catch(error=>{state.catalogAvailable=false;console.warn('题目目录加载失败',error);syncLobby()});
    syncLobby();showRetiredModeNotice();
    refreshExperiencePanel();
    if(state.retiredNavigation){setView('lobby');return}
    setView('lobby');
  }

  const api=Object.freeze({init,startPractice,answerById:id=>answer(id,dom.options.querySelector('[data-option-id="'+CSS.escape(text(id))+'"]')),finishPractice,showLobby,loadReleases,snapshot,constants:Object.freeze({COUNTS:[...COUNTS],MAX_HEALTH,SCHOLAR_MAX_SECONDS,CHECKPOINT_INTERVAL})});
  global.KGPracticeMode=api;
  if(typeof module!=='undefined'&&module.exports)module.exports={streakBonus,formatDuration,resolveRelease,practiceModeEnabled,renderHeartIcon,readRetiredModeNavigation,prioritizeRetiredQuestion,constants:api.constants};
  if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',init,{once:true});
})(typeof window!=='undefined'?window:globalThis);
