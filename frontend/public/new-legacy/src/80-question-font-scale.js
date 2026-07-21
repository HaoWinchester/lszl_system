'use strict';

/*
 * 本文件由原单文件 HTML 自动拆分而来。
 * 维护建议：继续把本文件中的强耦合函数逐步迁移为显式模块 API。
 */

/* 考题训练字体缩放强制修复脚本 */
const QUESTION_FONT_SCALE_MAP={small:.9,normal:1,large:1.18,xlarge:1.34};
function applyQuestionFontScale(size){
  const modal=document.getElementById('questionModal');
  if(!modal)return;
  const value=QUESTION_FONT_SCALE_MAP[size]?size:'normal';
  const scale=QUESTION_FONT_SCALE_MAP[value];
  modal.dataset.qFontSize=value;
  modal.style.setProperty('--q-font-scale',String(scale));
  modal.classList.remove('q-font-small','q-font-normal','q-font-large','q-font-xlarge');
  modal.classList.add('q-font-'+value);
  try{const store=window.KGAppStorage;if(store&&store.writeString)store.writeString('pmp_question_font_size_v2',value);else window.KGServerStateStorage.setItem('pmp_question_font_size_v2',value)}catch(e){}
  document.querySelectorAll('#questionModal .question-font-tools button').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.qFont===value);
  });
}
function getSavedQuestionFontScale(){
  try{const store=window.KGAppStorage;if(store&&store.readString)return store.readString('pmp_question_font_size_v2','')||store.readString('pmp_question_font_size_v1','')||'normal';return window.KGServerStateStorage.getItem('pmp_question_font_size_v2')||window.KGServerStateStorage.getItem('pmp_question_font_size_v1')||'normal'}catch(e){return'normal'}
}
function ensureQuestionFontScale(){
  applyQuestionFontScale(getSavedQuestionFontScale());
}
document.addEventListener('click',function(e){
  const btn=e.target&&e.target.closest&&e.target.closest('#questionModal .question-font-tools button[data-q-font]');
  if(!btn)return;
  if(typeof authRequire==='function'&&!authRequire('登录后才能调整考题训练字体。')){e.preventDefault();e.stopPropagation();return;}
  e.preventDefault();
  e.stopPropagation();
  applyQuestionFontScale(btn.dataset.qFont);
},true);
setTimeout(ensureQuestionFontScale,0);
setTimeout(ensureQuestionFontScale,300);
setTimeout(ensureQuestionFontScale,900);
window.addEventListener('load',ensureQuestionFontScale);
