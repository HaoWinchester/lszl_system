'use strict';

/*
 * 微信扫码登录接入层。
 * 说明：当前项目仍是纯前端 / localStorage 架构，所以本模块提供两种模式：
 * 1) 本地演示扫码：用于原型体验，会创建/登录一个本地微信演示账号。
 * 2) 正式微信开放平台：生成 qrconnect 授权地址；真正登录必须由后端用 code 换取 openid/unionid 后再回传本页面。
 */
(function(){
  const AUTH_USERS_KEY='kg_local_users_v1';
  const AUTH_SESSION_KEY='kg_local_current_user_v1';
  const USER_ADMIN_LOG_KEY='kg_user_admin_logs_v1';
  const WECHAT_CONFIG_KEY='kg_wechat_login_config_v1';
  const WECHAT_PENDING_KEY='kg_wechat_login_pending_v1';

  const Store=window.KGAppStorage||{};

  const DEFAULT_CONFIG={
    enableDemo:true,
    enableOfficial:false,
    appId:'',
    redirectUri:'',
    backendExchangeUrl:'',
    scope:'snsapi_login',
    autoCreateUser:true,
    defaultRole:'student',
    defaultSubject:'PMP'
  };

  const authCore=()=>window.KGAuthCore||null;
  function readJSON(key,fallback){
    const core=authCore();
    if(core&&typeof core.readJSON==='function')return core.readJSON(key,fallback);
    if(Store.readJSON)return Store.readJSON(key,fallback);
    try{const raw=window.KGServerStateStorage.getItem(key);return raw?JSON.parse(raw):fallback}catch(e){return fallback}
  }
  function writeJSON(key,value){
    const core=authCore();
    if(core&&typeof core.writeJSON==='function')return core.writeJSON(key,value);
    if(Store.writeJSON)return Store.writeJSON(key,value);
    window.KGServerStateStorage.setItem(key,JSON.stringify(value));
    return true;
  }
  function escapeHTML(value){
    const core=authCore();
    if(core&&typeof core.escapeHTML==='function')return core.escapeHTML(value);
    return String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }
  function hash(str){
    const core=authCore();
    if(core&&typeof core.hash==='function')return core.hash(str);
    let h=2166136261;str=String(str||'');for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h+=(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)}return (h>>>0).toString(36);
  }
  function uid(prefix='wx'){
    const core=authCore();
    if(core&&typeof core.uid==='function')return core.uid(prefix);
    return prefix+'_'+Math.random().toString(36).slice(2,8)+Date.now().toString(36).slice(-6);
  }
  function makeSalt(){
    const core=authCore();
    if(core&&typeof core.makeSalt==='function')return core.makeSalt();
    return Math.random().toString(36).slice(2)+Date.now().toString(36);
  }
  function cleanRole(role){
    const core=authCore();
    if(core&&typeof core.normalizeRole==='function')return core.normalizeRole(role,'student');
    return ['admin','teacher','student','viewer'].includes(String(role))?String(role):'student';
  }
  function cleanSubject(subject){return String(subject||'PMP').trim()||'PMP'}
  function normalizeConfig(config){
    config={...DEFAULT_CONFIG,...(config&&typeof config==='object'?config:{})};
    config.enableDemo=!!config.enableDemo;
    config.enableOfficial=!!config.enableOfficial;
    config.appId=String(config.appId||'').trim();
    config.redirectUri=String(config.redirectUri||'').trim();
    config.backendExchangeUrl=String(config.backendExchangeUrl||'').trim();
    config.scope=String(config.scope||'snsapi_login').trim()||'snsapi_login';
    config.autoCreateUser=config.autoCreateUser!==false;
    config.defaultRole=cleanRole(config.defaultRole);
    config.defaultSubject=cleanSubject(config.defaultSubject);
    return config;
  }
  function getConfig(){return normalizeConfig(readJSON(WECHAT_CONFIG_KEY,DEFAULT_CONFIG))}
  function saveConfig(config){const normalized=normalizeConfig(config);writeJSON(WECHAT_CONFIG_KEY,normalized);return normalized}
  function getUsers(){
    const core=authCore();
    if(core&&typeof core.users==='function')return core.users();
    return readJSON(AUTH_USERS_KEY,{}) || {};
  }
  function saveUsers(users){
    const core=authCore();
    if(core&&typeof core.saveUsers==='function')return core.saveUsers(users||{});
    return writeJSON(AUTH_USERS_KEY,users||{});
  }
  function setCurrentUsername(username){
    const core=authCore();
    if(core&&typeof core.setCurrentUsername==='function')return core.setCurrentUsername(username);
    if(Store.writeString)Store.writeString(AUTH_SESSION_KEY,username);
    else localStorage.setItem(AUTH_SESSION_KEY,username);
    window.dispatchEvent(new CustomEvent('kg-auth-session-change',{detail:{username}}));
    return username;
  }
  function logAction(action,username='',detail=''){
    const core=authCore();
    if(core&&typeof core.logAction==='function')return core.logAction(action,username,detail);
    try{
      const logs=readJSON(USER_ADMIN_LOG_KEY,[]);
      logs.unshift({id:uid('log'),action:String(action||''),username:String(username||''),detail:String(detail||''),actor:(Store.readString?Store.readString(AUTH_SESSION_KEY,''):localStorage.getItem(AUTH_SESSION_KEY))||'wechat-login',at:Date.now()});
      writeJSON(USER_ADMIN_LOG_KEY,logs.slice(0,300));
    }catch(e){}
  }
  function showToast(message,ok=true){
    if(typeof window.showStatus==='function'){window.showStatus(message);return}
    const el=document.getElementById('authMsg');
    if(el){el.textContent=message;el.classList.toggle('ok',!!ok);return}
    console.log(message);
  }
  function normalizeUser(username,user){
    const core=authCore();
    const now=Date.now();
    user=user&&typeof user==='object'?user:{};
    if(core&&typeof core.normalizeUser==='function'){
      const normalized=core.normalizeUser(username,{...user,role:cleanRole(user.role||'student'),subject:cleanSubject(user.subject||'PMP'),source:user.source||'wechat'});
      return {...normalized,updatedAt:now,lastLoginAt:now,lastActiveAt:now};
    }
    return {
      ...user,
      salt:String(user.salt||makeSalt()),
      hash:String(user.hash||''),
      createdAt:Number(user.createdAt||now),
      updatedAt:now,
      lastLoginAt:now,
      lastActiveAt:now,
      archivedAt:Number(user.archivedAt||0),
      status:String(user.status||'active'),
      role:cleanRole(user.role||'student'),
      displayName:String(user.displayName||username),
      email:String(user.email||''),
      phone:String(user.phone||''),
      subject:cleanSubject(user.subject||'PMP'),
      tags:Array.isArray(user.tags)?user.tags.map(String):String(user.tags||'').split(/[,，、;；|]/).map(s=>s.trim()).filter(Boolean),
      note:String(user.note||''),
      source:String(user.source||'wechat')
    };
  }
  function usernameFromProfile(profile){
    const openid=String(profile.openid||profile.unionid||'');
    return 'wx_'+hash(openid).slice(0,10);
  }
  function findUserByWechat(users,profile){
    const openid=String(profile.openid||'');
    const unionid=String(profile.unionid||'');
    return Object.keys(users||{}).find(username=>{
      const wx=users[username]&&users[username].wechat;
      return wx && ((openid&&wx.openid===openid) || (unionid&&wx.unionid===unionid));
    }) || '';
  }
  function completeLogin(profile,source='wechat-demo'){
    const config=getConfig();
    profile=profile&&typeof profile==='object'?profile:{};
    const openid=String(profile.openid||'');
    if(!openid){showToast('微信登录失败：缺少 openid。',false);return false}
    const users=getUsers();
    let username=findUserByWechat(users,profile) || usernameFromProfile(profile);
    if(!users[username]){
      if(!config.autoCreateUser){showToast('该微信账号尚未绑定本系统账号，请联系管理员。',false);return false}
      users[username]=normalizeUser(username,{role:config.defaultRole,subject:config.defaultSubject,displayName:profile.nickname||'微信用户',source});
    }
    const current=normalizeUser(username,users[username]);
    if(current.status==='paused' || current.status==='archived'){
      showToast(current.status==='paused'?'该微信绑定账号已暂停，请联系管理员恢复。':'该微信绑定账号已归档，请联系管理员恢复。',false);
      return false;
    }
    current.wechat={
      openid:String(profile.openid||''),
      unionid:String(profile.unionid||''),
      nickname:String(profile.nickname||current.displayName||'微信用户'),
      avatar:String(profile.avatar||''),
      boundAt:Number((current.wechat&&current.wechat.boundAt)||Date.now()),
      lastLoginAt:Date.now(),
      source
    };
    current.displayName=current.displayName || current.wechat.nickname || username;
    current.updatedAt=Date.now();
    current.lastLoginAt=Date.now();
    current.lastActiveAt=Date.now();
    current.source=current.source||source;
    users[username]=current;
    saveUsers(users);
    setCurrentUsername(username);
    logAction(source==='wechat-demo'?'微信演示扫码登录':'微信扫码登录',username,current.wechat.nickname);
    if(window.KGAuthRuntime && typeof window.KGAuthRuntime.afterExternalLogin==='function'){
      window.KGAuthRuntime.afterExternalLogin(username,'微信扫码登录成功');
    }else{
      showToast('微信扫码登录成功：'+username);
      setTimeout(()=>location.reload(),450);
    }
    window.dispatchEvent(new CustomEvent('kg-wechat-login-success',{detail:{username,profile:current.wechat}}));
    return true;
  }
  function getRedirectUri(config){
    if(config.redirectUri)return config.redirectUri;
    try{return location.origin+location.pathname}catch(e){return ''}
  }
  function buildOfficialAuthUrl(){
    const config=getConfig();
    const state='kgwechat_'+uid('state');
    const redirectUri=getRedirectUri(config);
    const pending={state,createdAt:Date.now(),returnPath:location.pathname+location.search+location.hash};
    writeJSON(WECHAT_PENDING_KEY,pending);
    const params=new URLSearchParams({appid:config.appId,redirect_uri:redirectUri,response_type:'code',scope:config.scope,state});
    return 'https://open.weixin.qq.com/connect/qrconnect?'+params.toString()+'#wechat_redirect';
  }
  function pseudoQR(seed){
    seed=String(seed||'wechat-demo');
    let cells='';
    for(let r=0;r<13;r++){
      for(let c=0;c<13;c++){
        const finder=(r<4&&c<4)||(r<4&&c>8)||(r>8&&c<4);
        const inner=(r>0&&r<3&&c>0&&c<3)||(r>0&&r<3&&c>9&&c<12)||(r>9&&r<12&&c>0&&c<3);
        const on=finder?true:inner?false:((hash(seed+'|'+r+'|'+c).charCodeAt(0)+r+c)%3!==0);
        cells+=`<span class="${on?'on':''}"></span>`;
      }
    }
    return `<div class="wechat-pseudo-qr" aria-hidden="true">${cells}</div>`;
  }
  function renderPanel(container){
    const config=getConfig();
    const officialReady=config.enableOfficial && config.appId;
    const officialText=officialReady?'已配置微信开放平台 AppID。':'未配置 AppID，正式扫码暂不可用。';
    container.innerHTML=`
      <div class="wechat-login-card">
        <div class="wechat-login-title"><span class="wechat-icon">微</span><div><strong>微信扫码登录</strong><small>${escapeHTML(officialText)}</small></div></div>
        <div class="wechat-login-body">
          ${pseudoQR(config.appId||'local-demo')}
          <div class="wechat-login-copy">
            <p>正式微信扫码登录需要微信开放平台网站应用 AppID、授权回调域名，以及后端接口用 <code>code</code> 换取 openid/unionid。</p>
            <div class="wechat-login-actions">
              <button type="button" class="wechat-official-btn" ${officialReady?'':'disabled'}>打开微信授权二维码页</button>
              <button type="button" class="wechat-demo-btn" ${config.enableDemo?'':'disabled'}>本地演示扫码成功</button>
            </div>
            <small class="wechat-login-tip">本地演示会创建一个微信演示账号；正式上线时请关闭演示模式。</small>
          </div>
        </div>
      </div>`;
    const official=container.querySelector('.wechat-official-btn');
    const demo=container.querySelector('.wechat-demo-btn');
    if(official)official.onclick=()=>{
      const cfg=getConfig();
      if(!cfg.appId){showToast('请先在用户管理页配置微信开放平台 AppID。',false);return}
      if(!cfg.backendExchangeUrl){showToast('已打开微信授权页；注意：当前未配置后端换取 openid 的接口，授权回来后不能完成真实登录。',false)}
      location.href=buildOfficialAuthUrl();
    };
    if(demo)demo.onclick=()=>{
      const demoId='demo_'+hash(navigator.userAgent+'|'+location.host).slice(0,8);
      completeLogin({openid:'wx_demo_openid_'+demoId,unionid:'wx_demo_unionid_'+demoId,nickname:'微信演示用户'},'wechat-demo');
    };
  }
  function ensureAuthPanel(){
    const modal=document.getElementById('authModal');
    if(!modal || modal.dataset.wechatLoginBound)return;
    const body=modal.querySelector('.auth-body');
    const actions=modal.querySelector('.auth-actions');
    if(!body || !actions)return;
    modal.dataset.wechatLoginBound='1';
    const wrap=document.createElement('div');
    wrap.className='wechat-login-section';
    wrap.innerHTML=`<div class="wechat-divider"><span>或使用微信</span></div><button class="wechat-login-entry" type="button">微信扫码登录</button><div class="wechat-login-panel" hidden></div>`;
    actions.insertAdjacentElement('afterend',wrap);
    const entry=wrap.querySelector('.wechat-login-entry');
    const panel=wrap.querySelector('.wechat-login-panel');
    entry.onclick=()=>{panel.hidden=!panel.hidden;if(!panel.hidden)renderPanel(panel)};
  }
  async function handleOfficialCallback(){
    const params=new URLSearchParams(location.search||'');
    const code=params.get('code');
    const state=params.get('state');
    if(!code || !state || !String(state).startsWith('kgwechat_'))return;
    const pending=readJSON(WECHAT_PENDING_KEY,null);
    const config=getConfig();
    if(!pending || pending.state!==state){showToast('微信登录回调校验失败，请重新扫码。',false);return}
    if(!config.backendExchangeUrl){
      showToast('已收到微信授权 code，但当前未配置后端换取 openid 的接口，无法完成正式登录。',false);
      return;
    }
    try{
      const res=await fetch(config.backendExchangeUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,state,redirectUri:getRedirectUri(config)})});
      if(!res.ok)throw new Error('HTTP '+res.status);
      const data=await res.json();
      if(!data || !data.openid)throw new Error('后端未返回 openid');
      if(Store.remove)Store.remove(WECHAT_PENDING_KEY);
      else window.KGServerStateStorage.removeItem(WECHAT_PENDING_KEY);
      completeLogin(data,'wechat-official');
      try{history.replaceState(null,document.title,location.pathname+location.hash)}catch(e){}
    }catch(err){
      console.error(err);
      showToast('微信正式登录失败：后端换取 openid 未成功。',false);
    }
  }

  window.KGWechatLogin={
    DEFAULT_CONFIG,
    getConfig,
    saveConfig,
    buildOfficialAuthUrl,
    completeLogin,
    renderPanel,
    ensureAuthPanel,
    handleOfficialCallback,
    escapeHTML
  };

  document.addEventListener('DOMContentLoaded',()=>{
    ensureAuthPanel();
    handleOfficialCallback();
  });
})();
