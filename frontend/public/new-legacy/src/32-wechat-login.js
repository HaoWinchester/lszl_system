'use strict';

/*
 * 微信扫码登录界面。
 * OAuth state、code 换 token、openid/unionid 与账号创建均由后端处理；浏览器只发起授权和展示结果。
 */
(function(){
  const WECHAT_CONFIG_KEY='kg_wechat_login_config_v1';
  const WECHAT_LOGIN_SDK_URL='https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js';
  const Store=window.KGAppStorage||{};

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

  function readJSON(key,fallback){
    try{
      const raw=Store.readJSON?Store.readJSON(key,fallback):localStorage.getItem(key);
      if(raw&&typeof raw==='object')return raw;
      return raw?JSON.parse(raw):fallback;
    }catch(error){return fallback}
  }
  function writeJSON(key,value){
    if(Store.writeJSON)return Store.writeJSON(key,value);
    localStorage.setItem(key,JSON.stringify(value));
    return true;
  }
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
  function getConfig(){return normalizeConfig(readJSON(WECHAT_CONFIG_KEY,DEFAULT_CONFIG))}
  function saveConfig(config){
    const normalized=normalizeConfig(config);
    writeJSON(WECHAT_CONFIG_KEY,normalized);
    return normalized;
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
  async function createOfficialAuthRequest(intent='login',returnPath=currentReturnPath()){
    const params=new URLSearchParams({intent:String(intent)==='bind'?'bind':'login',return_path:returnPath||'/'});
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
  function renderPanelError(container,message){
    container.innerHTML=`<div class="wechat-login-card"><div class="wechat-login-copy"><p>${escapeHTML(message)}</p><button type="button" class="wechat-login-retry">重新生成二维码</button></div></div>`;
    container.querySelector('.wechat-login-retry').onclick=()=>renderPanel(container);
  }
  async function renderPanel(container){
    if(!container)return;
    const qrId='wechatLoginQr_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
    container.innerHTML=`<div class="wechat-login-card"><div class="wechat-login-copy"><strong>请使用微信扫码</strong><p>在手机上确认后，将自动登录当前页面。</p><div class="wechat-login-qr" id="${qrId}"><span>正在生成微信授权二维码…</span></div></div></div>`;
    try{
      const [payload]=await Promise.all([createOfficialAuthRequest('login'),loadWechatLoginSdk()]);
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
    wrap.innerHTML='<div class="wechat-divider"><span>或使用微信</span></div><p class="wechat-login-hint">点击后在下方打开微信授权二维码。首次登录将自动创建学生账号。</p><button class="wechat-login-entry" type="button">微信扫码登录</button><div class="wechat-login-panel" hidden></div>';
    actions.insertAdjacentElement('afterend',wrap);
    const entry=wrap.querySelector('.wechat-login-entry');
    const panel=wrap.querySelector('.wechat-login-panel');
    entry.onclick=()=>{panel.hidden=!panel.hidden;if(!panel.hidden)renderPanel(panel)};
  }
  function handleOfficialCallback(){
    const params=new URLSearchParams(location.search||'');
    const result=params.get('wechat');
    if(!result)return;
    const messages={
      'login-success':'微信登录成功。',
      'bind-success':'微信账号绑定成功。',
      'login-failed':'微信登录未完成，请重新扫码。',
      'bind-failed':'微信账号绑定未完成，请重新扫码。',
      'provider-failed':'微信授权服务暂时不可用，请稍后重试。',
      'state-invalid':'微信授权已失效或已被使用，请重新扫码。'
    };
    showToast(messages[result]||'微信授权未完成。',result==='login-success'||result==='bind-success');
    params.delete('wechat');
    const query=params.toString();
    try{history.replaceState(null,document.title,location.pathname+(query?'?'+query:'')+location.hash)}catch(error){}
  }

  window.KGWechatLogin={
    DEFAULT_CONFIG,
    getConfig,
    saveConfig,
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
  });
})();
