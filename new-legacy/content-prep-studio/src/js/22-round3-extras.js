/* 单机版回补第 3 轮小件（自 P4.5.29 单机版移植）：
 * ① 开发变更记录面板与导出；② 审计日志 JSON 导入（auditId 去重/冲突保护）；
 * ③ 科目 Facet Registry 独立导出；④ 验收页"同步当前工作区 / 清空临时数据源"。
 * 说明：旧原则库/归纳卡单条迁移已由"原则与归纳卡 JSON"安全合并入口承接（支持旧格式），
 *       题目列表置顶/收起已在第 2 轮交付，此处不重复。 */
'use strict';

const DEVELOPMENT_CHANGELOG=Object.freeze([
  {workflowVersion:'V2.1',date:'2026-08-16',title:'校验中心与 JSON 导出修复',changes:['恢复联想库 Alias 冲突校验依赖，修复第⑥栏"重新校验"无响应。','为题库、完整内容包和校验报告导出增加校验运行时保护。','增加校验运行失败的可视化错误提示，避免静默失效。']},
  {workflowVersion:'V2.2',date:'2026-08-16',title:'审计日志导入与安全合并',changes:['新增审计日志 JSON 导入入口。','按 auditId 合并去重；完全重复记录跳过。','相同 auditId 但内容不同的记录判为冲突，保留本机记录且不覆盖。']},
  {workflowVersion:'V2.3',date:'2026-08-16',title:'同批题目补录 / 按 Question ID 合并',changes:['新增同批题目补录 JSON 导入，严格按已有 Question ID 匹配，不创建新题。','新增"仅填充空缺（推荐）"与"非空补录值覆盖已有"两种合并策略。','Question ID、中文题干、选项、正确答案、origin、系统身份与发布状态设为保护字段。','新增补录模板导出、合并结果明细、每题 supplementHistory 与补录操作审计。']},
  {workflowVersion:'V2.4',date:'2026-08-16',title:'基础导入布局、导入状态与补录 SOP',changes:['重排①基础数据与导入页面：完整内容包、知识树、基础题库与补录入口组成主导入区。','主要 JSON 导入框新增框内状态反馈。','帮助中心补充完整的多轮内容生产 SOP。']},
  {workflowVersion:'V2.5',date:'2026-08-21',title:'辅助知识点与公共标签治理',changes:['题目录入新增辅助知识点搜索、多选添加与已选 Chip 管理。','主知识点与辅助知识点互斥。','题目公共标签由自由文本输入改为分组复选器。','无法映射的旧标签显示为"未归类标签"，可人工移除或通过 Alias 归一。']},
  {workflowVersion:'V2.6',date:'2026-08-21',title:'稳定化与业务数据外置',changes:['验收器只读取当前工作区或临时外部 JSON。','Subject Facet 不再自动注入内置默认 Schema。','校验中心新增辅助知识点完整性校验。','公共标签题目绑定新增稳定 tagSlotIds。','Subject Facet 按 schema.selection 真正执行 single / multi。']},
  {workflowVersion:'V2.7-S',date:'2026-08-21',title:'服务器版功能回补（第 1–3 轮）',changes:['题目补录（pmp-question-supplement-v1）移植：模板导出、按 Question ID 合并、合并明细报告、supplementHistory。','题目编辑体验三件套：公共标签复选编辑器、辅助知识点关联编辑、可拖拽悬浮题目预览与列表收起。','开发变更记录面板与 JSON 导出。','审计日志 JSON 导入（auditId 去重 / 冲突保留本机）。','科目 Facet Registry 独立导出。','验收页新增"同步当前工作区 / 清空临时数据源"。']}
]);

function developmentLogPayload(){
  return {
    schemaVersion:1,
    format:'pmp-content-prep-development-changelog-v1',
    application:{name:'PMP Content Prep Studio',prepStudioTargetVersion:VERSION,architecture:'service-layer-v1'},
    exportedAt:nowIso(),
    changes:clone(DEVELOPMENT_CHANGELOG)
  };
}
function renderDevelopmentLog(){
  const box=document.getElementById('developmentLogList'),badge=document.getElementById('developmentVersionBadge');
  if(badge)badge.textContent=`${DEVELOPMENT_CHANGELOG[DEVELOPMENT_CHANGELOG.length-1].workflowVersion} · build ${VERSION}`;
  if(!box)return;
  box.innerHTML=[...DEVELOPMENT_CHANGELOG].reverse().map(row=>`<div class="dev-log-row">
    <div class="dev-log-head"><b>${esc(row.workflowVersion)}</b><span class="pill">${esc(row.date)}</span><strong>${esc(row.title)}</strong></div>
    <ul>${(row.changes||[]).map(item=>`<li>${esc(item)}</li>`).join('')}</ul>
  </div>`).join('');
}

