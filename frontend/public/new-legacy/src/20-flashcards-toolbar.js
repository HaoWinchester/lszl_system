'use strict';

/*
 * 本文件由原单文件 HTML 自动拆分而来。
 * 维护建议：继续把本文件中的强耦合函数逐步迁移为显式模块 API。
 */


/* 首页学习包 ZIP 导入 / 导出已拆到 src/21-home-package-service.js。
 * 本文件只保留与首页 state / render / 状态提示有关的薄封装。
 */
async function exportLearningPackage(){
  const service=window.KGHomePackageService;
  if(!service||typeof service.downloadPackage!=='function')throw new Error('学习包服务未加载。');
  if(typeof saveNow==='function'&&!saveNow({force:true,silent:false,reason:'export-package'}))throw new Error('当前图谱保存失败，请先清理本地存储空间或导出浏览器数据备份。');
  const store=window.KGGraphFileStore;
  const current=store&&typeof store.getCurrentFile==='function'?store.getCurrentFile():null;
  const meta=store&&typeof store.getCurrentFileMeta==='function'?store.getCurrentFileMeta():current;
  const clean=sanitizeState(current&&current.graphData?current.graphData:exportableState());
  const base=meta&&meta.name||clean.meta&&clean.meta.title||'知识图谱';
  service.downloadPackage(clean,{filename:service.safeFileBase(base)+'-学习包.zip'});
  showStatus(`已从当前文件“${base}”导出学习包 ZIP。`);
}
async function parseLearningPackageFile(file){
  const service=window.KGHomePackageService;
  if(!service||typeof service.parseFile!=='function')throw new Error('学习包服务未加载。');
  return service.parseFile(file);
}
function importedGraphName(data,file){
  const title=data&&data.meta&&data.meta.title;
  if(title)return String(title).trim().slice(0,100)||'导入图谱';
  const raw=String(file&&file.name||'').replace(/\.(zip|json)$/i,'').replace(/[-_]?学习包$/,'').trim();
  return raw.slice(0,100)||'导入图谱';
}
function applyImportedFile(fileRecord){
  if(!fileRecord||!fileRecord.graphData)return false;
  state=sanitizeState(fileRecord.graphData);
  state.selectedNodeId=null;
  state.selectedLinkId=null;
  state.linkSourceId=null;
  try{lastSavedSnapshot=JSON.stringify(typeof saveableState==='function'?saveableState():state)}catch(err){lastSavedSnapshot=''}
  if(window.KGGraphFileAutosave&&window.KGGraphFileAutosave.clearDirty)window.KGGraphFileAutosave.clearDirty('imported-file');
  if(window.KGGraphFileTabs&&typeof window.KGGraphFileTabs.refresh==='function')window.KGGraphFileTabs.refresh();
  render({persist:false});
  return true;
}
async function importLearningPackageFile(file){
  const data=await parseLearningPackageFile(file);
  if(!data||typeof data!=='object'||!Array.isArray(data.nodes)||!Array.isArray(data.links))throw new Error('格式不正确');
  const clean=sanitizeState(data);
  clean.selectedNodeId=null;
  clean.selectedLinkId=null;
  clean.linkSourceId=null;
  const store=window.KGGraphFileStore;
  const name=importedGraphName(clean,file);
  const autosave=window.KGGraphFileAutosave;
  if(autosave&&typeof autosave.saveBeforeSwitch==='function'&&!autosave.saveBeforeSwitch())throw new Error('当前图谱保存失败，已取消导入。');
  if(store&&typeof store.createFile==='function'){
    const previousId=store.getCurrentFileId&&store.getCurrentFileId();
    const created=store.createFile({name,graphData:clean,source:'import',sourceFileId:String(file&&file.name||'').slice(0,120)},{makeCurrent:true});
    if(!created)throw new Error(store.getLastError&&store.getLastError()||'导入文件保存失败，本地存储空间可能已满。');
    if(!applyImportedFile(created)){
      store.deleteFile(created.id,{emit:false,permanent:true});
      if(previousId)store.openFile(previousId,{emit:false});
      throw new Error('导入文件内容异常，已取消导入。');
    }
    window.dispatchEvent(new CustomEvent('kg-graph-current-file-change',{detail:{owner:store.currentOwner?store.currentOwner():'',id:created.id}}));
    showStatus(`学习包导入成功，已创建新图谱文件“${created.name}”。`);
    return created;
  }
  state=clean;
  render({persist:true});
  showStatus('学习包导入成功，已自动过滤无效节点、关系和颜色值。');
  return clean;
}

function addAtCenter(){const r=stage.getBoundingClientRect(),p=screenToWorld(r.left+r.width/2,r.top+r.height/2);createNodeAt(p.x,p.y)}

let flashMode='current',flashImportantOnly=false,flashShuffle=false,flashDueOnly=false,currentFlashcards=[],currentFlashIndex=0;
const REVIEW_INTERVALS=[20*60*1000,60*60*1000,24*60*60*1000,2*24*60*60*1000,4*24*60*60*1000,7*24*60*60*1000,15*24*60*60*1000,30*24*60*60*1000];
function memoryText(n,kind,extra={}){
  const title=n.title||n.name||'未命名知识点';
  const explanation=(n.summary||n.explanation||n.description||`${title} 是 ${n.category||kind||'本图谱'} 中需要掌握的知识点，可结合图谱中的前后关系进行理解。`).trim();
  const mnemonic=(n.notes||n.mnemonic||n.tip||autoMnemonic(n)).trim();
  const highlightTerms=n.highlightTerms||n.highlights||n.highlightWords||n.highlightKeywords||n.highlight||'';
  return{title,category:n.category||kind||'知识点',level:n.level||'基础',keywords:n.keywords||'',highlightTerms,explanation,mnemonic,color:n.color||'#2563eb',size:n.size||state.defaults.nodeSize||'',source:kind||'当前图谱',...extra};
}
function autoMnemonic(n){
  const keys=String(n.keywords||'').split(/[，,、\s]+/).filter(Boolean).slice(0,4);
  if(keys.length)return`抓住关键词：${keys.join(' → ')}，先理解含义，再回到图谱中看它与其他知识点的关系。`;
  return`先问“它是什么”，再问“它和谁有关”，最后用一句话讲给同学听。`;
}
function flashReviewFor(card){return state.flashReviews&&card?state.flashReviews[card.cardKey]:null}
function isReviewDue(card,now=Date.now()){const r=flashReviewFor(card);return !r||!r.nextReviewAt||new Date(r.nextReviewAt).getTime()<=now}
function sourceFlashcards(mode=flashMode){
  const exists=new Set(state.nodes.map(n=>String(n.title||'').trim()));
  const current=state.nodes.map(n=>({...memoryText(n,'当前图谱',{exists:true,sourceNodeId:n.id,cardKey:'node:'+n.id})}));
  const imported=(state.importedFlashcards||[]).map(c=>({...memoryText(c,c.source||c.subject||'导入闪卡',{exists:false,importedId:c.id,cardKey:'import:'+c.id})}));
  const library=[];
  ['pmp','p2','acp','cspm','npdp'].forEach(kind=>{
    const t=templateState(kind),label=t.meta.subject||kind.toUpperCase();
    t.nodes.forEach(n=>{if(!exists.has(String(n.title||'').trim()))library.push({...memoryText(n,label,{exists:false,templateKind:kind,cardKey:'library:'+kind+':'+String(n.title||'').trim()})})});
  });
  if(mode==='library')return library;
  if(mode==='imported')return imported;
  return current;
}
function buildFlashcards(){
  let list=sourceFlashcards(flashMode);
  if(flashImportantOnly)list=list.filter(c=>c.level==='重点');
  if(flashDueOnly)list=list.filter(c=>isReviewDue(c));
  list=list.map(c=>({...c,review:flashReviewFor(c),due:isReviewDue(c)}));
  if(flashShuffle)list=[...list].sort(()=>Math.random()-.5);
  else list=[...list].sort((a,b)=>(b.due-a.due)||String(a.category||'').localeCompare(String(b.category||''),'zh-Hans')||String(a.title||'').localeCompare(String(b.title||''),'zh-Hans'));
  return list;
}
function openFlashcards(mode='current'){flashMode=mode;currentFlashIndex=0;setFlashToolsExpanded(false);$('flashcardModal').classList.add('show');renderFlashcards()}
function closeFlashcards(){$('flashcardModal').classList.remove('show');setFlashToolsExpanded(false)}
function setFlashToolsExpanded(expanded){
  const tools=document.querySelector('.flashcard-tools'),toggle=$('flashToolsToggle');
  if(!tools||!toggle)return;
  tools.classList.toggle('tools-expanded',!!expanded);
  toggle.setAttribute('aria-expanded',expanded?'true':'false');
  toggle.textContent=expanded?'⌃':'⌄';
  toggle.title=expanded?'收起闪卡工具':'展开闪卡工具';
}
function toggleFlashTools(){
  const tools=document.querySelector('.flashcard-tools');
  setFlashToolsExpanded(!(tools&&tools.classList.contains('tools-expanded')));
}

