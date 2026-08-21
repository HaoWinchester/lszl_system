'use strict';

/* Question display-language switch. Student answering and assessment remain Chinese. */
(function(global){
  const schema=()=>global.KGActivitySchemaV1;
  function isStudentPage(){return Boolean(document.body?.matches?.('.guided-node-page,.guided-placement-page'))}
  function isLiveFreeModePage(){return Boolean(document.body?.matches?.('.question-workspace-page,.knowledge-recall-page,.question-training-page,.practice-mode-page'))}
  function mode(){
    const current=schema()?.getLanguageMode?.()||'zh';
    return isStudentPage()?(schema()?.normalizeStudentLanguageMode?.(current)||'zh'):current;
  }
  function sync(){
    const current=mode();
    if(isStudentPage()&&schema()?.getLanguageMode?.()!==current)schema()?.setLanguageMode?.(current);
    document.documentElement.dataset.questionLanguageMode=current;
    document.documentElement.dataset.questionAssessmentLanguage='zh';
    document.querySelectorAll('[data-question-language]').forEach(button=>{
      const active=String(button.dataset.questionLanguage||'')===current;
      button.classList.toggle('is-active',active);
      button.setAttribute('aria-pressed',active?'true':'false');
    });
    document.querySelectorAll('[data-question-language-note]').forEach(note=>{
      note.hidden=current!=='bilingual';
    });
  }
  function bind(){
    sync();
    document.addEventListener('click',event=>{
      const button=event.target.closest?.('[data-question-language]');
      if(!button)return;
      const requested=schema()?.normalizeLanguageMode?.(button.dataset.questionLanguage)||'zh';
      const next=isStudentPage()?(schema()?.normalizeStudentLanguageMode?.(requested)||'zh'):requested;
      if(next===mode())return;
      if(isStudentPage()&&global.confirm?.('切换题目显示方式会重新加载当前练习，未完成的本页答题状态将清空。是否继续？')===false)return;
      schema()?.setLanguageMode?.(next);
      sync();
      if(!isLiveFreeModePage())global.location?.reload?.();
    });
    global.addEventListener?.('kg:question-language-mode',sync);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
  global.KGQuestionLanguageUI=Object.freeze({sync,getMode:mode,isStudentPage,isLiveFreeModePage});
})(window);
