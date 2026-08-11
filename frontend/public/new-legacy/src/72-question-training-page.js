'use strict';

/* 独立考题训练页运行时：只提供训练页所需的基础工具、登录态与初始化。 */
const $=id=>document.getElementById(id);
const STORE_KEY='通用知识点关系图谱工具_多科目重点聚焦版_v2';
const AuthCore=window.KGAuthCore||{};
const AUTH_USERS_KEY=AuthCore.AUTH_USERS_KEY||'kg_local_users_v1';
const AUTH_SESSION_KEY=AuthCore.AUTH_SESSION_KEY||'kg_local_current_user_v1';
const USER_ADMIN_LOG_KEY=AuthCore.USER_LOG_KEY||'kg_user_admin_logs_v1';
const statusEl=$('status');

function escapeHTML(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function showStatus(msg){if(!statusEl)return;clearTimeout(showStatus.t);statusEl.textContent=msg;statusEl.classList.add('show');showStatus.t=setTimeout(()=>statusEl.classList.remove('show'),2600)}
function authHash(str){if(AuthCore.hash)return AuthCore.hash(str);let h=2166136261;str=String(str||'');for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h+=(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)}return(h>>>0).toString(36)}
function authMakeSalt(){return AuthCore.makeSalt?AuthCore.makeSalt():Math.random().toString(36).slice(2)+Date.now().toString(36)}
function authNormalizeUserRecord(username,user){
  if(AuthCore.normalizeUser)return AuthCore.normalizeUser(username,user);
  user=user&&typeof user==='object'?user:{};const now=Date.now();
  return {username:String(username||user.username||''),salt:String(user.salt||authMakeSalt()),hash:String(user.hash||''),createdAt:Number(user.createdAt||now),updatedAt:Number(user.updatedAt||user.createdAt||now),lastLoginAt:Number(user.lastLoginAt||0),lastActiveAt:Number(user.lastActiveAt||user.lastLoginAt||0),archivedAt:Number(user.archivedAt||0),status:String(user.status||'active'),role:String(user.role||'student'),displayName:String(user.displayName||username),email:String(user.email||''),phone:String(user.phone||''),subject:String(user.subject||'PMP'),tags:Array.isArray(user.tags)?user.tags.map(String):String(user.tags||'').split(/[,，、;；|]/).map(s=>s.trim()).filter(Boolean),note:String(user.note||''),source:String(user.source||'local')};
}
function authUsers(){if(AuthCore.users)return AuthCore.users();try{const data=JSON.parse(localStorage.getItem(AUTH_USERS_KEY)||'{}');if(!data||typeof data!=='object')return{};const users={};Object.keys(data).forEach(username=>{users[username]=authNormalizeUserRecord(username,data[username])});return users}catch(e){return{}}}
function authSaveUsers(users){if(AuthCore.saveUsers)return AuthCore.saveUsers(users||{});localStorage.setItem(AUTH_USERS_KEY,JSON.stringify(users||{}))}
function authLogAction(action,username='',detail=''){try{if(AuthCore.logAction)return AuthCore.logAction(action,username,detail);const logs=JSON.parse(localStorage.getItem(USER_ADMIN_LOG_KEY)||'[]');logs.unshift({id:'log-'+Math.random().toString(36).slice(2)+Date.now().toString(36),action:String(action||''),username:String(username||''),detail:String(detail||''),actor:(authCurrentUser&&authCurrentUser.username)||'local',at:Date.now()});localStorage.setItem(USER_ADMIN_LOG_KEY,JSON.stringify(logs.slice(0,300)))}catch(e){}}
function authUserKey(username){return STORE_KEY+'__user__'+encodeURIComponent(String(username||'').trim().toLowerCase())}
function authPublicKey(){return STORE_KEY+'__public_view'}
function authLoadSession(){try{if(AuthCore.currentUser){const user=AuthCore.currentUser();if(user&&user.username)return {username:user.username};if(AuthCore.currentUsername&&AuthCore.currentUsername())AuthCore.clearSession&&AuthCore.clearSession();return null}const username=localStorage.getItem(AUTH_SESSION_KEY);if(!username)return null;const users=authUsers();const user=users[username];if(user&&user.status!=='archived'&&user.status!=='paused')return {username};localStorage.removeItem(AUTH_SESSION_KEY);return null}catch(e){return null}}
let authCurrentUser=authLoadSession();
function authIsLoggedIn(){return !!(authCurrentUser&&authCurrentUser.username)}
function authCleanUsername(v){return AuthCore.cleanUsername?AuthCore.cleanUsername(v):String(v||'').trim().replace(/\s+/g,'_').slice(0,32)}
function authPasswordHash(username,password,salt){return AuthCore.passwordHash?AuthCore.passwordHash(username,password,salt):authHash(String(salt)+'|'+String(username).toLowerCase()+'|'+String(password))}
function authMsg(text,ok=false){const el=$('authMsg');if(!el)return;el.textContent=text||'';el.classList.toggle('ok',!!ok)}
function authOpen(reason='该操作需要登录后才能使用。'){const m=$('authModal');const r=$('authReason');if(r)r.textContent=reason;if(m)m.classList.add('show');authMsg('');setTimeout(()=>$('authUsername')?.focus(),60)}
function authClose(){$('authModal')?.classList.remove('show')}
function authRenderStatus(){const status=$('authStatus'),login=$('authLoginBtn'),logout=$('authLogoutBtn');const roleApi=window.KGRolePermissions;if(roleApi){roleApi.applyTheme();if(status)roleApi.renderStatus(status);roleApi.decoratePermissionElements()}else if(authIsLoggedIn()){if(status)status.textContent='已登录：'+authCurrentUser.username}else{if(status)status.textContent='未登录 · 游客'}if(login)login.style.display=authIsLoggedIn()?'none':'inline-flex';if(logout)logout.style.display=authIsLoggedIn()?'inline-flex':'none'}
function authLoadCurrentSpace(){authRenderStatus();if(typeof qBankState==='object'){qBankState.banks=null;qBankState.papers=null;qBankState.scope=null}}
function authLogin(username,password){
  username=authCleanUsername(username);password=String(password||'');
  if(!username||!password){authMsg('请输入用户名和密码。');return false}
  const users=authUsers(),user=users[username];
  const passwordOk=user&&(AuthCore.verifyPassword?AuthCore.verifyPassword(username,password,user):user.hash===authPasswordHash(username,password,user.salt));
  if(!passwordOk){authMsg('用户名或密码不正确。');return false}
  if(user.status==='archived'){authMsg('该账号已归档，请联系管理员恢复后再登录。');return false}
  if(user.status==='paused'){authMsg('该账号已暂停，请联系管理员恢复后再登录。');return false}
  user.lastLoginAt=Date.now();user.lastActiveAt=Date.now();user.updatedAt=Date.now();users[username]=user;authSaveUsers(users);
  authCurrentUser={username};if(AuthCore.setCurrentUsername)AuthCore.setCurrentUsername(username);else localStorage.setItem(AUTH_SESSION_KEY,username);authLogAction('用户登录',username);authClose();authLoadCurrentSpace();
  if(typeof qbLoadBanks==='function'){qbLoadBanks();ensureSingleDeepPublishedSelection();renderQuestionTrainer&&renderQuestionTrainer();renderPaperControls&&renderPaperControls()}
  showStatus('已登录：'+username);return true
}
function authRegister(username,password){
  username=authCleanUsername(username);password=String(password||'');
  if(!username||password.length<3){authMsg('用户名不能为空，密码至少 3 位。');return false}
  const users=authUsers();if(users[username]){authMsg('该用户名已存在，请直接登录。');return false}
  const salt=authMakeSalt();users[username]=authNormalizeUserRecord(username,{username,salt,hash:authPasswordHash(username,password,salt),createdAt:Date.now(),updatedAt:Date.now(),lastLoginAt:Date.now(),lastActiveAt:Date.now(),status:'active',role:'student',displayName:username,subject:'PMP',source:'self-register'});
  authSaveUsers(users);authCurrentUser={username};if(AuthCore.setCurrentUsername)AuthCore.setCurrentUsername(username);else localStorage.setItem(AUTH_SESSION_KEY,username);authLogAction('用户注册',username,'训练页注册并登录');authClose();authLoadCurrentSpace();
  if(typeof qbLoadBanks==='function'){qbLoadBanks();ensureSingleDeepPublishedSelection();renderQuestionTrainer&&renderQuestionTrainer();renderPaperControls&&renderPaperControls()}
  showStatus('已注册并登录：'+username);return true
}
async function authLogout(){
  const old=authCurrentUser&&authCurrentUser.username,remote=Boolean(AuthCore.providerStatus?.().remote);
  if(remote&&typeof AuthCore.logout==='function'){
    await AuthCore.logout({source:'单题深学账号菜单退出'});authCurrentUser=null;authRenderStatus();return true
  }
  if(old)authLogAction('用户退出',old);authCurrentUser=null;if(AuthCore.clearSession)AuthCore.clearSession();else localStorage.removeItem(AUTH_SESSION_KEY);authLoadCurrentSpace();
  if(typeof qbLoadBanks==='function'){qbLoadBanks();ensureSingleDeepPublishedSelection();renderQuestionTrainer&&renderQuestionTrainer();renderPaperControls&&renderPaperControls()}
  showStatus(old?'已退出：'+old+'。当前为只读浏览模式。':'当前为只读浏览模式。');return true
}
function authAfterExternalLogin(username,message='第三方登录成功'){
  username=authCleanUsername(username);
  if(!username)return false;
  authCurrentUser={username};
  if(AuthCore.setCurrentUsername)AuthCore.setCurrentUsername(username);
  else localStorage.setItem(AUTH_SESSION_KEY,username);
  authLogAction(message.includes('微信')?'微信扫码登录':'第三方登录',username,message);
  authClose();
  authLoadCurrentSpace();
  if(typeof qbLoadBanks==='function'){qbLoadBanks();ensureSingleDeepPublishedSelection();renderQuestionTrainer&&renderQuestionTrainer();renderPaperControls&&renderPaperControls()}
  showStatus(message+'：'+username);
  return true;
}
window.KGAuthRuntime={afterExternalLogin:authAfterExternalLogin,closeAuth:authClose,logout:authLogout,renderStatus:authRenderStatus,isLoggedIn:authIsLoggedIn,currentUsername:()=>authCurrentUser&&authCurrentUser.username||''};
function authRequire(reason,permission='useTraining'){if(!authIsLoggedIn()){authOpen(reason||'该操作需要登录后才能使用。');return false}const roleApi=window.KGRolePermissions;if(roleApi&&permission&&!roleApi.can(permission)){showStatus('当前角色（'+roleApi.currentRoleLabel()+'）没有考题训练操作权限。');return false}return true}

