(function(global){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const answer=()=>global.KGQuestionAnswerSet;
  function safeUrl(value){const url=String(value||'');return /^\/api\/v1\/question-assets\/[\w-]+$/.test(url)?url:'';}
  function extension(question){return {...(question?.metadata||{}),...(question?.raw||{}),...question};}
  function images(rows){return (Array.isArray(rows)?rows:[]).map(image=>{
    const url=safeUrl(image?.url);if(!url)return '';
    return `<figure class="qm-image"><button type="button" class="qm-zoom" data-qm-zoom="${esc(url)}" aria-label="放大图表：${esc(image.alt||'题目图表')}"><img src="${esc(url)}" alt="${esc(image.alt||'题目图表')}" loading="lazy"/></button><figcaption>${esc(image.alt||'点击图表放大')}</figcaption><button type="button" data-qm-retry hidden>图表加载失败，点击重试</button></figure>`;
  }).join('');}
  function renderMaterials(question){
    const q=extension(question),m=q.material;
    return (m?`<details class="qm-case" data-case-id="${esc(m.id)}" open><summary>${esc(m.title||'案例材料')}${q.caseGroup?` · 第 ${Number(q.caseGroup.order)||1} / ${Number(q.caseGroup.total)||1} 小题`:''}</summary><div class="qm-case-body"><div class="qm-text">${esc(m.text||'')}</div>${images(m.images)}</div></details>`:'')+images(q.images);
  }
  function renderMatching(question,{selectedPairs={},readOnly=false,reveal=false}={}){
    const q=extension(question),m=q.matching||{},selected=answer()?.pairs(q,selectedPairs)||{},right=m.right||[];
    return `<section class="qm-matching" aria-label="匹配作答"><p class="qm-help">${readOnly?'配对结果':'先选择左侧条目，再点击候选答案；也可把候选拖入条目。'}</p><div class="qm-pairs">${(m.left||[]).map((item,index)=>{
      const match=right.find(r=>r.id===selected[item.id]),correct=right.find(r=>r.id===m.correctPairs?.[item.id]);
      return `<div class="qm-pair${reveal?(match?.id===correct?.id?' is-correct':' is-wrong'):''}"><button type="button" class="qm-target" data-qm-left="${esc(item.id)}" ${readOnly?'disabled':''} aria-pressed="false"><b>${index+1}. ${esc(item.text)}</b><span>${esc(match?.text||'选择或拖入答案')}</span></button>${match&&!readOnly?`<button type="button" class="qm-clear" data-qm-clear="${esc(item.id)}" aria-label="取消第 ${index+1} 项配对">取消</button>`:''}${reveal?`<p class="qm-pair-feedback">${match?.id===correct?.id?'✓ 配对正确':'正确配对：'+esc(correct?.text||'未设置')}</p>`:''}</div>`;
    }).join('')}</div>${readOnly?'':`<div class="qm-candidates" aria-label="候选答案">${right.map(item=>`<button type="button" class="qm-candidate" draggable="true" data-qm-right="${esc(item.id)}" aria-label="候选：${esc(item.text)}">${esc(item.text)}${Object.values(selected).includes(item.id)?'<small>已配对，可重新分配</small>':''}</button>`).join('')}</div>`}<p class="qm-status" role="status" aria-live="polite"></p></section>`;
  }
  function bindMedia(container){
    if(!container||container.dataset.qmMediaBound)return;
    container.dataset.qmMediaBound='true';
    container.addEventListener('error',event=>{if(event.target.tagName==='IMG'){const retry=event.target.closest('.qm-image')?.querySelector('[data-qm-retry]');if(retry)retry.hidden=false;}},true);
    container.addEventListener('load',event=>{if(event.target.tagName==='IMG'){const retry=event.target.closest('.qm-image')?.querySelector('[data-qm-retry]');if(retry)retry.hidden=true;}},true);
    container.addEventListener('click',event=>{
      const retry=event.target.closest('[data-qm-retry]');if(retry){const img=retry.closest('.qm-image').querySelector('img');retry.textContent='正在重试…';img.src=img.getAttribute('src');setTimeout(()=>{retry.textContent='图表加载失败，点击重试';},1000);return;}
      const zoom=event.target.closest('[data-qm-zoom]');if(!zoom)return;
      const dialog=document.createElement('dialog');dialog.className='qm-image-dialog';
      dialog.innerHTML=`<button type="button" aria-label="关闭图表">关闭</button><img src="${esc(safeUrl(zoom.dataset.qmZoom))}" alt="${esc(zoom.querySelector('img')?.alt||'题目图表')}"/>`;
      dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{dialog.remove();zoom.focus();});document.body.append(dialog);dialog.showModal();
    });
  }
  function bind(container,{question,selectedPairs={},readOnly=false,reveal=false,onChange=()=>{}}={}){
    bindMedia(container);
    const q=extension(question);let selected=answer()?.pairs(q,selectedPairs)||{},active='';
    function status(message){const node=container.querySelector('.qm-status');if(node)node.textContent=message;}
    function draw(){container.innerHTML=renderMatching(q,{selectedPairs:selected,readOnly,reveal});}
    function assign(left,right){if(readOnly)return;selected=answer().assignPair(q,selected,left,right);active='';draw();onChange({...selected});const next=q.matching.left.find(item=>!selected[item.id])?.id||left;Array.from(container.querySelectorAll('[data-qm-left]')).find(el=>el.dataset.qmLeft===next)?.focus();status(`已配对 ${Object.keys(selected).length} / ${q.matching.left.length} 项`);}
    draw();
    container.onclick=event=>{
      const clear=event.target.closest('[data-qm-clear]');if(clear){assign(clear.dataset.qmClear,'');return;}
      const left=event.target.closest('[data-qm-left]');if(left&&!readOnly){active=left.dataset.qmLeft;container.querySelectorAll('[data-qm-left]').forEach(el=>el.setAttribute('aria-pressed',String(el===left)));status('请选择候选答案');return;}
      const right=event.target.closest('[data-qm-right]');if(right){if(!active){status('请先选择一个左侧条目');return;}assign(active,right.dataset.qmRight);}
    };
    container.ondragstart=event=>{const right=event.target.closest('[data-qm-right]');if(right){event.dataTransfer.setData('text/plain',right.dataset.qmRight);event.dataTransfer.effectAllowed='move';}};
    container.ondragover=event=>{if(!readOnly&&event.target.closest('[data-qm-left]'))event.preventDefault();};
    container.ondrop=event=>{const left=event.target.closest('[data-qm-left]');if(left&&!readOnly){event.preventDefault();const right=event.dataTransfer?.getData('text/plain');if(q.matching.right.some(item=>item.id===right))assign(left.dataset.qmLeft,right);}};
    return {value:()=>({...selected})};
  }
  function render(question,options={}){return renderMaterials(question)+(question?.type==='matching'?renderMatching(question,options):'');}
  async function request(path,{method='GET',body}={}){
    const response=await global.fetch('/api/v1/'+path,{method,credentials:'include',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){const detail=payload.detail;throw new Error(typeof detail==='string'?detail:detail?.message||`请求失败（${response.status}）`);}return payload;
  }
  async function upload(file,alt){
    if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw new Error('请上传不超过 5 MB 的 PNG、JPEG 或 WebP 图片。');
    if(!String(alt||'').trim())throw new Error('请填写图表说明。');
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('无法读取图片，请重新选择'));reader.readAsDataURL(file);});
    return (await request('question-assets',{method:'POST',body:{filename:file.name,mimeType:file.type,dataBase64:data,alt}})).asset;
  }
  global.KGQuestionMaterials=Object.freeze({render,renderMaterials,renderMatching,bind,bindMedia,extension,safeUrl,request,upload});
})(typeof window!=='undefined'?window:globalThis);
