'use strict';
(function(){
  function init(){const active=document.body?.dataset?.adminContext||'';document.querySelectorAll('.admin-context-nav [data-admin-nav]').forEach(link=>link.classList.toggle('active',link.dataset.adminNav===active))}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init();
})();
