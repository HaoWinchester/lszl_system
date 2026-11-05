'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function harness(extras={}){
  let session={user:{username:'teacher',role:'teacher'},loginSessionId:'old-login'};
  const listeners=new Map(),events=[];
  const context={console,setTimeout,clearTimeout,AbortController,URL,
    location:{pathname:'/knowledge-recall.html'},
    CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail}},
    addEventListener(type,handler){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(handler)},
    dispatchEvent(event){events.push(event);for(const handler of listeners.get(event.type)||[])handler(event)},
    KGAuthCore:{getCurrentSession:()=>session,currentUsername:()=>session.user?.username||'',currentUser:()=>session.user||null},
  };
  context.window=context;context.globalThis=context;
  Object.assign(context,extras);
  vm.createContext(context);
  const source=path.resolve(__dirname,'../src/shared/auth-recovery.js');
  if(fs.existsSync(source))vm.runInContext(fs.readFileSync(source,'utf8'),context);
  return {context,events,api:context.KGAuthRecovery,setSession(value){session=value}};
}

test('one current-session 401 pauses writes without replacing the classroom or duplicating recovery',()=>{
  const {api,events}=harness();assert.ok(api,'shared recovery is installed');
  const graph={nodes:[{id:'n1',title:'课堂修改'}]};let freezes=0;
  api.register('classroom',{hasUnsavedChanges:()=>true,onExpired:()=>{freezes++}});
  const identity=api.capture();
  api.observe({status:401},identity);api.observe({status:401},identity);
  assert.equal(api.isPaused(),true);assert.equal(freezes,1);
  assert.equal(graph.nodes[0].title,'课堂修改');
  assert.equal(events.filter(e=>e.type==='kg:auth-expired').length,1);
  assert.throws(()=>api.assertWritable(identity),e=>e.status===401);
});

test('late 401 from a prior login and permission403 do not suspend the new session',()=>{
  const {api,setSession}=harness();assert.ok(api);
  const old=api.capture();setSession({user:{username:'teacher'},loginSessionId:'new-login'});
  api.observe({status:401},old);api.observe({status:403},api.capture());
  assert.equal(api.isPaused(),false);
});

test('same-owner login resumes participants and keeps normal identity-change listeners untouched',async()=>{
  const {api,setSession,events}=harness();assert.ok(api);let saves=0;
  api.register('classroom',{hasUnsavedChanges:()=>true,onRecovered:async()=>{saves++;return true}});
  api.observe({status:401},api.capture());
  setSession({user:{username:'teacher'},loginSessionId:'new-login'});
  assert.equal(await api.acceptSession({username:'teacher',loginSessionId:'new-login'}),true);
  assert.equal(api.isPaused(),false);assert.equal(saves,1);
  assert.equal(events.filter(e=>e.type==='kg:auth-recovered').length,1);
  assert.equal(events.filter(e=>e.type==='kg-auth-session-change').length,0);
});

test('recovering an expired classroom rejects another account before authentication',async()=>{
  const {api}=harness();assert.ok(api);
  api.observe({status:401},api.capture());
  assert.equal(await api.beforeLogin('another-student'),false);
  assert.equal(api.isPaused(),true);
});

test('logout waits for all participants and cancels when an unsaved draft cannot persist',async()=>{
  const {api}=harness();assert.ok(api);let saved=false;
  api.register('classroom',{hasUnsavedChanges:()=>!saved,prepareLeave:async()=>saved});
  assert.equal(await api.prepareLogout(),false);
  saved=true;assert.equal(await api.prepareLogout(),true);
});

test('paused logout never calls persist and beforeunload still warns about retained drafts',async()=>{
  const {api,context}=harness();assert.ok(api);let writes=0;
  api.register('classroom',{hasUnsavedChanges:()=>true,prepareLeave:()=>{writes++;return true}});
  api.observe({status:401},api.capture());
  assert.equal(await api.prepareLogout(),false);assert.equal(writes,0);
  const event={type:'beforeunload',preventDefault(){this.prevented=true}};context.dispatchEvent(event);
  assert.equal(event.prevented,true);
});

test('failed post-login save retains dirty participant and allows a later save without another login',async()=>{
  const {api,setSession}=harness();assert.ok(api);let dirty=true;
  api.register('classroom',{hasUnsavedChanges:()=>dirty,onRecovered:()=>false,prepareLeave:()=>!dirty});
  api.observe({status:401},api.capture());setSession({user:{username:'teacher'},loginSessionId:'new-login'});
  await api.acceptSession({username:'teacher',loginSessionId:'new-login'});
  assert.equal(api.isPaused(),false);assert.equal(api.hasUnsavedChanges(),true);
  assert.equal(await api.prepareLogout(),false);dirty=false;assert.equal(await api.prepareLogout(),true);
});

function authHarness(fetchImpl,authenticated=true){
  const h=harness(),c=h.context;
  c.KG_AUTH_CONFIG={mode:'remote',endpoints:{login:'/api/v1/auth/login',logout:'/api/v1/auth/logout',session:'/api/v1/auth/me'}};
  c.__KG_DIRECT_BOOTSTRAP__={authenticated,authUser:authenticated?{username:'teacher',role:'teacher'}:null,loginSessionId:authenticated?'old-login':''};
  c.fetch=fetchImpl;
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../src/29-auth-core.js'),'utf8'),c);
  c.KGAuthCore.currentUser();
  return h;
}
const response=(status,payload={})=>({status,ok:status>=200&&status<300,json:async()=>payload});

test('a genuine session refresh401 preserves original owner and does not publish guest events',async()=>{
  const {context:c,events}=authHarness(async()=>response(401,{detail:'未登录'}));
  await c.KGAuthCore.refreshSession();
  assert.equal(c.KGAuthRecovery.isPaused(),true);
  assert.equal(c.KGAuthCore.currentUsername(),'teacher');
  assert.equal(events.filter(e=>e.type==='kg-auth-session-change').length,0);
});

