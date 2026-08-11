'use strict';

(function(global){
  const ICONS=Object.freeze({
    standard:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="3"></rect><path d="M3.5 10h17"></path><path d="M8 7h8"></path><path d="M7 14h10M7 17h7"></path></svg>',
    sticky:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v10l-5.5 5.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z"></path><path d="M15 20.5V16h5.5"></path><path d="M7.5 9h9M7.5 12.5h7"></path></svg>',
    rounded:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="6"></rect><path d="M8 12h8"></path></svg>',
    rectangle:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14"></rect><path d="M8 12h8"></path></svg>',
    circle:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M8 12h8"></path></svg>',
    triangle:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 21 20H3z"></path><path d="M9 14h6"></path></svg>'
  });
  const definitions=new Map();
  function register(definition={}){
    const id=String(definition.id||'').trim();
    if(!id)throw new Error('card style id is required');
    const current=definitions.get(id)||{};
    const model=global.KGGraphModel;
    const defaults=definition.defaults||(model&&model.defaultsForCardStyle?model.defaultsForCardStyle(id):{});
    definitions.set(id,Object.freeze({...current,...definition,id,defaults:Object.freeze({...defaults})}));
    return definitions.get(id);
  }
  function get(id){return definitions.get(id)||definitions.get('standard')||null}
  function list(){return [...definitions.values()]}
  function has(id){return definitions.has(id)}
  register({id:'standard',label:'标准卡牌',icon:ICONS.standard});
  register({id:'sticky',label:'便签',icon:ICONS.sticky});
  register({id:'rounded',label:'圆角矩形',icon:ICONS.rounded});
  register({id:'rectangle',label:'直角矩形',icon:ICONS.rectangle});
  register({id:'circle',label:'圆形',icon:ICONS.circle});
  register({id:'triangle',label:'三角形',icon:ICONS.triangle});
  global.KGGraphCardStyleRegistry=Object.freeze({register,get,list,has,icons:ICONS});
})(typeof window!=='undefined'?window:globalThis);
