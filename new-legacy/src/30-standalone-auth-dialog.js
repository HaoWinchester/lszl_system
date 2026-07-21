'use strict';

/*
 * StandaloneAuthDialog v1
 * 为不加载图谱编辑器或训练页运行时的独立页面提供登录、注册、退出和弹窗控制。
 */
(function(global){
  const core=()=>global.KGAuthCore||null;
  const byId=id=>document.getElementById(id);
  let initialized=false;

  function toast(message){
    const status=byId('status');
    if(!status){console.info(message);return}
    clearTimeout(toast.timer);
    status.textContent=String(message||'');
    status.classList.add('show');
    toast.timer=setTimeout(()=>status.classList.remove('show'),2800);
  }
  function message(text='',ok=false){
    const element=byId('authMsg');
    if(!element)return;
    element.textContent=String(text||'');
    element.classList.toggle('ok',!!ok);
  }
  function currentUser(){
    try{return core()?.currentUser?.()||null}catch(error){return null}
  }
  function currentUsername(){
    try{return String(currentUser()?.username||core()?.currentUsername?.()||'')}catch(error){return ''}
  }
  function isLoggedIn(){return !!currentUser()}
  function open(reason='该操作需要登录后才能使用。'){
    const modal=byId('authModal');
    if(!modal)return false;
    const reasonElement=byId('authReason');
    if(reasonElement)reasonElement.textContent=String(reason||'登录后可以继续操作。');
    message('');
    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');
    setTimeout(()=>byId('authUsername')?.focus?.(),60);
    return true;
  }
  function close(){
    const modal=byId('authModal');
    if(!modal)return false;
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden','true');
    return true;
  }
  function renderStatus(){
    const user=currentUser();
    const status=byId('authStatus');
    const login=byId('authLoginBtn');
    const logout=byId('authLogoutBtn');
    const roleApi=global.KGRolePermissions;
    try{roleApi?.applyTheme?.()}catch(error){}
    if(status){
      if(roleApi?.renderStatus)roleApi.renderStatus(status);
      else status.textContent=user?'已登录：'+String(user.displayName||user.username):'未登录 · 访客只读';
      const provider=core()?.providerStatus?.();
      status.title=provider?.remote?'后端认证模式':'本地演示认证模式；正式部署请切换后端认证';
    }
    if(login)login.style.display=user?'none':'inline-flex';
    if(logout)logout.style.display=user?'inline-flex':'none';
    document.body?.classList.toggle('auth-readonly',!user);
    return !!user;
  }
  function readCredentials(){
    return {
      username:String(byId('authUsername')?.value||''),
      password:String(byId('authPassword')?.value||'')
    };
  }
  function cleanUsername(value){
    return core()?.cleanUsername?.(value)||String(value||'').trim().replace(/\s+/g,'_').slice(0,32);
  }
  function setBusy(busy){
    ['authDoLoginBtn','authRegisterBtn'].forEach(id=>{const button=byId(id);if(button)button.disabled=!!busy});
  }
  async function login(username,password){
    const auth=core();
    if(!auth){message('认证模块未加载，请刷新页面后重试。');return false}
    username=cleanUsername(username);password=String(password||'');
    if(!username||!password){message('请输入用户名和密码。');return false}
    setBusy(true);message('正在验证账号…');
    try{
      const result=typeof auth.login==='function'
        ?await auth.login(username,password,{source:'多题归纳画布登录'})
        :{ok:false,message:'当前认证核心不支持统一登录接口。'};
      if(!result?.ok){message(result?.message||'登录失败，请重试。');return false}
      close();renderStatus();
      toast('已登录：'+String(result.user?.displayName||result.user?.username||username));
      return true;
    }catch(error){message(String(error?.message||error||'登录失败，请重试。'));return false}
    finally{setBusy(false)}
  }
  async function register(username,password){
    const auth=core();
    if(!auth){message('认证模块未加载，请刷新页面后重试。');return false}
    username=cleanUsername(username);password=String(password||'');
    if(username.length<2){message('用户名至少需要 2 个字符。');return false}
    if(password.length<4){message('密码至少需要 4 个字符。');return false}
    setBusy(true);message('正在创建账号…');
    try{
      const result=typeof auth.register==='function'
        ?await auth.register(username,password,{source:'多题归纳画布注册'})
        :{ok:false,message:'当前认证核心不支持统一注册接口。'};
      if(!result?.ok){message(result?.message||'注册失败，请重试。');return false}
      close();renderStatus();
      toast('已注册并登录：'+String(result.user?.displayName||result.user?.username||username));
      return true;
    }catch(error){message(String(error?.message||error||'注册失败，请重试。'));return false}
    finally{setBusy(false)}
  }
  async function logout(){
    const auth=core();
    const username=currentUsername();
    setBusy(true);
    try{
      if(typeof auth?.logout==='function')await auth.logout({source:'多题归纳画布退出'});
      else auth?.clearSession?.();
      close();renderStatus();
      toast(username?'已退出：'+username+'。当前为访客只读。':'当前为访客只读。');
      return true;
    }finally{setBusy(false)}
  }
  function afterExternalLogin(username,messageText='第三方登录成功'){
    username=cleanUsername(username);
    if(!username)return false;
    if(core()?.currentUsername?.()!==username)core()?.setCurrentUsername?.(username);
    close();
    renderStatus();
    toast(messageText+'：'+username);
    return true;
  }
  function bind(){
    if(initialized)return;
    const modal=byId('authModal');
    if(!modal)return;
    initialized=true;
    modal.setAttribute('aria-hidden',modal.classList.contains('show')?'false':'true');
    byId('authLoginBtn')?.addEventListener('click',()=>open('登录后可以编辑多题画布、拖入题目、框选并整体移动题目卡。'));
    byId('authLogoutBtn')?.addEventListener('click',logout);
    byId('authCloseBtn')?.addEventListener('click',close);
    byId('authDoLoginBtn')?.addEventListener('click',()=>{const value=readCredentials();login(value.username,value.password)});
    byId('authRegisterBtn')?.addEventListener('click',()=>{const value=readCredentials();register(value.username,value.password)});
    ['authUsername','authPassword'].forEach(id=>{
      byId(id)?.addEventListener('keydown',event=>{
        if(event.key!=='Enter')return;
        event.preventDefault();
        const value=readCredentials();
        login(value.username,value.password);
      });
    });
    modal.addEventListener('click',event=>{if(event.target===modal)close()});
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&modal.classList.contains('show')){event.preventDefault();close()}
    });
    global.addEventListener('kg-auth-session-change',renderStatus);
    renderStatus();
  }

  global.authOpen=open;
  global.authClose=close;
  global.authIsLoggedIn=isLoggedIn;
  global.authLogout=logout;
  global.KGAuthRuntime={
    ...(global.KGAuthRuntime||{}),
    openAuth:open,
    closeAuth:close,
    renderStatus,
    isLoggedIn,
    currentUsername,
    afterExternalLogin
  };
  global.KGStandaloneAuthDialog=Object.freeze({bind,open,close,login,register,logout,renderStatus,isLoggedIn,currentUsername});

  document.addEventListener('DOMContentLoaded',bind);
  global.addEventListener('load',()=>setTimeout(bind,0));
})(window);
