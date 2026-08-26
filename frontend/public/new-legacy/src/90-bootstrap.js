'use strict';

/*
 * 应用启动入口。
 * 原单文件依靠 IIFE 内部函数提升；拆分为多文件后，启动动作必须放在最后执行。
 */
window.KGHomepageGraphBootstrap=(async function bootstrapKnowledgeGraphApp(){
  const remote=window.KGGraphFileRemoteAdapter;
  if(remote&&remote.active&&remote.active()){
    try{await remote.initializeCurrent();}
    catch(error){console.warn('[KGGraphFileRemoteAdapter] initialize failed',error);}
  }
  const hadSavedState = load();
  render();
  authInstallGuards();
  authInstallQuestionReadonlyGuard();
  if (window.KGGraphFileTabs && typeof window.KGGraphFileTabs.init === 'function') await window.KGGraphFileTabs.init({currentOnly:true});
  if (window.KGGraphFileAutosave && typeof window.KGGraphFileAutosave.start === 'function') window.KGGraphFileAutosave.start();

  if (typeof bindQuestionTrainer === 'function') bindQuestionTrainer();
  if (typeof bindQuestionBankManager === 'function') bindQuestionBankManager();
  if (typeof bindQuestionTrainerSafe === 'function') bindQuestionTrainerSafe();
  if (typeof ensureQuestionFontScale === 'function') ensureQuestionFontScale();
  const userManagerBtn = $('userManagerBtn');
  if (userManagerBtn) userManagerBtn.onclick = e => {
    e.preventDefault();
    e.stopPropagation();
    const roleApi = window.KGRolePermissions;
    if (roleApi && authIsLoggedIn() && !roleApi.can('accessUserManagement')) {
      showStatus('当前角色无用户管理权限。');
      return;
    }
    if (roleApi && !authIsLoggedIn() && roleApi.hasAdmin()) {
      authOpen('请先以管理员账号登录后进入用户管理。');
      return;
    }
    window.open('user-management.html','_blank');
  };

  async function syncRemoteGraphSession(event){
    if(!remote||!remote.handleSessionChange)return;
    try{
      const file=await remote.handleSessionChange(event);
      if(window.KGGraphFileTabs&&typeof window.KGGraphFileTabs.refresh==='function')await window.KGGraphFileTabs.refresh({currentOnly:true});
      if(!file&&event&&event.detail&&event.detail.authenticated===true)return;
      if(event&&event.detail&&event.detail.authenticated===false){
        if(typeof baseState==='function')state=baseState();
        lastSavedSnapshot='';
      }
      load();
      render();
      if(typeof authRenderStatus==='function')authRenderStatus();
    }catch(error){console.warn('[KGGraphFileRemoteAdapter] session sync failed',error)}
  }
  window.addEventListener('kg:auth-session-changed',syncRemoteGraphSession);
  window.addEventListener('kg-auth-session-change',event=>syncRemoteGraphSession({detail:{...event.detail,authenticated:!!(window.KGAuthCore&&window.KGAuthCore.currentUser&&window.KGAuthCore.currentUser())}}));

  requestAnimationFrame(() => {
    if (!hadSavedState) fitView(true);
    authRenderStatus();
  });
  return true;
})();
