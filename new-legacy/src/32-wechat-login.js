'use strict';

/*
 * 微信扫码登录界面。
 * OAuth state、code 换 token、openid/unionid 与账号创建均由后端处理；浏览器只发起授权和展示结果。
 */
(function(){
  const WECHAT_CONFIG_KEY='kg_wechat_login_config_v1';
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
  async function getPublicConfig(){
    return requestJson('/api/v1/auth/wechat/config');
  }
  async function startOfficialLogin(intent='login',returnPath=currentReturnPath()){
    const params=new URLSearchParams({intent:String(intent)==='bind'?'bind':'login',return_path:returnPath||'/'});
    try{
      const payload=await requestJson('/api/v1/auth/wechat/auth-url?'+params.toString());
      if(!payload.authUrl)throw new Error('服务器未返回微信授权地址。');
      location.assign(payload.authUrl);
      return true;
    }catch(error){
      showToast(String(error&&error.message||'微信授权暂不可用，请稍后重试。'),false);
      return false;
    }
  }
  async function startDemoLogin(){
    try{
      await requestJson('/api/v1/auth/wechat/demo-login',{method:'POST'});
      location.reload();
      return true;
    }catch(error){
      showToast(String(error&&error.message||'扫码测试登录失败，请稍后重试。'),false);
      return false;
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
  function pseudoQR(seed){
    seed=String(seed||'wechat');
    let cells='';
    for(let r=0;r<13;r++){
      for(let c=0;c<13;c++){
        const finder=(r<4&&c<4)||(r<4&&c>8)||(r>8&&c<4);
        const inner=(r>0&&r<3&&c>0&&c<3)||(r>0&&r<3&&c>9&&c<12)||(r>9&&r<12&&c>0&&c<3);
        let hash=0;const value=seed+'|'+r+'|'+c;
        for(let i=0;i<value.length;i++)hash=(hash*31+value.charCodeAt(i))>>>0;
        cells+=`<span class="${finder? 'on' : inner? '' : hash%3!==0?'on':''}"></span>`;
      }
    }
    return `<div class="wechat-pseudo-qr" aria-hidden="true">${cells}</div>`;
  }
  function renderCard(container,config){
    const officialReady=config.mode==='official';
    const officialText=officialReady?'微信开放平台已配置，可使用微信扫码登录。':'正式微信登录尚未配置完成。';
    container.innerHTML=`
      <div class="wechat-login-card">
        <div class="wechat-login-title"><span class="wechat-icon">微</span><div><strong>微信扫码登录</strong><small>${escapeHTML(officialText)}</small></div></div>
        <div class="wechat-login-body">
          ${pseudoQR(config.hasAppId?'wechat-official':'wechat-demo')}
          <div class="wechat-login-copy">
            <p>点击后将跳转至微信官方授权页。账号创建、绑定和登录状态均由服务器安全处理。</p>
            <div class="wechat-login-actions">
              <button type="button" class="wechat-official-btn" ${officialReady?'':'disabled'}>打开微信授权二维码页</button>
              <button type="button" class="wechat-demo-btn" ${config.enableDemo?'':'disabled'}>模拟扫码成功</button>
            </div>
            <small class="wechat-login-tip">测试模式仅用于验证扫码界面；正式环境请关闭测试模式。</small>
          </div>
        </div>
      </div>`;
    const official=container.querySelector('.wechat-official-btn');
    const demo=container.querySelector('.wechat-demo-btn');
    if(official)official.onclick=()=>startOfficialLogin('login');
    if(demo)demo.onclick=()=>startDemoLogin();
  }
  async function renderPanel(container){
    if(!container)return;
    container.innerHTML='<div class="wechat-login-card"><div class="wechat-login-copy"><p>正在读取微信登录配置…</p></div></div>';
    try{renderCard(container,await getPublicConfig())}
    catch(error){
      container.innerHTML='<div class="wechat-login-card"><div class="wechat-login-copy"><p>暂时无法读取微信登录配置，请稍后重试。</p></div></div>';
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
    wrap.innerHTML='<div class="wechat-divider"><span>或使用微信</span></div><button class="wechat-login-entry" type="button">微信扫码登录</button><div class="wechat-login-panel" hidden></div>';
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
    getPublicConfig,
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
