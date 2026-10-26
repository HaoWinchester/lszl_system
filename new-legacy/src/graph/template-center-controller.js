/* Shared template center. Server-authoritative publications and new private files. */
(function(global){
  'use strict';
  function el(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node}
  function previewWindowPosition(left,top,width,height,viewportWidth,viewportHeight){return{left:Math.max(0,Math.min(Math.max(0,viewportWidth-width),left)),top:Math.max(0,Math.min(Math.max(0,viewportHeight-height),top))}}
  function canPublish(role){return role==='teacher'||role==='admin'}
  const categories=[['all','全部'],['pmp','PMP'],['prince2','PRINCE2'],['cspm','CSPM'],['gaoxiang','高项'],['general','通用学习']];
  function categoryOf(item){return categories.some(([id])=>id!=='all'&&id===item.category)?item.category:'general'}
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
    const heading=el('h2','知识图谱模板中心'),intro=el('p','选择一个起点，加载后生成可独立编辑的个人图谱。已有图谱与副本会保留。'),status=el('p'),list=el('div'),actions=el('div'),close=el('button','关闭');
    status.setAttribute('role','status');list.className='template-gallery';actions.className='template-center-actions';actions.append(close);
    const searchLabel=el('label'),search=el('input');searchLabel.className='template-search';searchLabel.append(el('span','搜索模板'));search.type='search';search.placeholder='搜索标题或描述';search.setAttribute('aria-label','搜索模板');searchLabel.append(search);
    const tabs=el('nav');tabs.className='template-categories';tabs.setAttribute('aria-label','模板分类');
    const section=el('h3');section.className='template-section-title';
    const recovery=el('div'),retry=el('button','重试加载'),reset=el('button','清除搜索');recovery.className='template-recovery';retry.dataset.templateRetry='';reset.dataset.templateReset='';retry.hidden=true;reset.hidden=true;recovery.append(retry,reset);
    dialog.append(heading,intro,searchLabel,tabs,section,status,recovery,list,actions);
    let disposed=false,busy=false,publicationForm=null,unmount=()=>{},closePreview=()=>{};const lifetime=new AbortController();active=dialog;
    function finish(force=false){if(busy&&!force)return;disposed=true;lifetime.abort();cancelThumbnails();catalogRequest?.abort();closePreview();unmount();dialog.close();dialog.remove();active=null}
    close.onclick=()=>finish();dialog.addEventListener('cancel',e=>{e.preventDefault();finish()});
    dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();finish()}});
    (document.fullscreenElement||document.body).append(dialog);
    if(global.KGCanvasDomInteraction?.mountOverlay)unmount=global.KGCanvasDomInteraction.mountOverlay(dialog);
    dialog.showModal();
    function context(){return global.KGGraphFileEditorStoreBridge?.fragmentSource?.()}
    const actor=global.KGAuthCore?.currentUser?.();
    const openingOwner=actor?.username;
    const isCurrent=()=>!disposed&&global.KGAuthCore?.currentUser?.()?.username===openingOwner;
    global.addEventListener?.('kg-auth-session-change',()=>{if(global.KGAuthCore?.currentUser?.()?.username!==openingOwner)finish(true)},{signal:lifetime.signal});
    if(canPublish(actor?.role)){
      const publish=el('button','发布当前图谱');publish.dataset.templatePublish='';actions.prepend(publish);publish.onclick=()=>form(null);
    }
    async function execute(action){if(busy||!isCurrent())return;busy=true;close.disabled=true;try{await action()}catch(error){if(!disposed)status.textContent=isCurrent()?error.message:'当前账号已切换，请关闭后重试。'}finally{busy=false;close.disabled=false}}
    let catalog=[],catalogError=null,selectedCategory='all',catalogRequest=null,observer=null,renderGeneration=0,runningThumbnails=0,thumbnailQueue=[];
    const thumbnailTasks=new Set(),thumbnailCache=new Map(),receipts=new Map(),latestResults=new Map(),cardViews=new Map(),categoryButtons=new Map();
    function cancelThumbnails(){renderGeneration++;observer?.disconnect();observer=null;thumbnailQueue=[];for(const task of thumbnailTasks){task.visible=false;task.controller?.abort()}thumbnailTasks.clear()}
    function pumpThumbnails(){
      while(runningThumbnails<4&&thumbnailQueue.length){
        const task=thumbnailQueue.shift();task.queued=false;
        if(!task.visible||task.generation!==renderGeneration||!isCurrent())continue;
        const controller=new AbortController();task.controller=controller;runningThumbnails++;
        request('/'+encodeURIComponent(task.item.id),{signal:controller.signal}).then(result=>{
          if(controller.signal.aborted||!isCurrent()||task.generation!==renderGeneration)return;
          global.KGTemplatePreview.mount(task.thumbnail,result.preview);thumbnailCache.set(task.key,result);task.retry.hidden=true;
        }).catch(error=>{if(!controller.signal.aborted&&isCurrent()&&task.generation===renderGeneration){task.thumbnail.textContent='预览暂不可用';task.retry.hidden=false}}).finally(()=>{task.controller=null;runningThumbnails--;if(controller.signal.aborted&&task.visible&&task.generation===renderGeneration)queueThumbnail(task);pumpThumbnails()});
      }
    }
    function queueThumbnail(task){if(!task.visible||task.queued||task.controller||thumbnailCache.has(task.key))return;task.queued=true;thumbnailQueue.push(task);pumpThumbnails()}
    for(const [id,label] of categories){const button=el('button',label);button.type='button';button.dataset.templateCategory=id;button.onclick=()=>{selectedCategory=id;renderCatalog()};categoryButtons.set(id,button);tabs.append(button)}
    search.oninput=()=>renderCatalog();reset.onclick=()=>{search.value='';renderCatalog();search.focus()};
    retry.onclick=()=>refresh().catch(showCatalogError);
    function showCatalogError(error){if(!isCurrent())return;catalogError=error;status.textContent=error.message;retry.hidden=false}
    async function refresh(){
      if(!isCurrent())return;cancelThumbnails();catalogRequest?.abort();const controller=new AbortController();catalogRequest=controller;retry.hidden=true;status.textContent='正在加载模板…';
      try{const data=await request('',{signal:controller.signal});if(!isCurrent()||controller.signal.aborted)return;catalog=data.templates;catalogError=null;renderCatalog()}
      catch(error){if(!controller.signal.aborted)throw error}
    }
    function updateReceiptView(item){
      const view=cardViews.get(item.id),receipt=latestResults.get(item.id);if(!view||!receipt?.fileId)return;
      const link=el('a','打开新图谱');link.href='index.html?fileId='+encodeURIComponent(receipt.fileId);link.dataset.templateResult=receipt.fileId;
      link.onclick=async e=>{if(busy||!isCurrent()){e.preventDefault();return}if(global.KGGraphFileTabs?.openFile){e.preventDefault();finish();await global.KGGraphFileTabs.openFile(receipt.fileId)}};
      view.details.hidden=false;view.details.replaceChildren(link);view.load.textContent='再次查看已创建副本';
    }
    function loadCopy(item,version){return execute(async()=>{
      if(!isCurrent())return;requireOnlineFiles();
      if(!receipts.has(item.id))receipts.set(item.id,new Map());const versions=receipts.get(item.id);
      if(!versions.has(version))versions.set(version,{requestId:global.crypto?.randomUUID?.()||'template-'+Date.now()+'-'+Math.random(),version});
      const receipt=versions.get(version);status.textContent='正在创建独立图谱…';
      const result=await request('/'+encodeURIComponent(item.id)+'/loads',{method:'POST',body:{requestId:receipt.requestId,version:receipt.version},signal:lifetime.signal});if(!isCurrent())return;
      receipt.fileId=result.fileId;latestResults.set(item.id,receipt);updateReceiptView(item);
      const store=global.KGGraphFileRemoteStore||global.KGGraphFileStore;await store?.refresh?.();if(!isCurrent())return;await global.KGGraphFileTabs?.refresh?.();if(!isCurrent())return;
      status.textContent='已创建独立副本';
    })}
    function renderCatalog(){
      cancelThumbnails();cardViews.clear();list.replaceChildren();retry.hidden=!catalogError;
      const query=(search.value||'').trim().toLocaleLowerCase();
      const visible=catalog.filter(item=>(selectedCategory==='all'||categoryOf(item)===selectedCategory)&&(!query||(item.name+' '+(item.description||'')).toLocaleLowerCase().includes(query)));
      for(const [id,label] of categories){const button=categoryButtons.get(id);button.textContent=label+' · '+catalog.filter(item=>id==='all'||categoryOf(item)===id).length;button.setAttribute('aria-pressed',String(selectedCategory===id))}
      section.textContent=categories.find(([id])=>id===selectedCategory)[1]+' · '+visible.length+' 个模板';reset.hidden=!query;
      status.textContent=catalogError?catalogError.message:!catalog.length?'暂无模板，教师可发布当前图谱。':!visible.length?'没有符合条件的模板，请切换分类或清除搜索。':'点击预览查看图谱，使用模板后可打开独立副本。';
      if(global.KGGraphFileEditorStoreBridge?.isRemote?.()!==true)status.textContent=onlineFilesRequired;
      if(global.IntersectionObserver)observer=new global.IntersectionObserver(entries=>{for(const entry of entries){const task=entry.target.templateThumbnailTask;if(!task)continue;task.visible=entry.isIntersecting;if(task.visible)queueThumbnail(task);else task.controller?.abort()}},{root:dialog,threshold:0.01});
      for(const item of visible){
        const card=el('article');card.dataset.templateId=item.id;
        const frame=el('div');frame.className='template-thumbnail-frame';const thumbnail=el('button','正在生成预览…');thumbnail.type='button';thumbnail.className='template-thumbnail';thumbnail.setAttribute('aria-label','预览 '+item.name);
        const thumbRetry=el('button','重试缩略图');thumbRetry.type='button';thumbRetry.hidden=true;thumbRetry.className='template-thumbnail-retry';thumbRetry.dataset.templateThumbnailRetry='';frame.append(thumbnail,thumbRetry);card.append(frame);
        const body=el('div');body.className='template-card-body';const head=el('div');head.className='template-card-head';head.append(el('h3',item.name));body.append(head);
        const meta=el('div');meta.className='template-card-meta';meta.append(el('span',(item.isBuiltin?'内置模板':item.publisherName||'教师发布')+' · '+(item.categoryLabel||categories.find(([id])=>id===categoryOf(item))[1])));
        const badge=el('span',`${item.memberOnly?'会员':'免费'} · v${item.version}${item.listed?'':' · 已下架'}`);badge.className='template-badge '+(item.memberOnly?'template-badge-member':'template-badge-free')+(item.listed?'':' template-badge-off');meta.append(badge);body.append(meta);
        const details=el('div');details.hidden=true;body.append(details);const cardActions=el('div');cardActions.className='template-card-actions';const preview=el('button','预览'),load=el('button','使用模板');preview.type=load.type='button';load.disabled=!item.listed;load.dataset.templateLoad='';load.classList.add('template-load-primary');cardActions.append(preview,load);body.append(cardActions);card.append(body);list.append(card);
        cardViews.set(item.id,{details,load});updateReceiptView(item);
        const key=item.id+':'+item.version;
        const fetchPreview=signal=>request('/'+encodeURIComponent(item.id),{signal:signal||lifetime.signal});
        preview.onclick=thumbnail.onclick=()=>showPreview(item,fetchPreview,version=>loadCopy(item,version));load.onclick=()=>loadCopy(item,item.version);
        const task={item,key,thumbnail,retry:thumbRetry,generation:renderGeneration,visible:!observer,controller:null,queued:false};thumbnailTasks.add(task);thumbnail.templateThumbnailTask=task;
        thumbRetry.onclick=()=>{thumbRetry.hidden=true;thumbnail.textContent='正在生成预览…';queueThumbnail(task)};
        if(thumbnailCache.has(key))global.KGTemplatePreview.mount(thumbnail,thumbnailCache.get(key).preview);else if(observer)observer.observe(thumbnail);else queueThumbnail(task);
        if(item.canMaintain){const management=el('details');management.className='template-card-management';const summary=el('summary','管理模板'),update=el('button','更新为新版本'),toggle=el('button',item.listed?'下架':'重新上架');update.type=toggle.type='button';management.append(summary,update,toggle);body.append(management);update.onclick=()=>form(item);toggle.onclick=()=>execute(async()=>{await request('/'+encodeURIComponent(item.id),{method:'PATCH',body:{listed:!item.listed},signal:lifetime.signal});if(isCurrent())await refresh()})}
      }
    }
    async function showPreview(item,fetchPreview,load){
      if(!isCurrent())return;
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
      use.onclick=async()=>{if(displayedVersion===null||!isCurrent())return;await dismiss();if(isCurrent())load(displayedVersion)};
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
      if(publicationForm){publicationForm.name.focus();status.textContent='请先完成或取消当前模板编辑。';return}
      const publisherId=publisher.username,publisherRole=publisher.role;
      const isCurrent=()=>!disposed&&context()?.fileId===current.fileId&&global.KGAuthCore?.currentUser?.()?.username===publisherId&&global.KGAuthCore?.currentUser?.()?.role===publisherRole;
      const editor=el('form');editor.className='template-publication-form';
      const nameField=el('label');nameField.className='template-field';nameField.append(el('span','模板名称'));
      const name=el('input');name.name='name';name.required=true;name.maxLength=200;name.value=item?.name||'知识图谱模板';name.placeholder='给模板起个名字';name.setAttribute('aria-label','模板名称');nameField.append(name);
      const descField=el('label');descField.className='template-field';descField.append(el('span','模板描述'));
      const description=el('textarea');description.name='description';description.maxLength=3000;description.value=item?.description||'';description.placeholder='描述模板内容与适用场景';description.setAttribute('aria-label','模板描述');descField.append(description);
      const categoryField=el('label');categoryField.className='template-field';categoryField.append(el('span','模板分类'));const category=el('select');category.name='category';category.setAttribute('aria-label','模板分类');for(const [id,label] of categories){if(id==='all')continue;const option=el('option',label);option.value=id;category.append(option)}category.value=item?categoryOf(item):'general';categoryField.append(category);
      const member=el('input');member.type='checkbox';member.checked=!!item?.memberOnly;member.name='memberOnly';const label=el('label','会员模板（加载需要有效会员） ');label.className='template-member-toggle';label.append(member);
      const submit=el('button',item?'发布新版本':'直接发布');submit.type='submit';submit.classList.add('template-submit-primary');const cancel=el('button','取消编辑');cancel.type='button';cancel.className='template-cancel';cancel.onclick=()=>{editor.remove();publicationForm=null};
      const row=el('div');row.className='template-form-actions';row.append(cancel,submit);
      editor.append(nameField,categoryField,descField,label,row);dialog.insertBefore(editor,list);publicationForm={editor,name};name.focus();
      editor.onsubmit=e=>{e.preventDefault();const cleanName=name.value.trim();if(!cleanName){status.textContent='请输入模板名称。';name.focus();return}execute(async()=>{
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
        await request(item?'/'+encodeURIComponent(item.id)+'/versions':'',{method:'POST',body:{sourceFileId:latest.fileId,expectedFileRevision:latest.revision,name:cleanName,description:description.value,memberOnly:member.checked,category:category.value},signal:lifetime.signal});
        editor.remove();publicationForm=null;const success=item?'新版本已发布，旧副本保留。':'模板已直接发布。';
        try{await refresh();status.textContent=success}catch(error){showCatalogError(error);status.textContent=success+'模板列表刷新失败，请点击重试加载。'}
      }).finally(()=>{submit.disabled=false;cancel.disabled=false})};
    }
    refresh().catch(showCatalogError);
  }
  global.KGGraphTemplateCenter={open,canPublish};
  if(typeof module==='object'&&module.exports)module.exports={canPublish,previewWindowPosition};
})(typeof window!=='undefined'?window:globalThis);
