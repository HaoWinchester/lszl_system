'use strict';
(function(global){
  const known=Object.freeze({
    back:'arrow-left','arrow-left':'arrow-left','arrow-right':'arrow-right',
    book:'book-open','book-open':'book-open',check:'check','chevron-down':'chevron-down',
    help:'circle-help','circle-help':'circle-help',download:'download',edit:'edit-3',
    'edit-3':'edit-3',filter:'filter',tree:'folder-tree','folder-tree':'folder-tree',
    minus:'minus',plus:'plus',search:'search',settings:'settings',delete:'trash-2',
    'trash-2':'trash-2',upload:'upload',close:'x',x:'x'
  });
  const labels=Object.freeze({
    'arrow-left':'返回','arrow-right':'继续','book-open':'内容','check':'完成',
    'chevron-down':'展开','circle-help':'帮助',download:'下载','edit-3':'编辑',
    filter:'筛选','folder-tree':'知识树',minus:'缩小',plus:'新增',search:'搜索',
    settings:'设置','trash-2':'删除',upload:'上传',x:'关闭'
  });
  const protectedSelector=[
    '#authModal','#authDialogRoot','#authStatus','.auth-backdrop','.auth-modal',
    '.account-menu','.tw-user','#wbAccount','#ccAccount','#userCenterModal',
    '.user-center-backdrop','[class^="uc-"],[class*=" uc-"]',
    '#userSubscriptionDetailModal','[class^="kg-subscription-"],[class*=" kg-subscription-"]',
    '[class^="subscription-"],[class*=" subscription-"]',
    '[class^="membership-"],[class*=" membership-"]',
    '[class^="payment-"],[class*=" payment-"]',
    '[class^="wechat-"],[class*=" wechat-"]'
  ].join(',');
  const script=document.currentScript;
  const sprite=script&&script.src
    ?new URL('../assets/icons/lucide-product.svg',script.src).href
    :'assets/icons/lucide-product.svg';

  function iconName(value){
    return known[String(value||'').trim()]||'circle-help';
  }

  function safeSize(value){
    const number=Number(value);
    return Number.isFinite(number)&&number>=12&&number<=32?number:16;
  }

  function render(name,options){
    const settings=options||{};
    const resolved=iconName(name);
    const size=safeSize(settings.size);
    const decorative=settings.decorative!==false;
    const accessibility=decorative
      ?'aria-hidden="true"'
      :`role="img" aria-label="${labels[resolved]||labels['circle-help']}"`;
    return `<svg class="focus-vega-ui-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${accessibility}><use href="${sprite}#${resolved}"></use></svg>`;
  }

  function hydrate(root){
    const scope=root&&root.querySelectorAll?root:document;
    scope.querySelectorAll('[data-ui-icon]:not([data-ui-icon-ready])').forEach(function(slot){
      if(slot.closest(protectedSelector))return;
      const labelled=slot.hasAttribute('data-ui-icon-label');
      slot.innerHTML=render(slot.getAttribute('data-ui-icon'),{
        size:slot.getAttribute('data-ui-icon-size'),
        decorative:!labelled
      });
      if(labelled)slot.setAttribute('aria-label',slot.getAttribute('data-ui-icon-label')||labels['circle-help']);
      slot.setAttribute('data-ui-icon-ready','true');
    });
    return scope;
  }

  function start(){
    hydrate(document);
    let queued=false;
    const observer=new MutationObserver(function(){
      if(queued)return;
      queued=true;
      queueMicrotask(function(){queued=false;hydrate(document);});
    });
    observer.observe(document.body,{childList:true,subtree:true});
  }

  global.KGFocusVegaIcons=Object.freeze({
    render:render,hydrate:hydrate,names:known,unknown:'circle-help'
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})(window);
