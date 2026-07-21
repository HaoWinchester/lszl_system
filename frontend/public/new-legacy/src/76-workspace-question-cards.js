'use strict';

/*
 * WorkspaceQuestionCards
 * @deprecated since v8.4.28-alpha
 * 旧版“把多题卡混入单题画布”的兼容模块。正式页面已不再加载。
 * 新的多题拖放由 question-workspace.html + MultiQuestionWorkspace 负责。
 */
(function(global){
  const MIME='application/x-kg-question-reference';
  const state={
    initialized:false,
    layer:null,
    viewport:null,
    elements:new Map(),
    dragDepth:0,
    dragLeaveTimer:null,
    activeDragPayload:null
  };
  const byId=id=>document.getElementById(id);

  function store(){return global.KGCanvasWorkspaceStore||null}
  function canvas(){return global.KGInfiniteLearningCanvas||null}
  function navigator(){return global.KGQuestionNavigator||null}
  function escapeHTML(value){
    return String(value??'').replace(/[&<>"']/g,char=>({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[char]));
  }
  function canModify(){
    if(navigator()?.isReadOnlyMobile?.()||canvas()?.getState?.().mobile){
      notify('移动端仅支持查看题目和完成作答。');
      return false;
    }
    try{
      if(typeof authIsLoggedIn==='function'&&!authIsLoggedIn()){
        if(typeof authOpen==='function')authOpen('登录后才能把题目加入跨题工作区。');
        return false;
      }
    }catch(e){}
    return true;
  }
  function notify(message){
    if(typeof showStatus==='function')showStatus(message);
    else console.info(message);
  }
  function statusLabel(node){
    if(node.status==='completed')return {label:'已完成',className:'completed'};
    if(node.status==='in-progress')return {label:'第 '+node.currentStep+' 步',className:'in-progress'};
    return {label:'未开始',className:'not-started'};
  }
  function nodeMarkup(node){
    const status=statusLabel(node);
    const topic=node.topic||'未分类';
    return '<header class="qt-canvas-card-header" data-card-drag-handle>'
      +'<div class="qt-canvas-card-heading">'
        +'<span class="qt-canvas-step-number">题</span>'
        +'<div><small>QUESTION REFERENCE</small><h3>'+escapeHTML(node.title)+'</h3></div>'
      +'</div>'
      +'<span class="qt-canvas-card-status '+status.className+'" data-workspace-status>'+escapeHTML(status.label)+'</span>'
    +'</header>'
    +'<div class="qt-canvas-card-body">'
      +'<div class="qt-question-reference-meta">'
        +'<span>'+escapeHTML(topic)+'</span>'
        +(node.difficulty?'<span>'+escapeHTML(node.difficulty)+'</span>':'')
        +'<span class="'+status.className+'">'+escapeHTML(status.label)+'</span>'
        +'<span>原则 '+Number(node.principleCount||0)+'</span>'
      +'</div>'
      +'<p class="qt-question-reference-stem">'+escapeHTML(node.stemSummary||'打开题目查看完整题干。')+'</p>'
      +'<div class="qt-question-reference-actions">'
        +'<button type="button" class="primary" data-workspace-action="open">进入深学</button>'
        +'<button type="button" data-workspace-action="focus">定位</button>'
        +'<button type="button" class="danger" data-workspace-action="remove" title="从工作区移除">移除</button>'
      +'</div>'
    +'</div>';
  }
  function createElement(node){
    const element=document.createElement('article');
    element.className='qt-canvas-card qt-question-reference-card available';
    element.dataset.canvasCard=node.id;
    element.dataset.cardKind='question-reference';
    element.dataset.workspaceNode=node.id;
    element.dataset.minWidth='300';
    element.dataset.minHeight='190';
    element.dataset.maxWidth='620';
    element.dataset.maxHeight='520';
    element.setAttribute('aria-label','题目引用卡：'+node.title);
    element.innerHTML=nodeMarkup(node);
    return element;
  }
  function renderNode(node){
    let element=state.elements.get(node.id);
    if(!element){
      element=createElement(node);
      state.elements.set(node.id,element);
      state.layer?.appendChild(element);
    }else{
      element.innerHTML=nodeMarkup(node);
      element.setAttribute('aria-label','题目引用卡：'+node.title);
    }
    canvas()?.registerExternalCard?.(element,{
      id:node.id,
      nodeId:node.id,
      kind:'question-reference',
      layout:{x:node.x,y:node.y,width:node.width,height:node.height}
    });
    return element;
  }
  function renderAll(){
    if(!state.layer)return;
    const nodes=store()?.listNodes?.()||[];
    const expected=new Set(nodes.map(node=>node.id));
    [...state.elements].forEach(([id,element])=>{
      if(expected.has(id))return;
      canvas()?.unregisterExternalCard?.(id);
      element.remove?.();
      state.elements.delete(id);
    });
    nodes.forEach(renderNode);
    const count=byId('qtWorkspaceCount');
    if(count)count.textContent=String(nodes.length);
    try{global.dispatchEvent(new CustomEvent('kg:workspace-cards-rendered',{detail:{count:nodes.length}}))}catch(e){}
    return nodes.length;
  }
  function positionForDrop(clientX,clientY){
    const point=canvas()?.clientToWorld?.(clientX,clientY)||canvas()?.defaultWorkspacePosition?.()||{x:600,y:420};
    return {x:point.x-180,y:point.y-80,width:360,height:240};
  }
  function resolveQuestion(payload={}){
    const expectedQuestionId=String(payload.questionId||'');
    const expectedBankId=String(payload.bankId||'');
    const item=navigator()?.getItem?.(Number(payload.index));
    const itemQuestionId=String(item?.question?.id||item?.question?.sourceQuestionId||'');
    const itemBankId=String(item?.bank?.id||item?.question?.sourceBankId||'');
    if(item?.question&&
      (!expectedQuestionId||itemQuestionId===expectedQuestionId)&&
      (!expectedBankId||!itemBankId||itemBankId===expectedBankId)){
      return {
        question:item.question,
        bankId:String(itemBankId||expectedBankId)
      };
    }
    const question=navigator()?.findQuestion?.(expectedQuestionId,expectedBankId);
    if(question?.question)return {
      question:question.question,
      bankId:String(question.bank?.id||expectedBankId||question.question.sourceBankId||'')
    };
    return null;
  }
  function addQuestion(question,bankId='',position={},options={}){
    if(!canModify())return {created:false,error:'LOGIN_REQUIRED'};
    const result=store()?.addQuestionReference?.(question,bankId,position);
    if(!result)return {created:false,error:'STORE_UNAVAILABLE'};
    renderAll();
    const node=result.node;
    if(node&&!canvas()?.getState?.().mobile){
      canvas()?.setMode?.('explore');
      setTimeout(()=>canvas()?.focusCard?.(node.id,{persist:false,zoom:1}),0);
    }
    if(result.created){
      notify('题目已加入跨题工作区。');
    }else if(result.reason==='already-exists'){
      notify('这道题已在工作区中，已为你定位。');
    }
    try{
      global.dispatchEvent(new CustomEvent('kg:workspace-question-added',{
        detail:{created:!!result.created,node:result.node}
      }));
    }catch(e){}
    return result;
  }
  function addFromNavigatorIndex(index,position){
    const item=navigator()?.getItem?.(Number(index));
    if(!item?.question)return {created:false,error:'QUESTION_NOT_FOUND'};
    const nextPosition=position||canvas()?.defaultWorkspacePosition?.()||{x:600,y:420,width:360,height:240};
    return addQuestion(item.question,String(item.bank?.id||item.question.sourceBankId||''),nextPosition);
  }
  function switchToNode(node){
    const success=navigator()?.switchToQuestion?.(node.questionId,node.bankId);
    if(success!==false){
      navigator()?.close?.();
      setTimeout(()=>canvas()?.focusStep?.(1,{persist:false}),0);
    }
    return success;
  }
  function removeNode(nodeId){
    if(!canModify())return false;
    let approved=true;
    try{
      if(typeof global.confirm==='function')approved=global.confirm('从跨题工作区移除这张题目卡？题目和学习记录不会被删除。');
    }catch(e){}
    if(!approved)return false;
    store()?.removeNode?.(nodeId);
    renderAll();
    notify('题目卡已从工作区移除。');
    return true;
  }
  function handleCardClick(event){
    const card=event.target.closest?.('[data-workspace-node]');
    if(!card||!state.layer?.contains(card))return;
    const nodeId=String(card.dataset.workspaceNode||'');
    const node=(store()?.listNodes?.()||[]).find(item=>item.id===nodeId);
    if(!node)return;
    const action=event.target.closest?.('[data-workspace-action]')?.dataset.workspaceAction;
    if(action==='open'){
      event.stopPropagation();
      switchToNode(node);
      return;
    }
    if(action==='remove'){
      event.stopPropagation();
      removeNode(nodeId);
      return;
    }
    if(action==='focus'){
      event.stopPropagation();
      canvas()?.focusCard?.(nodeId,{persist:false});
      return;
    }
    if(canvas()?.getState?.().mode==='explore'){
      canvas()?.selectPathCard?.(nodeId);
    }
  }
  function showDropIndicator(show){
    const indicator=byId('qtWorkspaceDropIndicator');
    if(indicator)indicator.hidden=!show;
    state.viewport?.classList.toggle('is-question-drag-over',!!show);
  }
  function dragTypes(event){
    return [...(event.dataTransfer?.types||[])].map(type=>String(type).toLowerCase());
  }
  function acceptsDrag(event){
    if(navigator()?.isReadOnlyMobile?.()||canvas()?.getState?.().mobile)return false;
    if(state.activeDragPayload||navigator()?.getDraggingPayload?.())return true;
    const types=dragTypes(event);
    return types.includes(MIME.toLowerCase())||
      types.includes('text/x-kg-question-reference');
  }
  function parseDragPayload(event){
    const transfer=event.dataTransfer;
    const candidates=[];
    if(transfer){
      for(const type of [MIME,'text/x-kg-question-reference','text/plain']){
        try{
          const value=transfer.getData(type);
          if(value)candidates.push(value);
        }catch(e){}
      }
    }
    for(const raw of candidates){
      try{
        const parsed=JSON.parse(raw);
        if(parsed&&parsed.questionId)return parsed;
      }catch(e){}
    }
    return state.activeDragPayload||
      navigator()?.getDraggingPayload?.()||
      null;
  }
  function handleDragEnter(event){
    if(!acceptsDrag(event))return;
    event.preventDefault();
    clearTimeout(state.dragLeaveTimer);
    state.dragDepth+=1;
    showDropIndicator(true);
  }
  function handleDragOver(event){
    if(!acceptsDrag(event))return;
    event.preventDefault();
    clearTimeout(state.dragLeaveTimer);
    if(event.dataTransfer)event.dataTransfer.dropEffect='copy';
    showDropIndicator(true);
  }
  function handleDragLeave(event){
    if(!acceptsDrag(event))return;
    state.dragDepth=Math.max(0,state.dragDepth-1);
    const related=event.relatedTarget;
    if(related&&state.viewport?.contains?.(related))return;
    clearTimeout(state.dragLeaveTimer);
    state.dragLeaveTimer=setTimeout(()=>{
      if(state.dragDepth===0)showDropIndicator(false);
    },50);
  }
  function handleDrop(event){
    if(!acceptsDrag(event))return;
    if(event.target.closest?.('.qt-question-drawer,.qt-canvas-toolbar'))return;
    event.preventDefault();
    event.stopPropagation();
    clearTimeout(state.dragLeaveTimer);
    state.dragDepth=0;
    showDropIndicator(false);
    const payload=parseDragPayload(event);
    state.activeDragPayload=null;
    navigator()?.clearDraggingPayload?.();
    if(!payload){
      notify('未能读取拖拽题目，请使用题目右侧的“+”按钮重试。');
      return;
    }
    const resolved=resolveQuestion(payload);
    if(!resolved){
      notify('未能定位这道题，请重新打开题目坞后再拖动。');
      return;
    }
    addQuestion(resolved.question,resolved.bankId,positionForDrop(event.clientX,event.clientY),{source:'drop'});
  }
  function handleQuestionDragStart(event){
    state.activeDragPayload=event?.detail?{...event.detail}:navigator()?.getDraggingPayload?.()||null;
    clearTimeout(state.dragLeaveTimer);
  }
  function handleQuestionDragEnd(){
    clearTimeout(state.dragLeaveTimer);
    state.dragLeaveTimer=setTimeout(()=>{
      state.activeDragPayload=null;
      state.dragDepth=0;
      showDropIndicator(false);
    },120);
  }
  function refreshProgress(event){
    const questionId=event?.detail?.session?.questionId;
    if(questionId)store()?.refreshQuestionProgress?.(questionId);
    renderAll();
  }
  function bind(){
    if(state.initialized)return;
    state.layer=byId('qtWorkspaceNodeLayer');
    state.viewport=byId('qtCanvasViewport');
    if(!state.layer||!state.viewport)return;
    state.initialized=true;
    state.layer.addEventListener('click',handleCardClick);
    state.viewport.addEventListener('dragenter',handleDragEnter,true);
    state.viewport.addEventListener('dragover',handleDragOver,true);
    state.viewport.addEventListener('dragleave',handleDragLeave,true);
    state.viewport.addEventListener('drop',handleDrop,true);
    global.addEventListener('kg:question-drag-start',handleQuestionDragStart);
    global.addEventListener('kg:question-drag-end',handleQuestionDragEnd);
    global.addEventListener('kg:workspace-changed',renderAll);
    global.addEventListener('kg:learning-session-updated',refreshProgress);
    global.addEventListener('kg:learning-session-changed',refreshProgress);
    renderAll();
  }

  const api=Object.freeze({
    MIME,
    bind,
    renderAll,
    addQuestion,
    addFromNavigatorIndex,
    removeNode,
    acceptsDrag,
    getActiveDragPayload:()=>state.activeDragPayload?{...state.activeDragPayload}:null,
    getNodes:()=>store()?.listNodes?.()||[]
  });
  global.KGWorkspaceQuestionCards=api;

  document.addEventListener('DOMContentLoaded',()=>setTimeout(bind,0));
  global.addEventListener('kg:canvas-ready',bind);
})(window);
