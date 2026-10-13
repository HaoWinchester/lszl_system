/* Card-scoped practice: the server alone authorizes content and grades answers. */
(function(global){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const path=context=>'/api/v1/graph-questions/files/'+encodeURIComponent(context.fileId)+'/nodes/'+encodeURIComponent(context.nodeId)+'/bindings';
  function create({surface=document.body,role=()=>global.KGAuthCore?.currentUser?.()?.role,getContext=()=>global.KGGraphFileEditorStoreBridge?.fragmentSource?.(),flush=()=>global.KGGraphFileRemoteAdapter?.flush?.(),onRevision=(id,revision)=>global.KGGraphFileRemoteAdapter?.acceptRevision?.(id,revision)}={}){
    const panel=document.createElement('aside');panel.className='graph-question-drawer';panel.hidden=true;panel.setAttribute('aria-label','卡片做题');panel.setAttribute('data-stage-ui','');surface.append(panel);
    const unmount=global.KGCanvasDomInteraction.mountOverlay(panel,surface);
    let epoch=0,context=null,abort=null,searchAbort=null,bindings=[],selected=new Set(),results=[],page=1,total=0,query='',subject='',searching=false,busy=false,fsEntered=false;
    const editor=()=>['admin','teacher'].includes(role());
    function cancel(){epoch++;abort?.abort();searchAbort?.abort();abort=new AbortController();}
    async function request(url,options={},signal=abort.signal){const response=await global.fetch(url,{...options,signal,credentials:'include',headers:options.body?{'Content-Type':'application/json'}:undefined,body:options.body?JSON.stringify(options.body):undefined});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:data.detail?.message||'请求失败（'+response.status+'）');return data;}
    function status(message){panel.querySelector('[data-status]').textContent=message;}
    // —— 全屏做题：请求 document.body 全屏（抽屉经 mountOverlay 跟随进入全屏宿主），
    //    配合 .is-fullscreen 样式改为居中限宽排版；Esc/再点退出，作答状态不重建所以保留。 ——
    const fsDocument=()=>panel.ownerDocument;
    const fsActive=()=>{const doc=fsDocument();return !!(doc.fullscreenElement||doc.webkitFullscreenElement)};
    function syncFullscreenButton(){
      const button=panel.querySelector('[data-fullscreen]');if(!button)return;
      const on=fsActive()||panel.classList.contains('gqd-fs-fallback');
      button.textContent=on?'退出全屏':'全屏';
      button.setAttribute('aria-pressed',on?'true':'false');
      panel.classList.toggle('is-fullscreen',on);
    }
    function exitFullscreen(){
      const doc=fsDocument();
      if(fsActive()){(doc.exitFullscreen||doc.webkitExitFullscreen||(()=>{})).call(doc);return true}
      if(panel.classList.contains('gqd-fs-fallback')){panel.classList.remove('gqd-fs-fallback');syncFullscreenButton();return true}
      return false;
    }
    async function toggleFullscreen(){
      if(exitFullscreen()){fsEntered=false;return}
      const target=fsDocument().body,request=target.requestFullscreen||target.webkitRequestFullscreen;
      if(!request){panel.classList.add('gqd-fs-fallback');fsEntered=true;syncFullscreenButton();return}
      try{await request.call(target);fsEntered=true}catch(error){status('进入全屏失败：'+error.message)}
    }
    function onFullscreenChange(){if(!fsActive())fsEntered=false;syncFullscreenButton()}
    fsDocument().addEventListener('fullscreenchange',onFullscreenChange);
    fsDocument().addEventListener('webkitfullscreenchange',onFullscreenChange);
    function shell(){
      panel.innerHTML=`<header><strong>${esc(context.title)} · 做题</strong><span class="gqd-header-actions"><button type="button" data-fullscreen aria-pressed="false" aria-label="全屏做题">全屏</button><button type="button" data-close aria-label="关闭做题抽屉">关闭</button></span></header><div class="gqd-scroll"><p data-status role="status" aria-live="polite"></p><div data-content></div></div>`;
      panel.querySelector('[data-close]').onclick=close;
      panel.querySelector('[data-fullscreen]').onclick=toggleFullscreen;
      panel.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape'){if(fsActive()){exitFullscreen();fsEntered=false;return}if(exitFullscreen())return;close();}};
      panel.onpointerdown=e=>e.stopPropagation();
      syncFullscreenButton();
    }
    function close(){cancel();if(fsEntered){exitFullscreen();fsEntered=false}context=null;panel.hidden=true;}
    function draw(){
      const body=panel.querySelector('[data-content]');body.innerHTML=`${editor()?'<button type="button" data-add>搜索并添加题目</button>':''}<div data-search></div><div data-questions></div>`;
      body.querySelector('[data-add]')?.addEventListener('click',()=>{searching=!searching;searchAbort?.abort();if(!searching){results=[];total=0;}drawSearch();});
      const list=body.querySelector('[data-questions]');if(!bindings.length)list.innerHTML='<p>暂无关联题目</p>';
      bindings.forEach(binding=>{
        const q=binding.question,card=document.createElement('section');card.className='gqd-question';card.dataset.bindingId=binding.id;
        card.innerHTML=`<h3>${esc(q.title||'题目')}</h3><div class="qm-text">${(q.stemParts||[]).map(p=>esc(p.text)).join('')}</div>${global.KGQuestionMaterials.renderMaterials(q)}<div data-answer></div><button type="button" data-submit>提交答案</button>${editor()?'<button type="button" data-remove>移除关联</button>':''}<div data-feedback role="status"></div>`;list.append(card);global.KGQuestionMaterials.bindMedia(card);
        let pairs={},ids=[],snapshot=null,savedAttempt=null,pending=false,submitted=false;
        const answer=card.querySelector('[data-answer]');if(q.type==='matching')global.KGQuestionMaterials.bind(answer,{question:q,onChange:value=>{if(!snapshot)pairs=value;}});
        else {answer.innerHTML=(q.options||[]).map(o=>`<label class="gqd-option"><input type="${q.type==='multiple_choice'?'checkbox':'radio'}" name="gqd-${esc(binding.id)}" value="${esc(o.id)}">${esc(o.id)}. ${esc(o.text)}</label>`).join('');answer.onchange=()=>{if(!snapshot)ids=global.KGQuestionAnswerSet.normalizeIds([...answer.querySelectorAll('input:checked')].map(i=>i.value),global.KGQuestionAnswerSet.optionIds(q));};}
        card.querySelector('[data-submit]').onclick=async()=>{
          if(submitted||pending)return;const feedback=card.querySelector('[data-feedback]'),token=epoch,button=card.querySelector('[data-submit]');if(q.type==='matching'?!global.KGQuestionAnswerSet.pairs(q,pairs,true):!ids.length){feedback.textContent='请完成作答后提交。';return;}
          snapshot=snapshot||JSON.parse(JSON.stringify({sourceVersion:binding.sourceVersion,requestId:global.crypto.randomUUID(),...(q.type==='matching'?{selectedPairs:pairs}:{selectedOptionIds:ids})}));
          Object.freeze(snapshot.selectedPairs||snapshot.selectedOptionIds);Object.freeze(snapshot);
          pending=true;button.disabled=true;feedback.textContent=savedAttempt?'正在读取解析…':'正在提交…';
          if(q.type==='matching')global.KGQuestionMaterials.bind(answer,{question:q,selectedPairs:snapshot.selectedPairs,readOnly:true});
          else answer.querySelectorAll('input,button,select,textarea').forEach(i=>{if(i.tagName==='INPUT')i.checked=snapshot.selectedOptionIds.includes(i.value);i.disabled=true;});
          try{if(!savedAttempt){const data=await request(path(context)+'/'+encodeURIComponent(binding.id)+'/attempts',{method:'POST',body:snapshot});if(token!==epoch)return;savedAttempt=data.attempt;}
            feedback.textContent=savedAttempt.correct?'回答正确':'回答错误';
            const history=await request('/api/v1/graph-questions/attempts/'+encodeURIComponent(savedAttempt.id)+'/analysis');if(token!==epoch)return;
            if(q.type==='matching')global.KGQuestionMaterials.bind(answer,{question:history.question,selectedPairs:snapshot.selectedPairs,readOnly:true,reveal:true});
            submitted=true;button.textContent='已提交';
            const sections=global.KGQuestionAnalysis.sections(history.question);feedback.innerHTML+=`<div class="gqd-analysis"><h4>解析</h4><p class="qm-text">${esc(history.analysis||'暂无文字解析')}</p><p>正确答案：${esc(global.KGQuestionAnswerSet.answerText(history.question,history.question.type==='matching'?history.question.matching?.correctPairs:global.KGQuestionAnswerSet.correctIds(history.question)))}</p>${sections.concepts.map(c=>`<p>${esc(c.title)}：${esc(c.rule)}</p>`).join('')}${sections.traps.map(o=>`<p>${esc(o.id)}：${esc(o.trap)}</p>`).join('')}</div>`;
          }catch(error){if(token===epoch&&error.name!=='AbortError'){feedback.textContent=(savedAttempt?'作答已保存，解析加载失败：':'提交失败，请重试当前答案：')+error.message;button.textContent=savedAttempt?'重试读取作答结果':'重试提交当前答案';}}finally{if(token===epoch){pending=false;button.disabled=submitted;}}
        };
        card.querySelector('[data-remove]')?.addEventListener('click',()=>{if(global.confirm('确定移除这道关联题目？'))save(bindings.filter(b=>b.id!==binding.id).map(b=>b.questionId));});
      });drawSearch();
    }
    function drawSearch(){
      const box=panel.querySelector('[data-search]');if(!box)return;box.innerHTML='';if(!editor()||!searching)return;
      box.innerHTML=`<form><label>标题／关键词<input name="q" maxlength="200" value="${esc(query)}"></label><label>学科<input name="subject" maxlength="32" placeholder="全部学科" value="${esc(subject)}"></label><button>搜索</button></form><div data-keywords>${context.keywords.map(k=>`<button type="button" data-keyword="${esc(k)}">${esc(k)}</button>`).join('')}</div><p data-search-status role="status"></p><div data-results></div><div class="gqd-pagination"><button type="button" data-prev ${page===1?'disabled':''}>上一页</button><span>第 ${page} 页 · ${total} 条</span><button type="button" data-next ${page*20>=total?'disabled':''}>下一页</button></div><button type="button" data-confirm ${busy?'disabled':''}>确认关联（${selected.size}）</button>`;
      box.querySelector('form').onsubmit=e=>{e.preventDefault();query=e.target.q.value;subject=e.target.subject.value;page=1;search();};box.querySelectorAll('[data-keyword]').forEach(b=>b.onclick=()=>{query=[query,b.dataset.keyword].filter(Boolean).join(' ').slice(0,200);page=1;drawSearch();search();});
      const target=box.querySelector('[data-results]');results.forEach(q=>{const linked=bindings.some(b=>b.questionId===q.id)||q.alreadyLinked;const row=document.createElement('label');row.className='gqd-option';row.innerHTML=`<input type="checkbox" value="${esc(q.id)}" ${linked||selected.has(q.id)?'checked':''} ${linked?'disabled':''}>${esc(q.title)} · ${esc(q.subject||'')} · ${esc(q.type||'')} ${linked?'（已关联）':''}<small>${esc(q.bankName||'')} ${esc(q.stem||'')}</small>`;target.append(row);row.querySelector('input').onchange=e=>{if(e.target.checked)selected.add(q.id);else selected.delete(q.id);box.querySelector('[data-confirm]').textContent='确认关联（'+selected.size+'）';};});
      box.querySelector('[data-prev]').onclick=()=>{page--;search();};box.querySelector('[data-next]').onclick=()=>{page++;search();};box.querySelector('[data-confirm]').onclick=()=>save([...new Set([...bindings.map(b=>b.questionId),...selected])]);
    }
    async function search(){if(!searching)return;searchAbort?.abort();searchAbort=new AbortController();const signal=searchAbort.signal,token=epoch;results=[];drawSearch();panel.querySelector('[data-search-status]').textContent='正在搜索…';try{const data=await request('/api/v1/graph-questions/search?'+new URLSearchParams({fileId:context.fileId,nodeId:context.nodeId,q:query,subject,page}),{},signal);if(token!==epoch||signal.aborted||!searching)return;results=data.questions;total=data.total;drawSearch();const target=panel.querySelector('[data-search-status]');if(target)target.textContent=results.length?'':'未找到匹配题目';}catch(error){if(token===epoch&&!signal.aborted&&searching){const target=panel.querySelector('[data-search-status]');if(target)target.textContent='搜索失败：'+error.message;}}}
    async function save(questionIds){if(busy)return;busy=true;const token=epoch,captured=context;status('正在保存关联…');try{await flush();if(token!==epoch)return;const latest=getContext();if(latest?.fileId!==captured.fileId)throw new Error('当前图谱已切换，请重新打开。');const data=await request(path(captured),{method:'PUT',body:{expectedFileRevision:latest.revision,questionIds}});if(token!==epoch)return;onRevision(captured.fileId,data.fileRevision);bindings=data.bindings;selected.clear();results=[];draw();status('关联已保存');}catch(error){if(token===epoch&&error.name!=='AbortError')status('关联保存失败：'+error.message);}finally{if(token===epoch){busy=false;const confirm=panel.querySelector('[data-confirm]');if(confirm)confirm.disabled=false;}}}
    async function open(node){cancel();const current=getContext();if(!current?.fileId){close();return false;}context={fileId:current.fileId,nodeId:node.id,title:node.title||node.content?.title||'知识卡片',keywords:String(node.keywords||'').split(/[，,、;；\s]+/).filter(Boolean)};busy=false;bindings=[];results=[];selected.clear();page=1;total=0;query=context.title;subject='';searching=false;panel.hidden=false;shell();status('正在加载关联题目…');panel.querySelector('[data-close]').focus();const token=epoch;try{const data=await request(path(context));if(token!==epoch)return false;bindings=data.bindings;draw();status('');return true;}catch(error){if(token===epoch&&error.name!=='AbortError'){status('关联题目加载失败：'+error.message);panel.querySelector('[data-content]').innerHTML='<button type="button" data-retry>重试加载</button>';panel.querySelector('[data-retry]').onclick=()=>open(node);}return false;}}
    function switched(){close();}
    global.addEventListener('kg-graph-file-transition',switched);global.addEventListener('kg-graph-current-file-change',switched);global.addEventListener('kg-auth-session-change',switched);
    return {open,close,syncNode(nodeId){if(context&&context.nodeId!==nodeId)close();},destroy(){close();unmount();panel.remove();fsDocument().removeEventListener('fullscreenchange',onFullscreenChange);fsDocument().removeEventListener('webkitfullscreenchange',onFullscreenChange);global.removeEventListener('kg-graph-file-transition',switched);global.removeEventListener('kg-graph-current-file-change',switched);global.removeEventListener('kg-auth-session-change',switched);}};
  }
  global.KGGraphQuestionDrawer={create};
})(typeof window!=='undefined'?window:globalThis);
