'use strict';
/*
 * bridge.js —— legacy 原版图谱引擎 与 React parent 之间的桥接层。
 *
 * 由 copy-legacy.js 拷入 public/legacy/bridge.js，并在 workbench.html 中
 * 于 23-graph-file-store.js 之后、90-bootstrap.js 调 load() 之前以 <script defer> 注入。
 *
 * 职责：
 *   1. override window.KGGraphFileStore → 内存缓存 + 乐观更新；真正落库交给 parent(filesApi)
 *   2. override 认证/角色/订阅 → 认为已登录、全权限、无配额限制
 *   3. chrome 协同：捕获阶段拦截 首页/新建/登出/升级/训练 等导航 → postMessage 交 React
 *   4. postMessage 协议：onload 发 kg:ready；收 parent 的 kg:hello/kg:load/kg:meta-update/kg:save-result
 *
 * 铁律：不改 legacy 源文件；本文件是 legacy 之外唯一新增的运行时代码。
 */
(function () {
  var PARENT = window.parent;
  var ORIGIN = window.location.origin;
  if (window === PARENT) return; // 防止直接在顶层页面误跑

  function send(msg) {
    try {
      var out = Object.assign({}, msg, { __kgBridge: 1 });
      PARENT.postMessage(out, ORIGIN);
    } catch (e) { /* ignore */ }
  }

  function clone(v) {
    if (v == null) return null;
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; }
  }

  // ---- 1. 初始 user：从 iframe URL query 同步读取，保证 30-auth-guards 加载时即"已登录" ----
  var qp = new URLSearchParams(location.search);
  var bridgeUser = qp.get('u') ? {
    username: qp.get('u'),
    displayName: qp.get('d') || qp.get('u'),
    role: qp.get('r') || 'admin',
    subject: qp.get('s') || 'PMP',
    status: 'active',
    email: '', phone: '', tags: [], note: '', source: 'server'
  } : null;

  // ---- 2. override KGGraphFileStore（23 已定义）----
  // 缓存：{ meta, graphData, learningState }。同步 getter 返回缓存；写操作乐观更新+异步落库。
  var cache = null;

  var FS = window.KGGraphFileStore;
  if (FS) {
    FS.currentOwner = function () { return 'bridge'; };
    FS.ensureInitialized = function () { return cache ? clone({ ...cache.meta, graphData: cache.graphData }) : null; };
    FS.getCurrentFileMeta = function () { return cache ? clone(cache.meta) : null; };
    FS.getCurrentFile = function () { return cache ? clone({ ...cache.meta, graphData: cache.graphData }) : null; };
    FS.getCurrentFileId = function () { return (cache && cache.meta && cache.meta.id) || ''; };
    FS.setCurrentFileId = function () { /* 由 parent 管 current */ };
    FS.getCurrentFileIdByOwner = FS.getCurrentFileId;
    FS.listFiles = function () { return cache ? [clone(cache.meta)] : []; };
    FS.getFileMeta = function (id) { return (cache && cache.meta && cache.meta.id === id) ? clone(cache.meta) : null; };
    FS.getFile = function (id) { return (cache && cache.meta && cache.meta.id === id) ? clone({ ...cache.meta, graphData: cache.graphData }) : null; };
    FS.openFile = function (id) {
      if (!cache || !cache.meta || cache.meta.id !== id) send({ type: 'kg:switch-file', id: id });
      return cache ? clone({ ...cache.meta, graphData: cache.graphData }) : null;
    };
    FS.createFile = function (input) {
      send({ type: 'kg:create-file', name: input && input.name });
      return cache ? clone(cache.meta) : null;
    };
    // 关键：saveFile 必须同步返回非 null，否则 00-config-state.js:234 会 throw。
    FS.saveFile = function (id, graphData, opts) {
      if (!cache) return null;
      cache.graphData = graphData;
      if (opts && opts.name) cache.meta.name = opts.name;
      send({ type: 'kg:save', id: id, graphData: graphData, name: opts && opts.name });
      return clone({ ...cache.meta, graphData: graphData });
    };
    FS.renameFile = function (id, name) {
      if (!cache) return null;
      cache.meta.name = name;
      send({ type: 'kg:rename', id: id, name: name });
      return clone(cache.meta);
    };
    FS.getLastError = function () { return ''; };
    FS.touchFileOpened = function () { /* 由 parent 记 lastOpenedAt */ };
    FS.deleteFile = FS.duplicateFile = FS.restoreFile = FS.emptyTrash = function () { return null; };
    FS.saveFileMeta = FS.patchFileMeta = function () { return cache ? clone(cache.meta) : null; };
  }

  // 屏蔽 legacy localStorage 镜像写入（00:237-241 persistCurrentGraphNow 会写 mirror key）
  var AS = window.KGAppStorage;
  if (AS) {
    AS.writeJSON = function () { return true; };
    AS.writeString = function () { return true; };
    AS.write = function () { return true; };
  }

  // ---- 3. override 认证 / 角色 / 订阅 ----
  // KGAuthCore(29)、KGRolePermissions(34)、KGSubscription(37) 均在 bridge 之前加载。
  var AC = window.KGAuthCore;
  if (AC) {
    AC.currentUser = function () { return bridgeUser ? clone(bridgeUser) : null; };
    AC.currentUsername = function () { return (bridgeUser && bridgeUser.username) || ''; };
    AC.hasAdmin = function () { return true; };
    AC.clearSession = function () { /* 登出交 parent */ };
    AC.setCurrentUsername = function () { return (bridgeUser && bridgeUser.username) || ''; };
  }

  var RP = window.KGRolePermissions;
  if (RP) {
    RP.can = function () { return true; };
    RP.hasAdmin = function () { return true; };
    RP.currentRole = function () { return (bridgeUser && bridgeUser.role) || 'admin'; };
    if (typeof RP.currentRoleLabel !== 'function') RP.currentRoleLabel = function () { return (bridgeUser && bridgeUser.role) || '管理员'; };
    if (typeof RP.applyTheme !== 'function') RP.applyTheme = function () {};
    if (typeof RP.decoratePermissionElements !== 'function') RP.decoratePermissionElements = function () {};
  }

  var SUB = window.KGSubscription;
  if (SUB) SUB.requireUsageLimit = function () { return true; };

  // ---- 4. 数据注入：parent 发 kg:load → 写缓存 → 复用 legacy load()/render() ----
  function applyLoad(payload) {
    cache = { meta: payload.meta, graphData: payload.graphData, learningState: payload.learningState || null };
    // 复用 legacy load()：内部调 ensureInitialized(已 override 返回 cache) → state=sanitizeState(graphData)
    try { if (typeof window.load === 'function') window.load(); } catch (e) { console.warn('[bridge] load() failed', e); }
    try { if (typeof window.render === 'function') window.render(); } catch (e) {}
    try { if (typeof window.fitView === 'function') window.fitView(true); } catch (e) {}
    try { if (window.KGGraphFileTabs && window.KGGraphFileTabs.refresh) window.KGGraphFileTabs.refresh(); } catch (e) {}
    send({ type: 'kg:loaded', id: cache.meta && cache.meta.id });
  }

  function refreshChrome() {
    try { if (typeof window.renderHeader === 'function') window.renderHeader(); } catch (e) {}
    try { if (window.KGGraphFileTabs && window.KGGraphFileTabs.refresh) window.KGGraphFileTabs.refresh(); } catch (e) {}
    try { if (typeof window.authRenderStatus === 'function') window.authRenderStatus(); } catch (e) {}
  }

  // ---- 5. chrome 协同：捕获阶段拦截导航/登出/新建/训练 ----
  var NAV = {
    '#graphFileHomeBtn': { nav: '/files' },
    '#upgradeMemberBtn': { nav: '/member' },
    '#accountMenuUserCenterBtn': { nav: '/member' },
    '#accountMenuUpgradeBtn': { nav: '/member' },
    '#accountMenuSessionBtn': { logout: true },
    '#graphFileAddBtn': { create: true },
    '#questionTrainBtn': { nav: '/training' }
  };
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    for (var sel in NAV) {
      if (!Object.prototype.hasOwnProperty.call(NAV, sel)) continue;
      var el = t.closest(sel);
      if (el) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        var action = NAV[sel];
        if (action.nav) send({ type: 'kg:navigate', to: action.nav });
        else if (action.logout) send({ type: 'kg:logout' });
        else if (action.create) send({ type: 'kg:create-file' });
        return;
      }
    }
  }, true);

  // ---- 6. 接收 parent 消息 ----
  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN) return;
    var msg = e.data;
    if (!msg || !msg.type || String(msg.type).indexOf('kg:') !== 0) return;
    switch (msg.type) {
      case 'kg:hello':
        if (msg.user) {
          bridgeUser = {
            username: msg.user.username || (bridgeUser && bridgeUser.username) || '',
            displayName: msg.user.display_name || msg.user.displayName || (bridgeUser && bridgeUser.displayName) || '',
            role: msg.user.role || (bridgeUser && bridgeUser.role) || 'admin',
            subject: msg.user.subject || (bridgeUser && bridgeUser.subject) || 'PMP',
            status: 'active', email: '', phone: '', tags: [], note: '', source: 'server'
          };
          refreshChrome();
        }
        break;
      case 'kg:load':
        applyLoad(msg);
        break;
      case 'kg:meta-update':
        if (cache && msg.meta) cache.meta = msg.meta;
        refreshChrome();
        break;
      case 'kg:save-result':
        if (msg.meta && cache) cache.meta = msg.meta;
        break;
      case 'kg:auth-change':
        // parent 登出：交由 React 卸载 iframe，此处不处理
        break;
    }
  });

  // ---- 7. onload 握手 ----
  function ready() { send({ type: 'kg:ready' }); }
  if (document.readyState === 'complete' || document.readyState === 'interactive') ready();
  else window.addEventListener('DOMContentLoaded', ready, { once: true });
})();
