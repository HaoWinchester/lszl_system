document.getElementById('btnHelp').onclick=()=>openHelp('base');
document.getElementById('btnOpenHelp').onclick=openHelp;
document.getElementById('btnHelpCenter').onclick=()=>openHelp(currentTabName());
document.querySelectorAll('[data-help-topic]').forEach(b=>b.onclick=()=>setHelpTopic(b.dataset.helpTopic));
document.querySelectorAll('[data-page-help]').forEach(b=>b.onclick=()=>openHelp(b.dataset.pageHelp));
document.getElementById('btnCloseHelp').onclick=closeHelp;
document.getElementById('helpModal').addEventListener('click',e=>{if(e.target.id==='helpModal')closeHelp()});
document.getElementById('btnDownloadCompleteBundle').onclick=()=>downloadJson(COMPLETE_CONTENT_BUNDLE_TEMPLATE,'PMP_Content_Prep_完整内容包模板_v1.json');
document.getElementById('btnDownloadCompleteAiPrompt').onclick=()=>downloadText(COMPLETE_AI_PROMPT,'PMP_Content_Prep_完整AI制作提示词.txt');
document.getElementById('btnDownloadQuestionTemplate').onclick=()=>downloadJson(QUESTION_TEMPLATE,'PMP_Content_Prep_题库导入模板_v3_自动ID.json');
document.getElementById('btnDownloadFamilyTemplate').onclick=()=>downloadJson(QUESTION_FAMILY_TEMPLATE,'PMP_Content_Prep_题目家族最低配置模板_v1.json',{auditType:'question-family-template'});
document.getElementById('btnDownloadFamilyAiPrompt').onclick=()=>downloadText(QUESTION_FAMILY_AI_PROMPT,'PMP_Content_Prep_题目家族_AI提示词_v1.txt');
document.getElementById('btnDownloadAiPrompt').onclick=()=>downloadText(WORD_TO_JSON_AI_PROMPT,'Word题目转PrepStudio_JSON_AI提示词.txt');
function confirmQuestionDuplicateCleanup(incoming,existing=[]){
  const report=preflightQuestionDuplicates(incoming,existing);if(!report.duplicates.length)return report;
  const approved=confirm(`检测到重复题目：已有重复 ${report.existingCount} 道，本批重复 ${report.batchCount} 道。\n自动清除后将保留 ${report.unique.length} 道题，是否继续导入？`);
  return {...report,cancelled:!approved};
}

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
// 导入结果面板：显示数据名与导入清单，便于确认导入内容。
function showImportReport(kind,name,summaryLines,items){
  const panel=document.getElementById('importReportPanel');if(!panel)return;
  document.getElementById('importReportTitle').textContent='导入结果 · '+esc(kind)+(name?'：'+esc(name):'');
  const body=document.getElementById('importReportBody');
  const summary=Array.isArray(summaryLines)&&summaryLines.length?'<p class="muted" style="margin:4px 0 8px">'+summaryLines.map(esc).join(' · ')+'</p>':'';
  const list=Array.isArray(items)&&items.length
    ?'<ol style="margin:0;padding-left:20px">'+items.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ol>'
    :'<p class="muted">没有可列出的条目。</p>';
  body.innerHTML=summary+list;
  panel.hidden=false;
  panel.scrollIntoView({block:'nearest',behavior:'smooth'});
}
(function bindImportReportClose(){const btn=document.getElementById('importReportClose');if(btn)btn.onclick=()=>{const p=document.getElementById('importReportPanel');if(p)p.hidden=true}})();
function questionTitles(list){return (Array.isArray(list)?list:[]).map(q=>String(q.title||q.stemParts?.[0]?.text||'未命名题目').slice(0,60))}

