'use strict';

/* 试卷访问权益：免费试卷直接开放，VIP 试卷使用服务端权益为第一判断来源。 */
(function(global){
  const FREE='free';
  const MEMBER='member';
  function text(value){return String(value==null?'':value)}
  function normalizeAccessLevel(value){
    const raw=text(value).trim().toLowerCase();
    return ['member','vip','paid','premium'].includes(raw)?MEMBER:FREE;
  }
  function accessLevelOf(paper){
    return normalizeAccessLevel(paper?.accessPolicy?.accessLevel||paper?.accessLevel||paper?.visibilityLevel||FREE);
  }
  function currentUser(){
    try{return global.KGAuthCore?.currentUser?.()||global.KGRolePermissions?.currentUser?.()||null}catch(error){return null}
  }
  function currentRole(user=currentUser()){
    try{return text(global.KGRolePermissions?.currentRole?.()||user?.role||'guest').toLowerCase()||'guest'}catch(error){return text(user?.role||'guest').toLowerCase()||'guest'}
  }
  function hasExamEntitlement(){
    const server=global.KGServerEntitlements;
    if(server&&Object.prototype.hasOwnProperty.call(server,'allExamPapers'))return server.allExamPapers===true;
    try{return !!global.KGSubscription?.canUse?.('allExamPapers')}catch(error){return false}
  }
  function inspect(paper){
    const accessLevel=accessLevelOf(paper),user=currentUser(),role=currentRole(user);
    if(accessLevel===FREE)return {allowed:true,accessLevel,state:'free',code:'FREE_PAPER',message:'免费试卷'};
    if(role==='admin'||role==='teacher')return {allowed:true,accessLevel,state:'role_bypass',code:'ROLE_BYPASS',message:'教学角色可预览 VIP 试卷'};
    if(!user||role==='guest'||role==='viewer')return {allowed:false,accessLevel,state:'login_required',code:'LOGIN_REQUIRED',message:'登录学员账号并开通会员后即可练习。'};
    if(hasExamEntitlement())return {allowed:true,accessLevel,state:'member',code:'MEMBER_ACCESS',message:'VIP 会员可使用'};
    return {allowed:false,accessLevel,state:'membership_required',code:'MEMBERSHIP_REQUIRED',message:'此试卷为 VIP 会员专属，开通会员即可解锁全部试卷。'};
  }
  function canUse(paper){return inspect(paper).allowed}
  const api=Object.freeze({FREE,MEMBER,normalizeAccessLevel,accessLevelOf,inspect,canUse});
  global.KGPaperAccessService=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
