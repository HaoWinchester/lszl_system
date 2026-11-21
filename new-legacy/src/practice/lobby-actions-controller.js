// 做题大厅改版交互控制器：
// - 头部“练习题量 / 答题顺序”下拉驱动隐藏的单选组（#practiceCountOptions / #practiceOrderOptions），
//   状态仍由 100-practice-mode.js 的 syncCountOptions 等逻辑统一维护，这里只做 UI 代理。
// - 模式 tab 切换底部操作栏中对应模式的真实 [data-practice-start] 按钮（只有激活模式的按钮可见）。
// - 底部摘要行同步“模式 · 题量 · 顺序”。
(function(global,document){
  'use strict';
  const tabs=[...document.querySelectorAll('[data-practice-tab]')];
  if(!tabs.length)return;
  const MODE_LABELS={practice:'普通练习',challenge:'挑战模式',scholar:'学霸模式',revenge:'复仇模式'};
  const shells={count:document.getElementById('practiceCountOptions'),order:document.getElementById('practiceOrderOptions')};
  const summary=document.getElementById('practiceActionBarSummary');
  const revengeStrip=document.getElementById('practiceRevengeStrip');
  let activeMode='practice';
  const dropdowns={};

  function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
  function inputLabel(input){const span=input?.closest('label')?.querySelector('span');return span?span.textContent.trim():input?.value||''}
  function inputs(name,shell){return [...(shell||document).querySelectorAll(`input[name="${name}"]`)]}
  function checkedLabel(name,shell){const list=inputs(name,shell);const current=list.find(input=>input.checked)||list[0];return current?inputLabel(current):''}

  function makeDropdown(key,name,shell){
    const trigger=document.querySelector(`[data-config-dropdown="${key}"]`);
    const root=trigger?.closest('.practice-config-dropdown');
    const menu=root?.querySelector(`[data-config-menu="${key}"]`);
    const value=root?.querySelector('.practice-config-value');
    if(!root||!menu||!trigger||!shell)return null;
    let openState=false;
    const refresh=()=>{
      const list=inputs(name,shell),current=list.find(input=>input.checked)||list[0];
      if(current)value.textContent=inputLabel(current);
      menu.innerHTML=list.map(input=>`<button type="button" class="practice-config-option${input.checked?' is-selected':''}" role="option" aria-selected="${String(!!input.checked)}" data-value="${escapeHTML(input.value)}"${input.disabled?' disabled':''}>${escapeHTML(inputLabel(input))}</button>`).join('');
      if(openState)refreshSummary();
    };
    const close=()=>{if(openState){openState=false;menu.hidden=true;trigger.setAttribute('aria-expanded','false')}};
    const open=()=>{refresh();openState=true;menu.hidden=false;trigger.setAttribute('aria-expanded','true')};
    trigger.addEventListener('click',()=>{openState?close():open()});
    menu.addEventListener('click',event=>{
      const option=event.target.closest('[data-value]');if(!option||option.disabled)return;
      const input=inputs(name,shell).find(item=>item.value===option.dataset.value);
      if(!input)return;
      // 通过原生 click() 走 change 事件，保证主逻辑（syncCountOptions 等）正常同步。
      if(!input.checked)input.click();
      close();
    });
    document.addEventListener('click',event=>{if(!root.contains(event.target))close()});
    document.addEventListener('keydown',event=>{if(event.key==='Escape')close()});
    // 隐藏单选组的状态由主逻辑以属性/文本方式更新，这里监听变化保持下拉与摘要同步。
    shell.addEventListener('change',refresh);
    new MutationObserver(refresh).observe(shell,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['checked','disabled']});
    refresh();
    return {
      refresh,
      close,
      setDisabled(disabled){trigger.disabled=!!disabled;root.classList.toggle('is-disabled',!!disabled)}
    };
  }

  function refreshSummary(){
    if(!summary)return;
    const parts=[MODE_LABELS[activeMode]];
    const count=activeMode==='revenge'?'':checkedLabel('practiceCount',shells.count);
    if(count)parts.push(count);
    parts.push(activeMode==='revenge'?'重练错题':checkedLabel('practiceOrder',shells.order));
    summary.textContent=parts.join(' · ');
  }

  function setMode(mode){
    const tab=tabs.find(item=>item.dataset.practiceTab===mode);
    if(!tab)return;
    activeMode=mode;
    tabs.forEach(item=>{
      const active=item===tab;
      item.classList.toggle('is-active',active);
      item.setAttribute('aria-selected',String(active));
      item.setAttribute('tabindex',active?'0':'-1');
    });
    document.querySelectorAll('[data-mode-actions]').forEach(wrapper=>{wrapper.hidden=wrapper.dataset.modeActions!==mode});
    if(revengeStrip)revengeStrip.hidden=mode!=='revenge';
    refreshSummary();
  }

  tabs.forEach(tab=>tab.addEventListener('click',()=>setMode(tab.dataset.practiceTab)));

  // 双击试卷直接进入普通练习：有未完成一轮时先询问（继续/新开一轮），否则直接开始。
  const library=document.getElementById('practicePaperLibrary');
  library?.addEventListener('dblclick',event=>{
    if(document.body.dataset.practiceView!=='lobby')return;
    const card=event.target.closest('[data-paper-id]');
    if(!card)return;
    event.preventDefault();
    if(!card.classList.contains('is-selected'))card.click();
    const startButton=document.querySelector('[data-practice-start="practice"]');
    const freshButton=document.querySelector('[data-practice-new="practice"]');
    if(!startButton||startButton.disabled)return;
    // 当前题量对该试卷不可用（如默认 10 题但试卷只有 2 题）时，自动切到“全部”再开始。
    const checkedCount=document.querySelector('[name="practiceCount"]:checked');
    if(checkedCount&&checkedCount.disabled)document.querySelector('[name="practiceCount"][value="all"]')?.click();
    const confirmDialog=global.KGDialogs?.confirm;
    if(freshButton&&!freshButton.hidden&&typeof confirmDialog==='function'){
      const match=/(\d+)\s*\/\s*(\d+)/.exec(startButton.textContent||'');
      const detail=match?`已保存 ${match[1]}/${match[2]} 题。`:'';
      confirmDialog(`这份试卷有一轮未完成的普通练习，${detail}是否继续？`,{danger:false}).then(ok=>{
        if(ok)startButton.click();
        else freshButton.click();
      });
      return;
    }
    startButton.click();
  });
  dropdowns.count=makeDropdown('count','practiceCount',shells.count);
  dropdowns.order=makeDropdown('order','practiceOrder',shells.order);
  setMode('practice');

  // 题量下拉的“全部（N 题）”文案等由主逻辑异步更新，兜底轮询保持同步（仅大厅视图时开销极小）。
  global.setInterval?.(()=>{if(document.body.dataset.practiceView==='lobby'){dropdowns.count?.refresh();dropdowns.order?.refresh();refreshSummary()}},1500);
})(window,document);
