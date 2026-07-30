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
  let nativePayPollTimer=0;
  function clearNativePayPolling(){
    if(nativePayPollTimer){clearInterval(nativePayPollTimer);nativePayPollTimer=0;}
  }
  function setMembershipPaymentView(active){
    const modal=document.querySelector("#userSubscriptionDetailModal .membership-ui");
    if(modal)modal.classList.toggle("is-payment-view",!!active);
  }
  function renderSubscriptionBox(user){
    const panel=$("ucSubscriptionBox");
    if(!panel)return;
    panel.className="uc-info-card uc-membership-card";
    const sub=subscriptionApi();
    if(!sub){
      panel.innerHTML='<div class="uc-card-icon uc-card-icon-membership">◇</div><div class="uc-card-content"><h3>订阅信息暂不可用</h3><p>请刷新页面后重试。</p></div>';
      return;
    }
    const role=user&&user.role||"student";
    if(role==="admin"||role==="teacher"){
      panel.innerHTML=`<div class="uc-card-icon uc-card-icon-membership">◇</div><div class="uc-membership-main"><div class="uc-membership-heading"><div><h3>当前身份免订阅</h3><p>管理员和教师/教研不受学员订阅限制。</p></div></div><p class="uc-membership-note">当前身份可直接使用系统管理或教学维护能力。</p></div>`;
      return;
    }
    if(role==="viewer"){
      panel.innerHTML=`<div class="uc-card-icon uc-card-icon-membership">◇</div><div class="uc-membership-main"><div class="uc-membership-heading"><div><h3>游客体验</h3><p>游客不进入订阅体系。</p></div></div><p class="uc-membership-note">请登录或切换为学员账号后开通会员。</p></div>`;
      return;
    }
    const summary=typeof sub.subscriptionSummary==="function"?sub.subscriptionSummary(user.username):null;
    const plan=summary&&summary.plan || (sub.planById?sub.planById("free"):{name:"免费学员"});
    const record=summary&&summary.subscription || null;
    const statusText=summary&&summary.statusText || "有效";
    const expiresText=summary&&summary.expiresFullText || summary&&summary.expiresText || "长期有效";
    const countdownText=summary&&summary.countdownText || "长期有效";
    const actionText=plan&&plan.id&&plan.id!=="free"?"续费":"续费 / 升级";
    panel.innerHTML=`<div class="uc-card-icon uc-card-icon-membership">◇</div>
      <div class="uc-membership-main"><div class="uc-membership-heading"><div><h3>${escapeHTML(plan.name||"免费学员")}</h3><p>${escapeHTML(plan.description||"当前学员订阅状态。")}</p></div><button type="button" class="uc-button uc-button-primary uc-button-compact" id="ucSubscriptionRenewBtn">${escapeHTML(actionText)}</button></div>
      <div class="uc-meta-chips"><span>✓ 状态：${escapeHTML(statusText)}</span><span>▣ 有效期：${escapeHTML(expiresText)}</span><span>◷ 倒计时：${escapeHTML(countdownText)}</span><span>◇ 来源：${escapeHTML(record&&record.source||"default")}</span></div>
      <p class="uc-membership-note">此处只展示当前订阅状态。点击续费可查看会员权益详情并进入购买 / 开通流程。</p></div>`;
    const btn=$("ucSubscriptionRenewBtn");
    if(btn)btn.addEventListener("click",openSubscriptionDetailModal);
  }
  function renderWechatBox(user){
    const panel=$("ucWechatBox");
    if(!panel)return;
    panel.className="uc-info-card uc-binding-card";
    const wechat=user&&user.wechat;
    const bound=!!(wechat&&wechat.bound);
    const nickname=String(wechat&&wechat.nickname||"微信用户");
    panel.innerHTML=bound
      ?`<div class="uc-card-icon uc-card-icon-wechat">◉</div><div class="uc-card-content"><h3>微信已绑定</h3><p>已绑定微信账号：${escapeHTML(nickname)}。以后可直接使用微信扫码登录。</p></div><button type="button" class="uc-button uc-button-outline uc-button-compact" id="ucWechatUnbindBtn">解除绑定</button>`
      :`<div class="uc-card-icon uc-card-icon-wechat">◉</div><div class="uc-card-content"><h3>尚未绑定微信</h3><p>绑定后可使用微信扫码登录当前账号。</p></div><button type="button" class="uc-button uc-button-outline uc-button-compact" id="ucWechatBindBtn">绑定微信</button>`;
    const bind=$("ucWechatBindBtn");
    const unbind=$("ucWechatUnbindBtn");
    if(bind)bind.addEventListener("click",()=>{
      const api=window.KGWechatLogin;
      if(!api||typeof api.startOfficialLogin!=="function"){msg("微信登录模块未加载，请刷新后重试。");return}
      msg("正在跳转至微信授权页…",true);
      api.startOfficialLogin('bind');
    });
    if(unbind)unbind.addEventListener("click",async()=>{
      const api=window.KGWechatLogin;
      if(!api||typeof api.unbind!=="function"){msg("微信登录模块未加载，请刷新后重试。");return}
      if(!confirm("解除后将不能使用该微信扫码登录，确定解除绑定吗？"))return;
      unbind.disabled=true;
      const result=await api.unbind();
      if(!result||!result.ok){
        unbind.disabled=false;
        msg(result&&result.message||"解除微信绑定失败。");
        return;
      }
      fillForm();
      msg("微信绑定已解除。",true);
      showStatus("微信绑定已解除。");
    });
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
    wrap.className="modal-backdrop user-subscription-detail-backdrop membership-ui-backdrop";
    wrap.id="userSubscriptionDetailModal";
    wrap.innerHTML=`
      <div aria-labelledby="userSubscriptionDetailTitle" aria-modal="true" class="modal kg-subscription-detail-modal membership-ui" role="dialog">
        <header class="modal-header">
          <div class="brand">
            <div class="brand-mark" aria-hidden="true">会</div>
            <div>
              <h2 class="brand-title" id="userSubscriptionDetailTitle">会员权益</h2>
              <p class="brand-copy">查看各会员方案权益，选择套餐后可使用微信扫码开通。</p>
            </div>
          </div>
          <button class="icon-button dialog-close" id="userSubscriptionDetailCloseBtn" type="button" aria-label="关闭"><span class="modal-close-icon" aria-hidden="true"></span></button>
        </header>
        <div class="kg-subscription-detail-body" id="userSubscriptionDetailBody"></div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click",event=>{if(event.target===wrap)closeSubscriptionDetailModal()});
    $("userSubscriptionDetailCloseBtn").addEventListener("click",closeSubscriptionDetailModal);
    return wrap;
  }
  function renderSubscriptionDetailPlans(){
    setMembershipPaymentView(false);
    const body=$("userSubscriptionDetailBody");
    const sub=subscriptionApi();
    const rec=currentRecord();
    if(!body||!sub){return}
    const summary=rec&&typeof sub.subscriptionSummary==="function"?sub.subscriptionSummary(rec.username):null;
    const currentPlanId=summary&&summary.plan&&summary.plan.id || "";
    const plans=typeof sub.enabledPlanList==="function"?sub.enabledPlanList():[];
    body.innerHTML=`<div class="divider"></div><div class="plans-grid">
      ${plans.map(plan=>{
        const current=!!currentPlanId && plan.id===currentPlanId;
        const features=planFeatureList(plan);
        const limitText=planLimitText(plan);
        const featured=plan.id==="monthly"||!!plan.recommended;
        const cta=current?(plan.id==="free"?"当前使用中":"续费当前方案"):(plan.id==="free"?"免费使用":"选择该方案");
        return `<article class="plan-card${featured?' featured':''}${current?' current':''}" data-plan-id="${escapeHTML(plan.id)}">
          <div class="plan-head">
            <h3 class="plan-title">${escapeHTML(plan.name||'套餐')}</h3>
            <span class="pill${plan.recommended&&!current?' pill-warning':''}">${plan.recommended&&!current?'<span class="icon i-star"></span>':''}${escapeHTML(current?'当前方案':(plan.badgeText||plan.shortName||'套餐'))}</span>
          </div>
          <div class="plan-price">
            <strong>${escapeHTML(plan.priceText||'待配置')}</strong>
            ${plan.originalPriceText?`<del>${escapeHTML(plan.originalPriceText)}</del>`:''}
          </div>
          <p class="plan-desc">${escapeHTML(plan.description||'')}</p>
          <div class="plan-rule"></div>
          <div class="benefit-line"><span class="benefit-dot"></span><span>${escapeHTML(features[0]||'会员权益')}</span></div>
          ${limitText?`<div class="feature-chip"><span class="icon i-infinity"></span><span>${escapeHTML(limitText)}</span></div>`:''}
          <button type="button" class="btn ${current?'current-btn':'btn-primary'}" data-buy-plan="${escapeHTML(plan.id)}">${current?'<span class="icon i-check-circle"></span>':''}${escapeHTML(cta)}${!current&&plan.id!=="free"?'<span class="icon i-chevron-right"></span>':''}</button>
        </article>`;
      }).join('')}
    </div>
    <section class="redeem">
      <div class="redeem-intro">
        <div class="redeem-icon"><span class="icon i-ticket"></span></div>
        <div><h3 class="redeem-title">卡密使用</h3><p class="redeem-copy">使用会员卡密兑换会员权益</p></div>
      </div>
      <input class="redeem-input" id="subscriptionRedeemCodeInput" placeholder="请输入会员卡密，例如 VIP-XXXX-XXXX-XXXX" autocomplete="off" />
      <button type="button" class="btn btn-primary" id="subscriptionRedeemCodeBtn">兑换卡密</button>
      <div class="redeem-message" id="subscriptionRedeemCodeMsg"></div>
    </section>
    <div class="footnote"><span class="icon i-shield-check"></span>卡密兑换成功后，权益将自动开通并即时生效</div>`;
    function renderPlanConfirm(plan){
      setMembershipPaymentView(false);
      if(!body||!plan)return;
      const features=planFeatureList(plan).slice(0,8);
      const limitText=planLimitText(plan);
      const latest=currentRecord();
      const username=latest&&latest.username||"";
      body.innerHTML=`<div class="divider"></div>
        <div class="toolbar"><button type="button" class="back-button" id="subscriptionBackToPlansBtn"><span class="icon i-arrow-left"></span>返回会员方案</button></div>
        <section class="confirm-card">
          <div class="confirm-main">
            <div class="confirm-head">
              <div><p class="kicker">确认订阅申请</p><h3 class="confirm-title">${escapeHTML(plan.name||'会员方案')}</h3></div>
              <span class="pill">${escapeHTML(plan.badgeText||plan.shortName||'会员')}</span>
            </div>
          <div class="confirm-price">
            <strong>${escapeHTML(plan.priceText||'待配置')}</strong>
            ${plan.originalPriceText?`<del>${escapeHTML(plan.originalPriceText)}</del>`:''}
          </div>
          <p class="confirm-help">确认后生成微信支付二维码。请使用微信扫码并在手机上完成付款，权益会在支付成功后自动开通。</p>
          <div class="meta-grid">
            <div class="meta-card"><div class="meta-icon"><span class="icon i-user"></span></div><div><div class="meta-label">申请账号</div><div class="meta-value">${escapeHTML(username||'未登录')}</div></div></div>
            <div class="meta-card"><div class="meta-icon green"><span class="icon i-wallet"></span></div><div><div class="meta-label">开通方式</div><div class="meta-value">微信扫码支付</div></div></div>
            <div class="meta-card"><div class="meta-icon"><span class="icon i-clock"></span></div><div><div class="meta-label">订单状态</div><div class="meta-value">待支付</div></div></div>
          </div>
          <section class="benefits"><h4 class="section-title">包含权益</h4>${features.map(item=>`<div class="benefit-item"><span class="icon i-check-circle"></span>${escapeHTML(item)}</div>`).join('')}${limitText?`<div class="benefit-item usage-item"><span class="icon i-infinity"></span>${escapeHTML(limitText)}</div>`:''}</section>
          </div>
          <aside class="guide">
            <div class="guide-visual"><div class="guide-browser"></div><div class="guide-wechat"><span class="icon i-wechat"></span></div></div>
            <h4 class="guide-title">微信扫码支付</h4><p class="guide-copy">支付成功后，会员权益将自动开通</p>
            <div class="steps"><div><div class="step-icon"><span class="icon i-qr-code"></span></div><div class="step-title">1. 打开微信</div><div class="step-copy">扫一扫</div></div><div class="step-arrow"><span class="icon i-chevron-right"></span></div><div><div class="step-icon"><span class="icon i-scan"></span></div><div class="step-title">2. 扫描二维码</div><div class="step-copy">确认订单</div></div><div class="step-arrow"><span class="icon i-chevron-right"></span></div><div><div class="step-icon"><span class="icon i-check-circle"></span></div><div class="step-title">3. 完成支付</div><div class="step-copy">权益自动开通</div></div></div>
          </aside>
        </section>
        <div class="confirm-actions"><button type="button" class="btn btn-secondary" id="subscriptionCancelOrderBtn">取消</button><button type="button" class="btn btn-primary" id="subscriptionSubmitOrderBtn">生成支付二维码</button></div>
        <div class="footnote"><span class="icon i-shield-check"></span>支付过程由微信安全保障，请放心使用</div>`;
      const back=$("subscriptionBackToPlansBtn");
      const cancel=$("subscriptionCancelOrderBtn");
      const submit=$("subscriptionSubmitOrderBtn");
      if(back)back.addEventListener("click",renderSubscriptionDetailPlans);
      if(cancel)cancel.addEventListener("click",renderSubscriptionDetailPlans);
      if(submit)submit.addEventListener("click",async()=>{
        const pay=window.KGWechatPay;
        if(!pay||typeof pay.createNativeOrder!=="function"){
          showStatus("支付服务不可用，请刷新页面后重试。");
          return;
        }
        submit.disabled=true;
        submit.textContent="正在生成…";
        try{
          const result=await pay.createNativeOrder(plan.id);
          if(!result||!result.order||!result.order.codeUrl){
            showStatus("支付二维码生成失败，请重试。");
            submit.disabled=false;
            submit.textContent="重新生成支付二维码";
            return;
          }
          renderNativePayment(plan,result.order);
          showStatus("支付二维码已生成，请使用微信扫码。");
        }catch(error){
          showStatus(String(error&&error.message||"支付二维码生成失败，请重试。"));
          submit.disabled=false;
          submit.textContent="重新生成支付二维码";
        }
      });
    }
    function renderNativePayment(plan,order){
      const pay=window.KGWechatPay;
      if(!body||!pay||!order||!order.id)return;
      clearNativePayPolling();
      setMembershipPaymentView(true);
      const amount=`￥${((Number(order.amount)||0)/100).toFixed(2)}`;
      body.innerHTML=`<div class="divider"></div>
        <section class="payment-grid">
          <article class="payment-card payment-card--qr"><div class="payment-card-head"><div class="payment-tag"><span class="icon i-wechat"></span>微信扫码支付</div><h3 class="payment-title">${escapeHTML(plan&&plan.name||order.planName||'会员方案')}</h3><p class="payment-help">请使用微信扫描二维码并完成付款，支付结果将自动刷新。</p></div><div class="qr-frame"><img class="kg-native-pay-qr" src="${escapeHTML(pay.nativeOrderQrCodeUrl(order.id))}" alt="微信支付二维码" /></div><div class="wechat-hint"><div class="wechat-hint-icon"><span class="icon i-wechat"></span></div><div><strong>微信扫一扫</strong><span>支付成功后自动开通会员权益</span></div></div></article>
          <article class="payment-card payment-summary"><div class="summary-top"><div><p class="summary-label">应付金额</p><div class="summary-amount">${escapeHTML(amount)}</div></div><span class="pill pill-solid"><span class="icon i-clock"></span>待支付</span></div><div class="summary-divider"></div><dl class="summary-list"><div class="summary-row"><dt class="summary-key"><span class="icon i-receipt"></span>订单编号</dt><dd class="summary-value">${escapeHTML(order.id)}</dd></div><div class="summary-row"><dt class="summary-key"><span class="icon i-money"></span>支付金额</dt><dd class="summary-value green">${escapeHTML(amount)}</dd></div><div class="summary-row"><dt class="summary-key"><span class="icon i-clock"></span>订单状态</dt><dd class="summary-value" id="nativePayStatus">等待扫码付款</dd></div></dl><div class="summary-note"><span class="icon i-info"></span>支付成功后页面将自动更新状态</div></article>
        </section>
        <div class="payment-actions"><button type="button" class="btn btn-secondary" id="nativePayRefreshBtn"><span class="icon i-refresh"></span>查询支付状态</button><button type="button" class="btn btn-primary" id="nativePayCloseBtn">稍后支付</button></div>
        <div class="footnote"><span class="icon i-shield-check"></span>支付过程由微信安全保障，请放心使用</div>`;
      const status=$("nativePayStatus");
      const refresh=async()=>{
        try{
          const latest=await pay.getNativeOrderStatus(order.id);
          if(latest.payStatus==="paid"){
            clearNativePayPolling();
            pay.syncSubscription(latest.subscription);
            renderOrderSubmitted(plan,{order});
            showStatus("支付成功，会员权益已开通。",true);
            window.setTimeout(()=>{
              closeSubscriptionDetailModal();
              window.location.href="index.html?mode=free";
            },1600);
            return;
          }
          if(status)status.textContent="等待扫码付款";
        }catch(error){
          if(status)status.textContent="查询失败，可点击重试";
        }
      };
      $("nativePayRefreshBtn")?.addEventListener("click",refresh);
      $("nativePayCloseBtn")?.addEventListener("click",closeSubscriptionDetailModal);
      nativePayPollTimer=setInterval(refresh,3000);
      refresh();
    }
    function renderOrderSubmitted(plan,result){
      setMembershipPaymentView(false);
      const order=result&&result.order||{};
      body.innerHTML=`<div class="divider"></div><section class="payment-success"><div class="success-icon"><span class="icon i-check-circle"></span></div><h3>支付成功</h3><p>会员权益已开通，即将返回首页。</p><div class="success-meta"><span>开通方案：${escapeHTML(plan&&plan.name||order.planName||'会员')}</span><span>订单编号：${escapeHTML(order.id||'—')}</span></div><button type="button" class="btn btn-primary" id="subscriptionCloseAfterSubmitBtn">知道了</button></section>`;
      $("subscriptionCloseAfterSubmitBtn")?.addEventListener("click",closeSubscriptionDetailModal);
    }
    async function handlePlanPick(card){
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
      const pay=window.KGWechatPay;
      if(!pay||typeof pay.createNativeOrder!=="function"){
        showStatus("支付服务不可用，请刷新页面后重试。");
        return;
      }
      const initialMarkup=card.innerHTML;
      card.disabled=true;
      card.textContent="正在生成二维码…";
      try{
        const result=await pay.createNativeOrder(plan.id);
        if(!result||!result.order||!result.order.codeUrl){
          throw new Error("支付二维码生成失败，请重试。");
        }
        renderNativePayment(plan,result.order);
        showStatus("支付二维码已生成，请使用微信扫码。",true);
      }catch(error){
        card.disabled=false;
        card.innerHTML=initialMarkup;
        showStatus(String(error&&error.message||"支付二维码生成失败，请重试。"));
      }
    }
    body.querySelectorAll('[data-buy-plan]').forEach(card=>card.addEventListener('click',()=>handlePlanPick(card)));
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
    setMembershipPaymentView(false);
    renderSubscriptionDetailPlans();
    modal.classList.add("show");
  }
  function closeSubscriptionDetailModal(){
    clearNativePayPolling();
    setMembershipPaymentView(false);
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
      <div aria-labelledby="userCenterTitle" aria-modal="true" class="modal kg-user-center-modal uc-dialog" role="dialog">
        <header class="uc-header"><div class="uc-profile-heading"><div class="uc-avatar" id="userCenterAvatar">我</div><div><h2 id="userCenterTitle">用户中心</h2><p>维护自己的账号资料。角色和账号状态由管理员统一调整。</p></div></div><button class="uc-close dialog-close" id="userCenterCloseBtn" type="button" aria-label="关闭用户中心"><span class="modal-close-icon" aria-hidden="true"></span></button></header>
        <div class="kg-user-center-body uc-body"><div class="uc-form-grid">
          <label class="uc-field uc-field-readonly"><span>用户名</span><div><input id="ucUsername" readonly /><b aria-hidden="true">♙</b></div></label>
          <label class="uc-field"><span>显示名称</span><div><input id="ucDisplayName" maxlength="40" placeholder="例如：Alex / 张老师" /></div></label>
          <label class="uc-field"><span>邮箱</span><div><input id="ucEmail" maxlength="120" placeholder="name@example.com" /></div></label>
          <label class="uc-field"><span>手机 / 联系方式</span><div><input id="ucPhone" maxlength="40" placeholder="可选" /></div></label>
          <label class="uc-field"><span>主要科目</span><div><input id="ucSubject" maxlength="80" placeholder="PMP / ACP / CSPM" /></div></label>
          <label class="uc-field"><span>标签</span><div><input id="ucTags" maxlength="160" placeholder="多个标签用逗号分隔" /></div></label>
        </div>
        <div class="uc-status-row"><span class="uc-status-chip uc-role" id="ucRoleChip">角色：—</span><span class="uc-status-chip uc-normal" id="ucStatusChip">状态：—</span></div>
        <section class="uc-info-card uc-binding-card" id="ucWechatBox" aria-label="微信登录"></section>
        <section class="uc-info-card uc-membership-card" id="ucSubscriptionBox" aria-label="我的订阅"></section>
        <label class="uc-field uc-notes-field"><span>个人备注 / 学习说明</span><div class="uc-textarea-wrap"><textarea id="ucNote" maxlength="500" placeholder="例如：所在班级、学习目标、备考进度等，保存后会同步到服务器。"></textarea><em id="ucNoteCount">0/500</em></div></label>
        <section class="uc-password-card"><h3>安全设置 · 修改密码（可选）</h3><p>不修改密码时请留空；微信账号或未设置密码的账号可直接设置新密码。</p><div class="uc-form-grid uc-password-grid"><label class="uc-field"><span>当前密码</span><div><input id="ucCurrentPassword" type="password" autocomplete="current-password" placeholder="修改密码时填写" /></div></label><label class="uc-field"><span>新密码</span><div><input id="ucNewPassword" type="password" autocomplete="new-password" placeholder="至少 4 位" /></div></label><label class="uc-field"><span>确认新密码</span><div><input id="ucConfirmPassword" type="password" autocomplete="new-password" placeholder="再次输入新密码" /></div></label></div></section>
        </div>
        <footer class="kg-user-center-footer" data-uc-footer><div class="kg-user-center-msg uc-message" id="userCenterMsg"></div><div class="uc-actions"><button class="uc-button uc-button-secondary" id="userCenterCancelBtn" type="button">取消</button><button class="uc-button uc-button-primary" id="userCenterSaveBtn" type="button">保存个人资料</button></div></footer>
      </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener("click",event=>{if(event.target===wrap)closeModal()});
    $("userCenterCloseBtn").addEventListener("click",closeModal);
    $("userCenterCancelBtn").addEventListener("click",closeModal);
    $("userCenterSaveBtn").addEventListener("click",saveProfile);
    $("ucNote").addEventListener("input",()=>{
      const count=$("ucNoteCount");
      if(count)count.textContent=`${$("ucNote").value.length}/500`;
    });
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
    $("ucNoteCount").textContent=`${$("ucNote").value.length}/500`;
    $("ucRoleChip").textContent="角色："+roleLabel(user.role||"student");
    $("ucStatusChip").textContent="状态："+statusLabel(user.status||"active");
    renderWechatBox(user);
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
    window.addEventListener("kg-wechat-binding-change",()=>{if($("userCenterModal")&&$("userCenterModal").classList.contains("show"))fillForm()});
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
