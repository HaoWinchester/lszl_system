'use strict';

/*
 * GuidedLearningIconRegistry v1
 * 首页学习节点统一使用内联 SVG。注册表负责图标查找、渲染和未知类型回退，
 * 避免节点数据继续保存单字图标，也不依赖外部图标字体或网络资源。
 */
(function(global){
  const icons=new Map();
  const fallbackKey='fallback';

  function normalizeKey(value){return String(value||'').trim().toLowerCase()}
  function safeClassName(value){return String(value||'').replace(/[^a-zA-Z0-9_\-\s]/g,'').trim()}
  function register(key,definition){
    const normalized=normalizeKey(key);
    if(!normalized)throw new Error('IconRegistry.register: key is required');
    if(!definition||typeof definition!=='object'||!String(definition.body||'').trim()){
      throw new Error('IconRegistry.register: SVG body is required for '+normalized);
    }
    const icon=Object.freeze({
      key:normalized,
      viewBox:String(definition.viewBox||'0 0 24 24'),
      body:String(definition.body)
    });
    icons.set(normalized,icon);
    return icon;
  }
  function get(key){
    const normalized=normalizeKey(key);
    return icons.get(normalized)||icons.get(fallbackKey)||null;
  }
  function has(key){return icons.has(normalizeKey(key))}
  function list(){return [...icons.values()]}
  function render(key,options={}){
    const requested=normalizeKey(key);
    const icon=get(requested);
    if(!icon)return '';
    const resolved=has(requested)?requested:fallbackKey;
    const className=safeClassName(options.className||'');
    return '<svg class="'+className+'" data-icon-key="'+resolved+'" viewBox="'+icon.viewBox+'" aria-hidden="true" focusable="false" fill="none" xmlns="http://www.w3.org/2000/svg">'+icon.body+'</svg>';
  }

  register(fallbackKey,{
    body:'<rect x="4" y="4" width="6" height="6" rx="2" fill="currentColor"/><rect x="14" y="4" width="6" height="6" rx="2" fill="currentColor"/><rect x="4" y="14" width="6" height="6" rx="2" fill="currentColor"/><rect x="14" y="14" width="6" height="6" rx="2" fill="currentColor"/>'
  });
  register('keyword',{
    body:'<circle cx="10" cy="10" r="5.5" stroke="currentColor" stroke-width="2.2"/><path d="M14.2 14.2 20 20" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M7.5 10h5M10 7.5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
  });
  register('choice',{
    body:'<circle cx="5" cy="7" r="1.7" fill="currentColor"/><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="5" cy="17" r="1.7" fill="currentColor"/><path d="M9 7h10M9 12h10M9 17h7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
  });
  register('matching',{
    body:'<path d="M9.2 14.8 7.6 16.4a3.4 3.4 0 1 1-4.8-4.8l3.1-3.1a3.4 3.4 0 0 1 4.8 0" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="m14.8 9.2 1.6-1.6a3.4 3.4 0 1 1 4.8 4.8l-3.1 3.1a3.4 3.4 0 0 1-4.8 0" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="m8.6 15.4 6.8-6.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'
  });
  register('open_text',{
    body:'<path d="M5 4.5h9.5A2.5 2.5 0 0 1 17 7v3" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><path d="M5 4.5A2.5 2.5 0 0 0 2.5 7v10A2.5 2.5 0 0 0 5 19.5h6" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><path d="m12.8 17.7.6-3.1 5.8-5.8a1.5 1.5 0 0 1 2.1 2.1l-5.8 5.8-3.1.6.4.4Z" fill="currentColor"/><path d="M6.5 9h6M6.5 13h3.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>'
  });
  register('deep_recall',{
    body:'<path d="M9.2 4.2a4 4 0 0 0-4 4v.5a3.6 3.6 0 0 0-1.7 3.1 3.7 3.7 0 0 0 2.2 3.4v.6a4 4 0 0 0 4 4c1 0 1.8-.3 2.3-.9.5.6 1.3.9 2.3.9a4 4 0 0 0 4-4v-.6a3.7 3.7 0 0 0 2.2-3.4 3.6 3.6 0 0 0-1.7-3.1v-.5a4 4 0 0 0-4-4c-1 0-1.8.3-2.3.9-.5-.6-1.3-.9-2.3-.9Z" stroke="currentColor" stroke-width="2"/><path d="M12 5.1v13.8M7.7 8.6c1.8 0 3 1.1 3 2.7M16.3 8.6c-1.8 0-3 1.1-3 2.7M7.6 15.2c1.6 0 2.7-.8 3.1-2.1M16.4 15.2c-1.6 0-2.7-.8-3.1-2.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
  });
  register('multi_question_induction',{
    body:'<rect x="3" y="4" width="6" height="5" rx="1.5" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="15" width="6" height="5" rx="1.5" stroke="currentColor" stroke-width="1.8"/><rect x="15" y="4" width="6" height="5" rx="1.5" stroke="currentColor" stroke-width="1.8"/><path d="M10 6.5h3M10 17.5h3M13 6.5v11M13 12h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m17 10 2 2-2 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
  });
  register('knowledge_graph',{
    body:'<circle cx="12" cy="4.5" r="2.4" fill="currentColor"/><circle cx="5" cy="12" r="2.4" fill="currentColor"/><circle cx="19" cy="12" r="2.4" fill="currentColor"/><circle cx="8.5" cy="19.2" r="2.4" fill="currentColor"/><circle cx="16" cy="19.2" r="2.4" fill="currentColor"/><path d="M10.4 6.3 6.7 10.2M13.6 6.3l3.7 3.9M7.1 13.8l1.3 3M16.9 13.8l-.8 3M7.4 12h9.2M10.9 18.9h2.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
  });
  register('memory_match',{
    body:'<rect x="4" y="3.5" width="11.5" height="15" rx="2.2" stroke="currentColor" stroke-width="2"/><path d="M8.5 7.5h2.5M8.5 11h3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M15.5 7h2.3A2.2 2.2 0 0 1 20 9.2v9.1a2.2 2.2 0 0 1-2.2 2.2H9.2A2.2 2.2 0 0 1 7 18.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
  });
  register('challenge',{
    body:'<path d="M8 4h8v3.2a4 4 0 0 1-8 0V4Z" stroke="currentColor" stroke-width="2"/><path d="M8 6H4.5v1.2A3.8 3.8 0 0 0 8.3 11M16 6h3.5v1.2a3.8 3.8 0 0 1-3.8 3.8M12 11.2V16M8.5 20h7M10 16h4v4h-4z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
  });

  global.KGGuidedLearningIconRegistry=Object.freeze({register,get,has,list,render,fallbackKey});
})(window);
