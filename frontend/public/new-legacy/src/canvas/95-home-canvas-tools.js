'use strict';

/* Adapt the shared drawing/capture tools to the graph's existing state and history. */
(function(global){
  function init(){
    if(global.KGHomeInk||!global.KGCanvasInk||!stage||!world)return;
    let previous;
    const ink=global.KGCanvasInk.create({
      viewport:stage,world,placement:'right',trigger:()=>document.getElementById('homeInkBtn'),
      getViewport:()=>state.viewport,getStrokes:()=>state.strokes||[],
      // 画笔批注是轻量编辑：阅读模式也允许（登录+账号权限即可），与改名/文件级操作一致。
      // 切文件过渡期（isSwitching）仍保持禁用，防止笔迹落进切换前后的错误文件。
      isReadonly:()=>document.body.classList.contains('auth-readonly')
        ||!!(window.KGRolePermissions&&window.KGRolePermissions.can&&window.KGRolePermissions.can('editGraph')===false)
        ||!!window.KGGraphFileTabs?.isSwitching?.(),
      history:ensureGraphHistoryController(),showHistory:true,
      change:(strokes,label)=>ensureGraphHistoryController().run(label,()=>{state.strokes=strokes;save()}),
      persistText:()=>{const graph=state;return window.KGGraphFileAutosave.saveAcknowledged({force:true},()=>state===graph)},
      onDrawMode:()=>{setGraphPointerMode('edit');clearSelection()},onError:showStatus
    });
    function sync(){if(previous!==state.strokes){previous=state.strokes;ink.render()}else ink.refreshControls()}
    global.KGHomeInk=Object.assign(ink,{sync});
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
        isReadonly:()=>document.body.classList.contains('auth-readonly')
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
    global.addEventListener('kg-graph-current-file-change',()=>{ink.reset();sync()});
    let account=global.KGAuthCore?.currentUsername?.()||'';
    global.addEventListener('kg-auth-session-change',()=>{
      const next=global.KGAuthCore?.currentUsername?.()||'';
      if(next!==account){ink.reset();ink.setOpen(false)}
      account=next;
    });
    bind();sync();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
