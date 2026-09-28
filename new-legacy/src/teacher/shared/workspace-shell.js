'use strict';

// Keep the existing business controls and navigation nodes; only arrange the daily shell.
(function(){
  function init(){
    if(document.body?.dataset.teacherDaily!=='true')return;
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
    if(tabs&&!tabs.querySelector('a[href="teacher-assistant.html"]')){
      const assistant=document.createElement('a');
      assistant.href='teacher-assistant.html';
      assistant.textContent='文件整理助手';
      tabs.append(assistant);
    }
    tabs?.querySelectorAll('a').forEach(link=>{
      const step=new URLSearchParams(window.location.search).get('step')==='training'?'training':'questions';
      const current=link.dataset.tqStep?link.dataset.tqStep===step:link.classList.contains('active');
      if(current)link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    });
    const menus=Array.from(document.querySelectorAll('.tw-admin-menu,.tw-more-actions'));
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
