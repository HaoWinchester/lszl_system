'use strict';
(function(global){
  const byId=id=>document.getElementById(id);
  let toastTimer=0;
  let accountServices=null;
  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}
  function formatTime(value){const date=new Date(value);return Number.isNaN(date.getTime())?String(value||''):date.toLocaleString('zh-CN',{hour12:false})}
  function toast(message,error=false){const el=byId('adminToast');if(!el)return;el.textContent=message;el.classList.toggle('error',!!error);el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3600)}
  function roleLabel(role){return ({admin:'管理员',teacher:'教师/教研',student:'学员',viewer:'游客'}[role]||role||'访客')}
  function account(services=global.KGAdminServices){
    accountServices=services||accountServices;
    const user=accountServices?.permissions?.currentUser?.()||global.KGAuthCore?.currentUser?.()||null;
    const el=byId('adminAccount');
    if(el)el.textContent=user?`${user.displayName||user.username} · ${roleLabel(user.role)}`:'访客只读';
    const trigger=byId('adminAccountTrigger');
    if(trigger)trigger.title=user?`当前账号：${user.displayName||user.username}（${roleLabel(user.role)}）`:'当前为访客只读';
    return user;
  }
  function renderReleaseVersion(){
    const release=String(document.documentElement?.dataset?.release||'').trim();
    const topbar=document.querySelector('.admin-topbar');
    if(!release||!topbar)return null;
    let badge=document.querySelector('.admin-release-version');
    if(!badge){
      badge=document.createElement('span');
      badge.className='admin-release-version';
      const accountMenu=byId('adminAccountMenu');
      if(accountMenu)topbar.insertBefore(badge,accountMenu);else topbar.appendChild(badge);
    }
    badge.textContent=release;
    badge.title=`当前后台版本：${release}`;
    badge.setAttribute('aria-label',`当前后台版本 ${release}`);
    return badge;
  }
  function currentPage(){return document.body?.dataset?.adminPage||document.body?.dataset?.adminContext||''}
  function markNavigation(){const page=currentPage();document.querySelectorAll('[data-admin-nav]').forEach(link=>link.classList.toggle('active',link.dataset.adminNav===page))}
  function closeAccountMenu({focus=false}={}){
    const trigger=byId('adminAccountTrigger'),popover=byId('adminAccountPopover');if(!trigger||!popover)return;
    popover.hidden=true;trigger.setAttribute('aria-expanded','false');byId('adminAccountMenu')?.classList.remove('open');if(focus)trigger.focus();
  }
  function openAccountMenu({focusFirst=false}={}){
    const trigger=byId('adminAccountTrigger'),popover=byId('adminAccountPopover');if(!trigger||!popover)return;
    account();popover.hidden=false;trigger.setAttribute('aria-expanded','true');byId('adminAccountMenu')?.classList.add('open');
    if(focusFirst)requestAnimationFrame(()=>popover.querySelector('[role="menuitem"]')?.focus());
  }
  function toggleAccountMenu(){const popover=byId('adminAccountPopover');if(!popover)return;popover.hidden?openAccountMenu():closeAccountMenu()}
  function helpCopy(){
    const base={
      overview:['总览用于查看科目、知识树、题库、试卷与任务的整体状态。','需要继续处理的事项会集中显示在“需要关注”区域。'],
      subjects:['左侧选择科目，右侧维护当前知识树、科目级联想库与历史版本。','题目待分类继续在教师工作台的题目管理中处理；联想库采用草稿与正式发布分离。'],
      operations:['操作记录集中展示管理端审计、知识树生命周期和安全删除记录。','这里用于追溯“谁在什么时间做了什么”，不承担业务数据编辑。'],
      settings:['系统设置分为业务配置与技术诊断。','普通管理员通常只需使用基础系统设置；技术诊断用于排查数据与引用状态。']
    };
    return base[currentPage()]||['管理后台顶部导航在滚动时保持可见，可随时切换业务模块。','账号胶囊用于进入用户中心、查看后台帮助或退出登录。'];
  }
  function ensureHelpDialog(){
    let backdrop=byId('adminHelpDialog');if(backdrop)return backdrop;
    backdrop=document.createElement('div');backdrop.id='adminHelpDialog';backdrop.className='admin-help-backdrop';backdrop.hidden=true;
    backdrop.innerHTML=`<section class="admin-help-dialog" role="dialog" aria-modal="true" aria-labelledby="adminHelpTitle"><header><div><p>ADMIN HELP</p><h2 id="adminHelpTitle">后台帮助中心</h2><span>这里仅说明管理后台的常用操作，不会跳转到学员端帮助。</span></div><button type="button" id="adminHelpCloseBtn" aria-label="关闭">×</button></header><div class="admin-help-body"><section><h3>当前页面</h3><ul id="adminHelpCurrentPage"></ul></section><section><h3>后台导航</h3><div class="admin-help-nav-grid"><span><b>科目与知识树</b>维护科目及当前知识树</span><span><b>教师工作台</b>录题、训练配置与试卷发布</span><span><b>用户管理</b>账号、角色与状态维护</span><span><b>操作记录</b>审计和生命周期追溯</span></div></section><p class="admin-help-note">顶部导航与账号胶囊会在滚动时保持可见，长页面中无需返回页面顶部。</p></div><footer><button type="button" id="adminHelpDoneBtn">知道了</button></footer></section>`;
    document.body.appendChild(backdrop);
    const close=()=>{backdrop.hidden=true};
    byId('adminHelpCloseBtn')?.addEventListener('click',close);byId('adminHelpDoneBtn')?.addEventListener('click',close);
    backdrop.addEventListener('click',event=>{if(event.target===backdrop)close()});
    return backdrop;
  }
  function openHelp(){
    closeAccountMenu();const dialog=ensureHelpDialog();const list=byId('adminHelpCurrentPage');if(list)list.innerHTML=helpCopy().map(item=>`<li>${escapeHtml(item)}</li>`).join('');dialog.hidden=false;byId('adminHelpCloseBtn')?.focus();
  }
  function openUserCenter(){
    closeAccountMenu();if(global.KGUserCenter&&typeof global.KGUserCenter.open==='function'){global.KGUserCenter.open();return}toast('用户中心组件未加载，请刷新页面后重试。',true)
  }
  async function logout(){
    closeAccountMenu();try{if(global.KGAuthCore?.logout)await global.KGAuthCore.logout({source:'管理后台账号菜单'});else global.KGAuthCore?.clearSession?.();}catch(error){console.warn('管理后台退出登录失败',error)}
    global.location.href='index.html';
  }
  function bindAccountMenu(){
    const shell=byId('adminAccountMenu'),trigger=byId('adminAccountTrigger'),popover=byId('adminAccountPopover');if(!shell||!trigger||!popover||shell.dataset.bound==='1')return;shell.dataset.bound='1';
    trigger.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();toggleAccountMenu()});
    trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();openAccountMenu({focusFirst:true})}else if(event.key==='Escape'){event.preventDefault();closeAccountMenu()}});
    popover.addEventListener('keydown',event=>{const items=[...popover.querySelectorAll('[role="menuitem"]')].filter(item=>!item.hidden);const index=items.indexOf(document.activeElement);if(event.key==='Escape'){event.preventDefault();closeAccountMenu({focus:true})}else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const step=event.key==='ArrowDown'?1:-1;items[(Math.max(index,0)+step+items.length)%items.length]?.focus()}});
    byId('adminAccountUserCenterBtn')?.addEventListener('click',openUserCenter);byId('adminAccountHelpBtn')?.addEventListener('click',openHelp);byId('adminAccountLogoutBtn')?.addEventListener('click',logout);
    document.addEventListener('click',event=>{if(!shell.contains(event.target))closeAccountMenu()});
    global.addEventListener('blur',()=>closeAccountMenu());global.addEventListener('resize',()=>closeAccountMenu());
    global.addEventListener('kg-auth-session-change',()=>setTimeout(()=>account(),0));global.addEventListener('kg-user-profile-updated',()=>setTimeout(()=>account(),0));
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!byId('adminHelpDialog')?.hidden){byId('adminHelpDialog').hidden=true}});
  }
  function init(services=global.KGAdminServices){renderReleaseVersion();account(services);markNavigation();bindAccountMenu()}
  global.KGAdminUI=Object.freeze({byId,escapeHtml,formatTime,toast,account,renderReleaseVersion,markNavigation,openHelp,init});
})(window);
