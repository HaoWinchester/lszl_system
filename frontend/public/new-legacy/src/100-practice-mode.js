'use strict';

/*
 * V9.0-P4.0.2 做题模式渐进危险反馈与导航修复。
 * 只读取公开发布试卷与发布快照，不读取教师草稿，不修改题库原题。
 */
(function(global){
  const COUNTS=[10,20,60,180];
  const MAX_HEALTH=3;
  const SCHOLAR_MAX_SECONDS=60;
  const FEEDBACK_DELAY=520;
  const RETIRED_SINGLE_DEEP_NOTICE='单题深学已停用，已为你切换到刷题';
  const AnswerSet=global.KGQuestionAnswerSet||{};

  const $=id=>document.getElementById(id);
  const dom={};
  const state={
    releases:[],selectedPaperId:'',libraryFilter:'all',selectedCount:10,revengeSelectedCount:0,order:'paper',mode:'',questions:[],index:0,
    health:MAX_HEALTH,streak:0,experience:0,correct:0,answered:0,startedAt:0,endedAt:0,
    locked:false,active:false,completed:false,lastSettings:null,timerId:0,deadline:0,
    feedbackTimer:0,popTimer:0,toastTimer:0,abandonedRecorded:false,catalogAvailable:false,retiredNavigation:null,retiredNoticeShown:false,
    remediationPending:false,verification:null,entryStartingMode:'',revengeRulePinned:false,showPreviousWrong:true,
    session:null,report:null,reviewing:false,answerSheet:null,pendingSelections:{},submitting:false,pendingRequestKey:'',resumeLookupToken:0,
    draft:null,revengeState:null,saves:null,reconciling:false
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
    const type=text(q.type||'single_choice'),correct=text(q.correctAnswer||rawOptions.find(option=>option?.correct)?.id);
    const options=rawOptions.map((option,optionIndex)=>({
      id:text(option?.id||String.fromCharCode(65+optionIndex)),
      text:text(option?.text),
      correct:!!option?.correct||text(option?.id)===correct
    })).filter(option=>option.text);
    const resolvedCorrect=correct||text(options.find(option=>option.correct)?.id);
    const correctOptionIds=type==='multiple_choice'?(AnswerSet.correctIds?.({...q,options})||options.filter(option=>option.correct).map(option=>option.id)):[];
    const knowledge=q?.metadata?.knowledge||q?.knowledge||{};
    const path=Array.isArray(knowledge.pathSnapshot)?knowledge.pathSnapshot:[];
    return {
      id:text(q.id||ref?.questionId||('q-'+index)),bankId:text(ref?.bankId||q.sourceBankId),mistakeId:text(ref?.mistakeId),previousWrongAnswer:text(ref?.previousWrongAnswer),previousWrongAnswerIds:Array.isArray(ref?.previousWrongAnswerIds)?ref.previousWrongAnswerIds.map(text):[],
      title:text(q.title||'未命名题目'),stem:stemText(q),options,correctAnswer:type==='multiple_choice'?'':resolvedCorrect,correctOptionIds,
      type,raw:q,
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
      if(question.stem&&question.options.length>=2&&(question.type==='multiple_choice'?question.correctOptionIds.length>=2:question.correctAnswer))questions.push(question);
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
  function saveCoordinator(){
    if(!state.saves)state.saves=global.KGPracticeSessionSave.create({api:practiceApi()});
    return state.saves;
  }
  function normalizedSession(session){
    return global.KGPracticeSessionCore?.normalizeSession?.(session)||clone(session||{});
  }
  function sessionQuestions(session){
    return (Array.isArray(session?.questions)?session.questions:[]).map((item,index)=>normalizeQuestion(item?.question||{},item,index)).filter(question=>question.stem&&question.options.length>=2);
  }
  function runtimeState(){
    const remainingMs=state.mode==='scholar'?Math.max(0,state.deadline-Date.now()):undefined;
    const runtime={currentIndex:Math.max(0,state.index),health:Math.max(0,Number(state.health)||0),streak:Math.max(0,Number(state.streak)||0),maxStreak:Math.max(0,Number(state.maxStreak)||0),experience:Math.max(0,Number(state.experience)||0),durationMs:elapsed(),languageMode:languageMode(),autoExplain:autoExplainEnabled()};
    if(remainingMs!==undefined)runtime.remainingMs=Math.round(remainingMs);
    if(state.mode==='revenge'&&state.revengeState)runtime.revengeState=clone(state.revengeState);
    return runtime;
  }
  function answerSheetSession(){
    // 答题卡正误来自本地草稿的 viewAnswers()（含派生 correct/correctAnswer）；
    // 交卷后 / 复盘页才消费服务器冻结结果（state.session.answers 已被完成态覆盖）。
    const draftView=state.reviewing?null:(state.draft?.viewAnswers?.()||null);
    const base=state.session?normalizedSession(state.session):{mode:state.mode,questions:draftQuestions(),answers:{}};
    if(draftView&&!state.reviewing)return {...base,answers:draftView,reviewOnly:false};
    return {...base,reviewOnly:state.reviewing};
  }
  function renderAnswerSheet(){
    const session=answerSheetSession(),currentId=state.questions[state.index]?.id||'';
    const stats=state.answerSheet?.render?.(session,currentId);
    if(dom.answerSheetMobileCount){dom.answerSheetMobileCount.textContent=(stats?.answered||0)+'/'+(stats?.total||state.questions.length||0)}
  }
  function mergeSessionQuestions(){
    if(!state.session)return;
    const incoming=new Map(sessionQuestions(state.session).map(question=>[question.id,question]));
    state.questions=state.questions.map(question=>incoming.has(question.id)?{...question,...incoming.get(question.id)}:question);
  }
  function setConflictVisible(visible){
    state.conflict=!!visible;if(dom.sessionConflict)dom.sessionConflict.hidden=!visible;
  }
  function handleSessionError(error,{allowRetry=false}={}){
    if(Number(error?.status)===409){clearTimers();state.locked=true;setConflictVisible(true);showFeedback('进度已在另一页更新','danger');showToast('请加载最新进度后继续做题。');return false}
    if(allowRetry)renderQuestion();
    showFeedback('保存未完成，答案仍保留在页面中，请重试。','danger');return false;
  }
  // 点击触发的公共请求包装器：统一加载框 + 按钮禁用 + 防重入。
  // 业务函数只负责成功后的页面切换和失败文案；异常路径也在 finally 里收尾。
  // begin/end 可选：开始/继续入口需要额外维护 aria-busy 与焦点恢复。
  async function runClickedRequest({key,button,title,message},operation,begin,end){
    if(state.pendingRequestKey)return {skipped:true};
    state.pendingRequestKey=key;
    if(button&&!begin)button.disabled=true;
    if(begin)begin();else global.KGLearningLoading?.show?.({title,message});
    try{return await operation()}
    finally{
      global.KGLearningLoading?.hide?.();
      if(end)end();else if(button)button.disabled=false;
      state.pendingRequestKey='';
      // 关闭可能恰好发生在末次作答与自动结算之间，恢复满卷草稿时继续结算。
      if(['start','reload'].includes(key)&&state.active&&shouldAutoComplete())void finishPractice();
    }
  }
  // 本地草稿控制器：会话与非会话作答统一入口，判题/真值全部内存持有，
  // 退出、正常关闭与完成时才整卷提交。
  function draftQuestions(){
    return (state.session?sessionQuestions(state.session):state.questions).map((question,index)=>({questionId:question.id,question:question.raw||question}));
  }
  function createDraft(session){
    state.draft=global.KGPracticeDraftState?.create({
      questions:draftQuestions(),
      answers:(session&&typeof session==='object'?session.answers:{})||{},
    })||null;
  }
  function runSessionMutation(operation){
    const run=async()=>{
      if(!state.session||state.conflict)throw Object.assign(new Error('练习进度待重新加载'),{status:409});
      const result=await operation(state.session);
      const next=result?.session||result;
      if(next?.id){state.session=normalizedSession(next);createDraft(state.session);mergeSessionQuestions();renderAnswerSheet()}
      return result;
    };
    return run();
  }
  async function reloadLatestSession(){
    if(!state.session||state.pendingRequestKey)return false;
    const button=dom.sessionConflictReload;
    return runClickedRequest({key:'reload',button,title:'正在加载最新进度',message:'正在同步服务器上的最新做题记录…'},async()=>{
      button?.setAttribute('aria-busy','true');
      try{
        const api=practiceApi(),latest=await api.getSession(state.session.id),catalog=state.releases.find(row=>row.releaseId===latest.releaseId)||selectedRelease();
        setConflictVisible(false);
        if(latest.status==='completed'){
          state.session=normalizedSession(latest);state.questions=sessionQuestions(state.session);state.report=await api.getReport(latest.id);state.active=false;state.reviewing=false;renderFrozenReport();setView('result');return true;
        }
        if(latest.status==='abandoned'){state.active=false;setConflictVisible(false);showLobby();showToast('该练习已放弃，未恢复到答题界面。');return true}
        restoreServerSession(latest,catalog||{id:latest.paperId});showToast('已加载最新进度。');return true;
      }catch(error){showToast('最新进度加载失败，请稍后重试。');return false}
      finally{button?.removeAttribute('aria-busy')}
    });
  }
  function navigateToQuestionId(questionId){
    if(state.submitting||state.pendingRequestKey||state.reconciling)return false;
    if(state.active&&shouldAutoComplete()){finishPractice();return false}
    const index=state.questions.findIndex(question=>question.id===text(questionId));if(index<0||(!state.active&&!state.reviewing))return false;
    state.index=index;state.locked=false;dom.feedback.hidden=true;hideRemediation();clearVerification();renderQuestion();
    // 题号切题后统一关闭抽屉（无论来自答题卡跳题还是其他入口）
    if(dom.answerSheetDrawer&&!dom.answerSheetDrawer.hidden)closeAnswerSheetDrawer(true);
    return true;
  }
  function renderFrozenReport(){
    if(!state.report||!global.KGPracticeResultReport?.render)return false;
    const questionNumbers=Object.fromEntries(state.questions.map((question,index)=>[question.id,index+1]));
    const rendered=global.KGPracticeResultReport.render(dom.result,state.report,{questionNumbers,
      experience:state.session?.stats?.experience,
      onReviewAll:state.mode==='practice'?()=>openQuestionReview(state.questions[state.index]?.id||state.questions[0]?.id):null,
      onReviewWrong:reviewWrongQuestion,onAgain:startAgain,onLobby:showLobby});
    renderModeOutcome();
    if(rendered&&!dom.challengeOutcome.hidden)dom.result.querySelector('.practice-report-overall')?.after(dom.challengeOutcome);
    return rendered;
  }
  function reviewWrongQuestion(questionId){
    if(!state.report?.wrongQuestionIds?.includes?.(questionId))return false;
    return openQuestionReview(questionId);
  }
  function openQuestionReview(questionId){
    const index=state.questions.findIndex(question=>question.id===text(questionId));if(index<0)return false;
    state.reviewing=true;state.index=index;state.active=false;document.body.classList.add('is-practice-review');if(dom.reviewBackBtn)dom.reviewBackBtn.hidden=false;
    setView('game');renderQuestion();return true;
  }
  function returnToFrozenReport(){
    state.reviewing=false;document.body.classList.remove('is-practice-review');if(dom.reviewBackBtn)dom.reviewBackBtn.hidden=true;closeAnswerSheetDrawer();setView('result');renderFrozenReport();return true;
  }
  function getMistakeStats(){try{return practiceApi()?.stats?.()||{active:0,pending:0,needsRemediation:0,mastered:0}}catch(error){return {active:0,pending:0,needsRemediation:0,mastered:0}}}
  function revengePolicy(){
    const stats=getMistakeStats();
    return global.KGRevengeEntryPolicy.derive(stats.active,state.revengeSelectedCount);
  }
  function setRevengeRuleOpen(open){
    if(!dom.revengeRuleTrigger||!dom.revengeRuleTooltip)return;
    dom.revengeRuleTrigger.setAttribute('aria-expanded',String(!!open));
    dom.revengeRuleTooltip.hidden=!open;
  }
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
    if(!modePolicy().showHealth){dom.health.hidden=true;return}
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
    const count=state.questions.length,total=Math.max(1,count),current=count?Math.max(1,Math.min(count,state.index+1)):0;
    const label='第 '+current+' / '+count+' 题',value=Math.max(0,Math.min(100,state.index/total*100));
    dom.progressBar.style.width=value+'%';dom.progressShell.setAttribute('aria-valuenow',String(Math.round(value)));dom.progressShell.setAttribute('aria-valuetext',label);
    if(dom.questionProgress)dom.questionProgress.textContent=label;
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
        ? '原错题已经答对。请再做一道不同的验证题，确认不是只记住了答案。'
        : '这道题在复仇模式中再次答错。先看解析并重新建立判断规则，再做验证题。';
    const explanation=remediationExplanation(question);
    // 复仇新规则：补救面板出现时自动展开题目解析（答错即见正确答案与解析）
    if(dom.remediationExplanation){
      if(explanation){dom.remediationExplanation.innerHTML=explanation;dom.remediationExplanation.hidden=false}
      else dom.remediationExplanation.hidden=true;
    }
    if(dom.remediationReviewBtn){dom.remediationReviewBtn.hidden=!explanation;dom.remediationReviewBtn.textContent=explanation?'收起题目解析':'查看题目解析'}
    if(dom.remediationContinueBtn){dom.remediationContinueBtn.textContent='开始验证';dom.remediationContinueBtn.hidden=false}
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
    // 复仇补救验证只存在于本地草稿：未交卷不调用服务端推进长期错题状态，
    // 验证题从复仇卷中的另一道冻结快照题派生，保存/恢复时随 revengeState 走。
    if(!state.active||state.mode!=='revenge'||!state.remediationPending)return false;
    const sourceQuestion=state.questions[state.index];
    if(!sourceQuestion?.mistakeId)return false;
    const nodeId=text(sourceQuestion.knowledge?.nodeId),fallback=(state.questions.find(question=>question.id!==sourceQuestion.id&&question.type===sourceQuestion.type&&(!nodeId||text(question.knowledge?.nodeId)===nodeId)&&question.stem&&question.options.length>=2))||null;
    if(!fallback){state.remediationPending=false;state.revengeState={phase:'verification_due',mistakeId:sourceQuestion.mistakeId,questionId:sourceQuestion.id};hideRemediation();showToast('暂无同题型验证题，已安排后续用原题延迟验证。');advanceAfterAnswer();return true}
    state.verification={active:true,sourceQuestion,question:fallback};
    state.revengeState={phase:'verification',mistakeId:sourceQuestion.mistakeId,questionId:sourceQuestion.id,verificationQuestion:clone(fallback.raw)};
    hideRemediation();document.body.dataset.practicePhase='verification';renderQuestion();return true;
  }
  function finishRemediationVerification(correct){
    const verification=state.verification;if(!verification?.active)return;
    const sourceQuestion=verification.sourceQuestion;clearVerification();
    if(correct){advanceAfterAnswer();return}
    renderQuestion();state.locked=true;lockOptions();showRemediation(sourceQuestion,{verificationFailed:true});
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
  async function openReportFromHistory(sessionId){
    if(!sessionId||state.pendingRequestKey)return false;
    return runClickedRequest({key:'report',title:'正在打开成绩报告',message:'正在读取历史成绩…'},async()=>{
      try{
        const api=practiceApi(),session=await api.getSession(sessionId),report=await api.getReport(sessionId);
        state.session=normalizedSession(session);state.questions=sessionQuestions(state.session);state.report=clone(report);state.mode=session.mode;state.active=false;state.reviewing=false;state.lastSettings={paperId:session.paperId,count:state.questions.length,order:text(session.runtimeState?.order||'paper'),mode:session.mode};
        closeHistoryDrawer();renderFrozenReport();setView('result');return true;
      }catch(error){showToast('成绩报告暂时无法打开，请稍后重试。');return false}
    });
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
          if(created>=row.lastAt){row.lastAt=created;row.lastRate=rate;row.paperName=text(record?.paperName)||row.paperName;row.latestMode=text(record?.mode||'challenge');row.lastAnswered=answered;row.lastStatus=text(record?.status)}
          if(record?.reportAvailable===true&&created>=row.reportAt){row.reportAt=created;row.reportSessionId=text(record?.sessionId)}
        }else byPaper.set(paperId,{paperId:row_paperId(paperId),paperName:text(record?.paperName||'未命名练习'),count:1,lastAt:created,lastRate:rate,lastAnswered:answered,lastStatus:text(record?.status),latestMode:text(record?.mode||'challenge'),reportAt:record?.reportAvailable===true?created:0,reportSessionId:record?.reportAvailable===true?text(record?.sessionId):''});
      });
      const papers=[...byPaper.values()].sort((a,b)=>b.lastAt-a.lastAt);
      if(dom.historyList){
        dom.historyList.innerHTML=papers.map(paper=>'<article class="practice-history-row is-paper" data-history-paper="'+escapeHTML(paper.paperId)+'"><div><strong>'+escapeHTML(paper.paperName)+'</strong><span>练习 '+paper.count+' 次 · 最近 '+escapeHTML(formatHistoryTime(paper.lastAt))+' · '+(paper.lastStatus==='paused'?'已保存':paper.lastStatus==='abandoned'?'已结束':'已完成')+' · 已答 '+paper.lastAnswered+' 题</span></div><span>最近正确率 '+paper.lastRate+'%</span><div class="practice-history-actions"><button type="button" data-history-practice="'+escapeHTML(paper.paperId)+'">进入练习</button>'+(paper.reportSessionId?'<button type="button" data-history-session="'+escapeHTML(paper.reportSessionId)+'">查看成绩</button>':'')+'</div></article>').join('');
        dom.historyList.querySelectorAll('[data-history-practice]').forEach(button=>button.addEventListener('click',()=>startPaperFromHistory(button.dataset.historyPractice)));
        dom.historyList.querySelectorAll('[data-history-session]').forEach(button=>button.addEventListener('click',()=>openReportFromHistory(button.dataset.historySession)));
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
  // runtimeState.autoExplain 按旧契约继续上报（后端白名单仍接受该字段），
  // 仅普通练习读取解析开关；挑战/学霸作答期间禁止展示解析。
  function modePolicy(){return global.KGPracticeModePolicy.forMode(state.mode,{reviewOnly:state.reviewing})}
  function shouldShowExplanation(){return state.mode==='revenge'||(modePolicy().canExplain&&(state.reviewing||autoExplainEnabled()))}
  function autoExplainEnabled(){
    try{return global.KGActivitySchemaV1?.getPracticeAutoExplain?.()!==false}catch(error){return true}
  }
  function questionCorrectIds(question){return question?.type==='multiple_choice'?(question.correctOptionIds||[]):[text(question?.correctAnswer)].filter(Boolean)}
  function answerSelectedIds(answer){return Array.isArray(answer?.selectedAnswerIds)?answer.selectedAnswerIds.map(text):[text(answer?.selectedAnswer)].filter(Boolean)}
  function renderPracticeExplanation(question,correct){
    const panel=$('practiceExplanationPanel');if(!panel||!shouldShowExplanation())return;
    const head=$('practiceExplanationHead'),body=$('practiceExplanationBody');
    const view=questionLanguageView(question);
    const correctText='正确答案：'+questionCorrectIds(question).join('、');
    const explanationMarkup=view?escapeHTML(languageText(view.explanation))+englishLine(view.explanation):escapeHTML(text(question?.raw?.analysis||question?.raw?.explanation||'暂无解析'));
    if(head){head.textContent=(correct?'回答正确':'回答错误')+' · '+correctText;head.className='practice-explanation-head '+(correct?'is-correct':'is-wrong')}
    if(body)body.innerHTML='<p class="practice-answer-line">'+escapeHTML(correctText)+'</p>'+explanationMarkup;
    const actions=$('practiceExplanationActions');
    if(actions)actions.innerHTML='';
    panel.hidden=false;
    panel.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function renderPreviousWrongAnswer(question){
    const revengeQuestion=state.mode==='revenge'&&!state.verification?.active;
    const answerIds=question?.previousWrongAnswerIds?.length?question.previousWrongAnswerIds:[text(question?.previousWrongAnswer)].filter(Boolean);
    const options=answerIds.map(id=>question?.options?.find(item=>text(item.id)===id)).filter(Boolean);
    const visible=revengeQuestion&&state.showPreviousWrong&&!!options.length;
    if(dom.previousWrongToggle)dom.previousWrongToggle.hidden=!revengeQuestion;
    if(dom.showPreviousWrong)dom.showPreviousWrong.checked=state.showPreviousWrong;
    if(!dom.previousWrongAnswer)return;
    dom.previousWrongAnswer.hidden=!visible;
    if(!visible){dom.previousWrongAnswer.textContent='';return}
    const view=questionLanguageView(question);
    dom.previousWrongAnswer.textContent='上次选错：'+options.map(option=>{const display=view?.options?.find(item=>text(item.id)===text(option.id))?.display;return text(option.id)+'. '+(display?languageText(display):option.text)}).join('；');
  }
  function renderQuestion(){
    if(state.mode==='revenge'&&!state.verification?.active&&state.revengeState?.phase==='verification'&&state.revengeState?.verificationQuestion){
      const source=state.questions.find(item=>item.id===text(state.revengeState.questionId));
      const verificationQuestion=normalizeQuestion(state.revengeState.verificationQuestion,{questionId:state.revengeState.verificationQuestion.id,bankId:state.revengeState.verificationQuestion.bankId},0);
      if(source&&verificationQuestion.stem&&verificationQuestion.options.length>=2)state.verification={active:true,sourceQuestion:source,question:verificationQuestion};
    }
    const question=state.verification?.active?state.verification.question:state.questions[state.index];
    if(!question){renderAnswerSheet();return}
    // 恢复服务器草稿后同样在本地派生正误；已答题锁定并回放正误样式。
    const savedAnswer=state.draft?.answer?.(question.id)||state.session?.answers?.[question.id]||null;
    const practiceAnswered=savedAnswer?{selected:answerSelectedIds(savedAnswer),correct:savedAnswer.correct===true}:null;
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
    renderPreviousWrongAnswer(question);
    const multi=question.type==='multiple_choice',pending=new Set(state.pendingSelections[question.id]||[]);
    dom.options.querySelectorAll('[data-option-id]').forEach(button=>{
      const id=text(button.dataset.optionId);button.classList.toggle('is-pending',multi&&pending.has(id));button.setAttribute('aria-pressed',multi&&pending.has(id)?'true':'false');
      button.addEventListener('click',()=>multi?togglePendingAnswer(question,id,button):answer(id,button));
    });
    if(dom.confirmAnswerBtn){dom.confirmAnswerBtn.hidden=!multi||!!practiceAnswered;dom.confirmAnswerBtn.disabled=!pending.size;dom.confirmAnswerBtn.dataset.questionId=multi?question.id:''}
    if(practiceAnswered){
      state.locked=true;lockOptions();
      revealOptionResult(practiceAnswered.selected,questionCorrectIds(question));
      // 已答题按模式策略与普通练习开关展示；未答题不提前显示解析。
      if(shouldShowExplanation())renderPracticeExplanation(question,practiceAnswered.correct);
    }
    renderProgress();renderHealth();renderVerificationBanner();
    updateQuestionNav();
    renderAnswerSheet();
    if(state.mode==='scholar')renderTimer();
    if(state.mode==='revenge'&&!state.verification?.active&&state.revengeState?.phase==='remediation'&&state.revengeState?.questionId===question.id)showRemediation(question);
  }
  function updateQuestionNav(){
    // 三种模式都可通过底部按钮、滑动和答题卡自由跳题。
    if(!dom.questionNav)return;
    const navMode=state.active;
    const toggle=$('practiceExplanationToggle'),input=$('practiceAutoExplain');
    if(toggle)toggle.hidden=state.mode!=='practice'||state.reviewing;
    if(input)input.checked=autoExplainEnabled();
    if(dom.previousWrongToggle)dom.previousWrongToggle.hidden=state.mode!=='revenge'||state.reviewing||!!state.verification?.active;
    if(dom.showPreviousWrong)dom.showPreviousWrong.checked=state.showPreviousWrong;
    dom.questionNav.hidden=!navMode;
    if(!navMode)return;
    dom.questionPos.textContent=(state.index+1)+' / '+state.questions.length;
    if(dom.prevBtn)dom.prevBtn.disabled=state.index<=0;
    if(dom.nextBtn)dom.nextBtn.disabled=state.index>=state.questions.length-1;
  }
  function switchQuestion(delta){
    if(!state.active||state.submitting||state.pendingRequestKey||state.reconciling)return false;
    if(shouldAutoComplete()){finishPractice();return false}
    const next=state.index+Number(delta);
    if(next<0||next>=state.questions.length)return false;
    global.clearTimeout(state.feedbackTimer);state.feedbackTimer=0;
    state.index=next;state.locked=false;
    dom.feedback.hidden=true;hideRemediation();clearVerification();
    renderQuestion();
    return true;
  }
  function togglePendingAnswer(question,optionId,button){
    if(state.locked)return false;
    const selected=new Set(state.pendingSelections[question.id]||[]);
    if(selected.has(optionId))selected.delete(optionId);else selected.add(optionId);
    state.pendingSelections[question.id]=question.options.map(option=>text(option.id)).filter(id=>selected.has(id));
    button.classList.toggle('is-pending',selected.has(optionId));button.setAttribute('aria-pressed',selected.has(optionId)?'true':'false');
    if(dom.confirmAnswerBtn)dom.confirmAnswerBtn.disabled=!selected.size;
    return true;
  }
  function confirmPendingAnswer(){
    const question=state.verification?.active?state.verification.question:state.questions[state.index];
    if(!question||question.type!=='multiple_choice')return false;
    return answer(state.pendingSelections[question.id]||[],dom.confirmAnswerBtn);
  }
  function lockOptions(){dom.options.querySelectorAll('button').forEach(button=>button.disabled=true);if(dom.confirmAnswerBtn)dom.confirmAnswerBtn.disabled=true}
  function revealOptionResult(selectedIds,correctIds){
    const selected=new Set(Array.isArray(selectedIds)?selectedIds.map(text):[text(selectedIds)].filter(Boolean)),correct=new Set(Array.isArray(correctIds)?correctIds.map(text):[text(correctIds)].filter(Boolean));
    dom.options.querySelectorAll('[data-option-id]').forEach(button=>{
      button.classList.remove('is-correct','is-wrong','is-pending');
      const optionId=text(button.dataset.optionId);
      if(correct.has(optionId))button.classList.add('is-correct');
      else if(selected.has(optionId))button.classList.add('is-wrong');
    });
  }
  function shouldAutoComplete(){
    const stats=state.draft?.stats?.();
    return modePolicy().autoComplete&&stats?.total>0&&stats.answered===stats.total;
  }
  function advanceAfterAnswer(){
    if(!state.active||state.submitting||state.pendingRequestKey)return;
    if(shouldAutoComplete()||(state.mode==='scholar'&&state.health<=0)){finishPractice();return}
    if(state.mode==='challenge'&&state.health<=0&&!state.challengeFailedShown){state.challengeFailedShown=true;showChallengeFailDialog()}
    if(state.mode==='practice'||state.index>=state.questions.length-1){updateQuestionNav();renderAnswerSheet();return}
    state.index+=1;
    renderQuestion();
  }
  function answerVerificationQuestion(optionId){
    // 复仇验证题本地判对：验证结果只是草稿事实，服务端在交卷时权威推进。
    const verification=state.verification,question=verification.question;
    state.locked=true;lockOptions();
    const selected=Array.isArray(optionId)?optionId:[optionId],correctIds=questionCorrectIds(question);
    const correct=AnswerSet.grade?AnswerSet.grade(selected,correctIds):selected.length===1&&selected[0]===correctIds[0];
    revealOptionResult(selected,correctIds);renderPracticeExplanation(question,correct);
    if(correct){state.correct+=1;state.experience+=5}else{
      correctIds.forEach(id=>dom.options.querySelector('[data-option-id="'+CSS.escape(text(id))+'"]')?.classList.add('is-correct'));
    }
    showFeedback(correct?'验证通过 · 明日再验证':'验证未通过 · 继续补救',correct?'success':'danger');
    verification.sourceQuestion.mistakeStatus=correct?verification.sourceQuestion.mistakeStatus:'needs_remediation';
    // 保留最近复仇阶段供保存/恢复：验证通过回到待再验证；未通过回到补救面板
    state.revengeState={
      phase:correct?'verification_due':'remediation',
      mistakeId:verification.sourceQuestion.mistakeId,
      questionId:verification.sourceQuestion.id,
    };
    state.feedbackTimer=global.setTimeout(()=>finishRemediationVerification(correct),correct?900:620);
    renderHealth();
    return Promise.resolve(correct);
  }
  async function answer(optionId,button){
    // 本地即时判题：挑战/学霸/复仇（含会话恢复）统一走 draft.select，
    // 选择答案零写请求；长期错题推进只发生在交卷时的服务端权威重算。
    if(!state.active||state.locked||state.submitting||state.pendingRequestKey||state.conflict||state.reconciling)return false;
    const question=state.verification?.active?state.verification.question:state.questions[state.index];if(!question)return false;
    if(state.verification?.active)return answerVerificationQuestion(optionId);
    if(!state.draft)createDraft(state.session);
    const selected=question.type==='multiple_choice'?(Array.isArray(optionId)?optionId:[]):text(optionId);
    const selection=state.draft.select(question.id,selected);
    if(!selection?.accepted||!selection.answer){showToast(text(selection?.message)||'该题已作答');renderAnswerSheet();return false}
    const correct=selection.answer.correct===true;
    if(question.type==='multiple_choice')question.correctOptionIds=selection.answer.correctOptionIds||question.correctOptionIds;
    else question.correctAnswer=selection.answer.correctAnswer||question.correctAnswer;
    const stats=state.draft.stats();
    state.answered=stats.answered;state.correct=Math.max(state.correct,stats.correct);
    state.locked=true;lockOptions();
    delete state.pendingSelections[question.id];if(dom.confirmAnswerBtn)dom.confirmAnswerBtn.hidden=true;
    revealOptionResult(question.type==='multiple_choice'?selection.answer.selectedAnswerIds:selected,questionCorrectIds(question));
    // 挑战/学霸：作答与答题卡回看均不展示解析；
    // 复仇模式保留"答错即见解析与补救"的既有交互。
    if(shouldShowExplanation())renderPracticeExplanation(question,correct);
    renderAnswerSheet();
    // 游戏反馈分支：挑战/学霸用生命与时间驱动，复仇用错题状态推进（全部本地）。
    if(state.mode==='revenge'){
      if(!correct){
        // 复仇交互原则：答错才触发解析与补救；是否掌握交给后续验证题判断。
        state.streak=0;hideStreakPop();
        state.remediationPending=true;state.revengeState={phase:'remediation',mistakeId:question.mistakeId,questionId:question.id};
        showFeedback('再次答错 · 需要知识补救','danger');showRemediation(question);
        renderHealth();return correct;
      }
      state.streak+=1;state.experience+=10+streakBonus(state.streak);
      showFeedback('复仇成功 · 查看解析后进入下一题','success');
      state.revengeState={phase:'verification_due',mistakeId:question.mistakeId,questionId:question.id};
      renderHealth();return correct;
    }
    if(correct){
      state.streak+=1;state.maxStreak=Math.max(state.maxStreak||0,state.streak);const bonus=streakBonus(state.streak);
      state.experience+=10+bonus;
      let healed=false;
      // 学霸 V2：连续答对 5 题回血 1 点，不超过初始生命上限
      if(state.mode==='scholar'&&state.streak%5===0&&state.health<state.maxHealth){state.health+=1;healed=true}
      const beforeSeconds=state.mode==='scholar'?remainingSeconds():0;
      if(state.mode==='scholar')setScholarSeconds(Math.min(SCHOLAR_MAX_SECONDS,beforeSeconds+20));
      const gainedSeconds=state.mode==='scholar'?Math.max(0,remainingSeconds()-beforeSeconds):0;
      if(state.streak>=3)showStreakPop('连胜 ×'+state.streak+(bonus?' · +'+bonus+' 经验':'')+(healed?' · +1 ♥':''));
      showFeedback('正确'+(state.mode==='scholar'?(gainedSeconds?' · +'+gainedSeconds+' 秒':' · 时间已满'):'')+' · +'+(10+bonus)+' 经验','success');
    }else{
      state.streak=0;hideStreakPop();if(state.mode!=='practice')state.health=Math.max(0,state.health-1);
      if(state.mode==='scholar'){
        const after=Math.max(0,remainingSeconds()-20);setScholarSeconds(after>0?after:(state.health>0?40:0));
        showFeedback('错误 · -20 秒 · -1 ♥','danger');
      }else showFeedback(state.mode==='practice'?'回答错误':'失误 · -1 ♥','danger');
    }
    renderHealth();
    state.feedbackTimer=global.setTimeout(advanceAfterAnswer,FEEDBACK_DELAY);
    return correct;
  }
  async function handleTimeout(){
    // 学霸本地超时：只记 timedOut 草稿（selectedAnswer 统一 '__timeout__'），零写请求。
    if(!state.active||state.mode!=='scholar'||state.locked||state.submitting||state.pendingRequestKey||state.conflict||state.reconciling||remainingSeconds()>0)return;
    const question=state.questions[state.index];if(!question)return;
    state.locked=true;lockOptions();
    if(!state.draft)createDraft(state.session);
    const selection=state.draft.select(question.id,'',{timedOut:true});
    question.correctAnswer=text(selection?.answer?.correctAnswer||question.correctAnswer);
    const stats=state.draft.stats();
    state.answered=stats.answered;state.correct=Math.max(state.correct,stats.correct);
    revealOptionResult([],questionCorrectIds(question));renderAnswerSheet();
    state.streak=0;hideStreakPop();state.health=Math.max(0,state.health-1);dom.questionCard.classList.add('is-timeout');
    showFeedback('超时 · -1 ♥','danger');renderHealth();
    if(state.health>0)setScholarSeconds(40);
    if(state.health<=0&&state.mode==='scholar'){finishPractice();return}
    state.feedbackTimer=global.setTimeout(advanceAfterAnswer,FEEDBACK_DELAY);
  }
  function timerTick(){renderTimer();void handleTimeout()}
  function startTimer({resume=false}={}){
    if(state.mode!=='scholar')return;if(!resume)setScholarSeconds(SCHOLAR_MAX_SECONDS);state.timerId=global.setInterval(timerTick,50);
  }
  function showChallengeFailDialog(){
    if(!dom.failBackdrop)return;
    dom.failBackdrop.hidden=false;
    const continueBtn=dom.failContinueBtn;
    if(continueBtn)continueBtn.focus();
  }
  function closeChallengeFailDialog(){if(dom.failBackdrop)dom.failBackdrop.hidden=true}
  function submissionPayload(){
    // 整卷载荷：answers 只含 selectedAnswer/timedOut/selectionIndex（无客户端真值），
    // 服务端忽略客户端 correct 等字段并按冻结快照权威重算。
    return {
      answers:state.draft?.submission?.()||{},
      runtimeState:runtimeState(),
    };
  }

  async function saveAndExit(){
    if(!state.active||!state.session){showToast('当前练习无法保存，请继续作答或放弃。');return false}
    if(state.submitting||state.pendingRequestKey||state.reconciling)return false;
    state.submitting=true;
    const button=dom.saveExitBtn;
    try{
      return await runClickedRequest({key:'save',button,title:'正在保存进度',message:'正在保存做题进度…'},async()=>{
        const api=practiceApi(),payload=submissionPayload();
        const saved=await saveCoordinator().save('pause',state.session.id,{revision:state.session.revision,...payload});
        state.session=normalizedSession(saved);
        createDraft(state.session);
        state.draft.markSaved();
        state.submitting=false;
        state.active=false;clearTimers();closeExitConfirm();showLobby();return true;
      });
    }catch(error){
      handleSessionError(error,{allowRetry:true});return false;
    }finally{state.submitting=false}
  }

  async function finishPractice(){
    if(!state.active||state.submitting||state.pendingRequestKey||state.reconciling)return false;
    $('practiceSettlementRetry').hidden=true;
    if(state.session){
      state.submitting=true;
      try{
        return await runClickedRequest({key:'complete',button:dom.submitAnywayBtn,title:'正在结算练习',message:'正在生成成绩报告…'},async()=>{
          const api=practiceApi(),payload=submissionPayload();
          const completed=await runSessionMutation(session=>saveCoordinator().save('complete',session.id,{revision:session.revision,...payload}));
          state.report=clone(completed?.report||null);
          if(completed?.session)state.session=normalizedSession(completed.session);
          state.draft?.markSaved?.();
          state.submitting=false;
          return concludePractice();
        });
      }catch(error){handleSessionError(error);if(Number(error?.status)!==409)$('practiceSettlementRetry').hidden=false;return false}
      finally{state.submitting=false}
    }
    return concludePractice();
  }

  function concludePractice(){
    if(state.session)state.experience=Number(state.session.stats?.experience??state.experience);
    state.draft?.markSaved?.();
    state.active=false;state.reviewing=false;state.completed=true;state.endedAt=Date.now();clearTimers();hideStreakPop();hideRemediation();clearVerification();setDangerVignette(false);renderProgress();closeChallengeFailDialog();
    if(!state.session)recordCompletedSession('completed');dom.resultAccuracy.textContent=(state.report?.scorePercent??accuracy())+'%';dom.resultDuration.textContent=formatDuration(state.report?.durationMs??elapsed());dom.resultExperience.textContent=String(state.experience);
    renderModeOutcome();
    if(state.report)renderFrozenReport();
    setView('result');
    return true;
  }
  function renderModeOutcome(){
    if(!dom.challengeOutcome)return;
    const mode=state.session?.mode||state.mode;
    dom.challengeOutcome.hidden=!['challenge','scholar'].includes(mode);
    if(dom.challengeOutcome.hidden)return;
    const stats=state.session?.stats||{},runtime=state.session?.runtimeState||{};
    const total=state.questions.length,answered=Number(stats.answered??state.answered);
    const maximum=mode==='challenge'?challengeInitialHealth(total):scholarInitialHealth(total);
    const health=state.session?(mode==='challenge'?Math.max(0,maximum-Number(stats.wrong||0)):Number(runtime.health??maximum)):state.health;
    dom.challengeResult.textContent=(mode==='scholar'?'学霸挑战':'挑战')+(health>0?'成功':'失败');
    dom.challengeResult.className=health>0?'is-success':'is-failed';
    dom.challengeDetail.textContent=(mode==='scholar'?(answered>=total?'已完成全部题目':'完成 '+answered+' / '+total+' 题')+' · ':'')+
      '剩余生命 '+health+' / '+maximum+(mode==='scholar'?' · 最高连胜 '+Number(runtime.maxStreak??state.maxStreak??0):'');
  }
  async function abandonPractice(){
    if(!state.active||state.pendingRequestKey||state.reconciling)return false;
    const button=dom.abandonBtn;
    try{
      return await runClickedRequest({key:'abandon',button,title:'正在放弃练习',message:'正在结束本次练习…'},async()=>{
        if(!state.active)return false;
        if(state.session){
          const api=practiceApi(),payload=submissionPayload();
          await runSessionMutation(session=>saveCoordinator().save('abandon',session.id,{revision:session.revision,...payload}));
        }
        return concludeAbandon();
      });
    }catch(error){handleSessionError(error,{allowRetry:true});return false}
  }

  function concludeAbandon(){
    // 明确放弃后清除 dirty：不再触发离开提醒。
    state.draft?.markSaved?.();
    state.active=false;state.endedAt=Date.now();clearTimers();hideStreakPop();hideRemediation();clearVerification();setDangerVignette(false);state.abandonedRecorded=true;if(!state.session)recordCompletedSession('abandoned');closeExitConfirm();closeChallengeFailDialog();showLobby();return true;
  }
  function startRevenge(){
    const records=activeMistakeRecords();
    if(!records.length){showToast('暂无待复仇错题，先去挑战或学霸模式练习吧。');return false}
    const questions=records.map(questionFromMistake).filter(question=>question.stem&&question.options.length>=2&&question.correctAnswer);
    if(!questions.length){showToast('错题内容暂不可用，请稍后刷新重试。');return false}
    const policy=global.KGRevengeEntryPolicy.derive(questions.length,state.revengeSelectedCount),count=policy.requestCount;
    clearTimers();hideStreakPop();hideRemediation();clearVerification();setDangerVignette(false);
    state.mode='revenge';state.showPreviousWrong=true;state.order='weakness_first';state.questions=questions.slice(0,count);state.pendingSelections={};state.index=0;state.health=MAX_HEALTH;state.streak=0;state.experience=0;state.correct=0;state.answered=0;state.startedAt=Date.now();state.endedAt=0;state.locked=false;state.active=true;state.completed=false;state.abandonedRecorded=false;
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
    state.saves=null;$('practiceSettlementRetry').hidden=true;
    state.session=normalizedSession(session);state.report=null;state.reviewing=false;state.mode=state.session.mode;state.showPreviousWrong=true;state.questions=sessionQuestions(state.session);
    createDraft(state.session);
    const runtime=state.session.runtimeState||{},stats=state.session.stats||{};
    state.index=Math.max(0,Math.min(state.questions.length-1,Number(runtime.currentIndex)||0));
    state.maxHealth=state.mode==='challenge'?challengeInitialHealth(state.questions.length):state.mode==='scholar'?scholarInitialHealth(state.questions.length):MAX_HEALTH;
    state.health=Number.isInteger(runtime.health)?runtime.health:state.maxHealth;state.streak=Math.max(0,Number(runtime.streak)||0);state.maxStreak=Math.max(0,Number(runtime.maxStreak)||0);state.experience=Math.max(0,Number(runtime.experience??stats.experience)||0);state.correct=Math.max(0,Number(stats.correct)||0);state.answered=Math.max(0,Number(stats.answered)||0);
    // 挑战无回血：生命是题量与已答错题的派生值，不能信任旧版保存的固定 3 点血量。
    // 草稿统一重判已保存答案，也覆盖尚未写入 correct 字段的显式保存进度。
    if(state.mode==='challenge')state.health=Math.max(0,state.maxHealth-Number(state.draft?.stats().wrong??stats.wrong??0));
    state.startedAt=Date.now()-Math.max(0,Number(stats.durationMs)||0);state.endedAt=0;state.locked=false;state.active=true;state.completed=false;state.abandonedRecorded=false;state.challengeFailedShown=false;state.revengeState=runtime.revengeState?clone(runtime.revengeState):null;state.verification=null;state.conflict=false;setConflictVisible(false);
    // 挑战/学霸恢复时血量可能与满血差距很大；顶栏虽然按剩余血量渲染，
    // 但"开始挑战"按钮静默恢复会让人误以为是满血新开局，必须明确告知剩余血量。
    if((state.mode==='challenge'||state.mode==='scholar')&&state.health<state.maxHealth)showToast('已恢复上次进度 · 剩余血量 '+state.health+' / '+state.maxHealth);
    state.lastSettings={paperId:catalog?.id||state.session.paperId,count:state.questions.length,order:text(runtime.order||state.order||'paper'),mode:state.mode};document.body.dataset.practiceMode=state.mode;
    if(state.mode==='scholar')state.deadline=Date.now()+Math.max(0,Number(runtime.remainingMs??SCHOLAR_MAX_SECONDS*1000));
    dom.timer.hidden=true;dom.timeRow.hidden=state.mode!=='scholar';dom.health.hidden=!modePolicy().showHealth;
    setView('game');renderQuestion();if(state.mode==='scholar')startTimer({resume:true});
    return true;
  }
  async function resolvePracticeEntrySession(session,input){
    const api=practiceApi();
    if(!session)return api.startSession(input);
    const previousCount=session.questions?.length||Number(session.stats?.total)||0;
    // 同卷只允许一份未完成会话；不能忽略新选题量，也不能未经确认放弃旧进度。
    // 复仇模式实际题量可能受可用错题数限制，保留原有恢复规则。
    if(input.mode!=='revenge'&&previousCount!==input.count){
      const message='上次练习共有 '+previousCount+' 题，已答 '+Number(session.stats?.answered||0)+' 题；本次选择了 '+input.count+' 题。是否放弃上次未完成的练习，开始新的 '+input.count+' 题练习？取消将保留上次进度。';
      if(!global.confirm(message))return null;
      await api.abandonSession(session.id,{revision:session.revision});
      return api.startSession(input);
    }
    return session;
  }
  function practiceEntryInput(mode,catalog,count){
    const order=mode==='revenge'?'paper':(dom.orderInputs.find(input=>input.checked)?.value||'paper');
    if(mode==='revenge')return {mode,count:revengePolicy().requestCount,order};
    return {paperId:text(catalog?.paperId||catalog?.id),releaseId:text(catalog?.releaseId),mode,count,order};
  }
  function resumableEntry(sessions,mode,paperId){
    const rows=Array.isArray(sessions)?sessions:[];
    return mode==='revenge'?rows.find(item=>item.mode==='revenge'):rows.find(item=>text(item.paperId)===paperId&&item.mode===mode);
  }
  async function startPractice(mode){
    const challenge=mode==='challenge';
    if(state.entryStartingMode)return false;
    if(mode==='revenge'&&!hasAuthenticatedUser())return startRevenge();
    const catalog=selectedRelease(),count=Number(state.selectedCount);
    if(mode!=='revenge'&&!catalog){syncLobby();return false}
    const access=catalog?paperAccess(catalog):{allowed:true,accessLevel:'free'};
    if(mode!=='revenge'&&!access.allowed)return openMembership(access);
    let restoreFocus=false;
    const beginEntry=()=>{
      setEntryStarting(mode,true);
      global.KGLearningLoading?.show?.({title:challenge?'正在准备挑战':'正在进入练习模式',message:'正在读取试题…'});
    };
    const endEntry=()=>setEntryStarting(mode,false,{focus:restoreFocus});
    return runClickedRequest({key:'start',button:dom.startButtons.find(item=>item.dataset.practiceStart===String(mode)),title:challenge?'正在准备挑战':'正在进入练习模式',message:'正在读取试题…'},async()=>{
      try{
        const api=practiceApi();
        if(hasAuthenticatedUser()&&typeof api?.startSession==='function'){
          const input=practiceEntryInput(mode,catalog,count),paperId=text(input.paperId);
          const active=await api.getActiveSessions({mode});
          const resumable=resumableEntry(active,mode,paperId);
          const session=await resolvePracticeEntrySession(resumable?await api.getSession(resumable.id):null,input);
          if(!session){restoreFocus=true;return false}
          state.order=input.order;
          return restoreServerSession(session,mode==='revenge'?null:catalog);
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
        state.session=null;state.report=null;state.saves=null;$('practiceSettlementRetry').hidden=true;
        state.mode=mode==='scholar'?'scholar':mode==='practice'?'practice':'challenge';document.body.dataset.practiceMode=state.mode;state.order=dom.orderInputs.find(input=>input.checked)?.value||'paper';
        if(state.order==='random')questions=shuffle(questions);
        if(state.retiredNavigation)questions=prioritizeRetiredQuestion(questions,state.retiredNavigation.questionId);
        state.questions=questions.slice(0,count);state.pendingSelections={};
        state.index=0;state.maxHealth=state.mode==='challenge'?challengeInitialHealth(state.questions.length):state.mode==='scholar'?scholarInitialHealth(state.questions.length):MAX_HEALTH;state.health=state.maxHealth;state.challengeFailedShown=false;state.streak=0;state.maxStreak=0;state.experience=0;state.correct=0;state.answered=0;state.startedAt=Date.now();state.endedAt=0;state.locked=false;state.active=true;state.completed=false;state.abandonedRecorded=false;
        createDraft(null);
        state.lastSettings={paperId:catalog.id,count,order:state.order,mode:state.mode};
        dom.timer.hidden=true;dom.timeRow.hidden=state.mode!=='scholar';dom.health.hidden=state.mode==='practice';
        setView('game');renderQuestion();if(state.mode==='scholar')startTimer();return true;
      }catch(error){
        restoreFocus=true;
        if(hasAuthenticatedUser()&&error?.detail?.code==='RESUMABLE_SESSION_EXISTS'){
          try{
            const api=practiceApi(),input=practiceEntryInput(mode,catalog,count),sessionId=text(error.detail.sessionId);
            const active=sessionId?[]:await api.getActiveSessions({mode});
            const resumable=sessionId?await api.getSession(sessionId):resumableEntry(active,mode,text(input.paperId));
            if(resumable){
              const session=await resolvePracticeEntrySession(resumable,input);
              return session?restoreServerSession(session,mode==='revenge'?null:catalog):false;
            }
          }catch(resumeError){}
        }
        const errorCode=error?.detail?.code;
        showToast(errorCode==='NO_REVENGE_QUESTIONS'?'当前没有可用的全局复仇错题。':errorCode==='REVENGE_SNAPSHOT_UNAVAILABLE'?'历史错题内容暂不可用，可先使用其他练习模式。':'试题读取失败，请稍后重试。');
        return false;
      }
    },beginEntry,endEntry);
  }
  function startAgain(){
    const settings=state.lastSettings;if(!settings){showLobby();return}
    state.selectedPaperId=settings.paperId;state.selectedCount=settings.count;state.order=settings.order;
    if(settings.mode==='revenge'){state.revengeSelectedCount=settings.count;startPractice('revenge');return}
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
  function closeAnswerSheetDrawer(focusEntry=false){
    setDrawerOpen(dom.answerSheetDrawer,false);
    dom.answerSheetMobileBtn?.setAttribute('aria-expanded','false');
    // 关闭 / 遮罩 / Escape 后焦点回到入口按钮，保证键盘与读屏用户能再次打开答题卡。
    if(focusEntry)dom.answerSheetMobileBtn?.focus?.();
  }
  function openSubmitConfirm(){
    if(!modePolicy().canSubmit)return false;
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
    const revengeEntry=revengePolicy();
    dom.startButtons.forEach(button=>{
      const revenge=button.dataset.practiceStart==='revenge',revengeStats=getMistakeStats(),revengeAvailable=revengeStats.active>0,revengeUnavailable=Number(revengeStats.unavailable||0)>0;
      button.disabled=revenge?!revengeAvailable&&!revengeUnavailable:(!release||!firstEnabled);
      button.classList.toggle('is-upgrade',!revenge&&!!release&&!access.allowed);
      button.textContent=revenge?(revengeAvailable?`开始复仇（${revengeEntry.automatic?'全部 ':''}${revengeEntry.requestCount} 题）`:revengeUnavailable?'检查错题内容':'暂无错题'):( !release?(button.dataset.defaultLabel||button.textContent):(!access.allowed?'开通会员':button.dataset.defaultLabel||button.textContent));
    });
    dom.setupCard?.classList.toggle('is-vip-locked',!!release&&!access.allowed);
  }
  async function syncResumableButtons(){
    const release=selectedRelease(),api=practiceApi(),token=++state.resumeLookupToken;
    if(!hasAuthenticatedUser()||typeof api?.getActiveSessions!=='function')return;
    try{
      const paperId=text(release?.paperId||release?.id),releaseKey=text(release?.id),sessions=await api.getActiveSessions({});
      if(token!==state.resumeLookupToken||releaseKey!==text(selectedRelease()?.id))return;
      ['challenge','scholar','revenge'].forEach(mode=>{
        const button=dom.startButtons.find(item=>item.dataset.practiceStart===mode),session=resumableEntry(sessions,mode,paperId);if(!button||!session)return;
        const stats=session.stats||{},total=Number(stats.total||session.questions?.length||0);button.disabled=false;
        button.textContent=mode==='revenge'?'继续上次复仇 '+Number(stats.answered||0)+'/'+total:total!==state.selectedCount?'开始新的 '+state.selectedCount+' 题练习':'继续上次练习 '+Number(stats.answered||0)+'/'+total;
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
    const revengeStats=getMistakeStats(),revengeAvailable=revengeStats.active>0||Number(revengeStats.unavailable||0)>0;
    dom.empty.hidden=!!releases.length||revengeAvailable;dom.setupCard.hidden=!releases.length;dom.modeGrid.hidden=!releases.length&&!revengeAvailable;
    const library=dom.paperLibrary?.closest('.practice-library');if(library)library.hidden=!releases.length;
    renderPaperLibrary();syncCountOptions();syncPaperMeta();syncRevengeStats();syncResumableButtons();
  }
  function syncRevengeStats(){
    const stats=getMistakeStats();
    const policy=revengePolicy();state.revengeSelectedCount=policy.selectedCount;
    if(dom.revengeActiveCount)dom.revengeActiveCount.textContent=String(stats.active||0);
    if(dom.revengePendingCount)dom.revengePendingCount.textContent=String(stats.pending||0);
    if(dom.revengeRemediationCount)dom.revengeRemediationCount.textContent=String(stats.needsRemediation||0);
    if(dom.revengeVerificationCount)dom.revengeVerificationCount.textContent=String(stats.verificationDue||0);
    if(dom.revengeMasteredCount)dom.revengeMasteredCount.textContent=String(stats.mastered||0);
    if(dom.revengeCountSummary)dom.revengeCountSummary.textContent=!policy.total?'当前暂无可复仇错题':policy.automatic?`本次自动进入全部 ${policy.total} 题`:`共 ${policy.total} 题可复仇，请选择本次题量`;
    if(dom.revengeCountOptions){
      dom.revengeCountOptions.hidden=policy.automatic||!policy.total;
      if(dom.revengeCountOptionList)dom.revengeCountOptionList.innerHTML=policy.options.map(option=>`<label><input type="radio" name="practiceRevengeCount" value="${option.value}" ${option.value===policy.selectedCount?'checked':''} ${option.disabled?'disabled':''}/><span>${escapeHTML(option.label)}</span></label>`).join('');
    }
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
  function showLobby(){state.completed=false;state.reviewing=false;clearTimers();setConflictVisible(false);document.body.classList.remove('is-practice-review');if(dom.reviewBackBtn)dom.reviewBackBtn.hidden=true;hideStreakPop();hideRemediation();clearVerification();setDangerVignette(0);delete document.body.dataset.practiceMode;setView('lobby');syncLobby();refreshExperiencePanel()}
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
    dom.countInputs.forEach(input=>input.addEventListener('change',()=>{if(input.checked){state.selectedCount=Number(input.value);syncCountOptions();syncResumableButtons()}}));
    dom.revengeCountOptions?.addEventListener('change',event=>{const input=event.target.closest?.('[name="practiceRevengeCount"]');if(!input?.checked||input.disabled)return;state.revengeSelectedCount=Number(input.value);syncRevengeStats();syncCountOptions();syncResumableButtons()});
    dom.revengeRuleShell?.addEventListener('mouseenter',()=>setRevengeRuleOpen(true));
    dom.revengeRuleShell?.addEventListener('mouseleave',()=>{if(!state.revengeRulePinned&&document.activeElement!==dom.revengeRuleTrigger)setRevengeRuleOpen(false)});
    dom.revengeRuleTrigger?.addEventListener('focus',()=>setRevengeRuleOpen(true));
    dom.revengeRuleTrigger?.addEventListener('blur',()=>global.setTimeout(()=>{if(!state.revengeRulePinned&&!dom.revengeRuleShell?.contains(document.activeElement))setRevengeRuleOpen(false)},0));
    dom.revengeRuleTrigger?.addEventListener('click',event=>{event.stopPropagation();state.revengeRulePinned=!state.revengeRulePinned;setRevengeRuleOpen(state.revengeRulePinned)});
    document.addEventListener('click',event=>{if(!dom.revengeRuleShell?.contains(event.target)){state.revengeRulePinned=false;setRevengeRuleOpen(false)}});
    dom.startButtons.forEach(button=>button.addEventListener('click',()=>startPractice(button.dataset.practiceStart)));
    dom.confirmAnswerBtn?.addEventListener('click',confirmPendingAnswer);
    $('practiceSettlementRetry')?.addEventListener('click',finishPractice);
    dom.exitBtn.addEventListener('click',openExitConfirm);dom.exitCancel.addEventListener('click',closeExitConfirm);dom.saveExitBtn?.addEventListener('click',saveAndExit);dom.abandonBtn?.addEventListener('click',abandonPractice);
    dom.sessionConflictReload?.addEventListener('click',reloadLatestSession);
    dom.exitConfirm.addEventListener('click',event=>{if(event.target===dom.exitConfirm)closeExitConfirm()});
    // 答题卡唯一开关（保留旧 ID 兼容绑定）：打开抽屉；关闭按钮 / 遮罩 / Escape 都把焦点还回入口
    const answerSheetToggle=openAnswerSheetDrawer;
    dom.answerSheetMobileBtn?.addEventListener('click',answerSheetToggle);
    dom.answerSheetDrawerClose?.addEventListener('click',()=>closeAnswerSheetDrawer(true));
    dom.answerSheetDrawer?.addEventListener('click',event=>{if(event.target===dom.answerSheetDrawer)closeAnswerSheetDrawer(true)});
    dom.reviewBackBtn?.addEventListener('click',returnToFrozenReport);
    dom.submitReturnBtn?.addEventListener('click',returnToFirstUnanswered);dom.submitAnywayBtn?.addEventListener('click',()=>{if(!modePolicy().canSubmit)return;closeSubmitConfirm();finishPractice()});dom.submitConfirm?.addEventListener('click',event=>{if(event.target===dom.submitConfirm)closeSubmitConfirm()});
    dom.againBtn.addEventListener('click',startAgain);dom.lobbyBtn.addEventListener('click',showLobby);dom.remediationContinueBtn?.addEventListener('click',startRemediationVerification);dom.remediationReviewBtn?.addEventListener('click',toggleRemediationExplanation);
    // 挑战 V2：生命归零失败弹窗（退回大厅 / 继续作答）
    dom.failLobbyBtn?.addEventListener('click',()=>{closeChallengeFailDialog();abandonPractice()});
    dom.failContinueBtn?.addEventListener('click',closeChallengeFailDialog);
    // 复仇模式：底部按钮 + 触屏左右滑动切题
    dom.prevBtn?.addEventListener('click',()=>switchQuestion(-1));
    dom.nextBtn?.addEventListener('click',()=>switchQuestion(1));
    // 语言单按钮循环切换：中 → EN → 双 → 中
    const autoExplain=$('practiceAutoExplain');
    autoExplain?.addEventListener('change',()=>{global.KGActivitySchemaV1?.setPracticeAutoExplain?.(autoExplain.checked);renderQuestion()});
    dom.showPreviousWrong?.addEventListener('change',()=>{
      state.showPreviousWrong=dom.showPreviousWrong.checked;
      renderPreviousWrongAnswer(state.verification?.active?state.verification.question:state.questions[state.index]);
    });
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
    if(dom.questionCard){
      let swipeStartX=0,swipeStartY=0;
      dom.questionCard.addEventListener('touchstart',event=>{const t=event.touches[0];swipeStartX=t.clientX;swipeStartY=t.clientY},{passive:true});
      dom.questionCard.addEventListener('touchend',event=>{
        const t=event.changedTouches[0],dx=t.clientX-swipeStartX,dy=t.clientY-swipeStartY;
        if(Math.abs(dx)>48&&Math.abs(dx)>Math.abs(dy)*1.4)switchQuestion(dx<0?1:-1);
      },{passive:true});
    }
    document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if(dom.revengeRuleTrigger?.getAttribute('aria-expanded')==='true'){state.revengeRulePinned=false;setRevengeRuleOpen(false)}else if(!dom.submitConfirm.hidden)closeSubmitConfirm();else if(!dom.exitConfirm.hidden)closeExitConfirm();else if(dom.answerSheetDrawer&&!dom.answerSheetDrawer.hidden)closeAnswerSheetDrawer(true);else if(dom.paperDrawer&&!dom.paperDrawer.hidden)closePaperDrawer();else if(dom.historyDrawer&&!dom.historyDrawer.hidden)closeHistoryDrawer()});
    global.addEventListener('kg-auth-session-change',()=>{if(!state.active)syncLobby();if(!state.active)refreshExperiencePanel()});
    global.addEventListener('kg-subscription-change',()=>{if(!state.active)syncLobby()});
    global.addEventListener('kg-subscription-plan-change',()=>{if(!state.active)syncLobby()});
    global.addEventListener('kg:published-papers-changed',()=>{if(!state.active)syncLobby()});
    // 三态语言切换即时重渲染当前题（作答与判题不受影响）
    global.addEventListener('kg:question-language-mode',()=>{if(state.active)try{renderQuestion()}catch(error){}});
    global.addEventListener('kg-practice-mistakes-change',()=>{if(!state.active)syncLobby()});
    global.addEventListener('pagehide',()=>{
      if(!state.session||!hasAuthenticatedUser())return;
      saveCoordinator().flushForPageHide({sessionId:state.session.id,
        input:{revision:state.session.revision,...submissionPayload()},
        active:state.active,dirty:state.draft?.isDirty?.()===true});
    });
    global.addEventListener('pageshow',event=>{if(event.persisted)void reconcileAfterPageShow()});
    // 仅 dirty 时提醒离开；取消提醒不会触发保存，实际 pagehide 才尝试发送。
    global.addEventListener('beforeunload',event=>{
      if(!state.active||!state.draft?.isDirty?.())return;
      event.preventDefault();
      event.returnValue='';
    });
  }
  async function reconcileAfterPageShow(){
    if(!state.active||!state.session||!hasAuthenticatedUser()||state.reconciling)return;
    const sessionId=state.session.id;
    state.reconciling=true;state.locked=true;clearTimers();
    try{
      const latest=await practiceApi().getSession(sessionId);
      if(state.session?.id!==sessionId)return;
      if(['completed','abandoned'].includes(latest.status)){state.reconciling=false;await reloadLatestSession();return}
      const local=state.draft?.submission?.()||{};
      const saved=global.KGPracticeDraftState.create({questions:latest.questions,answers:latest.answers}).submission();
      const conflicting=Object.entries(saved).some(([id,answer])=>!local[id]||JSON.stringify(answer)!==JSON.stringify(local[id]));
      if(conflicting){setConflictVisible(true);showFeedback('进度已在其他页面更新，请加载最新进度。','danger');return}
      saveCoordinator().reset();
      if(Object.keys(saved).length===Object.keys(local).length){restoreServerSession(latest,selectedRelease());state.reconciling=false;if(shouldAutoComplete())void finishPractice();return}
      state.session=normalizedSession(latest);
      renderQuestion();if(state.mode==='scholar')startTimer({resume:true});
      showFeedback('页面中的最新作答尚未保存，可通过退出重试保存。','danger');
    }catch(error){setConflictVisible(true);showFeedback('进度读取失败，请加载最新进度后继续。','danger')}
    finally{state.reconciling=false}
  }
  function cacheDom(){
    Object.assign(dom,{
      lobby:$('practiceLobby'),game:$('practiceGame'),checkpoint:$('practiceCheckpoint'),result:$('practiceResult'),paperSelect:$('practicePaperSelect'),paperMeta:$('practicePaperMeta'),retiredNotice:$('practiceRetiredModeNotice'),selectedPaperName:$('practiceSelectedPaperName'),paperLibrary:$('practicePaperLibrary'),paperDrawerLibrary:$('practicePaperDrawerLibrary'),filterButtons:[...document.querySelectorAll('[data-paper-filter]')],librarySummary:$('practiceLibrarySummary'),paperDrawerSummary:$('practicePaperDrawerSummary'),libraryMoreBtn:$('practiceLibraryMoreBtn'),paperDrawer:$('practicePaperDrawer'),paperDrawerClose:$('practicePaperDrawerClose'),toast:$('practiceToast'),
      setupCard:document.querySelector('.practice-setup-card'),modeGrid:document.querySelector('.practice-mode-grid'),empty:$('practiceEmpty'),countInputs:[...document.querySelectorAll('[name="practiceCount"]')],orderInputs:[...document.querySelectorAll('[name="practiceOrder"]')],startButtons:[...document.querySelectorAll('[data-practice-start]')],revengeActiveCount:$('practiceRevengeActiveCount'),revengePendingCount:$('practiceRevengePendingCount'),revengeRemediationCount:$('practiceRevengeRemediationCount'),revengeVerificationCount:$('practiceRevengeVerificationCount'),revengeMasteredCount:$('practiceRevengeMasteredCount'),revengeCountSummary:$('practiceRevengeCountSummary'),revengeCountOptions:$('practiceRevengeCountOptions'),revengeCountOptionList:$('practiceRevengeCountOptionList'),revengeRuleShell:$('practiceRevengeRuleShell'),revengeRuleTrigger:$('practiceRevengeRuleTrigger'),revengeRuleTooltip:$('practiceRevengeRuleTooltip'),
      progressShell:$('practiceProgressShell'),progressBar:$('practiceProgressBar'),questionProgress:$('practiceQuestionProgress'),health:$('practiceHealth'),timer:$('practiceTimer'),timeRow:$('practiceTimeRow'),timeRail:$('practiceTimeRail'),timeBar:$('practiceTimeBar'),timerMs:$('practiceTimerMs'),dangerVignette:$('practiceDangerVignette'),streakPop:$('practiceStreakPop'),feedback:$('practiceFeedback'),sessionConflict:$('practiceSessionConflict'),sessionConflictReload:$('practiceSessionConflictReload'),verificationBanner:$('practiceVerificationBanner'),verificationKnowledge:$('practiceVerificationKnowledge'),verificationMessage:$('practiceVerificationMessage'),questionCard:$('practiceQuestionCard'),questionStem:$('practiceQuestionStem'),previousWrongAnswer:$('practicePreviousWrongAnswer'),previousWrongToggle:$('practicePreviousWrongToggle'),showPreviousWrong:$('practiceShowPreviousWrong'),options:$('practiceOptions'),confirmAnswerBtn:$('practiceConfirmAnswerBtn'),questionNav:$('practiceQuestionNav'),prevBtn:$('practicePrevBtn'),nextBtn:$('practiceNextBtn'),questionPos:$('practiceQuestionPos'),remediationPanel:$('practiceRemediationPanel'),remediationKnowledge:$('practiceRemediationKnowledge'),remediationMessage:$('practiceRemediationMessage'),remediationReviewBtn:$('practiceRemediationReviewBtn'),remediationContinueBtn:$('practiceRemediationContinueBtn'),remediationExplanation:$('practiceRemediationExplanation'),
      exitBtn:$('practiceExitBtn'),reviewBackBtn:$('practiceReviewBackBtn'),exitConfirm:$('practiceExitConfirm'),exitCancel:$('practiceExitCancel'),exitConfirmBtn:$('practiceExitConfirmBtn'),saveExitBtn:$('practiceSaveExitBtn'),abandonBtn:$('practiceAbandonBtn'),answerSheetRoot:$('practiceAnswerSheet'),answerSheetMobileBtn:$('practiceAnswerSheetMobileBtn'),answerSheetMobileCount:document.querySelector('#practiceAnswerSheetMobileBtn span'),answerSheetDrawer:$('practiceAnswerSheetDrawer'),answerSheetDrawerClose:$('practiceAnswerSheetDrawerClose'),submitConfirm:$('practiceSubmitConfirm'),submitMessage:$('practiceSubmitMessage'),submitReturnBtn:$('practiceSubmitReturnBtn'),submitAnywayBtn:$('practiceSubmitAnywayBtn'),checkpointStreak:$('practiceCheckpointStreak'),checkpointExperience:$('practiceCheckpointExperience'),checkpointDuration:$('practiceCheckpointDuration'),checkpointContinue:$('practiceCheckpointContinue'),resultAccuracy:$('practiceResultAccuracy'),resultDuration:$('practiceResultDuration'),resultExperience:$('practiceResultExperience'),challengeOutcome:$('practiceChallengeOutcome'),challengeResult:$('practiceChallengeResult'),challengeDetail:$('practiceChallengeDetail'),failBackdrop:$('practiceFailBackdrop'),failLobbyBtn:$('practiceFailLobbyBtn'),failContinueBtn:$('practiceFailContinueBtn'),againBtn:$('practiceAgainBtn'),lobbyBtn:$('practiceLobbyBtn'),historyOpenBtn:$('practiceHistoryOpenBtn'),historyCount:$('practiceHistoryCount'),historyDrawer:$('practiceHistoryDrawer'),historyCloseBtn:$('practiceHistoryCloseBtn'),historySummary:$('practiceHistorySummary'),historyList:$('practiceHistoryList'),historyEmpty:$('practiceHistoryEmpty'),clearHistoryBtn:$('practiceClearHistoryBtn')
    });
  }
  function snapshot(){return {sessionId:text(state.session?.id),revision:Number(state.session?.revision||0),status:text(state.session?.status),mode:state.mode,index:state.index,health:state.health,streak:state.streak,experience:state.experience,correct:state.correct,answered:state.answered,remainingSeconds:state.mode==='scholar'?remainingSeconds():null,active:state.active,reviewing:state.reviewing,view:document.body.dataset.practiceView||'',questionCount:state.questions.length}}
  async function init(){
    cacheDom();
    const answerSheetOptions={onNavigate:navigateToQuestionId,onSubmit:()=>{closeAnswerSheetDrawer();openSubmitConfirm()}};
    // 单实例：答题卡渲染根只 mount 一次（位于抽屉 body 内），桌面与移动端共用同一 DOM
    if(global.KGPracticeAnswerSheet?.mount){
      state.answerSheet=global.KGPracticeAnswerSheet.mount(dom.answerSheetRoot,answerSheetOptions);
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

  const api=Object.freeze({init,startPractice,answerById:id=>answer(id,dom.options.querySelector('[data-option-id="'+CSS.escape(text(id))+'"]')),finishPractice,showLobby,loadReleases,snapshot,constants:Object.freeze({COUNTS:[...COUNTS],MAX_HEALTH,SCHOLAR_MAX_SECONDS})});
  global.KGPracticeMode=api;
  if(typeof module!=='undefined'&&module.exports)module.exports={streakBonus,formatDuration,resolveRelease,practiceModeEnabled,renderHeartIcon,readRetiredModeNavigation,prioritizeRetiredQuestion,constants:api.constants};
  if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',init,{once:true});
})(typeof window!=='undefined'?window:globalThis);
