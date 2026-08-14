'use strict';

/*
 * CanvasWorkspaceStore v10
 * 多题长期工作区。单题 LearningSession 与跨题 CanvasWorkspace 完全分离。
 */
(function(global){
  const Store=global.KGAppStorage||{};
  const STORAGE_PREFIX=global.KGStorageKeys?.PREFIXES?.CANVAS_WORKSPACE||'kg_canvas_workspace_v1__';
  const CATALOG_PREFIX='kg_canvas_workspace_catalog_v2__';
  const DEFAULT_WORKSPACE_ID='pmp-pattern-workspace';
  const SCHEMA_VERSION=10;
  const SYNTHESIS_TYPES=Object.freeze(['principle','routine','trap','note']);
  const EDGE_TYPES=Object.freeze(['same','contrast','cause','exception','confused','support','custom']);
  const GROUP_COLORS=Object.freeze(['#ede9fe','#dbeafe','#dcfce7','#fef3c7','#fee2e2','#fce7f3','#e0f2fe']);
  const LAYOUT_LIMITS=Object.freeze({minWidth:380,maxWidth:1400,minHeight:170,maxHeight:12000});
  const listeners=new Set();

  function now(){return Date.now()}
  function clone(value){
    if(value===undefined)return undefined;
    try{return JSON.parse(JSON.stringify(value))}catch(e){return value}
  }
  function normalizeColor(value,fallback=''){
    const color=String(value||'').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/i.test(color)?color:String(fallback||'');
  }
  function currentUserId(){
    try{
      const username=global.KGAuthCore?.currentUsername?.();
      if(username)return String(username);
    }catch(e){}
    try{
      const username=global.KGAuthRuntime?.currentUsername?.();
      if(username)return String(username);
    }catch(e){}
    try{
      const username=global.KGLearningSessionStore?.currentUserId?.();
      if(username&&String(username)!=='guest')return String(username);
    }catch(e){}
    return 'guest';
  }
  function storageKey(userId=currentUserId(),workspaceId=DEFAULT_WORKSPACE_ID){
    return STORAGE_PREFIX+encodeURIComponent(String(userId||'guest'))+'__'+encodeURIComponent(String(workspaceId||DEFAULT_WORKSPACE_ID));
  }
  function catalogKey(userId=currentUserId()){
    return CATALOG_PREFIX+encodeURIComponent(String(userId||'guest'));
  }
  function hashString(value){
    let hash=2166136261;
    const text=String(value||'');
    for(let index=0;index<text.length;index++){
      hash^=text.charCodeAt(index);
      hash=Math.imul(hash,16777619);
    }
    return (hash>>>0).toString(36);
  }
  function slugId(title='workspace'){
    return 'workspace-'+now().toString(36)+'-'+hashString(title+'-'+Math.random()).slice(0,6);
  }
  function questionIdentity(questionId,bankId='',paperId='',releaseId=''){
    const fixed=String(paperId||'')||String(releaseId||'');
    return fixed
      ?[paperId,releaseId,bankId,questionId].map(value=>String(value||'')).join('::')
      :String(bankId||'')+'::'+String(questionId||'');
  }
  function questionNodeId(questionId,bankId='',paperId='',releaseId=''){
    return 'question-ref-'+hashString(questionIdentity(questionId,bankId,paperId,releaseId));
  }
  function emptyWorkspace(options={}){
    const createdAt=now();
    return {
      schemaVersion:SCHEMA_VERSION,
      id:String(options.workspaceId||DEFAULT_WORKSPACE_ID),
      userId:String(options.userId||currentUserId()),
      title:String(options.title||'我的PMP解题规律'),
      viewport:{x:0,y:0,zoom:1},
      nodes:{},
      edges:[],
      groups:[],
      createdAt,
      updatedAt:createdAt
    };
  }
  function normalizeHighlight(highlight={},index=0){
    const start=Math.max(0,Math.floor(Number(highlight.start||0)));
    const end=Math.max(start,Math.floor(Number(highlight.end||start)));
    const allowedColors=new Set(['#fde68a','#bbf7d0','#bfdbfe','#fbcfe8','#fed7aa','#ddd6fe']);
    const color=allowedColors.has(String(highlight.color||''))?String(highlight.color):'#fde68a';
    return {
      id:String(highlight.id||('highlight-'+now().toString(36)+'-'+index)),
      region:String(highlight.region||'stem'),
      start,
      end,
      text:String(highlight.text||''),
      color,
      createdAt:Number(highlight.createdAt||now()),
      updatedAt:Number(highlight.updatedAt||now())
    };
  }
  function normalizeNode(node={}){
    const width=Math.max(LAYOUT_LIMITS.minWidth,Math.min(LAYOUT_LIMITS.maxWidth,Number(node.width||360)));
    const height=Math.max(LAYOUT_LIMITS.minHeight,Math.min(LAYOUT_LIMITS.maxHeight,Number(node.height||240)));
    const nodeType=String(node.nodeType||'question-reference');
    const base={
      id:String(node.id||'workspace-node-'+now().toString(36)),
      nodeType,
      x:Number.isFinite(Number(node.x))?Number(node.x):600,
      y:Number.isFinite(Number(node.y))?Number(node.y):420,
      width,
      height,
      createdAt:Number(node.createdAt||now()),
      updatedAt:Number(node.updatedAt||now())
    };
    if(nodeType==='synthesis-card'){
      const synthesisType=SYNTHESIS_TYPES.includes(String(node.synthesisType||''))?String(node.synthesisType):'principle';
      const defaults={principle:'新原则',routine:'新套路',trap:'新陷阱',note:'新笔记'};
      return {
        ...base,
        synthesisType,
        title:String(node.title||defaults[synthesisType]),
        content:String(node.content||''),
        tags:Array.isArray(node.tags)?node.tags.map(String).filter(Boolean).slice(0,24):[],
        color:normalizeColor(node.color,'#ede9fe'),
        status:['draft','verified','mastered'].includes(String(node.status||''))?String(node.status):'draft',
        displayMode:'full',
        sourceNodeIds:[...new Set((Array.isArray(node.sourceNodeIds)?node.sourceNodeIds:[]).map(String).filter(Boolean))].slice(0,200),
        autoGenerated:!!node.autoGenerated,
        cardType:String(node.cardType||'user')==='system'?'system':'user',
        personalCardId:String(node.personalCardId||''),
        personalCardRevision:Math.max(0,Math.floor(Number(node.personalCardRevision||0))),
        archived:!!node.archived,
        personalCardSyncError:String(node.personalCardSyncError||''),
        principleId:String(node.principleId||''),
        principleTag:String(node.principleTag||''),
        sourcePresetId:String(node.sourcePresetId||''),
        presetVersion:Math.max(0,Math.floor(Number(node.presetVersion||0))),
        practiceLevel:Math.max(1,Math.min(3,Math.floor(Number(node.practiceLevel||1)))),
        practiceRound:Math.max(0,Math.floor(Number(node.practiceRound||0))),
        practiceQuestionKeys:[...new Set((Array.isArray(node.practiceQuestionKeys)?node.practiceQuestionKeys:[]).map(String).filter(Boolean))].slice(0,500),
        practiceBatchNodeIds:[...new Set((Array.isArray(node.practiceBatchNodeIds)?node.practiceBatchNodeIds:[]).map(String).filter(Boolean))].slice(0,12),
        practiceMasteredCount:Math.max(0,Math.floor(Number(node.practiceMasteredCount||0))),
        questionId:'',bankId:'',paperId:'',releaseId:'',topic:'归纳卡',difficulty:'',stemSummary:'',correctAnswer:'',
        currentStep:1,principleCount:0,highlights:[]
      };
    }
    return {
      ...base,
      nodeType:'question-reference',
      questionId:String(node.questionId||''),
      bankId:String(node.bankId||''),
      paperId:String(node.paperId||''),
      releaseId:String(node.releaseId||''),
      title:String(node.title||'未命名题目'),
      topic:String(node.topic||node.domain||'未分类'),
      difficulty:String(node.difficulty||''),
      stemSummary:String(node.stemSummary||''),
      tags:Array.isArray(node.tags)?node.tags.map(String).slice(0,16):[],
      correctAnswer:String(node.correctAnswer||''),
      status:String(node.status||'not-started'),
      currentStep:Math.max(1,Math.min(5,Number(node.currentStep||1))),
      principleCount:Math.max(0,Number(node.principleCount||0)),
      displayMode:String(node.displayMode||'full')==='compact'?'compact':'full',
      color:normalizeColor(node.color,''),
      practiceForSynthesisId:String(node.practiceForSynthesisId||''),
      practiceLevel:Math.max(1,Math.min(3,Math.floor(Number(node.practiceLevel||1)))),
      practiceRound:Math.max(0,Math.floor(Number(node.practiceRound||0))),
      practiceOrder:Math.max(0,Math.min(3,Math.floor(Number(node.practiceOrder||0)))),
      practiceGenerated:!!node.practiceGenerated,
      practiceAttempted:!!node.practiceAttempted,
      practiceMastered:!!node.practiceMastered,
      practiceAnsweredAt:Math.max(0,Number(node.practiceAnsweredAt||0)),
      highlights:Array.isArray(node.highlights)?node.highlights.map(normalizeHighlight).filter(item=>item.end>item.start).slice(0,200):[]
    };
  }
  function normalizeEdge(edge={},index=0){
    const type=EDGE_TYPES.includes(String(edge.type||''))?String(edge.type):'same';
    const hasLabel=Object.prototype.hasOwnProperty.call(edge,'label');
    const color=/^#[0-9a-f]{6}$/i.test(String(edge.color||''))?String(edge.color):'';
    const lineStyle=['solid','dashed','dotted'].includes(String(edge.lineStyle||''))?String(edge.lineStyle):'solid';
    const pathStyle=['curve','straight','elbow'].includes(String(edge.pathStyle||''))?String(edge.pathStyle):'curve';
    const strokeWidth=Math.max(1,Math.min(8,Number(edge.strokeWidth)||3));
    const arrowStyle=['none','end','both'].includes(String(edge.arrowStyle||''))?String(edge.arrowStyle):(type==='cause'||type==='support'?'end':'none');
    return {
      id:String(edge.id||('workspace-edge-'+now().toString(36)+'-'+index)),
      source:String(edge.source||edge.from||''),
      target:String(edge.target||edge.to||''),
      type,
      label:hasLabel?String(edge.label??''):'',
      color,
      lineStyle,
      pathStyle,
      strokeWidth,
      arrowStyle,
      createdAt:Number(edge.createdAt||now()),
      updatedAt:Number(edge.updatedAt||now())
    };
  }
  function normalizeGroup(group={},index=0){
    return {
      id:String(group.id||('workspace-group-'+now().toString(36)+'-'+index)),
      title:String(group.title||'未命名分组'),
      color:normalizeColor(group.color,'#ede9fe'),
      nodeIds:[...new Set((Array.isArray(group.nodeIds)?group.nodeIds:[]).map(String).filter(Boolean))],
      collapsed:!!group.collapsed,
      x:Number.isFinite(Number(group.x))?Number(group.x):0,
      y:Number.isFinite(Number(group.y))?Number(group.y):0,
      width:Math.max(280,Math.min(2400,Number(group.width||420))),
      height:Math.max(72,Math.min(12000,Number(group.height||260))),
      createdAt:Number(group.createdAt||now()),
      updatedAt:Number(group.updatedAt||now())
    };
  }
  function normalizeWorkspace(value,options={}){
    const base=emptyWorkspace(options);
    if(!value||typeof value!=='object')return base;
    const nodes={};
    Object.entries(value.nodes&&typeof value.nodes==='object'?value.nodes:{}).forEach(([id,node])=>{
      const normalized=normalizeNode({...node,id:node?.id||id});
      nodes[normalized.id]=normalized;
    });
    const sourceSchema=Math.max(0,Number(value.schemaVersion||0));
    const edges=(Array.isArray(value.edges)?value.edges:[]).map(normalizeEdge).filter(edge=>edge.source&&edge.target&&edge.source!==edge.target&&nodes[edge.source]&&nodes[edge.target]);
    if(sourceSchema<6){
      edges.forEach(edge=>{
        const target=nodes[edge.target];
        if(edge.type==='support'&&edge.label==='归纳'&&target?.nodeType==='synthesis-card'&&target.autoGenerated&&(target.sourceNodeIds||[]).includes(edge.source))edge.label='';
      });
    }
    return {
      ...base,
      ...clone(value),
      schemaVersion:SCHEMA_VERSION,
      id:String(value.id||base.id),
      userId:String(value.userId||base.userId),
      title:String(value.title||base.title),
      viewport:{
        x:Number.isFinite(Number(value.viewport?.x))?Number(value.viewport.x):0,
        y:Number.isFinite(Number(value.viewport?.y))?Number(value.viewport.y):0,
        zoom:Math.max(.01,Math.min(4,Number(value.viewport?.zoom||1)))
      },
      nodes,
      edges,
      groups:(Array.isArray(value.groups)?value.groups:[]).map(normalizeGroup).map(group=>({...group,nodeIds:group.nodeIds.filter(id=>nodes[id])})).filter(group=>group.nodeIds.length),
      createdAt:Number(value.createdAt||base.createdAt),
      updatedAt:Number(value.updatedAt||base.updatedAt)
    };
  }
  function workspaceSummary(workspace){
    return {
      id:String(workspace.id),
      title:String(workspace.title||'未命名画布'),
      nodeCount:Object.keys(workspace.nodes||{}).length,
      questionCount:Object.values(workspace.nodes||{}).filter(node=>node.nodeType==='question-reference').length,
      synthesisCount:Object.values(workspace.nodes||{}).filter(node=>node.nodeType==='synthesis-card').length,
      createdAt:Number(workspace.createdAt||now()),
      updatedAt:Number(workspace.updatedAt||now())
    };
  }
  function emptyCatalog(userId=currentUserId()){
    return {
      schemaVersion:SCHEMA_VERSION,
      userId:String(userId||'guest'),
      activeWorkspaceId:DEFAULT_WORKSPACE_ID,
      workspaces:[],
      createdAt:now(),
      updatedAt:now()
    };
  }
  function normalizeCatalog(value,userId=currentUserId()){
    const base=emptyCatalog(userId);
    if(!value||typeof value!=='object')return base;
    const deduped=[];
    const seen=new Set();
    (Array.isArray(value.workspaces)?value.workspaces:[]).forEach(item=>{
      const id=String(item?.id||'');
      if(!id||seen.has(id))return;
      seen.add(id);
      deduped.push({
        id,
        title:String(item.title||'未命名画布'),
        nodeCount:Math.max(0,Number(item.nodeCount||0)),
        questionCount:Math.max(0,Number(item.questionCount||0)),
        synthesisCount:Math.max(0,Number(item.synthesisCount||0)),
        createdAt:Number(item.createdAt||now()),
        updatedAt:Number(item.updatedAt||now())
      });
    });
    return {
      ...base,
      ...clone(value),
      schemaVersion:SCHEMA_VERSION,
      userId:String(userId||value.userId||'guest'),
      activeWorkspaceId:String(value.activeWorkspaceId||deduped[0]?.id||DEFAULT_WORKSPACE_ID),
      workspaces:deduped,
      createdAt:Number(value.createdAt||base.createdAt),
      updatedAt:Number(value.updatedAt||base.updatedAt)
    };
  }
  function rawRead(userId,workspaceId){
    try{
      const raw=Store.readJSON?Store.readJSON(storageKey(userId,workspaceId),null):JSON.parse(global.localStorage?.getItem(storageKey(userId,workspaceId))||'null');
      return raw?normalizeWorkspace(raw,{userId,workspaceId}):null;
    }catch(error){
      console.warn('跨题工作区读取失败',error);
      return null;
    }
  }
  function rawWrite(workspace){
    const normalized=normalizeWorkspace({...clone(workspace),updatedAt:now()});
    const saved=Store.writeJSON?Store.writeJSON(storageKey(normalized.userId,normalized.id),normalized):(global.localStorage?.setItem(storageKey(normalized.userId,normalized.id),JSON.stringify(normalized)),true);
    if(!saved)console.warn('跨题工作区保存失败：浏览器存储不可用或空间不足。');
    return normalized;
  }
  function readCatalog(userId=currentUserId()){
    try{
      const raw=Store.readJSON?Store.readJSON(catalogKey(userId),null):JSON.parse(global.localStorage?.getItem(catalogKey(userId))||'null');
      return raw?normalizeCatalog(raw,userId):null;
    }catch(error){
      console.warn('工作区目录读取失败',error);
      return null;
    }
  }
  function writeCatalog(catalog){
    const normalized=normalizeCatalog({...clone(catalog),updatedAt:now()},catalog?.userId||currentUserId());
    const saved=Store.writeJSON?Store.writeJSON(catalogKey(normalized.userId),normalized):(global.localStorage?.setItem(catalogKey(normalized.userId),JSON.stringify(normalized)),true);
    if(!saved)console.warn('工作区目录保存失败：浏览器存储不可用或空间不足。');
    return normalized;
  }
  function ensureCatalog(options={}){
    const userId=String(options.userId||currentUserId());
    let catalog=readCatalog(userId);
    if(catalog&&catalog.workspaces.length){
      if(!catalog.workspaces.some(item=>item.id===catalog.activeWorkspaceId)){
        catalog.activeWorkspaceId=catalog.workspaces[0].id;
        catalog=writeCatalog(catalog);
      }
      return catalog;
    }
    let legacy=rawRead(userId,DEFAULT_WORKSPACE_ID);
    if(!legacy)legacy=rawWrite(emptyWorkspace({userId,workspaceId:DEFAULT_WORKSPACE_ID,title:'我的PMP解题规律'}));
    catalog=emptyCatalog(userId);
    catalog.activeWorkspaceId=legacy.id;
    catalog.workspaces=[workspaceSummary(legacy)];
    return writeCatalog(catalog);
  }
  function resolveWorkspaceId(options={}){
    if(options.workspaceId)return String(options.workspaceId);
    return String(ensureCatalog(options).activeWorkspaceId||DEFAULT_WORKSPACE_ID);
  }
  function notify(reason,workspace,detail={}){
    const payload={
      reason,
      workspace:workspace?clone(workspace):null,
      workspaceId:String(workspace?.id||detail.workspaceId||''),
      catalog:clone(readCatalog(workspace?.userId||detail.userId||currentUserId())),
      detail:clone(detail),
      at:now()
    };
    listeners.forEach(listener=>{
      try{listener(payload)}catch(error){console.error('CanvasWorkspaceStore listener error',error)}
    });
    try{global.dispatchEvent(new CustomEvent('kg:workspace-changed',{detail:payload}))}catch(e){}
    return payload;
  }
  function syncCatalogSummary(workspace,{activate=false}={}){
    let catalog=ensureCatalog({userId:workspace.userId});
    const summary=workspaceSummary(workspace);
    const index=catalog.workspaces.findIndex(item=>item.id===workspace.id);
    if(index>=0)catalog.workspaces[index]=summary;
    else catalog.workspaces.push(summary);
    if(activate)catalog.activeWorkspaceId=workspace.id;
    catalog=writeCatalog(catalog);
    return catalog;
  }
  function listWorkspaces(options={}){
    const catalog=ensureCatalog(options);
    return catalog.workspaces.map(summary=>{
      const workspace=rawRead(catalog.userId,summary.id);
      return workspace?workspaceSummary(workspace):summary;
    });
  }
  function reorderWorkspaces(workspaceIds=[],options={}){
    const userId=String(options.userId||currentUserId());
    let catalog=ensureCatalog({userId});
    const existingIds=catalog.workspaces.map(item=>String(item.id));
    const seen=new Set(),ordered=[];
    (Array.isArray(workspaceIds)?workspaceIds:[]).forEach(id=>{
      id=String(id||'');
      if(!id||seen.has(id)||!existingIds.includes(id))return;
      seen.add(id);ordered.push(id);
    });
    existingIds.forEach(id=>{if(!seen.has(id)){seen.add(id);ordered.push(id)}});
    const byId=new Map(catalog.workspaces.map(item=>[String(item.id),item]));
    catalog.workspaces=ordered.map(id=>byId.get(id)).filter(Boolean);
    catalog=writeCatalog(catalog);
    const active=ensure({userId,workspaceId:catalog.activeWorkspaceId});
    notify('workspace-order-changed',active,{workspaceIds:ordered});
    return clone(catalog);
  }
  function getActiveWorkspaceId(options={}){
    return resolveWorkspaceId(options);
  }
  function getActiveWorkspace(options={}){
    return ensure({...options,workspaceId:resolveWorkspaceId(options)});
  }
  function setActiveWorkspace(workspaceId,options={}){
    const userId=String(options.userId||currentUserId());
    const catalog=ensureCatalog({userId});
    workspaceId=String(workspaceId||'');
    if(!catalog.workspaces.some(item=>item.id===workspaceId))return null;
    catalog.activeWorkspaceId=workspaceId;
    writeCatalog(catalog);
    const workspace=ensure({userId,workspaceId});
    notify('active-workspace-changed',workspace,{workspaceId});
    return clone(workspace);
  }
  function read(options={}){
    const userId=String(options.userId||currentUserId());
    const workspaceId=resolveWorkspaceId({...options,userId});
    return rawRead(userId,workspaceId);
  }
  function write(workspace,options={}){
    const normalized=rawWrite(workspace);
    syncCatalogSummary(normalized,{activate:!!options.activate});
    notify(options.reason||'saved',normalized,options.detail||{});
    return clone(normalized);
  }
  function ensure(options={}){
    const userId=String(options.userId||currentUserId());
    const catalog=ensureCatalog({userId});
    const workspaceId=String(options.workspaceId||catalog.activeWorkspaceId||DEFAULT_WORKSPACE_ID);
    let workspace=rawRead(userId,workspaceId);
    if(!workspace){
      workspace=rawWrite(emptyWorkspace({
        userId,
        workspaceId,
        title:options.title||'未命名画布'
      }));
      syncCatalogSummary(workspace,{activate:options.activate!==false});
    }
    return clone(workspace);
  }
  function createWorkspace(title='新建画布',options={}){
    const userId=String(options.userId||currentUserId());
    const workspace=rawWrite(emptyWorkspace({
      userId,
      workspaceId:String(options.workspaceId||slugId(title)),
      title:String(title||'新建画布').trim()||'新建画布'
    }));
    syncCatalogSummary(workspace,{activate:options.activate!==false});
    notify('workspace-created',workspace,{workspaceId:workspace.id});
    return clone(workspace);
  }
  function renameWorkspace(workspaceId,title,options={}){
    workspaceId=String(workspaceId||resolveWorkspaceId(options));
    const workspace=ensure({...options,workspaceId});
    workspace.title=String(title||'').trim()||workspace.title;
    return write(workspace,{reason:'workspace-renamed'});
  }
  function deleteWorkspace(workspaceId,options={}){
    const userId=String(options.userId||currentUserId());
    let catalog=ensureCatalog({userId});
    workspaceId=String(workspaceId||catalog.activeWorkspaceId);
    if(!catalog.workspaces.some(item=>item.id===workspaceId))return null;
    try{if(Store.remove)Store.remove(storageKey(userId,workspaceId));else global.localStorage?.removeItem(storageKey(userId,workspaceId))}catch(e){}
    catalog.workspaces=catalog.workspaces.filter(item=>item.id!==workspaceId);
    if(!catalog.workspaces.length){
      const replacement=rawWrite(emptyWorkspace({
        userId,
        workspaceId:DEFAULT_WORKSPACE_ID,
        title:'我的PMP解题规律'
      }));
      catalog.workspaces=[workspaceSummary(replacement)];
    }
    if(catalog.activeWorkspaceId===workspaceId){
      catalog.activeWorkspaceId=catalog.workspaces[0].id;
    }
    catalog=writeCatalog(catalog);
    const active=ensure({userId,workspaceId:catalog.activeWorkspaceId});
    notify('workspace-deleted',active,{deletedWorkspaceId:workspaceId});
    return {deletedWorkspaceId:workspaceId,activeWorkspace:clone(active),catalog:clone(catalog)};
  }
  function update(mutator,options={}){
    const workspace=ensure(options);
    const draft=clone(workspace);
    const next=typeof mutator==='function'?(mutator(draft)||draft):{...draft,...clone(mutator||{})};
    return write(next,{reason:options.reason||'saved'});
  }
  function updateViewport(viewport={},options={}){
    return update(workspace=>{
      workspace.viewport={
        x:Number.isFinite(Number(viewport.x))?Number(viewport.x):Number(workspace.viewport?.x||0),
        y:Number.isFinite(Number(viewport.y))?Number(viewport.y):Number(workspace.viewport?.y||0),
        zoom:Math.max(.01,Math.min(4,Number(viewport.zoom||workspace.viewport?.zoom||1)))
      };
      return workspace;
    },{...options,reason:'viewport-updated'});
  }
  function stemSummary(question={}){
    if(String(question.stem||'').trim())return String(question.stem).trim().slice(0,260);
    if(Array.isArray(question.stemParts)){
      return question.stemParts.map(part=>String(part?.text||'')).join('').trim().slice(0,260);
    }
    return '';
  }
  function sessionStatus(input,bankId='',paperId='',releaseId=''){
    const context=input&&typeof input==='object'
      ?{paperId:String(input.sourcePaperId||input.paperId||''),releaseId:String(input.sourceReleaseId||input.releaseId||''),questionId:String(input.id||input.questionId||input.sourceQuestionId||''),bankId:String(input.sourceBankId||input.bankId||bankId||''),mode:'single_deep_study'}
      :{paperId:String(paperId||''),releaseId:String(releaseId||''),questionId:String(input||''),bankId:String(bankId||''),mode:'single_deep_study'};
    const session=global.KGLearningSessionStore?.get?.(context,currentUserId())||null;
    if(!session)return {status:'not-started',currentStep:1};
    return {
      status:session.status==='completed'?'completed':'in-progress',
      currentStep:Math.max(1,Math.min(5,Number(session.currentStep||1)))
    };
  }
  function snapshotQuestion(question={},bankId='',position={}){
    const questionId=String(question.id||question.sourceQuestionId||'');
    const resolvedBankId=String(bankId||question.sourceBankId||'');
    const paperId=String(question.sourcePaperId||'');
    const releaseId=String(question.sourceReleaseId||'');
    const progress=sessionStatus(question,resolvedBankId,paperId,releaseId);
    return normalizeNode({
      id:questionNodeId(questionId,resolvedBankId,paperId,releaseId),
      nodeType:'question-reference',
      questionId,
      bankId:resolvedBankId,
      paperId,
      releaseId,
      title:String(question.title||'未命名题目'),
      topic:String(question.topic||question.domain||'未分类'),
      difficulty:String(question.difficulty||''),
      stemSummary:stemSummary(question),
      tags:Array.isArray(question.tags)?question.tags:[],
      correctAnswer:String(question.correctAnswer||''),
      status:progress.status,
      currentStep:progress.currentStep,
      principleCount:0,
      x:Number(position.x||600),
      y:Number(position.y||420),
      width:Number(position.width||360),
      height:Number(position.height||240)
    });
  }
  function findQuestionNode(questionId,bankId='',options={}){
    const workspace=ensure(options);
    const identity=questionIdentity(questionId,bankId,options.paperId,options.releaseId);
    return Object.values(workspace.nodes).find(node=>{
      if(node.nodeType!=='question-reference')return false;
      const nodeIdentity=questionIdentity(node.questionId,node.bankId,node.paperId,node.releaseId);
      if(nodeIdentity===identity)return true;
      return !node.paperId&&!node.releaseId&&questionIdentity(node.questionId,node.bankId)===questionIdentity(questionId,bankId);
    })||null;
  }
  function addQuestionReference(question={},bankId='',position={},options={}){
    const questionId=String(question.id||question.sourceQuestionId||'');
    if(!questionId)return {created:false,error:'QUESTION_ID_REQUIRED',node:null,workspace:ensure(options)};
    const workspace=ensure(options);
    const resolvedBankId=String(bankId||question.sourceBankId||'');
    const paperId=String(question.sourcePaperId||'');
    const releaseId=String(question.sourceReleaseId||'');
    const identity=questionIdentity(questionId,resolvedBankId,paperId,releaseId);
    const existing=Object.values(workspace.nodes).find(node=>{
      if(node.nodeType!=='question-reference')return false;
      if(questionIdentity(node.questionId,node.bankId,node.paperId,node.releaseId)===identity)return true;
      return !node.paperId&&!node.releaseId&&questionIdentity(node.questionId,node.bankId)===questionIdentity(questionId,resolvedBankId);
    })||null;
    if(existing){
      return {created:false,node:clone(existing),workspace,reason:'already-exists'};
    }
    const node=snapshotQuestion(question,resolvedBankId,position);
    workspace.nodes[node.id]=node;
    const saved=write(workspace,{reason:'question-node-added',detail:{nodeId:node.id,questionId}});
    return {created:true,node:clone(node),workspace:saved};
  }
  function updateNode(nodeId,patch={},options={}){
    nodeId=String(nodeId||'');
    if(!nodeId)return null;
    let changed=null;
    const saved=update(workspace=>{
      const current=workspace.nodes[nodeId];
      if(!current)return workspace;
      changed=normalizeNode({...current,...clone(patch),id:nodeId,updatedAt:now()});
      workspace.nodes[nodeId]=changed;
      return workspace;
    },{...options,reason:'node-updated'});
    return changed?{node:clone(changed),workspace:saved}:null;
  }
  function updateNodeLayout(nodeId,layout={},options={}){
    return updateNode(nodeId,{
      x:Number(layout.x),
      y:Number(layout.y),
      width:Number(layout.width),
      height:Number(layout.height)
    },options);
  }
  function updateNodeLayouts(layouts={},options={}){
    const entries=Array.isArray(layouts)
      ?layouts.map(item=>[String(item?.id||item?.nodeId||''),item])
      :Object.entries(layouts||{});
    const changedIds=[];
    const saved=update(workspace=>{
      entries.forEach(([nodeId,layout])=>{
        nodeId=String(nodeId||'');
        const current=workspace.nodes[nodeId];
        if(!current||!layout)return;
        workspace.nodes[nodeId]=normalizeNode({
          ...current,
          x:Number(layout.x),
          y:Number(layout.y),
          width:Number(layout.width),
          height:Number(layout.height),
          id:nodeId,
          updatedAt:now()
        });
        changedIds.push(nodeId);
      });
      return workspace;
    },{...options,reason:'nodes-layout-updated'});
    return {nodeIds:changedIds,workspace:saved};
  }
  function updateNodeDisplayMode(nodeId,displayMode='full',options={}){
    return updateNode(nodeId,{displayMode:String(displayMode)==='compact'?'compact':'full'},options);
  }
  function setNodeHighlights(nodeId,highlights=[],options={}){
    return updateNode(nodeId,{highlights:Array.isArray(highlights)?highlights:[]},options);
  }
  function addNodeHighlight(nodeId,highlight={},options={}){
    const workspace=ensure(options);
    const current=workspace.nodes[String(nodeId||'')];
    if(!current)return null;
    const next=(Array.isArray(current.highlights)?current.highlights:[]).filter(item=>
      String(item.region)!==String(highlight.region)||Number(item.end)<=Number(highlight.start)||Number(item.start)>=Number(highlight.end)
    );
    next.push(normalizeHighlight(highlight,next.length));
    return setNodeHighlights(nodeId,next,options);
  }
  function updateNodeHighlight(nodeId,highlightId,patch={},options={}){
    const workspace=ensure(options);
    const current=workspace.nodes[String(nodeId||'')];
    if(!current)return null;
    let found=false;
    const next=(Array.isArray(current.highlights)?current.highlights:[]).map((item,index)=>{
      if(String(item.id)!==String(highlightId||''))return item;
      found=true;
      return normalizeHighlight({...item,...clone(patch),id:item.id,updatedAt:now()},index);
    });
    return found?setNodeHighlights(nodeId,next,options):null;
  }
  function removeNodeHighlight(nodeId,highlightId,options={}){
    const workspace=ensure(options);
    const current=workspace.nodes[String(nodeId||'')];
    if(!current)return null;
    const next=(Array.isArray(current.highlights)?current.highlights:[]).filter(item=>String(item.id)!==String(highlightId||''));
    return setNodeHighlights(nodeId,next,options);
  }
  function addSynthesisCard(payload={},position={},options={}){
    const workspace=ensure(options);
    const type=SYNTHESIS_TYPES.includes(String(payload.synthesisType||''))?String(payload.synthesisType):'principle';
    const node=normalizeNode({
      ...clone(payload),
      id:String(payload.id||('synthesis-'+type+'-'+now().toString(36)+'-'+hashString(Math.random()).slice(0,5))),
      nodeType:'synthesis-card',
      synthesisType:type,
      x:Number(position.x??payload.x??640),
      y:Number(position.y??payload.y??440),
      width:Number(position.width??payload.width??420),
      height:Number(position.height??payload.height??280)
    });
    workspace.nodes[node.id]=node;
    const saved=write(workspace,{reason:'synthesis-node-added',detail:{nodeId:node.id,synthesisType:type}});
    return {created:true,node:clone(node),workspace:saved};
  }
  function personalCardNodePatch(card={}){
    return {
      personalCardId:String(card.id||''),
      personalCardRevision:Math.max(0,Math.floor(Number(card.revision||0))),
      archived:!!card.archivedAt,
      personalCardSyncError:'',
      synthesisType:SYNTHESIS_TYPES.includes(String(card.synthesisType||''))?String(card.synthesisType):'principle',
      title:String(card.title||'未命名归纳卡'),
      content:String(card.content||''),
      tags:Array.isArray(card.tags)?card.tags.map(String).filter(Boolean).slice(0,24):[],
      status:['draft','verified','mastered'].includes(String(card.status||''))?String(card.status):'draft'
    };
  }
  function hydratePersonalCards(cards=[],options={}){
    const byId=new Map((Array.isArray(cards)?cards:[]).filter(card=>card&&card.id).map(card=>[String(card.id),card]));
    const workspace=ensure(options);
    let changed=0;
    Object.values(workspace.nodes||{}).forEach(node=>{
      if(node.nodeType!=='synthesis-card'||!node.personalCardId)return;
      const card=byId.get(String(node.personalCardId));
      if(!card)return;
      const patch=personalCardNodePatch(card);
      const differs=Object.entries(patch).some(([key,value])=>JSON.stringify(node[key])!==JSON.stringify(value));
      if(!differs)return;
      workspace.nodes[node.id]=normalizeNode({...node,...patch,id:node.id,updatedAt:now()});
      changed+=1;
    });
    const saved=changed?write(workspace,{reason:'personal-cards-hydrated',detail:{changed}}):workspace;
    return {changed,workspace:clone(saved)};
  }
  function addEdge(payload={},options={}){
    const workspace=ensure(options);
    const edge=normalizeEdge({...clone(payload),id:payload.id||('workspace-edge-'+now().toString(36)+'-'+hashString(Math.random()).slice(0,5))});
    if(!workspace.nodes[edge.source]||!workspace.nodes[edge.target]||edge.source===edge.target)return {created:false,error:'INVALID_ENDPOINT',workspace};
    const duplicate=(workspace.edges||[]).find(item=>item.source===edge.source&&item.target===edge.target&&item.type===edge.type);
    if(duplicate)return {created:false,reason:'already-exists',edge:clone(duplicate),workspace};
    workspace.edges.push(edge);
    const saved=write(workspace,{reason:'edge-added',detail:{edgeId:edge.id}});
    return {created:true,edge:clone(edge),workspace:saved};
  }
  function updateEdge(edgeId,patch={},options={}){
    edgeId=String(edgeId||'');
    let changed=null;
    const saved=update(workspace=>{
      const index=(workspace.edges||[]).findIndex(item=>String(item.id)===edgeId);
      if(index<0)return workspace;
      changed=normalizeEdge({...workspace.edges[index],...clone(patch),id:edgeId,updatedAt:now()},index);
      if(!workspace.nodes[changed.source]||!workspace.nodes[changed.target]||changed.source===changed.target){changed=null;return workspace}
      workspace.edges[index]=changed;
      return workspace;
    },{...options,reason:'edge-updated'});
    return changed?{edge:clone(changed),workspace:saved}:null;
  }
  function removeEdge(edgeId,options={}){
    edgeId=String(edgeId||'');
    let removed=null;
    const saved=update(workspace=>{
      removed=(workspace.edges||[]).find(item=>String(item.id)===edgeId)||null;
      workspace.edges=(workspace.edges||[]).filter(item=>String(item.id)!==edgeId);
      return workspace;
    },{...options,reason:'edge-removed'});
    return {removed:clone(removed),workspace:saved};
  }
  function createGroup(payload={},nodeIds=[],options={}){
    const workspace=ensure(options);
    const ids=[...new Set((nodeIds||payload.nodeIds||[]).map(String).filter(id=>workspace.nodes[id]))];
    if(ids.length<1)return {created:false,error:'NODE_REQUIRED',workspace};
    workspace.groups=(workspace.groups||[]).map(group=>({...group,nodeIds:(group.nodeIds||[]).filter(id=>!ids.includes(String(id)))})).filter(group=>group.nodeIds.length);
    const group=normalizeGroup({...clone(payload),nodeIds:ids,id:payload.id||('workspace-group-'+now().toString(36)+'-'+hashString(Math.random()).slice(0,5))});
    workspace.groups.push(group);
    const saved=write(workspace,{reason:'group-created',detail:{groupId:group.id,nodeIds:ids}});
    return {created:true,group:clone(group),workspace:saved};
  }
  function updateGroup(groupId,patch={},options={}){
    groupId=String(groupId||'');
    let changed=null;
    const saved=update(workspace=>{
      const index=(workspace.groups||[]).findIndex(item=>String(item.id)===groupId);
      if(index<0)return workspace;
      const proposed={...workspace.groups[index],...clone(patch),id:groupId,updatedAt:now()};
      proposed.nodeIds=[...new Set((proposed.nodeIds||[]).map(String).filter(id=>workspace.nodes[id]))];
      if(Array.isArray(patch.nodeIds)){
        const claimed=new Set(proposed.nodeIds);
        workspace.groups=workspace.groups.map((group,groupIndex)=>groupIndex===index?group:{...group,nodeIds:(group.nodeIds||[]).filter(id=>!claimed.has(String(id)))}).filter((group,groupIndex)=>groupIndex===index||group.nodeIds.length);
      }
      const freshIndex=workspace.groups.findIndex(item=>String(item.id)===groupId);
      changed=normalizeGroup(proposed,freshIndex);
      workspace.groups[freshIndex]=changed;
      return workspace;
    },{...options,reason:'group-updated'});
    return changed?{group:clone(changed),workspace:saved}:null;
  }
  function removeGroup(groupId,options={}){
    groupId=String(groupId||'');
    let removed=null;
    const saved=update(workspace=>{
      removed=(workspace.groups||[]).find(item=>String(item.id)===groupId)||null;
      workspace.groups=(workspace.groups||[]).filter(item=>String(item.id)!==groupId);
      return workspace;
    },{...options,reason:'group-removed'});
    return {removed:clone(removed),workspace:saved};
  }
  function listEdges(options={}){return clone(ensure(options).edges||[])}
  function listGroups(options={}){return clone(ensure(options).groups||[])}
  function removeNode(nodeId,options={}){
    nodeId=String(nodeId||'');
    let removed=null;
    const saved=update(workspace=>{
      removed=workspace.nodes[nodeId]||null;
      if(!removed)return workspace;
      const dependentPracticeIds=removed.nodeType==='synthesis-card'
        ?Object.values(workspace.nodes||{}).filter(node=>String(node.practiceForSynthesisId||'')===nodeId).map(node=>String(node.id))
        :[];
      delete workspace.nodes[nodeId];
      dependentPracticeIds.forEach(id=>delete workspace.nodes[id]);
      const removedIds=new Set([nodeId,...dependentPracticeIds]);
      workspace.edges=(workspace.edges||[]).filter(edge=>!removedIds.has(String(edge.source))&&!removedIds.has(String(edge.target)));
      workspace.groups=(workspace.groups||[]).map(group=>({
        ...group,
        nodeIds:(group.nodeIds||[]).filter(id=>!removedIds.has(String(id)))
      })).filter(group=>group.nodeIds.length);
      return workspace;
    },{...options,reason:'node-removed'});
    return {removed:clone(removed),workspace:saved};
  }
  function listNodes(options={}){
    return Object.values(ensure(options).nodes).sort((a,b)=>Number(a.createdAt)-Number(b.createdAt));
  }
  function refreshQuestionProgress(input,options={}){
    const context=input&&typeof input==='object'?input:{questionId:String(input||'')};
    const progress=sessionStatus(context,context.bankId,context.paperId,context.releaseId);
    const workspace=ensure(options);
    let changed=false;
    Object.values(workspace.nodes).forEach(node=>{
      if(node.questionId!==String(context.questionId||''))return;
      if(context.bankId&&node.bankId!==String(context.bankId))return;
      if(context.paperId&&node.paperId!==String(context.paperId))return;
      if(context.releaseId&&node.releaseId!==String(context.releaseId))return;
      node.status=progress.status;
      node.currentStep=progress.currentStep;
      node.updatedAt=now();
      changed=true;
    });
    return changed?write(workspace,{reason:'question-progress-refreshed'}):workspace;
  }
  function workspaceUrl(workspaceId,nodeId=''){
    const params=new URLSearchParams();
    if(workspaceId)params.set('workspace',String(workspaceId));
    if(nodeId)params.set('focus',String(nodeId));
    const query=params.toString();
    return 'question-workspace.html'+(query?'?'+query:'');
  }
  function subscribe(listener){
    if(typeof listener!=='function')return()=>{};
    listeners.add(listener);
    return()=>listeners.delete(listener);
  }

  global.KGCanvasWorkspaceStore=Object.freeze({
    STORAGE_PREFIX,
    CATALOG_PREFIX,
    DEFAULT_WORKSPACE_ID,
    LAYOUT_LIMITS,
    SYNTHESIS_TYPES,
    EDGE_TYPES,
    GROUP_COLORS,
    currentUserId,
    ensureCatalog,
    listWorkspaces,
    reorderWorkspaces,
    getActiveWorkspaceId,
    getActiveWorkspace,
    setActiveWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    ensure,
    read,
    write,
    update,
    updateViewport,
    listNodes,
    findQuestionNode,
    addQuestionReference,
    addSynthesisCard,
    personalCardNodePatch,
    hydratePersonalCards,
    updateNode,
    updateNodeLayout,
    updateNodeLayouts,
    updateNodeDisplayMode,
    setNodeHighlights,
    addNodeHighlight,
    updateNodeHighlight,
    removeNodeHighlight,
    addEdge,
    updateEdge,
    removeEdge,
    listEdges,
    createGroup,
    updateGroup,
    removeGroup,
    listGroups,
    removeNode,
    refreshQuestionProgress,
    snapshotQuestion,
    questionIdentity,
    questionNodeId,
    workspaceUrl,
    subscribe
  });
})(window);
