/*
 * P4.5.29 G5 · Workspace 服务器化体验（差异 22–23）：
 * 数据库共享草稿的防抖自动保存、刷新后自动恢复、失败可重试与 draft revision 冲突处理。
 *
 * - 编辑（markWorkspaceDirty）后防抖 1.5s 自动保存到数据库共享草稿；服务器保存成功前
 *   不显示"已保存"；失败保留 dirty 状态并显示可重试错误。
 * - draft revision 冲突（409）禁止静默覆盖：提供"复制本地为新草稿 / 放弃本地并重新载入 /
 *   稍后手动处理"三种恢复，默认不动服务器数据。
 * - 浏览器只保存 lastDraftId 这一会话级 UI 偏好；所有业务数据只存数据库共享草稿。
 */
(function(global){
  const DEBOUNCE_MS=1500;
  const LAST_DRAFT_KEY='prep.lastDraftId';
  let timer=0,inFlight=false;
  let Drafts=global.PMPPrepSharedDrafts;

  function bindDrafts(service){Drafts=service}
  function rememberDraftId(){try{if(prepRuntime.draftId)localStorage?.setItem?.(LAST_DRAFT_KEY,prepRuntime.draftId)}catch(_error){}}
  function forgetDraftId(){try{localStorage?.removeItem?.(LAST_DRAFT_KEY)}catch(_error){}}

  function schedule(){
    if(!prepRuntime.draftId||!prepRuntime.dirty)return;
    if(timer)clearTimeout(timer);
    timer=setTimeout(()=>{timer=0;runNow().catch(()=>{})},DEBOUNCE_MS);
  }

  function isRevisionConflict(error){
    return Number(error?.status)===409||['CONFLICT','DRAFT_REVISION_CONFLICT'].includes(String(error?.code||''));
  }

  async function handleRevisionConflict(error){
    const message=String(error?.message||'共享草稿已在其他地方被修改');
    const copy=confirm(`自动保存被拒绝：${message}。\n\n【确定】把当前内容复制为新草稿（保留本地修改，不动服务器原草稿）\n【取消】查看其他恢复选项`);
    if(copy){
      const title=String(prompt('新草稿名称：',`${prepRuntime.draftTitle||'未命名草稿'}（冲突副本）`)||'').trim();
      if(!title){updateWorkspaceSaveStatus('自动保存冲突已保留本地修改，可手动处理','warn');prepRuntime.dirty=true;return}
      try{
        const payload=typeof workspacePayload==='function'?workspacePayload():null;
        const draft=await Drafts.create({title,payload});
        prepRuntime.draftId=String(draft.id||'');prepRuntime.draftRevision=Number(draft.revision||1);prepRuntime.draftTitle=title;
        prepRuntime.dirty=false;rememberDraftId();
        updateWorkspaceSaveStatus(`冲突已通过新草稿“${title}”保留本地修改`,'good');
        toast('本地修改已复制为新草稿');
        return;
      }catch(createError){
        updateWorkspaceSaveStatus(`复制冲突草稿失败：${createError.message||createError}（本地修改已保留）`,'bad');
        prepRuntime.dirty=true;return;
      }
    }
    const discard=confirm('放弃本地未保存修改，并重新载入服务器上的最新版本？');
    if(discard){
      try{await global.PMPPrepDraftUi.openDraft(prepRuntime.draftId)}
      catch(reloadError){updateWorkspaceSaveStatus(`重新载入失败：${reloadError.message||reloadError}`,'bad');prepRuntime.dirty=true}
      return;
    }
    prepRuntime.dirty=true;
    updateWorkspaceSaveStatus('自动保存冲突未处理：本地修改已保留，请手动选择恢复方式','warn');
  }

  async function runNow(){
    if(!prepRuntime.draftId||!prepRuntime.dirty||prepRuntime.saveInFlight||inFlight)return;
    inFlight=true;
    try{
      await global.PMPPrepDraftUi.save();
      rememberDraftId();
    }catch(error){
      if(isRevisionConflict(error)){await handleRevisionConflict(error);return}
      prepRuntime.dirty=true;
      updateWorkspaceSaveStatus(`自动保存失败：${error.message||error}（修改已保留，可手动重试）`,'bad');
    }finally{
      inFlight=false;
    }
  }

  async function restoreLastDraft(){
    const lastId=localStorage?.getItem?.(LAST_DRAFT_KEY);
    if(!lastId)return false;
    try{
      const draft=await Drafts.get(lastId);
      if(!draft||!draft.id){forgetDraftId();return false}
      await global.PMPPrepDraftUi.openDraft(lastId);
      toast(`已恢复上次共享草稿：${draft.title||lastId}`);
      return true;
    }catch(error){
      if(Number(error?.status)===404||/不存在|not found/i.test(String(error?.message||''))){forgetDraftId();return false}
      return false;
    }
  }

  /* 编辑即调度：包装全局 markWorkspaceDirty（函数声明绑定可在后续脚本重赋值） */
  const manualMark=markWorkspaceDirty;
  markWorkspaceDirty=function(){manualMark();schedule()};

  global.PMPPrepAutosave=Object.freeze({
    runNow,
    schedule,
    restoreLastDraft,
    rememberDraftId,
    forgetDraftId,
    bindDrafts,
  });
})(window);
