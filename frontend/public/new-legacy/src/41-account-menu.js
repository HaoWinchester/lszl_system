'use strict';

/*
 * C-1.4.4：桌面端账号胶囊 + 移动端顶部吸附账号入口。
 * 移动端入口显示“账号”，菜单项使用两字短标签；桌面端保留完整名称。
 */
(function(){
  const $=id=>document.getElementById(id);
  let shell=null;
  let trigger=null;
  let menu=null;
  let userCenterBtn=null;
  let helpBtn=null;
  let upgradeBtn=null;
  let sessionBtn=null;
  let exitBtn=null;

  function isLoggedIn(){
    const runtime=window.KGAuthRuntime;
    if(runtime&&typeof runtime.isLoggedIn==='function')return !!runtime.isLoggedIn();
    const auth=window.KGAuthCore;
    if(auth&&typeof auth.currentUser==='function')return !!auth.currentUser();
    return false;
  }
  function menuItems(){
    if(!menu)return [];
    return [...menu.querySelectorAll('[role="menuitem"]:not([disabled])')]
      .filter(item=>!item.hidden&&getComputedStyle(item).display!=='none');
  }
  function setOpen(open,{focusFirst=false}={}){
    if(!shell||!trigger||!menu)return;
    open=!!open;
    shell.classList.toggle('is-open',open);
    trigger.setAttribute('aria-expanded',String(open));
    menu.hidden=!open;
    if(open){
      refresh();
      if(focusFirst)requestAnimationFrame(()=>{
        const first=menuItems()[0];
        if(first)first.focus();
      });
    }
  }
  function open(options){setOpen(true,options)}
  function close({restoreFocus=false}={}){
    const wasOpen=!!(shell&&shell.classList.contains('is-open'));
    setOpen(false);
    if(restoreFocus&&wasOpen&&trigger)trigger.focus();
  }
  function toggle(){
    if(!shell)return;
    setOpen(!shell.classList.contains('is-open'));
  }
  function refresh(){
    if(!sessionBtn)return;
    const loggedIn=isLoggedIn();
    sessionBtn.classList.toggle('is-logout',loggedIn);
    sessionBtn.classList.toggle('is-login',!loggedIn);
    const label=sessionBtn.querySelector('.account-menu-item-label,[data-account-session-label]')
      || [...sessionBtn.querySelectorAll('span')].find(item=>!item.matches('[data-kg-icon],[data-account-session-icon]'));
    const sessionIcon=sessionBtn.querySelector('[data-account-session-icon]');
    if(sessionIcon&&window.KGLearningIcons){
      sessionIcon.dataset.kgIcon=loggedIn?'log-out':'log-in';
      delete sessionIcon.dataset.kgIconHydrated;
      window.KGLearningIcons.hydrate(sessionIcon);
    }
    if(label){
      label.textContent=loggedIn?'退出登录':'登录';
      label.dataset.mobileLabel=loggedIn?'退出':'登录';
    }
    sessionBtn.setAttribute('aria-label',loggedIn?'退出登录':'登录');
    sessionBtn.title=loggedIn?'退出登录':'登录';
    if(userCenterBtn)userCenterBtn.setAttribute('aria-label','用户中心');
    if(helpBtn)helpBtn.setAttribute('aria-label','帮助中心');
    if(upgradeBtn)upgradeBtn.setAttribute('aria-label','升级会员');
  }
  function openUserCenter(){
    close();
    if(window.KGUserCenter&&typeof window.KGUserCenter.open==='function'){
      window.KGUserCenter.open();
      return;
    }
    const login=$('authLoginBtn');
    if(login)login.click();
  }
  function openHelp(){
    close();
    const explicit=String(shell?.dataset.accountHelpHref||helpBtn?.dataset.accountHelpHref||'').trim();
    if(explicit&&window.location){window.location.href=explicit;return}
    if(typeof window.startGuidedTour==='function'){
      window.startGuidedTour(true);
      return;
    }
    if(typeof window.openTutorial==='function'){
      window.openTutorial();
      return;
    }
    const legacy=$('tutorialBtn');
    if(legacy&&legacy.dataset.accountMenuBoundHelp==='1'){legacy.click();return}
    const href=String(shell?.dataset.accountHelpHref||helpBtn?.dataset.accountHelpHref||'multi-question-help.html').trim();
    if(href&&window.location){window.location.href=href;return}
  }
  function exitPage(){
    close();
    const fallback=String(shell?.dataset.accountExitHref||exitBtn?.dataset.accountExitHref||'question-training.html').trim()||'question-training.html';
    if(window.KGPracticeNavigation&&typeof window.KGPracticeNavigation.goBack==='function'){
      window.KGPracticeNavigation.goBack(fallback);
      return;
    }
    try{
      if(window.history&&window.history.length>1){window.history.back();return}
    }catch(e){}
    if(window.location)window.location.href=fallback;
  }
  function openUpgrade(){
    close();
    if(window.KGUserCenter&&typeof window.KGUserCenter.openSubscriptionDetail==='function'){
      window.KGUserCenter.openSubscriptionDetail();
      return;
    }
    const legacy=$('upgradeMemberBtn');
    if(legacy)legacy.click();
  }
  function toggleSession(){
    const loggedIn=isLoggedIn();
    close();
    const runtime=window.KGAuthRuntime;
    if(loggedIn){
      if(runtime&&typeof runtime.logout==='function')runtime.logout();
      else if(typeof window.authLogout==='function')window.authLogout();
      else{const logout=$('authLogoutBtn');if(logout)logout.click()}
      return;
    }
    if(runtime&&typeof runtime.openAuth==='function')runtime.openAuth();
    else if(typeof window.authOpen==='function')window.authOpen();
    else{const login=$('authLoginBtn');if(login)login.click()}
  }
  function onTriggerKeydown(event){
    if(event.key==='ArrowDown'){
      event.preventDefault();
      open({focusFirst:true});
    }else if(event.key==='Escape'){
      event.preventDefault();
      close();
    }
  }
  function onMenuKeydown(event){
    const items=menuItems();
    const index=items.indexOf(document.activeElement);
    if(event.key==='Escape'){
      event.preventDefault();
      close({restoreFocus:true});
      return;
    }
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      const step=event.key==='ArrowDown'?1:-1;
      const next=index<0?0:(index+step+items.length)%items.length;
      if(items[next])items[next].focus();
    }
  }
  function init(){
    shell=$('accountMenuShell');
    trigger=$('authStatus');
    menu=$('accountMenu');
    userCenterBtn=$('accountMenuUserCenterBtn');
    helpBtn=$('accountMenuHelpBtn');
    upgradeBtn=$('accountMenuUpgradeBtn');
    sessionBtn=$('accountMenuSessionBtn');
    exitBtn=$('accountMenuExitBtn');
    if(!shell||!trigger||!menu||!userCenterBtn||!helpBtn||!sessionBtn)return;
    if(shell.dataset.accountMenuBound==='1')return;
    shell.dataset.accountMenuBound='1';

    trigger.addEventListener('click',event=>{
      event.preventDefault();
      event.stopPropagation();
      toggle();
    });
    trigger.addEventListener('keydown',onTriggerKeydown);
    menu.addEventListener('keydown',onMenuKeydown);
    userCenterBtn.addEventListener('click',openUserCenter);
    helpBtn.addEventListener('click',openHelp);
    if(upgradeBtn)upgradeBtn.addEventListener('click',openUpgrade);
    if(exitBtn)exitBtn.addEventListener('click',exitPage);
    sessionBtn.addEventListener('click',toggleSession);

    document.addEventListener('click',event=>{
      if(shell&&!shell.contains(event.target))close();
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
    refresh();
  }

  window.KGAccountMenu={open,close,toggle,refresh};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
