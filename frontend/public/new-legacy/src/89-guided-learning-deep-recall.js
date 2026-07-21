'use strict';

/*
 * DeepRecallActivityPlugin v2
 * 复合活动：关键线索识别 → 知识点判断 → 推理路径排序。
 * 三个环节均采用渐进式提示：同一子任务答错 2 次开放第一条，
 * 答错 4 次开放第二条；提示不直接展示答案，并纳入节点提示使用统计。
 */
(function(global){
  const registry=global.KGGuidedLearningActivityRegistry;
  if(!registry)return;

  const sessions=new Map();
  const FALLBACK_HINTS=Object.freeze({
    clue:Object.freeze([
      '先把题干线索分成“方法环境、当前阶段或节奏、业务价值或约束”三类。',
      '优先选择会改变处理规则的词，而不是普通叙述或人物动作。'
    ]),
    concept:Object.freeze([
      '先判断题目正在考环境、约束还是角色职责，再比较选项。',
      '排除绕过既定角色分工、直接命令或机械套用另一种方法环境的选项。'
    ]),
    reasoning:Object.freeze([
      '推理通常从识别情境开始，最后才是选择行动。',
      '先确定环境和阶段，再明确角色、评估约束，最后决定处理方式。'
    ])
  });

  function sessionFor(activity){
    const key=String(activity?.id||'deep-recall');
    if(!sessions.has(key)){
      const conceptIds=(activity?.conceptQuestions||[]).map(item=>String(item.id));
      sessions.set(key,{
        phase:'clue',
        clueSelected:new Set(),
        clueCompleted:false,
        conceptQueue:[...conceptIds],
        conceptCompleted:new Set(),
        conceptChoice:'',
        reasoningOrder:(activity?.reasoningTask?.displayOrder||activity?.reasoningTask?.items||[]).map(item=>typeof item==='string'?String(item):String(item.id)),
        reasoningCompleted:false,
        dragId:'',
        awaitingAction:false,
        hintWrongCounts:new Map(),
        hintRevealed:new Map(),
        feedbackHintContext:null
      });
    }
    return sessions.get(key);
  }
  function reset(activity){sessions.delete(String(activity?.id||'deep-recall'))}
  function totalUnits(activity){return 2+Math.max(1,(activity?.conceptQuestions||[]).length)}
  function completedUnits(activity){
    const state=sessionFor(activity);
    return (state.clueCompleted?1:0)+state.conceptCompleted.size+(state.reasoningCompleted?1:0);
  }
  function currentConcept(activity,state){
    const id=String(state.conceptQueue[0]||'');
    return (activity.conceptQuestions||[]).find(item=>String(item.id)===id)||null;
  }
  function configuredHints(value,fallback){
    const hints=(Array.isArray(value)?value:[]).map(item=>String(item||'').trim()).filter(Boolean);
    return (hints.length?hints:fallback).slice(0,2);
  }
  function hintContextForPhase(activity,state,questionOverride=null){
    if(state.phase==='clue'){
      return {key:'clue',hints:configuredHints(activity?.clueTask?.hints,FALLBACK_HINTS.clue)};
    }
    if(state.phase==='concept'){
      const question=questionOverride||currentConcept(activity,state);
      const id=String(question?.id||'unknown');
      return {key:'concept:'+id,hints:configuredHints(question?.hints,FALLBACK_HINTS.concept)};
    }
    return {key:'reasoning',hints:configuredHints(activity?.reasoningTask?.hints,FALLBACK_HINTS.reasoning)};
  }
  function wrongHintCount(state,key){return Number(state.hintWrongCounts.get(key)||0)}
  function incrementHintWrong(state,key){
    const next=wrongHintCount(state,key)+1;
    state.hintWrongCounts.set(key,next);
    return next;
  }
  function allowedHintCount(state,context){
    const available=context?.hints?.length||0;
    const wrong=wrongHintCount(state,context?.key);
    if(wrong>=4)return Math.min(2,available);
    if(wrong>=2)return Math.min(1,available);
    return 0;
  }
  function revealedHintCount(state,context){return Number(state.hintRevealed.get(context?.key)||0)}
  function revealedHints(state,context){
    return (context?.hints||[]).slice(0,revealedHintCount(state,context));
  }
  function canRevealHint(state,context){return allowedHintCount(state,context)>revealedHintCount(state,context)}
  function hintButtonLabel(state,context){return revealedHintCount(state,context)>0?'再看一条提示':'查看提示'}
  function stepsHTML(activity,state,runtime){
    const steps=[
      {id:'clue',label:'线索识别',done:state.clueCompleted},
      {id:'concept',label:'知识判断',done:state.conceptCompleted.size>=(activity.conceptQuestions||[]).length},
      {id:'reasoning',label:'路径排序',done:state.reasoningCompleted}
    ];
    return '<div class="gln-deep-steps" aria-label="深度回忆步骤">'+steps.map(step=>'<span class="'+(step.done?'is-done ': '')+(state.phase===step.id?'is-current':'')+'">'+runtime.escapeHTML(step.label)+'</span>').join('')+'</div>';
  }
  function renderHintPanel(state,context,runtime){
    const revealed=revealedHints(state,context);
    const revealable=canRevealHint(state,context);
    if(!revealed.length&&!revealable)return '';
    return '<div class="gln-deep-hint-panel" data-deep-hint-panel="'+runtime.escapeHTML(context.key)+'" aria-label="渐进式提示">'
      +(revealed.length?'<div class="gln-deep-hints">'+revealed.map((hint,index)=>'<p><span>提示 '+(index+1)+'</span>'+runtime.escapeHTML(hint)+'</p>').join('')+'</div>':'')
      +(revealable?'<button type="button" class="ui-option-control" data-deep-hint>'+runtime.escapeHTML(hintButtonLabel(state,context))+'</button>':'')
      +'</div>';
  }
  function renderClue(activity,state,runtime){
    const clue=activity.clueTask||{};
    const required=Number(clue.requiredSelectionCount)||(clue.segments||[]).filter(segment=>segment.target).length;
    const context=hintContextForPhase(activity,state);
    return stepsHTML(activity,state,runtime)
      +'<div class="gln-question-head"><span>深度回忆 · 线索识别</span><h2>'+runtime.escapeHTML(clue.instruction||'请选择关键线索')+'</h2></div>'
      +'<div class="gln-keyword-instruction"><span>请选择 <strong>'+required+'</strong> 个关键线索</span><span id="glnDeepClueCount">已选 '+state.clueSelected.size+' / '+required+'</span></div>'
      +'<div class="gln-keyword-passage gln-deep-case">'+(clue.segments||[]).map((segment,index)=>'<button type="button" class="ui-option-control '+(state.clueSelected.has(index)?'is-selected':'')+'" data-deep-clue="'+index+'" aria-pressed="'+(state.clueSelected.has(index)?'true':'false')+'">'+runtime.escapeHTML(segment.text)+'</button>').join('')+'</div>'
      +renderHintPanel(state,context,runtime);
  }
  function renderConcept(activity,state,runtime){
    const question=currentConcept(activity,state);
    if(!question){state.phase='reasoning';return renderReasoning(activity,state,runtime)}
    const context=hintContextForPhase(activity,state,question);
    return stepsHTML(activity,state,runtime)
      +'<div class="gln-question-head"><span>深度回忆 · 知识判断</span><h2>'+runtime.escapeHTML(question.stem)+'</h2></div>'
      +'<div class="gln-choice-list">'+(question.options||[]).map(option=>'<button type="button" class="ui-option-control '+(String(option.id)===state.conceptChoice?'is-selected':'')+'" data-deep-choice="'+runtime.escapeHTML(option.id)+'"><span>'+runtime.escapeHTML(option.id)+'</span><strong>'+runtime.escapeHTML(option.text)+'</strong></button>').join('')+'</div>'
      +renderHintPanel(state,context,runtime);
  }
  function reasoningItems(activity){return activity?.reasoningTask?.items||[]}
  function reasoningMap(activity){return new Map(reasoningItems(activity).map(item=>[String(item.id),item]))}
  function renderReasoning(activity,state,runtime){
    const task=activity.reasoningTask||{};
    const byId=reasoningMap(activity);
    const context=hintContextForPhase(activity,state);
    return stepsHTML(activity,state,runtime)
      +'<div class="gln-question-head"><span>深度回忆 · 路径排序</span><h2>'+runtime.escapeHTML(task.instruction||'拖动卡片，组成完整判断顺序。')+'</h2></div>'
      +'<div class="gln-order-list" id="glnDeepOrderList">'+state.reasoningOrder.map((id,index)=>{
        const item=byId.get(String(id))||{id,text:id};
        return '<div class="gln-order-card" draggable="true" data-deep-order="'+runtime.escapeHTML(item.id)+'"><span class="gln-order-handle" aria-hidden="true">⋮⋮</span><strong>'+runtime.escapeHTML(item.text)+'</strong><span class="gln-order-actions"><button type="button" class="ui-option-control" data-deep-move="up" data-deep-order-id="'+runtime.escapeHTML(item.id)+'" aria-label="上移"'+(index===0?' disabled':'')+'>↑</button><button type="button" class="ui-option-control" data-deep-move="down" data-deep-order-id="'+runtime.escapeHTML(item.id)+'" aria-label="下移"'+(index===state.reasoningOrder.length-1?' disabled':'')+'>↓</button></span></div>';
      }).join('')+'</div>'
      +renderHintPanel(state,context,runtime);
  }
  function render(activity,runtime){
    const state=sessionFor(activity);
    if(state.phase==='clue')return renderClue(activity,state,runtime);
    if(state.phase==='concept')return renderConcept(activity,state,runtime);
    return renderReasoning(activity,state,runtime);
  }
  function setCheckState(activity,state,runtime){
    if(state.phase==='clue'){
      const clue=activity.clueTask||{};
      const required=Number(clue.requiredSelectionCount)||(clue.segments||[]).filter(segment=>segment.target).length;
      runtime.setCheckButton(state.clueSelected.size===required);
    }else if(state.phase==='concept')runtime.setCheckButton(Boolean(state.conceptChoice));
    else runtime.setCheckButton(state.reasoningOrder.length>1);
  }
  function mount(activity,runtime){
    runtime.rerenderActivity();
    setCheckState(activity,sessionFor(activity),runtime);
  }
  function feedbackButtons(state,context,nextAction){
    const buttons=[];
    if(context&&canRevealHint(state,context))buttons.push({action:'deep-hint',label:hintButtonLabel(state,context)});
    buttons.push({action:nextAction,label:'再试一次',primary:true});
    return buttons;
  }
  function showStageFeedback(activity,state,runtime,{correct,title,message,nextAction,hintContext=null}){
    state.awaitingAction=true;
    state.feedbackHintContext=correct?null:hintContext;
    runtime.showFeedback({title,message,kind:correct?'success':'error'});
    runtime.disableActivityControls();
    runtime.setFooterButtons(correct?[{action:nextAction,label:'继续',primary:true}]:feedbackButtons(state,hintContext,nextAction));
  }
  function submitClue(activity,state,runtime){
    const clue=activity.clueTask||{};
    const targets=(clue.segments||[]).map((segment,index)=>segment.target?index:null).filter(index=>index!==null);
    const selected=[...state.clueSelected];
    const missing=targets.filter(index=>!state.clueSelected.has(index));
    const wrong=selected.filter(index=>!targets.includes(index));
    const correct=!missing.length&&!wrong.length;
    runtime.recordAttempt(correct);
    if(correct){
      state.clueCompleted=true;
      runtime.updateProgress();
      showStageFeedback(activity,state,runtime,{correct:true,title:'线索识别完成',message:clue.shortExplanation||'你已经抓住了决定判断方向的关键线索。',nextAction:'deep-next'});
    }else{
      const context=hintContextForPhase(activity,state);
      incrementHintWrong(state,context.key);
      showStageFeedback(activity,state,runtime,{correct:false,title:'线索还不完整',message:'当前选择中有 '+wrong.length+' 项需要重新判断，同时遗漏了 '+missing.length+' 项关键线索。',nextAction:'deep-retry',hintContext:context});
    }
  }
  function submitConcept(activity,state,runtime){
    const question=currentConcept(activity,state);
    if(!question||!state.conceptChoice)return;
    const option=(question.options||[]).find(item=>String(item.id)===String(state.conceptChoice));
    const correct=Boolean(option?.correct);
    const context=hintContextForPhase(activity,state,question);
    runtime.recordAttempt(correct);
    if(correct){
      state.conceptQueue.shift();
      state.conceptCompleted.add(String(question.id));
      runtime.updateProgress();
      showStageFeedback(activity,state,runtime,{correct:true,title:'判断正确',message:question.shortExplanation||question.explanation||'你已经完成这一项知识判断。',nextAction:'deep-next'});
    }else{
      incrementHintWrong(state,context.key);
      state.conceptQueue.shift();
      state.conceptQueue.push(String(question.id));
      showStageFeedback(activity,state,runtime,{correct:false,title:'还需要重新判断',message:option?.feedback||question.incorrectFeedback||'请重新关注题目所处的环境、角色职责和当前约束。',nextAction:'deep-retry',hintContext:context});
    }
  }
  function submitReasoning(activity,state,runtime){
    const expected=(activity.reasoningTask?.correctOrder||reasoningItems(activity).map(item=>String(item.id))).map(String);
    const wrongPositions=state.reasoningOrder.filter((id,index)=>String(id)!==String(expected[index])).length;
    const correct=wrongPositions===0&&state.reasoningOrder.length===expected.length;
    runtime.recordAttempt(correct);
    if(correct){
      state.reasoningCompleted=true;
      runtime.updateProgress();
      runtime.completeActivity(activity.reasoningTask?.shortExplanation||activity.shortExplanation||'你已经完成线索、知识和推理路径的完整回忆。',{recordAttempt:false});
    }else{
      const context=hintContextForPhase(activity,state);
      incrementHintWrong(state,context.key);
      showStageFeedback(activity,state,runtime,{correct:false,title:'顺序还不完整',message:'当前有 '+wrongPositions+' 个步骤的位置需要重新考虑。',nextAction:'deep-retry',hintContext:context});
    }
  }
  function submit(activity,runtime){
    const state=sessionFor(activity);
    if(state.awaitingAction)return;
    if(state.phase==='clue')submitClue(activity,state,runtime);
    else if(state.phase==='concept')submitConcept(activity,state,runtime);
    else submitReasoning(activity,state,runtime);
  }
  function revealHint(activity,state,runtime,context){
    if(!context||!canRevealHint(state,context))return false;
    const next=revealedHintCount(state,context)+1;
    state.hintRevealed.set(context.key,next);
    runtime.recordHintUse?.();
    const hint=(context.hints||[])[next-1]||'';
    if(state.awaitingAction){
      const message=runtime.feedbackMessage?.();
      if(message&&hint&&!message.textContent.includes(hint))message.textContent=(message.textContent.trim()+' 提示：'+hint).trim();
      runtime.setFooterButtons(feedbackButtons(state,context,'deep-retry'));
    }else{
      mount(activity,runtime);
    }
    return true;
  }
  function moveOrder(state,id,direction){
    const index=state.reasoningOrder.indexOf(String(id));
    if(index<0)return;
    const target=direction==='up'?index-1:index+1;
    if(target<0||target>=state.reasoningOrder.length)return;
    [state.reasoningOrder[index],state.reasoningOrder[target]]=[state.reasoningOrder[target],state.reasoningOrder[index]];
  }
  function handleClick(event,activity,runtime){
    const state=sessionFor(activity);
    const hintButton=event.target.closest?.('[data-deep-hint]');
    if(hintButton&&!state.awaitingAction){
      revealHint(activity,state,runtime,hintContextForPhase(activity,state));
      return true;
    }
    if(state.awaitingAction)return false;
    const clueButton=event.target.closest?.('[data-deep-clue]');
    if(clueButton&&state.phase==='clue'){
      const index=Number(clueButton.dataset.deepClue);
      const clue=activity.clueTask||{};
      const required=Number(clue.requiredSelectionCount)||(clue.segments||[]).filter(segment=>segment.target).length;
      if(state.clueSelected.has(index))state.clueSelected.delete(index);
      else if(state.clueSelected.size<required)state.clueSelected.add(index);
      clueButton.classList.toggle('is-selected',state.clueSelected.has(index));
      clueButton.setAttribute('aria-pressed',state.clueSelected.has(index)?'true':'false');
      runtime.setText('glnDeepClueCount','已选 '+state.clueSelected.size+' / '+required);
      runtime.setCheckButton(state.clueSelected.size===required);
      return true;
    }
    const choice=event.target.closest?.('[data-deep-choice]');
    if(choice&&state.phase==='concept'){
      state.conceptChoice=String(choice.dataset.deepChoice);
      runtime.root().querySelectorAll('[data-deep-choice]').forEach(button=>button.classList.toggle('is-selected',button===choice));
      runtime.setCheckButton(true);
      return true;
    }
    const move=event.target.closest?.('[data-deep-move]');
    if(move&&state.phase==='reasoning'){
      moveOrder(state,move.dataset.deepOrderId,move.dataset.deepMove);
      mount(activity,runtime);
      return true;
    }
    return false;
  }
  function handleDragStart(event,activity){
    const state=sessionFor(activity);
    const card=event.target.closest?.('[data-deep-order]');
    if(!card||state.phase!=='reasoning'||state.awaitingAction)return false;
    state.dragId=String(card.dataset.deepOrder||'');
    card.classList.add('is-dragging');
    try{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',state.dragId)}catch(error){}
    return true;
  }
  function handleDragOver(event,activity){
    const state=sessionFor(activity);
    if(!state.dragId||state.phase!=='reasoning')return false;
    const card=event.target.closest?.('[data-deep-order]');
    if(!card)return false;
    event.preventDefault();
    return true;
  }
  function handleDrop(event,activity,runtime){
    const state=sessionFor(activity);
    const target=event.target.closest?.('[data-deep-order]');
    if(!target||!state.dragId)return false;
    event.preventDefault();
    const from=state.reasoningOrder.indexOf(state.dragId);
    const to=state.reasoningOrder.indexOf(String(target.dataset.deepOrder));
    if(from>=0&&to>=0&&from!==to){
      const [moved]=state.reasoningOrder.splice(from,1);
      state.reasoningOrder.splice(to,0,moved);
    }
    state.dragId='';
    mount(activity,runtime);
    return true;
  }
  function handleDragEnd(event,activity){
    const state=sessionFor(activity);
    state.dragId='';
    event.target.closest?.('[data-deep-order]')?.classList.remove('is-dragging');
    return true;
  }
  function handleFooterAction(action,activity,runtime){
    const state=sessionFor(activity);
    if(action==='deep-hint'){
      return revealHint(activity,state,runtime,state.feedbackHintContext);
    }
    if(action!=='deep-next'&&action!=='deep-retry')return false;
    runtime.clearFeedback();
    state.awaitingAction=false;
    state.feedbackHintContext=null;
    if(action==='deep-retry'){
      if(state.phase==='clue')state.clueSelected=new Set();
      else if(state.phase==='concept')state.conceptChoice='';
      else state.reasoningOrder=(activity.reasoningTask?.displayOrder||reasoningItems(activity)).map(item=>typeof item==='string'?String(item):String(item.id));
    }else if(state.phase==='clue'){
      state.phase='concept';
      state.conceptChoice='';
    }else if(state.phase==='concept'){
      state.conceptChoice='';
      if(!state.conceptQueue.length)state.phase='reasoning';
    }
    mount(activity,runtime);
    return true;
  }

  registry.register('deep_recall',{
    label:'深度回忆',
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
    dispose(activity){sessions.delete(String(activity?.id||'deep-recall'))}
  });
})(window);
