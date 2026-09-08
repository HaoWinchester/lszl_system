'use strict';

/*
 * 微信扫码登录界面。
 * OAuth state、code 换 token、openid/unionid 与账号创建均由后端处理；浏览器只发起授权和展示结果。
 */
(function(){
  const WECHAT_LOGIN_SDK_URL='https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js';

  const DEFAULT_CONFIG={
    enableDemo:true,
    enableOfficial:false,
    autoCreateUser:true,
    appId:'',
    redirectUri:'',
    scope:'snsapi_login',
    defaultRole:'student',
    defaultSubject:'PMP'
  };

  function escapeHTML(value){
    const core=window.KGAuthCore;
    if(core&&typeof core.escapeHTML==='function')return core.escapeHTML(value);
    return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }
  function cleanRole(role){return ['admin','teacher','student','viewer'].includes(String(role))?String(role):'student'}
  function normalizeConfig(config){
    const next={...DEFAULT_CONFIG,...(config&&typeof config==='object'?config:{})};
    next.enableDemo=!!next.enableDemo;
    next.enableOfficial=!!next.enableOfficial;
    next.autoCreateUser=next.autoCreateUser!==false;
    next.appId=String(next.appId||'').trim();
    next.redirectUri=String(next.redirectUri||'').trim();
    next.scope=String(next.scope||'snsapi_login').trim()||'snsapi_login';
    next.defaultRole=cleanRole(next.defaultRole);
    next.defaultSubject=String(next.defaultSubject||'PMP').trim()||'PMP';
    return next;
  }
  let configCache=normalizeConfig(DEFAULT_CONFIG);
  let configLoadPromise=null;
  function getConfig(){return normalizeConfig(configCache)}
  function applyConfig(config){configCache=normalizeConfig(config);return getConfig()}
  function saveConfig(config){
    return applyConfig(config);
  }
  function loadPublicConfig(){
    if(configLoadPromise)return configLoadPromise;
    configLoadPromise=requestJson('/api/v1/auth/wechat/config')
      .then(payload=>applyConfig({
        ...configCache,
        enableOfficial:payload?.mode==='official',
        enableDemo:payload?.mode==='demo',
        scope:payload?.scope||configCache.scope
      }))
      .catch(()=>getConfig())
      .finally(()=>{configLoadPromise=null});
    return configLoadPromise;
  }
  function showToast(message,ok=true){
    if(typeof window.showStatus==='function'){window.showStatus(message);return}
    const el=document.getElementById('authMsg');
    if(el){el.textContent=message;el.classList.toggle('ok',!!ok);return}
    console.info(message);
  }
  function currentReturnPath(){
    return location.pathname+location.search+location.hash;
  }
  async function requestJson(url,options={}){
    const response=await fetch(url,{credentials:'include',headers:{Accept:'application/json',...(options.headers||{})},...options});
    let payload={};
    try{payload=await response.json()}catch(error){}
    if(!response.ok)throw new Error(String(payload.detail||payload.message||`请求失败（${response.status}）`));
    return payload;
  }
  async function createOfficialAuthRequest(intent='login',returnPath=currentReturnPath(),acceptedTermsVersion=''){
    const params=new URLSearchParams({intent:['bind','recover'].includes(String(intent))?String(intent):'login',return_path:returnPath||'/'});
    if(acceptedTermsVersion)params.set('accepted_terms_version',acceptedTermsVersion);
    const payload=await requestJson('/api/v1/auth/wechat/auth-url?'+params.toString());
    if(!payload.authUrl)throw new Error('服务器未返回微信授权地址。');
    return payload;
  }
  async function startOfficialLogin(intent='login',returnPath=currentReturnPath()){
    try{
      const payload=await createOfficialAuthRequest(intent,returnPath);
      location.assign(payload.authUrl);
      return true;
    }catch(error){
      showToast(String(error&&error.message||'微信授权暂不可用，请稍后重试。'),false);
      return false;
    }
  }
  function loadWechatLoginSdk(){
    if(typeof window.WxLogin==='function')return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const existing=document.querySelector('script[data-wechat-login-sdk="true"]');
      if(existing){
        existing.addEventListener('load',resolve,{once:true});
        existing.addEventListener('error',()=>reject(new Error('微信二维码组件加载失败。')),{once:true});
        return;
      }
      const script=document.createElement('script');
      script.src=WECHAT_LOGIN_SDK_URL;
      script.async=true;
      script.dataset.wechatLoginSdk='true';
      script.onload=resolve;
      script.onerror=()=>reject(new Error('微信二维码组件加载失败。'));
      document.head.appendChild(script);
    });
  }
  function getEmbeddedAuthParams(authUrl){
    const params=new URL(authUrl).searchParams;
    const appid=params.get('appid')||'';
    const redirectUri=params.get('redirect_uri')||'';
    const scope=params.get('scope')||'snsapi_login';
    const state=params.get('state')||'';
    if(!appid||!redirectUri||!state)throw new Error('微信授权参数不完整，请重新生成二维码。');
    return {appid,redirectUri,scope,state};
  }
  function setWechatLoginMode(modal,enabled){
    if(!modal)return;
    modal.classList.toggle('wechat-login-mode',!!enabled);
    if(!enabled){
      const panel=modal.querySelector('.wechat-login-panel');
      if(panel){panel.hidden=true;panel.innerHTML=''}
    }
  }
  function bindPasswordLoginReturn(container){
    const back=container.querySelector('.wechat-login-back');
    if(back)back.onclick=()=>setWechatLoginMode(container.closest('#authModal'),false);
  }
  function renderPanelError(container,message){
    container.innerHTML=`<div class="wechat-login-card"><div class="wechat-login-copy"><p>${escapeHTML(message)}</p><button type="button" class="wechat-login-retry">重新生成二维码</button><button type="button" class="wechat-login-back">使用账号密码登录</button></div></div>`;
    container.querySelector('.wechat-login-retry').onclick=()=>renderPanel(container);
    bindPasswordLoginReturn(container);
  }
  async function renderPanel(container){
    if(!container)return;
    const qrId='wechatLoginQr_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
    container.innerHTML=`<div class="wechat-login-card"><div class="wechat-login-copy"><strong>请使用微信扫码</strong><p>在手机上确认后，将自动登录当前页面。</p><div class="wechat-login-qr" id="${qrId}"><span>正在生成微信授权二维码…</span></div><button type="button" class="wechat-login-back">使用账号密码登录</button></div></div>`;
    bindPasswordLoginReturn(container);
    try{
      const [payload]=await Promise.all([createOfficialAuthRequest('login',currentReturnPath(),window.KGAuthRuntime?.legalConsentVersion||''),loadWechatLoginSdk()]);
      if(!container.isConnected)return;
      const auth=getEmbeddedAuthParams(payload.authUrl);
      if(typeof window.WxLogin!=='function')throw new Error('微信二维码组件加载失败。');
      new window.WxLogin({
        self_redirect:false,
        id:qrId,
        appid:auth.appid,
        scope:auth.scope,
        redirect_uri:encodeURIComponent(auth.redirectUri),
        state:encodeURIComponent(auth.state),
        style:'black'
      });
    }catch(error){
      renderPanelError(container,String(error&&error.message||'微信授权暂不可用，请稍后重试。'));
    }
  }
  async function unbind(){
    try{
      const payload=await requestJson('/api/v1/auth/wechat/binding',{method:'DELETE'});
      await window.KGAuthCore?.refreshSession?.();
      window.dispatchEvent(new CustomEvent('kg-wechat-binding-change',{detail:{user:payload.user||null,bound:false}}));
      return {ok:true,user:payload.user||null};
    }catch(error){
      return {ok:false,message:String(error&&error.message||'解除微信绑定失败。')};
    }
  }
  function ensureAuthPanel(){
    const modal=document.getElementById('authModal');
    if(!modal||modal.dataset.wechatLoginBound)return;
    const actions=modal.querySelector('.auth-actions');
    if(!actions)return;
    modal.dataset.wechatLoginBound='1';
    const wrap=document.createElement('div');
    wrap.className='wechat-login-section';
    wrap.innerHTML='<div class="wechat-divider"><span>或使用微信</span></div><p class="wechat-login-hint">首次扫码可绑定已有账号，共用原会员；新用户可选择创建账号。</p><button class="wechat-login-entry" type="button">微信扫码登录</button><div class="wechat-login-panel" hidden></div>';
    actions.insertAdjacentElement('afterend',wrap);
    const entry=wrap.querySelector('.wechat-login-entry');
    const panel=wrap.querySelector('.wechat-login-panel');
    entry.onclick=()=>{
      if(!window.KGAuthRuntime?.requireLegalConsent?.())return;
      setWechatLoginMode(modal,true);panel.hidden=false;renderPanel(panel)
    };
    modal.querySelector('.auth-close')?.addEventListener('click',()=>setWechatLoginMode(modal,false));
  }
  let accountFlow=Promise.resolve();
  let registrationPrompt=null;
  function waitForAccountFlow(){return registrationPrompt||accountFlow}
  function clearCallbackMarker(){
    const params=new URLSearchParams(location.search||'');
    params.delete('wechat');
    const query=params.toString();
    history.replaceState(null,document.title,location.pathname+(query?'?'+query:'')+location.hash);
  }
  function accountDialog(title,copy,body){
    const dialog=document.createElement('dialog');
    dialog.className='wechat-account-dialog';
    dialog.setAttribute('aria-labelledby','wechatAccountTitle');
    dialog.innerHTML=`<h2 id="wechatAccountTitle">${escapeHTML(title)}</h2><p>${escapeHTML(copy)}</p>${body}<p class="wechat-account-error" role="alert"></p>`;
    document.body.appendChild(dialog);
    dialog.showModal();
    return dialog;
  }
  function promptBindingAfterRegister(){
    if(registrationPrompt)return registrationPrompt;
    registrationPrompt=(async()=>{
      const username=window.KGAuthCore?.currentUsername?.();
      if(!username||window.KGAuthCore?.currentUser?.()?.wechat?.bound)return;
      const config=await loadPublicConfig();
      if(window.KGAuthCore?.currentUsername?.()!==username)return;
      return new Promise(resolve=>{
        const dialog=accountDialog('注册成功，绑定微信更方便',
          '绑定后，账号密码和微信登录都进入当前账号，共用会员和学习记录。',
          '<div class="wechat-account-actions"><button type="button" data-bind>立即绑定微信</button><button type="button" data-later>稍后绑定</button></div><p>也可以稍后在用户中心绑定；绑定前请继续用账号密码登录。</p>');
        const finish=()=>{dialog.close();dialog.remove();resolve()};
        dialog.addEventListener('cancel',event=>{event.preventDefault();finish()});
        dialog.querySelector('[data-later]').onclick=finish;
        const bind=dialog.querySelector('[data-bind]');
        if(!config.enableOfficial){
          bind.disabled=true;
          dialog.querySelector('[role="alert"]').textContent='微信绑定暂不可用，请先使用账号密码登录，稍后可在用户中心绑定。';
        }
        bind.onclick=async()=>{
          if(bind.disabled)return;
          bind.disabled=true;
          try{
            const payload=await createOfficialAuthRequest('bind');
            location.assign(payload.authUrl);
          }catch(error){
            dialog.querySelector('[role="alert"]').textContent=String(error.message||'暂时无法绑定，请重试或稍后绑定。');
            bind.disabled=false;
          }
        };
      });
    })().finally(()=>{registrationPrompt=null});
    return registrationPrompt;
  }
  function resumeAccountChoice(){
    accountFlow=(async()=>{
      let state;
      try{state=await requestJson('/api/v1/auth/wechat/account')}
      catch(error){
        clearCallbackMarker();
        const dialog=accountDialog('微信授权已失效','请关闭此提示后重新扫码。','<button type="button" data-close>关闭</button>');
        dialog.querySelector('[role="alert"]').textContent=String(error.message);
        dialog.querySelector('[data-close]').onclick=()=>{dialog.close();dialog.remove()};
        dialog.addEventListener('cancel',()=>dialog.remove());
        return;
      }
      return new Promise(resolve=>{
        const recover=state.mode==='recover';
        const dialog=accountDialog(recover?'找回原账号会员':'已有账号，还是新用户？',
          recover?'验证原注册账号后，微信将绑定到原账号，以后直接使用原账号会员。':'如果你已经注册或购买过会员，请绑定已有账号，继续使用原来的会员和学习记录。',
          `<form><label>原账号用户名<input name="username" autocomplete="username" maxlength="64" required></label><label>原账号密码<input name="password" type="password" autocomplete="current-password" maxlength="128" required></label><button type="submit">${recover?'验证并关联原账号':'绑定已有账号'}</button></form>
          ${recover?'<p class="wechat-account-note">本操作只关联微信登录方式。当前微信账号的学习记录保留，不自动合并；关联后如需找回这些记录，请联系管理员。已有会员或订单会转人工核对。</p>':''}
          <div class="wechat-account-actions">${state.canCreate?'<button type="button" data-create>我是新用户，创建账号</button>':''}<button type="button" data-cancel>取消</button></div>`);
        let busy=false;
        const errorBox=dialog.querySelector('[role="alert"]');
        function setBusy(value){busy=value;dialog.querySelectorAll('button,input').forEach(el=>{el.disabled=value})}
        const finish=()=>{clearCallbackMarker();dialog.close();dialog.remove();resolve()};
        const cancel=async()=>{
          if(busy)return;
          setBusy(true);
          try{await requestJson('/api/v1/auth/wechat/account',{method:'DELETE'});finish()}
          catch(error){errorBox.textContent=String(error.message);setBusy(false)}
        };
        dialog.addEventListener('cancel',event=>{event.preventDefault();cancel()});
        dialog.querySelector('[data-cancel]').onclick=cancel;
        async function submit(action){
          if(busy)return;
          const username=dialog.querySelector('[name="username"]').value.trim();
          const password=dialog.querySelector('[name="password"]').value;
          if(action==='bind'&&(!username||!password)){errorBox.textContent='请填写原账号用户名和密码。';return}
          setBusy(true);errorBox.textContent='';
          try{
            await requestJson('/api/v1/auth/wechat/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,username,password})});
            dialog.querySelector('[name="password"]').value='';
            clearCallbackMarker();
            location.reload();
          }catch(error){errorBox.textContent=String(error.message);setBusy(false)}
        }
        dialog.querySelector('form').onsubmit=event=>{event.preventDefault();submit('bind')};
        const create=dialog.querySelector('[data-create]');
        if(create)create.onclick=()=>submit('create');
      });
    })();
    return accountFlow;
  }

  function handleOfficialCallback(){
    const params=new URLSearchParams(location.search||'');
    const result=params.get('wechat');
    if(!result)return;
    const messages={
      'login-success':'微信登录成功。',
      'bind-success':'微信账号绑定成功。',
      'login-failed':'微信登录未完成，请重新扫码。',
      'bind-failed':'微信账号绑定未完成，请确认扫码的是当前账号所绑定的微信后重试。',
      'bind-conflict':'该微信已关联其他账号。请用微信登录，在用户中心选择“找回原账号会员”，验证原注册账号后关联。',
      'provider-failed':'微信授权服务暂时不可用，请稍后重试。',
      'state-invalid':'微信授权已失效或已被使用，请重新扫码。'
    };
    if(result==='account-required'){resumeAccountChoice();return}
    else showToast(messages[result]||'微信授权未完成。',result==='login-success'||result==='bind-success');
    params.delete('wechat');
    const query=params.toString();
    try{history.replaceState(null,document.title,location.pathname+(query?'?'+query:'')+location.hash)}catch(error){}
  }

  window.KGWechatLogin={
    promptBindingAfterRegister,
    waitForAccountFlow,
    DEFAULT_CONFIG,
    getConfig,
    saveConfig,
    applyConfig,
    loadPublicConfig,
    createOfficialAuthRequest,
    startOfficialLogin,
    renderPanel,
    ensureAuthPanel,
    handleOfficialCallback,
    unbind,
    escapeHTML
  };

  document.addEventListener('DOMContentLoaded',()=>{
    ensureAuthPanel();
    handleOfficialCallback();
    loadPublicConfig().then(config=>{
      const entry=document.querySelector('.wechat-login-entry');
      if(entry)entry.hidden=config.enableOfficial!==true;
    });
  });
})();
