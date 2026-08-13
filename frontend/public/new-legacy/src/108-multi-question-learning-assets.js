'use strict';

;(function(global){
  const Personal=global.KGPersonalSynthesisCardApi||{};
  const Practice=global.KGPracticeLearningApi||{};
  const state={personalFilter:'active',mistakeFilter:'active',personalQuery:'',mistakeQuery:'',personal:null,practice:null,editing:null,lastFocus:null};
  const byId=id=>document.getElementById(id);
  const clone=value=>{try{return JSON.parse(JSON.stringify(value))}catch(error){return value}};
  const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const tags=value=>[...new Set(String(value||'').split(/[，,、;；\n]/).map(item=>item.trim()).filter(Boolean))].slice(0,24);
  function cardsSnapshot(){return state.personal||Personal.snapshot?.()||{active:[],archived:[]}}
  function practiceSnapshot(){return state.practice||Practice.snapshot?.()||{mistakes:[],stats:{}}}
  function setExpanded(id,expanded){const button=byId(id);if(button)button.setAttribute('aria-expanded',expanded?'true':'false')}
  function closeDrawers({restoreFocus=true}={}){
    for(const id of ['qwPersonalCardsDrawer','qwMistakesDrawer']){const element=byId(id);if(element)element.hidden=true}
    const backdrop=byId('qwLearningAssetsBackdrop');if(backdrop)backdrop.hidden=true;
    setExpanded('qwPersonalCardsBtn',false);setExpanded('qwMistakesBtn',false);
    if(restoreFocus)state.lastFocus?.focus?.();
  }
  function openDrawer(kind){
    closeEditor();
    const personal=kind==='personal';
    state.lastFocus=document.activeElement;
    byId('qwPersonalCardsDrawer').hidden=!personal;
    byId('qwMistakesDrawer').hidden=personal;
    byId('qwLearningAssetsBackdrop').hidden=false;
    setExpanded('qwPersonalCardsBtn',personal);setExpanded('qwMistakesBtn',!personal);
    if(personal){renderPersonal();byId('qwPersonalCardsSearch')?.focus?.()}else{renderMistakes();byId('qwMistakesSearch')?.focus?.()}
  }
  function showError(kind,error){
    const element=byId(kind==='personal'?'qwPersonalCardsError':'qwMistakesError');
    if(element){element.hidden=false;element.querySelector('span').textContent=String(error?.message||'加载失败，请重试')}
  }
  function updateCounts(){
    const cards=cardsSnapshot(),practice=practiceSnapshot();
    const activeMistakes=(practice.mistakes||[]).filter(row=>row.status!=='mastered').length;
    if(byId('qwPersonalCardsCount'))byId('qwPersonalCardsCount').textContent=String((cards.active||[]).length);
    if(byId('qwMistakesCount'))byId('qwMistakesCount').textContent=String(activeMistakes);
  }
  function personalRows(){
    const list=state.personalFilter==='archived'?cardsSnapshot().archived:cardsSnapshot().active;
    const query=state.personalQuery.trim().toLowerCase();
    return (list||[]).filter(card=>!query||[card.title,card.content,...(card.tags||[])].join(' ').toLowerCase().includes(query));
  }
  function renderPersonal(){
    const list=byId('qwPersonalCardsList');if(!list)return;
    byId('qwPersonalCardsError').hidden=true;
    const rows=personalRows(),archived=state.personalFilter==='archived';
    list.innerHTML=rows.length?rows.map(card=>'<article class="qw-learning-asset-card" data-card-id="'+escapeHTML(card.id)+'"><header><span>'+escapeHTML(({principle:'原则',routine:'套路',trap:'陷阱',note:'笔记'}[card.synthesisType]||'归纳'))+'</span><strong>'+escapeHTML(card.title||'未命名归纳卡')+'</strong></header><p>'+escapeHTML(card.content||'暂无正文')+'</p><small>'+escapeHTML((card.tags||[]).join(' · '))+'</small><footer>'
      +(archived?'<button type="button" data-card-action="restore">恢复</button>':'<button type="button" data-card-action="insert">放入当前画布</button><button type="button" data-card-action="edit">编辑</button><button type="button" data-card-action="archive">归档</button>')
      +'</footer></article>').join(''):'<div class="qw-learning-assets-empty">'+(archived?'还没有已归档的归纳卡':'还没有个人归纳卡；可在画布中新建。')+'</div>';
    updateCounts();
  }
  function mistakeRows(){
    const mastered=state.mistakeFilter==='mastered',query=state.mistakeQuery.trim().toLowerCase();
    return (practiceSnapshot().mistakes||[]).filter(row=>(row.status==='mastered')===mastered).filter(row=>{
      const snapshot=row.questionSnapshot||{};return !query||[snapshot.title,snapshot.stem,row.paperName,...(snapshot.tags||[])].join(' ').toLowerCase().includes(query);
    });
  }
  function renderMistakes(){
    const list=byId('qwMistakesList');if(!list)return;
    byId('qwMistakesError').hidden=true;
    const rows=mistakeRows(),mastered=state.mistakeFilter==='mastered';
    list.innerHTML=rows.length?rows.map(row=>{const question=row.questionSnapshot||{};return '<article class="qw-learning-asset-card qw-mistake-card" data-mistake-id="'+escapeHTML(row.id)+'"><header><span>'+(mastered?'已掌握':'待掌握')+'</span><strong>'+escapeHTML(question.title||question.stem||'未命名错题')+'</strong></header><p>累计答错 '+Number(row.wrongCount||0)+' 次'+(row.paperName?' · '+escapeHTML(row.paperName):'')+'</p><footer><button type="button" data-mistake-action="insert">放入当前画布</button></footer></article>'}).join(''):'<div class="qw-learning-assets-empty">'+(mastered?'暂无已掌握错题':'太好了，当前没有待掌握错题。')+'</div>';
    updateCounts();
  }
  async function refreshPersonal(){
    try{state.personal=await Personal.refresh?.({includeArchived:true})||cardsSnapshot();global.KGMultiQuestionWorkspace?.hydratePersonalCards?.([...(state.personal.active||[]),...(state.personal.archived||[])]);renderPersonal()}catch(error){showError('personal',error)}
  }
  async function refreshMistakes(){try{state.practice=await Practice.refresh?.()||practiceSnapshot();renderMistakes()}catch(error){showError('mistakes',error)}}
  function findCard(id){const snapshot=cardsSnapshot();return [...(snapshot.active||[]),...(snapshot.archived||[])].find(card=>String(card.id)===String(id))||null}
  function openEditor(card){
    if(!card)return;
    state.editing=clone(card);byId('qwPersonalCardConflict').hidden=true;
    byId('qwPersonalCardEditorTitleInput').value=String(card.title||'');byId('qwPersonalCardEditorContent').value=String(card.content||'');byId('qwPersonalCardEditorTags').value=(card.tags||[]).join('，');
    byId('qwPersonalCardEditorType').value=String(card.synthesisType||'principle');byId('qwPersonalCardEditorStatus').value=String(card.status||'draft');
    byId('qwPersonalCardEditor').hidden=false;byId('qwPersonalCardEditorTitleInput').focus();
  }
  function closeEditor(){const editor=byId('qwPersonalCardEditor');if(editor)editor.hidden=true;state.editing=null}
  async function saveEditor(event){
    event.preventDefault();if(!state.editing)return;
    const input={title:byId('qwPersonalCardEditorTitleInput').value.trim(),content:byId('qwPersonalCardEditorContent').value.trim(),tags:tags(byId('qwPersonalCardEditorTags').value),synthesisType:byId('qwPersonalCardEditorType').value,status:byId('qwPersonalCardEditorStatus').value,sourceQuestionRefs:state.editing.sourceQuestionRefs||[],revision:Number(state.editing.revision||1)};
    try{await Personal.update?.(state.editing.id,input);closeEditor();await refreshPersonal()}catch(error){
      if(Number(error?.status)===409){byId('qwPersonalCardConflict').hidden=false;return}
      showError('personal',error);
    }
  }
  function bind(){
    // 409 冲突时保留本地编辑内容，由用户点击“重新加载最新版本”后再覆盖。
    byId('qwPersonalCardsBtn')?.addEventListener('click',()=>byId('qwPersonalCardsDrawer').hidden?openDrawer('personal'):closeDrawers());
    byId('qwMistakesBtn')?.addEventListener('click',()=>byId('qwMistakesDrawer').hidden?openDrawer('mistakes'):closeDrawers());
    byId('qwPersonalCardsClose')?.addEventListener('click',()=>closeDrawers());byId('qwMistakesClose')?.addEventListener('click',()=>closeDrawers());byId('qwLearningAssetsBackdrop')?.addEventListener('click',()=>closeDrawers());
    byId('qwPersonalCardsSearch')?.addEventListener('input',event=>{state.personalQuery=String(event.target.value||'');renderPersonal()});byId('qwMistakesSearch')?.addEventListener('input',event=>{state.mistakeQuery=String(event.target.value||'');renderMistakes()});
    document.querySelectorAll('[data-personal-card-filter]').forEach(button=>button.addEventListener('click',()=>{state.personalFilter=String(button.dataset.personalCardFilter);document.querySelectorAll('[data-personal-card-filter]').forEach(item=>item.classList.toggle('active',item===button));renderPersonal()}));
    document.querySelectorAll('[data-mistake-filter]').forEach(button=>button.addEventListener('click',()=>{state.mistakeFilter=String(button.dataset.mistakeFilter);document.querySelectorAll('[data-mistake-filter]').forEach(item=>item.classList.toggle('active',item===button));renderMistakes()}));
    byId('qwPersonalCardsList')?.addEventListener('click',async event=>{const article=event.target.closest('[data-card-id]'),action=event.target.closest('[data-card-action]')?.dataset.cardAction,card=findCard(article?.dataset.cardId);if(!card||!action)return;if(action==='edit')openEditor(card);if(action==='insert'){const result=await global.KGMultiQuestionWorkspace?.insertPersonalCard?.(card);if(result?.created||result?.reason==='already-exists')closeDrawers()}if(action==='archive'){await Personal.archive?.(card.id);await refreshPersonal()}if(action==='restore'){await Personal.restore?.(card.id);await refreshPersonal()}});
    byId('qwMistakesList')?.addEventListener('click',event=>{const article=event.target.closest('[data-mistake-id]'),action=event.target.closest('[data-mistake-action]')?.dataset.mistakeAction,row=(practiceSnapshot().mistakes||[]).find(item=>String(item.id)===String(article?.dataset.mistakeId));if(action==='insert'&&row){global.KGMultiQuestionWorkspace?.addQuestionByReference?.({questionId:row.questionId,bankId:row.bankId,releaseId:row.releaseId});closeDrawers()}});
    byId('qwPersonalCardsRetry')?.addEventListener('click',refreshPersonal);byId('qwMistakesRetry')?.addEventListener('click',refreshMistakes);
    byId('qwPersonalCardEditor')?.querySelector('form')?.addEventListener('submit',saveEditor);for(const id of ['qwPersonalCardEditorCancel','qwPersonalCardEditorDismiss'])byId(id)?.addEventListener('click',closeEditor);
    byId('qwPersonalCardConflictReload')?.addEventListener('click',async()=>{const fresh=await Personal.get?.(state.editing?.id);if(fresh)openEditor(fresh)});
    global.addEventListener('kg-personal-synthesis-cards-change',event=>{state.personal=clone(event.detail);renderPersonal()});global.addEventListener('kg-practice-mistakes-change',event=>{state.practice=clone(event.detail);renderMistakes()});
    global.addEventListener('keydown',event=>{if(event.key==='Escape'){if(!byId('qwPersonalCardEditor').hidden)closeEditor();else closeDrawers()}});
  }
  async function init(){if(!document.body.classList.contains('question-workspace-page'))return;bind();renderPersonal();renderMistakes();await Promise.allSettled([refreshPersonal(),refreshMistakes()])}
  global.KGMultiQuestionLearningAssets=Object.freeze({init,refreshPersonal,refreshMistakes,openDrawer,closeDrawers,renderPersonal,renderMistakes});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
