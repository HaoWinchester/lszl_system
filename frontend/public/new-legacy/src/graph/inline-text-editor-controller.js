'use strict';

(function(global){
  function create(options={}){
    let session=null;

    const now=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
    const readText=element=>{
      if(!element)return '';
      const value=typeof element.innerText==='string'?element.innerText:element.textContent;
      return String(value??'').replace(/\r\n/g,'\n');
    };
    const writeText=(element,value)=>{if(element)element.textContent=String(value??'')};
    const placeCaretAtEnd=element=>{
      try{
        element.focus({preventScroll:true});
        const selection=global.getSelection?.(),range=document.createRange?.();
        if(!selection||!range)return;
        range.selectNodeContents(element);range.collapse(false);
        selection.removeAllRanges();selection.addRange(range);
      }catch(error){element.focus?.()}
    };

    const outsideHandler=event=>{
      if(!session)return;
      const target=event.target;
      if(target===session.editor||session.editor.contains?.(target))return;
      if(session.card?.contains?.(target)&&now()-session.startedAt<180)return;
      const outsideTarget={
        nodeId:target?.closest?String(target.closest('.knowledge-card')?.dataset?.nodeId||''):'',
        textElementId:target?.closest?String(target.closest('.graph-text-element')?.dataset?.textElementId||''):'',
        isCanvas:!!target?.closest?.('#stage')
      };
      setTimeout(()=>{
        if(!session)return;
        const committed=commit();
        if(typeof options.onOutsideCommit==='function')options.onOutsideCommit({...outsideTarget,committed,event});
      },0);
    };
    document.addEventListener('click',outsideHandler,true);
    function isEditing(){return !!session}
    function current(){return session?{nodeId:session.nodeId,entityType:session.entityType,multiline:session.multiline,value:readText(session.editor)}:null}
    function cleanup(){
      if(!session)return;
      const value=session;session=null;
      clearTimeout(value.blurTimer);
      (value.listeners||[]).forEach(([type,handler])=>value.editor.removeEventListener(type,handler));
      value.editor.removeAttribute('contenteditable');
      value.editor.removeAttribute('role');
      value.editor.removeAttribute('aria-multiline');
      value.editor.removeAttribute('aria-label');
      value.editor.removeAttribute('spellcheck');
      value.editor.removeAttribute('data-node-inline-editor');
      value.editor.classList.remove('node-inline-direct-editor');
      value.card.classList.remove('node-inline-editing');
      if(typeof options.onEnd==='function')options.onEnd({nodeId:value.nodeId,entityType:value.entityType});
    }
    function cancel(){
      if(!session)return false;
      const value=session;
      writeText(value.editor,value.original);
      cleanup();
      if(typeof options.onCancel==='function')options.onCancel({nodeId:value.nodeId,entityType:value.entityType,original:value.original});
      return true;
    }
    function commit(){
      if(!session)return false;
      const value=session;
      const raw=readText(value.editor),trimmed=raw.trim();
      const next=trimmed||(value.entityType==='text-element'?'文字':'未命名知识点');
      const changed=next!==value.original.trim();
      writeText(value.editor,changed?next:value.original);
      cleanup();
      if(!changed)return false;
      if(typeof options.onCommit==='function')options.onCommit({nodeId:value.nodeId,entityType:value.entityType,value:next,original:value.original,multiline:value.multiline});
      return true;
    }
    function start(config={}){
      if(session)commit();
      const card=config.card,host=config.host;
      if(!card||!host)return false;
      const editor=host.querySelector?.('.node-text-content,.graph-text-inline');
      if(!editor)return false;
      const multiline=config.multiline!==false,original=String(config.value??'');

      writeText(editor,original);
      editor.dataset.nodeInlineEditor='true';
      editor.classList.add('node-inline-direct-editor');
      editor.setAttribute('contenteditable','plaintext-only');
      editor.setAttribute('role','textbox');
      editor.setAttribute('aria-multiline',multiline?'true':'false');
      editor.setAttribute('aria-label',config.label||'编辑节点文字');
      editor.setAttribute('spellcheck','false');
      card.classList.add('node-inline-editing');

      session={
        nodeId:config.nodeId||card.dataset.nodeId||card.dataset.textElementId||'',
        entityType:config.entityType||'node',card,host,editor,original,multiline,
        blurTimer:null,startedAt:now(),listeners:[]
      };

      const listen=(type,handler)=>{editor.addEventListener(type,handler);session.listeners.push([type,handler])};
      listen('pointerdown',event=>event.stopPropagation());
      listen('click',event=>event.stopPropagation());
      listen('dblclick',event=>event.stopPropagation());
      listen('keydown',event=>{
        if(!session||session.editor!==editor)return;
        if(event.key==='Escape'){
          event.preventDefault();event.stopPropagation();cancel();return;
        }
        const shouldCommit=(!multiline&&event.key==='Enter')||(multiline&&event.key==='Enter'&&(event.ctrlKey||event.metaKey));
        if(shouldCommit){event.preventDefault();event.stopPropagation();commit()}
      });
      listen('blur',()=>{
        const currentSession=session;
        if(!currentSession||currentSession.editor!==editor)return;
        clearTimeout(currentSession.blurTimer);
        currentSession.blurTimer=setTimeout(()=>{if(session===currentSession)commit()},160);
      });
      requestAnimationFrame(()=>placeCaretAtEnd(editor));
      if(typeof options.onStart==='function')options.onStart({nodeId:session.nodeId,entityType:session.entityType,multiline,editor});
      return true;
    }
    function destroy(){cancel();document.removeEventListener('click',outsideHandler,true)}
    return Object.freeze({start,commit,cancel,isEditing,current,destroy});
  }
  global.KGGraphInlineTextEditorController=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
