"use strict";

/*
 * 用户中心：当前登录用户自助维护个人资料。
 * 说明：仍然基于 localStorage；正式网络版接入后端后，应改为服务端接口保存。
 */
(function(){
  const AUTH_USERS_KEY="kg_local_users_v1";
  const AUTH_SESSION_KEY="kg_local_current_user_v1";
  const USER_LOG_KEY="kg_user_admin_logs_v1";
  const Store=window.KGAppStorage||{};

  const $=id=>document.getElementById(id);
  function escapeHTML(value){
    return String(value == null ? "" : value).replace(/[&<>\'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\'":"&#39;",'"':"&quot;"}[c]));
  }
  const authCore=()=>window.KGAuthCore||null;
  function readJSON(key,fallback){
    const core=authCore();
    if(core&&typeof core.readJSON==="function")return core.readJSON(key,fallback);
    if(Store.readJSON)return Store.readJSON(key,fallback);
    try{
      const raw=localStorage.getItem(key);
      if(!raw)return fallback;
      const parsed=JSON.parse(raw);
      return parsed==null?fallback:parsed;
    }catch(e){return fallback}
  }
  function writeJSON(key,value){
    const core=authCore();
    if(core&&typeof core.writeJSON==="function")return core.writeJSON(key,value);
    if(Store.writeJSON)return Store.writeJSON(key,value);
    localStorage.setItem(key,JSON.stringify(value));
    return true;
  }
  function makeSalt(){
    const core=authCore();
    return core&&typeof core.makeSalt==="function"?core.makeSalt():Math.random().toString(36).slice(2)+Date.now().toString(36);
  }
  function passwordHash(username,password,salt){
    const core=authCore();
    if(core&&typeof core.passwordHash==="function")return core.passwordHash(username,password,salt);
    let h=2166136261;
    const str=String(salt)+"|"+String(username).toLowerCase()+"|"+String(password);
    for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h+=(h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)}
    return (h>>>0).toString(36);
  }
  function verifyPassword(username,password,user){
    const core=authCore();
    if(core&&typeof core.verifyPassword==="function")return core.verifyPassword(username,password,user);
    return passwordHash(username,password,user&&user.salt||"")===(user&&user.hash);
  }
  function cleanUsername(value){
    const core=authCore();
    if(core&&typeof core.cleanUsername==="function")return core.cleanUsername(value);
    return String(value||"").trim();
  }
  function cleanText(value,max=200){
    return String(value||"").trim().slice(0,max);
  }
  function cleanSubject(value){
    return cleanText(value,80)||"PMP";
  }
  function cleanTags(value){
    return String(value||"")
      .split(/[,，、;；|]/)
      .map(s=>s.trim())
      .filter(Boolean)
      .slice(0,12);
  }
  function roleLabel(role){
    const api=window.KGRolePermissions;
    return api&&typeof api.roleLabel==="function"?api.roleLabel(role):({admin:"管理员",teacher:"教师/教研",student:"学员",viewer:"游客"}[role]||role||"学员");
  }
  function statusLabel(status){
    return ({active:"正常",paused:"暂停",archived:"已归档"}[status]||status||"正常");
  }
  function subscriptionApi(){
    return window.KGSubscription || null;
  }
  function renderSubscriptionBox(user){
    const panel=$("ucSubscriptionBox");
    if(!panel)return;
    const sub=subscriptionApi();
    if(!sub){
      panel.innerHTML='<div class="kg-user-subscription-empty">订阅模块未加载。</div>';
      return;
    }
    const role=user&&user.role||"student";
    if(role==="admin"||role==="teacher"){
      panel.innerHTML=`<div class="kg-user-subscription-main"><strong>当前身份免订阅</strong><span>管理员和教师/教研用于系统管理或教学维护，不受学员订阅限制。</span></div>`;
      return;
    }
    if(role==="viewer"){
      panel.innerHTML=`<div class="kg-user-subscription-main"><strong>游客体验</strong><span>游客不进入订阅体系。请登录或切换为学员账号后开通订阅。</span></div>`;
      return;
    }
    const summary=typeof sub.subscriptionSummary==="function"?sub.subscriptionSummary(user.username):null;
    const plan=summary&&summary.plan || (sub.planById?sub.planById("free"):{name:"免费学员"});
    const record=summary&&summary.subscription || null;
    const statusText=summary&&summary.statusText || "有效";
    const expiresText=summary&&summary.expiresFullText || summary&&summary.expiresText || "长期有效";
    const countdownText=summary&&summary.countdownText || "长期有效";
    const actionText=plan&&plan.id&&plan.id!=="free"?"续费":"续费 / 升级";
    panel.innerHTML=`<div class="kg-user-subscription-main">
      <div>
        <strong>${escapeHTML(plan.name||"免费学员")}</strong>
        <span>${escapeHTML(plan.description||"当前学员订阅状态。")}</span>
      </div>
      <button type="button" class="kg-user-subscription-renew" id="ucSubscriptionRenewBtn">${escapeHTML(actionText)}</button>
    </div>
    <div class="kg-user-subscription-meta">
      <span>状态：${escapeHTML(statusText)}</span>
      <span>有效期：${escapeHTML(expiresText)}</span>
      <span>倒计时：${escapeHTML(countdownText)}</span>
      <span>来源：${escapeHTML(record&&record.source||"default")}</span>
    </div>
    <p class="kg-user-subscription-note">此处只展示当前订阅状态。点击续费可查看会员权益详情并进入购买/开通流程。</p>`;
    const btn=$("ucSubscriptionRenewBtn");
    if(btn)btn.addEventListener("click",openSubscriptionDetailModal);
  }
  function planFeatureList(plan){
    const sub=subscriptionApi();
    if(sub&&typeof sub.planBenefitItems==="function")return sub.planBenefitItems(plan);
    const labels=sub&&sub.FEATURE_LABELS||{};
    return Object.entries(plan&&plan.features||{}).filter(([,on])=>!!on).map(([key])=>labels[key]||key);
  }
  function planLimitText(plan){
    const sub=subscriptionApi();
    if(sub&&typeof sub.planUsageText==="function")return sub.planUsageText(plan);
    const labels={dailyTraining:"每日训练",recallMaps:"回忆图谱",importPackages:"学习包导入",exportPackages:"学习包导出"};
    return Object.entries(plan&&plan.limits||{}).map(([key,value])=>`${labels[key]||key}：${Number(value)===-1?"不限":String(value)}`).join(" · ");
  }
  function ensureSubscriptionDetailModal(){
    let modal=$("userSubscriptionDetailModal");
    if(modal)return modal;
    const wrap=document.createElement("div");
    wrap.className="modal-backdrop user-subscription-detail-backdrop";
    wrap.id="userSubscriptionDetailModal";
    wrap.innerHTML=`
      <div aria-labelledby="userSubscriptionDetailTitle" aria-modal="true" class="modal kg-subscription-detail-modal" role="dialog">
        <div class="kg-user-center-head">
          <div class="kg-user-center-title">
            <div class="kg-user-avatar">会</div>
            <div>
              <h2 id="userSubscriptionDetailTitle">会员权益</h2>
              <p>查看各会员方案权益。当前纯前端版本暂未接入支付，购买按钮用于后续支付入口预留。</p>
            </div>
          </div>
          <button class="kg-user-center-close" id="userSubscriptionDetailCloseBtn" type="button" aria-label="关闭">×</button>
        </div>
        <div class="kg-subscription-detail-body" id="userSubscriptionDetailBody"></div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click",event=>{if(event.target===wrap)closeSubscriptionDetailModal()});
    $("userSubscriptionDetailCloseBtn").addEventListener("click",closeSubscriptionDetailModal);
    return wrap;
  }
  function renderSubscriptionDetailPlans(){
    const body=$("userSubscriptionDetailBody");
    const sub=subscriptionApi();
    const rec=currentRecord();
    if(!body||!sub){return}
    const summary=rec&&typeof sub.subscriptionSummary==="function"?sub.subscriptionSummary(rec.username):null;
    const currentPlanId=summary&&summary.plan&&summary.plan.id || "";
    const plans=typeof sub.enabledPlanList==="function"?sub.enabledPlanList():[];
    body.innerHTML=`<div class="kg-subscription-detail-grid">
      ${plans.map(plan=>{
        const current=!!currentPlanId && plan.id===currentPlanId;
        const features=planFeatureList(plan);
        const limitText=planLimitText(plan);
        return `<article class="subscription-plan-card kg-subscription-purchase-card${plan.recommended?' recommended':''}${current?' current':''}" data-buy-plan="${escapeHTML(plan.id)}" data-plan-id="${escapeHTML(plan.id)}" role="button" tabindex="0" aria-label="${escapeHTML((current?'续费':'选择')+' '+(plan.name||'套餐'))}">
          <div class="subscription-plan-head">
            <h3>${escapeHTML(plan.name||'套餐')}</h3>
            <span>${escapeHTML(current?'当前方案':(plan.badgeText||plan.shortName||'套餐'))}</span>
          </div>
          <div class="kg-subscription-purchase-price">
            <strong>${escapeHTML(plan.priceText||'待配置')}</strong>
            ${plan.originalPriceText?`<del>${escapeHTML(plan.originalPriceText)}</del>`:''}
            ${plan.discountText?`<span class="subscription-discount-badge">${escapeHTML(plan.discountText)}</span>`:''}
          </div>
          <p class="kg-subscription-plan-desc">${escapeHTML(plan.description||'')}</p>
          <ul class="kg-subscription-benefit-list">${features.map(item=>`<li>${escapeHTML(item)}</li>`).join('')}</ul>
          ${limitText?`<div class="subscription-limit-note kg-subscription-usage-text">${escapeHTML(limitText)}</div>`:''}
          <div class="kg-subscription-card-cta">${current?'点击续费当前方案':'点击选择该方案'}</div>
        </article>`;
      }).join('')}
    </div>
    <div class="kg-subscription-redeem-panel">
      <div class="kg-subscription-redeem-title">
        <strong>卡密使用</strong>
      </div>
      <div class="kg-subscription-redeem-form">
        <input id="subscriptionRedeemCodeInput" placeholder="请输入会员卡密，例如 VIP-XXXX-XXXX-XXXX" autocomplete="off" />
        <button type="button" class="primary" id="subscriptionRedeemCodeBtn">兑换卡密</button>
      </div>
      <div class="kg-subscription-redeem-msg" id="subscriptionRedeemCodeMsg"></div>
    </div>`;
    function renderPlanConfirm(plan){
      if(!body||!plan)return;
      const features=planFeatureList(plan).slice(0,8);
      const limitText=planLimitText(plan);
      const latest=currentRecord();
      const username=latest&&latest.username||"";
      body.innerHTML=`<div class="kg-subscription-order-confirm">
        <button type="button" class="kg-subscription-back-btn" id="subscriptionBackToPlansBtn">← 返回会员方案</button>
        <div class="kg-subscription-order-card">
          <div class="kg-subscription-order-head">
            <div>
              <p>确认订阅申请</p>
              <h3>${escapeHTML(plan.name||'会员方案')}</h3>
            </div>
            <span>${escapeHTML(plan.badgeText||plan.shortName||'会员')}</span>
          </div>
          <div class="kg-subscription-order-price">
            <strong>${escapeHTML(plan.priceText||'待配置')}</strong>
            ${plan.originalPriceText?`<del>${escapeHTML(plan.originalPriceText)}</del>`:''}
            ${plan.discountText?`<em>${escapeHTML(plan.discountText)}</em>`:''}
          </div>
          <p class="kg-subscription-order-desc">当前纯前端版本暂不接真实支付。确认后会生成一条“待确认”的订阅申请，由管理员在系统设置中确认开通。</p>
          <div class="kg-subscription-order-meta">
            <span>申请账号：${escapeHTML(username||'未登录')}</span>
            <span>开通方式：管理员确认</span>
            <span>订单状态：待确认</span>
          </div>
          <ul class="kg-subscription-order-benefits">${features.map(item=>`<li>${escapeHTML(item)}</li>`).join('')}</ul>
          ${limitText?`<div class="subscription-limit-note">${escapeHTML(limitText)}</div>`:''}
          <div class="kg-subscription-order-actions">
            <button type="button" id="subscriptionCancelOrderBtn">取消</button>
            <button type="button" class="primary" id="subscriptionSubmitOrderBtn">确认提交申请</button>
          </div>
        </div>
      </div>`;
      const back=$("subscriptionBackToPlansBtn");
      const cancel=$("subscriptionCancelOrderBtn");
      const submit=$("subscriptionSubmitOrderBtn");
      if(back)back.addEventListener("click",renderSubscriptionDetailPlans);
      if(cancel)cancel.addEventListener("click",renderSubscriptionDetailPlans);
      if(submit)submit.addEventListener("click",()=>{
        if(!sub||typeof sub.createOrder!=="function"){
          showStatus("订阅订单模块未加载，请刷新页面后重试。");
          return;
        }
        const result=sub.createOrder(plan.id);
        if(!result||!result.ok){
          showStatus(result&&result.message||"订阅申请提交失败。");
          return;
        }
        renderOrderSubmitted(plan,result);
        showStatus(result.message||"订阅申请已提交。");
      });
    }
    function renderOrderSubmitted(plan,result){
      const order=result&&result.order||{};
      body.innerHTML=`<div class="kg-subscription-order-confirm">
        <div class="kg-subscription-order-card success">
          <div class="kg-subscription-order-done">✓</div>
          <h3>${escapeHTML(result&&result.duplicate?'已有待确认申请':'订阅申请已提交')}</h3>
          <p>${escapeHTML(result&&result.message||'管理员确认后，会员权益会自动生效。')}</p>
          <div class="kg-subscription-order-meta">
            <span>申请方案：${escapeHTML(plan&&plan.name||order.planName||'会员')}</span>
            <span>订单编号：${escapeHTML(order.id||'—')}</span>
            <span>状态：${escapeHTML(sub.orderStatusLabel?sub.orderStatusLabel(order.status):'待确认')}</span>
          </div>
          <div class="kg-subscription-order-actions">
            <button type="button" id="subscriptionBackAfterSubmitBtn">继续查看会员</button>
            <button type="button" class="primary" id="subscriptionCloseAfterSubmitBtn">知道了</button>
          </div>
        </div>
      </div>`;
      const back=$("subscriptionBackAfterSubmitBtn");
      const close=$("subscriptionCloseAfterSubmitBtn");
      if(back)back.addEventListener("click",renderSubscriptionDetailPlans);
      if(close)close.addEventListener("click",closeSubscriptionDetailModal);
    }
    function handlePlanPick(card){
      const planId=card&&card.dataset.buyPlan;
      if(!planId)return;
      const plan=sub.planById?sub.planById(planId):null;
      const latest=currentRecord();
      const role=latest&&latest.user&&latest.user.role || "guest";
      if(!latest){
        showStatus("请先登录学员账号后再购买或开通会员。");
        const login=$("authLoginBtn");
        if(login)login.click();
        return;
      }
      if(role==="admin"||role==="teacher"){
        showStatus("当前身份不需要订阅，可直接使用管理或教学能力。");
        return;
      }
      if(role==="viewer"){
        showStatus("游客不进入订阅体系，请切换为学员账号后购买会员。 ");
        return;
      }
      if(plan&&plan.id==="free"){
        showStatus("免费学员无需购买，可直接使用免费权益。");
        return;
      }
      renderPlanConfirm(plan);
    }
    body.querySelectorAll('[data-buy-plan]').forEach(card=>{
      card.addEventListener('click',()=>handlePlanPick(card));
      card.addEventListener('keydown',event=>{
        if(event.key==='Enter'||event.key===' '){
          event.preventDefault();
          handlePlanPick(card);
        }
      });
    });
    const redeemBtn=$("subscriptionRedeemCodeBtn");
    const redeemInput=$("subscriptionRedeemCodeInput");
    const redeemMsg=$("subscriptionRedeemCodeMsg");
    function setRedeemMsg(text,ok){
      if(!redeemMsg)return;
      redeemMsg.textContent=text||"";
      redeemMsg.classList.toggle("ok",!!ok);
    }
    if(redeemBtn&&redeemInput){
      const submitRedeem=()=>{
        const api=subscriptionApi();
        if(!api||typeof api.redeemCode!=="function"){setRedeemMsg("卡密模块未加载，请刷新页面后重试。",false);return}
        const result=api.redeemCode(redeemInput.value);
        setRedeemMsg(result&&result.message||"卡密兑换失败。",!!(result&&result.ok));
        showStatus(result&&result.message||"卡密兑换失败。");
        if(result&&result.ok){
          redeemInput.value="";
          refreshAuthUI();
          setTimeout(renderSubscriptionDetailPlans,600);
        }
      };
      redeemBtn.addEventListener("click",submitRedeem);
      redeemInput.addEventListener("keydown",event=>{
        if(event.key==="Enter"){event.preventDefault();submitRedeem()}
      });
    }
  }
  function openSubscriptionDetailModal(){
    const userCenter=$("userCenterModal");
    if(userCenter&&userCenter.classList.contains("show"))userCenter.classList.remove("show");
    const modal=ensureSubscriptionDetailModal();
    renderSubscriptionDetailPlans();
    modal.classList.add("show");
  }
  function closeSubscriptionDetailModal(){
    const modal=$("userSubscriptionDetailModal");
    if(modal)modal.classList.remove("show");
  }

  function currentUsername(){
    const core=authCore();
    if(core&&typeof core.currentUsername==="function")return core.currentUsername();
    try{return cleanUsername(Store.readString?Store.readString(AUTH_SESSION_KEY,""):localStorage.getItem(AUTH_SESSION_KEY)||"")}catch(e){return ""}
  }
  function users(){
    const core=authCore();
    if(core&&typeof core.users==="function")return core.users();
    return readJSON(AUTH_USERS_KEY,{}) || {};
  }
  function saveUser(username,patch){
    const core=authCore();
    if(core&&typeof core.upsertUser==="function")return core.upsertUser(username,patch);
    const map=users();
    map[username]={...(map[username]||{}),...patch,username,updatedAt:Date.now()};
    writeJSON(AUTH_USERS_KEY,map);
    window.dispatchEvent(new CustomEvent("kg-auth-users-change",{detail:{username,user:map[username]}}));
    return map[username];
  }
  function currentRecord(){
    const username=currentUsername();
    if(!username)return null;
    const core=authCore();
    const coreUser=core&&typeof core.currentUser==="function"?core.currentUser({includeInactive:true}):null;
    if(coreUser)return {username,user:{...coreUser}};
    const map=users();
    const user=map[username];
    if(!user||typeof user!=="object")return null;
    return {username,user:{...user}};
  }
  function logAction(action,username,detail=""){
    const core=authCore();
    if(core&&typeof core.logAction==="function")return core.logAction(action,username,detail);
    try{
      const logs=readJSON(USER_LOG_KEY,[]);
      logs.unshift({id:Math.random().toString(36).slice(2),action,username,detail:String(detail||""),actor:username||"self",at:Date.now()});
      writeJSON(USER_LOG_KEY,logs.slice(0,300));
    }catch(e){}
  }
  function showStatus(message){
    if(typeof window.showStatus==="function")window.showStatus(message);
    else{
      const status=$("status");
      if(status){
        status.textContent=message;
        status.classList.add("show");
        clearTimeout(showStatus.timer);
        showStatus.timer=setTimeout(()=>status.classList.remove("show"),2200);
      }
    }
  }
  function refreshAuthUI(){
    const api=window.KGRolePermissions;
    if(api){
      if(typeof api.applyTheme==="function")api.applyTheme();
      const status=$("authStatus");
      if(status&&typeof api.renderStatus==="function")api.renderStatus(status);
      if(typeof api.decoratePermissionElements==="function")api.decoratePermissionElements();
    }
    if(typeof window.authRenderStatus==="function")window.authRenderStatus();
    if(window.KGSubscription&&typeof window.KGSubscription.decorateSubscriptionElements==="function")window.KGSubscription.decorateSubscriptionElements();
    if(window.KGGlobalShortcuts&&typeof window.KGGlobalShortcuts.render==="function")window.KGGlobalShortcuts.render();
    window.dispatchEvent(new CustomEvent("kg-user-profile-updated",{detail:{username:currentUsername()}}));
    window.dispatchEvent(new CustomEvent("kg-role-theme-change",{detail:{role:api&&api.currentRole?api.currentRole():""}}));
  }
  function ensureModal(){
    let modal=$("userCenterModal");
    if(modal)return modal;
    const wrap=document.createElement("div");
    wrap.className="modal-backdrop user-center-backdrop";
    wrap.id="userCenterModal";
    wrap.innerHTML=`
      <div aria-labelledby="userCenterTitle" aria-modal="true" class="modal kg-user-center-modal" role="dialog">
        <div class="kg-user-center-head">
          <div class="kg-user-center-title">
            <div class="kg-user-avatar" id="userCenterAvatar">我</div>
            <div>
              <h2 id="userCenterTitle">用户中心</h2>
              <p>维护自己的账号资料。角色和账号状态由管理员统一调整。</p>
            </div>
          </div>
          <button class="kg-user-center-close" id="userCenterCloseBtn" type="button" aria-label="关闭">×</button>
        </div>
        <div class="kg-user-center-body">
          <div class="kg-user-center-grid">
            <label class="kg-user-field">
              <span>用户名</span>
              <input id="ucUsername" readonly />
            </label>
            <label class="kg-user-field">
              <span>显示名称</span>
              <input id="ucDisplayName" maxlength="40" placeholder="例如：Alex / 张老师" />
            </label>
            <label class="kg-user-field">
              <span>邮箱</span>
              <input id="ucEmail" maxlength="120" placeholder="name@example.com" />
            </label>
            <label class="kg-user-field">
              <span>手机 / 联系方式</span>
              <input id="ucPhone" maxlength="40" placeholder="可选" />
            </label>
            <label class="kg-user-field">
              <span>主要科目</span>
              <input id="ucSubject" maxlength="80" placeholder="PMP / ACP / CSPM" />
            </label>
            <label class="kg-user-field">
              <span>标签</span>
              <input id="ucTags" maxlength="160" placeholder="多个标签用逗号分隔" />
            </label>
            <div class="kg-user-readonly-line">
              <span class="kg-user-chip" id="ucRoleChip">角色：—</span>
              <span class="kg-user-chip" id="ucStatusChip">状态：—</span>
            </div>
            <section class="kg-user-subscription-box" id="ucSubscriptionBox" aria-label="我的订阅"></section>
            <label class="kg-user-field full">
              <span>个人备注 / 学习说明</span>
              <textarea id="ucNote" maxlength="500" placeholder="例如：所在班级、学习目标、备考进度等，仅保存在本浏览器。"></textarea>
            </label>
            <section class="kg-user-password-box">
              <h3>修改密码（可选）</h3>
              <div class="kg-user-center-grid">
                <label class="kg-user-field">
                  <span>当前密码</span>
                  <input id="ucCurrentPassword" type="password" autocomplete="current-password" placeholder="修改密码时填写" />
                </label>
                <label class="kg-user-field">
                  <span>新密码</span>
                  <input id="ucNewPassword" type="password" autocomplete="new-password" placeholder="至少 4 位" />
                </label>
                <label class="kg-user-field">
                  <span>确认新密码</span>
                  <input id="ucConfirmPassword" type="password" autocomplete="new-password" placeholder="再次输入新密码" />
                </label>
              </div>
              <div class="kg-user-center-tip">不修改密码时请留空。微信演示账号或未设置密码的账号，可以直接设置新密码。</div>
            </section>
          </div>
          <div class="kg-user-center-msg" id="userCenterMsg"></div>
          <div class="kg-user-center-actions">
            <button id="userCenterCancelBtn" type="button">取消</button>
            <button class="primary" id="userCenterSaveBtn" type="button">保存个人资料</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    wrap.addEventListener("click",event=>{if(event.target===wrap)closeModal()});
    $("userCenterCloseBtn").addEventListener("click",closeModal);
    $("userCenterCancelBtn").addEventListener("click",closeModal);
    $("userCenterSaveBtn").addEventListener("click",saveProfile);
    document.addEventListener("keydown",event=>{
      if(event.key==="Escape"){
        if($("userSubscriptionDetailModal")&&$("userSubscriptionDetailModal").classList.contains("show"))closeSubscriptionDetailModal();
        else if(wrap.classList.contains("show"))closeModal();
      }
    });
    return wrap;
  }
  function msg(text,ok=false){
    const el=$("userCenterMsg");
    if(!el)return;
    el.textContent=text||"";
    el.classList.toggle("ok",!!ok);
  }
  function fillForm(){
    const rec=currentRecord();
    if(!rec)return false;
    const {username,user}=rec;
    $("ucUsername").value=username;
    $("ucDisplayName").value=user.displayName||username;
    $("ucEmail").value=user.email||"";
    $("ucPhone").value=user.phone||"";
    $("ucSubject").value=user.subject||"PMP";
    $("ucTags").value=Array.isArray(user.tags)?user.tags.join("，"):String(user.tags||"");
    $("ucNote").value=user.note||"";
    $("ucRoleChip").textContent="角色："+roleLabel(user.role||"student");
    $("ucStatusChip").textContent="状态："+statusLabel(user.status||"active");
    renderSubscriptionBox(user);
    $("ucCurrentPassword").value="";
    $("ucNewPassword").value="";
    $("ucConfirmPassword").value="";
    const avatar=$("userCenterAvatar");
    const name=String(user.displayName||username||"我").trim();
    avatar.textContent=name.slice(0,1).toUpperCase()||"我";
    msg("");
    return true;
  }
  function openModal(){
    const modal=ensureModal();
    const rec=currentRecord();
    if(!rec){
      const login=$("authLoginBtn");
      if(login){
        login.click();
        showStatus("请先登录后再进入用户中心。");
      }else{
        alert("请先登录后再进入用户中心。");
      }
      return;
    }
    if(!fillForm())return;
    modal.classList.add("show");
    setTimeout(()=>$("ucDisplayName")&&$("ucDisplayName").focus(),80);
  }
  function closeModal(){
    const modal=$("userCenterModal");
    if(modal)modal.classList.remove("show");
  }
  function saveProfile(){
    const rec=currentRecord();
    if(!rec){msg("请先登录。");return}
    const {username,user}=rec;
    const displayName=cleanText($("ucDisplayName").value,40)||username;
    const email=cleanText($("ucEmail").value,120);
    const phone=cleanText($("ucPhone").value,40);
    const subject=cleanSubject($("ucSubject").value);
    const tags=cleanTags($("ucTags").value);
    const note=cleanText($("ucNote").value,500);
    const currentPassword=String($("ucCurrentPassword").value||"");
    const newPassword=String($("ucNewPassword").value||"");
    const confirmPassword=String($("ucConfirmPassword").value||"");

    if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      msg("邮箱格式不正确。");
      return;
    }
    if(newPassword||confirmPassword||currentPassword){
      if(newPassword.length<4){
        msg("新密码至少 4 位。");
        return;
      }
      if(newPassword!==confirmPassword){
        msg("两次输入的新密码不一致。");
        return;
      }
      if(user.hash){
        const ok=verifyPassword(username,currentPassword,user);
        if(!ok){
          msg("当前密码不正确。");
          return;
        }
      }
      const salt=makeSalt();
      user.salt=salt;
      user.hash=passwordHash(username,newPassword,salt);
    }

    const patch={
      ...user,
      displayName,
      email,
      phone,
      subject,
      tags,
      note,
      updatedAt:Date.now()
    };
    saveUser(username,patch);
    logAction("用户自助更新资料",username,newPassword?"更新资料并修改密码":"更新资料");
    refreshAuthUI();
    fillForm();
    msg("个人资料已保存。",true);
    showStatus("个人资料已更新。");
    setTimeout(closeModal,650);
  }
  function bindEntry(){
    const status=$("authStatus");
    if(!status)return;
    if(String(status.dataset.accountMenuTrigger||"").toLowerCase()==="true"){
      // 首页账号胶囊由 KGAccountMenu 统一接管；避免点击后直接弹出用户中心。
      status.dataset.userCenterEntry="account-menu";
      return;
    }
    if(status.dataset.userCenterBound==="1")return;
    status.dataset.userCenterBound="1";
    status.setAttribute("role","button");
    status.setAttribute("tabindex","0");
    status.setAttribute("title","点击打开用户中心");
    status.addEventListener("click",event=>{
      event.preventDefault();
      openModal();
    });
    status.addEventListener("keydown",event=>{
      if(event.key==="Enter"||event.key===" "){
        event.preventDefault();
        openModal();
      }
    });
  }
  function bindSubscriptionEntrypoints(){
    document.querySelectorAll("#upgradeMemberBtn,[data-open-subscription-detail]").forEach(btn=>{
      if(!btn || btn.dataset.subscriptionDetailBound==="1")return;
      btn.dataset.subscriptionDetailBound="1";
      btn.addEventListener("click",event=>{
        event.preventDefault();
        openSubscriptionDetailModal();
      });
    });
  }
  function init(){
    bindEntry();
    bindSubscriptionEntrypoints();
    ensureModal();
    window.addEventListener("kg-user-profile-updated",()=>setTimeout(()=>{bindEntry();bindSubscriptionEntrypoints()},0));
    window.addEventListener("kg-subscription-change",()=>{if($("userCenterModal")&&$("userCenterModal").classList.contains("show"))fillForm()});
    window.addEventListener("kg-subscription-plan-change",()=>{if($("userCenterModal")&&$("userCenterModal").classList.contains("show"))fillForm()});
    window.addEventListener("storage",event=>{
      if(!event.key || event.key===AUTH_USERS_KEY || event.key===AUTH_SESSION_KEY){
        setTimeout(()=>{bindEntry();refreshAuthUI()},0);
      }
    });
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);
  else init();
  window.KGUserCenter={open:openModal,refresh:refreshAuthUI,openSubscriptionDetail:openSubscriptionDetailModal,closeSubscriptionDetail:closeSubscriptionDetailModal};
})();