function applyNoPublishedQuestion(){
  try{
    if(typeof qBankState==='object'){
      qBankState.currentPaperId=null;
      qBankState.currentReleaseId=null;
      qBankState.currentPaperIndex=0;
      if(typeof qbSaveCurrentPaper==='function')qbSaveCurrentPaper();
    }
    PMP_QUESTION_MVP={id:'unavailable',title:'暂无可用题目',stemParts:[{text:'当前没有可用于单题深学的已发布试卷。'}],options:[],clues:[],concepts:[],tags:[],sourceBankId:'',sourceQuestionId:'unavailable',sourcePaperId:'',sourceReleaseId:''};
    document.body.classList.add('qt-no-published-paper');
    return false;
  }catch(error){return false}
}
function singleDeepCatalog(){
  try{
    const resolver=window.KGPublishedQuestionResolver;
    if(resolver)return resolver.listPapers({mode:'single_deep_study',respectRole:true})||[];
    const repository=window.KGPublishedPaperRepository;
    if(repository)return repository.listPublishedPapers({mode:'single_deep_study',respectRole:true})||[];
    if(typeof qbPublishedPaperCatalog==='function')return qbPublishedPaperCatalog({mode:'single_deep_study',respectRole:true})||[];
  }catch(error){console.error('单题深学读取已发布试卷失败',error)}
  return [];
}
function ensureSingleDeepPublishedSelection(){
  let catalog=singleDeepCatalog();
  const current=typeof qbCurrentPaper==='function'?qbCurrentPaper():null;
  let currentEntry=catalog.find(item=>String(item.paper?.id||'')===String(current?.id||'')&&String(item.paper?.releaseId||'')===String(current?.releaseId||''))||null;
  if(current&&!currentEntry){
    const historical=window.KGPublishedQuestionResolver?.resolvePaper?.({paperId:current.id,releaseId:current.releaseId,mode:'single_deep_study'},{respectRole:true,mode:'single_deep_study'});
    if(historical?.ok){currentEntry=historical;catalog=[historical,...catalog]}
  }
  let entry=(currentEntry?.availableCount>0?currentEntry:null)||catalog.find(item=>item.availableCount>0)||currentEntry||null;
  if(!entry)return applyNoPublishedQuestion();
  const currentIndex=Number(typeof qBankState==='object'?qBankState.currentPaperIndex:0)||0;
  const selectedItem=(entry.items||[]).find(item=>Number(item.paperIndex)===currentIndex)||entry.items?.[0];
  if(typeof qbSelectPublishedPaper==='function')qbSelectPublishedPaper(entry.paper.id,selectedItem?.paperIndex||0,{releaseId:entry.paper.releaseId,applyQuestion:true,mode:'single_deep_study'});
  const context=window.KGLearningRouteContext?.normalize?.({paperId:entry.paper.id,releaseId:entry.paper.releaseId,questionId:selectedItem?.question?.id||selectedItem?.ref?.questionId,bankId:selectedItem?.bank?.id||selectedItem?.ref?.bankId,mode:'single_deep_study',returnUrl:window.KGLearningRouteContext?.parse?.({mode:'single_deep_study'})?.returnUrl||'index.html'})||{};
  window.KGLearningRouteContext?.replace?.(context,{target:'question-training.html'});
  document.body.classList.remove('qt-no-published-paper');
  return true;
}

