'use strict';
(function(global){
  const $=id=>document.getElementById(id);
  const Repository=()=>global.KGEngagementRepository;
  let shell,trigger,popover,badge,feedbackMenuBadge,messageMenuBadge,refreshTimer=0,toastTimer=0,dialogReturnFocus=null;
  const FOCUSABLE='button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const MAX_ATTACHMENT_BYTES=160*1024;
  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}
  function fmtTime(value){try{return new Date(Number(value||0)).toLocaleString('zh-CN',{hour12:false})}catch(error){return '—'}}
  function safeHref(value){const href=String(value||'').trim();if(!href)return '';if(/^(https?:\/\/|\/?[\w.-]+(?:\/[^\s]*)?|[\w.-]+\.html(?:[?#][^\s]*)?)$/i.test(href))return href;return ''}
  function toast(message,error=false){let el=$('engagementToast');if(!el){el=document.createElement('div');el.id='engagementToast';el.className='engagement-toast';document.body.appendChild(el)}el.textContent=message;el.classList.toggle('error',!!error);el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2400)}
  function closePopover({focus=false}={}){if(!popover||!trigger)return;popover.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus()}
  function openPopover(){if(!popover||!trigger)return;popover.hidden=false;trigger.setAttribute('aria-expanded','true');refreshUnread();requestAnimationFrame(()=>popover.querySelector('button')?.focus())}
  function togglePopover(){if(popover?.hidden)openPopover();else closePopover()}
  function ensureShell(){
    shell=$('supportCenterShell');
    if(shell)return shell;
    const toolbar=document.querySelector('.canvas-toolbar-right,.lp-top-actions,.practice-header-actions,.fm-top-actions');if(!toolbar)return null;
    shell=document.createElement('div');shell.id='supportCenterShell';shell.className='support-center-shell';
    shell.innerHTML=`<button class="support-center-trigger" id="supportCenterBtn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="supportCenterMenu" title="帮助、反馈与消息"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.35 2.35 0 1 1 3.5 2.05c-.82.45-1.3.93-1.3 1.95"/><path d="M12 17h.01"/></svg><span class="support-center-badge" id="supportCenterBadge" hidden>0</span></button><div class="support-center-popover" id="supportCenterMenu" role="menu" hidden><button type="button" role="menuitem" data-support-action="help"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5Z"/><path d="M4 5.5v16"/></svg><span>帮助中心</span></button><button type="button" role="menuitem" data-support-action="feedback"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5h16v12H8l-4 4Z"/><path d="M8 9h8M8 13h5"/></svg><span>需求反馈</span><b class="menu-badge" id="supportFeedbackMenuBadge" hidden>0</b></button><button type="button" role="menuitem" data-support-action="messages"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"/><path d="M10 19h4"/></svg><span>消息</span><b class="menu-badge" id="supportMessageMenuBadge" hidden>0</b></button></div>`;
    const account=document.getElementById('accountMenuShell');if(account&&account.parentNode===toolbar)account.insertAdjacentElement('afterend',shell);else toolbar.appendChild(shell);
    return shell;
  }
  function ensureDialog(){
    let backdrop=$('engagementDialogBackdrop');if(backdrop)return backdrop;
    backdrop=document.createElement('div');backdrop.id='engagementDialogBackdrop';backdrop.className='engagement-backdrop';backdrop.hidden=true;
    backdrop.innerHTML=`<section class="engagement-dialog" role="dialog" aria-modal="true" aria-labelledby="engagementDialogTitle"><header><div><h2 id="engagementDialogTitle">需求反馈</h2><p id="engagementDialogSubtitle"></p></div><button class="engagement-close" id="engagementDialogClose" type="button" aria-label="关闭" title="关闭"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header><div class="engagement-body" id="engagementDialogBody"></div></section>`;
    document.body.appendChild(backdrop);$('engagementDialogClose').addEventListener('click',closeDialog);backdrop.addEventListener('click',event=>{if(event.target===backdrop)closeDialog()});return backdrop;
  }
  function visibleFocusable(root){return [...root.querySelectorAll(FOCUSABLE)].filter(item=>!item.hidden&&item.getClientRects().length>0)}
  function trapDialogFocus(event){
    const backdrop=$('engagementDialogBackdrop');if(event.key!=='Tab'||!backdrop||backdrop.hidden)return;
    const items=visibleFocusable(backdrop);if(!items.length){event.preventDefault();return}
    const first=items[0],last=items[items.length-1];
    if(!backdrop.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus()}
    else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  }
  function closeDialog(){const dialog=$('engagementDialogBackdrop');if(!dialog||dialog.hidden)return;dialog.hidden=true;document.body.classList.remove('engagement-dialog-open');const target=dialogReturnFocus;dialogReturnFocus=null;requestAnimationFrame(()=>target?.focus?.())}
  function openDialog(title,subtitle=''){const dialog=ensureDialog();dialogReturnFocus=trigger||document.activeElement;$('engagementDialogTitle').textContent=title;$('engagementDialogSubtitle').textContent=subtitle;$('engagementDialogBody').innerHTML='';dialog.hidden=false;document.body.classList.add('engagement-dialog-open');requestAnimationFrame(()=>$('engagementDialogClose')?.focus());return $('engagementDialogBody')}
  function statusLabel(status){return ({pending:'待处理',in_progress:'处理中',resolved:'已解决',closed:'已关闭'}[status]||status||'待处理')}
  async function filePayload(file){
    if(!file)return null;if(file.size>MAX_ATTACHMENT_BYTES)throw new Error('截图不能超过 160KB。');
    const allowed=/^image\/(png|jpeg|webp|gif)$/i.test(file.type||'');if(!allowed)throw new Error('截图仅支持 PNG、JPG、WebP 或 GIF。');
    const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('截图读取失败。'));reader.readAsDataURL(file)});
    return {name:file.name,type:file.type,size:file.size,dataUrl};
  }
  function renderFeedbackForm(body){
    body.innerHTML=`<div class="engagement-tabs"><button type="button" class="active" data-feedback-tab="new">提交反馈</button><button type="button" data-feedback-tab="mine"><span>我的反馈</span><b class="feedback-tab-badge" id="feedbackTabBadge" hidden>0</b></button></div><section id="feedbackTabContent"></section>`;
    body.querySelectorAll('[data-feedback-tab]').forEach(button=>button.addEventListener('click',()=>{body.querySelectorAll('[data-feedback-tab]').forEach(item=>item.classList.toggle('active',item===button));button.dataset.feedbackTab==='mine'?renderMyFeedback(body):renderNewFeedback(body)}));
    renderNewFeedback(body);
  }
  function renderNewFeedback(body){
    const content=body.querySelector('#feedbackTabContent');if(!content)return;
    content.innerHTML=`<form class="engagement-form" id="feedbackForm" novalidate><div class="engagement-form-row"><label>反馈类型<select id="feedbackType"><option value="suggestion">功能建议</option><option value="bug">问题反馈</option><option value="content">内容问题</option><option value="other">其他</option></select></label><label>联系方式（选填）<input id="feedbackContact" maxlength="120" placeholder="邮箱或手机号"/></label></div><label>标题<input id="feedbackTitle" maxlength="100" aria-describedby="feedbackFormError" placeholder="请简要说明问题或建议"/></label><label>详细描述<textarea id="feedbackDetail" maxlength="4000" aria-describedby="feedbackFormError" placeholder="请描述发生了什么、期望结果以及复现步骤"></textarea></label><label>截图（选填，最大 160KB）<input id="feedbackAttachment" type="file" accept="image/png,image/jpeg,image/webp,image/gif"/></label><div class="engagement-form-error" id="feedbackFormError" role="alert" hidden></div><div class="engagement-note">将自动记录当前页面、账号角色和应用版本，不会自动提交图谱或题目内容。</div><button class="engagement-primary" type="submit">提交反馈</button></form>`;
    $('feedbackForm').addEventListener('submit',async event=>{
      event.preventDefault();const title=$('feedbackTitle').value.trim(),detail=$('feedbackDetail').value.trim(),errorBox=$('feedbackFormError');
      if(!title||!detail){errorBox.textContent='请填写反馈标题和详细描述。';errorBox.hidden=false;(title?$('feedbackDetail'):$('feedbackTitle')).focus();return}
      errorBox.hidden=true;const button=event.submitter||$('feedbackForm').querySelector('[type="submit"]');button.disabled=true;
      try{
        const attachment=await filePayload($('feedbackAttachment').files?.[0]);
        await Repository().submitFeedback({type:$('feedbackType').value,title,detail,contact:$('feedbackContact').value,page:location.pathname.split('/').pop()||'index.html',appVersion:global.__KG_DIRECT_BOOTSTRAP__?.releaseVersion||document.documentElement.dataset.release||'',attachment});
        toast('反馈已提交，谢谢你的建议！');$('feedbackForm').reset();
      }catch(error){toast(error.message||'反馈提交失败。',true)}finally{button.disabled=false}
    });
  }
  async function renderMyFeedback(body){
    const content=body.querySelector('#feedbackTabContent');if(!content)return;content.innerHTML='<div class="engagement-empty">正在读取反馈…</div>';
    try{
      const rows=await Repository().listMyFeedback();
      const unreadRows=rows.filter(item=>Number(item.unreadReplyCount||0)>0);
      content.innerHTML=rows.length?`<div class="my-feedback-list">${rows.map(item=>`<article class="my-feedback-card ${Number(item.unreadReplyCount||0)>0?'unread-reply':''}"><header><div><h3>${escapeHtml(item.title)}</h3><span class="feedback-status ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span>${Number(item.unreadReplyCount||0)>0?`<span class="feedback-reply-badge">管理员新回复 ${escapeHtml(item.unreadReplyCount)}</span>`:''}</div><time>${escapeHtml(fmtTime(item.updatedAt))}</time></header><p>${escapeHtml(item.detail)}</p>${item.replies?.length?`<div class="feedback-replies"><strong>处理回复</strong>${item.replies.map(reply=>`<article><b>${escapeHtml(reply.actor)}</b> · ${escapeHtml(fmtTime(reply.createdAt))}<div>${escapeHtml(reply.message)}</div></article>`).join('')}</div>`:''}</article>`).join('')}</div>`:'<div class="engagement-empty">还没有提交过反馈。</div>';
      if(unreadRows.length){await Promise.all(unreadRows.map(item=>Repository().markFeedbackRead(item.id)));refreshUnread()}
    }catch(error){content.innerHTML=`<div class="engagement-empty">${escapeHtml(error.message||'反馈读取失败。')}</div>`}
  }
  function openFeedback(){closePopover();const body=openDialog('需求反馈','提交问题、建议或内容反馈，并查看处理进度。');renderFeedbackForm(body);refreshUnread()}
  async function openMessages(){
    closePopover();const body=openDialog('消息','查看管理员和运营人员发布的通知。');body.innerHTML='<div class="engagement-empty">正在读取消息…</div>';
    try{
      const rows=await Repository().listUserMessages();
      body.innerHTML=`<div class="message-toolbar"><button type="button" id="messageMarkAllBtn" ${rows.some(item=>!item.read)?'':'disabled'}>全部标为已读</button></div>${rows.length?`<div class="message-list">${rows.map(item=>{const href=safeHref(item.link);return `<article class="message-card ${item.read?'':'unread'}" data-message-id="${escapeHtml(item.id)}"><header><h3>${escapeHtml(item.title)}</h3><time>${escapeHtml(fmtTime(item.publishAt||item.publishedAt||item.createdAt))}</time></header><p>${escapeHtml(item.body)}</p><div>${href?`<button type="button" data-message-link="${escapeHtml(href)}">查看详情</button>`:''}${item.read?'':`<button type="button" data-message-read="${escapeHtml(item.id)}">标为已读</button>`}</div></article>`}).join('')}</div>`:'<div class="engagement-empty">目前没有消息。</div>'}`;
      body.querySelectorAll('[data-message-read]').forEach(button=>button.addEventListener('click',async()=>{await Repository().markMessageRead(button.dataset.messageRead);button.closest('.message-card')?.classList.remove('unread');button.remove();refreshUnread()}));
      body.querySelectorAll('[data-message-link]').forEach(button=>button.addEventListener('click',async()=>{const card=button.closest('[data-message-id]');if(card)await Repository().markMessageRead(card.dataset.messageId);location.href=button.dataset.messageLink}));
      $('messageMarkAllBtn')?.addEventListener('click',async()=>{await Repository().markAllMessagesRead();body.querySelectorAll('.message-card').forEach(card=>card.classList.remove('unread'));body.querySelectorAll('[data-message-read]').forEach(button=>button.remove());$('messageMarkAllBtn').disabled=true;refreshUnread()});
    }catch(error){body.innerHTML=`<div class="engagement-empty">${escapeHtml(error.message||'消息读取失败。')}</div>`}
  }
  function openHelp(){closePopover();const returnTo=(location.pathname.split('/').pop()||'index.html')+location.search+location.hash;location.href='help-center.html?returnTo='+encodeURIComponent(returnTo)}
  function applyBadge(element,count){if(!element)return;const safe=Math.max(0,Number(count||0));element.textContent=safe>99?'99+':String(safe);element.hidden=safe<=0}
  async function refreshUnread(){
    if(!Repository()||!badge)return;
    try{
      const summary=Repository().unreadSummary?await Repository().unreadSummary():{messages:await Repository().unreadCount(),feedbackReplies:0};
      summary.total=Number(summary.total??(Number(summary.messages||0)+Number(summary.feedbackReplies||0)));
      applyBadge(badge,summary.total);applyBadge(messageMenuBadge,summary.messages);applyBadge(feedbackMenuBadge,summary.feedbackReplies);applyBadge($('feedbackTabBadge'),summary.feedbackReplies);
      if(trigger)trigger.title=summary.total>0?`帮助、反馈与消息（${summary.total} 条未读）`:'帮助、反馈与消息';
    }catch(error){applyBadge(badge,0);applyBadge(messageMenuBadge,0);applyBadge(feedbackMenuBadge,0);applyBadge($('feedbackTabBadge'),0)}
  }
  function onKeydown(event){
    trapDialogFocus(event);
    if(event.key==='Escape'){const dialog=$('engagementDialogBackdrop');if(dialog&&!dialog.hidden)closeDialog();else closePopover({focus:true});return}
    if(!popover||popover.hidden)return;const items=[...popover.querySelectorAll('[role="menuitem"]')];const index=items.indexOf(document.activeElement);if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const step=event.key==='ArrowDown'?1:-1;items[(Math.max(index,0)+step+items.length)%items.length]?.focus()}
  }
  function init(){
    if(!Repository())return;if(!ensureShell())return;trigger=$('supportCenterBtn');popover=$('supportCenterMenu');badge=$('supportCenterBadge');feedbackMenuBadge=$('supportFeedbackMenuBadge');messageMenuBadge=$('supportMessageMenuBadge');if(shell.dataset.bound==='1')return;shell.dataset.bound='1';
    trigger.addEventListener('click',event=>{event.stopPropagation();togglePopover()});popover.querySelector('[data-support-action="help"]').addEventListener('click',openHelp);popover.querySelector('[data-support-action="feedback"]').addEventListener('click',openFeedback);popover.querySelector('[data-support-action="messages"]').addEventListener('click',openMessages);
    document.addEventListener('click',event=>{if(!shell.contains(event.target))closePopover()});document.addEventListener('keydown',onKeydown);global.addEventListener('blur',()=>closePopover());global.addEventListener('resize',()=>closePopover());
    global.addEventListener(Repository().eventName,refreshUnread);global.addEventListener('storage',event=>{if(!event.key||event.key===Repository().feedbackStorageKey||event.key===Repository().announcementStorageKey||event.key?.startsWith(Repository().readStoragePrefix)||event.key?.startsWith(Repository().feedbackReadStoragePrefix))refreshUnread()});global.addEventListener('kg-auth-session-change',refreshUnread);
    refreshUnread();refreshTimer=global.setInterval(refreshUnread,60000);
  }
  global.KGSupportCenter=Object.freeze({openFeedback,openMessages,refreshUnread,closePopover});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
