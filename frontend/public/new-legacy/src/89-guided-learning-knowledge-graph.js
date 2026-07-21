'use strict';

/*
 * KnowledgeGraphActivityPlugin v1
 * 固定小型知识图谱复合活动：
 * 补全缺失知识点 → 选择节点关系 → 找出错误连接。
 * 每项任务答错后进入当前阶段队尾；逐级提示会计入统一提示统计。
 */
(function(global){
  const registry=global.KGGuidedLearningActivityRegistry;
  if(!registry)return;

  const sessions=new Map();

  function list(value){return Array.isArray(value)?value:[]}
  function graphNodes(activity){return list(activity?.graph?.nodes)}
  function graphEdges(activity){return list(activity?.graph?.edges)}
  function missingTasks(activity){return list(activity?.missingNodeTasks)}
  function relationTasks(activity){return list(activity?.relationTasks)}
  function errorTasks(activity){return list(activity?.errorConnectionTasks)}
  function phaseTasks(activity,phase){
    if(phase==='missing')return missingTasks(activity);
    if(phase==='relation')return relationTasks(activity);
    return errorTasks(activity);
  }
  function taskMap(activity,phase){return new Map(phaseTasks(activity,phase).map(task=>[String(task.id),task]))}
  function taskQueue(state,phase){
    if(phase==='missing')return state.missingQueue;
    if(phase==='relation')return state.relationQueue;
    return state.errorQueue;
  }
  function completedSet(state,phase){
    if(phase==='missing')return state.missingCompleted;
    if(phase==='relation')return state.relationCompleted;
    return state.errorCompleted;
  }
  function currentTask(activity,state){
    const id=String(taskQueue(state,state.phase)[0]||'');
    return taskMap(activity,state.phase).get(id)||null;
  }
  function nextPhase(phase){
    if(phase==='missing')return 'relation';
    if(phase==='relation')return 'error';
    return 'done';
  }
  function ensurePhase(activity,state){
    let guard=0;
    while(state.phase!=='done'&&!taskQueue(state,state.phase).length&&guard<4){
      state.phase=nextPhase(state.phase);
      guard+=1;
    }
    return state.phase;
  }
  function sessionFor(activity){
    const key=String(activity?.id||'knowledge-graph');
    if(!sessions.has(key)){
      sessions.set(key,{
        phase:'missing',
        missingQueue:missingTasks(activity).map(task=>String(task.id)),
        relationQueue:relationTasks(activity).map(task=>String(task.id)),
        errorQueue:errorTasks(activity).map(task=>String(task.id)),
        missingCompleted:new Set(),
        relationCompleted:new Set(),
        errorCompleted:new Set(),
        selectedOption:'',
        selectedEdge:'',
        wrongCounts:new Map(),
        hintRevealed:new Map(),
        awaitingAction:false,
        feedbackTask:null
      });
    }
    const state=sessions.get(key);
    ensurePhase(activity,state);
    return state;
  }
  function reset(activity){sessions.delete(String(activity?.id||'knowledge-graph'))}
  function totalUnits(activity){
    return Math.max(1,missingTasks(activity).length+relationTasks(activity).length+errorTasks(activity).length);
  }
  function completedUnits(activity){
    const state=sessionFor(activity);
    return state.missingCompleted.size+state.relationCompleted.size+state.errorCompleted.size;
  }
  function taskKey(state,task){return state.phase+':'+String(task?.id||'unknown')}
  function taskHints(task){return list(task?.hints).map(item=>String(item||'').trim()).filter(Boolean).slice(0,2)}
  function wrongCount(state,key){return Number(state.wrongCounts.get(key)||0)}
  function incrementWrong(state,key){
    const next=wrongCount(state,key)+1;
    state.wrongCounts.set(key,next);
    return next;
  }
  function allowedHintCount(state,task){
    const available=taskHints(task).length;
    return Math.min(available,wrongCount(state,taskKey(state,task)));
  }
  function revealedHintCount(state,task){return Number(state.hintRevealed.get(taskKey(state,task))||0)}
  function canRevealHint(state,task){return allowedHintCount(state,task)>revealedHintCount(state,task)}
  function revealedHints(state,task){return taskHints(task).slice(0,revealedHintCount(state,task))}
  function hintLabel(state,task){return revealedHintCount(state,task)>0?'再看一条提示':'查看提示'}

  function stepsHTML(activity,state,runtime){
    const steps=[
      {id:'missing',label:'补全知识点',done:state.missingCompleted.size>=missingTasks(activity).length},
      {id:'relation',label:'选择关系',done:state.relationCompleted.size>=relationTasks(activity).length},
      {id:'error',label:'错误连接',done:state.errorCompleted.size>=errorTasks(activity).length}
    ];
    return '<div class="gln-kg-steps" aria-label="知识图谱步骤">'+steps.map(step=>'<span class="'+(step.done?'is-done ':'')+(state.phase===step.id?'is-current':'')+'">'+runtime.escapeHTML(step.label)+'</span>').join('')+'</div>';
  }
  function nodeMap(activity){return new Map(graphNodes(activity).map(node=>[String(node.id),node]))}
  function edgeCoordinates(activity,edge){
    const byId=nodeMap(activity);
    const from=byId.get(String(edge.from))||{x:0,y:0};
    const to=byId.get(String(edge.to))||{x:0,y:0};
    return {
      x1:Number(from.x)||0,
      y1:Number(from.y)||0,
      x2:Number(to.x)||0,
      y2:Number(to.y)||0,
      labelX:edge.labelX===undefined?((Number(from.x)||0)+(Number(to.x)||0))/2:Number(edge.labelX),
      labelY:edge.labelY===undefined?((Number(from.y)||0)+(Number(to.y)||0))/2:Number(edge.labelY)
    };
  }
  function visibleEdges(activity,state,task){
    if(state.phase==='error'&&task)return list(task.candidateEdges);
    return graphEdges(activity);
  }
  function edgeRelation(state,task,edge){
    if(state.phase==='relation'&&String(edge.id)===String(task?.edgeId))return '？';
    return String(edge.relation||'关联');
  }
  function graphHTML(activity,state,task,runtime){
    const edges=visibleEdges(activity,state,task);
    const missingTarget=state.phase==='missing'?String(task?.targetNodeId||''):'';
    const relationTarget=state.phase==='relation'?String(task?.edgeId||''):'';
    const errorMode=state.phase==='error';
    const lines=edges.map(edge=>{
      const c=edgeCoordinates(activity,edge);
      const highlight=String(edge.id)===relationTarget;
      return '<line class="'+(highlight?'is-highlight':'')+'" x1="'+(c.x1*10)+'" y1="'+(c.y1*5.6)+'" x2="'+(c.x2*10)+'" y2="'+(c.y2*5.6)+'" marker-end="url(#glnKgArrow)"></line>';
    }).join('');
    const labels=edges.map(edge=>{
      const c=edgeCoordinates(activity,edge);
      const highlight=String(edge.id)===relationTarget;
      const selected=String(edge.id)===state.selectedEdge;
      const classes=['gln-kg-edge-label',errorMode?'ui-option-control':'',highlight?'is-highlight':'',selected?'is-selected':'',errorMode?'is-clickable':''].filter(Boolean).join(' ');
      const attrs=errorMode?' type="button" data-kg-error-edge="'+runtime.escapeHTML(edge.id)+'" aria-pressed="'+(selected?'true':'false')+'"':'';
      const tag=errorMode?'button':'span';
      return '<'+tag+attrs+' class="'+classes+'" style="left:'+c.labelX+'%;top:'+c.labelY+'%">'+runtime.escapeHTML(edgeRelation(state,task,edge))+'</'+tag+'>';
    }).join('');
    const nodes=graphNodes(activity).map(node=>{
      const missing=String(node.id)===missingTarget;
      return '<div class="gln-kg-node'+(missing?' is-missing':'')+(node.kind==='root'?' is-root':'')+'" data-kg-node="'+runtime.escapeHTML(node.id)+'" style="left:'+Number(node.x||0)+'%;top:'+Number(node.y||0)+'%"><span>'+runtime.escapeHTML(missing?'？':node.label||node.id)+'</span></div>';
    }).join('');
    return '<div class="gln-kg-board" aria-label="固定知识图谱">'
      +'<svg class="gln-kg-lines" viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="glnKgArrow" viewBox="0 0 10 10" refX="8.2" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>'+lines+'</svg>'
      +nodes+labels+'</div>';
  }
  function renderHintPanel(state,task,runtime){
    const revealed=revealedHints(state,task);
    const revealable=canRevealHint(state,task);
    if(!revealed.length&&!revealable)return '';
    return '<div class="gln-kg-hint-panel" aria-label="知识图谱渐进提示">'
      +(revealed.length?'<div class="gln-kg-hints">'+revealed.map((hint,index)=>'<p><span>提示 '+(index+1)+'</span>'+runtime.escapeHTML(hint)+'</p>').join('')+'</div>':'')
      +(revealable&&!state.awaitingAction?'<button type="button" class="ui-option-control" data-kg-hint>'+runtime.escapeHTML(hintLabel(state,task))+'</button>':'')
      +'</div>';
  }
  function optionButtons(task,state,runtime){
    return '<div class="gln-kg-options">'+list(task?.options).map(option=>{
      const selected=String(option.id)===state.selectedOption;
      return '<button type="button" class="ui-option-control '+(selected?'is-selected':'')+'" data-kg-option="'+runtime.escapeHTML(option.id)+'" aria-pressed="'+(selected?'true':'false')+'"><strong>'+runtime.escapeHTML(option.text||option.label||option.id)+'</strong></button>';
    }).join('')+'</div>';
  }
  function phaseCounter(activity,state){
    const tasks=phaseTasks(activity,state.phase);
    const completed=completedSet(state,state.phase).size;
    return Math.min(tasks.length,completed+1)+' / '+tasks.length;
  }
  function renderMissing(activity,state,task,runtime){
    return stepsHTML(activity,state,runtime)
      +'<div class="gln-question-head"><span>知识图谱 · 补全知识点 '+phaseCounter(activity,state)+'</span><h2>'+runtime.escapeHTML(task?.instruction||'补全缺失知识点')+'</h2><p>观察节点位置和上下游关系，选择最合适的知识点。</p></div>'
      +graphHTML(activity,state,task,runtime)+optionButtons(task,state,runtime)+renderHintPanel(state,task,runtime);
  }
  function renderRelation(activity,state,task,runtime){
    return stepsHTML(activity,state,runtime)
      +'<div class="gln-question-head"><span>知识图谱 · 选择关系 '+phaseCounter(activity,state)+'</span><h2>'+runtime.escapeHTML(task?.instruction||'选择节点之间的关系')+'</h2><p>图中“？”表示当前需要补全的关系。</p></div>'
      +graphHTML(activity,state,task,runtime)+optionButtons(task,state,runtime)+renderHintPanel(state,task,runtime);
  }
  function renderError(activity,state,task,runtime){
    return stepsHTML(activity,state,runtime)
      +'<div class="gln-question-head"><span>知识图谱 · 找出错误连接 '+phaseCounter(activity,state)+'</span><h2>'+runtime.escapeHTML(task?.instruction||'找出错误连接')+'</h2><p>点击图中的关系标签选择一条连接，再检查答案。</p></div>'
      +graphHTML(activity,state,task,runtime)+renderHintPanel(state,task,runtime);
  }
  function render(activity,runtime){
    const state=sessionFor(activity);
    ensurePhase(activity,state);
    const task=currentTask(activity,state);
    if(state.phase==='missing')return renderMissing(activity,state,task,runtime);
    if(state.phase==='relation')return renderRelation(activity,state,task,runtime);
    return renderError(activity,state,task,runtime);
  }
  function setCheckState(activity,state,runtime){
    if(state.phase==='error')runtime.setCheckButton(Boolean(state.selectedEdge));
    else runtime.setCheckButton(Boolean(state.selectedOption));
  }
  function mount(activity,runtime){
    runtime.rerenderActivity();
    setCheckState(activity,sessionFor(activity),runtime);
  }
  function feedbackButtons(state,task,nextAction,label){
    const buttons=[];
    if(canRevealHint(state,task))buttons.push({action:'kg-hint',label:hintLabel(state,task)});
    buttons.push({action:nextAction,label:label||'继续',primary:true});
    return buttons;
  }
  function showTaskFeedback(state,task,runtime,{correct,title,message,nextAction,label}){
    state.awaitingAction=true;
    state.feedbackTask=task;
    runtime.showFeedback({title,message,kind:correct?'success':'error'});
    runtime.disableActivityControls();
    runtime.setFooterButtons(correct?[{action:nextAction,label:label||'继续',primary:true}]:feedbackButtons(state,task,nextAction,label||'继续'));
  }
  function requeueCurrent(activity,state,task,correct){
    const queue=taskQueue(state,state.phase);
    queue.shift();
    if(correct)completedSet(state,state.phase).add(String(task.id));
    else queue.push(String(task.id));
    ensurePhase(activity,state);
  }
  function submitMissing(activity,state,task,runtime){
    if(!task||!state.selectedOption)return;
    const correct=String(state.selectedOption)===String(task.correctOptionId);
    runtime.recordAttempt(correct);
    if(!correct)incrementWrong(state,taskKey(state,task));
    requeueCurrent(activity,state,task,correct);
    if(correct){
      runtime.updateProgress();
      showTaskFeedback(state,task,runtime,{correct:true,title:'知识点补全正确',message:task.shortExplanation||'缺失知识点已补全。',nextAction:'kg-next',label:state.phase==='relation'?'进入关系判断':'继续'});
    }else{
      showTaskFeedback(state,task,runtime,{correct:false,title:'知识点还不匹配',message:'这项补全任务会进入当前阶段队尾，请根据上下游关系重新判断。',nextAction:'kg-retry',label:'继续'});
    }
  }
  function submitRelation(activity,state,task,runtime){
    if(!task||!state.selectedOption)return;
    const correct=String(state.selectedOption)===String(task.correctOptionId);
    runtime.recordAttempt(correct);
    if(!correct)incrementWrong(state,taskKey(state,task));
    requeueCurrent(activity,state,task,correct);
    if(correct){
      runtime.updateProgress();
      showTaskFeedback(state,task,runtime,{correct:true,title:'关系选择正确',message:task.shortExplanation||'节点关系已经补全。',nextAction:'kg-next',label:state.phase==='error'?'进入错误连接':'继续'});
    }else{
      showTaskFeedback(state,task,runtime,{correct:false,title:'关系还需调整',message:'这项关系任务会进入当前阶段队尾，请重新比较两个节点之间的逻辑。',nextAction:'kg-retry',label:'继续'});
    }
  }
  function submitError(activity,state,task,runtime){
    if(!task||!state.selectedEdge)return;
    const correct=String(state.selectedEdge)===String(task.incorrectEdgeId);
    runtime.recordAttempt(correct);
    if(!correct)incrementWrong(state,taskKey(state,task));
    requeueCurrent(activity,state,task,correct);
    if(correct){
      runtime.updateProgress();
      if(state.phase==='done'){
        runtime.completeActivity(task.shortExplanation||activity.shortExplanation||'你已经完成知识图谱任务。',{recordAttempt:false});
      }else{
        showTaskFeedback(state,task,runtime,{correct:true,title:'错误连接已找到',message:task.shortExplanation||'你已经识别出错误连接。',nextAction:'kg-next',label:'继续'});
      }
    }else{
      showTaskFeedback(state,task,runtime,{correct:false,title:'这条连接本身可以成立',message:'错误连接任务会进入队尾，请寻找会绕过角色、约束或影响评估的关系。',nextAction:'kg-retry',label:'继续'});
    }
  }
  function submit(activity,runtime){
    const state=sessionFor(activity);
    if(state.awaitingAction)return;
    const task=currentTask(activity,state);
    if(state.phase==='missing')submitMissing(activity,state,task,runtime);
    else if(state.phase==='relation')submitRelation(activity,state,task,runtime);
    else submitError(activity,state,task,runtime);
  }
  function revealHint(activity,state,task,runtime){
    if(!task||!canRevealHint(state,task))return false;
    const key=taskKey(state,task);
    const next=revealedHintCount(state,task)+1;
    state.hintRevealed.set(key,next);
    runtime.recordHintUse?.();
    const hint=taskHints(task)[next-1]||'';
    if(state.awaitingAction){
      const message=runtime.feedbackMessage?.();
      if(message&&hint&&!message.textContent.includes(hint))message.textContent=(message.textContent.trim()+' 提示：'+hint).trim();
      runtime.setFooterButtons(feedbackButtons(state,task,'kg-retry','继续'));
    }else mount(activity,runtime);
    return true;
  }
  function handleClick(event,activity,runtime){
    const state=sessionFor(activity);
    const hint=event.target.closest?.('[data-kg-hint]');
    if(hint&&!state.awaitingAction)return revealHint(activity,state,currentTask(activity,state),runtime);
    if(state.awaitingAction)return false;
    const option=event.target.closest?.('[data-kg-option]');
    if(option&&state.phase!=='error'){
      state.selectedOption=String(option.dataset.kgOption||'');
      runtime.root().querySelectorAll('[data-kg-option]').forEach(button=>{
        const selected=button===option;
        button.classList.toggle('is-selected',selected);
        button.setAttribute('aria-pressed',selected?'true':'false');
      });
      runtime.setCheckButton(true);
      return true;
    }
    const edge=event.target.closest?.('[data-kg-error-edge]');
    if(edge&&state.phase==='error'){
      state.selectedEdge=String(edge.dataset.kgErrorEdge||'');
      runtime.root().querySelectorAll('[data-kg-error-edge]').forEach(button=>{
        const selected=button===edge;
        button.classList.toggle('is-selected',selected);
        button.setAttribute('aria-pressed',selected?'true':'false');
      });
      runtime.setCheckButton(true);
      return true;
    }
    return false;
  }
  function handleFooterAction(action,activity,runtime){
    const state=sessionFor(activity);
    if(action==='kg-hint')return revealHint(activity,state,state.feedbackTask||currentTask(activity,state),runtime);
    if(action!=='kg-next'&&action!=='kg-retry')return false;
    runtime.clearFeedback();
    state.awaitingAction=false;
    state.feedbackTask=null;
    state.selectedOption='';
    state.selectedEdge='';
    ensurePhase(activity,state);
    mount(activity,runtime);
    return true;
  }

  registry.register('knowledge_graph',{
    label:'知识图谱',
    mode:'composite',
    isWide:true,
    render,
    prepare(activity){reset(activity);sessionFor(activity)},
    submit,
    handleClick,
    handleFooterAction,
    workUnits:totalUnits,
    completedWorkUnits:completedUnits,
    onMounted(activity,runtime){setCheckState(activity,sessionFor(activity),runtime)},
    dispose(activity){sessions.delete(String(activity?.id||'knowledge-graph'))}
  });
})(window);
