'use strict';
(function(global){
  const Services=global.KGAdminServices,UI=global.KGAdminUI;if(!Services||!UI)return;
  const {byId,escapeHtml,formatTime}=UI;
  function ensureAccess(){
    if(Services.permissions.can('viewAdminConsole'))return true;
    const nav=document.querySelector('.admin-context-nav');if(nav)nav.hidden=true;
    const shell=document.querySelector('.admin-app-shell');if(shell)shell.innerHTML='<main class="admin-main"><section class="admin-panel admin-empty"><h1>无权访问管理后台</h1><p>当前账号没有管理后台权限，请返回学习首页或联系管理员。</p><a class="admin-button primary" href="index.html">返回首页</a></section></main>';
    return false;
  }
  function renderMetrics(){
    const subjects=Services.subjects.list();
    const activeSubjects=subjects.filter(item=>!Services.subjects.isInactive(item));
    const taxonomies=Services.taxonomies.list();
    const currentCount=subjects.filter(item=>Services.taxonomies.currentForSubject(item.id)).length;
    const activities=Services.legacyContent.getActivities?.()||[];
    const index=Services.references.build();
    byId('adminSubjectCount').textContent=String(activeSubjects.length);
    byId('adminSubjectDetail').textContent=`共 ${subjects.length} 个科目`;
    byId('adminCurrentTaxonomyCount').textContent=String(currentCount);
    byId('adminTaxonomyDetail').textContent=`${taxonomies.filter(item=>item.status==='draft').length} 个草稿 · ${taxonomies.filter(item=>item.status==='archived').length} 个归档`;
    byId('adminQuestionCount').textContent=String(activities.length);
    const unmapped=activities.filter(item=>!item.metadata?.knowledge?.primaryNodeId).length;
    byId('adminQuestionDetail').textContent=`${unmapped} 道待分类`;
    byId('adminAssessmentCount').textContent=String(index.papers+index.tasks);
    byId('adminAssessmentDetail').textContent=`${index.papers} 份试卷 · ${index.tasks} 个任务`;
  }
  function renderAttention(){
    const subjects=Services.subjects.list();
    const taxonomies=Services.taxonomies.list();
    const activities=Services.legacyContent.getActivities?.()||[];
    const unmapped=activities.filter(item=>!item.metadata?.knowledge?.primaryNodeId).length;
    const drafts=taxonomies.filter(item=>item.status==='draft').length;
    const withoutTree=subjects.filter(item=>!Services.subjects.isInactive(item)&&!Services.taxonomies.currentForSubject(item.id)).length;
    const rows=[
      {value:unmapped,title:'待分类题目',detail:'尚未设置主要知识点',href:'question-bank.html'},
      {value:drafts,title:'知识树草稿',detail:'重大导入或整体调整待确认',href:'admin-subjects.html?tab=history'},
      {value:withoutTree,title:'缺少当前知识树的科目',detail:'需要导入或设定当前版本',href:'admin-subjects.html?tab=history'}
    ];
    byId('adminAttentionList').innerHTML=rows.map(item=>`<a href="${item.href}" class="${item.value?'needs-attention':'clear'}"><b>${item.value}</b><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></div><i>→</i></a>`).join('');
  }
  function renderAudit(){
    const el=byId('adminRecentAudit');
    if(!Services.permissions.can('viewAudit')){el.innerHTML='<div class="admin-empty">当前角色不显示审计详情。</div>';return}
    const rows=Services.audit.list().slice(0,6);
    el.innerHTML=rows.length?rows.map(item=>`<article class="${item.status==='failed'?'failed':''}"><i></i><div><strong>${escapeHtml(item.summary||item.action)}</strong><span>${escapeHtml(item.actor?.name||'未知用户')} · ${escapeHtml(item.entityType)}</span></div><time>${formatTime(item.at)}</time></article>`).join(''):'<div class="admin-empty">还没有操作记录。</div>';
  }
  async function init(){UI.init(Services);if(!ensureAccess())return;const snapshot=await Services.referenceSnapshotReady;if(!snapshot){const main=document.querySelector('.admin-main');if(main)main.innerHTML='<section class="admin-panel admin-empty"><h1>内容引用索引加载失败</h1><p>为避免遗漏正式题目或试卷引用，管理指标与引用操作已暂停。请刷新页面重试。</p></section>';return}renderMetrics();renderAttention();renderAudit()}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>{void init()}):void init();
})(window);
