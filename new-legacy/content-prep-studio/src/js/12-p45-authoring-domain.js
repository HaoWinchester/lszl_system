/*
 * P4.5 Authoring Domain：Family / Facet / 难度 / Global Tag 的纯归一与校验函数（无 DOM）。
 * 参考 V9.0-P4.5.29 单文件业务规则，按服务器版口径收紧：
 * - Facet 无效引用是 error（阻止正式同步），deprecated 引用是 warning（兼容历史 Schema）。
 * - Registry 显式传参（默认取 state），保证纯函数可测。
 */

const DEFAULT_PMP_FACET_SCHEMA={
  schemaId:'pmp-facet-schema-v1',schemaVersion:1,subjectId:'subject-pmp',subjectCodes:['PMP'],name:'PMP 科目分类',status:'active',
  dimensions:[
    {id:'performance-domain',label:'绩效域',selection:'multi',values:[
      {id:'governance',label:'治理',status:'active',aliases:[],replacedBy:[]},{id:'stakeholder',label:'相关方',status:'active',aliases:[],replacedBy:[]},{id:'resources',label:'资源',status:'active',aliases:[],replacedBy:[]},{id:'scope',label:'范围',status:'active',aliases:[],replacedBy:[]},{id:'schedule',label:'进度',status:'active',aliases:[],replacedBy:[]},{id:'finance',label:'财务',status:'active',aliases:[],replacedBy:[]},{id:'risk',label:'风险',status:'active',aliases:[],replacedBy:[]}
    ]},
    {id:'exam-domain',label:'考试域',selection:'multi',values:[
      {id:'people',label:'人员',status:'active',aliases:[],replacedBy:[]},{id:'process',label:'过程',status:'active',aliases:[],replacedBy:[]},{id:'business-environment',label:'业务环境',status:'active',aliases:[],replacedBy:[]}
    ]},
    {id:'delivery-approach',label:'交付方式',selection:'multi',values:[
      {id:'predictive',label:'预测型',status:'active',aliases:[],replacedBy:[]},{id:'adaptive-agile',label:'敏捷 / 自适应',status:'active',aliases:[],replacedBy:[]},{id:'hybrid',label:'混合型',status:'active',aliases:[],replacedBy:[]}
    ]},
    {id:'focus-area',label:'焦点阶段',selection:'multi',values:[
      {id:'initiating',label:'启动',status:'active',aliases:[],replacedBy:[]},{id:'planning',label:'规划',status:'active',aliases:[],replacedBy:[]},{id:'executing',label:'执行',status:'active',aliases:[],replacedBy:[]},{id:'monitoring-controlling',label:'监控',status:'active',aliases:[],replacedBy:[]},{id:'closing',label:'收尾',status:'active',aliases:[],replacedBy:[]}
    ]}
  ],createdAt:'2026-08-08T00:00:00.000Z',updatedAt:'2026-08-08T00:00:00.000Z'
};

