'use strict';

/*
 * GuidedLearningActivityRegistry v1
 * 统一管理标准活动与复合活动插件。插件只负责当前活动的渲染、交互和工作量统计，
 * 节点运行器继续负责队列、统一进度、完成统计与持久化。
 */
(function(global){
  const plugins=new Map();

  function normalizeType(type){return String(type||'').trim()}
  function register(type,plugin){
    const key=normalizeType(type);
    if(!key)throw new Error('ActivityRegistry.register: type is required');
    if(!plugin||typeof plugin!=='object')throw new Error('ActivityRegistry.register: plugin is required');
    if(typeof plugin.render!=='function')throw new Error('ActivityRegistry.register: render() is required for '+key);
    plugins.set(key,Object.freeze({...plugin,type:key}));
    return plugins.get(key);
  }
  function unregister(type){return plugins.delete(normalizeType(type))}
  function get(type){return plugins.get(normalizeType(type))||null}
  function has(type){return plugins.has(normalizeType(type))}
  function list(){return [...plugins.values()]}

  global.KGGuidedLearningActivityRegistry=Object.freeze({register,unregister,get,has,list});
})(window);
