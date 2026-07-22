'use strict';

(function(){
  const $=id=>document.getElementById(id);
  const viewport=$('krViewport'),world=$('krWorld'),edges=$('krEdges'),questionCard=$('krQuestionCard'),nodeLayer=$('krNodeLayer'),guide=$('krGuide');
  const CURRENT_KEY='kg_deep_recall_current_question_v1';
  const PROGRESS_PREFIX='kg_deep_recall_progress_v1__';
  const THEME_KEY='kg_deep_recall_theme_v1';
  const THEME_MIGRATION_KEY='kg_deep_recall_theme_platform_migrated_v1';
  const DATA=window.KNOWLEDGE_RECALL_MAP||{roots:{},nodes:{}};
  const Store=window.KGAppStorage||{};
  const fallbackQuestion=(typeof PMP_QUESTION_MVP!=='undefined'&&PMP_QUESTION_MVP)||window.PMP_QUESTION_MVP||{id:'demo',title:'题目',stemParts:[{text:'暂无题目数据。'}],options:[],clues:[],concepts:[]};
  let question=loadQuestion();
  let rootMap=buildRootMap(question);
  let state={nodes:[],edges:[],lastNewEdgeId:'',lastNewNodeId:'',activeNodeId:null,activeKeywords:[],transform:{x:0,y:0,scale:1},customNodes:{}};
  let isDragging=false,dragStart=null,worldStart=null,customOpen=false;
  let guideDragging=false,guideDragStart=null,guideStart=null;
  const THEMES=new Set(['platform','parchment','aurora','neon','sakura','ocean','latte']);
  const HIGHLIGHT_PALETTES=[
    {'--kr-highlight-from':'rgba(251,191,36,.34)','--kr-highlight-to':'rgba(253,230,138,.90)','--kr-highlight-ring':'rgba(251,191,36,.26)','--kr-highlight-hover':'rgba(251,191,36,.18)','--kr-highlight-text':'#3a1f0a'},
    {'--kr-highlight-from':'rgba(52,211,153,.28)','--kr-highlight-to':'rgba(167,243,208,.86)','--kr-highlight-ring':'rgba(16,185,129,.24)','--kr-highlight-hover':'rgba(16,185,129,.16)','--kr-highlight-text':'#064e3b'},
    {'--kr-highlight-from':'rgba(96,165,250,.30)','--kr-highlight-to':'rgba(191,219,254,.88)','--kr-highlight-ring':'rgba(59,130,246,.24)','--kr-highlight-hover':'rgba(59,130,246,.16)','--kr-highlight-text':'#172554'},
    {'--kr-highlight-from':'rgba(244,114,182,.30)','--kr-highlight-to':'rgba(251,207,232,.88)','--kr-highlight-ring':'rgba(236,72,153,.23)','--kr-highlight-hover':'rgba(236,72,153,.15)','--kr-highlight-text':'#831843'},
    {'--kr-highlight-from':'rgba(167,139,250,.31)','--kr-highlight-to':'rgba(221,214,254,.88)','--kr-highlight-ring':'rgba(139,92,246,.24)','--kr-highlight-hover':'rgba(139,92,246,.16)','--kr-highlight-text':'#3b0764'},
    {'--kr-highlight-from':'rgba(45,212,191,.30)','--kr-highlight-to':'rgba(153,246,228,.86)','--kr-highlight-ring':'rgba(20,184,166,.24)','--kr-highlight-hover':'rgba(20,184,166,.15)','--kr-highlight-text':'#134e4a'}
  ];

  function recallQuestionBankId(){return String(question?.sourceBankId||question?.bankId||'')}
  function isRecallReadonly(){return document.body.classList.contains('kr-readonly')}
  function notifyRecallReadonly(){
    notifyRecallLimit('当前为访客只读模式，登录后才能操作深度回忆。');
  }
  function setRecallReadonly(enabled){
    document.body.classList.toggle('kr-readonly',!!enabled);
    const app=$('krApp');if(app)app.dataset.readonly=enabled?'true':'false';
    const status=$('authStatus');
    if(enabled&&status){status.textContent='访客只读';status.setAttribute('aria-label','访客只读模式')}
    ['krResetBtn'].forEach(id=>{const el=$(id);if(el){el.classList.toggle('kr-readonly-control',!!enabled);el.setAttribute('aria-disabled',String(!!enabled))}});
  }
  function installRecallReadonlyGuard(){
    if(document.body.dataset.krReadonlyGuardBound)return;
    document.body.dataset.krReadonlyGuardBound='1';
    document.addEventListener('click',event=>{
      if(!isRecallReadonly())return;
      const target=event.target.closest&&event.target.closest('.kr-keyword,.kr-node button,.kr-guide button,#krResetBtn');
      if(!target)return;
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();notifyRecallReadonly();
    },true);
  }
  function enforceRecallPermission(){
    const api=window.KGRolePermissions;
    if(!api||typeof api.canUseDeepRecallQuestion!=='function')return true;
    api.applyTheme&&api.applyTheme();
    const status=$('authStatus');if(status&&api.renderStatus)api.renderStatus(status);
    const user=typeof api.currentUser==='function'?api.currentUser():null;
    if(!user){setRecallReadonly(true);installRecallReadonlyGuard();return true}
    setRecallReadonly(false);
    if(api.canUseDeepRecallQuestion(question,recallQuestionBankId()))return true;
    api.renderPermissionDenied(document.querySelector('.kr-app')||document.body, api.questionDeniedMessage?.()||'当前角色无权进入这道题的深度回忆。');
    return false;
  }
  function escapeHTML(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
  function notifyRecallLimit(message){
    const sub=window.KGSubscription;
    if(sub&&typeof sub.showSubscriptionMessage==='function'){sub.showSubscriptionMessage(message);return}
    let toast=$('krLimitToast');
    if(!toast){toast=document.createElement('div');toast.id='krLimitToast';toast.className='kr-limit-toast';document.body.appendChild(toast)}
    toast.textContent=String(message||'');toast.classList.add('show');
    clearTimeout(notifyRecallLimit.timer);notifyRecallLimit.timer=setTimeout(()=>toast.classList.remove('show'),3000);
  }
  function requireRecallNodeLimit(addCount=1){
    const sub=window.KGSubscription;
    if(!sub||typeof sub.requireUsageLimit!=='function')return true;
    return sub.requireUsageLimit('recallNodes',state.nodes.length,addCount,{label:'深度回忆知识点'});
  }
  function applyRandomHighlight(){
    const palette=HIGHLIGHT_PALETTES[Math.floor(Math.random()*HIGHLIGHT_PALETTES.length)]||HIGHLIGHT_PALETTES[0];
    Object.entries(palette).forEach(([name,value])=>document.documentElement.style.setProperty(name,value));
  }
  function savedTheme(){
    try{
      const raw=Store.readString?Store.readString(THEME_KEY,''):localStorage.getItem(THEME_KEY);
      const migrated=(Store.readString?Store.readString(THEME_MIGRATION_KEY,''):localStorage.getItem(THEME_MIGRATION_KEY))==='1';
      if(!migrated && (!raw || raw==='parchment')){
        if(Store.writeString){Store.writeString(THEME_MIGRATION_KEY,'1');Store.writeString(THEME_KEY,'platform')}
        else{localStorage.setItem(THEME_MIGRATION_KEY,'1');localStorage.setItem(THEME_KEY,'platform')}
        return 'platform';
      }
      return THEMES.has(raw)?raw:'platform';
    }catch(e){return 'platform'}
  }
  function applyTheme(theme){
    const next=THEMES.has(theme)?theme:'platform';
    const app=$('krApp');if(app)app.dataset.theme=next;
    const select=$('krThemeSelect');if(select&&select.value!==next)select.value=next;
    try{if(Store.writeString)Store.writeString(THEME_KEY,next);else localStorage.setItem(THEME_KEY,next)}catch(e){}
  }
  function bindThemeSelect(){
    const select=$('krThemeSelect');if(!select)return;
    applyTheme(savedTheme());
    select.addEventListener('change',()=>applyTheme(select.value));
  }
  function uid(prefix='kr'){return prefix+'-'+Math.random().toString(36).slice(2,9)+'-'+Date.now().toString(36)}
  function firstChar(text){const s=String(text||'?').trim();return Array.from(s)[0]||'?'}
  function loadQuestion(){
    try{
      const payload=Store.readJSON?Store.readJSON(CURRENT_KEY,null):JSON.parse(localStorage.getItem(CURRENT_KEY)||'null');
      if(payload&&payload.question&&payload.question.stemParts){
        const q=payload.question;
        if(payload.sourceBankId&&!q.sourceBankId)q.sourceBankId=payload.sourceBankId;
        if(payload.sourceQuestionId&&!q.sourceQuestionId)q.sourceQuestionId=payload.sourceQuestionId;
        return q;
      }
    }catch(e){}
    return JSON.parse(JSON.stringify(fallbackQuestion));
  }
  function progressKey(){return PROGRESS_PREFIX+encodeURIComponent(String(question.id||'current'))}
  function saveProgress(){
    if(isRecallReadonly())return;
    try{const payload={nodes:state.nodes,edges:state.edges,customNodes:state.customNodes,activeKeywords:state.activeKeywords,savedAt:Date.now()};if(Store.writeJSON)Store.writeJSON(progressKey(),payload);else localStorage.setItem(progressKey(),JSON.stringify(payload));const track=(global.KGFeatureAnalytics&&global.KGFeatureAnalytics.track)||function(){};track('recall','key_action','recall_saved');track('recall','outcome','recall_saved')}catch(e){}
  }
  function loadProgress(){
    try{
      const raw=Store.readJSON?Store.readJSON(progressKey(),null):JSON.parse(localStorage.getItem(progressKey())||'null');
      if(raw&&Array.isArray(raw.nodes)&&Array.isArray(raw.edges)){
        state.nodes=raw.nodes;state.edges=raw.edges;state.customNodes=raw.customNodes&&typeof raw.customNodes==='object'?raw.customNodes:{};state.activeKeywords=Array.isArray(raw.activeKeywords)?raw.activeKeywords:[];
        normalizeGraph();
        return true;
      }
    }catch(e){}
    return false;
  }
  function resetProgress(){
    if(isRecallReadonly()){notifyRecallReadonly();return}
    if(!confirm('确定重置这道题的深度回忆地图吗？'))return;
    try{if(Store.remove)Store.remove(progressKey());else localStorage.removeItem(progressKey())}catch(e){}
    state.nodes=[];state.edges=[];state.customNodes={};state.activeKeywords=[];state.activeNodeId=null;state.lastNewEdgeId='';state.lastNewNodeId='';renderAll();centerOn(0,0,true);closeGuide();
  }
  function rootConfig(key){return rootMap[key]||DATA.roots?.[key]||null}
  function nodeData(id){return state.customNodes[id]||DATA.nodes?.[id]||null}
  function buildRootMap(q){
    const map={...(DATA.roots||{})};
    (q.clues||[]).forEach(clue=>{
      if(!map[clue.id]){
        const first=(clue.conceptIds||[]).map(id=>(q.concepts||[]).find(c=>String(c.id)===String(id))).find(Boolean);
        map[clue.id]={title:clue.text,nodeId:first?.id||clue.id,matchTexts:[clue.text]};
      }
    });
    (q.concepts||[]).forEach(c=>{
      if(c.title&&!Object.values(map).some(r=>String(r.title)===String(c.title))){
        map[c.id]={title:c.title,nodeId:c.id,matchTexts:[c.title,...String(c.keywords||'').split(/[,，、;；|]/).map(x=>x.trim()).filter(Boolean).slice(0,2)]};
      }
    });
    return map;
  }
  function fallbackNode(id){
    const concept=(question.concepts||[]).find(c=>String(c.id)===String(id));
    if(concept){
      const choices=(question.concepts||[]).filter(c=>String(c.id)!==String(id)).slice(0,4).map(c=>({text:c.title,next:c.id}));
      return {title:concept.title,prompt:`围绕“${concept.title}”，你还能回忆到哪个相关知识点？`,hint:concept.summary||concept.notes||'',choices};
    }
    const clue=(question.clues||[]).find(c=>String(c.id)===String(id));
    if(clue){
      const choices=(clue.conceptIds||[]).map(cid=>{
        const c=(question.concepts||[]).find(x=>String(x.id)===String(cid));return c?{text:c.title,next:c.id}:null;
      }).filter(Boolean);
      return {title:clue.text,prompt:`看到“${clue.text}”，你能回忆到哪个知识点？`,hint:clue.explain||'',choices};
    }
    return {title:String(id||'知识点'),prompt:'这个节点还没有预设分支，你可以添加自己的回忆节点。',choices:[]};
  }
  function getNodeData(id){return nodeData(id)||fallbackNode(id)}
  function normalizeGraph(){
    const canonical=new Map(),replace={};
    const nodes=[];
    (state.nodes||[]).forEach(n=>{
      const titleKey=String(n.title||getNodeData(n.dataId).title||'').trim();
      const key=titleKey||String(n.dataId||n.instanceId);
      if(!canonical.has(key)){canonical.set(key,n);nodes.push(n)}
      else replace[n.instanceId]=canonical.get(key).instanceId;
    });
    const nextEdges=[];
    const hasPathIn=(from,to)=>{
      if(String(from)===String(to))return true;
      const seen=new Set(),stack=[from];
      while(stack.length){
        const cur=stack.pop();
        if(seen.has(cur))continue;
        seen.add(cur);
        for(const e of nextEdges){
          if(String(e.from)!==String(cur))continue;
          if(String(e.to)===String(to))return true;
          if(!seen.has(e.to))stack.push(e.to);
        }
      }
      return false;
    };
    (state.edges||[]).forEach(edge=>{
      const from=replace[edge.from]||edge.from,to=replace[edge.to]||edge.to;
      if(!from||!to||String(from)===String(to))return;
      if(nextEdges.some(e=>String(e.from)===String(from)&&String(e.to)===String(to)))return;
      if(hasPathIn(from,to)||hasPathIn(to,from))return;
      nextEdges.push({...edge,from,to});
    });
    if(replace[state.activeNodeId])state.activeNodeId=replace[state.activeNodeId];
    state.nodes=nodes;state.edges=nextEdges;
  }
  function isKeywordActive(key){return (state.activeKeywords||[]).some(k=>String(k)===String(key))}
  function markKeywordActive(key){if(!isKeywordActive(key))state.activeKeywords.push(String(key))}
  function renderQuestion(){
    const stem=(question.stemParts||[]).map((p,i)=>{
      const text=escapeHTML(p.text||'');
      if(p.clue&&rootConfig(p.clue))return `<span class="kr-keyword ${isKeywordActive(p.clue)?'active':''}" data-keyword-id="${escapeHTML(p.clue)}" data-keyword-index="${i}">${text}</span>`;
      return wrapKnownKeywords(text);
    }).join('');
    const options=(question.options||[]).map(o=>`<div class="kr-option"><strong>${escapeHTML(o.id)}</strong>${wrapKnownKeywords(escapeHTML(o.text||''))}</div>`).join('');
    questionCard.innerHTML=`<h2 class="kr-question-title">${escapeHTML(question.title||'深度知识回忆')}</h2><div class="kr-stem">${stem}</div><div class="kr-options">${options}</div>`;
    questionCard.querySelectorAll('.kr-keyword').forEach(el=>{
      el.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();activateKeyword(el)});
    });
  }
  function allMatchEntries(){
    const arr=[];
    Object.entries(rootMap).forEach(([key,root])=>{
      (root.matchTexts||[root.title]).forEach(text=>{if(text&&String(text).length>=2)arr.push({key,text:String(text)})});
    });
    return arr.sort((a,b)=>b.text.length-a.text.length);
  }
  function wrapKnownKeywords(escapedText){
    let s=String(escapedText||'');
    const used=[];
    for(const item of allMatchEntries()){
      const safe=escapeHTML(item.text).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      if(!safe)continue;
      const re=new RegExp(safe,'g');
      s=s.replace(re,m=>{
        const token=`__KR_${used.length}__`;
        used.push(`<span class="kr-keyword ${isKeywordActive(item.key)?'active':''}" data-keyword-id="${escapeHTML(item.key)}">${m}</span>`);
        return token;
      });
    }
    used.forEach((html,i)=>{s=s.replace(`__KR_${i}__`,html)});
    return s;
  }
  function activateKeyword(el){
    if(isRecallReadonly()){notifyRecallReadonly();return}
    const key=el.dataset.keywordId;
    const root=rootConfig(key);
    if(!root)return;
    markKeywordActive(key);
    questionCard.querySelectorAll(`.kr-keyword[data-keyword-id="${cssAttr(key)}"]`).forEach(x=>x.classList.add('active'));
    el.classList.add('active');
    const rootDataId=root.nodeId||key;
    let node=state.nodes.find(n=>String(n.dataId)===String(rootDataId));
    if(!node){
      if(!requireRecallNodeLimit(1))return;
      const pos=keywordNodePosition(el,state.nodes.filter(n=>n.depth===0).length);
      const data=getNodeData(rootDataId);
      node={instanceId:uid('node'),dataId:rootDataId,rootKey:key,title:data.title||root.title,x:pos.x,y:pos.y,parentId:null,depth:0,createdAt:Date.now()};
      state.nodes.push(node);
      state.lastNewNodeId=node.instanceId;
      saveProgress();
      renderAll();
      setTimeout(()=>focusNode(node.instanceId,false),40);
    }else{
      saveProgress();
      renderAll();
      focusNode(node.instanceId,false);
    }
  }
  function keywordNodePosition(el,index){
    const wr=screenToWorldRect(el.getBoundingClientRect());
    const q=questionBounds(92);
    const keywordSide=wr.x>=0?1:-1;
    const preferredSide=index%2===0?keywordSide:-keywordSide;
    const sideX=preferredSide>0?q.right+98:q.left-98;
    const verticalOffsets=[0,86,-86,172,-172,258,-258,344,-344];
    const candidates=[];
    verticalOffsets.forEach(offset=>candidates.push({x:sideX,y:clamp(wr.y+offset,q.top+42,q.bottom-42)}));
    const altSideX=preferredSide>0?q.left-98:q.right+98;
    verticalOffsets.forEach(offset=>candidates.push({x:altSideX,y:clamp(wr.y+offset,q.top+42,q.bottom-42)}));
    const horizontalOffsets=[-280,-140,0,140,280];
    horizontalOffsets.forEach(offset=>candidates.push({x:clamp(wr.x+offset,q.left+74,q.right-74),y:q.top-112}));
    horizontalOffsets.forEach(offset=>candidates.push({x:clamp(wr.x+offset,q.left+74,q.right-74),y:q.bottom+112}));
    candidates.push({x:wr.x+(preferredSide>0?360:-360),y:wr.y});
    return findOpenPosition(candidates,index);
  }
  function screenToWorldRect(rect){
    const vp=viewport.getBoundingClientRect();
    const t=state.transform;
    return {x:(rect.left+rect.width/2-vp.left-t.x)/t.scale,y:(rect.top+rect.height/2-vp.top-t.y)/t.scale};
  }
  function questionBounds(pad=72){
    const w=(questionCard&&questionCard.offsetWidth)||780;
    const h=(questionCard&&questionCard.offsetHeight)||430;
    return {left:-w/2-pad,right:w/2+pad,top:-h/2-pad,bottom:h/2+pad,width:w+pad*2,height:h+pad*2};
  }
  function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
  function nodeRectAt(x,y,pad=14){
    const w=132+pad*2,h=154+pad*2;
    return {left:x-w/2,right:x+w/2,top:y-h/2,bottom:y+h/2};
  }
  function rectsOverlap(a,b){return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top}
  function pointBlocksQuestion(x,y){return rectsOverlap(nodeRectAt(x,y,8),questionBounds(18))}
  function pointCrowdingScore(x,y){
    const rect=nodeRectAt(x,y,18);
    let score=pointBlocksQuestion(x,y)?100000:0;
    state.nodes.forEach(n=>{
      if(rectsOverlap(rect,nodeRectAt(Number(n.x)||0,Number(n.y)||0,16)))score+=12000;
      const dx=(Number(n.x)||0)-x,dy=(Number(n.y)||0)-y;
      const d=Math.max(1,Math.hypot(dx/1.05,dy/1.2));
      score+=Math.max(0,220-d);
    });
    return score;
  }
  function findOpenPosition(candidates,seed=0){
    let best=null,bestScore=Infinity;
    const q=questionBounds(90);
    const expanded=[...candidates];
    for(let ring=1;ring<=6;ring++){
      const radius=ring*120;
      const start=(seed%8)*Math.PI/4;
      for(let i=0;i<12;i++){
        const angle=start+i*Math.PI/6;
        expanded.push({x:Math.cos(angle)*(Math.max(q.width/2+90,radius+380)),y:Math.sin(angle)*(Math.max(q.height/2+70,radius+260))});
      }
    }
    expanded.forEach((p,i)=>{
      const score=pointCrowdingScore(p.x,p.y)+i*.015;
      if(score<bestScore){bestScore=score;best=p}
    });
    if(!best)return {x:0,y:0};
    let x=best.x,y=best.y;
    for(let i=0;i<18&&(pointBlocksQuestion(x,y)||state.nodes.some(n=>rectsOverlap(nodeRectAt(x,y,16),nodeRectAt(Number(n.x)||0,Number(n.y)||0,16))));i++){
      const angle=(seed*.83+i*.72);
      x+=Math.cos(angle)*92;
      y+=Math.sin(angle)*104;
      if(pointBlocksQuestion(x,y)){
        const q2=questionBounds(110);
        if(Math.abs(x)<q2.right)x=x>=0?q2.right+76:q2.left-76;
        if(y>q2.top&&y<q2.bottom)y+=y>=0?96:-96;
      }
    }
    return {x,y};
  }
  function renderNodes(){
    const newNodeId=state.lastNewNodeId;
    nodeLayer.innerHTML=state.nodes.map(n=>{
      const d=getNodeData(n.dataId);
      const title=n.title||d.title||'知识点';
      const cls=['kr-node',`depth-${Math.min(6,Number(n.depth||0))}`];
      if(state.activeNodeId===n.instanceId)cls.push('is-active');
      if(newNodeId&&newNodeId===n.instanceId)cls.push('is-new');
      return `<div class="${cls.join(' ')}" data-instance-id="${escapeHTML(n.instanceId)}" style="left:${Number(n.x)||0}px;top:${Number(n.y)||0}px"><button type="button" title="${escapeHTML(title)}" aria-label="打开 ${escapeHTML(title)} 的回忆引导"><span>${escapeHTML(firstChar(title))}</span></button><div class="kr-node-label">${escapeHTML(title)}</div></div>`;
    }).join('');
    nodeLayer.querySelectorAll('.kr-node button').forEach(btn=>{
      btn.addEventListener('click',e=>{
        e.preventDefault();e.stopPropagation();
        btn.classList.add('is-pressed');setTimeout(()=>btn.classList.remove('is-pressed'),150);
        const wrap=btn.closest('.kr-node');if(wrap)openNodeGuide(wrap.dataset.instanceId,btn);
      });
    });
    if(newNodeId)setTimeout(()=>{if(state.lastNewNodeId===newNodeId)state.lastNewNodeId=''},520);
  }
  function renderEdges(){
    const paths=state.edges.map(edge=>{
      const a=state.nodes.find(n=>n.instanceId===edge.from),b=state.nodes.find(n=>n.instanceId===edge.to);
      if(!a||!b)return '';
      const dx=Math.max(80,Math.abs(b.x-a.x)*.52),c1x=a.x+dx,c2x=b.x-dx*.35;
      const d=`M ${a.x} ${a.y} C ${c1x} ${a.y}, ${c2x} ${b.y}, ${b.x} ${b.y}`;
      const cls=edge.id===state.lastNewEdgeId?'kr-edge new':'kr-edge';
      return `<path class="kr-edge-glow" d="${d}"></path><path class="${cls}" d="${d}"></path>`;
    }).join('');
    edges.innerHTML=paths;
  }
  function renderAll(){renderQuestion();renderNodes();renderEdges();applyTransform(false)}
  function openNodeGuide(instanceId,anchor){
    if(isRecallReadonly()){notifyRecallReadonly();return}
    const node=state.nodes.find(n=>n.instanceId===instanceId);if(!node)return;
    state.activeNodeId=instanceId;customOpen=false;guide.dataset.dragged='';renderNodes();
    const liveAnchor=nodeLayer.querySelector(`[data-instance-id="${cssAttr(instanceId)}"] button`)||anchor;
    const d=getNodeData(node.dataId);
    const choices=Array.isArray(d.choices)?d.choices:[];
    guide.hidden=false;
    guide.innerHTML=`<div class="kr-guide-head"><div><h2>${escapeHTML(d.title||node.title)}</h2><p>${escapeHTML(d.prompt||'你还能从这里继续回忆到什么？')}</p>${d.hint?`<p><strong>轻提示：</strong>${escapeHTML(d.hint)}</p>`:''}</div><button class="kr-guide-close" title="关闭" type="button">×</button></div>${choices.length?`<div class="kr-choice-list">${choices.map((c,i)=>`<button type="button" data-choice-index="${i}">${escapeHTML(c.text||'继续回忆')}</button>`).join('')}</div>`:'<div class="kr-empty-choices">这个节点暂时没有预设分支。可以添加自己的回忆节点，让知识地图继续延展。</div>'}<div class="kr-guide-actions"><button class="secondary" id="krCustomBtn" type="button">添加我的回忆</button><button class="secondary" id="krCenterNodeBtn" type="button">居中此节点</button></div><div class="kr-custom-form" id="krCustomForm" hidden><input id="krCustomInput" placeholder="输入你想到的知识点，例如：信息发射源" maxlength="30"/><button id="krCustomSaveBtn" type="button">生成</button></div>`;
    guide.querySelector('.kr-guide-close').onclick=closeGuide;
    makeGuideDraggable();
    guide.querySelectorAll('[data-choice-index]').forEach(btn=>btn.onclick=()=>{
      const choice=choices[Number(btn.dataset.choiceIndex)];createChildFromChoice(node,choice,Number(btn.dataset.choiceIndex));
    });
    const customBtn=$('krCustomBtn'),customForm=$('krCustomForm'),customInput=$('krCustomInput'),customSave=$('krCustomSaveBtn'),centerBtn=$('krCenterNodeBtn');
    if(customBtn)customBtn.onclick=()=>{customOpen=!customOpen;customForm.hidden=!customOpen;if(customOpen)setTimeout(()=>customInput&&customInput.focus(),20)};
    if(customSave)customSave.onclick=()=>{const title=(customInput.value||'').trim();if(title)createCustomChild(node,title)};
    if(customInput)customInput.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const title=(customInput.value||'').trim();if(title)createCustomChild(node,title)}};
    if(centerBtn)centerBtn.onclick=()=>centerOn(node.x,node.y,true);
    requestAnimationFrame(()=>placeGuide(liveAnchor));
  }
  function closeGuide(){guide.hidden=true;guide.innerHTML='';guide.dataset.dragged='';guideDragging=false;state.activeNodeId=null;renderNodes()}
  function placeGuide(anchor){
    if(!guide||guide.hidden||guide.dataset.dragged==='1')return;
    const vp=viewport.getBoundingClientRect();
    const r=anchor&&anchor.getBoundingClientRect?anchor.getBoundingClientRect():null;
    const margin=18,gap=18;
    const guideRect=guide.getBoundingClientRect();
    const gw=Math.min(guideRect.width||380,Math.max(280,vp.width-margin*2));
    const gh=Math.min(guideRect.height||260,Math.max(180,vp.height-margin*2));
    if(!r||(!r.width&&!r.height)){
      const pos=clampGuidePosition(Math.max(margin,(vp.width-gw)/2),Math.max(margin,(vp.height-gh)/2));
      guide.style.left=Math.round(pos.left)+'px';guide.style.top=Math.round(pos.top)+'px';return;
    }
    const anchorBox={left:r.left-vp.left,right:r.right-vp.left,top:r.top-vp.top,bottom:r.bottom-vp.top,width:r.width,height:r.height};
    const candidates=[
      {name:'right',left:anchorBox.right+gap,top:anchorBox.top+anchorBox.height/2-gh/2},
      {name:'left',left:anchorBox.left-gw-gap,top:anchorBox.top+anchorBox.height/2-gh/2},
      {name:'bottom',left:anchorBox.left+anchorBox.width/2-gw/2,top:anchorBox.bottom+gap},
      {name:'top',left:anchorBox.left+anchorBox.width/2-gw/2,top:anchorBox.top-gh-gap}
    ].map(c=>({...c,...clampGuidePosition(c.left,c.top)}));
    function visibleScore(c){
      const overflow=Math.max(0,margin-c.left)+Math.max(0,c.left+gw-(vp.width-margin))+Math.max(0,margin-c.top)+Math.max(0,c.top+gh-(vp.height-margin));
      const horizontalBonus=(c.name==='right'||c.name==='left')?80:0;
      const sideBonus=c.name==='right'?20:0;
      return horizontalBonus+sideBonus-overflow*40;
    }
    const best=candidates.sort((a,b)=>visibleScore(b)-visibleScore(a))[0];
    guide.dataset.placement=best.name;
    guide.style.left=Math.round(best.left)+'px';guide.style.top=Math.round(best.top)+'px';
  }
  function clampGuidePosition(left,top){
    const vp=viewport.getBoundingClientRect();
    const r=guide.getBoundingClientRect();
    const margin=18;
    const maxLeft=Math.max(margin,vp.width-r.width-margin);
    const maxTop=Math.max(margin,vp.height-r.height-margin);
    return {left:Math.max(margin,Math.min(maxLeft,left)),top:Math.max(margin,Math.min(maxTop,top))};
  }
  function makeGuideDraggable(){
    const head=guide.querySelector('.kr-guide-head');
    if(!head)return;
    head.addEventListener('pointerdown',e=>{
      if(e.target.closest('button,input,textarea,select,a'))return;
      e.preventDefault();e.stopPropagation();
      guideDragging=true;guide.dataset.dragged='1';
      guideDragStart={x:e.clientX,y:e.clientY};
      guideStart={left:parseFloat(guide.style.left)||0,top:parseFloat(guide.style.top)||0};
      head.setPointerCapture(e.pointerId);
      guide.classList.add('dragging');
    });
    head.addEventListener('pointermove',e=>{
      if(!guideDragging||!guideDragStart||!guideStart)return;
      e.preventDefault();e.stopPropagation();
      const pos=clampGuidePosition(guideStart.left+e.clientX-guideDragStart.x,guideStart.top+e.clientY-guideDragStart.y);
      guide.style.left=Math.round(pos.left)+'px';guide.style.top=Math.round(pos.top)+'px';
    });
    const endDrag=e=>{
      if(!guideDragging)return;
      guideDragging=false;guide.classList.remove('dragging');
      try{head.releasePointerCapture(e.pointerId)}catch(_){}
    };
    head.addEventListener('pointerup',endDrag);
    head.addEventListener('pointercancel',endDrag);
  }
  function edgeExists(from,to){
    return state.edges.some(e=>String(e.from)===String(from)&&String(e.to)===String(to));
  }
  function hasDirectedPath(from,to){
    if(String(from)===String(to))return true;
    const seen=new Set();
    const stack=[from];
    while(stack.length){
      const cur=stack.pop();
      if(seen.has(cur))continue;
      seen.add(cur);
      for(const edge of state.edges){
        if(String(edge.from)!==String(cur))continue;
        if(String(edge.to)===String(to))return true;
        if(!seen.has(edge.to))stack.push(edge.to);
      }
    }
    return false;
  }
  function shouldConnectNodes(from,to){
    if(!from||!to||String(from)===String(to))return false;
    if(edgeExists(from,to))return false;
    if(hasDirectedPath(from,to)||hasDirectedPath(to,from))return false;
    return true;
  }
  function createChildFromChoice(parent,choice,choiceIndex=0){
    if(isRecallReadonly()){notifyRecallReadonly();return}
    if(!choice||!choice.next)return;
    const data=getNodeData(choice.next);
    let child=state.nodes.find(n=>String(n.dataId)===String(choice.next)||String(n.title||getNodeData(n.dataId).title||'').trim()===String(data.title||choice.text||'').trim());
    let created=false,connected=false;
    if(!child){
      if(!requireRecallNodeLimit(1))return;
      const pos=childPosition(parent,choiceIndex);
      child={instanceId:uid('node'),dataId:choice.next,rootKey:parent.rootKey,title:data.title||choice.text,x:pos.x,y:pos.y,parentId:parent.instanceId,depth:Number(parent.depth||0)+1,createdAt:Date.now()};
      state.nodes.push(child);
      state.lastNewNodeId=child.instanceId;
      created=true;
    }
    if(shouldConnectNodes(parent.instanceId,child.instanceId)){
      const edge={id:uid('edge'),from:parent.instanceId,to:child.instanceId};
      state.edges.push(edge);state.lastNewEdgeId=edge.id;connected=true;
    }
    saveProgress();
    closeGuide();renderAll();setTimeout(()=>focusNode(child.instanceId,created||connected),60);
  }
  function createCustomChild(parent,title){
    if(isRecallReadonly()){notifyRecallReadonly();return}
    const normalized=String(title||'').trim();
    if(!normalized)return;
    let child=state.nodes.find(n=>String(n.title||getNodeData(n.dataId).title||'').trim()===normalized);
    let created=false,connected=false;
    if(!child){
      if(!requireRecallNodeLimit(1))return;
      const id='custom-'+uid('idea');
      state.customNodes[id]={title:normalized,prompt:`围绕“${normalized}”，你还能继续想到什么？`,hint:'这是你自己添加的回忆节点，可以继续添加下一层。',choices:[]};
      const pos=childPosition(parent,state.nodes.filter(n=>n.parentId===parent.instanceId).length);
      child={instanceId:uid('node'),dataId:id,rootKey:parent.rootKey,title:normalized,x:pos.x,y:pos.y,parentId:parent.instanceId,depth:Number(parent.depth||0)+1,createdAt:Date.now(),custom:true};
      state.nodes.push(child);state.lastNewNodeId=child.instanceId;created=true;
    }
    if(shouldConnectNodes(parent.instanceId,child.instanceId)){
      const edge={id:uid('edge'),from:parent.instanceId,to:child.instanceId};
      state.edges.push(edge);state.lastNewEdgeId=edge.id;connected=true;
    }
    saveProgress();closeGuide();renderAll();setTimeout(()=>focusNode(child.instanceId,created||connected),60);
  }
  function childPosition(parent,choiceIndex){
    const siblingCount=state.nodes.filter(n=>n.parentId===parent.instanceId).length;
    const depth=Number(parent.depth||0)+1;
    const px=Number(parent.x||0),py=Number(parent.y||0);
    const branchOffsets=[0,-150,150,-300,300,-450,450,-600,600];
    const branch=branchOffsets[(siblingCount+choiceIndex)%branchOffsets.length]||0;
    const step=270+Math.min(depth,5)*24;
    const candidates=[
      {x:px+step,y:py+branch+(depth%2?30:-24)},
      {x:px+step,y:py-branch-(depth%2?24:-30)},
      {x:px+step*.72,y:py+branch+170},
      {x:px+step*.72,y:py+branch-170},
      {x:px-step*.36,y:py+branch+150},
      {x:px-step*.36,y:py+branch-150}
    ];
    return findOpenPosition(candidates,siblingCount+choiceIndex+depth*3);
  }
  function focusNode(instanceId,openGuide){
    const node=state.nodes.find(n=>n.instanceId===instanceId);if(!node)return;
    centerOn(node.x,node.y,true);
    state.activeNodeId=instanceId;renderNodes();
    const wrap=nodeLayer.querySelector(`[data-instance-id="${cssAttr(instanceId)}"]`);if(wrap){wrap.classList.add('kr-focus-ring');setTimeout(()=>wrap.classList.remove('kr-focus-ring'),1300)}
    if(openGuide&&wrap){const btn=wrap.querySelector('button');setTimeout(()=>openNodeGuide(instanceId,btn),430)}
  }
  function cssAttr(value){return (window.CSS&&CSS.escape)?CSS.escape(String(value)):String(value).replace(/"/g,'\\"')}
  function centerOn(x,y,smooth=false){
    const vp=viewport.getBoundingClientRect();
    state.transform.x=vp.width/2-x*state.transform.scale;
    state.transform.y=vp.height/2-y*state.transform.scale;
    applyTransform(smooth);
  }
  function applyTransform(smooth){
    world.classList.toggle('smooth',!!smooth);
    const t=state.transform;
    world.style.transform=`translate(${t.x}px,${t.y}px) scale(${t.scale})`;
    if(smooth)setTimeout(()=>world.classList.remove('smooth'),460);
    if(!guide.hidden&&state.activeNodeId){
      const wrap=nodeLayer.querySelector(`[data-instance-id="${cssAttr(state.activeNodeId)}"] button`);if(wrap)placeGuide(wrap);
    }
  }
  function zoomAt(delta,cx,cy){
    const old=state.transform.scale;
    const next=Math.max(.45,Math.min(1.75,old+delta));
    if(next===old)return;
    const vp=viewport.getBoundingClientRect();
    const wx=(cx-vp.left-state.transform.x)/old,wy=(cy-vp.top-state.transform.y)/old;
    state.transform.scale=next;
    state.transform.x=cx-vp.left-wx*next;state.transform.y=cy-vp.top-wy*next;
    applyTransform(false);
  }
  function bindCanvas(){
    viewport.addEventListener('pointerdown',e=>{
      if(e.target.closest('.kr-node,.kr-question-card,.kr-guide,.kr-tools,.kr-topbar'))return;
      isDragging=true;dragStart={x:e.clientX,y:e.clientY};worldStart={x:state.transform.x,y:state.transform.y};viewport.classList.add('dragging');viewport.setPointerCapture(e.pointerId);closeGuide();
    });
    viewport.addEventListener('pointermove',e=>{if(!isDragging)return;state.transform.x=worldStart.x+e.clientX-dragStart.x;state.transform.y=worldStart.y+e.clientY-dragStart.y;applyTransform(false)});
    viewport.addEventListener('pointerup',e=>{isDragging=false;viewport.classList.remove('dragging');try{viewport.releasePointerCapture(e.pointerId)}catch(_){}});
    viewport.addEventListener('pointercancel',()=>{isDragging=false;viewport.classList.remove('dragging')});
    viewport.addEventListener('wheel',e=>{e.preventDefault();zoomAt(e.deltaY<0?.1:-.1,e.clientX,e.clientY)},{passive:false});
    viewport.addEventListener('dblclick',e=>{if(e.target.closest('.kr-node,.kr-question-card,.kr-guide'))return;centerOn(0,0,true)});
    window.addEventListener('resize',()=>{applyTransform(false);if(!state.nodes.length)centerOn(0,0,false);if(!guide.hidden&&guide.dataset.dragged==='1'){const pos=clampGuidePosition(parseFloat(guide.style.left)||0,parseFloat(guide.style.top)||0);guide.style.left=Math.round(pos.left)+'px';guide.style.top=Math.round(pos.top)+'px';}});
  }
  function bindTools(){
    $('krBackBtn').onclick=()=>{if(history.length>1)history.back();else window.close()};
    $('krCenterBtn').onclick=()=>centerOn(0,0,true);
    $('krZoomInBtn').onclick=()=>{const r=viewport.getBoundingClientRect();zoomAt(.1,r.left+r.width/2,r.top+r.height/2)};
    $('krZoomOutBtn').onclick=()=>{const r=viewport.getBoundingClientRect();zoomAt(-.1,r.left+r.width/2,r.top+r.height/2)};
    $('krResetBtn').onclick=resetProgress;
  }
  function init(){
    if(!enforceRecallPermission())return;
    applyRandomHighlight();bindThemeSelect();bindCanvas();bindTools();loadProgress();renderAll();
    setTimeout(()=>centerOn(0,0,false),30);
  }
  document.addEventListener('DOMContentLoaded',init);
})();