function initQuestionTrainingAuth(){
  const login=$('authLoginBtn'),logout=$('authLogoutBtn'),close=$('authCloseBtn'),doLogin=$('authDoLoginBtn'),register=$('authRegisterBtn'),modal=$('authModal');
  if(login)login.onclick=()=>authOpen('登录后可以进行完整考题训练、切换题目、提交答案与保存训练数据。');
  if(logout)logout.onclick=authLogout;
  if(close)close.onclick=authClose;
  if(doLogin)doLogin.onclick=()=>authLogin($('authUsername')?.value,$('authPassword')?.value);
  if(register)register.onclick=()=>authRegister($('authUsername')?.value,$('authPassword')?.value);
  ['authUsername','authPassword'].forEach(id=>{const el=$(id);if(el&&!el.dataset.authEnterBound){el.dataset.authEnterBound='1';el.addEventListener('keydown',e=>{if(e.key==='Enter')authLogin($('authUsername')?.value,$('authPassword')?.value)})}});
  if(modal&&!modal.dataset.authClickBound){modal.dataset.authClickBound='1';modal.addEventListener('click',e=>{if(e.target===modal)authClose()})}
  authRenderStatus()
}

function applyQuestionTrainingRoute(){
  const route=window.KGLearningRouteContext?.parse?.({mode:'single_deep_study',returnUrl:'index.html'})||{};
  if(!route.questionId&&!route.releaseId&&!route.paperId)return false;
  try{
    const result=window.KGPublishedQuestionResolver?.resolveQuestion?.(route,{mode:'single_deep_study',respectRole:true});
    if(!result?.ok){showStatus(window.KGPublishedQuestionResolver?.message?.(result,'未能打开指定的已发布题目。')||'未能打开指定的已发布题目。');return false}
    const item=result.item,entry=result.entry;
    if(typeof qbSelectPublishedPaper==='function')qbSelectPublishedPaper(entry.paper.id,item.paperIndex,{releaseId:entry.paper.releaseId,applyQuestion:true,mode:'single_deep_study'});
    document.body.classList.remove('qt-no-published-paper');
    const context=window.KGLearningRouteContext?.withResolved?.(result,route,{mode:'single_deep_study'})||result.context;
    window.KGLearningProgress?.activate?.(context,{mode:'single_deep_study',clearTransient:true});
    window.KGLearningRouteContext?.replace?.(context,{target:'question-training.html'});
    try{sessionStorage.setItem('kg_question_training_route_v1',JSON.stringify({...context,workspaceId:String(route.workspaceId||''),source:String(route.source||''),at:Date.now()}))}catch(e){}
    return true;
  }catch(error){
    console.error('训练页路由恢复失败',error);
    showStatus('未能恢复指定的发布题目，请重新选择已发布试卷。');
    return false;
  }
}

