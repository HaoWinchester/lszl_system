/* ==========================================================
   v0.4.0 Service Layer
   UI handlers should call these facades for cross-domain work.
   They intentionally wrap the proven v0.3.x functions instead
   of rewriting page behavior in this architecture-only release.
   ========================================================== */
const TagService=Object.freeze({
  normalizeConfig:normalizeTagConfig,
  exportFormalConfig:exportTagConfig,
  semanticSlot:semanticTagSlot,
  formalSlot:formalTagSlot,
  catalog:tagCatalogEntries,
  canonicalName:canonicalTagName,
  pathFor:tagPathFor,
  refreshQuestionPaths:refreshQuestionTagPaths
});
const QuestionService=Object.freeze({
  create:(payload={},subject=state.questionBank.subject||'PMP')=>normalizeQuestion(payload,state.questionBank.questions.length,subject),
  normalize:normalizeQuestion,
  normalizeBank,
  duplicatePayload:(question)=>{
    const copy=clone(question),parentQuestionId=copy.id;copy.id=generateQuestionId();delete copy.contentHash;
    delete copy.serverRevision;delete copy.serverContentHash;delete copy.lastSyncedAt;delete copy.lockToken;delete copy.lock;
    copy.metadata=copy.metadata||{};delete copy.metadata.origin;delete copy.metadata.lastImport;
    stampQuestionOrigin(copy,{batchId:generateBatchId(),source:'duplicate',forceOrigin:true,parentQuestionId});
    return copy;
  },
  contentHash:computeQuestionContentHash,
  validate:validateQuestion,
  prepareForExport:exportableQuestion,
  exportBank:exportableBank
});
const StorageService=Object.freeze({
  put:prepDbPut,
  get:prepDbGet,
  remove:prepDbDelete,
  saveWorkspace:saveWorkspaceLocal,
  restoreWorkspace:restoreWorkspaceLocal,
  deleteWorkspace:deleteWorkspaceLocal
});
const WorkspaceService=Object.freeze({
  currentPayload:workspacePayload,
  migrate:migrateWorkspacePayload,
  apply:applyWorkspacePayload
});
const ImportService=Object.freeze({
  questionBank:(payload)=>normalizeBank(payload),
  completeBundle:(payload)=>normalizeContentBundle(payload),
  tagConfig:(payload)=>normalizeTagConfig(payload),
  recall:(payload)=>normalizeRecall(payload),
  principles:(payload)=>normalizePrinciples(payload),
  presets:(payload)=>normalizePresets(payload)
});
const ExportService=Object.freeze({
  json:downloadJson,
  completeBundle:completeBundlePayload,
  questionBank:exportableBank,
  tagConfig:exportTagConfig,
  auditTrail:auditTrailPayload
});
const ValidationService=Object.freeze({
  question:validateQuestion,
  workspace:runValidation
});
const AppServices=Object.freeze({
  TagService,QuestionService,StorageService,WorkspaceService,ImportService,ExportService,ValidationService,
  get ServerCatalogService(){return window.PMPPrepServerCatalogService||null}
});
window.PMPPrepServices=AppServices;
