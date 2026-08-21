/* 题目编辑体验增强（自单机版 P4.5.29 移植）：
 * ① 公共标签专用编辑器（勾选式 catalog → 同步 q.tags 与结构化 tagPaths，未归类标签可删）
 * ② 辅助知识点关联编辑（搜索/添加/移除 relatedNodeIds）
 * ③ 粘性浮动题目预览（可拖拽/缩放，双击题目列表打开）与题目列表顶部收起 */
'use strict';

function normalizeKnowledgeSearchText(v){return String(v||'').trim().toLowerCase().replace(/\s+/g,' ')}
function knowledgeTreeMatches(term=''){
  if(!state.knowledgeTree)return [];
  const q=normalizeKnowledgeSearchText(term);
  if(!q)return state.knowledgeTree.nodes.slice();
  const tokens=q.split(' ').filter(Boolean);
  return state.knowledgeTree.nodes.filter(n=>{
    const path=state.knowledgeTree.pathFor(n.id).join(' > ');
    const hay=normalizeKnowledgeSearchText([path,n.id,n.title||'',n.titleEn||''].join(' '));
    return hay.includes(q)||(tokens.length>1&&tokens.every(t=>hay.includes(t)));
  });
}

/* ① 公共标签编辑器 */
function questionTagEditorHtml(q){
  q.metadata=q.metadata||{};
  const tags=unique((q?.tags||[]).map(canonicalTagName).filter(Boolean)),catalog=tagCatalogEntries(),bySlot=new Map(catalog.map(x=>[x.slot,x]));
  const storedSlots=unique((q.metadata.tagSlotIds||[]).map(semanticTagSlot).filter(x=>bySlot.has(x)));
  const inferredSlots=unique((q.metadata.tagPaths||[]).map(p=>semanticTagSlot(p?.slotId||'')).filter(x=>bySlot.has(x)));
  const labelSlots=unique(tags.map(t=>catalog.find(x=>x.label===t)?.slot).filter(Boolean));
  const selectedSlots=new Set(unique([...storedSlots,...inferredSlots,...labelSlots]));
  const catalogLabels=new Set(catalog.map(x=>x.label));
  const unknown=tags.filter(t=>!catalogLabels.has(t));
  const groups=effectiveTagGroups();
  const grouped=groups.map(g=>`<div class="question-tag-group"><div class="question-tag-group-title">${esc(g.label)}</div>${g.categories.map(c=>`<div class="question-tag-category"><div class="question-tag-category-title">${esc(c.label)}</div><div class="question-tag-options">${c.options.map((label,i)=>{const slot=tagSlotKey(g,c,i);return `<label><input type="checkbox" data-question-global-tag-slot="${esc(slot)}"${selectedSlots.has(slot)?' checked':''}>${esc(label)}</label>`}).join('')}</div></div>`).join('')}</div>`).join('');
  return `<div class="question-tag-editor">${grouped}${unknown.length?`<div class="unclassified-tags"><b>未归类标签</b><div class="muted tiny">这些标签未映射到②公共标签 Schema，不会生成结构化 tagPaths。可删除，或在②页配置 Alias 后归一。</div><div class="chip-row">${unknown.map(tag=>`<span class="unclassified-tag">${esc(tag)}<button type="button" data-remove-unclassified-tag="${esc(tag)}" title="删除未归类标签">×</button></span>`).join('')}</div></div>`:''}</div>`;
}
function syncQuestionTagsFromEditor(q,box){
  const catalog=tagCatalogEntries(),bySlot=new Map(catalog.map(x=>[x.slot,x]));
  const slots=unique([...box.querySelectorAll('[data-question-global-tag-slot]:checked')].map(el=>semanticTagSlot(el.dataset.questionGlobalTagSlot)).filter(x=>bySlot.has(x)));
  const catalogLabels=new Set(catalog.map(x=>x.label));
  const legacyUnknown=unique((q.tags||[]).map(canonicalTagName).filter(t=>t&&!catalogLabels.has(t)));
  q.metadata=q.metadata||{};q.metadata.tagSlotIds=slots;
  q.metadata.tagPaths=slots.map(slot=>{const e=bySlot.get(slot);return {scope:'global',slotId:e.slot,groupId:e.groupId,group:e.group,categoryId:e.categoryId,category:e.category,label:e.label}});
  q.tags=unique([...slots.map(slot=>bySlot.get(slot)?.label).filter(Boolean),...legacyUnknown]);
}
function renderQuestionTagEditor(){
  const q=currentQuestion(),box=document.getElementById('questionTagEditor');if(!q||!box)return;
  box.innerHTML=questionTagEditorHtml(q);
  box.querySelectorAll('[data-question-global-tag-slot]').forEach(el=>el.addEventListener('change',()=>{
    syncQuestionTagsFromEditor(q,box);state.questionBank.updatedAt=Date.now();renderCurrentIssues();markWorkspaceDirty();
  }));
  box.querySelectorAll('[data-remove-unclassified-tag]').forEach(btn=>btn.addEventListener('click',()=>{
    const target=canonicalTagName(btn.dataset.removeUnclassifiedTag);
    q.tags=unique((q.tags||[]).map(canonicalTagName).filter(t=>t&&t!==target));
    q.metadata=q.metadata||{};q.metadata.tagPaths=q.tags.map(tagPathFor).filter(Boolean);
    state.questionBank.updatedAt=Date.now();renderQuestionTagEditor();renderCurrentIssues();markWorkspaceDirty();
  }));
}

