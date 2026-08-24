'use strict';

(function(global){
  let selected=global.KGGraphFileStore||null;
  async function initialize(){
    const remote=global.KGGraphFileRemoteStore;
    if(remote&&typeof remote.active==='function'&&remote.active()){
      if(typeof remote.clearSession==='function')remote.clearSession();
      await remote.initialize();
      selected=remote;
    }else{
      if(remote&&typeof remote.clearSession==='function')remote.clearSession();
      selected=global.KGGraphFileStore||null;
    }
    return selected;
  }
  function current(){return selected}
  async function invoke(method,...args){
    const store=current();
    if(!store||typeof store[method]!=='function')throw new Error(`文件管理数据源缺少方法：${method}`);
    return await Promise.resolve(store[method](...args));
  }
  global.KGFileManagerStoreBridge={initialize,current,invoke};
})(window);
