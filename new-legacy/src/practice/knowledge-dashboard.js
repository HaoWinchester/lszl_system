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
  let instance;
  function init(options={}){
    if(instance)return instance;
    const document=global.document;if(!document?.body)return null;
    const dialog=document.createElement('dialog');dialog.className='kg-knowledge-dialog';dialog.id='kgKnowledgeDashboard';
    dialog.setAttribute('aria-labelledby','kgKnowledgeTitle');dialog.setAttribute('aria-describedby','kgKnowledgeMeaning');
    dialog.innerHTML=`<div class="kg-knowledge-dismiss"><button type="button" data-knowledge-close aria-label="关闭星空知识网络" autofocus>关闭 ×</button></div><div class="kg-knowledge-shell">
      <header class="kg-knowledge-header"><div><p class="kg-knowledge-eyebrow">我的学习足迹 · KNOWLEDGE SPACE</p><h2 id="kgKnowledgeTitle">星空知识网络</h2><p class="kg-knowledge-subtitle">从每一次练习，看到知识的连接。</p></div><div class="kg-knowledge-overview"><p data-knowledge-summary></p><button type="button" data-knowledge-refresh>刷新数据</button></div></header>
      <p data-knowledge-status role="status" aria-live="polite"></p><button type="button" data-knowledge-retry hidden>重试</button>
      <div class="kg-knowledge-body">
        <details class="kg-knowledge-detail" aria-label="选中考点详情"><summary>考点详情与列表</summary><div class="kg-knowledge-detail-content"><p class="kg-knowledge-eyebrow" data-knowledge-detail-subject></p><p class="kg-knowledge-number" data-knowledge-detail-number>—</p><h3 data-knowledge-detail-title>选择一个考点</h3><p class="kg-knowledge-path" data-knowledge-detail-path></p><dl class="kg-knowledge-facts"><div><dt>直接作答</dt><dd data-knowledge-detail-attempts>—</dd></div><div><dt>含下级作答</dt><dd data-knowledge-detail-related>—</dd></div><div><dt>最近直接练习</dt><dd data-knowledge-detail-date>—</dd></div></dl><div class="kg-knowledge-step"><button type="button" data-knowledge-node-prev>← 上一个</button><button type="button" data-knowledge-node-next>下一个 →</button><button type="button" data-knowledge-list-toggle aria-expanded="false" aria-controls="kgKnowledgeList">考点列表</button></div><ol id="kgKnowledgeList" data-knowledge-list class="kg-knowledge-list" hidden></ol></div></details>
        <section class="kg-knowledge-space" aria-label="知识星空探索"><div class="kg-knowledge-space-heading"><span data-knowledge-page-count>全目录 0 个节点</span><span>练习次数 · 含下级</span></div><div data-knowledge-network class="kg-knowledge-network" hidden></div><div class="kg-knowledge-space-empty" data-knowledge-space-empty>每一次练习，都留下足迹</div><div class="kg-knowledge-camera" role="group" aria-label="星空视角"><button type="button" data-knowledge-rotate-left aria-label="向左旋转星空">↶</button><button type="button" data-knowledge-rotate-right aria-label="向右旋转星空">↷</button><button type="button" data-knowledge-zoom-out aria-label="缩小星空">−</button><button type="button" data-knowledge-zoom-in aria-label="放大星空">＋</button><button type="button" data-knowledge-reset>复位视角</button></div><p class="kg-knowledge-help">横向拖动旋转 · 上下滚动浏览 · Ctrl / ⌘ 滚轮或双指缩放 · 缩小看分类，放大看考点<br>也可使用视角按钮和考点列表探索</p></section>
      </div>
      <footer class="kg-knowledge-footer"><div class="kg-knowledge-groups" data-knowledge-groups role="group" aria-label="全部科目和分类"></div></footer>
      <p id="kgKnowledgeMeaning">亮度表示节点及其下级的累计练习次数，20 次及以上最亮，不代表掌握程度。未练习节点也会显示。连线表示目录上下级关系。没有考点引用的作答只计入总数。</p>
    </div>`;
    document.body.appendChild(dialog);
    const find=selector=>dialog.querySelector(selector);
    const summary=find('[data-knowledge-summary]'),network=find('[data-knowledge-network]'),list=find('[data-knowledge-list]'),status=find('[data-knowledge-status]'),retry=find('[data-knowledge-retry]'),groups=find('[data-knowledge-groups]');
    find('.kg-knowledge-shell').prepend(network);
    let returnFocus=null,scene=null,nodes=[],selected=null,activeGroup='',listOpen=false;
    const formatDate=value=>{const date=value?new Date(value):null;return !date||Number.isNaN(date.getTime())?'时间未知':date.toLocaleDateString('zh-CN')};
    const setText=(name,value)=>{find(`[data-knowledge-${name}]`).textContent=text(value)};
    function toggleList(value){listOpen=value;list.hidden=!value||!nodes.length;find('[data-knowledge-list-toggle]').setAttribute('aria-expanded',String(!list.hidden))}
    function select(index,reveal=true){
      const node=nodes[index];if(!node)return;
      selected=index;if(reveal)scene?.select(index);
      setText('detail-subject',node.subject||'科目未标注');setText('detail-number',String(index+1).padStart(2,'0'));
      setText('detail-title',node.title||'未命名考点');setText('detail-path',Array.isArray(node.path)?node.path.map(text).join(' / ')||'无路径标签':'无路径标签');
      setText('detail-attempts',`${Number(node.attemptCount)||0} 次`);setText('detail-related',`${node.relatedAttemptCount} 次`);setText('detail-date',formatDate(node.lastPracticedAt));
      for(const button of list.querySelectorAll('button'))button.setAttribute('aria-pressed',String(Number(button.dataset.knowledgeNode)===index));
    }
    function focusGroup(key,reveal=true){
      activeGroup=key;scene?.focusGroup(key);
      for(const button of groups.querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.knowledgeGroup===key));
      for(const li of list.children)li.hidden=!!key&&groupKey(nodes[Number(li.firstChild.dataset.knowledgeNode)])!==key;
      if(selected===null||key&&groupKey(nodes[selected])!==key)select(nodes.findIndex(node=>!key||groupKey(node)===key),reveal);
    }
    function step(direction){
      const indices=nodes.map((node,index)=>!activeGroup||groupKey(node)===activeGroup?index:-1).filter(index=>index>=0);
      if(indices.length)select(indices[(indices.indexOf(selected)+direction+indices.length)%indices.length]);
    }
    function button(label,attribute,value){const element=document.createElement('button');element.type='button';element.textContent=label;element.setAttribute(attribute,value);return element}
    function render(data){
      scene?.destroy();scene=null;dialog.classList.remove('kg-knowledge-fallback');nodes=[];selected=null;activeGroup='';summary.textContent='';network.replaceChildren();list.replaceChildren();groups.replaceChildren();
      network.hidden=true;find('[data-knowledge-space-empty]').hidden=false;find('.kg-knowledge-detail').open=false;
      setText('detail-title','选择一个考点');setText('detail-number','—');setText('detail-subject','');setText('detail-path','');setText('detail-attempts','—');setText('detail-related','—');setText('detail-date','—');setText('page-count','全目录 0 个节点');
      for(const control of dialog.querySelectorAll('.kg-knowledge-step button,.kg-knowledge-camera button'))control.disabled=true;
      toggleList(listOpen);if(!data)return;
      nodes=derivePracticeOverlay(data.nodes);
      summary.textContent=`累计 ${Number(data.attemptCount)||0} 次作答 · ${nodes.length} 个目录节点 · 已点亮 ${nodes.filter(node=>node.relatedAttemptCount>0).length} 个${data.unknownAttemptCount?` · ${Number(data.unknownAttemptCount)} 次作答暂无考点引用`:''}${data.unmappedAttemptCount?` · ${Number(data.unmappedAttemptCount)} 次作答未映射到当前目录`:''}。`;
      setText('page-count',`全目录 ${nodes.length} 个节点`);
      list.start=1;
      for(const [index,node] of nodes.entries()){
        const li=document.createElement('li'),item=button(`${String(index+1).padStart(2,'0')} · ${node.title||'未命名考点'}`,'data-knowledge-node',index);
        item.setAttribute('aria-pressed','false');li.appendChild(item);list.appendChild(li);
      }
      if(nodes.length){
        groups.appendChild(button('全部考点','data-knowledge-group',''));
        const seen=new Map();for(const node of nodes){const key=groupKey(node);if(!seen.has(key))seen.set(key,[]);seen.get(key).push(node)}
        for(const [key,members] of seen){
          const label=global.KGKnowledgeSpaceScene?.classificationLabel(members)||`${members[0].subject||'科目未标注'} · 未分类`;
          groups.appendChild(button(`${label} / ${members.length}`,'data-knowledge-group',key));
        }
        network.hidden=false;find('[data-knowledge-space-empty]').hidden=true;
        try{scene=global.KGKnowledgeSpaceScene?.mount({host:network,nodes,onSelect:(_,index)=>{select(index);find('.kg-knowledge-detail').open=true},onGroup:key=>focusGroup(key,false)})||null}catch(error){scene=null;network.replaceChildren()}
        for(const control of dialog.querySelectorAll('.kg-knowledge-step button'))control.disabled=false;
        for(const control of dialog.querySelectorAll('.kg-knowledge-camera button'))control.disabled=!scene;
        focusGroup('',false);select(0,false);toggleList(!scene||listOpen);if(!scene){dialog.classList.add('kg-knowledge-fallback');find('.kg-knowledge-detail').open=true;}
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
      find('[data-knowledge-close]').focus();return loader.refresh();
    }
    dialog.addEventListener('click',event=>{
      if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();return}
      const button=event.target.closest('button');if(!button||button.disabled)return;
      if(button.hasAttribute('data-knowledge-close'))close();
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
      if(event.key!=='Tab')return;
      const buttons=[...dialog.querySelectorAll('button:not(:disabled)')].filter(button=>!button.closest('[hidden]')&&button.getClientRects().length);
      const first=buttons[0],last=buttons.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    });
    dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
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
