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
document.getElementById('btnDownloadAiPrompt').onclick=()=>downloadText(WORD_TO_JSON_AI_PROMPT,'Word题目转PrepStudio_JSON_AI提示词.txt');
document.getElementById('btnParsePastedQuestions').onclick=()=>{
  const raw=document.getElementById('rawQuestionPaste').value;
  const qs=parsePastedQuestionText(raw);
  if(!qs.length){document.getElementById('pasteParseResult').textContent='未识别到题目，请点击 ? 查看推荐格式。';return}
  const batchId=stampImportedQuestions(qs,'word-ai-paste');
  if(document.getElementById('pasteImportMode').value==='replace')state.questionBank.questions=qs;else state.questionBank.questions.push(...qs);
  state.questionBank.updatedAt=Date.now();state.currentQuestionId=qs[0].id;renderQuestions();refreshHeader();
  document.getElementById('pasteParseResult').textContent=`已导入 ${qs.length} 题；Batch：${batchId.slice(0,24)}…；题目 ID 已由程序生成。`;
  markWorkspaceDirty();toast(`已解析 ${qs.length} 题`);
};

document.getElementById('fileContentBundle').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{importContentBundle(await readJsonFile(f));markWorkspaceDirty();toast('完整内容包已加载')}catch(err){alert('完整内容包导入失败：'+err.message)}e.target.value=''});
document.getElementById('filePrinciples').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{state.principles=normalizePrinciples(await readJsonFile(f));state.currentPrincipleId=state.principles.items[0]?.id||'';refreshAll();markWorkspaceDirty();toast('原则库已加载')}catch(err){alert('原则库导入失败：'+err.message)}e.target.value=''});
document.getElementById('filePresets').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{state.synthesisPresets=normalizePresets(await readJsonFile(f));refreshAll();markWorkspaceDirty();toast('归纳卡已加载')}catch(err){alert('归纳卡导入失败：'+err.message)}e.target.value=''});
document.getElementById('fileTagConfig').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{state.tagConfig=ImportService.tagConfig(await readJsonFile(f));refreshQuestionTagPaths();refreshAll();markWorkspaceDirty();toast('标签配置已加载')}catch(err){alert('标签配置导入失败：'+err.message)}e.target.value=''});
document.getElementById('fileTree').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{state.knowledgeTree=normalizeTree(await readJsonFile(f));state.questionBank.questions.forEach(q=>{const id=q.metadata?.knowledge?.primaryNodeId;if(id&&state.knowledgeTree.map.has(id))q.metadata.knowledge.pathSnapshot=state.knowledgeTree.pathFor(id)});refreshHeader();renderQuestionEditor();renderRecallEditor();markWorkspaceDirty();toast('知识树已加载')}catch(err){alert('知识树导入失败：'+err.message)}e.target.value=''});
document.getElementById('fileRecall').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{state.recallLibrary=normalizeRecall(await readJsonFile(f));state.currentRecallId=state.recallLibrary.nodes[0]?.id||'';refreshHeader();renderRecallList();renderRecallEditor();renderKeywords();markWorkspaceDirty();toast('联想库已加载')}catch(err){alert('联想库导入失败：'+err.message)}e.target.value=''});
document.getElementById('fileQuestionBank').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{state.questionBank=ImportService.questionBank(await readJsonFile(f));stampImportedQuestions(state.questionBank.questions,'question-bank-json');state.currentQuestionId=state.questionBank.questions[0]?.id||'';refreshHeader();renderQuestions();markWorkspaceDirty();toast('题库已加载 · 已记录导入批次')}catch(err){alert('题库导入失败：'+err.message)}e.target.value=''});