test('network-failed explicit logout retains user identity and does not announce logout',async()=>{
  const {context:c,events}=authHarness(async()=>response(503,{detail:'暂不可用'}));
  const result=await c.KGAuthCore.logout({source:'account-menu'});
  assert.equal(result.ok,false);assert.equal(c.KGAuthCore.currentUsername(),'teacher');
  assert.equal(events.filter(e=>e.type==='kg-auth-session-change').length,0);
});

test('re-login of original owner resumes drafts rather than announcing a destructive account change',async()=>{
  const {context:c,events}=authHarness(async()=>response(200,{user:{username:'teacher',role:'teacher'},loginSessionId:'new-login'}));
  let resumes=0;c.KGAuthRecovery.register('canvas',{hasUnsavedChanges:()=>true,onRecovered:()=>{resumes++;return true}});
  c.KGAuthRecovery.observe(response(401),c.KGAuthRecovery.capture());
  const result=await c.KGAuthCore.login('teacher','password');
  assert.equal(result.ok,true);assert.equal(resumes,1);
  assert.equal(c.KGAuthCore.getCurrentSession().loginSessionId,'new-login');
  assert.equal(c.__KG_DIRECT_BOOTSTRAP__.loginSessionId,'new-login');
  assert.equal(events.filter(e=>e.type==='kg-auth-session-change').length,0);
});

test('logout does not send a request when participant save fails',async()=>{
  let requests=0;const {context:c}=authHarness(async()=>{requests++;return response(200)});
  c.KGAuthRecovery.register('canvas',{hasUnsavedChanges:()=>true,prepareLeave:()=>false});
  const result=await c.KGAuthCore.logout();
  assert.equal(result.ok,false);assert.equal(requests,0);assert.equal(c.KGAuthCore.currentUsername(),'teacher');
});

test('another401 during recovery retains the original-owner recovery path for the next login',async()=>{
  const {api,setSession,events}=harness();let fail=true;assert.ok(api);
  api.register('canvas',{onRecovered:()=>{if(fail){api.observe(response(401),api.capture());return false}return true}});
  api.observe(response(401),api.capture());setSession({user:{username:'teacher'},loginSessionId:'new-login'});
  await api.acceptSession({username:'teacher',loginSessionId:'new-login'});
  assert.equal(api.isPaused(),true);assert.equal(events.filter(e=>e.type==='kg:auth-recovered').length,0);
  fail=false;setSession({user:{username:'teacher'},loginSessionId:'third-login'});
  assert.equal(await api.acceptSession({username:'teacher',loginSessionId:'third-login'}),true);
  assert.equal(api.isPaused(),false);
});

test('a late guest session401 cannot clear a login that completed in the meantime',async()=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve});
  const {context:c}=authHarness(async url=>url.endsWith('/me')?pending:response(200,{user:{username:'teacher'},loginSessionId:'new-login'}),false);
  const refresh=c.KGAuthCore.refreshSession();
  assert.equal((await c.KGAuthCore.login('teacher','password')).ok,true);
  finish(response(401));await refresh;
  assert.equal(c.KGAuthCore.currentUsername(),'teacher');
  assert.equal(c.KGAuthRecovery.isPaused(),false);
});

test('authenticated mutations bind to the browser login identity while auth login remains available during expiry',async()=>{
  const {api}=harness();const calls=[];assert.ok(api);
  const network=async(url,init)=>{calls.push({url,init});return response(200)};
  await api.fetch('/api/v1/recall/progress/q1',{method:'PUT'},network);
  assert.equal(calls[0].init.headers['X-KG-Login-Session-ID'],'old-login');
  api.observe(response(401),api.capture());
  await assert.rejects(api.fetch('/api/v1/recall/progress/q1',{method:'PUT'},network),e=>e.status===401);
  await api.fetch('/api/v1/auth/login',{method:'POST'},network);
  assert.equal(calls.length,2);assert.equal(calls[1].init.headers?.['X-KG-Login-Session-ID'],undefined);
});

test('another-tab account change pauses this classroom without adopting or exposing its retained draft',()=>{
  let channel;
  const {api,context}=harness({BroadcastChannel:class{constructor(){channel=this}postMessage(){}}});assert.ok(api);
  api.register('canvas',{hasUnsavedChanges:()=>true});
  channel.onmessage({data:{username:'another-student',loginSessionId:'student-login'}});
  assert.equal(api.isPaused(),true);assert.equal(context.KGAuthCore.currentUsername(),'teacher');
});

test('multi-question answer writes pause with the classroom and resume with the new login identity',async()=>{
  const {api,context:c,setSession}=harness();const writes=[];assert.ok(api);
  c.location.pathname='/practice-mode.html';c.fetch=async(url,init)=>{writes.push({url,init});return response(200,{ok:true})};
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../frontend/scripts/new-legacy-assets/practice-learning-adapter.js'),'utf8'),c);
  api.observe(response(401),api.capture());
  await assert.rejects(c.KGPracticeLearningApi.answer({questionId:'q1',selectedAnswer:'B'},{skipRefresh:true}),e=>e.status===401);
  assert.equal(writes.length,0);
  setSession({user:{username:'teacher'},loginSessionId:'new-login'});await api.acceptSession({username:'teacher',loginSessionId:'new-login'});
  await c.KGPracticeLearningApi.answer({questionId:'q1',selectedAnswer:'B'},{skipRefresh:true});
  assert.equal(writes.length,1);assert.equal(writes[0].init.headers['X-KG-Login-Session-ID'],'new-login');
});
