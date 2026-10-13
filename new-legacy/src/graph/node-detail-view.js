'use strict';
(function(global){
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function render(node,{relationMarkup='',imagesMarkup=''}={}){
    const model=global.KGGraphModel,content=model.contentOf(node),color=model.safeColor(model.appearanceOf(node).color);
    return `<div class="detail-top"><div class="detail-mini-icon" style="background:${color}">${escape(content.title.slice(0,1))}</div><div><div class="detail-name">${escape(content.title)}</div><div class="detail-title">${escape(content.category||'未填写分类')}${content.level?` ｜${escape(content.level)}`:''}</div></div></div><div class="detail-grid">${relationMarkup}<div class="label">关键词</div><div>${escape(content.keywords||'—')}</div><div class="label">说明</div><div>${escape(content.description||'—')}</div><div class="label">学习提示</div><div>${escape(content.notes||'—')}</div></div>${imagesMarkup}`;
  }
  global.KGGraphNodeDetailView=Object.freeze({render});
  if(typeof module!=='undefined')module.exports=global.KGGraphNodeDetailView;
})(typeof window!=='undefined'?window:globalThis);
