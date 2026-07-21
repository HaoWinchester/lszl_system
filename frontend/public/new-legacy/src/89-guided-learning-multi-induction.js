'use strict';

/*
 * MultiQuestionInductionActivityPlugin v1
 * 复合活动：完成三道相关原题 → 将题目卡片归入固定分类区 → 排列通用判断规则。
 * 原题答错后进入队尾；分类仅反馈错误数量；排序答错 2 次和 4 次后分别开放一级、二级提示。
 */
(function(global){
  const registry=global.KGGuidedLearningActivityRegistry;
  if(!registry)return;

  const sessions=new Map();
  const FALLBACK_ORDER_HINTS=Object.freeze([
    '通用规则通常从识别题目环境开始，最后才选择处理路径。',
    '先识别环境，再确认承诺或基准约束，随后明确角色、评估影响，最后选择行动。'
  ]);

  function sourceQuestions(activity){return Array.isArray(activity?.sourceQuestions)?activity.sourceQuestions:[]}
  function classificationCards(activity){return Array.isArray(activity?.classificationTask?.cards)?activity.classificationTask.cards:[]}
  function classificationCategories(activity){return Array.isArray(activity?.classificationTask?.categories)?activity.classificationTask.categories:[]}
  function orderItems(activity){return Array.isArray(activity?.orderingTask?.items)?activity.orderingTask.items:[]}
  function initialOrder(activity){
    const configured=activity?.orderingTask?.displayOrder;
    return (Array.isArray(configured)&&configured.length?configured:orderItems(activity)).map(item=>typeof item==='string'?String(item):String(item.id));
  }
  function sessionFor(activity){
    const key=String(activity?.id||'multi-question-induction');
    if(!sessions.has(key)){
      sessions.set(key,{
        phase:'questions',
        questionQueue:sourceQuestions(activity).map(item=>String(item.id)),
        questionCompleted:new Set(),
        questionChoice:'',
        classificationAssignments:new Map(),
        classificationCompleted:false,
        selectedCardId:'',
        orderingOrder:initialOrder(activity),
        orderingCompleted:false,
        orderingWrongCount:0,
        orderingHintsRevealed:0,
        dragType:'',
        dragId:'',
        awaitingAction:false,
        feedbackHintContext:null
      });
    }
    return sessions.get(key);
  }
  function reset(activity){sessions.delete(String(activity?.id||'multi-question-induction'))}
  function totalUnits(activity){return Math.max(1,sourceQuestions(activity).length)+2}
  function completedUnits(activity){
    const state=sessionFor(activity);
    return state.questionCompleted.size+(state.classificationCompleted?1:0)+(state.orderingCompleted?1:0);
  }
  function currentQuestion(activity,state){
    const id=String(state.questionQueue[0]||'');
    return sourceQuestions(activity).find(item=>String(item.id)===id)||null;
  }
  function orderHints(activity){
    const hints=(activity?.orderingTask?.hints||[]).map(item=>String(item||'').trim()).filter(Boolean);
    return (hints.length?hints:FALLBACK_ORDER_HINTS).slice(0,2);
  }
  function allowedOrderHintCount(activity,state){
    const available=orderHints(activity).length;
    if(state.orderingWrongCount>=4)return Math.min(2,available);
    if(state.orderingWrongCount>=2)return Math.min(1,available);
    return 0;
  }
  function canRevealOrderHint(activity,state){return allowedOrderHintCount(activity,state)>state.orderingHintsRevealed}
  function orderHintLabel(state){return state.orderingHintsRevealed?'再看一条提示':'查看提示'}

  function stepsHTML(activity,state,runtime){
    const steps=[
      {id:'questions',label:'完成原题',done:state.questionCompleted.size>=sourceQuestions(activity).length},
      {id:'classification',label:'分类归纳',done:state.classificationCompleted},
      {id:'ordering',label:'通用规则',done:state.orderingCompleted}
    ];
    return '<div class="gln-induction-steps" aria-label="多题归纳步骤">'+steps.map(step=>'<span class="'+(step.done?'is-done ':'')+(state.phase===step.id?'is-current':'')+'">'+runtime.escapeHTML(step.label)+'</span>').join('')+'</div>';
  }
  function renderQuestion(activity,state,runtime){
    const question=currentQuestion(activity,state);
    if(!question){state.phase='classification';return renderClassification(activity,state,runtime)}
    const complete=state.questionCompleted.size;
    const total=sourceQuestions(activity).length;
    return stepsHTML(activity,state,runtime)
      +'<div class="gln-question-head"><span>多题归纳 · 原题 '+Math.min(total,complete+1)+' / '+total+'</span><h2>'+runtime.escapeHTML(question.stem||'请选择正确答案')+'</h2><p>答错的题目会进入队尾，三道原题全部正确后进入分类归纳。</p></div>'
      +'<div class="gln-choice-list gln-induction-question-options">'+(question.options||[]).map(option=>'<button type="button" class="ui-option-control '+(String(option.id)===state.questionChoice?'is-selected':'')+'" data-induction-choice="'+runtime.escapeHTML(option.id)+'"><span>'+runtime.escapeHTML(option.id)+'</span><strong>'+runtime.escapeHTML(option.text)+'</strong></button>').join('')+'</div>';
  }
  function cardHTML(card,state,runtime){
    const selected=String(card.id)===state.selectedCardId;
    return '<button type="button" draggable="true" class="gln-induction-card ui-option-control'+(selected?' is-selected':'')+'" data-induction-card="'+runtime.escapeHTML(card.id)+'" aria-pressed="'+(selected?'true':'false')+'"><span>'+runtime.escapeHTML(card.label||'题目卡片')+'</span><strong>'+runtime.escapeHTML(card.text||card.title||card.id)+'</strong></button>';
  }
  function renderClassification(activity,state,runtime){
    const task=activity.classificationTask||{};
    const cards=classificationCards(activity);
    const assigned=new Set(state.classificationAssignments.keys());
    const unassigned=cards.filter(card=>!assigned.has(String(card.id)));
    return stepsHTML(activity,state,runtime)
      +'<div class="gln-question-head"><span>多题归纳 · 分类画布</span><h2>'+runtime.escapeHTML(task.instruction||'把三道题拖入对应分类区。')+'</h2><p>可拖动卡片，也可以先点击卡片，再点击目标分类区。</p></div>'
      +'<div class="gln-induction-canvas">'
      +'<section class="gln-induction-tray" aria-label="待分类题目"><header><strong>待分类题目</strong><span>'+unassigned.length+' 张</span></header><div class="gln-induction-tray-cards">'+(unassigned.length?unassigned.map(card=>cardHTML(card,state,runtime)).join(''):'<p class="gln-induction-empty">全部题目已放入分类区</p>')+'</div></section>'
      +'<div class="gln-induction-zones">'+classificationCategories(activity).map(category=>{
        const zoneCards=cards.filter(card=>String(state.classificationAssignments.get(String(card.id))||'')===String(category.id));
        return '<section class="gln-induction-zone" data-induction-drop-zone="'+runtime.escapeHTML(category.id)+'" aria-label="'+runtime.escapeHTML(category.label)+'分类区"><header><strong>'+runtime.escapeHTML(category.label)+'</strong><span>'+runtime.escapeHTML(category.description||'')+'</span><button type="button" class="ui-option-control" data-induction-zone="'+runtime.escapeHTML(category.id)+'">放入此分类</button></header><div class="gln-induction-zone-cards">'+(zoneCards.length?zoneCards.map(card=>cardHTML(card,state,runtime)).join(''):'<p class="gln-induction-drop-hint">拖到这里</p>')+'</div></section>';
      }).join('')+'</div></div>';
  }
  function orderItemMap(activity){return new Map(orderItems(activity).map(item=>[String(item.id),item]))}
  function renderOrderHints(activity,state,runtime){
    const revealed=orderHints(activity).slice(0,state.orderingHintsRevealed);
    const revealable=canRevealOrderHint(activity,state);
    if(!revealed.length&&!revealable)return '';
    return '<div class="gln-induction-hint-panel" aria-label="排序渐进提示">'
      +(revealed.length?'<div class="gln-induction-hints">'+revealed.map((hint,index)=>'<p><span>提示 '+(index+1)+'</span>'+runtime.escapeHTML(hint)+'</p>').join('')+'</div>':'')
      +(revealable&&!state.awaitingAction?'<button type="button" class="ui-option-control" data-induction-hint>'+runtime.escapeHTML(orderHintLabel(state))+'</button>':'')+'</div>';
  }
  function renderOrdering(activity,state,runtime){
    const task=activity.orderingTask||{};
    const byId=orderItemMap(activity);
    return stepsHTML(activity,state,runtime)
      +'<div class="gln-question-head"><span>多题归纳 · 通用规则</span><h2>'+runtime.escapeHTML(task.instruction||'排列可复用的判断规则。')+'</h2><p>把三道题背后的共同判断过程整理成稳定顺序。</p></div>'
      +'<div class="gln-order-list gln-induction-order-list">'+state.orderingOrder.map((id,index)=>{
        const item=byId.get(String(id))||{id,text:id};
        return '<div class="gln-order-card" draggable="true" data-induction-order="'+runtime.escapeHTML(item.id)+'"><span class="gln-order-handle" aria-hidden="true">⋮⋮</span><strong>'+runtime.escapeHTML(item.text)+'</strong><span class="gln-order-actions"><button type="button" class="ui-option-control" data-induction-move="up" data-induction-order-id="'+runtime.escapeHTML(item.id)+'" aria-label="上移"'+(index===0?' disabled':'')+'>↑</button><button type="button" class="ui-option-control" data-induction-move="down" data-induction-order-id="'+runtime.escapeHTML(item.id)+'" aria-label="下移"'+(index===state.orderingOrder.length-1?' disabled':'')+'>↓</button></span></div>';
      }).join('')+'</div>'+renderOrderHints(activity,state,runtime);
  }
  function render(activity,runtime){
    const state=sessionFor(activity);
    if(state.phase==='questions')return renderQuestion(activity,state,runtime);
    if(state.phase==='classification')return renderClassification(activity,state,runtime);
    return renderOrdering(activity,state,runtime);
  }
  function setCheckState(activity,state,runtime){
    if(state.phase==='questions')runtime.setCheckButton(Boolean(state.questionChoice));
    else if(state.phase==='classification')runtime.setCheckButton(state.classificationAssignments.size===classificationCards(activity).length);
    else runtime.setCheckButton(state.orderingOrder.length>1);
  }
  function mount(activity,runtime){runtime.rerenderActivity();setCheckState(activity,sessionFor(activity),runtime)}
  function feedbackButtons(activity,state,nextAction,label){
    const buttons=[];
    if(state.phase==='ordering'&&canRevealOrderHint(activity,state))buttons.push({action:'induction-hint',label:orderHintLabel(state)});
    buttons.push({action:nextAction,label:label||'继续',primary:true});
    return buttons;
  }
  function showStageFeedback(activity,state,runtime,{correct,title,message,nextAction,label}){
    state.awaitingAction=true;
    runtime.showFeedback({title,message,kind:correct?'success':'error'});
    runtime.disableActivityControls();
    runtime.setFooterButtons(feedbackButtons(activity,state,nextAction,label));
  }
  function submitQuestion(activity,state,runtime){
    const question=currentQuestion(activity,state);
    if(!question||!state.questionChoice)return;
    const option=(question.options||[]).find(item=>String(item.id)===String(state.questionChoice));
    const correct=Boolean(option?.correct);
    runtime.recordAttempt(correct);
    state.questionQueue.shift();
    if(correct){
      state.questionCompleted.add(String(question.id));
      runtime.updateProgress();
      showStageFeedback(activity,state,runtime,{correct:true,title:'原题完成',message:question.shortExplanation||'这道题已经答对。',nextAction:'induction-next',label:state.questionQueue.length?'继续':'进入分类'});
    }else{
      state.questionQueue.push(String(question.id));
      showStageFeedback(activity,state,runtime,{correct:false,title:'稍后再做一次',message:option?.feedback||question.incorrectFeedback||'这道题会进入队尾，请先完成其他相关题目。',nextAction:'induction-next',label:'继续'});
    }
  }
  function submitClassification(activity,state,runtime){
    const cards=classificationCards(activity);
    const wrong=cards.filter(card=>String(state.classificationAssignments.get(String(card.id))||'')!==String(card.correctCategoryId));
    const correct=wrong.length===0&&state.classificationAssignments.size===cards.length;
    runtime.recordAttempt(correct);
    if(correct){
      state.classificationCompleted=true;
      runtime.updateProgress();
      showStageFeedback(activity,state,runtime,{correct:true,title:'分类完成',message:activity.classificationTask?.shortExplanation||'你已经正确区分三类项目环境。',nextAction:'induction-next',label:'整理通用规则'});
    }else{
      showStageFeedback(activity,state,runtime,{correct:false,title:'分类还需调整',message:'当前有 '+wrong.length+' 张题目卡片分类错误。系统不会指出具体卡片，请重新比较方法环境、工件和治理约束。',nextAction:'induction-retry',label:'重新分类'});
    }
  }
  function submitOrdering(activity,state,runtime){
    const expected=(activity.orderingTask?.correctOrder||orderItems(activity).map(item=>String(item.id))).map(String);
    const wrongPositions=state.orderingOrder.filter((id,index)=>String(id)!==String(expected[index])).length;
    const correct=wrongPositions===0&&state.orderingOrder.length===expected.length;
    runtime.recordAttempt(correct);
    if(correct){
      state.orderingCompleted=true;
      runtime.updateProgress();
      runtime.completeActivity(activity.orderingTask?.shortExplanation||activity.shortExplanation||'你已经从三道原题中归纳出可复用的判断规则。',{recordAttempt:false});
    }else{
      state.orderingWrongCount+=1;
      showStageFeedback(activity,state,runtime,{correct:false,title:'通用规则顺序还不完整',message:'当前有 '+wrongPositions+' 个步骤的位置需要重新考虑。',nextAction:'induction-retry',label:'重新排序'});
    }
  }
  function submit(activity,runtime){
    const state=sessionFor(activity);
    if(state.awaitingAction)return;
    if(state.phase==='questions')submitQuestion(activity,state,runtime);
    else if(state.phase==='classification')submitClassification(activity,state,runtime);
    else submitOrdering(activity,state,runtime);
  }
  function revealOrderHint(activity,state,runtime){
    if(!canRevealOrderHint(activity,state))return false;
    state.orderingHintsRevealed+=1;
    runtime.recordHintUse?.();
    const hint=orderHints(activity)[state.orderingHintsRevealed-1]||'';
    if(state.awaitingAction){
      const message=runtime.feedbackMessage?.();
      if(message&&hint&&!message.textContent.includes(hint))message.textContent=(message.textContent.trim()+' 提示：'+hint).trim();
      runtime.setFooterButtons(feedbackButtons(activity,state,'induction-retry','重新排序'));
    }else mount(activity,runtime);
    return true;
  }
  function assignCard(state,cardId,categoryId){
    if(!cardId||!categoryId)return;
    state.classificationAssignments.set(String(cardId),String(categoryId));
    state.selectedCardId='';
  }
  function moveOrder(state,id,direction){
    const index=state.orderingOrder.indexOf(String(id));
    if(index<0)return;
    const target=direction==='up'?index-1:index+1;
    if(target<0||target>=state.orderingOrder.length)return;
    [state.orderingOrder[index],state.orderingOrder[target]]=[state.orderingOrder[target],state.orderingOrder[index]];
  }
  function handleClick(event,activity,runtime){
    const state=sessionFor(activity);
    const hint=event.target.closest?.('[data-induction-hint]');
    if(hint&&!state.awaitingAction)return revealOrderHint(activity,state,runtime);
    if(state.awaitingAction)return false;
    const choice=event.target.closest?.('[data-induction-choice]');
    if(choice&&state.phase==='questions'){
      state.questionChoice=String(choice.dataset.inductionChoice);
      runtime.root().querySelectorAll('[data-induction-choice]').forEach(button=>button.classList.toggle('is-selected',button===choice));
      runtime.setCheckButton(true);
      return true;
    }
    const card=event.target.closest?.('[data-induction-card]');
    if(card&&state.phase==='classification'){
      state.selectedCardId=state.selectedCardId===String(card.dataset.inductionCard)?'':String(card.dataset.inductionCard);
      mount(activity,runtime);
      return true;
    }
    const zone=event.target.closest?.('[data-induction-zone]');
    if(zone&&state.phase==='classification'&&state.selectedCardId){
      assignCard(state,state.selectedCardId,zone.dataset.inductionZone);
      mount(activity,runtime);
      return true;
    }
    const move=event.target.closest?.('[data-induction-move]');
    if(move&&state.phase==='ordering'){
      moveOrder(state,move.dataset.inductionOrderId,move.dataset.inductionMove);
      mount(activity,runtime);
      return true;
    }
    return false;
  }
  function handleDragStart(event,activity){
    const state=sessionFor(activity);
    if(state.awaitingAction)return false;
    const card=event.target.closest?.('[data-induction-card]');
    if(card&&state.phase==='classification'){
      state.dragType='card';state.dragId=String(card.dataset.inductionCard);card.classList.add('is-dragging');
    }else{
      const order=event.target.closest?.('[data-induction-order]');
      if(!order||state.phase!=='ordering')return false;
      state.dragType='order';state.dragId=String(order.dataset.inductionOrder);order.classList.add('is-dragging');
    }
    try{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',state.dragId)}catch(error){}
    return true;
  }
  function handleDragOver(event,activity){
    const state=sessionFor(activity);
    if(state.dragType==='card'&&event.target.closest?.('[data-induction-drop-zone]')){event.preventDefault();return true}
    if(state.dragType==='order'&&event.target.closest?.('[data-induction-order]')){event.preventDefault();return true}
    return false;
  }
  function handleDrop(event,activity,runtime){
    const state=sessionFor(activity);
    if(state.dragType==='card'){
      const zone=event.target.closest?.('[data-induction-drop-zone]');
      if(!zone||!state.dragId)return false;
      event.preventDefault();assignCard(state,state.dragId,zone.dataset.inductionDropZone);state.dragType='';state.dragId='';mount(activity,runtime);return true;
    }
    if(state.dragType==='order'){
      const target=event.target.closest?.('[data-induction-order]');
      if(!target||!state.dragId)return false;
      event.preventDefault();
      const from=state.orderingOrder.indexOf(state.dragId);
      const to=state.orderingOrder.indexOf(String(target.dataset.inductionOrder));
      if(from>=0&&to>=0&&from!==to){const moved=state.orderingOrder.splice(from,1)[0];state.orderingOrder.splice(to,0,moved)}
      state.dragType='';state.dragId='';mount(activity,runtime);return true;
    }
    return false;
  }
  function handleDragEnd(event,activity){
    const state=sessionFor(activity);state.dragType='';state.dragId='';event.target.closest?.('[draggable="true"]')?.classList.remove('is-dragging');return true;
  }
  function handleFooterAction(action,activity,runtime){
    const state=sessionFor(activity);
    if(action==='induction-hint')return revealOrderHint(activity,state,runtime);
    if(action!=='induction-next'&&action!=='induction-retry')return false;
    runtime.clearFeedback();state.awaitingAction=false;
    if(action==='induction-retry'){
      if(state.phase==='classification'){
        state.classificationAssignments=new Map();state.selectedCardId='';
      }else if(state.phase==='ordering')state.orderingOrder=initialOrder(activity);
    }else if(state.phase==='questions'){
      state.questionChoice='';
      if(!state.questionQueue.length)state.phase='classification';
    }else if(state.phase==='classification'){
      state.phase='ordering';state.orderingOrder=initialOrder(activity);
    }
    mount(activity,runtime);return true;
  }

  registry.register('multi_question_induction',{
    label:'多题归纳',
    mode:'composite',
    isWide:true,
    render,
    prepare(activity){reset(activity);sessionFor(activity)},
    submit,
    handleClick,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    handleFooterAction,
    workUnits:totalUnits,
    completedWorkUnits:completedUnits,
    onMounted(activity,runtime){setCheckState(activity,sessionFor(activity),runtime)},
    dispose(activity){sessions.delete(String(activity?.id||'multi-question-induction'))}
  });
})(window);
