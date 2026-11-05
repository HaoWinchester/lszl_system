(function(global){
  'use strict';
  if(global.KGAuthRecovery)return;
  const participants=new Map();
  const TIMEOUT=15000,RENEW_INTERVAL=15*60*1000;
  let paused=false,retained=null,recovering=null,logoutCheck=null,banner=null;
  let renewFlight=null,nextRenewal=Date.now()+1000,lastActivity=Date.now();
  const channel=typeof global.BroadcastChannel==='function'?new global.BroadcastChannel('kg-auth-session-lifecycle-v1'):null;
  function capture(){
    const value=global.KGAuthCore?.getCurrentSession?.();
    const username=String(value?.user?.username||'');
    return username?{username,loginSessionId:String(value?.loginSessionId||'')}:null;
  }
  const same=(a,b)=>!!a&&!!b&&a.username===b.username&&a.loginSessionId===b.loginSessionId;
  function failure(message='登录已失效，当前文字和画布已保留，请重新登录原账号。',status=401){
    const error=new Error(message);error.status=status;error.code=status===401?'AUTH_SESSION_EXPIRED':'AUTH_SESSION_CHANGED';return error;
  }
  function assertWritable(identity=capture()){
    if(paused)throw failure();
    if(identity&&!same(identity,capture()))throw failure('登录状态已变化，已停止旧会话的保存。',409);
    return true;
  }
  function hasUnsavedChanges(){
    return [...participants.values()].some(value=>{try{return !!value.hasUnsavedChanges?.()}catch(_){return true}});
  }
  async function bounded(action){
    let timer;
    try{return await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{timer=global.setTimeout(()=>reject(new Error('保存仍未完成，当前内容已保留，请稍后重试。')),TIMEOUT)})])}
    finally{global.clearTimeout(timer)}
  }
  function show(message){
    const doc=global.document;if(!doc?.body)return;
    if(!banner){
      banner=doc.createElement('aside');banner.id='kgAuthRecoveryBanner';banner.dataset.canvasUi='true';banner.setAttribute('role','status');
      banner.style.cssText='position:fixed;z-index:2147483000;top:calc(env(safe-area-inset-top, 0px) + 112px);left:50%;transform:translateX(-50%);max-width:calc(100vw - 32px);width:max-content;box-sizing:border-box;padding:12px 16px;border:1px solid #d97706;border-radius:10px;background:#fffbeb;color:#78350f;box-shadow:0 4px 18px #0002;display:flex;align-items:center;gap:12px;flex-wrap:wrap;font:14px/1.5 sans-serif';
      const text=doc.createElement('span');text.dataset.authRecoveryMessage='true';
      const login=doc.createElement('button');login.type='button';login.dataset.authRecoveryLogin='true';login.textContent='重新登录';
      login.addEventListener('click',async()=>{
        if(doc.fullscreenElement&&!doc.fullscreenElement.contains(doc.getElementById('authModal')))try{await doc.exitFullscreen()}catch(_){}
        const open=global.KGAuthRuntime?.openAuth||global.authOpen||global.KGSharedAuthDialog?.open;
        open?.('当前文字和画布已保留，请重新登录 '+(retained?.username||'原账号')+' 后继续。');
        const input=doc.getElementById('authUsername');if(input&&retained?.username)input.value=retained.username;
      });
      const retryButton=doc.createElement('button');retryButton.type='button';retryButton.dataset.authRecoveryRetry='true';retryButton.textContent='重试';
      retryButton.addEventListener('click',async()=>{retryButton.disabled=true;try{await retry()}finally{retryButton.disabled=false}});
      for(const button of [login,retryButton])button.style.cssText='padding:6px 10px;border:1px solid currentColor;border-radius:6px;background:white;color:inherit;cursor:pointer;font:inherit';
      banner.append(text,login,retryButton);doc.body.append(banner);
      global.KGCanvasDomInteraction?.mountOverlay?.(banner,doc.body);
    }
    banner.hidden=false;banner.style.display='flex';
    banner.querySelector('[data-auth-recovery-message]').textContent=message;
    banner.querySelector('[data-auth-recovery-login]').hidden=!paused;
  }
  function hide(){if(banner){banner.hidden=true;banner.style.display='none'}}
  function register(name,value){participants.set(name,value);return()=>participants.delete(name)}
  function observe(response,identity,context={}){
    if(Number(response?.status)!==401||!identity||!same(identity,capture())||paused)return false;
    paused=true;retained={...identity};
    for(const value of participants.values())try{value.onExpired?.()}catch(error){global.console?.warn?.('[AuthRecovery] pause failed',error)}
    show('登录已失效，当前文字和画布已保留，请重新登录 '+identity.username+'。');
    global.dispatchEvent(new CustomEvent('kg:auth-expired',{detail:{...identity,source:context.source||''}}));
    return true;
  }
  async function acceptSession(identity){
    if(!retained)return false;
    if(identity?.username!==retained.username)throw failure('请使用原账号重新登录，当前课堂尚未保存。',409);
    paused=false;
    if(recovering)return recovering;
    const operation=(async()=>{
      let saved=true;
      for(const value of participants.values())try{if(value.onRecovered&&await bounded(()=>value.onRecovered(identity))===false)saved=false}catch(_){saved=false}
      if(paused)return true;
      retained=null;
      if(saved)hide();else show('登录已恢复，部分修改尚未保存；当前内容已保留，请重试保存。');
      global.dispatchEvent(new CustomEvent('kg:auth-recovered',{detail:{...identity,saved}}));
      global.KGAuthRuntime?.renderStatus?.();global.KGSharedAuthDialog?.renderStatus?.();global.KGAccountMenu?.refresh?.();
      return true;
    })();
    recovering=operation;
    try{return await operation}finally{if(recovering===operation)recovering=null}
  }
  async function prepareLogout(){
    if(logoutCheck)return logoutCheck;
    if(paused){show('登录已失效，当前课堂尚未保存，已取消退出。请先重新登录原账号。');return false}
    logoutCheck=(async()=>{
      try{
        for(const value of participants.values())if(value.prepareLeave&&await bounded(()=>value.prepareLeave())===false){show('当前修改尚未保存，已取消退出，请重试保存。');return false}
        return true;
      }catch(error){show(String(error?.message||'当前修改尚未保存，已取消退出。'));return false}
    })();
    try{return await logoutCheck}finally{logoutCheck=null}
  }
  async function beforeLogin(username){
    if(retained&&username!==retained.username){show('请使用原账号 '+retained.username+' 重新登录，当前课堂尚未保存。');return false}
    const current=capture();
    if(current&&current.username!==username)return prepareLogout();
    if(current&&hasUnsavedChanges())retained=retained||current;
    return true;
  }
  async function request(url,init={},fetchImpl=global.fetch){
    const identity=capture(),authentication=/\/auth\/(?:login|logout|register)(?:$|\?)/.test(String(url));
    const writing=!authentication&&!['GET','HEAD','OPTIONS'].includes(String(init.method||'GET').toUpperCase());
    if(writing)assertWritable(identity);
    if(writing&&identity?.loginSessionId){
      const headers=init.headers?.entries?Object.fromEntries(init.headers.entries()):Array.isArray(init.headers)?Object.fromEntries(init.headers):{...(init.headers||{})};
      init={...init,headers:{...headers,'X-KG-Login-Session-ID':identity.loginSessionId}};
    }
    const controller=new global.AbortController(),external=init.signal;
    const abort=()=>controller.abort(external.reason);
    if(external?.aborted)abort();else external?.addEventListener?.('abort',abort,{once:true});
    const timer=global.setTimeout(()=>controller.abort(),TIMEOUT);
    try{
      const response=await fetchImpl(url,{...init,signal:controller.signal});
      if(!authentication)observe(response,identity,{path:String(url)});
      if(writing&&identity&&!same(identity,capture()))throw failure('登录状态已变化，旧保存结果已忽略。',409);
      return response;
    }catch(error){if(controller.signal.aborted&&!external?.aborted){const timeout=new Error('请求超时，当前内容已保留，请重试。');timeout.code='REQUEST_TIMEOUT';throw timeout}throw error}
    finally{global.clearTimeout(timer);external?.removeEventListener?.('abort',abort)}
  }
  async function retry(){
    if(paused){await global.KGAuthCore?.refreshSession?.();return !paused}
    let saved=true;
    for(const value of participants.values())try{if(value.prepareLeave&&await bounded(()=>value.prepareLeave())===false)saved=false}catch(_){saved=false}
    if(saved&&!hasUnsavedChanges())hide();else show('当前修改尚未保存，内容已保留，请检查连接后重试。');
    return saved;
  }
  async function renew(){
    if(renewFlight)return renewFlight;
    if(paused||!capture()||global.document?.visibilityState==='hidden')return false;
    nextRenewal=Date.now()+60000;
    renewFlight=(async()=>{
      try{const response=await request('/api/v1/auth/refresh',{method:'POST',credentials:'include',headers:{Accept:'application/json'}});if(!response.ok)return false;const payload=await response.json();if(payload.loginSessionId&&payload.loginSessionId!==capture()?.loginSessionId)await global.KGAuthCore?.refreshSession?.();nextRenewal=Date.now()+RENEW_INTERVAL;return true}catch(_){return false}
    })();
    try{return await renewFlight}finally{renewFlight=null}
  }
  global.addEventListener?.('beforeunload',event=>{if(hasUnsavedChanges()){event.preventDefault();event.returnValue=''}});
  function activity(){lastActivity=Date.now();if(Date.now()>=nextRenewal)void renew()}
  global.document?.addEventListener?.('pointerdown',activity,{passive:true});
  global.document?.addEventListener?.('keydown',activity);
  global.addEventListener?.('focus',activity);
  global.document?.addEventListener?.('visibilitychange',()=>{if(global.document.visibilityState==='visible')activity()});
  function publishSession(identity){channel?.postMessage({username:String(identity?.username||''),loginSessionId:String(identity?.loginSessionId||'')})}
  if(channel)channel.onmessage=event=>{
    const identity=capture(),next=event.data;
    if(!identity||!next||typeof next.username!=='string'||typeof next.loginSessionId!=='string'||same(identity,next))return;
    observe({status:401},identity,{source:'cross-tab'});
    if(next.username===identity.username)void global.KGAuthCore?.refreshSession?.();
  };
  if(global.document&&global.setInterval)global.setInterval(()=>{if(Date.now()-lastActivity<RENEW_INTERVAL&&Date.now()>=nextRenewal)void renew()},60000);
  global.KGAuthRecovery=Object.freeze({capture,isPaused:()=>paused,observe,assertWritable,register,acceptSession,beforeLogin,prepareLogout,hasUnsavedChanges,fetch:request,retry,renew,publishSession});
})(window);
