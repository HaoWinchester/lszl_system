'use strict';

/*
 * Database-backed Deep Recall adapter.
 *
 * The open graph exists only in this closure.  This module deliberately has
 * no browser-storage fallback: a failed request remains visibly unsaved and
 * retryable instead of becoming a second source of truth.
 */
(function(global){
  function clone(value){
    if(value==null)return value;
    try{return JSON.parse(JSON.stringify(value))}catch(error){return value}
  }

  function questionPath(questionId){
    return encodeURIComponent(String(questionId||'').trim());
  }

  async function responseJson(response){
    try{return await response.json()}catch(error){return {detail:{code:'invalid_response',message:'服务器返回了无法解析的数据'}}}
  }

  function requestError(response,payload){
    const detail=payload?.detail&&typeof payload.detail==='object'?payload.detail:{};
    const error=new Error(detail.message||payload?.detail||`请求失败（${response.status}）`);
    error.name='DeepRecallRequestError';
    error.status=Number(response.status)||0;
    error.code=detail.code||'request_failed';
    error.payload=payload;
    return error;
  }

  function graphFromSession(session){
    const progress=session?.progress&&typeof session.progress==='object'?session.progress:{};
    return {
      nodes:Array.isArray(progress.nodes)?clone(progress.nodes):[],
      edges:Array.isArray(progress.edges)?clone(progress.edges):[],
      customNodes:progress.customNodes&&typeof progress.customNodes==='object'?clone(progress.customNodes):{},
      activeKeywords:Array.isArray(progress.activeKeywords)?clone(progress.activeKeywords):[],
      choiceOffsets:progress.choiceOffsets&&typeof progress.choiceOffsets==='object'?clone(progress.choiceOffsets):{},
      transform:progress.transform&&typeof progress.transform==='object'?clone(progress.transform):{x:0,y:0,scale:1},
      metrics:progress.metrics&&typeof progress.metrics==='object'?clone(progress.metrics):{},
      graphSchemaVersion:Number(progress.graphSchemaVersion)||3
    };
  }

  function normalizeGraph(graph){
    const value=graph&&typeof graph==='object'?graph:{};
    return {
      nodes:Array.isArray(value.nodes)?clone(value.nodes):[],
      edges:Array.isArray(value.edges)?clone(value.edges):[],
      customNodes:value.customNodes&&typeof value.customNodes==='object'?clone(value.customNodes):{},
      activeKeywords:Array.isArray(value.activeKeywords)?clone(value.activeKeywords):[],
      choiceOffsets:value.choiceOffsets&&typeof value.choiceOffsets==='object'?clone(value.choiceOffsets):{},
      transform:value.transform&&typeof value.transform==='object'?clone(value.transform):{x:0,y:0,scale:1},
      metrics:value.metrics&&typeof value.metrics==='object'?clone(value.metrics):{},
      graphSchemaVersion:Number(value.graphSchemaVersion)||3
    };
  }

  function create({questionId,fetchImpl}={}){
    const id=String(questionId||'').trim();
    if(!id)throw new TypeError('questionId 不能为空');
    const request=fetchImpl||global.fetch;
    if(typeof request!=='function')throw new TypeError('当前环境缺少 fetch');
    const listeners=new Set();
    const state={
      session:null,
      graph:null,
      progressRevision:0,
      saveState:'idle',
      error:null,
      lastUnsavedGraph:null
    };

    function snapshot(){return clone(state)}
    function emit(){
      const value=snapshot();
      listeners.forEach(listener=>{try{listener(value)}catch(error){global.console?.error?.(error)}});
    }
    function update(patch){Object.assign(state,patch);emit()}

    async function send(url,init={}){
      const response=await request(url,{
        credentials:'include',
        headers:{Accept:'application/json',...(init.body?{'Content-Type':'application/json'}:{}),...(init.headers||{})},
        ...init
      });
      const payload=await responseJson(response);
      if(!response.ok)throw requestError(response,payload);
      return payload;
    }

    async function loadSession(){
      update({saveState:'loading',error:null});
      try{
        const session=await send(`/api/v1/recall/session/${questionPath(id)}`);
        const graph=graphFromSession(session);
        update({
          session:clone(session),
          graph,
          progressRevision:Number(session.progressRevision)||0,
          saveState:'idle',
          error:null,
          lastUnsavedGraph:null
        });
        return clone(session);
      }catch(error){
        update({saveState:'failed',error});
        throw error;
      }
    }

    async function saveGraph(graph){
      if(!state.session)throw new Error('请先加载深度回忆会话');
      const pending=normalizeGraph(graph);
      update({saveState:'saving',error:null,lastUnsavedGraph:pending,graph:pending});
      const libraryHash=String(
        state.session.currentLibrary?.contentHash||state.session.library?.contentHash||''
      );
      const body={
        expectedRevision:Number(state.progressRevision)||0,
        questionRevision:Number(state.session.currentQuestion?.revision)||1,
        libraryHash,
        graphSchemaVersion:pending.graphSchemaVersion,
        nodes:pending.nodes,
        edges:pending.edges,
        customNodes:pending.customNodes,
        activeKeywords:pending.activeKeywords,
        choiceOffsets:pending.choiceOffsets,
        transform:pending.transform,
        metrics:pending.metrics
      };
      try{
        const saved=await send(`/api/v1/recall/progress/${questionPath(id)}`,{
          method:'PUT',
          body:JSON.stringify(body)
        });
        const nextGraph=normalizeGraph(saved);
        const nextRevision=Number(saved.revision)||Number(state.progressRevision)||0;
        const nextSession={...state.session,progressRevision:nextRevision,progress:clone(saved),versionState:'current'};
        update({
          session:nextSession,
          graph:nextGraph,
          progressRevision:nextRevision,
          saveState:'saved',
          error:null,
          lastUnsavedGraph:null
        });
        return clone(saved);
      }catch(error){
        update({
          graph:pending,
          saveState:Number(error?.status)===409?'conflict':'failed',
          error,
          lastUnsavedGraph:pending
        });
        throw error;
      }
    }

    async function retryLastSave(){
      if(!state.lastUnsavedGraph)throw new Error('没有待重试的深度回忆进度');
      return saveGraph(state.lastUnsavedGraph);
    }

    async function resetToCurrent(){
      if(!state.session)throw new Error('请先加载深度回忆会话');
      update({saveState:'saving',error:null});
      const body={
        expectedRevision:Number(state.progressRevision)||0,
        targetQuestionRevision:Number(state.session.currentQuestion?.revision)||1
      };
      try{
        const saved=await send(`/api/v1/recall/progress/${questionPath(id)}/reset`,{
          method:'POST',
          body:JSON.stringify(body)
        });
        const nextRevision=Number(saved.revision)||Number(state.progressRevision)||0;
        const graph=normalizeGraph(saved);
        const session={
          ...state.session,
          versionState:'current',
          historyQuestion:null,
          library:clone(state.session.currentLibrary||state.session.library),
          progressRevision:nextRevision,
          progress:clone(saved)
        };
        update({
          session,
          graph,
          progressRevision:nextRevision,
          saveState:'saved',
          error:null,
          lastUnsavedGraph:null
        });
        return clone(saved);
      }catch(error){
        update({saveState:Number(error?.status)===409?'conflict':'failed',error});
        throw error;
      }
    }

    function subscribe(listener){
      if(typeof listener!=='function')throw new TypeError('listener 必须是函数');
      listeners.add(listener);
      return ()=>listeners.delete(listener);
    }

    return Object.freeze({
      loadSession,
      saveGraph,
      resetToCurrent,
      retryLastSave,
      getState:snapshot,
      subscribe
    });
  }

  const api=Object.freeze({create});
  global.KGDeepRecallServerAdapter=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