document.getElementById('btnNewWorkspace').onclick=()=>{if(!confirm('清空当前 Prep Studio 工作区？请先导出需要保留的草稿。'))return;state.knowledgeTree=null;state.recallLibrary={schemaVersion:1,nodes:[],edges:[],updatedAt:''};state.questionBank={id:generateSystemId('bank'),name:'PMP 内容准备题库',subject:'PMP',description:'',version:'1.0',visibility:'private',createdAt:Date.now(),updatedAt:Date.now(),questions:[]};state.principles={schemaVersion:1,items:[],updatedAt:Date.now()};state.synthesisPresets={schemaVersion:1,items:[],updatedAt:Date.now()};state.tagConfig={names:{},groupNames:{},categoryNames:{},aliases:{},slotAliases:{},looseAliases:{}};state.currentQuestionId='';state.currentRecallId='';state.currentPrincipleId='';state.demoQuestionId='';state.demoLang='zh';state.recallPreviewCandidateId='';refreshAll();setTab('base');markWorkspaceDirty();toast('已清空')};
document.getElementById('btnImportWorkspace').onclick=()=>document.getElementById('fileWorkspace').click();
document.getElementById('fileWorkspace').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const w=await readJsonFile(f);if(!w.prepStudioWorkspaceVersion)throw new Error('不是 Prep Studio 草稿');applyWorkspacePayload(w);markWorkspaceDirty();toast('草稿已恢复')}catch(err){alert('草稿导入失败：'+err.message)}e.target.value=''});

document.getElementById('btnExportCompleteBundle').onclick=()=>{const v=runValidation();if(v.metrics.errors&&!confirm(`当前有 ${v.metrics.errors} 个错误。仍要导出完整成品包吗？`))return;const payload=completeBundlePayload();downloadJson(payload,'PMP_Content_Complete_Bundle.json',{auditType:'complete-bundle',details:{validation:{errors:v.metrics.errors,warnings:v.metrics.warnings}}})};
document.getElementById('btnExportPrinciples').onclick=()=>downloadJson(state.principles,'kg_principle_repository_v1.json',{auditType:'principles'});
document.getElementById('btnExportPresets').onclick=()=>downloadJson(state.synthesisPresets,'kg_synthesis_preset_repository_v1.json',{auditType:'synthesis-presets'});
document.getElementById('btnExportTagConfig').onclick=()=>ExportService.json(ExportService.tagConfig(),'kg_question_tag_names_v1.json',{auditType:'tag-config'});
document.getElementById('btnExportQuestions').onclick=()=>{const v=runValidation();if(v.metrics.errors&&!confirm(`当前有 ${v.metrics.errors} 个错误。仍要导出题库吗？`))return;const payload=exportableBank(),name=safeName(state.questionBank.name||'PMP题库')+'_PrepStudio.json';downloadJson(payload,name,{auditType:'question-bank',details:{validation:{errors:v.metrics.errors,warnings:v.metrics.warnings}}})};
document.getElementById('btnExportRecall').onclick=()=>{const lib=clone(state.recallLibrary);lib.schemaVersion=1;lib.updatedAt=nowIso();downloadJson(lib,'PMP_科目级联想库_PrepStudio.json',{auditType:'recall-library',details:{nodes:lib.nodes.length,edges:lib.edges.length}})};
document.getElementById('btnExportValidation').onclick=()=>{const payload=runValidation();downloadJson(payload,'PMP_Content_Prep_Studio_校验报告.json',{auditType:'validation-report',details:{errors:payload.metrics.errors,warnings:payload.metrics.warnings}})};
document.getElementById('btnExportWorkspace').onclick=()=>ExportService.json(WorkspaceService.currentPayload(),'PMP_Content_Prep_Studio_工作区草稿.json',{auditType:'workspace-draft'});
document.getElementById('btnExportAuditTrail').onclick=()=>downloadJson(auditTrailPayload(),'PMP_Content_Prep_Studio_导出审计日志.json');
document.getElementById('btnClearAuditTrail').onclick=clearAuditTrail;
function safeName(s){return String(s||'file').replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,'_')}

refreshAll();setTab('base');detectLocalWorkspace();initDeviceProfile();initThemeSettings();loadAuditTrail();requireCreatorSelection();