function flashSwipeSpeed(){
  normalizeState();
  return state.defaults.flashSwipeSpeed;
}

// 闪卡拖拽/滑出性能参数。后续开发器可把这些字段映射成滑块配置。
const FLASH_DRAG_TUNING={
  swipeRatio:.28,
  minThreshold:82,
  maxThreshold:136,
  dragStartThreshold:3,
  horizontalBias:1.05,
  followX:1,
  followY:.92,
  edgeResistance:.58,
  edgePower:.86,
  dragRotate:16,
  flyRotate:22,
  flyDurationScale:.72,
  minFlyDurationMs:220,
  maxFlyDurationMs:680,
  springDurationMs:340,
  springBackOffset:.06,
  failSafePaddingMs:180
};
function flashDragTuning(){
  const user=globalThis.KG_FLASH_DRAG_TUNING&&typeof globalThis.KG_FLASH_DRAG_TUNING==='object'?globalThis.KG_FLASH_DRAG_TUNING:{};
  return {...FLASH_DRAG_TUNING,...user};
}
function flashSwipeDuration(){
  const cfg=flashDragTuning();
  const base={1:980,2:760,3:560,4:420,5:300}[flashSwipeSpeed()]||760;
  const scaled=Math.round(base*(Number(cfg.flyDurationScale)||1));
  return Math.max(Number(cfg.minFlyDurationMs)||180,Math.min(Number(cfg.maxFlyDurationMs)||720,scaled));
}
function flashSwipeSpeedLabel(speed=flashSwipeSpeed()){
  return {1:'很慢',2:'较慢',3:'标准',4:'较快',5:'快速'}[speed]||'较慢';
}
function syncFlashSwipeSpeedControl(){
  const input=$('flashSwipeSpeed'),label=$('flashSwipeSpeedLabel');if(!input||!label)return;
  const speed=flashSwipeSpeed();
  if(input.value!==String(speed))input.value=String(speed);
  label.textContent=flashSwipeSpeedLabel(speed);
}
function setFlashSwipeSpeed(value){
  normalizeState();
  state.defaults.flashSwipeSpeed=clamp(Math.round(Number(value)||DEFAULTS.flashSwipeSpeed),1,5);
  syncFlashSwipeSpeedControl();
  save();
}
function renderFlashcards(){
  const grid=$('flashcardGrid');if(!grid)return;
  normalizeState();
  syncFlashSwipeSpeedControl();
  const baseList=sourceFlashcards(flashMode);
  const dueCount=baseList.filter(c=>isReviewDue(c)).length;
  const nextAt=nextReviewTime(baseList);
  const cards=buildFlashcards();currentFlashcards=cards;
  if(currentFlashIndex>=cards.length)currentFlashIndex=Math.max(0,cards.length-1);
  $('flashCurrentBtn').classList.toggle('active-toggle',flashMode==='current');
  $('flashLibraryBtn').classList.toggle('active-toggle',flashMode==='library');
  $('flashImportedBtn').classList.toggle('active-toggle',flashMode==='imported');
  $('flashImportantBtn').classList.toggle('active-toggle',flashImportantOnly);
  $('flashDueBtn').classList.toggle('active-toggle',flashDueOnly);
  $('flashcardTip').textContent=flashMode==='current'?'当前图谱节点已生成复习闪卡，可滑动记录记忆状态。':flashMode==='imported'?'这里显示你导入的闪卡，可添加到画布生成知识点。':'示例闪卡可一键添加到当前画布。';
  $('flashcardProgress').innerHTML=`<span><strong>${cards.length?currentFlashIndex+1:0}</strong> / ${cards.length} 张｜本组到期 <strong>${dueCount}</strong> 张</span><span>${nextAt?'下次复习：'+formatDateTime(nextAt):'暂无待提醒复习'}</span>`;
  refreshFlashAddMissingButton(cards);
  if(!cards.length){grid.innerHTML=`<div class="flashcard-empty">${emptyFlashcardText(baseList.length)}</div>`;return}
  const c=cards[currentFlashIndex],r=flashReviewFor(c),schedule=r&&r.nextReviewAt?`上次：${r.lastResult==='remembered'?'记住了':'记不清'}｜复习${r.reviewCount||0}次｜下次：${formatDateTime(r.nextReviewAt)}`:'尚未复习，滑动后会记录艾宾浩斯复习提醒。';
  grid.innerHTML=`<div class="flashcard-session">
    <div id="flashcardDeck" class="flashcard-deck">
      <article class="memory-card ${c.level==='重点'?'key-card':''}" data-card-index="${currentFlashIndex}">
        <div class="memory-review-mark left">记不清</div>
        <div class="memory-review-mark right">记住了</div>
        <div class="memory-card-inner">
          <section class="memory-face memory-front">
            <div class="memory-subject">${escapeHTML(c.category||c.source||'知识点')}</div>
            <div class="memory-title">${escapeHTML(c.title)}</div>
            <div class="memory-badge">${escapeHTML(c.level||'基础')}</div>
          </section>
          <section class="memory-face memory-back">
            ${c.level==='重点'?'<div class="memory-key">重点</div>':''}
            <h3>${escapeHTML(c.title)}</h3>
            <div class="section-title">解释</div>
            <div class="explain">${highlightImportant(c.explanation,c.highlightTerms||c.keywords)}</div>
            <div class="section-title">记忆口诀</div>
            <div class="mnemonic">${highlightImportant(c.mnemonic,c.highlightTerms||c.keywords)}</div>
            <div class="memory-schedule">${escapeHTML(schedule)}</div>
            <div class="memory-actions">
              <button class="add-flash-node" data-card-index="${currentFlashIndex}">添加到画布</button>
              ${c.sourceNodeId?`<button class="secondary locate-flash-node" data-node-id="${c.sourceNodeId}">定位</button>`:''}
            </div>
          </section>
        </div>
      </article>
    </div>
    <div class="flashcard-review-actions">
      <button id="flashUnclearBtn" class="unclear">← 记不清</button>
      <button id="flashRememberBtn" class="remember">记住了 →</button>
    </div>
  </div>`;
  bindSingleFlashcard();
}
function emptyFlashcardText(baseCount){
  if(flashMode==='imported'&&!baseCount)return'还没有导入闪卡。请点击“导入格式”查看表格样式，再点击“导入表格”。';
  if(baseCount&&flashDueOnly)return'当前筛选下没有到期复习卡。可以关闭“到期复习”查看全部闪卡。';
  if(flashMode==='current')return'当前图谱还没有知识点。可以先新增知识点，或切换到“示例闪卡库”。';
  return'没有符合条件的闪卡。';
}
function bindSingleFlashcard(){
  const deck=$('flashcardDeck'),card=deck&&deck.querySelector('.memory-card');if(!card)return;
  const cfg=flashDragTuning();
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  let startX=0,startY=0,lastX=0,lastY=0,visualX=0,visualY=0,rot=0;
  let dragging=false,moved=false,locked=false,pointerId=null,rafId=0,recoverTimer=null,activeAnim=null;

  function threshold(){return clamp((deck.clientWidth||360)*cfg.swipeRatio,cfg.minThreshold,cfg.maxThreshold)}
  function dampAxis(v,limit,follow){
    const abs=Math.abs(v),sign=Math.sign(v)||1;
    if(abs<=limit)return v*follow;
    return sign*(limit*follow+Math.pow(abs-limit,Number(cfg.edgePower)||.86)*(Number(cfg.edgeResistance)||.58));
  }
  function cleanupTimers(){
    if(rafId){cancelAnimationFrame(rafId);rafId=0}
    if(recoverTimer){clearTimeout(recoverTimer);recoverTimer=null}
  }
  function safeRelease(){
    if(pointerId!==null&&card.releasePointerCapture){
      try{card.releasePointerCapture(pointerId)}catch(err){}
    }
  }
  function clearReviewProgress(){
    card.querySelectorAll('.memory-review-mark').forEach(mark=>{mark.style.opacity='';mark.style.transform=''})
  }
  function hardUnlock(resetTransform=true){
    cleanupTimers();
    if(activeAnim&&activeAnim.cancel){try{activeAnim.cancel()}catch(err){}}
    activeAnim=null;dragging=false;locked=false;pointerId=null;
    deck.classList.remove('drag-active');
    card.classList.remove('dragging','peek-left','peek-right','rebounding','flying','swipe-left','swipe-right');
    clearReviewProgress();
    if(resetTransform){
      card.style.transform='';
      card.style.opacity='';
      card.style.transition='';
    }
  }
  function armRecover(ms){
    if(recoverTimer)clearTimeout(recoverTimer);
    recoverTimer=setTimeout(()=>hardUnlock(true),Math.max(240,ms+(cfg.failSafePaddingMs||180)));
  }
  function paintReviewProgress(dx){
    const t=threshold(),progress=clamp(Math.abs(dx)/t,0,1),scale=.92+progress*.16;
    const left=card.querySelector('.memory-review-mark.left'),right=card.querySelector('.memory-review-mark.right');
    if(left){left.style.opacity=dx<0?String(progress):'';left.style.transform=dx<0?`scale(${scale}) rotate(${-8*progress}deg)`:''}
    if(right){right.style.opacity=dx>0?String(progress):'';right.style.transform=dx>0?`scale(${scale}) rotate(${8*progress}deg)`:''}
  }
  function applyDragTransform(dx,dy){
    const t=threshold(),w=deck.clientWidth||360;
    visualX=dampAxis(dx,t*1.35,Number(cfg.followX)||1);
    visualY=dampAxis(dy,t*2.1,Number(cfg.followY)||.92);
    rot=clamp(dx/w*(Number(cfg.dragRotate)||16)+dy*.006,-(Number(cfg.dragRotate)||16),Number(cfg.dragRotate)||16);
    card.style.transform=`translate3d(${visualX}px, ${visualY}px, 0) rotate(${rot}deg)`;
    card.classList.toggle('peek-right',dx>t*.42);
    card.classList.toggle('peek-left',dx<-t*.42);
    paintReviewProgress(dx);
  }
  function scheduleDrag(dx,dy){
    lastX=dx;lastY=dy;
    if(rafId)return;
    rafId=requestAnimationFrame(()=>{rafId=0;if(dragging&&!locked)applyDragTransform(lastX,lastY)});
  }
  function springBack(){
    const from=`translate3d(${visualX}px, ${visualY}px, 0) rotate(${rot}deg)`;
    const dur=Math.max(180,Number(cfg.springDurationMs)||340);
    dragging=false;locked=false;safeRelease();cleanupTimers();
    deck.classList.remove('drag-active');
    card.classList.remove('dragging','peek-left','peek-right');card.classList.add('rebounding');clearReviewProgress();
    armRecover(dur);
    if(!card.animate){
      card.style.transition=`transform ${dur}ms cubic-bezier(.17,.89,.25,1.16)`;
      requestAnimationFrame(()=>{card.style.transform='translate3d(0, 0, 0) rotate(0deg)'});
      setTimeout(()=>hardUnlock(true),dur+50);
      return;
    }
    activeAnim=card.animate([
      {transform:from,offset:0},
      {transform:`translate3d(${-visualX*(cfg.springBackOffset||.06)}px, ${-visualY*(cfg.springBackOffset||.06)}px, 0) rotate(${-rot*.10}deg)`,offset:.70},
      {transform:'translate3d(0, 0, 0) rotate(0deg)',offset:1}
    ],{duration:dur,easing:'cubic-bezier(.17,.89,.25,1.16)',fill:'both'});
    activeAnim.onfinish=()=>hardUnlock(true);
    activeAnim.oncancel=()=>hardUnlock(true);
  }

  card.addEventListener('pointerdown',e=>{
    if(e.button!==undefined&&e.button!==0)return;
    if(e.target.closest('button'))return;
    hardUnlock(false);
    dragging=true;moved=false;locked=false;pointerId=e.pointerId;
    startX=e.clientX;startY=e.clientY;lastX=lastY=visualX=visualY=rot=0;
    deck.classList.add('drag-active');card.classList.add('dragging');
    card.style.transition='none';card.style.opacity='';
    try{card.setPointerCapture&&card.setPointerCapture(e.pointerId)}catch(err){}
    if(e.cancelable)e.preventDefault();
    e.stopPropagation();
  },{passive:false});

  card.addEventListener('pointermove',e=>{
    if(!dragging||locked||e.pointerId!==pointerId)return;
    const dx=e.clientX-startX,dy=e.clientY-startY;
    if(Math.abs(dx)>cfg.dragStartThreshold||Math.abs(dy)>cfg.dragStartThreshold)moved=true;
    scheduleDrag(dx,dy);
    if(e.cancelable)e.preventDefault();
    e.stopPropagation();
  },{passive:false});

  function finish(e){
    if(!dragging||locked||e.pointerId!==pointerId)return;
    dragging=false;safeRelease();
    const dx=e.clientX-startX,dy=e.clientY-startY,t=threshold(),bias=Number(cfg.horizontalBias)||1.05;
    if(rafId){cancelAnimationFrame(rafId);rafId=0;applyDragTransform(dx,dy)}
    if(Math.abs(dx)>t&&Math.abs(dx)>Math.abs(dy)*bias){
      locked=true;deck.classList.remove('drag-active');
      swipeFlashcard(dx>0?'remembered':'unclear',{dx,dy,visualX,visualY,rot});
      if(e.cancelable)e.preventDefault();
      e.stopPropagation();
      return;
    }
    if(!moved){
      hardUnlock(true);
      card.classList.toggle('flipped');
      if(e.cancelable)e.preventDefault();
      e.stopPropagation();
      return;
    }
    springBack();
    if(e.cancelable)e.preventDefault();
    e.stopPropagation();
  }

  card.addEventListener('pointerup',finish,{passive:false});
  card.addEventListener('pointercancel',e=>{if(!dragging||e.pointerId!==pointerId)return;springBack()},{passive:false});
  card.addEventListener('lostpointercapture',()=>{if(dragging&&!locked)springBack()});

  card.querySelectorAll('.add-flash-node').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();const c=currentFlashcards[Number(btn.dataset.cardIndex)];if(c)addFlashcardToCanvas(c)}));
  card.querySelectorAll('.locate-flash-node').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();const id=btn.dataset.nodeId;if(id)locateNode(id)}));
  const unclear=$('flashUnclearBtn'),remember=$('flashRememberBtn');
  if(unclear)unclear.onclick=()=>swipeFlashcard('unclear');
  if(remember)remember.onclick=()=>swipeFlashcard('remembered');
}
function swipeFlashcard(result,drag={}){
  const deck=$('flashcardDeck'),card=deck&&deck.querySelector('.memory-card'),current=currentFlashcards[currentFlashIndex];if(!current)return;
  if(!card){recordFlashReview(current,result);advanceFlashcard();return}
  const cfg=flashDragTuning(),dir=result==='remembered'?1:-1;
  const fromX=Number.isFinite(drag.visualX)?drag.visualX:dir*38;
  const fromY=Number.isFinite(drag.visualY)?drag.visualY:0;
  const fromRot=Number.isFinite(drag.rot)?drag.rot:dir*5;
  const rawY=Number.isFinite(drag.dy)?drag.dy:0;
  const width=card.getBoundingClientRect().width||300;
  const targetX=dir*(window.innerWidth+width*.82);
  const targetY=Math.max(-150,Math.min(150,rawY*.82));
  const targetRot=dir*((Number(cfg.flyRotate)||22)+Math.min(Math.abs(drag.dx||0)/18,10));
  let done=false,failSafe=null;
  function complete(){
    if(done)return;done=true;
    if(failSafe)clearTimeout(failSafe);
    card.classList.remove('flying','dragging','rebounding','peek-left','peek-right');
    deck&&deck.classList.remove('drag-active');
    card.style.transform='';card.style.opacity='';card.style.transition='';
    recordFlashReview(current,result);
    advanceFlashcard();
  }
  card.classList.remove('flipped','peek-left','peek-right','dragging','rebounding','swipe-left','swipe-right');
  card.classList.add('flying',result==='remembered'?'peek-right':'peek-left');
  deck&&deck.classList.remove('drag-active');
  card.querySelectorAll('.memory-review-mark').forEach(mark=>{mark.style.opacity='';mark.style.transform=''});
  const duration=flashSwipeDuration();
  failSafe=setTimeout(complete,duration+(cfg.failSafePaddingMs||180));
  if(!card.animate){
    card.style.transition=`transform ${duration}ms cubic-bezier(.18,.72,.18,1), opacity ${duration}ms ease`;
    card.style.transform=`translate3d(${targetX}px, ${targetY}px, 0) rotate(${targetRot}deg)`;
    card.style.opacity='0';
    return;
  }
  const anim=card.animate([
    {transform:`translate3d(${fromX}px, ${fromY}px, 0) rotate(${fromRot}deg)`,opacity:1,offset:0},
    {transform:`translate3d(${targetX*.22}px, ${targetY*.55}px, 0) rotate(${targetRot*.52}deg)`,opacity:.96,offset:.34},
    {transform:`translate3d(${targetX}px, ${targetY}px, 0) rotate(${targetRot}deg)`,opacity:0,offset:1}
  ],{duration,easing:'cubic-bezier(.18,.72,.18,1)',fill:'forwards'});
  anim.onfinish=complete;
  anim.oncancel=complete;
}
function advanceFlashcard(){
  if(flashDueOnly)currentFlashIndex=0;else currentFlashIndex++;
  renderFlashcards();
}
function recordFlashReview(card,result){
  normalizeState();
  const key=card.cardKey||('card:'+card.title),now=Date.now(),old=state.flashReviews[key]||{cardKey:key,title:card.title,source:card.source,stage:0,reviewCount:0,rememberCount:0,unclearCount:0,history:[]};
  const remembered=result==='remembered';
  const stage=remembered?Math.min((old.stage||0)+1,REVIEW_INTERVALS.length-1):0;
  const interval=remembered?REVIEW_INTERVALS[stage]:REVIEW_INTERVALS[0];
  const next=new Date(now+interval).toISOString();
  const rec={...old,title:card.title,source:card.source,category:card.category,lastResult:result,stage,reviewCount:(old.reviewCount||0)+1,rememberCount:(old.rememberCount||0)+(remembered?1:0),unclearCount:(old.unclearCount||0)+(remembered?0:1),lastReviewedAt:new Date(now).toISOString(),nextReviewAt:next};
  rec.history=[...(old.history||[]),{time:rec.lastReviewedAt,result,nextReviewAt:next,stage}].slice(-60);
  state.flashReviews[key]=rec;save(420);
  showStatus(remembered?`已记录“记住了”，下次复习：${formatDateTime(next)}`:`已记录“记不清”，建议 ${formatDateTime(next)} 再复习。`);
}
function nextReviewTime(cards){
  const times=cards.map(c=>flashReviewFor(c)).filter(r=>r&&r.nextReviewAt).map(r=>new Date(r.nextReviewAt).getTime()).filter(t=>!Number.isNaN(t));
  if(!times.length)return null;return new Date(Math.min(...times)).toISOString();
}
function formatDateTime(v){const d=new Date(v);if(Number.isNaN(d.getTime()))return'—';const pad=n=>String(n).padStart(2,'0');return`${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`}
function splitHighlightTerms(v){
  return String(v||'').split(/[，,、;；|\n]+/).map(s=>s.trim()).filter(Boolean).filter((s,i,a)=>a.findIndex(x=>x.toLowerCase()===s.toLowerCase())===i).sort((a,b)=>b.length-a.length);
}
function escapeRegExp(s){return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function highlightImportant(text,terms){
  const safe=escapeHTML(text||'—'),safeLower=safe.toLowerCase();
  const list=splitHighlightTerms(terms)
    .filter(t=>t.length>=2&&safeLower.includes(escapeHTML(t).toLowerCase()))
    .sort((a,b)=>b.length-a.length)
    .map(t=>escapeHTML(t));
  if(!list.length)return safe;
  const pattern=new RegExp('('+list.map(escapeRegExp).join('|')+')','gi');
  return safe.replace(pattern,'<span class="memory-highlight">$1</span>');
}
function flashTitleKey(v){return String(v||'').trim().replace(/\s+/g,' ').toLowerCase()}
function findCanvasNodeForFlashcard(card){
  if(card&&card.sourceNodeId){const n=nodeById(card.sourceNodeId);if(n)return n}
  const key=flashTitleKey(card&&card.title);
  if(!key)return null;
  return state.nodes.find(n=>flashTitleKey(n.title)===key)||null;
}
function missingFlashcardsForCanvas(cards=buildFlashcards()){
  const seen=new Set(state.nodes.map(n=>flashTitleKey(n.title)).filter(Boolean));
  const result=[];
  for(const card of cards||[]){
    const key=flashTitleKey(card&&card.title);
    if(!key||seen.has(key)||findCanvasNodeForFlashcard(card))continue;
    seen.add(key);
    result.push(card);
  }
  return result;
}
function makeNodeFromFlashcard(card,x,y){
  const size=state.defaults.nodeSize||card.size||'',d=dimsForSize(size);
  const n=makeNode(card.title,Math.round(x-d.w/2),Math.round(y-d.h/2),card.color||'#38bdf8',card.category||'',card.level||'基础',card.keywords||'',card.explanation||'',card.mnemonic||'',size);
  n.highlightTerms=card.highlightTerms||card.keywords||'';
  return n;
}
function addFlashcardToCanvas(card){
  const existed=findCanvasNodeForFlashcard(card);
  if(existed){
    closeFlashcards();
    locateNode(existed.id);
    showStatus(`“${existed.title}”已在画布中，已为你定位。`);
    return;
  }
  const sub=window.KGSubscription;
  if(sub&&typeof sub.requireUsageLimit==='function'&&!sub.requireUsageLimit('graphNodes',state.nodes.length,1,{label:'图谱卡牌'}))return;
  const r=stage.getBoundingClientRect(),p=screenToWorld(r.left+r.width/2,r.top+r.height/2),offset=(state.nodes.length%7)*22;
  const n=makeNodeFromFlashcard(card,p.x+offset,p.y+offset);
  state.nodes.push(n);
  clearMultiSelection();
  selectedNodeIds.add(n.id);
  state.selectedNodeId=n.id;state.selectedLinkId=null;state.linkSourceId=n.id;
  closeFlashcards();render({persist:true});showStatus(`已将“${n.title}”添加到画布。`);
}
function addAllMissingFlashcardsToCanvas(){
  normalizeState();
  const missing=missingFlashcardsForCanvas(buildFlashcards());
  if(!missing.length){
    showStatus('当前筛选下没有需要添加到画布的新闪卡。');
    return;
  }
  const sub=window.KGSubscription;
  if(sub&&typeof sub.requireUsageLimit==='function'&&!sub.requireUsageLimit('graphNodes',state.nodes.length,missing.length,{label:'图谱卡牌'}))return;
  const r=stage.getBoundingClientRect(),center=screenToWorld(r.left+r.width/2,r.top+r.height/2);
  const cols=Math.min(6,Math.max(1,Math.ceil(Math.sqrt(missing.length))));
  const gapX=190,gapY=170,rows=Math.ceil(missing.length/cols);
  const startX=center.x-(cols-1)*gapX/2,startY=center.y-(rows-1)*gapY/2;
  const created=[];
  missing.forEach((card,i)=>{
    const col=i%cols,row=Math.floor(i/cols);
    const n=makeNodeFromFlashcard(card,startX+col*gapX,startY+row*gapY);
    state.nodes.push(n);
    created.push(n.id);
  });
  clearMultiSelection();
  selectedNodeIds=new Set(created);
  state.selectedNodeId=created[0]||null;
  state.selectedLinkId=null;
  state.linkSourceId=null;
  closeFlashcards();
  render({persist:true});
  showStatus(`已将 ${created.length} 张未在画布中的闪卡批量添加为知识点，可直接拖动选中组整体移动。`);
}
function refreshFlashAddMissingButton(cards=currentFlashcards){
  const btn=$('flashAddMissingBtn');if(!btn)return;
  const count=missingFlashcardsForCanvas(cards||[]).length;
  const sub=window.KGSubscription;
  const remaining=sub&&typeof sub.remainingUsage==='function'?sub.remainingUsage('graphNodes',state.nodes.length):-1;
  const limitBlocked=count>0&&remaining>=0&&remaining<count;
  btn.disabled=count===0||limitBlocked;
  btn.textContent=count?`全部入画布(${count})`:'全部已入画布';
  btn.title=count?(limitBlocked?`当前套餐图谱卡牌剩余 ${remaining} 个名额，无法一次添加 ${count} 张。`:`将当前筛选下 ${count} 张未出现在画布的闪卡添加为知识点`):'当前筛选下的闪卡都已在画布中';
}
function locateNode(id){
  const n=nodeById(id);if(!n)return;const r=stage.getBoundingClientRect(),c=nodeCenter(n);
  state.viewport.x=r.width/2-c.x*state.viewport.scale;state.viewport.y=r.height/2-c.y*state.viewport.scale;state.selectedNodeId=id;state.selectedLinkId=null;state.linkSourceId=id;closeFlashcards();render();showStatus(`已定位到“${n.title}”。`);
}
function parseFlashTable(text,filename=''){
  text=String(text||'').replace(/^\uFEFF/,'');
  const firstLine=(text.split(/\r?\n/).find(l=>l.trim())||''),tabCount=(firstLine.match(/\t/g)||[]).length,commaCount=(firstLine.match(/,/g)||[]).length,delimiter=tabCount>commaCount?'\t':',';
  const rows=parseDelimitedRows(text,delimiter).filter(r=>r.some(c=>String(c||'').trim()));
  if(rows.length<2)throw new Error('表格至少需要表头和一行数据。');
  const headers=rows[0].map(h=>String(h||'').trim());
  const find=(aliases)=>aliases.map(a=>headers.findIndex(h=>normHeader(h)===normHeader(a))).find(i=>i>=0);
  const idx={subject:find(['科目','课程','来源','subject','source']),category:find(['分类','章节','模块','category']),title:find(['知识点名称','名称','标题','正面','title','name','question']),explanation:find(['解释','说明','答案','背面解释','explanation','answer','description']),mnemonic:find(['记忆口诀','口诀','学习提示','提示','mnemonic','tip']),level:find(['难度','等级','level']),keywords:find(['关键词','keywords']),color:find(['颜色','color']),important:find(['是否重点','重点','important','isImportant']),highlightTerms:find(['高亮词','荧光词','重点词','高亮关键词','highlightTerms','highlight','highlights'])};
  if(idx.title===undefined||idx.title<0)throw new Error('缺少必填表头：知识点名称。');
  return rows.slice(1).map((row,i)=>{
    const val=k=>idx[k]>=0?String(row[idx[k]]||'').trim():'';
    const important=/^(是|yes|y|true|1|重点)$/i.test(val('important'));
    const title=val('title');if(!title)return null;
    const level=important?'重点':(val('level')||'基础');
    const color=/^#[0-9a-f]{6}$/i.test(val('color'))?val('color'):'#38bdf8';
    return{id:uid('f'),subject:val('subject')||filename.replace(/\.[^.]+$/,'')||'导入闪卡',source:val('subject')||'导入闪卡',category:val('category')||'未分类',title,explanation:val('explanation')||`${title} 是需要复习的知识点。`,mnemonic:val('mnemonic')||autoMnemonic({keywords:val('keywords'),title}),level,keywords:val('keywords'),highlightTerms:val('highlightTerms'),color};
  }).filter(Boolean);
}
function parseDelimitedRows(text,delimiter=','){
  const rows=[];let row=[],cell='',inQuotes=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i],next=text[i+1];
    if(ch==='"'){if(inQuotes&&next==='"'){cell+='"';i++}else inQuotes=!inQuotes;continue}
    if(ch===delimiter&&!inQuotes){row.push(cell);cell='';continue}
    if((ch==='\n'||ch==='\r')&&!inQuotes){if(ch==='\r'&&next==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';continue}
    cell+=ch;
  }
  row.push(cell);rows.push(row);return rows;
}
function normHeader(s){return String(s||'').toLowerCase().replace(/\s+/g,'').replace(/[＊*：:]/g,'')}
async function importFlashcardFile(file){
  const content=await file.text();
  const cards=parseFlashTable(content,file.name);
  if(!cards.length)throw new Error('未读取到有效闪卡数据。');
  state.importedFlashcards=[...(state.importedFlashcards||[]),...cards];
  flashMode='imported';flashDueOnly=false;currentFlashIndex=0;save();renderFlashcards();showStatus(`已导入 ${cards.length} 张记忆闪卡。`);
}
function downloadFlashcardTemplate(){
  const rows=[
    ['科目','分类','知识点名称','解释','记忆口诀','高亮词','难度','关键词','颜色','是否重点'],
    ['PMP','进度管理','关键路径法','通过网络路径计算项目最短工期。','最长路径看工期，零浮动要警惕。','关键路径法,最短工期,最长路径,零浮动','重点','CPM,浮动时间','#ea580c','是'],
    ['ACP','敏捷交付','产品待办列表','承载需求、价值和优先级，是团队规划与交付的输入。','价值风险依赖成本，排序细化别混淆。','价值,优先级,排序,细化','重点','Backlog,优先级','#f59e0b','是']
  ];
  const csv='\ufeff'+rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='记忆闪卡导入模板.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(a.href);
}

function toggleFocusMode(){
  if(typeof beginFocusVisualTransition==='function')beginFocusVisualTransition();
  state.focusMode=!state.focusMode;
  syncGraphModeClasses();
  renderHeader();
  renderEdges();
  refreshCardClasses();
  renderDetails();
  updateCardQuickActions();
  save();
  showStatus(state.focusMode?'已开启重点聚焦：仅“重点”知识点高亮。':'已退出重点聚焦。')
}
function currentNodeSize(){const n=nodeById(state.selectedNodeId);return(n&&n.size)||state.defaults.nodeSize||''}
function currentLineStyle(){const l=linkById(state.selectedLinkId);return(l&&l.lineStyle)||state.defaults.linkStyle||DEFAULTS.linkStyle}
function selectedColorNodes(){const ids=selectedNodeIds&&selectedNodeIds.size?[...selectedNodeIds]:(state.selectedNodeId?[state.selectedNodeId]:[]);return ids.map(id=>nodeById(id)).filter(Boolean)} function currentLineColor(){const l=linkById(state.selectedLinkId);return safeColor((l&&l.color)||state.defaults.linkColor||DEFAULTS.linkColor,DEFAULTS.linkColor)} function currentCanvasColor(){const nodes=selectedColorNodes();if(nodes.length)return safeColor(nodes[0].color,DEFAULTS.nodeColor);const l=linkById(state.selectedLinkId);if(l)return safeColor(l.color,DEFAULTS.linkColor);return safeColor(state.defaults.nodeColor||state.defaults.linkColor||DEFAULTS.nodeColor,DEFAULTS.nodeColor)}
function nodeSizeLabel(size){return size==='small'?'小卡':size==='big'?'大卡':'默认尺寸'}
function applyNodeSize(size){size=NODE_SIZES.has(size)?size:'';const n=nodeById(state.selectedNodeId);if(n){n.size=size;showStatus(`已将“${n.title}”设为${nodeSizeLabel(size)}。`)}else{state.defaults.nodeSize=size;showStatus(`新建知识点默认使用${nodeSizeLabel(size)}。`)}render({persist:true})}
function toggleNodeSize(){applyNodeSize(currentNodeSize()==='big'?'small':'big')}
function lineStyleLabel(style){return style==='dotted'?'短虚线':style==='dashed'?'长虚线':'实线'}
function applyLineStyle(style){if(!LINE_STYLES.has(style))style=DEFAULTS.linkStyle;const l=linkById(state.selectedLinkId);if(l){l.lineStyle=style;showStatus(`已将选中关系线设为${lineStyleLabel(style)}。`)}else{state.defaults.linkStyle=style;showStatus(`新建关系线默认使用${lineStyleLabel(style)}。`)}render({persist:true})}
function currentPathStyle(){const l=linkById(state.selectedLinkId);return LINE_PATH_STYLES.has(l&&l.pathStyle)?l.pathStyle:(LINE_PATH_STYLES.has(state.defaults.linkPathStyle)?state.defaults.linkPathStyle:DEFAULTS.linkPathStyle)}
function pathStyleLabel(style){return style==='straight'?'直线':style==='elbow'?'折线':'曲线'}
function applyPathStyle(style){if(!LINE_PATH_STYLES.has(style))style=DEFAULTS.linkPathStyle;const l=linkById(state.selectedLinkId);if(l){l.pathStyle=style;showStatus(`已将选中关系线设为${pathStyleLabel(style)}。`)}else{state.defaults.linkPathStyle=style;showStatus(`新建关系线默认使用${pathStyleLabel(style)}。`)}render({persist:true})}
function toggleLineStyle(){applyLineStyle(currentLineStyle()==='dashed'?'solid':'dashed')}
function applyLineColor(color){color=safeColor(color,'');if(!color)return;const nodes=selectedColorNodes(),l=linkById(state.selectedLinkId);if(nodes.length){nodes.forEach(n=>{n.color=color});state.defaults.nodeColor=color;showStatus(nodes.length>1?`已更新 ${nodes.length} 张选中卡牌颜色。`:`已更新“${nodes[0].title}”卡牌颜色。`)}else if(l){l.color=color;state.defaults.linkColor=color;showStatus('已更新选中关系线颜色。')}else{state.defaults.nodeColor=color;state.defaults.linkColor=color;showStatus('已更新新卡牌和新关系线默认颜色。')}const nodeColorInput=$('nColor');if(nodeColorInput&&nodes.length&&nodeColorInput.value!==color)nodeColorInput.value=color;render({persist:true})}
function updateStyleControls(){const size=currentNodeSize(),lineStyle=currentLineStyle(),pathStyle=currentPathStyle(),canvasColor=currentCanvasColor();[['sizeSmallBtn',size==='small'],['sizeDefaultBtn',!size],['sizeBigBtn',size==='big'],['lineSolidBtn',lineStyle==='solid'],['lineDashedBtn',lineStyle==='dashed'],['lineDottedBtn',lineStyle==='dotted'],['pathStraightBtn',pathStyle==='straight'],['pathElbowBtn',pathStyle==='elbow'],['pathCurveBtn',pathStyle==='curve']].forEach(([id,on])=>{const b=$(id);if(b)b.classList.toggle('active-toggle',!!on)});const sizeMenu=$('sizeMenuBtn');if(sizeMenu)sizeMenu.classList.toggle('active-toggle',!!size);const lineMenu=$('lineStyleMenuBtn');if(lineMenu)lineMenu.classList.toggle('active-toggle',lineStyle!==DEFAULTS.linkStyle||pathStyle!==DEFAULTS.linkPathStyle);['lineColorPicker','mLineColorPicker'].forEach(id=>{const i=$(id);if(i&&i.value!==canvasColor)i.value=canvasColor});const floatingColor=$('lineColorPicker');if(floatingColor&&floatingColor.parentElement)floatingColor.parentElement.style.setProperty('--floating-line-color',canvasColor);const ms=$('mSizeBtn');if(ms)ms.textContent=size==='big'?'小卡':'大卡';const ml=$('mLineStyleBtn');if(ml)ml.textContent=lineStyle==='solid'?'虚线':'实线'}

const FLOATING_TOOLBOX_POSITION_KEY='通用知识点关系图谱工具_悬浮菜单位置_v1';
function initFloatingToolbox(){
  const box=$('floatingToolbox'),handle=$('floatingToolboxHandle'),host=$('stage');if(!box||!handle||!host)return;
  const safeTop=()=>{const toolbar=$('topToolbar');if(!toolbar)return 8;const hostRect=host.getBoundingClientRect(),rect=toolbar.getBoundingClientRect();return Math.max(8,Math.ceil(rect.bottom-hostRect.top+12))};
  const clampPosition=(left,top)=>{const minTop=safeTop(),maxLeft=Math.max(8,host.clientWidth-box.offsetWidth-8),maxTop=Math.max(minTop,host.clientHeight-box.offsetHeight-8);return{left:Math.max(8,Math.min(left,maxLeft)),top:Math.max(minTop,Math.min(top,maxTop))}};
  const applyPosition=(left,top)=>{const pos=clampPosition(Number(left)||16,Number(top)||safeTop());box.style.left=pos.left+'px';box.style.top=pos.top+'px';return pos};
  try{const store=window.KGAppStorage;const saved=store&&store.readJSON?store.readJSON(FLOATING_TOOLBOX_POSITION_KEY,null):JSON.parse(window.KGServerStateStorage.getItem(FLOATING_TOOLBOX_POSITION_KEY)||'null');if(saved)applyPosition(saved.left,saved.top)}catch(err){}
  let drag=null;
  handle.addEventListener('pointerdown',e=>{if(e.button!==undefined&&e.button!==0)return;e.preventDefault();e.stopPropagation();const rect=box.getBoundingClientRect(),hostRect=host.getBoundingClientRect();drag={id:e.pointerId,startX:e.clientX,startY:e.clientY,left:rect.left-hostRect.left,top:rect.top-hostRect.top};box.classList.add('dragging');document.body.classList.add('toolbox-dragging');try{handle.setPointerCapture(e.pointerId)}catch(err){}} ,{passive:false});
  handle.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;e.preventDefault();e.stopPropagation();applyPosition(drag.left+e.clientX-drag.startX,drag.top+e.clientY-drag.startY)},{passive:false});
  const finish=e=>{if(!drag||drag.id!==e.pointerId)return;e.preventDefault();e.stopPropagation();try{handle.releasePointerCapture(e.pointerId)}catch(err){}const pos=applyPosition(box.offsetLeft,box.offsetTop);try{const store=window.KGAppStorage;if(store&&store.writeJSON)store.writeJSON(FLOATING_TOOLBOX_POSITION_KEY,pos);else window.KGServerStateStorage.setItem(FLOATING_TOOLBOX_POSITION_KEY,JSON.stringify(pos))}catch(err){}drag=null;box.classList.remove('dragging');document.body.classList.remove('toolbox-dragging')};
  handle.addEventListener('pointerup',finish,{passive:false});handle.addEventListener('pointercancel',finish,{passive:false});
  window.addEventListener('resize',()=>applyPosition(box.offsetLeft,box.offsetTop));
}
initCanvasZoomDock();
window.KGHomeToolbarActions={
  addNode:addAtCenter,
  openFlashcards:()=>openFlashcards('current'),
  fitView,
  zoomIn:()=>zoomAtCenterStep(1),
  zoomOut:()=>zoomAtCenterStep(-1),
  openTemplate:()=>$('templateModal').classList.add('show'),
  toggleFocus:toggleFocusMode,
  togglePointerMode:()=>toggleGraphPointerMode(),
  toggleFlowMode:()=>toggleFlowMode(),
  toggleLargeGraphOverview:()=>toggleLargeGraphOverviewRelations(),
  toggleLargeGraphRelated:()=>toggleLargeGraphRelatedFocus(),
  openGraphSearch:()=>openGraphSearchPanel(),
  openQuestionTraining:event=>{
    if(event){
      event.preventDefault();
      event.stopPropagation();
    }
    if(typeof forceOpenQuestionTrainer==='function') forceOpenQuestionTrainer();
    else window.open('question-training.html','_blank');
  },
  setSmallCards:()=>applyNodeSize('small'),
  setDefaultCards:()=>applyNodeSize(''),
  setBigCards:()=>applyNodeSize('big'),
  setSolidLine:()=>applyLineStyle('solid'),
  setDashedLine:()=>applyLineStyle('dashed'),
  setDottedLine:()=>applyLineStyle('dotted'),
  setStraightPath:()=>applyPathStyle('straight'),
  setElbowPath:()=>applyPathStyle('elbow'),
  setCurvePath:()=>applyPathStyle('curve'),
  openLineColorPicker:()=>{const input=$('lineColorPicker');if(input)input.click()},
  setLineColor:event=>applyLineColor(event.target.value),
  exportLearningPackage:()=>{exportLearningPackage().catch(err=>alert('导出学习包失败：'+(err.message||err)))},
  openImportFile:()=>$('importFile').click(),
  importLearningPackage:async event=>{
    const f=event.target.files[0];
    if(!f)return;
    try{await importLearningPackageFile(f)}
    catch(err){alert('导入失败：不是有效的学习包 ZIP 或知识图谱 JSON。\n'+(err.message||err))}
    event.target.value='';
  },
  resetGraph:()=>{
    if(confirm('确定清空当前知识图谱吗？建议先导出备份。')){
      state=templateState('blank');
      normalizeState();
      render({persist:true});
      fitView(true);
      showStatus('已清空为一张空白图谱。');
    }
  },
  initToolbarDrag:initFloatingToolbox
};
if(window.KGHomeToolbarRegistry && typeof window.KGHomeToolbarRegistry.registerActions==='function'){
  window.KGHomeToolbarRegistry.registerActions(window.KGHomeToolbarActions);
}else{
  initFloatingToolbox();
}
$('mAddBtn').onclick=addAtCenter;$('mFlashcardBtn').onclick=()=>openFlashcards('current');$('mFitBtn').onclick=fitView;$('mZoomInBtn').onclick=()=>zoomAtCenterStep(1);$('mZoomOutBtn').onclick=()=>zoomAtCenterStep(-1);$('mGraphBtn').onclick=openGraphModal;$('mFocusBtn').onclick=toggleFocusMode;$('mSizeBtn').onclick=toggleNodeSize;$('mLineStyleBtn').onclick=toggleLineStyle;$('mLineColorPicker').oninput=e=>applyLineColor(e.target.value);
$('mEditBtn').onclick=()=>{if(state.selectedNodeId)return openNodeModal(state.selectedNodeId);if(state.selectedLinkId)return openLinkModal(state.selectedLinkId);showStatus('请先选择一个知识点或关系线。')};
$('mLinkBtn').onclick=()=>{if(state.selectedNodeId){const n=nodeById(state.selectedNodeId);state.linkSourceId=state.linkSourceId===state.selectedNodeId?null:state.selectedNodeId;showStatus(state.linkSourceId?`“${n.title}”已设为连线起点，请单击另一个知识点建立关系。`:'已取消连线起点。');render();return}if(state.selectedLinkId){openLinkModal(state.selectedLinkId);return}showStatus('请先点击一个知识点作为连线起点。')};
$('hideHelpBtn').onclick=()=>$('helpCard').classList.add('hide');
$('closeFlashcardBtn').onclick=closeFlashcards;
$('flashToolsToggle').onclick=toggleFlashTools;
$('flashCurrentBtn').onclick=()=>{flashMode='current';currentFlashIndex=0;setFlashToolsExpanded(false);renderFlashcards()};
$('flashLibraryBtn').onclick=()=>{flashMode='library';currentFlashIndex=0;setFlashToolsExpanded(false);renderFlashcards()};
$('flashImportedBtn').onclick=()=>{flashMode='imported';currentFlashIndex=0;setFlashToolsExpanded(false);renderFlashcards()};
$('flashDueBtn').onclick=()=>{flashDueOnly=!flashDueOnly;currentFlashIndex=0;setFlashToolsExpanded(false);renderFlashcards()};
$('flashImportantBtn').onclick=()=>{flashImportantOnly=!flashImportantOnly;currentFlashIndex=0;setFlashToolsExpanded(false);renderFlashcards()};
$('flashShuffleBtn').onclick=()=>{flashShuffle=!flashShuffle;currentFlashIndex=0;setFlashToolsExpanded(false);renderFlashcards()};
$('flashGuideBtn').onclick=()=>{$('flashImportGuide').classList.toggle('show');setFlashToolsExpanded(false)};
$('flashImportBtn').onclick=()=>{setFlashToolsExpanded(false);$('flashImportFile').click()};
$('flashAddMissingBtn').onclick=()=>{setFlashToolsExpanded(false);addAllMissingFlashcardsToCanvas()};
$('flashTemplateBtn').onclick=()=>{setFlashToolsExpanded(false);downloadFlashcardTemplate()};
$('flashSwipeSpeed').addEventListener('input',e=>setFlashSwipeSpeed(e.target.value));
$('flashImportFile').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{await importFlashcardFile(f)}catch(err){alert('闪卡导入失败：'+(err.message||err))}e.target.value=''});

