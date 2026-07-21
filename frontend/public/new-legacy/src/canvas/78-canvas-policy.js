'use strict';

/*
 * CanvasPolicy v1
 * 画布能力策略。页面、设备和工作区类型通过策略组合能力，而不是在各事件中散落条件判断。
 */
(function(global){
  const BASE=Object.freeze({
    workspaceType:'blank',
    readonly:false,
    editable:true,
    allowPanZoom:true,
    allowCardCreate:true,
    allowCardDelete:true,
    allowCardMove:true,
    allowCardResize:true,
    allowEdgeCreate:true,
    allowEdgeEdit:true,
    allowGrouping:true,
    allowFreeExplore:true,
    autoFocusCurrentStep:false,
    allowedCardTypes:null
  });

  const CAPABILITY_MAP=Object.freeze({
    edit:'editable',
    panZoom:'allowPanZoom',
    cardCreate:'allowCardCreate',
    cardDelete:'allowCardDelete',
    cardMove:'allowCardMove',
    cardResize:'allowCardResize',
    edgeCreate:'allowEdgeCreate',
    edgeEdit:'allowEdgeEdit',
    grouping:'allowGrouping',
    freeExplore:'allowFreeExplore'
  });

  function clone(value){
    if(value===undefined)return undefined;
    try{return JSON.parse(JSON.stringify(value))}catch(e){return value}
  }
  function normalizeAllowedCardTypes(value){
    if(value===null||value===undefined)return null;
    return [...new Set((Array.isArray(value)?value:[value]).map(String).filter(Boolean))];
  }
  function normalize(input={}){
    const policy={
      ...BASE,
      ...clone(input),
      workspaceType:String(input.workspaceType||BASE.workspaceType),
      allowedCardTypes:normalizeAllowedCardTypes(input.allowedCardTypes)
    };
    policy.readonly=!!policy.readonly;
    policy.editable=policy.readonly?false:policy.editable!==false;
    [
      'allowPanZoom','allowCardCreate','allowCardDelete','allowCardMove',
      'allowCardResize','allowEdgeCreate','allowEdgeEdit','allowGrouping',
      'allowFreeExplore','autoFocusCurrentStep'
    ].forEach(key=>{
      policy[key]=!!policy[key];
    });
    if(policy.readonly){
      policy.allowCardCreate=false;
      policy.allowCardDelete=false;
      policy.allowCardMove=false;
      policy.allowCardResize=false;
      policy.allowEdgeCreate=false;
      policy.allowEdgeEdit=false;
      policy.allowGrouping=false;
      policy.allowFreeExplore=false;
    }
    return policy;
  }
  function can(policy,capability){
    const normalized=normalize(policy);
    const key=CAPABILITY_MAP[String(capability||'')]||String(capability||'');
    if(!(key in normalized))return false;
    return !!normalized[key];
  }
  function allowsCardType(policy,cardType){
    const normalized=normalize(policy);
    if(!normalized.allowedCardTypes)return true;
    return normalized.allowedCardTypes.includes(String(cardType||''));
  }
  function merge(...policies){
    return normalize(Object.assign({},...policies.filter(Boolean).map(clone)));
  }
  function deepLearning(overrides={}){
    return merge({
      workspaceType:'deep-learning',
      readonly:false,
      editable:true,
      allowPanZoom:true,
      allowCardCreate:false,
      allowCardDelete:false,
      allowCardMove:true,
      allowCardResize:false,
      allowEdgeCreate:false,
      allowEdgeEdit:false,
      allowGrouping:false,
      allowFreeExplore:true,
      autoFocusCurrentStep:true,
      allowedCardTypes:[
        'learning.answer',
        'learning.keyword',
        'learning.knowledge-network',
        'learning.reasoning',
        'learning.recap'
      ]
    },overrides);
  }
  function synthesis(overrides={}){
    return merge({
      workspaceType:'synthesis',
      readonly:false,
      editable:true,
      allowPanZoom:true,
      allowCardCreate:true,
      allowCardDelete:true,
      allowCardMove:true,
      allowCardResize:true,
      allowEdgeCreate:true,
      allowEdgeEdit:true,
      allowGrouping:true,
      allowFreeExplore:true,
      autoFocusCurrentStep:false,
      allowedCardTypes:[
        'question.reference',
        'knowledge.principle',
        'knowledge.pattern',
        'knowledge.mistake',
        'knowledge.note',
        'knowledge.image',
        'knowledge.document',
        'knowledge.summary',
        'workspace.group'
      ]
    },overrides);
  }
  function mobileReadonly(base={}){
    return merge(base,{
      readonly:true,
      editable:false,
      allowPanZoom:false,
      allowCardCreate:false,
      allowCardDelete:false,
      allowCardMove:false,
      allowCardResize:false,
      allowEdgeCreate:false,
      allowEdgeEdit:false,
      allowGrouping:false,
      allowFreeExplore:false
    });
  }
  function create(input={}){
    let value=normalize(input);
    const api={
      get value(){return clone(value)},
      update(next={}){value=merge(value,next);return api.value},
      replace(next={}){value=normalize(next);return api.value},
      can(capability){return can(value,capability)},
      allowsCardType(cardType){return allowsCardType(value,cardType)},
      with(overrides={}){return create(merge(value,overrides))}
    };
    return Object.freeze(api);
  }

  global.KGCanvasPolicy=Object.freeze({
    BASE,
    CAPABILITY_MAP,
    normalize,
    merge,
    can,
    allowsCardType,
    create,
    presets:Object.freeze({
      deepLearning,
      synthesis,
      mobileReadonly
    })
  });
})(window);
