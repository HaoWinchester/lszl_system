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
