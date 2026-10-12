'use strict';

/* Adapt the shared drawing/capture tools to the graph's existing state and history. */
(function(global){
  function init(){
    if(global.KGHomeInk||!global.KGCanvasInk||!stage||!world)return;
    let previous;
    const ink=global.KGCanvasInk.create({
      viewport:stage,world,placement:'right',trigger:()=>document.getElementById('homeInkBtn'),
      getViewport:()=>state.viewport,getStrokes:()=>state.strokes||[],
      isReadonly:()=>!canWriteGraph(),
      history:ensureGraphHistoryController(),showHistory:true,
      change:(strokes,label)=>ensureGraphHistoryController().run(label,()=>{state.strokes=strokes;save()}),
      persistText:()=>{const graph=state;return window.KGGraphFileAutosave.saveAcknowledged({force:true},()=>state===graph)},
      onDrawMode:()=>setGraphPointerMode('edit'),onError:showStatus
    });
    function sync(){if(previous!==state.strokes){previous=state.strokes;ink.render()}else ink.refreshControls()}
    global.KGHomeInk=Object.assign(ink,{sync});
    // 可编辑表格：共享控制器渲染 state.tables，写入经图谱历史（单次操作一次撤销）+ 自动保存。
    if(global.KGCanvasTableController&&!global.KGHomeTables){
      const tablesController=global.KGCanvasTableController.create({
        viewport:stage,world,
        getViewport:()=>state.viewport,
        getTables:()=>state.tables||[],
        change:(next,label)=>{
          const history=ensureGraphHistoryController();
          if(label&&history)history.run(label,()=>{state.tables=next;save()});
          else{state.tables=next;save()}
        },
        isReadonly:()=>!canWriteGraph(),
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
    bind();sync();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
