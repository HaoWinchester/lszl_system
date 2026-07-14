'use strict';

/*
 * 角色权限与角色主题模块。
 * 当前版本仍基于浏览器 localStorage，适合前端原型 / 本地多用户验证。
 * 后续接入后端时，所有权限判断都应在服务器端再次校验。
 */
(function(){
  const AUTH_USERS_KEY='kg_local_users_v1';
  const AUTH_SESSION_KEY='kg_local_current_user_v1';
  const ROLE_THEME_KEY='kg_role_themes_v1';
  const DEMO_BANK_ID='bank-pmp-demo';
  const DEMO_QUESTION_ID='pmp-agile-change-001';
  const Auth=window.KGAuthCore||{};
  const Store=window.KGAppStorage||Auth.storage||{};

  const ROLE_LABELS={
    admin:'管理员',
    teacher:'教师/教研',
    student:'学员',
    viewer:'游客',
    guest:'访客'
  };

  const PERMISSION_LABELS={
    editGraph:'编辑个人知识图谱',
    accessQuestionBank:'进入题库管理',
    manageQuestionBank:'新建/编辑/删除题库',
    editQuestions:'编辑题目与认知标注',
    importData:'导入题库/数据',
    exportData:'导出题库/数据',
    managePapers:'组卷与维护试卷',
    publishPapers:'发布/取消发布试卷',
    useTraining:'参加考题训练',
    useDeepRecall:'使用深度回忆',
    accessUserManagement:'进入用户管理',
    accessSystemSettings:'进入系统设置',
    manageUsers:'新建/编辑/归档用户',
    modifyRoleThemes:'修改角色主题',
    viewLogs:'查看操作日志'
  };

  const ROLE_PERMISSIONS={
    admin:Object.keys(PERMISSION_LABELS),
    teacher:[
      'editGraph','accessQuestionBank','manageQuestionBank','editQuestions',
      'importData','exportData','managePapers','publishPapers',
      'useTraining','useDeepRecall'
    ],
    student:['editGraph','useTraining','useDeepRecall'],
    viewer:['useTraining','useDeepRecall']
  };

  const DEFAULT_THEMES={
    admin:{primary:'#7c3aed',accent:'#f59e0b',soft:'#f5f3ff',text:'#3b0764'},
    teacher:{primary:'#0284c7',accent:'#14b8a6',soft:'#e0f2fe',text:'#075985'},
    student:{primary:'#2563eb',accent:'#22c55e',soft:'#dbeafe',text:'#1e3a8a'},
    viewer:{primary:'#64748b',accent:'#94a3b8',soft:'#f1f5f9',text:'#334155'},
    guest:{primary:'#0f172a',accent:'#64748b',soft:'#f8fafc',text:'#334155'}
  };

  function readJSON(key,fallback){
    if(Auth.readJSON)return Auth.readJSON(key,fallback);
    if(Store.readJSON)return Store.readJSON(key,fallback);
    return (()=>{try{const raw=localStorage.getItem(key);if(!raw)return fallback;const parsed=JSON.parse(raw);return parsed==null?fallback:parsed}catch(e){return fallback}})();
  }
  function writeJSON(key,value){
    if(Auth.writeJSON)return Auth.writeJSON(key,value);
    if(Store.writeJSON)return Store.writeJSON(key,value);
    localStorage.setItem(key,JSON.stringify(value));
    return true;
  }
  function escapeHTML(value){
    return Auth.escapeHTML ? Auth.escapeHTML(value) : String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }
  function normalizeRole(role){
    if(Auth.normalizeRole)return Auth.normalizeRole(role);
    role=String(role||'student');
    return ROLE_LABELS[role]?role:'student';
  }
  function normalizeUser(username,user){
    if(Auth.normalizeUser)return Auth.normalizeUser(username,user);
    user=user&&typeof user==='object'?user:{};
    return {
      username:String(username||user.username||''),
      displayName:String(user.displayName||username||''),
      role:normalizeRole(user.role||'student'),
      status:String(user.status||'active'),
      subject:String(user.subject||'PMP')
    };
  }
  function users(){
    if(Auth.users)return Auth.users();
    const raw=readJSON(AUTH_USERS_KEY,{});
    const out={};
    Object.keys(raw||{}).forEach(username=>{out[username]=normalizeUser(username,raw[username])});
    return out;
  }
  function currentUsername(){
    if(Auth.currentUsername)return Auth.currentUsername();
    try{return Store.readString?Store.readString(AUTH_SESSION_KEY,''):(localStorage.getItem(AUTH_SESSION_KEY)||'')}catch(e){return ''}
  }
  function currentUser(){
    if(Auth.currentUser)return Auth.currentUser();
    const username=currentUsername();
    if(!username)return null;
    const u=users()[username];
    if(!u || u.status==='paused' || u.status==='archived')return null;
    return u;
  }
  function currentRole(){
    const u=currentUser();
    return u?normalizeRole(u.role):'guest';
  }
  function roleLabel(role=currentRole()){
    return ROLE_LABELS[normalizeRole(role)] || ROLE_LABELS.guest;
  }
  function hasAdmin(){
    // 只有正常可登录的管理员才算有效管理员，避免唯一管理员被暂停后锁死用户管理入口。
    return Object.values(users()).some(u=>u.role==='admin' && u.status==='active');
  }
  function permissionsForRole(role){
    role=normalizeRole(role);
    return new Set(ROLE_PERMISSIONS[role] || []);
  }
  function can(permission){
    const u=currentUser();
    if(!u)return false;
    if(u.role==='admin')return true;
    return permissionsForRole(u.role).has(permission);
  }
  function canRole(role,permission){
    role=normalizeRole(role);
    if(role==='admin')return true;
    return permissionsForRole(role).has(permission);
  }
  function canEnterUserManagement(){
    return can('accessUserManagement') || !hasAdmin();
  }
  function getThemes(){
    const saved=readJSON(ROLE_THEME_KEY,{});
    const themes={};
    Object.keys(DEFAULT_THEMES).forEach(role=>{
      themes[role]={...DEFAULT_THEMES[role], ...(saved&&saved[role]||{})};
    });
    return themes;
  }
  function getTheme(role=currentRole()){
    const themes=getThemes();
    return themes[role] || themes.guest || DEFAULT_THEMES.guest;
  }
  function cleanThemePatch(theme){
    theme=theme&&typeof theme==='object'?theme:{};
    const clean={};
    ['primary','accent','soft','text'].forEach(key=>{
      if(theme[key])clean[key]=String(theme[key]);
    });
    return clean;
  }
  function saveTheme(role,theme){
    role=normalizeRole(role);
    const themes=getThemes();
    themes[role]={...DEFAULT_THEMES[role],...themes[role],...cleanThemePatch(theme)};
    writeJSON(ROLE_THEME_KEY,themes);
    applyTheme();
    window.dispatchEvent(new CustomEvent('kg-role-theme-change',{detail:{role,theme:themes[role]}}));
    return themes[role];
  }
  function resetTheme(role){
    role=normalizeRole(role);
    const themes=getThemes();
    themes[role]={...DEFAULT_THEMES[role]};
    writeJSON(ROLE_THEME_KEY,themes);
    applyTheme();
    window.dispatchEvent(new CustomEvent('kg-role-theme-change',{detail:{role,theme:themes[role]}}));
    return themes[role];
  }
  function applyTheme(role=currentRole()){
    const theme=getTheme(role);
    const doc=document.documentElement;
    doc.style.setProperty('--role-primary',theme.primary);
    doc.style.setProperty('--role-accent',theme.accent);
    doc.style.setProperty('--role-soft',theme.soft);
    doc.style.setProperty('--role-text',theme.text);
    doc.style.setProperty('--primary',theme.primary);
    doc.style.setProperty('--primary-dark',theme.primary);
    doc.style.setProperty('--line',theme.primary);
    if(document.body){
      document.body.dataset.roleTheme=role;
      document.body.dataset.role=role;
    }
    return theme;
  }
  function renderStatus(el){
    if(!el)return;
    const u=currentUser();
    const hasMenu=String(el.dataset.accountMenuTrigger||'').toLowerCase()==='true';
    el.classList.toggle('logged-in',!!u);
    if(!hasMenu){
      if(!u){
        el.innerHTML='<span class="role-dot"></span><span>未登录 · 访客只读</span>';
        return;
      }
      const role=u.role;
      const theme=getTheme(role);
      el.innerHTML=`<span class="role-dot" style="background:${escapeHTML(theme.primary)}"></span><span>已登录：${escapeHTML(u.displayName||u.username)}</span><span class="role-badge">${escapeHTML(roleLabel(role))}</span>`;
      return;
    }
    const chevron='<svg aria-hidden="true" class="account-menu-chevron" viewBox="0 0 20 20"><path d="m6 8 4 4 4-4"/></svg>';
    if(!u){
      el.innerHTML=`<span class="role-dot"></span><span class="auth-status-label">访客只读</span>${chevron}`;
      el.setAttribute('aria-label','访客只读，打开账号菜单');
      el.title='打开账号菜单';
      return;
    }
    const role=u.role;
    const theme=getTheme(role);
    const label=String(u.displayName||u.username||'用户');
    el.innerHTML=`<span class="role-dot" style="background:${escapeHTML(theme.primary)}"></span><span class="auth-status-label">${escapeHTML(label)}</span>${chevron}`;
    el.setAttribute('aria-label',`${label}，打开账号菜单`);
    el.title='打开账号菜单';
  }
  function permissionAllowedForElement(el){
    const current=currentUser();
    const guestAllowed=String(el.dataset.permissionGuest||'').toLowerCase()==='true';
    const any=String(el.dataset.permissionAny||el.dataset.permission||'').split(/[,，\s]+/).map(s=>s.trim()).filter(Boolean);
    if(!current){
      if(any.includes('accessUserManagement')&&!hasAdmin())return true;
      return guestAllowed;
    }
    if(any.length)return any.some(permission=>can(permission));
    return true;
  }
  function decoratePermissionElements(root=document){
    (root||document).querySelectorAll('[data-permission],[data-permission-any]').forEach(el=>{
      if(!el.dataset.originalTitle && el.title)el.dataset.originalTitle=el.title;
      const allowed=permissionAllowedForElement(el);
      const mode=el.dataset.permissionMode || 'hide';
      if(mode==='hide'){
        el.hidden=!allowed;
        el.classList.toggle('permission-hidden',!allowed);
        el.setAttribute('aria-hidden',String(!allowed));
      }else{
        el.classList.toggle('permission-disabled',!allowed);
        if('disabled' in el)el.disabled=!allowed;
        el.setAttribute('aria-disabled',String(!allowed));
      }
      if(!allowed)el.title=el.dataset.permissionTip || '当前角色无此权限';
      else if(el.dataset.originalTitle)el.title=el.dataset.originalTitle;
    });
  }
  function requirePermission(permission,message){
    if(can(permission))return true;
    const label=PERMISSION_LABELS[permission] || permission || '该操作';
    const role=currentUser()?roleLabel(currentRole()):'未登录';
    const msg=message || `当前身份（${role}）没有“${label}”权限。`;
    if(typeof showStatus==='function')showStatus(msg);
    else alert(msg);
    return false;
  }
  function renderPermissionDenied(container,message){
    const target=container || document.body;
    target.innerHTML=`<section class="role-permission-denied">
      <div class="role-denied-card">
        <div class="role-denied-icon">🔐</div>
        <h1>暂无访问权限</h1>
        <p>${escapeHTML(message||'当前角色无权访问该页面。请使用管理员账号登录，或联系管理员调整角色。')}</p>
        <div class="role-denied-actions">
          <a href="index.html">返回首页</a>
          <a href="question-training.html">进入考题训练</a>
        </div>
      </div>
    </section>`;
  }

  function demoBankIdFromQuestion(question, explicitBankId=''){
    if(explicitBankId)return String(explicitBankId);
    const q=question&&typeof question==='object'?question:{};
    return String(q.sourceBankId||q.bankId||q.bankID||q.sourceBank||'');
  }
  function demoQuestionIdFromQuestion(question){
    const q=question&&typeof question==='object'?question:{};
    return String(q.sourceQuestionId||q.questionId||q.id||'');
  }
  function isDemoQuestion(question, explicitBankId=''){
    const bankId=demoBankIdFromQuestion(question, explicitBankId);
    const questionId=demoQuestionIdFromQuestion(question);
    return bankId===DEMO_BANK_ID && questionId===DEMO_QUESTION_ID;
  }
  function canOperateQuestion(question, explicitBankId=''){
    const u=currentUser();
    if(!u)return false;
    if(u.role==='viewer')return isDemoQuestion(question, explicitBankId);
    return can('useTraining');
  }
  function canUseDeepRecallQuestion(question, explicitBankId=''){
    const u=currentUser();
    if(!u)return false;
    if(u.role==='viewer')return isDemoQuestion(question, explicitBankId);
    return can('useDeepRecall');
  }
  function questionDeniedMessage(){
    return currentRole()==='viewer'?'游客只能体验内置 PMP 示例题，其他题目不可操作。':'当前角色没有操作这道题目的权限。';
  }

  function roleRows(){
    return ['admin','teacher','student','viewer'].map(role=>({
      role,
      label:ROLE_LABELS[role],
      permissions:Object.keys(PERMISSION_LABELS).filter(p=>canRole(role,p))
    }));
  }

  window.KGRolePermissions={
    ROLE_LABELS,
    PERMISSION_LABELS,
    ROLE_PERMISSIONS,
    DEFAULT_THEMES,
    users,
    currentUser,
    currentRole,
    currentRoleLabel:()=>roleLabel(currentRole()),
    roleLabel,
    hasAdmin,
    can,
    canRole,
    canEnterUserManagement,
    getThemes,
    getTheme,
    saveTheme,
    resetTheme,
    applyTheme,
    renderStatus,
    decoratePermissionElements,
    require:requirePermission,
    renderPermissionDenied,
    isDemoQuestion,
    canOperateQuestion,
    canUseDeepRecallQuestion,
    questionDeniedMessage,
    roleRows,
    escapeHTML
  };

  document.addEventListener('DOMContentLoaded',()=>{
    applyTheme();
    decoratePermissionElements();
    const status=document.getElementById('authStatus');
    if(status)renderStatus(status);
  });
})();
