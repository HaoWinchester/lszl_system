'use strict';

/*
 * 本文件由原单文件 HTML 自动拆分而来。
 * 维护建议：继续把本文件中的强耦合函数逐步迁移为显式模块 API。
 */

/* 考题训练字体缩放强制修复脚本 */
const QUESTION_FONT_SCALE_MAP={small:.9,normal:1,large:1.18,xlarge:1.34};
const QUESTION_FONT_CYCLE_LEVELS=['normal','large','xlarge'];
function applyQuestionFontScale(size){
  const modal=document.getElementById('questionModal');
  if(!modal)return;
  const value=QUESTION_FONT_SCALE_MAP[size]?size:'normal';
  const scale=QUESTION_FONT_SCALE_MAP[value];
  modal.dataset.qFontSize=value;
  modal.style.setProperty('--q-font-scale',String(scale));
  modal.classList.remove('q-font-small','q-font-normal','q-font-large','q-font-xlarge');
  modal.classList.add('q-font-'+value);
  try{const store=window.KGAppStorage;if(store&&store.writeString)store.writeString('pmp_question_font_size_v2',value);else localStorage.setItem('pmp_question_font_size_v2',value)}catch(e){}
  document.querySelectorAll('#questionModal .question-font-tools button').forEach(btn=>{btn.classList.toggle('active',btn.dataset.qFont===value);});
  const cycle=document.getElementById('qtFontScaleBtn');
  if(cycle){
    const labels={small:'小',normal:'标准',large:'舒适',xlarge:'超大'};
    cycle.dataset.fontScale=value;
    cycle.title='当前：'+(labels[value]||'标准')+'字号；点击切换';
    cycle.setAttribute('aria-label',cycle.title);
  }
}
function getSavedQuestionFontScale(){
  try{const store=window.KGAppStorage;if(store&&store.readString)return store.readString('pmp_question_font_size_v2','')||store.readString('pmp_question_font_size_v1','')||'normal';return localStorage.getItem('pmp_question_font_size_v2')||localStorage.getItem('pmp_question_font_size_v1')||'normal'}catch(e){return'normal'}
}
function ensureQuestionFontScale(){
  applyQuestionFontScale(getSavedQuestionFontScale());
}
function cycleQuestionFontScale(){
  const current=document.getElementById('questionModal')?.dataset.qFontSize||getSavedQuestionFontScale();
  const normalized=QUESTION_FONT_CYCLE_LEVELS.includes(current)?current:'normal';
  const index=QUESTION_FONT_CYCLE_LEVELS.indexOf(normalized);
  const next=QUESTION_FONT_CYCLE_LEVELS[(index+1)%QUESTION_FONT_CYCLE_LEVELS.length];
  applyQuestionFontScale(next);
  if(typeof showStatus==='function'){const labels={normal:'标准',large:'舒适',xlarge:'超大'};showStatus('单题页面已切换为'+labels[next]+'字号。');}
  return next;
}
document.addEventListener('click',function(e){
  const cycle=e.target&&e.target.closest&&e.target.closest('#qtFontScaleBtn');
  if(cycle){
    if(typeof authRequire==='function'&&!authRequire('登录后才能调整考题训练字体。')){e.preventDefault();e.stopPropagation();return;}
    e.preventDefault();e.stopPropagation();cycleQuestionFontScale();return;
  }
  const btn=e.target&&e.target.closest&&e.target.closest('#questionModal .question-font-tools button[data-q-font]');
  if(!btn)return;
  if(typeof authRequire==='function'&&!authRequire('登录后才能调整考题训练字体。')){e.preventDefault();e.stopPropagation();return;}
  e.preventDefault();e.stopPropagation();applyQuestionFontScale(btn.dataset.qFont);
},true);
setTimeout(ensureQuestionFontScale,0);
setTimeout(ensureQuestionFontScale,300);
setTimeout(ensureQuestionFontScale,900);
window.addEventListener('load',ensureQuestionFontScale);
