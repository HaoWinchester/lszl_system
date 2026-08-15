'use strict';

(function(){
  const Auth=window.KGAuthCore;
  const UserService=window.KGUserAdminService;
  if(!Auth || !UserService){
    console.error('[UserManagement] KGAuthCore 或 KGUserAdminService 未加载');
    return;
  }

  const USER_LOG_KEY=Auth.USER_LOG_KEY;
  const STORE_KEY='通用知识点关系图谱工具_多科目重点聚焦版_v2';
  const QUESTION_BANKS_PREFIX='kg_question_banks_v1__';
  const QUESTION_PAPERS_PREFIX='kg_exam_papers_v1__';
  const $=id=>document.getElementById(id);
  const state={users:{},selected:'',query:'',roleFilter:'ALL',statusFilter:'ALL',selectedUsers:new Set(),visibleUsernames:[],activeRightTab:'actions',rightCollapsed:false,userToolsExpanded:false,userPage:1,userPageSize:20};

  const cleanUsername=value=>Auth.cleanUsername(value);
  const escapeHTML=value=>Auth.escapeHTML(value);
  const fmtTime=value=>Auth.fmtTime(value);
  const readJSON=(key,fallback)=>Auth.readJSON(key,fallback);
  const writeJSON=(key,value)=>Auth.writeJSON(key,value);
  const logAction=(action,username,detail='')=>Auth.logAction(action,username,detail);

  function refreshAuthDependentUi(){
    const api=window.KGRolePermissions;
    if(api){
      if(typeof api.applyTheme==='function')api.applyTheme();
      const status=$('authStatus');
      if(status&&typeof api.renderStatus==='function')api.renderStatus(status);
      if(typeof api.decoratePermissionElements==='function')api.decoratePermissionElements();
    }
    if(window.KGSubscription&&typeof window.KGSubscription.decorateSubscriptionElements==='function')window.KGSubscription.decorateSubscriptionElements();
    if(window.KGGlobalShortcuts&&typeof window.KGGlobalShortcuts.render==='function')window.KGGlobalShortcuts.render();
    if(window.KGUserCenter&&typeof window.KGUserCenter.refresh==='function')window.KGUserCenter.refresh();
  }
  function loadUsers(){
    state.users=UserService.loadUsers();
    UserService.persist(state.users,{silent:true});
    if(!state.selected || !state.users[state.selected]) state.selected=Object.keys(state.users)[0]||'';
  }
  function saveUsers(renderAfter=true,options={}){
    const result=UserService.persist(state.users,{
      silent:!!options.silent,
      detail:{selected:state.selected,...(options.detail||{})}
    });
    if(!result.ok){
      toast(result.message||'用户数据保存失败');
      return false;
    }
    state.users=result.users;
    if(!options.silent)refreshAuthDependentUi();
    if(renderAfter)render();
    return true;
  }
  function userQuestionScope(username){return 'user__'+encodeURIComponent(username)}
  function graphKey(username){return STORE_KEY+'__user__'+encodeURIComponent(String(username||'').trim().toLowerCase())}
  function userDataStats(username){
    const graph=readJSON(graphKey(username),null);
    const banks=readJSON(QUESTION_BANKS_PREFIX+userQuestionScope(username),[]);
    const papers=readJSON(QUESTION_PAPERS_PREFIX+userQuestionScope(username),[]);
    const questionCount=Array.isArray(banks)?banks.reduce((sum,b)=>sum+(Array.isArray(b.questions)?b.questions.length:0),0):0;
    return {
      graphNodes: graph&&Array.isArray(graph.nodes)?graph.nodes.length:0,
      graphLinks: graph&&Array.isArray(graph.links)?graph.links.length:0,
      banks: Array.isArray(banks)?banks.length:0,
      questions: questionCount,
      papers: Array.isArray(papers)?papers.length:0,
      hasGraph: !!graph
    };
  }
  function roleLabel(role){return window.KGRolePermissions?window.KGRolePermissions.roleLabel(role):({admin:'管理员',teacher:'教师/教研',student:'学员',viewer:'游客'}[role]||role||'学员')}
  function statusLabel(status){return {active:'正常',paused:'暂停',archived:'已归档'}[status]||status||'正常'}
  function subApi(){return window.KGSubscription||null}
  function dateInputValue(ts){
    const sub=subApi();
    if(sub&&typeof sub.dateInputValue==='function')return sub.dateInputValue(ts);
    const n=Number(ts)||0;if(!n)return '';
    return new Date(n-new Date(n).getTimezoneOffset()*60000).toISOString().slice(0,10);
  }
  function dateInputToTime(value,endOfDay=false){
    const sub=subApi();
    if(sub&&typeof sub.dateInputToTime==='function')return sub.dateInputToTime(value,endOfDay);
    if(!value)return 0;
    const t=new Date(String(value)+(endOfDay?'T23:59:59':'T00:00:00')).getTime();
    return Number.isFinite(t)?t:0;
  }
  function subscriptionStatusLabel(status){
    const sub=subApi();
    return sub&&typeof sub.statusLabel==='function'?sub.statusLabel(status):({active:'有效',expired:'已过期',paused:'已停用',cancelled:'已取消',trial:'试用中',manual:'手动开通'}[status]||status||'有效');
  }
  function subscriptionPlanOptions(selectedPlan){
    const sub=subApi();
    const plans=sub&&typeof sub.planList==='function'?sub.planList({includeDisabled:true}):[];
    return plans.map(plan=>`<option value="${escapeHTML(plan.id)}" ${plan.id===selectedPlan?'selected':''}>${escapeHTML(plan.name)}${plan.enabled===false?'（停用展示）':''}</option>`).join('');
  }
  function selectedUsernames(){
    return Array.from(state.selectedUsers||[]).filter(username=>!!state.users[username]);
  }
  function syncSelectedUsers(){
    selectedUsernames().forEach(username=>state.selectedUsers.add(username));
    Array.from(state.selectedUsers||[]).forEach(username=>{if(!state.users[username])state.selectedUsers.delete(username)});
  }
  function renderBatchState(rows){
    syncSelectedUsers();
    const visible=(rows||[]).map(([username])=>username);
    state.visibleUsernames=visible;
    const selectedCount=selectedUsernames().length;
    const visibleSelected=visible.filter(username=>state.selectedUsers.has(username)).length;
    const all=$('umSelectAllUsers');
    if(all){
      all.checked=visible.length>0 && visibleSelected===visible.length;
      all.indeterminate=visibleSelected>0 && visibleSelected<visible.length;
      all.disabled=!visible.length;
    }
    const count=$('umSelectedCount');
    if(count)count.textContent=`已选 ${selectedCount} 人`;
    ['umBatchApplyBtn','umBatchExportBtn','umBatchClearBtn','umBatchDeleteBtn'].forEach(id=>{const el=$(id);if(el)el.disabled=selectedCount===0});
  }
  function renderUserToolsState(totalRows=0){
    const panel=$('umListTools'),toggle=$('umListToolsToggle'),summary=$('umListToolsSummary'),left=document.querySelector('.um-left-card');
    const selectedCount=selectedUsernames().length;
    const filters=[];
    if(state.query.trim())filters.push(`搜索“${state.query.trim()}”`);
    if(state.roleFilter!=='ALL')filters.push(`角色：${roleLabel(state.roleFilter)}`);
    if(state.statusFilter!=='ALL')filters.push(`状态：${statusLabel(state.statusFilter)}`);
    const expanded=!!state.userToolsExpanded;
    if(panel)panel.hidden=!expanded;
    if(left)left.classList.toggle('tools-expanded',expanded);
    if(toggle){
      toggle.textContent=expanded?'收起筛选':'筛选/批量';
      toggle.setAttribute('aria-expanded',String(expanded));
      toggle.classList.toggle('active',expanded || filters.length>0 || selectedCount>0);
    }
    if(summary){
      const parts=[];
      if(filters.length)parts.push(filters.join(' · '));
      if(selectedCount)parts.push(`已选 ${selectedCount} 人`);
      if(!parts.length)parts.push(expanded?'可搜索、筛选或批量管理用户':'筛选与批量操作已收起');
      const hasActive=filters.length>0 || selectedCount>0;
      summary.textContent=`${parts.join(' · ')} · 当前匹配 ${totalRows} 人`;
      summary.classList.toggle('active',hasActive);
      summary.hidden=!expanded && !hasActive;
    }
  }
  function clampUserPage(totalRows){
    const size=Math.max(1,Number(state.userPageSize||20));
    const totalPages=Math.max(1,Math.ceil(totalRows/size));
    state.userPage=Math.min(Math.max(1,Number(state.userPage||1)),totalPages);
    return totalPages;
  }
  function renderUserPagination(totalRows,totalPages){
    const wrap=$('umPagination');
    if(!wrap)return;
    const size=Math.max(1,Number(state.userPageSize||20));
    const start=totalRows?((state.userPage-1)*size+1):0;
    const end=Math.min(totalRows,state.userPage*size);
    const info=$('umPageInfo');
    if(info)info.textContent=totalRows?`第 ${state.userPage} / ${totalPages} 页 · ${start}-${end} / ${totalRows} 人`:'暂无用户';
    const prev=$('umPrevPageBtn');
    const next=$('umNextPageBtn');
    if(prev)prev.disabled=state.userPage<=1 || totalRows===0;
    if(next)next.disabled=state.userPage>=totalPages || totalRows===0;
    const sizeSelect=$('umPageSizeSelect');
    if(sizeSelect && String(sizeSelect.value)!==String(size))sizeSelect.value=String(size);
  }
  function filteredUsers(){
    const q=state.query.trim().toLowerCase();
    return Object.entries(state.users).filter(([username,u])=>{
      if(state.roleFilter!=='ALL' && u.role!==state.roleFilter)return false;
      if(state.statusFilter!=='ALL' && u.status!==state.statusFilter)return false;
      if(!q)return true;
      const hay=[username,u.displayName,u.email,u.phone,u.subject,(u.tags||[]).join(','),u.note].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  function renderSummary(){
    const entries=Object.entries(state.users);
    const active=entries.filter(([,u])=>u.status==='active').length;
    const archived=entries.filter(([,u])=>u.status==='archived').length;
    const admins=entries.filter(([,u])=>u.role==='admin').length;
    const totalQuestions=entries.reduce((sum,[name])=>sum+userDataStats(name).questions,0);
    $('umSummary').innerHTML=`
      <article class="um-stat"><span>账号总数</span><strong>${entries.length}</strong><em>服务器账号库</em></article>
      <article class="um-stat"><span>正常用户</span><strong>${active}</strong><em>可登录使用</em></article>
      <article class="um-stat"><span>已归档</span><strong>${archived}</strong><em>保留资料，不允许登录</em></article>
      <article class="um-stat"><span>题目总量</span><strong>${totalQuestions}</strong><em>统计各账号题库</em></article>`;
    $('umScopeInfo').textContent=`${entries.length} 个账号 · ${admins} 个管理员角色`;
  }
  function renderUserList(){
    const rows=filteredUsers();
    const totalPages=clampUserPage(rows.length);
    const size=Math.max(1,Number(state.userPageSize||20));
    const pageRows=rows.slice((state.userPage-1)*size,state.userPage*size);
    renderBatchState(pageRows);
    renderUserToolsState(rows.length);
    renderUserPagination(rows.length,totalPages);
    if(!rows.length){$('umUserList').innerHTML='<div class="um-empty">没有匹配的用户。可点击“+ 新用户”创建账号。</div>';return}
    $('umUserList').innerHTML=pageRows.map(([username,u],pageIndex)=>{
      const stats=userDataStats(username);
      const checked=state.selectedUsers.has(username);
      const order=(state.userPage-1)*size+pageIndex+1;
      const title=escapeHTML(u.displayName||username);
      const role=roleLabel(u.role);
      const status=statusLabel(u.status);
      const subject=escapeHTML(u.subject||'PMP');
      const sub=u.subscription&&typeof u.subscription==='object'?u.subscription:null;
      const subBadges=sub&&sub.planId&&sub.planId!=='free'
        ?`<span class="um-pill plan" title="当前套餐：${escapeHTML(sub.planName||sub.planId)}${sub.expiresAt?' · 至 '+fmtTime(Date.parse(sub.expiresAt)):''}">${escapeHTML(sub.planName||sub.planId)}</span>`
          +(sub.paid?'<span class="um-pill paid" title="存在已支付订单或微信支付开通">已付款</span>':'<span class="um-pill unpaid" title="套餐由兑换码或管理员开通，无线上付款记录">未在线付款</span>')
        :'';
      return `<div class="um-user-item compact ${username===state.selected?'active':''} ${checked?'selected':''}" data-user="${escapeHTML(username)}" role="button" tabindex="0" title="@${escapeHTML(username)} · ${escapeHTML(role)} · ${subject} · ${stats.questions} 题" aria-label="选择用户 ${escapeHTML(username)}，${escapeHTML(role)}，${status}">
        <label class="um-user-check" title="加入批量选择">
          <input class="um-user-checkbox" data-select-user="${escapeHTML(username)}" type="checkbox" ${checked?'checked':''}/>
          <span></span>
        </label>
        <span class="um-user-order">${order}</span>
        <div class="um-user-main">
          <div class="um-user-title">
            <strong>${title}</strong>
            <span class="um-pill ${escapeHTML(u.status)}">${status}</span>
          </div>
          <div class="um-user-compact-meta">
            <span>${escapeHTML(role)}</span>
            <span>${subject}</span>
            <span>${stats.questions} 题</span>
          </div>
          ${subBadges?`<div class="um-user-compact-meta um-sub-meta">${subBadges}</div>`:''}
        </div>
      </div>`;
    }).join('');
  }
  function renderForm(){
    const username=state.selected;
    const u=username?state.users[username]:null;
    const disabled=!u;
    ['umDisplayName','umRole','umStatus','umEmail','umPhone','umSubject','umTags','umNote','umSaveUserBtn','umResetPasswordBtn','umArchiveUserBtn','umRestoreUserBtn','umDeleteUserBtn','umSetActiveBtn','umSetPausedBtn','umDuplicateUserBtn','umExportSelectedBtn'].forEach(id=>{const el=$(id);if(el)el.disabled=disabled});
    if(!u){
      $('umEditorTitle').textContent='用户资料';$('umEditorSubtitle').textContent='暂无用户，请先创建。';$('umSaveState').textContent='未选择';
      ['umUsername','umDisplayName','umEmail','umPhone','umTags','umNote'].forEach(id=>$(id).value='');
      $('umRole').value='student';$('umStatus').value='active';$('umSubject').value='PMP';
      const subCard=$('umSubscriptionCard');if(subCard){subCard.innerHTML='';subCard.hidden=true}
      $('umDataCard').innerHTML='<div class="um-empty">选择用户后可查看该用户题库、试卷和图谱数据概览。</div>';
      return;
    }
    $('umEditorTitle').textContent=u.displayName||username;
    $('umEditorSubtitle').textContent=`@${username} · 创建于 ${fmtTime(u.createdAt)}`;
    $('umSaveState').textContent='已加载';$('umSaveState').className='um-save-state saved';
    $('umUsername').value=username;$('umDisplayName').value=u.displayName||username;$('umRole').value=u.role||'student';$('umStatus').value=u.status||'active';$('umEmail').value=u.email||'';$('umPhone').value=u.phone||'';$('umSubject').value=u.subject||'PMP';$('umTags').value=(u.tags||[]).join(', ');$('umNote').value=u.note||'';
    renderSubscriptionCard(username,u);
    const stats=userDataStats(username);
    $('umDataCard').innerHTML=`<div class="um-card-head small"><div><h2>用户数据概览</h2><p>统计当前账号在服务器保存的题库、试卷与图谱数据。</p></div></div>
      <div class="um-data-grid">
        <div class="um-data-item"><span>图谱节点</span><strong>${stats.graphNodes}</strong></div>
        <div class="um-data-item"><span>关系线</span><strong>${stats.graphLinks}</strong></div>
        <div class="um-data-item"><span>题库</span><strong>${stats.banks}</strong></div>
        <div class="um-data-item"><span>题目</span><strong>${stats.questions}</strong></div>
        <div class="um-data-item"><span>试卷</span><strong>${stats.papers}</strong></div>
        <div class="um-data-item"><span>最近登录</span><strong style="font-size:13px">${fmtTime(u.lastLoginAt)}</strong></div>
        <div class="um-data-item"><span>最近活跃</span><strong style="font-size:13px">${fmtTime(u.lastActiveAt)}</strong></div>
        <div class="um-data-item"><span>更新时间</span><strong style="font-size:13px">${fmtTime(u.updatedAt)}</strong></div>
      </div>`;
  }
  function renderLogs(){
    const logs=readJSON(USER_LOG_KEY,[]).slice(0,60);
    if(!logs.length){$('umLogList').innerHTML='<div class="um-empty">暂无操作日志。</div>';return}
    $('umLogList').innerHTML=logs.map(log=>`<div class="um-log-item"><strong>${escapeHTML(log.action)} · ${escapeHTML(log.username||'系统')}</strong><span>${fmtTime(log.at)} · 操作者：${escapeHTML(log.actor||'local-admin')}</span>${log.detail?`<span>${escapeHTML(log.detail)}</span>`:''}</div>`).join('');
  }

  function renderSubscriptionCard(username,u){
    const card=$('umSubscriptionCard');
    if(!card)return;
    const sub=subApi();
    if(!username||!u){card.innerHTML='';card.hidden=true;return}
    card.hidden=false;
    if(!sub){card.innerHTML='<div class="um-empty">订阅模块未加载。</div>';return}
    if((u.role||'student')!=='student'){
      card.innerHTML=`<div class="um-card-head small"><div><h2>学员订阅</h2><p>当前用户是 ${escapeHTML(roleLabel(u.role))}，不进入学员订阅体系。</p></div></div>`;
      return;
    }
    const summary=typeof sub.subscriptionSummary==='function'?sub.subscriptionSummary(username):null;
    const record=summary&&summary.subscription || (sub.subscriptionFor?sub.subscriptionFor(username):null) || {};
    const plan=summary&&summary.plan || (sub.planById?sub.planById(record.planId||'free'):{id:'free',name:'免费学员'});
    const expiresText=summary&&summary.expiresText || '长期有效';
    const statusText=summary&&summary.statusText || subscriptionStatusLabel(record.status||'active');
    card.innerHTML=`<div class="um-card-head small">
      <div><h2>学员订阅</h2><p>管理员可在当前本地版本手动开通、续期或停用学员订阅。</p></div>
      <span class="subscription-badge">${escapeHTML(plan.name||'免费学员')} · ${escapeHTML(statusText)}</span>
    </div>
    <div class="um-subscription-summary">
      <span>到期：${escapeHTML(expiresText)}</span>
      <span>来源：${escapeHTML(record.source||'default')}</span>
      <span>更新：${escapeHTML(fmtTime(record.updatedAt))}</span>
    </div>
    <div class="um-subscription-grid">
      <label class="um-field compact"><span>套餐</span><select id="umSubPlan">${subscriptionPlanOptions(record.planId||'free')}</select></label>
      <label class="um-field compact"><span>状态</span><select id="umSubStatus">
        ${['active','paused','expired','cancelled','trial','manual'].map(st=>`<option value="${st}" ${st===(record.status||'active')?'selected':''}>${subscriptionStatusLabel(st)}</option>`).join('')}
      </select></label>
      <label class="um-field compact"><span>开始日期</span><input id="umSubStart" type="date" value="${escapeHTML(dateInputValue(record.startedAt||Date.now()))}"></label>
      <label class="um-field compact"><span>到期日期</span><input id="umSubExpires" type="date" value="${escapeHTML(dateInputValue(record.expiresAt||0))}" placeholder="终身/免费可留空"></label>
      <label class="um-field compact full"><span>订阅备注</span><input id="umSubNote" value="${escapeHTML(record.note||'')}" placeholder="例如：线下收款、内测赠送、订单号等"></label>
    </div>
    <div class="um-subscription-actions">
      <button type="button" class="primary" data-sub-action="save">保存订阅</button>
      <button type="button" data-sub-action="renew">按套餐续期/开通</button>
      <button type="button" data-sub-action="free">设为免费</button>
      <button type="button" class="danger" data-sub-action="pause">停用订阅</button>
    </div>`;
  }
  function saveSubscriptionExact(){
    const username=state.selected;if(!username||!state.users[username])return;
    const sub=subApi();if(!sub||typeof sub.setStudentSubscription!=='function'){toast('订阅模块未加载');return}
    if((state.users[username].role||'student')!=='student'){toast('仅学员角色需要订阅');return}
    const planId=$('umSubPlan')?.value||'free';
    const startedAt=dateInputToTime($('umSubStart')?.value,false)||Date.now();
    const expiresAt=dateInputToTime($('umSubExpires')?.value,true);
    const record=sub.setStudentSubscription(username,{
      planId,
      status:$('umSubStatus')?.value||'active',
      startedAt,
      expiresAt,
      source:'manual',
      note:$('umSubNote')?.value.trim()||''
    });
    logAction('保存学员订阅',username,`${sub.planById(record.planId).name} · ${sub.statusLabel(record.status)}`);
    refreshAuthDependentUi();renderForm();toast('学员订阅已保存');
  }
  function renewSubscription(){
    const username=state.selected;if(!username||!state.users[username])return;
    const sub=subApi();if(!sub||typeof sub.renewStudentSubscription!=='function'){toast('订阅模块未加载');return}
    if((state.users[username].role||'student')!=='student'){toast('仅学员角色需要订阅');return}
    const planId=$('umSubPlan')?.value||'monthly';
    const note=$('umSubNote')?.value.trim()||'管理员手动开通/续期';
    const record=sub.renewStudentSubscription(username,planId,{extend:true,note,source:'manual'});
    logAction('开通/续期学员订阅',username,`${sub.planById(record.planId).name} · 到期 ${record.expiresAt?fmtTime(record.expiresAt):'永久有效'}`);
    refreshAuthDependentUi();renderForm();toast('已按套餐开通/续期');
  }
  function pauseSubscription(){
    const username=state.selected;if(!username||!state.users[username])return;
    const sub=subApi();if(!sub||typeof sub.pauseStudentSubscription!=='function'){toast('订阅模块未加载');return}
    const note=$('umSubNote')?.value.trim()||'管理员手动停用';
    sub.pauseStudentSubscription(username,note);
    logAction('停用学员订阅',username,note);
    refreshAuthDependentUi();renderForm();toast('订阅已停用');
  }
  function freeSubscription(){
    const username=state.selected;if(!username||!state.users[username])return;
    const sub=subApi();if(!sub||typeof sub.activateFreeSubscription!=='function'){toast('订阅模块未加载');return}
    const note=$('umSubNote')?.value.trim()||'管理员设置为免费学员';
    sub.activateFreeSubscription(username,note);
    logAction('设置免费学员订阅',username,note);
    refreshAuthDependentUi();renderForm();toast('已设为免费学员');
  }

  function renderPermissionMatrix(){
    const panel=$('umPermissionMatrix');
    if(!panel)return;
    const api=window.KGRolePermissions;
    if(!api){panel.innerHTML='<div class="um-empty">权限模块未加载。</div>';return}
    panel.innerHTML=api.roleRows().map(row=>`<article class="um-permission-row">
      <strong>${escapeHTML(row.label)}</strong>
      <div>${row.permissions.map(p=>`<span>${escapeHTML(api.PERMISSION_LABELS[p]||p)}</span>`).join('')}</div>
    </article>`).join('');
  }
  function render(){renderSummary();renderUserList();renderForm();renderPermissionMatrix();renderLogs();applyRightPanelState()}
  function toast(text){const el=$('umToast');el.textContent=text;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),1800)}
  function collectForm(){
    const username=state.selected;
    if(!username||!state.users[username])return null;
    return {
      displayName:$('umDisplayName').value.trim()||username,
      role:$('umRole').value,
      status:$('umStatus').value,
      email:$('umEmail').value.trim(),
      phone:$('umPhone').value.trim(),
      subject:$('umSubject').value,
      tags:$('umTags').value.split(/[,，、;；|]/).map(s=>s.trim()).filter(Boolean),
      note:$('umNote').value.trim()
    };
  }
  function applyServiceResult(result,options={}){
    if(!result||!result.ok){toast(result&&result.message?result.message:'操作失败');return false}
    state.users=result.users;
    if(Object.prototype.hasOwnProperty.call(options,'selected'))state.selected=options.selected;
    if(!saveUsers(false,{detail:options.detail||{}}))return false;
    if(options.log)logAction(options.log.action,options.log.username,options.log.detail||'');
    if(options.render!==false)render();
    if(options.toast)toast(options.toast);
    return true;
  }
  function addUser(){
    const username=cleanUsername(prompt('请输入新用户名（至少 2 个字符）：')||'');
    if(username.length<2){toast('用户名至少 2 个字符');return}
    if(state.users[username]){toast('该用户名已存在');return}
    const password=prompt('请输入初始密码（至少 4 个字符）：')||'';
    const result=UserService.createUser(state.users,{username,password,user:{role:'student',status:'active',subject:'PMP',source:'user-management'}});
    applyServiceResult(result,{
      selected:result&&result.username?result.username:state.selected,
      detail:{action:'create',username},
      log:{action:'创建用户',username,detail:'通过用户管理页面创建'},
      toast:'已创建用户'
    });
  }
  function saveSelected(e){
    if(e)e.preventDefault();
    const username=state.selected;if(!username)return;
    const patch=collectForm();if(!patch)return;
    const result=UserService.updateUser(state.users,username,patch);
    applyServiceResult(result,{
      selected:username,
      detail:{action:'update',username},
      log:{action:'保存用户资料',username},
      toast:'已保存用户资料'
    });
  }
  function resetPassword(){
    const username=state.selected;if(!username)return;
    const password=prompt(`请输入 ${username} 的新密码（至少 4 个字符）：`);
    if(password===null)return;
    const result=UserService.resetPassword(state.users,username,password);
    applyServiceResult(result,{
      selected:username,
      detail:{action:'reset-password',username},
      log:{action:'重置密码',username},
      toast:'密码已重置'
    });
  }
  function setStatus(status){
    const username=state.selected;if(!username)return;
    const result=UserService.setStatus(state.users,username,status);
    applyServiceResult(result,{
      selected:username,
      detail:{action:'set-status',username,status},
      log:{action:status==='archived'?'归档用户':status==='paused'?'暂停用户':'恢复用户',username},
      toast:`已设置为：${statusLabel(status)}`
    });
  }
  function deleteUser(){
    const username=state.selected;if(!username)return;
    if(!confirm(`确认删除账号“${username}”？

这会移除账号资料，但不会主动清除该用户的本地图谱/题库数据。`))return;
    const result=UserService.deleteUsers(state.users,[username]);
    const nextSelected=result&&result.ok?Object.keys(result.users)[0]||'':state.selected;
    applyServiceResult(result,{
      selected:nextSelected,
      detail:{action:'delete',usernames:[username]},
      log:{action:'删除账号',username,detail:'保留本地学习数据键值'},
      toast:'账号已删除'
    });
  }
  function duplicateUser(){
    const username=state.selected;if(!username)return;
    const next=cleanUsername(prompt('请输入复制后的新用户名：',username+'_copy')||'');
    if(next.length<2||state.users[next]){toast('用户名无效或已存在');return}
    const password=prompt('请输入新用户初始密码（至少 4 个字符）：')||'';
    const result=UserService.duplicateUser(state.users,username,{username:next,password});
    applyServiceResult(result,{
      selected:result&&result.username?result.username:state.selected,
      detail:{action:'duplicate',username:next,sourceUsername:username},
      log:{action:'复制用户',username:next,detail:`来源：${username}`},
      toast:'已复制用户'
    });
  }

  function exportUsersPayload(users, filename, action, target){
    const payload=UserService.buildExportPayload(users);
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=filename+'.json';
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    logAction(action,target||'ALL',`导出 ${Object.keys(payload.users||{}).length} 个用户`);
    toast('已导出 JSON');
  }
  function batchApply(){
    const names=selectedUsernames();
    if(!names.length){toast('请先勾选用户');return}
    const role=$('umBatchRoleSelect')?$('umBatchRoleSelect').value:'KEEP';
    const status=$('umBatchStatusSelect')?$('umBatchStatusSelect').value:'KEEP';
    const subject=$('umBatchSubjectSelect')?$('umBatchSubjectSelect').value:'KEEP';
    if(role==='KEEP'&&status==='KEEP'&&subject==='KEEP'){toast('请选择要批量调整的字段');return}
    if(!confirm(`确认批量调整 ${names.length} 个用户？`))return;
    const result=UserService.batchUpdate(state.users,names,{role,status,subject});
    applyServiceResult(result,{
      detail:{action:'batch-update',usernames:names,role,status,subject},
      log:{action:'批量调整用户',username:'MULTI',detail:`影响 ${names.length} 人；角色=${role}；状态=${status}；科目=${subject}`},
      toast:`已批量调整 ${names.length} 个用户`
    });
  }
  function exportBatchUsers(){
    const names=selectedUsernames();
    if(!names.length){toast('请先勾选用户');return}
    const users=UserService.pickUsers(state.users,names);
    exportUsersPayload(users,`用户管理_所选${names.length}人`,'导出所选用户',names.join(','));
  }
  function clearBatchSelection(){
    state.selectedUsers.clear();
    renderUserList();
    toast('已清除批量选择');
  }
  function deleteBatchUsers(){
    const names=selectedUsernames();
    if(!names.length){toast('请先勾选用户');return}
    if(!confirm(`确认删除所选 ${names.length} 个账号？

这会移除账号资料，但不会主动清除这些用户的本地图谱/题库数据。`))return;
    const result=UserService.deleteUsers(state.users,names);
    const nextSelected=result&&result.ok&&result.users[state.selected]?state.selected:(result&&result.ok?Object.keys(result.users)[0]||'':state.selected);
    state.selectedUsers.clear();
    applyServiceResult(result,{
      selected:nextSelected,
      detail:{action:'batch-delete',usernames:names},
      log:{action:'批量删除用户',username:'MULTI',detail:`删除 ${names.length} 个账号：${names.join(', ')}`},
      toast:`已删除 ${names.length} 个账号`
    });
  }
  function toggleSelectAllVisible(checked){
    (state.visibleUsernames||[]).forEach(username=>{
      if(checked)state.selectedUsers.add(username);
      else state.selectedUsers.delete(username);
    });
    renderUserList();
  }
  function setRightTab(tab){
    state.activeRightTab=tab||'actions';
    document.querySelectorAll('[data-right-tab]').forEach(btn=>btn.classList.toggle('active',btn.dataset.rightTab===state.activeRightTab));
    document.querySelectorAll('[data-right-panel]').forEach(panel=>panel.classList.toggle('active',panel.dataset.rightPanel===state.activeRightTab));
  }
  function applyRightPanelState(){
    const card=$('umRightCard');
    const layout=document.querySelector('.um-layout');
    const btn=$('umRightCollapseBtn');
    if(card)card.classList.toggle('collapsed',!!state.rightCollapsed);
    if(layout)layout.classList.toggle('um-right-collapsed',!!state.rightCollapsed);
    if(btn){
      btn.textContent=state.rightCollapsed?'展开':'收起';
      btn.setAttribute('aria-expanded',String(!state.rightCollapsed));
      btn.title=state.rightCollapsed?'展开右侧辅助面板':'收起右侧辅助面板';
    }
    setRightTab(state.activeRightTab);
  }

  function exportData(selectedOnly=false){
    const users=selectedOnly&&state.selected?UserService.pickUsers(state.users,[state.selected]):state.users;
    exportUsersPayload(users,selectedOnly?`用户_${state.selected}`:'用户管理_全部用户',selectedOnly?'导出当前用户':'导出全部用户',selectedOnly?state.selected:'ALL');
  }
  async function importUsers(file){
    if(!file)return;
    try{
      const payload=JSON.parse(await file.text());
      const result=UserService.importUsers(state.users,payload,{overwrite:true});
      const selected=result&&result.ok&&result.users[state.selected]?state.selected:(result&&result.ok?Object.keys(result.users)[0]||'':state.selected);
      applyServiceResult(result,{
        selected,
        detail:{action:'import',count:result&&result.count||0,skipped:result&&result.skipped||0},
        log:{action:'导入用户',username:'ALL',detail:`导入 ${result&&result.count||0} 个用户${result&&result.skipped?`，跳过 ${result.skipped} 条`:''}`},
        toast:`已导入 ${result&&result.count||0} 个用户`
      });
    }catch(e){
      console.error(e);
      toast('导入失败：JSON 格式无效');
    }finally{
      $('umImportFile').value='';
    }
  }
  function bindEvents(){
    $('umAddUserBtn').onclick=addUser;$('umRefreshBtn').onclick=()=>{loadUsers();render();toast('已刷新')};$('umUserForm').addEventListener('submit',saveSelected);$('umResetPasswordBtn').onclick=resetPassword;$('umArchiveUserBtn').onclick=()=>setStatus('archived');$('umRestoreUserBtn').onclick=()=>setStatus('active');$('umDeleteUserBtn').onclick=deleteUser;$('umSetActiveBtn').onclick=()=>setStatus('active');$('umSetPausedBtn').onclick=()=>setStatus('paused');$('umDuplicateUserBtn').onclick=duplicateUser;$('umExportBtn').onclick=()=>exportData(false);$('umExportSelectedBtn').onclick=()=>exportData(true);$('umImportBtn').onclick=()=>$('umImportFile').click();$('umImportFile').onchange=e=>importUsers(e.target.files&&e.target.files[0]);$('umClearLogsBtn').onclick=()=>{if(confirm('确认清空操作日志？')){writeJSON(USER_LOG_KEY,[]);renderLogs();toast('日志已清空')}};
    const listToolsToggle=$('umListToolsToggle');if(listToolsToggle)listToolsToggle.onclick=()=>{state.userToolsExpanded=!state.userToolsExpanded;renderUserToolsState(filteredUsers().length)};
    $('umSearchInput').oninput=e=>{state.query=e.target.value;state.userPage=1;renderUserList()};$('umRoleFilter').onchange=e=>{state.roleFilter=e.target.value;state.userPage=1;renderUserList()};$('umStatusFilter').onchange=e=>{state.statusFilter=e.target.value;state.userPage=1;renderUserList()};
    const selectAll=$('umSelectAllUsers');if(selectAll)selectAll.onchange=e=>toggleSelectAllVisible(e.target.checked);
    const prevPage=$('umPrevPageBtn');if(prevPage)prevPage.onclick=()=>{state.userPage=Math.max(1,state.userPage-1);renderUserList()};
    const nextPage=$('umNextPageBtn');if(nextPage)nextPage.onclick=()=>{state.userPage=state.userPage+1;renderUserList()};
    const pageSize=$('umPageSizeSelect');if(pageSize)pageSize.onchange=e=>{state.userPageSize=Math.max(1,Number(e.target.value||20));state.userPage=1;renderUserList()};
    const batchApplyBtn=$('umBatchApplyBtn');if(batchApplyBtn)batchApplyBtn.onclick=batchApply;
    const batchExportBtn=$('umBatchExportBtn');if(batchExportBtn)batchExportBtn.onclick=exportBatchUsers;
    const batchClearBtn=$('umBatchClearBtn');if(batchClearBtn)batchClearBtn.onclick=clearBatchSelection;
    const batchDeleteBtn=$('umBatchDeleteBtn');if(batchDeleteBtn)batchDeleteBtn.onclick=deleteBatchUsers;
    $('umUserList').addEventListener('click',e=>{
      if(e.target.closest('.um-user-check')||e.target.classList.contains('um-user-checkbox'))return;
      const item=e.target.closest('.um-user-item');if(!item)return;
      state.selected=item.dataset.user;render();
    });
    $('umUserList').addEventListener('change',e=>{
      const box=e.target.closest('.um-user-checkbox');if(!box)return;
      const username=box.dataset.selectUser;
      if(box.checked)state.selectedUsers.add(username);else state.selectedUsers.delete(username);
      renderUserList();
    });
    $('umUserList').addEventListener('keydown',e=>{
      const item=e.target.closest('.um-user-item');if(!item)return;
      if(e.key==='Enter'||e.key===' '){e.preventDefault();state.selected=item.dataset.user;render()}
    });
    const subscriptionCard=$('umSubscriptionCard');
    if(subscriptionCard)subscriptionCard.addEventListener('click',e=>{
      const action=e.target.closest('[data-sub-action]');
      if(!action)return;
      if(action.dataset.subAction==='save')saveSubscriptionExact();
      if(action.dataset.subAction==='renew')renewSubscription();
      if(action.dataset.subAction==='pause')pauseSubscription();
      if(action.dataset.subAction==='free')freeSubscription();
    });
    if(subscriptionCard)subscriptionCard.addEventListener('change',e=>{
      if(e.target&&e.target.id==='umSubPlan'){
        const sub=subApi();const plan=sub&&sub.planById?sub.planById(e.target.value):null;
        const expires=$('umSubExpires');
        if(expires&&plan){
          if(plan.durationDays===-1||plan.durationDays===0)expires.value='';
          else expires.value=dateInputValue(Date.now()+plan.durationDays*24*60*60*1000);
        }
      }
    });
    const rightToggle=$('umRightCollapseBtn');if(rightToggle)rightToggle.onclick=()=>{state.rightCollapsed=!state.rightCollapsed;applyRightPanelState()};
    document.querySelectorAll('[data-right-tab]').forEach(btn=>{btn.onclick=()=>{state.rightCollapsed=false;setRightTab(btn.dataset.rightTab);applyRightPanelState()}});
    ['umDisplayName','umRole','umStatus','umEmail','umPhone','umSubject','umTags','umNote'].forEach(id=>{const el=$(id);el.addEventListener('input',()=>{$('umSaveState').textContent='有未保存修改';$('umSaveState').className='um-save-state warn'});el.addEventListener('change',()=>{$('umSaveState').textContent='有未保存修改';$('umSaveState').className='um-save-state warn'})});
  }
  if(window.KGRolePermissions){
    window.KGRolePermissions.applyTheme();
    if(!window.KGRolePermissions.canEnterUserManagement()){
      window.KGRolePermissions.renderPermissionDenied(document.querySelector('.um-app') || document.body, '用户管理仅限管理员访问。教师/教研可进入教师工作台完成题目、训练与组卷；学员请进入刷题。');
      return;
    }
  }
  window.addEventListener('kg-subscription-change',()=>{if(state.selected)renderForm()});
  window.addEventListener('kg-subscription-plan-change',()=>{if(state.selected)renderForm()});
  bindEvents();loadUsers();render();
})();
