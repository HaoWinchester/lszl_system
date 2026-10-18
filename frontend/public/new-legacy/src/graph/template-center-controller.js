/* Shared template center. Server-authoritative publications and new private files. */
(function(global){
  'use strict';
  function el(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node}
  function previewWindowPosition(left,top,width,height,viewportWidth,viewportHeight){return{left:Math.max(0,Math.min(Math.max(0,viewportWidth-width),left)),top:Math.max(0,Math.min(Math.max(0,viewportHeight-height),top))}}
  function canPublish(role){return role==='teacher'||role==='admin'}
  let active=null;
  const onlineFilesRequired='当前为临时图谱模式，暂不能发布或加载模板。请先导出学习包保留内容，再联系管理员恢复在线图谱后重新打开。';
  function requireOnlineFiles(){if(global.KGGraphFileEditorStoreBridge?.isRemote?.()!==true)throw new Error(onlineFilesRequired)}
  async function request(path,options={}){
    const response=await fetch('/api/v1/graph-templates'+path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json'},body:options.body?JSON.stringify(options.body):undefined});
    let data;try{data=await response.json()}catch(error){throw new Error('模板服务返回异常（HTTP '+response.status+'），请稍后重试。')}
    if(!response.ok){
      const detail=data?.detail,code=detail?.code,messages={TEMPLATE_MEMBERSHIP_REQUIRED:'此模板需要有效会员，请先开通会员。',TEMPLATE_NOT_AVAILABLE:'模板已下架，不能新加载。',TEMPLATE_NODE_QUOTA_EXCEEDED:'此模板超出当前账号的卡牌额度。',GRAPH_FILE_NOT_FOUND:'源图谱不存在或不属于当前账号，请重新打开图谱后发布。',GRAPH_FILE_REVISION_CONFLICT:'源图谱已改变，请保存并重新发布。',TEMPLATE_GRAPH_INVALID:'源图谱结构不完整，请检查卡片和连线后重新发布。',GRAPH_TABLES_INVALID:'源图谱表格数据不完整，请修复后重新发布。',GRAPH_STROKES_INVALID:'源图谱画布数据不完整，请修复后重新发布。',TEMPLATE_PUBLISHER_REQUIRED:'仅教师和管理员可以发布模板。',TEMPLATE_READER_REQUIRED:'当前账号没有模板访问权限。',TEMPLATE_NOT_FOUND:'模板不存在或当前账号没有访问权限。',TEMPLATE_VERSION_NOT_FOUND:'模板版本不存在，请重新打开模板中心。',TEMPLATE_REQUEST_ID_CONFLICT:'该加载请求已被用于其他模板或版本，请重新加载。'};
      const fallback=response.status===401?'登录已失效，请重新登录。':'模板请求失败（HTTP '+response.status+'），请稍后重试。';
      throw new Error(messages[code]||(typeof detail==='string'?detail:detail?.message||fallback));
    }
    return data;
  }
  function open(){
    if(active)return;
    const dialog=el('dialog');dialog.id='graphTemplateCenter';dialog.className='graph-template-center';dialog.setAttribute('aria-label','知识图谱模板中心');
    const heading=el('h2','知识图谱模板中心'),intro=el('p','加载会创建独立的新图谱。模板更新或下架不会修改已加载的副本。'),status=el('p'),list=el('div'),actions=el('div'),close=el('button','关闭');status.setAttribute('role','status');actions.className='template-center-actions';actions.append(close);dialog.append(heading,intro,status,list,actions);
    let disposed=false,busy=false,unmount=()=>{},closePreview=()=>{};const lifetime=new AbortController();active=dialog;
    function finish(){if(busy)return;disposed=true;lifetime.abort();closePreview();unmount();dialog.close();dialog.remove();active=null}
    close.onclick=finish;dialog.addEventListener('cancel',e=>{e.preventDefault();finish()});
    dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();finish()}});
    (document.fullscreenElement||document.body).append(dialog);
    if(global.KGCanvasDomInteraction?.mountOverlay)unmount=global.KGCanvasDomInteraction.mountOverlay(dialog);
    dialog.showModal();
    function context(){return global.KGGraphFileEditorStoreBridge?.fragmentSource?.()}
    const actor=global.KGAuthCore?.currentUser?.();
    if(canPublish(actor?.role)){
      const publish=el('button','发布当前图谱');publish.dataset.templatePublish='';actions.prepend(publish);publish.onclick=()=>form(null);
    }
    async function execute(action){if(busy)return;busy=true;close.disabled=true;try{await action()}catch(error){if(!disposed)status.textContent=error.message}finally{busy=false;close.disabled=false}}
    async function refresh(){status.textContent='正在加载模板…';const data=await request('');if(disposed)return;list.replaceChildren();if(!data.templates.length)status.textContent='暂无模板，教师可发布当前图谱。';else status.textContent='点击图谱预览，可拖动、缩放或全屏查看。';if(global.KGGraphFileEditorStoreBridge?.isRemote?.()!==true)status.textContent=onlineFilesRequired;
      for(const item of data.templates){
        const card=el('article');card.dataset.templateId=item.id;
        // 头部：标题 + 免费/会员徽章（下架状态并入徽章文案，保持“已下架”可读）。
        const head=el('div');head.className='template-card-head';
        head.append(el('h3',item.name));
        const badge=el('span',`${item.memberOnly?'会员':'免费'} · v${item.version}${item.listed?'':' · 已下架'}`);
        badge.className='template-badge '+(item.memberOnly?'template-badge-member':'template-badge-free')+(item.listed?'':' template-badge-off');
        head.append(badge);card.append(head);
        const thumbnail=el('button','正在生成预览…');thumbnail.type='button';thumbnail.className='template-thumbnail';thumbnail.setAttribute('aria-label','预览 '+item.name);card.append(thumbnail);
        const body=el('div');body.className='template-card-body';const details=el('div');details.hidden=true;body.append(details);card.append(body);
        const actions=el('div');actions.className='template-card-actions';card.append(actions);
        const preview=el('button','预览');actions.append(preview);
        let snapshot=null;
        function fetchPreview(signal){if(signal)return request('/'+encodeURIComponent(item.id),{signal});if(!snapshot)snapshot=request('/'+encodeURIComponent(item.id),{signal:lifetime.signal}).catch(error=>{snapshot=null;throw error});return snapshot}
        preview.onclick=thumbnail.onclick=()=>showPreview(item,fetchPreview,version=>loadCopy(version));
        fetchPreview().then(result=>{if(!disposed)global.KGTemplatePreview.mount(thumbnail,result.preview)}).catch(()=>{if(!disposed)thumbnail.textContent='预览暂不可用 · 点击重试'});
        const load=el('button','加载为新图谱');load.disabled=!item.listed;load.dataset.templateLoad='';load.classList.add('template-load-primary');actions.append(load);
        const receipts=new Map();
        load.onclick=()=>loadCopy(item.version);
        function loadCopy(version){return execute(async()=>{
          requireOnlineFiles();
          if(!receipts.has(version))receipts.set(version,{requestId:global.crypto?.randomUUID?.()||'template-'+Date.now()+'-'+Math.random(),version});
          const receipt=receipts.get(version);
          status.textContent='正在创建独立图谱…';
          const result=await request('/'+encodeURIComponent(item.id)+'/loads',{method:'POST',body:receipt});if(disposed)return;
          const store=global.KGGraphFileRemoteStore||global.KGGraphFileStore;await store?.refresh?.();await global.KGGraphFileTabs?.refresh?.();
          status.textContent='已创建独立副本';const link=el('a','打开新图谱');link.href='index.html?fileId='+encodeURIComponent(result.fileId);link.dataset.templateResult=result.fileId;
          link.onclick=async e=>{if(global.KGGraphFileTabs?.openFile){e.preventDefault();finish();await global.KGGraphFileTabs.openFile(result.fileId)}};details.hidden=false;details.replaceChildren(link);load.textContent='再次查看已创建副本';
        })}
        if(item.canMaintain){const update=el('button','更新为新版本'),toggle=el('button',item.listed?'下架':'重新上架');actions.append(update,toggle);update.onclick=()=>form(item);toggle.onclick=()=>execute(async()=>{await request('/'+encodeURIComponent(item.id),{method:'PATCH',body:{listed:!item.listed}});await refresh()})}
        list.append(card);
      }
    }
    async function showPreview(item,fetchPreview,load){
      closePreview();
      const panel=el('dialog');panel.className='template-preview-window';panel.setAttribute('aria-label',item.name+' · 模板预览');
      const surface=el('div');surface.className='template-preview-surface';
      const header=el('header'),title=el('h3',item.name),close=el('button','×');close.type='button';close.setAttribute('aria-label','关闭模板预览');header.append(title,close);
      const viewport=el('div');viewport.className='template-preview-viewport';const message=el('p','正在加载图谱…');message.setAttribute('role','status');viewport.append(message);
      const footer=el('footer'),minus=el('button','−'),scale=el('output','100%'),plus=el('button','＋'),fit=el('button','适应视图'),full=el('button','全屏'),use=el('button','加载为新图谱');
      minus.setAttribute('aria-label','缩小预览');plus.setAttribute('aria-label','放大预览');use.disabled=true;footer.append(minus,scale,plus,fit,full,use);surface.append(header,viewport,footer);panel.append(surface);
      const lifetime=new AbortController();let drawing=null,closed=false,displayedVersion=null;
      async function dismiss(){if(closed)return;closed=true;lifetime.abort();drawing?.destroy();if(document.fullscreenElement===surface)await document.exitFullscreen().catch(()=>{});panel.close();panel.remove();previewFocus?.focus()}
      const previewFocus=document.activeElement;closePreview=dismiss;close.onclick=dismiss;panel.addEventListener('cancel',event=>{event.preventDefault();dismiss()});
      panel.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();dismiss()}});
      (document.fullscreenElement||document.body).append(panel);panel.showModal();
      minus.onclick=()=>drawing?.zoom(.8);plus.onclick=()=>drawing?.zoom(1.25);fit.onclick=()=>drawing?.fit();
      full.onclick=async()=>{try{if(document.fullscreenElement===surface)await document.exitFullscreen();else await surface.requestFullscreen()}catch(error){message.textContent='当前浏览器无法全屏，请使用窗口预览。';footer.append(message)}};
      panel.addEventListener('fullscreenchange',()=>{full.textContent=document.fullscreenElement===surface?'退出全屏':'全屏';keepWindowInView();drawing?.fit()},{signal:lifetime.signal});
      use.onclick=async()=>{if(displayedVersion===null)return;await dismiss();load(displayedVersion)};
      function positionWindow(left,top){const position=previewWindowPosition(left,top,panel.offsetWidth,panel.offsetHeight,innerWidth,innerHeight);panel.style.margin='0';panel.style.left=position.left+'px';panel.style.top=position.top+'px'}
      function keepWindowInView(){if(document.fullscreenElement===surface||!panel.style.left)return;const rect=panel.getBoundingClientRect();positionWindow(rect.left,rect.top)}
      global.addEventListener('resize',keepWindowInView,{signal:lifetime.signal});
      let drag=null;
      header.addEventListener('pointerdown',event=>{if(event.target.closest('button')||document.fullscreenElement===surface||event.button!==0)return;const r=panel.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:r.left,top:r.top};header.setPointerCapture(event.pointerId)},{signal:lifetime.signal});
      header.addEventListener('pointermove',event=>{if(!drag||drag.id!==event.pointerId)return;positionWindow(drag.left+event.clientX-drag.x,drag.top+event.clientY-drag.y)},{signal:lifetime.signal});
      header.addEventListener('pointerup',()=>{drag=null},{signal:lifetime.signal});header.addEventListener('pointercancel',()=>{drag=null},{signal:lifetime.signal});
      async function render(){try{const result=await fetchPreview(lifetime.signal);if(closed||disposed)return;displayedVersion=result.preview.version;use.disabled=!result.template.listed;title.textContent=result.template.name+' · v'+displayedVersion;drawing=global.KGTemplatePreview.mount(viewport,result.preview,{interactive:true,onScale:value=>scale.textContent=Math.round(value*100)+'%'});if(result.template.description){const description=el('p',result.template.description);description.className='template-preview-description';surface.insertBefore(description,footer)}}catch(error){if(closed||disposed)return;message.textContent=error.message;const retry=el('button','重试预览');retry.onclick=()=>{retry.remove();message.textContent='正在加载图谱…';render()};viewport.replaceChildren(message,retry)}}
      render();
    }
    function form(item){
      if(busy)return;try{requireOnlineFiles()}catch(error){status.textContent=error.message;return}const current=context(),publisher=global.KGAuthCore?.currentUser?.();if(!canPublish(publisher?.role)){status.textContent='仅教师和管理员可以发布模板。';return}if(!current?.fileId){status.textContent='请先保存并打开一个正式图谱。';return}
      const publisherId=publisher.username,publisherRole=publisher.role;
      const isCurrent=()=>!disposed&&context()?.fileId===current.fileId&&global.KGAuthCore?.currentUser?.()?.username===publisherId&&global.KGAuthCore?.currentUser?.()?.role===publisherRole;
      const editor=el('form');editor.className='template-publication-form';
      const nameField=el('label');nameField.className='template-field';nameField.append(el('span','模板名称'));
      const name=el('input');name.name='name';name.required=true;name.maxLength=200;name.value=item?.name||'知识图谱模板';name.placeholder='给模板起个名字';name.setAttribute('aria-label','模板名称');nameField.append(name);
      const descField=el('label');descField.className='template-field';descField.append(el('span','模板描述'));
      const description=el('textarea');description.name='description';description.maxLength=3000;description.value=item?.description||'';description.placeholder='描述模板内容与适用场景';description.setAttribute('aria-label','模板描述');descField.append(description);
      const member=el('input');member.type='checkbox';member.checked=!!item?.memberOnly;member.name='memberOnly';const label=el('label','会员模板（加载需要有效会员） ');label.className='template-member-toggle';label.append(member);
      const submit=el('button',item?'发布新版本':'直接发布');submit.type='submit';submit.classList.add('template-submit-primary');const cancel=el('button','取消编辑');cancel.type='button';cancel.className='template-cancel';cancel.onclick=()=>editor.remove();
      const row=el('div');row.className='template-form-actions';row.append(cancel,submit);
      editor.append(nameField,descField,label,row);dialog.insertBefore(editor,list);name.focus();
      editor.onsubmit=e=>{e.preventDefault();execute(async()=>{
        requireOnlineFiles();
        submit.disabled=true;cancel.disabled=true;status.textContent='正在保存当前图谱并发布模板…';
        if(!isCurrent())throw new Error('当前图谱或账号已变化，请重新发布。');
        if(global.KGHomeInk?.hasTextDraft?.()&&await global.KGHomeInk.commitText()===false)throw new Error('图谱文字保存失败，请重试后发布。');
        const inline=global.ensureNodeInlineTextEditorController?.();
        if(inline?.isEditing()){await inline.commit();if(inline.isEditing())throw new Error('图谱文字保存失败，请重试后发布。')}
        const autosave=global.KGGraphFileAutosave;
        if(!autosave?.saveAcknowledged)throw new Error('图谱保存服务尚未就绪，请刷新后重试。');
        if(await autosave.saveAcknowledged({force:true,reason:'template-publication'},isCurrent)===false)throw new Error(isCurrent()?'图谱保存失败，未发布模板，请重试。':'当前图谱或账号已变化，请重新发布。');
        await global.KGGraphFileRemoteAdapter?.flush?.();
        if(!isCurrent())throw new Error('当前图谱或账号已变化，请重新发布。');
        const latest=context();
        await request(item?'/'+encodeURIComponent(item.id)+'/versions':'',{method:'POST',body:{sourceFileId:latest.fileId,expectedFileRevision:latest.revision,name:name.value,description:description.value,memberOnly:member.checked}});
        editor.remove();const success=item?'新版本已发布，旧副本保留。':'模板已直接发布。';
        try{await refresh();status.textContent=success}catch(error){status.textContent=success+'模板列表刷新失败，请关闭后重新打开查看。'}
      }).finally(()=>{submit.disabled=false;cancel.disabled=false})};
    }
    refresh().catch(error=>{if(!disposed)status.textContent=error.message});
  }
  global.KGGraphTemplateCenter={open,canPublish};
  if(typeof module==='object'&&module.exports)module.exports={canPublish,previewWindowPosition};
})(typeof window!=='undefined'?window:globalThis);
