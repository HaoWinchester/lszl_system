'use strict';

/*
 * 本文件由原单文件 HTML 自动拆分而来。
 * 维护建议：继续把本文件中的强耦合函数逐步迁移为显式模块 API。
 */

/* 考题训练打开失败修复兜底 */
function forceOpenQuestionTrainer(){
  if(!document.body.classList.contains('question-training-page')){window.open('question-training.html','_blank');return}
  const modal=$('questionModal');
  if(!modal){
    if(typeof showStatus==='function')showStatus('考题训练页面未找到，请检查文件是否完整。');
    return;
  }
  if(typeof qbLoadBanks==='function')qbLoadBanks();
  if(typeof qbApplyCurrentQuestion==='function')qbApplyCurrentQuestion(false);
  modal.classList.add('show');
  if(typeof bindQuestionCaseTabs==='function')bindQuestionCaseTabs();
  if(typeof ensureQuestionFontScale==='function')ensureQuestionFontScale();
  if(typeof renderQuestionTrainer==='function')renderQuestionTrainer();
  if(typeof qSetCaseTab==='function')qSetCaseTab(typeof qActiveCaseTab!=='undefined'?qActiveCaseTab:'question');
}
function bindQuestionTrainerSafe(){
  if(typeof bindQuestionCaseTabs==='function')bindQuestionCaseTabs();
  const btn=$('questionTrainBtn');
  if(btn){
    btn.onclick=null;
    if(btn.dataset.toolbarActionClick !== 'openQuestionTraining'){
      btn.addEventListener('click',e=>{
        e.preventDefault();
        e.stopPropagation();
        forceOpenQuestionTrainer();
      });
    }
  }
  const close=$('closeQuestionBtn');
  if(close){
    close.onclick=e=>{
      e.preventDefault();
      if(document.body.classList.contains('question-training-page')){window.location.href='learning-path.html';return}
      const modal=$('questionModal');
      if(modal)modal.classList.remove('show');
    };
  }
  const modal=$('questionModal');
  if(modal&&!modal.dataset.safeClickBound){
    modal.dataset.safeClickBound='1';
    modal.addEventListener('click',e=>{
      if(e.target===modal&&!document.body.classList.contains('question-training-page'))modal.classList.remove('show');
    });
  }
  const submit=$('qSubmitBtn'),reset=$('qResetBtn'),graph=$('qGraphBtn'),add=$('qAddToCanvasBtn'),flash=$('qFlashBtn');
  if(submit&&typeof submitQuestionAnswer==='function')submit.onclick=submitQuestionAnswer;
  if(reset&&typeof resetQuestionTrainer==='function')reset.onclick=resetQuestionTrainer;
  if(graph&&typeof generateQuestionGraph==='function')graph.onclick=generateQuestionGraph;
  if(add&&typeof addQuestionGraphToCanvas==='function')add.onclick=addQuestionGraphToCanvas;
  if(flash&&typeof addQuestionFlashcards==='function')flash.onclick=addQuestionFlashcards;
}
setTimeout(bindQuestionTrainerSafe,0);
setTimeout(bindQuestionTrainerSafe,300);
setTimeout(bindQuestionTrainerSafe,900);
document.addEventListener('DOMContentLoaded',bindQuestionTrainerSafe);
window.addEventListener('load',bindQuestionTrainerSafe);


setTimeout(bindQuestionTrainer,0);
setTimeout(bindQuestionTrainer,300);
window.addEventListener('load',bindQuestionTrainer);
