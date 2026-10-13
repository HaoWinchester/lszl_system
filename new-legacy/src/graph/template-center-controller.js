/* Shared template center. Server-authoritative publications and new private files. */
(function(global){
  'use strict';
  function el(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node}
  function canPublish(role){return role==='teacher'||role==='admin'}
  let active=null;
  async function request(path,options={}){
    const response=await fetch('/api/v1/graph-templates'+path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json'},body:options.body?JSON.stringify(options.body):undefined});
    const data=await response.json();
    if(!response.ok){const code=data.detail?.code;throw new Error(({TEMPLATE_MEMBERSHIP_REQUIRED:'此模板需要有效会员，请先开通会员。',TEMPLATE_NOT_AVAILABLE:'模板已下架，不能新加载。',TEMPLATE_NODE_QUOTA_EXCEEDED:'此模板超出当前账号的卡牌额度。',GRAPH_FILE_REVISION_CONFLICT:'源图谱已改变，请保存并重新发布。',TEMPLATE_PUBLISHER_REQUIRED:'仅教师和管理员可以发布模板。',TEMPLATE_REQUEST_ID_CONFLICT:'该加载请求已被用于其他模板或版本，请重新加载。'})[code]|| (typeof data.detail==='string'?data.detail:'模板请求失败，请检查登录或重试。'))}
    return data;
  }
  function open(){
    if(active)return;
    const dialog=el('dialog');dialog.id='graphTemplateCenter';dialog.className='graph-template-center';dialog.setAttribute('aria-label','知识图谱模板中心');
    const heading=el('h2','知识图谱模板中心'),intro=el('p','加载会创建独立的新图谱。模板更新或下架不会修改已加载的副本。'),status=el('p'),list=el('div'),actions=el('div'),close=el('button','关闭');status.setAttribute('role','status');actions.className='template-center-actions';actions.append(close);dialog.append(heading,intro,status,list,actions);
    let disposed=false,busy=false,unmount=()=>{};active=dialog;
    function finish(){if(busy)return;disposed=true;unmount();dialog.close();dialog.remove();active=null}
    close.onclick=finish;dialog.addEventListener('cancel',e=>{e.preventDefault();finish()});
    (document.fullscreenElement||document.body).append(dialog);
    if(global.KGCanvasDomInteraction?.mountOverlay)unmount=global.KGCanvasDomInteraction.mountOverlay(dialog);
    dialog.showModal();
    function context(){return global.KGGraphFileEditorStoreBridge?.fragmentSource?.()}
    const actor=global.KGAuthCore?.currentUser?.();
    if(canPublish(actor?.role)){
      const publish=el('button','发布当前图谱');publish.dataset.templatePublish='';actions.prepend(publish);publish.onclick=()=>form(null);
    }
    async function execute(action){if(busy)return;busy=true;close.disabled=true;try{await action()}catch(error){if(!disposed)status.textContent=error.message}finally{busy=false;close.disabled=false}}
    async function refresh(){status.textContent='正在加载模板…';const data=await request('');if(disposed)return;list.replaceChildren();if(!data.templates.length)status.textContent='暂无模板，教师可发布当前图谱。';else status.textContent='选择模板查看描述并加载。';
      for(const item of data.templates){
        const card=el('article');card.dataset.templateId=item.id;
        // 头部：标题 + 免费/会员徽章（下架状态并入徽章文案，保持“已下架”可读）。
        const head=el('div');head.className='template-card-head';
        head.append(el('h3',item.name));
        const badge=el('span',`${item.memberOnly?'会员':'免费'} · v${item.version}${item.listed?'':' · 已下架'}`);
        badge.className='template-badge '+(item.memberOnly?'template-badge-member':'template-badge-free')+(item.listed?'':' template-badge-off');
        head.append(badge);card.append(head);
        const body=el('div');body.className='template-card-body';const details=el('div');details.hidden=true;body.append(details);card.append(body);
        const actions=el('div');actions.className='template-card-actions';card.append(actions);
        const preview=el('button','预览');actions.append(preview);
        preview.onclick=()=>execute(async()=>{const result=await request('/'+encodeURIComponent(item.id));if(disposed)return;details.hidden=false;details.replaceChildren(el('p',result.template.description||'暂无描述'));});
        const load=el('button','加载为新图谱');load.disabled=!item.listed;load.dataset.templateLoad='';load.classList.add('template-load-primary');actions.append(load);
        let receipt=null;
        load.onclick=()=>execute(async()=>{
          if(!receipt)receipt={requestId:global.crypto?.randomUUID?.()||'template-'+Date.now()+'-'+Math.random(),version:item.version};
          status.textContent='正在创建独立图谱…';
          const result=await request('/'+encodeURIComponent(item.id)+'/loads',{method:'POST',body:receipt});if(disposed)return;
          const store=global.KGGraphFileRemoteStore||global.KGGraphFileStore;await store?.refresh?.();await global.KGGraphFileTabs?.refresh?.();
          status.textContent='已创建独立副本';const link=el('a','打开新图谱');link.href='index.html?fileId='+encodeURIComponent(result.fileId);link.dataset.templateResult=result.fileId;
          link.onclick=async e=>{if(global.KGGraphFileTabs?.openFile){e.preventDefault();finish();await global.KGGraphFileTabs.openFile(result.fileId)}};details.hidden=false;details.replaceChildren(link);load.textContent='再次查看已创建副本';
        });
        if(item.canMaintain){const update=el('button','更新为新版本'),toggle=el('button',item.listed?'下架':'重新上架');actions.append(update,toggle);update.onclick=()=>form(item);toggle.onclick=()=>execute(async()=>{await request('/'+encodeURIComponent(item.id),{method:'PATCH',body:{listed:!item.listed}});await refresh()})}
        list.append(card);
      }
    }
    function form(item){
      if(busy)return;const current=context();if(!current?.fileId){status.textContent='请先保存并打开一个正式图谱。';return}
      const editor=el('form');editor.className='template-publication-form';
      const nameField=el('label');nameField.className='template-field';nameField.append(el('span','模板名称'));
      const name=el('input');name.name='name';name.required=true;name.maxLength=200;name.value=item?.name||'知识图谱模板';name.placeholder='给模板起个名字';name.setAttribute('aria-label','模板名称');nameField.append(name);
      const descField=el('label');descField.className='template-field';descField.append(el('span','模板描述'));
      const description=el('textarea');description.name='description';description.maxLength=3000;description.value=item?.description||'';description.placeholder='描述模板内容与适用场景（预览不含完整图谱或答案）';description.setAttribute('aria-label','模板描述');descField.append(description);
      const member=el('input');member.type='checkbox';member.checked=!!item?.memberOnly;member.name='memberOnly';const label=el('label','会员模板（加载需要有效会员） ');label.className='template-member-toggle';label.append(member);
      const submit=el('button',item?'发布新版本':'直接发布');submit.type='submit';submit.classList.add('template-submit-primary');const cancel=el('button','取消编辑');cancel.type='button';cancel.className='template-cancel';cancel.onclick=()=>editor.remove();
      const row=el('div');row.className='template-form-actions';row.append(cancel,submit);
      editor.append(nameField,descField,label,row);dialog.insertBefore(editor,list);name.focus();
      editor.onsubmit=e=>{e.preventDefault();execute(async()=>{submit.disabled=true;await global.KGGraphFileRemoteAdapter?.flush?.();const latest=context();if(latest?.fileId!==current.fileId)throw new Error('当前图谱已切换，请重新发布。');await request(item?'/'+encodeURIComponent(item.id)+'/versions':'',{method:'POST',body:{sourceFileId:latest.fileId,expectedFileRevision:latest.revision,name:name.value,description:description.value,memberOnly:member.checked}});editor.remove();await refresh();status.textContent=item?'新版本已发布，旧副本保留。':'模板已直接发布。'}).finally(()=>{submit.disabled=false})};
    }
    refresh().catch(error=>{if(!disposed)status.textContent=error.message});
  }
  global.KGGraphTemplateCenter={open,canPublish};
  if(typeof module==='object'&&module.exports)module.exports={canPublish};
})(typeof window!=='undefined'?window:globalThis);
