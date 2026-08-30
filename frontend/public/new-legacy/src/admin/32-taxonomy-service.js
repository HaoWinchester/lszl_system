'use strict';
(function(global){
  const Core=global.KGAdminCore;
  class TaxonomyService{
    constructor(options={}){this.legacy=options.legacy;this.repository=options.repository;this.transactions=options.transactions;this.permissions=options.permissions;this.audit=options.audit;this.references=options.references}
    list(subjectId=''){return this.legacy.getTaxonomies(subjectId)}
    get(taxonomyId){return this.legacy.taxonomyById(taxonomyId)}
    defaultForSubject(subjectId){return this.legacy.defaultTaxonomyForSubject(subjectId)}
    currentForSubject(subjectId){const subject=this.legacy.subjectById(subjectId),rows=this.list(subject?.id||subjectId);return rows.find(item=>item.status==='published'&&item.id===subject?.defaultTaxonomyId)||rows.find(item=>item.status==='published'&&item.isDefault)||rows.find(item=>item.status==='published')||null}
    isCurrent(taxonomyOrId){const item=typeof taxonomyOrId==='string'?this.get(taxonomyOrId):taxonomyOrId;if(!item)return false;const subject=this.legacy.subjectById(item.subjectId);return item.id===subject?.defaultTaxonomyId||item.isDefault===true||item.id===this.currentForSubject(item.subjectId)?.id}
    nodes(taxonomyId,options={}){return this.legacy.nodesForTaxonomy(taxonomyId,options)}
    validate(taxonomy){return this.legacy.validateTaxonomy(taxonomy)}
    versionLabel(version){return `v${Math.max(1,Number(version)||1)}.0`}
    statusLabel(status){return ({draft:'草稿',published:'已发布',archived:'已归档',deprecated:'已停用'})[Core.clean(status)]||Core.clean(status)||'未知'}
    nextVersion(subjectId){const versions=this.list(subjectId).map(item=>Math.max(1,Number(item.version)||1));return versions.length?Math.max(...versions)+1:1}
    uniqueTaxonomyId(baseId,version){const cleanBase=Core.clean(baseId)||'taxonomy-import';let candidate=version<=1?cleanBase:`${cleanBase.replace(/-v\d+(?:-\d+)?$/,'')}-v${version}`,suffix=2;while(this.get(candidate))candidate=`${cleanBase.replace(/-v\d+(?:-\d+)?$/,'')}-v${version}-${suffix++}`;return candidate}
    editMode(taxonomyOrId){const item=typeof taxonomyOrId==='string'?this.get(taxonomyOrId):taxonomyOrId;if(!item)return '';if(item.status==='draft')return 'draft';if(item.status==='published'&&this.isCurrent(item))return 'current';return ''}
    canEdit(taxonomyOrId){return !!this.editMode(taxonomyOrId)&&this.permissions.can('editTaxonomies')}
    editableCheck(taxonomyOrId){const item=typeof taxonomyOrId==='string'?this.get(taxonomyOrId):taxonomyOrId;if(!item)return {valid:false,errors:['知识树不存在。']};const permission=this.permissions?.require?.('editTaxonomies')||{valid:true};if(!permission.valid)return permission;const mode=this.editMode(item);if(!mode)return {valid:false,errors:['只有当前知识树或草稿可以编辑；历史已发布和归档版本保持只读。']};return {valid:true,taxonomy:item,mode,errors:[]}}
    usage(taxonomyId){return this.references?.referencesForTaxonomy?.(taxonomyId)||[]}
    nodeUsage(taxonomyId,nodeId){const library=Object.values(this.legacy.getActivityLibrary?.()||{}),direct=[];library.forEach(activity=>{const knowledge=activity.metadata?.knowledge||{};if(knowledge.taxonomyId!==taxonomyId)return;if(knowledge.primaryNodeId===nodeId)direct.push({kind:'activity',relation:'primary',id:activity.id,title:this.legacy.activityTitle?.(activity)||activity.id});else if((knowledge.relatedNodeIds||[]).includes(nodeId))direct.push({kind:'activity',relation:'related',id:activity.id,title:this.legacy.activityTitle?.(activity)||activity.id})});const references=this.references?.referencesForNode?.(nodeId)||[],formal=references.filter(item=>item.kind==='question').map(item=>({kind:'question',relation:'primary',id:item.id,title:item.title,bankId:item.bankId,questionId:item.questionId})),directItems=[...direct,...formal];return {directActivityCount:directItems.length,directActivities:Core.clone(directItems),formalQuestionCount:formal.length,referenceCount:references.length,references:Core.clone(references)}}
    normalizeImportPayload(payload,options={}){let taxonomies=[];if(Array.isArray(payload?.taxonomies))taxonomies=payload.taxonomies;else if(payload?.taxonomy)taxonomies=[payload.taxonomy];else if(payload&&typeof payload==='object')taxonomies=[payload];const source=taxonomies[0]?Core.clone(taxonomies[0]):null;if(!source)return {valid:false,errors:['导入文件中没有知识树。']};const subjectId=Core.clean(options.subjectId||source.subjectId||payload?.subjectId||payload?.subject?.id);if(!subjectId||!this.legacy.subjectById(subjectId))return {valid:false,errors:['导入知识树缺少有效 subjectId。']};source.subjectId=subjectId;source.nodes=Array.isArray(source.nodes)?source.nodes:[];return {valid:true,source,subjectId}}
    async importVersion(payload,options={}){
      const parsed=this.normalizeImportPayload(payload,options);if(!parsed.valid)return parsed;
      const existing=this.list(parsed.subjectId),version=existing.length?this.nextVersion(parsed.subjectId):1,id=this.uniqueTaxonomyId(parsed.source.id||`taxonomy-${parsed.subjectId.replace(/^subject-/,'')}`,version),now=Core.nowIso(),actor=Core.actor();
      const imported={...parsed.source,id,subjectId:parsed.subjectId,version,versionLabel:this.versionLabel(version),maxDepth:Number(this.legacy.MAX_DEPTH)||9,status:'draft',isDefault:false,createdAt:now,updatedAt:now,createdBy:actor,source:{type:'import',fileName:Core.clean(options.fileName),importedAt:now}};
      imported.nodes=(imported.nodes||[]).map((node,index)=>({...Core.clone(node),taxonomyId:id,sortOrder:Number(node.sortOrder||index+1)}));
      const validation=this.validate(imported);if(!validation.valid)return validation;
      const all=this.list(),tx=await this.transactions.executeAsync({name:'导入知识树版本',action:'taxonomy.import',entityType:'taxonomy',entityId:id,permission:'importTaxonomies',keys:['taxonomies'],validate:()=>validation,commit:async()=>{const saved=await this.legacy.saveTaxonomies([...all,imported]);if(!saved.valid)return saved;const record={id:`taxonomy-import-${id}`,importedAt:now,importedBy:actor,fileName:Core.clean(options.fileName),subjectId:parsed.subjectId,taxonomyId:id,version,versionLabel:this.versionLabel(version),nodeCount:imported.nodes.length,result:'success',derivedFromTaxonomy:true};return {valid:true,taxonomy:this.get(id),importRecord:record}},metadata:{subjectId:parsed.subjectId,version,nodeCount:imported.nodes.length,fileName:Core.clean(options.fileName)}});
      if(tx.valid)this.references?.invalidate();
      return tx.valid?{valid:true,taxonomy:tx.value.taxonomy,importRecord:tx.value.importRecord,transactionId:tx.transactionId,errors:[],warnings:validation.warnings||[]}:{valid:false,errors:tx.errors||[]};
    }
    publishCheck(taxonomyId){const taxonomy=this.get(taxonomyId);if(!taxonomy)return {valid:false,errors:['知识树不存在。'],warnings:[]};const base=this.validate(taxonomy),errors=[...(base.errors||[])],warnings=[...(base.warnings||[])],nodes=Array.isArray(taxonomy.nodes)?taxonomy.nodes:[],active=nodes.filter(item=>item.status!=='deprecated');if(!nodes.length)errors.push('空知识树不能发布。');if(nodes.length&&!active.length)errors.push('知识树没有可用节点，不能发布。');const roots=active.filter(item=>!item.parentId);if(active.length&&!roots.length)errors.push('知识树缺少一级根节点。');if(roots.length>1)warnings.push(`知识树包含 ${roots.length} 个一级根节点，请确认这是预期结构。`);const maxLevel=Math.max(0,...nodes.map(item=>Number(item.level)||0));if(maxLevel>9)errors.push('知识树最多支持 9 层。');return {valid:errors.length===0,errors:[...new Set(errors)],warnings:[...new Set(warnings)],taxonomy,maxLevel,nodeCount:nodes.length}}
    async publish(taxonomyId,options={}){
      const check=this.publishCheck(taxonomyId);if(!check.valid)return check;
      const source=check.taxonomy,now=Core.nowIso(),actor=Core.actor(),current=this.currentForSubject(source.subjectId),releaseType=source.status==='draft'?'publish':'activate',notes=Core.clean(options.notes);
      const tx=await this.transactions.executeAsync({name:releaseType==='publish'?'发布知识树为当前':'切换当前知识树',action:releaseType==='publish'?'taxonomy.publish':'taxonomy.activate',entityType:'taxonomy',entityId:taxonomyId,permission:'publishTaxonomies',keys:['subjects','taxonomies','taxonomyReleases'],validate:()=>check,commit:async()=>{
        const taxonomies=this.list().map(item=>{if(item.subjectId!==source.subjectId)return item;if(item.id===taxonomyId)return {...item,status:'published',isDefault:true,maxDepth:Number(this.legacy.MAX_DEPTH)||9,publishedAt:item.publishedAt||now,activatedAt:now,publishedBy:item.publishedBy||actor,activatedBy:actor,releaseNotes:notes||item.releaseNotes||'',archivedAt:'',archivedBy:null,updatedAt:now};return {...item,isDefault:false}});
        const subjects=this.legacy.getSubjects().map(item=>item.id===source.subjectId?{...item,defaultTaxonomyId:taxonomyId}:item);await global.KGTeachingContentApi.saveCatalog({taxonomies,subjects});
        const record={id:`taxonomy-release-${taxonomyId}-${releaseType}`,action:releaseType,subjectId:source.subjectId,taxonomyId,version:Number(source.version)||1,versionLabel:source.versionLabel||this.versionLabel(source.version),previousTaxonomyId:current?.id||'',at:now,actor,notes,nodeCount:check.nodeCount,maxLevel:check.maxLevel,contentHash:Core.hash(JSON.stringify(source)),derivedFromTaxonomy:true};return {valid:true,taxonomy:this.get(taxonomyId),record};
      },metadata:{subjectId:source.subjectId,version:source.version,previousTaxonomyId:current?.id||'',releaseType,nodeCount:check.nodeCount,maxLevel:check.maxLevel}});
      if(tx.valid)this.references?.invalidate();
      return tx.valid?{valid:true,taxonomy:tx.value.taxonomy,record:tx.value.record,transactionId:tx.transactionId,errors:[],warnings:check.warnings||[]}:{valid:false,errors:tx.errors||[]};
    }
    async createDraftFrom(taxonomyId){const source=this.get(taxonomyId);if(!source)return {valid:false,errors:['知识树不存在。']};const version=this.nextVersion(source.subjectId),id=this.uniqueTaxonomyId(source.id,version),now=Core.nowIso(),actor=Core.actor(),draft={...Core.clone(source),id,version,versionLabel:this.versionLabel(version),status:'draft',isDefault:false,maxDepth:Number(this.legacy.MAX_DEPTH)||9,createdAt:now,updatedAt:now,createdBy:actor,publishedAt:'',activatedAt:'',publishedBy:null,activatedBy:null,releaseNotes:'',archivedAt:'',archivedBy:null,source:{type:'copy',sourceTaxonomyId:source.id,sourceVersion:source.version,copiedAt:now}};draft.nodes=(draft.nodes||[]).map(item=>({...item,taxonomyId:id}));const validation=this.validate(draft);if(!validation.valid)return validation;const tx=await this.transactions.executeAsync({name:'基于版本创建知识树草稿',action:'taxonomy.draft.create',entityType:'taxonomy',entityId:id,permission:'editTaxonomies',keys:['taxonomies'],validate:()=>validation,commit:async()=>{const saved=await this.legacy.saveTaxonomies([...this.list(),draft]);return saved.valid?{valid:true,taxonomy:this.get(id)}:saved},metadata:{subjectId:source.subjectId,sourceTaxonomyId:source.id,version}});if(tx.valid)this.references?.invalidate();return tx.valid?{valid:true,taxonomy:tx.value.taxonomy,transactionId:tx.transactionId,errors:[],warnings:validation.warnings||[]}:{valid:false,errors:tx.errors||[]}}
    deletionCheck(taxonomyId){
      const permission=this.permissions?.require?.('deleteTaxonomies')||{valid:true};if(!permission.valid)return {...permission,references:[],referenceCount:0};
      const taxonomy=this.get(taxonomyId);if(!taxonomy)return {valid:false,errors:['知识树不存在。'],references:[],referenceCount:0};
      const authority=global.KGReferenceIndexService.permanentDeleteAuthority(this.references);if(!authority.valid)return {...authority,taxonomy,references:[],referenceCount:0};
      const references=this.usage(taxonomyId),errors=[];
      if(this.isCurrent(taxonomy))errors.push('当前使用的知识树不能删除。请先将其他版本设为当前。');
      if(taxonomy.status==='published')errors.push('历史已发布版本需要先归档，再执行永久删除。');
      if(!['draft','archived'].includes(taxonomy.status))errors.push(`状态为“${this.statusLabel(taxonomy.status)}”的知识树不能直接删除。`);
      if(references.length)errors.push(`该知识树仍被 ${references.length} 项内容直接引用，请先迁移或解除引用。`);
      return {valid:errors.length===0,errors:[...new Set(errors)],warnings:[],taxonomy,references,referenceCount:references.length,requiresArchive:taxonomy.status==='published',isCurrent:this.isCurrent(taxonomy)};
    }
    async archive(taxonomyId,options={}){
      const permission=this.permissions?.require?.('deleteTaxonomies')||{valid:true};if(!permission.valid)return permission;
      const source=this.get(taxonomyId);if(!source)return {valid:false,errors:['知识树不存在。']};
      if(this.isCurrent(source))return {valid:false,errors:['当前使用的知识树不能归档。请先将其他版本设为当前。']};
      if(source.status!=='published')return {valid:false,errors:['只有历史已发布版本可以归档。草稿可以直接删除。']};
      const now=Core.nowIso(),actor=Core.actor(),notes=Core.clean(options.notes);
      const tx=await this.transactions.executeAsync({name:'归档历史知识树',action:'taxonomy.archive',entityType:'taxonomy',entityId:taxonomyId,permission:'deleteTaxonomies',keys:['taxonomies','taxonomyReleases'],commit:async()=>{
        const rows=this.list().map(item=>item.id===taxonomyId?{...item,status:'archived',isDefault:false,archivedAt:now,archivedBy:actor,archiveNotes:notes,updatedAt:now}:item),saved=await this.legacy.saveTaxonomies(rows);if(!saved.valid)return saved;
        const record={id:`taxonomy-release-${taxonomyId}-archive`,action:'archive',subjectId:source.subjectId,taxonomyId,version:Number(source.version)||1,versionLabel:source.versionLabel||this.versionLabel(source.version),previousTaxonomyId:'',at:now,actor,notes,nodeCount:(source.nodes||[]).length,maxLevel:Math.max(0,...(source.nodes||[]).map(item=>Number(item.level)||0)),contentHash:Core.hash(JSON.stringify(source)),derivedFromTaxonomy:true};return {valid:true,taxonomy:this.get(taxonomyId),record};
      },metadata:{subjectId:source.subjectId,version:source.version,referenceCount:this.usage(taxonomyId).length}});
      if(tx.valid)this.references?.invalidate();
      return tx.valid?{valid:true,taxonomy:tx.value.taxonomy,record:tx.value.record,transactionId:tx.transactionId,errors:[]}:{valid:false,errors:tx.errors||[]};
    }
    async restoreArchived(taxonomyId){
      const permission=this.permissions?.require?.('deleteTaxonomies')||{valid:true};if(!permission.valid)return permission;
      const source=this.get(taxonomyId);if(!source)return {valid:false,errors:['知识树不存在。']};
      if(source.status!=='archived')return {valid:false,errors:['只有已归档知识树可以恢复。']};
      const now=Core.nowIso(),actor=Core.actor();
      const tx=await this.transactions.executeAsync({name:'恢复归档知识树',action:'taxonomy.archive.restore',entityType:'taxonomy',entityId:taxonomyId,permission:'deleteTaxonomies',keys:['taxonomies','taxonomyReleases'],commit:async()=>{
        const rows=this.list().map(item=>item.id===taxonomyId?{...item,status:'published',isDefault:false,restoredAt:now,restoredBy:actor,updatedAt:now}:item),saved=await this.legacy.saveTaxonomies(rows);if(!saved.valid)return saved;
        const record={id:`taxonomy-release-${taxonomyId}-restore`,action:'restore',subjectId:source.subjectId,taxonomyId,version:Number(source.version)||1,versionLabel:source.versionLabel||this.versionLabel(source.version),previousTaxonomyId:'',at:now,actor,notes:'',nodeCount:(source.nodes||[]).length,maxLevel:Math.max(0,...(source.nodes||[]).map(item=>Number(item.level)||0)),contentHash:Core.hash(JSON.stringify(source)),derivedFromTaxonomy:true};return {valid:true,taxonomy:this.get(taxonomyId),record};
      },metadata:{subjectId:source.subjectId,version:source.version}});
      if(tx.valid)this.references?.invalidate();
      return tx.valid?{valid:true,taxonomy:tx.value.taxonomy,record:tx.value.record,transactionId:tx.transactionId,errors:[]}:{valid:false,errors:tx.errors||[]};
    }
    async deleteVersion(taxonomyId,options={}){
      const check=this.deletionCheck(taxonomyId);if(!check.valid)return check;
      const source=check.taxonomy,now=Core.nowIso(),actor=Core.actor(),notes=Core.clean(options.notes);
      const tx=await this.transactions.executeAsync({name:source.status==='draft'?'删除知识树草稿':'永久删除归档知识树',action:'taxonomy.delete',entityType:'taxonomy',entityId:taxonomyId,permission:'deleteTaxonomies',keys:['taxonomies','taxonomyDeletions'],validate:()=>this.deletionCheck(taxonomyId),commit:async()=>{
        const saved=await this.legacy.saveTaxonomies(this.list().filter(item=>item.id!==taxonomyId));if(!saved.valid)return saved;
        const record={id:`taxonomy-deletion-${source.id}`,deletedAt:now,deletedBy:actor,subjectId:source.subjectId,taxonomyId:source.id,name:Core.clone(source.name||{}),version:Number(source.version)||1,versionLabel:source.versionLabel||this.versionLabel(source.version),previousStatus:source.status,nodeCount:(source.nodes||[]).length,notes,contentHash:Core.hash(JSON.stringify(source)),persisted:false};return {valid:true,record};
      },metadata:{subjectId:source.subjectId,version:source.version,status:source.status,nodeCount:(source.nodes||[]).length}});
      if(tx.valid)this.references?.invalidate();
      return tx.valid?{valid:true,deletedTaxonomyId:taxonomyId,record:tx.value.record,transactionId:tx.transactionId,errors:[]}:{valid:false,errors:tx.errors||[]};
    }
    async saveAll(taxonomies){
      const current=this.list(),existingById=new Map(current.map(item=>[item.id,item])),incoming=Array.isArray(taxonomies)?taxonomies:[];
      const tx=await this.transactions.executeAsync({name:'保存知识树',action:'taxonomy.save',entityType:'taxonomy',permission:'editTaxonomies',keys:['taxonomies'],validate:()=>{
        const errors=[],incomingIds=new Set(incoming.map(item=>item?.id)),currentIds=new Set(current.map(item=>item.id)),removed=current.filter(item=>!incomingIds.has(item.id));if(incomingIds.size!==incoming.length)errors.push('知识树 ID 不能重复。');if(incoming.length!==current.length||incomingIds.size!==currentIds.size||[...currentIds].some(id=>!incomingIds.has(id)))errors.push('知识树整体恢复不能新增或删除版本。');if(removed.length){const authority=global.KGReferenceIndexService.permanentDeleteAuthority(this.references);if(!authority.valid)errors.push(...(authority.errors||['永久删除知识树已暂停。']))}
        incoming.forEach(item=>{const before=existingById.get(item.id),check=this.validate(item);check.errors.forEach(message=>errors.push(`${item.id||'未命名知识树'}：${message}`));if(!before){errors.push(`知识树版本不存在：${item.id}`);return}if(before.subjectId!==item.subjectId||Number(before.version)!==Number(item.version)||before.status!==item.status||!!before.isDefault!==!!item.isDefault)errors.push(`${item.id} 的版本身份和生命周期状态不能通过日常编辑修改。`);if(JSON.stringify(before)!==JSON.stringify(item)&&!this.editMode(before))errors.push(`${item.id} 是历史版本，只能查看。`);const incomingNodeIds=new Set((item.nodes||[]).map(node=>node.id)),removedNodes=(before.nodes||[]).filter(node=>!incomingNodeIds.has(node.id));if(removedNodes.length){const authority=global.KGReferenceIndexService.permanentDeleteAuthority(this.references);if(!authority.valid)errors.push(...(authority.errors||['永久删除知识点已暂停。']))} });
        return {valid:errors.length===0,errors:[...new Set(errors)]};
      },commit:()=>this.legacy.saveTaxonomies(incoming),metadata:{count:incoming.length,editableCurrentIds:current.filter(item=>this.editMode(item)==='current').map(item=>item.id)}});
      if(tx.valid)this.references?.invalidate();return tx.valid?{...tx.value,transactionId:tx.transactionId,snapshotId:tx.snapshotId}:{valid:false,errors:tx.errors||[]}
    }
    async reconcileAuthenticatedServerProjection(subjectId,taxonomy){
      const subject=this.legacy.subjectById(subjectId);if(!subject)return {valid:false,errors:['服务器知识树对应的科目不存在。']};
      const candidate=Core.clone(taxonomy||{});candidate.subjectId=Core.clean(candidate.subjectId);candidate.id=Core.clean(candidate.id);
      if(candidate.subjectId!==subject.id)return {valid:false,errors:['服务器知识树的科目身份与请求不一致。']};
      const validation=this.validate(candidate);if(!validation.valid)return {valid:false,errors:validation.errors||['服务器知识树校验失败。']};
      const beforeTaxonomies=this.list(),beforeSubjects=this.legacy.getSubjects(),current=this.currentForSubject(subject.id),defaultProjectionId=`taxonomy-${Core.clean(subject.code).toLowerCase()}-main`,existing=this.get(candidate.id);
      if(existing&&existing.id!==current?.id&&(existing.status!=='published'||existing.isDefault!==true))return {valid:false,errors:['服务器知识树 ID 与本地草稿或历史版本冲突，未替换本地内容。']};
      const removableProjectionId=current?.id===defaultProjectionId&&current.id!==candidate.id?current.id:'';
      const next=beforeTaxonomies
        .filter(item=>item.id!==candidate.id&&item.id!==removableProjectionId)
        .map(item=>item.subjectId===subject.id?{...item,isDefault:false}:item);
      next.push({...candidate,status:'published',isDefault:true});
      const nextSubjects=beforeSubjects.map(item=>item.id===subject.id?{...item,defaultTaxonomyId:candidate.id}:item);
      try{
        await global.KGTeachingContentApi.saveCatalog({taxonomies:next,subjects:nextSubjects});
      }catch(error){return {valid:false,errors:[`服务器知识树投影保存失败：${error?.message||'未知错误'}`]}}
      this.references?.invalidate();return {valid:true,taxonomy:this.get(candidate.id),errors:[]};
    }
    async saveNode(taxonomyId,node){
      const editable=this.editableCheck(taxonomyId);if(!editable.valid)return editable;const taxonomy=editable.taxonomy,existing=node?.id?this.legacy.nodeById?.(taxonomyId,node.id):null,parentId=node?.parentId?Core.clean(node.parentId):null,parent=parentId?this.legacy.nodeById?.(taxonomyId,parentId):null;
      if(parent&&parent.status==='deprecated')return {valid:false,errors:['不能将知识点移动到已停用节点下。请先恢复父节点。']};
      const requestedStatus=Core.clean(node?.status||existing?.status||'active');if(!['active','deprecated'].includes(requestedStatus))return {valid:false,errors:['知识点仅支持启用或停用状态。']};
      if(existing&&node?.status==='deprecated'&&existing.status!=='deprecated')return this.deprecateNode(taxonomyId,existing.id,node.replacedByNodeIds||[],node);
      if(existing&&node?.status==='active'&&existing.status==='deprecated')return this.restoreNode(taxonomyId,existing.id,node);
      const actor=Core.actor(),now=Core.nowIso(),requested={...Core.clone(node||{}),id:existing?.id||Core.clean(node?.id)||Core.safeId('knowledge'),updatedAt:now,updatedBy:actor};if(existing&&(existing.parentId||null)!==(requested.parentId||null)&&Number(requested.sortOrder)===Number(existing.sortOrder))delete requested.sortOrder;if(!existing){requested.createdAt=now;requested.createdBy=actor}
      const action=existing?'taxonomy.node.update':'taxonomy.node.create',name=existing?'编辑知识点':'新增知识点';
      const tx=await this.transactions.executeAsync({name,action,entityType:'knowledge-node',entityId:requested.id||'',permission:'editTaxonomies',keys:['taxonomies'],validate:()=>this.editableCheck(taxonomyId),commit:()=>this.legacy.saveKnowledgeNode(taxonomyId,requested),metadata:{taxonomyId,subjectId:taxonomy.subjectId,mode:editable.mode,before:Core.clone(existing),after:Core.clone(requested)}});
      if(tx.valid)this.references?.invalidate();return tx.valid?{...tx.value,transactionId:tx.transactionId,snapshotId:tx.snapshotId}:{valid:false,errors:tx.errors||[]}
    }
    async deprecateNode(taxonomyId,nodeId,replacedByNodeIds=[],patch={}){
      const editable=this.editableCheck(taxonomyId);if(!editable.valid)return editable;const taxonomy=editable.taxonomy,node=this.legacy.nodeById?.(taxonomyId,nodeId);if(!node)return {valid:false,errors:['知识点不存在。']};if(node.status==='deprecated')return {valid:true,node,errors:[],warnings:['知识点已经停用。']};
      const children=(taxonomy.nodes||[]).filter(item=>item.parentId===nodeId&&item.status!=='deprecated');if(children.length)return {valid:false,errors:[`该知识点下还有 ${children.length} 个启用的子节点，请先移动或停用子节点。`]};
      const actor=Core.actor(),now=Core.nowIso(),usage=this.nodeUsage(taxonomyId,nodeId),after={...node,...Core.clone(patch||{}),id:node.id,status:'deprecated',replacedByNodeIds:Core.unique(replacedByNodeIds),deactivatedAt:now,deactivatedBy:actor,updatedAt:now,updatedBy:actor};
      const tx=await this.transactions.executeAsync({name:'停用知识点',action:'taxonomy.node.deprecate',entityType:'knowledge-node',entityId:nodeId,permission:'editTaxonomies',keys:['taxonomies'],validate:()=>this.editableCheck(taxonomyId),commit:()=>this.legacy.saveKnowledgeNode(taxonomyId,after),metadata:{taxonomyId,subjectId:taxonomy.subjectId,mode:editable.mode,before:Core.clone(node),after:Core.clone(after),directActivityCount:usage.directActivityCount,referenceCount:usage.referenceCount}});
      if(tx.valid)this.references?.invalidate();return tx.valid?{...tx.value,transactionId:tx.transactionId,snapshotId:tx.snapshotId,usage}:{valid:false,errors:tx.errors||[]}
    }
    async restoreNode(taxonomyId,nodeId,patch={}){
      const editable=this.editableCheck(taxonomyId);if(!editable.valid)return editable;const taxonomy=editable.taxonomy,node=this.legacy.nodeById?.(taxonomyId,nodeId);if(!node)return {valid:false,errors:['知识点不存在。']};if(node.status!=='deprecated')return {valid:false,errors:['只有已停用知识点可以恢复。']};const parent=node.parentId?this.legacy.nodeById?.(taxonomyId,node.parentId):null;if(parent?.status==='deprecated')return {valid:false,errors:['父知识点仍处于停用状态，请先恢复父节点。']};
      const actor=Core.actor(),now=Core.nowIso(),after={...node,...Core.clone(patch||{}),id:node.id,parentId:patch?.parentId??node.parentId,status:'active',reactivatedAt:now,reactivatedBy:actor,updatedAt:now,updatedBy:actor};
      const tx=await this.transactions.executeAsync({name:'恢复知识点',action:'taxonomy.node.restore',entityType:'knowledge-node',entityId:nodeId,permission:'editTaxonomies',keys:['taxonomies'],validate:()=>this.editableCheck(taxonomyId),commit:()=>this.legacy.saveKnowledgeNode(taxonomyId,after),metadata:{taxonomyId,subjectId:taxonomy.subjectId,mode:editable.mode,before:Core.clone(node),after:Core.clone(after)}});
      if(tx.valid)this.references?.invalidate();return tx.valid?{...tx.value,transactionId:tx.transactionId,snapshotId:tx.snapshotId}:{valid:false,errors:tx.errors||[]}
    }
    async reorderNode(taxonomyId,nodeId,direction){
      const editable=this.editableCheck(taxonomyId);if(!editable.valid)return editable;const taxonomy=editable.taxonomy,nodes=Core.clone(taxonomy.nodes||[]),node=nodes.find(item=>item.id===nodeId);if(!node)return {valid:false,errors:['知识点不存在。']};const siblings=nodes.filter(item=>(item.parentId||null)===(node.parentId||null)).sort((a,b)=>Number(a.sortOrder)-Number(b.sortOrder)||String(a.title?.zh||'').localeCompare(String(b.title?.zh||''),'zh-CN')),index=siblings.findIndex(item=>item.id===nodeId),targetIndex=direction==='up'?index-1:direction==='down'?index+1:-1;if(targetIndex<0||targetIndex>=siblings.length)return {valid:false,errors:[direction==='up'?'知识点已经位于最前。':'知识点已经位于最后。']};
      const beforeNode=Core.clone(node),beforeTarget=Core.clone(siblings[targetIndex]);siblings.forEach((item,position)=>{item.sortOrder=(position+1)*10});const target=siblings[targetIndex],actor=Core.actor(),now=Core.nowIso(),nodeOrder=Number(node.sortOrder),targetOrder=Number(target.sortOrder);node.sortOrder=targetOrder;target.sortOrder=nodeOrder;node.updatedAt=now;node.updatedBy=actor;target.updatedAt=now;target.updatedBy=actor;const updated={...taxonomy,nodes,updatedAt:now,updatedBy:actor,lastMaintainedAt:now,lastMaintainedBy:actor,maintenanceRevision:Math.max(0,Number(taxonomy.maintenanceRevision)||0)+1};
      const tx=await this.transactions.executeAsync({name:direction==='up'?'知识点上移':'知识点下移',action:'taxonomy.node.reorder',entityType:'knowledge-node',entityId:nodeId,permission:'editTaxonomies',keys:['taxonomies'],validate:()=>{const check=this.editableCheck(taxonomyId);if(!check.valid)return check;return this.validate(updated)},commit:()=>this.legacy.saveTaxonomies(this.list().map(item=>item.id===taxonomyId?updated:item)),metadata:{taxonomyId,subjectId:taxonomy.subjectId,mode:editable.mode,direction,before:{node:beforeNode,target:beforeTarget},after:{node:Core.clone(node),target:Core.clone(target)}}});
      if(tx.valid)this.references?.invalidate();return tx.valid?{valid:true,node:this.legacy.nodeById(taxonomyId,nodeId),transactionId:tx.transactionId,snapshotId:tx.snapshotId,errors:[]}:{valid:false,errors:tx.errors||[]}
    }
    nodeDeletionCheck(taxonomyId,nodeId){
      const editable=this.editableCheck(taxonomyId);if(!editable.valid)return {...editable,children:[],usage:{directActivityCount:0,directActivities:[],referenceCount:0,references:[]}};const taxonomy=editable.taxonomy,node=this.legacy.nodeById?.(taxonomyId,nodeId);if(!node)return {valid:false,errors:['知识点不存在。'],children:[],usage:{directActivityCount:0,directActivities:[],referenceCount:0,references:[]}};const authority=global.KGReferenceIndexService.permanentDeleteAuthority(this.references);if(!authority.valid)return {...authority,children:[],usage:{directActivityCount:0,directActivities:[],referenceCount:0,references:[]},node,taxonomy,mode:editable.mode,recommendDeprecate:true};const children=(taxonomy.nodes||[]).filter(item=>item.parentId===nodeId),usage=this.nodeUsage(taxonomyId,nodeId),errors=[];if(children.length)errors.push(`该知识点下还有 ${children.length} 个子节点，请先处理子节点。`);if(usage.directActivityCount)errors.push(`该知识点仍关联 ${usage.directActivityCount} 道题目，请先移动题目或设为待分类；历史使用节点建议停用。`);return {valid:errors.length===0,errors,children:Core.clone(children),usage,node,taxonomy,mode:editable.mode,recommendDeprecate:usage.directActivityCount>0||node.status==='active'}
    }
    async deleteNode(taxonomyId,nodeId,options={}){
      const check=this.nodeDeletionCheck(taxonomyId,nodeId);if(!check.valid)return check;const node=check.node,actor=Core.actor(),now=Core.nowIso();
      const tx=await this.transactions.executeAsync({name:'删除空知识点',action:'taxonomy.node.delete',entityType:'knowledge-node',entityId:nodeId,permission:'editTaxonomies',keys:['taxonomies'],validate:()=>this.nodeDeletionCheck(taxonomyId,nodeId),commit:()=>this.legacy.deleteKnowledgeNode(taxonomyId,nodeId,{cascade:false}),metadata:{taxonomyId,subjectId:check.taxonomy.subjectId,mode:check.mode,before:Core.clone(node),after:null,deletedAt:now,deletedBy:actor,cascadeRequested:!!options.cascade}});
      if(tx.valid)this.references?.invalidate();return tx.valid?{...tx.value,transactionId:tx.transactionId,snapshotId:tx.snapshotId}:{valid:false,errors:tx.errors||[]}
    }
    async resetAll(){const authority=global.KGReferenceIndexService.permanentDeleteAuthority(this.references);if(!authority.valid)return authority;const result=await this.legacy.resetTaxonomies();this.references?.invalidate();return {valid:true,...result,errors:[]}}
    importRecords(){return Core.clone(this.list().filter(item=>item.source?.type==='import').map(item=>({id:`taxonomy-import-${item.id}`,importedAt:item.source.importedAt||item.createdAt||'',importedBy:item.createdBy||null,fileName:item.source.fileName||'',subjectId:item.subjectId,taxonomyId:item.id,version:Number(item.version)||1,versionLabel:item.versionLabel||this.versionLabel(item.version),nodeCount:(item.nodes||[]).length,result:'success',derivedFromTaxonomy:true})).sort((a,b)=>String(b.importedAt).localeCompare(String(a.importedAt))))}
    releaseRecords(subjectId=''){const rows=[];(subjectId?this.list(subjectId):this.list()).forEach(item=>{const common={subjectId:item.subjectId,taxonomyId:item.id,version:Number(item.version)||1,versionLabel:item.versionLabel||this.versionLabel(item.version),nodeCount:(item.nodes||[]).length,maxLevel:Math.max(0,...(item.nodes||[]).map(node=>Number(node.level)||0)),notes:item.releaseNotes||item.archiveNotes||'',contentHash:Core.hash(JSON.stringify(item)),derivedFromTaxonomy:true};if(item.publishedAt)rows.push({...common,id:`taxonomy-release-${item.id}-publish`,action:'publish',at:item.publishedAt,actor:item.publishedBy||item.createdBy||null});if(item.activatedAt&&item.activatedAt!==item.publishedAt)rows.push({...common,id:`taxonomy-release-${item.id}-activate`,action:'activate',at:item.activatedAt,actor:item.activatedBy||item.publishedBy||null});if(item.archivedAt)rows.push({...common,id:`taxonomy-release-${item.id}-archive`,action:'archive',at:item.archivedAt,actor:item.archivedBy||null});if(item.restoredAt)rows.push({...common,id:`taxonomy-release-${item.id}-restore`,action:'restore',at:item.restoredAt,actor:item.restoredBy||null})});return Core.clone(rows.sort((a,b)=>String(b.at).localeCompare(String(a.at))))}
    deletionRecords(){return []}
  }
  global.KGTaxonomyService=TaxonomyService;
})(window);
