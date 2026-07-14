'use strict';

/*
 * 用户管理服务层。
 *
 * 职责：
 * - 集中处理用户创建、资料更新、密码重置、状态变更、复制、删除和批量操作。
 * - 集中处理用户导入/导出数据结构与持久化事件。
 * - 不负责页面 DOM、弹窗、确认框、Toast 和列表渲染。
 *
 * 当前仍是纯前端 localStorage 原型；正式网络版应把这些写操作迁移到后端 API。
 */
(function(){
  function core(){ return window.KGAuthCore || null; }
  function clone(value){
    if(typeof structuredClone === 'function'){
      try{return structuredClone(value)}catch(e){}
    }
    return JSON.parse(JSON.stringify(value == null ? {} : value));
  }
  function failure(code, message, extra={}){
    return {ok:false, code:String(code||'ERROR'), message:String(message||'操作失败'), ...extra};
  }
  function success(users, extra={}){
    return {ok:true, users:normalizeUsers(users), ...extra};
  }
  function requireCore(){
    const api=core();
    return api && typeof api.normalizeUser==='function' && typeof api.cleanUsername==='function' ? api : null;
  }
  function normalizeUsers(input){
    const api=requireCore();
    if(!api) return {};
    const out={};
    Object.entries(input&&typeof input==='object'?input:{}).forEach(([username,user])=>{
      const clean=api.cleanUsername(username || (user&&user.username));
      if(clean) out[clean]=api.normalizeUser(clean,user);
    });
    return out;
  }
  function loadUsers(){
    const api=requireCore();
    if(!api || typeof api.users!=='function')return {};
    const normalized=normalizeUsers(api.users());
    const sorted={};
    Object.keys(normalized).sort((a,b)=>a.localeCompare(b,'zh-CN')).forEach(username=>{sorted[username]=normalized[username]});
    return sorted;
  }
  function persist(users, options={}){
    const api=requireCore();
    if(!api || typeof api.saveUsers!=='function') return failure('AUTH_CORE_UNAVAILABLE','认证核心未加载，无法保存用户');
    const next=normalizeUsers(users);
    if(!api.saveUsers(next)) return failure('SAVE_FAILED','用户数据保存失败', {users:next});

    const current=typeof api.currentUsername==='function'?api.currentUsername():'';
    if(current && !next[current] && typeof api.clearSession==='function') api.clearSession();

    if(!options.silent){
      try{
        window.dispatchEvent(new CustomEvent('kg-auth-users-change',{detail:{
          source:'user-management-service',
          total:Object.keys(next).length,
          ...options.detail
        }}));
      }catch(e){}
    }
    return success(next);
  }
  function createUser(users, input={}){
    const api=requireCore();
    if(!api) return failure('AUTH_CORE_UNAVAILABLE','认证核心未加载');
    const next=normalizeUsers(users);
    const username=api.cleanUsername(input.username);
    const password=String(input.password||'');
    if(username.length<2) return failure('INVALID_USERNAME','用户名至少 2 个字符');
    if(next[username]) return failure('USERNAME_EXISTS','该用户名已存在');
    if(password.length<4) return failure('INVALID_PASSWORD','密码至少 4 个字符');
    const salt=api.makeSalt();
    next[username]=api.normalizeUser(username,{
      ...(input.user||{}),
      username,
      salt,
      hash:api.passwordHash(username,password,salt),
      createdAt:Date.now(),
      updatedAt:Date.now(),
      displayName:String((input.user&&input.user.displayName)||username),
      role:String((input.user&&input.user.role)||'student'),
      status:String((input.user&&input.user.status)||'active'),
      subject:String((input.user&&input.user.subject)||'PMP'),
      source:String((input.user&&input.user.source)||'user-management')
    });
    return success(next,{username,user:next[username]});
  }
  function updateUser(users, username, patch={}){
    const api=requireCore();
    if(!api) return failure('AUTH_CORE_UNAVAILABLE','认证核心未加载');
    const next=normalizeUsers(users);
    username=api.cleanUsername(username);
    if(!username || !next[username]) return failure('USER_NOT_FOUND','用户不存在');
    const current=next[username];
    const merged={...current,...clone(patch),username,updatedAt:Date.now()};
    if(Object.prototype.hasOwnProperty.call(patch,'status')){
      merged.archivedAt=patch.status==='archived'?(current.archivedAt||Date.now()):0;
    }
    next[username]=api.normalizeUser(username,merged);
    return success(next,{username,user:next[username]});
  }
  function resetPassword(users, username, password){
    const api=requireCore();
    if(!api) return failure('AUTH_CORE_UNAVAILABLE','认证核心未加载');
    username=api.cleanUsername(username);
    password=String(password||'');
    const next=normalizeUsers(users);
    if(!username || !next[username]) return failure('USER_NOT_FOUND','用户不存在');
    if(password.length<4) return failure('INVALID_PASSWORD','密码至少 4 个字符');
    const salt=api.makeSalt();
    next[username]=api.normalizeUser(username,{
      ...next[username],
      salt,
      hash:api.passwordHash(username,password,salt),
      updatedAt:Date.now()
    });
    return success(next,{username,user:next[username]});
  }
  function setStatus(users, username, status){
    const api=requireCore();
    if(!api) return failure('AUTH_CORE_UNAVAILABLE','认证核心未加载');
    status=String(status||'');
    if(!api.STATUSES || !api.STATUSES.includes(status)) return failure('INVALID_STATUS','账号状态无效');
    return updateUser(users,username,{status});
  }
  function duplicateUser(users, sourceUsername, input={}){
    const api=requireCore();
    if(!api) return failure('AUTH_CORE_UNAVAILABLE','认证核心未加载');
    const next=normalizeUsers(users);
    sourceUsername=api.cleanUsername(sourceUsername);
    const username=api.cleanUsername(input.username);
    const password=String(input.password||'');
    if(!sourceUsername || !next[sourceUsername]) return failure('USER_NOT_FOUND','来源用户不存在');
    if(username.length<2) return failure('INVALID_USERNAME','用户名至少 2 个字符');
    if(next[username]) return failure('USERNAME_EXISTS','该用户名已存在');
    if(password.length<4) return failure('INVALID_PASSWORD','密码至少 4 个字符');
    const salt=api.makeSalt();
    const source=clone(next[sourceUsername]);
    next[username]=api.normalizeUser(username,{
      ...source,
      username,
      salt,
      hash:api.passwordHash(username,password,salt),
      displayName:source.displayName?source.displayName+' 副本':username,
      createdAt:Date.now(),
      updatedAt:Date.now(),
      lastLoginAt:0,
      lastActiveAt:0,
      archivedAt:0,
      status:'active',
      source:'duplicated'
    });
    return success(next,{username,user:next[username],sourceUsername});
  }
  function deleteUsers(users, usernames){
    const api=requireCore();
    if(!api) return failure('AUTH_CORE_UNAVAILABLE','认证核心未加载');
    const next=normalizeUsers(users);
    const deleted=[];
    Array.from(new Set(Array.isArray(usernames)?usernames:[usernames])).forEach(value=>{
      const username=api.cleanUsername(value);
      if(username && next[username]){
        delete next[username];
        deleted.push(username);
      }
    });
    if(!deleted.length) return failure('USER_NOT_FOUND','没有可删除的用户');
    return success(next,{deleted});
  }
  function batchUpdate(users, usernames, patch={}){
    const api=requireCore();
    if(!api) return failure('AUTH_CORE_UNAVAILABLE','认证核心未加载');
    const next=normalizeUsers(users);
    const names=Array.from(new Set(Array.isArray(usernames)?usernames:[])).map(api.cleanUsername).filter(Boolean);
    const updated=[];
    names.forEach(username=>{
      if(!next[username]) return;
      const current=next[username];
      const merged={...current,username,updatedAt:Date.now()};
      if(patch.role && patch.role!=='KEEP') merged.role=patch.role;
      if(patch.subject && patch.subject!=='KEEP') merged.subject=patch.subject;
      if(patch.status && patch.status!=='KEEP'){
        merged.status=patch.status;
        merged.archivedAt=patch.status==='archived'?(current.archivedAt||Date.now()):0;
      }
      next[username]=api.normalizeUser(username,merged);
      updated.push(username);
    });
    if(!updated.length) return failure('USER_NOT_FOUND','没有可更新的用户');
    return success(next,{updated});
  }
  function pickUsers(users, usernames){
    const api=requireCore();
    if(!api) return {};
    const source=normalizeUsers(users);
    const out={};
    Array.from(new Set(Array.isArray(usernames)?usernames:[])).forEach(value=>{
      const username=api.cleanUsername(value);
      if(username && source[username]) out[username]=clone(source[username]);
    });
    return out;
  }
  function buildExportPayload(users){
    return {type:'kg-users-export',version:'1.0',exportedAt:Date.now(),users:normalizeUsers(users)};
  }
  function importUsers(users, payload, options={}){
    const api=requireCore();
    if(!api) return failure('AUTH_CORE_UNAVAILABLE','认证核心未加载');
    const next=normalizeUsers(users);
    const incoming=payload&&payload.users&&typeof payload.users==='object'?payload.users:payload;
    if(!incoming || typeof incoming!=='object' || Array.isArray(incoming)) return failure('INVALID_IMPORT','导入内容不是有效的用户数据');
    let count=0;
    let skipped=0;
    Object.entries(incoming).forEach(([rawUsername,user])=>{
      const username=api.cleanUsername(rawUsername || (user&&user.username));
      if(!username || !user || typeof user!=='object'){skipped++;return}
      if(options.overwrite===false && next[username]){skipped++;return}
      // 合并而非盲目覆盖，避免旧导入文件清掉未来新增的订阅等字段。
      next[username]=api.normalizeUser(username,{...(next[username]||{}),...clone(user),username,updatedAt:Number(user.updatedAt||Date.now())});
      count++;
    });
    if(!count) return failure('NO_USERS_IMPORTED','没有可导入的用户',{skipped});
    return success(next,{count,skipped});
  }

  window.KGUserAdminService={
    normalizeUsers,
    loadUsers,
    persist,
    createUser,
    updateUser,
    resetPassword,
    setStatus,
    duplicateUser,
    deleteUsers,
    batchUpdate,
    pickUsers,
    buildExportPayload,
    importUsers
  };
})();