function normalizeFacetValue(v={}){
  return {id:String(v.id||'').trim(),label:String(v.label||v.name||'').trim(),status:['active','inactive','deprecated'].includes(String(v.status||''))?String(v.status):'active',aliases:unique(cleanList(v.aliases)),replacedBy:unique(cleanList(v.replacedBy)),createdAt:String(v.createdAt||''),updatedAt:String(v.updatedAt||'')};
}
function normalizeFacetDimension(d={}){
  return {id:String(d.id||'').trim(),label:String(d.label||d.name||'').trim(),selection:d.selection==='single'?'single':'multi',status:['active','inactive','deprecated'].includes(String(d.status||''))?String(d.status):'active',values:(Array.isArray(d.values)?d.values:[]).map(normalizeFacetValue).filter(v=>v.id&&v.label)};
}
function normalizeFacetSchema(s={}){
  return {schemaId:String(s.schemaId||s.id||'').trim(),schemaVersion:Math.max(1,Number(s.schemaVersion||s.version||1)),subjectId:String(s.subjectId||'').trim(),subjectCodes:unique(cleanList(s.subjectCodes||[s.subjectCode,s.code])),name:String(s.name||'科目分类').trim(),status:['active','inactive','deprecated'].includes(String(s.status||''))?String(s.status):'active',dimensions:(Array.isArray(s.dimensions)?s.dimensions:[]).map(normalizeFacetDimension).filter(d=>d.id&&d.label),createdAt:String(s.createdAt||''),updatedAt:String(s.updatedAt||''),...(Number(s.revision)>0?{revision:Number(s.revision)}:{})};
}
function normalizeSubjectFacetRegistry(payload){
  const rows=Array.isArray(payload?.schemas)?payload.schemas:(payload?.schemaId?[payload]:[]),bySubject=new Map();
  [clone(DEFAULT_PMP_FACET_SCHEMA),...rows].map(normalizeFacetSchema).filter(s=>s.schemaId&&s.subjectId).forEach(s=>bySubject.set(s.subjectId,s));
  return {schemaVersion:1,format:'subject-facet-registry-v1',schemas:[...bySubject.values()],updatedAt:String(payload?.updatedAt||nowIso())};
}
function facetSchemaForSubject(subject,registry){
  const token=String(subject||state?.questionBank?.subject||'').trim().toLowerCase();
  return ((registry||state?.subjectFacetRegistry)?.schemas||[]).find(s=>[s.subjectId,...(s.subjectCodes||[])].some(x=>String(x||'').trim().toLowerCase()===token||String(x||'').trim().toLowerCase()===`subject-${token}`))||null;
}
function facetIdFor(schema,dimensionId,valueId){
  const slug=String(schema?.subjectId||'').replace(/^subject-/,'')||String(schema?.subjectCodes?.[0]||'').toLowerCase();
  return `subject/${slug}/${dimensionId}/${valueId}`;
}
function facetCatalog(subject,registry){
  const schema=facetSchemaForSubject(subject,registry);if(!schema)return [];const out=[];
  schema.dimensions.forEach(d=>d.values.forEach(v=>out.push({facetId:facetIdFor(schema,d.id,v.id),subjectId:schema.subjectId,schemaId:schema.schemaId,schemaVersion:schema.schemaVersion,dimensionId:d.id,dimension:d.label,valueId:v.id,label:v.label,status:v.status,replacedBy:v.replacedBy||[],aliases:v.aliases||[]})));
  return out;
}
function normalizeQuestionFacets(value,subject,registry){
  const raw=Array.isArray(value)?value:[],byId=new Map(facetCatalog(subject,registry).map(x=>[x.facetId,x])),schema=facetSchemaForSubject(subject,registry),out=[];
  raw.forEach(item=>{
    const id=String(typeof item==='string'?item:(item?.facetId||item?.slotId||item?.id)||'').trim();
    if(!id)return;
    const found=byId.get(id);
    if(found)out.push(clone(found));
    else if(typeof item==='object')out.push({...clone(item),facetId:id,subjectId:String(item.subjectId||schema?.subjectId||''),status:String(item.status||'unknown')});
    else out.push({facetId:id,subjectId:schema?.subjectId||'',label:id,status:'unknown'});
  });
  return [...new Map(out.map(x=>[x.facetId,x])).values()];
}
function selectedFacetsFromIds(ids,subject,registry){
  const map=new Map(facetCatalog(subject,registry).map(x=>[x.facetId,x]));
  return unique(ids).map(id=>map.get(id)).filter(Boolean).map(clone);
}
function importFacetSchema(payload){
  const schema=normalizeFacetSchema(payload?.schema||payload);
  if(!schema.schemaId)throw new Error('Facet Schema 缺少 schemaId');
  if(!schema.subjectId)throw new Error('Facet Schema 缺少 subjectId');
  if(!schema.dimensions.length)throw new Error('Facet Schema 缺少 dimensions（至少一个维度）');
  const reg=normalizeSubjectFacetRegistry(state.subjectFacetRegistry);
  const idx=reg.schemas.findIndex(s=>s.schemaId===schema.schemaId||s.subjectId===schema.subjectId);
  schema.updatedAt=nowIso();if(!schema.createdAt)schema.createdAt=nowIso();
  if(idx>=0)reg.schemas[idx]=schema;else reg.schemas.push(schema);
  state.subjectFacetRegistry=reg;
  return schema;
}
function validateQuestionFacets(q,registry){
  const subject=q?.subject||state?.questionBank?.subject;
  const rows=normalizeQuestionFacets(q?.metadata?.subjectFacets||[],subject,registry);
  const issues=[];
  rows.forEach(row=>{
    if(row.status==='unknown')issues.push({level:'error',message:`科目分类 ${row.facetId} 不在当前 Schema 中，已阻止正式同步`,suggest:'在题目编辑区清除该分类，或先导入包含该 ID 的 Facet Schema。'});
    else if(row.status==='deprecated')issues.push({level:'warning',message:`科目分类 ${row.label||row.facetId} 已 deprecated`,suggest:'保留为历史兼容引用，或改选当前值。'});
  });
  return issues;
}