document.getElementById('btnParsePastedQuestions').onclick=()=>{
  const raw=document.getElementById('rawQuestionPaste').value;
  const qs=parsePastedQuestionText(raw);
  if(!qs.length){document.getElementById('pasteParseResult').textContent='未识别到题目，请点击 ? 查看推荐格式。';return}
  const replace=document.getElementById('pasteImportMode').value==='replace',report=confirmQuestionDuplicateCleanup(qs,replace?[]:state.questionBank.questions);
  if(report.cancelled){document.getElementById('pasteParseResult').textContent='已取消导入，当前题库没有变化。';return}
  const uniqueQuestions=report.unique,batchId=stampImportedQuestions(uniqueQuestions,'word-ai-paste');
  if(replace)state.questionBank.questions=uniqueQuestions;else state.questionBank.questions.push(...uniqueQuestions);
  state.questionBank.updatedAt=Date.now();state.currentQuestionId=uniqueQuestions[0]?.id||state.currentQuestionId;renderQuestions();refreshHeader();
  document.getElementById('pasteParseResult').textContent=`已导入 ${uniqueQuestions.length} 题${report.duplicates.length?`，自动清除 ${report.duplicates.length} 道重复题`:''}；Batch：${batchId.slice(0,24)}…；每题 ID 已由程序生成。`;
  showImportReport(replace?'替换导入 · 文本粘贴':'追加导入 · 文本粘贴',state.questionBank.name||'当前题库',[`共 ${uniqueQuestions.length} 题`,report.duplicates.length?`清除重复 ${report.duplicates.length} 题`:null].filter(Boolean),questionTitles(uniqueQuestions));
  markWorkspaceDirty();toast(`已解析 ${uniqueQuestions.length} 题`);
};

document.getElementById('fileContentBundle').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const result=importContentBundle(await readJsonFile(f));if(result?.cancelled){toast('已取消导入，当前内容没有变化');return}markWorkspaceDirty();
  {const qs=state.questionBank.questions||[];
   showImportReport('完整内容包',state.questionBank.name||'未命名题库',[`题目 ${qs.length} 道`,`知识树节点 ${(state.knowledgeTree?.nodes||[]).length} 个`,`联想库节点 ${(state.recallLibrary?.nodes||[]).length} 个`,`原则 ${(state.principles?.items||[]).length} 条`,result?.report?.duplicates?.length?`清除重复 ${result.report.duplicates.length} 题`:null].filter(Boolean),questionTitles(qs));}
  toast(`完整内容包已加载${result?.report?.duplicates?.length?` · 已清除 ${result.report.duplicates.length} 道重复题`:''}`)}catch(err){alert('完整内容包导入失败：'+err.message)}finally{e.target.value=''}});