$('cancelTemplateBtn').onclick=()=>$('templateModal').classList.remove('show');
document.querySelectorAll('.template-card').forEach(card=>card.addEventListener('click',()=>{const kind=card.dataset.template;if(confirm('使用模板会替换当前图谱。确定继续吗？')){state=templateState(kind);normalizeState();$('templateModal').classList.remove('show');fitView(true);showStatus('模板已载入。')}}));
document.addEventListener('keydown',e=>{if(e.key==='Escape'){for(const id of ['nodeModal','linkModal','graphModal','templateModal','flashcardModal']){if($(id).classList.contains('show')){$(id).classList.remove('show');return}}clearSelection();return}if(e.key!=='Delete'&&e.key!=='Backspace')return;if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;if(state.selectedLinkId){if(typeof pushGraphUndoSnapshot==='function')pushGraphUndoSnapshot('删除关系线');state.links=state.links.filter(l=>l.id!==state.selectedLinkId);state.selectedLinkId=null;render({persist:true});showStatus('已删除选中的关系线。')}else if(selectedNodeIds&&selectedNodeIds.size>1&&typeof deleteSelectedNodesBatch==='function'){deleteSelectedNodesBatch()}else if(state.selectedNodeId){deleteNode(state.selectedNodeId)}else if(selectedNodeIds&&selectedNodeIds.size&&typeof deleteSelectedNodesBatch==='function'){deleteSelectedNodesBatch()}});
function graphMinZoom(){return typeof graphViewportMinScale==='function'?graphViewportMinScale():.01}
function graphMaxZoom(){return typeof graphViewportMaxScale==='function'?graphViewportMaxScale():4}
function setZoomAtStageCenter(scale,persist=true){
  if(typeof cancelGraphSmoothZoom==='function')cancelGraphSmoothZoom();
  const r=stage.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,before=screenToWorld(cx,cy),ns=clamp(Number(scale)||1,graphMinZoom(),graphMaxZoom());
  state.viewport.scale=ns;
  state.viewport.x=cx-r.left-before.x*ns;
  state.viewport.y=cy-r.top-before.y*ns;
  if(persist){
    viewportDirty=true;
    applyTransform();
    scheduleViewportCommit();
  }else{
    applyTransform();
  }
}
function animateZoomAtStageCenter(scale,persist=true,options={}){
  const r=stage.getBoundingClientRect();
  const cx=r.left+r.width/2,cy=r.top+r.height/2;
  const before=screenToWorld(cx,cy);
  const ns=clamp(Number(scale)||1,graphMinZoom(),graphMaxZoom());
  animateViewportTo({
    scale:ns,
    x:cx-r.left-before.x*ns,
    y:cy-r.top-before.y*ns
  },persist,{duration:options.duration??360});
}
function zoomAtCenter(factor){setZoomAtStageCenter(state.viewport.scale*factor,true)}
function zoomAtCenterStep(direction){
  if(typeof smoothGraphButtonZoomAtStageCenter==='function'){
    smoothGraphButtonZoomAtStageCenter(direction);
    return;
  }
  const current=state.viewport.scale||1;
  const next=typeof nextGraphButtonZoomScale==='function'?nextGraphButtonZoomScale(current,direction):current*(direction>0?1.25:.75);
  animateZoomAtStageCenter(next,true,{duration:230});
}
function zoomPercentValue(){return Math.round((state.viewport.scale||1)*100)}
function updateCanvasStatusChipPosition(){
  const stageEl=$('stage'),dock=$('canvasZoomDock');
  if(!stageEl||!dock||!dock.getBoundingClientRect)return;
  const stageRect=stageEl.getBoundingClientRect(),dockRect=dock.getBoundingClientRect();
  if(!stageRect.width||!dockRect.width)return;
  const left=Math.ceil(dockRect.right-stageRect.left+12);
  const maxWidth=Math.max(220,Math.floor(stageRect.width-left-16));
  stageEl.style.setProperty('--canvas-status-left',left+'px');
  stageEl.style.setProperty('--canvas-status-max-width',maxWidth+'px');
}
function updateCanvasZoomControls(){
  const percent=$('canvasZoomPercentBtn'),slider=$('canvasZoomSlider');
  const value=zoomPercentValue();
  if(percent)percent.textContent=value+'%';
  if(slider){
    const min=Math.round(graphMinZoom()*100),max=Math.round(graphMaxZoom()*100);
    if(slider.min!==String(min))slider.min=String(min);
    if(slider.max!==String(max))slider.max=String(max);
    if(document.activeElement!==slider)slider.value=String(clamp(value,min,max));
  }
  updateCanvasStatusChipPosition();
}
window.updateCanvasZoomControls=updateCanvasZoomControls;
function showCanvasZoomSlider(show=true){
  const dock=$('canvasZoomDock'),popover=$('canvasZoomSliderPopover');
  if(!dock||!popover)return;
  dock.classList.toggle('slider-open',!!show);
  popover.setAttribute('aria-hidden',show?'false':'true');
}
function resetCanvasZoomTo100(){
  animateZoomAtStageCenter(1,true,{duration:360});
  showStatus('缩放已平滑恢复 100%。');
}
function updateCanvasFullscreenButton(){
  const btn=$('canvasFullscreenBtn'),active=document.fullscreenElement===stage;
  if(!btn)return;
  btn.classList.toggle('active-toggle',!!active);
  btn.setAttribute('aria-label',active?'退出全屏':'全屏显示画布');
  btn.setAttribute('title',active?'退出全屏':'全屏');
}
function toggleCanvasFullscreen(){
  if(!document.fullscreenElement){
    const request=stage.requestFullscreen||stage.webkitRequestFullscreen;
    if(request)request.call(stage);
    else showStatus('当前浏览器不支持全屏。');
  }else{
    const exit=document.exitFullscreen||document.webkitExitFullscreen;
    if(exit)exit.call(document);
  }
}
function isZoomShortcutBlocked(target){
  if(typeof isTextEditingTarget==='function'&&isTextEditingTarget(target))return true;
  const el=target&&target.closest&&target.closest('input,textarea,select,[contenteditable]');
  if(el)return true;
  return !!document.querySelector('.modal-backdrop.show,.related-canvas-backdrop,.edge-inline-label-editor.show');
}
function handleCanvasZoomShortcut(event){
  if(event.defaultPrevented||event.repeat||event.ctrlKey||event.metaKey||event.altKey||isZoomShortcutBlocked(event.target))return;
  const key=String(event.key||'');
  if(key==='-'||key==='_'){
    event.preventDefault();event.stopPropagation();zoomAtCenterStep(-1);
  }else if(key==='+'||key==='='){
    event.preventDefault();event.stopPropagation();zoomAtCenterStep(1);
  }
}
function initCanvasZoomDock(){
  const dock=$('canvasZoomDock'),out=$('zoomOutBtn'),inn=$('zoomInBtn'),percent=$('canvasZoomPercentBtn'),slider=$('canvasZoomSlider'),fit=$('canvasFitBtn'),full=$('canvasFullscreenBtn');
  if(!dock||dock.dataset.bound==='1')return;
  dock.dataset.bound='1';
  out&&out.addEventListener('click',e=>{e.preventDefault();zoomAtCenterStep(-1)});
  inn&&inn.addEventListener('click',e=>{e.preventDefault();zoomAtCenterStep(1)});
  percent&&percent.addEventListener('click',e=>{e.preventDefault();resetCanvasZoomTo100();showCanvasZoomSlider(true)});
  slider&&slider.addEventListener('input',e=>{showCanvasZoomSlider(true);setZoomAtStageCenter(Number(e.target.value)/100,true)});
  slider&&slider.addEventListener('pointerdown',e=>e.stopPropagation());
  fit&&fit.addEventListener('click',e=>{e.preventDefault();fitView(true)});
  full&&full.addEventListener('click',e=>{e.preventDefault();toggleCanvasFullscreen()});
  document.addEventListener('pointerdown',e=>{if(dock.classList.contains('slider-open')&&!dock.contains(e.target))showCanvasZoomSlider(false)},true);
  document.addEventListener('fullscreenchange',()=>{updateCanvasFullscreenButton();setTimeout(()=>updateCanvasZoomControls(),80)});
  document.addEventListener('webkitfullscreenchange',()=>{updateCanvasFullscreenButton();setTimeout(()=>updateCanvasZoomControls(),80)});
  window.addEventListener('resize',()=>setTimeout(updateCanvasZoomControls,40));
  if(typeof ResizeObserver==='function')new ResizeObserver(()=>updateCanvasStatusChipPosition()).observe(dock);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')showCanvasZoomSlider(false)});
  document.addEventListener('keydown',handleCanvasZoomShortcut);
  updateCanvasZoomControls();
  updateCanvasFullscreenButton();
}
function selectedNodesForFitView(){
  const ids=new Set();
  if(selectedNodeIds&&selectedNodeIds.size)selectedNodeIds.forEach(id=>ids.add(id));
  if(state.selectedNodeId)ids.add(state.selectedNodeId);
  return [...ids].map(id=>nodeById(id)).filter(Boolean);
}
function boundsForNodes(nodes){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  nodes.forEach(n=>{
    const p=typeof visualPositionForNode==='function'?visualPositionForNode(n):{x:n.x,y:n.y};
    const d=nodeDims(n);
    minX=Math.min(minX,p.x);
    minY=Math.min(minY,p.y);
    maxX=Math.max(maxX,p.x+d.w);
    maxY=Math.max(maxY,p.y+d.h);
  });
  return{minX,minY,maxX,maxY,w:Math.max(1,maxX-minX),h:Math.max(1,maxY-minY)};
}
let fitViewAnimationFrame=0;
function easeViewportFit(t){return 1-Math.pow(1-t,3)}
function animateViewportTo(target,persist=false,options={}){
  if(typeof cancelGraphSmoothZoom==='function')cancelGraphSmoothZoom();
  const start={x:state.viewport.x||0,y:state.viewport.y||0,scale:state.viewport.scale||1};
  const duration=options.duration??360;
  const distance=Math.hypot((target.x||0)-start.x,(target.y||0)-start.y)+Math.abs((target.scale||1)-start.scale)*180;
  const reduceMotion=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduceMotion||duration<=0||distance<1){
    if(fitViewAnimationFrame)cancelAnimationFrame(fitViewAnimationFrame);
    fitViewAnimationFrame=0;
    state.viewport={x:target.x,y:target.y,scale:target.scale};
    render({persist});
    return;
  }
  if(fitViewAnimationFrame)cancelAnimationFrame(fitViewAnimationFrame);
  const started=performance.now();
  stage.classList.add('viewport-fitting');
  const step=now=>{
    const t=clamp((now-started)/duration,0,1),k=easeViewportFit(t);
    state.viewport.x=start.x+(target.x-start.x)*k;
    state.viewport.y=start.y+(target.y-start.y)*k;
    state.viewport.scale=start.scale+(target.scale-start.scale)*k;
    if(typeof applyTransform==='function')applyTransform();
    else render();
    if(t<1){
      fitViewAnimationFrame=requestAnimationFrame(step);
    }else{
      fitViewAnimationFrame=0;
      state.viewport={x:target.x,y:target.y,scale:target.scale};
      stage.classList.remove('viewport-fitting');
      render({persist});
    }
  };
  fitViewAnimationFrame=requestAnimationFrame(step);
}
function normalizeFitBoundsArgs(persist,options){
  if(persist&&typeof persist==='object'&&!Array.isArray(persist)){
    return{persist:false,options:persist};
  }
  return{persist:!!persist,options:options||{}};
}
function viewportForBounds(bounds,options={}){
  const r=stage.getBoundingClientRect(),margin=options.margin??(isCoarse?90:140);
  const usableW=Math.max(120,r.width-margin),usableH=Math.max(120,r.height-margin);
  const minScale=options.minScale??.25,maxScale=options.maxScale??1.5;
  const scale=clamp(Math.min(usableW/bounds.w,usableH/bounds.h),minScale,maxScale);
  return{
    scale,
    x:(r.width-(bounds.minX+bounds.maxX)*scale)/2,
    y:(r.height-(bounds.minY+bounds.maxY)*scale)/2
  };
}
function fitBoundsToView(bounds,persist=false,options={}){
  const args=normalizeFitBoundsArgs(persist,options);
  animateViewportTo(viewportForBounds(bounds,args.options),args.persist,{duration:args.options.duration??360});
}
function fitView(persist=false){
  if(!state.nodes.length){
    const r=stage.getBoundingClientRect();
    animateViewportTo({x:r.width/2,y:r.height/2,scale:1},persist,{duration:300});
    return;
  }
  const selected=selectedNodesForFitView();
  if(selected.length){
    const maxScale=selected.length===1?2:1.75,margin=isCoarse?100:190;
    fitBoundsToView(boundsForNodes(selected),persist,{margin,minScale:.35,maxScale});
    showStatus(selected.length===1?`已居中并放大“${selected[0].title||'选中卡牌'}”。`:`已居中并缩放 ${selected.length} 张选中卡牌。`);
    return;
  }
  fitBoundsToView(boundsForNodes(state.nodes),persist,{margin:isCoarse?(typeof GRAPH_FIT_ALL_COARSE_MARGIN==='number'?GRAPH_FIT_ALL_COARSE_MARGIN:130):(typeof GRAPH_FIT_ALL_DESKTOP_MARGIN==='number'?GRAPH_FIT_ALL_DESKTOP_MARGIN:240),minScale:graphMinZoom(),maxScale:1.5});
  showStatus('已完整显示全画布，并保留舒适留白。');
}
function truncate(s,n){s=String(s||'');return s.length>n?s.slice(0,n-1)+'…':s}
function escapeHTML(s){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function tint(hex,amount){const h=safeColor(hex).replace('#',''),n=parseInt(h.length===3?h.split('').map(c=>c+c).join(''):h,16);let r=n>>16&255,g=n>>8&255,b=n&255;r=Math.round(r+(255-r)*amount);g=Math.round(g+(255-g)*amount);b=Math.round(b+(255-b)*amount);return`rgb(${r}, ${g}, ${b})`}
function showStatus(msg){clearTimeout(showStatus.t);statusEl.textContent=msg;statusEl.classList.add('show');showStatus.t=setTimeout(()=>statusEl.classList.remove('show'),2600)}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function mid(a,b){return{x:(a.x+b.x)/2,y:(a.y+b.y)/2}}
