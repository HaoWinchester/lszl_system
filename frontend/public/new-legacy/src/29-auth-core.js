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
  const AUTH_REMOTE_SESSION_KEY = "kg_remote_auth_session_v1";

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
      createdAt: Number(user.createdAt || Date.parse(user.created_at||'') || now),
      updatedAt: Number(user.updatedAt || Date.parse(user.updated_at||'') || user.createdAt || now),
      lastLoginAt: Number(user.lastLoginAt || Date.parse(user.last_login_at||'') || 0),
      lastActiveAt: Number(user.lastActiveAt || Date.parse(user.last_active_at||'') || user.lastLoginAt || 0),
      archivedAt: Number(user.archivedAt || Date.parse(user.archived_at||'') || 0),
      status: normalizeStatus(user.status || "active"),
      role: normalizeRole(user.role || "student"),
      displayName: String(user.displayName || user.display_name || username || ""),
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
  function providerConfig(){
    const raw = globalThis.KG_AUTH_CONFIG || globalThis.KG_APP_CONFIG?.auth || {};
    const mode = String(raw.mode || "local-demo").toLowerCase();
    return {
      mode: mode === "remote" ? "remote" : "local-demo",
      baseUrl: String(raw.baseUrl || "").replace(/\/$/, ""),
      endpoints: {
        login: String(raw.endpoints?.login || "/api/auth/login"),
        register: String(raw.endpoints?.register || "/api/auth/register"),
        logout: String(raw.endpoints?.logout || "/api/auth/logout"),
        session: String(raw.endpoints?.session || "/api/auth/session"),
        profile: String(raw.endpoints?.profile || raw.endpoints?.session || "/api/auth/session")
      },
      credentials: String(raw.credentials || "include"),
      allowLocalRegistration: raw.allowLocalRegistration !== false
    };
  }
  function readRemoteSession(){
    try{
      const raw = sessionStorage.getItem(AUTH_REMOTE_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){return null}
  }
  function writeRemoteSession(session){
    try{
      if(session) sessionStorage.setItem(AUTH_REMOTE_SESSION_KEY, JSON.stringify(session));
      else sessionStorage.removeItem(AUTH_REMOTE_SESSION_KEY);
      return true;
    }catch(e){return false}
  }
  function remoteUser(){
    const session = readRemoteSession();
    if(!session?.user) return null;
    return normalizeUser(session.user.username || session.username || "remote-user", {...session.user, source:"remote"});
  }
  function endpointUrl(path){
    const config = providerConfig();
    if(/^https?:\/\//i.test(path)) return path;
    return config.baseUrl + (String(path||"").startsWith("/") ? String(path||"") : "/"+String(path||""));
  }
  async function remoteRequest(endpoint, options={}){
    const config=providerConfig();
    const session=readRemoteSession();
    const headers={"Content-Type":"application/json",...(options.headers||{})};
    if(session?.token)headers.Authorization="Bearer "+session.token;
    const response=await fetch(endpointUrl(endpoint),{
      method:options.method||"POST",
      credentials:config.credentials,
      headers,
      body:options.body===undefined?undefined:JSON.stringify(options.body)
    });
    let payload={};
    try{payload=await response.json()}catch(e){}
    if(!response.ok)throw new Error(String(payload.detail||payload.message||payload.error||("认证服务请求失败（"+response.status+"）")));
    return payload;
  }
  function currentUsername(){
    try{
      if(providerConfig().mode==="remote"){
        const user=remoteUser();
        if(user?.username)return cleanUsername(user.username);
      }
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
    if(providerConfig().mode==="remote"){
      const user=remoteUser();
      if(!user)return null;
      if(options.includeInactive)return user;
      if(user.status === "paused" || user.status === "archived")return null;
      return user;
    }
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
  async function login(username,password,context={}){
    username=cleanUsername(username);
    password=String(password||"");
    if(!username||!password)return {ok:false,message:"请输入用户名和密码。"};
    if(providerConfig().mode==="remote"){
      try{
        const payload=await remoteRequest(providerConfig().endpoints.login,{body:{username,password,context}});
        const user=normalizeUser(payload.user?.username||payload.username||username,{...(payload.user||{}),username:payload.user?.username||payload.username||username,source:"remote"});
        writeRemoteSession({user,token:payload.token||"",issuedAt:Date.now()});
        try{if(Store.remove)Store.remove(AUTH_SESSION_KEY);else localStorage.removeItem(AUTH_SESSION_KEY)}catch(e){}
        window.dispatchEvent(new CustomEvent("kg-auth-session-change",{detail:{username:user.username,provider:"remote"}}));
        return {ok:true,user,message:String(payload.message||"登录成功")};
      }catch(error){return {ok:false,message:String(error?.message||error)}}
    }
    const map=users();
    const user=map[username];
    if(!user)return {ok:false,message:"用户不存在，请先注册。"};
    if(user.status==="archived")return {ok:false,message:"该账号已归档，请联系管理员恢复。"};
    if(user.status==="paused")return {ok:false,message:"该账号已暂停，请联系管理员恢复。"};
    if(!verifyPassword(username,password,user))return {ok:false,message:"用户名或密码不正确。"};
    const now=Date.now();
    map[username]={...user,lastLoginAt:now,lastActiveAt:now,updatedAt:now};
    saveUsers(map);setCurrentUsername(username);logAction("用户登录",username,String(context.source||"本地登录"));
    return {ok:true,user:map[username],message:"登录成功"};
  }
  async function register(username,password,context={}){
    username=cleanUsername(username);password=String(password||"");
    if(username.length<2)return {ok:false,message:"用户名至少需要 2 个字符。"};
    if(password.length<4)return {ok:false,message:"密码至少需要 4 个字符。"};
    const config=providerConfig();
    if(config.mode==="remote"){
      try{
        const payload=await remoteRequest(config.endpoints.register,{body:{username,password,context}});
        const user=normalizeUser(payload.user?.username||payload.username||username,{...(payload.user||{}),username:payload.user?.username||payload.username||username,source:"remote"});
        writeRemoteSession({user,token:payload.token||"",issuedAt:Date.now()});
        try{if(Store.remove)Store.remove(AUTH_SESSION_KEY);else localStorage.removeItem(AUTH_SESSION_KEY)}catch(e){}
        window.dispatchEvent(new CustomEvent("kg-auth-session-change",{detail:{username:user.username,provider:"remote"}}));
        return {ok:true,user,message:String(payload.message||"注册成功")};
      }catch(error){return {ok:false,message:String(error?.message||error)}}
    }
    if(!config.allowLocalRegistration)return {ok:false,message:"当前环境已关闭前端本地注册，请使用后端账号服务。"};
    const map=users();
    if(map[username])return {ok:false,message:"该用户名已存在，请直接登录。"};
    const salt=makeSalt(),now=Date.now();
    map[username]=normalizeUser(username,{username,salt,hash:passwordHash(username,password,salt),createdAt:now,updatedAt:now,lastLoginAt:now,lastActiveAt:now,status:"active",role:"student",displayName:username,subject:"PMP",source:"self-register"});
    saveUsers(map);setCurrentUsername(username);logAction("用户注册",username,String(context.source||"本地注册"));
    return {ok:true,user:map[username],message:"注册成功"};
  }
  async function logout(context={}){
    const config=providerConfig();
    const username=currentUsername();
    if(config.mode==="remote"){
      try{await remoteRequest(config.endpoints.logout,{body:{context}})}catch(error){console.warn("[KGAuthCore] remote logout failed",error)}
      writeRemoteSession(null);
      try{if(Store.remove)Store.remove(AUTH_SESSION_KEY);else localStorage.removeItem(AUTH_SESSION_KEY)}catch(e){}
      window.dispatchEvent(new CustomEvent("kg-auth-session-change",{detail:{username:"",provider:"remote"}}));
      return {ok:true,username};
    }
    if(username)logAction("用户退出",username,String(context.source||"本地退出"));
    clearSession();
    return {ok:true,username};
  }
  async function refreshSession(){
    const config=providerConfig();
    if(config.mode!=="remote")return {ok:true,user:currentUser(),provider:"local-demo"};
    try{
      const payload=await remoteRequest(config.endpoints.session,{method:"GET"});
      const username=payload.user?.username||payload.username||"";
      if(!username){writeRemoteSession(null);return {ok:false,user:null,provider:"remote"}}
      const user=normalizeUser(username,{...(payload.user||{}),username,source:"remote"});
      writeRemoteSession({user,token:payload.token||readRemoteSession()?.token||"",issuedAt:Date.now()});
      window.dispatchEvent(new CustomEvent("kg-auth-session-change",{detail:{username:user.username,provider:"remote"}}));
      return {ok:true,user,provider:"remote"};
    }catch(error){writeRemoteSession(null);return {ok:false,user:null,provider:"remote",message:String(error?.message||error)}}
  }
  async function updateProfile(patch={}){
    const username=currentUsername();if(!username)return {ok:false,message:"请先登录。"};
    if(providerConfig().mode!=="remote")return {ok:true,user:upsertUser(username,patch),message:"个人资料已保存。"};
    try{
      const payload=await remoteRequest(providerConfig().endpoints.profile,{method:"PUT",body:{
        display_name:patch.displayName,
        email:patch.email,
        phone:patch.phone,
        subject:patch.subject,
        tags:patch.tags,
        note:patch.note,
        current_password:patch.currentPassword||undefined,
        new_password:patch.newPassword||undefined
      }});
      const raw=payload.user||{};const user=normalizeUser(raw.username||username,{...raw,source:"remote"});
      writeRemoteSession({user,token:readRemoteSession()?.token||"",issuedAt:Date.now()});
      window.dispatchEvent(new CustomEvent("kg-user-profile-updated",{detail:{username:user.username,user}}));
      window.dispatchEvent(new CustomEvent("kg-auth-session-change",{detail:{username:user.username,provider:"remote"}}));
      return {ok:true,user,message:String(payload.message||"个人资料已保存。")} ;
    }catch(error){return {ok:false,message:String(error?.message||error||"个人资料保存失败。")}}
  }
  function providerStatus(){
    const config=providerConfig();
    const sameOriginSecure=!config.baseUrl&&String(globalThis.location?.protocol||'')==='https:';
    const remoteSecure=!!config.baseUrl&&/^https:\/\//i.test(config.baseUrl);
    return {mode:config.mode,remote:config.mode==="remote",baseUrl:config.baseUrl,productionReady:config.mode==="remote"&&(sameOriginSecure||remoteSecure),localCredentialsStored:config.mode==="local-demo"};
  }
  function fmtTime(ts){
    if(!ts) return "—";
    try{return new Date(Number(ts)).toLocaleString("zh-CN", {hour12:false})}catch(e){return "—"}
  }

  window.KGAuthCore = {
    AUTH_USERS_KEY,
    AUTH_SESSION_KEY,
    USER_LOG_KEY,
    AUTH_REMOTE_SESSION_KEY,
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
    providerConfig,
    providerStatus,
    login,
    register,
    logout,
    refreshSession,
    updateProfile,
    fmtTime
  };
})();
