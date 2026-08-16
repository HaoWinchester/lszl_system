/* Baseline bootstrap: 内嵌固定基准数据(知识树/联想库/八大原则/归纳卡/标签配置)自动预填。
 *
 * 基线来源:scripts/fetch_baseline.py 从服务器 content-prep/shared-content 拉取,build.py 注入 window.__PMP_PREP_BASELINE__。
 * 策略:只在对应部分为空时填充(不覆盖用户已导入/服务器已下发的数据),且绝不 markWorkspaceDirty()
 * ——这样启动时服务器 shared-content(refreshSharedContent 的 !draftId && !dirty 条件)仍可优先覆盖内嵌快照。
 */
function prepBaseline(){return window.__PMP_PREP_BASELINE__||null}
function prepBaselineSummary(){
  const b=prepBaseline();if(!b)return null;
  return {
    treeNodes:(b.knowledgeTree?.taxonomy?.nodes||[]).length,
    recallNodes:(b.recallLibrary?.nodes||[]).length,
    recallEdges:(b.recallLibrary?.edges||[]).length,
    principles:(b.principles?.items||[]).length,
    presets:(b.synthesisPresets?.items||[]).length,
    contentRevision:b.contentRevision??''
  };
}
function applyPrepBaseline({refresh=false}={}){
  const b=prepBaseline();
  if(!b)return false;
  let touched=false;
  try{
    if(!state.knowledgeTree&&b.knowledgeTree){state.knowledgeTree=normalizeTree(b.knowledgeTree);touched=true}
    if(!(state.recallLibrary?.nodes||[]).length&&b.recallLibrary){state.recallLibrary=normalizeRecall(b.recallLibrary);touched=true}
    if(!(state.principles?.items||[]).length&&b.principles){state.principles=normalizePrinciples(b.principles);touched=true}
    if(!(state.synthesisPresets?.items||[]).length&&b.synthesisPresets){state.synthesisPresets=normalizePresets(b.synthesisPresets);touched=true}
    if(!Object.keys(state.tagConfig?.names||{}).length&&b.tagConfig){state.tagConfig=normalizeTagConfig(b.tagConfig);touched=true}
    if(touched){
      if(!state.currentRecallId)state.currentRecallId=state.recallLibrary.nodes[0]?.id||'';
      if(!state.currentPrincipleId)state.currentPrincipleId=state.principles.items[0]?.id||'';
      if(refresh)refreshAll();
    }
  }catch(error){console.warn('[prep-baseline] 基线预填失败:',error)}
  return touched;
}
window.applyPrepBaseline=applyPrepBaseline;
