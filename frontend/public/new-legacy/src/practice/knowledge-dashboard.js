'use strict';
(function(global){
  function derivePracticeOverlay(input){
    const nodes=(Array.isArray(input)?input:[]).filter(node=>node&&typeof node==='object').map(node=>({...node,relatedAttemptCount:0}));
    const key=(node,id)=>JSON.stringify([String(node.subject||''),String(node.taxonomyId??''),String(id)]),byId=new Map();
    for(const node of nodes)if(node.id!=null){const id=key(node,node.id);byId.set(id,byId.has(id)?null:node)}
    for(const node of nodes){
      const raw=Number(node.attemptCount),count=Number.isFinite(raw)&&raw>0?raw:0,visited=new Set();
      let current=node;
      while(current&&!visited.has(current)){
        visited.add(current);current.relatedAttemptCount+=count;
        current=current.parentId==null?null:byId.get(key(current,current.parentId));
      }
    }
    for(const node of nodes)node.brightness=.12+.88*Math.min(Math.log1p(node.relatedAttemptCount)/Math.log(21),1);
    return nodes;
  }
  const text=value=>String(value??'');
  function currentOwner(){try{return global.KGAuthCore?.currentUser?.()?.username||''}catch(error){return ''}}
  function createLoader({getUser,load,onData,onState}){
    let generation=0;
    function invalidate(){generation++;onData(null)}
    async function refresh(){
      const owner=getUser(),request=++generation;onData(null);
      if(!owner){onState('guest');return false}
      onState('loading');
      try{
        const data=await load();
        if(request!==generation||owner!==getUser())return false;
        if(!data||!Array.isArray(data.nodes))throw Error('Invalid dashboard response');
        onData(data);onState(data.nodes.length?'ready':'empty');return true;
      }catch(error){
        if(request!==generation||owner!==getUser())return false;
        onData(null);onState(error?.status===401?'guest':'error');return false;
      }
    }
    return Object.freeze({refresh,invalidate});
  }
  async function fetchUniverse(){
    if(!global.KGDomainApi?.request)throw Error('API client unavailable');
    return global.KGDomainApi.request({path:'/api/v1/learning/practice/knowledge-universe'});
  }
  const groupKey=node=>global.KGKnowledgeSpaceScene?.groupKey(node)||JSON.stringify([text(node.subject||''),text(node.taxonomyId??'')]);
  const categoryColor=key=>global.KGKnowledgeSpaceScene?.categoryColor?.(key)||'#8193a8';
  let instance;
  function init(options={}){
    if(instance)return instance;
    const document=global.document;if(!document?.body)return null;
    const dialog=document.createElement('dialog');dialog.className='kg-knowledge-dialog';dialog.id='kgKnowledgeDashboard';
    dialog.setAttribute('aria-labelledby','kgKnowledgeTitle');dialog.setAttribute('aria-describedby','kgKnowledgeMeaning');
    dialog.innerHTML=`<div class="kg-knowledge-dismiss"><button type="button" data-knowledge-close aria-label="关闭星空知识网络" autofocus>关闭 ×</button></div><div class="kg-knowledge-shell">
      <header class="kg-knowledge-header"><section class="brand"><div class="overline">我的学习足迹 · THE MAP · SCALE</div><h1 id="kgKnowledgeTitle"><em data-knowledge-subject-title>知识目录</em><br>星空知识网络</h1><div class="sub">PEOPLE · PROCESS · ENVIRONMENT · KNOWLEDGE GRAPH</div></section><section class="hud interactive"><div class="card progress-card"><div class="kicker">练习覆盖 · PRACTICE COVERAGE</div><div class="progress-line"><div class="track"><div class="fill" data-knowledge-coverage-fill></div></div><div class="value" data-knowledge-coverage>0 / 0</div></div></div><div class="card level-card"><div class="kicker">累计练习 · PRACTICE VOLUME</div><div class="level-row"><div class="level" data-knowledge-attempt-total>0</div><div class="xp">次作答</div></div></div></section></header>
      <p data-knowledge-summary hidden></p><p data-knowledge-status role="status" aria-live="polite"></p><button type="button" data-knowledge-retry hidden>重试</button>
      <div class="kg-knowledge-body info">
        <button class="btn primary" type="button" data-knowledge-details-open>考点详情与列表</button><dialog class="kg-knowledge-detail" aria-label="考点详情与列表"><button type="button" data-knowledge-details-close autofocus>返回星空 ×</button><div class="kg-knowledge-detail-content"><p class="kg-knowledge-eyebrow" data-knowledge-detail-subject></p><p class="kg-knowledge-number" data-knowledge-detail-number>—</p><h3 data-knowledge-detail-title>选择一个考点</h3><p class="kg-knowledge-path" data-knowledge-detail-path></p><dl class="kg-knowledge-facts"><div><dt>直接作答</dt><dd data-knowledge-detail-attempts>—</dd></div><div><dt>含下级作答</dt><dd data-knowledge-detail-related>—</dd></div><div><dt>最近直接练习</dt><dd data-knowledge-detail-date>—</dd></div></dl><div class="kg-knowledge-step"><button type="button" data-knowledge-node-prev>← 上一个</button><button type="button" data-knowledge-node-next>下一个 →</button><button type="button" data-knowledge-list-toggle aria-expanded="false" aria-controls="kgKnowledgeList">考点列表</button></div><ol id="kgKnowledgeList" data-knowledge-list class="kg-knowledge-list" hidden></ol></div></dialog>
        <section class="kg-knowledge-space" aria-label="知识星空探索"><div class="kg-knowledge-space-heading"><span data-knowledge-page-count>全目录 0 个节点</span><span>练习次数 · 含下级</span></div><div data-knowledge-network class="kg-knowledge-network" hidden></div><div class="kg-knowledge-space-empty" data-knowledge-space-empty>每一次练习，都留下足迹</div><div class="kg-knowledge-camera" role="group" aria-label="星空视角"><button type="button" data-knowledge-rotate-left aria-label="向左旋转星空">↶</button><button type="button" data-knowledge-rotate-right aria-label="向右旋转星空">↷</button><button type="button" data-knowledge-zoom-out aria-label="缩小星空">−</button><button type="button" data-knowledge-zoom-in aria-label="放大星空">＋</button><button type="button" data-knowledge-labels aria-pressed="false">显示文字</button><button type="button" data-knowledge-reset>复位视角</button></div><p class="kg-knowledge-help">横向拖动旋转 · 上下滚动浏览 · Ctrl / ⌘ 滚轮或双指缩放 · 缩小看分类，放大看考点<br>也可使用视角按钮和考点列表探索</p></section>
      </div>
      <footer class="kg-knowledge-footer"><div class="kg-knowledge-groups module-strip interactive" data-knowledge-groups role="group" aria-label="全部科目和分类"></div></footer>
      <p id="kgKnowledgeMeaning">亮度表示节点及其下级的累计练习次数，20 次及以上最亮，不代表掌握程度。未练习节点也会显示。连线表示目录上下级关系。没有考点引用的作答只计入总数。</p>
    </div>`;
    document.body.appendChild(dialog);
    const find=selector=>dialog.querySelector(selector);
    const summary=find('[data-knowledge-summary]'),network=find('[data-knowledge-network]'),list=find('[data-knowledge-list]'),status=find('[data-knowledge-status]'),retry=find('[data-knowledge-retry]'),groups=find('[data-knowledge-groups]');
    // Original-reference.html layout: canvas + vignette/scanlines/noise behind the .ui grid.
    const shell=find('.kg-knowledge-shell'),ui=document.createElement('main');ui.className='ui';
    ui.append(find('.kg-knowledge-header'),find('.kg-knowledge-body'));
    const stage=document.createElement('section');stage.className='kg-knowledge-stage';ui.append(stage,find('.kg-knowledge-footer'));
    shell.prepend(network);for(const name of ['vignette','scanlines','noise']){const layer=document.createElement('div');layer.className=name;layer.setAttribute('aria-hidden','true');shell.append(layer)}shell.append(ui);
    const dock=find('.kg-knowledge-footer'),help=document.createElement('details'),helpTitle=document.createElement('summary');
    help.className='kg-knowledge-guidance';helpTitle.textContent='操作与亮度说明';summary.hidden=false;help.append(helpTitle,summary,find('.kg-knowledge-help'),find('#kgKnowledgeMeaning'));
    const secondary=document.createElement('div');secondary.className='kg-knowledge-secondary';const autoButton=document.createElement('button');autoButton.type='button';autoButton.setAttribute('data-knowledge-auto-rotate','');autoButton.disabled=true;function rotationState(value){autoButton.textContent=value?'暂停旋转':'开始旋转';autoButton.setAttribute('aria-pressed',String(value))}rotationState(false);secondary.append(autoButton,help);dock.append(find('.kg-knowledge-camera'));find('.kg-knowledge-body').append(secondary);
    const reading=document.createElement('section');reading.className='kg-knowledge-focus';reading.setAttribute('aria-label','当前考点');
    reading.innerHTML='<p class="module-line" data-knowledge-focus-subject></p><p class="kg-knowledge-focus-number big-index" data-knowledge-focus-number>—</p><h3 class="topic" data-knowledge-focus-title>选择一个考点</h3><p class="kg-knowledge-path desc" data-knowledge-focus-path></p><dl class="kg-knowledge-facts status"><div class="chip"><dt>直接作答</dt><dd data-knowledge-focus-attempts>—</dd></div><div class="chip"><dt>含下级作答</dt><dd data-knowledge-focus-related>—</dd></div></dl>';
    find('.kg-knowledge-body').prepend(reading);
    const actions=document.createElement('div');actions.className='actions interactive';actions.append(find('[data-knowledge-details-open]'));
    const refresh=document.createElement('button');refresh.type='button';refresh.className='btn';refresh.setAttribute('data-knowledge-refresh','');refresh.textContent='刷新数据';actions.append(refresh,find('[data-knowledge-close]'));find('.kg-knowledge-dismiss').remove();reading.after(actions);
    for(const control of dialog.querySelectorAll('button'))control.classList.add('btn');

    const detail=find('.kg-knowledge-detail');let detailReturnFocus=null,labelsVisible=false;
    function closeDetail(){if(detail.open)detail.close();scene?.setRotationPaused(false);detailReturnFocus?.focus?.();detailReturnFocus=null}
    function openDetail(){if(!nodes.length)return;detailReturnFocus=document.activeElement;toggleList(true);if(!detail.open)detail.showModal();scene?.setRotationPaused(true)}
    detail.addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();closeDetail()});
    let returnFocus=null,scene=null,nodes=[],selected=null,activeGroup='',listOpen=false;
    const formatDate=value=>{const date=value?new Date(value):null;return !date||Number.isNaN(date.getTime())?'时间未知':date.toLocaleDateString('zh-CN')};
    const setText=(name,value)=>{find(`[data-knowledge-${name}]`).textContent=text(value);const inline=find(`[data-knowledge-${name.replace('detail-','focus-')}]`);if(inline)inline.textContent=text(value)};
    function toggleList(value){listOpen=value;list.hidden=!value||!nodes.length;find('[data-knowledge-list-toggle]').setAttribute('aria-expanded',String(!list.hidden))}
    function select(index,reveal=true){
      const node=nodes[index];if(!node)return;
      selected=index;scene?.select(index,reveal);
      setText('detail-subject',node.subject||'科目未标注');find('[data-knowledge-focus-subject]').textContent=[node.subject,JSON.parse(groupKey(node))[2]].filter(Boolean).join(' · ');reading.style.setProperty('--category-color',categoryColor(groupKey(node)));setText('detail-number',String(index+1).padStart(2,'0'));
      setText('detail-title',node.title||'未命名考点');setText('detail-path',Array.isArray(node.path)?node.path.map(text).join(' / ')||'无路径标签':'无路径标签');
      setText('detail-attempts',`${Number(node.attemptCount)||0} 次`);setText('detail-related',`${node.relatedAttemptCount} 次`);setText('detail-date',formatDate(node.lastPracticedAt));
      for(const button of list.querySelectorAll('button'))button.setAttribute('aria-pressed',String(Number(button.dataset.knowledgeNode)===index));
    }
    function focusGroup(key,reveal=true){
      activeGroup=key;scene?.focusGroup(key);
      for(const button of groups.querySelectorAll('button')){button.setAttribute('aria-pressed',String(button.dataset.knowledgeGroup===key));button.classList.toggle('active',button.dataset.knowledgeGroup===key)}
      for(const li of list.children)li.hidden=!!key&&groupKey(nodes[Number(li.firstChild.dataset.knowledgeNode)])!==key;
      if(selected===null||key&&groupKey(nodes[selected])!==key)select(nodes.findIndex(node=>!key||groupKey(node)===key),reveal);
    }
    function step(direction){
      const indices=nodes.map((node,index)=>!activeGroup||groupKey(node)===activeGroup?index:-1).filter(index=>index>=0);
      if(indices.length)select(indices[(indices.indexOf(selected)+direction+indices.length)%indices.length]);
    }
    function button(label,attribute,value){const element=document.createElement('button');element.type='button';element.className='btn';element.textContent=label;element.setAttribute(attribute,value);if(attribute==='data-knowledge-group'){element.className='module-btn';const title=document.createElement('div');title.className='mt';title.textContent=label;const number=document.createElement('div');number.className='mn';number.textContent=value?JSON.parse(value)[2]:'ALL';const track=document.createElement('div');track.className='mp';track.appendChild(document.createElement('i'));element.replaceChildren(number,title,track)}return element}
    function render(data){
      closeDetail();autoButton.disabled=true;rotationState(false);scene?.destroy();scene=null;dialog.classList.remove('kg-knowledge-fallback');nodes=[];selected=null;activeGroup='';summary.textContent='';find('[data-knowledge-subject-title]').textContent='知识目录';find('[data-knowledge-attempt-total]').textContent='0';find('[data-knowledge-coverage]').textContent='0 / 0';find('[data-knowledge-coverage-fill]').style.width='0%';network.replaceChildren();list.replaceChildren();groups.replaceChildren();
      network.hidden=true;find('[data-knowledge-space-empty]').hidden=false;
      setText('detail-title','选择一个考点');setText('detail-number','—');setText('detail-subject','');setText('detail-path','');setText('detail-attempts','—');setText('detail-related','—');setText('detail-date','—');setText('page-count','全目录 0 个节点');
      for(const control of dialog.querySelectorAll('.kg-knowledge-step button,.kg-knowledge-camera button'))control.disabled=true;
      toggleList(listOpen);if(!data)return;
      nodes=derivePracticeOverlay(data.nodes).filter(node=>!global.KGKnowledgeSpaceScene?.isSubjectOverviewNode(node));
      find('[data-knowledge-subject-title]').textContent=[...new Set(nodes.map(node=>node.subject).filter(Boolean))].join(' · ')||'知识目录';find('[data-knowledge-attempt-total]').textContent=Number(data.attemptCount)||0;const covered=nodes.filter(node=>node.relatedAttemptCount>0).length;find('[data-knowledge-coverage]').textContent=`${covered} / ${nodes.length}`;find('[data-knowledge-coverage-fill]').style.width=`${nodes.length?covered/nodes.length*100:0}%`;
      summary.textContent=`累计 ${Number(data.attemptCount)||0} 次作答 · ${nodes.length} 个目录节点 · 已点亮 ${nodes.filter(node=>node.relatedAttemptCount>0).length} 个${data.unknownAttemptCount?` · ${Number(data.unknownAttemptCount)} 次作答暂无考点引用`:''}${data.unmappedAttemptCount?` · ${Number(data.unmappedAttemptCount)} 次作答未映射到当前目录`:''}。`;
      setText('page-count',`全目录 ${nodes.length} 个节点`);
      list.start=1;
      for(const [index,node] of nodes.entries()){
        const li=document.createElement('li'),item=button(`${String(index+1).padStart(2,'0')} · ${node.title||'未命名考点'}`,'data-knowledge-node',index);
        item.setAttribute('aria-pressed','false');li.appendChild(item);list.appendChild(li);
      }
      if(nodes.length){
        const all=button('全部考点','data-knowledge-group','');all.querySelector('.mp i').style.width=`${covered/nodes.length*100}%`;groups.appendChild(all);
        const seen=new Map();for(const node of nodes){const key=groupKey(node);if(!seen.has(key))seen.set(key,[]);seen.get(key).push(node)}
        for(const [key,members] of seen){
          const label=global.KGKnowledgeSpaceScene?.classificationLabel(members)||`${members[0].subject||'科目未标注'} · 未分类`;
          const category=button(`${label} / ${members.length}`,'data-knowledge-group',key);category.style.setProperty('--category-color',categoryColor(key));category.querySelector('.mp i').style.width=`${members.filter(n=>n.relatedAttemptCount>0).length/members.length*100}%`;groups.appendChild(category);
        }
        network.hidden=false;find('[data-knowledge-space-empty]').hidden=true;
        try{scene=global.KGKnowledgeSpaceScene?.mount({host:network,nodes,autoRotate:true,onAutoRotateChange:rotationState,insets:()=>({plot:false}),onSelect:(_,index)=>select(index),onGroup:key=>focusGroup(key,false)})||null}catch(error){scene=null;network.replaceChildren()}
        for(const control of dialog.querySelectorAll('.kg-knowledge-step button'))control.disabled=false;
        for(const control of dialog.querySelectorAll('.kg-knowledge-camera button'))control.disabled=!scene;
        autoButton.disabled=!scene;rotationState(scene?.snapshot().autoRotate||false);scene?.setLabelsVisible(labelsVisible);focusGroup('',false);select(0,false);toggleList(!scene||listOpen);if(!scene){dialog.classList.add('kg-knowledge-fallback');}
      }
    }
    function setState(value){
      status.textContent=({loading:'正在读取全部知识目录与练习记录…',guest:'登录后查看自己的知识星空。',empty:'当前暂无已发布的知识目录。',error:'知识星空暂时无法读取，请重试。',ready:scene?'':'当前设备无法显示三维星空，请通过考点列表查看详情。'})[value]||'';
      retry.hidden=value!=='error';network.hidden=value!=='ready'||!scene;
      find('[data-knowledge-refresh]').disabled=value==='loading';dialog.setAttribute('aria-busy',String(value==='loading'));
    }
    const loader=createLoader({getUser:options.getUser||currentOwner,load:options.load||fetchUniverse,onData:render,onState:setState});
    function restoreFocus(){returnFocus?.focus?.();returnFocus=null}
    let backgroundOverflow;
    function unlockBackground(){if(backgroundOverflow!==undefined){document.body.style.overflow=backgroundOverflow;backgroundOverflow=undefined}}
    function close(){loader.invalidate();if(dialog.open)dialog.close();unlockBackground();restoreFocus()}
    function open(){
      if(!dialog.open){returnFocus=document.activeElement;backgroundOverflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();find('.kg-knowledge-shell').scrollTop=0}
      find('[data-knowledge-close]').focus({preventScroll:true});return loader.refresh();
    }
    dialog.addEventListener('click',event=>{
      if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();return}
      const button=event.target.closest('button');if(!button||button.disabled)return;
      if(button.hasAttribute('data-knowledge-auto-rotate'))scene?.setAutoRotate(!scene.snapshot().autoRotate);
      else if(button.hasAttribute('data-knowledge-details-close'))closeDetail();
      else if(button.hasAttribute('data-knowledge-details-open'))openDetail();
      else if(button.hasAttribute('data-knowledge-labels')){labelsVisible=!labelsVisible;button.setAttribute('aria-pressed',String(labelsVisible));scene?.setLabelsVisible(labelsVisible)}
      else if(button.hasAttribute('data-knowledge-close'))close();
      else if(button.hasAttribute('data-knowledge-retry')||button.hasAttribute('data-knowledge-refresh'))void loader.refresh();
      else if(button.hasAttribute('data-knowledge-node'))select(Number(button.dataset.knowledgeNode));
      else if(button.hasAttribute('data-knowledge-group'))focusGroup(button.dataset.knowledgeGroup);
      else if(button.hasAttribute('data-knowledge-node-prev'))step(-1);
      else if(button.hasAttribute('data-knowledge-node-next'))step(1);
      else if(button.hasAttribute('data-knowledge-list-toggle'))toggleList(!listOpen);
      else if(button.hasAttribute('data-knowledge-reset')){scene?.reset();focusGroup('')}
      else if(button.hasAttribute('data-knowledge-zoom-out'))scene?.zoomBy(1/1.2);
      else if(button.hasAttribute('data-knowledge-zoom-in'))scene?.zoomBy(1.2);
      else if(button.hasAttribute('data-knowledge-rotate-left'))scene?.rotate(-30,0);
      else if(button.hasAttribute('data-knowledge-rotate-right'))scene?.rotate(30,0);
    });
    dialog.addEventListener('keydown',event=>{
      if(detail.open||event.key!=='Tab')return;
      const buttons=[...dialog.querySelectorAll('button:not(:disabled),summary')].filter(button=>!button.closest('[hidden]')&&button.getClientRects().length);
      const first=buttons[0],last=buttons.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    });
    dialog.addEventListener('cancel',event=>{if(event.target!==dialog)return;event.preventDefault();close()});
    dialog.addEventListener('close',()=>{if(!dialog.open){loader.invalidate();unlockBackground();restoreFocus()}});
    global.addEventListener?.('kg-auth-session-change',()=>{loader.invalidate();if(dialog.open){void loader.refresh()}});
    global.addEventListener?.('pagehide',close);
    instance=Object.freeze({open,close,refresh:()=>loader.refresh()});return instance;
  }
  const api=Object.freeze({init,open:()=>init()?.open(),close:()=>instance?.close(),createLoader,derivePracticeOverlay});
  global.KGKnowledgeDashboard=api;
  global.document?.addEventListener('click',event=>{
    const trigger=event.target?.closest?.('[data-knowledge-dashboard-open]');
    if(trigger){event.preventDefault();void api.open()}
  });
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
