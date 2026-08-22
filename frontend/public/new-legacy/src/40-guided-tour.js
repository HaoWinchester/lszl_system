'use strict';

/*
 * 本文件由原单文件 HTML 自动拆分而来。
 * 维护建议：继续把本文件中的强耦合函数逐步迁移为显式模块 API。
 */

function openTutorial(){
  const modal=$('tutorialModal');if(!modal)return;
  modal.classList.add('show');
}
function closeTutorial(){
  const modal=$('tutorialModal');if(!modal)return;
  modal.classList.remove('show');
}
function bindTutorial(){
  const openBtn=$('tutorialBtn'),closeBtn=$('closeTutorialBtn'),bottomBtn=$('tutorialCloseBottomBtn'),startBtn=$('tutorialStartAddBtn'),modal=$('tutorialModal');
  if(openBtn)openBtn.onclick=e=>{e.preventDefault();startGuidedTour(true)};
  if(closeBtn)closeBtn.onclick=closeTutorial;
  if(bottomBtn)bottomBtn.onclick=closeTutorial;
  if(startBtn)startBtn.onclick=()=>{closeTutorial();openNodeModal()};
  if(modal)modal.addEventListener('click',e=>{if(e.target===modal)closeTutorial()});
}

bindTutorial();

const TOUR_STORAGE_KEY='通用知识点关系图谱工具_新手引导已看_v1';
let guidedTourState=null;
const guidedTourSteps=[
  {target:'#graphMetaDisplay',title:'图谱与文件',text:'顶部显示当前图谱名称；文件页签用于切换不同图谱，搜索按钮可快速定位知识点。',tip:'登录后双击图谱名称可编辑图谱信息。'},
  {target:'#floatingToolbox',title:'左侧悬浮工具',text:'新增、模板、聚焦、闪卡、题库、样式、导入导出等操作都集中在左侧菜单。',tip:'按住顶部六点手柄可以移动菜单。'},
  {target:'#addBtn',title:'创建第一张知识卡',text:'点击新增知识点，填写名称、分类、难度、关键词和说明。保存后卡牌会出现在画布中央。',tip:'先创建 3～5 个核心知识点，再建立关系。'},
  {target:'#stage',title:'统一画布操作',text:'左键用于选择和编辑；滚轮缩放；右键拖动或按住空格再拖动可以平移画布。',tip:'右键轻点会打开画布或图元快捷菜单。'},
  {target:'.knowledge-card',fallback:'#stage',title:'卡牌与关系线',text:'单击卡牌查看详情，拖动调整位置；使用工具栏“连线”或卡牌连接手柄建立关系。',tip:'再次单击已选卡牌可原位编辑文字。'},
  {target:'#stage',title:'直接框选全部图元',text:'在画布空白处直接拖出选框，无需按 Shift。框选可以同时命中知识节点、文本框和关系线。',tip:'按 Ctrl/Command 或 Shift 框选可追加选择。'},
  {target:'#stage',title:'筛选与整体移动',text:'混合框选后，使用悬浮栏里的“多选（N）”只保留一种图元；拖动选区或任意已选卡牌可整体移动。',tip:'已有选框时，可直接在选框外开始新的框选。'},
  {target:'#stage',title:'拖动时自动轻量化',text:'整体移动期间只绘制简单关系线，并暂时隐藏箭头、描边、控制点和辅助线；松开后自动恢复。',tip:'这能让关系较多的图谱保持流畅。'},
  {target:'#focusBtn',title:'聚焦与复习',text:'重点聚焦用于突出核心节点；记忆闪卡用于翻面和滑动复习。',tip:'两种复习入口分别保存显示状态。'},
  {target:'#exportBtn',title:'备份与恢复',text:'定期导出学习包 ZIP。导入学习包可在换电脑或换浏览器后恢复图谱。',tip:'导入和清空会修改数据，需要登录。'},
  {target:'#authStatus',title:'帮助、反馈与消息',text:'点击右上角账号区域进入帮助中心、提交反馈或查看消息。帮助中心也包含教师后台和四种学习模式说明。',tip:'完成后仍可随时重新播放本引导。'}
]
function ensureGuidedTourLayer(){
  let layer=$('guidedTourLayer');
  if(layer)return layer;
  layer=document.createElement('div');
  layer.id='guidedTourLayer';
  layer.className='guided-tour-layer guided-tour-no-clone';
  layer.innerHTML=`
    <div class="guided-tour-dim"></div>
    <div class="guided-tour-spotlight"><div class="guided-tour-pulse"></div></div>
    <div class="guided-tour-card">
      <div class="guided-tour-step"></div>
      <h3 class="guided-tour-title"></h3>
      <p class="guided-tour-text"></p>
      <div class="guided-tour-tip"></div>
      <div class="guided-tour-progress"></div>
      <div class="guided-tour-actions">
        <button class="tour-skip" type="button">跳过</button>
        <button class="tour-prev" type="button">上一步</button>
        <button class="tour-next" type="button">下一步</button>
      </div>
    </div>`;
  document.body.appendChild(layer);
  layer.querySelector('.tour-skip').onclick=()=>finishGuidedTour(true);
  layer.querySelector('.tour-prev').onclick=()=>moveGuidedTour(-1);
  layer.querySelector('.tour-next').onclick=()=>moveGuidedTour(1);
  layer.querySelector('.guided-tour-dim').onclick=()=>finishGuidedTour(true);
  return layer;
}
function isVisibleElement(el){
  if(!el)return false;
  const rect=el.getBoundingClientRect(),style=getComputedStyle(el);
  return rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility!=='hidden';
}
function guidedTargetForStep(step){
  let el=step.target?document.querySelector(step.target):null;
  if((!el||!isVisibleElement(el))&&step.fallback)el=document.querySelector(step.fallback);
  if(!el||!isVisibleElement(el))el=stage||document.body;
  return el;
}
function clearGuidedRaised(){
  document.querySelectorAll('.guided-tour-target-raised').forEach(el=>el.classList.remove('guided-tour-target-raised'));
}
function clearGuidedClone(){
  document.querySelectorAll('#guidedTourFocusClone,.guided-tour-focus-clone').forEach(el=>el.remove());
}
function setGuidedTourPageState(active){
  const tutorial=$('tutorialModal');
  if(tutorial)tutorial.classList.remove('show');
  const help=$('helpCard');
  if(help)help.classList.toggle('guided-tour-temporary-hidden',!!active);
  document.body.classList.toggle('guided-tour-active',!!active);
}
function guidedClamp(v,min,max){
  return Math.max(min,Math.min(max,v));
}
function placeGuidedTour(){
  if(!guidedTourState)return;
  const layer=ensureGuidedTourLayer(),step=guidedTourSteps[guidedTourState.index],target=guidedTargetForStep(step);
  clearGuidedRaised();
  clearGuidedClone();

  const rawRect=target.getBoundingClientRect();
  const viewportPad=10,pad=8;
  const safeRect=(rawRect.width>0&&rawRect.height>0)?rawRect:{
    left:viewportPad,
    top:viewportPad,
    width:window.innerWidth-viewportPad*2,
    height:window.innerHeight-viewportPad*2
  };
  const left=guidedClamp(safeRect.left-pad,viewportPad,Math.max(viewportPad,window.innerWidth-viewportPad-70));
  const top=guidedClamp(safeRect.top-pad,viewportPad,Math.max(viewportPad,window.innerHeight-viewportPad-46));
  const width=Math.max(70,Math.min(window.innerWidth-viewportPad*2,safeRect.width+pad*2));
  const height=Math.max(46,Math.min(window.innerHeight-viewportPad*2,safeRect.height+pad*2));
  const radius=(target.classList&&target.classList.contains('knowledge-card'))?'24px':'20px';

  const spot=layer.querySelector('.guided-tour-spotlight');
  spot.style.left=left+'px';
  spot.style.top=top+'px';
  spot.style.width=width+'px';
  spot.style.height=height+'px';
  spot.style.borderRadius=radius;

  // 修复重点：不再 clone / 复制当前高亮目标。
  // 只用透明聚光框显示原页面内容，避免出现第二层菜单、文字或按钮面板。
  const card=layer.querySelector('.guided-tour-card');
  const margin=14,gap=16,cardW=Math.min(390,window.innerWidth-margin*2);
  card.style.width=cardW+'px';
  const cardH=Math.min(card.offsetHeight||260,window.innerHeight-margin*2);

  const clampLeft=v=>guidedClamp(v,margin,Math.max(margin,window.innerWidth-cardW-margin));
  const clampTop=v=>guidedClamp(v,margin,Math.max(margin,window.innerHeight-cardH-margin));
  const candidates=[
    {name:'below',left:clampLeft(left),top:top+height+gap},
    {name:'above',left:clampLeft(left),top:top-cardH-gap},
    {name:'right',left:left+width+gap,top:clampTop(top)},
    {name:'left',left:left-cardW-gap,top:clampTop(top)},
    {name:'bottom',left:clampLeft((window.innerWidth-cardW)/2),top:window.innerHeight-cardH-margin}
  ];
  const fits=p=>p.left>=margin&&p.top>=margin&&p.left+cardW<=window.innerWidth-margin&&p.top+cardH<=window.innerHeight-margin;
  const chosen=candidates.find(fits)||{
    name:'safe',
    left:clampLeft(candidates[0].left),
    top:clampTop(candidates[0].top)
  };
  card.dataset.placement=chosen.name;
  card.style.left=chosen.left+'px';
  card.style.top=chosen.top+'px';
}

