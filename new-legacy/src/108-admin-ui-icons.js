'use strict';
(function(global){
  const known=Object.freeze({
    plus:'plus',refresh:'refresh-cw','refresh-cw':'refresh-cw',search:'search',
    settings:'settings','arrow-left':'arrow-left',download:'download',upload:'upload',
    delete:'trash-2','trash-2':'trash-2','chevron-right':'chevron-right',
    help:'circle-help','circle-help':'circle-help',users:'users','file-text':'file-text',
    message:'message-square','message-square':'message-square',list:'clipboard-list',
    'clipboard-list':'clipboard-list',database:'database',save:'save',close:'x',x:'x'
  });
  const labels=Object.freeze({
    plus:'新增','refresh-cw':'刷新',search:'搜索',settings:'设置','arrow-left':'返回',
    download:'下载',upload:'上传','trash-2':'删除','chevron-right':'进入',
    'circle-help':'帮助',users:'用户','file-text':'文档','message-square':'消息',
    'clipboard-list':'列表',database:'数据',save:'保存',x:'关闭'
  });
  const decorations=Object.freeze([
    ['.admin-head-actions a[href="admin-subjects.html"]','file-text'],
    ['.admin-head-actions a[href="teacher-workbench.html"]','users'],
    ['.admin-head-actions a[href^="admin-subjects.html?tab=history"]','upload'],
    ['.admin-head-actions a[href="system-settings.html"]','settings'],
    ['#adminRefreshOperations','refresh-cw'],
    ['#adminHealthBtn','refresh-cw'],
    ['#feedbackRefreshBtn','refresh-cw'],
    ['#messageNewBtn','plus'],
    ['#messageRefreshBtn','refresh-cw'],
    ['#umAddUserBtn','plus'],
    ['#umExportBtn','download'],
    ['#umImportBtn','upload'],
    ['.ss-topbar .um-back','arrow-left']
  ]);
  const script=document.currentScript;
  const sprite=script&&script.src
    ?new URL('../assets/icons/lucide-admin.svg',script.src).href
    :'assets/icons/lucide-admin.svg';

  function safeSize(value){
    const number=Number(value);
    return Number.isFinite(number)&&number>=12&&number<=32?number:16;
  }

  function iconName(value){
    return known[String(value||'').trim()]||'circle-help';
  }

  function render(name,options){
    const settings=options||{};
    const resolved=iconName(name);
    const size=safeSize(settings.size);
    const decorative=settings.decorative!==false;
    const accessible=decorative
      ?'aria-hidden="true"'
      :`role="img" aria-label="${labels[resolved]||labels['circle-help']}"`;
    return `<svg class="admin-ui-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${accessible}><use href="${sprite}#${resolved}"></use></svg>`;
  }

  function hydrate(root){
    const scope=root&&root.querySelectorAll?root:document;
    scope.querySelectorAll('[data-admin-icon]:not([data-admin-icon-ready])').forEach(function(slot){
      const labelled=slot.hasAttribute('data-admin-icon-label');
      slot.innerHTML=render(slot.getAttribute('data-admin-icon'),{
        size:slot.getAttribute('data-admin-icon-size'),
        decorative:!labelled
      });
      if(labelled)slot.setAttribute('aria-label',slot.getAttribute('data-admin-icon-label')||labels['circle-help']);
      slot.setAttribute('data-admin-icon-ready','true');
    });
    return scope;
  }

  function decorate(root){
    const scope=root&&root.querySelectorAll?root:document;
    decorations.forEach(function(rule){
      scope.querySelectorAll(rule[0]).forEach(function(target){
        if(target.querySelector(':scope > [data-admin-icon]'))return;
        if(rule[1]==='plus'){
          Array.from(target.childNodes).some(function(node){
            if(node.nodeType!==Node.TEXT_NODE||!/^\s*\+\s*/.test(node.textContent||''))return false;
            node.textContent=String(node.textContent||'').replace(/^\s*\+\s*/,'');
            return true;
          });
        }
        const slot=document.createElement('span');
        slot.setAttribute('data-admin-icon',rule[1]);
        slot.setAttribute('data-admin-icon-size','16');
        slot.setAttribute('aria-hidden','true');
        target.prepend(slot);
      });
    });
    return hydrate(scope);
  }

  function start(){
    decorate(document);
    let queued=false;
    const observer=new MutationObserver(function(){
      if(queued)return;
      queued=true;
      queueMicrotask(function(){queued=false;decorate(document);});
    });
    observer.observe(document.body,{childList:true,subtree:true});
  }

  const api={render:render,hydrate:hydrate,decorate:decorate,names:known,unknown:'circle-help'};
  global.KGAdminIcons=Object.freeze(api);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})(window);
