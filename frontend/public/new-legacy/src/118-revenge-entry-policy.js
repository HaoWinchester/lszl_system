'use strict';
;(function(global){
  const MAX_SESSION_QUESTIONS=180;

  function count(value){
    const parsed=Math.floor(Number(value)||0);
    return Math.max(0,parsed);
  }

  function derive(activeCount,selectedCount){
    const total=count(activeCount);
    if(!total)return Object.freeze({total:0,automatic:true,selectedCount:0,requestCount:0,options:Object.freeze([])});
    if(total<=10){
      const option=Object.freeze({value:total,label:`全部 ${total} 题`,disabled:false,kind:'all'});
      return Object.freeze({total,automatic:true,selectedCount:total,requestCount:total,options:Object.freeze([option])});
    }
    const fullCount=Math.min(total,MAX_SESSION_QUESTIONS);
    const options=[
      {value:10,label:'10 题',disabled:false,kind:'batch'},
      {value:20,label:'20 题',disabled:total<20,kind:'batch'},
      {value:fullCount,label:total>MAX_SESSION_QUESTIONS?`本次最多 ${MAX_SESSION_QUESTIONS} 题`:`全部 ${total} 题`,disabled:false,kind:total>MAX_SESSION_QUESTIONS?'limit':'all'},
    ].map(Object.freeze);
    const requested=count(selectedCount);
    const selected=options.some(option=>!option.disabled&&option.value===requested)?requested:10;
    return Object.freeze({total,automatic:false,selectedCount:selected,requestCount:selected,options:Object.freeze(options)});
  }

  global.KGRevengeEntryPolicy=Object.freeze({derive,MAX_SESSION_QUESTIONS});
})(typeof window!=='undefined'?window:globalThis);
