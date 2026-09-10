(function(global){
 'use strict';
 const copy=v=>JSON.parse(JSON.stringify(v)),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let state=null,host=null;
 const id=prefix=>prefix+'-'+(global.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2));
 function blankMatching(){return {left:[{id:id('l'),text:''},{id:id('l'),text:''}],right:[{id:id('r'),text:''},{id:id('r'),text:''}],correctPairs:{}};}
 function mount(container,question,{onCreateChildren}={}){
  host=container;if(!question){host.innerHTML='';state=null;return;}
  const q=global.KGQuestionMaterials.extension(question);state={id:q.id,type:q.type,images:copy(q.images||[]),matching:copy(q.matching||blankMatching()),material:copy(q.material||{title:'',text:'',images:[]}),caseGroup:copy(q.caseGroup||null),enabled:!!q.caseGroup,dirty:false,onCreateChildren};draw();
 }
 function draw(){if(!host||!state)return;
  const s=state,m=s.material;
  host.innerHTML=`<section class="qm-editor"><h3>图表与案例材料</h3><label>图表说明<input data-rich-alt placeholder="描述图表主题、单位或图例"/></label><label>上传图表<input type="file" data-rich-image accept="image/png,image/jpeg,image/webp"/></label><div data-rich-images>${s.images.map((x,i)=>`<div>${esc(x.alt)} <button type="button" data-rich-remove-image="${i}">移除</button></div>`).join('')}</div><label><input type="checkbox" data-rich-case ${s.enabled?'checked':''} style="width:auto"/> 关联公共案例材料</label><div data-rich-case-panel ${s.enabled?'':'hidden'}><label>选择已有案例<select data-rich-material><option value="">新建案例材料</option>${m.id?`<option value="${esc(m.id)}" selected>${esc(m.title)} · 版本 ${Number(m.revision)}</option>`:''}</select></label><button type="button" data-rich-list>刷新案例列表</button><label>案例标题<input data-rich-title value="${esc(m.title)}"/></label><label>案例正文<textarea data-rich-text rows="7">${esc(m.text)}</textarea></label><label>案例附图说明<input data-rich-case-alt/></label><label>上传案例附图<input type="file" data-rich-case-image accept="image/png,image/jpeg,image/webp"/></label><div>${(m.images||[]).map((x,i)=>`<div>${esc(x.alt)} <button type="button" data-rich-remove-case-image="${i}">移除</button></div>`).join('')}</div><div class="qm-editor-row"><label>本题在案例中的序号<input type="number" min="1" max="180" data-rich-order value="${s.caseGroup?.order||1}"/></label><label>案例小题总数<input type="number" min="2" max="180" data-rich-total value="${s.caseGroup?.total||3}"/></label></div><p>小题独立编辑与计分，组卷时整组加入。修改材料后保存题目会生成新的材料版本。</p><button type="button" data-rich-children>保存本题并补齐案例小题</button></div><p class="qm-editor-error" role="alert"></p></section><section class="qm-editor" data-rich-matching ${s.type==='matching'?'':'hidden'}><h3>匹配内容与正确答案</h3><p>填写两侧内容，再选择每个左侧条目的正确候选。每个候选只能使用一次。</p><div data-rich-pairs>${s.matching.left.map((l,i)=>`<div class="qm-editor-row"><label>条目 ${i+1}<textarea data-rich-left="${i}">${esc(l.text)}</textarea></label><label>候选 ${i+1}<textarea data-rich-right="${i}">${esc(s.matching.right[i]?.text)}</textarea></label><label>正确候选<select data-rich-answer="${esc(l.id)}"><option value="">请选择</option>${s.matching.right.map((r,j)=>`<option value="${esc(r.id)}" ${s.matching.correctPairs[l.id]===r.id?'selected':''}>候选 ${j+1}</option>`).join('')}</select></label><button type="button" data-rich-remove-pair="${i}" ${s.matching.left.length<=2?'disabled':''}>删除</button></div>`).join('')}</div><button type="button" data-rich-add-pair>增加一对</button></section>`;
  host.oninput=()=>capture();
  host.onchange=async event=>{capture();try{
   if(event.target.matches('[data-rich-case]')){state.enabled=event.target.checked;host.querySelector('[data-rich-case-panel]').hidden=!state.enabled;}
   if(event.target.matches('[data-rich-image],[data-rich-case-image]')){const isCase=event.target.hasAttribute('data-rich-case-image'),file=event.target.files[0];if(!file)return;const alt=host.querySelector(isCase?'[data-rich-case-alt]':'[data-rich-alt]').value;event.target.disabled=true;const editing=state;const asset=await global.KGQuestionMaterials.upload(file,alt);if(state!==editing)return;(isCase?state.material.images:state.images).push(asset);if(isCase)state.dirty=true;draw();}
   if(event.target.matches('[data-rich-material]')){const chosen=state.available?.find(m=>m.id===event.target.value);state.material=copy(chosen||{title:'',text:'',images:[]});state.dirty=!chosen;draw();}
  }catch(error){showError(error);event.target.disabled=false;}};
  host.onclick=async event=>{const button=event.target.closest('button');if(!button)return;capture();try{
   if(button.hasAttribute('data-rich-remove-image')){state.images.splice(Number(button.dataset.richRemoveImage),1);draw();}
   if(button.hasAttribute('data-rich-remove-case-image')){state.material.images.splice(Number(button.dataset.richRemoveCaseImage),1);state.dirty=true;draw();}
   if(button.hasAttribute('data-rich-add-pair')){state.matching.left.push({id:id('l'),text:''});state.matching.right.push({id:id('r'),text:''});draw();}
   if(button.hasAttribute('data-rich-remove-pair')){const n=Number(button.dataset.richRemovePair),left=state.matching.left.splice(n,1)[0],right=state.matching.right.splice(n,1)[0];delete state.matching.correctPairs[left.id];Object.keys(state.matching.correctPairs).forEach(k=>{if(state.matching.correctPairs[k]===right.id)delete state.matching.correctPairs[k];});draw();}
   if(button.hasAttribute('data-rich-list')){button.disabled=true;const editing=state;const result=await global.KGQuestionMaterials.request('question-materials');if(state!==editing)return;state.available=result.materials;const select=host.querySelector('[data-rich-material]');select.innerHTML='<option value="">新建案例材料</option>'+state.available.map(m=>`<option value="${esc(m.id)}">${esc(m.title)} · 版本 ${Number(m.revision)}</option>`).join('');select.value=state.material.id||'';button.disabled=false;}
   if(button.hasAttribute('data-rich-children')){button.disabled=true;await state.onCreateChildren?.();button.disabled=false;}
  }catch(error){showError(error);button.disabled=false;}};
 }
 function showError(error){const node=host?.querySelector('.qm-editor-error');if(node)node.textContent=error.message||String(error);}
 function capture(){if(!state||!host)return;
  const order=host.querySelector('[data-rich-order]'),total=host.querySelector('[data-rich-total]');
  if(order&&total)state.caseGroup={id:state.material.id,order:order.value,total:total.value};
  host.querySelectorAll('[data-rich-left]').forEach(el=>{state.matching.left[Number(el.dataset.richLeft)].text=el.value;});
  host.querySelectorAll('[data-rich-right]').forEach(el=>{state.matching.right[Number(el.dataset.richRight)].text=el.value;});
  host.querySelectorAll('[data-rich-answer]').forEach(el=>{if(el.value)state.matching.correctPairs[el.dataset.richAnswer]=el.value;else delete state.matching.correctPairs[el.dataset.richAnswer];});
  const title=host.querySelector('[data-rich-title]')?.value||'',text=host.querySelector('[data-rich-text]')?.value||'';
  if(title!==state.material.title||text!==state.material.text)state.dirty=true;
  state.material.title=title;state.material.text=text;
 }
 async function flush(question){if(!state||state.id!==question.id)return;capture();if(!state.enabled)return;
  const order=Number(host.querySelector('[data-rich-order]').value),total=Number(host.querySelector('[data-rich-total]').value);
  if(!Number.isInteger(total)||total<2||total>180||!Number.isInteger(order)||order<1||order>total)throw new Error('案例总数须为 2–180，本题序号不能超过总数。');
  if(!state.material.title.trim()||!state.material.text.trim())throw new Error('请填写案例标题与正文。');

  state.caseGroup={id:state.material.id,order,total};
 }
 function collect(question){if(!state||state.id!==question.id)return question;capture();const result={...question,images:copy(state.images)};
  if(question.type==='matching'){result.matching=copy(state.matching);result.options=[];result.correctAnswer=null;result.correctOptionIds=[];}else delete result.matching;
  if(state.enabled){result.material=copy(state.material);if(state.dirty||!state.material.id)result.materialEdit=copy(state.material);result.caseGroup={id:state.material.id,order:Number(host.querySelector('[data-rich-order]').value),total:Number(host.querySelector('[data-rich-total]').value)};}else{delete result.material;delete result.caseGroup;delete result.materialEdit;}
  result.metadata={...(result.metadata||{})};for(const key of ['images','matching','material','caseGroup']){if(result[key]!=null)result.metadata[key]=copy(result[key]);else delete result.metadata[key];}return result;
 }
 function setType(type){if(!state)return;capture();state.type=type;const panel=host.querySelector('[data-rich-matching]');if(panel)panel.hidden=type!=='matching';}
 global.KGQuestionRichEditor=Object.freeze({mount,collect,flush,setType,blankMatching});
})(window);