/* ② 审计日志导入 */
function auditEventSignature(event){return JSON.stringify(stableAuditValue(event))}
function normalizeAuditTrailImport(payload){
  const events=Array.isArray(payload)?payload:Array.isArray(payload?.events)?payload.events:null;
  if(!events)throw new Error('审计日志缺少 events 数组。请选择由 Prep Studio 导出的审计日志 JSON。');
  if(payload&&!Array.isArray(payload)&&payload.format&&payload.format!=='pmp-content-prep-export-audit-v1')throw new Error(`不支持的审计日志格式：${payload.format}`);
  const valid=[],invalid=[];
  events.forEach((raw,index)=>{
    if(!raw||typeof raw!=='object'||!String(raw.auditId||'').trim()||!String(raw.exportedAt||'').trim()){invalid.push({index,reason:'缺少 auditId 或 exportedAt'});return}
    valid.push(raw);
  });
  return {events:valid,invalid};
}
async function importAuditTrailPayload(payload){
  const parsed=normalizeAuditTrailImport(payload);
  const localById=new Map((prepRuntime.auditTrail||[]).map(e=>[String(e.auditId||''),e]));
  let imported=0,duplicates=0,conflicts=0;const conflictIds=[];
  parsed.events.forEach(event=>{
    const id=event.auditId,existing=localById.get(id);
    if(!existing){prepRuntime.auditTrail.push(event);localById.set(id,event);imported++;return}
    if(auditEventSignature(existing)===auditEventSignature(event)){duplicates++;return}
    conflicts++;conflictIds.push(id);
  });
  prepRuntime.auditTrail.sort((a,b)=>(Date.parse(a?.exportedAt||'')||0)-(Date.parse(b?.exportedAt||'')||0)||String(a?.auditId||'').localeCompare(String(b?.auditId||'')));
  await persistAuditTrail();renderAuditTrail();
  return {imported,duplicates,conflicts,invalid:parsed.invalid.length,conflictIds,total:parsed.events.length};
}

document.addEventListener('DOMContentLoaded',()=>{
  renderDevelopmentLog();
  const devExport=document.getElementById('btnExportDevelopmentLog');
  if(devExport)devExport.addEventListener('click',()=>downloadJson(developmentLogPayload(),'PMP_Content_Prep_Studio_开发变更记录.json',{auditType:'development-changelog'}));
  const auditImportBtn=document.getElementById('btnImportAuditTrail');
  const auditFile=document.getElementById('fileAuditTrail');
  if(auditImportBtn&&auditFile){
    auditImportBtn.addEventListener('click',()=>auditFile.click());
    auditFile.addEventListener('change',async e=>{
      const f=e.target.files&&e.target.files[0];if(!f)return;
      const status=document.getElementById('auditImportStatus');
      try{
        const result=await importAuditTrailPayload(await readJsonFile(f));
        const parts=[`新增 ${result.imported} 条`,`重复跳过 ${result.duplicates} 条`];
        if(result.conflicts)parts.push(`冲突 ${result.conflicts} 条（未覆盖）`);
        if(result.invalid)parts.push(`无效 ${result.invalid} 条（跳过）`);
        const msg='审计日志导入完成：'+parts.join('，');
        if(status){status.textContent=msg;status.className='smalltxt '+(result.conflicts||result.invalid?'warn':'ok')}
        toast(msg);
        if(result.conflicts)alert(`审计日志已合并，但发现 ${result.conflicts} 条 auditId 冲突。为保护审计链，已保留本机记录且未覆盖。\n\n冲突 ID：\n${result.conflictIds.slice(0,20).join('\n')}${result.conflictIds.length>20?'\n…':''}`);
      }catch(err){
        if(status){status.textContent='导入失败：'+err.message;status.className='smalltxt bad'}
        alert('审计日志导入失败：'+err.message);
      }finally{e.target.value=''}
    });
  }
  const facetExport=document.getElementById('btnExportFacetRegistry');
  if(facetExport)facetExport.addEventListener('click',()=>downloadJson(clone(state.subjectFacetRegistry),'kg_subject_facet_registry_v1.json',{auditType:'subject-facet-registry'}));
  /* ④ 验收页数据源按钮 */
  const raSync=document.getElementById('raSyncWorkspace');
  if(raSync)raSync.addEventListener('click',()=>{
    raSyncFromWorkspace(true);
    if(typeof raRenderAcceptance==='function')raRenderAcceptance();
  });
  const raReset=document.getElementById('raUseEmbedded');
  if(raReset)raReset.addEventListener('click',()=>{
    raSyncFromWorkspace(true);
    if(typeof raSetStatus==='function')raSetStatus('已切回当前工作区联想库数据源。','ok');
  });
});
