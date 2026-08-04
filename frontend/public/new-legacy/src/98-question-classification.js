'use strict';

(function(global){
  const Core=global.KGLearningContent;
  const clean=value=>String(value??'').trim();
  const unique=values=>[...new Set((values||[]).map(clean).filter(Boolean))];
  const clone=value=>{try{return JSON.parse(JSON.stringify(value))}catch(error){return value}};
  const byId=id=>document.getElementById(id);
  const escapeHTML=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const COLLAPSE_KEY='kg_question_classification_collapsed_v1';
  const TAG_CONFIG_KEY='kg_question_tag_names_v1';

  const TAG_GROUPS=Object.freeze([
    {id:'usage',label:'用途标签',categories:[
      {id:'stage',label:'训练阶段',options:['基础练习','阶段测试','模拟考试','冲刺复习']},
      {id:'scene',label:'使用场景',options:['课后练习','课堂讨论','作业题','专项训练']}
    ]},
    {id:'quality',label:'质量标签',categories:[
      {id:'feature',label:'题目特征',options:['易错题','高频题','核心题','综合题']},
      {id:'review',label:'内容状态',options:['待复核','已复核','需更新']}
    ]},
    {id:'source',label:'来源标签',categories:[
      {id:'origin',label:'来源类型',options:['真题','自编题','改编题','教材例题']},
      {id:'scope',label:'使用范围',options:['可公开','内部使用']}
    ]}
  ]);

  function tagSlotKey(group,category,index){return `${group.id}/${category.id}/${index}`}
  function tagGroupKey(group){return group.id}
  function tagCategoryKey(group,category){return `${group.id}/${category.id}`}
  function readTagConfig(){
    try{
      const parsed=JSON.parse(localStorage.getItem(TAG_CONFIG_KEY)||'{}');
      return parsed&&typeof parsed==='object'?{
        names:parsed.names&&typeof parsed.names==='object'?parsed.names:{},
        groupNames:parsed.groupNames&&typeof parsed.groupNames==='object'?parsed.groupNames:{},
        categoryNames:parsed.categoryNames&&typeof parsed.categoryNames==='object'?parsed.categoryNames:{},
        aliases:parsed.aliases&&typeof parsed.aliases==='object'?parsed.aliases:{}
      }:{names:{},groupNames:{},categoryNames:{},aliases:{}}
    }catch(error){return {names:{},groupNames:{},categoryNames:{},aliases:{}}}
  }
  function writeTagConfig(config){try{localStorage.setItem(TAG_CONFIG_KEY,JSON.stringify(config))}catch(error){console.warn('标签名称保存失败',error)}}
  function loadTagConfig(){
    const config=readTagConfig();
    TAG_GROUPS.forEach(group=>{
      const groupName=clean(config.groupNames[tagGroupKey(group)]);if(groupName)group.label=groupName;
      group.categories.forEach(category=>{
        const categoryName=clean(config.categoryNames[tagCategoryKey(group,category)]);if(categoryName)category.label=categoryName;
        category.options.forEach((option,index)=>{const value=clean(config.names[tagSlotKey(group,category,index)]);if(value)category.options[index]=value});
      });
    });
    return config;
  }
  function canonicalTagName(value){
    let current=clean(value);if(!current)return '';const aliases=readTagConfig().aliases;const visited=new Set();
    while(aliases[current]&&!visited.has(current)){visited.add(current);current=clean(aliases[current])||current}
    return current;
  }
  function canonicalTags(values){return unique((values||[]).map(canonicalTagName))}
  loadTagConfig();

  const state={question:null,bank:null,subject:null,taxonomy:null,knowledgeDraftId:'',tagDraft:new Set(),tagGroupId:TAG_GROUPS[0].id,tagCategoryId:TAG_GROUPS[0].categories[0].id,tagManagerMessage:''};

  function normalizeToken(value){return clean(value).toLowerCase().replace(/[＞>\/\\|｜]+/g,'>').replace(/[\s　]+/g,'').replace(/[·•]/g,'');}
  function subjectFor(value){
    const query=clean(value);if(!query||!Core)return null;
    const token=normalizeToken(query);
    return Core.getSubjects().find(item=>[item.id,item.code,item.name?.zh,item.name?.en].some(candidate=>normalizeToken(candidate)===token))||null;
  }
  function subjectForBank(bankSubject){return subjectFor(bankSubject)||Core?.subjectById?.(bankSubject)||null}
  function taxonomyPath(taxonomyId,nodeId){return Core?.pathForNode?.(taxonomyId,nodeId)||[]}
  function pathLabel(taxonomyId,nodeId){return taxonomyPath(taxonomyId,nodeId).map(node=>node.title?.zh||node.id).join(' > ')}
  function activeTaxonomy(subject){return subject?Core?.defaultTaxonomyForSubject?.(subject.id):null}
  function nodeAliases(node){return unique([node.title?.zh,node.title?.en,node.code,...(node.aliases||[])])}

  function resolveKnowledge(taxonomy,query){
    const requested=clean(query);if(!taxonomy||!requested)return {status:requested?'missing_taxonomy':'empty',candidates:[]};
    const nodes=(taxonomy.nodes||[]).filter(node=>!['deprecated','disabled','inactive','archived'].includes(String(node.status||'active').toLowerCase()));
    const token=normalizeToken(requested);
    let candidates=nodes.filter(node=>normalizeToken(node.code)===token);
    if(!candidates.length){
      candidates=nodes.filter(node=>{
        const path=taxonomyPath(taxonomy.id,node.id).map(item=>item.title?.zh||'');
        const variants=[path.join('>'),path.slice(1).join('>'),path.join('/'),path.slice(1).join('/')];
        return variants.some(item=>normalizeToken(item)===token);
      });
    }
    if(!candidates.length)candidates=nodes.filter(node=>nodeAliases(node).some(alias=>normalizeToken(alias)===token));
    const uniqueCandidates=[...new Map(candidates.map(node=>[node.id,node])).values()];
    if(uniqueCandidates.length===1)return {status:'matched',node:uniqueCandidates[0],candidates:uniqueCandidates};
    if(uniqueCandidates.length>1)return {status:'ambiguous',candidates:uniqueCandidates};
    return {status:'unmatched',candidates:[]};
  }

  function resolveTemplate(parsed={},bankSubjectCode=''){
    const bankSubject=subjectForBank(bankSubjectCode)||Core?.getSubjects?.().find(item=>item.status==='active')||null;
    const requestedSubject=subjectFor(parsed.subject||parsed.subjectCode||'');
    const subject=requestedSubject||bankSubject;
    const warnings=[];
    let subjectStatus='bank_default';
    if(clean(parsed.subject||parsed.subjectCode)){
      if(!requestedSubject){subjectStatus='unmatched';warnings.push(`模板科目“${clean(parsed.subject||parsed.subjectCode)}”未匹配，将使用当前题库科目。`)}
      else if(bankSubject&&requestedSubject.id!==bankSubject.id){subjectStatus='mismatch';warnings.push(`模板科目“${requestedSubject.name?.zh||requestedSubject.code}”与当前题库科目不一致，将使用当前题库科目。`)}
      else subjectStatus='matched';
    }
    const effectiveSubject=bankSubject||subject;
    const taxonomy=activeTaxonomy(effectiveSubject);
    const requestedKnowledge=clean(parsed.knowledge||parsed.knowledgePath||parsed.primaryKnowledge||'');
    const match=resolveKnowledge(taxonomy,requestedKnowledge);
    if(match.status==='ambiguous')warnings.push(`知识点“${requestedKnowledge}”存在多个同名候选，请进入题目内容页手动选择。`);
    if(match.status==='unmatched')warnings.push(`知识点“${requestedKnowledge}”未在当前知识树中匹配，题目将进入待分类。`);
    if(match.status==='missing_taxonomy')warnings.push('当前科目没有可用知识树，题目将进入待分类。');
    const node=match.node||null;
    return {
      subjectId:effectiveSubject?.id||'',subjectCode:effectiveSubject?.code||bankSubjectCode||'',subjectStatus,
      taxonomyId:taxonomy?.id||'',taxonomyVersion:Number(taxonomy?.version)||1,
      requestedKnowledge,matchStatus:match.status,primaryNodeId:node?.id||null,
      mappingStatus:node?'confirmed':'unmapped',mappingSource:node?'template':'template-unmatched',
      pathSnapshot:node?taxonomyPath(taxonomy.id,node.id).map(item=>item.title?.zh||item.id):[],
      candidates:(match.candidates||[]).map(item=>({id:item.id,path:pathLabel(taxonomy.id,item.id),code:item.code||''})),
      tags:canonicalTags(parsed.tags||[]),warnings
    };
  }

  function knowledgeMetadataFromResolution(resolution){
    if(!resolution)return null;
    return {taxonomyId:resolution.taxonomyId||'',taxonomyVersion:Number(resolution.taxonomyVersion)||1,primaryNodeId:resolution.primaryNodeId||null,relatedNodeIds:[],mappingStatus:resolution.primaryNodeId?'confirmed':'unmapped',mappingSource:resolution.mappingSource||'template',pathSnapshot:resolution.pathSnapshot||[],confirmedAt:resolution.primaryNodeId?new Date().toISOString():''};
  }

  function normalizeKnowledge(question,subject,taxonomy){
    const raw=question?.metadata?.knowledge||{};const id=clean(raw.primaryNodeId);const mappedNode=id&&raw.taxonomyId?Core?.nodeById?.(raw.taxonomyId,id):null;
    const active=taxonomy||activeTaxonomy(subject);const taxonomyId=clean(raw.taxonomyId)||active?.id||'';
    const validNode=id?Core?.nodeById?.(taxonomyId,id):null;
    return {
      taxonomyId,taxonomyVersion:Number(raw.taxonomyVersion)||Number(active?.version)||1,
      primaryNodeId:validNode?.id||null,relatedNodeIds:[],
      mappingStatus:validNode?(clean(raw.mappingStatus)||'confirmed'):'unmapped',
      mappingSource:clean(raw.mappingSource)||'',
      pathSnapshot:validNode?(raw.pathSnapshot?.length?raw.pathSnapshot:taxonomyPath(taxonomyId,id).map(item=>item.title?.zh||item.id)):[],
      confirmedAt:clean(raw.confirmedAt),confirmedBy:clone(raw.confirmedBy||null),
      deprecated:!!mappedNode&&mappedNode.status==='deprecated'
    };
  }

  function currentApi(){return global.KGQuestionBankAdminAPI}
  function currentQuestion(){return currentApi()?.getCurrentQuestion?.()||null}
  function currentBank(){return currentApi()?.getCurrentBank?.()||null}
  function currentUser(){return global.KGAuthCore?.currentUser?.()||{id:'local-teacher',name:'本地教师'}}
  function historyEntry(kind,before,after,source){return {id:`classification-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`,kind,source:source||'manual',at:new Date().toISOString(),actor:currentUser(),before:clone(before),after:clone(after)}}

  function updateQuestion(patch,history){
    const question=currentQuestion();if(!question)return null;
    const metadata={...(question.metadata||{}),...(patch.metadata||{})};
    if(history)metadata.classificationHistory=[...(question.metadata?.classificationHistory||[]),history].slice(-50);
    return currentApi()?.updateCurrentQuestion?.({...patch,metadata});
  }

  function applyKnowledge(next,source='manual'){
    const question=currentQuestion(),bank=currentBank();if(!question||!bank)return;
    const subject=subjectForBank(bank.subject),taxonomy=activeTaxonomy(subject);const before=normalizeKnowledge(question,subject,taxonomy);
    const node=next.primaryNodeId?Core?.nodeById?.(next.taxonomyId||taxonomy?.id,next.primaryNodeId):null;
    const after={taxonomyId:next.taxonomyId||taxonomy?.id||'',taxonomyVersion:Number(next.taxonomyVersion)||Number(taxonomy?.version)||1,primaryNodeId:node?.id||null,relatedNodeIds:[],mappingStatus:node?'confirmed':'unmapped',mappingSource:source,pathSnapshot:node?taxonomyPath(next.taxonomyId||taxonomy?.id,node.id).map(item=>item.title?.zh||item.id):[],confirmedAt:node?new Date().toISOString():'',confirmedBy:node?currentUser():null};
    const result=updateQuestion({metadata:{...(question.metadata||{}),subjectId:subject?.id||'',knowledge:after}},historyEntry('knowledge',before,after,source));
    if(result?.valid!==false)currentApi()?.recordQuestionAudit?.(after.primaryNodeId?'question.knowledge.update':'question.unclassified.move',before,after,{summary:after.primaryNodeId?`修改题目主要知识点：${question.title}`:`移入待分类：${question.title}`,metadata:{source}});
  }

  function applyTags(tags,source='manual'){
    const question=currentQuestion();if(!question)return;const before=canonicalTags(question.tags||[]),after=canonicalTags(tags);
    const tagPaths=[];TAG_GROUPS.forEach(group=>group.categories.forEach(category=>category.options.forEach(option=>{if(after.includes(option))tagPaths.push({groupId:group.id,group:group.label,categoryId:category.id,category:category.label,label:option})})));
    const result=updateQuestion({tags:after,metadata:{...(question.metadata||{}),tagPaths}},historyEntry('tags',before,after,source));
    if(result?.valid!==false)currentApi()?.recordQuestionAudit?.('question.tags.update',before,after,{summary:`修改题目标签：${question.title}`,metadata:{source}});
  }

  function fillSubjectSelect(subject){
    const select=byId('questionSubjectInput');if(!select||!Core)return;
    const subjects=Core.getSubjects();select.innerHTML=subjects.map(item=>`<option value="${escapeHTML(item.id)}">${escapeHTML(item.code)} · ${escapeHTML(item.name?.zh||'')}</option>`).join('');select.value=subject?.id||'';
  }
  function statusInfo(knowledge){
    if(knowledge.deprecated)return {label:'知识点已停用',className:'deprecated'};
    if(knowledge.primaryNodeId&&knowledge.mappingStatus==='suggested')return {label:'模板识别待确认',className:'suggested'};
    if(knowledge.primaryNodeId)return {label:knowledge.mappingSource==='template'?'模板已识别':'已分类',className:'confirmed'};
    return {label:'待分类',className:'unmapped'};
  }
  function renderMain(){
    const question=currentQuestion(),bank=currentBank();state.question=question;state.bank=bank;state.subject=subjectForBank(bank?.subject);state.taxonomy=activeTaxonomy(state.subject);
    fillSubjectSelect(state.subject);
    const enabled=!!question;['qbKnowledgePickerBtn','qbSetUnclassifiedBtn','qbTagPickerBtn'].forEach(id=>{const node=byId(id);if(node)node.disabled=!enabled});
    const knowledge=normalizeKnowledge(question,state.subject,state.taxonomy);const node=knowledge.primaryNodeId?Core?.nodeById?.(knowledge.taxonomyId,knowledge.primaryNodeId):null;
    const label=knowledge.primaryNodeId?(pathLabel(knowledge.taxonomyId,knowledge.primaryNodeId)||knowledge.pathSnapshot.join(' > ')||knowledge.primaryNodeId):'待分类';
    if(byId('qbKnowledgePathLabel'))byId('qbKnowledgePathLabel').textContent=label;
    const info=statusInfo({...knowledge,deprecated:node?.status==='deprecated'}),status=byId('qbKnowledgeStatus');if(status){status.textContent=info.label;status.className=`qb-classification-status ${info.className}`}
    const tags=canonicalTags(question?.tags||[]);if(byId('qbTagSummary'))byId('qbTagSummary').textContent=tags.length?`${tags.length} 个标签：${tags.slice(0,3).join('、')}${tags.length>3?'…':''}`:'未选择标签';
    renderTagChips(byId('qbSelectedTagChips'),tags,true);
  }

  function children(parentId){return (state.taxonomy?.nodes||[]).filter(node=>(node.parentId||null)===(parentId||null)&&!['deprecated','disabled','inactive','archived'].includes(String(node.status||'active').toLowerCase())).sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)||(nodeTitle(a).localeCompare(nodeTitle(b),'zh-CN')))}
  function nodeTitle(node){return node?.title?.zh||node?.id||''}
  function pathIds(nodeId){return taxonomyPath(state.taxonomy?.id,nodeId).map(node=>node.id)}
  function renderKnowledgeBreadcrumb(){
    const wrap=byId('qbKnowledgeBreadcrumb');if(!wrap)return;const ids=state.knowledgeDraftId?pathIds(state.knowledgeDraftId):[];
    wrap.innerHTML=ids.length?ids.map((id,index)=>`<button type="button" data-knowledge-crumb="${escapeHTML(id)}">${escapeHTML(nodeTitle(Core.nodeById(state.taxonomy.id,id)))}</button>${index<ids.length-1?'<i>›</i>':''}`).join(''):'<span class="qb-knowledge-column-empty">尚未选择路径</span>';
    wrap.querySelectorAll('[data-knowledge-crumb]').forEach(button=>button.addEventListener('click',()=>{state.knowledgeDraftId=button.dataset.knowledgeCrumb;renderKnowledgePicker()}));
  }
  function renderKnowledgeColumns(){
    const wrap=byId('qbKnowledgeColumns');if(!wrap)return;const ids=state.knowledgeDraftId?pathIds(state.knowledgeDraftId):[];const parents=[null,...ids];const columns=[];
    parents.forEach((parentId,index)=>{const rows=children(parentId);if(!rows.length)return;const activeId=ids[index]||'';columns.push(`<section class="qb-knowledge-column"><strong>第 ${index+1} 层</strong>${rows.map(node=>{const hasChildren=children(node.id).length>0;return `<button type="button" class="qb-knowledge-node ${activeId===node.id?'active':''} ${state.knowledgeDraftId===node.id?'selected':''}" data-knowledge-node="${escapeHTML(node.id)}"><span class="radio"></span><span class="copy"><b>${escapeHTML(nodeTitle(node))}</b><small>${escapeHTML(node.code||`L${node.level}`)}</small></span><span class="arrow">${hasChildren?'›':''}</span></button>`}).join('')}</section>`)});
    wrap.innerHTML=columns.join('')||'<div class="qb-knowledge-column-empty">当前知识树没有可选知识点。</div>';
    wrap.querySelectorAll('[data-knowledge-node]').forEach(button=>button.addEventListener('click',()=>{state.knowledgeDraftId=button.dataset.knowledgeNode;renderKnowledgePicker()}));
    requestAnimationFrame(()=>{wrap.scrollLeft=wrap.scrollWidth});
  }
  function renderKnowledgeSearch(){
    const input=byId('qbKnowledgeSearchInput'),results=byId('qbKnowledgeSearchResults'),columns=byId('qbKnowledgeColumns');if(!input||!results||!columns)return;const query=clean(input.value);
    if(!query){results.hidden=true;columns.hidden=false;return}
    const token=normalizeToken(query);const rows=(state.taxonomy?.nodes||[]).filter(node=>!['deprecated','disabled','inactive','archived'].includes(String(node.status||'active').toLowerCase())).filter(node=>{
      const hay=[...nodeAliases(node),pathLabel(state.taxonomy.id,node.id)].map(normalizeToken);return hay.some(item=>item.includes(token));
    }).slice(0,80);
    results.innerHTML=rows.length?rows.map(node=>`<button type="button" data-knowledge-search-node="${escapeHTML(node.id)}"><b>${escapeHTML(nodeTitle(node))}</b><small>${escapeHTML(pathLabel(state.taxonomy.id,node.id))}${node.code?` · ${escapeHTML(node.code)}`:''}</small></button>`).join(''):'<div class="qb-knowledge-column-empty">没有匹配知识点。</div>';
    results.hidden=false;columns.hidden=true;results.querySelectorAll('[data-knowledge-search-node]').forEach(button=>button.addEventListener('click',()=>{state.knowledgeDraftId=button.dataset.knowledgeSearchNode;input.value='';renderKnowledgePicker()}));
  }
  function renderKnowledgeSelection(){
    const node=state.knowledgeDraftId?Core?.nodeById?.(state.taxonomy?.id,state.knowledgeDraftId):null,label=byId('qbKnowledgeDraftSelection'),hint=byId('qbKnowledgeSelectionHint'),confirm=byId('qbKnowledgeConfirmBtn');
    if(label)label.textContent=node?pathLabel(state.taxonomy.id,node.id):'尚未选择知识点';if(confirm)confirm.disabled=!node;
    if(hint)hint.textContent=node&&children(node.id).length?'该知识点还有下级节点；如果题目属于整体概念可以继续选择，否则建议进入更具体的节点。':'主要知识点只能选择一个。';
  }
  function renderKnowledgePicker(){renderKnowledgeBreadcrumb();renderKnowledgeColumns();renderKnowledgeSearch();renderKnowledgeSelection()}
  function openKnowledgePicker(){
    const question=currentQuestion(),bank=currentBank();if(!question||!bank)return;state.subject=subjectForBank(bank.subject);state.taxonomy=activeTaxonomy(state.subject);const knowledge=normalizeKnowledge(question,state.subject,state.taxonomy);state.knowledgeDraftId=knowledge.primaryNodeId||'';
    if(byId('qbKnowledgeSubjectLabel'))byId('qbKnowledgeSubjectLabel').textContent=state.subject?`${state.subject.code} · ${state.subject.name?.zh||''}`:'未找到科目';
    if(byId('qbKnowledgeTaxonomyLabel'))byId('qbKnowledgeTaxonomyLabel').textContent=state.taxonomy?`${state.taxonomy.name?.zh||state.taxonomy.id} · ${state.taxonomy.versionLabel||`v${state.taxonomy.version}.0`}`:'没有当前知识树';
    if(byId('qbKnowledgeSearchInput'))byId('qbKnowledgeSearchInput').value='';renderKnowledgePicker();const dialog=byId('qbKnowledgePickerDialog');dialog?.showModal?dialog.showModal():dialog?.setAttribute('open','');
  }

  function group(){return TAG_GROUPS.find(item=>item.id===state.tagGroupId)||TAG_GROUPS[0]}
  function category(){return group().categories.find(item=>item.id===state.tagCategoryId)||group().categories[0]}
  function renderTagChips(wrap,tags,removable){
    if(!wrap)return;wrap.innerHTML=canonicalTags(tags).map(tag=>removable?`<button type="button" data-remove-tag="${escapeHTML(tag)}" title="移除标签">${escapeHTML(tag)} <b>×</b></button>`:`<span>${escapeHTML(tag)}</span>`).join('');
    if(removable)wrap.querySelectorAll('[data-remove-tag]').forEach(button=>button.addEventListener('click',event=>{event.stopPropagation();const current=canonicalTags(currentQuestion()?.tags||[]).filter(tag=>tag!==button.dataset.removeTag);applyTags(current,'manual-remove')}));
  }
  function renderTagPicker(){
    const groups=byId('qbTagGroupList'),categories=byId('qbTagCategoryList'),options=byId('qbTagOptionList');if(!groups||!categories||!options)return;
    groups.innerHTML=TAG_GROUPS.map(item=>`<button type="button" class="${item.id===state.tagGroupId?'active':''}" data-tag-group="${escapeHTML(item.id)}"><span>${escapeHTML(item.label)}</span><b>›</b></button>`).join('');
    categories.innerHTML=group().categories.map(item=>`<button type="button" class="${item.id===state.tagCategoryId?'active':''}" data-tag-category="${escapeHTML(item.id)}"><span>${escapeHTML(item.label)}</span><b>›</b></button>`).join('');
    options.innerHTML=category().options.map(option=>`<label><input type="checkbox" data-tag-option="${escapeHTML(option)}" ${state.tagDraft.has(option)?'checked':''}/><span>${escapeHTML(option)}</span></label>`).join('')||'<div class="qb-tag-column-empty">没有可选标签。</div>';
    groups.querySelectorAll('[data-tag-group]').forEach(button=>button.addEventListener('click',()=>{state.tagGroupId=button.dataset.tagGroup;state.tagCategoryId=group().categories[0].id;renderTagPicker()}));
    categories.querySelectorAll('[data-tag-category]').forEach(button=>button.addEventListener('click',()=>{state.tagCategoryId=button.dataset.tagCategory;renderTagPicker()}));
    options.querySelectorAll('[data-tag-option]').forEach(input=>input.addEventListener('change',()=>{input.checked?state.tagDraft.add(input.dataset.tagOption):state.tagDraft.delete(input.dataset.tagOption);renderTagDraftChips()}));renderTagDraftChips();
  }
  function renderTagDraftChips(){const wrap=byId('qbTagDraftChips');renderTagChips(wrap,[...state.tagDraft],false)}
  function openTagPicker(){state.tagDraft=new Set(canonicalTags(currentQuestion()?.tags||[]));renderTagPicker();const dialog=byId('qbTagPickerDialog');dialog?.showModal?dialog.showModal():dialog?.setAttribute('open','')}
  function addCustomTag(){const input=byId('qbCustomTagInput'),value=clean(input?.value);if(!value)return;if(input)input.value='';state.tagDraft.add(canonicalTagName(value));renderTagDraftChips()}

  function managedTagSlots(){
    const rows=[];TAG_GROUPS.forEach(group=>group.categories.forEach(category=>category.options.forEach((name,index)=>rows.push({kind:'option',key:tagSlotKey(group,category,index),group,category,index,name}))));return rows;
  }
  function managedCatalogItems(){
    const rows=[];TAG_GROUPS.forEach(group=>{rows.push({kind:'group',key:tagGroupKey(group),group,name:group.label});group.categories.forEach(category=>rows.push({kind:'category',key:tagCategoryKey(group,category),group,category,name:category.label}))});return rows.concat(managedTagSlots());
  }
  function setTagManagerMessage(message,type=''){state.tagManagerMessage=message||'';const node=byId('qbTagManagerMessage');if(node){node.textContent=state.tagManagerMessage;node.dataset.type=type||''}}
  function managerButton(item,className){return `<button type="button" class="${className}" data-tag-manage-kind="${escapeHTML(item.kind)}" data-tag-manage-key="${escapeHTML(item.key)}" data-tag-manage-name="${escapeHTML(item.name)}"><span>${escapeHTML(item.name)}</span><small>双击修改</small></button>`}
  function renderTagManager(){
    const wrap=byId('qbTagManagerList');if(!wrap)return;
    wrap.innerHTML=TAG_GROUPS.map(group=>{
      const groupItem={kind:'group',key:tagGroupKey(group),group,name:group.label};
      return `<section class="qb-tag-manage-group"><div class="qb-tag-manage-group-head">${managerButton(groupItem,'qb-tag-manage-label qb-tag-manage-group-name')}</div>${group.categories.map(category=>{const categoryItem={kind:'category',key:tagCategoryKey(group,category),group,category,name:category.label};return `<div class="qb-tag-manage-category"><div class="qb-tag-manage-category-head">${managerButton(categoryItem,'qb-tag-manage-label qb-tag-manage-category-name')}</div><div>${category.options.map((name,index)=>managerButton({kind:'option',key:tagSlotKey(group,category,index),group,category,index,name},'qb-tag-manage-name')).join('')}</div></div>`}).join('')}</section>`
    }).join('');
    wrap.querySelectorAll('[data-tag-manage-key]').forEach(button=>button.addEventListener('dblclick',()=>beginTagNameEdit(button)));
    setTagManagerMessage(state.tagManagerMessage);
  }
  function beginTagNameEdit(button){
    if(!button||button.querySelector('input'))return;const key=button.dataset.tagManageKey,kind=button.dataset.tagManageKind||'option',oldName=button.dataset.tagManageName||'';
    button.innerHTML=`<input class="qb-tag-manage-input" value="${escapeHTML(oldName)}" aria-label="修改${kind==='group'?'标签分类':kind==='category'?'二级分类':'标签'}名称"/>`;
    const input=button.querySelector('input');let cancelled=false,committed=false;
    const cancel=()=>{if(committed)return;cancelled=true;renderTagManager()};
    const commit=()=>{if(cancelled||committed)return;committed=true;renameManagedCatalogItem(kind,key,oldName,input.value)};
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();commit()}else if(event.key==='Escape'){event.preventDefault();cancel()}});
    input.addEventListener('blur',commit);input.addEventListener('dblclick',event=>event.stopPropagation());input.focus();input.select();
  }
  function renameManagedCatalogItem(kind,key,oldName,nextValue){
    const next=clean(nextValue),item=managedCatalogItems().find(row=>row.kind===kind&&row.key===key);
    if(!item){setTagManagerMessage('未找到标签项目，请重新打开管理窗口。','error');renderTagManager();return}
    if(!next){setTagManagerMessage('名称不能为空。','error');renderTagManager();return}
    if(next===oldName){setTagManagerMessage('名称没有变化。');renderTagManager();return}
    let duplicate=false;
    if(kind==='group')duplicate=TAG_GROUPS.some(group=>group!==item.group&&normalizeToken(group.label)===normalizeToken(next));
    else if(kind==='category')duplicate=item.group.categories.some(category=>category!==item.category&&normalizeToken(category.label)===normalizeToken(next));
    else duplicate=managedTagSlots().some(slot=>slot.key!==key&&normalizeToken(slot.name)===normalizeToken(next));
    if(duplicate){const message=kind==='group'?'已存在同名标签分类，请使用其他名称。':kind==='category'?'已存在同名二级分类，请使用其他名称。':'已存在同名标签，请使用其他名称。';setTagManagerMessage(message,'error');renderTagManager();return}
    const config=readTagConfig();
    if(kind==='group'){item.group.label=next;config.groupNames[key]=next}
    else if(kind==='category'){item.category.label=next;config.categoryNames[key]=next}
    else{
      const result=currentApi()?.renameTagAcrossQuestions?.(oldName,next);
      if(result&&result.valid===false){setTagManagerMessage(result.error||'标签名称修改失败。','error');renderTagManager();return}
      item.category.options[item.index]=next;config.names[key]=next;config.aliases[oldName]=next;Object.keys(config.aliases).forEach(alias=>{if(config.aliases[alias]===oldName)config.aliases[alias]=next});
      if(state.tagDraft.has(oldName)){state.tagDraft.delete(oldName);state.tagDraft.add(next)}
      document.dispatchEvent(new CustomEvent('kg-tag-renamed',{detail:{oldName,newName:next,updatedQuestions:Number(result?.updatedQuestions)||0}}));
      writeTagConfig(config);setTagManagerMessage(`已将“${oldName}”改为“${next}”${result?.updatedQuestions?`，同步更新 ${result.updatedQuestions} 道题`:''}。`,'success');renderTagManager();renderTagPicker();renderMain();return
    }
    writeTagConfig(config);document.dispatchEvent(new CustomEvent('kg-tag-catalog-renamed',{detail:{kind,key,oldName,newName:next}}));setTagManagerMessage(`已将“${oldName}”改为“${next}”。`,'success');renderTagManager();renderTagPicker();renderMain();
  }
  function openTagManager(){state.tagManagerMessage='';renderTagManager();const dialog=byId('qbTagManagerDialog');dialog?.showModal?dialog.showModal():dialog?.setAttribute('open','')}

  function toggleCollapse(){const fields=byId('qbClassificationFields'),button=byId('qbClassificationCollapseBtn');if(!fields||!button)return;const collapsed=!fields.hidden;fields.hidden=collapsed;button.textContent=collapsed?'展开':'收起';button.setAttribute('aria-expanded',String(!collapsed));try{localStorage.setItem(COLLAPSE_KEY,collapsed?'1':'0')}catch(error){}}
  function restoreCollapse(){let collapsed=false;try{collapsed=localStorage.getItem(COLLAPSE_KEY)==='1'}catch(error){}const fields=byId('qbClassificationFields'),button=byId('qbClassificationCollapseBtn');if(fields)fields.hidden=collapsed;if(button){button.textContent=collapsed?'展开':'收起';button.setAttribute('aria-expanded',String(!collapsed))}}

  function init(){
    if(!byId('qbClassificationBar')||!Core)return;
    byId('qbClassificationCollapseBtn')?.addEventListener('click',toggleCollapse);byId('qbKnowledgePickerBtn')?.addEventListener('click',openKnowledgePicker);byId('qbSetUnclassifiedBtn')?.addEventListener('click',()=>applyKnowledge({primaryNodeId:null},'manual-unmapped'));
    byId('qbKnowledgeSearchInput')?.addEventListener('input',renderKnowledgeSearch);byId('qbKnowledgeConfirmBtn')?.addEventListener('click',()=>{if(!state.knowledgeDraftId)return;applyKnowledge({taxonomyId:state.taxonomy?.id,taxonomyVersion:state.taxonomy?.version,primaryNodeId:state.knowledgeDraftId},'manual');byId('qbKnowledgePickerDialog')?.close()});byId('qbKnowledgeUnmappedBtn')?.addEventListener('click',()=>{applyKnowledge({primaryNodeId:null},'manual-unmapped');byId('qbKnowledgePickerDialog')?.close()});
    byId('qbTagPickerBtn')?.addEventListener('click',openTagPicker);byId('qbTagManageBtn')?.addEventListener('click',openTagManager);byId('qbTagConfirmBtn')?.addEventListener('click',()=>{applyTags([...state.tagDraft],'manual');byId('qbTagPickerDialog')?.close()});byId('qbTagClearBtn')?.addEventListener('click',()=>{state.tagDraft.clear();renderTagDraftChips()});byId('qbCustomTagInput')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();addCustomTag()}});
    document.addEventListener('kg-question-form-filled',renderMain);restoreCollapse();renderMain();
  }

  global.KGQuestionClassification=Object.freeze({TAG_GROUPS,resolveTemplate,knowledgeMetadataFromResolution,normalizeKnowledge,subjectForBank,pathLabel,canonicalTagName,canonicalTags});
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init();
})(globalThis);
