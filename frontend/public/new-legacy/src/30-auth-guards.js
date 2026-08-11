'use strict';

/*
 * 本文件由原单文件 HTML 自动拆分而来。
 * 维护建议：继续把本文件中的强耦合函数逐步迁移为显式模块 API。
 */

/* 本地登录与多用户管理核心 */
const AuthCore=window.KGAuthCore||{};
const AppStorage=window.KGAppStorage||AuthCore.storage||{};
const AUTH_USERS_KEY=AuthCore.AUTH_USERS_KEY||'kg_local_users_v1';
const AUTH_SESSION_KEY=AuthCore.AUTH_SESSION_KEY||'kg_local_current_user_v1';
const USER_ADMIN_LOG_KEY=AuthCore.USER_LOG_KEY||'kg_user_admin_logs_v1';
function authHash(str){
  return AuthCore.hash ? AuthCore.hash(str) : (()=>{let h=2166136261;str=String(str||'');for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h+=(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)}return (h>>>0).toString(36)})();
}
function authNormalizeUserRecord(username,user){
  return AuthCore.normalizeUser ? AuthCore.normalizeUser(username,user) : (()=>{user=user&&typeof user==='object'?user:{};const now=Date.now();return {salt:String(user.salt||authMakeSalt()),hash:String(user.hash||''),createdAt:Number(user.createdAt||now),updatedAt:Number(user.updatedAt||user.createdAt||now),lastLoginAt:Number(user.lastLoginAt||0),lastActiveAt:Number(user.lastActiveAt||user.lastLoginAt||0),archivedAt:Number(user.archivedAt||0),status:String(user.status||'active'),role:String(user.role||'student'),displayName:String(user.displayName||username),email:String(user.email||''),phone:String(user.phone||''),subject:String(user.subject||'PMP'),tags:Array.isArray(user.tags)?user.tags.map(String):String(user.tags||'').split(/[,，、;；|]/).map(s=>s.trim()).filter(Boolean),note:String(user.note||''),source:String(user.source||'local')}})();
}
function authUsers(){
  if(AuthCore.users)return AuthCore.users();
  try{
    const data=AppStorage.readJSON?AppStorage.readJSON(AUTH_USERS_KEY,{}):JSON.parse(localStorage.getItem(AUTH_USERS_KEY)||'{}');
    if(!data||typeof data!=='object')return{};
    const users={};
    Object.keys(data).forEach(username=>{users[username]=authNormalizeUserRecord(username,data[username])});
    return users;
  }catch(e){return{}}
}
function authSaveUsers(users){
  if(AuthCore.saveUsers)return AuthCore.saveUsers(users||{});
  if(AppStorage.writeJSON)AppStorage.writeJSON(AUTH_USERS_KEY,users||{});
  else localStorage.setItem(AUTH_USERS_KEY,JSON.stringify(users||{}));
}
function authLogAction(action,username='',detail=''){
  try{
    if(AuthCore.logAction)return AuthCore.logAction(action,username,detail);
    const logs=AppStorage.readJSON?AppStorage.readJSON(USER_ADMIN_LOG_KEY,[]):JSON.parse(localStorage.getItem(USER_ADMIN_LOG_KEY)||'[]');
    logs.unshift({id:uid('log'),action:String(action||''),username:String(username||''),detail:String(detail||''),actor:(authCurrentUser&&authCurrentUser.username)||'local',at:Date.now()});
    if(AppStorage.writeJSON)AppStorage.writeJSON(USER_ADMIN_LOG_KEY,logs.slice(0,300));
    else localStorage.setItem(USER_ADMIN_LOG_KEY,JSON.stringify(logs.slice(0,300)));
  }catch(e){}
}
function authUserKey(username){
  return STORE_KEY+'__user__'+encodeURIComponent(String(username||'').trim().toLowerCase());
}
function authPublicKey(){
  return STORE_KEY+'__public_view';
}
function authLoadSession(){
  try{
    if(AuthCore.currentUser){
      const user=AuthCore.currentUser();
      if(user&&user.username)return {username:user.username};
      if(AuthCore.currentUsername&&AuthCore.currentUsername())AuthCore.clearSession&&AuthCore.clearSession();
      return null;
    }
    const username=AppStorage.readString?AppStorage.readString(AUTH_SESSION_KEY,''):localStorage.getItem(AUTH_SESSION_KEY);
    if(!username)return null;
    const users=authUsers();
    const user=users[username];
    if(user&&user.status!=='archived'&&user.status!=='paused')return {username};
    if(AppStorage.remove)AppStorage.remove(AUTH_SESSION_KEY);
    else localStorage.removeItem(AUTH_SESSION_KEY);
    return null;
  }catch(e){return null}
}
let authCurrentUser=authLoadSession();
function authIsLoggedIn(){
  // 远程模式下 authCurrentUser 闭包可能在登录 reload 后未同步，优先读权威源 KGAuthCore。
  const core=window.KGAuthCore;
  if(core&&typeof core.currentUser==='function'){try{if(core.currentUser())return true}catch(e){}}
  return !!(authCurrentUser&&authCurrentUser.username)
}
function currentStoreKey(){
  const core=window.KGAuthCore;
  const username=(core&&typeof core.currentUsername==='function')?core.currentUsername():(authCurrentUser&&authCurrentUser.username||'');
  return username?authUserKey(username):authPublicKey();
}
function authCleanUsername(v){
  return AuthCore.cleanUsername ? AuthCore.cleanUsername(v) : String(v||'').trim().replace(/\s+/g,'_').slice(0,32);
}
function authMakeSalt(){
  return AuthCore.makeSalt ? AuthCore.makeSalt() : Math.random().toString(36).slice(2)+Date.now().toString(36);
}
function authPasswordHash(username,password,salt){
  return AuthCore.passwordHash ? AuthCore.passwordHash(username,password,salt) : authHash(String(salt)+'|'+String(username).toLowerCase()+'|'+String(password));
}
function authMsg(text,ok=false){
  if(window.KGSharedAuthDialog)return window.KGSharedAuthDialog.message(text,ok);
  const el=$('authMsg');if(!el)return;
  el.textContent=text||'';
  el.classList.toggle('ok',!!ok);
}
function authOpen(reason='未登录时只能查看图谱，登录后可以新增、编辑、连线和保存自己的内容。'){
  if(window.KGSharedAuthDialog)return window.KGSharedAuthDialog.open(reason);
  const modal=$('authModal');
  if(!modal)return false;
  $('authReason').textContent=reason||'未登录时只能查看，登录后可以编辑自己的内容。';
  authMsg('');
  modal.classList.add('show');
  modal.setAttribute('aria-hidden','false');
  setTimeout(()=>{$('authUsername')&&$('authUsername').focus()},80);
  return true;
}
function authClose(){
  if(window.KGSharedAuthDialog)return window.KGSharedAuthDialog.close();
  const modal=$('authModal');if(!modal)return false;
  modal.classList.remove('show');modal.setAttribute('aria-hidden','true');return true;
}
function authRenderStatus(){
  const status=$('authStatus'),login=$('authLoginBtn'),logout=$('authLogoutBtn');
  document.body.classList.toggle('auth-readonly',!authIsLoggedIn());
  const roleApi=window.KGRolePermissions;
  if(roleApi){
    roleApi.applyTheme();
    if(status)roleApi.renderStatus(status);
    roleApi.decoratePermissionElements();
  }else if(status){
    const loggedIn=authIsLoggedIn();
    const label=loggedIn&&authCurrentUser?authCurrentUser.username:'访客只读';
    const safeLabel=AuthCore&&typeof AuthCore.escapeHTML==='function'?AuthCore.escapeHTML(label):String(label).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
    const chevron=String(status.dataset.accountMenuTrigger||'').toLowerCase()==='true'?'<svg aria-hidden="true" class="account-menu-chevron" viewBox="0 0 20 20"><path d="m6 8 4 4 4-4"/></svg>':'';
    status.classList.toggle('logged-in',loggedIn);
    status.innerHTML=`<span class="role-dot"></span><span class="auth-status-label">${safeLabel}</span>${chevron}`;
  }
  if(login)login.hidden=true;
  if(logout)logout.hidden=true;
  if(window.KGAccountMenu&&typeof window.KGAccountMenu.refresh==='function')window.KGAccountMenu.refresh();
}
function authLoadCurrentSpace(copyCurrentIfEmpty=false){
  const currentSnapshot=saveableState();
  const key=currentStoreKey();
  if(copyCurrentIfEmpty&&!(AppStorage.exists?AppStorage.exists(key):localStorage.getItem(key)!=null)){
    try{if(AppStorage.writeJSON)AppStorage.writeJSON(key,currentSnapshot);else localStorage.setItem(key,JSON.stringify(currentSnapshot))}catch(e){console.warn(e)}
  }
  state=templateState('pmp');
  state.selectedNodeId=null;state.selectedLinkId=null;state.linkSourceId=null;
  lastSavedSnapshot='';
  const had=load();
  normalizeState();
  render();
  if(window.KGGraphFileAutosave&&window.KGGraphFileAutosave.clearDirty)window.KGGraphFileAutosave.clearDirty('space-loaded');
  if(window.KGGraphFileTabs&&window.KGGraphFileTabs.refresh)window.KGGraphFileTabs.refresh();
  requestAnimationFrame(()=>{if(!had)fitView(true)});
  authRenderStatus();
}
function authLogin(username,password){
  username=authCleanUsername(username);
  if(!username||!password){authMsg('请输入用户名和密码。');return false}
  const users=authUsers(),user=users[username];
  if(!user){authMsg('用户不存在，请先注册。');return false}
  if(user.status==='archived'){authMsg('该账号已归档，请联系管理员恢复后再登录。');return false}
  if(user.status==='paused'){authMsg('该账号已暂停，请联系管理员恢复后再登录。');return false}
  if(authPasswordHash(username,password,user.salt)!==user.hash){authMsg('密码不正确。');return false}
  user.lastLoginAt=Date.now();
  user.lastActiveAt=Date.now();
  user.updatedAt=Date.now();
  users[username]=user;
  authSaveUsers(users);
  authCurrentUser={username};
  if(AuthCore.setCurrentUsername)AuthCore.setCurrentUsername(username);
  else if(AppStorage.writeString)AppStorage.writeString(AUTH_SESSION_KEY,username);
  else localStorage.setItem(AUTH_SESSION_KEY,username);
  authLogAction('用户登录',username);
  authClose();
  authLoadCurrentSpace(false);
  showStatus(`已登录：${username}`);
  return true;
}
function authRegister(username,password){
  username=authCleanUsername(username);
  if(username.length<2){authMsg('用户名至少 2 个字符。');return false}
  if(String(password||'').length<4){authMsg('密码至少 4 个字符。');return false}
  const users=authUsers();
  if(users[username]){authMsg('该用户名已存在，请直接登录。');return false}
  const salt=authMakeSalt();
  users[username]=authNormalizeUserRecord(username,{salt,hash:authPasswordHash(username,password,salt),createdAt:Date.now(),updatedAt:Date.now(),lastLoginAt:Date.now(),lastActiveAt:Date.now(),status:'active',role:'student',displayName:username,subject:'PMP',source:'self-register'});
  authSaveUsers(users);
  authCurrentUser={username};
  if(AuthCore.setCurrentUsername)AuthCore.setCurrentUsername(username);
  else if(AppStorage.writeString)AppStorage.writeString(AUTH_SESSION_KEY,username);
  else localStorage.setItem(AUTH_SESSION_KEY,username);
  authLogAction('用户注册',username,'注册并登录');
  authClose();
  authLoadCurrentSpace(true);
  showStatus(`已注册并登录：${username}`);
  return true;
}
async function authLogout(){
  if(authIsLoggedIn()&&saveNow({silent:true})===false){showStatus('当前图谱保存失败，已取消退出。请先导出学习包备份或清理浏览器存储空间。');return false}
  const old=authCurrentUser&&authCurrentUser.username;
  const remote=Boolean(AuthCore.providerStatus?.().remote);
  if(remote&&typeof AuthCore.logout==='function'){
    // 远程会话必须由认证核心清除：调用后端 /logout、移除 sessionStorage 会话缓存。
    await AuthCore.logout({source:'图谱账号菜单退出'});
    authCurrentUser=null;
    // 兜底：即便 direct-entry 未触发整页 reload，也立即把顶栏刷成访客态，避免残留用户名。
    authRenderStatus();
    return true;
  }
  if(old)authLogAction('用户退出',old);
  authCurrentUser=null;
  if(AuthCore.clearSession)AuthCore.clearSession();
  else if(AppStorage.remove)AppStorage.remove(AUTH_SESSION_KEY);
  else localStorage.removeItem(AUTH_SESSION_KEY);
  authLoadCurrentSpace(false);
  showStatus(old?`已退出：${old}。当前为游客浏览模式。`:'当前为游客浏览模式。');
  return true;
}
function authAfterExternalLogin(username,message='第三方登录成功'){
  username=authCleanUsername(username);
  if(!username)return false;
  authCurrentUser={username};
  if(AuthCore.setCurrentUsername)AuthCore.setCurrentUsername(username);
  else if(AppStorage.writeString)AppStorage.writeString(AUTH_SESSION_KEY,username);
  else localStorage.setItem(AUTH_SESSION_KEY,username);
  authLogAction(message.includes('微信')?'微信扫码登录':'第三方登录',username,message);
  authClose();
  authLoadCurrentSpace(false);
  showStatus(`${message}：${username}`);
  return true;
}
window.KGAuthRuntime={
  afterExternalLogin:authAfterExternalLogin,
  openAuth:authOpen,
  closeAuth:authClose,
  logout:authLogout,
  renderStatus:authRenderStatus,
  isLoggedIn:authIsLoggedIn,
  currentUsername:()=>{const c=window.KGAuthCore;if(c&&c.currentUsername){try{return c.currentUsername()}catch(e){}}return authCurrentUser&&authCurrentUser.username||''}
};
function authRequire(reason,permission='editGraph'){
  if(!authIsLoggedIn()){
    authOpen(reason||'该操作需要登录后才能编辑。');
    return false;
  }
  const roleApi=window.KGRolePermissions;
  if(roleApi && permission && !roleApi.can(permission)){
    const msg=`当前角色（${roleApi.currentRoleLabel()}）没有执行该操作的权限。`;
    showStatus(msg);
    return false;
  }
  return true;
}
function authViewNodeReadOnly(id){
  const n=nodeById(id);if(!n)return;
  clearMultiSelection&&clearMultiSelection();
  clearHoverDetail&&clearHoverDetail(false);
  state.selectedNodeId=id;state.selectedLinkId=null;state.linkSourceId=null;
  refreshSelectionUI();
  showStatus(`游客查看：“${n.title}”。登录后可拖动、编辑或连线。`);
}
const AUTH_EDIT_SELECTOR=[
  '#addBtn','#templateBtn','#sizeSmallBtn','#sizeBigBtn','#lineSolidBtn','#lineDashedBtn',
  '#importBtn','#resetBtn','#mAddBtn','#mEditBtn','#mLinkBtn','#mSizeBtn','#mLineStyleBtn','#mGraphBtn',
  '#saveNodeBtn','#deleteNodeBtn','#saveLinkBtn','#deleteLinkBtn','#saveGraphBtn',
  '#tutorialStartAddBtn','#qAddToCanvasBtn','#qFlashBtn','#flashImportBtn','#flashAddMissingBtn',
  '.node-size-btn','.template-card'
].join(',');
const AUTH_EDIT_CHANGE_SELECTOR='#lineColorPicker,#importFile,#flashFile,#nTitle,#nCategory,#nColor,#nSize,#nLevel,#nKeywords,#nSummary,#nNotes,#linkType,#linkStyle,#linkColor,#linkNote,#gTitle,#gSubject,#gAudience,#gDescription';
function authInstallGuards(){
  const login=$('authLoginBtn'),logout=$('authLogoutBtn');
  if(window.KGSharedAuthDialog)window.KGSharedAuthDialog.configure({
    defaultReason:'未登录时只能查看图谱，登录后可以新增、编辑、连线和保存自己的内容。',
    source:'自由模式登录',
    logout:window.KGAuthRuntime?.logout||authLogout,
    renderStatus:authRenderStatus
  });
  if(login)login.onclick=()=>authOpen('登录后可以新增、编辑、连线和保存自己的图谱。');
  if(logout)logout.onclick=authLogout;

  document.addEventListener('click',e=>{
    if(authIsLoggedIn() && (!window.KGRolePermissions || window.KGRolePermissions.can('editGraph')))return;
    if(e.target.closest&&e.target.closest('#authModal,#authLoginBtn,#tutorialBtn,#flashcardBtn,#focusBtn,#fitBtn,#zoomInBtn,#zoomOutBtn,#exportBtn,#hideHelpBtn,#floatingToolboxHandle,#graphMetaDisplay,#closeQuestionBtn,#closeTutorialBtn,#tutorialCloseBottomBtn,#closeFlashcardBtn,#flashCurrentBtn,#flashLibraryBtn,#flashImportedBtn,#flashDueBtn,#flashImportantBtn,#flashShuffleBtn,#flashTemplateBtn,#flashGuideBtn'))return;
    const edit=e.target.closest&&e.target.closest(AUTH_EDIT_SELECTOR);
    if(edit){
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      if(authIsLoggedIn())showStatus('当前角色无图谱编辑权限。');else authOpen('登录后才能进行新增、编辑、导入、清空、加入图谱或生成个人闪卡。');
    }
  },true);

  document.addEventListener('change',e=>{
    if(authIsLoggedIn() && (!window.KGRolePermissions || window.KGRolePermissions.can('editGraph')))return;
    if(e.target.matches&&e.target.matches(AUTH_EDIT_CHANGE_SELECTOR)){
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      if(authIsLoggedIn())showStatus('当前角色无图谱编辑权限。');else authOpen('登录后才能修改图谱内容或导入数据。');
      try{e.target.value=e.target.defaultValue||''}catch(err){}
    }
  },true);

  if(cardsLayer&&!cardsLayer.dataset.authReadonlyBound){
    cardsLayer.dataset.authReadonlyBound='1';
    cardsLayer.addEventListener('pointerdown',e=>{
      if(authIsLoggedIn() && (!window.KGRolePermissions || window.KGRolePermissions.can('editGraph')))return;
      const card=e.target.closest&&e.target.closest('.knowledge-card');
      if(!card)return;
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      authViewNodeReadOnly(card.dataset.nodeId);
    },true);
    cardsLayer.addEventListener('dblclick',e=>{
      if(authIsLoggedIn() && (!window.KGRolePermissions || window.KGRolePermissions.can('editGraph')))return;
      const card=e.target.closest&&e.target.closest('.knowledge-card');
      if(!card)return;
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      if(authIsLoggedIn())showStatus('当前角色无图谱编辑权限。');else authOpen('登录后才能双击设为连线起点并建立关系。');
    },true);
  }
  if(stage&&!stage.dataset.authReadonlyBound){
    stage.dataset.authReadonlyBound='1';
    stage.addEventListener('dblclick',e=>{
      if(authIsLoggedIn() && (!window.KGRolePermissions || window.KGRolePermissions.can('editGraph')))return;
      if(isUI(e.target))return;
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      if(authIsLoggedIn())showStatus('当前角色无图谱编辑权限。');else authOpen('登录后才能在画布上新建知识点。');
    },true);
  }
  document.addEventListener('dblclick',e=>{
    if(authIsLoggedIn() && (!window.KGRolePermissions || window.KGRolePermissions.can('editGraph')))return;
    if(e.target.closest&&e.target.closest('.edge-hit')){
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      if(authIsLoggedIn())showStatus('当前角色无图谱编辑权限。');else authOpen('登录后才能编辑关系线。');
    }
  },true);
  authRenderStatus();
}

