'use strict';
(function(global){
  const PAGE_SIZE=60;
  const text=value=>String(value??'');
  const escape=value=>text(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function currentOwner(){try{return global.KGAuthCore?.currentUser?.()?.username||''}catch(error){return ''}}
  function createLoader({getUser,load,onData,onState}){
    let generation=0;
    function invalidate(){generation++;onData(null)}
    async function refresh(page=1){
      const owner=getUser(),request=++generation;onData(null);
      if(!owner){onState('guest');return false}
      onState('loading');
      try{
        const data=await load(page);
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
  function starPositions(nodes){
    // Deterministic layout, no random/fake practice data and no simulation loop.
    const subjects=[...new Set(nodes.map(node=>text(node.subject)))];
    return nodes.map((node,index)=>{
      const columns=Math.min(3,subjects.length),group=subjects.indexOf(text(node.subject)),column=group%columns,row=Math.floor(group/columns),rows=Math.ceil(subjects.length/columns);
      const same=nodes.filter(n=>text(n.subject)===text(node.subject)),within=same.indexOf(node);
      const angle=within*2.399963229728653,radius=same.length===1?0:18+Math.sqrt(within/Math.max(1,same.length-1))*Math.min(145,280/columns);
      return {node,x:(column+.5)*800/columns+Math.cos(angle)*radius,y:((row+.5)*420/rows)+Math.sin(angle)*Math.min(radius,160/rows),index};
    });
  }
  function networkMarkup(nodes){
    const positions=starPositions(nodes),last=new Map();
    const edges=positions.map(point=>{
      const key=text(point.node.subject)+'\0'+text(point.node.taxonomyId),previous=last.get(key);last.set(key,point);
      return previous?`<line x1="${previous.x.toFixed(2)}" y1="${previous.y.toFixed(2)}" x2="${point.x.toFixed(2)}" y2="${point.y.toFixed(2)}"/>`:'';
    }).join('');
    const stars=positions.map(({node,x,y,index})=>{
      const brightness=Math.max(.2,Math.min(1,Number(node.brightness)||.2));
      return `<g style="opacity:${brightness}"><circle class="kg-knowledge-halo" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${5+brightness*6}"/><circle class="kg-knowledge-star" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3"/><text x="${x.toFixed(2)}" y="${(y+23).toFixed(2)}">${index+1}</text><title>${escape(node.subject||'科目未标注')} · ${escape(node.title)} · ${Number(node.attemptCount)||0} 次作答</title></g>`;
    }).join('');
    return `<svg viewBox="0 0 800 420" role="img" aria-label="本页考点练习新鲜度星空，完整考点信息见下方列表"><g class="kg-knowledge-edges">${edges}</g>${stars}</svg>`;
  }
  async function fetchPage(page){
    if(!global.KGDomainApi?.request)throw Error('API client unavailable');
    return global.KGDomainApi.request({path:`/api/v1/learning/practice/knowledge-dashboard?page=${page}&pageSize=${PAGE_SIZE}`});
  }
  let instance;
  function init(options={}){
    if(instance)return instance;
    const document=global.document;if(!document?.body)return null;
    const dialog=document.createElement('dialog');dialog.className='kg-knowledge-dialog';dialog.id='kgKnowledgeDashboard';
    dialog.setAttribute('aria-labelledby','kgKnowledgeTitle');dialog.setAttribute('aria-describedby','kgKnowledgeMeaning');
    dialog.innerHTML=`<div class="kg-knowledge-shell"><header><div><p class="kg-knowledge-eyebrow">我的学习足迹</p><h2 id="kgKnowledgeTitle">星空知识网络</h2></div><button type="button" data-knowledge-close aria-label="关闭星空知识网络" autofocus>关闭</button></header><p id="kgKnowledgeMeaning">每次已保存的有效作答点亮对应考点。没有考点引用的作答计入总数，不产生星点。亮度仅表示最近练习的新鲜度，30 天内逐渐变暗，不代表掌握程度。连线仅用于组织同科目考点。</p><div class="kg-knowledge-toolbar"><p data-knowledge-summary></p><button type="button" data-knowledge-refresh>刷新数据</button></div><p data-knowledge-status role="status" aria-live="polite"></p><button type="button" data-knowledge-retry hidden>重试</button><div data-knowledge-network class="kg-knowledge-network"></div><ol data-knowledge-list class="kg-knowledge-list"></ol><nav class="kg-knowledge-pagination" aria-label="考点分页" hidden><button type="button" data-knowledge-prev>上一页</button><span data-knowledge-page></span><button type="button" data-knowledge-next>下一页</button></nav></div>`;
    document.body.appendChild(dialog);
    const find=selector=>dialog.querySelector(selector);
    const summary=find('[data-knowledge-summary]'),network=find('[data-knowledge-network]'),list=find('[data-knowledge-list]'),status=find('[data-knowledge-status]'),retry=find('[data-knowledge-retry]'),pagination=find('nav');
    let page=1,returnFocus=null,lastData=null;
    const formatDate=value=>{const date=new Date(value);return Number.isNaN(date.getTime())?'时间未知':date.toLocaleDateString('zh-CN')};
    function render(data){
      lastData=data;summary.textContent='';network.innerHTML='';list.innerHTML='';pagination.hidden=true;
      if(!data)return;
      summary.textContent=`累计 ${Number(data.attemptCount)||0} 次作答 · 近 7 天 ${Number(data.recentAttemptCount)||0} 次 · ${Number(data.topicCount)||0} 个考点${data.unknownAttemptCount?` · ${Number(data.unknownAttemptCount)} 次作答暂无考点引用`:''}。`;
      network.innerHTML=networkMarkup(data.nodes);
      list.start=(page-1)*PAGE_SIZE+1;
      list.innerHTML=data.nodes.map(node=>`<li><div><strong>${escape(node.title)}</strong><span>${escape(node.subject||'科目未标注')} · ${escape((node.path||[]).join(' / ')||'无路径标签')}</span></div><span>${Number(node.attemptCount)||0} 次 · 最近 ${escape(formatDate(node.lastPracticedAt))}</span></li>`).join('');
      pagination.hidden=Number(data.topicCount)<=PAGE_SIZE;find('[data-knowledge-prev]').disabled=page===1;find('[data-knowledge-next]').disabled=!data.hasMore;
      find('[data-knowledge-page]').textContent=`第 ${page} / ${Math.max(1,Math.ceil(Number(data.topicCount)/PAGE_SIZE))} 页`;
    }
    function setState(value){
      status.textContent=({loading:'正在读取你的已保存作答…',guest:'登录后查看自己的知识星空。',empty:lastData?.attemptCount?'这些作答尚未保存可识别的考点引用，暂时无法形成知识星空。':'保存有效作答后，对应考点会在这里点亮。',error:'知识星空暂时无法读取，请重试。'})[value]||'';
      retry.hidden=value!=='error';network.hidden=value!=='ready';list.hidden=value!=='ready';
      find('[data-knowledge-refresh]').disabled=value==='loading';dialog.setAttribute('aria-busy',String(value==='loading'));
    }
    const loader=createLoader({getUser:options.getUser||currentOwner,load:options.load||fetchPage,onData:render,onState:setState});
    function close(){loader.invalidate();if(dialog.open)dialog.close();returnFocus?.focus?.();returnFocus=null}
    function open(){
      if(!dialog.open){returnFocus=document.activeElement;dialog.showModal()}
      page=1;find('[data-knowledge-close]').focus();return loader.refresh(page);
    }
    dialog.addEventListener('click',event=>{
      if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close();return}
      const button=event.target.closest('button');if(!button)return;
      if(button.hasAttribute('data-knowledge-close'))close();
      else if(button.hasAttribute('data-knowledge-prev')){page=Math.max(1,page-1);void loader.refresh(page)}
      else if(button.hasAttribute('data-knowledge-next')){page++;void loader.refresh(page)}
      else if(button.hasAttribute('data-knowledge-retry')||button.hasAttribute('data-knowledge-refresh'))void loader.refresh(page);
    });
    dialog.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return;
      const buttons=[...dialog.querySelectorAll('button:not(:disabled)')].filter(button=>!button.closest('[hidden]')&&button.getClientRects().length);
      const first=buttons[0],last=buttons.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    });
    dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
    dialog.addEventListener('close',()=>{if(!dialog.open)loader.invalidate()});
    global.addEventListener?.('kg-auth-session-change',()=>{loader.invalidate();if(dialog.open){page=1;void loader.refresh(page)}});
    instance=Object.freeze({open,close,refresh:()=>loader.refresh(page)});return instance;
  }
  const api=Object.freeze({init,open:()=>init()?.open(),close:()=>instance?.close(),createLoader,networkMarkup,starPositions});
  global.KGKnowledgeDashboard=api;
  global.document?.addEventListener('click',event=>{
    const trigger=event.target?.closest?.('[data-knowledge-dashboard-open]');
    if(trigger){event.preventDefault();void api.open()}
  });
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