/* 加载顺序保证 state 初始化后 registry 可用 */
state.subjectFacetRegistry=normalizeSubjectFacetRegistry(state.subjectFacetRegistry||{});

/*
 * Question Family v1（P4.5.29 差异 12–20、28）
 * 领域规则与 V9.0-P4.5.29 单文件一致：三种角色、等价/拆解/扩展关系、A/B/C 等价等级、
 * 独立 L1–L4 诊断层级、用途多选、教师人工 qualityConfirmed；外部导入一律强制 false。
 */

const QUESTION_FAMILY_SCHEMA='question-family-v1';
const FAMILY_ROLES=new Set(['standalone','root','member']);
const FAMILY_RELATIONS=new Set(['standalone','root','equivalent','decomposed','extension']);
const FAMILY_VARIANT_TYPES=new Set(['none','stem','options','scenario','parameter','mixed','decomposed','advanced']);
const FAMILY_EQUIVALENCE_GRADES=new Set(['','A','B','C']);
const FAMILY_DIAGNOSTIC_TARGETS=new Set(['general','concept','understanding','discrimination','application','analysis','case-transfer']);
const FAMILY_PURPOSES=new Set(['practice','error-confirmation','diagnosis','post-remediation-verification','delayed-verification','mastery-check']);
const FAMILY_HIGH_ORDER_TARGETS=new Set(['application','analysis','case-transfer']);
const FAMILY_PURPOSE_LABELS={practice:'普通练习','error-confirmation':'错误确认',diagnosis:'诊断','post-remediation-verification':'补救后验证','delayed-verification':'延迟验证','mastery-check':'掌握度检测'};

