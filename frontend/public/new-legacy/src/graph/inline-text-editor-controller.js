'use strict';

(function(global){
  function create(options={}){
    let session=null;
    const outsideHandler=event=>{
      if(!session)return;
      const target=event.target;if(target===session.editor||session.editor.contains&&session.editor.contains(target))return;
      // The editor is opened on pointer release of the second click. Ignore the click event
      // that belongs to that same gesture so it cannot immediately commit and close itself.
      const now=typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
      if(session.card&&session.card.contains&&session.card.contains(target)&&now-session.startedAt<180)return;
      const outsideTarget={
        nodeId:target&&target.closest?String(target.closest('.knowledge-card')?.dataset?.nodeId||''):'',
        textElementId:target&&target.closest?String(target.closest('.graph-text-element')?.dataset?.textElementId||''):'',
        isCanvas:!!(target&&target.closest&&target.closest('#stage'))
      };
      setTimeout(()=>{
        if(!session)return;
        const committed=commit();
        if(typeof options.onOutsideCommit==='function')options.onOutsideCommit({...outsideTarget,committed,event});
      },0)
    };
    document.addEventListener('click',outsideHandler,true);
    function isEditing(){return !!session}
    function current(){return session?{nodeId:session.nodeId,entityType:session.entityType,multiline:session.multiline,value:session.editor.value}:null}
    function cleanup(){
      if(!session)return;
      const value=session;session=null;
      clearTimeout(value.blurTimer);
      value.host.classList.remove('node-inline-edit-host');value.card.classList.remove('node-inline-editing');
      value.editor.remove();
      if(typeof options.onEnd==='function')options.onEnd({nodeId:value.nodeId,entityType:value.entityType});
    }
    function cancel(){if(!session)return false;const value=session;cleanup();if(typeof options.onCancel==='function')options.onCancel({nodeId:value.nodeId,entityType:value.entityType,original:value.original});return true}
    function commit(){
      if(!session)return false;
      const value=session,next=String(value.editor.value??'').replace(/\r\n/g,'\n').trim();
      cleanup();
      if(next===value.original.trim())return false;
      if(typeof options.onCommit==='function')options.onCommit({nodeId:value.nodeId,entityType:value.entityType,value:next||(value.entityType==='text-element'?'文字':'未命名知识点'),original:value.original,multiline:value.multiline});
      return true;
    }
    function start(config={}){
      if(session)commit();
      const card=config.card,host=config.host;if(!card||!host)return false;
      const multiline=config.multiline!==false,original=String(config.value??'');
      const editor=document.createElement(multiline?'textarea':'input');
      editor.className='node-inline-text-editor';editor.value=original;editor.dataset.nodeInlineEditor='true';editor.setAttribute('aria-label',config.label||'编辑节点文字');
      if(!multiline)editor.type='text';else editor.rows=3;
      host.classList.add('node-inline-edit-host');card.classList.add('node-inline-editing');host.appendChild(editor);
      session={nodeId:config.nodeId||card.dataset.nodeId||card.dataset.textElementId||'',entityType:config.entityType||'node',card,host,editor,original,multiline,blurTimer:null,startedAt:(typeof performance!=='undefined'&&performance.now?performance.now():Date.now())};
      editor.addEventListener('pointerdown',event=>event.stopPropagation());editor.addEventListener('click',event=>event.stopPropagation());editor.addEventListener('dblclick',event=>event.stopPropagation());
      editor.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();return}
        const shouldCommit=(!multiline&&event.key==='Enter')||(multiline&&event.key==='Enter'&&(event.ctrlKey||event.metaKey));
        if(shouldCommit){event.preventDefault();event.stopPropagation();commit()}
      });
      editor.addEventListener('blur',()=>{const currentSession=session;if(!currentSession)return;clearTimeout(currentSession.blurTimer);currentSession.blurTimer=setTimeout(()=>{if(session===currentSession)commit()},160)});
      requestAnimationFrame(()=>{editor.focus({preventScroll:true});const end=editor.value.length;if(typeof editor.setSelectionRange==='function')editor.setSelectionRange(end,end);if(multiline)editor.scrollTop=editor.scrollHeight});
      if(typeof options.onStart==='function')options.onStart({nodeId:session.nodeId,entityType:session.entityType,multiline,editor});
      return true;
    }
    function destroy(){cancel();document.removeEventListener('click',outsideHandler,true)}
    return Object.freeze({start,commit,cancel,isEditing,current,destroy});
  }
  global.KGGraphInlineTextEditorController=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
