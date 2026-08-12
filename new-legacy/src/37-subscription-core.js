"use strict";

/*
 * 学员订阅权益核心模块。
 *
 * 设计边界：
 * - admin 管理员：系统管理角色，自动绕过订阅限制。
 * - teacher 教师/教研：教学维护角色，自动绕过订阅限制。
 * - student 学员：唯一需要订阅权益判断的角色。
 * - viewer 游客：体验/只读角色，不进入订阅体系，只能使用公开示例能力。
 * - guest 未登录访客：不进入订阅体系。
 *
 * 当前版本仍基于 localStorage，正式商业化时应改为后端校验。
 *
 * 基线重构 A：套餐、订单、卡密已拆到独立模块；本文件保留统一入口、
 * 订阅状态、权益校验、页面装饰和 window.KGSubscription 对外 API。
 */
(function(){
  const Auth = window.KGAuthCore || {};
  const Store = window.KGAppStorage || Auth.storage || {};
  const STORAGE_KEY = "kg_student_subscriptions_v1";
  const MIGRATION_KEY = "kg_subscription_plan_model_v2_migrated";
  const ACTIVE_STATUSES = new Set(["active","trial","manual"]);

  const STATUS_LABELS = {
    active:"有效",
    expired:"已过期",
    paused:"已停用",
    cancelled:"已取消",
    trial:"试用中",
    manual:"手动开通"
  };

  function readJSON(key,fallback){
    if(Auth.readJSON) return Auth.readJSON(key,fallback);
    if(Store.readJSON) return Store.readJSON(key,fallback);
    return (()=>{try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback}catch(e){return fallback}})();
  }
  function writeJSON(key,value){
    if(Auth.writeJSON) return Auth.writeJSON(key,value);
    if(Store.writeJSON) return Store.writeJSON(key,value);
    return (()=>{try{localStorage.setItem(key,JSON.stringify(value));return true}catch(e){return false}})();
  }
  function roleApi(){
    return window.KGRolePermissions || null;
  }
  function currentUser(){
    if(Auth.currentUser) return Auth.currentUser();
    const api=roleApi();
    return api && typeof api.currentUser==="function" ? api.currentUser() : null;
  }
  function currentRole(){
    const api=roleApi();
    return api && typeof api.currentRole==="function" ? api.currentRole() : "guest";
  }
  function currentUsername(){
    if(Auth.currentUsername) return Auth.currentUsername();
    const user=currentUser();
    return user && user.username || "";
  }
  function currentActor(){
    return Auth.currentActor ? Auth.currentActor() : currentUsername();
  }
  function uid(prefix="sub_order"){
    if(Auth.uid) return Auth.uid(prefix);
    const c=globalThis.crypto;
    return prefix + "-" + (c && c.randomUUID ? c.randomUUID() : Math.random().toString(36).slice(2)+Date.now().toString(36));
  }
  function logAction(action, username, detail){
    if(Auth.logAction) Auth.logAction(action, username, detail);
  }

  const PlansFactory = window.KGSubscriptionPlansModule;
  const OrdersFactory = window.KGSubscriptionOrdersModule;
  const RedeemCodesFactory = window.KGSubscriptionRedeemCodesModule;
  if(typeof PlansFactory !== "function" || typeof OrdersFactory !== "function" || typeof RedeemCodesFactory !== "function"){
    console.error("订阅模块加载顺序异常：请先加载 plans / orders / redeem-codes，再加载 37-subscription-core.js");
    return;
  }

  const Plans = PlansFactory({readJSON,writeJSON,decorateSubscriptionElements});

  function normalizePlanId(planId){ return Plans.normalizePlanId(planId); }
  function basePlanById(planId){ return Plans.basePlanById(planId); }
  function planById(planId){ return Plans.planById(planId); }
  function planList(options={}){ return Plans.planList(options); }
  function enabledPlanList(){ return Plans.enabledPlanList(); }
  function expiresAtForPlan(planId,startedAt=Date.now()){ return Plans.expiresAtForPlan(planId,startedAt); }
  function readPlanSettings(){ return Plans.readPlanSettings(); }
  function savePlanSettings(settings){ return Plans.savePlanSettings(settings); }
  function setPlanSettings(planId,patch={}){ return Plans.setPlanSettings(planId,patch); }
  function resetPlanSettings(planId){ return Plans.resetPlanSettings(planId); }
  function deriveDiscountPrice(originalText,discountPercent){ return Plans.deriveDiscountPrice(originalText,discountPercent); }
  function deriveDiscountLabel(discountPercent){ return Plans.deriveDiscountLabel(discountPercent); }
  function featureLabel(feature){ return Plans.featureLabel(feature); }
  function planBenefitItems(plan){ return Plans.planBenefitItems(plan); }
  function planUsageText(plan){ return Plans.planUsageText(plan); }
  function defaultPlanBenefitItems(plan){ return Plans.defaultPlanBenefitItems(plan); }
  function defaultPlanUsageText(plan){ return Plans.defaultPlanUsageText(plan); }

  function isStudentRole(role=currentRole()){
    return role === "student";
  }
  function isBypassRole(role=currentRole()){
    return role === "admin" || role === "teacher";
  }
  function isVisitorRole(role=currentRole()){
    return role === "viewer" || role === "guest";
  }
  function normalizeStatus(status){
    const next=String(status || "active").trim();
    return STATUS_LABELS[next] ? next : "active";
  }
  function readSubscriptions(){
    const map=readJSON(STORAGE_KEY,{});
    return map && typeof map === "object" ? map : {};
  }
  function saveSubscriptions(map){
    writeJSON(STORAGE_KEY,map && typeof map === "object" ? map : {});
  }
  function defaultSubscription(username=currentUsername()){
    const now=Date.now();
    return {
      username,
      planId:"free",
      status:"active",
      startedAt:now,
      expiresAt:0,
      updatedAt:now,
      source:"default",
      orderId:"",
      note:""
    };
  }
  function normalizeSubscription(sub,username=currentUsername()){
    sub=sub && typeof sub === "object" ? sub : {};
    const planId=normalizePlanId(sub.planId);
    const startedAt=Number(sub.startedAt)||Date.now();
    let expiresAt=Number(sub.expiresAt)||0;
    const plan=planById(planId);
    if(plan.durationDays === -1) expiresAt=0;
    return {
      ...defaultSubscription(username),
      ...sub,
      username:sub.username || username,
      planId,
      status:normalizeStatus(sub.status),
      startedAt,
      expiresAt,
      updatedAt:Number(sub.updatedAt)||0,
      source:sub.source || "manual",
      orderId:sub.orderId || "",
      note:sub.note || ""
    };
  }
  function isExpired(sub){
    const plan=planById(sub && sub.planId);
    if(plan.durationDays === -1) return false;
    return !!(sub && Number(sub.expiresAt) && Date.now() > Number(sub.expiresAt));
  }
  function effectiveSubscription(sub,username=currentUsername()){
    const next=normalizeSubscription(sub,username);
    if(isExpired(next)) return {...next,status:"expired"};
    return next;
  }
  function subscriptionFor(username){
    username=String(username||"").trim();
    if(!username) return null;
    const map=readSubscriptions();
    return effectiveSubscription(map[username],username);
  }
  function currentSubscription(){
    const role=currentRole();
    const user=currentUser();
    if(!user || !isStudentRole(role)) return null;
    return subscriptionFor(user.username);
  }
  function currentPlan(){
    const role=currentRole();
    if(isBypassRole(role)){
      return {id:"role_bypass",name:"管理/教学免订阅",shortName:"免订阅",level:99,features:{},limits:{},durationText:"不需要订阅"};
    }
    if(isVisitorRole(role)){
      return {id:"visitor",name:"游客体验",shortName:"游客",level:-1,features:{demoOnly:true},limits:{},durationText:"体验"};
    }
    const sub=currentSubscription();
    return planById(sub && sub.planId);
  }
  function statusLabel(status){
    return STATUS_LABELS[status] || status || "未知";
  }
  function canUse(feature, options={}){
    const role=currentRole();
    if(isBypassRole(role)) return true;
    if(isVisitorRole(role)) return !!options.allowVisitorDemo;
    if(!isStudentRole(role)) return false;
    const sub=currentSubscription();
    if(!sub || !ACTIVE_STATUSES.has(sub.status)) return false;
    const plan=planById(sub.planId);
    if(!feature) return true;
    return !!(plan && plan.features && plan.features[feature]);
  }
  function requireFeature(feature, options={}){
    const allowed=canUse(feature, options);
    if(allowed) return true;
    const role=currentRole();
    let message="";
    if(isVisitorRole(role)) message="游客不参与订阅，请登录学员账号后使用“"+featureLabel(feature)+"”。";
    else if(isStudentRole(role)) message="当前学员订阅暂未包含“"+featureLabel(feature)+"”。";
    else message="当前角色不可使用“"+featureLabel(feature)+"”。";
    const status=document.getElementById("status");
    if(status && typeof window.showStatus==="function") window.showStatus(message);
    else if(status){
      status.textContent=message;
      status.classList.add("show");
      clearTimeout(requireFeature.timer);
      requireFeature.timer=setTimeout(()=>status.classList.remove("show"),2200);
    }
    return false;
  }
  function usageLimit(key){
    const role=currentRole();
    if(isBypassRole(role)) return -1;
    if(isVisitorRole(role)) return 0;
    const plan=currentPlan();
    return plan && plan.limits && Number.isFinite(Number(plan.limits[key])) ? Number(plan.limits[key]) : 0;
  }
  function limitLabel(key){
    return Plans.LIMIT_LABELS[key] || key;
  }
  function remainingUsage(key,currentCount=0){
    const limit=usageLimit(key);
    if(limit < 0) return -1;
    return Math.max(0,limit-(Number(currentCount)||0));
  }
  function showSubscriptionMessage(message){
    const text=String(message||"").trim();
    if(!text) return;
    if(typeof window.showStatus==="function"){
      window.showStatus(text);
      return;
    }
    const status=document.getElementById("status");
    if(status){
      status.textContent=text;
      status.classList.add("show");
      clearTimeout(showSubscriptionMessage.timer);
      showSubscriptionMessage.timer=setTimeout(()=>status.classList.remove("show"),2800);
      return;
    }
    let toast=document.getElementById("subscriptionLimitToast");
    if(!toast){
      toast=document.createElement("div");
      toast.id="subscriptionLimitToast";
      toast.className="subscription-limit-toast";
      document.body.appendChild(toast);
    }
    toast.textContent=text;
    toast.classList.add("show");
    clearTimeout(showSubscriptionMessage.toastTimer);
    showSubscriptionMessage.toastTimer=setTimeout(()=>toast.classList.remove("show"),3000);
  }
  function usageLimitMessage(key,currentCount=0,addCount=1,options={}){
    const role=currentRole();
    const label=options.label || limitLabel(key);
    if(isVisitorRole(role)) return `游客账号不能新增${label}，请登录学员账号后使用。`;
    const limit=usageLimit(key);
    if(limit < 0) return "";
    const current=Math.max(0,Number(currentCount)||0);
    const add=Math.max(1,Number(addCount)||1);
    const plan=currentPlan();
    const planName=plan && (plan.name||plan.shortName) || "当前套餐";
    return `${planName}的${label}上限为 ${limit} 个，当前已有 ${current} 个，本次还需新增 ${add} 个。升级会员后可解除此限制。`;
  }
  function canAddUsage(key,currentCount=0,addCount=1){
    const limit=usageLimit(key);
    if(limit < 0) return true;
    const current=Math.max(0,Number(currentCount)||0);
    const add=Math.max(1,Number(addCount)||1);
    return current + add <= limit;
  }
  function requireUsageLimit(key,currentCount=0,addCount=1,options={}){
    if(canAddUsage(key,currentCount,addCount)) return true;
    showSubscriptionMessage(options.message || usageLimitMessage(key,currentCount,addCount,options));
    return false;
  }
  function setStudentSubscription(username, patch={}){
    username=String(username||"").trim();
    if(!username) return null;
    const map=readSubscriptions();
    const previous=normalizeSubscription(map[username],username);
    const planId=patch.planId != null ? normalizePlanId(patch.planId) : previous.planId;
    const startedAt=patch.startedAt != null ? Number(patch.startedAt)||Date.now() : (previous.startedAt || Date.now());
    let expiresAt=patch.expiresAt != null ? Number(patch.expiresAt)||0 : previous.expiresAt;
    if(patch.planId != null && patch.expiresAt == null) expiresAt=expiresAtForPlan(planId,startedAt);
    const next=normalizeSubscription({
      ...previous,
      ...patch,
      username,
      planId,
      startedAt,
      expiresAt,
      updatedAt:Date.now()
    },username);
    map[username]=next;
    saveSubscriptions(map);
    window.dispatchEvent(new CustomEvent("kg-subscription-change",{detail:{username,subscription:next}}));
    decorateSubscriptionElements();
    return next;
  }
  function subscriptionText(){
    const role=currentRole();
    if(isBypassRole(role)) return "免订阅";
    if(role==="viewer") return "游客体验";
    if(role==="guest") return "未登录游客";
    const sub=currentSubscription();
    if(!sub) return "无订阅";
    const plan=planById(sub.planId);
    if(ACTIVE_STATUSES.has(sub.status)) return plan.shortName || plan.name || "免费";
    return (plan.shortName || plan.name || "订阅") + " · " + statusLabel(sub.status);
  }
  function formatDate(ts){
    const n=Number(ts)||0;
    if(!n) return "永久有效";
    try{return new Date(n).toLocaleDateString("zh-CN")}catch(e){return "—"}
  }
  function formatDateTime(ts){
    const n=Number(ts)||0;
    if(!n) return "永久有效";
    try{return new Date(n).toLocaleString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false})}catch(e){return "—"}
  }
  function countdownDaysText(ts){
    const n=Number(ts)||0;
    if(!n) return "长期有效";
    const diff=n-Date.now();
    if(diff <= 0) return "已到期";
    return `剩余 ${Math.ceil(diff/(24*60*60*1000))} 天`;
  }
  function dateInputValue(ts){
    const n=Number(ts)||0;
    if(!n) return "";
    const d=new Date(n - new Date(n).getTimezoneOffset()*60000);
    return d.toISOString().slice(0,10);
  }
  function dateInputToTime(value,endOfDay=false){
    if(!value) return 0;
    const suffix=endOfDay ? "T23:59:59" : "T00:00:00";
    const t=new Date(String(value)+suffix).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  function renewStudentSubscription(username,planId,options={}){
    username=String(username||"").trim();
    if(!username) return null;
    const plan=planById(planId||"monthly");
    const previous=subscriptionFor(username) || defaultSubscription(username);
    const now=Date.now();
    const extend=options.extend !== false;
    const base=extend && plan.durationDays > 0 && previous.expiresAt && previous.expiresAt > now ? previous.expiresAt : now;
    const startedAt=Number(options.startedAt)||now;
    const expiresAt=plan.durationDays === -1 ? 0 : (plan.durationDays > 0 ? base + plan.durationDays*24*60*60*1000 : 0);
    return setStudentSubscription(username,{
      planId:plan.id,
      status:options.status || "active",
      startedAt,
      expiresAt,
      source:options.source || "manual",
      orderId:options.orderId || previous.orderId || "",
      note:options.note != null ? String(options.note) : previous.note || ""
    });
  }
  function pauseStudentSubscription(username,note=""){
    const previous=subscriptionFor(username) || defaultSubscription(username);
    return setStudentSubscription(username,{...previous,status:"paused",note:String(note||previous.note||""),source:previous.source||"manual"});
  }
  function activateFreeSubscription(username,note=""){
    return setStudentSubscription(username,{planId:"free",status:"active",startedAt:Date.now(),expiresAt:0,source:"manual",note:String(note||"")});
  }
  function subscriptionSummary(username=currentUsername()){
    const sub=subscriptionFor(username);
    if(!sub) return {subscription:null,plan:planById("free"),statusText:"未开通",expiresText:"—",expiresFullText:"—",countdownText:"—"};
    const plan=planById(sub.planId);
    const unlimited=plan.durationDays === -1 || !sub.expiresAt;
    return {
      subscription:sub,
      plan,
      statusText:statusLabel(sub.status),
      expiresText:unlimited ? (plan.durationDays === -1 ? "永久有效" : "长期有效") : formatDate(sub.expiresAt),
      expiresFullText:unlimited ? (plan.durationDays === -1 ? "永久有效" : "长期有效") : formatDateTime(sub.expiresAt),
      countdownText:unlimited ? (plan.durationDays === -1 ? "永久有效" : "长期有效") : countdownDaysText(sub.expiresAt)
    };
  }
  function migrateLegacySubscriptions(){
    if(readJSON(MIGRATION_KEY,false)) return false;
    const map=readSubscriptions();
    let changed=false;
    Object.keys(map).forEach(username=>{
      const before=map[username];
      if(!before || typeof before !== "object") return;
      const next=normalizeSubscription(before,username);
      if(next.planId !== before.planId || next.status !== before.status){
        map[username]=next;
        changed=true;
      }
    });
    if(changed) saveSubscriptions(map);
    writeJSON(MIGRATION_KEY,true);
    return changed;
  }
  function decorateSubscriptionElements(root=document){
    const scope=root||document;
    scope.querySelectorAll("[data-subscription-feature]").forEach(el=>{
      const feature=el.dataset.subscriptionFeature;
      const mode=el.dataset.subscriptionMode || "disable";
      const allowed=canUse(feature);
      el.classList.toggle("subscription-locked",!allowed);
      el.setAttribute("aria-disabled",String(!allowed));
      if(mode==="hide") el.hidden=!allowed;
      else if("disabled" in el) el.disabled=!allowed;
      if(!allowed && !el.dataset.subscriptionTitle){
        el.dataset.subscriptionTitle=el.title || "";
        el.title="当前学员订阅暂未包含："+featureLabel(feature);
      }else if(allowed && el.dataset.subscriptionTitle!=null){
        el.title=el.dataset.subscriptionTitle;
      }
    });
    const status=scope.querySelector("[data-subscription-status]");
    if(status) status.textContent=subscriptionText();
    const current=currentSubscription();
    const hasActivePaidMembership=!!(current
      && ACTIVE_STATUSES.has(current.status)
      && current.planId
      && current.planId!=="free");
    scope.querySelectorAll("#upgradeMemberBtn,#accountMenuUpgradeBtn,[data-subscription-upgrade-label]").forEach(btn=>{
      btn.hidden=hasActivePaidMembership;
      if(!hasActivePaidMembership) btn.textContent="升级会员";
    });
  }

  const Orders = OrdersFactory({
    readJSON,
    writeJSON,
    currentUser,
    currentRole,
    currentUsername,
    currentActor,
    uid,
    logAction,
    normalizePlanId,
    planById,
    planUsageText,
    planBenefitItems,
    subscriptionFor,
    defaultSubscription,
    renewStudentSubscription
  });

  const RedeemCodes = RedeemCodesFactory({
    readJSON,
    writeJSON,
    currentUser,
    currentRole,
    currentUsername,
    uid,
    logAction,
    normalizePlanId,
    planById,
    renewStudentSubscription
  });

  function readOrders(){ return Orders.readOrders(); }
  function saveOrders(list){ return Orders.saveOrders(list); }
  function orderList(options={}){ return Orders.orderList(options); }
  function pendingOrders(){ return Orders.pendingOrders(); }
  function currentUserOrders(){ return Orders.currentUserOrders(); }
  function hasPendingOrder(username,planId){ return Orders.hasPendingOrder(username,planId); }
  function createOrder(planId,options={}){ return Orders.createOrder(planId,options); }
  function approveOrder(orderId,options={}){ return Orders.approveOrder(orderId,options); }
  function cancelOrder(orderId,options={}){ return Orders.cancelOrder(orderId,options); }
  function removeOrder(orderId){ return Orders.removeOrder(orderId); }
  function orderStatusLabel(status){ return Orders.orderStatusLabel(status); }

  function readRedeemCodes(){ return RedeemCodes.readRedeemCodes(); }
  function saveRedeemCodes(list){ return RedeemCodes.saveRedeemCodes(list); }
  function redeemCodeList(options={}){ return RedeemCodes.redeemCodeList(options); }
  function generateRedeemCodes(options={}){ return RedeemCodes.generateRedeemCodes(options); }
  function redeemCode(input,options={}){ return RedeemCodes.redeemCode(input,options); }
  function disableRedeemCode(id){ return RedeemCodes.disableRedeemCode(id); }
  function enableRedeemCode(id){ return RedeemCodes.enableRedeemCode(id); }
  function removeRedeemCode(id){ return RedeemCodes.removeRedeemCode(id); }
  function redeemCodeStatusLabel(status){ return RedeemCodes.redeemCodeStatusLabel(status); }

  migrateLegacySubscriptions();
  document.addEventListener("DOMContentLoaded",()=>decorateSubscriptionElements());
  window.addEventListener("kg-role-theme-change",()=>setTimeout(decorateSubscriptionElements,0));
  window.addEventListener("kg-auth-session-change",()=>setTimeout(decorateSubscriptionElements,0));
  window.addEventListener("kg-auth-users-change",()=>setTimeout(decorateSubscriptionElements,0));
  window.addEventListener("kg-subscription-change",()=>setTimeout(decorateSubscriptionElements,0));
  window.addEventListener("kg-subscription-plan-change",()=>setTimeout(decorateSubscriptionElements,0));
  window.addEventListener("storage",event=>{
    if(!event.key || event.key===STORAGE_KEY || event.key===Plans.PLAN_SETTINGS_KEY || event.key===Orders.ORDER_KEY || event.key===RedeemCodes.REDEEM_CODE_KEY || event.key.indexOf("kg_local_")===0) setTimeout(decorateSubscriptionElements,0);
  });

  window.KGSubscription={
    STORAGE_KEY,
    PLAN_SETTINGS_KEY:Plans.PLAN_SETTINGS_KEY,
    ORDER_KEY:Orders.ORDER_KEY,
    REDEEM_CODE_KEY:RedeemCodes.REDEEM_CODE_KEY,
    MIGRATION_KEY,
    PLANS:Plans.PLANS,
    PLAN_ORDER:Plans.PLAN_ORDER,
    PLAN_ALIASES:Plans.PLAN_ALIASES,
    FEATURE_LABELS:Plans.FEATURE_LABELS,
    LIMIT_LABELS:Plans.LIMIT_LABELS,
    STATUS_LABELS,
    ORDER_STATUS_LABELS:Orders.ORDER_STATUS_LABELS,
    REDEEM_CODE_STATUS_LABELS:RedeemCodes.REDEEM_CODE_STATUS_LABELS,
    readSubscriptions,
    saveSubscriptions,
    readOrders,
    saveOrders,
    readRedeemCodes,
    saveRedeemCodes,
    redeemCodeList,
    generateRedeemCodes,
    redeemCode,
    disableRedeemCode,
    enableRedeemCode,
    removeRedeemCode,
    redeemCodeStatusLabel,
    orderList,
    pendingOrders,
    currentUserOrders,
    hasPendingOrder,
    createOrder,
    approveOrder,
    cancelOrder,
    removeOrder,
    orderStatusLabel,
    readPlanSettings,
    savePlanSettings,
    setPlanSettings,
    resetPlanSettings,
    normalizePlanId,
    basePlanById,
    planById,
    planList,
    enabledPlanList,
    expiresAtForPlan,
    subscriptionFor,
    currentSubscription,
    currentPlan,
    currentRole,
    isStudentRole,
    isBypassRole,
    isVisitorRole,
    canUse,
    requireFeature,
    usageLimit,
    limitLabel,
    remainingUsage,
    canAddUsage,
    requireUsageLimit,
    usageLimitMessage,
    showSubscriptionMessage,
    setStudentSubscription,
    renewStudentSubscription,
    pauseStudentSubscription,
    activateFreeSubscription,
    subscriptionSummary,
    formatDate,
    formatDateTime,
    countdownDaysText,
    deriveDiscountPrice,
    deriveDiscountLabel,
    dateInputValue,
    dateInputToTime,
    subscriptionText,
    decorateSubscriptionElements,
    featureLabel,
    planBenefitItems,
    planUsageText,
    defaultPlanBenefitItems,
    defaultPlanUsageText,
    statusLabel,
    normalizeSubscription,
    migrateLegacySubscriptions
  };
})();