function normalizeQuestionDifficulty(value){
  const d=String(value||'').trim().toLowerCase();
  if(['easy','simple','基础','简单','初级','1','l1','★'].includes(d))return '简单';
  if(['medium','中等','中级','常规','2','l2','★★'].includes(d))return '中等';
  if(['hard','困难','难点','高级','复杂','高阶','专家','3','4','l3','l4','★★★'].includes(d))return '困难';
  return '中等';
}
function difficultyLevelFromQuestion(difficulty){
  const d=String(difficulty||'').trim();
  if(/^L?4$/i.test(d)||/高阶|专家/.test(d))return 4;
  if(/^L?3$/i.test(d)||/困难|复杂|难/.test(d))return 3;
  if(/^L?1$/i.test(d)||/基础|简单|易/.test(d))return 1;
  return 2;
}
function normalizeFamilyRole(v){v=String(v||'').trim().toLowerCase();if(['母题','root','parent','master'].includes(v))return 'root';if(['成员','member','child','变体','诊断题'].includes(v))return 'member';return FAMILY_ROLES.has(v)?v:'standalone'}
function normalizeFamilyRelation(v){v=String(v||'').trim().toLowerCase();const map={'母题':'root','等价':'equivalent','强等价':'equivalent','变体':'equivalent','拆解':'decomposed','能力拆解':'decomposed','扩展':'extension','高阶扩展':'extension','独立':'standalone'};v=map[v]||v;return FAMILY_RELATIONS.has(v)?v:'standalone'}
function normalizeFamilyVariantType(v){v=String(v||'').trim().toLowerCase();const map={'题干':'stem','题干变体':'stem','选项':'options','选项变体':'options','情境':'scenario','案例':'scenario','情境变体':'scenario','参数':'parameter','数字':'parameter','混合':'mixed','拆解':'decomposed','能力拆解':'decomposed','高阶':'advanced','高阶变体':'advanced','无':'none'};v=map[v]||v;return FAMILY_VARIANT_TYPES.has(v)?v:'none'}
function normalizeDiagnosticTarget(v){v=String(v||'').trim().toLowerCase();const map={'概念':'concept','概念识别':'concept','理解':'understanding','辨析':'discrimination','应用':'application','分析':'analysis','案例':'case-transfer','案例迁移':'case-transfer','迁移':'case-transfer','综合':'case-transfer','一般':'general'};v=map[v]||v;return FAMILY_DIAGNOSTIC_TARGETS.has(v)?v:'general'}
function normalizeFamilyPurposes(v){return unique(cleanList(v).map(x=>{const s=String(x||'').trim().toLowerCase(),map={'练习':'practice','普通练习':'practice','错误确认':'error-confirmation','确认':'error-confirmation','诊断':'diagnosis','补救后验证':'post-remediation-verification','验证':'post-remediation-verification','延迟验证':'delayed-verification','掌握度检测':'mastery-check','掌握验证':'mastery-check'};return map[s]||s}).filter(x=>FAMILY_PURPOSES.has(x)))}
function normalizeEquivalenceGrade(v){v=String(v||'').trim().toUpperCase();const map={'强等价':'A','近似等价':'B','关联':'C'};v=map[v]||v;return FAMILY_EQUIVALENCE_GRADES.has(v)?v:''}
function normalizeQuestionFamily(raw={},qId='',difficulty='中等'){
  raw=raw&&typeof raw==='object'?clone(raw):{};
  const role=normalizeFamilyRole(raw.role||raw.familyRole);
  const relation=role==='root'?'root':role==='member'?normalizeFamilyRelation(raw.relationToRoot||raw.relation):'standalone';
  let level=Math.round(Number(raw.difficultyLevel||raw.level||difficultyLevelFromQuestion(difficulty)));
  if(!Number.isFinite(level))level=difficultyLevelFromQuestion(difficulty);
  level=Math.min(4,Math.max(1,level));
  let purposes=normalizeFamilyPurposes(raw.purposes||raw.learningPurposes||[]);if(!purposes.length)purposes=['practice'];
  return {schemaVersion:1,familyId:String(raw.familyId||'').trim(),familyKey:String(raw.familyKey||raw.groupKey||'').trim(),role,rootQuestionId:role==='root'?String(qId||raw.rootQuestionId||'').trim():String(raw.rootQuestionId||'').trim(),relationToRoot:relation,variantType:role==='root'?'none':normalizeFamilyVariantType(raw.variantType),equivalenceGrade:role==='member'?normalizeEquivalenceGrade(raw.equivalenceGrade||raw.equivalence):'',diagnosticTarget:normalizeDiagnosticTarget(raw.diagnosticTarget||raw.target),difficultyLevel:level,purposes,qualityConfirmed:raw.qualityConfirmed===true||['true','1','yes','y','是','已确认'].includes(String(raw.qualityConfirmed||'').trim().toLowerCase()),notes:String(raw.notes||'').trim()};
}
function questionFamily(q){q.metadata=q.metadata||{};q.metadata.questionFamily=normalizeQuestionFamily(q.metadata.questionFamily||{},q.id,q.difficulty);return q.metadata.questionFamily}
function familyQuestionById(id){return state.questionBank.questions.find(q=>q.id===String(id||''))||null}
function familyRootFor(q){
  if(!q)return null;const f=questionFamily(q);
  if(f.role==='root')return q;
  if(f.role==='member'&&f.rootQuestionId)return familyQuestionById(f.rootQuestionId);
  if(f.familyId)return state.questionBank.questions.find(x=>{const xf=questionFamily(x);return xf.role==='root'&&xf.familyId===f.familyId})||null;
  return null;
}
function makeQuestionFamilyRoot(q){
  const f=questionFamily(q);
  if(!f.familyId)f.familyId=generateSystemId('family');
  if(!f.familyKey)f.familyKey=`FAMILY-${String(q.id||'').replace(/[^a-z0-9]/gi,'').slice(0,8).toUpperCase()||Date.now().toString(36).toUpperCase()}`;
  f.role='root';f.rootQuestionId=q.id;f.relationToRoot='root';f.variantType='none';f.equivalenceGrade='';
  f.purposes=unique(['practice',...(f.purposes||[])]);return f;
}
function makeQuestionStandalone(q){
  q.metadata=q.metadata||{};
  q.metadata.questionFamily=normalizeQuestionFamily({role:'standalone',difficultyLevel:questionFamily(q).difficultyLevel,diagnosticTarget:questionFamily(q).diagnosticTarget,purposes:['practice']},q.id,q.difficulty);
  return q.metadata.questionFamily;
}
function makeQuestionFamilyMember(q,root,options={}){
  if(!q||!root)return questionFamily(q);
  const rf=makeQuestionFamilyRoot(root),f=questionFamily(q),applyDefaults=options.applyDefaults!==false;
  f.familyId=rf.familyId;f.familyKey=rf.familyKey;f.role='member';f.rootQuestionId=root.id;
  if(!['equivalent','decomposed','extension'].includes(f.relationToRoot))f.relationToRoot='equivalent';
  if(applyDefaults){
    if(f.variantType==='none')f.variantType='stem';
    if(!f.equivalenceGrade&&f.relationToRoot==='equivalent')f.equivalenceGrade='A';
    if(!Array.isArray(f.purposes)||!f.purposes.length||f.purposes.length===1&&f.purposes[0]==='practice')f.purposes=['practice','error-confirmation','post-remediation-verification'];
  }
  return f;
}
function renameQuestionFamilyKey(root,newKey){
  if(!root)return;const rf=makeQuestionFamilyRoot(root),oldId=rf.familyId;
  rf.familyKey=String(newKey||'').trim();
  state.questionBank.questions.forEach(q=>{const f=questionFamily(q);if(f.familyId===oldId)f.familyKey=rf.familyKey});
}
function resolveQuestionFamilies(questions=state.questionBank.questions){
  questions.forEach(q=>questionFamily(q));
  const byId=new Map(questions.map(q=>[q.id,q]));
  const rootByFamilyId=new Map(),rootByKey=new Map();
  questions.filter(q=>questionFamily(q).role==='root').forEach(root=>{const f=makeQuestionFamilyRoot(root);rootByFamilyId.set(f.familyId,root);if(f.familyKey)rootByKey.set(f.familyKey,root)});
  questions.filter(q=>questionFamily(q).role==='member').forEach(q=>{
    const f=questionFamily(q);
    let root=byId.get(f.rootQuestionId)||rootByFamilyId.get(f.familyId)||rootByKey.get(f.familyKey)||null;
    if(root)makeQuestionFamilyMember(q,root,{applyDefaults:false});
    else{f.familyId=String(f.familyId||'');f.rootQuestionId=String(f.rootQuestionId||'')}
  });
  return questions;
}
function familyMembersFor(q){
  const root=familyRootFor(q);if(!root)return [];
  const rf=questionFamily(root);
  return state.questionBank.questions.filter(x=>x.id!==root.id&&questionFamily(x).role==='member'&&questionFamily(x).familyId===rf.familyId);
}
function familyCoverageFor(q){
  const root=familyRootFor(q);
  if(!root)return {root:null,members:[],strong:0,concept:0,understanding:0,highOrder:0,confirmedStrong:0,confirmedConcept:0,confirmedUnderstanding:0,confirmedHighOrder:0,coverage:0,complete:false,ready:false};
  const members=familyMembersFor(root),rootLevel=questionFamily(root).difficultyLevel;
  const isStrong=x=>{const f=questionFamily(x);return f.relationToRoot==='equivalent'&&f.equivalenceGrade==='A'};
  const isHigh=x=>{const f=questionFamily(x);return FAMILY_HIGH_ORDER_TARGETS.has(f.diagnosticTarget)&&f.difficultyLevel>=rootLevel&&f.purposes.some(p=>['post-remediation-verification','delayed-verification','mastery-check'].includes(p))};
  const strong=members.filter(isStrong).length,concept=members.filter(x=>questionFamily(x).diagnosticTarget==='concept').length,understanding=members.filter(x=>questionFamily(x).diagnosticTarget==='understanding').length,highOrder=members.filter(isHigh).length;
  const confirmedStrong=members.filter(x=>isStrong(x)&&questionFamily(x).qualityConfirmed).length,confirmedConcept=members.filter(x=>questionFamily(x).diagnosticTarget==='concept'&&questionFamily(x).qualityConfirmed).length,confirmedUnderstanding=members.filter(x=>questionFamily(x).diagnosticTarget==='understanding'&&questionFamily(x).qualityConfirmed).length,confirmedHighOrder=members.filter(x=>isHigh(x)&&questionFamily(x).qualityConfirmed).length;
  const coverage=Math.min(strong,2)+(concept?1:0)+(understanding?1:0)+(highOrder?1:0),complete=coverage===5,ready=complete&&confirmedStrong>=2&&confirmedConcept>=1&&confirmedUnderstanding>=1&&confirmedHighOrder>=1;
  return {root,members,strong,concept,understanding,highOrder,confirmedStrong,confirmedConcept,confirmedUnderstanding,confirmedHighOrder,coverage,complete,ready};
}
function validateQuestionFamily(q){
  const issues=[],f=questionFamily(q),id=q.id||'未命名';
  const push=(level,message,suggest='')=>issues.push({level,object:id,message,suggest});
  if(f.role==='standalone')return issues;
  if(f.role==='root'){
    if(!f.familyId)push('error','母题缺少系统 Family ID','重新切换一次"家族角色 = 母题"以自动生成。');
    if(f.rootQuestionId!==q.id)push('error','母题 rootQuestionId 与自身 Question ID 不一致','重新保存母题家族设置。');
    const c=familyCoverageFor(q);
    if(!c.complete)push('warn',`题目家族最低配置未达标：强等价 ${c.strong}/2、概念 ${c.concept?1:0}/1、理解 ${c.understanding?1:0}/1、高阶验证 ${c.highOrder?1:0}/1`,'补齐缺失成员；同一道成员允许同时承担多个用途。Root-only 批次合法，这只是"未达到诊断就绪"提示。');
    else if(!c.ready)push('warn','题目家族结构已完整，但尚未达到"诊断就绪"','至少确认 2 道强等价、1 道概念、1 道理解和 1 道高阶验证的内容质量。');
  }
  if(f.role==='member'){
    if(!f.rootQuestionId)push('error',`家族成员（${f.familyKey||'未命名家族'}）尚未绑定母题`,'在题目家族区域选择母题。');
    const root=f.rootQuestionId?familyQuestionById(f.rootQuestionId):null;
    if(f.rootQuestionId&&!root)push('error',`母题 ${f.rootQuestionId} 不存在`,'重新选择母题。');
    if(root&&questionFamily(root).role!=='root')push('error','绑定对象不是母题','请选择角色为"母题"的题目。');
    if(!['equivalent','decomposed','extension'].includes(f.relationToRoot))push('error','家族成员缺少有效关系','选择等价变体 / 能力拆解 / 扩展。');
    if(f.relationToRoot==='equivalent'&&!f.equivalenceGrade)push('warn','等价变体尚未设置等价等级','正式验证建议使用 A 级强等价。');
    if(f.purposes.some(p=>['post-remediation-verification','mastery-check'].includes(p))&&f.relationToRoot==='decomposed')push('warn','能力拆解题被标记为最终验证用途','拆解题适合定位问题；最终掌握验证建议回到强等价或高阶变体。');
    if((f.equivalenceGrade==='A'||f.purposes.some(p=>['post-remediation-verification','mastery-check'].includes(p)))&&!f.qualityConfirmed)push('warn','高价值诊断/验证成员尚未人工确认质量','确认知识目标、能力层级、难度和推理链后勾选"质量确认"。');
  }
  return issues;
}
function validateFamilyStructure(questions=state.questionBank.questions){
  const issues=[],familyRootKeys=new Map(),familyRootIds=new Map();
  questions.filter(q=>questionFamily(q).role==='root').forEach(q=>{
    const f=questionFamily(q);
    if(f.familyKey){
      if(familyRootKeys.has(f.familyKey))issues.push({level:'error',object:q.id,message:`家族代号重复：${f.familyKey} 存在多个母题`,suggest:'同一个 familyKey 只能有 1 道母题。'});
      else familyRootKeys.set(f.familyKey,q.id);
    }
    if(f.familyId){
      if(familyRootIds.has(f.familyId))issues.push({level:'error',object:q.id,message:`Family ID ${f.familyId} 存在多个母题`,suggest:'重新拆分或绑定题目家族。'});
      else familyRootIds.set(f.familyId,q.id);
    }
  });
  return issues;
}
function forceExternalFamilyUnconfirmed(questions=[]){
  (questions||[]).forEach(q=>{if(q?.metadata?.questionFamily)q.metadata.questionFamily.qualityConfirmed=false});
}
function familyRoleLabel(role){return role==='root'?'母题':role==='member'?'家族成员':'独立题'}
function familyRelationLabel(v){return ({root:'母题',equivalent:'等价变体',decomposed:'能力拆解',extension:'扩展/高阶',standalone:'独立'})[v]||v}
function diagnosticTargetLabel(v){return ({general:'一般',concept:'概念',understanding:'理解',discrimination:'辨析',application:'应用',analysis:'分析','case-transfer':'案例迁移'})[v]||v}
function familyPurposeLabels(v){return (v||[]).map(x=>FAMILY_PURPOSE_LABELS[x]||x).join('、')}

