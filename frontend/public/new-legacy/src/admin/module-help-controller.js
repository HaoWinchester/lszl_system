'use strict';
(function(global){
  const $=(selector,root=document)=>root.querySelector(selector);
  let popover=null,active=null;
  function escapeHTML(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}
  function ensurePopover(){
    if(popover)return popover;
    popover=document.createElement('aside');
    popover.className='kg-module-help-popover';
    popover.id='kgModuleHelpPopover';
    popover.setAttribute('role','dialog');
    popover.setAttribute('aria-modal','false');
    popover.hidden=true;
    document.body.appendChild(popover);
    return popover;
  }
  function close(){
    if(active){active.setAttribute('aria-expanded','false');active=null}
    if(popover)popover.hidden=true;
  }
  function position(trigger){
    if(!popover||popover.hidden)return;
    const rect=trigger.getBoundingClientRect(),gap=10,pad=10;
    const width=Math.min(360,Math.max(260,popover.offsetWidth||320));
    let left=rect.left+rect.width/2-width/2;
    left=Math.max(pad,Math.min(left,window.innerWidth-width-pad));
    let top=rect.bottom+gap;
    popover.dataset.placement='bottom';
    if(top+popover.offsetHeight>window.innerHeight-pad){top=Math.max(pad,rect.top-popover.offsetHeight-gap);popover.dataset.placement='top'}
    popover.style.left=Math.round(left)+'px';popover.style.top=Math.round(top)+'px';
    popover.style.setProperty('--kg-help-arrow-x',Math.round(rect.left+rect.width/2-left)+'px');
  }
  function open(trigger){
    const id=String(trigger.dataset.moduleHelp||''),entry=global.KGModuleHelpContent?.get?.(id);
    if(!entry)return;
    if(active===trigger&&!ensurePopover().hidden){close();return}
    close();active=trigger;trigger.setAttribute('aria-expanded','true');
    const items=Array.isArray(entry.items)?entry.items:[];
    ensurePopover().innerHTML=`<header><div><span>HELP</span><h2>${escapeHTML(entry.title||'模块帮助')}</h2></div><button type="button" data-module-help-close aria-label="关闭帮助">×</button></header><p class="kg-module-help-summary">${escapeHTML(entry.summary||'')}</p><ul>${items.map(item=>`<li>${escapeHTML(item)}</li>`).join('')}</ul>${entry.note?`<p class="kg-module-help-note">${escapeHTML(entry.note)}</p>`:''}`;
    popover.hidden=false;position(trigger);$('[data-module-help-close]',popover)?.addEventListener('click',close,{once:true});
  }
  function init(){
    ensurePopover();
    document.querySelectorAll('[data-module-help]').forEach(trigger=>{
      trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
      trigger.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();open(trigger)});
    });
    document.addEventListener('pointerdown',event=>{if(!active)return;if(event.target.closest('[data-module-help],#kgModuleHelpPopover'))return;close()},true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape')close()});
    window.addEventListener('resize',()=>active&&position(active),{passive:true});
    document.addEventListener('scroll',()=>active&&position(active),true);
  }
  global.KGModuleHelpController=Object.freeze({init,open,close});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(globalThis);
