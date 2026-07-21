'use strict';

/* CanvasHistoryController v1 · 通用可撤销命令栈。 */
(function(global){
  function create(options={}){
    const limit=Math.max(1,Number(options.limit||80));
    const onChange=typeof options.onChange==='function'?options.onChange:()=>{};
    const undoStack=[];
    const redoStack=[];
    let busy=false;
    function state(){return {canUndo:undoStack.length>0,canRedo:redoStack.length>0,undoLabel:undoStack.at(-1)?.label||'',redoLabel:redoStack.at(-1)?.label||'',undoCount:undoStack.length,redoCount:redoStack.length,busy}}
    function emit(reason){onChange({...state(),reason})}
    function push(command={}){
      if(busy||typeof command.undo!=='function'||typeof command.redo!=='function')return false;
      undoStack.push({label:String(command.label||'画布操作'),undo:command.undo,redo:command.redo,at:Date.now()});
      if(undoStack.length>limit)undoStack.splice(0,undoStack.length-limit);
      redoStack.length=0;
      emit('push');
      return true;
    }
    function run(from,to,method,reason){
      if(busy||!from.length)return false;
      const command=from.pop();
      busy=true;
      try{command[method]();to.push(command)}catch(error){from.push(command);throw error}finally{busy=false;emit(reason)}
      return command;
    }
    function undo(){return run(undoStack,redoStack,'undo','undo')}
    function redo(){return run(redoStack,undoStack,'redo','redo')}
    function clear(){undoStack.length=0;redoStack.length=0;emit('clear')}
    return Object.freeze({push,undo,redo,clear,getState:state,get busy(){return busy}});
  }
  global.KGCanvasHistoryController=Object.freeze({create});
})(window);
