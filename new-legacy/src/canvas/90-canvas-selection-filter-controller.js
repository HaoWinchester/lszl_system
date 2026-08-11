'use strict';

/*
 * CanvasSelectionFilterController v3
 * 统一画布框选候选快照、混合选择、悬浮单分类筛选与选区包围框。
 */
(function(global){
  const asArray=value=>Array.isArray(value)?value:[];
  const idOf=item=>String(item?.id??'');
  const typeOf=item=>String(item?.type??item?.kind??'');
  const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  function create(options={}){
    const surface=options.surface||null;
    const host=options.host||surface?.parentElement||surface||null;
    const labels={...(options.labels||{})};
    const order=asArray(options.order).map(String);
    const applySelection=typeof options.applySelection==='function'?options.applySelection:()=>{};
    const onChange=typeof options.onChange==='function'?options.onChange:()=>{};
    const getAnchorRect=typeof options.getAnchorRect==='function'?options.getAnchorRect:()=>null;
    let groups=new Map(),candidates=[],activeType='',anchorRect=null,destroyed=false;
    let wrap=null,trigger=null,root=null,bounds=null,standalone=false,menuOpen=false,closeTimer=0;

    function totalCount(){return candidates.length}
    function selectedCount(){return activeType?(groups.get(activeType)?.size||0):totalCount()}
    function sortedTypes(){
      const actual=[...groups.keys()];
      return actual.sort((a,b)=>{
        const ai=order.indexOf(a),bi=order.indexOf(b);
        if(ai<0&&bi<0)return a.localeCompare(b);
        if(ai<0)return 1;if(bi<0)return -1;return ai-bi;
      });
    }
    function allIds(){return candidates.map(item=>item.id)}
    function snapshot(){
      return {
        activeType,
        total:totalCount(),
        candidates:candidates.map(item=>({...item})),
        categories:sortedTypes().map(type=>({type,label:labels[type]||type,ids:[...(groups.get(type)||[])]}))
      };
    }
    function clearCloseTimer(){if(closeTimer){global.clearTimeout?.(closeTimer);closeTimer=0}}
    function scheduleClose(delay=150){
      clearCloseTimer();
      closeTimer=global.setTimeout?.(()=>{closeTimer=0;closeMenu()},delay)||0;
      return true;
    }
    function ensureBounds(){
      if(bounds?.isConnected)return bounds;
      if(!host||typeof document==='undefined')return null;
      bounds=document.createElement('div');
      bounds.className='uc-selection-bounds';
      bounds.hidden=true;
      bounds.setAttribute('aria-hidden','true');
      bounds.innerHTML='<i data-corner="nw"></i><i data-corner="ne"></i><i data-corner="se"></i><i data-corner="sw"></i>';
      host.appendChild(bounds);
      return bounds;
    }
    function updateBounds(nextRect=null){
      const overlay=ensureBounds();
      if(!overlay)return false;
      const rect=nextRect||getAnchorRect()||anchorRect;
      if(!rect||selectedCount()<2){overlay.hidden=true;return false}
      const hostRect=host?.getBoundingClientRect?.()||{left:0,top:0,width:0,height:0};
      const rawLeft=Number(rect.left)-Number(hostRect.left||0),rawTop=Number(rect.top)-Number(hostRect.top||0);
      const rawRight=Number(rect.right)-Number(hostRect.left||0),rawBottom=Number(rect.bottom)-Number(hostRect.top||0);
      if(![rawLeft,rawTop,rawRight,rawBottom].every(Number.isFinite)){overlay.hidden=true;return false}
      const left=Math.floor(rawLeft),top=Math.floor(rawTop),right=Math.ceil(rawRight),bottom=Math.ceil(rawBottom);
      const width=Math.max(1,right-left),height=Math.max(1,bottom-top);
      overlay.style.left=left+'px';overlay.style.top=top+'px';
      overlay.style.width=width+'px';overlay.style.height=height+'px';
      overlay.hidden=false;return true;
    }
    function bindHoverMenu(holder,menu){
      holder.addEventListener('pointerenter',event=>{clearCloseTimer();if(event.pointerType!=='touch')openMenu()});
      holder.addEventListener('pointerleave',event=>{if(event.pointerType!=='touch')scheduleClose()});
      holder.addEventListener('focusin',()=>{clearCloseTimer();openMenu()});
      holder.addEventListener('focusout',event=>{if(!holder.contains(event.relatedTarget))scheduleClose(80)});
      menu.addEventListener('pointerenter',clearCloseTimer);
      menu.addEventListener('pointerleave',()=>scheduleClose());
      holder.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu();trigger?.focus?.()}
        else if(event.key==='ArrowDown'){event.preventDefault();event.stopPropagation();openMenu();root?.querySelector?.('[data-uc-selection-type]')?.focus?.()}
      });
    }
    function ensureInline(){
      if(wrap&&root&&trigger)return wrap;
      if(typeof document==='undefined')return null;
      wrap=document.createElement('div');
      wrap.className='uc-selection-filter-wrap';
      wrap.hidden=true;
      wrap.innerHTML='<button type="button" class="uc-selection-filter-trigger" aria-haspopup="menu" aria-expanded="false"><span data-uc-selection-count>多选（0）</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"></path></svg></button><div class="uc-selection-filter uc-selection-filter-inline" hidden role="menu" aria-label="框选分类筛选"></div>';
      trigger=wrap.querySelector('.uc-selection-filter-trigger');
      root=wrap.querySelector('.uc-selection-filter');
      trigger.addEventListener('pointerdown',event=>event.stopPropagation());
      trigger.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();openMenu()});
      root.addEventListener('pointerdown',event=>event.stopPropagation());
      root.addEventListener('click',event=>{
        event.stopPropagation();
        const button=event.target.closest?.('[data-uc-selection-type]');
        if(!button)return;
        event.preventDefault();
        select(button.dataset.ucSelectionType,{reason:'menu'});closeMenu();
      });
      bindHoverMenu(wrap,root);
      return wrap;
    }
    function ensureStandalone(){
      if(root?.isConnected)return root;
      if(!host||typeof document==='undefined')return null;
      standalone=true;
      root=document.createElement('div');
      root.className='uc-selection-filter';
      root.hidden=true;
      root.setAttribute('role','menu');
      root.setAttribute('aria-label','框选分类筛选');
      root.addEventListener('pointerdown',event=>event.stopPropagation());
      root.addEventListener('click',event=>{
        event.stopPropagation();
        const button=event.target.closest?.('[data-uc-selection-type]');
        if(!button)return;
        event.preventDefault();
        select(button.dataset.ucSelectionType,{reason:'menu'});closeMenu();
      });
      host.appendChild(root);
      return root;
    }
    function mountInto(toolbar,meta={}){
      if(!toolbar||typeof toolbar.insertBefore!=='function')return false;
      const holder=ensureInline();if(!holder)return false;
      standalone=false;holder.classList.remove('is-standalone');holder.style.left='';holder.style.top='';
      const directChild=element=>{let current=element;while(current&&current.parentElement!==toolbar)current=current.parentElement;return current};
      const before=directChild(meta.beforeSelector?toolbar.querySelector(meta.beforeSelector):null);
      const after=directChild(meta.afterSelector?toolbar.querySelector(meta.afterSelector):null);
      if(before)toolbar.insertBefore(holder,before);
      else if(after)toolbar.insertBefore(holder,after.nextSibling);
      else toolbar.prepend(holder);
      render();updateBounds();return true;
    }
    function updateTrigger(){
      if(!wrap||!trigger)return;
      const types=sortedTypes(),count=totalCount(),current=selectedCount();
      wrap.hidden=count<2;
      const label=wrap.querySelector('[data-uc-selection-count]');
      if(label)label.textContent='多选（'+current+'）';
      trigger.disabled=types.length<=1;
      trigger.classList.toggle('is-filtered',!!activeType);
      trigger.setAttribute('aria-expanded',menuOpen?'true':'false');
      trigger.setAttribute('aria-label',types.length>1?'悬浮筛选当前多选图元':'当前多选数量');
      const svg=trigger.querySelector('svg');if(svg)svg.hidden=types.length<=1;
    }
    function render(){
      let menu=root;
      if(!menu){
        const holder=ensureInline();
        if(holder&&host){standalone=true;holder.classList.add('is-standalone');host.appendChild(holder);menu=root}
      }
      if(!menu){updateBounds();return false}
      const types=sortedTypes();
      updateTrigger();
      if(types.length<=1){closeMenu();menu.replaceChildren();return false}
      const rows=[];
      for(const type of types){
        const checked=type===activeType,count=groups.get(type)?.size||0;
        rows.push(`<button type="button" role="menuitemradio" aria-checked="${checked?'true':'false'}" class="${checked?'is-active':''}" data-uc-selection-type="${escapeHTML(type)}"><span class="uc-selection-filter-check" aria-hidden="true"></span><span>${escapeHTML(labels[type]||type)}</span><small>${count}</small></button>`);
      }
      menu.innerHTML=rows.join('');
      menu.hidden=!menuOpen;
      if(standalone)refreshPosition();
      return true;
    }
    function openMenu(){
      clearCloseTimer();
      if(sortedTypes().length<=1)return false;
      menuOpen=true;if(root)root.hidden=false;updateTrigger();
      wrap?.dispatchEvent?.(new CustomEvent('uc-selection-filter-open',{bubbles:true}));
      return true;
    }
    function closeMenu(){clearCloseTimer();menuOpen=false;if(root)root.hidden=true;updateTrigger();return true}
    function toggleMenu(){return menuOpen?closeMenu():openMenu()}
    function refreshPosition(nextRect=null){
      updateBounds(nextRect);
      if(!standalone||!wrap)return true;
      const rect=nextRect||getAnchorRect()||anchorRect;if(!rect)return false;
      const hostRect=host?.getBoundingClientRect?.()||{left:0,top:0,width:global.innerWidth||0,height:global.innerHeight||0};
      const width=wrap.offsetWidth||92,height=wrap.offsetHeight||44;
      const left=Math.max(8,Math.min((rect.left+rect.right)/2-hostRect.left-width/2,Math.max(8,hostRect.width-width-8)));
      let top=rect.top-hostRect.top-height-10;if(top<8)top=rect.bottom-hostRect.top+10;
      wrap.style.left=Math.round(left)+'px';wrap.style.top=Math.round(top)+'px';return true;
    }
    function select(type,meta={}){
      type=String(type||'');
      if(type&&!groups.has(type))return false;
      activeType=type;
      const ids=type?[...(groups.get(type)||[])]:allIds();
      const snap=snapshot();
      applySelection(type,ids,{...meta,snapshot:snap});
      render();updateBounds();
      onChange({reason:meta.reason||'select',activeType,ids,snapshot:snapshot()});
      return true;
    }
    function setSnapshot(nextCandidates=[],meta={}){
      groups=new Map();candidates=[];
      const seen=new Set();
      for(const item of asArray(nextCandidates)){
        const type=typeOf(item),id=idOf(item),key=type+'\u0000'+id;
        if(!type||!id||seen.has(key))continue;seen.add(key);
        const candidate={id,type};candidates.push(candidate);
        if(!groups.has(type))groups.set(type,new Set());groups.get(type).add(id);
      }
      anchorRect=meta.anchorRect||null;activeType='';closeMenu();
      if(!candidates.length){clear({reason:meta.reason||'empty',apply:false});return snapshot()}
      select(meta.activatePreferred===true&&groups.has(String(meta.preferredType||''))?String(meta.preferredType):'',{reason:meta.reason||'snapshot'});
      return snapshot();
    }
    function clear(meta={}){
      groups.clear();candidates=[];activeType='';anchorRect=null;closeMenu();
      if(wrap)wrap.hidden=true;if(root)root.replaceChildren();if(bounds)bounds.hidden=true;
      if(meta.apply!==false)applySelection('',[],{reason:meta.reason||'clear',cleared:true,snapshot:snapshot()});
      onChange({reason:meta.reason||'clear',activeType:'',ids:[],snapshot:snapshot()});
      return true;
    }
    function hasSnapshot(){return candidates.length>0}
    function handleDocumentPointer(event){if(menuOpen&&!wrap?.contains(event.target)&&!root?.contains(event.target))closeMenu()}
    if(typeof document!=='undefined')document.addEventListener('pointerdown',handleDocumentPointer,true);
    function destroy(){
      if(destroyed)return false;destroyed=true;clearCloseTimer();
      if(typeof document!=='undefined')document.removeEventListener('pointerdown',handleDocumentPointer,true);
      wrap?.remove();if(standalone)root?.remove();bounds?.remove();wrap=null;root=null;bounds=null;groups.clear();candidates=[];return true;
    }
    return Object.freeze({setSnapshot,select,clear,snapshot,hasSnapshot,getActiveType:()=>activeType,refreshPosition,updateBounds,mountInto,openMenu,closeMenu,toggleMenu,destroy});
  }
  global.KGCanvasSelectionFilterController=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
