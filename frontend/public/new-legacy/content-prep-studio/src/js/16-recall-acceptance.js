/*
 * P4.5.29 联想库验收器（页签④）
 * 参照《联想库快速验收器 V8 · 智能记录版》移植：模拟深度回忆走库、
 * 自动记录未命中/过宽词/多义/断链/单候选，支持人工判定与备注，
 * 可导出 JSON / Markdown 验收报告。默认验收当前工作区联想库。
 * 记录持久化键：pmp_recall_acceptance_records_v1（会话外仍保留，最近 2000 条）。
 */
const RA_STORAGE_KEY='pmp_recall_acceptance_records_v1';
const RA_PAGE_SIZE=4;
const RA={L:null,LSource:'',byId:new Map(),titles:new Map(),aliases:new Map(),outs:new Map(),path:[],page:0,records:[],lastRecordId:null};

function raEsc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function raN(s){return String(s??'').trim().replace(/\s+/g,' ').toLocaleLowerCase()}
function raIso(){return new Date().toISOString()}
function raRid(){return 'ra-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7)}
function raAddIndex(m,k,id){if(!k)return;if(!m.has(k))m.set(k,[]);if(!m.get(k).includes(id))m.get(k).push(id)}
function raIndex(){
  RA.byId=new Map();RA.titles=new Map();RA.aliases=new Map();RA.outs=new Map();
  for(const n of RA.L?.nodes||[]){
    RA.byId.set(n.id,n);raAddIndex(RA.titles,raN(n.title),n.id);raAddIndex(RA.titles,raN(n.titleEn),n.id);
    for(const a of n.aliases||[])raAddIndex(RA.aliases,raN(a),n.id);
  }
  for(const e of RA.L?.edges||[]){if(!RA.outs.has(e.from))RA.outs.set(e.from,[]);RA.outs.get(e.from).push(e)}
  for(const a of RA.outs.values())a.sort((x,y)=>(y.priority||0)-(x.priority||0));
}
function raSyncFromWorkspace(force=false){
  const lib=state.recallLibrary;
  if(!force&&RA.LSource==='workspace'&&RA.L===lib)return;
  RA.L=lib;RA.LSource='workspace';RA.path=[];RA.page=0;raIndex();
}
function raResolve(q){
  if(RA.byId.has(q))return{ids:[q],mode:'ID'};
  const k=raN(q),t=RA.titles.get(k)||[];
  if(t.length)return{ids:t,mode:'正式标题'};
  return{ids:RA.aliases.get(k)||[],mode:'Alias'};
}
function raCurrent(){return RA.path[RA.path.length-1]}
function raEligibleFor(id,pth=RA.path){
  if(!id)return[];
  const ancestors=new Set(pth.slice(0,-1));
  return(RA.outs.get(id)||[]).filter(e=>e.to!==id&&!ancestors.has(e.to)&&RA.byId.has(e.to));
}
function raPathTitles(pth=RA.path){return pth.map(id=>RA.byId.get(id)?.title||id)}
function raAutoStatusFor(count){return count===0?'断链':count===1?'单候选':'可继续'}
function raPersist(){try{localStorage.setItem(RA_STORAGE_KEY,JSON.stringify(RA.records.slice(-2000)))}catch(e){}}
function raRestore(){try{const raw=localStorage.getItem(RA_STORAGE_KEY);if(raw){const a=JSON.parse(raw);if(Array.isArray(a))RA.records=a}}catch(e){}}
function raLatest(){return [...RA.records].reverse().find(r=>r.id===RA.lastRecordId)}
function raAddRecord(rec){
  rec.id=raRid();rec.at=raIso();rec.manualVerdict='';rec.note='';
  RA.records.push(rec);RA.lastRecordId=rec.id;raPersist();raRenderRecords();
  return rec;
}
function raRecordNodeEntry(id,source,query='',mode=''){
  const c=raEligibleFor(id),n=RA.byId.get(id);
  return raAddRecord({
    type:'node',source,query,matchMode:mode,
    nodeId:id,nodeTitle:n?.title||id,
    autoStatus:raAutoStatusFor(c.length),candidateCount:c.length,
    firstChoices:c.slice(0,4).map(e=>({id:e.to,title:RA.byId.get(e.to)?.title||e.to,label:e.label||'',priority:e.priority??null})),
    path:raPathTitles()
  });
}
function raRecordMiss(query){
  const broad=(RA.L?.metadata?.testerBroadTerms&&RA.L.metadata.testerBroadTerms[query])||'';
  if(broad)return raAddRecord({type:'input',source:'input',query,matchMode:'',nodeId:'',nodeTitle:'',autoStatus:'过宽词',candidateCount:0,firstChoices:[],path:raPathTitles(),suggestion:broad});
  return raAddRecord({type:'input',source:'input',query,matchMode:'',nodeId:'',nodeTitle:'',autoStatus:'未命中',candidateCount:0,firstChoices:[],path:raPathTitles()});
}
function raRecordAmbiguous(query,ids){
  return raAddRecord({type:'input',source:'input',query,matchMode:'',nodeId:'',nodeTitle:'',autoStatus:'多义',candidateCount:null,
    matches:ids.map(id=>({id,title:RA.byId.get(id)?.title||id})),firstChoices:[],path:raPathTitles()});
}
function raSetStatus(s,cls=''){const el=document.getElementById('raStatus');if(!el)return;el.className='ra-status '+(cls||'');el.innerHTML=s}
function raLibraryLabel(){return RA.LSource==='workspace'?'当前工作区联想库':'临时载入的外部 JSON'}
function raRenderCurrent(mode=''){
  const box=document.getElementById('raCurrent');if(!box)return;
  if(!raCurrent()){box.innerHTML='<div class="ra-empty">输入关键词或点击快速入口开始。</div>';return}
  const n=RA.byId.get(raCurrent()),al=(n.aliases||[]).map(raEsc).join(' · ');
  box.innerHTML=`<h2>${raEsc(n.title)}</h2>${n.titleEn?`<div class="ra-en">${raEsc(n.titleEn)}</div>`:''}
  <div class="ra-prompt">${raEsc(n.prompt||'')}</div>${n.hint?`<div class="ra-hint">${raEsc(n.hint)}</div>`:''}
  <div class="ra-pills"><span class="ra-pill">ID: ${raEsc(n.id)}</span><span class="ra-pill">Priority: ${raEsc(n.priority??'—')}</span>${mode?`<span class="ra-pill">${raEsc(mode)}</span>`:''}</div>
  <details><summary>查看 Alias</summary><div class="ra-aliases">${al||'无'}</div></details>`;
}
function raRenderPath(){
  const b=document.getElementById('raPath');if(!b)return;
  if(!RA.path.length){b.innerHTML='<span class="muted tiny">暂无</span>';return}
  b.innerHTML=RA.path.map((id,i)=>`<button class="btn small ra-crumb" data-ra-i="${i}">${raEsc(RA.byId.get(id)?.title||id)}</button>`).join('');
  b.querySelectorAll('[data-ra-i]').forEach(x=>x.onclick=()=>{
    RA.path=RA.path.slice(0,Number(x.dataset.raI)+1);RA.page=0;raRenderAll();
    raRecordNodeEntry(raCurrent(),'path-jump','','路径回跳');
  });
}
function raRenderChoices(){
  const info=document.getElementById('raInfo'),box=document.getElementById('raChoices');if(!box)return;
  const a=raEligibleFor(raCurrent()),pages=Math.max(1,Math.ceil(a.length/RA_PAGE_SIZE));
  if(RA.page>=pages)RA.page=0;
  const s=a.slice(RA.page*RA_PAGE_SIZE,RA.page*RA_PAGE_SIZE+RA_PAGE_SIZE);
  if(info)info.textContent=a.length?`有效候选 ${a.length} 个 · 第 ${RA.page+1}/${pages} 组`:'有效候选 0 个';
  box.innerHTML=s.length?s.map(e=>`<button class="ra-choice" data-ra-to="${raEsc(e.to)}">
    <div class="ra-ct">${raEsc(RA.byId.get(e.to)?.title||e.to)}<span class="ra-pri">${raEsc(e.priority??'')}</span></div>
    <div class="ra-cl">${raEsc(e.label||'关联')}</div></button>`).join(''):
    '<div class="ra-empty">没有更多系统推荐。此状态会自动记录为"断链"；也可以继续手动输入词测试能否重新接库。</div>';
  box.querySelectorAll('[data-ra-to]').forEach(x=>x.onclick=()=>{
    RA.path.push(x.dataset.raTo);RA.page=0;raRenderAll();raRecordNodeEntry(x.dataset.raTo,'click','','候选点击');
  });
  const next=document.getElementById('raNext'),back=document.getElementById('raBack');
  if(next)next.disabled=a.length<=RA_PAGE_SIZE;
  if(back)back.disabled=RA.path.length<=1;
}
function raRenderRecords(){
  const sum=document.getElementById('raSummary'),box=document.getElementById('raLog');if(!box)return;
  const total=RA.records.length;
  const counts=k=>RA.records.filter(r=>r.autoStatus===k).length;
  const manualBad=RA.records.filter(r=>r.manualVerdict&&r.manualVerdict!=='正常').length;
  if(sum)sum.innerHTML=[
    ['记录',total],['未命中',counts('未命中')],['过宽词',counts('过宽词')],['多义',counts('多义')],
    ['断链',counts('断链')],['单候选',counts('单候选')],['人工问题',manualBad]
  ].map(([l,n])=>`<div class="ra-stat"><b>${n}</b><span>${l}</span></div>`).join('');
  if(!total){box.innerHTML='<div class="ra-logitem muted tiny">暂无记录。</div>';return}
  box.innerHTML=RA.records.slice(-120).reverse().map(r=>{
    const cls=['未命中','断链'].includes(r.autoStatus)?'bad':(['多义','单候选','过宽词'].includes(r.autoStatus)?'warn':'ok');
    const name=r.query?`输入“${raEsc(r.query)}”${r.nodeTitle?' → '+raEsc(r.nodeTitle):''}`:raEsc(r.nodeTitle||r.type);
    const manual=r.manualVerdict?` · 人工：<b>${raEsc(r.manualVerdict)}</b>`:'';
    const note=r.note?`<div>备注：${raEsc(r.note)}</div>`:'';
    const suggestion=r.suggestion?`<div>建议：${raEsc(r.suggestion)}</div>`:'';
    const choices=(r.firstChoices||[]).length?`<div>第一屏：${r.firstChoices.map(x=>raEsc(x.title)).join(' / ')}</div>`:'';
    return `<div class="ra-logitem"><div class="ra-logtop"><b>${name}</b><span class="ra-tag ${cls}">${raEsc(r.autoStatus||'')}</span></div>
      <div>候选：${r.candidateCount??'—'}${manual}</div>${choices}${suggestion}${note}</div>`;
  }).join('');
}
function raRenderAll(mode=''){raRenderCurrent(mode);raRenderChoices();raRenderPath()}
/* 全局入口：setTab/refreshAll/导入事件以 renderRecallAcceptance 调用本模块 */
function renderRecallAcceptance(){raRenderAcceptance()}
function raRenderAcceptance(){
  const box=document.getElementById('raChoices');if(!box)return;
  raSyncFromWorkspace();
  const src=document.getElementById('raLibrarySource');
  if(src)src.textContent=`${raLibraryLabel()}：${(RA.L?.nodes||[]).length} 节点 / ${(RA.L?.edges||[]).length} 边`;
  raRenderAll();raRenderRecords();
}
function raSubmit(q){
  q=String(q||'').trim();if(!q)return;
  raSyncFromWorkspace();
  if(!(RA.L?.nodes||[]).length){raSetStatus('联想库为空：请先在“① 基础数据与导入”导入联想库，或在此载入 JSON。','bad');return}
  const r=raResolve(q);
  if(r.ids.length===1){
    const id=r.ids[0];RA.path.push(id);RA.page=0;raRenderAll(r.mode);
    raRecordNodeEntry(id,'input',q,r.mode);
    raSetStatus(`✓ <b>${raEsc(q)}</b> → <b>${raEsc(RA.byId.get(id).title)}</b>（${r.mode}）`,'ok');
  }else if(r.ids.length>1){
    raRecordAmbiguous(q,r.ids);
    raSetStatus(`“${raEsc(q)}”命中多个节点：`+r.ids.map(id=>`<button class="btn small ra-crumb" data-ra-id="${raEsc(id)}">${raEsc(RA.byId.get(id)?.title||id)}</button>`).join(' '),'warn');
    document.getElementById('raStatus')?.querySelectorAll('[data-ra-id]').forEach(x=>x.onclick=()=>{
      RA.path.push(x.dataset.raId);RA.page=0;raRenderAll('消歧选择');raRecordNodeEntry(x.dataset.raId,'disambiguation',q,'消歧选择');
      raSetStatus('已手动消歧。','ok');
    });
  }else{
    const rec=raRecordMiss(q);
    if(rec.autoStatus==='过宽词')raSetStatus(`输入词过宽：<b>${raEsc(q)}</b>。${raEsc(rec.suggestion||'建议补充更具体上下文。')}`,'warn');
    else raSetStatus(`未命中：<b>${raEsc(q)}</b>。已自动记录为“未命中”。`,'bad');
  }
  const input=document.getElementById('raQuery');if(input)input.select();
}
function raFocusNode(nodeId){
  raSyncFromWorkspace();
  if(!RA.byId.has(nodeId))return false;
  RA.path.push(nodeId);RA.page=0;raRenderAll('演示跳转');raRecordNodeEntry(nodeId,'demo-jump','','演示跳转');
  return true;
}
function raUpdateLatest(verdict,noteOnly=false){
  const r=raLatest(),status=document.getElementById('raNoteStatus');
  if(!r){if(status)status.textContent='还没有记录。';return}
  if(!noteOnly)r.manualVerdict=verdict;
  const note=document.getElementById('raNote');
  r.note=note?note.value.trim():'';
  r.updatedAt=raIso();raPersist();raRenderRecords();
  if(status)status.textContent=`已保存到：${r.query||r.nodeTitle||r.autoStatus}`;
}
function raReportObject(){
  const summary={
    total:RA.records.length,
    unresolved:RA.records.filter(r=>r.autoStatus==='未命中').length,
    broadTerms:RA.records.filter(r=>r.autoStatus==='过宽词').length,
    ambiguous:RA.records.filter(r=>r.autoStatus==='多义').length,
    deadEnds:RA.records.filter(r=>r.autoStatus==='断链').length,
    singleChoice:RA.records.filter(r=>r.autoStatus==='单候选').length,
    manualNormal:RA.records.filter(r=>r.manualVerdict==='正常').length,
    manualIssues:RA.records.filter(r=>r.manualVerdict&&r.manualVerdict!=='正常').length
  };
  return{
    reportType:'PMP Recall Association Acceptance Report',
    testerVersion:'V8-recording · Prep Studio integration',
    exportedAt:raIso(),
    librarySource:raLibraryLabel(),
    library:{updatedAt:RA.L?.updatedAt||'',nodeCount:(RA.L?.nodes||[]).length,edgeCount:(RA.L?.edges||[]).length},
    summary,records:RA.records
  };
}
function raDownload(name,text,type){
  const blob=new Blob([text],{type:type||'text/plain;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);
}

/* ── 事件绑定（脚本位于 body 末尾，元素已就绪）──────────── */
function raBindEvents(){
  const go=document.getElementById('raGo'),input=document.getElementById('raQuery');
  if(!go||!input)return;
  go.onclick=()=>raSubmit(input.value);
  input.onkeydown=e=>{if(e.key==='Enter')raSubmit(e.currentTarget.value)};
  document.querySelectorAll('[data-raq]').forEach(x=>x.onclick=()=>{input.value=x.dataset.raq;raSubmit(x.dataset.raq)});
  const next=document.getElementById('raNext'),back=document.getElementById('raBack');
  if(next)next.onclick=()=>{const a=raEligibleFor(raCurrent());if(a.length>RA_PAGE_SIZE){RA.page=(RA.page+1)%Math.ceil(a.length/RA_PAGE_SIZE);raRenderChoices()}};
  if(back)back.onclick=()=>{if(RA.path.length>1){RA.path.pop();RA.page=0;raRenderAll();raRecordNodeEntry(raCurrent(),'back','','回退一步')}};
  const reset=document.getElementById('raResetPath');
  if(reset)reset.onclick=()=>{RA.path=[];RA.page=0;input.value='';raRenderAll();raSetStatus('路径已重置；验收记录不会被清空。')};
  document.querySelectorAll('[data-rav]').forEach(b=>b.onclick=()=>raUpdateLatest(b.dataset.rav,false));
  const saveNote=document.getElementById('raSaveNote');
  if(saveNote)saveNote.onclick=()=>raUpdateLatest('',true);
  const exportJson=document.getElementById('raExportJson');
  if(exportJson)exportJson.onclick=()=>{
    raDownload(`PMP联想库验收报告_${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(raReportObject(),null,2),'application/json');
  };
  const exportMd=document.getElementById('raExportMd');
  if(exportMd)exportMd.onclick=()=>{
    const R=raReportObject(),s=R.summary;
    let md=`# PMP 联想库验收报告\n\n- 导出时间：${R.exportedAt}\n- 联想库：${R.librarySource}（${R.library.nodeCount} 节点 / ${R.library.edgeCount} 边）\n- 总记录：${s.total}\n- 未命中：${s.unresolved}\n- 过宽词：${s.broadTerms}\n- 多义：${s.ambiguous}\n- 断链：${s.deadEnds}\n- 单候选：${s.singleChoice}\n- 人工正常：${s.manualNormal}\n- 人工问题：${s.manualIssues}\n`;
    R.records.forEach((r,i)=>{
      md+=`\n### ${i+1}. ${r.query?`输入「${r.query}」`:r.nodeTitle||r.type}\n`;
      md+=`- 自动状态：${r.autoStatus||''}\n- 命中节点：${r.nodeTitle||'—'}\n- 命中方式：${r.matchMode||'—'}\n- 有效候选：${r.candidateCount??'—'}\n`;
      if((r.firstChoices||[]).length)md+=`- 第一屏：${r.firstChoices.map(x=>x.title).join(' / ')}\n`;
      if((r.path||[]).length)md+=`- 当时路径：${r.path.join(' → ')}\n`;
      if(r.manualVerdict)md+=`- 人工判断：${r.manualVerdict}\n`;
      if(r.note)md+=`- 备注：${r.note}\n`;
    });
    raDownload(`PMP联想库验收报告_${new Date().toISOString().slice(0,10)}.md`,md,'text/markdown;charset=utf-8');
  };
  const clearLog=document.getElementById('raClearLog');
  if(clearLog)clearLog.onclick=()=>{
    if(!confirm('确认清空本验收器保存的测试记录？')){
      return;
    }
    RA.records=[];RA.lastRecordId=null;try{localStorage.removeItem(RA_STORAGE_KEY)}catch(e){}
    raRenderRecords();const ns=document.getElementById('raNoteStatus');if(ns)ns.textContent='';
  };
  const file=document.getElementById('raFile');
  if(file)file.onchange=async e=>{
    const f=e.target.files?.[0];if(!f)return;
    try{
      const j=JSON.parse(await f.text());
      if(!Array.isArray(j.nodes)||!Array.isArray(j.edges))throw new Error('JSON 缺少 nodes / edges');
      RA.L=j;RA.LSource='external';RA.path=[];RA.page=0;raIndex();raRenderAll();
      raRenderAcceptance();
      raSetStatus(`✓ 已临时加载 ${raEsc(f.name)}：${j.nodes.length} 节点 / ${j.edges.length} 边。记录将继续累计。`,'ok');
      if(confirm('是否同时将其设为当前工作区联想库？（会更新工作区并标记草稿待保存）')){
        state.recallLibrary=normalizeRecall(j);markWorkspaceDirty();raSyncFromWorkspace(true);raRenderAcceptance();
        raSetStatus(`✓ 已设为工作区联想库：${j.nodes.length} 节点 / ${j.edges.length} 边。`,'ok');
      }
    }catch(err){raSetStatus('加载失败：'+raEsc(err.message),'bad')}
    finally{e.target.value=''}
  };
}
raBindEvents();
raRestore();
raRenderRecords();