function renderGuidedTour(){
  if(!guidedTourState)return;
  const layer=ensureGuidedTourLayer(),step=guidedTourSteps[guidedTourState.index];
  clearGuidedClone();
  layer.classList.add('show');
  layer.querySelector('.guided-tour-step').textContent=`第 ${guidedTourState.index+1} / ${guidedTourSteps.length} 步`;
  layer.querySelector('.guided-tour-title').textContent=step.title;
  layer.querySelector('.guided-tour-text').textContent=step.text;
  layer.querySelector('.guided-tour-tip').textContent=step.tip||'';
  layer.querySelector('.tour-prev').disabled=guidedTourState.index===0;
  layer.querySelector('.tour-next').textContent=guidedTourState.index===guidedTourSteps.length-1?'完成':'下一步';
  layer.querySelector('.guided-tour-progress').innerHTML=guidedTourSteps.map((_,i)=>`<span class="guided-tour-dot ${i<=guidedTourState.index?'active':''}"></span>`).join('');
  setTimeout(placeGuidedTour,30);
}
function startGuidedTour(force=false){
  const store=window.KGAppStorage;
  if(!force&&((store&&store.readString?store.readString(TOUR_STORAGE_KEY,''):localStorage.getItem(TOUR_STORAGE_KEY))==='1'))return;
  setGuidedTourPageState(true);
  guidedTourState={index:0,force};
  ensureGuidedTourLayer();
  renderGuidedTour();
}
function moveGuidedTour(delta){
  if(!guidedTourState)return;
  const next=guidedTourState.index+delta;
  if(next>=guidedTourSteps.length){finishGuidedTour(false);return}
  guidedTourState.index=Math.max(0,Math.min(guidedTourSteps.length-1,next));
  renderGuidedTour();
}
function finishGuidedTour(skipped=false){
  const layer=$('guidedTourLayer');
  if(layer)layer.classList.remove('show');
  clearGuidedRaised();
  clearGuidedClone();
  setGuidedTourPageState(false);
  guidedTourState=null;
  {const store=window.KGAppStorage;if(store&&store.writeString)store.writeString(TOUR_STORAGE_KEY,'1');else localStorage.setItem(TOUR_STORAGE_KEY,'1');}
  if(!skipped)showStatus('新手引导完成。你可以随时从右上角账号菜单进入“帮助中心”再次查看。');
}
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&guidedTourState)finishGuidedTour(true)});
window.addEventListener('resize',()=>{if(guidedTourState)placeGuidedTour()});
window.addEventListener('scroll',()=>{if(guidedTourState)placeGuidedTour()},true);
document.getElementById('guidedTourStartBtn')?.addEventListener('click',()=>startGuidedTour(true));
let guidedTourAutostartTimer=0;
let guidedTourClaimInFlight=null;
function hasAuthenticatedGuidedTourSession(){
  const user = window.KGAuthCore?.currentUser?.()
  return Boolean(user && user.username && user.username !== 'guest');
}
async function scheduleAutoGuidedTour(){
  clearTimeout(guidedTourAutostartTimer);
  // Guests may browse membership plans.  The guided layer must never block
  // that public path; it is only an automatic first-run aid after login.
  if(!hasAuthenticatedGuidedTourSession())return;
  if(guidedTourState)return;
  if(document.querySelector('.kg-learning-entry-dialog.show')){
    guidedTourAutostartTimer=window.setTimeout(scheduleAutoGuidedTour,160);
    return;
  }
  const store=window.KGServerStateStorage;
  if(typeof store?.claimGuidedTour!=='function'||guidedTourClaimInFlight)return;
  guidedTourClaimInFlight=true;
  try{
    const claim=await store.claimGuidedTour();
    if(claim?.claimed)startGuidedTour(true);
  }catch(error){
    console.warn('[guided-tour] 无法保存首次引导状态',error);
  }finally{
    guidedTourClaimInFlight=null;
  }
}
function startGuidedTourAfterLearningEntry(){
  const waiter=window.KGDirectEntry?.waitForInitialLearningEntry;
  if(typeof waiter!=='function'){scheduleAutoGuidedTour();return}
  Promise.resolve(waiter()).then(result=>{
    if(result?.shown)return;
    scheduleAutoGuidedTour();
  }).catch(scheduleAutoGuidedTour);
}
window.addEventListener('kg-learning-entry-dialog-closed',()=>{if(!guidedTourState)scheduleAutoGuidedTour()});
window.addEventListener('kg-learning-entry-dialog-opened',()=>clearTimeout(guidedTourAutostartTimer));
guidedTourAutostartTimer=window.setTimeout(startGuidedTourAfterLearningEntry,0);
