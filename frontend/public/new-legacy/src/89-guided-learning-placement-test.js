'use strict';

/*
 * GuidedLearningPlacementTest v1
 * 固定 12 项客观测试；达到 requiredCorrect 后统一完成本部分，并单独保存测试成绩。
 */
(function(global){
  const byId=id=>document.getElementById(id);
  const data=()=>global.KGGuidedLearningData;
  const store=()=>global.KGGuidedLearningStore;
  const state={
    course:null,part:null,stage:null,config:null,progress:null,activities:[],
    index:0,answers:[],selectedChoice:'',selectedKeywords:new Set(),
    matchAssignments:new Map(),matchLeft:'',awaiting:false,completed:false,bound:false,
    started:false,activeMs:0,activeSince:0,adminPreview:false
  };

  function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
  function currentActivity(){return state.activities[state.index]||null}
  function firstNode(){return state.course?.nodes?.filter(node=>node.partId===state.part?.id).sort((a,b)=>a.order-b.order)[0]||null}
  function pathHref(){return 'learning-path.html?stage='+encodeURIComponent(state.stage?.id||'')}
  function nodeHref(){return 'guided-learning-node.html?node='+encodeURIComponent(firstNode()?.id||'')}
  function isAdminUser(){
    try{
      const user=global.KGAuthCore?.currentUser?.();
      if(user?.role)return String(user.role)==='admin';
      return String(global.KGRolePermissions?.currentRole?.()||'')==='admin';
    }catch(error){return false}
  }
  function activityLabel(type){return ({choice:'单项选择',keyword:'关键词识别',matching:'连线配对'})[String(type||'')]||'测试任务'}
  function setText(id,value){const element=byId(id);if(element)element.textContent=String(value??'')}
  function startTimer(){
    if(!state.started||state.completed||state.activeSince||document.visibilityState==='hidden')return;
    state.activeSince=Date.now();
  }
  function pauseTimer(){
    if(!state.activeSince)return;
    state.activeMs+=Math.max(0,Date.now()-state.activeSince);
    state.activeSince=0;
  }
  function activeDurationSeconds(){
    const live=state.activeSince?Math.max(0,Date.now()-state.activeSince):0;
    return Math.max(1,Math.round((state.activeMs+live)/1000));
  }
  function formatDuration(seconds){
    const value=Math.max(0,Number(seconds)||0);
    return Math.floor(value/60)+':'+String(value%60).padStart(2,'0');
  }
  function resetAnswerState(){
    state.selectedChoice='';
    state.selectedKeywords=new Set();
    state.matchAssignments=new Map();
    state.matchLeft='';
    state.awaiting=false;
  }
  function updateProgress(){
    const percent=state.activities.length?Math.round(state.index/state.activities.length*100):0;
    const bar=byId('gptProgressBar');if(bar)bar.style.width=percent+'%';
    byId('gptProgressShell')?.setAttribute('aria-valuenow',String(percent));
  }
  function primaryAction(){return byId('gptPrimaryAction')}
  function setPrimaryAction(action,label,disabled=false){
    const button=primaryAction();if(!button)return;
    button.dataset.action=String(action||'check');
    button.textContent=String(label||'提交答案');
    button.disabled=Boolean(disabled);
  }
  function setCheckEnabled(enabled){
    const button=primaryAction();
    if(button&&button.dataset.action==='check')button.disabled=!enabled;
  }
  function clearFeedback(){
    const box=byId('gptFeedback');if(box){box.hidden=true;box.removeAttribute('data-kind')}
    setText('gptFeedbackTitle','');setText('gptFeedbackMessage','');
  }
  function showFeedback(correct){
    const box=byId('gptFeedback');if(!box)return;
    box.hidden=false;box.dataset.kind=correct?'success':'error';
    setText('gptFeedbackTitle',correct?'本题已记录':'本题未答对');
    setText('gptFeedbackMessage',correct?'继续完成剩余测试任务。':'本次答案已记录。测试结束后会显示总体结果。');
  }
  function disableControls(){byId('gptQuestion')?.querySelectorAll('button,select,input').forEach(control=>{control.disabled=true})}
  function renderHead(activity){
    return '<div class="glp-question-head"><span>'+escapeHTML(activityLabel(activity.type))+'</span>'
      +'<h2>'+escapeHTML(activity.stem||activity.instruction||'请完成当前测试任务')+'</h2>'
      +'<small>第 '+(state.index+1)+' 项 / 共 '+state.activities.length+' 项</small></div>';
  }
  function renderChoice(activity){
    return renderHead(activity)+'<div class="glp-choice-list">'
      +(activity.options||[]).map(option=>'<button type="button" class="ui-option-control" data-gpt-choice="'+escapeHTML(option.id)+'"><span class="glp-choice-key">'+escapeHTML(option.id)+'</span><span>'+escapeHTML(option.text)+'</span></button>').join('')
      +'</div>';
  }
  function renderKeyword(activity){
    const required=Number(activity.requiredSelectionCount)||(activity.segments||[]).filter(segment=>segment.target).length;
    return renderHead(activity)
      +'<div class="glp-keyword-instruction"><span>请选择 <strong>'+required+'</strong> 个关键线索</span><strong id="gptKeywordCount">已选 0 / '+required+'</strong></div>'
      +'<div class="glp-keyword-passage">'+(activity.segments||[]).map((segment,index)=>'<button type="button" class="ui-option-control" data-gpt-keyword="'+index+'" aria-pressed="false">'+escapeHTML(segment.text)+'</button>').join('')+'</div>';
  }
  function renderMatching(activity){
    const pairs=activity.pairs||[];
    const right=[...pairs].reverse();
    return renderHead(activity)+'<div class="glp-match-board">'
      +'<div class="glp-match-column"><span>左侧项目</span>'+pairs.map(pair=>'<button type="button" class="ui-option-control" data-gpt-match-left="'+escapeHTML(pair.id)+'">'+escapeHTML(pair.left)+'</button>').join('')+'</div>'
      +'<div class="glp-match-column"><span>右侧说明</span>'+right.map(pair=>'<button type="button" class="ui-option-control" data-gpt-match-right="'+escapeHTML(pair.id)+'">'+escapeHTML(pair.right)+'</button>').join('')+'</div>'
      +'</div>';
  }
  function renderActivity(){
    const activity=currentActivity();
    if(!activity){finish();return}
    resetAnswerState();clearFeedback();updateProgress();
    const shell=byId('gptQuestion');
    shell.hidden=false;
    shell.dataset.activityId=activity.id;
    shell.setAttribute('data-activity-id',activity.id);
    if(activity.type==='choice')shell.innerHTML=renderChoice(activity);
    else if(activity.type==='keyword')shell.innerHTML=renderKeyword(activity);
    else if(activity.type==='matching')shell.innerHTML=renderMatching(activity);
    else{showFatal('测试活动不可用','当前跳级测试包含不受支持的活动类型：'+String(activity.type||'unknown'));return}
    setPrimaryAction('check','提交答案',true);
  }
  function updateKeyword(button){
    const activity=currentActivity();
    const index=Number(button.dataset.gptKeyword);
    const required=Number(activity.requiredSelectionCount)||(activity.segments||[]).filter(segment=>segment.target).length;
    if(state.selectedKeywords.has(index))state.selectedKeywords.delete(index);
    else if(state.selectedKeywords.size<required)state.selectedKeywords.add(index);
    button.classList.toggle('is-selected',state.selectedKeywords.has(index));
    button.setAttribute('aria-pressed',state.selectedKeywords.has(index)?'true':'false');
    setText('gptKeywordCount','已选 '+state.selectedKeywords.size+' / '+required);
    setCheckEnabled(state.selectedKeywords.size===required);
  }
  function assignMatch(side,id){
    id=String(id);
    if(side==='left'){state.matchLeft=id;updateMatchingUI();return}
    if(!state.matchLeft)return;
    for(const [left,right] of state.matchAssignments.entries())if(right===id&&left!==state.matchLeft)state.matchAssignments.delete(left);
    state.matchAssignments.set(state.matchLeft,id);
    state.matchLeft='';
    updateMatchingUI();
    setCheckEnabled(state.matchAssignments.size===(currentActivity()?.pairs||[]).length);
  }
  function updateMatchingUI(){
    const root=byId('gptQuestion');if(!root)return;
    root.querySelectorAll('[data-gpt-match-left]').forEach(button=>{
      const id=String(button.dataset.gptMatchLeft);
      button.classList.toggle('is-active',id===state.matchLeft);
      button.classList.toggle('is-assigned',state.matchAssignments.has(id));
    });
    const used=new Set(state.matchAssignments.values());
    root.querySelectorAll('[data-gpt-match-right]').forEach(button=>button.classList.toggle('is-assigned',used.has(String(button.dataset.gptMatchRight))));
  }
  function evaluate(activity){
    if(activity.type==='choice'){
      const option=(activity.options||[]).find(item=>String(item.id)===String(state.selectedChoice));
      return Boolean(option?.correct);
    }
    if(activity.type==='keyword'){
      const targets=(activity.segments||[]).map((segment,index)=>segment.target?index:null).filter(index=>index!==null);
      return targets.length===state.selectedKeywords.size&&targets.every(index=>state.selectedKeywords.has(index));
    }
    if(activity.type==='matching'){
      return (activity.pairs||[]).every(pair=>String(state.matchAssignments.get(String(pair.id))||'')===String(pair.id));
    }
    return false;
  }
  function answerPayload(activity,correct){
    let answer=null;
    if(activity.type==='choice')answer=state.selectedChoice;
    else if(activity.type==='keyword')answer=[...state.selectedKeywords];
    else if(activity.type==='matching')answer=[...state.matchAssignments.entries()];
    return {activityId:String(activity.id),type:String(activity.type),correct:Boolean(correct),answer};
  }
  function submit(){
    if(state.awaiting||state.completed)return;
    const activity=currentActivity();if(!activity)return;
    const correct=evaluate(activity);
    state.answers.push(answerPayload(activity,correct));
    state.awaiting=true;disableControls();showFeedback(correct);
    setPrimaryAction('continue',state.index===state.activities.length-1?'查看结果':'下一项',false);
  }
  function continueTest(){
    if(!state.awaiting)return;
    state.index+=1;
    if(state.index>=state.activities.length){finish();return}
    renderActivity();
  }
  function typeSummary(){
    const groups=new Map();
    state.answers.forEach(answer=>{
      if(!groups.has(answer.type))groups.set(answer.type,{type:answer.type,label:activityLabel(answer.type),total:0,correct:0});
      const group=groups.get(answer.type);group.total+=1;if(answer.correct)group.correct+=1;
    });
    return [...groups.values()];
  }
  function renderResult(result){
    const passed=result.passed;
    byId('gptQuestion').hidden=true;
    byId('gptActionBar').hidden=true;
    const resultBox=byId('gptResult');
    resultBox.hidden=false;
    resultBox.classList.toggle('is-failed',!passed);
    setText('gptResultMark',passed?'✓':'!');
    setText('gptResultLabel',state.adminPreview?'管理员测试完成':passed?'跳级测试通过':'跳级测试未通过');
    setText('gptResultTitle',state.part.title);
    setText('gptResultMessage',passed
      ?'本部分已完成，全部节点已经开放；你仍可以随时回头练习每个节点。'
      :'需要答对至少 '+state.config.requiredCorrect+' 项。本次没有改变你的正常学习进度，可以重新测试或从首节点开始学习。');
    byId('gptAdminNote').hidden=!state.adminPreview;
    setText('gptCorrectResult',result.correct+' / '+result.total);
    setText('gptDurationResult',formatDuration(result.activeDurationSeconds));
    byId('gptTypeSummary').innerHTML=typeSummary().map(item=>'<article><span>'+escapeHTML(item.label)+'</span><strong>'+item.correct+' / '+item.total+'</strong></article>').join('');
    byId('gptResultActions').innerHTML=passed
      ?'<a class="ui-button ui-button--primary" href="'+pathHref()+'">返回学习路径</a><a class="ui-button ui-button--secondary" href="'+nodeHref()+'">练习本部分节点</a>'
      :'<button type="button" class="ui-button ui-button--primary" data-gpt-retry>重新测试</button><a class="ui-button ui-button--secondary" href="'+nodeHref()+'">正常开始学习</a><a class="ui-button ui-button--secondary" href="'+pathHref()+'">返回学习路径</a>';
  }
  function finish(){
    if(state.completed)return;
    pauseTimer();state.completed=true;state.started=false;
    const total=state.activities.length;
    const correct=state.answers.filter(answer=>answer.correct).length;
    const percent=total?Math.round(correct/total*100):0;
    const result={
      testId:state.config.id,partId:state.part.id,correct,total,percent,
      passed:correct>=Number(state.config.requiredCorrect||total),
      activeDurationSeconds:activeDurationSeconds(),completedAt:Date.now(),answers:state.answers
    };
    if(!state.adminPreview){
      state.progress=result.passed
        ?store().completePartByPlacementTest(state.course,state.part.id,result)
        :store().recordPlacementTestAttempt(state.course,state.part.id,result);
    }
    byId('gptProgressBar').style.width='100%';
    byId('gptProgressShell').setAttribute('aria-valuenow','100');
    renderResult(result);
  }
  function startTest(){
    state.index=0;state.answers=[];state.completed=false;state.awaiting=false;
    state.activeMs=0;state.activeSince=0;state.started=true;
    byId('gptIntro').hidden=true;byId('gptResult').hidden=true;byId('gptActionBar').hidden=false;
    startTimer();renderActivity();
  }
  function retry(){
    byId('gptResult').hidden=true;
    startTest();
  }
  function showFatal(title,message){
    pauseTimer();state.completed=true;state.started=false;
    setText('gptTitle',title);
    byId('gptIntro').hidden=true;byId('gptQuestion').hidden=false;byId('gptActionBar').hidden=true;byId('gptResult').hidden=true;
    byId('gptQuestion').innerHTML='<div class="glp-fatal"><p>'+escapeHTML(message)+'</p><a href="'+pathHref()+'">返回学习路径</a></div>';
  }
  function exit(){
    if(!state.completed&&state.started&&global.confirm?.('退出后，本次跳级测试不会保存。确定退出吗？')===false)return;
    global.location.href=pathHref();
  }
  function bind(){
    if(state.bound)return;state.bound=true;
    byId('gptExitBtn')?.addEventListener('click',exit);
    byId('gptStartBtn')?.addEventListener('click',startTest);
    byId('gptPrimaryAction')?.addEventListener('click',event=>{
      const button=event.currentTarget;
      if(button.disabled)return;
      if(button.dataset.action==='continue')continueTest();
      else submit();
    });
    byId('gptQuestion')?.addEventListener('click',event=>{
      if(state.awaiting||state.completed)return;
      const choice=event.target.closest?.('[data-gpt-choice]');
      if(choice){
        state.selectedChoice=String(choice.dataset.gptChoice);
        byId('gptQuestion').querySelectorAll('[data-gpt-choice]').forEach(item=>item.classList.toggle('is-selected',item===choice));
        setCheckEnabled(true);return;
      }
      const keyword=event.target.closest?.('[data-gpt-keyword]');
      if(keyword){updateKeyword(keyword);return}
      const left=event.target.closest?.('[data-gpt-match-left]');
      if(left){assignMatch('left',left.dataset.gptMatchLeft);return}
      const right=event.target.closest?.('[data-gpt-match-right]');
      if(right){assignMatch('right',right.dataset.gptMatchRight)}
    });
    byId('gptResult')?.addEventListener('click',event=>{if(event.target.closest?.('[data-gpt-retry]'))retry()});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')pauseTimer();else startTimer()});
    global.addEventListener('beforeunload',pauseTimer);
    global.addEventListener('kg-auth-session-change',()=>global.location.reload());
  }
  function init(partIdOverride=''){
    state.course=data()?.getCourse?.();
    const partId=String(partIdOverride||new URLSearchParams(global.location.search).get('part')||'');
    state.part=state.course?.parts?.find(part=>part.id===partId)||null;
    state.stage=state.course?.stages?.find(stage=>stage.id===state.part?.stageId)||null;
    state.config=data()?.placementTestForPart?.(partId)||null;
    bind();
    if(!state.course||!state.part||!state.config){showFatal('测试不存在','没有找到对应的部分跳级测试。');return}
    state.progress=store().read(state.course);
    state.adminPreview=isAdminUser();
    const entry=state.progress.nodes[firstNode()?.id];
    if(entry?.status==='locked'&&!state.adminPreview){showFatal('测试尚未开放','请先完成前一个部分，再从本部分首节点发起跳级测试。');return}
    state.activities=Array.isArray(state.config.activities)?state.config.activities:[];
    if(state.activities.length!==Number(state.config.expectedActivityCount||12)){showFatal('测试配置不完整','当前测试题目数量与配置不一致。');return}
    setText('gptStageLabel','第 '+state.stage.order+' 阶段 · 第 '+state.part.order+' 部分');
    setText('gptTitle',state.config.title);
    setText('gptScoreRule','答对 '+state.config.requiredCorrect+' / '+state.config.expectedActivityCount+' 通过');
    setText('gptIntroTitle',state.config.title);
    setText('gptIntroDescription',state.config.description);
    setText('gptTaskCount',state.config.expectedActivityCount+' 项');
    setText('gptPassRule','至少 '+state.config.requiredCorrect+' 项正确');
    setText('gptEstimatedTime',state.config.estimatedMinutes+' 分钟');
    byId('gptIntro').hidden=false;byId('gptQuestion').hidden=true;byId('gptResult').hidden=true;byId('gptActionBar').hidden=true;
    updateProgress();
  }

  global.KGGuidedLearningPlacementTest=Object.freeze({init,startTest,retry});
  document.addEventListener('DOMContentLoaded',()=>init());
})(window);
