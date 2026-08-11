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
// C-1.4.2：不再在页面首次加载时自动启动全屏引导。
// 本项目经常通过解压 ZIP / file:// 直接运行，不同路径可能让浏览器把它视为新的存储环境，
// 从而反复触发引导遮罩并拦截画布顶部左右悬浮模块的鼠标操作。
// 用户仍可通过右上角账号菜单的“帮助中心”主动启动完整引导。

const TOUR_STORAGE_KEY='通用知识点关系图谱工具_新手引导已看_v1';
let guidedTourState=null;
const guidedTourSteps=[
  {target:'#graphMetaDisplay',title:'顶部保留图谱信息',text:'顶部只显示图谱名称，旁边的放大镜可打开搜索定位。登录后双击图谱名称即可编辑图谱信息。',tip:'也可以选中后按 Enter 键打开编辑窗口。'},
  {target:'#floatingToolbox',title:'左侧悬浮操作菜单',text:'原顶部操作按钮已集中到左侧图标菜单，包含新增、模板、聚焦、闪卡、题库、样式、缩放、导入导出和清空。',tip:'鼠标停留在图标上会显示功能名称。'},
  {target:'#floatingToolboxHandle',title:'拖动菜单到合适位置',text:'按住菜单顶部的六点拖拽手柄即可移动，位置会保存在当前浏览器中。',tip:'移动端继续使用底部操作栏，避免遮挡画布。'},
  {target:'#addBtn',title:'第一步：新增知识点',text:'点击加号图标可以创建一张知识卡牌。你可以填写分类、难度、关键词、说明和学习提示。',tip:'新手建议先创建 3～5 个核心知识点，再开始连线。'},
  {target:'#stage',title:'这是知识图谱画布',text:'画布中会显示所有知识点卡片和关系线。拖动画布空白处可以平移，滚轮或双指可以缩放。',tip:'画布就像一张无限大的白板。'},
  {target:'.knowledge-card',fallback:'#stage',title:'知识点卡牌怎么操作',text:'单击卡牌查看详情；拖动卡牌调整位置；双击卡牌会设为连线起点，再单击另一个卡牌即可建立关系。',tip:'如果当前还没有卡牌，这一步会先高亮画布区域。'},
  {target:'#detailPanel',fallback:'#stage',title:'这里会显示卡牌详情',text:'选中卡牌后，详情窗口会展示分类、难度、关键词、说明和学习提示。详情窗口上的操作按钮默认收起，点击箭头可展开。',tip:'移动端详情窗口默认在屏幕上方，避免遮挡底部手势。'},
  {target:'#focusBtn',title:'重点聚焦',text:'点击靶心图标后，系统会突出重点、难点、易错点，适合课堂讲解、冲刺复习或快速回顾。',tip:'重点卡牌会更醒目，普通卡牌会弱化。'},
  {target:'#flashcardBtn',title:'记忆闪卡',text:'点击卡片图标进入复习窗口。点击闪卡翻面，向左滑表示记不清，向右滑表示记住了。',tip:'闪卡窗口里还可以一键把未出现在画布中的闪卡批量加入图谱。'},
  {target:'#stage',title:'框选多个卡片',text:'电脑端按住 Shift，在画布空白处拖拽，可以框选多个卡片。框选后拖动任意选中卡片，可以整体移动一组选中的知识点。',tip:'这是整理大图谱布局时最有用的功能之一。'},
  {target:'#exportBtn',title:'导入导出与备份',text:'左侧菜单下方提供导入、导出和清空图标。建议经常导出学习包 ZIP 保存备份。',tip:'导入和清空会修改数据，因此需要登录。'},
  {target:'#authStatus',title:'帮助中心入口',text:'以后如果忘记操作，可以点击右上角账号胶囊，再从下拉菜单进入“帮助中心”重新播放引导。',tip:'点击“完成”后，下次进入页面不会自动弹出。'}
];
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
