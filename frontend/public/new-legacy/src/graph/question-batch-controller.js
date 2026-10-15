/* Existing-question matching: previews are read-only; confirmation is server-authorized. */
(function(global){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function create({getContext,getNodes,getSelectedIds,flush,onRevision=(id,revision)=>global.KGGraphFileRemoteAdapter?.acceptRevision?.(id,revision)}){
    const backdrop=document.createElement('div');backdrop.className='graph-question-batch-backdrop';backdrop.hidden=true;backdrop.dataset.stageUi='true';
    backdrop.innerHTML=`<section class="graph-question-batch" role="dialog" aria-modal="true" aria-label="批量添加题目"><header><div><h2>批量添加题目</h2><p>从现有题库匹配，保留已有题目，跳过重复关联。</p></div><button type="button" data-batch-close aria-label="关闭批量配题">×</button></header><div class="gqb-scroll"><div class="gqb-settings"><label>卡片范围<select data-batch-scope aria-label="卡片范围"><option value="all">全部卡片</option><option value="selected">画布已选卡片</option><option value="custom">手动勾选</option></select></label><label>每张卡片新增题数<input data-batch-count aria-label="每张卡片新增题数" type="number" min="1" max="100" value="3" step="1"></label></div><div class="gqb-filter"><label>搜索知识卡片<input data-batch-search aria-label="搜索知识卡片" type="search" placeholder="按标题或关键词搜索" autocomplete="off"></label><button type="button" data-batch-all>全选当前列表</button><button type="button" data-batch-clear>清空选择</button></div><p data-batch-selected></p><div class="gqb-card-list" data-batch-nodes></div><p class="gqb-help">每张卡片最多关联100题；匹配不足时只添加相关题目。单次最多选择500张卡片、新增2000道关联。</p><div data-batch-preview hidden></div></div><footer><p data-batch-status role="status" aria-live="polite"></p><div><button type="button" data-batch-run>预览匹配</button><button type="button" data-batch-confirm hidden>确认添加（0）</button></div></footer></section>`;
    document.body.append(backdrop);const unmount=global.KGCanvasDomInteraction.mountOverlay(backdrop);
    const $=selector=>backdrop.querySelector(selector),scope=$('[data-batch-scope]'),count=$('[data-batch-count]'),search=$('[data-batch-search]'),list=$('[data-batch-nodes]'),previewEl=$('[data-batch-preview]'),run=$('[data-batch-run]'),confirm=$('[data-batch-confirm]'),closer=$('[data-batch-close]');
    let context=null,nodes=[],selected=new Set(),preview=null,choices=new Map(),epoch=0,abort=null,busy='',lastFocus=null;
    const role=()=>global.KGRolePermissions?.currentRole?.()||global.KGAuthCore?.currentUser?.()?.role;
    const allowed=()=>['admin','teacher'].includes(role())&&!document.body.classList.contains('auth-readonly')&&global.KGHomeInteractionModes?.getMode?.()!=='reading';
    function status(message){$('[data-batch-status]').textContent=message;}
    function validCount(){const value=Number(count.value);return count.value.trim()!==''&&Number.isInteger(value)&&value>=1&&value<=100;}
    function totalChoices(){return [...choices.values()].reduce((total,ids)=>total+ids.size,0);}
    function controls(){
      backdrop.querySelectorAll('input,select,button').forEach(el=>{el.disabled=!!busy});closer.disabled=busy==='apply';
      run.disabled=!!busy||!validCount()||!selected.size||selected.size>500;
      confirm.disabled=!!busy||!preview||totalChoices()===0;
      confirm.textContent='确认添加（'+totalChoices()+'）';
      $('[data-batch-selected]').textContent='已选择 '+selected.size+' / '+nodes.length+' 张卡片';
    }
    function invalidate(){preview=null;choices.clear();previewEl.replaceChildren();previewEl.hidden=true;confirm.hidden=true;status('');controls();}
    function visibleNodes(){const term=search.value.trim().toLocaleLowerCase();return nodes.filter(n=>!term||(n.title+' '+n.keywords).toLocaleLowerCase().includes(term));}
    function drawNodes(){
      const visible=visibleNodes();list.innerHTML=visible.length?visible.map(n=>`<label data-batch-node="${esc(n.id)}"><input type="checkbox" value="${esc(n.id)}" ${selected.has(n.id)?'checked':''}><span>${esc(n.title)}</span></label>`).join(''):'<p>没有找到知识卡片</p>';
      list.querySelectorAll('input').forEach(input=>input.onchange=()=>{if(input.checked)selected.add(input.value);else selected.delete(input.value);scope.value='custom';invalidate();});controls();
    }
    function chooseScope(){selected=new Set(scope.value==='all'?nodes.map(n=>n.id):scope.value==='selected'?(getSelectedIds()||[]).filter(id=>nodes.some(n=>n.id===id)):[]);invalidate();drawNodes();}
    function drawPreview(){
      choices=new Map(preview.cards.map(card=>[card.nodeId,new Set(card.questions.map(q=>q.id))]));
      previewEl.hidden=false;confirm.hidden=false;
      previewEl.innerHTML='<h3>匹配预览</h3>'+preview.cards.map(card=>`<article data-batch-preview-card="${esc(card.nodeId)}"><h4>${esc(card.title)} <small>已有 ${card.existingCount} 题 · 匹配 ${card.questions.length} / ${card.requestedCount} 题</small></h4>${card.questions.map(q=>`<label class="gqb-question"><input type="checkbox" value="${esc(q.id)}" checked><span><strong>${esc(q.title)}</strong><small>${esc(q.bankName)} · ${esc(q.matchReason)}</small><span>${esc(q.stem)}</span></span></label>`).join('')}${card.shortfall?`<p class="gqb-shortfall">${card.questions.length?'相关题量不足，少于设置数量。':'未找到可新增的匹配题目，或该卡片已满。'}</p>`:''}</article>`).join('');
      previewEl.querySelectorAll('[data-batch-preview-card]').forEach(card=>card.querySelectorAll('input').forEach(input=>input.onchange=()=>{const ids=choices.get(card.dataset.batchPreviewCard);if(input.checked)ids.add(input.value);else ids.delete(input.value);controls();}));controls();
    }
    async function request(url,body,signal){
      const response=await global.fetch(url,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});const data=await response.json().catch(()=>({}));
      if(!response.ok){const detail=data.detail;const messages={GRAPH_FILE_REVISION_CONFLICT:'图谱已更新，请刷新图谱后重新匹配。',GRAPH_NODE_NOT_FOUND:'部分卡片已不存在，请刷新图谱后重新选择。',GRAPH_QUESTION_EDITOR_REQUIRED:'当前账号没有批量配题权限。'};throw new Error(typeof detail==='string'?detail:detail?.message||messages[detail?.code]||'请求失败，请重试（'+response.status+'）。');}return data;
    }
    async function match(){
      if(busy||run.disabled)return;invalidate();busy='preview';abort?.abort();abort=new AbortController();const token=++epoch,signal=abort.signal,captured=context;controls();status('正在匹配题目…');
      try{await flush();if(token!==epoch)return;const latest=getContext();if(!allowed()||latest?.fileId!==captured.fileId)throw new Error('当前图谱或账号已变化，请重新打开。');
        const data=await request('/api/v1/graph-questions/files/'+encodeURIComponent(captured.fileId)+'/batch-preview',{expectedFileRevision:latest.revision,nodeIds:[...selected],countPerCard:Number(count.value)},signal);if(token!==epoch)return;preview=data;drawPreview();status('已匹配 '+totalChoices()+' 道题目，请核对后确认添加。');
      }catch(error){if(token===epoch&&error.name!=='AbortError')status('匹配失败：'+error.message);}finally{if(token===epoch){busy='';controls();}}
    }
    async function apply(){
      if(busy||!preview||!totalChoices())return;const latest=getContext();if(!allowed()||latest?.fileId!==context.fileId||latest.revision!==preview.fileRevision){invalidate();status('图谱已变化，请重新匹配。');return;}
      busy='apply';const token=++epoch,captured=context;abort?.abort();abort=new AbortController();controls();status('正在添加题目…');
      try{const data=await request('/api/v1/graph-questions/files/'+encodeURIComponent(captured.fileId)+'/batch-apply',{previewToken:preview.previewToken,selections:[...choices].map(([nodeId,ids])=>({nodeId,questionIds:[...ids]}))},abort.signal);if(token!==epoch)return;onRevision(captured.fileId,data.fileRevision);preview=null;choices.clear();status('已添加 '+data.addedCount+' 道题目，可从知识卡片的“做题”中查看。');
      }catch(error){if(token===epoch&&error.name!=='AbortError'){invalidate();status('添加失败：'+error.message);}}finally{if(token===epoch){busy='';controls();}}
    }
    function close(force=false){if(busy==='apply'&&!force){status('正在保存，请稍候。');return;}epoch++;abort?.abort();abort=null;busy='';preview=null;choices.clear();backdrop.hidden=true;document.body.classList.remove('graph-question-batch-open');context=null;if(lastFocus?.isConnected)lastFocus.focus();}
    function open(){
      const current=getContext();if(!allowed()||!current?.fileId)return false;
      close(true);lastFocus=document.activeElement;context={fileId:current.fileId};nodes=(getNodes()||[]).filter(n=>n?.id).map(n=>({id:n.id,title:n.content?.title||n.title||'未命名卡片',keywords:String(n.content?.keywords||n.keywords||'')}));count.value='3';search.value='';scope.value=(getSelectedIds()||[]).length?'selected':'all';chooseScope();backdrop.hidden=false;document.body.classList.add('graph-question-batch-open');closer.focus();return true;
    }
    run.onclick=match;confirm.onclick=apply;closer.onclick=()=>close();scope.onchange=chooseScope;count.oninput=invalidate;search.oninput=()=>{invalidate();drawNodes();};
    $('[data-batch-all]').onclick=()=>{visibleNodes().forEach(n=>selected.add(n.id));scope.value='custom';invalidate();drawNodes();};$('[data-batch-clear]').onclick=()=>{selected.clear();scope.value='custom';invalidate();drawNodes();};
    const key=e=>{if(backdrop.hidden)return;if(e.key==='Escape'){e.preventDefault();close();}else if(e.key==='Tab'){const elements=[...backdrop.querySelectorAll('button,input,select')].filter(el=>!el.disabled&&el.getClientRects().length);const first=elements[0],last=elements.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}e.stopImmediatePropagation();};
    global.addEventListener('keydown',key,true);backdrop.addEventListener('pointerdown',e=>e.stopPropagation());
    const switched=()=>close(true);for(const event of ['kg-graph-file-transition','kg-graph-current-file-change','kg-auth-session-change','kg-home-interaction-mode-change'])global.addEventListener(event,switched);
    return {open,close,destroy(){close(true);unmount();backdrop.remove();global.removeEventListener('keydown',key,true);for(const event of ['kg-graph-file-transition','kg-graph-current-file-change','kg-auth-session-change','kg-home-interaction-mode-change'])global.removeEventListener(event,switched);}};
  }
  global.KGGraphQuestionBatch=Object.freeze({create});
})(window);
