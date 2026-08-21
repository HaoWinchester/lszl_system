function refreshHeader(){
  document.getElementById('hdrTree').textContent='知识树 '+(state.knowledgeTree?.nodes.length||0);
  document.getElementById('hdrRecall').textContent='联想库 '+state.recallLibrary.nodes.length;
  document.getElementById('hdrQuestions').textContent='题目 '+state.questionBank.questions.length;
  const creator=prepRuntime.creatorProfile?.name||'未选择';const hdrCreator=document.getElementById('hdrCreator');if(hdrCreator)hdrCreator.textContent='制作人：'+creator;
  document.getElementById('baseTreeCount').textContent=state.knowledgeTree?.nodes.length||0;
  document.getElementById('baseTreeName').textContent=state.knowledgeTree?.name||'未加载';
  document.getElementById('baseRecallCount').textContent=state.recallLibrary.nodes.length;
  document.getElementById('baseRecallInfo').textContent=state.recallLibrary.nodes.length?`${state.recallLibrary.edges.length} 条关系`:'未加载';
  document.getElementById('baseQuestionCount').textContent=state.questionBank.questions.length;
  document.getElementById('baseQuestionName').textContent=state.questionBank.name||'未加载';
  if(document.getElementById('basePrincipleCount'))document.getElementById('basePrincipleCount').textContent=state.principles.items.length;
  if(document.getElementById('basePresetInfo'))document.getElementById('basePresetInfo').textContent=`归纳卡 ${state.synthesisPresets.items.length}`;
  if(document.getElementById('baseTagCount'))document.getElementById('baseTagCount').textContent=tagCatalogEntries().length;
}
function setTab(name){
  document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.id==='tab-'+name));
  if(name==='validate')runValidation();
  if(name==='association')renderRecallAcceptance();
  if(name==='management'){renderPrincipleList();renderPrincipleEditor();renderTagManager()}
  if(name==='demo')renderDemoValidation();
  if(name==='export')renderAuditTrail();
}

function currentQuestionLeaseState(){
  const q=currentQuestion(),lease=prepRuntime.editLeaseState||{};
  if(!q?.serverRevision)return {mode:'local-new',readOnly:false,canSave:true,message:'本地新题无需编辑锁'};
  if(lease.questionId!==q.id)return {mode:'server-readonly',readOnly:true,canSave:false,message:'正在确认服务器编辑权…'};
  return lease;
}
function renderQuestionLockState(){
  const lease=currentQuestionLeaseState(),banner=document.getElementById('questionLockBanner');if(!banner)return;
  const messages={
    'local-new':'本地新题无需编辑锁',
    'server-editable':`已锁定当前题目 · ${lease.leaseSeconds||300} 秒租约`,
    'server-readonly':lease.message||'该题正由其他人编辑，当前为只读',
    'offline-unsynced':lease.message||'连接中断，本地修改仍会保存在工作区',
    'conflict-copy-required':lease.message||'编辑锁或版本已失效，请复制为新题'
  };
  banner.className=`question-lock-banner ${lease.mode||'server-readonly'} ${lease.readOnly?'bad':lease.connection==='unstable'||lease.connection==='offline'?'warn':'good'}`;
  document.getElementById('questionLockMessage').textContent=messages[lease.mode]||lease.message||'正在确认编辑状态';
  const readOnly=!!lease.readOnly,tab=document.getElementById('tab-questions');tab?.classList.toggle('question-edit-readonly',readOnly);
  document.querySelectorAll('#questionEditor input,#questionEditor textarea,#questionEditor select,#keywordList input,#keywordList textarea,#keywordList select,#keywordList button').forEach(control=>control.disabled=readOnly);
  for(const id of ['btnDeleteQuestion','btnAddNormalKeyword','btnAddCoreKeyword']){const control=document.getElementById(id);if(control)control.disabled=readOnly}
}
async function switchQuestionForEdit(question){
  if(window.PMPPrepQuestionLocks)await window.PMPPrepQuestionLocks.switchTo(question);
}

