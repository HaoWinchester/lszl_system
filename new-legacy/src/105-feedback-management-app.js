'use strict';
(function(global){
  const $=id=>document.getElementById(id),Repo=global.KGEngagementRepository,UI=global.KGAdminUI;let rows=[],selectedId='';
  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}
  function fmt(value){try{return new Date(Number(value||0)).toLocaleString('zh-CN',{hour12:false})}catch(error){return '—'}}
  function statusLabel(status){return ({pending:'待处理',in_progress:'处理中',resolved:'已解决',closed:'已关闭'}[status]||status)}
  function typeLabel(type){return ({bug:'问题反馈',suggestion:'功能建议',content:'内容问题',other:'其他'}[type]||type)}
  function toast(message,error=false){UI?.toast?.(message,error)}
  function log(action,detail){try{global.KGAuthCore?.logAction?.(action,'FEEDBACK',detail)}catch(error){}}
  function canAccess(){const user=global.KGAuthCore?.currentUser?.();return !!user&&user.role==='admin'}
  function deny(){document.querySelector('.engagement-admin-main').innerHTML='<section class="admin-page-head"><div><h1>无权访问</h1><span>反馈管理仅限管理员使用。</span></div></section>';return false}
  async function load(){
    rows=await Repo.listFeedback({query:$('feedbackAdminSearch').value,status:$('feedbackAdminStatus').value,type:$('feedbackAdminType').value});
    if(selectedId&&!rows.some(item=>item.id===selectedId))selectedId='';if(!selectedId&&rows[0])selectedId=rows[0].id;renderSummary();renderList();renderDetail();
  }
  async function loadAllForSummary(){return Repo.listFeedback()}
  async function renderSummary(){
    const all=await loadAllForSummary();const count=status=>all.filter(item=>item.status===status).length;
    $('feedbackSummary').innerHTML=`<article><span>全部反馈</span><strong>${all.length}</strong></article><article><span>待处理</span><strong>${count('pending')}</strong></article><article><span>处理中</span><strong>${count('in_progress')}</strong></article><article><span>已解决</span><strong>${count('resolved')}</strong></article>`;
  }
  function renderList(){
    $('feedbackAdminList').innerHTML=rows.length?rows.map(item=>`<button type="button" class="engagement-admin-row ${item.id===selectedId?'active':''}" data-feedback-id="${escapeHtml(item.id)}"><header><strong>${escapeHtml(item.title||'无标题')}</strong><time>${escapeHtml(fmt(item.updatedAt))}</time></header><p>${escapeHtml(item.detail)}</p><footer><span>${escapeHtml(item.submittedBy.displayName||item.submittedBy.username)} · ${escapeHtml(typeLabel(item.type))}</span><b>${escapeHtml(statusLabel(item.status))}</b></footer></button>`).join(''):'<div class="engagement-admin-empty">没有匹配的反馈。</div>';
    $('feedbackAdminList').querySelectorAll('[data-feedback-id]').forEach(button=>button.addEventListener('click',()=>{selectedId=button.dataset.feedbackId;renderList();renderDetail()}));
  }
  function attachmentHtml(item){const attachment=item.attachment;if(!attachment?.dataUrl)return '';const safe=/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(attachment.dataUrl)?attachment.dataUrl:'';return safe?`<p><a href="${escapeHtml(safe)}" target="_blank" rel="noopener">查看截图：${escapeHtml(attachment.name||'附件')}</a></p>`:''}
  function renderDetail(){
    const item=rows.find(row=>row.id===selectedId);if(!item){$('feedbackAdminDetail').innerHTML='<div class="engagement-admin-empty">请选择一条反馈。</div>';return}
    $('feedbackAdminDetail').innerHTML=`<h2>${escapeHtml(item.title)}</h2><div class="engagement-admin-meta"><span class="engagement-admin-chip">${escapeHtml(typeLabel(item.type))}</span><span class="engagement-admin-chip">${escapeHtml(statusLabel(item.status))}</span><span class="engagement-admin-chip">${escapeHtml(item.submittedBy.displayName||item.submittedBy.username)} · ${escapeHtml(item.submittedBy.role)}</span><span class="engagement-admin-chip">${escapeHtml(item.page||'未知页面')}</span><span class="engagement-admin-chip">${escapeHtml(fmt(item.createdAt))}</span></div><div class="engagement-admin-copy">${escapeHtml(item.detail)}</div>${item.contact?`<p>联系方式：${escapeHtml(item.contact)}</p>`:''}${attachmentHtml(item)}${item.replies?.length?`<div class="engagement-reply-list"><strong>历史回复</strong>${item.replies.map(reply=>`<article><b>${escapeHtml(reply.actor)}</b> · ${escapeHtml(fmt(reply.createdAt))}<div>${escapeHtml(reply.message)}</div></article>`).join('')}</div>`:''}<form class="engagement-admin-form" id="feedbackHandleForm"><label>处理状态<select id="feedbackDetailStatus"><option value="pending" ${item.status==='pending'?'selected':''}>待处理</option><option value="in_progress" ${item.status==='in_progress'?'selected':''}>处理中</option><option value="resolved" ${item.status==='resolved'?'selected':''}>已解决</option><option value="closed" ${item.status==='closed'?'selected':''}>已关闭</option></select></label><label>回复用户<textarea id="feedbackReplyText" placeholder="回复内容会显示在用户的“我的反馈”中"></textarea></label><div class="engagement-admin-actions"><button type="button" id="feedbackSaveStatusBtn">只保存状态</button><button class="primary" type="submit">保存并回复</button></div></form>`;
    $('feedbackSaveStatusBtn').addEventListener('click',async()=>{try{const status=$('feedbackDetailStatus').value;await Repo.updateFeedback(item.id,{status});log('更新反馈状态',`${item.id} → ${status}`);toast('反馈状态已更新。');await load()}catch(error){toast(error.message,true)}});
    $('feedbackHandleForm').addEventListener('submit',async event=>{event.preventDefault();try{const status=$('feedbackDetailStatus').value,reply=$('feedbackReplyText').value.trim();await Repo.updateFeedback(item.id,{status});if(reply)await Repo.replyFeedback(item.id,reply);log('回复用户反馈',`${item.id} · ${status}`);toast(reply?'回复已保存。':'反馈状态已更新。');await load()}catch(error){toast(error.message,true)}});
  }
  function bind(){
    $('feedbackRefreshBtn').addEventListener('click',()=>load().catch(error=>toast(error.message,true)));['feedbackAdminSearch','feedbackAdminStatus','feedbackAdminType'].forEach(id=>$(id).addEventListener(id==='feedbackAdminSearch'?'input':'change',()=>load().catch(error=>toast(error.message,true))));
  }
  async function init(){UI?.init?.();if(!canAccess())return deny();bind();try{await load()}catch(error){toast(error.message||'反馈读取失败。',true)}}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init,{once:true}):init();
})(window);