/* P4.5.29 家族视觉 tone（对齐官方配套版）：root/equivalent/decomposed/extension/standalone 五色 */
function familyToneKey(q){
  const f=questionFamily(q);
  if(f.role==='root')return 'root';
  if(f.role!=='member')return 'standalone';
  if(f.relationToRoot==='decomposed')return 'decomposed';
  if(f.relationToRoot==='extension'||f.variantType==='advanced')return 'extension';
  return 'equivalent';
}
function familyToneClass(q){return 'family-tone-'+familyToneKey(q)}
function familyHoverToneKey(q){
  const f=questionFamily(q);
  if(f.role!=='member')return '';
  const target=String(f.diagnosticTarget||'general');
  const purposes=Array.isArray(f.purposes)?f.purposes:[];
  if(target==='concept')return 'concept';
  if(target==='understanding'||target==='discrimination')return 'understanding';
  const highOrderTarget=['application','analysis','case-transfer'].includes(target);
  const highOrderPurpose=purposes.some(x=>['post-remediation-verification','delayed-verification','mastery-check'].includes(x));
  if(f.relationToRoot==='extension'||f.variantType==='advanced'||(highOrderTarget&&highOrderPurpose))return 'advanced';
  return 'equivalent';
}
function familyHoverClass(q){const k=familyHoverToneKey(q);return k?` family-hover-${k}`:''}
function familyTabMeta(q){
  const f=questionFamily(q);
  if(f.role==='root')return `${f.familyKey||'未命名家族'} · 母题`;
  if(f.role==='member')return `${familyRelationLabel(f.relationToRoot)} · ${diagnosticTargetLabel(f.diagnosticTarget)} · L${f.difficultyLevel}`;
  return '独立题';
}
function familyListClass(q){
  const tone=familyToneKey(q),f=questionFamily(q);
  return f.role==='root'?'family-list-root':f.role==='member'?`family-list-member family-list-${tone}`:'';
}
