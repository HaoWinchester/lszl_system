'use strict';

(function(global){
  function clone(value){try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
  function create(options={}){
    const limit=Math.max(1,Number(options.limit)||50);
    const undoStack=[],redoStack=[];
    let transaction=null,busy=false;
    const capture=()=>clone(typeof options.capture==='function'?options.capture():null);
    const restore=snapshot=>typeof options.restore==='function'?options.restore(clone(snapshot)):false;
    const emit=(type,item)=>{if(typeof options.onChange==='function')options.onChange({type,item,state:getState()})};
    function trim(stack){if(stack.length>limit)stack.splice(0,stack.length-limit)}
    function checkpoint(label='操作'){
      if(busy)return false;
      if(transaction){if(!transaction.captured)transaction.before=capture(),transaction.captured=true;return true}
      undoStack.push({label:String(label||'操作'),snapshot:capture(),at:Date.now()});
      trim(undoStack);redoStack.length=0;emit('checkpoint',undoStack.at(-1));return true;
    }
    function begin(label='操作'){
      if(transaction||busy)return false;
      transaction={label:String(label||'操作'),before:null,captured:false};
      return true;
    }
    function commit(){
      if(!transaction)return false;
      const item=transaction;transaction=null;
      if(!item.captured)return false;
      undoStack.push({label:item.label,snapshot:item.before,at:Date.now()});
      trim(undoStack);redoStack.length=0;emit('commit',undoStack.at(-1));return true;
    }
    function rollback(){
      if(!transaction)return false;
      const item=transaction;transaction=null;
      if(item.captured)restore(item.before);
      emit('rollback',item);return true;
    }
    function run(label,mutator){
      if(typeof mutator!=='function')return false;
      if(!begin(label))return mutator();
      checkpoint(label);
      try{const result=mutator();commit();return result}catch(error){rollback();throw error}
    }
    function move(source,target,type){
      if(busy||!source.length)return false;
      const item=source.pop(),current={label:item.label,snapshot:capture(),at:Date.now()};
      busy=true;
      try{restore(item.snapshot)}finally{busy=false}
      target.push(current);trim(target);emit(type,item);return item;
    }
    function undo(){return move(undoStack,redoStack,'undo')}
    function redo(){return move(redoStack,undoStack,'redo')}
    function clear(){undoStack.length=0;redoStack.length=0;transaction=null;emit('clear',null)}
    function getState(){return{canUndo:undoStack.length>0,canRedo:redoStack.length>0,undoLabel:undoStack.at(-1)?.label||'',redoLabel:redoStack.at(-1)?.label||'',undoCount:undoStack.length,redoCount:redoStack.length,busy,transaction:transaction&&transaction.label||''}}
    return Object.freeze({checkpoint,begin,commit,rollback,run,undo,redo,clear,getState,get busy(){return busy}});
  }
  global.KGGraphHistoryController=Object.freeze({create});
})(typeof window!=='undefined'?window:globalThis);
