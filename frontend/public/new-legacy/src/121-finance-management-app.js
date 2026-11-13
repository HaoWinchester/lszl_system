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

  function renderRows(){
    const tbody=$('financeRows');
    if(!rows.length){tbody.innerHTML='<tr><td colspan="7">当前范围没有消费记录。</td></tr>';return}
    tbody.innerHTML=rows.map(record=>{
      const invoice=record.invoice
        ?`<a class="admin-action-link" href="${escapeHtml(record.invoice.url)}" target="_blank" rel="noopener">${escapeHtml(record.invoice.name)}</a>`
        :'<span class="admin-status">无</span>';
      const actions=[`<button type="button" class="admin-action-link" data-finance-edit="${escapeHtml(record.id)}">编辑</button>`];
      if(isAdmin())actions.push(`<button type="button" class="admin-action-link" data-finance-delete="${escapeHtml(record.id)}">删除</button>`);
      return `<tr><td>${escapeHtml(record.spentOn)}</td><td>${escapeHtml(record.purpose)}</td><td>${escapeHtml(money(record.amount))}</td><td>${escapeHtml(record.note||'—')}</td><td>${invoice}</td><td>${escapeHtml(record.createdBy)}</td><td>${actions.join('')}</td></tr>`;
    }).join('');
    tbody.querySelectorAll('[data-finance-edit]').forEach(button=>button.addEventListener('click',()=>startEdit(button.dataset.financeEdit)));
    tbody.querySelectorAll('[data-finance-delete]').forEach(button=>button.addEventListener('click',()=>removeRecord(button.dataset.financeDelete)));
  }

  function resetForm(){
    editingId='';$('financeRecordForm').reset();
    $('financeSpentOn').value=today();
    $('financeInvoiceHint').textContent='';$('financeInvoiceHint').classList.remove('has-invoice');
    $('financeFormMode').textContent='NEW RECORD';$('financeFormTitle').textContent='登记消费';
    $('financeSubmitBtn').textContent='保存记录';
    $('financeCancelEditBtn').hidden=true;
    $('financeInvoice').disabled=false;
  }

  function startEdit(recordId){
    const record=rows.find(row=>row.id===recordId);if(!record)return;
    editingId=recordId;
    $('financeAmount').value=Number(record.amount||0).toFixed(2);
    $('financeSpentOn').value=record.spentOn||today();
    $('financePurpose').value=record.purpose||'';
    $('financeNote').value=record.note||'';
    $('financeInvoice').value='';
    if(record.invoice){$('financeInvoiceHint').textContent=`已有发票：${record.invoice.name}（${Math.round((record.invoice.size||0)/1024)} KiB），重新选择文件将替换`;$('financeInvoiceHint').classList.add('has-invoice')}
    else{$('financeInvoiceHint').textContent='当前记录没有发票，可选择文件上传';$('financeInvoiceHint').classList.add('has-invoice')}
    $('financeFormMode').textContent='EDIT RECORD';$('financeFormTitle').textContent='编辑消费记录';
    $('financeSubmitBtn').textContent='保存修改';
    $('financeCancelEditBtn').hidden=false;
    $('financeFormMode').scrollIntoView?.({behavior:'smooth',block:'center'});
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
