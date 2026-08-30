'use strict';
(function(global){
  const Services=global.KGAdminServices,UI=global.KGAdminUI;if(!Services||!UI)return;
  const DomainSummary=global.KGAdminDomainSummary;
  const {byId,escapeHtml,formatTime}=UI;
  function ensureAccess(){
    if(Services.permissions.can('viewAdminConsole'))return true;
    const nav=document.querySelector('.admin-context-nav');if(nav)nav.hidden=true;
    const shell=document.querySelector('.admin-app-shell');if(shell)shell.innerHTML='<main class="admin-main"><section class="admin-panel admin-empty"><h1>无权访问管理后台</h1><p>当前账号没有管理后台权限，请返回学习首页或联系管理员。</p><a class="admin-button primary" href="index.html">返回首页</a></section></main>';
    return false;
  }
  function renderMetrics(summary){
    const subjects=summary.subjects;
    const activeSubjects=subjects.filter(item=>!Services.subjects.isInactive(item));
    const taxonomies=summary.taxonomies;
    const currentCount=subjects.filter(item=>Services.taxonomies.currentForSubject(item.id)).length;
    byId('adminSubjectCount').textContent=String(activeSubjects.length);
    byId('adminSubjectDetail').textContent=`共 ${subjects.length} 个科目`;
    byId('adminCurrentTaxonomyCount').textContent=String(currentCount);
    byId('adminTaxonomyDetail').textContent=`${taxonomies.filter(item=>item.status==='draft').length} 个草稿 · ${taxonomies.filter(item=>item.status==='archived').length} 个归档`;
    byId('adminQuestionCount').textContent=String(summary.questionCount);
    byId('adminQuestionDetail').textContent=`${summary.banks.length} 个服务端题库`;
    byId('adminAssessmentCount').textContent=String(summary.papers.length+summary.tasks.length);
    byId('adminAssessmentDetail').textContent=`${summary.papers.length} 份试卷 · ${summary.tasks.length} 个任务`;
  }
  function renderAttention(summary){
    const taxonomies=summary.taxonomies;
    const drafts=taxonomies.filter(item=>item.status==='draft').length;
    const courseDrafts=summary.drafts.filter(item=>item.status==='draft').length;
    const rows=[
      {value:summary.pendingFeedbackCount,title:'待处理反馈',detail:'用户反馈仍处于待处理或处理中',href:'feedback-management.html'},
      {value:drafts,title:'知识树草稿',detail:'重大导入或整体调整待确认',href:'admin-subjects.html?tab=history'},
      {value:courseDrafts,title:'课程草稿',detail:'尚未发布的课程内容',href:'course-admin.html'}
    ];
    byId('adminAttentionList').innerHTML=rows.map(item=>`<a href="${item.href}" class="${item.value?'needs-attention':'clear'}"><b>${item.value}</b><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></div><i>→</i></a>`).join('');
  }
  function renderAudit(summary){
    const el=byId('adminRecentAudit');
    if(!Services.permissions.can('viewAudit')){el.innerHTML='<div class="admin-empty">当前角色不显示审计详情。</div>';return}
    const rows=summary.audit.slice(0,6);
    el.innerHTML=rows.length?rows.map(item=>`<article class="${item.status==='failed'?'failed':''}"><i></i><div><strong>${escapeHtml(item.summary||item.action)}</strong><span>${escapeHtml(item.actor?.name||'未知用户')} · ${escapeHtml(item.entityType)}</span></div><time>${formatTime(item.at)}</time></article>`).join(''):'<div class="admin-empty">还没有操作记录。</div>';
  }
  async function init(){UI.init(Services);if(!ensureAccess())return;try{const summary=await DomainSummary.ready();renderMetrics(summary);renderAttention(summary);renderAudit(summary)}catch(error){const main=document.querySelector('.admin-main');if(main)main.innerHTML=`<section class="admin-panel admin-empty"><h1>管理数据加载失败</h1><p>${escapeHtml(error?.message||error)}。请刷新页面重试。</p></section>`}}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>{void init()}):void init();
})(window);
