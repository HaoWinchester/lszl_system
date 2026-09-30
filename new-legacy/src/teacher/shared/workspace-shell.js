'use strict';

// Keep the existing business controls and navigation nodes; only arrange the daily shell.
(function(){
  function init(){
    const assistantNav=document.getElementById('assistant-workspace-nav');
    if(document.body?.dataset.teacherDaily!=='true'&&!assistantNav)return;
    const file=window.location.pathname.split('/').pop();
    const step=new URLSearchParams(window.location.search).get('step')==='training'?'training':'questions';
    const links=[
      {href:'teacher-workbench.html',label:'工作台',current:file==='teacher-workbench.html'},
      {href:'question-bank.html?mode=simple&step=questions',label:'题目管理',current:file==='question-bank.html'&&step==='questions'},
      {href:'question-bank.html?mode=simple&step=training',label:'训练配置',current:file==='question-bank.html'&&step==='training'},
      {href:'paper-management.html',label:'试卷管理',current:file==='paper-management.html'},
      {href:'teacher-assistant.html',label:'文件整理助手',current:file==='teacher-assistant.html'},
    ];
    const extra=[{href:'content-center.html',label:'内容中心',current:file==='content-center.html'},{href:'course-admin.html',label:'课程与任务',current:file==='course-admin.html'}];
    function navigation(node,entries){
      if(!node)return;
      node.replaceChildren();
      for(const entry of entries){const a=document.createElement('a');a.href=entry.href;a.textContent=entry.label;if(entry.current){a.classList.add('active');a.setAttribute('aria-current','page')}node.append(a)}
    }
    navigation(assistantNav,[...links,...extra]);
    const header=document.querySelector('.tw-topbar');
    const nav=document.querySelector('.admin-context-nav');
    const user=header?.querySelector('.tw-user');
    if(nav&&user&&!header.querySelector('.tw-admin-menu')){
      const menu=document.createElement('details');
      menu.className='tw-admin-menu';
      const summary=document.createElement('summary');
      summary.textContent='管理入口';
      menu.append(summary,nav);
      user.append(menu);
    }
    function renderAdminAnalysis(){
      const existing=nav?.querySelector('[data-teacher-analytics]');
      if(window.KGAuthCore?.currentUser?.()?.role!=='admin'){existing?.remove();return}
      if(!nav||existing)return;
      const link=document.createElement('a');
      link.href='system-settings.html?tab=analytics';
      link.textContent='学员使用分析';
      link.dataset.teacherAnalytics='true';
      nav.append(link);
    }
    renderAdminAnalysis();
    window.addEventListener('kg-auth-session-change',renderAdminAnalysis);
    const tabs=header?.querySelector('.tw-tabs');
    navigation(tabs,links);
    if(user&&!user.querySelector('.tw-teaching-tools')){
      user.querySelectorAll('a[href="course-admin.html"]').forEach(link=>link.remove());
      const menu=document.createElement('details');menu.className='tw-teaching-tools';
      const summary=document.createElement('summary');summary.textContent='教学工具';
      const panel=document.createElement('div');navigation(panel,extra);menu.append(summary,panel);
      if(extra.some(entry=>entry.current))menu.setAttribute('aria-current','true');
      user.prepend(menu);
    }
    const current=[...links,...extra].find(entry=>entry.current);
    if(header&&current&&file!=='teacher-workbench.html'&&!document.querySelector('.tw-location')){
      const location=document.createElement('nav');location.className='tw-location';location.setAttribute('aria-label','当前位置');
      const parent=document.createElement('a');parent.href='teacher-workbench.html';parent.textContent='教师工作台';
      const separator=document.createElement('span');separator.textContent='/';separator.setAttribute('aria-hidden','true');
      const title=document.createElement('span');title.textContent=current.label;title.setAttribute('aria-current','page');location.append(parent,separator,title);header.after(location);
    }
    const menus=Array.from(document.querySelectorAll('.tw-admin-menu,.tw-more-actions,.tw-teaching-tools'));
    document.addEventListener('click',event=>menus.forEach(menu=>{
      if(!menu.contains(event.target))menu.open=false;
    }));
    document.addEventListener('keydown',event=>{
      if(event.key!=='Escape')return;
      menus.forEach(menu=>{if(menu.open){menu.open=false;menu.querySelector('summary')?.focus()}});
    });
    document.body.classList.add('teacher-shell-ready');
  }
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init();
})();
