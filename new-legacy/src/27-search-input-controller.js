'use strict';
/* Search is page memory state. Credential autofill/form restoration is not a search action. */
(function(global){
  function bind(input,{getValue,onChange}){
    let editing=false,composing=false;
    const isAutofilled=()=>{
      for(const selector of [':autofill',':-webkit-autofill']){
        try{if(input.matches(selector))return true}catch(_){}
      }
      return false;
    };
    const reconcile=()=>{if(!composing)input.value=getValue()};
    reconcile();
    input.addEventListener('keydown',event=>{
      editing=event.key.length===1||event.key==='Backspace'||event.key==='Delete';
    });
    input.addEventListener('keyup',()=>{editing=false});
    input.addEventListener('paste',()=>{editing=true});
    input.addEventListener('cut',()=>{editing=true});
    input.addEventListener('drop',()=>{editing=true});
    input.addEventListener('compositionstart',()=>{composing=true;editing=true});
    input.addEventListener('compositionend',()=>{composing=false;onChange(input.value);editing=false});
    input.addEventListener('beforeinput',event=>{
      if(event.inputType)editing=true;
    });
    input.addEventListener('input',event=>{
      // fill(), accessibility editing and native search clear may omit beforeinput.
      const directEdit=/^(insertText|insertFromPaste|insertFromDrop|insertCompositionText|delete)/.test(event.inputType||'');
      if(!isAutofilled()&&(editing||composing||directEdit||input.value===''))onChange(input.value);
      else reconcile();
      if(!composing)editing=false;
    });
    input.addEventListener('focus',reconcile);
    input.addEventListener('blur',()=>{editing=false;reconcile()});
    global.addEventListener('pageshow',reconcile);
  }
  global.KGSearchInputController={bind};
})(window);