/* ② 辅助知识点关联编辑 */
function relatedKnowledgeOptions(term=''){
  const q=currentQuestion();if(!q||!state.knowledgeTree)return '<option value="">未加载知识树</option>';
  const primary=q.metadata?.knowledge?.primaryNodeId||'',selected=new Set(q.metadata?.knowledge?.relatedNodeIds||[]);
  const nodes=knowledgeTreeMatches(term).filter(n=>n.id!==primary&&!selected.has(n.id));
  let html='<option value="">— 选择辅助知识点 —</option>';
  html+=nodes.map(n=>`<option value="${esc(n.id)}">${esc(state.knowledgeTree.pathFor(n.id).join(' > '))} [${esc(n.id)}]</option>`).join('');
  if(term&&!nodes.length)html+='<option value="" disabled>没有可添加的匹配知识点</option>';
  return html;
}
function renderRelatedKnowledgeUi(term=''){
  const q=currentQuestion(),sel=document.getElementById('relatedNodeSelect'),chips=document.getElementById('relatedKnowledgeChips'),meta=document.getElementById('relatedNodeSearchMeta');if(!q||!sel||!chips)return;
  const knowledge=q.metadata.knowledge=q.metadata.knowledge||{},primary=knowledge.primaryNodeId||'';
  knowledge.relatedNodeIds=unique((knowledge.relatedNodeIds||[]).map(String).filter(id=>id&&id!==primary));
  sel.innerHTML=relatedKnowledgeOptions(term);
  chips.innerHTML=knowledge.relatedNodeIds.length?knowledge.relatedNodeIds.map(id=>{
    const node=state.knowledgeTree?.map.get(id),label=node?state.knowledgeTree.pathFor(id).join(' > '):id;
    return `<span class="related-knowledge-chip"><span title="${esc(id)}">${esc(label)}</span><button type="button" data-remove-related-node="${esc(id)}" title="移除辅助知识点">×</button></span>`;
  }).join(''):'<span class="muted tiny">尚未选择辅助知识点。</span>';
  chips.querySelectorAll('[data-remove-related-node]').forEach(btn=>btn.addEventListener('click',()=>{
    knowledge.relatedNodeIds=knowledge.relatedNodeIds.filter(id=>id!==btn.dataset.removeRelatedNode);
    renderRelatedKnowledgeUi(document.getElementById('relatedNodeSearch')?.value||'');renderCurrentIssues();markWorkspaceDirty();
  }));
  if(meta){
    const matches=state.knowledgeTree?knowledgeTreeMatches(term).filter(n=>n.id!==primary&&!knowledge.relatedNodeIds.includes(n.id)).length:0;
    meta.textContent=state.knowledgeTree?(term?`可添加匹配 ${matches} 个 · 已选 ${knowledge.relatedNodeIds.length} 个`:`已选 ${knowledge.relatedNodeIds.length} 个辅助知识点 · 支持名称 / 路径 / Node ID 搜索`):'尚未加载知识树';
  }
}

