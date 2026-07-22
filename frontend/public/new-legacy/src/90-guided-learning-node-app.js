'use strict';

/*
 * GuidedLearningNodeApp v9
 * 统一节点运行器：通过 ActivityRegistry 同时运行标准活动与复合活动。
 * 节点状态只存在于当前页面内存；全部完成后一次性保存节点结果和本轮统计。
 */
(function(global){
  const byId=id=>document.getElementById(id);
  const data=()=>global.KGGuidedLearningData;
  const store=()=>global.KGGuidedLearningStore;
  const registry=()=>global.KGGuidedLearningActivityRegistry;
  const state={
    course:null,
    progress:null,
    node:null,
    part:null,
    stage:null,
    runMode:'standard',
    activities:[],
    activityMap:new Map(),
    queue:[],
    completedIds:new Set(),
    current:null,
    selectedChoice:'',
    selectedKeywords:new Set(),
    matchAssignments:new Map(),
    matchLeft:'',
    textAnswer:'',
    awaitingAdvance:false,
    started:false,
    nodeCompleted:false,
    bound:false,
    wrongAttempts:new Map(),
    hintRevealed:new Map(),
    hintOrder:new Map(),
    metrics:{totalAttempts:0,correctAttempts:0,currentStreak:0,maxCorrectStreak:0,hintUsedCount:0},
    activityOutcomes:new Map(),
    activeMs:0,
    activeSince:0,
    memoryCards:[],
    memoryFlipped:[],
    memoryMatched:new Set(),
    memoryLocked:false,
    memoryTimer:null,
    adminPreview:false
  };

  function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
  function selectorValue(value){return global.CSS?.escape?global.CSS.escape(String(value)):String(value).replace(/["\\]/g,'\\$&')}
  function setText(id,value){const element=byId(id);if(element)element.textContent=String(value??'')}
  function nodeIndex(){return state.course?.nodes?.findIndex(node=>node.id===state.node?.id)??-1}
  function nextNode(){return state.course?.nodes?.[nodeIndex()+1]||null}
  function pathHref(){return 'learning-path.html?stage='+encodeURIComponent(state.stage?.id||'')}
  function currentActivity(){return state.activityMap.get(state.queue[0])||null}
  function activePlugin(){return registry()?.get?.(state.current?.type)||null}
  function activityLabel(type){return registry()?.get?.(type)?.label||'学习活动'}
  function isPartChallenge(){return Boolean(state.node?.isChallenge||state.node?.nodeType==='part_challenge'||state.runMode==='challenge')}
  function ensureActivityOutcome(activity=state.current){
    const id=String(activity?.id||'');
    if(!id)return null;
    if(!state.activityOutcomes.has(id)){
      state.activityOutcomes.set(id,{
        activityId:id,
        type:String(activity?.type||'unknown'),
        label:activityLabel(activity?.type),
        attempts:0,
        correctAttempts:0,
        wrongAttempts:0,
        completed:false
      });
    }
    return state.activityOutcomes.get(id);
  }
  function markActivityCompleted(activity=state.current){
    const outcome=ensureActivityOutcome(activity);
    if(outcome)outcome.completed=true;
  }
  function challengeContextHTML(activity){
    return '<div class="gln-challenge-context">'
      +'<span>部分综合挑战</span>'
      +'<strong>已完成 '+state.completedIds.size+' / '+state.activities.length+'</strong>'
      +'<small>'+escapeHTML(activityLabel(activity?.type))+'</small>'
      +'</div>';
  }
  function isAdminUser(){
    try{
      const user=global.KGAuthCore?.currentUser?.();
      if(user?.role)return String(user.role)==='admin';
      return String(global.KGRolePermissions?.currentRole?.()||'')==='admin';
    }catch(error){return false}
  }
  function openMinLength(activity){return Math.max(1,Number(activity?.minLength)||1)}
  function openMaxLength(activity){return Math.max(20,Number(activity?.maxLength)||140)}
  function setActionBarHidden(hidden){const bar=byId('glnActionBar');if(bar)bar.hidden=Boolean(hidden)}
  function pluginRuntime(){
    return {
      state,
      escapeHTML,
      selectorValue,
      setText,
      root:()=>byId('glnActivity'),
      setCheckButton,
      setFooterButtons,
      setActionBarHidden,
      recordAttempt,
      recordHintUse,
      feedbackMessage:()=>byId('glnFeedbackMessage'),
      showFeedback,
      clearFeedback,
      disableActivityControls,
      updateProgress,
      completeActivity:markCorrect,
      rerenderActivity:()=>mountCurrentActivity(false)
    };
  }

  function clearMemoryTimer(){if(state.memoryTimer){global.clearTimeout(state.memoryTimer);state.memoryTimer=null}}
  function resetActivityState(){
    clearMemoryTimer();
    state.selectedChoice='';
    state.selectedKeywords=new Set();
    state.matchAssignments=new Map();
    state.matchLeft='';
    state.textAnswer='';
    state.awaitingAdvance=false;
    state.memoryCards=[];
    state.memoryFlipped=[];
    state.memoryMatched=new Set();
    state.memoryLocked=false;
  }

  function activityWeight(activity){
    const plugin=registry()?.get?.(activity?.type);
    return Math.max(1,Number(plugin?.workUnits?.(activity,pluginRuntime())||1));
  }
  function completedWorkUnits(){
    let total=0;
    state.completedIds.forEach(id=>{total+=activityWeight(state.activityMap.get(id))});
    if(state.current&&!state.completedIds.has(state.current.id)){
      const plugin=activePlugin();
      total+=Math.max(0,Number(plugin?.completedWorkUnits?.(state.current,pluginRuntime())||0));
    }
    return total;
  }
  function totalWorkUnits(){return state.activities.reduce((sum,activity)=>sum+activityWeight(activity),0)}
  function updateProgress(){
    const total=totalWorkUnits();
    const completed=completedWorkUnits();
    const percent=total?Math.round(completed/total*100):0;
    const bar=byId('glnProgressBar');
    if(bar)bar.style.width=percent+'%';
    byId('glnProgressShell')?.setAttribute('aria-valuenow',String(percent));
  }

  function startActiveTimer(){
    if(!state.started||state.nodeCompleted||document.visibilityState==='hidden'||state.activeSince)return;
    state.activeSince=Date.now();
  }
  function pauseActiveTimer(){
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
    const minutes=Math.floor(value/60);
    const remainder=value%60;
    return minutes+':'+String(remainder).padStart(2,'0');
  }
  function recordAttempt(correct){
    const outcome=ensureActivityOutcome();
    state.metrics.totalAttempts+=1;
    if(outcome){
      outcome.attempts+=1;
      if(correct)outcome.correctAttempts+=1;
      else outcome.wrongAttempts+=1;
    }
    if(correct){
      state.metrics.correctAttempts+=1;
      state.metrics.currentStreak+=1;
      state.metrics.maxCorrectStreak=Math.max(state.metrics.maxCorrectStreak,state.metrics.currentStreak);
    }else{
      state.metrics.currentStreak=0;
    }
  }
  function recordHintUse(){state.metrics.hintUsedCount+=1}
  function wrongCount(activityId){return Number(state.wrongAttempts.get(activityId)||0)}
  function incrementWrong(activityId){const count=wrongCount(activityId)+1;state.wrongAttempts.set(activityId,count);return count}

  function showFatal(title,message){
    clearMemoryTimer();
    pauseActiveTimer();
    setText('glnTitle',title);
    const activity=byId('glnActivity');
    if(activity)activity.innerHTML='<div class="gln-fatal"><p>'+escapeHTML(message)+'</p><a href="learning-path.html">返回学习路径</a></div>';
    if(byId('glnProgressShell'))byId('glnProgressShell').hidden=true;
    if(byId('glnActionBar'))byId('glnActionBar').hidden=true;
  }

  function clearFeedback(){
    const feedback=byId('glnFeedback');
    if(feedback){feedback.hidden=true;feedback.removeAttribute('data-kind')}
    setText('glnFeedbackTitle','');
    setText('glnFeedbackMessage','');
    const toggle=byId('glnDetailToggle');
    const detail=byId('glnDetailContent');
    if(toggle){toggle.hidden=true;toggle.textContent='查看详细解析';toggle.setAttribute('aria-expanded','false')}
    if(detail){detail.hidden=true;detail.textContent=''}
  }
  function showFeedback({title,message,kind='warning',detail=''}){
    const feedback=byId('glnFeedback');
    if(!feedback)return;
    feedback.hidden=false;
    feedback.dataset.kind=kind;
    setText('glnFeedbackTitle',title);
    setText('glnFeedbackMessage',message);
    const toggle=byId('glnDetailToggle');
    const detailContent=byId('glnDetailContent');
    if(toggle&&detailContent&&String(detail||'').trim()){
      toggle.hidden=false;
      toggle.textContent='查看详细解析';
      toggle.setAttribute('aria-expanded','false');
      detailContent.hidden=true;
      detailContent.textContent=String(detail);
    }
  }
  function footerButtonHTML(button,primary){
    if(!button)return '';
    const classes=['ui-button',primary?'ui-button--primary':'ui-button--secondary',button.className||''].filter(Boolean).join(' ');
    return '<button type="button" data-footer-action="'+escapeHTML(button.action)+'" class="'+escapeHTML(classes)+'"'+(button.disabled?' disabled':'')+'>'+escapeHTML(button.label)+'</button>';
  }
  function setFooterButtons(buttons){
    const shell=byId('glnFooterActions');
    if(!shell)return;
    const list=(buttons||[]).filter(Boolean);
    const primary=list.find(button=>button.primary)||list.at(-1)||null;
    const secondary=list.find(button=>button!==primary)||null;
    shell.classList.toggle('has-secondary',Boolean(secondary));
    shell.innerHTML='<div class="gln-footer-slot gln-footer-slot--secondary">'+footerButtonHTML(secondary,false)+'</div>'
      +'<div class="gln-footer-slot gln-footer-slot--primary">'+footerButtonHTML(primary,true)+'</div>';
  }
  function setCheckButton(enabled){setFooterButtons([{action:'check',label:'检查答案',primary:true,disabled:!enabled}])}
  function setContinueButton(label='继续'){setFooterButtons([{action:'continue',label,primary:true}])}

  function renderChoice(activity){
    return '<div class="gln-question-head"><span>'+activityLabel(activity.type)+'</span><h2>'+escapeHTML(activity.stem)+'</h2></div>'
      +'<div class="gln-choice-list">'+(activity.options||[]).map(option=>'<button type="button" class="ui-option-control" data-choice="'+escapeHTML(option.id)+'"><span>'+escapeHTML(option.id)+'</span><strong>'+escapeHTML(option.text)+'</strong></button>').join('')+'</div>';
  }
  function keywordHintKey(activity){return 'keyword:'+String(activity?.id||'')}
  function keywordHints(activity){return (activity?.hints||[]).map(item=>String(item||'').trim()).filter(Boolean)}
  function keywordHintAvailable(activity){
    return keywordHints(activity).length>0&&wrongCount(activity.id)>=Math.max(1,Number(activity.hintAfterWrong)||1);
  }
  function keywordHintRevealed(activity){return Number(state.hintRevealed.get(keywordHintKey(activity))||0)>0}
  function renderKeywordHintPanel(activity){
    const available=keywordHintAvailable(activity);
    const revealed=keywordHintRevealed(activity);
    return '<div class="gln-keyword-hint-panel" id="glnKeywordHintPanel"'+(!available?' hidden':'')+'>'
      +(revealed?'<p><span>提示</span>'+escapeHTML(keywordHints(activity)[0])+'</p>':'')
      +(available&&!revealed?'<button type="button" data-keyword-hint>提示</button>':'')
      +'</div>';
  }
  function updateKeywordHintPanel(){
    const old=byId('glnKeywordHintPanel');
    if(!old||state.current?.type!=='keyword')return;
    const wrapper=document.createElement('div');
    wrapper.innerHTML=renderKeywordHintPanel(state.current);
    old.replaceWith(wrapper.firstElementChild);
  }
  function revealKeywordHint(){
    const activity=state.current;
    if(activity?.type!=='keyword'||!keywordHintAvailable(activity)||keywordHintRevealed(activity))return;
    state.hintRevealed.set(keywordHintKey(activity),1);
    recordHintUse();
    updateKeywordHintPanel();
  }
  function renderKeyword(activity){
    const required=Number(activity.requiredSelectionCount)||(activity.segments||[]).filter(segment=>segment.target).length;
    return '<div class="gln-question-head"><span>'+activityLabel(activity.type)+'</span><h2>'+escapeHTML(activity.instruction||'请选择关键线索')+'</h2></div>'
      +'<div class="gln-keyword-instruction"><span>请选择 <strong>'+required+'</strong> 个关键线索</span><span id="glnKeywordCount">已选 0 / '+required+'</span></div>'
      +'<div class="gln-keyword-passage">'+(activity.segments||[]).map((segment,index)=>'<button type="button" class="ui-option-control" data-keyword="'+index+'" aria-pressed="false">'+escapeHTML(segment.text)+'</button>').join('')+'</div>'
      +renderKeywordHintPanel(activity);
  }
  function matchingRightPairs(activity){
    const pairs=activity.pairs||[];
    const byPairId=new Map(pairs.map(pair=>[String(pair.id),pair]));
    const ordered=(activity.rightOrder||[]).map(id=>byPairId.get(String(id))).filter(Boolean);
    return ordered.length===pairs.length?ordered:[...pairs].reverse();
  }
  function renderMatching(activity){
    const pairs=activity.pairs||[];
    const right=matchingRightPairs(activity);
    return '<div class="gln-question-head"><span>'+activityLabel(activity.type)+'</span><h2>'+escapeHTML(activity.instruction)+'</h2></div>'
      +'<div class="gln-match-board" id="glnMatchBoard"><svg id="glnMatchLines" aria-hidden="true"></svg>'
      +'<div class="gln-match-column">'+pairs.map(pair=>'<button type="button" class="ui-option-control" data-match-left="'+escapeHTML(pair.id)+'">'+escapeHTML(pair.left)+'</button>').join('')+'</div>'
      +'<div class="gln-match-column">'+right.map(pair=>'<button type="button" class="ui-option-control" data-match-right="'+escapeHTML(pair.id)+'">'+escapeHTML(pair.right)+'</button>').join('')+'</div></div>';
  }

  function allOpenHints(activity){
    const remembered=state.hintOrder.get(activity.id);
    if(Array.isArray(remembered)&&remembered.length)return remembered;
    return (activity.requiredConcepts||[]).map(item=>String(item.missingHint||'').trim()).filter(Boolean);
  }
  function allowedOpenHintCount(activity){
    const count=wrongCount(activity.id);
    const available=allOpenHints(activity).length;
    if(count>=4)return Math.min(2,available);
    if(count>=2)return Math.min(1,available);
    return 0;
  }
  function revealedOpenHints(activity){
    const count=Number(state.hintRevealed.get(activity.id)||0);
    return allOpenHints(activity).slice(0,count);
  }
  function renderOpenHintPanel(activity){
    const revealed=revealedOpenHints(activity);
    const allowed=allowedOpenHintCount(activity);
    const revealedCount=revealed.length;
    return '<div class="gln-open-hint-panel" id="glnOpenHintPanel"'+(!revealed.length&&allowed<=revealedCount?' hidden':'')+'>'
      +(revealed.length?'<div class="gln-open-hints">'+revealed.map(hint=>'<p>'+escapeHTML(hint)+'</p>').join('')+'</div>':'')
      +(allowed>revealedCount?'<button type="button" data-open-hint>查看提示</button>':'')+'</div>';
  }
  function renderOpenText(activity){
    const min=openMinLength(activity);
    const max=openMaxLength(activity);
    const reflection=String(activity.evaluationMode||'')==='show_reference';
    const placeholder=activity.placeholder||(reflection?'写下你的处理思路即可……':'请在这里输入你的回答……');
    const guidance=reflection?'填写后即可提交 · 最多 '+max+' 字':'建议回答 '+min+'～'+max+' 字';
    return '<div class="gln-question-head"><span>'+activityLabel(activity.type)+'</span><h2>'+escapeHTML(activity.prompt)+'</h2></div>'
      +'<div class="gln-open-text"><textarea id="glnOpenTextInput" minlength="'+min+'" maxlength="'+max+'" placeholder="'+escapeHTML(placeholder)+'"></textarea>'
      +'<div class="gln-open-text-meta"><span>'+escapeHTML(guidance)+'</span><strong id="glnOpenTextCount">0 / '+max+'</strong></div>'
      +(reflection?'':renderOpenHintPanel(activity))+'</div>';
  }
  function updateOpenHintPanel(){
    const old=byId('glnOpenHintPanel');
    if(!old||state.current?.type!=='open_text')return;
    const wrapper=document.createElement('div');
    wrapper.innerHTML=renderOpenHintPanel(state.current);
    old.replaceWith(wrapper.firstElementChild);
  }
  function revealOpenHint(){
    const activity=state.current;
    if(activity?.type!=='open_text')return;
    const allowed=allowedOpenHintCount(activity);
    const current=Number(state.hintRevealed.get(activity.id)||0);
    if(current>=allowed)return;
    state.hintRevealed.set(activity.id,current+1);
    state.metrics.hintUsedCount+=1;
    updateOpenHintPanel();
    const hint=revealedOpenHints(activity).at(-1)||'';
    if(!byId('glnFeedback')?.hidden&&hint){
      const message=byId('glnFeedbackMessage');
      if(message&&!message.textContent.includes(hint))message.textContent=(message.textContent.trim()+' 提示：'+hint).trim();
      setFooterButtons([{action:'continue',label:'继续',primary:true}]);
    }
  }

  function buildMemoryCards(activity){
    const cards=[];
    (activity.pairs||[]).forEach(pair=>{
      cards.push({id:String(pair.id)+':left',pairId:String(pair.id),text:pair.left,side:'left'});
      cards.push({id:String(pair.id)+':right',pairId:String(pair.id),text:pair.right,side:'right'});
    });
    const map=new Map(cards.map(card=>[card.id,card]));
    const ordered=(activity.cardOrder||[]).map(id=>map.get(String(id))).filter(Boolean);
    return ordered.length===cards.length?ordered:cards;
  }
  function renderMemory(activity){
    state.memoryCards=buildMemoryCards(activity);
    return '<div class="gln-question-head"><span>'+activityLabel(activity.type)+'</span><h2>'+escapeHTML(activity.instruction||'翻开两张卡片，找出正确配对。')+'</h2></div>'
      +'<div class="gln-memory-grid">'+state.memoryCards.map(card=>'<button type="button" class="gln-memory-card ui-option-control" data-memory-card="'+escapeHTML(card.id)+'" aria-label="未翻开的记忆卡片"><span class="gln-memory-back">?</span><span class="gln-memory-front">'+escapeHTML(card.text)+'</span></button>').join('')+'</div>';
  }

  function mountCurrentActivity(prepare=false){
    const activity=state.current;
    const plugin=activePlugin();
    if(!activity||!plugin){
      const shell=byId('glnActivity');
      if(shell)shell.innerHTML='<div class="gln-fatal"><p>暂不支持该活动类型：'+escapeHTML(activity?.type||'unknown')+'</p></div>';
      setActionBarHidden(true);
      return;
    }
    const runtime=pluginRuntime();
    if(prepare)plugin.prepare?.(activity,runtime);
    const main=byId('glnMain');
    main?.classList.toggle('is-wide',Boolean(plugin.isWide));
    const shell=byId('glnActivity');
    shell.innerHTML=(isPartChallenge()?challengeContextHTML(activity):'')+plugin.render(activity,runtime);
    shell.dataset.activityId=activity.id;
    shell.classList.toggle('gln-keyword-activity',activity.type==='keyword');
    const hideActionBar=Boolean(plugin.actionBarHidden?.(activity,runtime));
    setActionBarHidden(hideActionBar);
    if(hideActionBar)setFooterButtons([]);else setCheckButton(false);
    plugin.onMounted?.(activity,runtime);
    requestAnimationFrame(drawMatchLines);
    updateProgress();
  }

  function renderActivity(){
    const previous=state.current;
    state.current=currentActivity();
    if(!state.current){finishNode();return}
    if(previous&&previous.id!==state.current.id)registry()?.get?.(previous.type)?.dispose?.(previous,pluginRuntime());
    resetActivityState();
    clearFeedback();
    state.started=true;
    startActiveTimer();
    mountCurrentActivity(true);
  }

  function activityDetail(activity){return activity?.detailedExplanation||activity?.explanation||''}
  function markCorrect(message,options={}){
    const activity=state.current;
    if(options.recordAttempt!==false)recordAttempt(true);
    markActivityCompleted(activity);
    state.queue.shift();
    state.completedIds.add(activity.id);
    updateProgress();
    state.awaitingAdvance=true;
    if(byId('glnActionBar'))byId('glnActionBar').hidden=false;
    showFeedback({title:'回答正确',message:message||activity.shortExplanation||'本题已完成。',kind:'success',detail:activityDetail(activity)});
    disableActivityControls();
    setContinueButton(state.queue.length?'继续':'完成节点');
  }
  function markWrong(message,options={}){
    const activity=state.current;
    recordAttempt(false);
    const count=incrementWrong(activity.id);
    state.queue.shift();
    state.queue.push(activity.id);
    state.awaitingAdvance=true;
    if(byId('glnActionBar'))byId('glnActionBar').hidden=false;
    showFeedback({title:'还没有完全正确',message:message||activity.incorrectFeedback||'请重新考虑，稍后这道题会再次出现。',kind:'error'});
    disableActivityControls();
    if(activity.type==='open_text'&&allowedOpenHintCount(activity)>Number(state.hintRevealed.get(activity.id)||0)){
      setFooterButtons([{action:'show-open-hint',label:'查看提示'},{action:'continue',label:'继续',primary:true}]);
    }else{
      setContinueButton('继续');
    }
    return count;
  }
  function disableActivityControls(){
    byId('glnActivity')?.querySelectorAll('button,textarea').forEach(control=>{control.disabled=true});
    byId('glnActivity')?.querySelectorAll('[draggable="true"]').forEach(control=>{control.draggable=false});
  }
  function continueAfterFeedback(){
    if(!state.awaitingAdvance)return;
    state.awaitingAdvance=false;
    if(!state.queue.length){finishNode();return}
    renderActivity();
  }

  function submitChoice(){
    if(!state.selectedChoice)return;
    const option=(state.current.options||[]).find(item=>String(item.id)===String(state.selectedChoice));
    const button=byId('glnActivity')?.querySelector('[data-choice="'+selectorValue(state.selectedChoice)+'"]');
    if(option?.correct){button?.classList.add('is-correct');markCorrect(state.current.shortExplanation)}
    else{button?.classList.add('is-wrong');markWrong(option?.feedback||state.current.incorrectFeedback)}
  }
  function submitKeyword(){
    const targets=(state.current.segments||[]).map((segment,index)=>segment.target?index:null).filter(index=>index!==null);
    const selected=[...state.selectedKeywords];
    const missing=targets.filter(index=>!state.selectedKeywords.has(index));
    const wrong=selected.filter(index=>!targets.includes(index));
    if(!missing.length&&!wrong.length)markCorrect(state.current.shortExplanation);
    else markWrong('当前选择中有 '+wrong.length+' 项需要重新判断，同时遗漏了 '+missing.length+' 项关键线索。'+(state.current.incorrectFeedback?' '+state.current.incorrectFeedback:''));
  }
  function submitMatching(){
    const pairs=state.current.pairs||[];
    const wrong=pairs.filter(pair=>String(state.matchAssignments.get(String(pair.id))||'')!==String(pair.id));
    if(!wrong.length)markCorrect(state.current.shortExplanation);
    else markWrong('当前有 '+wrong.length+' 组配对需要重新判断。'+(state.current.incorrectFeedback?' '+state.current.incorrectFeedback:''));
  }
  function normalizeText(value){return String(value||'').toLowerCase().replace(/[\s\u3000，。！？；：、,.!?;:'"“”‘’（）()【】\[\]—–_-]/g,'')}
  function evaluateOpenText(){
    const answer=normalizeText(state.textAnswer);
    const concepts=state.current.requiredConcepts||[];
    const matched=[];
    const missing=[];
    concepts.forEach(concept=>{
      const hit=(concept.acceptedExpressions||[]).some(expression=>{
        const normalized=normalizeText(expression);
        return normalized&&answer.includes(normalized);
      });
      (hit?matched:missing).push(concept);
    });
    return {matched,missing};
  }
  function submitOpenText(){
    const min=openMinLength(state.current);
    if(state.textAnswer.trim().length<min)return;
    if(String(state.current.evaluationMode||'')==='show_reference'){
      const answer=String(state.current.referenceAnswer||state.current.explanation||'').trim();
      markCorrect((state.current.shortExplanation||'你的回答已提交。')+(answer?' 参考答案：'+answer:''));
      return;
    }
    const result=evaluateOpenText();
    if(!result.missing.length){markCorrect(state.current.shortExplanation);return}
    const missingHints=result.missing.map(item=>String(item.missingHint||'').trim()).filter(Boolean);
    const remainingHints=(state.current.requiredConcepts||[]).map(item=>String(item.missingHint||'').trim()).filter(hint=>hint&&!missingHints.includes(hint));
    state.hintOrder.set(state.current.id,[...missingHints,...remainingHints]);
    markWrong('你的回答已经涉及 '+result.matched.length+' 个关键方面，但仍缺少 '+result.missing.length+' 个重要角度。');
  }
  function submitCurrent(){
    if(state.awaitingAdvance||!state.current)return;
    activePlugin()?.submit?.(state.current,pluginRuntime());
  }

  function updateKeywordSelection(button){
    const index=Number(button.dataset.keyword);
    const required=Number(state.current.requiredSelectionCount)||(state.current.segments||[]).filter(segment=>segment.target).length;
    if(state.selectedKeywords.has(index))state.selectedKeywords.delete(index);
    else if(state.selectedKeywords.size<required)state.selectedKeywords.add(index);
    button.classList.toggle('is-selected',state.selectedKeywords.has(index));
    button.setAttribute('aria-pressed',state.selectedKeywords.has(index)?'true':'false');
    setText('glnKeywordCount','已选 '+state.selectedKeywords.size+' / '+required);
    setCheckButton(state.selectedKeywords.size===required);
  }
  function assignMatch(side,id){
    if(state.awaitingAdvance)return;
    id=String(id);
    if(side==='left'){
      state.matchLeft=id;
      updateMatchingUI();
      return;
    }
    if(!state.matchLeft)return;
    for(const [left,right] of state.matchAssignments.entries())if(right===id&&left!==state.matchLeft)state.matchAssignments.delete(left);
    state.matchAssignments.set(state.matchLeft,id);
    state.matchLeft='';
    updateMatchingUI();
    setCheckButton(state.matchAssignments.size===(state.current.pairs||[]).length);
    requestAnimationFrame(drawMatchLines);
  }
  function updateMatchingUI(){
    const activity=byId('glnActivity');
    if(!activity)return;
    activity.querySelectorAll('[data-match-left]').forEach(button=>{
      const id=String(button.dataset.matchLeft);
      button.classList.toggle('is-active',id===state.matchLeft);
      button.classList.toggle('is-assigned',state.matchAssignments.has(id));
    });
    const used=new Set(state.matchAssignments.values());
    activity.querySelectorAll('[data-match-right]').forEach(button=>button.classList.toggle('is-assigned',used.has(String(button.dataset.matchRight))));
  }
  function drawMatchLines(){
    const board=byId('glnMatchBoard');
    const svg=byId('glnMatchLines');
    if(!board||!svg)return;
    const rect=board.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    svg.setAttribute('viewBox','0 0 '+rect.width+' '+rect.height);
    svg.innerHTML='';
    state.matchAssignments.forEach((rightId,leftId)=>{
      const left=board.querySelector('[data-match-left="'+selectorValue(leftId)+'"]');
      const right=board.querySelector('[data-match-right="'+selectorValue(rightId)+'"]');
      if(!left||!right)return;
      const a=left.getBoundingClientRect();
      const b=right.getBoundingClientRect();
      const x1=a.right-rect.left;
      const y1=a.top+a.height/2-rect.top;
      const x2=b.left-rect.left;
      const y2=b.top+b.height/2-rect.top;
      const middle=(x1+x2)/2;
      const path=document.createElementNS('http://www.w3.org/2000/svg','path');
      path.setAttribute('d','M '+x1+' '+y1+' C '+middle+' '+y1+' '+middle+' '+y2+' '+x2+' '+y2);
      svg.appendChild(path);
    });
  }

  function flipMemoryCard(button){
    if(state.awaitingAdvance||state.memoryLocked||state.current?.type!=='memory_match')return;
    const cardId=String(button.dataset.memoryCard||'');
    const card=state.memoryCards.find(item=>item.id===cardId);
    if(!card||state.memoryMatched.has(card.pairId)||state.memoryFlipped.some(item=>item.id===card.id))return;
    state.memoryFlipped.push(card);
    button.classList.add('is-flipped');
    button.setAttribute('aria-label',card.text);
    if(state.memoryFlipped.length<2)return;
    state.memoryLocked=true;
    const [first,second]=state.memoryFlipped;
    const correct=first.pairId===second.pairId&&first.side!==second.side;
    recordAttempt(correct);
    if(correct){
      state.memoryTimer=global.setTimeout(()=>{
        state.memoryMatched.add(first.pairId);
        [first,second].forEach(item=>byId('glnActivity')?.querySelector('[data-memory-card="'+selectorValue(item.id)+'"]')?.classList.add('is-matched'));
        state.memoryFlipped=[];
        state.memoryLocked=false;
        updateProgress();
        if(state.memoryMatched.size===(state.current.pairs||[]).length){
          state.memoryTimer=global.setTimeout(()=>markCorrect(state.current.shortExplanation,{recordAttempt:false}),280);
        }
      },350);
    }else{
      if(byId('glnActionBar'))byId('glnActionBar').hidden=false;
      showFeedback({title:'再试一次',message:'这两张牌不是一组。',kind:'error'});
      state.memoryTimer=global.setTimeout(()=>{
        [first,second].forEach(item=>{
          const target=byId('glnActivity')?.querySelector('[data-memory-card="'+selectorValue(item.id)+'"]');
          target?.classList.remove('is-flipped');
          target?.setAttribute('aria-label','未翻开的记忆卡片');
        });
        state.memoryFlipped=[];
        state.memoryLocked=false;
        clearFeedback();
        if(byId('glnActionBar'))byId('glnActionBar').hidden=true;
      },780);
    }
  }

  function typePerformanceMetrics(){
    const groups=new Map();
    state.activities.forEach(activity=>{
      const outcome=ensureActivityOutcome(activity)||{completed:false,wrongAttempts:0,attempts:0,correctAttempts:0};
      const type=String(activity.type||'unknown');
      if(!groups.has(type))groups.set(type,{type,label:activityLabel(type),total:0,firstAttemptCorrect:0,attempts:0,correctAttempts:0,wrongAttempts:0});
      const group=groups.get(type);
      group.total+=1;
      if(outcome.completed&&outcome.wrongAttempts===0)group.firstAttemptCorrect+=1;
      group.attempts+=Number(outcome.attempts||0);
      group.correctAttempts+=Number(outcome.correctAttempts||0);
      group.wrongAttempts+=Number(outcome.wrongAttempts||0);
    });
    return [...groups.values()].map(group=>({
      ...group,
      firstAttemptAccuracy:group.total?Math.round(group.firstAttemptCorrect/group.total*100):100
    }));
  }
  function weakestType(performance){
    return [...performance].sort((a,b)=>
      a.firstAttemptAccuracy-b.firstAttemptAccuracy||
      b.wrongAttempts-a.wrongAttempts||
      String(a.label).localeCompare(String(b.label),'zh-CN')
    )[0]||null;
  }
  function completionMetrics(){
    const total=state.metrics.totalAttempts;
    const outcomes=state.activities.map(activity=>ensureActivityOutcome(activity)).filter(Boolean);
    const firstAttemptTotal=outcomes.length;
    const firstAttemptCorrect=outcomes.filter(outcome=>outcome.completed&&outcome.wrongAttempts===0).length;
    const typePerformance=typePerformanceMetrics();
    const weakest=weakestType(typePerformance);
    return {
      accuracy:total?Math.round(state.metrics.correctAttempts/total*100):100,
      firstAttemptAccuracy:firstAttemptTotal?Math.round(firstAttemptCorrect/firstAttemptTotal*100):100,
      firstAttemptTotal,
      firstAttemptCorrect,
      activeDurationSeconds:activeDurationSeconds(),
      maxCorrectStreak:state.metrics.maxCorrectStreak,
      totalAttempts:total,
      correctAttempts:state.metrics.correctAttempts,
      hintUsedCount:state.metrics.hintUsedCount,
      typePerformance,
      weakestType:weakest?.type||'',
      weakestTypeLabel:weakest?.label||'无',
      challengePartId:isPartChallenge()?String(state.part?.id||''):'',
      challengeCompleted:isPartChallenge()
    };
  }
  function challengePerformanceHTML(metrics){
    return '<section class="gln-type-performance"><h3>分题型表现</h3><div>'
      +(metrics.typePerformance||[]).map(item=>'<article><span>'+escapeHTML(item.label)+'</span><strong>'+item.firstAttemptAccuracy+'%</strong><small>首答 '+item.firstAttemptCorrect+' / '+item.total+'</small></article>').join('')
      +'</div></section>';
  }
  function finishNode(){
    if(state.nodeCompleted)return;
    clearMemoryTimer();
    pauseActiveTimer();
    state.nodeCompleted=true;
    state.started=false;
    const metrics=completionMetrics();
    if(!state.adminPreview)state.progress=store().completeNode(state.course,state.node.id,{metrics});
    updateProgress();
    clearFeedback();
    if(byId('glnActionBar'))byId('glnActionBar').hidden=true;
    const next=nextNode();
    const challenge=isPartChallenge();
    const completionLabel=state.adminPreview?'管理员测试完成':(challenge?'本部分挑战完成':'节点完成');
    const completionTitle=challenge?(state.part?.title||state.node.title):state.node.title;
    const resultGrid=challenge
      ?'<div class="gln-result-grid gln-challenge-results">'
        +'<div><span>首答正确率</span><strong>'+metrics.firstAttemptAccuracy+'%</strong></div>'
        +'<div><span>活跃用时</span><strong>'+formatDuration(metrics.activeDurationSeconds)+'</strong></div>'
        +'<div><span>最长连对</span><strong>'+metrics.maxCorrectStreak+' 次</strong></div>'
        +'<div><span>最薄弱题型</span><strong>'+escapeHTML(metrics.weakestTypeLabel)+'</strong></div>'
        +'</div>'
      :'<div class="gln-result-grid">'
        +'<div><span>正确率</span><strong>'+metrics.accuracy+'%</strong></div>'
        +'<div><span>用时</span><strong>'+formatDuration(metrics.activeDurationSeconds)+'</strong></div>'
        +'<div><span>最长连对</span><strong>'+metrics.maxCorrectStreak+' 次</strong></div>'
        +'</div>';
    byId('glnActivity').innerHTML='<section class="gln-complete'+(challenge?' is-challenge':'')+'">'
      +'<div class="gln-complete-mark">✓</div><span>'+completionLabel+'</span><h2>'+escapeHTML(completionTitle)+'</h2>'
      +(challenge?'<p class="gln-challenge-summary">你已经完成本部分的全部综合任务，所有错题均已重新答对。</p>':'')
      +(state.adminPreview?'<p class="gln-admin-preview-note">本次为管理员测试，不写入学员解锁进度。</p>':'')
      +resultGrid
      +(challenge?challengePerformanceHTML(metrics):'')
      +'<div class="gln-complete-actions">'+(next?'<a class="ui-button ui-button--primary" href="guided-learning-node.html?node='+encodeURIComponent(next.id)+'">'+(challenge?'进入下一部分':'继续下一节点')+'</a>':'')
      +'<a class="ui-button ui-button--secondary" href="'+pathHref()+'">返回学习路径</a></div></section>';
  }
  function confirmExit(){
    if(state.nodeCompleted||!state.started)return true;
    return global.confirm?.('退出后，本节点将从头开始，当前学习进度不会保存。')!==false;
  }


  function registerStandardPlugins(){
    const target=registry();
    if(!target)return;
    target.register('choice',{
      label:'单项选择',
      render:renderChoice,
      submit(){submitChoice()},
      handleClick(event){
        if(state.awaitingAdvance)return false;
        const choice=event.target.closest?.('[data-choice]');
        if(!choice)return false;
        state.selectedChoice=String(choice.dataset.choice);
        byId('glnActivity').querySelectorAll('[data-choice]').forEach(item=>item.classList.toggle('is-selected',item===choice));
        setCheckButton(true);
        return true;
      }
    });
    target.register('keyword',{
      label:'关键词识别',
      render:renderKeyword,
      submit(){submitKeyword()},
      handleClick(event){
        if(state.awaitingAdvance)return false;
        const hint=event.target.closest?.('[data-keyword-hint]');
        if(hint){revealKeywordHint();return true}
        const keyword=event.target.closest?.('[data-keyword]');
        if(!keyword)return false;
        updateKeywordSelection(keyword);
        return true;
      }
    });
    target.register('matching',{
      label:'连线配对',
      render:renderMatching,
      submit(){submitMatching()},
      handleClick(event){
        if(state.awaitingAdvance)return false;
        const left=event.target.closest?.('[data-match-left]');
        if(left){assignMatch('left',left.dataset.matchLeft);return true}
        const right=event.target.closest?.('[data-match-right]');
        if(right){assignMatch('right',right.dataset.matchRight);return true}
        return false;
      }
    });
    target.register('open_text',{
      label:'开放文本',
      render:renderOpenText,
      submit(){submitOpenText()},
      handleClick(event){
        const hint=event.target.closest?.('[data-open-hint]');
        if(!hint)return false;
        revealOpenHint();
        return true;
      },
      handleInput(event){
        if(event.target.id!=='glnOpenTextInput'||state.awaitingAdvance)return false;
        state.textAnswer=event.target.value;
        const max=openMaxLength(state.current);
        setText('glnOpenTextCount',state.textAnswer.length+' / '+max);
        setCheckButton(state.textAnswer.trim().length>=openMinLength(state.current));
        return true;
      },
      handleFooterAction(action){
        if(action!=='show-open-hint')return false;
        revealOpenHint();
        return true;
      }
    });
    target.register('memory_match',{
      label:'翻牌记忆',
      isWide:true,
      render:renderMemory,
      actionBarHidden:()=>true,
      workUnits:activity=>Math.max(1,(activity.pairs||[]).length),
      completedWorkUnits:()=>state.memoryMatched.size,
      handleClick(event){
        const memory=event.target.closest?.('[data-memory-card]');
        if(!memory)return false;
        flipMemoryCard(memory);
        return true;
      }
    });
  }

  function bind(){
    if(state.bound)return;
    state.bound=true;
    byId('glnExitBtn')?.addEventListener('click',event=>{
      event.preventDefault();
      if(confirmExit()){state.started=false;pauseActiveTimer();clearMemoryTimer();global.location.href=pathHref()}
    });
    const activityRoot=byId('glnActivity');
    activityRoot?.addEventListener('click',event=>{activePlugin()?.handleClick?.(event,state.current,pluginRuntime())});
    activityRoot?.addEventListener('input',event=>{activePlugin()?.handleInput?.(event,state.current,pluginRuntime())});
    activityRoot?.addEventListener('dragstart',event=>{activePlugin()?.handleDragStart?.(event,state.current,pluginRuntime())});
    activityRoot?.addEventListener('dragover',event=>{activePlugin()?.handleDragOver?.(event,state.current,pluginRuntime())});
    activityRoot?.addEventListener('drop',event=>{activePlugin()?.handleDrop?.(event,state.current,pluginRuntime())});
    activityRoot?.addEventListener('dragend',event=>{activePlugin()?.handleDragEnd?.(event,state.current,pluginRuntime())});
    byId('glnFooterActions')?.addEventListener('click',event=>{
      const button=event.target.closest?.('[data-footer-action]');
      if(!button||button.disabled)return;
      const action=button.dataset.footerAction;
      if(activePlugin()?.handleFooterAction?.(action,state.current,pluginRuntime()))return;
      if(action==='check')submitCurrent();
      else if(action==='continue')continueAfterFeedback();
    });
    byId('glnDetailToggle')?.addEventListener('click',()=>{
      const toggle=byId('glnDetailToggle');
      const detail=byId('glnDetailContent');
      if(!toggle||!detail)return;
      const opening=detail.hidden;
      detail.hidden=!opening;
      toggle.textContent=opening?'收起详细解析':'查看详细解析';
      toggle.setAttribute('aria-expanded',opening?'true':'false');
    });
    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='hidden')pauseActiveTimer();
      else startActiveTimer();
    });
    global.addEventListener('resize',()=>requestAnimationFrame(drawMatchLines));
    global.addEventListener('kg-auth-session-change',()=>{state.started=false;pauseActiveTimer();clearMemoryTimer();global.location.reload()});
    global.addEventListener('beforeunload',pauseActiveTimer);
  }

  function init(nodeIdOverride=''){
    state.course=data()?.getCourse?.();
    if(!state.course){showFatal('课程不可用','未能加载课程配置。');return}
    const nodeId=String(nodeIdOverride||new URLSearchParams(global.location.search).get('node')||'');
    state.node=state.course.nodes.find(node=>node.id===nodeId)||null;
    if(!state.node){showFatal('节点不存在','请从学习路径选择一个有效节点。');return}
    state.part=state.course.parts.find(part=>part.id===state.node.partId)||null;
    state.stage=state.course.stages.find(stage=>stage.id===state.part?.stageId)||null;
    state.progress=store().read(state.course);
    state.adminPreview=isAdminUser();
    const entry=state.progress.nodes[state.node.id];
    if((!entry||entry.status==='locked')&&!state.adminPreview){showFatal('节点尚未解锁','请先完成前面的学习节点。');return}
    const content=data().contentForNode?.(state.node.id)||{mode:state.node.runMode||'standard',activities:data().activitiesForNode(state.node.id)};
    state.runMode=content.mode||'standard';
    state.activities=Array.isArray(content.activities)?content.activities:[];
    state.activityMap=new Map(state.activities.map(activity=>[activity.id,activity]));
    state.queue=state.activities.map(activity=>activity.id);
    state.completedIds=new Set();
    state.nodeCompleted=false;
    state.wrongAttempts=new Map();
    state.hintRevealed=new Map();
    state.hintOrder=new Map();
    state.metrics={totalAttempts:0,correctAttempts:0,currentStreak:0,maxCorrectStreak:0,hintUsedCount:0};
    state.activityOutcomes=new Map();
    state.activities.forEach(activity=>ensureActivityOutcome(activity));
    state.activeMs=0;
    state.activeSince=0;
    if(byId('glnActionBar'))byId('glnActionBar').hidden=false;
    if(byId('glnProgressShell'))byId('glnProgressShell').hidden=false;
    setText('glnTitle',state.node.title);
    updateProgress();
    bind();
    renderActivity();
  }

  registerStandardPlugins();
  global.KGGuidedLearningNodeApp=Object.freeze({init});
  document.addEventListener('DOMContentLoaded',()=>init());
})(window);
