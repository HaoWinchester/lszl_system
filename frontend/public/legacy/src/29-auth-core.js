"use strict";

/*
 * 认证与用户数据核心模块。
 *
 * 第一步重构目标：
 * - 统一 localStorage key、用户读取/保存、当前登录用户、用户规范化、密码 hash、日志写入。
 * - 权限、订阅、系统设置等模块优先通过本模块获取用户上下文。
 * - 保留旧登录/用户管理逻辑的原有函数名和行为，避免一次性大改造成回归。
 * - 当前仍是纯前端 localStorage 原型；正式网络版必须迁移到后端校验。
 */
(function(){
  const Store = window.KGAppStorage || {};
  const AUTH_USERS_KEY = "kg_local_users_v1";
  const AUTH_SESSION_KEY = "kg_local_current_user_v1";
  const USER_LOG_KEY = "kg_user_admin_logs_v1";

  const ROLES = ["admin","teacher","student","viewer"];
  const STATUSES = ["active","paused","archived"];

  function readJSON(key, fallback){
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
    if(Store.writeJSON) return Store.writeJSON(key, value);
    try{
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    }catch(e){
      console.warn("[KGAuthCore] writeJSON failed", key, e);
      return false;
    }
  }
  function escapeHTML(value){
    return String(value ?? "").replace(/[&<>'"]/g, c => ({
      "&":"&amp;",
      "<":"&lt;",
      ">":"&gt;",
      "'":"&#39;",
      '"':"&quot;"
    }[c]));
  }
  function uid(prefix="id"){
    const c = globalThis.crypto;
    return prefix + "-" + (c && c.randomUUID
      ? c.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36));
  }
  function hash(str){
    let h = 2166136261;
    str = String(str || "");
    for(let i=0;i<str.length;i++){
      h ^= str.charCodeAt(i);
      h += (h<<1) + (h<<4) + (h<<7) + (h<<8) + (h<<24);
    }
    return (h >>> 0).toString(36);
  }
  function makeSalt(){
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function cleanUsername(value){
    return String(value || "").trim().replace(/\s+/g, "_").slice(0, 32);
  }
  function normalizeRole(role, fallback="student"){
    role = String(role || fallback || "student");
    return ROLES.includes(role) ? role : fallback;
  }
  function normalizeStatus(status, fallback="active"){
    status = String(status || fallback || "active");
    return STATUSES.includes(status) ? status : fallback;
  }
  function cleanTags(value){
    if(Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
    return String(value || "").split(/[,，、;；|]/).map(s => s.trim()).filter(Boolean);
  }
  function normalizeUser(username, user){
    user = user && typeof user === "object" ? user : {};
    const now = Date.now();
    username = cleanUsername(username || user.username || "");
    return {
      ...user,
      username,
      salt: String(user.salt || makeSalt()),
      hash: String(user.hash || ""),
      createdAt: Number(user.createdAt || now),
      updatedAt: Number(user.updatedAt || user.createdAt || now),
      lastLoginAt: Number(user.lastLoginAt || 0),
      lastActiveAt: Number(user.lastActiveAt || user.lastLoginAt || 0),
      archivedAt: Number(user.archivedAt || 0),
      status: normalizeStatus(user.status || "active"),
      role: normalizeRole(user.role || "student"),
      displayName: String(user.displayName || username || ""),
      email: String(user.email || ""),
      phone: String(user.phone || ""),
      subject: String(user.subject || "PMP"),
      tags: cleanTags(user.tags),
      note: String(user.note || ""),
      source: String(user.source || "local")
    };
  }
  function users(){
    const raw = readJSON(AUTH_USERS_KEY, {});
    const out = {};
    Object.keys(raw || {}).forEach(username => {
      const clean = cleanUsername(username);
      if(clean) out[clean] = normalizeUser(clean, raw[username]);
    });
    return out;
  }
  function saveUsers(nextUsers){
    const out = {};
    Object.entries(nextUsers || {}).forEach(([username,user]) => {
      const clean = cleanUsername(username || (user && user.username));
      if(clean) out[clean] = normalizeUser(clean, user);
    });
    return writeJSON(AUTH_USERS_KEY, out);
  }
  function currentUsername(){
    try{
      const raw = Store.readString ? Store.readString(AUTH_SESSION_KEY, "") : localStorage.getItem(AUTH_SESSION_KEY);
      return cleanUsername(raw || "");
    }catch(e){return ""}
  }
  function setCurrentUsername(username){
    username = cleanUsername(username);
    if(username){
      if(Store.writeString) Store.writeString(AUTH_SESSION_KEY, username);
      else localStorage.setItem(AUTH_SESSION_KEY, username);
    }else{
      if(Store.remove) Store.remove(AUTH_SESSION_KEY);
      else localStorage.removeItem(AUTH_SESSION_KEY);
    }
    window.dispatchEvent(new CustomEvent("kg-auth-session-change", {detail:{username}}));
    return username;
  }
  function clearSession(){
    return setCurrentUsername("");
  }
  function currentUser(options={}){
    const username = currentUsername();
    if(!username) return null;
    const user = users()[username];
    if(!user) return null;
    if(options.includeInactive) return user;
    if(user.status === "paused" || user.status === "archived") return null;
    return user;
  }
  function hasAdmin(){
    return Object.values(users()).some(u => u.role === "admin" && u.status === "active");
  }
  function passwordHash(username, password, salt){
    return hash(String(salt) + "|" + String(username).toLowerCase() + "|" + String(password));
  }
  function verifyPassword(username, password, user){
    user = user || users()[cleanUsername(username)];
    if(!user) return false;
    return passwordHash(username, password, user.salt) === user.hash;
  }
  function upsertUser(username, patch={}){
    username = cleanUsername(username || patch.username);
    if(!username) return null;
    const map = users();
    const current = map[username] || {};
    const next = normalizeUser(username, {...current, ...patch, username, updatedAt:Date.now()});
    map[username] = next;
    saveUsers(map);
    window.dispatchEvent(new CustomEvent("kg-auth-users-change", {detail:{username,user:next}}));
    return next;
  }
  function removeUser(username){
    username = cleanUsername(username);
    if(!username) return false;
    const map = users();
    if(!map[username]) return false;
    delete map[username];
    saveUsers(map);
    window.dispatchEvent(new CustomEvent("kg-auth-users-change", {detail:{username,deleted:true}}));
    return true;
  }
  function currentActor(){
    return currentUsername() || "system-admin";
  }
  function logAction(action, username="SYSTEM", detail=""){
    const logs = readJSON(USER_LOG_KEY, []);
    const entry = {
      id: uid("log"),
      action: String(action || ""),
      username: String(username || "SYSTEM"),
      detail: String(detail || ""),
      actor: currentActor(),
      at: Date.now()
    };
    logs.unshift(entry);
    writeJSON(USER_LOG_KEY, logs.slice(0, 300));
    window.dispatchEvent(new CustomEvent("kg-user-log-change", {detail:entry}));
    return entry;
  }
  function fmtTime(ts){
    if(!ts) return "—";
    try{return new Date(Number(ts)).toLocaleString("zh-CN", {hour12:false})}catch(e){return "—"}
  }

  window.KGAuthCore = {
    AUTH_USERS_KEY,
    AUTH_SESSION_KEY,
    USER_LOG_KEY,
    ROLES,
    STATUSES,
    readJSON,
    writeJSON,
    storage: Store,
    readString: Store.readString,
    writeString: Store.writeString,
    removeStorage: Store.remove,
    escapeHTML,
    uid,
    hash,
    makeSalt,
    cleanUsername,
    normalizeRole,
    normalizeStatus,
    normalizeUser,
    users,
    saveUsers,
    currentUsername,
    setCurrentUsername,
    clearSession,
    currentUser,
    hasAdmin,
    passwordHash,
    verifyPassword,
    upsertUser,
    removeUser,
    currentActor,
    logAction,
    fmtTime
  };
})();