/* ③ 浮动题目预览 + 列表顶部收起 */
function toggleQuestionListTop(){
  const card=document.getElementById('questionListCard'),btn=document.getElementById('btnToggleQuestionListTop');if(!card||!btn)return;
  const collapsed=card.classList.toggle('top-collapsed');
  btn.setAttribute('aria-expanded',collapsed?'false':'true');
  btn.title=collapsed?'展开题目列表顶部标签和按钮':'收起题目列表顶部标签和按钮';
}
function openQuestionPreviewFloat(){
  const box=document.getElementById('questionPreviewFloat'),q=currentQuestion();if(!box||!q)return;
  renderPreview();
  box.classList.add('show');box.setAttribute('aria-hidden','false');
  keepQuestionPreviewFloatInViewport();
}
function closeQuestionPreviewFloat(){
  const box=document.getElementById('questionPreviewFloat');if(!box)return;
  box.classList.remove('show');box.setAttribute('aria-hidden','true');hideKeywordFloat();
}
function keepQuestionPreviewFloatInViewport(){
  const box=document.getElementById('questionPreviewFloat');if(!box||!box.classList.contains('show'))return;
  const r=box.getBoundingClientRect(),pad=8;
  const left=Math.max(pad,Math.min(r.left,window.innerWidth-Math.min(r.width,window.innerWidth-pad*2)-pad));
  const top=Math.max(pad,Math.min(r.top,window.innerHeight-Math.min(r.height,window.innerHeight-pad*2)-pad));
  box.style.left=left+'px';box.style.top=top+'px';box.style.right='auto';
}
function initQuestionPreviewFloatDrag(){
  const box=document.getElementById('questionPreviewFloat'),head=document.getElementById('questionPreviewFloatHead');if(!box||!head)return;
  let drag=null;
  head.addEventListener('pointerdown',e=>{
    if(e.button!==0||e.target.closest('button'))return;
    const r=box.getBoundingClientRect();
    drag={x:e.clientX,y:e.clientY,left:r.left,top:r.top};
    box.style.left=r.left+'px';box.style.top=r.top+'px';box.style.right='auto';
    head.setPointerCapture?.(e.pointerId);e.preventDefault();
  });
  head.addEventListener('pointermove',e=>{
    if(!drag)return;
    const w=box.offsetWidth,h=box.offsetHeight,pad=8;
    const left=Math.max(pad,Math.min(window.innerWidth-w-pad,drag.left+e.clientX-drag.x));
    const top=Math.max(pad,Math.min(window.innerHeight-h-pad,drag.top+e.clientY-drag.y));
    box.style.left=left+'px';box.style.top=top+'px';
  });
  const stop=e=>{if(!drag)return;drag=null;try{head.releasePointerCapture?.(e.pointerId)}catch(_){}};
  head.addEventListener('pointerup',stop);head.addEventListener('pointercancel',stop);
  window.addEventListener('resize',keepQuestionPreviewFloatInViewport);
}

document.addEventListener('DOMContentLoaded',()=>{
  const collapseBtn=document.getElementById('btnToggleQuestionListTop');
  if(collapseBtn)collapseBtn.addEventListener('click',toggleQuestionListTop);
  const closeFloat=document.getElementById('btnCloseQuestionPreviewFloat');
  if(closeFloat)closeFloat.addEventListener('click',closeQuestionPreviewFloat);
  initQuestionPreviewFloatDrag();
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&document.getElementById('questionPreviewFloat')?.classList.contains('show')){e.preventDefault();closeQuestionPreviewFloat()}
  });
});
