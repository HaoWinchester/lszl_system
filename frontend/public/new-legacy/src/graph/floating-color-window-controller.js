'use strict';

(function(global){
  const CLOSE_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"></path></svg>';
  const GRIP_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="7" r="1"></circle><circle cx="16" cy="7" r="1"></circle><circle cx="8" cy="12" r="1"></circle><circle cx="16" cy="12" r="1"></circle><circle cx="8" cy="17" r="1"></circle><circle cx="16" cy="17" r="1"></circle></svg>';
  function clamp(value,min,max){return Math.min(max,Math.max(min,Number(value)||0))}
  function create(options={}){
    const stage=options.stage||document.body;
    let root=null,picker=null,drag=null,current=null,pinned=false,outsideBound=false;
    function ensure(){
      if(root&&root.isConnected)return root;
      root=document.createElement('aside');
      root.className='graph-floating-color-window';
      root.dataset.stageUi='true';
      root.hidden=true;
      root.innerHTML=`<header class="graph-floating-color-head" data-color-window-drag aria-label="拖动调色窗口；拖动后改为手动关闭"><button type="button" class="graph-floating-color-grip" aria-label="拖动调色窗口">${GRIP_ICON}</button><strong data-color-window-title>自定义颜色</strong><span class="graph-floating-color-pin-state" aria-hidden="true">已固定</span><button type="button" class="graph-floating-color-close" data-color-window-close aria-label="关闭调色窗口">${CLOSE_ICON}</button></header><div class="graph-floating-color-body" data-color-window-body></div>`;
      root.addEventListener('pointerdown',event=>event.stopPropagation());
      root.addEventListener('click',event=>event.stopPropagation());
      root.addEventListener('dblclick',event=>event.stopPropagation());
      root.querySelector('[data-color-window-close]').addEventListener('click',()=>close({cancel:true,force:true,reason:'explicit'}));
      const grip=root.querySelector('[data-color-window-drag]');
      grip.addEventListener('pointerdown',event=>{
        if(event.target&&event.target.closest&&event.target.closest('[data-color-window-close]'))return;
        if(event.button!==0)return;
        pinned=true;root.classList.add('manual-close');
        const rect=root.getBoundingClientRect(),sr=stage.getBoundingClientRect();
        drag={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,left:rect.left-sr.left,top:rect.top-sr.top};
        root.classList.add('dragging');
        try{grip.setPointerCapture(event.pointerId)}catch(error){}
        event.preventDefault();event.stopPropagation();
      });
      grip.addEventListener('pointermove',event=>{
        if(!drag||drag.pointerId!==event.pointerId)return;
        const left=drag.left+event.clientX-drag.startX,top=drag.top+event.clientY-drag.startY;
        setPosition(left,top);event.preventDefault();
      });
      const finish=event=>{
        if(!drag||drag.pointerId!==event.pointerId)return;
        try{grip.releasePointerCapture(event.pointerId)}catch(error){}
        drag=null;root.classList.remove('dragging');event.preventDefault();event.stopPropagation();
      };
      grip.addEventListener('pointerup',finish);grip.addEventListener('pointercancel',finish);
      stage.appendChild(root);
      bindOutsideClose();
      return root;
    }
    function bindOutsideClose(){
      if(outsideBound)return;outsideBound=true;
      document.addEventListener('pointerdown',event=>{
        if(!root||root.hidden||pinned)return;
        const target=event.target;
        if(root.contains(target))return;
        if(current&&current.anchor&&current.anchor.contains&&current.anchor.contains(target))return;
        close({cancel:false,reason:'outside'});
      },true);
    }
    function setPosition(left,top){
      ensure();const sr=stage.getBoundingClientRect(),width=root.offsetWidth||320,height=root.offsetHeight||420,pad=10;
      root.style.left=Math.round(clamp(left,pad,Math.max(pad,sr.width-width-pad)))+'px';
      root.style.top=Math.round(clamp(top,pad,Math.max(pad,sr.height-height-pad)))+'px';
    }
    function positionNear(anchor,pointer){
      ensure();const sr=stage.getBoundingClientRect(),ar=anchor&&typeof anchor.left==='number'?anchor:(anchor&&anchor.getBoundingClientRect?anchor.getBoundingClientRect():null),width=root.offsetWidth||286,height=root.offsetHeight||356,pad=8,gap=6;
      const toolbar=anchor&&anchor.closest?anchor.closest('.node-style-toolbar'):null;
      const toolbarRect=toolbar&&toolbar.getBoundingClientRect?toolbar.getBoundingClientRect():null;
      const px=pointer&&Number.isFinite(pointer.x)?pointer.x:null,py=pointer&&Number.isFinite(pointer.y)?pointer.y:null;
      // P4.2.12: node-toolbar colours use a diagonal lower-left placement:
      // the colour window's upper-right corner sits beside the toolbar's lower-left corner.
      let left=toolbarRect?toolbarRect.left-sr.left-width-gap:(px!=null?px-sr.left-18:(ar?ar.left-sr.left:(sr.width-width)/2));
      let top=toolbarRect?toolbarRect.bottom-sr.top+gap:(ar?ar.bottom-sr.top+gap:(py!=null?py-sr.top+10:(sr.height-height)/2));
      if(toolbarRect&&left<pad){
        // Not enough room on the left: keep the same lower edge relationship and align to the toolbar instead.
        left=toolbarRect.left-sr.left;
      }
      if(top+height+pad>sr.height){
        const reference=toolbarRect||ar;
        top=reference?reference.top-sr.top-height-gap:sr.height-height-pad;
      }
      if(left+width+pad>sr.width)left=sr.width-width-pad;
      if(left<pad)left=pad;
      setPosition(left,top);
    }
    function open(config={}){
      ensure();
      if(picker&&picker.destroy)picker.destroy();picker=null;
      const anchorRect=config.anchor&&config.anchor.getBoundingClientRect?config.anchor.getBoundingClientRect():config.anchor;
      current={...config,anchorRect};pinned=false;root.classList.remove('manual-close');
      root.querySelector('[data-color-window-title]').textContent=config.title||'自定义颜色';
      const body=root.querySelector('[data-color-window-body]');body.innerHTML='';
      const factory=global.KGGraphColorPickerController;
      if(!factory||typeof factory.create!=='function')throw new Error('KGGraphColorPickerController unavailable');
      picker=factory.create({
        host:body,kind:config.kind||'color',allowOpacity:config.allowOpacity!==false,allowTransparent:!!config.allowTransparent,
        presets:config.presets,documentColors:config.documentColors||[],documentLabel:config.documentLabel||'当前图谱',
        color:config.value&&config.value.color,opacity:config.value&&config.value.opacity,
        onStart:value=>config.onStart&&config.onStart(value),
        onPreview:value=>config.onPreview&&config.onPreview(value),
        onCommit:value=>config.onCommit&&config.onCommit(value),
        onCancel:value=>config.onCancel&&config.onCancel(value)
      });
      picker.setValue(config.value||{});picker.setDocumentColors(config.documentColors||[]);
      root.hidden=false;root.classList.add('show');
      requestAnimationFrame(()=>positionNear(config.anchor||anchorRect,config.pointer));
      if(typeof options.onOpen==='function')options.onOpen({root,config});
      return root;
    }
    function close(closeOptions={}){
      if(!root||root.hidden)return false;
      if(pinned&&!closeOptions.force)return false;
      if(closeOptions.cancel!==false&&picker&&picker.cancel)picker.cancel();
      root.hidden=true;root.classList.remove('show','dragging','manual-close');drag=null;pinned=false;
      if(typeof options.onClose==='function')options.onClose({config:current});
      current=null;return true;
    }
    function isOpen(){return !!(root&&!root.hidden)}
    function reposition(){if(isOpen())setPosition(parseFloat(root.style.left)||10,parseFloat(root.style.top)||10)}
    function destroy(){if(picker&&picker.destroy)picker.destroy();if(root)root.remove();root=null;picker=null;current=null;drag=null}
    return Object.freeze({ensure,open,close,isOpen,isPinned:()=>pinned,reposition,destroy,getRoot:()=>ensure()});
  }
  global.KGGraphFloatingColorWindowController=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