function installQuestionTrainingReadonlyGuard(){
  if(document.body.dataset.qtReadonlyGuardBound)return;
  document.body.dataset.qtReadonlyGuardBound='1';
  document.addEventListener('click',e=>{
    if(authIsLoggedIn() && (!window.KGRolePermissions || window.KGRolePermissions.can('useTraining')))return;
    const inQuestion=e.target.closest&&e.target.closest('#questionModal');
    if(!inQuestion)return;
    if(e.target.closest('#closeQuestionBtn'))return;
    const interactive=e.target.closest('.q-clue,.q-option,#qPrevQuestionBtn,#qNextQuestionBtn,#qSubmitBtn,#qResetBtn,#qGraphBtn,#qAddToCanvasBtn,#qFlashBtn,#qDeepRecallBtn,#qStartPaperBtn,#qExitPaperBtn,#qPaperSelect,.question-font-tools button');
    if(interactive){
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      if(authIsLoggedIn())showStatus('当前角色没有考题训练操作权限。');else authOpen('登录后才能进行考题训练：包括切换题目、点击关键词、选择答案、提交、生成本题图谱、调整训练字体、选择试卷或进入深度回忆。')
    }
  },true)
}

async function initQuestionTrainingPage(){
  initQuestionTrainingAuth();
  installQuestionTrainingReadonlyGuard();
  try{
    await window.KGQuestionCatalogAdapter.ready;
    window.KGLearningProgress?.registerAdapter?.('single_deep_study',{flush:()=>window.KGGuidedLearningCanvas?.flushPendingConclusion?.(),clearTransient:()=>{try{if(typeof qNewMvpState==='function')qMvpState=qNewMvpState()}catch(e){};try{window.dispatchEvent(new CustomEvent('kg:learning-session-reset',{detail:{reason:'context-switch'}}))}catch(e){}}});
    if(typeof qbLoadBanks==='function')qbLoadBanks();
    const routed=applyQuestionTrainingRoute();
    if(!routed)ensureSingleDeepPublishedSelection();
    if(typeof bindQuestionCaseTabs==='function')bindQuestionCaseTabs();
    if(typeof bindQuestionTrainer==='function')bindQuestionTrainer();
    if(typeof bindQuestionTrainerSafe==='function')bindQuestionTrainerSafe();
    if(typeof bindQuestionBankManager==='function')bindQuestionBankManager();
    if(typeof ensureQuestionFontScale==='function')ensureQuestionFontScale();
    if(typeof renderQuestionTrainer==='function')renderQuestionTrainer();
    if(typeof qSetCaseTab==='function')qSetCaseTab(typeof qActiveCaseTab!=='undefined'?qActiveCaseTab:'question')
  }catch(err){
    console.error(err);
    showStatus('题目目录暂不可用，请稍后刷新重试。')
  }
}
document.addEventListener('DOMContentLoaded',initQuestionTrainingPage);
window.addEventListener('load',()=>setTimeout(()=>{void initQuestionTrainingPage()},0));
