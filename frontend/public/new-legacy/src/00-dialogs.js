'use strict';

// Promise based application dialogs. Never replace the synchronous browser APIs.
(function(global){
  if(global.KGDialogs)return;
  const queue=[];
  let active=null,dialog=null,previousFocus=null;
  function owner(){return global.KGAuthCore?.currentUser?.()?.username || global.__KG_DIRECT_BOOTSTRAP__?.authUser?.username || ''}
  function cancelled(task){return task.kind==='confirm'?false:task.kind==='prompt'?null:undefined}
  function finish(value){
    const task=active;if(!task)return;
    active=null;
    task.signal?.removeEventListener('abort',task.abort);
    if(dialog.open)dialog.close();
    else dialog.removeAttribute('open');
    if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
    previousFocus=null;
    task.resolve(task.owner===owner()?value:cancelled(task));
    showNext();
  }
  function build(){
    if(dialog)return;
    dialog=document.createElement('dialog');dialog.className='kg-dialog';
    dialog.setAttribute('aria-labelledby','kgDialogTitle');dialog.setAttribute('aria-describedby','kgDialogMessage');
    dialog.innerHTML='<form method="dialog" class="kg-dialog-panel"><button type="button" class="kg-dialog-close" data-dialog-close aria-label="关闭弹窗">×</button><h2 id="kgDialogTitle"></h2><p id="kgDialogMessage" data-dialog-message></p><label class="kg-dialog-field" hidden><span data-dialog-input-label>请输入</span><input data-dialog-input autocomplete="off" aria-label="请输入"></label><div class="kg-dialog-actions"><button type="button" data-dialog-cancel>取消</button><button type="submit" data-dialog-accept>确定</button></div></form>';
    document.body.appendChild(dialog);
    dialog.querySelector('[data-dialog-close]').addEventListener('click',()=>finish(cancelled(active)));
    dialog.querySelector('[data-dialog-cancel]').addEventListener('click',()=>finish(cancelled(active)));
    dialog.querySelector('form').addEventListener('submit',event=>{
      event.preventDefault();
      if(active)finish(active.kind==='prompt'?dialog.querySelector('input').value:active.kind==='confirm'?true:undefined);
    });
    dialog.addEventListener('cancel',event=>{event.preventDefault();if(active)finish(cancelled(active))});
    dialog.addEventListener('close',()=>{if(active&&!dialog.open)finish(cancelled(active))});
    dialog.addEventListener('click',event=>{if(event.target===dialog&&active){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)finish(cancelled(active))}});
    global.addEventListener('keydown',event=>{
      if(!active)return;
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish(cancelled(active));return}
      if(event.key==='Tab'){
        const controls=[...dialog.querySelectorAll('button,input')].filter(el=>!el.hidden&&!el.closest('[hidden]')&&!el.disabled);
        const first=controls[0],last=controls[controls.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
      }
      // Do not let underlying canvas shortcuts delete content while typing.
      event.stopImmediatePropagation();
    },true);
  }
  function showNext(){
    if(active||!queue.length)return;
    if(!document.body){document.addEventListener('DOMContentLoaded',showNext,{once:true});return}
    const task=queue.shift();
    if(task.signal?.aborted||task.owner!==owner()){task.signal?.removeEventListener('abort',task.abort);task.resolve(cancelled(task));showNext();return}
    build();active=task;previousFocus=document.activeElement;
    const {options,kind}=task;
    dialog.querySelector('h2').textContent=options.title || (kind==='alert'?'提示':kind==='prompt'?'输入信息':'请确认');
    dialog.querySelector('[data-dialog-message]').textContent=String(task.message??'');
    dialog.classList.toggle('kg-dialog-danger',options.danger===true);
    const input=dialog.querySelector('input'),field=dialog.querySelector('label'),cancel=dialog.querySelector('[data-dialog-cancel]'),accept=dialog.querySelector('[data-dialog-accept]');
    field.hidden=kind!=='prompt';cancel.hidden=kind==='alert';
    input.value=String(task.defaultValue??'');input.type=options.inputType==='password'?'password':'text';
    input.setAttribute('aria-label',options.inputLabel||'请输入');dialog.querySelector('[data-dialog-input-label]').textContent=options.inputLabel||'请输入';
    cancel.textContent=options.cancelText||'取消';accept.textContent=options.confirmText||'确定';
    if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
    const focus=kind==='prompt'?input:options.danger&&kind!=='alert'?cancel:accept;
    focus.focus({preventScroll:true});if(kind==='prompt')input.select();
  }
  function open(kind,message,defaultValue,options={}){
    return new Promise(resolve=>{
      const task={kind,message,defaultValue,options,resolve,owner:owner(),signal:options.signal};
      task.abort=()=>{if(active===task)finish(cancelled(task));else{const at=queue.indexOf(task);if(at!==-1)queue.splice(at,1);resolve(cancelled(task))}};
      if(task.signal?.aborted){resolve(cancelled(task));return}
      task.signal?.addEventListener('abort',task.abort,{once:true});queue.push(task);showNext();
    });
  }
  function cancelAll(){
    const waiting=queue.splice(0);
    if(active)finish(cancelled(active));
    waiting.forEach(task=>{task.signal?.removeEventListener('abort',task.abort);task.resolve(cancelled(task))});
  }
  global.addEventListener('kg-auth-session-change',cancelAll);
  global.addEventListener('pagehide',cancelAll);
  global.KGDialogs=Object.freeze({alert:(message,options)=>open('alert',message,'',options),confirm:(message,options)=>open('confirm',message,'',options),prompt:(message,defaultValue='',options)=>open('prompt',message,defaultValue,options),cancelAll});
})(window);