document.getElementById('filePrincipleCardBundle').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const merged=importPrincipleBundleSafe(await readJsonFile(f));if(merged.cancelled){toast('已取消导入，原则与归纳卡没有变化');return}state.principles=merged.applied.principles;state.synthesisPresets=merged.applied.synthesisPresets;state.currentPrincipleId=state.principles.items.some(p=>p.id===state.currentPrincipleId)?state.currentPrincipleId:(state.principles.items[0]?.id||'');refreshAll();markWorkspaceDirty();toast(`原则已安全合并 · 新增 ${merged.added} · 保持 ${merged.unchanged} · 冲突 ${merged.conflicts}（保留现有）`)}catch(err){alert('原则与归纳卡导入失败：'+err.message)}finally{e.target.value=''}});
function importPrincipleBundleSafe(payload){
  const domain=canonicalPrincipleDomain(payload);
  const plan=planPrincipleMerge(domain,{principles:state.principles,synthesisPresets:state.synthesisPresets});
  if(plan.conflicts.length){
    const lines=plan.conflicts.map(c=>{
      if(c.type==='same-id-different-name')return `· 原则 ${c.principleId}：现有“${c.existingName}” vs 导入“${c.incomingName}”`;
      if(c.type==='same-normalized-name-different-id')return `· 名称“${c.name}”：现有 ${c.existingId} vs 导入 ${c.principleId}`;
      if(c.type==='preset-rebind')return `· 归纳卡 ${c.presetId} 改绑：现有 ${c.existingPrincipleId} vs 导入 ${c.incomingPrincipleId}`;
      return `· 未知冲突 ${JSON.stringify(c)}`;
    }).join('\n');
    const takeAll=confirm(`检测到 ${plan.conflicts.length} 项原则/归纳卡冲突：\n${lines}\n\n【确定】全部保留现有（推荐，不覆盖服务器已有配置）\n【取消】全部采用导入版本覆盖`);
    if(takeAll)plan.conflicts.forEach(c=>{c.resolution='keep-existing'});
    else{
      const perItem=confirm('是否逐项裁决？\n【确定】逐项询问（每项可选保留/采用）\n【取消】全部采用导入版本');
      if(!perItem)plan.conflicts.forEach(c=>{c.resolution='take-incoming'});
      else plan.conflicts.forEach(c=>{
        const desc=c.type==='same-id-different-name'?`原则 ${c.principleId}：现有“${c.existingName}” / 导入“${c.incomingName}”`:
          c.type==='same-normalized-name-different-id'?`名称“${c.name}”：保留现有 ${c.existingId} / 合入导入 ${c.principleId}`:
          `归纳卡 ${c.presetId}：保留现有绑定 ${c.existingPrincipleId} / 采用导入绑定 ${c.incomingPrincipleId}`;
        c.resolution=confirm(`冲突裁决：\n${desc}\n\n【确定】保留现有\n【取消】采用导入`)?'keep-existing':'take-incoming';
      });
    }
  }
  return {cancelled:false,applied:applyPrincipleMergePlan(plan,{principles:state.principles,synthesisPresets:state.synthesisPresets}),added:plan.added.length,unchanged:plan.unchanged.length,conflicts:plan.conflicts.length};
}
document.getElementById('fileTagConfig').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{state.tagConfig=ImportService.tagConfig(await readJsonFile(f));refreshQuestionTagPaths();refreshAll();markWorkspaceDirty();toast('标签配置已加载')}catch(err){alert('标签配置导入失败：'+err.message)}e.target.value=''});
document.getElementById('fileTree').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{state.knowledgeTree=normalizeTree(await readJsonFile(f));state.questionBank.questions.forEach(q=>{const id=q.metadata?.knowledge?.primaryNodeId;if(id&&state.knowledgeTree.map.has(id))q.metadata.knowledge.pathSnapshot=state.knowledgeTree.pathFor(id)});refreshHeader();renderQuestionEditor();renderRecallEditor();markWorkspaceDirty();
  showImportReport('知识树',state.knowledgeTree.name||'知识树',[`节点 ${(state.knowledgeTree.nodes||[]).length} 个`,`关系 ${(state.knowledgeTree.edges||[]).length} 条`],(state.knowledgeTree.nodes||[]).map(n=>n.title?.zh||n.title||n.id));
  toast('知识树已加载')}catch(err){alert('知识树导入失败：'+err.message)}e.target.value=''});
document.getElementById('fileRecall').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{state.recallLibrary=normalizeRecall(await readJsonFile(f));state.currentRecallId=state.recallLibrary.nodes[0]?.id||'';refreshHeader();renderRecallList();renderRecallEditor();renderKeywords();markWorkspaceDirty();
  showImportReport('联想库',state.recallLibrary.name||'联想库',[`节点 ${(state.recallLibrary.nodes||[]).length} 个`,`关系 ${(state.recallLibrary.edges||[]).length} 条`],(state.recallLibrary.nodes||[]).map(n=>n.title));
  toast('联想库已加载')}catch(err){alert('联想库导入失败：'+err.message)}e.target.value=''});
document.getElementById('fileQuestionBank').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const imported=ImportService.questionBank(await readJsonFile(f)),report=confirmQuestionDuplicateCleanup(imported.questions,[]);if(report.cancelled)return;imported.questions=report.unique;state.questionBank=imported;stampImportedQuestions(state.questionBank.questions,'question-bank-json');state.currentQuestionId=state.questionBank.questions[0]?.id||'';refreshHeader();renderQuestions();markWorkspaceDirty();
  showImportReport('题库 JSON',imported.name||'未命名题库',[`共 ${state.questionBank.questions.length} 题`,report.duplicates.length?`清除重复 ${report.duplicates.length} 题`:null].filter(Boolean),questionTitles(state.questionBank.questions));
  toast(`题库已加载${report.duplicates.length?` · 已清除 ${report.duplicates.length} 道重复题`:''} · 已记录导入批次`)}catch(err){alert('题库导入失败：'+err.message)}e.target.value=''});