async function newQuestion(){
  await switchQuestionForEdit(null);
  const q=QuestionService.create({
    title:'新题目',subject:state.questionBank.subject||'PMP',
    options:[{id:'A',text:''},{id:'B',text:''},{id:'C',text:''},{id:'D',text:''}],correctAnswer:'A',
    translations:{en:{title:'',stemParts:[{text:''}],options:[{id:'A',text:''},{id:'B',text:''},{id:'C',text:''},{id:'D',text:''}],analysis:''}},
    metadata:{knowledge:{primaryNodeId:'',relatedNodeIds:[],mappingStatus:'unmapped',pathSnapshot:[]}}
  },state.questionBank.subject);
  stampQuestionOrigin(q,{batchId:generateBatchId(),source:'manual-new',forceOrigin:true});
  state.questionBank.questions.push(q);state.currentQuestionId=q.id;state.questionBank.updatedAt=Date.now();renderQuestions();toast('已新建题目 · 全局 ID 已生成');
}
async function duplicateQuestion(){
  const q=currentQuestion();if(!q)return;
  await switchQuestionForEdit(null);
  const copy=QuestionService.duplicatePayload(q);copy.title=q.title+'（副本）';
  state.questionBank.questions.push(copy);state.currentQuestionId=copy.id;renderQuestions();toast('已复制 · 新全局 ID 已生成');
}
async function deleteQuestion(){
  const q=currentQuestion();if(!q)return;if(!confirm('删除当前草稿题目？不会影响正式程序。'))return;
  await switchQuestionForEdit(null);
  state.questionBank.questions=state.questionBank.questions.filter(x=>x.id!==q.id);
  state.currentQuestionId=state.questionBank.questions[0]?.id||'';renderQuestions();
}
function questionCompleteness(q){
  const issues=validateQuestion(q,false);const err=issues.some(x=>x.level==='error'),warn=issues.some(x=>x.level==='warn');
  return err?'bad':warn?'warn':'ok';
}
function renderQuestionListOnly(){
  refreshHeader();
  const list=document.getElementById('questionList');if(!list)return;list.innerHTML='';
  document.getElementById('qCount').textContent=state.questionBank.questions.length+' 题';
  state.questionBank.questions.forEach((q,i)=>{
    const d=document.createElement('div');d.className='list-item'+(q.id===state.currentQuestionId?' active':'')+(typeof familyListClass==='function'&&familyListClass(q)?' '+familyListClass(q):'');
    const st=questionCompleteness(q);
    const fam=questionFamily(q);
    const famBadge=fam.role==='standalone'?'':`<span class="family-badge family-${fam.role}" title="${fam.role==='root'?'母题':'家族成员'} ${esc(fam.familyKey)}">【${fam.role==='root'?'母题':'成员'}${fam.role==='member'&&fam.equivalenceGrade?'·'+fam.equivalenceGrade:''}】</span>`;
    d.innerHTML=`<div class="list-title"><span class="status-dot ${st}"></span>${i+1}. ${famBadge}${esc(q.title)}</div><div class="list-meta">${esc(q.id)} · ${esc(q.difficulty||'')}${fam.role!=='standalone'?' · L'+fam.difficultyLevel:''}</div>`;
    d.onclick=async()=>{if(q.id===state.currentQuestionId)return;await switchQuestionForEdit(q);state.currentQuestionId=q.id;renderQuestions()};
    d.ondblclick=e=>{e.preventDefault();openQuestionPreviewFloat()};
    list.appendChild(d);
  });
}
function renderQuestions(){
  if(!state.currentQuestionId&&state.questionBank.questions[0])state.currentQuestionId=state.questionBank.questions[0].id;
  renderQuestionListOnly();
  renderQuestionEditor();
  if(typeof renderFamilyQuestionTabs==='function')renderFamilyQuestionTabs();
}
let primaryNodeFilter='';
function treeOptions(selected,filter=''){
  if(!state.knowledgeTree)return '<option value="">未加载知识树</option>';
  const kw=String(filter||'').trim().toLowerCase();
  const matched=kw?state.knowledgeTree.nodes.filter(n=>{
    const label=state.knowledgeTree.pathFor(n.id).join(' > ');
    return label.toLowerCase().includes(kw)||String(n.id).toLowerCase().includes(kw);
  }):state.knowledgeTree.nodes;
  const kept=selected&&!matched.some(n=>n.id===selected); // 当前已选项被过滤掉时仍保留,避免静默丢失关联
  return '<option value="">— 未关联 —</option>'+matched.map(n=>{
    const label=state.knowledgeTree.pathFor(n.id).join(' > ');
    return `<option value="${esc(n.id)}"${n.id===selected?' selected':''}>${esc(label)} [${esc(n.id)}]</option>`;
  }).join('')+(kept?treeOptions(selected).replace('<option value="">— 未关联 —</option>',''):'');
}
function principleCheckMarkup(selected=[],namePrefix='p'){
  const set=new Set((selected||[]).map(String));if(!state.principles.items.length)return '<span class="muted smalltxt">尚未导入/创建原则。</span>';
  return `<div class="principle-checks">${state.principles.items.filter(p=>p.status!=='inactive').map(p=>`<label><input type="checkbox" data-principle-check="${esc(namePrefix)}" value="${esc(p.id)}"${set.has(p.id)?' checked':''}> ${esc(p.name)}</label>`).join('')}</div>`;
}
function renderQuestionPrincipleBindings(){
  const q=currentQuestion(),box=document.getElementById('questionPrincipleBindingPanel');if(!q||!box)return;syncQuestionPrinciples(q);const map=q.metadata.optionPrincipleMap||{};
  box.innerHTML=`<div class="help">题干 / 通用原则保存到 <code>metadata.stemPrincipleIds</code>；选项原则保存到 <code>metadata.optionPrincipleMap</code>。兼容字段 <code>metadata.principleIds</code> 由两者自动汇总；多题归纳只使用正确选项的唯一原则。</div>
  <div style="margin-top:9px"><label>题干 / 通用原则</label>${principleCheckMarkup(q.metadata.stemPrincipleIds,'question')}</div>
  <div style="margin-top:10px">${q.options.slice(0,4).map(o=>`<div class="option-principles"><b>选项 ${esc(o.id)}</b>${principleCheckMarkup(map[o.id]||[],'opt-'+o.id)}</div>`).join('')}</div>`;
  box.querySelectorAll('[data-principle-check="question"]').forEach(el=>el.addEventListener('change',()=>{q.metadata.stemPrincipleIds=[...box.querySelectorAll('[data-principle-check="question"]:checked')].map(x=>x.value);syncQuestionPrinciples(q);renderCurrentIssues()}));
  q.options.slice(0,4).forEach(o=>box.querySelectorAll(`[data-principle-check="opt-${o.id}"]`).forEach(el=>el.addEventListener('change',()=>{q.metadata.optionPrincipleMap=q.metadata.optionPrincipleMap||{};q.metadata.optionPrincipleMap[o.id]=[...box.querySelectorAll(`[data-principle-check="opt-${o.id}"]:checked`)].map(x=>x.value);syncQuestionPrinciples(q);renderCurrentIssues()})));
}
function renderQuestionFacetBindings(){
  const q=currentQuestion(),box=document.getElementById('questionFacetBindingPanel');if(!q||!box)return;
  const subject=q.subject||state.questionBank.subject||'PMP',schema=facetSchemaForSubject(subject);
  if(!schema){box.innerHTML=`<div class="help">当前科目 <b>${esc(subject)}</b> 尚未配置科目分类 Schema；可到「① 基础数据与导入」导入 Facet Schema。未配置时题目不携带 subjectFacets。</div>`;return}
  const catalog=facetCatalog(subject),selected=new Set(normalizeQuestionFacets(q.metadata?.subjectFacets,subject).map(x=>x.facetId));
  const unknown=[...selected].filter(id=>!catalog.some(x=>x.facetId===id));
  box.innerHTML=`<div class="help">按当前科目 Schema（${esc(schema.name)} · <code>${esc(schema.schemaId)}</code>）绑定；保存为 <code>metadata.subjectFacets</code>，仅允许引用 Schema 中的真实 ID，界面只显示教师业务名称。</div>
  ${schema.dimensions.filter(d=>d.status!=='inactive').map(d=>`
    <div style="margin-top:9px"><label>${esc(d.label)}（${d.selection==='single'?'单选':'多选'}）</label>
    <div class="principle-checks">${d.values.filter(v=>v.status!=='inactive').map(v=>{
      const fid=facetIdFor(schema,d.id,v.id);
      return `<label><input type="checkbox" data-facet-check value="${esc(fid)}"${selected.has(fid)?' checked':''}> ${esc(v.label)}${v.status==='deprecated'?'（已废弃）':''}</label>`;
    }).join('')}</div></div>`).join('')}
  ${unknown.length?`<div class="muted tiny" style="margin-top:8px;color:#c0392b">未知分类引用（不在当前 Schema，校验中心会标红并阻止正式同步）：${unknown.map(esc).join('、')} <button class="btn small" type="button" id="btnClearUnknownFacets">清除未知引用</button></div>`:''}`;
  const clearBtn=document.getElementById('btnClearUnknownFacets');
  if(clearBtn)clearBtn.onclick=()=>{const ids=[...box.querySelectorAll('[data-facet-check]:checked')].map(x=>x.value);q.metadata.subjectFacets=selectedFacetsFromIds(ids,subject);renderQuestionFacetBindings();renderCurrentIssues();markWorkspaceDirty()};
  box.querySelectorAll('[data-facet-check]').forEach(el=>el.addEventListener('change',()=>{
    const ids=[...box.querySelectorAll('[data-facet-check]:checked')].map(x=>x.value);
    q.metadata.subjectFacets=selectedFacetsFromIds(ids,subject).concat(normalizeQuestionFacets(q.metadata?.subjectFacets,subject).filter(x=>x.status==='unknown'));
    renderCurrentIssues();markWorkspaceDirty();
  }));
}
function createFamilyMemberFromCurrent(){
  const q=currentQuestion();if(!q)return;
  const root=familyRootFor(q);
  const base=root&&root.id!==q.id?root:q;
  if(questionFamily(base).role!=='root'&&!confirm('当前题不是母题，先把它设为母题再创建成员？'))return;
  makeQuestionFamilyRoot(base);
  const copy=QuestionService.duplicatePayload(base);
  copy.title=base.title+'（家族成员）';
  /* 插入到母题（及其已有成员）正下方，不排到列表末尾 */
  const famKey=questionFamily(base).familyKey;
  let insertAt=state.questionBank.questions.findIndex(x=>x.id===base.id);
  if(insertAt>=0){
    for(let i=insertAt+1;i<state.questionBank.questions.length;i++){
      const f2=questionFamily(state.questionBank.questions[i]);
      if(f2.role!=='standalone'&&(f2.familyKey===famKey||f2.rootQuestionId===base.id))insertAt=i;else break;
    }
    state.questionBank.questions.splice(insertAt+1,0,copy);
  }else state.questionBank.questions.push(copy);
  makeQuestionFamilyMember(copy,base);
  questionFamily(copy).qualityConfirmed=false;
  state.currentQuestionId=copy.id;state.questionBank.updatedAt=Date.now();
  renderQuestions();renderQuestionEditor();markWorkspaceDirty();toast('已从母题创建家族成员');
}
function renderFamilyQuestionTabs(){
  const host=document.getElementById('familyQuestionTabs'),card=document.getElementById('questionEditCard');if(!host||!card)return;
  card.classList.remove('family-tone-root','family-tone-equivalent','family-tone-decomposed','family-tone-extension','family-tone-standalone');
  const q=currentQuestion();if(!q){host.innerHTML='';return}
  card.classList.add(familyToneClass(q));
  const f=questionFamily(q),root=familyRootFor(q);
  if(f.role==='standalone'||!root){host.innerHTML='<div class="family-editor-standalone"><span class="family-role-chip standalone">独立题</span> 当前题尚未加入题目家族。</div>';return}
  const members=familyMembersFor(root),items=[root,...members],rf=questionFamily(root);
  host.innerHTML=`<div class="family-editor-tabs-wrap"><div class="family-editor-tabs-head"><b>当前题目家族</b><span class="family-role-chip ${familyToneKey(q)}">${esc(familyRoleLabel(f.role))}</span><span class="muted tiny">${esc(rf.familyKey||'未命名家族')} · ${items.length} 题</span></div><div class="family-editor-tabs">${items.map((item,idx)=>{const tone=familyToneKey(item),ff=questionFamily(item),label=ff.role==='root'?'母题':`成员 ${idx}`;return `<button type="button" class="family-editor-tab ${tone}${familyHoverClass(item)}${item.id===q.id?' active':''}" data-family-tab="${esc(item.id)}"><strong>${esc(label)} · ${esc(item.title||'未命名题')}</strong><span>${esc(familyTabMeta(item))}</span></button>`}).join('')}</div></div>`;
  host.querySelectorAll('[data-family-tab]').forEach(btn=>btn.onclick=async()=>{
    if(btn.dataset.familyTab===state.currentQuestionId)return;
    const target=state.questionBank.questions.find(x=>x.id===btn.dataset.familyTab);if(!target)return;
    await switchQuestionForEdit(target);state.currentQuestionId=target.id;renderQuestions();
  });
}
function renderQuestionFamilyEditor(){
  const q=currentQuestion(),box=document.getElementById('questionFamilyPanel');if(!q||!box)return;
  const f=questionFamily(q);
  const root=familyRootFor(q),members=root?familyMembersFor(root):[],coverage=root?familyCoverageFor(root):null;
  const rootOptions=state.questionBank.questions.filter(x=>x.id!==q.id&&questionFamily(x).role==='root');
  const purposesChecked=new Set(f.purposes);
  box.innerHTML=`<div class="help">三种角色：母题（root）/ 家族成员（member）/ 独立题（standalone）。普通难度是三档，<code>questionFamily.difficultyLevel</code> 是独立 L1–L4 诊断层级。外部导入的质量确认一律为否，只有教师可以勾选确认。</div>
  <div class="form-grid" style="margin-top:10px">
    <div><label>家族角色</label><select id="qfRole">
      ${['standalone|独立题','root|母题','member|家族成员'].map(x=>{const [v,l]=x.split('|');return `<option value="${v}"${f.role===v?' selected':''}>${l}</option>`}).join('')}
    </select></div>
    <div><label>家族代号 familyKey</label><input type="text" id="qfFamilyKey" value="${esc(f.familyKey)}" ${f.role==='standalone'?'disabled':''} placeholder="FAMILY-001"></div>
    <div><label>与母题关系（成员）</label><select id="qfRelation" ${f.role!=='member'?'disabled':''}>
      ${[['equivalent','等价变体'],['decomposed','能力拆解'],['extension','扩展/高阶']].map(([v,l])=>`<option value="${v}"${f.relationToRoot===v?' selected':''}>${l}</option>`).join('')}
    </select></div>
    <div><label>变体类型（成员）</label><select id="qfVariant" ${f.role!=='member'?'disabled':''}>
      ${[['stem','题干'],['options','选项'],['scenario','情境'],['parameter','参数'],['mixed','混合'],['decomposed','拆解'],['advanced','高阶']].map(([v,l])=>`<option value="${v}"${f.variantType===v?' selected':''}>${l}</option>`).join('')}
    </select></div>
    <div><label>等价等级（等价变体）</label><select id="qfGrade" ${f.role!=='member'||f.relationToRoot!=='equivalent'?'disabled':''}>
      ${['','A','B','C'].map(v=>`<option value="${v}"${f.equivalenceGrade===v?' selected':''}>${v||'— 未设置 —'}</option>`).join('')}
    </select></div>
    <div><label>诊断目标</label><select id="qfTarget">
      ${[['general','一般'],['concept','概念'],['understanding','理解'],['discrimination','辨析'],['application','应用'],['analysis','分析'],['case-transfer','案例迁移']].map(([v,l])=>`<option value="${v}"${f.diagnosticTarget===v?' selected':''}>${l}</option>`).join('')}
    </select></div>
    <div><label>诊断层级 L1–L4</label><select id="qfLevel">
      ${[1,2,3,4].map(v=>`<option value="${v}"${f.difficultyLevel===v?' selected':''}>L${v}</option>`).join('')}
    </select></div>
    <div><label>绑定母题（成员）</label><select id="qfRoot" ${f.role!=='member'?'disabled':''}>
      <option value="">— 选择母题 —</option>
      ${rootOptions.map(x=>`<option value="${esc(x.id)}"${f.rootQuestionId===x.id?' selected':''}>${esc(x.title)}（${esc(x.id.slice(0,8))}）</option>`).join('')}
    </select></div>
    <div class="span2"><label>学习用途（多选）</label><div class="principle-checks">
      ${Object.entries(FAMILY_PURPOSE_LABELS).map(([v,l])=>`<label><input type="checkbox" data-qf-purpose="${v}"${purposesChecked.has(v)?' checked':''}> ${l}</label>`).join('')}
    </div></div>
    <div class="span2"><label><input type="checkbox" id="qfConfirmed"${f.qualityConfirmed?' checked':''}> 教师质量确认（qualityConfirmed；外部导入固定为否）</label></div>
    <div class="span2"><label>备注</label><input type="text" id="qfNotes" value="${esc(f.notes)}"></div>
  </div>
  <div class="toolbar" style="margin-top:10px">
    <button class="btn small primary" id="btnCreateFamilyMember" type="button">从母题创建成员题</button>
    <button class="btn small" id="btnGoFamilyRoot" type="button" ${root?'':'disabled'}>跳到母题</button>
    <span class="muted tiny">${f.role==='standalone'?'独立题不参与家族分组。':root?`家族 ${esc(questionFamily(root).familyKey)} · 成员 ${members.length} 道 · ${coverage.ready?'已达到诊断就绪':coverage.complete?'结构完整，待人工确认':'未达到诊断就绪（强等价 '+coverage.strong+'/2 · 概念 '+(coverage.concept?1:0)+'/1 · 理解 '+(coverage.understanding?1:0)+'/1 · 高阶 '+(coverage.highOrder?1:0)+'/1）'}（Root-only 批次合法，这只是就绪提示）`:'尚未绑定母题。'}</span>
  </div>
  ${members.length?`<div class="muted tiny" style="margin-top:8px">家族成员：${members.map(m=>`<a href="javascript:void(0)" data-qf-goto="${esc(m.id)}" style="margin-right:8px">${esc(m.title)}（${familyRelationLabel(questionFamily(m).relationToRoot)}${questionFamily(m).equivalenceGrade?'·'+questionFamily(m).equivalenceGrade:''}）</a>`).join('')}</div>`:''}`;
  const rerender=()=>{renderQuestionFamilyEditor();renderQuestionListOnly();renderFamilyQuestionTabs();renderCurrentIssues();markWorkspaceDirty()};
  document.getElementById('qfRole').onchange=e=>{
    const role=e.target.value;
    if(role==='root')makeQuestionFamilyRoot(q);
    else if(role==='standalone')makeQuestionStandalone(q);
    else{const target=root&&root.id!==q.id?root:rootOptions[0];if(target)makeQuestionFamilyMember(q,target,{applyDefaults:false});else{q.metadata.questionFamily.role='member'}}
    rerender();
  };
  const keyInput=document.getElementById('qfFamilyKey');keyInput.oninput=()=>{questionFamily(q).familyKey=keyInput.value.trim();if(root&&root.id===q.id)renameQuestionFamilyKey(q,keyInput.value.trim());renderQuestionListOnly();renderCurrentIssues();markWorkspaceDirty()};
  // 注意：questionFamily(q) 每次调用都会重新归一并替换 q.metadata.questionFamily 对象，
  // 校验中心等流程也会触发替换，因此 handler 内必须现取对象，不能依赖渲染时的闭包 f。
  const bind=(id,apply)=>{const el=document.getElementById(id);if(el)el.onchange=()=>{apply(el.value);rerender()}};
  bind('qfRelation',v=>{const fam=questionFamily(q);fam.relationToRoot=normalizeFamilyRelation(v);if(fam.role==='member')fam.relationToRoot=['equivalent','decomposed','extension'].includes(fam.relationToRoot)?fam.relationToRoot:'equivalent'});
  bind('qfVariant',v=>{questionFamily(q).variantType=normalizeFamilyVariantType(v)});
  bind('qfGrade',v=>{questionFamily(q).equivalenceGrade=normalizeEquivalenceGrade(v)});
  bind('qfTarget',v=>{questionFamily(q).diagnosticTarget=normalizeDiagnosticTarget(v)});
  bind('qfLevel',v=>{questionFamily(q).difficultyLevel=Math.min(4,Math.max(1,Number(v)||2))});
  bind('qfRoot',v=>{const target=state.questionBank.questions.find(x=>x.id===v);if(target){makeQuestionFamilyMember(q,target,{applyDefaults:false})}else{questionFamily(q).rootQuestionId=''}});
  box.querySelectorAll('[data-qf-purpose]').forEach(el=>el.addEventListener('change',()=>{
    const fam=questionFamily(q);
    fam.purposes=[...box.querySelectorAll('[data-qf-purpose]:checked')].map(x=>x.dataset.qfPurpose);
    if(!fam.purposes.length)fam.purposes=['practice'];
    renderCurrentIssues();markWorkspaceDirty();
  }));
  document.getElementById('qfConfirmed').onchange=e=>{questionFamily(q).qualityConfirmed=e.target.checked;renderCurrentIssues();markWorkspaceDirty()};
  document.getElementById('qfNotes').oninput=e=>{questionFamily(q).notes=e.target.value.trim();markWorkspaceDirty()};
  box.querySelectorAll('[data-qf-goto]').forEach(el=>el.addEventListener('click',()=>{state.currentQuestionId=el.dataset.qfGoto;renderQuestions();renderQuestionEditor()}));
  const createBtn=document.getElementById('btnCreateFamilyMember');
  createBtn.onclick=()=>createFamilyMemberFromCurrent();
  const goRoot=document.getElementById('btnGoFamilyRoot');
  if(goRoot&&!root)goRoot.disabled=true;
  else if(goRoot)goRoot.onclick=()=>{state.currentQuestionId=root.id;renderQuestions();renderQuestionEditor()};
}
function renderSubjectFacetManager(){  const box=document.getElementById('subjectFacetManager');if(!box)return;
  /* 默认兜底：内置 PMP 官方 Schema，保证首次进入即有分类预览 */
  if(!state.subjectFacetRegistry&&typeof normalizeSubjectFacetRegistry==='function')state.subjectFacetRegistry=normalizeSubjectFacetRegistry({});
  const subject=state.questionBank.subject||'PMP',schema=facetSchemaForSubject(subject);
  if(!schema){
    box.innerHTML=`<div class="help">当前科目 <b>${esc(subject)}</b> 尚未配置科目分类。</div><div class="toolbar"><button class="btn small primary" id="btnImportFacetSchema">导入科目分类</button><input type="file" id="fileFacetSchema" accept=".json,application/json" hidden></div>`;
  }else{
    box.innerHTML=`
    <div class="toolbar"><b>${esc(schema.name||subject+' 科目分类')}</b><span class="spacer"></span><button class="btn small" id="btnLoadServerFacets">从服务器拉取</button><button class="btn small" id="btnPushServerFacets">推送到服务器</button><button class="btn small" id="btnExportCurrentFacetSchema">导出分类配置</button><button class="btn small primary" id="btnImportFacetSchema">导入 / 替换分类</button><input type="file" id="fileFacetSchema" accept=".json,application/json" hidden></div>
    ${schema.dimensions.map(d=>`<div class="facet-preview-dim"><label>${esc(d.label)}<span class="muted tiny">（${d.selection==='single'?'单选':'多选'}）</span></label><div class="facet-chip-row">${d.values.map(v=>`<span class="facet-chip${v.status==='deprecated'?' deprecated':''}${v.status==='inactive'?' inactive':''}">${esc(v.label)}</span>`).join('')}</div></div>`).join('')}
    <div class="muted tiny" style="margin-top:8px">分类取值使用系统稳定编码，随题目数据保存与导出，无需人工维护；历史使用过的编码不可删除。服务器 Schema 是正式真源，推送遇到版本冲突时会自动刷新最新版并要求重新确认。</div>`;
  }
  const importBtn=document.getElementById('btnImportFacetSchema'),file=document.getElementById('fileFacetSchema');
  if(importBtn)importBtn.onclick=()=>file?.click();
  if(file)file.onchange=async()=>{const f=file.files?.[0];if(!f)return;try{
    const imported=importFacetSchema(await readJsonFile(f));
    state.questionBank.questions.forEach(q=>q.metadata.subjectFacets=normalizeQuestionFacets(q.metadata?.subjectFacets,q.subject||state.questionBank.subject));
    renderSubjectFacetManager();renderQuestionEditor();renderCurrentIssues();markWorkspaceDirty();toast(`已导入科目分类：${imported.name}`);
  }catch(err){alert('科目分类导入失败：'+err.message)}file.value=''};
  const exportBtn=document.getElementById('btnExportCurrentFacetSchema');
  if(exportBtn&&schema)exportBtn.onclick=()=>downloadJson({format:'pmp-facet-schema-v1',...clone(schema)},`${schema.schemaId}.json`,{auditType:'subject-facet-schema'});
  const loadBtn=document.getElementById('btnLoadServerFacets');
  if(loadBtn)loadBtn.onclick=async()=>{
    if(!window.PMPPrepP45Server){toast('服务器适配器未加载');return}
    try{const result=await window.PMPPrepP45Server.loadSubjectFacetSchemas();state.questionBank.questions.forEach(q=>q.metadata.subjectFacets=normalizeQuestionFacets(q.metadata?.subjectFacets,q.subject||state.questionBank.subject));renderSubjectFacetManager();renderQuestionEditor();renderCurrentIssues();toast(`已从服务器拉取 ${result.schemas.length} 份 Facet Schema`)}
    catch(error){alert('从服务器拉取科目分类失败：'+error.message)}
  };
  const pushBtn=document.getElementById('btnPushServerFacets');
  if(pushBtn&&schema)pushBtn.onclick=async()=>{
    if(!window.PMPPrepP45Server){toast('服务器适配器未加载');return}
    if(!confirm(`将当前科目分类（${schema.name}）推送到服务器？\n服务器将按科目替换同名 Schema；历史使用过的 ID 会被保留，不会被硬删除。`))return;
    try{
      const result=await window.PMPPrepP45Server.pushSubjectFacetSchema(schema,{contentRevision:prepRuntime.serverContentRevision||0});
      prepRuntime.serverContentRevision=Math.max(Number(prepRuntime.serverContentRevision||0),Number(result?.contentRevision||0));
      toast('科目分类已推送到服务器');
    }catch(error){
      alert(error.code==='SUBJECT_FACET_REVISION_CONFLICT'?error.message:'推送到服务器失败：'+error.message);
      if(error.code==='SUBJECT_FACET_REVISION_CONFLICT'&&error.detail?.latestContentRevision)prepRuntime.serverContentRevision=error.detail.latestContentRevision;
    }
  };
}
function renderQuestionEditor(){
  const q=currentQuestion(),ed=document.getElementById('questionEditor');
  document.getElementById('currentQuestionId').textContent=q?.id||'';
  if(!q){ed.innerHTML='<div class="no-data">请新建题目，或导入已有题库。</div>';renderKeywords();return}
  const en=q.translations?.en||{};
  while(en.options.length<4)en.options.push({id:String.fromCharCode(65+en.options.length),text:''});
  ed.innerHTML=`
  <div class="form-grid">
    <div><label>题目 ID</label><input type="text" data-qfield="id" value="${esc(q.id)}"></div>
    <div><label>标题</label><input type="text" data-qfield="title" value="${esc(q.title)}"></div>
    <div><label>难度</label><select data-qfield="difficulty">${['简单','中等','困难'].map(x=>`<option${q.difficulty===x?' selected':''}>${x}</option>`).join('')}</select></div>
    <div><label>阶段</label><input type="text" data-qfield="stage" value="${esc(q.stage||'')}"></div>
    <div><label>领域 / Domain</label><input type="text" data-qfield="domain" value="${esc(q.domain||'')}"></div>
    <div><label>主题 / Topic</label><input type="text" data-qfield="topic" value="${esc(q.topic||'')}"></div>
    <div class="span2"><label>标签（逗号分隔）</label><input type="text" data-qfield="tags" value="${esc((q.tags||[]).join(', '))}"></div>
  </div>
  <div class="section">
    <div class="section-title">中文题干</div>
    <textarea id="stemZh" data-source="stem">${esc(questionStem(q))}</textarea>
  </div>
  <div class="section">
    <div class="section-title">中文选项</div>
    ${q.options.slice(0,4).map(o=>`<div class="option-row"><div class="option-letter">${o.id}</div><textarea class="textarea-sm" data-option="${o.id}" data-source="option">${esc(o.text)}</textarea><label class="tiny" style="margin-top:9px"><input type="radio" name="correctOption" value="${o.id}" ${q.correctAnswer===o.id?'checked':''}> 正确</label></div>`).join('')}
  </div>
  <div class="section">
    <div class="section-title">中文解析</div>
    <textarea id="analysisZh">${esc(q.analysis||'')}</textarea>
  </div>
  <div class="section">
    <div class="section-title">原则 / 归纳卡关联</div>
    <div id="questionPrincipleBindingPanel"></div>
  </div>
  <div class="section">
    <div class="section-title">科目分类（Subject Facets）</div>
    <div id="questionFacetBindingPanel"></div>
  </div>
  <div class="section">
    <div class="section-title">题目家族（Question Family v1）</div>
    <div id="questionFamilyPanel"></div>
  </div>
  <div class="section">
    <div class="section-title">公共标签 · Global Tags</div>
    <div class="help" style="margin-bottom:8px">勾选后同时维护 <code>q.tags</code> 与结构化 <code>metadata.tagPaths</code>；历史自由标签如果无法映射，会显示为“未归类标签”。</div>
    <div id="questionTagEditor"></div>
  </div>
  <div class="section">
    <div class="section-title">知识点</div>
    <label>主知识点（只保存稳定 Node ID）</label>
    <input type="text" id="primaryNodeSearch" placeholder="搜索知识点路径或 ID，如：进度 / kp-pmp" autocomplete="off" value="${esc(primaryNodeFilter)}">
    <select id="primaryNode">${treeOptions(q.metadata?.knowledge?.primaryNodeId||'',primaryNodeFilter)}</select>
    <div class="related-knowledge-box">
      <label>辅助知识点（多选）</label>
      <div class="related-knowledge-add">
        <input id="relatedNodeSearch" type="text" placeholder="搜索辅助知识点名称 / 路径 / Node ID" autocomplete="off">
        <button class="btn small" id="btnAddRelatedNode" type="button">+ 添加</button>
        <select id="relatedNodeSelect">${relatedKnowledgeOptions('')}</select>
      </div>
      <div class="knowledge-search-meta" id="relatedNodeSearchMeta"></div>
      <div class="related-knowledge-chips" id="relatedKnowledgeChips"></div>
    </div>
  </div>
  <div class="section">
    <div class="section-title">English</div>
    <div class="form-grid">
      <div class="span2"><label>English Title</label><input id="titleEn" type="text" value="${esc(en.title||'')}"></div>
      <div class="span2"><label>English Stem</label><textarea id="stemEn">${esc(englishStem(q))}</textarea></div>
      ${en.options.slice(0,4).map(o=>`<div class="span2"><label>${o.id}</label><input type="text" data-enoption="${o.id}" value="${esc(o.text)}"></div>`).join('')}
      <div class="span2"><label>English Analysis</label><textarea id="analysisEn">${esc(en.analysis||'')}</textarea></div>
    </div>
  </div>`;
  bindQuestionEditor();
  renderQuestionPrincipleBindings();renderQuestionFacetBindings();renderQuestionFamilyEditor();renderKeywords();renderPreview();renderCurrentIssues();renderQuestionLockState();
  renderQuestionTagEditor();renderRelatedKnowledgeUi('');
}
function bindQuestionEditor(){
  const q=currentQuestion();if(!q)return;
  document.querySelectorAll('[data-qfield]').forEach(el=>el.addEventListener('input',()=>{
    const f=el.dataset.qfield,v=el.value,oldId=q.id;
    if(f==='tags'){q.tags=unique(cleanList(v).map(canonicalTagName));q.metadata.tagPaths=q.tags.map(tagPathFor).filter(Boolean)}else q[f]=v;
    if(f==='id'){
      state.currentQuestionId=v;
      document.getElementById('currentQuestionId').textContent=v;
    }
    state.questionBank.updatedAt=Date.now();
    if(f==='title'||f==='id')renderQuestionListOnly();
    renderCurrentIssues();
  }));
  const stem=document.getElementById('stemZh');stem.addEventListener('input',()=>{q.stemParts=[{text:stem.value}];recomputeKeywordLocations(q);renderKeywords();renderPreview();renderCurrentIssues()});bindSelection(stem,'stem','');
  document.querySelectorAll('[data-option]').forEach(el=>{
    el.addEventListener('input',()=>{const o=q.options.find(x=>x.id===el.dataset.option);if(o)o.text=el.value;recomputeKeywordLocations(q);renderKeywords();renderPreview();renderCurrentIssues()});
    bindSelection(el,'option',el.dataset.option);
  });
  document.querySelectorAll('input[name=correctOption]').forEach(el=>el.addEventListener('change',()=>{q.correctAnswer=el.value;q.options.forEach(o=>o.correct=o.id===el.value);renderCurrentIssues()}));
  document.getElementById('analysisZh').addEventListener('input',e=>{q.analysis=e.target.value;q.explanation=e.target.value;renderCurrentIssues()});
  document.getElementById('primaryNode').addEventListener('change',e=>{setPrimaryKnowledge(q,e.target.value);renderKeywords();renderCurrentIssues();renderRelatedKnowledgeUi(document.getElementById('relatedNodeSearch')?.value||'')});
  const primarySearch=document.getElementById('primaryNodeSearch');
  if(primarySearch)primarySearch.addEventListener('input',e=>{
    primaryNodeFilter=e.target.value;
    const sel=document.getElementById('primaryNode');if(!sel)return;
    const current=q.metadata?.knowledge?.primaryNodeId||'';
    sel.innerHTML=treeOptions(current,primaryNodeFilter);
  });
  const relatedSearch=document.getElementById('relatedNodeSearch'),relatedSelect=document.getElementById('relatedNodeSelect'),addRelated=document.getElementById('btnAddRelatedNode');
  if(relatedSearch)relatedSearch.addEventListener('input',()=>renderRelatedKnowledgeUi(relatedSearch.value));
  if(addRelated)addRelated.addEventListener('click',()=>{
    const id=relatedSelect?.value||'';if(!id)return;
    const knowledge=q.metadata.knowledge=q.metadata.knowledge||{},primary=knowledge.primaryNodeId||'';
    knowledge.relatedNodeIds=unique([...(knowledge.relatedNodeIds||[]),id].map(String).filter(x=>x&&x!==primary));
    relatedSearch.value='';renderRelatedKnowledgeUi('');renderCurrentIssues();markWorkspaceDirty();
  });
  document.getElementById('titleEn').addEventListener('input',e=>q.translations.en.title=e.target.value);
  document.getElementById('stemEn').addEventListener('input',e=>q.translations.en.stemParts=[{text:e.target.value}]);
  document.querySelectorAll('[data-enoption]').forEach(el=>el.addEventListener('input',()=>{let o=q.translations.en.options.find(x=>x.id===el.dataset.enoption);if(!o){o={id:el.dataset.enoption,text:''};q.translations.en.options.push(o)}o.text=el.value}));
  document.getElementById('analysisEn').addEventListener('input',e=>q.translations.en.analysis=e.target.value);
}
function setPrimaryKnowledge(q,nodeId){
  const knowledge=q.metadata.knowledge=q.metadata.knowledge||{};
  knowledge.primaryNodeId=nodeId||'';
  knowledge.relatedNodeIds=Array.isArray(knowledge.relatedNodeIds)?knowledge.relatedNodeIds:[];
  knowledge.mappingStatus=nodeId?'confirmed':'unmapped';
  knowledge.pathSnapshot=nodeId&&state.knowledgeTree?state.knowledgeTree.pathFor(nodeId):[];
  delete knowledge.taxonomyId;delete knowledge.taxonomyVersion;
  q.clues.forEach(c=>c.conceptIds=nodeId?[nodeId]:[]);
}
function bindSelection(el,sourceType,optionId){
  const capture=()=>{
    const a=el.selectionStart,b=el.selectionEnd;
    if(a!=null&&b!=null&&b>a){
      state.lastSelection={sourceType,optionId,text:el.value.slice(a,b).trim(),start:a,end:b};
      document.getElementById('selectionHint').textContent=state.lastSelection.text?`已选：“${state.lastSelection.text}”`:'先选中一个词/术语';
    }
  };
  ['select','mouseup','keyup'].forEach(ev=>el.addEventListener(ev,capture));
}
function keywordLooksLikeWord(term){
  term=String(term||'').trim();
  if(!term)return {ok:false,msg:'关键词为空'};
  if(/[，。！？；：\n\r]/.test(term))return {ok:false,msg:'关键词包含句子标点'};
  if(/\s{2,}/.test(term))return {ok:false,msg:'关键词包含异常空格'};
  if(term.length>14)return {ok:false,msg:'关键词过长，疑似半句话'};
  return {ok:true,msg:''};
}
function addKeyword(level){
  const q=currentQuestion(),sel=state.lastSelection;if(!q)return;
  if(!sel?.text){toast('请先在题干或选项中选中一个词/术语');return}
  const check=keywordLooksLikeWord(sel.text);if(!check.ok&&!confirm(check.msg+'。仍要添加吗？'))return;
  if(q.clues.some(c=>c.text===sel.text&&c.sourceType===sel.sourceType&&String(c.sourceOptionId||'')===String(sel.optionId||''))){toast('该位置已存在此关键词');return}
  const resolved=resolveRecall(sel.text);
  const primary=q.metadata?.knowledge?.primaryNodeId||'';
  q.clues.push({
    id:uid('kw'),text:sel.text,textEn:'',type:level==='core'?'core-keyword':'recall-keyword',clueRole:'true',
    keywordLevel:level,isCore:level==='core',solutionRole:level==='core'?'concept-anchor':'context',coreReason:'',
    sourceType:sel.sourceType,sourceOptionId:sel.optionId||'',conceptIds:primary?[primary]:[],
    explain:'',recallNodeId:resolved.unique?.id||'',recallEntryLabel:resolved.unique?.title||'',sourceMode:'prep-studio-keyword-v2',matchLocations:[]
  });
  recomputeKeywordLocations(q);state.lastSelection=null;document.getElementById('selectionHint').textContent='先在题干或选项中选中一个词/术语';
  renderKeywords();renderPreview();renderCurrentIssues();
}
function recomputeKeywordLocations(q){
  const stem=questionStem(q);
  q.clues.forEach(c=>{
    const locs=[],sourceType=String(c.sourceType||'stem'),sourceOptionId=String(c.sourceOptionId||'');
    if(sourceType==='option'){
      const option=q.options.find(o=>String(o.id)===sourceOptionId),count=option?countOccurrences(option.text,c.text):0;
      if(count)locs.push({field:'option',optionId:sourceOptionId,count});
    }else{
      const count=countOccurrences(stem,c.text);if(count)locs.push({field:'stem',optionId:'',count});
    }
    c.matchLocations=locs;
  });
}
function recallNodeOptions(selected){
  return '<option value="">— 未关联 —</option>'+state.recallLibrary.nodes.slice().sort((a,b)=>a.title.localeCompare(b.title,'zh-CN')).map(n=>`<option value="${esc(n.id)}"${n.id===selected?' selected':''}>${esc(n.title)}${n.titleEn?' / '+esc(n.titleEn):''}</option>`).join('');
}
function normalizeRecallSearchText(value){return String(value||'').trim().toLowerCase().replace(/\s+/g,' ')}
function fuzzySubsequenceMatch(needle,haystack){
  needle=normalizeRecallSearchText(needle).replace(/\s+/g,'');haystack=normalizeRecallSearchText(haystack).replace(/\s+/g,'');
  if(!needle)return true;let i=0;for(const ch of haystack){if(ch===needle[i])i++;if(i>=needle.length)return true}return false;
}
function recallSearchNodes(term,limit=80){
  const q=normalizeRecallSearchText(term),tokens=q.split(' ').filter(Boolean),rows=[];
  state.recallLibrary.nodes.forEach(n=>{
    const fields=[{v:n.title,w:120},{v:n.titleEn,w:80},{v:n.id,w:70},...(n.aliases||[]).map(v=>({v,w:100}))];
    let score=0,best='';
    if(!q){score=1}else fields.forEach(({v,w})=>{
      const text=normalizeRecallSearchText(v);if(!text)return;
      let local=0;
      if(text===q)local=w+100;else if(text.startsWith(q))local=w+70;else if(text.includes(q))local=w+50;
      else if(tokens.length>1&&tokens.every(token=>text.includes(token)))local=w+35;
      else if(q.length>=2&&fuzzySubsequenceMatch(q,text))local=w+18;
      if(local>score){score=local;best=String(v||'')}
    });
    if(score)rows.push({n,score,best});
  });
  return rows.sort((a,b)=>b.score-a.score||Number(b.n.priority||0)-Number(a.n.priority||0)||String(a.n.title||'').localeCompare(String(b.n.title||''),'zh-CN')).slice(0,limit);
}
function recallFilteredOptions(term,selectedId=''){
  const rows=recallSearchNodes(term,80),q=normalizeRecallSearchText(term);
  let html='<option value="">— 未关联 —</option>';
  if(selectedId&&!rows.some(({n})=>n.id===selectedId)){
    const selected=state.recallLibrary.nodes.find(n=>n.id===selectedId);
    html+=selected
      ?`<option value="${esc(selected.id)}" selected>当前选择：${esc(selected.title)} · ${esc(selected.id)}</option>`
      :`<option value="${esc(selectedId)}" selected>已失效：${esc(selectedId)}</option>`;
  }
  html+=rows.map(({n,best})=>{
    const alias=(n.aliases||[]).find(a=>q&&normalizeRecallSearchText(a).includes(q));
    const extra=alias?` · Alias: ${alias}`:(q&&best&&best!==n.title?` · ${best}`:'');
    return `<option value="${esc(n.id)}"${n.id===selectedId?' selected':''}>${esc(n.title)}${extra?esc(extra):''} · ${esc(n.id)}</option>`;
  }).join('');
  return {html,count:rows.length,rows};
}
function keywordRecallControl(box,attribute,clueId){
  return [...box.querySelectorAll(`[${attribute}]`)].find(element=>element.getAttribute(attribute)===String(clueId))||null;
}
function renderKeywords(){
  const q=currentQuestion(),box=document.getElementById('keywordList');if(!box)return;
  if(!q){box.innerHTML='<div class="no-data">暂无题目</div>';document.getElementById('kwSummary').textContent='';return}
  const normal=q.clues.filter(c=>c.keywordLevel!=='core').length,core=q.clues.filter(c=>c.keywordLevel==='core').length;
  document.getElementById('kwSummary').textContent=`普通 ${normal} · 核心 ${core}`;
  if(!q.clues.length){box.innerHTML='<div class="no-data">尚未标记关键词</div>';return}
  box.innerHTML=q.clues.map((c,i)=>{
    const level=c.keywordLevel==='core'?'core':'normal',resolved=c.recallNodeId&&recallIndex().byId.get(c.recallNodeId);
    const location=(c.matchLocations||[]).map(x=>x.field==='stem'?'题干':`选项 ${x.optionId}`).join(' / ')||'未命中';
    return `<div class="kw-card ${level}" data-kw="${esc(c.id)}">
      <div class="kw-head">
        <span class="kw-word">${esc(c.text)}</span>
        <span class="pill ${level}">${level==='core'?'核心关键词':'普通关键词'}</span>
        <span class="pill">${esc(location)}</span>
        <span style="margin-left:auto"></span>
        <button class="btn small danger" data-remove-kw="${esc(c.id)}">删除</button>
      </div>
      <div class="kw-grid">
        <div><label>英文</label><input type="text" data-kwfield="textEn" data-kwid="${esc(c.id)}" value="${esc(c.textEn||'')}"></div>
        <div><label>级别</label><select data-kwfield="keywordLevel" data-kwid="${esc(c.id)}"><option value="normal"${level==='normal'?' selected':''}>普通关键词</option><option value="core"${level==='core'?' selected':''}>核心关键词</option></select></div>
        <div class="span2"><label>联想入口 ${resolved?'✓':c.recallNodeId?'⚠':'（可选）'}</label>
          <div class="recall-search-row"><input type="search" data-transient-ui data-kw-recall-search="${esc(c.id)}" placeholder="输入名称 / Alias / ID 搜索，或输入新名称后点“手动输入”"><button class="btn small" type="button" data-kw-recall-manual="${esc(c.id)}">手动输入</button><button class="btn small" type="button" data-kw-recall-clear="${esc(c.id)}">清空</button></div>
          <select class="recall-filtered" data-kwfield="recallNodeId" data-kwid="${esc(c.id)}" data-kw-recall-select="${esc(c.id)}">${recallNodeOptions(c.recallNodeId)}</select>
          <div class="recall-search-meta" data-kw-recall-meta="${esc(c.id)}"></div>
        </div>
        ${level==='core'?`<div><label>解题作用</label><select data-kwfield="solutionRole" data-kwid="${esc(c.id)}">
          ${[['decision-cue','Decision Cue / 决策提示'],['concept-anchor','Concept Anchor / 知识锚点'],['condition-anchor','Condition Anchor / 情境条件'],['answer-anchor','Answer Anchor / 答案判断']].map(([v,t])=>`<option value="${v}"${c.solutionRole===v?' selected':''}>${t}</option>`).join('')}
        </select></div><div><label>核心理由</label><input type="text" data-kwfield="coreReason" data-kwid="${esc(c.id)}" value="${esc(c.coreReason||'')}" placeholder="为什么这个词影响本题推理？"></div>`:''}
        <div class="span2 tiny muted">${resolved?`→ ${esc(resolved.title)}`:c.recallNodeId?`联想入口 ${esc(c.recallNodeId)} 已失效，请重新选择或清除。`:c.recallEntryLabel?`已手动输入：${esc(c.recallEntryLabel)}（未关联稳定 ID）`:'未关联（可选）'}</div>
      </div>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-remove-kw]').forEach(b=>b.onclick=()=>{q.clues=q.clues.filter(c=>c.id!==b.dataset.removeKw);renderKeywords();renderPreview();renderCurrentIssues()});
  box.querySelectorAll('[data-kwfield]').forEach(el=>el.addEventListener('change',()=>updateKeywordField(el)));
  box.querySelectorAll('input[data-kwfield]').forEach(el=>el.addEventListener('input',()=>updateKeywordField(el,false)));
  q.clues.forEach(c=>{
    const input=keywordRecallControl(box,'data-kw-recall-search',c.id),select=keywordRecallControl(box,'data-kw-recall-select',c.id),clear=keywordRecallControl(box,'data-kw-recall-clear',c.id),meta=keywordRecallControl(box,'data-kw-recall-meta',c.id),manual=keywordRecallControl(box,'data-kw-recall-manual',c.id);
    if(!input||!select||!clear||!meta)return;
    const filter=()=>{const result=recallFilteredOptions(input.value,c.recallNodeId||'');select.innerHTML=result.html;meta.textContent=input.value?`找到 ${result.count} 个候选；选择后才会保存稳定 ID。`:`共 ${result.count} 个正式联想入口。`;return result};
    input.addEventListener('input',filter);
    input.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();input.value='';filter()}else if(event.key==='Enter'){event.preventDefault();const first=filter().rows[0];if(first){select.value=first.n.id;updateKeywordField(select)}}});
    clear.onclick=()=>{input.value='';filter();input.focus()};
    if(manual)manual.onclick=()=>{
      const typed=String(input.value||'').trim();
      if(!typed){meta.textContent='请先在输入框中输入要手动保存的联想入口名称。';input.focus();return}
      const exact=state.recallLibrary.nodes.find(n=>n.title===typed||n.titleEn===typed||(n.aliases||[]).includes(typed));
      if(exact){select.value=exact.id;updateKeywordField(select);return}
      c.recallEntryLabel=typed;c.recallNodeId='';
      renderKeywords();renderPreview();renderCurrentIssues();
    };
    filter();
  });
}
function updateKeywordField(el,rerender=true){
  const q=currentQuestion(),c=q?.clues.find(x=>x.id===el.dataset.kwid);if(!c)return;
  const f=el.dataset.kwfield,v=el.value;
  if(f==='keywordLevel'){
    c.keywordLevel=v==='core'?'core':'normal';c.isCore=c.keywordLevel==='core';c.type=c.isCore?'core-keyword':'recall-keyword';
    if(c.isCore&&!c.solutionRole)c.solutionRole='concept-anchor';if(!c.isCore){c.solutionRole='context';c.coreReason=''}
  }else if(f==='recallNodeId'){
    c.recallNodeId=v;const n=recallIndex().byId.get(v);c.recallEntryLabel=n?.title||'';
  }else c[f]=v;
  if(rerender){renderKeywords();renderPreview();renderCurrentIssues()}
}
function suggestionText(term){
  const s=recallSuggestions(term);return s.length?' 建议检查：'+s.map(x=>x.title).join('、')+'；或把该词加入正确节点 Alias。':' 建议：创建新的语义联想入口，或把该词增加为现有节点 Alias。'
}
function markText(text,clues,field,optionId=''){
  const spans=[];
  clues.forEach(c=>{
    const applies=(c.matchLocations||[]).some(x=>x.field===field&&(field!=='option'||String(x.optionId)===String(optionId)));
    if(!applies)return;
    let i=0;while((i=text.indexOf(c.text,i))>=0){spans.push({a:i,b:i+c.text.length,c});i+=Math.max(1,c.text.length)}
  });
  spans.sort((x,y)=>x.a-y.a||(y.b-y.a)-(x.b-x.a));
  const picked=[];spans.forEach(s=>{if(!picked.some(p=>!(s.b<=p.a||s.a>=p.b)))picked.push(s)});
  picked.sort((a,b)=>a.a-b.a);let cur=0,out='';
  picked.forEach(s=>{out+=esc(text.slice(cur,s.a));out+=`<mark class="${s.c.keywordLevel==='core'?'core':'normal'}" data-kwid="${esc(s.c.id)}" title="${esc(s.c.recallEntryLabel||'未关联')}">${esc(text.slice(s.a,s.b))}</mark>`;cur=s.b});
  return out+esc(text.slice(cur));
}
function renderPreview(){
  const q=currentQuestion(),p=document.getElementById('questionPreview');
  const floatTarget=document.getElementById('floatingQuestionPreview');
  const floatTitle=document.getElementById('questionPreviewFloatTitle');
  if(floatTitle)floatTitle.textContent=q?(q.title?`· ${q.title}`:`· ${q.id}`):'';
  if(!p)return;
  if(!q){p.innerHTML='<div class="no-data">请导入或新建题目。</div>';if(floatTarget)floatTarget.innerHTML=p.innerHTML;return}
  let html=`<div class="stem-view" data-preview-source="stem" data-preview-option="">${markText(questionStem(q),q.clues,'stem')}</div>`;
  q.options.forEach(o=>{
    html+=`<div class="option-view${q.correctAnswer===o.id?' correct':''}" data-preview-source="option" data-preview-option="${esc(o.id)}"><b>${esc(o.id)}.</b> ${markText(o.text,q.clues,'option',o.id)} ${q.correctAnswer===o.id?'<span class="pill">正确答案</span>':''}</div>`;
  });
  p.innerHTML=html;
  if(floatTarget)floatTarget.innerHTML=html;
  bindInteractivePreview();
}

function hideKeywordFloat(){const box=document.getElementById('keywordFloat');if(box)box.classList.remove('show')}
document.addEventListener('pointerdown',e=>{const edit=document.getElementById('keywordFloat');if(edit?.classList.contains('show')&&!edit.contains(e.target)&&!e.target.closest('mark[data-kwid]'))hideKeywordFloat()});
function positionKeywordFloat(x,y){
  const box=document.getElementById('keywordFloat');if(!box)return;
  const w=420,h=340,left=Math.max(8,Math.min(window.innerWidth-w-8,x+8)),top=Math.max(8,Math.min(window.innerHeight-h-8,y+8));
  box.style.left=left+'px';box.style.top=top+'px';box.classList.add('show');
}
function keywordMatchesSource(c,sourceType,optionId){
  return (c.matchLocations||[]).some(x=>x.field===sourceType&&(sourceType!=='option'||String(x.optionId)===String(optionId||'')));
}
function showKeywordFloatEditor({clue=null,text='',sourceType='stem',optionId='',x=100,y=100}){
  const q=currentQuestion(),box=document.getElementById('keywordFloat');if(!q||!box)return;
  const existing=clue||q.clues.find(c=>c.text===text&&keywordMatchesSource(c,sourceType,optionId))||null;
  const resolved=existing?.recallNodeId?recallIndex().byId.get(existing.recallNodeId):resolveRecall(text).unique;
  let floatRecallSelectedId=existing?.recallNodeId||'';
  let floatManualEntryLabel=existing?.recallNodeId?'':(existing?.recallEntryLabel||'');
  const level=existing?.keywordLevel==='core'?'core':'normal';
  const role=existing?.solutionRole||(level==='core'?'concept-anchor':'context');
  box.innerHTML=`<div class="float-title"><span>${existing?'编辑关键词':'新增关键词'}：</span><span class="kw-word">${esc(existing?.text||text)}</span><span class="spacer"></span><button class="btn small" id="floatClose">×</button></div>
  <div class="float-grid">
    <div><label>级别</label><select id="floatLevel"><option value="normal"${level==='normal'?' selected':''}>普通关键词</option><option value="core"${level==='core'?' selected':''}>核心关键词</option></select></div>
    <div><label>English</label><input id="floatTextEn" type="text" value="${esc(existing?.textEn||'')}"></div>
    <div class="span2"><label>联想入口（可选）</label>
      <div class="recall-search-row"><input id="floatRecallSearch" type="search" data-transient-ui placeholder="输入名称 / Alias / ID 搜索，或输入新名称后点“手动输入”"><button class="btn small" id="floatRecallManual" type="button">手动输入</button><button class="btn small" id="floatRecallSearchClear" type="button">清空</button></div>
      <select id="floatRecall" class="recall-filtered">${recallNodeOptions(floatRecallSelectedId)}</select>
      <div id="floatRecallSearchMeta" class="recall-search-meta"></div>
    </div>
    <div id="floatCoreRoleWrap"${level==='core'?'':' class="hidden"'}><label>解题作用</label><select id="floatRole">
      ${[['decision-cue','Decision Cue / 决策提示'],['concept-anchor','Concept Anchor / 知识锚点'],['condition-anchor','Condition Anchor / 情境条件'],['answer-anchor','Answer Anchor / 答案判断']].map(([v,t])=>`<option value="${v}"${role===v?' selected':''}>${t}</option>`).join('')}
    </select></div>
    <div id="floatCoreReasonWrap"${level==='core'?'':' class="hidden"'}><label>核心理由</label><input id="floatReason" type="text" value="${esc(existing?.coreReason||'')}" placeholder="为什么这个词影响解题？"></div>
  </div>
  <div class="toolbar" style="margin-top:9px"><button class="btn primary" id="floatSave">保存</button>${existing?'<button class="btn danger" id="floatDelete">删除关键词</button>':''}<span class="muted tiny">${resolved?'自动命中：'+esc(resolved.title):esc(suggestionText(text))}</span></div>`;
  positionKeywordFloat(x,y);
  document.getElementById('floatClose').onclick=hideKeywordFloat;
  document.getElementById('floatLevel').onchange=e=>{
    const core=e.target.value==='core';
    document.getElementById('floatCoreRoleWrap').classList.toggle('hidden',!core);
    document.getElementById('floatCoreReasonWrap').classList.toggle('hidden',!core);
  };
  const recallSearch=document.getElementById('floatRecallSearch'),recallSelect=document.getElementById('floatRecall'),recallMeta=document.getElementById('floatRecallSearchMeta');
  const filterFloatRecall=()=>{const result=recallFilteredOptions(recallSearch.value,floatRecallSelectedId);recallSelect.innerHTML=result.html;recallMeta.textContent=recallSearch.value?`找到 ${result.count} 个候选；选择后才会保存稳定 ID。`:`共 ${result.count} 个正式联想入口。`;return result};
  recallSearch.oninput=()=>{floatManualEntryLabel='';filterFloatRecall()};
  recallSearch.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();recallSearch.value='';floatManualEntryLabel='';filterFloatRecall()}else if(event.key==='Enter'){event.preventDefault();const first=filterFloatRecall().rows[0];if(first){floatRecallSelectedId=first.n.id;floatManualEntryLabel='';recallSelect.value=floatRecallSelectedId;recallMeta.textContent=`已选择：${first.n.title} · ${first.n.id}`}}};
  recallSelect.onchange=()=>{floatRecallSelectedId=recallSelect.value;floatManualEntryLabel='';const selected=recallIndex().byId.get(floatRecallSelectedId);recallMeta.textContent=selected?`已选择：${selected.title} · ${selected.id}`:'未关联（可选）'};
  document.getElementById('floatRecallSearchClear').onclick=()=>{recallSearch.value='';floatManualEntryLabel='';filterFloatRecall();recallSearch.focus()};
  document.getElementById('floatRecallManual').onclick=()=>{
    const typed=String(recallSearch.value||'').trim();
    if(!typed){recallMeta.textContent='请先在输入框中输入要手动保存的联想入口名称。';recallSearch.focus();return}
    const exact=state.recallLibrary.nodes.find(n=>n.title===typed||n.titleEn===typed||(n.aliases||[]).includes(typed));
    if(exact){floatRecallSelectedId=exact.id;recallSelect.value=exact.id;recallMeta.textContent=`已选择：${exact.title} · ${exact.id}`;return}
    floatRecallSelectedId='';floatManualEntryLabel=typed;
    recallMeta.textContent=`已手动输入：${typed}（未关联稳定 ID）`;
  };
  filterFloatRecall();
  document.getElementById('floatSave').onclick=()=>{
    const selectedLevel=document.getElementById('floatLevel').value==='core'?'core':'normal';
    let c=existing;
    if(!c){
      const check=keywordLooksLikeWord(text);if(!check.ok&&!confirm(check.msg+'。仍要添加吗？'))return;
      c={id:uid('kw'),text:String(text).trim(),textEn:'',type:'recall-keyword',clueRole:'true',keywordLevel:'normal',isCore:false,solutionRole:'context',coreReason:'',
        sourceType,sourceOptionId:optionId||'',conceptIds:[],explain:'',recallNodeId:'',recallEntryLabel:'',sourceMode:'prep-studio-keyword-v2',matchLocations:[]};
      q.clues.push(c);
    }
    c.textEn=document.getElementById('floatTextEn').value;
    c.keywordLevel=selectedLevel;c.isCore=selectedLevel==='core';c.type=c.isCore?'core-keyword':'recall-keyword';
    c.solutionRole=c.isCore?document.getElementById('floatRole').value:'context';
    c.coreReason=c.isCore?document.getElementById('floatReason').value:'';
    c.recallNodeId=floatRecallSelectedId;
    const rn=recallIndex().byId.get(c.recallNodeId);c.recallEntryLabel=rn?.title||(floatRecallSelectedId?'':floatManualEntryLabel);
    c.sourceType=sourceType||c.sourceType;c.sourceOptionId=optionId||c.sourceOptionId||'';
    const primary=q.metadata?.knowledge?.primaryNodeId||'';c.conceptIds=primary?[primary]:[];
    recomputeKeywordLocations(q);hideKeywordFloat();renderKeywords();renderPreview();renderCurrentIssues();
  };
  if(existing)document.getElementById('floatDelete').onclick=()=>{q.clues=q.clues.filter(c=>c.id!==existing.id);hideKeywordFloat();renderKeywords();renderPreview();renderCurrentIssues()};
}
function bindInteractivePreview(){
  const p=document.getElementById('questionPreview');if(!p)return;
  p.querySelectorAll('mark[data-kwid]').forEach(el=>el.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();const q=currentQuestion(),c=q?.clues.find(x=>x.id===el.dataset.kwid);if(c)showKeywordFloatEditor({clue:c,text:c.text,sourceType:c.sourceType,optionId:c.sourceOptionId,x:e.clientX,y:e.clientY});
  }));
  p.addEventListener('mouseup',e=>{
    if(e.target.closest('mark[data-kwid]'))return;
    const source=e.target.closest('[data-preview-source]');if(!source)return;
    const sel=window.getSelection();const text=String(sel?.toString()||'').trim();if(!text)return;
    state.lastSelection={sourceType:source.dataset.previewSource,optionId:source.dataset.previewOption||'',text};
    showKeywordFloatEditor({text,sourceType:source.dataset.previewSource,optionId:source.dataset.previewOption||'',x:e.clientX,y:e.clientY});
  });
}

function buildMarkedParts(text,clues){
  const spans=[];
  clues.filter(c=>(c.matchLocations||[]).some(x=>x.field==='stem')).forEach(c=>{
    let i=0;while((i=text.indexOf(c.text,i))>=0){spans.push({a:i,b:i+c.text.length,id:c.id});i+=Math.max(1,c.text.length)}
  });
  spans.sort((x,y)=>x.a-y.a||(y.b-y.a)-(x.b-x.a));const picked=[];spans.forEach(s=>{if(!picked.some(p=>!(s.b<=p.a||s.a>=p.b)))picked.push(s)});
  picked.sort((a,b)=>a.a-b.a);const parts=[];let cur=0;picked.forEach(s=>{if(s.a>cur)parts.push({text:text.slice(cur,s.a)});parts.push({text:text.slice(s.a,s.b),clue:s.id});cur=s.b});if(cur<text.length)parts.push({text:text.slice(cur)});return parts.length?parts:[{text}];
}

function validateKeyword(q,c){
  const issues=[],word=keywordLooksLikeWord(c.text);
  if(!word.ok)issues.push({level:'warn',message:`关键词“${c.text}”：${word.msg}`,suggest:'缩短为词或稳定专业术语。'});
  if(!(c.matchLocations||[]).length)issues.push({level:'error',message:`关键词“${c.text}”已不在题干/选项中`,suggest:'重新标记或删除该关键词。'});
  if(c.recallNodeId&&!recallIndex().byId.has(c.recallNodeId))issues.push({level:'error',message:`关键词“${c.text}”引用的联想入口不存在：${c.recallNodeId}`,suggest:'清除该引用，或重新选择一个现有联想入口。'});
  if(!c.recallNodeId)issues.push({level:'warn',message:`${c.keywordLevel==='core'?'核心':'普通'}关键词“${c.text}”未关联联想入口`,suggest:'Recall 为可选增强；如需联想通路，可在关键词卡片中选择联想入口。'});
  if(c.keywordLevel==='core'){
    if(!c.solutionRole||c.solutionRole==='context')issues.push({level:'warn',message:`核心关键词“${c.text}”缺少解题作用`,suggest:'建议选择 Decision Cue / Concept Anchor / Condition Anchor / Answer Anchor（P4.5.29：solutionRole 仅用于审核与诊断，不作合法性门槛）。'});
    if(!String(c.coreReason||'').trim())issues.push({level:'warn',message:`核心关键词“${c.text}”缺少核心理由`,suggest:'建议补充说明这个词为什么影响本题推理或答案选择。'});
  }
  return issues;
}
function validateQuestion(q,deep=true){
  const issues=[],id=q.id||'未命名';
  const push=(level,message,suggest='',field='')=>issues.push({level,object:id,questionId:q.id||'',field,message,suggest});
  if(!String(q.title||'').trim())push('error','缺少题目标题','填写 title。','title');
  if(!String(questionStem(q)||'').trim())push('error','缺少中文题干','填写题干。','stemParts');
  if(!Array.isArray(q.options)||q.options.length<4||q.options.slice(0,4).some(o=>!String(o.text||'').trim()))push('error','A/B/C/D 选项不完整','补齐四个选项。','options');
  if(!q.options.some(o=>o.id===q.correctAnswer))push('error','正确答案无效','从 A/B/C/D 选择正确答案。','correctAnswer');
  if(!String(q.analysis||'').trim())push('error','缺少中文解析','填写 analysis。','analysis');
  const en=q.translations?.en||{};
  if(!String(englishStem(q)||'').trim())push('warn','缺少英文题干','若要双语题库，请补齐 English Stem。','translations.en.stemParts');
  if((en.options||[]).length<4||(en.options||[]).slice(0,4).some(o=>!String(o.text||'').trim()))push('warn','英文选项不完整','补齐英文 A/B/C/D。','translations.en.options');
  if(!String(en.analysis||'').trim())push('warn','缺少英文解析','补齐 English Analysis。','translations.en.analysis');
  const primary=q.metadata?.knowledge?.primaryNodeId||'';
  if(!primary)push('error','未关联主知识点','从知识树选择 primaryNodeId。','metadata.knowledge.primaryNodeId');
  else if(state.knowledgeTree&&!state.knowledgeTree.map.has(primary))push('error',`主知识点 ${primary} 不在已加载知识树中`,'重新选择当前知识树节点。','metadata.knowledge.primaryNodeId');
  const normal=q.clues.filter(c=>c.keywordLevel!=='core').length,core=q.clues.filter(c=>c.keywordLevel==='core').length;
  if(!q.clues.length)push('error','没有关键词','至少标记普通关键词和核心关键词。','clues');
  if(core===0)push('error','没有核心关键词','核心关键词用于未来做题大厅的解题提示。','clues');
  if(core>6)push('warn',`核心关键词 ${core} 个，可能过多`,'建议保留 2～5 个真正影响解题的词。');
  if(core===1)push('warn','只有 1 个核心关键词','通常建议 2～5 个。');
  if(normal===0)push('warn','没有普通关键词','建议补充知识回忆类词汇。');
  if(deep)q.clues.forEach(c=>validateKeyword(q,c).forEach(x=>push(x.level,x.message,x.suggest)));
  return issues;
}
function renderCurrentIssues(){
  const q=currentQuestion(),box=document.getElementById('questionIssues');if(!box)return;
  if(!q){box.innerHTML='';return}
  const issues=validateQuestion(q,true).sort((a,b)=>(a.level==='error'?0:1)-(b.level==='error'?0:1));
  if(!issues.length){box.innerHTML='<div class="issue ok"><strong>✓ 当前题通过</strong>结构、知识点、关键词和核心关键词规则均通过。</div>';return}
  box.innerHTML=issues.slice(0,12).map(x=>`<div class="issue ${x.level}"><strong>${x.level==='error'?'错误':'提醒'}：${esc(x.message)}</strong><span class="smalltxt">${esc(x.suggest||'')}</span></div>`).join('');
}

function newPrinciple(){
  const item={id:'principle-'+Date.now().toString(36),name:'新原则',status:'active',confusablePrincipleIds:[],createdAt:Date.now(),updatedAt:Date.now()};
  state.principles.items.push(item);state.currentPrincipleId=item.id;renderPrincipleList();renderPrincipleEditor();renderQuestions();
}
function renderPrincipleList(){
  const box=document.getElementById('principleList');if(!box)return;if(!state.currentPrincipleId&&state.principles.items[0])state.currentPrincipleId=state.principles.items[0].id;
  box.innerHTML=state.principles.items.length?state.principles.items.map(p=>`<div class="manager-row${p.id===state.currentPrincipleId?' active':''}" data-principle-id="${esc(p.id)}"><b>${esc(p.name)}</b><div class="muted tiny">${esc(p.id)} · ${esc(p.status)}</div></div>`).join(''):'<div class="no-data">暂无原则</div>';
  box.querySelectorAll('[data-principle-id]').forEach(el=>el.onclick=()=>{state.currentPrincipleId=el.dataset.principleId;renderPrincipleList();renderPrincipleEditor()});
}
function renderPrincipleEditor(){
  const box=document.getElementById('principleEditor');if(!box)return;const p=principleById(state.currentPrincipleId);if(!p){box.innerHTML='<div class="no-data">请选择或新建原则。</div>';return}let preset=presetByPrincipleId(p.id);
  box.innerHTML=`<div class="form-grid"><div><label>原则 ID</label><input type="text" value="${esc(p.id)}" disabled></div><div><label>状态</label><select id="pmPrincipleStatus"><option value="active"${p.status==='active'?' selected':''}>active</option><option value="inactive"${p.status==='inactive'?' selected':''}>inactive</option></select></div><div class="span2"><label>原则名称</label><input id="pmPrincipleName" type="text" value="${esc(p.name)}"></div><div class="span2"><label>易混淆原则 IDs</label><input id="pmConfusable" type="text" value="${esc((p.confusablePrincipleIds||[]).join(', '))}"></div></div>
  <div class="section"><div class="section-title">系统预设归纳卡</div><div class="form-grid"><div class="span2"><label>标题（与原则名称自动一致）</label><input id="pmPresetTitle" type="text" readonly value="${esc(p.name)}"></div><div class="span2"><label>内容</label><textarea id="pmPresetContent">${esc(preset?.content||'')}</textarea></div><div><label>状态</label><select id="pmPresetStatus"><option value="draft"${preset?.status==='draft'||!preset?' selected':''}>draft</option><option value="active"${preset?.status==='active'?' selected':''}>active</option><option value="inactive"${preset?.status==='inactive'?' selected':''}>inactive</option></select></div><div><label>版本</label><input id="pmPresetVersion" type="number" min="1" value="${preset?.version||1}"></div></div></div>
  <div class="section toolbar"><button class="btn primary" id="pmSave">保存原则与归纳卡</button><button class="btn danger" id="pmDelete">删除原则</button></div>`;
  document.getElementById('pmSave').onclick=async()=>{
    const button=document.getElementById('pmSave');button.disabled=true;
    const principle={...p,name:document.getElementById('pmPrincipleName').value.trim()||'未命名原则',status:document.getElementById('pmPrincipleStatus').value,confusablePrincipleIds:unique(cleanList(document.getElementById('pmConfusable').value)),updatedAt:Date.now()};
    const nextPreset={...(preset||{id:'preset-'+Date.now().toString(36),principleId:p.id,createdAt:Date.now()}),principleId:p.id,title:principle.name,content:document.getElementById('pmPresetContent').value.trim(),status:document.getElementById('pmPresetStatus').value,version:Math.max(1,Number(document.getElementById('pmPresetVersion').value||1)),updatedAt:Date.now()};
    try{
      Object.assign(p,principle);
      const index=state.synthesisPresets.items.findIndex(item=>item.id===nextPreset.id||item.principleId===p.id);
      if(index>=0)state.synthesisPresets.items[index]=nextPreset;else state.synthesisPresets.items.push(nextPreset);
      refreshAll();markWorkspaceDirty();toast('原则与归纳卡已保存到共享草稿');
    }catch(error){alert('草稿保存失败：'+(error?.message||error))}
    finally{button.disabled=false}
  };
  document.getElementById('pmDelete').onclick=async()=>{
    if(!confirm('从当前共享草稿删除该原则及其归纳卡？题目中的旧原则 ID 会在校验中心提示。'))return;
    const button=document.getElementById('pmDelete');button.disabled=true;
    try{state.principles.items=state.principles.items.filter(item=>item.id!==p.id);state.synthesisPresets.items=state.synthesisPresets.items.filter(item=>item.principleId!==p.id);state.currentPrincipleId=state.principles.items[0]?.id||'';refreshAll();markWorkspaceDirty();toast('原则与归纳卡已从共享草稿删除')}
    catch(error){alert('草稿删除失败：'+(error?.message||error))}
    finally{button.disabled=false}
  };
}
function tagAliasesForSlot(slot){return unique(cleanList(state.tagConfig?.slotAliases?.[slot]||[]))}
function exportTagConfig(){
  syncFlatTagAliases(state.tagConfig);
  const names={};Object.entries(state.tagConfig.names||{}).forEach(([slot,value])=>names[semanticTagSlot(slot)]=value);
  const slotAliases={};Object.entries(state.tagConfig.slotAliases||{}).forEach(([slot,items])=>slotAliases[semanticTagSlot(slot)]=unique(cleanList(items)));
  const looseAliases={};Object.entries(state.tagConfig.looseAliases||{}).forEach(([from,to])=>looseAliases[String(from)]=to);
  return {schemaVersion:3,slotIdStrategy:'global-semantic-v1',names,groupNames:{...(state.tagConfig.groupNames||{})},categoryNames:{...(state.tagConfig.categoryNames||{})},aliases:{...(state.tagConfig.aliases||{})},slotAliases,looseAliases,updatedAt:nowIso()};
}
let tagManagerEditOpen=false;
function renderTagManager(){
  const box=document.getElementById('tagManager');if(!box)return;
  if(!tagManagerEditOpen){
    /* 轻量预览：与科目分类一致的 chips；点击"编辑"进入完整编辑 */
    box.innerHTML=`<div class="toolbar" style="margin-bottom:4px"><span class="muted tiny">展示教师日常使用的中文名称；改名与别名管理点"编辑"。</span><span class="spacer"></span><button class="btn small" id="btnToggleTagEdit" type="button">编辑</button></div>`
      +effectiveTagGroups().map(g=>`<div class="facet-preview-dim"><label>${esc(g.label)}</label>${g.categories.map(c=>`<div class="tag-chip-row-title muted tiny">${esc(c.label)}</div><div class="facet-chip-row">${c.options.map(name=>`<span class="facet-chip">${esc(name)}</span>`).join('')}</div>`).join('')}</div>`).join('');
    const editBtn=document.getElementById('btnToggleTagEdit');
    if(editBtn)editBtn.onclick=()=>{tagManagerEditOpen=true;renderTagManager()};
    return;
  }
  box.innerHTML=`<div class="toolbar" style="margin-bottom:4px"><span class="muted tiny">修改标签名不会自动把旧名称加入 Alias；需要兼容旧名称请在别名栏补填。</span><span class="spacer"></span><button class="btn small primary" id="btnToggleTagEdit" type="button">完成编辑</button></div>`
    +effectiveTagGroups().map(g=>`<div class="tag-group-card"><div class="tag-group-head"><label>一级分类</label><input type="text" data-tag-group="${esc(g.id)}" value="${esc(g.label)}"></div>${g.categories.map(c=>`<div class="tag-category"><div class="tag-category-title"><label>二级分类</label><input type="text" data-tag-category="${esc(g.id+'/'+c.id)}" value="${esc(c.label)}"></div>${c.options.map((name,oi)=>{const slot=tagSlotKey(g,c,oi),aliases=tagAliasesForSlot(slot);return `<div class="tag-slot"><div><input type="text" data-tag-name="${esc(slot)}" value="${esc(name)}"><div class="tag-alias-help">修改标签名不会自动把旧名称加入 Alias。</div></div><div><input type="text" data-tag-aliases="${esc(slot)}" value="${esc(aliases.join(', '))}" placeholder="兼容别名，逗号分隔"><div class="tag-alias-status" data-tag-alias-status="${esc(slot)}">${aliases.length?`已保存 ${aliases.length} 个别名`:'无别名'}</div></div></div>`}).join('')}</div>`).join('')}</div>`).join('');
  const doneBtn=document.getElementById('btnToggleTagEdit');
  if(doneBtn)doneBtn.onclick=()=>{tagManagerEditOpen=false;renderTagManager()};
  box.querySelectorAll('[data-tag-group]').forEach(el=>el.addEventListener('change',()=>{state.tagConfig.groupNames[el.dataset.tagGroup]=el.value.trim();refreshQuestionTagPaths();renderTagManager()}));
  box.querySelectorAll('[data-tag-category]').forEach(el=>el.addEventListener('change',()=>{state.tagConfig.categoryNames[el.dataset.tagCategory]=el.value.trim();refreshQuestionTagPaths();renderTagManager()}));
  box.querySelectorAll('[data-tag-name]').forEach(el=>el.addEventListener('change',()=>{
    const slot=el.dataset.tagName,next=el.value.trim(),oldLabel=tagCatalogEntries().find(x=>x.slot===slot)?.label||'';
    if(!next){renderTagManager();return}
    state.tagConfig.names[slot]=next;
    if(oldLabel&&oldLabel!==next)state.questionBank.questions.forEach(q=>q.tags=unique((q.tags||[]).map(t=>t===oldLabel?next:t)));
    syncFlatTagAliases(state.tagConfig);refreshQuestionTagPaths();renderTagManager();renderQuestions()
  }));
  box.querySelectorAll('[data-tag-aliases]').forEach(el=>el.addEventListener('change',()=>{const slot=el.dataset.tagAliases,current=tagCatalogEntries().find(x=>x.slot===slot)?.label||'';state.tagConfig.slotAliases=state.tagConfig.slotAliases||{};state.tagConfig.slotAliases[slot]=unique(cleanList(el.value)).filter(a=>a&&a!==current);syncFlatTagAliases(state.tagConfig);refreshQuestionTagPaths();const status=box.querySelector(`[data-tag-alias-status="${CSS.escape(slot)}"]`);if(status)status.textContent=state.tagConfig.slotAliases[slot].length?`已保存 ${state.tagConfig.slotAliases[slot].length} 个别名`:'无别名';el.value=state.tagConfig.slotAliases[slot].join(', ')}));
}

function aliasConflicts(){
  const map=new Map();
  state.recallLibrary.nodes.forEach(n=>[n.title,...(n.aliases||[])].filter(Boolean).forEach(t=>{
    if(!map.has(t))map.set(t,[]);
    const rows=map.get(t);
    if(!rows.some(item=>item.id===n.id))rows.push(n);
  }));
  return [...map.entries()].filter(([,a])=>a.length>1).map(([term,nodes])=>({term,nodes}));
}



function exportableQuestion(q){
  const out=clone(q),primary=out.metadata?.knowledge?.primaryNodeId||'';
  registerQuestionId(out.id);out.contentHash=computeQuestionContentHash(out);
  recomputeKeywordLocations(out);
  out.stemParts=buildMarkedParts(questionStem(out),out.clues);
  out.metadata=out.metadata||{};out.metadata.knowledge=out.metadata.knowledge||{};
  delete out.metadata.knowledge.taxonomyId;delete out.metadata.knowledge.taxonomyVersion;
  out.metadata.knowledge.primaryNodeId=primary;
  out.metadata.knowledge.mappingStatus=primary?'confirmed':'unmapped';
  if(primary&&state.knowledgeTree)out.metadata.knowledge.pathSnapshot=state.knowledgeTree.pathFor(primary);
  syncQuestionPrinciples(out);out.tags=unique((out.tags||[]).map(canonicalTagName));out.metadata.tagPaths=out.tags.map(tagPathFor).filter(Boolean);
  out.metadata.translationStatus=(englishStem(out)&&out.translations?.en?.analysis)?'bilingual':'zh_only';
  out.metadata.keywordSystemV2={
    schemaVersion:2,
    name:KEYWORD_SCHEMA,
    keywords:out.clues.map(c=>({
      clueId:c.id,text:c.text,textEn:c.textEn||'',keywordLevel:c.keywordLevel||'normal',isCore:c.keywordLevel==='core',
      solutionRole:c.keywordLevel==='core'?(c.solutionRole||'concept-anchor'):'context',
      coreReason:c.keywordLevel==='core'?(c.coreReason||''):'',
      recallNodeId:c.recallNodeId||'',recallEntryLabel:c.recallEntryLabel||''
    }))
  };
  out.clues=out.clues.map(c=>({
    ...c,
    keywordLevel:c.keywordLevel||'normal',isCore:c.keywordLevel==='core',
    type:c.keywordLevel==='core'?'core-keyword':'recall-keyword',
    solutionRole:c.keywordLevel==='core'?(c.solutionRole||'concept-anchor'):'context',
    coreReason:c.keywordLevel==='core'?(c.coreReason||''):'',
    sourceMode:'prep-studio-keyword-v2',
    conceptIds:primary?[primary]:[]
  }));
  const coreIds=out.clues.filter(c=>c.keywordLevel==='core').map(c=>c.id);
  out.keyPath=out.keyPath&&typeof out.keyPath==='object'?out.keyPath:{};
  out.keyPath.clueIds=coreIds;
  out.keyPath.conceptIds=primary?[primary]:[];
  out.keyPath.primaryConceptId=primary;
  out.keyPath.ruleConceptId=primary;
  out.keyPath.answerId=out.correctAnswer;
  out.analysis=String(out.analysis||out.explanation||'');out.explanation=out.analysis;
  out.status=out.status||{};
  out.status.contentReady=!!(questionStem(out)&&out.options.every(o=>o.text)&&out.analysis);
  out.status.keywordsReady=out.clues.length>0&&out.clues.every(c=>String(c.text||'').trim());
  out.status.knowledgeReady=!!primary;
  out.status.reasoningReady=!!(out.reasoningSteps||[]).length;
  return out;
}
function exportableBank(){
  const b=clone(state.questionBank);b.updatedAt=Date.now();b.questions=state.questionBank.questions.map(QuestionService.prepareForExport);
  if(window.PMPPrepAuthoringContract){
    window.PMPPrepAuthoringContract.attachToQuestionBank(b,{serverBuildEvidence:prepRuntime.serverBuildMetadata||{}});
  }else{
    b.programCompatibility={...(b.programCompatibility||{}),prepStudioVersion:VERSION,architecture:'service-layer-v1',keywordSystem:'Question Keyword System v2',knowledgeBindingStrategy:'current-default-taxonomy-by-subject'};
  }
  return b;
}
function demoKeywordMarkedText(text,q,field,optionId=''){
  const spans=[];q.clues.forEach(c=>{const applies=(c.matchLocations||[]).some(x=>x.field===field&&(field!=='option'||String(x.optionId)===String(optionId)));if(!applies)return;let i=0;while((i=text.indexOf(c.text,i))>=0){spans.push({a:i,b:i+c.text.length,c});i+=Math.max(1,c.text.length)}});
  spans.sort((a,b)=>a.a-b.a||((b.b-b.a)-(a.b-a.a)));const picked=[];spans.forEach(s=>{if(!picked.some(p=>!(s.b<=p.a||s.a>=p.b)))picked.push(s)});picked.sort((a,b)=>a.a-b.a);let out='',cur=0;picked.forEach(s=>{out+=esc(text.slice(cur,s.a));out+=`<span class="demo-keyword ${s.c.keywordLevel==='core'?'core':''}" data-demo-clue="${esc(s.c.id)}">${esc(text.slice(s.a,s.b))}</span>`;cur=s.b});return out+esc(text.slice(cur));
}
function recallLayers(startId,maxDepth=4){
  const byId=recallIndex().byId;if(!byId.has(startId))return [];const layers=[[byId.get(startId)]],seen=new Set([startId]);let frontier=[startId];
  for(let d=1;d<maxDepth;d++){const next=[];state.recallLibrary.edges.forEach(e=>{if(frontier.includes(e.from)&&!seen.has(e.to)&&byId.has(e.to)){seen.add(e.to);next.push(e.to)}});if(!next.length)break;layers.push(next.map(id=>byId.get(id)));frontier=next}return layers;
}
function renderDemoRecall(clue){
  const box=document.getElementById('demoRecallResult');if(!box)return;
  if(!clue?.recallNodeId){box.innerHTML=`<div class="issue error"><strong>${esc(clue?.text||'关键词')} 无有效 recallNodeId</strong></div>`;return}
  const layers=recallLayers(clue.recallNodeId,4);if(!layers.length){box.innerHTML=`<div class="issue error"><strong>联想入口不存在：${esc(clue.recallNodeId)}</strong></div>`;return}
  const knowledge=layers[0][0]?.metadata?.taxonomyNodeId||'',path=knowledge&&state.knowledgeTree?.map.has(knowledge)?state.knowledgeTree.pathFor(knowledge).join(' > '):'未绑定知识树节点';
  box.innerHTML=`<div><b>关键词：</b>${esc(clue.text)} ${clue.keywordLevel==='core'?'<span class="pill core">核心</span>':'<span class="pill normal">普通</span>'}</div><div class="muted tiny" style="margin:5px 0">${esc(path)}</div>`+
    layers.map((layer,i)=>`<div class="recall-layer"><b>${i===0?'入口':`第${i}层`}</b><span>${layer.map(n=>`<button class="chip-btn" data-demo-recall-jump="${esc(n.id)}">${esc(n.title)}</button>`).join(' ')}</span></div>`).join('');
  box.querySelectorAll('[data-demo-recall-jump]').forEach(b=>b.onclick=()=>{state.currentRecallId=b.dataset.demoRecallJump;state.recallPreviewCandidateId='';setTab('association');if(typeof raFocusNode==='function')raFocusNode(b.dataset.demoRecallJump)});
}
function renderDemoPrinciples(q,optionId){
  const box=document.getElementById('demoPrincipleResult');if(!box)return;const ids=q.metadata?.optionPrincipleMap?.[optionId]||[];
  const rows=ids.map(id=>{const p=principleById(id);return p?{p,preset:presetByPrincipleId(id)}:null}).filter(Boolean);
  if(!rows.length){box.innerHTML='<div class="issue warn"><strong>该选项未绑定原则归纳卡</strong><span>请在题目录入区配置。</span></div>';return}
  box.innerHTML=`<div class="muted smalltxt">选项 ${esc(optionId)}：</div>`+rows.map(({p,preset})=>`<div class="principle-card"><strong>${esc(p.name)}</strong><div class="status">${esc(preset?.status||'未配置归纳卡')}</div><div>${esc(preset?.title||'')}</div><div style="margin-top:4px">${esc(preset?.content||'暂无归纳卡内容')}</div></div>`).join('');
}
function demoKeywordMarkedTextEn(text,q,field,optionId=''){
  text=String(text||'');const spans=[];
  q.clues.forEach(c=>{
    const term=String(c.textEn||'').trim();if(!term)return;
    const applies=(c.matchLocations||[]).some(x=>x.field===field&&(field!=='option'||String(x.optionId)===String(optionId)));if(!applies)return;
    let i=0;const lowerText=text.toLowerCase(),lowerTerm=term.toLowerCase();
    while((i=lowerText.indexOf(lowerTerm,i))>=0){spans.push({a:i,b:i+term.length,c});i+=Math.max(1,term.length)}
  });
  spans.sort((a,b)=>a.a-b.a||((b.b-b.a)-(a.b-a.a)));const picked=[];spans.forEach(x=>{if(!picked.some(y=>!(x.b<=y.a||x.a>=y.b)))picked.push(x)});picked.sort((a,b)=>a.a-b.a);
  let out='',cur=0;picked.forEach(x=>{out+=esc(text.slice(cur,x.a));out+=`<span class="demo-keyword ${x.c.keywordLevel==='core'?'core':''}" data-demo-clue="${esc(x.c.id)}">${esc(text.slice(x.a,x.b))}</span>`;cur=x.b});return out+esc(text.slice(cur));
}

function demoEnglishOption(q,id){return q.translations?.en?.options?.find(x=>x.id===id)?.text||''}
function demoQuestionTitle(q){return state.demoLang==='en'?(q.translations?.en?.title||q.title):q.title}
function demoStemHtml(q){
  const zh=demoKeywordMarkedText(questionStem(q),q,'stem'),rawEn=englishStem(q)||'（暂无英文题干）',en=demoKeywordMarkedTextEn(rawEn,q,'stem');
  if(state.demoLang==='en')return en;
  if(state.demoLang==='bi')return `<div>${zh}</div><div class="demo-bilingual-block">${en}</div>`;
  return zh;
}
function demoOptionHtml(q,o){
  const zh=demoKeywordMarkedText(o.text,q,'option',o.id),rawEn=demoEnglishOption(q,o.id)||'（暂无英文选项）',en=demoKeywordMarkedTextEn(rawEn,q,'option',o.id);
  if(state.demoLang==='en')return en;
  if(state.demoLang==='bi')return `<div>${zh}</div><div class="demo-bilingual-block">${en}</div>`;
  return zh;
}
function renderDemoQuestionList(){
  const box=document.getElementById('demoQuestionList');if(!box)return;
  if(!state.demoQuestionId)state.demoQuestionId=state.currentQuestionId||state.questionBank.questions[0]?.id||'';
  document.getElementById('demoQuestionCount').textContent=`${state.questionBank.questions.length} 题`;
  box.innerHTML=state.questionBank.questions.length?state.questionBank.questions.map((q,i)=>{
    const st=questionCompleteness(q);
    return `<div class="list-item${q.id===state.demoQuestionId?' active':''}" data-demo-question-id="${esc(q.id)}"><div class="list-title"><span class="status-dot ${st}"></span>${i+1}. ${esc(q.title)}</div><div class="list-meta">${esc(q.id)} · ${esc(q.difficulty||'')}</div></div>`;
  }).join(''):'<div class="no-data">暂无题目</div>';
  box.querySelectorAll('[data-demo-question-id]').forEach(el=>el.onclick=()=>{state.demoQuestionId=el.dataset.demoQuestionId;renderDemoValidation()});
}
function renderDemoValidation(){
  const host=document.getElementById('demoQuestion');if(!host)return;renderDemoQuestionList();
  const q=state.questionBank.questions.find(x=>x.id===state.demoQuestionId);if(!q){host.innerHTML='<div class="no-data">暂无题目</div>';return}
  recomputeKeywordLocations(q);
  document.querySelectorAll('[data-demo-lang]').forEach(b=>{b.classList.toggle('active',b.dataset.demoLang===state.demoLang);b.onclick=()=>{state.demoLang=b.dataset.demoLang;renderDemoValidation()}});
  const tags=(q.tags||[]).map(t=>`<span class="demo-tag${tagPathFor(t)?'':' unbound'}" title="${tagPathFor(t)?'已绑定标签槽位':'未绑定预设标签槽位'}">${esc(t)}</span>`).join('');
  host.innerHTML=`<div class="demo-question"><div class="demo-tags">${tags||'<span class="demo-tag unbound">无标签</span>'}</div>
    <div style="font-weight:900;margin-bottom:8px">${esc(demoQuestionTitle(q))}</div>
    <div class="demo-stem">${demoStemHtml(q)}</div>
    ${q.options.map(o=>`<div class="demo-option${q.correctAnswer===o.id?' demo-answer':''}" data-demo-option="${esc(o.id)}"><b>${esc(o.id)}.</b> ${demoOptionHtml(q,o)}${q.correctAnswer===o.id?'<span class="answer-badge">正确答案</span>':''}</div>`).join('')}
    <details style="margin-top:12px"><summary>查看解析</summary><div style="padding:8px 2px">${
      state.demoLang==='en'?esc(q.translations?.en?.analysis||'暂无英文解析'):
      state.demoLang==='bi'?`<div>${esc(q.analysis||'暂无解析')}</div><div class="demo-bilingual-block">${esc(q.translations?.en?.analysis||'暂无英文解析')}</div>`:
      esc(q.analysis||'暂无解析')
    }</div></details></div>`;
  host.querySelectorAll('[data-demo-clue]').forEach(el=>el.onclick=e=>{e.stopPropagation();renderDemoRecall(q.clues.find(x=>x.id===el.dataset.demoClue))});
  host.querySelectorAll('[data-demo-option]').forEach(el=>el.onclick=e=>{if(e.target.closest('[data-demo-clue]'))return;host.querySelectorAll('[data-demo-option]').forEach(x=>x.classList.remove('active'));el.classList.add('active');renderDemoPrinciples(q,el.dataset.demoOption)});
  document.getElementById('demoRecallResult').textContent='点击题目中的关键词进行检查。';
  document.getElementById('demoPrincipleResult').textContent='点击 A/B/C/D 选项查看对应原则归纳卡。';
}

function runValidation(){
  /* 校验临时关闭(PREP_VALIDATION_DISABLED,见 00-core-bootstrap.js):跳过全部题目级校验,
   * 仅保留导出依赖的副作用(contentHash 计算 + 原则引用规整);恢复开关后走原逻辑。 */
  if(typeof PREP_VALIDATION_DISABLED!=='undefined'&&PREP_VALIDATION_DISABLED){
    state.questionBank.questions.forEach(q=>{q.contentHash=computeQuestionContentHash(q);syncQuestionPrinciples(q)});
    state.validation={at:nowIso(),issues:[],metrics:{questions:state.questionBank.questions.length,errors:0,warnings:0,normalKeywords:state.questionBank.questions.reduce((n,q)=>n+q.clues.filter(c=>c.keywordLevel!=='core').length,0),coreKeywords:state.questionBank.questions.reduce((n,q)=>n+q.clues.filter(c=>c.keywordLevel==='core').length,0),recallNodes:state.recallLibrary.nodes.length,recallEdges:state.recallLibrary.edges.length,principles:state.principles.items.length,presets:state.synthesisPresets.items.length,aliasConflicts:0},disabled:true};
    renderValidation();return state.validation;
  }
  const issues=[];
  if(!prepRuntime.creatorProfile?.name)issues.push({level:'error',object:'制作人身份',message:'当前页面尚未选择制作人',suggest:'返回制作人入口，必须选择 6 人之一后才能继续。'});
  const contentHashOwners=new Map();;
  const qids=new Set();
  state.questionBank.questions.forEach(q=>{
    if(qids.has(q.id))issues.push({level:'error',object:q.id,message:'题目 ID 重复',suggest:'该文件可能来自旧版本或被手工修改；新题 ID 应全部由 Prep Studio 自动生成。'});qids.add(q.id);
    const ch=computeQuestionContentHash(q);q.contentHash=ch;
    if(contentHashOwners.has(ch))issues.push({level:'warn',object:q.id,message:`疑似重复题内容：与 ${contentHashOwners.get(ch)} 的 Content Hash 相同`,suggest:'确认是否为重复题；服务器未来可用 contentHash 做二次去重。'});
    else contentHashOwners.set(ch,q.id);
    validateQuestion(q,true).forEach(x=>issues.push(x));
    validateQuestionFamily(q).forEach(x=>issues.push({...x,questionId:q.id,field:'metadata.questionFamily'}));
  });
  validateFamilyStructure(state.questionBank.questions).forEach(x=>issues.push(x));
  state.questionBank.questions.forEach(q=>{const metadata=syncQuestionPrinciples(q);(metadata.stemPrincipleIds||[]).forEach(id=>{if(!principleById(id))issues.push({level:'error',object:q.id,questionId:q.id,field:'metadata.stemPrincipleIds',message:`题干原则 ID 不存在：${id}`,suggest:'在原则管理中创建或重新绑定。'})});Object.entries(metadata.optionPrincipleMap||{}).forEach(([opt,ids])=>(ids||[]).forEach(id=>{if(!principleById(id))issues.push({level:'error',object:q.id,questionId:q.id,field:`metadata.optionPrincipleMap.${opt}`,message:`选项 ${opt} 的原则 ID 不存在：${id}`,suggest:'重新绑定选项原则。'})}));const correctIds=metadata.optionPrincipleMap?.[q.correctAnswer]||[];if(correctIds.length!==1)issues.push({level:'error',object:q.id,questionId:q.id,field:'metadata.optionPrincipleMap',message:'正确选项必须绑定且只能绑定一条原则',suggest:'在题目录入区为正确选项保留一条原则；多题归纳据此分组。'});validateQuestionFacets(q).forEach(x=>issues.push({level:x.level,object:q.id,questionId:q.id,field:'metadata.subjectFacets',message:x.message,suggest:x.suggest}));(q.tags||[]).forEach(tag=>{if(!tagPathFor(tag))issues.push({level:'warn',object:q.id,questionId:q.id,field:'metadata.tagPaths',message:`标签“${tag}”未绑定主程序预设标签槽位`,suggest:'保留为自由标签，或在标签管理中映射/改名。'})})});
  state.principles.items.forEach(p=>{const preset=presetByPrincipleId(p.id);if(!preset||!preset.content)issues.push({level:'warn',object:p.id,message:`原则“${p.name}”缺少归纳卡内容`,suggest:'补充 synthesis preset。'})});
  const conflicts=aliasConflicts();conflicts.forEach(c=>issues.push({level:'error',object:'联想库',message:`名称/Alias 冲突：“${c.term}” → ${c.nodes.map(n=>n.title).join(' / ')}`,suggest:'保留唯一入口，或把 Alias 改成更具体的词。'}));
  const recallIds=new Set(state.recallLibrary.nodes.map(n=>n.id));
  state.recallLibrary.edges.forEach(e=>{if(!recallIds.has(e.from)||!recallIds.has(e.to))issues.push({level:'error',object:'联想库',message:`关系 ${e.id} 端点不存在`,suggest:'删除或修正关系。'})});
  const coreCount=state.questionBank.questions.reduce((n,q)=>n+q.clues.filter(c=>c.keywordLevel==='core').length,0);
  const normalCount=state.questionBank.questions.reduce((n,q)=>n+q.clues.filter(c=>c.keywordLevel!=='core').length,0);
  state.validation={at:nowIso(),issues,metrics:{questions:state.questionBank.questions.length,errors:issues.filter(x=>x.level==='error').length,warnings:issues.filter(x=>x.level==='warn').length,normalKeywords:normalCount,coreKeywords:coreCount,recallNodes:state.recallLibrary.nodes.length,recallEdges:state.recallLibrary.edges.length,principles:state.principles.items.length,presets:state.synthesisPresets.items.length,aliasConflicts:conflicts.length}};
  renderValidation();return state.validation;
}
function renderValidation(){
  const v=state.validation||runValidation(),m=v.metrics;
  const banner=document.getElementById('validationDisabledBanner');
  if(banner)banner.hidden=!v.disabled;
  document.getElementById('validationMetrics').innerHTML=[
    ['题目',m.questions],['错误',m.errors],['提醒',m.warnings],['普通关键词',m.normalKeywords],
    ['核心关键词',m.coreKeywords],['联想节点',m.recallNodes],['原则',m.principles],['归纳卡',m.presets],['Alias 冲突',m.aliasConflicts]
  ].map(([k,n])=>`<div class="metric"><span class="muted">${k}</span><b>${n}</b></div>`).join('');
  const rows=document.getElementById('validationRows');
  rows.innerHTML=v.disabled?'<tr><td colspan="4">校验已临时关闭，未执行题目级校验。</td></tr>':v.issues.length?v.issues.map(x=>`<tr${x.questionId?` class="validation-row-action" tabindex="0" data-question-id="${esc(x.questionId)}" data-field-path="${esc(x.field||'')}" title="点击定位到题目编辑区"`:''}><td>${x.level==='error'?'❌ 错误':'⚠ 提醒'}</td><td>${esc(x.object||'')}</td><td>${esc(x.message)}</td><td>${esc(x.suggest||'')}</td></tr>`).join(''):'<tr><td colspan="4">✓ 未发现问题</td></tr>';
  rows.querySelectorAll('[data-question-id]').forEach(row=>{
    const jump=()=>goToValidationIssue(row.dataset.questionId,row.dataset.fieldPath||'');
    row.onclick=jump;
    row.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();jump()}};
  });
}
function validationFieldTarget(field){
  if(field==='title')return '[data-qfield="title"]';
  if(field==='stemParts')return '#stemZh';
  if(field==='options'||field==='correctAnswer')return '[data-option]';
  if(field==='analysis')return '#analysisZh';
  if(field.startsWith('translations.en.stemParts'))return '#stemEn';
  if(field.startsWith('translations.en.options'))return '[data-enoption]';
  if(field.startsWith('translations.en.analysis'))return '#analysisEn';
  if(field.startsWith('metadata.knowledge'))return '#primaryNode';
  if(field.startsWith('metadata.questionFamily'))return '#questionFamilyPanel';
  if(field.startsWith('metadata.subjectFacets'))return '#questionFacetBindingPanel';
  if(field.startsWith('metadata.stemPrincipleIds')||field.startsWith('metadata.optionPrincipleMap'))return '#questionPrincipleBindingPanel';
  if(field.startsWith('clues'))return '#keywordManager';
  return '#questionEditor';
}
function goToValidationIssue(questionId,field=''){
  if(!state.questionBank.questions.some(q=>q.id===questionId))return false;
  state.currentQuestionId=questionId;
  setTab('questions');renderQuestions();
  const target=document.querySelector(validationFieldTarget(field));
  target?.scrollIntoView?.({behavior:'smooth',block:'center'});
  if(target?.matches?.('input,textarea,select,button'))target.focus();
  else target?.classList?.add('validation-target-pulse');
  return true;
}
function workspacePayload(){return {
  prepStudioWorkspaceVersion:6,prepStudioVersion:VERSION,savedAt:nowIso(),
  schema:{tagSlots:'global-semantic-v1',subjectFacets:'subject-facet-registry-v1',questionIds:'uuid-v4',keywordSystem:KEYWORD_SCHEMA,questionFamily:'question-family-v1'},
  knowledgeTree:state.knowledgeTree?{taxonomy:{id:state.knowledgeTree.id,subjectId:state.knowledgeTree.subjectId,name:{zh:state.knowledgeTree.name},version:state.knowledgeTree.version,nodes:state.knowledgeTree.nodes}}:null,
  recallLibrary:state.recallLibrary,questionBank:state.questionBank,principles:state.principles,synthesisPresets:state.synthesisPresets,tagConfig:state.tagConfig,subjectFacetRegistry:state.subjectFacetRegistry,
  server:{
    serverBankId:prepRuntime.serverBankId||'',serverBankRevision:prepRuntime.serverBankRevision??null,
    clientInstanceId:prepRuntime.clientInstanceId,lastIdempotencyKey:prepRuntime.lastIdempotencyKey||'',
    lastBatchId:prepRuntime.lastBatchId||'',lastUploadFingerprint:prepRuntime.lastUploadFingerprint||''
  },
  identitySnapshot:{deviceProfile:clone(prepRuntime.deviceProfile||{})},
  system:{issuedQuestionIds:[...prepRuntime.issuedQuestionIds]},
  ui:{currentQuestionId:state.currentQuestionId,currentRecallId:state.currentRecallId,currentPrincipleId:state.currentPrincipleId,demoQuestionId:state.demoQuestionId,demoLang:state.demoLang}
}}
function migrateWorkspacePayload(input){
  if(!input||!input.prepStudioWorkspaceVersion)throw new Error('不是 Prep Studio 工作区草稿');
  const w=clone(input),from=Number(w.prepStudioWorkspaceVersion||1);
  let migrated=false;
  if(from<4){
    w.tagConfig=normalizeTagConfig(w.tagConfig||{});
    w.schema={...(w.schema||{}),tagSlots:'semantic-v1',questionIds:'uuid-v4',keywordSystem:KEYWORD_SCHEMA};
    w.prepStudioWorkspaceVersion=4;migrated=true;
  }
  if(from<5){
    /* P4.5.29 v5：Tag 统一 global-semantic-v1，补 Subject Facet Registry，题目补 subjectFacets 默认 [] */
    w.tagConfig=normalizeTagConfig(w.tagConfig||{});
    if(typeof normalizeSubjectFacetRegistry==='function')w.subjectFacetRegistry=normalizeSubjectFacetRegistry(w.subjectFacetRegistry||{});
    if(w.questionBank&&Array.isArray(w.questionBank.questions))w.questionBank.questions=w.questionBank.questions.map(q=>{
      const metadata=q.metadata&&typeof q.metadata==='object'?q.metadata:{};
      return {...q,metadata:{...metadata,subjectFacets:Array.isArray(metadata.subjectFacets)?metadata.subjectFacets:[]}};
    });
    w.schema={...(w.schema||{}),tagSlots:'global-semantic-v1',subjectFacets:'subject-facet-registry-v1'};
    w.prepStudioWorkspaceVersion=5;migrated=true;
  }
  if(from<6){
    /* P4.5.29 v6：Question Family v1 归一（缺省 standalone） */
    if(w.questionBank&&Array.isArray(w.questionBank.questions)&&typeof normalizeQuestionFamily==='function')w.questionBank.questions=w.questionBank.questions.map(q=>{
      const metadata=q.metadata&&typeof q.metadata==='object'?q.metadata:{};
      return {...q,metadata:{...metadata,questionFamily:normalizeQuestionFamily(metadata.questionFamily||{},q.id,q.difficulty)}};
    });
    w.schema={...(w.schema||{}),questionFamily:'question-family-v1'};
    w.prepStudioWorkspaceVersion=6;migrated=true;
  }
  if(migrated){w.migratedFromVersion=from;w.migratedAt=nowIso()}
  const server=w.server&&typeof w.server==='object'?w.server:{};
  w.server={
    serverBankId:String(server.serverBankId||''),
    serverBankRevision:Number(server.serverBankRevision)||null,
    clientInstanceId:String(server.clientInstanceId||generateSystemId('prep_client')),
    lastIdempotencyKey:String(server.lastIdempotencyKey||''),
    lastBatchId:String(server.lastBatchId||''),
    lastUploadFingerprint:String(server.lastUploadFingerprint||'')
  };
  if(w.questionBank&&Array.isArray(w.questionBank.questions))w.questionBank.questions=w.questionBank.questions.map(question=>({
    ...question,serverRevision:Number(question.serverRevision)||null,
    serverContentHash:String(question.serverContentHash||''),lastSyncedAt:String(question.lastSyncedAt||''),
    serverExportSnapshot:String(question.serverExportSnapshot||'')
  }));
  return w;
}
function applyWorkspacePayload(input){
  const w=migrateWorkspacePayload(input);
  prepRuntime.serverBankId=w.server.serverBankId;prepRuntime.serverBankRevision=w.server.serverBankRevision;
  prepRuntime.clientInstanceId=w.server.clientInstanceId;prepRuntime.lastIdempotencyKey=w.server.lastIdempotencyKey;
  prepRuntime.lastBatchId=w.server.lastBatchId;prepRuntime.lastUploadFingerprint=w.server.lastUploadFingerprint;
  state.knowledgeTree=w.knowledgeTree?normalizeTree(w.knowledgeTree):null;
  state.recallLibrary=normalizeRecall(w.recallLibrary||{});
  state.tagConfig=normalizeTagConfig(w.tagConfig||{});
  state.subjectFacetRegistry=normalizeSubjectFacetRegistry(w.subjectFacetRegistry||{});
  state.principles=normalizePrinciples(w.principles||{});
  state.synthesisPresets=normalizePresets(w.synthesisPresets||{});
  state.questionBank=normalizeBank(w.questionBank||{questions:[]});
  (w.system?.issuedQuestionIds||[]).forEach(registerQuestionId);
  state.questionBank.questions.forEach(q=>registerQuestionId(q.id));
  const ui=w.ui||{};
  state.currentQuestionId=state.questionBank.questions.some(q=>q.id===ui.currentQuestionId)?ui.currentQuestionId:(state.questionBank.questions[0]?.id||'');
  state.currentRecallId=state.recallLibrary.nodes.some(n=>n.id===ui.currentRecallId)?ui.currentRecallId:(state.recallLibrary.nodes[0]?.id||'');
  state.currentPrincipleId=state.principles.items.some(p=>p.id===ui.currentPrincipleId)?ui.currentPrincipleId:(state.principles.items[0]?.id||'');
  state.demoQuestionId=state.questionBank.questions.some(q=>q.id===ui.demoQuestionId)?ui.demoQuestionId:state.currentQuestionId;
  state.demoLang=['zh','en','bi'].includes(ui.demoLang)?ui.demoLang:'zh';
  state.recallPreviewCandidateId='';refreshQuestionTagPaths();refreshAll();
}

function refreshAll(){refreshHeader();renderQuestions();if(typeof renderRecallAcceptance==='function')renderRecallAcceptance();renderPrincipleList();renderPrincipleEditor();renderTagManager();renderSubjectFacetManager();if(document.getElementById('tab-demo')?.classList.contains('active'))renderDemoValidation()}
document.getElementById('tabs').addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(b)setTab(b.dataset.tab)});
document.getElementById('btnNewQuestion').onclick=newQuestion;
document.getElementById('btnCreateFamilyMemberToolbar').onclick=createFamilyMemberFromCurrent;
document.getElementById('btnDuplicateQuestion').onclick=duplicateQuestion;
document.getElementById('btnDeleteQuestion').onclick=deleteQuestion;
document.getElementById('btnAddNormalKeyword').onclick=()=>addKeyword('normal');
document.getElementById('btnAddCoreKeyword').onclick=()=>addKeyword('core');
document.getElementById('btnNewPrinciple').onclick=newPrinciple;
document.getElementById('btnRunValidation').onclick=runValidation;
document.querySelectorAll('[data-creator-key]').forEach(btn=>btn.addEventListener('click',()=>selectFixedCreator(btn.dataset.creatorKey)));
document.getElementById('btnSwitchCreator').onclick=requireCreatorSelection;
document.getElementById('btnSwitchCreatorBase').onclick=requireCreatorSelection;
document.getElementById('themeSelect').addEventListener('change',e=>applyTheme(e.target.value,{persist:true}));
document.getElementById('btnQuickSaveWorkspace').onclick=()=>window.PMPPrepDraftUi?.save?.().catch(error=>alert(error.message||error));
document.getElementById('btnSaveWorkspaceLocal').onclick=()=>window.PMPPrepDraftUi?.save?.().catch(error=>alert(error.message||error));
document.getElementById('btnOpenSharedDrafts').onclick=()=>window.PMPPrepDraftUi?.open?.();




document.addEventListener('input',event=>{if(!event.target.closest?.('[data-transient-ui]'))markWorkspaceDirty()},true);
document.addEventListener('change',e=>{if(e.target.id!=='themeSelect')markWorkspaceDirty()},true);
document.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  const mutationIds=new Set(['btnNewQuestion','btnCreateFamilyMemberToolbar','btnDuplicateQuestion','btnDeleteQuestion','btnAddNormalKeyword','btnAddCoreKeyword','btnNewPrinciple','btnParsePastedQuestions','pmSave','pmDelete','floatSave','floatDelete']);
  if(mutationIds.has(b.id)||b.dataset.removeKw||b.dataset.removeEdge)markWorkspaceDirty();
},true);
function isTextEntryTarget(target){
  return !!target?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""]');
}
document.addEventListener('keydown',event=>{
  if(event.key!=='Delete'||event.repeat||event.defaultPrevented||isTextEntryTarget(event.target))return;
  if(currentTabName()!=='questions'||!currentQuestion())return;
  event.preventDefault();
  deleteQuestion();
});
function currentTabName(){return document.querySelector('nav button.active')?.dataset.tab||'base'}
function setHelpTopic(topic){
  const valid=new Set(['base','management','questions','association','demo','validate','export','global']);topic=valid.has(topic)?topic:'global';
  document.querySelectorAll('[data-help-topic]').forEach(b=>b.classList.toggle('active',b.dataset.helpTopic===topic));
  document.querySelectorAll('[data-help-content]').forEach(x=>x.classList.toggle('active',x.dataset.helpContent===topic));
  const label=document.querySelector(`[data-help-topic="${topic}"]`)?.textContent?.trim()||'';const hint=document.getElementById('helpCurrentHint');if(hint)hint.textContent=label;
}
function openHelp(topic=currentTabName()){setHelpTopic(topic);document.getElementById('helpModal').classList.add('show')}
function closeHelp(){document.getElementById('helpModal').classList.remove('show')}
