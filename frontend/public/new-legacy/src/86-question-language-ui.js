'use strict';

/* Question content language switch. The surrounding application UI remains Chinese. */
(function(global){
  const schema=()=>global.KGActivitySchemaV1;
  function mode(){return schema()?.getLanguageMode?.()||'zh'}
  function sync(){
    const current=mode();
    document.documentElement.dataset.questionLanguageMode=current;
    document.querySelectorAll('[data-question-language]').forEach(button=>{
      const active=String(button.dataset.questionLanguage||'')===current;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-pressed',active?'true':'false');
    });
  }
  function bind(){
    sync();
    document.addEventListener('click',event=>{
      const button=event.target.closest?.('[data-question-language]');
      if(!button)return;
      const next=schema()?.normalizeLanguageMode?.(button.dataset.questionLanguage)||'zh';
      if(next===mode())return;
      const isRunningPage=document.body?.matches?.('.guided-node-page,.guided-placement-page');
      if(isRunningPage&&global.confirm?.('切换题目语言会重新加载当前练习，未完成的本页答题状态将清空。是否继续？')===false)return;
      schema()?.setLanguageMode?.(next);
      sync();
      global.location?.reload?.();
    });
    global.addEventListener?.('kg:question-language-mode',sync);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
  global.KGQuestionLanguageUI=Object.freeze({sync,getMode:mode});
})(window);
