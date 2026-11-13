'use strict';
(function(global){
  const $=id=>document.getElementById(id),UI=global.KGAdminUI;
  let rows=[],monthly=[],editingId='',viewMonth='',selectedFile=null,existingInvoice=null;
  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}
  function toast(message,error=false){UI?.toast?.(message,error)}
  function log(action,detail){try{global.KGAuthCore?.logAction?.(action,'FINANCE',detail)}catch(error){}}
  function user(){return global.KGAuthCore?.currentUser?.()||null}
  function isAdmin(){return user()?.role==='admin'}
  function canAccess(){const role=user()?.role;return role==='admin'||role==='teacher'}
  function deny(){document.querySelector('.admin-main').innerHTML='<section class="admin-page-head"><div><h1>无权访问</h1><span>财务管理仅限管理员与教师使用。</span></div></section>';return false}
  function money(value){const number=Number(value||0);return '¥'+number.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function kib(size){return size>=1024*1024?`${(size/1024/1024).toFixed(1)} MiB`:`${Math.max(1,Math.round((size||0)/1024))} KiB`}
  function pad(n){return String(n).padStart(2,'0')}
  function todayParts(){const now=new Date();return {y:now.getFullYear(),m:now.getMonth()+1,d:now.getDate()}}
  function monthKey(date){return `${date.getFullYear()}-${pad(date.getMonth()+1)}`}
  async function api(path,options={}){
    const response=await fetch(`/api/v1/finance${path}`,{credentials:'include',...options});
    if(!response.ok){
      let detail=`请求失败（${response.status}）`;
      try{const body=await response.json();if(body?.detail)detail=typeof body.detail==='string'?body.detail:detail}catch(error){}
      throw new Error(detail);
    }
    return response.status===204?null:response.json();
  }

  /* ---------- 日期三段选择 ---------- */
  function fillDateSelects(y,m,d){
    const now=todayParts();
    const years=[];for(let year=now.y+1;year>=now.y-5;year--)years.push(year);
    $('financeYear').innerHTML=years.map(year=>`<option value="${year}">${year}</option>`).join('');
    $('financeMonthPart').innerHTML=Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');
    fillDayOptions(y,m);
    $('financeYear').value=y;$('financeMonthPart').value=m;$('financeDayPart').value=Math.min(d,new Date(y,m,0).getDate());
  }
  function fillDayOptions(y,m){
    const days=new Date(y,m,0).getDate();
    $('financeDayPart').innerHTML=Array.from({length:days},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');
  }
  function selectedDate(){
    const y=Number($('financeYear').value),m=Number($('financeMonthPart').value),d=Number($('financeDayPart').value);
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  /* ---------- 月份胶囊 ---------- */
  function viewMonthDate(){return viewMonth?new Date(Number(viewMonth.slice(0,4)),Number(viewMonth.slice(5,7))-1,1):null}
  function renderMonthPicker(){
    $('financeMonthCurrent').textContent=viewMonth||'全部时间';
    $('financeMonthAll').classList.toggle('finance-month-all-active',!viewMonth);
  }
  function switchRange(nextMonth){
    viewMonth=nextMonth;
    if(editingId)resetForm();
    renderMonthPicker();
    load().catch(error=>toast(error.message,true));
  }
  function shiftMonth(delta){
    const base=viewMonthDate()||new Date();
    const target=new Date(base.getFullYear(),base.getMonth()+delta,1);
    switchRange(monthKey(target));
  }
  function showAll(){switchRange('')}
  function backToCurrentMonth(){switchRange(monthKey(new Date()))}

  function renderKpi(){
    const monthRow=viewMonth?monthly.find(row=>row.month===viewMonth):null;
    const totalAll=monthly.reduce((sum,row)=>sum+Number(row.total||0),0);
    const countAll=monthly.reduce((sum,row)=>sum+Number(row.count||0),0);
    $('financeMonthTotal').textContent=monthRow?money(monthRow.total):(viewMonth?'¥0.00':money(totalAll));
    $('financeMonthCount').textContent=monthRow?String(monthRow.count):(viewMonth?'0':String(countAll));
    $('financeAllTotal').textContent=money(totalAll);
    $('financeAllDetail').textContent=`共 ${countAll} 笔`;
  }

  function invoiceCell(record){
    const invoice=record.invoice;
    if(!invoice)return '<span class="finance-cell-muted">无</span>';
    const by=invoice.by?escapeHtml(invoice.by):'未知';
    return `<button type="button" class="finance-link" data-finance-view="${escapeHtml(record.id)}">预览</button>`
      +` <a class="finance-link" href="${escapeHtml(invoice.url)}" download="${escapeHtml(invoice.name)}">下载</a>`
      +`<span class="finance-invoice-meta">${by} · ${escapeHtml(kib(invoice.size||0))}</span>`;
  }

  function renderRows(){
    const tbody=$('financeRows');
    if(!rows.length){tbody.innerHTML='<tr><td colspan="7" class="finance-empty">当前范围没有消费记录。</td></tr>';return}
    tbody.innerHTML=rows.map(record=>{
      const actions=[`<button type="button" class="finance-link" data-finance-edit="${escapeHtml(record.id)}">编辑</button>`];
      if(isAdmin())actions.push(`<button type="button" class="finance-link" data-finance-delete="${escapeHtml(record.id)}">删除</button>`);
      const date=record.spentOn||'';
      const dateLabel=viewMonth&&date.startsWith(viewMonth+'-')?date.slice(5):date;
      const note=record.note||'';
      return `<tr>`
        +`<td class="finance-date-cell">${escapeHtml(dateLabel)}</td>`
        +`<td class="finance-purpose">${escapeHtml(record.purpose)}</td>`
        +`<td class="finance-col-amount">${escapeHtml(money(record.amount))}</td>`
        +`<td class="finance-note-cell"${note?` title="${escapeHtml(note)}"`:''}>${escapeHtml(note||'—')}</td>`
        +`<td class="finance-invoice-cell">${invoiceCell(record)}</td>`
        +`<td>${escapeHtml(record.createdBy)}</td>`
        +`<td><span class="finance-row-actions">${actions.join('')}</span></td>`
        +`</tr>`;
    }).join('');
    tbody.querySelectorAll('[data-finance-edit]').forEach(button=>button.addEventListener('click',()=>startEdit(button.dataset.financeEdit)));
    tbody.querySelectorAll('[data-finance-delete]').forEach(button=>button.addEventListener('click',()=>removeRecord(button.dataset.financeDelete)));
    tbody.querySelectorAll('[data-finance-view]').forEach(button=>button.addEventListener('click',()=>openViewer(button.dataset.financeView)));
  }

  /* ---------- 发票预览弹层 ---------- */
  function openViewer(recordId){
    const record=rows.find(row=>row.id===recordId);
    const invoice=record?.invoice;
    if(!invoice)return;
    const body=$('financeViewerBody');
    if((invoice.mime||'').startsWith('image/')){
      body.innerHTML=`<img src="${escapeHtml(invoice.url)}" alt="${escapeHtml(invoice.name)}"/>`;
    }else if(invoice.mime==='application/pdf'){
      body.innerHTML=`<iframe src="${escapeHtml(invoice.url)}" title="${escapeHtml(invoice.name)}"></iframe>`;
    }else{
      body.innerHTML='<span class="finance-empty">该类型不支持内嵌预览，请下载查看。</span>';
    }
    $('financeViewerName').textContent=invoice.name;
    $('financeViewerMeta').textContent=`${record.purpose} · ${kib(invoice.size||0)}${invoice.by?` · 上传人 ${invoice.by}`:''}`;
    $('financeViewerDownload').onclick=()=>{window.location.href=invoice.url};
    $('financeViewer').hidden=false;
  }

  function closeViewer(){
    $('financeViewer').hidden=true;
    $('financeViewerBody').innerHTML='';
  }

  /* ---------- 发票文件选择（拖拽 + 点击 + chip） ---------- */
  function setFile(file){
    const error=validateInvoice(file);
    if(error){toast(error,true);return}
    selectedFile=file;
    renderFileChip();
  }
  function renderFileChip(){
    const chip=$('financeFileChip'),drop=$('financeDrop');
    if(selectedFile){
      chip.hidden=false;
      $('financeFileChipName').textContent=selectedFile.name;
      $('financeFileChipSize').textContent=kib(selectedFile.size);
      drop.classList.add('finance-drop-has');
      drop.querySelector('.finance-drop-text').textContent='重新选择或拖入可替换';
    }else{
      chip.hidden=true;
      drop.classList.remove('finance-drop-has');
      drop.querySelector('.finance-drop-text').textContent='点击选择或拖入文件';
    }
  }
  function clearFile(){
    selectedFile=null;$('financeInvoice').value='';renderFileChip();
  }

  /* ---------- 表单 ---------- */
  function resetForm(){
    editingId='';existingInvoice=null;clearFile();
    $('financeRecordForm').reset();
    const now=todayParts();
    fillDateSelects(now.y,now.m,now.d);
    $('financeFormMode').textContent='NEW RECORD';$('financeFormTitle').textContent='登记消费';
    $('financeSubmitBtn').textContent='保存记录';
    $('financeCancelEditBtn').hidden=true;
    $('financeFormPanel').classList.remove('finance-editing');
  }

  function startEdit(recordId){
    const record=rows.find(row=>row.id===recordId);if(!record)return;
    editingId=recordId;
    existingInvoice=record.invoice||null;
    selectedFile=null;
    const [y,m,d]=String(record.spentOn||'').split('-').map(Number);
    if(y&&m&&d)fillDateSelects(y,m,d);
    $('financeAmount').value=Number(record.amount||0).toFixed(2);
    $('financePurpose').value=record.purpose||'';
    $('financeNote').value=record.note||'';
    $('financeInvoice').value='';
    renderFileChip();
    if(existingInvoice){
      $('financeFileChipName').textContent=existingInvoice.name;
      $('financeFileChipSize').textContent=`已有 · ${kib(existingInvoice.size||0)}${existingInvoice.by?` · 上传人 ${existingInvoice.by}`:''}`;
    }
    $('financeFormMode').textContent='EDIT RECORD';$('financeFormTitle').textContent='编辑消费记录';
    $('financeSubmitBtn').textContent='保存修改';
    $('financeCancelEditBtn').hidden=false;
    $('financeFormPanel').classList.add('finance-editing');
    $('financeAmount').focus();
  }

  function validateInvoice(file){
    if(!file)return null;
    const ok=/\.(png|jpe?g|webp|pdf)$/i.test(file.name);
    if(!ok){return '发票仅支持 png/jpg/jpeg/webp/pdf'}
    if(file.size>20*1024*1024){return '发票文件限 20 MiB'}
    if(file.size===0){return '发票文件为空'}
    return null;
  }

  async function submitForm(event){
    event.preventDefault();
    if($('financeSubmitBtn').disabled)return;
    const amount=Number($('financeAmount').value);
    const purpose=$('financePurpose').value.trim();
    if(!(amount>0)){toast('请填写大于 0 的金额',true);return}
    if(!purpose){toast('请填写用途',true);return}
    const spentOn=selectedDate();
    const submit=$('financeSubmitBtn');
    submit.disabled=true;submit.textContent=editingId?'保存中…':'保存中…';
    try{
      if(editingId){
        await api(`/records/${editingId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          amount:amount.toFixed(2),purpose,spentOn,note:$('financeNote').value.trim(),
        })});
        if(selectedFile){
          const form=new FormData();form.append('invoice',selectedFile);
          await api(`/records/${editingId}/invoice`,{method:'POST',body:form});
        }
        log('更新财务记录',`${editingId} · ${purpose}`);
        toast('消费记录已更新。');
      }else{
        const form=new FormData();
        form.append('amount',amount.toFixed(2));form.append('purpose',purpose);
        form.append('spent_on',spentOn);
        const note=$('financeNote').value.trim();
        if(note)form.append('note',note);
        if(selectedFile)form.append('invoice',selectedFile);
        await api('/records',{method:'POST',body:form});
        log('登记财务消费',`${purpose} · ¥${amount.toFixed(2)}`);
        toast('消费记录已保存。');
      }
      resetForm();await load();
    }catch(error){toast(error.message||'保存失败',true)}
    finally{submit.disabled=false;submit.textContent=editingId?'保存修改':'保存记录'}
  }

  async function removeRecord(recordId){
    if(!await global.KGDialogs?.confirm?.('确定删除这条消费记录？发票附件会一并删除。',{danger:true}))return;
    try{
      await api(`/records/${recordId}`,{method:'DELETE'});
      log('删除财务记录',recordId);
      toast('记录已删除。');
      if(editingId===recordId)resetForm();
      await load();
    }catch(error){toast(error.message||'删除失败',true)}
  }

  async function load(){
    const card=document.querySelector('.finance-table-card');
    card?.classList.add('finance-loading');
    try{
      const query=viewMonth?`?month=${encodeURIComponent(viewMonth)}`:'';
      const data=await api(`/records${query}`);
      rows=data.items||[];monthly=data.monthly||[];
      renderKpi();renderRows();
    }finally{
      card?.classList.remove('finance-loading');
    }
  }

  function bind(){
    const now=todayParts();
    viewMonth=monthKey(new Date());
    renderMonthPicker();
    fillDateSelects(now.y,now.m,now.d);
    $('financeYear').addEventListener('change',()=>fillDayOptions(Number($('financeYear').value),Number($('financeMonthPart').value)));
    $('financeMonthPart').addEventListener('change',()=>fillDayOptions(Number($('financeYear').value),Number($('financeMonthPart').value)));
    $('financeMonthPrev').addEventListener('click',()=>shiftMonth(-1));
    $('financeMonthNext').addEventListener('click',()=>shiftMonth(1));
    $('financeMonthCurrent').addEventListener('click',backToCurrentMonth);
    $('financeMonthAll').addEventListener('click',showAll);
    $('financeRefreshBtn').addEventListener('click',()=>load().catch(error=>toast(error.message,true)));
    $('financeRecordForm').addEventListener('submit',submitForm);
    $('financeCancelEditBtn').addEventListener('click',resetForm);
    const drop=$('financeDrop'),input=$('financeInvoice');
    drop.addEventListener('click',()=>input.click());
    drop.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();input.click()}});
    input.addEventListener('change',()=>setFile(input.files[0]));
    ['dragenter','dragover'].forEach(type=>drop.addEventListener(type,event=>{event.preventDefault();drop.classList.add('finance-drop-over')}));
    ['dragleave','drop'].forEach(type=>drop.addEventListener(type,event=>{event.preventDefault();drop.classList.remove('finance-drop-over')}));
    drop.addEventListener('drop',event=>{const file=event.dataTransfer?.files?.[0];if(file)setFile(file)});
    $('financeFileChipRemove').addEventListener('click',clearFile);
    $('financeViewerClose').addEventListener('click',closeViewer);
    $('financeViewer').addEventListener('click',event=>{if(event.target===$('financeViewer'))closeViewer()});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('financeViewer').hidden)closeViewer()});
  }

  async function init(){
    UI?.init?.();
    if(!canAccess())return deny();
    bind();
    try{await load()}catch(error){toast(error.message||'财务记录读取失败。',true)}
  }
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init,{once:true}):init();
})(window);