/* 考题训练未登录只读权限修复 */
function authInstallQuestionReadonlyGuard(){
  document.addEventListener('click',e=>{
    if(authIsLoggedIn() && (!window.KGRolePermissions || window.KGRolePermissions.can('useTraining')))return;
    const inQuestion=e.target.closest&&e.target.closest('#questionModal');
    if(!inQuestion)return;
    if(e.target.closest('#closeQuestionBtn'))return;
    const interactive=e.target.closest('.q-clue,.q-option,#qPrevQuestionBtn,#qNextQuestionBtn,#qSubmitBtn,#qResetBtn,#qGraphBtn,#qAddToCanvasBtn,#qFlashBtn,.question-font-tools button');
    if(interactive){
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if(authIsLoggedIn())showStatus('当前角色无考题训练权限。');else authOpen('登录后才能进行考题训练：包括切换题目、点击关键词、选择答案、提交、生成本题图谱、调整训练字体、加入总图谱或生成闪卡。');
    }
  },true);
}

const __authOpenNodeModal=openNodeModal;
openNodeModal=function(id,isNew=false){
  if(!authRequire(isNew?'登录后才能创建知识点。':'登录后才能编辑知识点。'))return;
  return __authOpenNodeModal(id,isNew);
};
const __authCreateNodeAt=createNodeAt;
createNodeAt=function(x,y){
  if(!authRequire('登录后才能在画布上新建知识点。'))return;
  return __authCreateNodeAt(x,y);
};
const __authActivateLinkSource=activateLinkSource;
activateLinkSource=function(id){
  if(!authRequire('登录后才能设为连线起点。'))return;
  return __authActivateLinkSource(id);
};
const __authOpenLinkModal=openLinkModal;
openLinkModal=function(id){
  if(!authRequire('登录后才能编辑关系线。'))return;
  return __authOpenLinkModal(id);
};
const __authDeleteNode=deleteNode;
deleteNode=function(id,fromModal=false){
  if(!authRequire('登录后才能删除知识点。'))return;
  return __authDeleteNode(id,fromModal);
};
const __authApplyNodeSize=applyNodeSize;
applyNodeSize=function(size){
  if(!authRequire('登录后才能修改卡牌尺寸。'))return;
  return __authApplyNodeSize(size);
};
const __authApplyLineStyle=applyLineStyle;
applyLineStyle=function(style){
  if(!authRequire('登录后才能修改关系线样式。'))return;
  return __authApplyLineStyle(style);
};
const __authApplyLineColor=applyLineColor;
applyLineColor=function(color){
  if(!authRequire('登录后才能修改线条或卡牌颜色。'))return;
  return __authApplyLineColor(color);
};

