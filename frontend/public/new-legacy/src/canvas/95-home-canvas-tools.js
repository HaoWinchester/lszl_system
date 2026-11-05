'use strict';

/* Adapt the shared drawing/capture tools to the graph's existing state and history. */
(function(global){
  function init(){
    if(global.KGHomeInk||!global.KGCanvasInk||!stage||!world)return;
    let previous;
    const currentOwner=()=>global.KGAuthCore?.currentUsername?.()||'';
    const currentFileId=()=>global.KGGraphFileEditorStoreBridge?.fragmentSource?.()?.fileId||global.KGGraphFileRemoteAdapter?.getCurrentFileMeta?.()?.id||'';
    let account=currentOwner(),fileId=currentFileId(),contextGeneration=0,contextGraph=state;
    function textContext(){
      if(!global.KGHomeInk?.hasTextDraft?.())contextGraph=state;
      const nextOwner=currentOwner(),nextFileId=currentFileId();
      if(nextOwner!==account||(fileId&&nextFileId!==fileId))contextGeneration++;
      account=nextOwner;fileId=nextFileId;
      return JSON.stringify([account,contextGeneration]);
    }
    let displayedContext=textContext();
    const readonly=()=>!!global.KGAuthRecovery?.isPaused()||document.body.classList.contains('auth-readonly')
      ||!!(global.KGRolePermissions?.can&&global.KGRolePermissions.can('editGraph')===false)
      ||!!global.KGGraphFileTabs?.isSwitching?.();
    const ink=global.KGCanvasInk.create({
      viewport:stage,world,placement:'right',trigger:()=>document.getElementById('homeInkBtn'),
      getViewport:()=>state.viewport,getStrokes:()=>state.strokes||[],getColorContext:()=>state,
      getTextContext:textContext,
      allowReadonlyToolSelection:()=>!!global.KGAuthRecovery?.isPaused(),
      // 画笔批注是轻量编辑：阅读模式也允许（登录+账号权限即可），与改名/文件级操作一致。
      // 切文件过渡期（isSwitching）仍保持禁用，防止笔迹落进切换前后的错误文件。
      isReadonly:readonly,
      history:ensureGraphHistoryController(),showHistory:true,
      change:(strokes,label)=>ensureGraphHistoryController().run(label,()=>{state.strokes=strokes;save()}),
      persistText:()=>{const context=textContext();return global.KGGraphFileAutosave.saveAcknowledged({force:true,allowFileCreation:true},()=>textContext()===context)},
      onDrawMode:()=>{setGraphPointerMode('edit');clearSelection()},onError:showStatus
    });
    function sync(){if(previous!==state.strokes){previous=state.strokes;ink.render()}else ink.refreshControls()}
    global.KGHomeInk=Object.assign(ink,{sync});
    const hasUnsavedChanges=()=>ink.hasTextDraft()||global.KGGraphFileAutosave?.isDirty?.()||!!(typeof ensureNodeInlineTextEditorController==='function'&&ensureNodeInlineTextEditorController()?.isEditing());
    async function flushClassroom(){
      // Viewers have no writable graph endpoint. Clean sessions may leave;
      // retained drafts must stay discoverable without attempting forbidden writes.
      if(!hasUnsavedChanges())return true;
      if(readonly())return false;
      if(ink.hasTextDraft()&&!await ink.commitText())return false;
      const inline=typeof ensureNodeInlineTextEditorController==='function'?ensureNodeInlineTextEditorController():null;
      if(inline?.isEditing()){await inline.commit();if(inline.isEditing())return false}
      return !global.KGGraphFileAutosave.isDirty()||global.KGGraphFileAutosave.saveAcknowledged({force:true});
    }
    global.KGAuthRecovery?.register('graph',{
      hasUnsavedChanges,
      prepareLeave:flushClassroom,
      onExpired:()=>{ink.cancel();if(typeof authRenderStatus==='function')authRenderStatus();ink.refreshControls()},
      onRecovered:()=>{if(typeof authRenderStatus==='function')authRenderStatus();ink.refreshControls();return flushClassroom()}
    });
    // 可编辑表格：共享控制器渲染 state.tables，写入经图谱历史（单次操作一次撤销）+ 自动保存。
    if(global.KGCanvasTableModel?.ENABLED===false){/* 表格功能暂时下线 */}
    else if(global.KGCanvasTableController&&!global.KGHomeTables){
      const tablesController=global.KGCanvasTableController.create({
        viewport:stage,world,
        getViewport:()=>state.viewport,
        getTables:()=>state.tables||[],
        change:(next,label)=>{
          const history=ensureGraphHistoryController();
          if(label&&history)history.run(label,()=>{state.tables=next;save()});
          else{state.tables=next;save()}
        },
        isReadonly:()=>!!global.KGAuthRecovery?.isPaused()||document.body.classList.contains('auth-readonly')
          ||!!(window.KGRolePermissions&&window.KGRolePermissions.can&&window.KGRolePermissions.can('editGraph')===false)
          ||!!window.KGGraphFileTabs?.isSwitching?.(),
        getLastWorldPoint:()=>(lastGraphPointerWorldPosition&&Number.isFinite(lastGraphPointerWorldPosition.x))?{...lastGraphPointerWorldPosition}:null,
        onStatus:showStatus
      });
      global.KGHomeTables=tablesController;
      global.addEventListener('kg-graph-current-file-change',()=>tablesController.reset());
      global.addEventListener('kg-home-interaction-mode-change',()=>tablesController.refreshControls());
    }
    function bind(){
      ink.refreshControls();
      global.KGCanvasCapture?.bind(document.getElementById('homeCaptureBtn'),stage,{filename:()=>state.meta.title||'知识图谱',onError:showStatus});
    }
    global.addEventListener('kg-home-toolbar-rendered',bind);
    global.addEventListener('kg-graph-file-transition',()=>{ink.cancel();ink.refreshControls()});
    global.addEventListener('kg-home-interaction-mode-change',()=>{if(!graphModeAllows('editGraph'))ink.setOpen(false);bind()});
    global.addEventListener('kg-graph-current-file-change',()=>{
      const replaced=state!==contextGraph,next=textContext();
      // Assigning the first server ID to the current preview is an acknowledgement,
      // not a replacement of the graph being edited.
      if(replaced&&next===displayedContext)contextGeneration++;
      const context=textContext();
      if(context!==displayedContext)ink.reset();
      displayedContext=context;contextGraph=state;sync();
    });
    global.addEventListener('kg-auth-session-change',()=>{
      const next=textContext();
      if(next!==displayedContext){ink.reset();ink.setOpen(false)}
      displayedContext=next;contextGraph=state;
    });
    bind();sync();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