document.getElementById('btnNewWorkspace').onclick=()=>{if(!confirm('清空当前 Prep Studio 工作区？请先导出需要保留的草稿。'))return;state.knowledgeTree=null;state.recallLibrary={schemaVersion:1,nodes:[],edges:[],updatedAt:''};state.questionBank={id:generateSystemId('bank'),name:'PMP 内容准备题库',subject:'PMP',description:'',version:'1.0',visibility:'private',createdAt:Date.now(),updatedAt:Date.now(),questions:[]};state.principles={schemaVersion:1,items:[],updatedAt:Date.now()};state.synthesisPresets={schemaVersion:1,items:[],updatedAt:Date.now()};state.tagConfig={names:{},groupNames:{},categoryNames:{},aliases:{},slotAliases:{},looseAliases:{}};state.subjectFacetRegistry=normalizeSubjectFacetRegistry({});state.currentQuestionId='';state.currentRecallId='';state.currentPrincipleId='';state.demoQuestionId='';state.demoLang='zh';state.recallPreviewCandidateId='';refreshAll();setTab('base');markWorkspaceDirty();toast('已清空')};
document.getElementById('btnImportWorkspace').onclick=()=>document.getElementById('fileWorkspace').click();
document.getElementById('fileWorkspace').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const w=await readJsonFile(f);if(!w.prepStudioWorkspaceVersion)throw new Error('不是 Prep Studio 草稿');applyWorkspacePayload(w);markWorkspaceDirty();toast('草稿已恢复')}catch(err){alert('草稿导入失败：'+err.message)}e.target.value=''});

document.getElementById('btnExportCompleteBundle').onclick=()=>{const v=runValidation();if(v.metrics.errors&&!confirm(`当前有 ${v.metrics.errors} 个错误。仍要导出完整成品包吗？`))return;try{const payload=completeBundlePayload();downloadJson(payload,'PMP_Content_Complete_Bundle.json',{auditType:'complete-bundle',details:{validation:{errors:v.metrics.errors,warnings:v.metrics.warnings}}})}catch(err){alert('完整成品包导出失败：'+err.message)}};
document.getElementById('btnExportPrincipleCards').onclick=()=>{try{downloadJson(principleCardBundlePayload(),'kg_principle_card_bundle_v1.json',{auditType:'principle-card-bundle'})}catch(err){alert('原则与归纳卡组合导出失败：'+err.message)}};
document.getElementById('btnExportTagConfig').onclick=()=>ExportService.json(ExportService.tagConfig(),'kg_question_tag_names_v1.json',{auditType:'tag-config'});
document.getElementById('btnExportQuestions').onclick=()=>{const v=runValidation();if(v.metrics.errors&&!confirm(`当前有 ${v.metrics.errors} 个错误。仍要导出题库吗？`))return;const payload=exportableBank(),name=safeName(state.questionBank.name||'PMP题库')+'_PrepStudio.json';downloadJson(payload,name,{auditType:'question-bank',details:{validation:{errors:v.metrics.errors,warnings:v.metrics.warnings}}})};
document.getElementById('btnExportRecall').onclick=()=>{const lib=clone(state.recallLibrary);lib.schemaVersion=1;lib.updatedAt=nowIso();downloadJson(lib,'PMP_科目级联想库_PrepStudio.json',{auditType:'recall-library',details:{nodes:lib.nodes.length,edges:lib.edges.length}})};
document.getElementById('btnExportValidation').onclick=()=>{const payload=runValidation();downloadJson(payload,'PMP_Content_Prep_Studio_校验报告.json',{auditType:'validation-report',details:{errors:payload.metrics.errors,warnings:payload.metrics.warnings}})};
document.getElementById('btnExportWorkspace').onclick=()=>ExportService.json(WorkspaceService.currentPayload(),'PMP_Content_Prep_Studio_工作区草稿.json',{auditType:'workspace-draft'});
document.getElementById('btnExportAuditTrail').onclick=()=>downloadJson(auditTrailPayload(),'PMP_Content_Prep_Studio_导出审计日志.json');
document.getElementById('btnClearAuditTrail').onclick=clearAuditTrail;
function safeName(s){return String(s||'file').replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,'_')}

refreshAll();setTab('base');initDeviceProfile();initThemeSettings();loadAuditTrail();requireCreatorSelection();
document.getElementById('btnCreateSharedDraft').onclick=()=>window.PMPPrepDraftUi?.create?.();
document.getElementById('btnRefreshSharedDrafts').onclick=()=>window.PMPPrepDraftUi?.reload?.();
window.PMPPrepDraftUi?.open?.();