if(typeof submitQuestionAnswer==='function'){
  const __auth_submitQuestionAnswer=submitQuestionAnswer;
  submitQuestionAnswer=function(){
    if(!authRequire('登录后才能提交答案。'))return;
    return __auth_submitQuestionAnswer.apply(this,arguments);
  };
}


if(typeof generateQuestionGraph==='function'){
  const __auth_generateQuestionGraph=generateQuestionGraph;
  generateQuestionGraph=function(){
    if(!authRequire('登录后才能生成本题知识图谱。'))return;
    return __auth_generateQuestionGraph.apply(this,arguments);
  };
}


if(typeof resetQuestionTrainer==='function'){
  const __auth_resetQuestionTrainer=resetQuestionTrainer;
  resetQuestionTrainer=function(){
    if(!authRequire('登录后才能重置本题训练。'))return;
    return __auth_resetQuestionTrainer.apply(this,arguments);
  };
}

if(typeof addFlashcardToCanvas==='function'){
  const __authAddFlashcardToCanvas=addFlashcardToCanvas;
  addFlashcardToCanvas=function(card){
    if(!authRequire('登录后才能把闪卡加入画布。'))return;
    return __authAddFlashcardToCanvas(card);
  };
}
if(typeof addAllMissingFlashcardsToCanvas==='function'){
  const __authAddAllMissingFlashcardsToCanvas=addAllMissingFlashcardsToCanvas;
  addAllMissingFlashcardsToCanvas=function(){
    if(!authRequire('登录后才能批量把闪卡加入画布。'))return;
    return __authAddAllMissingFlashcardsToCanvas();
  };
}
if(typeof addQuestionGraphToCanvas==='function'){
  const __authAddQuestionGraphToCanvas=addQuestionGraphToCanvas;
  addQuestionGraphToCanvas=function(){
    if(!authRequire('登录后才能把本题知识点加入总图谱。'))return;
    return __authAddQuestionGraphToCanvas();
  };
}
if(typeof addQuestionFlashcards==='function'){
  const __authAddQuestionFlashcards=addQuestionFlashcards;
  addQuestionFlashcards=function(){
    if(!authRequire('登录后才能生成个人闪卡。'))return;
    return __authAddQuestionFlashcards();
  };
}
