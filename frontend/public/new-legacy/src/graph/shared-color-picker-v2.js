'use strict';

(function(global){
  let controller=null;
  function ensure(){
    if(controller)return controller;
    const factory=global.KGGraphFloatingColorWindowController;
    if(!factory||typeof factory.create!=='function')return null;
    controller=factory.create({stage:document.body});
    return controller;
  }
  function open(options={}){
    const instance=ensure();if(!instance)return false;
    instance.open({
      kind:options.kind||'color',
      title:options.title||'选择颜色',
      anchor:options.anchor||null,
      pointer:options.pointer||null,
      value:options.value||{color:'#64748b',opacity:1},
      allowOpacity:options.allowOpacity!==false,
      allowTransparent:!!options.allowTransparent,
      presets:options.presets,
      documentColors:options.documentColors||[],
      documentLabel:options.documentLabel||'当前画布',
      onStart:options.onStart,
      onPreview:options.onPreview,
      onCommit:value=>{if(typeof options.onCommit==='function')options.onCommit(value)},
      onCancel:options.onCancel
    });
    return true;
  }
  function close(options={}){return controller?controller.close(options):false}
  function isOpen(){return !!(controller&&controller.isOpen())}
  function destroy(){if(controller)controller.destroy();controller=null}
  global.KGColorPickerV2=Object.freeze({open,close,isOpen,destroy,ensure});
})(typeof window!=='undefined'?window:globalThis);
