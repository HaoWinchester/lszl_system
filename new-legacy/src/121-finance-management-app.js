'use strict';
(function(global){
  const $=id=>document.getElementById(id),UI=global.KGAdminUI;
  let rows=[],monthly=[],editingId='',currentMonth='';
  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]))}
  function toast(message,error=false){UI?.toast?.(message,error)}
  function log(action,detail){try{global.KGAuthCore?.logAction?.(action,'FINANCE',detail)}catch(error){}}
  function user(){return global.KGAuthCore?.currentUser?.()||null}
  function isAdmin(){return user()?.role==='admin'}
  function canAccess(){const role=user()?.role;return role==='admin'||role==='teacher'}
  function deny(){document.querySelector('.admin-main').innerHTML='<section class="admin-page-head"><div><h1>无权访问</h1><span>财务管理仅限管理员与教师使用。</span></div></section>';return false}
  function money(value){const number=Number(value||0);return '¥'+number.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}
  function kib(size){return size>=1024*1024?`${(size/1024/1024).toFixed(1)} MiB`:`${Math.max(1,Math.round((size||0)/1024))} KiB`}
  function today(){const now=new Date();const pad=n=>String(n).padStart(2,'0');return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`}
  function currentMonthKey(){return today().slice(0,7)}
  async function api(path,options={}){
    const response=await fetch(`/api/v1/finance${path}`,{credentials:'include',...options});
    if(!response.ok){
      let detail=`请求失败（${response.status}）`;
      try{const body=await response.json();if(body?.detail)detail=typeof body.detail==='string'?body.detail:detail}catch(error){}
      throw new Error(detail);
    }
    return response.status===204?null:response.json();
  }

  function renderKpi(){
    const monthKey=$('financeMonthFilter').value||currentMonthKey();
    const monthRow=monthly.find(row=>row.month===monthKey);
    const totalAll=monthly.reduce((sum,row)=>sum+Number(row.total||0),0);
    $('financeMonthTotal').textContent=monthRow?money(monthRow.total):'¥0.00';
    $('financeMonthDetail').textContent=`${monthKey} 消费合计`;
    $('financeMonthCount').textContent=monthRow?String(monthRow.count):'0';
    $('financeAllTotal').textContent=money(totalAll);
    $('financeAllDetail').textContent=`共 ${monthly.reduce((sum,row)=>sum+Number(row.count||0),0)} 笔`;
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
      return `<tr>`
        +`<td class="finance-cell-muted">${escapeHtml(record.spentOn)}</td>`
        +`<td class="finance-purpose">${escapeHtml(record.purpose)}</td>`
        +`<td class="finance-col-amount">${escapeHtml(money(record.amount))}</td>`
        +`<td class="finance-cell-muted">${escapeHtml(record.note||'—')}</td>`
        +`<td class="finance-invoice-cell">${invoiceCell(record)}</td>`
        +`<td>${escapeHtml(record.createdBy)}</td>`
        +`<td><span class="finance-row-actions">${actions.join('')}</span></td>`
        +`</tr>`;
    }).join('');
    tbody.querySelectorAll('[data-finance-edit]').forEach(button=>button.addEventListener('click',()=>startEdit(button.dataset.financeEdit)));
    tbody.querySelectorAll('[data-finance-delete]').forEach(button=>button.addEventListener('click',()=>removeRecord(button.dataset.financeDelete)));
    tbody.querySelectorAll('[data-finance-view]').forEach(button=>button.addEventListener('click',()=>openViewer(button.dataset.financeView)));
  }

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

  function resetForm(){
    editingId='';$('financeRecordForm').reset();
    $('financeSpentOn').value=today();
    $('financeInvoiceHint').textContent='';$('financeInvoiceHint').classList.remove('has-invoice');
    $('financeFormMode').textContent='NEW RECORD';$('financeFormTitle').textContent='登记消费';
    $('financeSubmitBtn').textContent='保存记录';
    $('financeCancelEditBtn').hidden=true;
    $('financeInvoice').disabled=false;
    $('financeFormPanel').classList.remove('finance-editing');
  }

  function startEdit(recordId){
    const record=rows.find(row=>row.id===recordId);if(!record)return;
    editingId=recordId;
    $('financeAmount').value=Number(record.amount||0).toFixed(2);
    $('financeSpentOn').value=record.spentOn||today();
    $('financePurpose').value=record.purpose||'';
    $('financeNote').value=record.note||'';
    $('financeInvoice').value='';
    if(record.invoice){$('financeInvoiceHint').textContent=`已有发票：${record.invoice.name}（${kib(record.invoice.size||0)}${record.invoice.by?`，上传人 ${record.invoice.by}`:''}）。重新选择文件将替换`;$('financeInvoiceHint').classList.add('has-invoice')}
    else{$('financeInvoiceHint').textContent='当前记录没有发票，可选择文件上传';$('financeInvoiceHint').classList.add('has-invoice')}
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
    const file=$('financeInvoice').files[0];
    const invoiceError=validateInvoice(file);
    if(invoiceError){toast(invoiceError,true);return}
    const payload={
      amount:String(Number($('financeAmount').value).toFixed(2)),
      purpose:$('financePurpose').value.trim(),
      spentOn:$('financeSpentOn').value,
      note:$('financeNote').value.trim(),
    };
    if(!payload.purpose){toast('请填写用途',true);return}
    try{
      if(editingId){
        await api(`/records/${editingId}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        if(file){
          const form=new FormData();form.append('invoice',file);
          await api(`/records/${editingId}/invoice`,{method:'POST',body:form});
        }
        log('更新财务记录',`${editingId} · ${payload.purpose}`);
        toast('消费记录已更新。');
      }else{
        const form=new FormData();
        form.append('amount',payload.amount);form.append('purpose',payload.purpose);
        form.append('spent_on',payload.spentOn);
        if(payload.note)form.append('note',payload.note);
        if(file)form.append('invoice',file);
        await api('/records',{method:'POST',body:form});
        log('登记财务消费',`${payload.purpose} · ¥${payload.amount}`);
        toast('消费记录已保存。');
      }
      resetForm();await load();
    }catch(error){toast(error.message||'保存失败',true)}
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
    const month=$('financeMonthFilter').value;
    const query=month?`?month=${encodeURIComponent(month)}`:'';
    const data=await api(`/records${query}`);
    rows=data.items||[];monthly=data.monthly||[];
    renderKpi();renderRows();
  }

  function bind(){
    $('financeMonthFilter').value=currentMonthKey();
    $('financeMonthFilter').addEventListener('change',()=>load().catch(error=>toast(error.message,true)));
    $('financeRefreshBtn').addEventListener('click',()=>load().catch(error=>toast(error.message,true)));
    $('financeRecordForm').addEventListener('submit',submitForm);
    $('financeCancelEditBtn').addEventListener('click',resetForm);
    $('financeInvoice').addEventListener('change',()=>{
      const error=validateInvoice($('financeInvoice').files[0]);
      if(error){$('financeInvoice').value='';$('financeInvoiceHint').textContent='';$('financeInvoiceHint').classList.remove('has-invoice');toast(error,true)}
    });
    $('financeViewerClose').addEventListener('click',closeViewer);
    $('financeViewer').addEventListener('click',event=>{if(event.target===$('financeViewer'))closeViewer()});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('financeViewer').hidden)closeViewer()});
  }

  async function init(){
    UI?.init?.();
    if(!canAccess())return deny();
    $('financeSpentOn').value=today();
    bind();
    try{await load()}catch(error){toast(error.message||'财务记录读取失败。',true)}
  }
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init,{once:true}):init();
})(window);
