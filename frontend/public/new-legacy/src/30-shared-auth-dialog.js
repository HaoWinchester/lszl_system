'use strict';

/*
 * SharedAuthDialog v1
 * 自由模式与做题模式共用的登录弹窗模板和通用交互控制器。
 * 页面业务只通过可选回调接入，不在这里读取图谱或练习状态。
 */
(function(global){
  const byId=id=>document.getElementById(id);
  const ownHandlers={};
  const state={
    mounted:false,
    boundModal:null,
    globalBound:false,
    busy:false,
    options:{
      defaultReason:'未登录时只能查看图谱，登录后可以新增、编辑、连线和保存自己的内容。',
      source:'共享登录弹窗'
    }
  };

  function core(){return global.KGAuthCore||null}
  function configure(options={}){
    if(options&&typeof options==='object')Object.assign(state.options,options);
    return api;
  }
  function template(){
    return `<div class="modal-backdrop auth-backdrop" id="authModal" aria-hidden="true">
      <div aria-labelledby="authTitle" aria-modal="true" class="modal auth-modal" role="dialog">
        <div class="auth-head">
          <div>
            <h2 id="authTitle">登录后可编辑</h2>
            <p id="authReason">未登录时只能查看图谱，登录后可以新增、编辑、连线和保存自己的内容。</p>
          </div>
          <button class="auth-close" id="authCloseBtn" title="关闭登录窗口" type="button" aria-label="关闭登录窗口">×</button>
        </div>
        <div class="auth-body">
          <label>用户名
            <input autocomplete="username" id="authUsername" placeholder="请输入用户名"/>
          </label>
          <label>密码
            <input autocomplete="current-password" id="authPassword" placeholder="请输入密码" type="password"/>
          </label>
          <div class="auth-msg" id="authMsg"></div>
          <div class="auth-actions">
            <button class="primary" id="authDoLoginBtn" type="button">登录</button>
            <button id="authRegisterBtn" type="button">注册并登录</button>
          </div>
          <div class="auth-note">当前为本地单文件多用户：账号和数据保存在本浏览器 localStorage 中。不同用户的数据互相隔离；如需跨设备/真正安全登录，需要后续接入服务器。</div>
        </div>
      </div>
    </div>`;
  }
  function mount(options={}){
    configure(options);
    const root=byId('authDialogRoot');
    if(!root)return false;
    if(!byId('authModal'))root.innerHTML=template();
    state.mounted=!!byId('authModal');
    if(state.mounted){bind();renderStatus()}
    return state.mounted;
  }
  function message(text='',ok=false){
    const element=byId('authMsg');
    if(!element)return false;
    element.textContent=String(text||'');
    element.classList.toggle('ok',!!ok);
    return true;
  }
  function setBusy(busy){
    state.busy=!!busy;
    ['authDoLoginBtn','authRegisterBtn'].forEach(id=>{
      const button=byId(id);
      if(button){button.disabled=state.busy;button.setAttribute('aria-busy',String(state.busy))}
    });
    return state.busy;
  }
  function currentUser(){
    try{return core()?.currentUser?.()||null}catch(error){return null}
  }
  function currentUsername(){
    try{return String(currentUser()?.username||core()?.currentUsername?.()||'')}catch(error){return ''}
  }
  function isLoggedIn(){return !!currentUser()}
  function open(reason){
    if(!state.mounted&&!mount())return false;
    const modal=byId('authModal');
    if(!modal)return false;
    const reasonElement=byId('authReason');
    if(reasonElement)reasonElement.textContent=String(reason||state.options.defaultReason);
    message('');
    modal.classList.add('show');
    modal.setAttribute('aria-hidden','false');
    byId('authUsername')?.focus?.();
    return true;
  }
  function close(){
    const modal=byId('authModal');
    if(!modal)return false;
    modal.classList.remove('show','wechat-login-mode');
    modal.setAttribute('aria-hidden','true');
    const panel=modal.querySelector('.wechat-login-panel');
    if(panel){panel.hidden=true;panel.innerHTML=''}
    message('');
    return true;
  }
  function readCredentials(){
    const auth=core();
    const rawUsername=String(byId('authUsername')?.value||'');
    return {
      username:auth?.cleanUsername?.(rawUsername)||rawUsername.trim().replace(/\s+/g,'_').slice(0,32),
      password:String(byId('authPassword')?.value||'')
    };
  }
  function handlerFor(kind){
    if(typeof state.options[kind]==='function')return state.options[kind];
    const globalName='auth'+kind[0].toUpperCase()+kind.slice(1);
    const legacy=global[globalName];
    if(typeof legacy==='function'&&legacy!==ownHandlers[kind])return legacy;
    const auth=core();
    if(typeof auth?.[kind]==='function')return (...args)=>auth[kind](...args);
    return null;
  }
  async function runCredentialAction(kind){
    if(state.busy)return false;
    const credentials=readCredentials();
    if(kind==='login'&&(!credentials.username||!credentials.password)){
      message('请输入用户名和密码。');
      return false;
    }
    if(kind==='register'&&credentials.username.length<2){
      message('用户名至少需要 2 个字符。');
      return false;
    }
    if(kind==='register'&&credentials.password.length<4){
      message('密码至少需要 4 个字符。');
      return false;
    }
    const handler=handlerFor(kind);
    if(!handler){message('认证模块未加载，请刷新页面后重试。');return false}
    setBusy(true);
    message(kind==='register'?'正在创建账号…':'正在验证账号…');
    try{
      const result=await handler(credentials.username,credentials.password,{source:state.options.source});
      const ok=result===true||!!result?.ok;
      if(!ok){
        if(!String(byId('authMsg')?.textContent||'').trim()||String(byId('authMsg')?.textContent||'').includes('正在')){
          message(result?.message||(kind==='register'?'注册失败，请重试。':'登录失败，请重试。'));
        }
        return false;
      }
      close();
      renderStatus();
      if(typeof state.options.afterSuccess==='function')state.options.afterSuccess(kind,result);
      return true;
    }catch(error){
      message(String(error?.message||error||(kind==='register'?'注册失败，请重试。':'登录失败，请重试。')));
      return false;
    }finally{setBusy(false)}
  }
  function login(){return runCredentialAction('login')}
  function register(){return runCredentialAction('register')}
  async function logout(){
    if(state.busy)return false;
    const handler=handlerFor('logout');
    if(!handler){message('认证模块未加载，请刷新页面后重试。');return false}
    setBusy(true);
    try{
      const result=await handler({source:state.options.source});
      if(result===false||result?.ok===false){
        if(result?.message)message(result.message);
        return false;
      }
      close();
      renderStatus();
      if(typeof state.options.afterSuccess==='function')state.options.afterSuccess('logout',result);
      return true;
    }catch(error){
      message(String(error?.message||error||'退出失败，请重试。'));
      return false;
    }finally{setBusy(false)}
  }
  function renderStatus(){
    if(typeof state.options.renderStatus==='function')return state.options.renderStatus();
    const user=currentUser();
    const status=byId('authStatus');
    document.body?.classList.toggle('auth-readonly',!user);
    if(status){
      const accountTrigger=String(status.dataset.accountMenuTrigger||'').toLowerCase()==='true';
      if(accountTrigger){
        const label=status.querySelector('.account-menu-trigger-label,.auth-status-label');
        if(label)label.textContent=user?String(user.displayName||user.username):'访客';
        status.classList.toggle('logged-in',!!user);
      }else status.textContent=user?'已登录：'+String(user.displayName||user.username):'未登录 · 访客只读';
      const provider=core()?.providerStatus?.();
      status.title=provider?.remote?'后端认证模式':'本地演示认证模式；正式部署请切换后端认证';
    }
    const loginButton=byId('authLoginBtn'),logoutButton=byId('authLogoutBtn');
    if(loginButton)loginButton.hidden=!!user;
    if(logoutButton)logoutButton.hidden=!user;
    try{global.KGAccountMenu?.refresh?.()}catch(error){}
    return !!user;
  }
  function afterExternalLogin(username,messageText='第三方登录成功'){
    close();
    renderStatus();
    if(typeof state.options.afterExternalLogin==='function')return state.options.afterExternalLogin(username,messageText);
    return !!username;
  }
  function bind(){
    const modal=byId('authModal');
    if(!modal||state.boundModal===modal)return;
    state.boundModal=modal;
    byId('authCloseBtn')?.addEventListener('click',close);
    byId('authDoLoginBtn')?.addEventListener('click',login);
    byId('authRegisterBtn')?.addEventListener('click',register);
    ['authUsername','authPassword'].forEach(id=>{
      byId(id)?.addEventListener('keydown',event=>{
        if(event.key!=='Enter')return;
        event.preventDefault();
        login();
      });
    });
    modal.addEventListener('click',event=>{if(event.target===modal)close()});
    if(!state.globalBound){
      state.globalBound=true;
      document.addEventListener('keydown',event=>{
        const currentModal=byId('authModal');
        if(event.key==='Escape'&&currentModal?.classList.contains('show')){event.preventDefault();close()}
      });
      global.addEventListener('kg-auth-session-change',renderStatus);
    }
  }

  const api={mount,configure,open,close,message,setBusy,login,register,logout,renderStatus,isLoggedIn,currentUsername,afterExternalLogin};
  ownHandlers.login=login;
  ownHandlers.register=register;
  ownHandlers.logout=logout;
  global.KGSharedAuthDialog=Object.freeze(api);
  global.authOpen=open;
  global.authClose=close;
  global.authIsLoggedIn=isLoggedIn;
  global.authLogout=logout;
  global.KGAuthRuntime={
    ...(global.KGAuthRuntime||{}),
    openAuth:open,
    closeAuth:close,
    logout,
    renderStatus,
    isLoggedIn,
    currentUsername,
    afterExternalLogin
  };
  mount();
})(window);
