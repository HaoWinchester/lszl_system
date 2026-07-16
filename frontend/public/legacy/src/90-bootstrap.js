'use strict';

/*
 * 应用启动入口。
 * 原单文件依靠 IIFE 内部函数提升；拆分为多文件后，启动动作必须放在最后执行。
 */
(function bootstrapKnowledgeGraphApp(){
  const hadSavedState = load();
  render();
  authInstallGuards();
  authInstallQuestionReadonlyGuard();
  if (window.KGGraphFileTabs && typeof window.KGGraphFileTabs.init === 'function') window.KGGraphFileTabs.init();
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

  requestAnimationFrame(() => {
    if (!hadSavedState) fitView(true);
    authRenderStatus();
  });
})();
