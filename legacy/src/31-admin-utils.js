"use strict";

/*
 * 后台/系统页面公共工具。
 * 目标：减少用户管理、系统设置、用户中心等页面中的重复工具函数。
 */
(function(){
  const Auth = window.KGAuthCore || {};
  const Store = window.KGAppStorage || Auth.storage || {};
  const AUTH_USERS_KEY = Auth.AUTH_USERS_KEY || "kg_local_users_v1";
  const AUTH_SESSION_KEY = Auth.AUTH_SESSION_KEY || "kg_local_current_user_v1";
  const USER_LOG_KEY = Auth.USER_LOG_KEY || "kg_user_admin_logs_v1";

  function escapeHTML(value){
    if(Auth.escapeHTML) return Auth.escapeHTML(value);
    return String(value ?? "").replace(/[&<>'"]/g, c => ({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      "'":"&#39;",
      '"':"&quot;"
    }[c]));
  }
  function readJSON(key, fallback){
    if(Auth.readJSON) return Auth.readJSON(key, fallback);
    if(Store.readJSON) return Store.readJSON(key, fallback);
    try{
      const raw = localStorage.getItem(key);
      if(!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    }catch(e){
      return fallback;
    }
  }
  function writeJSON(key, value){
    if(Auth.writeJSON) return Auth.writeJSON(key, value);
    if(Store.writeJSON) return Store.writeJSON(key, value);
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  }
  function uid(prefix="log"){
    if(Auth.uid) return Auth.uid(prefix);
    const c = globalThis.crypto;
    return prefix + "-" + (c && c.randomUUID
      ? c.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36));
  }
  function fmtTime(ts){
    if(Auth.fmtTime) return Auth.fmtTime(ts);
    if(!ts) return "—";
    try{
      return new Date(Number(ts)).toLocaleString("zh-CN", {hour12:false});
    }catch(e){
      return "—";
    }
  }
  function currentActor(){
    if(Auth.currentActor) return Auth.currentActor();
    try{
      return (Store.readString ? Store.readString(AUTH_SESSION_KEY, "") : localStorage.getItem(AUTH_SESSION_KEY)) || "system-admin";
    }catch(e){
      return "system-admin";
    }
  }
  function logAction(action, username="SYSTEM", detail=""){
    if(Auth.logAction) return Auth.logAction(action, username, detail);
    const logs = readJSON(USER_LOG_KEY, []);
    logs.unshift({
      id: uid("log"),
      action,
      username: username || "SYSTEM",
      detail: String(detail || ""),
      actor: currentActor(),
      at: Date.now()
    });
    writeJSON(USER_LOG_KEY, logs.slice(0, 300));
    return logs[0];
  }
  function roleLabel(role){
    const api = window.KGRolePermissions;
    return api && typeof api.roleLabel === "function"
      ? api.roleLabel(role)
      : ({admin:"管理员",teacher:"教师/教研",student:"学员",viewer:"游客"}[role] || role || "学员");
  }
  function statusLabel(status){
    return ({active:"正常",paused:"暂停",archived:"已归档"}[status] || status || "正常");
  }
  function refreshRoleUi(){
    const api = window.KGRolePermissions;
    const status = document.getElementById("authStatus");
    if(api && status && typeof api.renderStatus === "function") api.renderStatus(status);
    if(api && typeof api.decoratePermissionElements === "function") api.decoratePermissionElements();
    if(typeof window.KGGlobalShortcuts === "object" && typeof window.KGGlobalShortcuts.render === "function") window.KGGlobalShortcuts.render();
    if(typeof window.KGUserCenter === "object" && typeof window.KGUserCenter.refresh === "function") window.KGUserCenter.refresh();
  }
  function toast(id, text, timeout=1800){
    const el = typeof id === "string" ? document.getElementById(id) : id;
    if(!el) return;
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(el.__kgToastTimer);
    el.__kgToastTimer = setTimeout(() => el.classList.remove("show"), timeout);
  }

  window.KGAdminUtils = {
    AUTH_USERS_KEY,
    AUTH_SESSION_KEY,
    USER_LOG_KEY,
    escapeHTML,
    readJSON,
    writeJSON,
    uid,
    fmtTime,
    currentActor,
    logAction,
    roleLabel,
    statusLabel,
    refreshRoleUi,
    toast
  };
})();
