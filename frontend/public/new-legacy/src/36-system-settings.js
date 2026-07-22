"use strict";

/*
 * 系统设置页。
 * 负责系统级配置：角色主题、微信登录、权限模板、系统日志。
 * 用户管理页只保留账号管理相关能力。
 */
(function(){
  const A=window.KGAdminUtils||{};
  const Store=window.KGAppStorage||{};
  const USER_LOG_KEY=A.USER_LOG_KEY||'kg_user_admin_logs_v1';
  const $=id=>document.getElementById(id);
  const readJSON=A.readJSON||((key,fallback)=>Store.readJSON?Store.readJSON(key,fallback):(()=>{try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback}catch(e){return fallback}})());
  const writeJSON=A.writeJSON||((key,value)=>Store.writeJSON?Store.writeJSON(key,value):localStorage.setItem(key,JSON.stringify(value)));
  const escapeHTML=A.escapeHTML||(value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])));
  const fmtTime=A.fmtTime||(ts=>ts?new Date(Number(ts)).toLocaleString('zh-CN',{hour12:false}):'—');
  const roleLabel=A.roleLabel||(role=>({admin:'管理员',teacher:'教师/教研',student:'学员',viewer:'游客'}[role]||role||'学员'));
  const logAction=A.logAction||((action,username='SYSTEM',detail='')=>{
    const logs=readJSON(USER_LOG_KEY,[]);
    logs.unshift({id:'log-'+Date.now().toString(36),action,username,detail:String(detail||''),actor:'system-admin',at:Date.now()});
    writeJSON(USER_LOG_KEY,logs.slice(0,300));
  });
  const refreshRoleUi=A.refreshRoleUi||(()=>{});
  function toast(text){(A.toast?A.toast('ssToast',text):(()=>{const el=$('ssToast');if(el){el.textContent=text;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),1800)}})())}
  const REDEEM_CODE_PAGE_SIZE=10;
  let redeemCodePage=1;


  function ensureAccess(){
    const api=window.KGRolePermissions;
    if(!api)return true;
    api.applyTheme&&api.applyTheme();
    const status=$('authStatus');
    if(status&&api.renderStatus)api.renderStatus(status);
    if(api.decoratePermissionElements)api.decoratePermissionElements();
    if(!api.can('accessSystemSettings')){
      api.renderPermissionDenied(
        document.querySelector('.ss-app') || document.body,
        '系统设置仅限管理员访问。请先在首页登录管理员账号，或联系管理员调整角色。'
      );
      return false;
    }
    return true;
  }

  function renderRoleThemes(){
    const panel=$('ssRoleThemePanel');
    if(!panel)return;
    const api=window.KGRolePermissions;
    if(!api){panel.innerHTML='<div class="um-empty">角色主题模块未加载。</div>';return}
    const themes=api.getThemes();
    const rows=['admin','teacher','student','viewer'];
    panel.innerHTML=rows.map(role=>{
      const theme=themes[role]||api.DEFAULT_THEMES[role];
      return `<article class="um-role-theme" data-theme-role="${escapeHTML(role)}" style="--theme:${escapeHTML(theme.primary)};--theme-accent:${escapeHTML(theme.accent)};--theme-soft:${escapeHTML(theme.soft)}">
        <div class="um-role-theme-head">
          <span class="um-role-dot" style="background:${escapeHTML(theme.primary)}"></span>
          <strong>${escapeHTML(roleLabel(role))}</strong>
        </div>
        <label><span>主色</span><input type="color" data-theme-field="primary" value="${escapeHTML(theme.primary)}"></label>
        <label><span>强调色</span><input type="color" data-theme-field="accent" value="${escapeHTML(theme.accent)}"></label>
        <label><span>柔和底色</span><input type="color" data-theme-field="soft" value="${escapeHTML(theme.soft)}"></label>
        <div class="um-role-theme-actions">
          <button type="button" data-save-theme="${escapeHTML(role)}">保存</button>
          <button type="button" data-reset-theme="${escapeHTML(role)}">恢复默认</button>
        </div>
      </article>`;
    }).join('');
  }
  function themeCardByRole(role){
    const panel=$('ssRoleThemePanel');
    return panel ? panel.querySelector(`.um-role-theme[data-theme-role="${role}"]`) : null;
  }
  function collectRoleTheme(card){
    const theme={};
    if(!card)return theme;
    card.querySelectorAll('[data-theme-field]').forEach(input=>{
      if(input.dataset.themeField)theme[input.dataset.themeField]=input.value;
    });
    return theme;
  }

  function saveRoleTheme(role){
    const api=window.KGRolePermissions;if(!api)return;
    const card=themeCardByRole(role);if(!card){toast('没有找到对应角色主题卡片');return}
    const theme=collectRoleTheme(card);
    api.saveTheme(role,theme);
    refreshRoleUi();
    logAction('修改角色主题',role,`${roleLabel(role)} 主题色已更新`);
    renderRoleThemes();
    toast('角色主题已保存');
  }
  function resetRoleTheme(role){
    const api=window.KGRolePermissions;if(!api)return;
    api.resetTheme(role);
    refreshRoleUi();
    logAction('恢复角色主题',role,`${roleLabel(role)} 主题恢复默认`);
    renderRoleThemes();
    toast('已恢复默认主题');
  }

  function renderWechatConfig(){
    const panel=$('ssWechatConfigPanel');
    if(!panel)return;
    const api=window.KGWechatLogin;
    if(!api){panel.innerHTML='<div class="um-empty">微信登录模块未加载。</div>';return}
    const cfg=api.getConfig();
    panel.innerHTML=`<div class="um-wechat-config">
      <p class="um-wechat-note">微信扫码配置由服务器统一保存。AppSecret 只可在部署环境中设置，不会显示或存入浏览器。</p>
      <div class="um-wechat-checks">
        <label><input type="checkbox" id="wxEnableDemo" ${cfg.enableDemo?'checked':''}> 启用扫码测试模式</label>
        <label><input type="checkbox" id="wxEnableOfficial" ${cfg.enableOfficial?'checked':''}> 启用正式微信开放平台模式</label>
        <label><input type="checkbox" id="wxAutoCreate" ${cfg.autoCreateUser?'checked':''}> 首次微信登录自动创建用户</label>
      </div>
      <div class="um-wechat-grid">
        <label>微信开放平台 AppID<input id="wxAppId" value="${escapeHTML(cfg.appId)}" placeholder="wx1234567890abcdef"></label>
        <label>授权回调地址 redirect_uri<input id="wxRedirectUri" value="${escapeHTML(cfg.redirectUri)}" placeholder="https://lszl.aihuanpu.com/api/v1/auth/wechat/callback"></label>
        <label>微信授权 scope<select id="wxScope"><option value="snsapi_login" ${cfg.scope==='snsapi_login'?'selected':''}>snsapi_login（网站扫码）</option><option value="snsapi_userinfo" ${cfg.scope==='snsapi_userinfo'?'selected':''}>snsapi_userinfo（公众号网页授权）</option></select></label>
        <label>微信新用户默认角色<select id="wxDefaultRole"><option value="student" ${cfg.defaultRole==='student'?'selected':''}>学员</option><option value="viewer" ${cfg.defaultRole==='viewer'?'selected':''}>游客</option><option value="teacher" ${cfg.defaultRole==='teacher'?'selected':''}>教师/教研</option></select></label>
        <label>微信新用户默认科目<input id="wxDefaultSubject" value="${escapeHTML(cfg.defaultSubject||'PMP')}" placeholder="PMP"></label>
      </div>
      <div class="um-wechat-actions"><button type="button" class="primary" id="wxSaveConfigBtn">保存微信配置</button></div>
      <div class="um-wechat-preview">正式登录由服务器创建授权链接并校验回调状态；浏览器不会接触 AppSecret 或微信用户标识。</div>
    </div>`;
  }
  function collectWechatConfig(){
    const api=window.KGWechatLogin;if(!api)return null;
    return {
      enableDemo:!!$('wxEnableDemo')?.checked,
      enableOfficial:!!$('wxEnableOfficial')?.checked,
      autoCreateUser:!!$('wxAutoCreate')?.checked,
      appId:$('wxAppId')?.value.trim()||'',
      redirectUri:$('wxRedirectUri')?.value.trim()||'',
      scope:$('wxScope')?.value||'snsapi_login',
      defaultRole:$('wxDefaultRole')?.value||'student',
      defaultSubject:$('wxDefaultSubject')?.value.trim()||'PMP'
    };
  }
  function saveWechatConfig(){
    const api=window.KGWechatLogin;if(!api)return;
    const cfg=api.saveConfig(collectWechatConfig());
    logAction('保存微信登录配置','SYSTEM',cfg.enableOfficial?'正式微信模式已启用':'保存本地演示微信配置');
    renderWechatConfig();
    toast('微信登录配置已保存');
  }
  function renderPermissionMatrix(){
    const panel=$('ssPermissionMatrix');
    if(!panel)return;
    const api=window.KGRolePermissions;
    if(!api){panel.innerHTML='<div class="um-empty">权限模块未加载。</div>';return}
    panel.innerHTML=api.roleRows().map(row=>`<article class="um-permission-row">
      <strong>${escapeHTML(row.label)}</strong>
      <div>${row.permissions.map(p=>`<span>${escapeHTML(api.PERMISSION_LABELS[p]||p)}</span>`).join('')}</div>
    </article>`).join('');
  }

  function renderSubscriptionOrdersMarkup(sub){
    if(!sub||typeof sub.orderList!=='function')return '';
    const orders=sub.orderList({}).slice(0,80);
    const pending=orders.filter(order=>order.status==='pending').length;
    const approved=orders.filter(order=>order.status==='approved').length;
    const cancelled=orders.filter(order=>order.status==='cancelled').length;
    const statusLabel=typeof sub.orderStatusLabel==='function'?sub.orderStatusLabel:(status=>status||'未知');
    return `<section class="subscription-order-admin-panel">
      <div class="subscription-admin-toolbar subscription-order-toolbar">
        <div>
          <strong>订阅开通申请</strong>
          <p>学员在会员权益弹窗中点击会员卡片后，会生成待确认申请。管理员确认后自动开通或续费对应套餐。</p>
        </div>
        <div class="subscription-order-stats">
          <span>待确认：${pending}</span>
          <span>已开通：${approved}</span>
          <span>已取消：${cancelled}</span>
        </div>
      </div>
      ${orders.length?`<div class="subscription-order-list">
        ${orders.map(order=>{
          const pendingOrder=order.status==='pending';
          const price=[order.amountText,order.originalPriceText&&order.originalPriceText!==order.amountText?`原价 ${order.originalPriceText}`:'',order.discountText].filter(Boolean).join(' · ');
          return `<article class="subscription-order-item ${escapeHTML(order.status)}" data-order-id="${escapeHTML(order.id)}">
            <div class="subscription-order-main">
              <div>
                <strong>${escapeHTML(order.planName||order.planId)}</strong>
                <span>${escapeHTML(order.username)} · ${escapeHTML(price||'价格待配置')}</span>
              </div>
              <em>${escapeHTML(statusLabel(order.status))}</em>
            </div>
            <div class="subscription-order-submeta">
              <span>提交：${escapeHTML(fmtTime(order.createdAt))}</span>
              ${order.approvedAt?`<span>开通：${escapeHTML(fmtTime(order.approvedAt))} · ${escapeHTML(order.approvedBy||'')}</span>`:''}
              ${order.cancelledAt?`<span>取消：${escapeHTML(fmtTime(order.cancelledAt))} · ${escapeHTML(order.cancelledBy||'')}</span>`:''}
              <span>订单：${escapeHTML(order.id)}</span>
            </div>
            ${order.snapshot&&order.snapshot.usageText?`<p>${escapeHTML(order.snapshot.usageText)}</p>`:''}
            <div class="subscription-order-actions">
              <button type="button" class="primary" data-order-action="approve" ${pendingOrder?'':'disabled'}>确认开通</button>
              <button type="button" data-order-action="cancel" ${pendingOrder?'':'disabled'}>取消申请</button>
            </div>
          </article>`;
        }).join('')}
      </div>`:`<div class="um-empty">暂无订阅开通申请。学员点击会员权益卡片并确认后，会在这里生成待确认记录。</div>`}
    </section>`;
  }
  function renderRedeemCodeAdminMarkup(sub){
    if(!sub||typeof sub.redeemCodeList!=='function')return '';
    const all=sub.redeemCodeList({});
    const unused=all.filter(code=>code.status==='unused').length;
    const used=all.filter(code=>code.status==='used').length;
    const disabled=all.filter(code=>code.status==='disabled').length;
    const totalPages=Math.max(1,Math.ceil(all.length/REDEEM_CODE_PAGE_SIZE));
    redeemCodePage=Math.min(Math.max(1,redeemCodePage),totalPages);
    const start=(redeemCodePage-1)*REDEEM_CODE_PAGE_SIZE;
    const pageItems=all.slice(start,start+REDEEM_CODE_PAGE_SIZE);
    const plans=typeof sub.enabledPlanList==='function'?sub.enabledPlanList().filter(plan=>plan.id!=='free'):[];
    const statusLabel=typeof sub.redeemCodeStatusLabel==='function'?sub.redeemCodeStatusLabel:(status=>status||'未知');
    const planOptions=plans.map(plan=>`<option value="${escapeHTML(plan.id)}">${escapeHTML(plan.name||plan.id)}</option>`).join('');
    return `<section class="subscription-code-admin-panel">
      <div class="subscription-admin-toolbar subscription-code-toolbar">
        <div>
          <strong>卡密管理</strong>
          <p>管理员可批量生成会员卡密，学员在会员权益弹窗中输入卡密后可直接开通或续费。当前列表每页显示 ${REDEEM_CODE_PAGE_SIZE} 条。</p>
        </div>
        <div class="subscription-order-stats">
          <span>未使用：${unused}</span>
          <span>已使用：${used}</span>
          <span>已停用：${disabled}</span>
        </div>
      </div>
      <div class="subscription-code-create">
        <label>会员方案<select id="ssRedeemPlanSelect">${planOptions}</select></label>
        <label>生成数量<input id="ssRedeemCountInput" type="number" min="1" max="200" value="10"></label>
        <label>卡密前缀<input id="ssRedeemPrefixInput" value="VIP" maxlength="8" placeholder="VIP"></label>
        <label class="full">备注<input id="ssRedeemNoteInput" placeholder="例如：线下活动 / 管理员发放"></label>
        <button type="button" class="primary" id="ssGenerateRedeemCodesBtn">生成卡密</button>
      </div>
      ${all.length?`<div class="subscription-code-list">
        ${pageItems.map(code=>`<article class="subscription-code-item ${escapeHTML(code.status)}" data-code-id="${escapeHTML(code.id)}">
          <div class="subscription-code-main">
            <div>
              <strong>${escapeHTML(code.code)}</strong>
              <span>${escapeHTML(code.planName||code.planId)} · ${escapeHTML(statusLabel(code.status))}</span>
            </div>
            <em>${escapeHTML(code.status==='unused'?'可发放':statusLabel(code.status))}</em>
          </div>
          <div class="subscription-code-submeta">
            <span>生成：${escapeHTML(fmtTime(code.createdAt))}</span>
            ${code.usedAt?`<span>使用：${escapeHTML(fmtTime(code.usedAt))} · ${escapeHTML(code.usedBy||'')}</span>`:''}
            ${code.note?`<span>备注：${escapeHTML(code.note)}</span>`:''}
          </div>
          <div class="subscription-code-actions">
            <button type="button" data-code-action="copy">复制</button>
            <button type="button" data-code-action="disable" ${code.status==='unused'?'':'disabled'}>停用</button>
            <button type="button" data-code-action="enable" ${code.status==='disabled'?'':'disabled'}>启用</button>
            <button type="button" data-code-action="remove">删除</button>
          </div>
        </article>`).join('')}
      </div>
      <div class="subscription-code-pagination" aria-label="卡密列表分页">
        <button type="button" data-code-page="first" ${redeemCodePage<=1?'disabled':''}>首页</button>
        <button type="button" data-code-page="prev" ${redeemCodePage<=1?'disabled':''}>上一页</button>
        <span>第 <strong>${redeemCodePage}</strong> / ${totalPages} 页 · 共 ${all.length} 条</span>
        <button type="button" data-code-page="next" ${redeemCodePage>=totalPages?'disabled':''}>下一页</button>
        <button type="button" data-code-page="last" ${redeemCodePage>=totalPages?'disabled':''}>末页</button>
      </div>`:`<div class="um-empty">暂无卡密。填写上方信息后可批量生成，列表会按每页 ${REDEEM_CODE_PAGE_SIZE} 条分页显示。</div>`}
    </section>`;
  }
  function handleRedeemCodeGenerate(){
    const sub=window.KGSubscription;if(!sub||typeof sub.generateRedeemCodes!=='function')return;
    const planId=$('ssRedeemPlanSelect')?.value||'monthly';
    const count=$('ssRedeemCountInput')?.value||1;
    const prefix=$('ssRedeemPrefixInput')?.value||'VIP';
    const note=$('ssRedeemNoteInput')?.value||'';
    const result=sub.generateRedeemCodes({planId,count,prefix,note});
    if(!result||!result.ok){toast(result&&result.message||'卡密生成失败');return}
    redeemCodePage=1;
    toast(result.message||'卡密已生成');
    renderSubscriptionPlans();
  }
  function handleRedeemCodeAction(btn){
    const sub=window.KGSubscription;if(!sub)return;
    const item=btn.closest('[data-code-id]');
    const id=item&&item.dataset.codeId;
    if(!id)return;
    const action=btn.dataset.codeAction;
    if(action==='copy'){
      const text=item.querySelector('.subscription-code-main strong')?.textContent||'';
      if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(()=>toast('卡密已复制')).catch(()=>prompt('复制卡密：',text));}
      else prompt('复制卡密：',text);
      return;
    }
    let ok=false;
    if(action==='disable')ok=!!(sub.disableRedeemCode&&sub.disableRedeemCode(id));
    else if(action==='enable')ok=!!(sub.enableRedeemCode&&sub.enableRedeemCode(id));
    else if(action==='remove'){
      if(!confirm('确认删除这条卡密？删除后不可恢复。'))return;
      ok=!!(sub.removeRedeemCode&&sub.removeRedeemCode(id));
    }
    if(!ok){toast('卡密操作失败');return}
    toast('卡密已更新');
    renderSubscriptionPlans();
  }
  function handleRedeemCodePage(action){
    const sub=window.KGSubscription;if(!sub||typeof sub.redeemCodeList!=='function')return;
    const total=Math.max(1,Math.ceil(sub.redeemCodeList({}).length/REDEEM_CODE_PAGE_SIZE));
    if(action==='first')redeemCodePage=1;
    else if(action==='prev')redeemCodePage=Math.max(1,redeemCodePage-1);
    else if(action==='next')redeemCodePage=Math.min(total,redeemCodePage+1);
    else if(action==='last')redeemCodePage=total;
    renderSubscriptionPlans();
  }

  function handleSubscriptionOrderAction(btn){
    const sub=window.KGSubscription;if(!sub)return;
    const item=btn.closest('[data-order-id]');
    const id=item&&item.dataset.orderId;
    if(!id)return;
    let result=null;
    if(btn.dataset.orderAction==='approve'){
      if(!confirm('确认开通该学员的订阅申请？'))return;
      result=typeof sub.approveOrder==='function'?sub.approveOrder(id,{note:'管理员在系统设置中确认开通'}):null;
    }else if(btn.dataset.orderAction==='cancel'){
      const note=prompt('请输入取消原因（可选）：','')||'';
      result=typeof sub.cancelOrder==='function'?sub.cancelOrder(id,{note}):null;
    }
    if(!result||!result.ok){toast(result&&result.message||'订阅申请处理失败');return}
    toast(result.message||'订阅申请已处理');
    renderSubscriptionPlans();
    renderLogs();
    if(window.KGSubscription&&typeof window.KGSubscription.decorateSubscriptionElements==='function')window.KGSubscription.decorateSubscriptionElements();
    if(window.KGUserCenter&&typeof window.KGUserCenter.refresh==='function')window.KGUserCenter.refresh();
  }

  function renderSubscriptionPlans(){
    const panel=$('ssSubscriptionPanel');
    if(!panel)return;
    const sub=window.KGSubscription;
    if(!sub){
      panel.innerHTML='<div class="um-empty">订阅权益模块未加载。</div>';
      return;
    }
    const plans=typeof sub.planList==='function' ? sub.planList({includeDisabled:true}) : Object.values(sub.PLANS||{}).sort((a,b)=>(a.level||0)-(b.level||0));
    panel.innerHTML=`<div class="subscription-admin-toolbar">
      <div>
        <strong>订阅套餐配置</strong>
        <p>套餐价格、订单和订阅状态统一保存到服务器；价格填写原价和折扣系数，现价会自动计算。</p>
      </div>
      <button type="button" id="ssResetAllPlanSettingsBtn">恢复全部默认</button>
    </div>
    <div class="subscription-plan-grid subscription-admin-grid">
      ${plans.map(plan=>{
        const enabledFeatures=typeof sub.planBenefitItems==='function'
          ? sub.planBenefitItems(plan)
          : Object.entries(plan.features||{}).filter(([,on])=>!!on).map(([key])=>(sub.FEATURE_LABELS&&sub.FEATURE_LABELS[key])||key);
        const limitSummary=typeof sub.planUsageText==='function'
          ? sub.planUsageText(plan)
          : Object.entries(plan.limits||{}).map(([key,value])=>{
            const label={dailyTraining:'每日训练',recallMaps:'回忆图谱',importPackages:'学习包导入',exportPackages:'学习包导出'}[key]||key;
            const text=Number(value)===-1?'不限':String(value);
            return `${label}：${text}`;
          }).join(' · ');
        return `<article class="subscription-plan-card subscription-admin-card${plan.recommended?' recommended':''}" data-plan-id="${escapeHTML(plan.id)}">
          <div class="subscription-plan-head">
            <h3>${escapeHTML(plan.name)}</h3>
            <span>${escapeHTML(plan.badgeText||plan.shortName||'套餐')}</span>
          </div>
          <div class="subscription-admin-price-preview">
            <strong>${escapeHTML(plan.priceText||'待配置')}</strong>
            ${plan.originalPriceText?`<del>${escapeHTML(plan.originalPriceText)}</del>`:''}
            ${plan.discountText?`<span class="subscription-discount-badge">${escapeHTML(plan.discountText)}</span>`:''}
          </div>
          <div class="subscription-admin-switches">
            <label><input type="checkbox" data-plan-field="enabled" ${plan.enabled!==false?'checked':''}> 启用展示</label>
            <label><input type="checkbox" data-plan-field="recommended" ${plan.recommended?'checked':''}> 推荐套餐</label>
          </div>
          <div class="subscription-admin-fields">
            <label>套餐名称<input data-plan-field="name" value="${escapeHTML(plan.name||'')}"></label>
            <label>短名称<input data-plan-field="shortName" value="${escapeHTML(plan.shortName||'')}"></label>
            <label>原价<input data-plan-field="originalPriceText" value="${escapeHTML(plan.originalPriceText||'')}" placeholder="例如：¥129 / 季"></label>
            <label>折扣系数（%）<input data-plan-field="discountPercent" type="number" min="0" max="100" step="1" value="${escapeHTML(plan.discountPercent||'')}" placeholder="例如：80 表示 8 折"></label>
            <label>标签文案<input data-plan-field="badgeText" value="${escapeHTML(plan.badgeText||'')}"></label>
            <label class="full">权益说明<textarea data-plan-field="description" rows="3">${escapeHTML(plan.description||'')}</textarea></label>
            <label class="full">权益展示文字（每行一条，仅影响展示）<textarea data-plan-field="benefitText" rows="5" placeholder="不填写则按底层权益自动生成">${escapeHTML(plan.benefitText||'')}</textarea></label>
            <label class="full">每日训练 / 用量展示文案（仅影响展示）<textarea data-plan-field="usageText" rows="2" placeholder="不填写则按用量限制自动生成">${escapeHTML(plan.usageText||'')}</textarea></label>
          </div>
          <p class="subscription-duration">有效期：${escapeHTML(plan.durationText||'')}</p>
          <ul>
            ${enabledFeatures.map(item=>`<li>${escapeHTML(item)}</li>`).join('')}
          </ul>
          ${limitSummary?`<div class="subscription-limit-note">${escapeHTML(limitSummary)}</div>`:''}
          <div class="subscription-admin-actions">
            <button type="button" class="primary" data-plan-action="save">保存套餐</button>
            <button type="button" data-plan-action="reset">恢复默认</button>
          </div>
        </article>`;
      }).join('')}
    </div>
    ${renderSubscriptionOrdersMarkup(sub)}
    ${renderRedeemCodeAdminMarkup(sub)}
    <div class="subscription-policy-note">
      <strong>订阅边界：</strong>
      管理员和教师/教研不受订阅限制；订阅仅用于学员角色。游客不进入订阅体系，只用于公开示例和体验入口。当前套餐模型为 <code>free</code>、<code>monthly</code>、<code>quarterly</code>、<code>half_year</code>、<code>lifetime</code>。
    </div>`;
  }
  function collectPlanSettings(card){
    const patch={};
    if(!card)return patch;
    card.querySelectorAll('[data-plan-field]').forEach(el=>{
      const key=el.dataset.planField;
      if(!key)return;
      if(el.type==='checkbox')patch[key]=!!el.checked;
      else patch[key]=el.value;
    });
    return patch;
  }
  function savePlanSettingsFromCard(card){
    const sub=window.KGSubscription;if(!sub||typeof sub.setPlanSettings!=='function')return;
    const id=card&&card.dataset.planId;if(!id)return;
    const patch=collectPlanSettings(card);
    sub.setPlanSettings(id,patch);
    logAction('保存订阅套餐配置','SYSTEM',`${id} 套餐配置已更新`);
    renderSubscriptionPlans();
    toast('订阅套餐已保存');
  }
  function resetPlanSettingsFromCard(card){
    const sub=window.KGSubscription;if(!sub||typeof sub.resetPlanSettings!=='function')return;
    const id=card&&card.dataset.planId;if(!id)return;
    sub.resetPlanSettings(id);
    logAction('恢复订阅套餐默认','SYSTEM',`${id} 套餐恢复默认配置`);
    renderSubscriptionPlans();
    toast('已恢复该套餐默认配置');
  }
  function resetAllPlanSettings(){
    const sub=window.KGSubscription;if(!sub||typeof sub.savePlanSettings!=='function')return;
    if(!confirm('确认恢复全部订阅套餐默认配置？'))return;
    sub.savePlanSettings({});
    logAction('恢复全部订阅套餐默认','SYSTEM','全部套餐恢复默认配置');
    renderSubscriptionPlans();
    toast('全部套餐已恢复默认');
  }

  function renderLogs(){
    const panel=$('ssLogList');
    if(!panel)return;
    const logs=readJSON(USER_LOG_KEY,[]).slice(0,80);
    if(!logs.length){panel.innerHTML='<div class="um-empty">暂无系统操作日志。</div>';return}
    panel.innerHTML=logs.map(log=>`<div class="um-log-item"><strong>${escapeHTML(log.action)} · ${escapeHTML(log.username||'系统')}</strong><span>${fmtTime(log.at)} · 操作者：${escapeHTML(log.actor||'system-admin')}</span>${log.detail?`<span>${escapeHTML(log.detail)}</span>`:''}</div>`).join('');
  }
  function clearLogs(){
    if(!confirm('确认清空系统操作日志？'))return;
    writeJSON(USER_LOG_KEY,[]);
    renderLogs();
    toast('日志已清空');
  }

  const ANALYTICS_FEATURE_LABELS={graph:'图谱编辑',files:'文件管理',question_bank:'题库',training:'训练',recall:'回忆',learning_path:'学习路径'};
  const ANALYTICS_OUTCOME_NOTES={graph:'保存图谱',files:'保存文件库',question_bank:'保存题库 / 题目',training:'提交答题',recall:'保存回忆',learning_path:'完成节点 / 测试'};
  let analyticsAutoLoaded=false;
  function fmtAnalyticsDate(daysAgo){
    const d=new Date();
    d.setDate(d.getDate()-daysAgo);
    const mm=String(d.getMonth()+1).padStart(2,'0');
    const dd=String(d.getDate()).padStart(2,'0');
    return d.getFullYear()+'-'+mm+'-'+dd;
  }
  function initAnalyticsControls(){
    const start=$('ssAnalyticsStart'),end=$('ssAnalyticsEnd');
    if(start&&!start.value)start.value=fmtAnalyticsDate(29);
    if(end&&!end.value)end.value=fmtAnalyticsDate(0);
  }
  async function loadFeatureAnalytics(){
    const content=$('ssAnalyticsContent');
    if(!content)return;
    const start=$('ssAnalyticsStart'),end=$('ssAnalyticsEnd'),role=$('ssAnalyticsRole');
    const startValue=(start&&start.value)||'',endValue=(end&&end.value)||'';
    if(!startValue||!endValue){content.innerHTML='<div class="um-empty">请选择开始与结束日期。</div>';return}
    if(startValue>endValue){content.innerHTML='<div class="um-empty">开始日期不能晚于结束日期。</div>';return}
    content.innerHTML='<div class="um-empty">正在加载汇总数据…</div>';
    let data;
    try{
      const params=new URLSearchParams({start:startValue,end:endValue});
      if(role&&role.value)params.set('role',role.value);
      const response=await fetch('/api/v1/system/feature-analytics?'+params.toString(),{credentials:'include'});
      if(!response.ok)throw new Error('加载失败 ('+response.status+')');
      data=await response.json();
    }catch(error){
      content.innerHTML='<div class="um-empty">汇总数据加载失败，请稍后重试。</div>';
      return;
    }
    renderFeatureAnalytics(content,data);
  }
  function renderFeatureAnalytics(content,data){
    const sampleSize=Number(data&&data.sampleSize||0);
    if(sampleSize===0){content.innerHTML='<div class="um-empty">所选区间暂无功能使用记录，发布后开始累计。</div>';return}
    const features=Array.isArray(data.features)?data.features:[];
    const totalActive=features.reduce((sum,f)=>sum+Number(f&&f.activeUsers||0),0);
    const totalKey=features.reduce((sum,f)=>sum+Number(f&&f.keyActions||0),0);
    const summary=[
      {label:'功能记录数',value:String(sampleSize)},
      {label:'活跃用户合计',value:String(totalActive)},
      {label:'关键操作次数',value:String(totalKey)},
    ];
    const maxActive=Math.max(1,...features.map(f=>Number(f&&f.activeUsers||0)));
    const rows=features.map(f=>{
      const active=Number(f&&f.activeUsers||0);
      const rate=Number(f&&f.outcomeUserRate||0);
      const pct=Math.round(rate*100);
      const width=Math.round(active/maxActive*100);
      const quality=(f&&f.quality&&f.quality.value!==null&&f.quality.value!==undefined)?Math.round(Number(f.quality.value)*100)+'%':'—';
      return '<tr><td>'+escapeHTML(ANALYTICS_FEATURE_LABELS[f.featureKey]||f.featureKey)+'</td>'
        +'<td>'+active+'</td><td>'+Number(f&&f.keyActions||0)+'</td><td>'+Number(f&&f.engagedSeconds||0)+'</td>'
        +'<td><span class="ss-analytics-bubble" style="--w:'+width+'%"></span><span>'+pct+'%</span></td>'
        +'<td>'+quality+'</td><td>'+escapeHTML(ANALYTICS_OUTCOME_NOTES[f.featureKey]||'')+'</td></tr>';
    }).join('');
    const trends=(Array.isArray(data.trends)&&data.trends.length)?data.trends.map(t=>'<li><span>'+escapeHTML(t.date||'')+'</span><span>事件 '+Number(t.events||0)+'</span><span>活跃 '+Number(t.activeUsers||0)+'</span></li>').join(''):'<li class="um-empty">暂无每日趋势。</li>';
    const insights=(Array.isArray(data.insights)&&data.insights.length)?data.insights.map(i=>'<li><strong>'+escapeHTML(i.title||'')+'</strong><span>'+escapeHTML(i.detail||'')+'</span></li>').join(''):'<li class="um-empty">暂无洞察。</li>';
    content.innerHTML='<div class="ss-analytics-summary">'+summary.map(s=>'<div><strong>'+escapeHTML(s.value)+'</strong><span>'+escapeHTML(s.label)+'</span></div>').join('')+'</div>'
      +'<div class="ss-analytics-table-wrap"><table class="ss-analytics-table"><thead><tr><th>功能</th><th>活跃用户</th><th>关键操作</th><th>停留秒数</th><th>成果用户率</th><th>质量</th><th>成果定义</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
      +'<div class="ss-analytics-trends"><h3>每日趋势</h3><ul>'+trends+'</ul></div>'
      +'<div class="ss-analytics-insights"><h3>洞察</h3><ul>'+insights+'</ul></div>';
  }

  function setTab(tab){
    const next=tab||'themes';
    document.querySelectorAll('[data-ss-tab]').forEach(btn=>btn.classList.toggle('active',btn.dataset.ssTab===next));
    document.querySelectorAll('[data-ss-panel]').forEach(panel=>panel.classList.toggle('active',panel.dataset.ssPanel===next));
    if(next==='analytics'){initAnalyticsControls();if(!analyticsAutoLoaded){analyticsAutoLoaded=true;loadFeatureAnalytics();}}
  }
  function bindEvents(){
    document.querySelectorAll('[data-ss-tab]').forEach(btn=>btn.addEventListener('click',()=>setTab(btn.dataset.ssTab)));
    const themePanel=$('ssRoleThemePanel');
    if(themePanel){
      themePanel.addEventListener('click',event=>{
        const save=event.target.closest('[data-save-theme]');
        const reset=event.target.closest('[data-reset-theme]');
        if(save)saveRoleTheme(save.dataset.saveTheme);
        if(reset)resetRoleTheme(reset.dataset.resetTheme);
      });
      themePanel.addEventListener('input',event=>{
        const input=event.target.closest('[data-theme-field]');
        if(!input)return;
        const card=input.closest('.um-role-theme');
        if(!card)return;
        const theme=collectRoleTheme(card);
        card.style.setProperty('--theme',theme.primary||'#2563eb');
        card.style.setProperty('--theme-accent',theme.accent||'#7c3aed');
        card.style.setProperty('--theme-soft',theme.soft||'#f8fafc');
        const dot=card.querySelector('.um-role-dot');
        if(dot&&theme.primary)dot.style.background=theme.primary;
      });
    }
        const wechatPanel=$('ssWechatConfigPanel');
        if(wechatPanel)wechatPanel.addEventListener('click',event=>{
          if(event.target.closest('#wxSaveConfigBtn'))saveWechatConfig();
        });
    const subscriptionPanel=$('ssSubscriptionPanel');
    if(subscriptionPanel)subscriptionPanel.addEventListener('click',event=>{
      const resetAll=event.target.closest('#ssResetAllPlanSettingsBtn');
      if(resetAll){resetAllPlanSettings();return}
      const generateCodes=event.target.closest('#ssGenerateRedeemCodesBtn');
      if(generateCodes){handleRedeemCodeGenerate();return}
      const codePage=event.target.closest('[data-code-page]');
      if(codePage){handleRedeemCodePage(codePage.dataset.codePage);return}
      const codeBtn=event.target.closest('[data-code-action]');
      if(codeBtn){handleRedeemCodeAction(codeBtn);return}
      const orderBtn=event.target.closest('[data-order-action]');
      if(orderBtn){handleSubscriptionOrderAction(orderBtn);return}
      const btn=event.target.closest('[data-plan-action]');
      if(!btn)return;
      const card=btn.closest('[data-plan-id]');
      if(btn.dataset.planAction==='save')savePlanSettingsFromCard(card);
      if(btn.dataset.planAction==='reset')resetPlanSettingsFromCard(card);
    });
    const clear=$('ssClearLogsBtn');
    if(clear)clear.addEventListener('click',clearLogs);
    const analyticsApply=$('ssAnalyticsApply');
    if(analyticsApply)analyticsApply.addEventListener('click',loadFeatureAnalytics);
  }
  function render(){
    renderRoleThemes();
    renderWechatConfig();
    renderPermissionMatrix();
    renderSubscriptionPlans();
    renderLogs();
  }

  document.addEventListener('DOMContentLoaded',()=>{
    if(!ensureAccess())return;
    bindEvents();
    render();
    initAnalyticsControls();
    window.addEventListener('kg-subscription-plan-change',()=>renderSubscriptionPlans());
    window.addEventListener('kg-subscription-order-change',()=>renderSubscriptionPlans());
    window.addEventListener('kg-subscription-redeem-code-change',()=>renderSubscriptionPlans());
  });
})();
