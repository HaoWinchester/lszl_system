'use strict';

(function(global){
  const SUBJECT_KEY='kg_content_subjects_v1';
  const TAXONOMY_KEY='kg_content_taxonomies_v1';
  const ACTIVITY_OVERRIDE_KEY='kg_content_activity_overrides_v1';
  const COURSE_DRAFT_KEY='kg_course_config_drafts_v1';
  const COURSE_RELEASE_KEY='kg_course_config_releases_v1';
  const ACTIVE_COURSE_KEY='kg_course_config_active_release_v1';
  const SCHEMA_VERSION=1;
  const MAX_DEPTH=9;

  const clone=value=>{try{return JSON.parse(JSON.stringify(value))}catch(error){return value}};
  const clean=value=>String(value??'').trim();
  const unique=values=>[...new Set((values||[]).map(value=>String(value||'')).filter(Boolean))];
  const nowIso=()=>new Date().toISOString();
  const safeId=(prefix='id')=>prefix+'-'+(global.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)+Date.now().toString(36));
  function hashString(value){let hash=0x811c9dc5;for(const char of String(value||'')){hash^=char.charCodeAt(0);hash=Math.imul(hash,0x01000193)>>>0}return 'fnv1a32:'+hash.toString(16).padStart(8,'0')}

  const DEFAULT_SUBJECTS=[
    {id:'subject-pmp',code:'PMP',name:{zh:'PMP 项目管理',en:'PMP Project Management'},defaultTaxonomyId:'taxonomy-pmp-main',status:'active',sortOrder:10},
    {id:'subject-cspm',code:'CSPM',name:{zh:'CSPM 项目管理能力',en:'CSPM Project Management Capability'},defaultTaxonomyId:'taxonomy-cspm-main',status:'active',sortOrder:20},
    {id:'subject-p2',code:'P2',name:{zh:'P2 / PRINCE2',en:'P2 / PRINCE2'},defaultTaxonomyId:'taxonomy-p2-main',status:'active',sortOrder:30},
    {id:'subject-acp',code:'ACP',name:{zh:'ACP 敏捷项目管理',en:'ACP Agile Project Management'},defaultTaxonomyId:'taxonomy-acp-main',status:'active',sortOrder:40},
    {id:'subject-npdp',code:'NPDP',name:{zh:'NPDP 产品开发',en:'NPDP Product Development'},defaultTaxonomyId:'taxonomy-npdp-main',status:'active',sortOrder:50}
  ];

  function rootNode(id,taxonomyId,title,code){
    return {id,taxonomyId,parentId:null,level:1,title:{zh:title,en:''},code,status:'active',aliases:[],sortOrder:10};
  }

  const DEFAULT_TAXONOMIES=[
    {
      id:'taxonomy-pmp-main',subjectId:'subject-pmp',name:{zh:'PMP 主知识树',en:'PMP Main Knowledge Tree'},version:1,maxDepth:MAX_DEPTH,status:'published',isDefault:true,
      nodes:[
        rootNode('kp-pmp','taxonomy-pmp-main','PMP','PMP'),
        {id:'kp-pmp-environment',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp',level:2,title:{zh:'项目环境',en:'Project Environment'},code:'PMP.ENV',status:'active',aliases:[],sortOrder:10},
        {id:'kp-pmp-principles',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp',level:2,title:{zh:'项目管理原则',en:'Project Management Principles'},code:'PMP.PRINCIPLES',status:'active',aliases:[],sortOrder:20},
        {id:'kp-pmp-domains',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp',level:2,title:{zh:'项目绩效域',en:'Project Performance Domains'},code:'PMP.DOMAINS',status:'active',aliases:['绩效域'],sortOrder:30},
        {id:'kp-pmp-requirements',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp',level:2,title:{zh:'项目需求管理',en:'Project Requirements Management'},code:'PMP.REQ',status:'active',aliases:['需求管理'],sortOrder:40},
        {id:'kp-pmp-plan-requirements',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp-requirements',level:3,title:{zh:'规划需求管理',en:'Plan Requirements Management'},code:'PMP.REQ.PLAN',status:'active',aliases:[],sortOrder:10},
        {id:'kp-pmp-plan-requirements-output',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp-plan-requirements',level:4,title:{zh:'输出',en:'Outputs'},code:'PMP.REQ.PLAN.OUTPUT',status:'active',aliases:[],sortOrder:10},
        {id:'kp-pmp-rtm',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp-plan-requirements-output',level:5,title:{zh:'需求跟踪矩阵',en:'Requirements Traceability Matrix'},code:'PMP.REQ.PLAN.OUTPUT.RTM',status:'active',aliases:['RTM','需求追踪矩阵','需求可追溯矩阵'],sortOrder:10},
        {id:'kp-pmp-rtm-bidirectional',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp-rtm',level:6,title:{zh:'双向可追溯特点',en:'Bidirectional Traceability'},code:'PMP.REQ.PLAN.OUTPUT.RTM.BIDIRECTIONAL',status:'active',aliases:['双向追踪','双向可追溯'],sortOrder:10},
        {id:'kp-pmp-predictive',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp',level:2,title:{zh:'预测型方法',en:'Predictive Approach'},code:'PMP.PREDICTIVE',status:'active',aliases:[],sortOrder:50},
        {id:'kp-pmp-agile',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp',level:2,title:{zh:'敏捷方法',en:'Agile Approach'},code:'PMP.AGILE',status:'active',aliases:['敏捷'],sortOrder:60},
        {id:'kp-pmp-hybrid',taxonomyId:'taxonomy-pmp-main',parentId:'kp-pmp',level:2,title:{zh:'混合型方法',en:'Hybrid Approach'},code:'PMP.HYBRID',status:'active',aliases:['混合'],sortOrder:70}
      ]
    },
    {id:'taxonomy-cspm-main',subjectId:'subject-cspm',name:{zh:'CSPM 主知识树',en:'CSPM Main Knowledge Tree'},version:1,maxDepth:MAX_DEPTH,status:'published',isDefault:true,nodes:[rootNode('kp-cspm','taxonomy-cspm-main','CSPM','CSPM')]},
    {id:'taxonomy-p2-main',subjectId:'subject-p2',name:{zh:'P2 / PRINCE2 主知识树',en:'P2 / PRINCE2 Main Knowledge Tree'},version:1,maxDepth:MAX_DEPTH,status:'published',isDefault:true,nodes:[rootNode('kp-p2','taxonomy-p2-main','P2 / PRINCE2','P2')]},
    {id:'taxonomy-acp-main',subjectId:'subject-acp',name:{zh:'ACP 主知识树',en:'ACP Main Knowledge Tree'},version:1,maxDepth:MAX_DEPTH,status:'published',isDefault:true,nodes:[rootNode('kp-acp','taxonomy-acp-main','ACP','ACP')]},
    {id:'taxonomy-npdp-main',subjectId:'subject-npdp',name:{zh:'NPDP 主知识树',en:'NPDP Main Knowledge Tree'},version:1,maxDepth:MAX_DEPTH,status:'published',isDefault:true,nodes:[rootNode('kp-npdp','taxonomy-npdp-main','NPDP','NPDP')]}
  ];

  function readJson(key,fallback){
    try{const raw=global.localStorage?.getItem(key);return raw?JSON.parse(raw):clone(fallback)}catch(error){return clone(fallback)}
  }
  function writeJson(key,value){
    try{global.localStorage?.setItem(key,JSON.stringify(value));try{if(typeof global.CustomEvent==='function')global.dispatchEvent?.(new global.CustomEvent('kg-app-storage-change',{detail:{type:'json',action:'write',key,value:clone(value)}}))}catch(_error){}return true}catch(error){return false}
  }
  function normalizedSubjects(){
    const stored=readJson(SUBJECT_KEY,DEFAULT_SUBJECTS);
    return (Array.isArray(stored)?stored:DEFAULT_SUBJECTS).map((item,index)=>{
      const rawStatus=clean(item.status).toLowerCase();
      return {
        id:clean(item.id)||safeId('subject'),code:(clean(item.code)||clean(item.id).replace(/^subject-/,'')).toUpperCase(),
        name:{zh:clean(item.name?.zh||(typeof item.name==='string'?item.name:'')||item.code||'未命名科目'),en:clean(item.name?.en||'')},
        description:{zh:clean(typeof item.description==='string'?item.description:item.description?.zh||''),en:clean(item.description?.en||'')},
        defaultTaxonomyId:clean(item.defaultTaxonomyId),status:['inactive','disabled','deprecated','archived'].includes(rawStatus)?'inactive':'active',sortOrder:Number(item.sortOrder||index+1),
        createdAt:clean(item.createdAt),updatedAt:clean(item.updatedAt),createdBy:clone(item.createdBy||null),updatedBy:clone(item.updatedBy||null)
      };
    }).sort((a,b)=>a.sortOrder-b.sortOrder);
  }
  function normalizedTaxonomies(){
    const stored=readJson(TAXONOMY_KEY,DEFAULT_TAXONOMIES);
    return (Array.isArray(stored)?stored:DEFAULT_TAXONOMIES).map((taxonomy,index)=>{
      const nodes=(Array.isArray(taxonomy.nodes)?taxonomy.nodes:[]).map((node,nodeIndex)=>({
        id:clean(node.id)||safeId('knowledge'),taxonomyId:clean(node.taxonomyId)||clean(taxonomy.id),parentId:node.parentId?clean(node.parentId):null,
        level:Math.max(1,Math.min(MAX_DEPTH,Number(node.level)||1)),title:{zh:clean(node.title?.zh||node.title||'未命名知识点'),en:clean(node.title?.en||'')},
        description:{zh:clean(typeof node.description==='string'?node.description:node.description?.zh||''),en:clean(node.description?.en||'')},
        code:clean(node.code),status:clean(node.status)||'active',aliases:unique(node.aliases),sortOrder:Number(node.sortOrder||nodeIndex+1),replacedByNodeIds:unique(node.replacedByNodeIds),
        createdAt:clean(node.createdAt),updatedAt:clean(node.updatedAt),createdBy:clone(node.createdBy||null),updatedBy:clone(node.updatedBy||null),deactivatedAt:clean(node.deactivatedAt),deactivatedBy:clone(node.deactivatedBy||null),reactivatedAt:clean(node.reactivatedAt),reactivatedBy:clone(node.reactivatedBy||null)
      }));
      return {id:clean(taxonomy.id)||safeId('taxonomy'),subjectId:clean(taxonomy.subjectId),name:{zh:clean(taxonomy.name?.zh||taxonomy.name||'未命名知识树'),en:clean(taxonomy.name?.en||'')},version:Math.max(1,Number(taxonomy.version)||1),versionLabel:clean(taxonomy.versionLabel)||`v${Math.max(1,Number(taxonomy.version)||1)}.0`,maxDepth:MAX_DEPTH,status:clean(taxonomy.status)||'draft',isDefault:!!taxonomy.isDefault,sortOrder:Number(taxonomy.sortOrder||index+1),createdAt:clean(taxonomy.createdAt),updatedAt:clean(taxonomy.updatedAt),createdBy:clone(taxonomy.createdBy||null),updatedBy:clone(taxonomy.updatedBy||null),maintenanceRevision:Math.max(0,Number(taxonomy.maintenanceRevision)||0),lastMaintainedAt:clean(taxonomy.lastMaintainedAt),lastMaintainedBy:clone(taxonomy.lastMaintainedBy||null),source:clone(taxonomy.source||null),nodes};
    });
  }
  function getSubjects(){return clone(normalizedSubjects())}
  function subjectById(subjectId){return clone(normalizedSubjects().find(item=>item.id===String(subjectId||'')||item.code===String(subjectId||''))||null)}
  function getTaxonomies(subjectId=''){return clone(normalizedTaxonomies().filter(item=>!subjectId||item.subjectId===String(subjectId)))}
  function taxonomyById(taxonomyId){return clone(normalizedTaxonomies().find(item=>item.id===String(taxonomyId||''))||null)}
  function defaultTaxonomyForSubject(subjectId){
    const subject=subjectById(subjectId);const list=getTaxonomies(subject?.id||subjectId);
    return clone(list.find(item=>item.id===subject?.defaultTaxonomyId)||list.find(item=>item.isDefault)||list[0]||null);
  }
  function nodesForTaxonomy(taxonomyId,options={}){
    const taxonomy=taxonomyById(taxonomyId);if(!taxonomy)return [];
    return clone(taxonomy.nodes.filter(node=>options.includeDeprecated||node.status!=='deprecated').sort((a,b)=>a.level-b.level||a.sortOrder-b.sortOrder||a.title.zh.localeCompare(b.title.zh,'zh-CN')));
  }
  function nodeById(taxonomyId,nodeId){return clone(nodesForTaxonomy(taxonomyId,{includeDeprecated:true}).find(node=>node.id===String(nodeId||''))||null)}
  function childrenOf(taxonomyId,parentId=null,options={}){return nodesForTaxonomy(taxonomyId,options).filter(node=>(node.parentId||null)===(parentId||null)).sort((a,b)=>a.sortOrder-b.sortOrder||a.title.zh.localeCompare(b.title.zh,'zh-CN'))}
  function pathForNode(taxonomyId,nodeId){
    const nodes=nodesForTaxonomy(taxonomyId,{includeDeprecated:true});const byId=new Map(nodes.map(node=>[node.id,node]));const result=[];let current=byId.get(String(nodeId||''));const guard=new Set();
    while(current&&!guard.has(current.id)){guard.add(current.id);result.unshift(clone(current));current=current.parentId?byId.get(current.parentId):null}
    return result;
  }
  function pathLabel(taxonomyId,nodeId,separator=' > '){return pathForNode(taxonomyId,nodeId).map(node=>node.title.zh).join(separator)}
  function descendantIds(taxonomyId,nodeId){
    const nodes=nodesForTaxonomy(taxonomyId,{includeDeprecated:true});const byParent=new Map();nodes.forEach(node=>{const key=node.parentId||'';if(!byParent.has(key))byParent.set(key,[]);byParent.get(key).push(node.id)});
    const result=[];const queue=[String(nodeId||'')];while(queue.length){const current=queue.shift();(byParent.get(current)||[]).forEach(id=>{result.push(id);queue.push(id)})}return result;
  }
  function searchNodes(taxonomyId,query=''){
    const keyword=clean(query).toLowerCase();const nodes=nodesForTaxonomy(taxonomyId);
    if(!keyword)return nodes.map(node=>({...node,path:pathLabel(taxonomyId,node.id)}));
    return nodes.filter(node=>[node.id,node.code,node.title.zh,node.title.en,...(node.aliases||[]),pathLabel(taxonomyId,node.id)].join(' ').toLowerCase().includes(keyword)).map(node=>({...node,path:pathLabel(taxonomyId,node.id)}));
  }
  function validateTaxonomy(taxonomy){
    const errors=[];const warnings=[];if(!taxonomy||typeof taxonomy!=='object')return {valid:false,errors:['知识树必须是对象。'],warnings:[]};
    if(!clean(taxonomy.id))errors.push('知识树缺少稳定 ID。');if(!clean(taxonomy.subjectId))errors.push('知识树缺少 subjectId。');
    const nodes=Array.isArray(taxonomy.nodes)?taxonomy.nodes:[];const byId=new Map();nodes.forEach(node=>{if(!clean(node.id))errors.push('存在缺少 ID 的知识节点。');else if(byId.has(node.id))errors.push('知识节点 ID 重复：'+node.id);else byId.set(node.id,node)});
    nodes.forEach(node=>{
      if(Number(node.level)<1||Number(node.level)>MAX_DEPTH)errors.push(`${node.id} 层级必须在 1～${MAX_DEPTH} 之间。`);
      if(node.parentId&&!byId.has(node.parentId))errors.push(`${node.id} 的父节点不存在：${node.parentId}`);
      if(node.parentId){const parent=byId.get(node.parentId);if(parent&&Number(node.level)!==Number(parent.level)+1)errors.push(`${node.id} 的 level 与父节点不连续。`)}
      const seen=new Set([node.id]);let current=node;while(current?.parentId){if(seen.has(current.parentId)){errors.push(`${node.id} 所在分支存在循环引用。`);break}seen.add(current.parentId);current=byId.get(current.parentId);if(!current)break}
    });
    if(!nodes.length)warnings.push('知识树还没有节点。');return {valid:errors.length===0,errors:[...new Set(errors)],warnings};
  }
  function saveSubjects(subjects){const normalized=clone(subjects||[]);writeJson(SUBJECT_KEY,normalized);return getSubjects()}
  function saveTaxonomies(taxonomies){const normalized=clone(taxonomies||[]);const errors=[];normalized.forEach(taxonomy=>{const result=validateTaxonomy(taxonomy);result.errors.forEach(message=>errors.push(`${taxonomy.id||'未命名知识树'}：${message}`))});if(errors.length)return {valid:false,errors};writeJson(TAXONOMY_KEY,normalized);return {valid:true,errors:[],taxonomies:getTaxonomies()}}
  function resetTaxonomies(){writeJson(SUBJECT_KEY,DEFAULT_SUBJECTS);writeJson(TAXONOMY_KEY,DEFAULT_TAXONOMIES);return {subjects:getSubjects(),taxonomies:getTaxonomies()}}
  function saveKnowledgeNode(taxonomyId,node){
    const taxonomies=normalizedTaxonomies();const taxonomy=taxonomies.find(item=>item.id===String(taxonomyId||''));if(!taxonomy)return {valid:false,errors:['知识树不存在。']};
    const record=clone(node)||{};record.id=clean(record.id)||safeId('knowledge');record.taxonomyId=taxonomy.id;record.parentId=record.parentId?clean(record.parentId):null;
    const existingIndex=taxonomy.nodes.findIndex(item=>item.id===record.id);const existing=existingIndex>=0?taxonomy.nodes[existingIndex]:null;const sameParent=(existing?.parentId||null)===(record.parentId||null);
    const descendantsOf=id=>{const result=[];const visit=parent=>taxonomy.nodes.filter(item=>item.parentId===parent).forEach(item=>{result.push(item.id);visit(item.id)});visit(id);return result};
    if(record.parentId===record.id)return {valid:false,errors:['知识点不能成为自己的父节点。']};
    if(existing&&descendantsOf(record.id).includes(record.parentId))return {valid:false,errors:['不能把知识点移动到自己的下级节点。']};
    const parent=record.parentId?taxonomy.nodes.find(item=>item.id===record.parentId):null;if(record.parentId&&!parent)return {valid:false,errors:['父知识点不存在。']};
    record.title={zh:clean(record.title?.zh||record.title||existing?.title?.zh)||'未命名知识点',en:clean(record.title?.en??existing?.title?.en??'')};
    record.description={zh:clean(typeof record.description==='string'?record.description:record.description?.zh??existing?.description?.zh??''),en:clean(record.description?.en??existing?.description?.en??'')};
    record.code=clean(record.code??existing?.code);record.status=clean(record.status||existing?.status)||'active';record.aliases=unique(record.aliases??existing?.aliases);
    const explicitSort=Object.prototype.hasOwnProperty.call(record,'sortOrder')&&Number.isFinite(Number(record.sortOrder));const siblingOrders=taxonomy.nodes.filter(item=>(item.parentId||null)===(record.parentId||null)&&item.id!==record.id).map(item=>Number(item.sortOrder)||0);record.sortOrder=explicitSort?Number(record.sortOrder):(existing&&sameParent?Number(existing.sortOrder)||10:Math.max(0,...siblingOrders)+10);
    record.replacedByNodeIds=unique(record.replacedByNodeIds??existing?.replacedByNodeIds);record.createdAt=clean(record.createdAt||existing?.createdAt)||nowIso();record.createdBy=clone(record.createdBy||existing?.createdBy||currentUser());record.updatedAt=clean(record.updatedAt)||nowIso();record.updatedBy=clone(record.updatedBy||currentUser());
    if(existingIndex>=0)taxonomy.nodes[existingIndex]={...existing,...record};else taxonomy.nodes.push(record);
    const byId=new Map(taxonomy.nodes.map(item=>[item.id,item]));const levelMemo=new Map();const resolving=new Set();
    const computeLevel=item=>{if(levelMemo.has(item.id))return levelMemo.get(item.id);if(resolving.has(item.id))throw new Error('知识树存在循环引用。');resolving.add(item.id);let level=1;if(item.parentId){const parentNode=byId.get(item.parentId);if(!parentNode)throw new Error(`父知识点不存在：${item.parentId}`);level=computeLevel(parentNode)+1}resolving.delete(item.id);levelMemo.set(item.id,level);return level};
    try{taxonomy.nodes.forEach(item=>{item.level=computeLevel(item);if(item.level>taxonomy.maxDepth||item.level>MAX_DEPTH)throw new Error(`知识点最多支持 ${Math.min(taxonomy.maxDepth,MAX_DEPTH)} 层。`)})}catch(error){return {valid:false,errors:[error.message]}}
    const actor=currentUser(),now=nowIso();taxonomy.updatedAt=now;taxonomy.updatedBy=clone(actor);taxonomy.lastMaintainedAt=now;taxonomy.lastMaintainedBy=clone(actor);taxonomy.maintenanceRevision=Math.max(0,Number(taxonomy.maintenanceRevision)||0)+1;
    const validation=validateTaxonomy(taxonomy);if(!validation.valid)return validation;writeJson(TAXONOMY_KEY,taxonomies);return {valid:true,node:clone(taxonomy.nodes.find(item=>item.id===record.id)),taxonomy:clone(taxonomy),errors:[],warnings:validation.warnings}
  }
  function deprecateKnowledgeNode(taxonomyId,nodeId,replacedByNodeIds=[]){const node=nodeById(taxonomyId,nodeId);if(!node)return {valid:false,errors:['知识点不存在。']};const actor=currentUser(),now=nowIso();return saveKnowledgeNode(taxonomyId,{...node,status:'deprecated',replacedByNodeIds:unique(replacedByNodeIds),deactivatedAt:now,deactivatedBy:actor,updatedAt:now,updatedBy:actor})}
  function deleteKnowledgeNode(taxonomyId,nodeId,options={}){
    const taxonomies=normalizedTaxonomies();const taxonomy=taxonomies.find(item=>item.id===String(taxonomyId||''));if(!taxonomy)return {valid:false,errors:['知识树不存在。']};
    const target=taxonomy.nodes.find(item=>item.id===String(nodeId||''));if(!target)return {valid:false,errors:['知识点不存在。']};
    const byParent=new Map();taxonomy.nodes.forEach(item=>{const key=item.parentId||'';if(!byParent.has(key))byParent.set(key,[]);byParent.get(key).push(item)});
    const descendants=[];const queue=[target.id];while(queue.length){const current=queue.shift();(byParent.get(current)||[]).forEach(item=>{descendants.push(item.id);queue.push(item.id)})}
    const branchIds=new Set([target.id,...descendants]);const references=[];Object.values(getActivityLibrary()).forEach(activity=>{const knowledge=activity.metadata?.knowledge||{};const related=Array.isArray(knowledge.relatedNodeIds)?knowledge.relatedNodeIds:[];if(branchIds.has(knowledge.primaryNodeId)||related.some(id=>branchIds.has(id)))references.push(activity.id)});
    if(references.length)return {valid:false,errors:[`该知识点分支仍被 ${references.length} 个活动引用，不能物理删除。请先重新归类活动，或将知识点设为停用。`],referencedActivityIds:unique(references),descendantIds:descendants};
    if(descendants.length&&!options.cascade)return {valid:false,errors:[`该知识点包含 ${descendants.length} 个下级节点。`],requiresCascade:true,descendantIds:descendants};
    const deletedIds=options.cascade?[target.id,...descendants]:[target.id];taxonomy.nodes=taxonomy.nodes.filter(item=>!deletedIds.includes(item.id));const validation=validateTaxonomy(taxonomy);if(!validation.valid)return validation;writeJson(TAXONOMY_KEY,taxonomies);return {valid:true,errors:[],warnings:validation.warnings,deletedIds,parentId:target.parentId||null};
  }

  function currentUser(){
    const user=global.KGAuthCore?.currentUser?.({includeInactive:true})||null;const username=global.KGAuthCore?.currentUsername?.()||clean(global.localStorage?.getItem('kg_local_current_user_v1'));
    if(user)return {id:clean(user.id||user.username||username)||'local-user',name:clean(user.displayName||user.name||user.username||username)||'本地用户',role:clean(user.role)||'teacher'};
    if(username)return {id:username,name:username,role:'teacher'};
    return {id:'local-anonymous',name:'未登录本地用户',role:'guest'};
  }
  function legacySubjectId(activity){
    const raw=clean(activity?.metadata?.subjectId||activity?.subject||activity?.metadata?.subject||'PMP');
    return subjectById(raw)?.id||subjectById(raw.toUpperCase())?.id||'subject-pmp';
  }
  function ensureActivityMetadata(activity,options={}){
    const record=clone(activity)||{};record.metadata=record.metadata&&typeof record.metadata==='object'?record.metadata:{};
    const subjectId=clean(record.metadata.subjectId)||legacySubjectId(record);const taxonomy=defaultTaxonomyForSubject(subjectId);
    const existing=record.metadata.knowledge&&typeof record.metadata.knowledge==='object'?record.metadata.knowledge:{};
    const primaryNodeId=clean(existing.primaryNodeId);const validPrimary=primaryNodeId&&nodeById(clean(existing.taxonomyId)||taxonomy?.id,primaryNodeId);
    record.metadata.subjectId=subjectId;
    record.metadata.knowledge={taxonomyId:clean(existing.taxonomyId)||taxonomy?.id||'',taxonomyVersion:Math.max(1,Number(existing.taxonomyVersion)||Number(taxonomy?.version)||1),primaryNodeId:validPrimary?primaryNodeId:null,relatedNodeIds:unique(existing.relatedNodeIds).filter(id=>nodeById(clean(existing.taxonomyId)||taxonomy?.id,id)),mappingStatus:validPrimary?(clean(existing.mappingStatus)||'confirmed'):(clean(existing.mappingStatus)==='suggested'?'suggested':'unmapped'),pathSnapshot:validPrimary?pathForNode(clean(existing.taxonomyId)||taxonomy?.id,primaryNodeId).map(node=>node.title.zh):[]};
    const user=currentUser();const author=record.metadata.authorship&&typeof record.metadata.authorship==='object'?record.metadata.authorship:{};const createdAt=clean(author.createdAt)||clean(options.createdAt)||nowIso();
    record.metadata.authorship={createdByUserId:clean(author.createdByUserId)||clean(options.createdByUserId)||'system-legacy',createdByName:clean(author.createdByName)||clean(options.createdByName)||'历史活动库',createdAt,updatedByUserId:clean(options.updatedByUserId)||clean(author.updatedByUserId)||clean(author.createdByUserId)||'system-legacy',updatedByName:clean(options.updatedByName)||clean(author.updatedByName)||clean(author.createdByName)||'历史活动库',updatedAt:clean(options.updatedAt)||clean(author.updatedAt)||createdAt};
    record.metadata.ownership={ownerUserId:clean(record.metadata.ownership?.ownerUserId)||record.metadata.authorship.createdByUserId,organizationId:clean(record.metadata.ownership?.organizationId)};
    record.metadata.lifecycle={status:clean(record.metadata.lifecycle?.status)||clean(options.status)||'approved',revision:Math.max(1,Number(record.metadata.lifecycle?.revision)||1),sourceApplication:clean(record.metadata.lifecycle?.sourceApplication)||clean(record.metadata.source)||'guided-learning'};
    const organization=record.metadata.organization&&typeof record.metadata.organization==='object'?record.metadata.organization:{};
    record.metadata.organization={difficulty:['unset','easy','medium','hard'].includes(organization.difficulty)?organization.difficulty:'unset',estimatedTimeSeconds:Math.max(0,Number(organization.estimatedTimeSeconds)||0),usagePurposes:unique(organization.usagePurposes).filter(item=>['practice','exam','learning_task'].includes(item)),tagIds:unique(organization.tagIds),reviewStatus:['unreviewed','reviewed'].includes(organization.reviewStatus)?organization.reviewStatus:'unreviewed',sourceType:['original','adapted','imported','legacy'].includes(organization.sourceType)?organization.sourceType:'legacy'};
    record.metadata.author=record.metadata.author||record.metadata.authorship.createdByName;
    if(options.touch){record.metadata.authorship.updatedByUserId=user.id;record.metadata.authorship.updatedByName=user.name;record.metadata.authorship.updatedAt=nowIso();record.metadata.lifecycle.revision+=1}
    return record;
  }
  function baseLibrary(){
    const source=global.KGGuidedLearningData?.getActivityLibrary?.()||{};const result={};Object.entries(source).forEach(([id,activity])=>{result[id]=ensureActivityMetadata(activity)});return result;
  }
  function activityOverrides(){return readJson(ACTIVITY_OVERRIDE_KEY,{})||{}}
  function getActivityLibrary(){const result=baseLibrary();Object.entries(activityOverrides()).forEach(([id,activity])=>{result[id]=ensureActivityMetadata(activity)});return clone(result)}
  function getActivities(filters={}){
    let list=Object.values(getActivityLibrary());const subjectId=clean(filters.subjectId),taxonomyId=clean(filters.taxonomyId),nodeId=clean(filters.nodeId),status=clean(filters.status),mappingStatus=clean(filters.mappingStatus),authorId=clean(filters.authorId),query=clean(filters.query).toLowerCase();
    if(subjectId)list=list.filter(item=>item.metadata?.subjectId===subjectId);if(taxonomyId)list=list.filter(item=>item.metadata?.knowledge?.taxonomyId===taxonomyId);
    if(nodeId){const ids=new Set([nodeId,...descendantIds(taxonomyId||list[0]?.metadata?.knowledge?.taxonomyId,nodeId)]);list=list.filter(item=>ids.has(item.metadata?.knowledge?.primaryNodeId))}
    if(status)list=list.filter(item=>item.metadata?.lifecycle?.status===status);if(mappingStatus)list=list.filter(item=>item.metadata?.knowledge?.mappingStatus===mappingStatus);if(authorId)list=list.filter(item=>item.metadata?.authorship?.createdByUserId===authorId);
    if(query)list=list.filter(item=>{const zh=item.content?.zh||{};return [item.id,item.type,zh.stem,zh.prompt,zh.instruction,item.metadata?.topic,item.metadata?.authorship?.createdByName,pathLabel(item.metadata?.knowledge?.taxonomyId,item.metadata?.knowledge?.primaryNodeId)].join(' ').toLowerCase().includes(query)});
    return clone(list.sort((a,b)=>String(a.id).localeCompare(String(b.id))));
  }
  function activityTitle(activity){const zh=activity?.content?.zh||{};return clean(zh.stem||zh.prompt||zh.instruction||activity?.metadata?.topic||activity?.id)||'未命名活动'}
  function saveActivity(activity,options={}){
    const schema=global.KGActivitySchemaV1;const record=ensureActivityMetadata(activity,{touch:options.touch!==false,status:options.status});const validation=schema?.validate?.(record)||{valid:true,errors:[],warnings:[]};
    if(!validation.valid)return {valid:false,errors:validation.errors,warnings:validation.warnings};
    const overrides=activityOverrides();overrides[record.id]=record;writeJson(ACTIVITY_OVERRIDE_KEY,overrides);return {valid:true,activity:clone(record),errors:[],warnings:validation.warnings};
  }
  function saveActivities(activities,options={}){const results=[];(activities||[]).forEach(activity=>results.push(saveActivity(activity,options)));return {valid:results.every(item=>item.valid),results}}
  function mapActivities(activityIds,mapping){
    const library=getActivityLibrary();const results=[];(activityIds||[]).forEach(id=>{const activity=library[id];if(!activity){results.push({valid:false,activityId:id,errors:['活动不存在。']});return}activity.metadata.knowledge={...activity.metadata.knowledge,...clone(mapping),relatedNodeIds:unique(mapping.relatedNodeIds||activity.metadata.knowledge.relatedNodeIds)};const taxonomy=taxonomyById(activity.metadata.knowledge.taxonomyId);activity.metadata.knowledge.taxonomyVersion=taxonomy?.version||activity.metadata.knowledge.taxonomyVersion||1;activity.metadata.knowledge.mappingStatus=activity.metadata.knowledge.primaryNodeId?'confirmed':'unmapped';activity.metadata.knowledge.pathSnapshot=activity.metadata.knowledge.primaryNodeId?pathForNode(activity.metadata.knowledge.taxonomyId,activity.metadata.knowledge.primaryNodeId).map(node=>node.title.zh):[];results.push({...saveActivity(activity,{touch:true}),activityId:id})});return {valid:results.every(item=>item.valid),results}
  }
  function importActivityPackage(payload,options={}){
    const schema=global.KGActivitySchemaV1;if(!schema)return {valid:false,errors:['Activity Schema v1 未加载。']};const existing=getActivityLibrary();const analysis=schema.analyzePackageMerge(existing,payload);if(!analysis.package)return analysis;
    const policy=clean(options.conflictPolicy)||'reject';const merged=schema.mergePackage(existing,payload,{conflictPolicy:policy});if(!merged.valid)return merged;
    const incomingIds=new Set(Object.keys(analysis.library||{}));const overrides=activityOverrides();Object.entries(merged.library).forEach(([id,activity])=>{if(incomingIds.has(id))overrides[id]=ensureActivityMetadata(activity,{touch:true,status:options.status||'submitted'})});writeJson(ACTIVITY_OVERRIDE_KEY,overrides);return {...merged,importedCount:incomingIds.size}
  }
  function exportActivityPackage(filters={},metadata={}){const library={};getActivities(filters).forEach(activity=>{library[activity.id]=activity});return global.KGActivitySchemaV1?.createPackage?.(library,{...metadata,author:metadata.author||currentUser().name})||null}
  function activityUsage(activityId){
    const drafts=getCourseDrafts();const releases=getCourseReleases();const usage=[];drafts.forEach(course=>(course.nodes||[]).forEach(node=>{if((node.activityIds||[]).includes(activityId))usage.push({courseId:course.id,courseName:course.name,nodeId:node.id,nodeTitle:node.title,source:'draft'})}));releases.forEach(release=>(release.course?.nodes||[]).forEach(node=>{if((node.activityIds||[]).includes(activityId))usage.push({courseId:release.course.id,courseName:release.course.name,nodeId:node.id,nodeTitle:node.title,source:'release',version:release.version})}));
    const guided=global.KGGuidedLearningData?.getCourse?.();(guided?.nodes||[]).forEach(node=>{if((node.activityIds||[]).includes(activityId))usage.push({courseId:guided.id,courseName:guided.title||guided.name,nodeId:node.id,nodeTitle:node.title,source:'built-in'})});return usage;
  }

  function normalizeCourse(course,index=0){
    const source=clone(course)||{};return {id:clean(source.id)||safeId('course'),name:clean(source.name||source.title)||'未命名课程',subjectId:clean(source.subjectId)||'subject-pmp',taxonomyId:clean(source.taxonomyId)||defaultTaxonomyForSubject(clean(source.subjectId)||'subject-pmp')?.id||'',status:clean(source.status)||'draft',description:clean(source.description),version:Math.max(1,Number(source.version)||1),updatedAt:clean(source.updatedAt)||nowIso(),stages:Array.isArray(source.stages)?source.stages.map((item,i)=>({id:clean(item.id)||safeId('stage'),title:clean(item.title||item.name)||`阶段 ${i+1}`,order:Number(item.order||i+1)})):[],parts:Array.isArray(source.parts)?source.parts.map((item,i)=>({id:clean(item.id)||safeId('part'),stageId:clean(item.stageId),title:clean(item.title||item.name)||`部分 ${i+1}`,order:Number(item.order||i+1)})):[],nodes:Array.isArray(source.nodes)?source.nodes.map((item,i)=>({id:clean(item.id)||safeId('node'),partId:clean(item.partId),title:clean(item.title||item.name)||`节点 ${i+1}`,order:Number(item.order||i+1),nodeType:clean(item.nodeType)||'standard',activityIds:unique(item.activityIds),description:clean(item.description),settings:clone(item.settings||{})})):[]};
  }
  function builtInCourseDraft(){
    const course=global.KGGuidedLearningData?.getCourse?.();if(!course)return null;return normalizeCourse({...course,id:'course-guided-pmp',name:course.title||'PMP 引导学习课程',subjectId:'subject-pmp',taxonomyId:'taxonomy-pmp-main',status:'draft',version:Number(course.version||13)});
  }
  function getCourseDrafts(){const stored=readJson(COURSE_DRAFT_KEY,[]);if(Array.isArray(stored)&&stored.length)return stored.map(normalizeCourse);const seed=builtInCourseDraft();return seed?[seed]:[]}
  function saveCourseDraft(course){const normalized=normalizeCourse({...course,status:'draft',updatedAt:nowIso()});const drafts=getCourseDrafts();const index=drafts.findIndex(item=>item.id===normalized.id);if(index>=0)drafts[index]=normalized;else drafts.push(normalized);writeJson(COURSE_DRAFT_KEY,drafts);return clone(normalized)}
  function deleteCourseDraft(courseId){const drafts=getCourseDrafts().filter(item=>item.id!==String(courseId));writeJson(COURSE_DRAFT_KEY,drafts);return drafts}
  function getCourseReleases(){const stored=readJson(COURSE_RELEASE_KEY,[]);return Array.isArray(stored)?clone(stored):[]}
  function validateCourse(course){
    const errors=[];const warnings=[];const c=normalizeCourse(course);const stageIds=new Set(c.stages.map(item=>item.id)),partIds=new Set(c.parts.map(item=>item.id)),nodeIds=new Set(),library=getActivityLibrary();
    if(!c.name)errors.push('课程名称不能为空。');if(!subjectById(c.subjectId))errors.push('课程 subjectId 不存在。');if(!taxonomyById(c.taxonomyId))errors.push('课程 taxonomyId 不存在。');
    c.parts.forEach(part=>{if(!stageIds.has(part.stageId))errors.push(`部分 ${part.title} 引用了不存在的阶段。`)});c.nodes.forEach(node=>{if(nodeIds.has(node.id))errors.push(`节点 ID 重复：${node.id}`);nodeIds.add(node.id);if(!partIds.has(node.partId))errors.push(`节点 ${node.title} 引用了不存在的部分。`);(node.activityIds||[]).forEach(id=>{if(!library[id])errors.push(`节点 ${node.title} 引用了不存在的活动：${id}`);else if(library[id].metadata?.subjectId!==c.subjectId)warnings.push(`活动 ${id} 与课程科目不一致。`)})});
    if(!c.nodes.length)warnings.push('课程还没有节点。');return {valid:errors.length===0,errors,warnings,course:c};
  }
  function publishCourse(courseId,notes=''){
    const course=getCourseDrafts().find(item=>item.id===String(courseId));if(!course)return {valid:false,errors:['没有找到课程草稿。']};const validation=validateCourse(course);if(!validation.valid)return validation;const releases=getCourseReleases();const previous=releases.filter(item=>item.course?.id===course.id).sort((a,b)=>b.version-a.version)[0];const release={id:safeId('release'),version:Number(previous?.version||0)+1,publishedAt:nowIso(),publishedBy:currentUser(),notes:clean(notes),contentHash:hashString(JSON.stringify(validation.course)),course:{...validation.course,status:'published',version:Number(previous?.version||0)+1}};releases.push(release);writeJson(COURSE_RELEASE_KEY,releases);writeJson(ACTIVE_COURSE_KEY,{courseId:course.id,releaseId:release.id});return {valid:true,release,warnings:validation.warnings,errors:[]}
  }
  function activeCourseRelease(){const pointer=readJson(ACTIVE_COURSE_KEY,null);return clone(getCourseReleases().find(item=>item.id===pointer?.releaseId)||null)}
  function courseKnowledgeCoverage(course){
    const library=getActivityLibrary();const coverage=new Map();(course?.nodes||[]).forEach(node=>(node.activityIds||[]).forEach(id=>{const knowledge=library[id]?.metadata?.knowledge;if(!knowledge?.primaryNodeId)return;const key=knowledge.primaryNodeId;if(!coverage.has(key))coverage.set(key,{nodeId:key,taxonomyId:knowledge.taxonomyId,path:pathLabel(knowledge.taxonomyId,key),activityIds:[]});coverage.get(key).activityIds.push(id)}));return [...coverage.values()].map(item=>({...item,activityIds:unique(item.activityIds),activityCount:unique(item.activityIds).length}))
  }

  global.KGLearningContent=Object.freeze({
    SCHEMA_VERSION,MAX_DEPTH,storageKeys:Object.freeze({SUBJECT_KEY,TAXONOMY_KEY,ACTIVITY_OVERRIDE_KEY,COURSE_DRAFT_KEY,COURSE_RELEASE_KEY,ACTIVE_COURSE_KEY}),
    getSubjects,subjectById,getTaxonomies,taxonomyById,defaultTaxonomyForSubject,nodesForTaxonomy,nodeById,childrenOf,pathForNode,pathLabel,descendantIds,searchNodes,validateTaxonomy,saveSubjects,saveTaxonomies,resetTaxonomies,saveKnowledgeNode,deprecateKnowledgeNode,deleteKnowledgeNode,
    currentUser,ensureActivityMetadata,getActivityLibrary,getActivities,activityTitle,saveActivity,saveActivities,mapActivities,importActivityPackage,exportActivityPackage,activityUsage,
    getCourseDrafts,saveCourseDraft,deleteCourseDraft,getCourseReleases,validateCourse,publishCourse,activeCourseRelease,courseKnowledgeCoverage,normalizeCourse,safeId,clone
  });
})(window);
