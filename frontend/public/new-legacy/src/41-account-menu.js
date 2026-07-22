'use strict';

/*
 * 账号入口统一为“账号胶囊 + 就近菜单”。
 * 页面只需提供 .account-menu-shell、[data-account-menu-trigger] 和 role=menu；
 * 登录/退出仍通过隐藏代理按钮转给各页面已有的认证实现，避免复制认证逻辑。
 */
(function(){
  const $=id=>document.getElementById(id);
  const states=[];

  function isLoggedIn(){
    const runtime=window.KGAuthRuntime;
    if(runtime&&typeof runtime.isLoggedIn==='function')return !!runtime.isLoggedIn();
    const auth=window.KGAuthCore;
    if(auth&&typeof auth.currentUser==='function')return !!auth.currentUser();
    return false;
  }
  function menuItems(state){
    if(!state?.menu)return [];
    return [...state.menu.querySelectorAll('[role="menuitem"]:not([disabled])')]
      .filter(item=>!item.hidden&&getComputedStyle(item).display!=='none');
  }
  function stateFor(target){
    if(target instanceof Element){
      return states.find(state=>state.shell===target||state.shell.contains(target))||states[0]||null;
    }
    return states[0]||null;
  }
  function setOpen(state,open,{focusFirst=false}={}){
    if(!state?.shell||!state.trigger||!state.menu)return;
    const expanded=!!open;
    state.shell.classList.toggle('is-open',expanded);
    state.trigger.setAttribute('aria-expanded',String(expanded));
    state.menu.hidden=!expanded;
    if(expanded){
      refresh(state);
      if(focusFirst)requestAnimationFrame(()=>menuItems(state)[0]?.focus());
    }
  }
  function open(target,options={}){setOpen(stateFor(target),true,options)}
  function close(target,{restoreFocus=false}={}){
    if(target===undefined){states.forEach(state=>close(state.shell,{restoreFocus:false}));return}
    const state=stateFor(target);
    const wasOpen=!!state?.shell.classList.contains('is-open');
    setOpen(state,false);
    if(restoreFocus&&wasOpen)state?.trigger.focus();
  }
  function toggle(target){
    const state=stateFor(target);
    if(state)setOpen(state,!state.shell.classList.contains('is-open'));
  }
  function refresh(target){
    const only=target?stateFor(target):null;
    (only?[only]:states).filter(Boolean).forEach(state=>{
      if(!state.sessionBtn)return;
      const loggedIn=isLoggedIn();
      state.sessionBtn.classList.toggle('is-logout',loggedIn);
      state.sessionBtn.classList.toggle('is-login',!loggedIn);
      const label=state.sessionBtn.querySelector('span');
      if(label){
        label.textContent=loggedIn?'退出登录':'登录';
        label.dataset.mobileLabel=loggedIn?'退出':'登录';
      }
      state.sessionBtn.setAttribute('aria-label',loggedIn?'退出登录':'登录');
      state.sessionBtn.title=loggedIn?'退出登录':'登录';
      state.userCenterBtn?.setAttribute('aria-label','用户中心');
      state.helpBtn?.setAttribute('aria-label','帮助中心');
      state.upgradeBtn?.setAttribute('aria-label','升级会员');
    });
  }
  function closeForAction(state){close(state.shell)}
  function openUserCenter(state){
    closeForAction(state);
    if(window.KGUserCenter&&typeof window.KGUserCenter.open==='function'){
      window.KGUserCenter.open();
      return;
    }
    $('authLoginBtn')?.click();
  }
  function openHelp(state){
    closeForAction(state);
    if(typeof window.startGuidedTour==='function'){
      window.startGuidedTour(true);
      return;
    }
    if(typeof window.openTutorial==='function'){
      window.openTutorial();
      return;
    }
    $('tutorialBtn')?.click();
  }
  function openUpgrade(state){
    closeForAction(state);
    if(window.KGUserCenter&&typeof window.KGUserCenter.openSubscriptionDetail==='function'){
      window.KGUserCenter.openSubscriptionDetail();
      return;
    }
    $('upgradeMemberBtn')?.click();
  }
  function toggleSession(state){
    const loggedIn=isLoggedIn();
    closeForAction(state);
    const proxy=$(loggedIn?'authLogoutBtn':'authLoginBtn');
    if(proxy){proxy.click();return}
    const runtime=window.KGAuthRuntime;
    if(loggedIn){
      if(runtime&&typeof runtime.logout==='function')runtime.logout();
      else if(typeof window.authLogout==='function')window.authLogout();
      return;
    }
    if(runtime&&typeof runtime.openAuth==='function')runtime.openAuth('登录后可以新增、编辑、连线和保存自己的图谱。');
    else if(typeof window.authOpen==='function')window.authOpen('登录后可以新增、编辑、连线和保存自己的图谱。');
  }
  function onTriggerKeydown(state,event){
    if(event.key==='ArrowDown'){
      event.preventDefault();
      setOpen(state,true,{focusFirst:true});
    }else if(event.key==='Escape'){
      event.preventDefault();
      close(state.shell);
    }
  }
  function onMenuKeydown(state,event){
    const items=menuItems(state);
    const index=items.indexOf(document.activeElement);
    if(event.key==='Escape'){
      event.preventDefault();
      close(state.shell,{restoreFocus:true});
      return;
    }
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      const step=event.key==='ArrowDown'?1:-1;
      const next=index<0?0:(index+step+items.length)%items.length;
      items[next]?.focus();
    }
  }
  function initShell(shell){
    const trigger=shell.querySelector('[data-account-menu-trigger="true"]');
    const menu=shell.querySelector('[role="menu"]');
    const sessionBtn=menu?.querySelector('[data-account-menu-action="session"],#accountMenuSessionBtn');
    if(!trigger||!menu||!sessionBtn||shell.dataset.accountMenuBound==='1')return;
    const state={
      shell,trigger,menu,sessionBtn,
      userCenterBtn:menu.querySelector('[data-account-menu-action="user-center"],#accountMenuUserCenterBtn'),
      helpBtn:menu.querySelector('[data-account-menu-action="help"],#accountMenuHelpBtn'),
      upgradeBtn:menu.querySelector('[data-account-menu-action="upgrade"],#accountMenuUpgradeBtn')
    };
    shell.dataset.accountMenuBound='1';
    states.push(state);
    trigger.addEventListener('click',event=>{
      event.preventDefault();
      event.stopPropagation();
      toggle(shell);
    });
    trigger.addEventListener('keydown',event=>onTriggerKeydown(state,event));
    menu.addEventListener('keydown',event=>onMenuKeydown(state,event));
    state.userCenterBtn?.addEventListener('click',()=>openUserCenter(state));
    state.helpBtn?.addEventListener('click',()=>openHelp(state));
    state.upgradeBtn?.addEventListener('click',()=>openUpgrade(state));
    sessionBtn.addEventListener('click',()=>toggleSession(state));
    refresh(state);
  }
  function init(){
    document.querySelectorAll('.account-menu-shell').forEach(initShell);
    document.addEventListener('click',event=>{
      states.forEach(state=>{if(!state.shell.contains(event.target))close(state.shell)});
    });
    window.addEventListener('blur',()=>close());
    window.addEventListener('orientationchange',()=>close());
    window.addEventListener('resize',()=>close());
    window.addEventListener('kg-auth-session-change',()=>{close();setTimeout(refresh,0)});
    window.addEventListener('kg-user-profile-updated',()=>setTimeout(refresh,0));
    window.addEventListener('storage',event=>{
      if(!event.key||event.key==='kg_local_current_user_v1'||event.key==='kg_local_users_v1'){
        close();
        setTimeout(refresh,0);
      }
    });
  }

  window.KGAccountMenu={open,close,toggle,refresh};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
