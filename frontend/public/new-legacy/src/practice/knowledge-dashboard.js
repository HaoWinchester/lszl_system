'use strict';
(function(global){
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
  const groupKey=node=>JSON.stringify([text(node.subject||''),text(node.taxonomyId||'')]);
  function findMatches(nodes,query,subjects=[]){
    const normalize=value=>text(value).normalize('NFKC').toLocaleLowerCase(),terms=normalize(query).trim().split(/\s+/).filter(Boolean);
    if(!terms.length)return [];
    return nodes.flatMap((node,index)=>{
      const subject=subjects.find(item=>item.code===node.subject)?.name||'';
      const content=normalize([node.title,node.subject,subject,node.taxonomyTitle,...(Array.isArray(node.path)?node.path:[]),node.description,...(Array.isArray(node.keywords)?node.keywords:[])].filter(Boolean).join(' '));
      return terms.every(term=>content.includes(term))?[index]:[];
    });
  }
  let instance;
  function init(options={}){
    if(instance)return instance;
    const document=global.document;if(!document?.body)return null;
    const dialog=document.createElement('dialog');dialog.className='kg-knowledge-dialog';dialog.id='kgKnowledgeDashboard';
    dialog.setAttribute('aria-labelledby','kgKnowledgeTitle');dialog.setAttribute('aria-describedby','kgKnowledgeMeaning');
    dialog.innerHTML=`<div class="kg-knowledge-dismiss"><button type="button" data-knowledge-close aria-label="关闭星空知识网络" autofocus>关闭 ×</button></div><div class="kg-knowledge-shell">
      <header class="kg-knowledge-header"><div><p class="kg-knowledge-eyebrow">我的知识宇宙 · KNOWLEDGE SPACE</p><h2 id="kgKnowledgeTitle">星空知识网络</h2><p class="kg-knowledge-subtitle">已练知识点组成星空，未练知识点在旁边探索。</p></div><div class="kg-knowledge-overview"><p data-knowledge-summary></p><button type="button" data-knowledge-refresh>刷新数据</button></div></header>
      <p data-knowledge-status role="status" aria-live="polite"></p><button type="button" data-knowledge-retry hidden>重试</button>
      <div class="kg-knowledge-body">
        <section class="kg-knowledge-detail" aria-label="选中考点详情"><p class="kg-knowledge-eyebrow" data-knowledge-detail-subject></p><p class="kg-knowledge-number" data-knowledge-detail-number>—</p><h3 data-knowledge-detail-title>选择一个考点</h3><p class="kg-knowledge-path" data-knowledge-detail-path></p><dl class="kg-knowledge-facts"><div><dt>已保存作答</dt><dd data-knowledge-detail-attempts>—</dd></div><div><dt>最近练习</dt><dd data-knowledge-detail-date>—</dd></div><div><dt>综合分值</dt><dd data-knowledge-detail-score>—</dd></div><div><dt>近期正确率 / 样本</dt><dd data-knowledge-detail-accuracy>—</dd></div><div><dt>近期连对</dt><dd data-knowledge-detail-streak>—</dd></div></dl><div class="kg-knowledge-step"><button type="button" data-knowledge-node-prev>← 上一个</button><button type="button" data-knowledge-node-next>下一个 →</button><button type="button" data-knowledge-list-toggle aria-expanded="false" aria-controls="kgKnowledgeList">已练考点</button></div><ol id="kgKnowledgeList" data-knowledge-list class="kg-knowledge-list" hidden></ol><h4 class="kg-knowledge-unpracticed-heading" data-knowledge-unpracticed-count>未练知识点 · 0</h4><p class="kg-knowledge-path">点击未练知识点查看关联题目。</p><ol data-knowledge-unpracticed class="kg-knowledge-list" aria-label="未练知识点"></ol><section class="kg-knowledge-questions" data-knowledge-questions hidden aria-label="知识点关联题目"><h4>关联题目</h4><p data-knowledge-questions-status role="status" aria-live="polite"></p><div data-knowledge-question-items></div><div class="kg-knowledge-step"><button type="button" data-knowledge-questions-retry hidden>重试</button><button type="button" data-knowledge-questions-prev hidden>上一页题目</button><button type="button" data-knowledge-questions-next hidden>下一页题目</button></div></section></section>
        <section class="kg-knowledge-space" aria-label="知识星空探索"><div class="kg-knowledge-space-heading"><span data-knowledge-page-count>全部 0 个考点</span><span>练习熟练度 · 越熟练越亮</span></div><form class="kg-knowledge-search" role="search" aria-label="搜索知识网络"><label for="kgKnowledgeSearch">搜索知识点</label><div class="kg-knowledge-search-field"><input id="kgKnowledgeSearch" type="search" data-knowledge-search placeholder="名称、科目或知识路径" maxlength="200" autocomplete="off"><button type="button" data-knowledge-search-clear disabled>清空</button></div><p data-knowledge-search-status role="status" aria-live="polite">搜索全部已发布知识点，点击结果定位。</p><ol data-knowledge-search-results aria-label="知识点搜索结果" hidden></ol></form><div data-knowledge-network class="kg-knowledge-network" hidden></div><div class="kg-knowledge-space-empty" data-knowledge-space-empty>暂无发布知识树</div><div class="kg-knowledge-camera" role="group" aria-label="星空视角"><button type="button" data-knowledge-rotate-left aria-label="向左旋转星空">↶</button><button type="button" data-knowledge-rotate-right aria-label="向右旋转星空">↷</button><button type="button" data-knowledge-zoom-out aria-label="缩小星空">−</button><button type="button" data-knowledge-zoom-in aria-label="放大星空">＋</button><button type="button" data-knowledge-reset>复位视角</button></div><p class="kg-knowledge-help">横向拖动旋转 · 上下滚动浏览 · Ctrl / ⌘ 滚轮或双指缩放<br>也可使用视角按钮和考点列表探索</p></section>
      </div>
      <footer class="kg-knowledge-footer"><div class="kg-knowledge-groups" data-knowledge-groups role="group" aria-label="科目筛选"></div></footer>
      <p id="kgKnowledgeMeaning">星空仅显示已练知识点，越熟练越亮；未练知识点在旁边列表查看关联题目。完成练习后，综合有效作答次数、近期正确率和连对更新熟练度；未完成的练习待评估。连线组织同科目、同分类考点。没有匹配当前目录引用的作答计入总数，不点亮星点。</p>
    </div>`;
    document.body.appendChild(dialog);
    const find=selector=>dialog.querySelector(selector);
    const summary=find('[data-knowledge-summary]'),network=find('[data-knowledge-network]'),list=find('[data-knowledge-list]'),status=find('[data-knowledge-status]'),retry=find('[data-knowledge-retry]'),groups=find('[data-knowledge-groups]');
    let returnFocus=null,scene=null,nodes=[],selected=null,activeGroup='',listOpen=false,subjects=[],sceneIndices=[],questionGeneration=0,questionPage=1;
    const unpracticed=find('[data-knowledge-unpracticed]'),questionPanel=find('[data-knowledge-questions]'),questionItems=find('[data-knowledge-question-items]'),questionStatus=find('[data-knowledge-questions-status]');
    const getUser=options.getUser||currentOwner;
    function clearQuestions(){questionGeneration++;questionItems.replaceChildren();questionStatus.textContent='';questionPanel.hidden=true;for(const control of questionPanel.querySelectorAll('button'))control.hidden=true}
    async function loadQuestions(page=1){
      const node=nodes[selected];if(!node||node.practiced)return;
      clearQuestions();questionPanel.hidden=false;questionPage=page;questionStatus.textContent='正在读取关联题目…';
      const generation=questionGeneration,owner=getUser(),index=selected;
      try{
        const query=new URLSearchParams({taxonomyId:node.taxonomyId,nodeId:node.primaryNodeId,page:String(page),pageSize:'10'});
        const data=await global.KGDomainApi.request({path:'/api/v1/learning/practice/knowledge-questions?'+query});
        if(generation!==questionGeneration||owner!==getUser()||index!==selected)return;
        if(!Array.isArray(data?.questions))throw Error('Invalid question response');
        questionStatus.textContent=data.total?`可查看 ${Number(data.total)} 道关联题目 · 第 ${page} 页`:'暂无可查看的已发布关联题目；题目需已发布且当前账号有权访问。';
        for(const question of data.questions){
          const item=document.createElement('details'),heading=document.createElement('summary'),source=document.createElement('p'),content=document.createElement('div');
          heading.textContent=question.title||`第 ${question.order} 题`;source.textContent=`${question.paperName||'已发布试卷'} · 第 ${question.order} 题`;source.className='kg-knowledge-question-source';
          content.innerHTML=global.KGQuestionMaterials.renderPreview(question);global.KGQuestionMaterials.bindMedia(content);
          item.append(heading,source,content);questionItems.appendChild(item);
        }
        find('[data-knowledge-questions-prev]').hidden=page<=1;find('[data-knowledge-questions-next]').hidden=!data.hasMore;
      }catch(error){
        if(generation!==questionGeneration||owner!==getUser()||index!==selected)return;
        questionStatus.textContent=error?.status===401?'登录已失效，请重新登录。':'关联题目读取失败，请重试。';find('[data-knowledge-questions-retry]').hidden=false;
      }
    }
    const search=find('[data-knowledge-search]'),searchResults=find('[data-knowledge-search-results]'),searchStatus=find('[data-knowledge-search-status]'),searchClear=find('[data-knowledge-search-clear]');
    const formatDate=value=>{const date=value?new Date(value):null;return !date||Number.isNaN(date.getTime())?'时间未知':date.toLocaleDateString('zh-CN')};
    const setText=(name,value)=>{find(`[data-knowledge-${name}]`).textContent=text(value)};
    function toggleList(value){listOpen=value;list.hidden=!value||!nodes.length;find('[data-knowledge-list-toggle]').setAttribute('aria-expanded',String(!list.hidden))}
    function select(index){
      const node=nodes[index];if(!node)return;
      selected=index;const sceneIndex=sceneIndices.indexOf(index);scene?.select(sceneIndex<0?null:sceneIndex);clearQuestions();if(!node.practiced)void loadQuestions();
      setText('detail-subject',node.subject||'科目未标注');setText('detail-number',String(index+1).padStart(2,'0'));
      setText('detail-title',node.title||'未命名考点');setText('detail-path',Array.isArray(node.path)?node.path.map(text).join(' / ')||'无路径标签':'无路径标签');
      setText('detail-attempts',`${Number(node.attemptCount)||0} 次`);setText('detail-date',node.practiced?formatDate(node.lastPracticedAt):'尚未练习');
      setText('detail-score',Number.isFinite(node.proficiencyScore)?`${node.proficiencyScore} / 100`:node.practiced?'待评估':'尚未练习');
      setText('detail-accuracy',`${Number.isFinite(node.recentAccuracy)?`${Math.round(node.recentAccuracy*100)}%`:'待评估'} · ${Number(node.recentGradedAttemptCount)||0} 次`);
      setText('detail-streak',`${Number(node.correctStreak)||0} 次`);
      for(const button of [...list.querySelectorAll('button'),...unpracticed.querySelectorAll('button')])button.setAttribute('aria-pressed',String(Number(button.dataset.knowledgeNode)===index));
    }
    function renderSearch(){
      const query=search.value.trim();searchResults.replaceChildren();searchResults.hidden=!query;searchClear.disabled=!query;
      const matches=findMatches(nodes,query,subjects);
      searchStatus.textContent=!query?'搜索全部已发布知识点，点击结果定位。':matches.length?`找到 ${matches.length} 个知识点，点击结果定位。`:'没有找到匹配的知识点，请换个关键词。';
      for(const index of matches){
        const node=nodes[index],item=document.createElement('li'),control=button(node.title||'未命名考点','data-knowledge-locate',index),path=document.createElement('small');
        path.textContent=[subjects.find(subject=>subject.code===node.subject)?.name||node.subject,...(Array.isArray(node.path)?node.path:[])].filter(Boolean).join(' / ');
        control.appendChild(path);item.appendChild(control);searchResults.appendChild(item);
      }
      return matches;
    }
    function locate(index){
      if(!nodes[index])return;
      if(activeGroup&&groupKey(nodes[index])!==activeGroup)focusGroup('');
      select(index);const sceneIndex=sceneIndices.indexOf(index);if(sceneIndex>=0){scene?.focus(sceneIndex);network.scrollIntoView({block:'center',behavior:'instant'})}else{questionPanel.scrollIntoView({block:'nearest',behavior:'instant'})}
    }
    function focusGroup(key){
      activeGroup=key;scene?.focusGroup(key);
      for(const button of groups.querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.knowledgeGroup===key));
      for(const li of [...list.children,...unpracticed.children])li.hidden=!!key&&groupKey(nodes[Number(li.firstChild.dataset.knowledgeNode)])!==key;
      const members=nodes.filter(node=>!key||groupKey(node)===key),practiced=members.filter(node=>node.practiced).length;
      setText('page-count',`星空 · 已练 ${practiced} 个考点`);setText('unpracticed-count',`未练知识点 · ${members.length-practiced}`);
      network.hidden=!scene||!practiced;find('[data-knowledge-space-empty]').hidden=!!scene&&practiced>0;find('[data-knowledge-space-empty]').textContent=practiced?'当前设备无法显示三维星空，请查看已练考点列表。':'暂无已练知识点，完成练习后会在星空中点亮。';
      if(selected===null||key&&groupKey(nodes[selected])!==key)select(nodes.findIndex(node=>node.practiced&&(!key||groupKey(node)===key))>=0?nodes.findIndex(node=>node.practiced&&(!key||groupKey(node)===key)):nodes.findIndex(node=>!key||groupKey(node)===key));
    }
    function step(direction){
      const indices=nodes.map((node,index)=>!activeGroup||groupKey(node)===activeGroup?index:-1).filter(index=>index>=0);
      if(indices.length)select(indices[(indices.indexOf(selected)+direction+indices.length)%indices.length]);
    }
    function button(label,attribute,value){const element=document.createElement('button');element.type='button';element.textContent=label;element.setAttribute(attribute,value);return element}
    function render(data){
      clearQuestions();scene?.destroy();scene=null;sceneIndices=[];nodes=[];selected=null;activeGroup='';subjects=[];search.value='';search.disabled=true;renderSearch();summary.textContent='';network.replaceChildren();list.replaceChildren();unpracticed.replaceChildren();groups.replaceChildren();
      network.hidden=true;find('[data-knowledge-space-empty]').hidden=false;
      setText('detail-title','选择一个考点');setText('detail-number','—');setText('detail-subject','');setText('detail-path','');setText('detail-attempts','—');setText('detail-date','—');setText('detail-score','—');setText('detail-accuracy','—');setText('detail-streak','—');setText('page-count','星空 · 已练 0 个考点');setText('unpracticed-count','未练知识点 · 0');
      for(const control of dialog.querySelectorAll('.kg-knowledge-step button,.kg-knowledge-camera button'))control.disabled=true;
      toggleList(listOpen);if(!data)return;
      nodes=data.nodes.filter(node=>node&&typeof node==='object');subjects=Array.isArray(data.subjects)?data.subjects:[];search.disabled=!nodes.length;
      summary.textContent=`全部 ${Number(data.topicCount)||0} · 已练 ${Number(data.practicedTopicCount)||0} · 未练 ${Number(data.unpracticedTopicCount)||0}；累计 ${Number(data.attemptCount)||0} 次作答 · 近 7 天 ${Number(data.recentAttemptCount)||0} 次${data.unknownAttemptCount?` · ${Number(data.unknownAttemptCount)} 次作答暂无考点引用`:''}。`;
      setText('page-count',`全部 ${nodes.length} 个考点`);
      for(const [index,node] of nodes.entries()){
        const li=document.createElement('li'),item=button(`${String(index+1).padStart(2,'0')} · ${node.title||'未命名考点'}`,'data-knowledge-node',index);
        item.setAttribute('aria-pressed','false');li.appendChild(item);(node.practiced?list:unpracticed).appendChild(li);if(node.practiced)sceneIndices.push(index);
      }
      if(nodes.length){
        groups.appendChild(button(`全部 · ${nodes.length}`,'data-knowledge-group',''));
        const seen=new Map();for(const node of nodes){const key=groupKey(node);if(!seen.has(key))seen.set(key,[]);seen.get(key).push(node)}
        for(const [key,members] of seen){
          const [subject]=JSON.parse(key),name=data.subjects?.find(item=>item.code===subject)?.name||subject||'科目未标注';
          groups.appendChild(button(`${name} · ${members.length}`,'data-knowledge-group',key));
        }
        network.hidden=false;find('[data-knowledge-space-empty]').hidden=true;
        try{scene=sceneIndices.length?global.KGKnowledgeSpaceScene?.mount({host:network,nodes:sceneIndices.map(index=>nodes[index]),onSelect:(_,index)=>select(sceneIndices[index])})||null:null}catch(error){scene=null;network.replaceChildren()}
        for(const control of dialog.querySelectorAll('.kg-knowledge-step button'))control.disabled=false;
        for(const control of dialog.querySelectorAll('.kg-knowledge-camera button'))control.disabled=!scene;
        focusGroup('');toggleList(!scene||listOpen);
      }
    }
    function setState(value){
      status.textContent=({loading:'正在读取完整知识目录与练习记录…',guest:'登录后查看自己的知识星空。',empty:'暂无发布知识树。发布后即可浏览全部考点，完成练习后更新熟练度。',error:'知识星空暂时无法读取，请重试。',ready:scene||!sceneIndices.length?'':'当前设备无法显示三维星空，请通过考点列表查看详情。'})[value]||'';
      retry.hidden=value!=='error';network.hidden=value!=='ready'||!scene||!nodes.some(node=>node.practiced&&(!activeGroup||groupKey(node)===activeGroup));
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
      else if(button.hasAttribute('data-knowledge-search-clear')){search.value='';renderSearch();search.focus()}
      else if(button.hasAttribute('data-knowledge-locate'))locate(Number(button.dataset.knowledgeLocate));
      else if(button.hasAttribute('data-knowledge-questions-retry'))void loadQuestions(questionPage);
      else if(button.hasAttribute('data-knowledge-questions-prev'))void loadQuestions(questionPage-1);
      else if(button.hasAttribute('data-knowledge-questions-next'))void loadQuestions(questionPage+1);
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
    search.addEventListener('input',renderSearch);
    find('.kg-knowledge-search').addEventListener('submit',event=>{event.preventDefault();const matches=renderSearch();if(matches.length)locate(matches[0])});
    dialog.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return;
      const buttons=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),summary')].filter(button=>!button.closest('[hidden]')&&button.getClientRects().length);
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
  const api=Object.freeze({init,open:()=>init()?.open(),close:()=>instance?.close(),createLoader,findMatches});
  global.KGKnowledgeDashboard=api;
  global.document?.addEventListener('click',event=>{
    const trigger=event.target?.closest?.('[data-knowledge-dashboard-open]');
    if(trigger){event.preventDefault();void api.open()}
  });
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
