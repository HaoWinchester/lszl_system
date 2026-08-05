'use strict';

(function(){
  const Core=window.KGLearningContent;
  const $=id=>document.getElementById(id);
  const escapeHTML=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const SUBJECT_PREF_KEY='kg_teacher_workbench_subject_v1';
  const WORKSPACE_KEY='kg_course_admin_workspace_v862_p1';
  const RECENT_KEY='kg_course_admin_recent_v862_p2';
  const P2=window.KGTeacherWorkflowP2;
  const workflowParams=new URLSearchParams(location.search);
  const workflowMode=(workflowParams.get('mode')||document.body?.dataset?.caWorkflowMode||'simple')==='advanced'?'advanced':'simple';
  const state={
    courses:[],courseId:'',selection:{kind:'course',id:''},activityQuery:'',knowledgeId:'',onlyMapped:true,
    expandedStages:new Set(),expandedParts:new Set(),currentStageId:'',structureQuery:'',structureFilter:'all',treeScrollTop:0,validationFilter:'all',outlinePreview:null
  };
  let toastTimer,scrollSaveTimer,recentEditTimer;

  function toast(message){const el=$('caToast');if(!el)return;el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2500)}
  function course(){return state.courses.find(item=>item.id===state.courseId)||null}
  function stage(id){return course()?.stages.find(item=>item.id===id)||null}
  function part(id){return course()?.parts.find(item=>item.id===id)||null}
  function node(id){return course()?.nodes.find(item=>item.id===id)||null}
  function selected(){return state.selection.kind==='stage'?stage(state.selection.id):state.selection.kind==='part'?part(state.selection.id):state.selection.kind==='node'?node(state.selection.id):course()}
  function selectedNode(){return state.selection.kind==='node'?node(state.selection.id):null}
  function subjects(){return Core.getSubjects()}
  function sorted(list){return (list||[]).slice().sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0))}
  function stages(){return sorted(course()?.stages||[])}
  function partsOf(stageId){return sorted(course()?.parts.filter(item=>item.stageId===stageId)||[])}
  function nodesOf(partId){return sorted(course()?.nodes.filter(item=>item.partId===partId)||[])}
  function allParts(){return stages().flatMap(item=>partsOf(item.id))}
  function pad(value){return String(Number(value)||0).padStart(2,'0')}
  function clean(value){return String(value??'').trim()}
  function normalizeOrders(){
    const c=course();if(!c)return;
    sorted(c.stages).forEach((item,index)=>item.order=index+1);
    sorted(c.stages).forEach(s=>{sorted(c.parts.filter(item=>item.stageId===s.id)).forEach((item,index)=>item.order=index+1)});
    c.parts.forEach(p=>{sorted(c.nodes.filter(item=>item.partId===p.id)).forEach((item,index)=>item.order=index+1)});
  }
  function selectionTitle(selection=state.selection){
    const item=selection.kind==='stage'?stage(selection.id):selection.kind==='part'?part(selection.id):selection.kind==='node'?node(selection.id):course();
    return clean(item?.title||item?.name)||'未命名';
  }
  function readRecent(){try{const parsed=JSON.parse(localStorage.getItem(RECENT_KEY)||'[]');return Array.isArray(parsed)?parsed:[]}catch(error){return []}}
  function writeRecent(items){try{localStorage.setItem(RECENT_KEY,JSON.stringify(items.slice(0,30)));return true}catch(error){return false}}
  function recordRecent(action,selection=state.selection){
    const c=course();if(!c||!selectionExists(selection))return;
    const item={courseId:c.id,courseName:c.name,kind:selection.kind,id:selection.id,title:selectionTitle(selection),path:pathTextFor(selection),action:clean(action)||'编辑',updatedAt:new Date().toISOString()};
    const key=`${item.courseId}:${item.kind}:${item.id}`;const items=readRecent().filter(entry=>`${entry.courseId}:${entry.kind}:${entry.id}`!==key);items.unshift(item);writeRecent(items);
  }
  function scheduleRecent(action){clearTimeout(recentEditTimer);recentEditTimer=setTimeout(()=>recordRecent(action),500)}
  function pathTextFor(selection){
    const c=course(),nums=numbering();if(!c)return '';
    if(selection.kind==='stage'){const s=stage(selection.id);return `${nums.stage.get(s?.id)||''} ${s?.title||''}`}
    if(selection.kind==='part'){const p=part(selection.id),s=stage(p?.stageId);return `${nums.stage.get(s?.id)||''} ${s?.title||''} / ${nums.part.get(p?.id)||''} ${p?.title||''}`}
    if(selection.kind==='node'){const n=node(selection.id),p=part(n?.partId),s=stage(p?.stageId);return `${nums.stage.get(s?.id)||''} ${s?.title||''} / ${nums.part.get(p?.id)||''} ${p?.title||''} / ${nums.node.get(n?.id)||''} ${n?.title||''}`}
    return c.name;
  }

  function numbering(){
    const c=course(),map={stage:new Map(),part:new Map(),node:new Map()};if(!c)return map;
    stages().forEach((s,si)=>{
      const stageNo=pad(si+1);map.stage.set(s.id,stageNo);
      partsOf(s.id).forEach((p,pi)=>{
        const partNo=`${stageNo}.${pad(pi+1)}`;map.part.set(p.id,partNo);
        nodesOf(p.id).forEach((n,ni)=>map.node.set(n.id,`${partNo}.${pad(ni+1)}`));
      });
    });
    return map;
  }

  function readWorkspaceMap(){try{return JSON.parse(localStorage.getItem(WORKSPACE_KEY)||'{}')||{}}catch(error){return {}}}
  function writeWorkspaceMap(map){try{localStorage.setItem(WORKSPACE_KEY,JSON.stringify(map));return true}catch(error){return false}}
  function selectionExists(selection){
    if(!selection||!selection.kind)return false;
    if(selection.kind==='course')return selection.id===course()?.id;
    if(selection.kind==='stage')return !!stage(selection.id);
    if(selection.kind==='part')return !!part(selection.id);
    if(selection.kind==='node')return !!node(selection.id);
    return false;
  }
  function saveWorkspaceState(){
    if(!state.courseId)return;
    const map=readWorkspaceMap();
    map[state.courseId]={selection:{...state.selection},currentStageId:state.currentStageId,expandedPartIds:[...state.expandedParts],treeScrollTop:Math.max(0,Number(state.treeScrollTop)||0),activityQuery:state.activityQuery,knowledgeId:state.knowledgeId,onlyMapped:state.onlyMapped,structureFilter:state.structureFilter,updatedAt:new Date().toISOString()};
    writeWorkspaceMap(map);
  }
  function restoreWorkspaceState(){
    const c=course();if(!c)return false;
    const stored=readWorkspaceMap()[c.id];if(!stored)return false;
    state.currentStageId=stage(stored.currentStageId)?.id||'';
    state.selection=selectionExists(stored.selection)?stored.selection:{kind:'course',id:c.id};
    state.expandedParts=new Set((stored.expandedPartIds||[]).filter(id=>!!part(id)));
    state.treeScrollTop=Math.max(0,Number(stored.treeScrollTop)||0);
    state.activityQuery=String(stored.activityQuery||'');
    state.knowledgeId=String(stored.knowledgeId||'');
    state.onlyMapped=stored.onlyMapped!==false;
    state.structureFilter=['all','incomplete','issues'].includes(stored.structureFilter)?stored.structureFilter:'all';
    ensureSelectionVisible();
    return true;
  }

  function stageIdForSelection(selection=state.selection){
    if(selection.kind==='stage')return stage(selection.id)?.id||'';
    if(selection.kind==='part')return part(selection.id)?.stageId||'';
    if(selection.kind==='node')return part(node(selection.id)?.partId)?.stageId||'';
    return '';
  }
  function ensureCurrentStage(){
    const list=stages();if(!list.length){state.currentStageId='';return null}
    const fromSelection=stageIdForSelection();
    if(fromSelection)state.currentStageId=fromSelection;
    if(!stage(state.currentStageId))state.currentStageId=list[0].id;
    return stage(state.currentStageId);
  }
  function ensureSelectionVisible(){
    const c=course();if(!c)return;
    if(state.selection.kind==='stage'){
      const s=stage(state.selection.id);if(s){state.currentStageId=s.id;state.expandedStages.add(s.id)}return;
    }
    if(state.selection.kind==='part'){
      const p=part(state.selection.id);if(p){state.currentStageId=p.stageId;state.expandedStages.add(p.stageId);state.expandedParts.add(p.id)}return;
    }
    if(state.selection.kind==='node'){
      const n=node(state.selection.id),p=part(n?.partId);if(p){state.currentStageId=p.stageId;state.expandedStages.add(p.stageId);state.expandedParts.add(p.id)}
    }
  }
  function chooseInitialSelection(){
    const c=course();if(!c)return;
    const firstStage=stages()[0];if(!firstStage){state.selection={kind:'course',id:c.id};state.currentStageId='';return}
    const firstPart=partsOf(firstStage.id)[0],firstNode=firstPart?nodesOf(firstPart.id)[0]:null;
    state.selection=firstNode?{kind:'node',id:firstNode.id}:firstPart?{kind:'part',id:firstPart.id}:{kind:'stage',id:firstStage.id};
    state.currentStageId=firstStage.id;state.expandedParts.clear();ensureSelectionVisible();
  }
  function setSelection(selection,{scroll=true,save=true}={}){
    if(!selectionExists(selection))return false;
    state.selection={kind:selection.kind,id:selection.id};
    ensureSelectionVisible();
    if(state.selection.kind==='part'||state.selection.kind==='node'){
      const p=state.selection.kind==='part'?part(state.selection.id):part(node(state.selection.id)?.partId);
      if(p){state.expandedParts.clear();state.expandedParts.add(p.id)}
    }
    renderStructure();renderEditor();renderPicker();renderPreview();renderNavigationState();
    if(scroll)requestAnimationFrame(()=>document.querySelector('#caStructureTree .label.active')?.scrollIntoView({block:'nearest'}));
    if(save)saveWorkspaceState();
    return true;
  }

  function renderCourseBar(){
    const select=$('caCourseSelect');if(select)select.innerHTML=state.courses.map(item=>`<option value="${escapeHTML(item.id)}" ${item.id===state.courseId?'selected':''}>${escapeHTML(item.name)}</option>`).join('');
    const c=course();if(!c)return;
    $('caCourseName').value=c.name;$('caDescription').value=c.description||'';
    $('caSubject').innerHTML=subjects().map(subject=>`<option value="${escapeHTML(subject.id)}" ${subject.id===c.subjectId?'selected':''}>${escapeHTML(subject.name.zh)}</option>`).join('');
    renderTaxonomySelect();const account=$('caAccount');if(account)account.textContent=`${Core.currentUser().name} · 在线草稿模式`;
    if($('caActivitySearch'))$('caActivitySearch').value=state.activityQuery;
    if($('caOnlyMapped'))$('caOnlyMapped').checked=state.onlyMapped;
  }
  function renderTaxonomySelect(){const c=course();if(!c)return;const list=Core.getTaxonomies(c.subjectId);if(!list.some(item=>item.id===c.taxonomyId))c.taxonomyId=list[0]?.id||'';$('caTaxonomy').innerHTML=list.map(item=>`<option value="${escapeHTML(item.id)}" ${item.id===c.taxonomyId?'selected':''}>${escapeHTML(item.name.zh)} · v${item.version}</option>`).join('')}

  function issueIndex(){
    const c=course(),library=Core.getActivityLibrary(),counts=new Map(),issues=new Map(),incomplete=new Set();
    if(!c)return {issues,incomplete};
    [...c.stages,...c.parts,...c.nodes].forEach(item=>counts.set(item.id,(counts.get(item.id)||0)+1));
    c.stages.forEach(s=>{
      const messages=[];if(!clean(s.title))messages.push('阶段名称为空');if((counts.get(s.id)||0)>1)messages.push('ID 重复');if(!partsOf(s.id).length)incomplete.add(`stage:${s.id}`);if(messages.length)issues.set(`stage:${s.id}`,messages);
    });
    c.parts.forEach(p=>{
      const messages=[];if(!clean(p.title))messages.push('章节名称为空');if((counts.get(p.id)||0)>1)messages.push('ID 重复');if(!stage(p.stageId))messages.push('所属阶段不存在');if(!nodesOf(p.id).length)incomplete.add(`part:${p.id}`);if(messages.length)issues.set(`part:${p.id}`,messages);
    });
    c.nodes.forEach(n=>{
      const messages=[];if(!clean(n.title))messages.push('学习步骤名称为空');if((counts.get(n.id)||0)>1)messages.push('ID 重复');if(!part(n.partId))messages.push('所属章节不存在');const missing=(n.activityIds||[]).filter(id=>!library[id]);if(missing.length)messages.push(`${missing.length} 项内容不存在`);if(!(n.activityIds||[]).length)incomplete.add(`node:${n.id}`);if(messages.length)issues.set(`node:${n.id}`,messages);
    });
    return {issues,incomplete};
  }
  function statusFor(kind,id,index=issueIndex()){
    const key=`${kind}:${id}`;return {issue:index.issues.get(key)||[],incomplete:index.incomplete.has(key)};
  }
  function descendantStatusForPart(p,index){
    const self=statusFor('part',p.id,index),nodes=nodesOf(p.id);return {issue:self.issue.length>0||nodes.some(n=>statusFor('node',n.id,index).issue.length),incomplete:self.incomplete||nodes.some(n=>statusFor('node',n.id,index).incomplete)};
  }
  function stageStatus(s,index){
    const self=statusFor('stage',s.id,index),parts=partsOf(s.id);return {issue:self.issue.length>0||parts.some(p=>descendantStatusForPart(p,index).issue),incomplete:self.incomplete||parts.some(p=>descendantStatusForPart(p,index).incomplete)};
  }
  function statusBadges(status){
    const result=[];if(status.issue?.length||status.issue===true)result.push('<i class="ca-tree-status issue" title="存在校验问题">!</i>');if(status.incomplete)result.push('<i class="ca-tree-status incomplete" title="尚未配置完整">待</i>');return result.join('');
  }
  function treeLabel(kind,id,title,number,extra='',status={}){
    const active=state.selection.kind===kind&&state.selection.id===id;
    return `<button type="button" class="label ${active?'active':''}" data-kind="${kind}" data-id="${escapeHTML(id)}"><b class="ca-tree-number">${escapeHTML(number)}</b><span>${escapeHTML(title||'未命名')}</span><span class="ca-tree-meta">${extra?`<small>${escapeHTML(extra)}</small>`:''}${statusBadges(status)}</span></button>`;
  }

  function renderStageSelector(){
    const list=stages(),nums=numbering(),current=ensureCurrentStage(),select=$('caStageSelector');
    if(!select)return;
    select.innerHTML=list.map((s,index)=>`<option value="${escapeHTML(s.id)}" ${s.id===current?.id?'selected':''}>${nums.stage.get(s.id)} ${escapeHTML(s.title)} · ${partsOf(s.id).length} 章</option>`).join('');
    const position=current?list.findIndex(item=>item.id===current.id)+1:0;
    $('caStagePosition').textContent=`${position} / ${list.length}`;
    $('caStructureFilter').value=state.structureFilter;
  }
  function renderSearchResults(){
    const box=$('caStructureSearchResults'),query=clean(state.structureQuery).toLowerCase();if(!box)return;
    if(!query){box.hidden=true;box.innerHTML='';return}
    const nums=numbering(),items=[];
    stages().forEach(s=>{
      items.push({kind:'stage',id:s.id,title:s.title,number:nums.stage.get(s.id),path:`${nums.stage.get(s.id)} ${s.title}`});
      partsOf(s.id).forEach(p=>{
        items.push({kind:'part',id:p.id,title:p.title,number:nums.part.get(p.id),path:`${nums.stage.get(s.id)} ${s.title} / ${nums.part.get(p.id)} ${p.title}`});
        nodesOf(p.id).forEach(n=>items.push({kind:'node',id:n.id,title:n.title,number:nums.node.get(n.id),path:`${nums.stage.get(s.id)} ${s.title} / ${nums.part.get(p.id)} ${p.title} / ${nums.node.get(n.id)} ${n.title}`}));
      });
    });
    const matches=items.filter(item=>`${item.number} ${item.title} ${item.id} ${item.path}`.toLowerCase().includes(query)).slice(0,60);
    box.innerHTML=matches.length?matches.map(item=>`<button type="button" data-search-kind="${item.kind}" data-search-id="${escapeHTML(item.id)}"><b>${escapeHTML(item.number)}</b><span>${escapeHTML(item.title)}</span><small>${escapeHTML(item.kind==='stage'?'阶段':item.kind==='part'?'章节':'学习步骤')}</small></button>`).join(''):'<div class="ca-search-empty">没有找到匹配内容。</div>';
    box.hidden=false;
  }
  function renderAdvancedStructure(){
    const c=course();if(!c)return;ensureSelectionVisible();const nums=numbering();
    const html=stages().map(s=>{
      const parts=partsOf(s.id),open=state.expandedStages.has(s.id);
      let block=`<section class="ca-tree-stage ${open?'open':''}"><div class="ca-tree-row depth-0"><button type="button" class="ca-tree-toggle" data-toggle-kind="stage" data-toggle-id="${escapeHTML(s.id)}" aria-expanded="${open}">${open?'−':'+'}</button>${treeLabel('stage',s.id,s.title,nums.stage.get(s.id),`${parts.length} 章`)}</div>`;
      if(open)block+='<div class="ca-tree-children">'+parts.map(p=>{const nodes=nodesOf(p.id),partOpen=state.expandedParts.has(p.id);let partBlock=`<section class="ca-tree-part ${partOpen?'open':''}"><div class="ca-tree-row depth-1"><button type="button" class="ca-tree-toggle" data-toggle-kind="part" data-toggle-id="${escapeHTML(p.id)}" aria-expanded="${partOpen}">${partOpen?'−':'+'}</button>${treeLabel('part',p.id,p.title,nums.part.get(p.id),`${nodes.length} 步`)}</div>`;if(partOpen)partBlock+='<div class="ca-tree-children">'+nodes.map(n=>`<div class="ca-tree-row depth-2"><span class="ca-tree-toggle-spacer"></span>${treeLabel('node',n.id,n.title,nums.node.get(n.id),`${n.activityIds.length} 项内容`)}</div>`).join('')+'</div>';return partBlock+'</section>'}).join('')+'</div>';
      return block+'</section>';
    }).join('');
    $('caStructureTree').innerHTML=html||'<div class="ca-empty">尚无课程结构。</div>';
  }
  function renderStructure(){
    if(workflowMode==='advanced'){renderAdvancedStructure();return}
    const c=course();if(!c)return;ensureSelectionVisible();const nums=numbering(),current=ensureCurrentStage(),index=issueIndex();renderStageSelector();
    const tree=$('caStructureTree');if(!current){tree.innerHTML='<div class="ca-empty">尚无课程结构。</div>';renderSearchResults();return}
    const allStageParts=partsOf(current.id);
    const visibleParts=allStageParts.filter(p=>{
      if(state.structureFilter==='all')return true;const status=descendantStatusForPart(p,index);return state.structureFilter==='incomplete'?status.incomplete:status.issue;
    });
    const sStatus=stageStatus(current,index);
    let html=`<section class="ca-tree-stage open" data-stage-id="${escapeHTML(current.id)}"><div class="ca-tree-row depth-0"><span class="ca-tree-toggle-spacer"></span>${treeLabel('stage',current.id,current.title,nums.stage.get(current.id),`${allStageParts.length} 章`,sStatus)}</div>`;
    if(visibleParts.length){
      html+='<div class="ca-tree-children">'+visibleParts.map(p=>{
        const allNodes=nodesOf(p.id),pStatus=descendantStatusForPart(p,index);
        const visibleNodes=allNodes.filter(n=>state.structureFilter==='all'||(state.structureFilter==='incomplete'?statusFor('node',n.id,index).incomplete:statusFor('node',n.id,index).issue.length));
        const selectedPartId=state.selection.kind==='part'?state.selection.id:state.selection.kind==='node'?node(state.selection.id)?.partId:'';
        const partOpen=state.expandedParts.has(p.id)||selectedPartId===p.id||state.structureFilter!=='all';
        let block=`<section class="ca-tree-part ${partOpen?'open':''}"><div class="ca-tree-row depth-1"><button type="button" class="ca-tree-toggle" data-toggle-kind="part" data-toggle-id="${escapeHTML(p.id)}" aria-expanded="${partOpen}">${partOpen?'−':'+'}</button>${treeLabel('part',p.id,p.title,nums.part.get(p.id),`${allNodes.length} 步`,pStatus)}</div>`;
        if(partOpen)block+='<div class="ca-tree-children">'+(visibleNodes.length?visibleNodes.map(n=>`<div class="ca-tree-row depth-2"><span class="ca-tree-toggle-spacer"></span>${treeLabel('node',n.id,n.title,nums.node.get(n.id),`${n.activityIds.length} 项内容`,statusFor('node',n.id,index))}</div>`).join(''):'<div class="ca-tree-filter-empty">当前筛选下没有学习步骤。</div>')+'</div>';
        return block+'</section>';
      }).join('')+'</div>';
    }else html+=`<div class="ca-tree-filter-empty">当前阶段没有符合“${state.structureFilter==='incomplete'?'待配置':'有问题'}”条件的章节。</div>`;
    tree.innerHTML=html+'</section>';
    requestAnimationFrame(()=>{tree.scrollTop=Math.min(state.treeScrollTop,Math.max(0,tree.scrollHeight-tree.clientHeight))});
    renderSearchResults();renderNavigationState();
  }

  function pathText(){
    const c=course(),nums=numbering();if(!c)return '';
    if(state.selection.kind==='stage'){const s=stage(state.selection.id);return `${c.name} / ${nums.stage.get(s?.id)||''} ${s?.title||''}`}
    if(state.selection.kind==='part'){const p=part(state.selection.id),s=stage(p?.stageId);return `${c.name} / ${nums.stage.get(s?.id)||''} ${s?.title||''} / ${nums.part.get(p?.id)||''} ${p?.title||''}`}
    if(state.selection.kind==='node'){const n=node(state.selection.id),p=part(n?.partId),s=stage(p?.stageId);return `${c.name} / ${nums.stage.get(s?.id)||''} ${s?.title||''} / ${nums.part.get(p?.id)||''} ${p?.title||''} / ${nums.node.get(n?.id)||''} ${n?.title||''}`}
    return c.name;
  }
  function renderEditor(){
    const item=selected(),kind=state.selection.kind;
    $('caEditorTitle').textContent=kind==='course'?'课程设置':kind==='stage'?'阶段设置':kind==='part'?'章节设置':'学习步骤设置';$('caEditorPath').textContent=pathText();
    $('caAddPartBtn').disabled=kind!=='stage';$('caAddNodeBtn').disabled=kind!=='part';$('caDeleteItemBtn').disabled=kind==='course';
    if(!item){$('caNodeFields').innerHTML='<div class="ca-empty">请选择课程结构项。</div>';return}
    if(kind==='course'){$('caNodeFields').innerHTML='<div class="ca-empty">课程基本信息请在上方编辑。请从左侧选择阶段、章节或学习步骤。</div>';$('caNodeActivities').hidden=true;return}
    let fields=`<div class="ca-form-grid"><label><span>内部 ID</span><input data-edit="id" value="${escapeHTML(item.id)}" disabled /></label><label><span>显示顺序</span><input type="number" min="1" data-edit="order" value="${Number(item.order)||1}" /></label><label class="wide"><span>${kind==='stage'?'阶段':kind==='part'?'章节':'学习步骤'}名称</span><input data-edit="title" value="${escapeHTML(item.title)}" /></label>`;
    if(kind==='node')fields+=`<label><span>学习步骤类型</span><select data-edit="nodeType"><option value="standard" ${item.nodeType==='standard'?'selected':''}>普通学习</option><option value="challenge" ${item.nodeType==='challenge'?'selected':''}>综合挑战</option><option value="deep_recall" ${item.nodeType==='deep_recall'?'selected':''}>深度回忆</option><option value="multi_question" ${item.nodeType==='multi_question'?'selected':''}>多题归纳</option><option value="knowledge_graph" ${item.nodeType==='knowledge_graph'?'selected':''}>知识图谱</option></select></label><label class="wide"><span>学习说明</span><textarea data-edit="description" rows="3">${escapeHTML(item.description||'')}</textarea></label>`;
    fields+='</div>';$('caNodeFields').innerHTML=fields;$('caNodeActivities').hidden=kind!=='node';if(kind==='node')renderAssignedActivities();
  }
  function renderAssignedActivities(){
    const n=selectedNode();if(!n)return;const library=Core.getActivityLibrary();$('caNodeActivityCount').textContent=`${n.activityIds.length} 项内容`;
    $('caAssignedActivities').innerHTML=n.activityIds.length?n.activityIds.map((id,index)=>{const activity=library[id];return `<div class="ca-assigned-item"><div class="order"><button type="button" data-move="-1" data-index="${index}" ${index===0?'disabled':''}>↑</button><button type="button" data-move="1" data-index="${index}" ${index===n.activityIds.length-1?'disabled':''}>↓</button></div><div><strong>${escapeHTML(activity?Core.activityTitle(activity):'内容不存在')}</strong><small>${escapeHTML(id)}${activity?.metadata?.knowledge?.primaryNodeId?' · '+escapeHTML(Core.pathLabel(activity.metadata.knowledge.taxonomyId,activity.metadata.knowledge.primaryNodeId)):''}</small></div><button type="button" data-remove-activity="${escapeHTML(id)}">移除</button></div>`}).join(''):'<div class="ca-empty">当前学习步骤还没有内容。</div>';
  }
  function renderKnowledgeFilter(){const c=course();if(!c)return;const nodes=Core.nodesForTaxonomy(c.taxonomyId);$('caKnowledgeFilter').innerHTML='<option value="">全部知识点</option>'+nodes.map(item=>`<option value="${escapeHTML(item.id)}" ${item.id===state.knowledgeId?'selected':''}>${escapeHTML(Core.pathLabel(c.taxonomyId,item.id))}</option>`).join('')}
  function pickerActivities(){const c=course(),n=selectedNode();if(!c)return [];let list=Core.getActivities({subjectId:c.subjectId,query:state.activityQuery});if(state.onlyMapped)list=list.filter(item=>item.metadata?.knowledge?.mappingStatus==='confirmed');if(state.knowledgeId){const ids=new Set([state.knowledgeId,...Core.descendantIds(c.taxonomyId,state.knowledgeId)]);list=list.filter(item=>ids.has(item.metadata?.knowledge?.primaryNodeId))}if(n){const assigned=new Set(n.activityIds);list=list.filter(item=>!assigned.has(item.id))}return list.slice(0,80)}
  function renderPicker(){const n=selectedNode(),list=pickerActivities();$('caActivityPicker').innerHTML=!n?'<div class="ca-empty">请先选择一个学习步骤，再添加题目或训练内容。</div>':list.length?list.map(activity=>`<article class="ca-picker-item"><strong>${escapeHTML(Core.activityTitle(activity))}</strong><small>${escapeHTML(activity.id)} · ${escapeHTML(activity.type)}${activity.metadata?.knowledge?.primaryNodeId?' · '+escapeHTML(Core.pathLabel(activity.metadata.knowledge.taxonomyId,activity.metadata.knowledge.primaryNodeId)):''}</small><button type="button" data-add-activity="${escapeHTML(activity.id)}">＋ 加入学习步骤</button></article>`).join(''):'<div class="ca-empty">没有可添加的题目或训练内容。</div>'}

  function previewContext(){
    const c=course();if(!c)return null;
    if(state.selection.kind==='node')return part(node(state.selection.id)?.partId);
    if(state.selection.kind==='part')return part(state.selection.id);
    if(state.selection.kind==='stage')return partsOf(state.selection.id)[0]||null;
    const current=ensureCurrentStage();return current?partsOf(current.id)[0]||null:null;
  }
  function chapterPreviewMarkup(p,{detailed=false}={}){
    if(!p)return '<div class="ca-empty">暂无可预览章节。</div>';
    const nums=numbering(),s=stage(p.stageId),nodes=nodesOf(p.id),library=Core.getActivityLibrary();
    return `<div class="preview-current ${detailed?'detailed':''}"><div class="preview-current-head"><strong>${escapeHTML(nums.part.get(p.id)||'')} ${escapeHTML(p.title)}</strong><small>${escapeHTML(nums.stage.get(s?.id)||'')} ${escapeHTML(s?.title||'')}</small></div>${nodes.length?nodes.map(n=>{const activities=(n.activityIds||[]).map(id=>library[id]).filter(Boolean);return `<div class="preview-node"><b>${escapeHTML(nums.node.get(n.id)||'')}</b><span><strong>${escapeHTML(n.title)}</strong>${detailed&&n.description?`<em>${escapeHTML(n.description)}</em>`:''}${detailed&&activities.length?`<span class="preview-activities">${activities.map(a=>`<i>${escapeHTML(Core.activityTitle(a))}</i>`).join('')}</span>`:''}</span><small>${n.activityIds.length} 项内容</small></div>`}).join(''):'<div class="ca-empty">当前章节尚无学习步骤。</div>'}</div>`;
  }
  function renderChapterDialog(){
    const dialog=$('caChapterPreviewDialog');if(!dialog)return;const p=previewContext(),nums=numbering(),s=p?stage(p.stageId):null;
    $('caChapterPreviewTitle').textContent=p?`${nums.part.get(p.id)||''} ${p.title}`:'当前章节预览';
    $('caChapterPreviewPath').textContent=p&&s?`${nums.stage.get(s.id)||''} ${s.title} · ${nodesOf(p.id).length} 个学习步骤`:'';
    $('caChapterPreviewBody').innerHTML=chapterPreviewMarkup(p,{detailed:true});
    const parts=allParts(),index=p?parts.findIndex(item=>item.id===p.id):-1;
    $('caPreviewPrevPartBtn').disabled=index<=0;$('caPreviewNextPartBtn').disabled=index<0||index>=parts.length-1;
  }
  function renderPreview(){
    const c=course();if(!c)return;const validation=Core.validateCourse(c);
    $('caValidationSummary').innerHTML=validation.errors.length?`<span class="validation-error">${validation.errors.length} 个错误</span>`:validation.warnings.length?`<span class="validation-warn">可发布 · ${validation.warnings.length} 个提醒</span>`:'<span class="validation-ok">结构校验通过</span>';
    $('caPreviewTree').innerHTML=chapterPreviewMarkup(previewContext());
    const coverage=Core.courseKnowledgeCoverage(c);$('caCoverage').innerHTML=coverage.length?coverage.sort((a,b)=>b.activityCount-a.activityCount).slice(0,12).map(item=>`<div class="coverage-item"><strong>${escapeHTML(item.path)}</strong><small>${item.activityCount} 项内容</small></div>`).join(''):'<div class="ca-empty">课程内容尚未形成知识覆盖。</div>';
    const releases=Core.getCourseReleases().filter(item=>item.course?.id===c.id).sort((a,b)=>b.version-a.version);$('caReleases').innerHTML=releases.length?releases.slice(0,8).map(item=>`<div class="release-item"><strong>v${item.version} · ${escapeHTML(item.publishedBy?.name||'')}</strong><small>${escapeHTML(item.publishedAt)}<br>${escapeHTML(item.notes||'无发布说明')}</small></div>`).join(''):'<div class="ca-empty">尚未发布版本。</div>';
    if($('caChapterPreviewDialog')?.open)renderChapterDialog();
  }

  function currentPart(){return previewContext()}
  function movePart(delta,{openPreview=false}={}){
    const list=allParts(),current=currentPart(),index=current?list.findIndex(item=>item.id===current.id):-1,target=list[index+delta];if(!target)return false;
    const firstNode=nodesOf(target.id)[0];setSelection(firstNode?{kind:'node',id:firstNode.id}:{kind:'part',id:target.id},{scroll:true});
    if(openPreview)renderChapterDialog();return true;
  }
  function flattenedItems(){
    const result=[];stages().forEach(s=>{result.push({kind:'stage',id:s.id});partsOf(s.id).forEach(p=>{result.push({kind:'part',id:p.id});nodesOf(p.id).forEach(n=>result.push({kind:'node',id:n.id}))})});return result;
  }
  function jumpByStatus(type){
    const index=issueIndex(),items=flattenedItems().filter(item=>type==='incomplete'?statusFor(item.kind,item.id,index).incomplete:statusFor(item.kind,item.id,index).issue.length);
    if(!items.length){toast(type==='incomplete'?'当前课程没有待配置项目。':'当前课程没有可定位的结构问题。');return}
    const currentIndex=items.findIndex(item=>item.kind===state.selection.kind&&item.id===state.selection.id),target=items[(currentIndex+1+items.length)%items.length];setSelection(target);toast(type==='incomplete'?'已定位到下一项待配置内容。':'已定位到下一项结构问题。');
  }
  function renderNavigationState(){
    const list=allParts(),p=currentPart(),index=p?list.findIndex(item=>item.id===p.id):-1;
    if($('caPrevPartBtn'))$('caPrevPartBtn').disabled=index<=0;if($('caNextPartBtn'))$('caNextPartBtn').disabled=index<0||index>=list.length-1;
    const statuses=issueIndex(),items=flattenedItems();
    const incompleteCount=items.filter(item=>statusFor(item.kind,item.id,statuses).incomplete).length,issueCount=items.filter(item=>statusFor(item.kind,item.id,statuses).issue.length).length;
    if($('caJumpIncompleteBtn'))$('caJumpIncompleteBtn').textContent=`待配置 ${incompleteCount}`;
    if($('caJumpIssueBtn'))$('caJumpIssueBtn').textContent=`有问题 ${issueCount}`;
  }

  function templateTargets(){
    const scope=$('caTemplateScope')?.value||'current_part';
    if(scope==='current_stage')return partsOf(ensureCurrentStage()?.id||'');
    if(scope==='all_empty_parts')return allParts().filter(item=>nodesOf(item.id).length===0);
    const current=previewContext();return current?[current]:[];
  }
  function renderBatchToolOptions(){
    if(!$('caTemplateSelect'))return;
    const templates=P2?.COURSE_TEMPLATES||{};
    $('caTemplateSelect').innerHTML=Object.values(templates).map(item=>`<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)}</option>`).join('');
    $('caCopyTargetStage').innerHTML=stages().map(item=>`<option value="${escapeHTML(item.id)}" ${item.id===ensureCurrentStage()?.id?'selected':''}>${escapeHTML(numbering().stage.get(item.id)||'')} ${escapeHTML(item.title)}</option>`).join('');
    updateTemplateDescription();updateCopyTargetVisibility();
  }
  function updateTemplateDescription(){
    const template=P2?.COURSE_TEMPLATES?.[$('caTemplateSelect')?.value];
    if($('caTemplateDescription'))$('caTemplateDescription').innerHTML=template?`<strong>${escapeHTML(template.name)}</strong><span>${escapeHTML(template.description)} · ${template.steps.length} 个学习步骤</span>`:'没有可用模板。';
  }
  function updateCopyTargetVisibility(){if($('caCopyTargetWrap'))$('caCopyTargetWrap').hidden=$('caCopyKind')?.value==='stage'}
  function openBatchTools(){renderBatchToolOptions();state.outlinePreview=null;if($('caOutlineReport'))$('caOutlineReport').textContent='等待输入课程大纲。';if($('caApplyOutlineBtn'))$('caApplyOutlineBtn').disabled=true;$('caBatchToolsDialog')?.showModal()}
  function applyTemplate(){
    const template=P2?.COURSE_TEMPLATES?.[$('caTemplateSelect')?.value],targets=templateTargets(),c=course();if(!template||!c)return toast('没有可用模板。');if(!targets.length)return toast('当前范围没有可套用模板的章节。');
    const added=[];targets.forEach(p=>{const existing=new Set(nodesOf(p.id).map(item=>`${clean(item.title).toLowerCase()}::${item.nodeType}`));template.steps.forEach(step=>{const key=`${clean(step.title).toLowerCase()}::${step.nodeType}`;if(existing.has(key))return;const item={id:Core.safeId('node'),partId:p.id,title:step.title,order:nodesOf(p.id).length+1,nodeType:step.nodeType,activityIds:[],description:'',settings:{templateId:template.id}};c.nodes.push(item);existing.add(key);added.push(item)})});
    if(!added.length)return toast('所选章节已经包含该模板的全部步骤。');normalizeOrders();persist();const first=added[0];state.selection={kind:'node',id:first.id};ensureSelectionVisible();recordRecent(`套用模板：${template.name}`,state.selection);renderAll();toast(`已向 ${targets.length} 个章节新增 ${added.length} 个学习步骤。`);
  }
  function cloneCurrentStructure(){
    const c=course();if(!c)return;const kind=$('caCopyKind')?.value==='stage'?'stage':'part',count=Math.max(1,Math.min(20,Number($('caCopyCount')?.value)||1)),includeActivities=$('caCopyActivities')?.checked!==false;let firstSelection=null,createdCount=0;
    if(kind==='part'){
      const source=previewContext(),target=stage($('caCopyTargetStage')?.value)||ensureCurrentStage();if(!source||!target)return toast('请先选择要复制的章节和目标阶段。');
      for(let copyIndex=1;copyIndex<=count;copyIndex++){
        const newPart={id:Core.safeId('part'),stageId:target.id,title:`${source.title}（副本 ${copyIndex}）`,order:partsOf(target.id).length+1};c.parts.push(newPart);const clonedNodes=nodesOf(source.id).map((sourceNode,index)=>({id:Core.safeId('node'),partId:newPart.id,title:sourceNode.title,order:index+1,nodeType:sourceNode.nodeType,activityIds:includeActivities?[...(sourceNode.activityIds||[])]:[],description:sourceNode.description||'',settings:Core.clone(sourceNode.settings||{})}));c.nodes.push(...clonedNodes);createdCount+=1+clonedNodes.length;if(!firstSelection)firstSelection=clonedNodes[0]?{kind:'node',id:clonedNodes[0].id}:{kind:'part',id:newPart.id};
      }
    }else{
      const source=ensureCurrentStage();if(!source)return toast('请先选择要复制的阶段。');const sourceParts=partsOf(source.id);
      for(let copyIndex=1;copyIndex<=count;copyIndex++){
        const newStage={id:Core.safeId('stage'),title:`${source.title}（副本 ${copyIndex}）`,order:stages().length+1};c.stages.push(newStage);createdCount+=1;
        sourceParts.forEach((sourcePart,partIndex)=>{const newPart={id:Core.safeId('part'),stageId:newStage.id,title:sourcePart.title,order:partIndex+1};c.parts.push(newPart);createdCount+=1;const clonedNodes=nodesOf(sourcePart.id).map((sourceNode,index)=>({id:Core.safeId('node'),partId:newPart.id,title:sourceNode.title,order:index+1,nodeType:sourceNode.nodeType,activityIds:includeActivities?[...(sourceNode.activityIds||[])]:[],description:sourceNode.description||'',settings:Core.clone(sourceNode.settings||{})}));c.nodes.push(...clonedNodes);createdCount+=clonedNodes.length;if(!firstSelection)firstSelection=clonedNodes[0]?{kind:'node',id:clonedNodes[0].id}:{kind:'part',id:newPart.id}});
      }
    }
    normalizeOrders();persist();if(firstSelection){state.selection=firstSelection;ensureSelectionVisible();recordRecent(kind==='part'?'批量复制章节':'批量复制阶段',firstSelection)}renderAll();toast(`已生成 ${count} 份副本，共新增 ${createdCount} 个课程项。`);
  }
  function parseOutlinePreview(){
    const parsed=P2?.parseCourseOutline?.($('caOutlineInput')?.value||'');state.outlinePreview=parsed;if(!parsed)return;
    $('caApplyOutlineBtn').disabled=!!parsed.errors.length||!parsed.counts.stages;
    $('caOutlineReport').innerHTML=`<strong>${parsed.errors.length?'解析失败':'解析通过'}</strong><span>${parsed.counts.stages} 个阶段 · ${parsed.counts.parts} 个章节 · ${parsed.counts.nodes} 个学习步骤${parsed.errors.length?' · '+escapeHTML(parsed.errors.join('；')):''}${parsed.warnings.length?' · '+escapeHTML(parsed.warnings.join('；')):''}</span>`;
  }
  function applyOutline(){
    const parsed=state.outlinePreview||P2?.parseCourseOutline?.($('caOutlineInput')?.value||''),c=course();if(!parsed||parsed.errors.length||!c)return toast('请先完成有效的大纲解析。');let firstSelection=null,created=0;
    parsed.stages.forEach(stageSpec=>{const newStage={id:Core.safeId('stage'),title:stageSpec.title,order:c.stages.length+1};c.stages.push(newStage);created+=1;stageSpec.parts.forEach((partSpec,partIndex)=>{const newPart={id:Core.safeId('part'),stageId:newStage.id,title:partSpec.title,order:partIndex+1};c.parts.push(newPart);created+=1;partSpec.nodes.forEach((nodeSpec,nodeIndex)=>{const newNode={id:Core.safeId('node'),partId:newPart.id,title:nodeSpec.title,order:nodeIndex+1,nodeType:nodeSpec.nodeType,activityIds:[],description:'',settings:{generatedBy:'outline-p2'}};c.nodes.push(newNode);created+=1;if(!firstSelection)firstSelection={kind:'node',id:newNode.id}});if(!firstSelection)firstSelection={kind:'part',id:newPart.id}});if(!firstSelection)firstSelection={kind:'stage',id:newStage.id}});
    normalizeOrders();persist();if(firstSelection){state.selection=firstSelection;ensureSelectionVisible();recordRecent('按大纲生成课程结构',firstSelection)}renderAll();$('caBatchToolsDialog')?.close();toast(`已按大纲新增 ${created} 个课程项。`);
  }
  function renderRecent(){
    const list=$('caRecentList');if(!list)return;const entries=readRecent().filter(item=>item.courseId===state.courseId&&selectionExists({kind:item.kind,id:item.id}));
    list.innerHTML=entries.length?entries.map(item=>`<button type="button" class="ca-p2-list-item" data-recent-kind="${item.kind}" data-recent-id="${escapeHTML(item.id)}"><b>${escapeHTML(item.action)}</b><span>${escapeHTML(item.path||item.title)}</span><small>${escapeHTML(new Date(item.updatedAt).toLocaleString('zh-CN',{hour12:false}))}</small></button>`).join(''):'<div class="ca-empty">当前课程还没有最近编辑记录。</div>';
  }
  function openRecent(){renderRecent();$('caRecentDialog')?.showModal()}
  function validationEntries(){
    const index=issueIndex(),nums=numbering(),entries=[];
    flattenedItems().forEach(item=>{const status=statusFor(item.kind,item.id,index),title=selectionTitle(item),number=nums[item.kind]?.get(item.id)||'';status.issue.forEach(message=>entries.push({severity:'issue',kind:item.kind,id:item.id,number,title,message}));if(status.incomplete)entries.push({severity:'incomplete',kind:item.kind,id:item.id,number,title,message:item.kind==='stage'?'阶段还没有章节':item.kind==='part'?'章节还没有学习步骤':'学习步骤还没有题目或训练内容'})});
    const core=Core.validateCourse(course());core.errors.forEach(message=>{if(!entries.some(item=>item.message===message))entries.unshift({severity:'issue',kind:'course',id:course().id,number:'',title:course().name,message})});core.warnings.forEach(message=>entries.push({severity:'warning',kind:'course',id:course().id,number:'',title:course().name,message}));return entries;
  }
  function renderValidationDialog(){
    const entries=validationEntries(),filter=state.validationFilter,list=$('caValidationList');if(!list)return;const issues=entries.filter(item=>item.severity==='issue').length,incomplete=entries.filter(item=>item.severity==='incomplete').length,warnings=entries.filter(item=>item.severity==='warning').length;
    $('caValidationDialogSummary').textContent=issues?`${issues} 个错误 · ${incomplete} 项待配置 · ${warnings} 个提醒`:`没有结构错误 · ${incomplete} 项待配置 · ${warnings} 个提醒`;
    const visible=filter==='all'?entries:entries.filter(item=>item.severity===filter);list.innerHTML=visible.length?visible.slice(0,300).map(item=>`<button type="button" class="ca-p2-list-item ${item.severity}" data-validation-kind="${item.kind}" data-validation-id="${escapeHTML(item.id)}"><b>${item.severity==='issue'?'错误':item.severity==='incomplete'?'待配置':'提醒'}${item.number?' · '+escapeHTML(item.number):''}</b><span>${escapeHTML(item.title)}：${escapeHTML(item.message)}</span><small>${item.kind==='stage'?'阶段':item.kind==='part'?'章节':item.kind==='node'?'学习步骤':'课程'}</small></button>`).join(''):'<div class="ca-empty">当前筛选下没有项目。</div>';
    document.querySelectorAll('[data-validation-filter]').forEach(button=>button.classList.toggle('active',button.dataset.validationFilter===filter));
  }
  function openValidation(){state.validationFilter='all';renderValidationDialog();$('caValidationDialog')?.showModal()}

  function renderAll(){renderCourseBar();renderStructure();renderEditor();renderKnowledgeFilter();renderPicker();renderPreview();renderNavigationState()}
  function persist(silent=true){const c=course();if(!c)return;Core.saveCourseDraft(c);state.courses=Core.getCourseDrafts();saveWorkspaceState();if(!silent)toast('课程草稿已保存。');renderPreview()}
  function addStage(){const c=course();if(!c)return;const item={id:Core.safeId('stage'),title:`新阶段 ${c.stages.length+1}`,order:c.stages.length+1};c.stages.push(item);state.selection={kind:'stage',id:item.id};state.currentStageId=item.id;state.expandedStages.add(item.id);persist();recordRecent('新增阶段',state.selection);renderAll()}
  function addPart(){const c=course(),s=stage(state.selection.id)||stage(state.currentStageId);if(!c||!s)return;const count=c.parts.filter(item=>item.stageId===s.id).length;const item={id:Core.safeId('part'),stageId:s.id,title:`新章节 ${count+1}`,order:count+1};c.parts.push(item);state.selection={kind:'part',id:item.id};state.currentStageId=s.id;state.expandedParts.clear();state.expandedParts.add(item.id);persist();recordRecent('新增章节',state.selection);renderAll()}
  function addNode(){const c=course(),p=part(state.selection.id);if(!c||!p)return;const count=c.nodes.filter(item=>item.partId===p.id).length;const item={id:Core.safeId('node'),partId:p.id,title:`新学习步骤 ${count+1}`,order:count+1,nodeType:'standard',activityIds:[],description:'',settings:{}};c.nodes.push(item);state.selection={kind:'node',id:item.id};state.expandedParts.clear();ensureSelectionVisible();persist();recordRecent('新增学习步骤',state.selection);renderAll()}
  function deleteSelection(){
    const c=course();if(!c||state.selection.kind==='course')return;if(!confirm('删除当前课程项？其下级内容也会一并删除。'))return;
    if(state.selection.kind==='stage'){const partIds=new Set(c.parts.filter(p=>p.stageId===state.selection.id).map(p=>p.id));c.stages=c.stages.filter(s=>s.id!==state.selection.id);c.parts=c.parts.filter(p=>!partIds.has(p.id));c.nodes=c.nodes.filter(n=>!partIds.has(n.partId))}
    else if(state.selection.kind==='part'){c.parts=c.parts.filter(p=>p.id!==state.selection.id);c.nodes=c.nodes.filter(n=>n.partId!==state.selection.id)}
    else c.nodes=c.nodes.filter(n=>n.id!==state.selection.id);
    chooseInitialSelection();persist();renderAll();
  }
  function newCourse(){const preferred=Core.subjectById(localStorage.getItem(SUBJECT_PREF_KEY)),subject=preferred||subjects()[0],taxonomy=Core.defaultTaxonomyForSubject(subject.id);const c=Core.normalizeCourse({id:Core.safeId('course'),name:'新课程',subjectId:subject.id,taxonomyId:taxonomy?.id||'',description:'',stages:[],parts:[],nodes:[]});Core.saveCourseDraft(c);state.courses=Core.getCourseDrafts();state.courseId=c.id;state.expandedStages.clear();state.expandedParts.clear();state.selection={kind:'course',id:c.id};state.currentStageId='';state.treeScrollTop=0;renderAll();saveWorkspaceState();toast('新课程草稿已创建。')}
  function deleteCourse(){if(state.courses.length<=1)return toast('至少保留一个课程草稿。');if(!confirm('删除当前课程草稿？已发布版本不会删除。'))return;Core.deleteCourseDraft(state.courseId);state.courses=Core.getCourseDrafts();state.courseId=state.courses[0]?.id||'';state.expandedStages.clear();state.expandedParts.clear();state.treeScrollTop=0;if(!restoreWorkspaceState())chooseInitialSelection();renderAll()}
  function openPublish(){persist();const result=Core.validateCourse(course());$('caPublishWarnings').innerHTML=[...result.errors.map(item=>`<p class="validation-error">错误：${escapeHTML(item)}</p>`),...result.warnings.map(item=>`<p class="validation-warn">提醒：${escapeHTML(item)}</p>`)].join('')||'<p class="validation-ok">课程结构校验通过，可以发布。</p>';$('caConfirmPublishBtn').disabled=!result.valid;$('caPublishDialog').showModal()}
  function publish(){const result=Core.publishCourse(state.courseId,$('caPublishNotes').value);if(!result.valid)return toast('发布失败：'+(result.errors||[]).join('；'));$('caPublishDialog').close();$('caPublishNotes').value='';renderPreview();toast(`课程 v${result.release.version} 已发布。`)}
  function exportCourse(){persist();const c=course(),payload={schemaVersion:1,exportedAt:new Date().toISOString(),course:c,knowledgeCoverage:Core.courseKnowledgeCoverage(c)},blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${c.id}-draft.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)}

  function bind(){
    $('caCourseSelect').addEventListener('change',event=>{persist();state.courseId=event.target.value;state.expandedStages.clear();state.expandedParts.clear();state.treeScrollTop=0;if(!restoreWorkspaceState())chooseInitialSelection();renderAll()});
    $('caCourseName').addEventListener('input',event=>{course().name=event.target.value;persist();scheduleRecent('编辑课程信息');renderStructure()});$('caDescription').addEventListener('input',event=>{course().description=event.target.value;persist();scheduleRecent('编辑课程信息')});
    $('caSubject').addEventListener('change',event=>{course().subjectId=event.target.value;localStorage.setItem(SUBJECT_PREF_KEY,event.target.value);course().taxonomyId=Core.defaultTaxonomyForSubject(event.target.value)?.id||'';state.knowledgeId='';persist();renderAll()});$('caTaxonomy').addEventListener('change',event=>{course().taxonomyId=event.target.value;state.knowledgeId='';persist();renderKnowledgeFilter();renderPicker();renderPreview()});
    $('caStageSelector').addEventListener('change',event=>{const s=stage(event.target.value);if(!s)return;state.currentStageId=s.id;const firstPart=partsOf(s.id)[0],firstNode=firstPart?nodesOf(firstPart.id)[0]:null;state.selection=firstNode?{kind:'node',id:firstNode.id}:firstPart?{kind:'part',id:firstPart.id}:{kind:'stage',id:s.id};state.expandedParts.clear();ensureSelectionVisible();state.treeScrollTop=0;renderStructure();renderEditor();renderPicker();renderPreview();saveWorkspaceState()});
    $('caStructureSearch').addEventListener('input',event=>{state.structureQuery=event.target.value;renderSearchResults()});
    $('caStructureSearch').addEventListener('keydown',event=>{if(event.key==='Escape'){state.structureQuery='';event.target.value='';renderSearchResults()}});
    $('caStructureSearchResults').addEventListener('click',event=>{const button=event.target.closest('[data-search-kind]');if(!button)return;state.structureQuery='';$('caStructureSearch').value='';renderSearchResults();setSelection({kind:button.dataset.searchKind,id:button.dataset.searchId})});
    $('caStructureFilter').addEventListener('change',event=>{state.structureFilter=event.target.value;state.treeScrollTop=0;renderStructure();saveWorkspaceState()});
    $('caPrevPartBtn').addEventListener('click',()=>movePart(-1));$('caNextPartBtn').addEventListener('click',()=>movePart(1));$('caJumpIncompleteBtn').addEventListener('click',()=>jumpByStatus('incomplete'));$('caJumpIssueBtn').addEventListener('click',()=>jumpByStatus('issue'));
    $('caStructureTree').addEventListener('scroll',event=>{state.treeScrollTop=event.currentTarget.scrollTop;clearTimeout(scrollSaveTimer);scrollSaveTimer=setTimeout(saveWorkspaceState,120)},{passive:true});
    $('caStructureTree').addEventListener('click',event=>{
      const toggle=event.target.closest('[data-toggle-kind]');if(toggle){const id=toggle.dataset.toggleId,set=toggle.dataset.toggleKind==='stage'?state.expandedStages:state.expandedParts;if(set.has(id))set.delete(id);else set.add(id);renderStructure();saveWorkspaceState();return}
      const button=event.target.closest('[data-kind]');if(button)setSelection({kind:button.dataset.kind,id:button.dataset.id});
    });
    $('caNodeFields').addEventListener('input',event=>{const key=event.target.dataset.edit;if(!key)return;const item=selected();item[key]=key==='order'?Number(event.target.value)||1:event.target.value;persist();scheduleRecent('编辑课程结构');renderStructure();renderPreview()});$('caNodeFields').addEventListener('change',event=>{const key=event.target.dataset.edit;if(!key)return;selected()[key]=event.target.value;persist();recordRecent('编辑课程结构');renderStructure();renderPreview()});
    $('caAddStageBtn').addEventListener('click',addStage);$('caAddPartBtn').addEventListener('click',addPart);$('caAddNodeBtn').addEventListener('click',addNode);$('caDeleteItemBtn').addEventListener('click',deleteSelection);$('caNewCourseBtn').addEventListener('click',newCourse);$('caDeleteCourseBtn').addEventListener('click',deleteCourse);$('caSaveBtn').addEventListener('click',()=>persist(false));$('caExportBtn').addEventListener('click',exportCourse);$('caPublishBtn').addEventListener('click',openPublish);$('caConfirmPublishBtn').addEventListener('click',publish);
    $('caAssignedActivities').addEventListener('click',event=>{const n=selectedNode();if(!n)return;const remove=event.target.closest('[data-remove-activity]');if(remove){n.activityIds=n.activityIds.filter(id=>id!==remove.dataset.removeActivity);persist();recordRecent('移除学习内容');renderEditor();renderPicker();renderStructure();renderPreview();return}const move=event.target.closest('[data-move]');if(move){const index=Number(move.dataset.index),target=index+Number(move.dataset.move);if(target>=0&&target<n.activityIds.length)[n.activityIds[index],n.activityIds[target]]=[n.activityIds[target],n.activityIds[index]];persist();recordRecent('调整内容顺序');renderEditor();renderPreview()}});
    $('caActivityPicker').addEventListener('click',event=>{const button=event.target.closest('[data-add-activity]'),n=selectedNode();if(!button||!n)return;if(!n.activityIds.includes(button.dataset.addActivity))n.activityIds.push(button.dataset.addActivity);persist();recordRecent('加入题目或训练');renderEditor();renderPicker();renderStructure();renderPreview()});$('caActivitySearch').addEventListener('input',event=>{state.activityQuery=event.target.value;renderPicker();saveWorkspaceState()});$('caKnowledgeFilter').addEventListener('change',event=>{state.knowledgeId=event.target.value;renderPicker();saveWorkspaceState()});$('caOnlyMapped').addEventListener('change',event=>{state.onlyMapped=event.target.checked;renderPicker();saveWorkspaceState()});
    $('caBatchToolsBtn')?.addEventListener('click',openBatchTools);$('caRecentBtn')?.addEventListener('click',openRecent);$('caValidationBtn')?.addEventListener('click',openValidation);
    $('caTemplateSelect')?.addEventListener('change',updateTemplateDescription);$('caCopyKind')?.addEventListener('change',updateCopyTargetVisibility);$('caApplyTemplateBtn')?.addEventListener('click',applyTemplate);$('caCopyStructureBtn')?.addEventListener('click',cloneCurrentStructure);$('caParseOutlineBtn')?.addEventListener('click',parseOutlinePreview);$('caApplyOutlineBtn')?.addEventListener('click',applyOutline);
    $('caRecentList')?.addEventListener('click',event=>{const button=event.target.closest('[data-recent-kind]');if(!button)return;$('caRecentDialog').close();setSelection({kind:button.dataset.recentKind,id:button.dataset.recentId})});$('caClearRecentBtn')?.addEventListener('click',()=>{writeRecent(readRecent().filter(item=>item.courseId!==state.courseId));renderRecent();toast('已清空当前课程的最近编辑记录。')});
    document.querySelectorAll('[data-validation-filter]').forEach(button=>button.addEventListener('click',()=>{state.validationFilter=button.dataset.validationFilter;renderValidationDialog()}));$('caValidationList')?.addEventListener('click',event=>{const button=event.target.closest('[data-validation-kind]');if(!button||button.dataset.validationKind==='course')return;$('caValidationDialog').close();setSelection({kind:button.dataset.validationKind,id:button.dataset.validationId})});
    $('caOpenChapterPreviewBtn').addEventListener('click',()=>{renderChapterDialog();$('caChapterPreviewDialog').showModal()});$('caPreviewPrevPartBtn').addEventListener('click',()=>movePart(-1,{openPreview:true}));$('caPreviewNextPartBtn').addEventListener('click',()=>movePart(1,{openPreview:true}));
    window.addEventListener('beforeunload',saveWorkspaceState);
  }
  function init(){
    state.courses=Core.getCourseDrafts();state.courseId=state.courses[0]?.id||'';
    if(!restoreWorkspaceState())chooseInitialSelection();const current=course();if(current)localStorage.setItem(SUBJECT_PREF_KEY,current.subjectId);
    bind();renderAll();
  }
  document.addEventListener('DOMContentLoaded',init);
})();
