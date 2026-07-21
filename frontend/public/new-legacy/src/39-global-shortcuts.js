"use strict";

/*
 * 全局快捷悬浮栏。
 * 仅负责跨页面入口、权限显示、拖拽位置持久化；不接管各页面自身业务逻辑。
 */
(function(){
  const Store = window.KGAppStorage || {};
  const STORAGE_POS = "kg_global_shortcuts_position_v1";
  const STORAGE_LAYOUT = "kg_global_shortcuts_layout_v1";

  const ICONS = {
    home: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 10.8 12 3l9 7.8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
    training: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9.5 9a2.8 2.8 0 1 1 4.6 2.1c-1.2.9-2.1 1.5-2.1 3"/><circle cx="12" cy="18" r=".8" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="9"/></svg>',
    recall: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 4a7 7 0 0 0-7 7c0 2.4 1.2 4.5 3 5.8V20h8v-3.2a7 7 0 0 0-4-12.8Z"/><path d="M9 11h6M10 15h4"/></svg>',
    bank: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H20v16H7.5A2.5 2.5 0 0 0 5 21.5z"/><path d="M5 5.5v16M9 7h7M9 11h7"/></svg>',
    users: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    settings: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.05.05a2.1 2.1 0 1 1-2.97 2.97l-.05-.05A1.8 1.8 0 0 0 14.8 19.6a1.8 1.8 0 0 0-1.8 1.4 2.1 2.1 0 0 1-4.1 0 1.8 1.8 0 0 0-1.8-1.4 1.8 1.8 0 0 0-1.98.36l-.05.05a2.1 2.1 0 1 1-2.97-2.97l.05-.05A1.8 1.8 0 0 0 2.6 15 1.8 1.8 0 0 0 1.2 13.2a2.1 2.1 0 0 1 0-4.1A1.8 1.8 0 0 0 2.6 7.3a1.8 1.8 0 0 0-.36-1.98l-.05-.05A2.1 2.1 0 1 1 5.16 2.3l.05.05A1.8 1.8 0 0 0 7.2 2.7 1.8 1.8 0 0 0 9 1.3a2.1 2.1 0 0 1 4.1 0 1.8 1.8 0 0 0 1.8 1.4 1.8 1.8 0 0 0 1.98-.36l.05-.05a2.1 2.1 0 1 1 2.97 2.97l-.05.05A1.8 1.8 0 0 0 19.4 7.3a1.8 1.8 0 0 0 1.4 1.8 2.1 2.1 0 0 1 0 4.1A1.8 1.8 0 0 0 19.4 15Z"/></svg>',
    grip: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 6h.01M16 6h.01M8 12h.01M16 12h.01M8 18h.01M16 18h.01"/></svg>',
    toggle: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>'
  };

  const ITEMS = [
    {id:"home", label:"首页", href:"index.html", className:"home", always:true, icon:ICONS.home},
    {id:"training", label:"考题训练", href:"question-training.html", className:"training", permission:"useTraining", guestView:true, icon:ICONS.training},
    {id:"recall", label:"深度回忆", href:"knowledge-recall.html", className:"recall", permission:"useDeepRecall", guestView:true, icon:ICONS.recall},
    {id:"bank", label:"题库管理", href:"question-bank.html", className:"bank", permission:"accessQuestionBank", icon:ICONS.bank},
    {id:"users", label:"用户管理", href:"user-management.html", className:"users", permission:"accessUserManagement", allowWhenNoAdmin:true, icon:ICONS.users},
    {id:"settings", label:"系统设置", href:"system-settings.html", className:"settings", permission:"accessSystemSettings", icon:ICONS.settings}
  ];

  const qs = (sel, root=document) => root.querySelector(sel);

  function roleApi(){
    return window.KGRolePermissions || null;
  }
  function canShow(item){
    if(item.always) return true;
    const api = roleApi();
    if(!api) return false;
    // 访客可进入训练与深度回忆页面进行只读浏览，页面内部继续拦截所有学习操作。
    if(item.guestView && typeof api.currentUser === "function" && !api.currentUser()) return true;
    if(item.allowWhenNoAdmin && typeof api.canEnterUserManagement === "function") return api.canEnterUserManagement();
    return !!(item.permission && api.can(item.permission));
  }
  function currentPage(){
    const path = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    return path || "index.html";
  }
  function isCurrent(item){
    return currentPage() === item.href.toLowerCase();
  }
  function readJSON(key, fallback){
    if(Store.readJSON) return Store.readJSON(key, fallback);
    try{
      const raw = window.KGServerStateStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    }catch(e){
      return fallback;
    }
  }
  function writeJSON(key, value){
    if(Store.writeJSON){Store.writeJSON(key, value);return}
    try{ window.KGServerStateStorage.setItem(key, JSON.stringify(value)); }catch(e){}
  }
  function setStatus(message){
    const status = document.getElementById("status");
    if(status && typeof window.showStatus === "function"){
      window.showStatus(message);
    }else if(status){
      status.textContent = message;
      status.classList.add("show");
      clearTimeout(setStatus.timer);
      setStatus.timer = setTimeout(() => status.classList.remove("show"), 2200);
    }
  }
  function clamp(value, min, max){
    return Math.max(min, Math.min(max, value));
  }
  function applySavedPosition(el){
    const pos = readJSON(STORAGE_POS, null);
    if(!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return;
    const rect = el.getBoundingClientRect();
    const width = rect.width || 168;
    const height = rect.height || 220;
    const maxX = Math.max(8, window.innerWidth - width - 8);
    const maxY = Math.max(8, window.innerHeight - height - 8);
    const x = clamp(pos.x, 8, maxX);
    const y = clamp(pos.y, 8, maxY);
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.right = "auto";
    el.style.bottom = "auto";
  }
  function savePosition(el){
    const rect = el.getBoundingClientRect();
    writeJSON(STORAGE_POS, {x: Math.round(rect.left), y: Math.round(rect.top)});
  }
  function installDrag(el, handle){
    if(!el || !handle) return;
    const isInteractiveDragTarget = target => !!(target && target.closest && target.closest('button,a,input,select,textarea,label,[role="button"],[data-global-shortcut]'));
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;
    const move = event => {
      if(!dragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if(Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      const rect = el.getBoundingClientRect();
      const width = rect.width || 168;
      const height = rect.height || 220;
      const x = clamp(originX + dx, 8, Math.max(8, window.innerWidth - width - 8));
      const y = clamp(originY + dy, 8, Math.max(8, window.innerHeight - height - 8));
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.style.right = "auto";
      el.style.bottom = "auto";
      event.preventDefault();
    };
    const up = () => {
      if(!dragging) return;
      dragging = false;
      el.classList.remove("dragging");
      savePosition(el);
      setTimeout(() => { moved = false; }, 0);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointerdown", event => {
      if(event.button != null && event.button !== 0) return;
      if(isInteractiveDragTarget(event.target)) return;
      dragging = true;
      moved = false;
      const rect = el.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      originX = rect.left;
      originY = rect.top;
      el.classList.add("dragging");
      handle.setPointerCapture && handle.setPointerCapture(event.pointerId);
      document.addEventListener("pointermove", move, {passive:false});
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
      event.preventDefault();
    });
    el.addEventListener("click", event => {
      if(moved && !isInteractiveDragTarget(event.target)){
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);
    window.addEventListener("resize", () => applySavedPosition(el));
  }
  function normalizeLayout(value){
    return value === "horizontal" ? "horizontal" : "vertical";
  }
  function readLayout(){
    return normalizeLayout(readJSON(STORAGE_LAYOUT, "vertical"));
  }
  function applyLayout(el, layout){
    const next = normalizeLayout(layout);
    el.dataset.layout = next;
    el.classList.toggle("layout-horizontal", next === "horizontal");
    el.classList.toggle("layout-vertical", next !== "horizontal");
    const toggle = el.querySelector("#kgGlobalShortcutsToggle");
    if(toggle){
      toggle.setAttribute("aria-label", next === "horizontal" ? "当前水平排布，点击切换为纵向排布" : "当前纵向排布，点击切换为水平排布");
      toggle.setAttribute("title", next === "horizontal" ? "水平排布，点击切换为纵向" : "纵向排布，点击切换为水平");
    }
    const label = el.querySelector("[data-layout-label]");
    if(label) label.textContent = next === "horizontal" ? "水平排布" : "纵向排布";
  }

  function openItem(event, item){
    if(isCurrent(item)){
      event.preventDefault();
      setStatus("当前已经在" + item.label + "。");
      return;
    }
    if(!canShow(item)){
      event.preventDefault();
      setStatus("当前角色无“" + item.label + "”权限。");
      return;
    }
  }
  function render(){
    const existing = document.getElementById("kgGlobalShortcuts");
    if(existing) existing.remove();

    const visible = ITEMS.filter(canShow);
    if(!visible.length) return;

    const el = document.createElement("aside");
    el.className = "kg-global-shortcuts";
    el.id = "kgGlobalShortcuts";
    el.setAttribute("aria-label", "全局快捷入口");

    const layout = readLayout();

    el.innerHTML = `
      <div class="kg-global-shortcuts-head" id="kgGlobalShortcutsHandle" title="按住拖拽快捷栏">
        <div class="kg-global-shortcuts-title">
          <span class="kg-global-shortcuts-grip">${ICONS.grip}</span>
          <div>
            <strong>全局快捷</strong>
            <small data-layout-label>${layout === "horizontal" ? "水平排布" : "纵向排布"}</small>
          </div>
        </div>
        <button class="kg-global-shortcuts-toggle" id="kgGlobalShortcutsToggle" type="button">${ICONS.toggle}</button>
      </div>
      <nav class="kg-global-shortcuts-body" aria-label="快捷入口列表">
        ${visible.map(item => `
          <a class="kg-global-shortcuts-link ${item.className || ""} ${isCurrent(item) ? "current" : ""}" href="${item.href}" data-global-shortcut="${item.id}" title="${item.label}">
            ${item.icon}
            <span>${item.label}</span>
          </a>
        `).join("") || '<div class="kg-global-shortcuts-empty">当前角色暂无可用快捷入口。</div>'}
      </nav>
    `;

    document.body.appendChild(el);
    applyLayout(el, layout);
    applySavedPosition(el);

    const handle = document.getElementById("kgGlobalShortcutsHandle");
    const toggle = document.getElementById("kgGlobalShortcutsToggle");
    installDrag(el, handle);
    if(toggle){
      toggle.addEventListener("pointerdown", event => event.stopPropagation());
      toggle.addEventListener("mousedown", event => event.stopPropagation());
      toggle.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        const next = el.dataset.layout === "horizontal" ? "vertical" : "horizontal";
        writeJSON(STORAGE_LAYOUT, next);
        applyLayout(el, next);
        requestAnimationFrame(() => {
          applySavedPosition(el);
          savePosition(el);
        });
      });
    }
    el.querySelectorAll("[data-global-shortcut]").forEach(link => {
      const item = ITEMS.find(x => x.id === link.dataset.globalShortcut);
      if(item) link.addEventListener("click", event => openItem(event, item));
    });
  }

  function init(){
    render();
    window.addEventListener("storage", event => {
      if(!event.key || event.key.indexOf("kg_local_") === 0 || event.key === STORAGE_POS || event.key === STORAGE_LAYOUT) render();
    });
    window.addEventListener("kg-role-theme-change", render);
    window.addEventListener("kg-wechat-login-success", () => setTimeout(render, 300));
    document.addEventListener("click", event => {
      const target = event.target && event.target.closest && event.target.closest("#authDoLoginBtn,#authRegisterBtn,#authLogoutBtn,#umSaveUserBtn,#umDeleteUserBtn,#umArchiveUserBtn,#umRestoreUserBtn,#umSetActiveBtn,#umSetPausedBtn");
      if(target) setTimeout(render, 550);
    }, true);
    document.addEventListener("change", event => {
      const target = event.target && event.target.closest && event.target.closest("#umRole,#umStatus");
      if(target) setTimeout(render, 550);
    }, true);
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.KGGlobalShortcuts = {render, readLayout};
})();
