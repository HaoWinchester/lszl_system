"use strict";

/*
 * 后台/系统页面公共工具。
 * 目标：减少用户管理、系统设置、用户中心等页面中的重复工具函数。
 */
(function(){
  const Auth = window.KGAuthCore || {};

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
    return "system-admin";
  }
  function logAction(action, username="SYSTEM", detail=""){
    if(Auth.logAction) return Auth.logAction(action, username, detail);
    return {id:uid("log"),action,username:username||"SYSTEM",detail:String(detail||""),actor:currentActor(),at:Date.now()};
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
    escapeHTML,
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
