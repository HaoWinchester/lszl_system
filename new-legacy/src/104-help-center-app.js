'use strict';
(function(global){
  const $=id=>document.getElementById(id);const docs=global.KGHelpContent?.docs||[];let selected=String(new URLSearchParams(location.search).get('topic')||docs[0]?.id||'');
  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}
  function filtered(){const query=String($('helpSearch')?.value||'').trim().toLowerCase();if(!query)return docs;return docs.filter(doc=>[doc.title,doc.summary,...(doc.keywords||[]),...(doc.sections||[]).flatMap(section=>[section.title,section.body])].some(value=>String(value||'').toLowerCase().includes(query)))}
  function renderNav(){const rows=filtered();if(rows.length&&!rows.some(doc=>doc.id===selected))selected=rows[0].id;$('helpNav').innerHTML=rows.length?rows.map(doc=>`<button type="button" data-help-id="${escapeHtml(doc.id)}" class="${doc.id===selected?'active':''}">${escapeHtml(doc.title)}<span>${escapeHtml(doc.summary)}</span></button>`).join(''):'<div class="help-empty">没有匹配的帮助内容。</div>';$('helpNav').querySelectorAll('[data-help-id]').forEach(button=>button.addEventListener('click',()=>{selected=button.dataset.helpId;try{history.replaceState(null,'','?topic='+encodeURIComponent(selected))}catch(error){}render()}))}
  function renderContent(){const doc=docs.find(item=>item.id===selected);$('helpContent').innerHTML=doc?`<header><h1>${escapeHtml(doc.title)}</h1><p>${escapeHtml(doc.summary)}</p></header>${(doc.sections||[]).map(section=>`<section class="help-section"><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.body)}</p></section>`).join('')}<a class="help-open-page" href="${escapeHtml(doc.href)}">打开对应页面</a>`:'<div class="help-empty">请选择一项帮助内容。</div>'}
  function render(){renderNav();renderContent()}
  function init(){$('helpSearch').addEventListener('input',render);render()}
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init,{once:true}):init();
})(window);
