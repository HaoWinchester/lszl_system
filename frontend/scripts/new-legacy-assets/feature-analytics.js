'use strict'

;(function (global) {
  const ENDPOINT='/api/v1/analytics/feature-intervals'
  const FEATURE_BY_PAGE={
    'index.html':'graph','workbench.html':'graph','file-manager.html':'files',
    'question-bank.html':'question_bank','knowledge-recall.html':'recall',
    'question-workspace.html':'induction','practice-mode.html':'practice',
  }
  let snapshot=null, generation=0, queue=[], busy=false, hidden=false
  const uuid=()=>global.crypto.randomUUID()
  const identity=()=>snapshot?.authenticated ? String(snapshot.loginSessionId||'') : ''
  function pageFeature(){
    const name=String(global.location?.pathname||'').split('/').pop()
    if(name==='practice-mode.html'){
      const view=global.document.body?.dataset.practiceView
      if(view==='result')return 'analysis'
      if(view==='lobby')return 'papers'
      const analysis=global.document.getElementById('practiceExplanationPanel')
      if(analysis && !analysis.hidden && analysis.getClientRects().length)return 'analysis'
    }
    return FEATURE_BY_PAGE[name]||''
  }
  function foreground(){return !hidden && global.document.visibilityState==='visible' && global.document.hasFocus()}
  function sync(){clock.select(pageFeature(),identity());clock.visibility(foreground())}
  async function drain(){
    if(busy)return
    busy=true
    try{
      while(queue.length){
        const entry=queue[0]
        if(entry.identity!==identity() || Date.now()-Date.parse(entry.endedAt)>600000){queue.shift();continue}
        const {identity:loginSessionId,...body}=entry
        let response
        try{response=await global.fetch(ENDPOINT,{method:'POST',credentials:'include',keepalive:true,
          headers:{'content-type':'application/json'},body:JSON.stringify({...body,loginSessionId})})}
        catch(_){break}
        if(entry.identity!==identity())continue
        if(response.status>=500 || response.status===429)break
        if(queue[0]===entry)queue.shift()
        if(response.status===401 || response.status===409){
          queue=[];snapshot=null;sync()
          if(response.status===409)await loadSession(true)
          break
        }
      }
    }finally{busy=false}
  }
  const clock=global.KGUsageClock?.create({now:()=>Date.now(),uuid,emit:entry=>{
    queue.push(entry);if(queue.length>64)queue.shift();void drain()
  }})
  if(!clock)return
  async function loadSession(refresh=false){
    const token=++generation
    // Discard the old account's pending time before reading the new identity.
    snapshot=null;queue=[];sync()
    const bootstrap=global.KGAuthSessionBootstrap
    const next=await (refresh?bootstrap?.refresh():bootstrap?.load())?.catch(()=>null)
    if(token!==generation)return
    snapshot=next;sync()
  }
  function activity(){sync();if(foreground())clock.touch();void drain()}
  function track(featureKey,eventType,actionKey){
    activity()
    // Retain legacy outcome instrumentation only in the explicitly legacy view.
    if(!identity() || !['key_action','outcome'].includes(eventType) || !actionKey)return
    global.fetch('/api/v1/analytics/feature-events',{method:'POST',credentials:'include',keepalive:true,
      headers:{'content-type':'application/json'},body:JSON.stringify({featureKey,eventType,actionKey})}).catch(()=>{})
  }
  global.KGFeatureAnalytics=Object.freeze({track})
  function install(){
    void loadSession()
    global.document.addEventListener('visibilitychange',()=>{sync();void drain()})
    global.addEventListener('blur',()=>{clock.visibility(false);void drain()})
    global.addEventListener('focus',()=>{sync();void drain()})
    global.addEventListener('pagehide',()=>{hidden=true;clock.visibility(false);void drain()})
    global.addEventListener('pageshow',()=>{hidden=false;sync();void drain()})
    global.addEventListener('kg-auth-session-change',()=>{void loadSession()})
    global.addEventListener('online',()=>{void drain()})
    for(const name of ['pointerdown','keydown','input','scroll','touchstart'])
      global.document.addEventListener(name,activity,{capture:true,passive:true})
    global.setInterval(()=>{sync();clock.tick();void drain()},15000)
    // Same-page feature changes settle the previous counter before a new visit.
    new global.MutationObserver(()=>sync()).observe(global.document.body,{attributes:true,subtree:true,attributeFilter:['data-practice-view','hidden']})
  }
  if(global.document.readyState==='loading')global.document.addEventListener('DOMContentLoaded',install,{once:true})
  else install()
})(window)
