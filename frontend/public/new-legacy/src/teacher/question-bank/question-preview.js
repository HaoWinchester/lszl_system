'use strict';
(function(global){
  const root=global.KGTeacherDomains=global.KGTeacherDomains||{};
  const escape=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  function stem(question,lang='zh'){if(lang==='en')return (question?.translations?.en?.stemParts||[]).map(item=>item?.text||'').join('');return (question?.stemParts||[]).map(item=>item?.text||'').join('')}
  function viewModel(question,lang='zh'){
    const english=lang==='en'&&question?.translations?.en;const options=(english?.options||question?.options||[]).map(item=>({id:String(item.id||''),text:String(item.text||''),correct:String(item.id||'')===String(question?.correctAnswer||'')}));
    return {id:String(question?.id||''),title:String(english?.title||question?.title||'未命名题目'),stem:stem(question,lang)||'—',options,analysis:String(english?.analysis||question?.analysis||''),language:english?'en':'zh'};
  }
  function render(question,options={}){const model=viewModel(question,options.language||'zh');return `<article class="teacher-question-preview"><h3>${escape(model.title)}</h3><p class="stem">${escape(model.stem)}</p><div class="options">${model.options.map(item=>`<div class="option ${item.correct?'correct':''}"><b>${escape(item.id)}</b><span>${escape(item.text||'—')}</span>${item.correct?'<em>正确答案</em>':''}</div>`).join('')}</div><section class="analysis"><b>解析</b><p>${escape(model.analysis||'暂无解析')}</p></section></article>`}
  root.QuestionBank=root.QuestionBank||{};root.QuestionBank.QuestionPreview=Object.freeze({viewModel,render,stem});
})(globalThis);
