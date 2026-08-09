/* Server-backed question catalog client. Local IndexedDB remains the draft store. */
(function(global){
  const API_ROOT='/api/v1';
  const STATUS_CODES={
    401:['AUTH_REQUIRED','请先登录后再连接服务器题库。'],
    403:['PERMISSION_DENIED','当前账号没有录入题目的权限。'],
    409:['CONFLICT','服务器数据已变化，请重新载入后再试。'],
    422:['VALIDATION_FAILED','题目未通过服务器校验。']
  };

  class ServerCatalogError extends Error{
    constructor(code,message,{status=0,serverCode='',issues=[],detail=null,cause=null}={}){
      super(message);this.name='ServerCatalogError';this.code=code;this.status=status;
      this.serverCode=serverCode;this.issues=Array.isArray(issues)?issues:[];this.detail=detail;
      if(cause)this.cause=cause;
    }
  }

  function cloneJson(value){return JSON.parse(JSON.stringify(value??{}))}
  function uuid(){return global.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}
  function errorDetail(payload){
    const detail=payload?.detail??payload??{};
    if(typeof detail==='string')return {message:detail,code:'',issues:[]};
    return {
      message:String(detail?.message||payload?.message||''),
      code:String(detail?.code||payload?.code||''),
      issues:Array.isArray(detail?.issues)?detail.issues:(Array.isArray(payload?.issues)?payload.issues:[])
    };
  }
  async function request(path,options={}){
    let response;
    try{
      response=await global.fetch(`${API_ROOT}${path}`,{
        ...options,
        credentials:'include',
        headers:{...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})}
      });
    }catch(cause){
      if(cause instanceof ServerCatalogError)throw cause;
      throw new ServerCatalogError('NETWORK_ERROR','无法连接服务器，本地草稿已保留。',{cause});
    }
    let payload={};
    try{payload=await response.json()}catch(_error){}
    if(!response.ok){
      const detail=errorDetail(payload),mapped=STATUS_CODES[response.status]||['SERVER_ERROR',`服务器请求失败 (${response.status})`];
      throw new ServerCatalogError(mapped[0],detail.message||mapped[1],{
        status:response.status,serverCode:detail.code,issues:detail.issues,detail:payload
      });
    }
    return payload;
  }
  function stripSyncFields(question){
    const payload=cloneJson(question);
    for(const key of ['serverRevision','serverContentHash','lastSyncedAt','lockToken','lock'])delete payload[key];
    return payload;
  }
  function uploadFingerprint(bundle,workspace,creatorId){
    return JSON.stringify({
      targetBankId:workspace.serverBankId||'',creatorId,
      questions:(bundle?.questionBank?.questions||[]).map(question=>({
        id:question.id,contentHash:question.contentHash||'',serverRevision:question.serverRevision??null
      })),
      principles:bundle?.principles||{},synthesisPresets:bundle?.synthesisPresets||{},tagConfig:bundle?.tagConfig||{}
    });
  }
  function idempotencyKey(workspace,fingerprint){
    if(workspace.lastIdempotencyKey&&workspace.lastUploadFingerprint===fingerprint)return workspace.lastIdempotencyKey;
    const key=`prep-${uuid()}`;
    workspace.lastIdempotencyKey=key;workspace.lastUploadFingerprint=fingerprint;
    return key;
  }
  async function withStableIdempotencyKey(workspace,fingerprint,operation){
    return operation(idempotencyKey(workspace,fingerprint));
  }
  function emit(type,detail){
    try{global.dispatchEvent(new CustomEvent(type,{detail}))}catch(_error){}
  }
  function migrateWorkspaceMetadata(input){
    const workspace=cloneJson(input),server=workspace.server&&typeof workspace.server==='object'?workspace.server:{};
    workspace.server={
      serverBankId:String(server.serverBankId||''),
      serverBankRevision:Number(server.serverBankRevision)||null,
      clientInstanceId:String(server.clientInstanceId||`prep_client_${uuid()}`),
      lastIdempotencyKey:String(server.lastIdempotencyKey||''),
      lastBatchId:String(server.lastBatchId||''),
      lastUploadFingerprint:String(server.lastUploadFingerprint||'')
    };
    if(workspace.questionBank&&Array.isArray(workspace.questionBank.questions)){
      workspace.questionBank.questions=workspace.questionBank.questions.map(question=>({
        ...question,
        serverRevision:Number(question.serverRevision)||null,
        serverContentHash:String(question.serverContentHash||''),
        lastSyncedAt:String(question.lastSyncedAt||'')
      }));
    }
    return workspace;
  }
  function syncMetadata(workspace,questions,result){
    if(result?.status!=='committed')return false;
    const syncedAt=new Date().toISOString(),byId=new Map((questions||[]).map(question=>[String(question.id),question]));
    workspace.serverBankId=String(result.bankId||workspace.serverBankId||'');
    workspace.serverBankRevision=Number(result.bankRevision||workspace.serverBankRevision||1);
    workspace.lastBatchId=String(result.batchId||'');
    for(const item of result.questions||[]){
      const question=byId.get(String(item.questionId||''));if(!question)continue;
      question.serverRevision=Number(item.revision||1);
      question.serverContentHash=String(item.contentHash||'');
      question.lastSyncedAt=syncedAt;
    }
    emit('prep:sync-committed',{result});
    return true;
  }

  async function acquireLock(questionId,{clientInstanceId,creatorId}={}){
    return request(`/content-prep/locks/${encodeURIComponent(questionId)}`,{
      method:'POST',body:JSON.stringify({clientInstanceId,creatorId})
    });
  }
  async function heartbeatLock(questionId,{clientInstanceId,lockToken}={}){
    return request(`/content-prep/locks/${encodeURIComponent(questionId)}/heartbeat`,{
      method:'PUT',body:JSON.stringify({clientInstanceId,lockToken})
    });
  }
  async function releaseLock(questionId,{clientInstanceId,lockToken,keepalive=false}={}){
    return request(`/content-prep/locks/${encodeURIComponent(questionId)}`,{
      method:'DELETE',body:JSON.stringify({clientInstanceId,lockToken}),keepalive
    });
  }
  function createEditLeaseController({clientInstanceId,creatorId,onState=()=>{}}={}){
    let timer=0,heartbeatFailures=0;
    let currentQuestion=null;
    let state={
      questionId:'',mode:'local-new',connection:'online',canSave:true,readOnly:false,
      lockToken:'',leaseSeconds:0,heartbeatIntervalSeconds:0,expiresAt:'',message:''
    };
    const snapshot=()=>({...state});
    function publish(patch,event=''){
      state={...state,...patch};onState(snapshot());if(event)emit(event,snapshot());return snapshot();
    }
    function stopHeartbeat(){if(timer){global.clearInterval(timer);timer=0}}
    async function releaseCurrent({keepalive=false}={}){
      stopHeartbeat();
      if(!state.questionId||!state.lockToken)return;
      try{await releaseLock(state.questionId,{clientInstanceId,lockToken:state.lockToken,keepalive})}catch(_error){}
      state.lockToken='';
    }
    async function beat(){
      if(!state.questionId||!state.lockToken||state.mode!=='server-editable')return snapshot();
      try{
        const grant=await heartbeatLock(state.questionId,{clientInstanceId,lockToken:state.lockToken});
        heartbeatFailures=0;
        return publish({connection:'online',expiresAt:grant.expiresAt||state.expiresAt,message:''});
      }catch(error){
        heartbeatFailures+=1;
        if(error.status===409){stopHeartbeat();return publish({mode:'conflict-copy-required',connection:'online',canSave:false,readOnly:true,message:error.message},'prep:lock-lost')}
        if(error.status===403){stopHeartbeat();return publish({mode:'server-readonly',connection:'online',canSave:false,readOnly:true,message:error.message},'prep:lock-lost')}
        if(heartbeatFailures>=2){stopHeartbeat();return publish({mode:'offline-unsynced',connection:'offline',canSave:false,readOnly:false,message:'连接中断，本地修改将继续保存在工作区；恢复后需重新确认编辑锁。'},'prep:lock-lost')}
        return publish({connection:'unstable',message:'服务器连接不稳定，正在保留当前编辑锁。'});
      }
    }
    function beginHeartbeat(grant){
      stopHeartbeat();
      const seconds=Math.max(1,Number(grant.heartbeatIntervalSeconds||30));
      timer=global.setInterval(beat,seconds*1000);
    }
    async function acquire(question){
      currentQuestion=question;
      if(!question?.serverRevision){
        return publish({questionId:String(question?.id||''),mode:'local-new',connection:'online',canSave:true,readOnly:false,lockToken:'',leaseSeconds:0,heartbeatIntervalSeconds:0,expiresAt:'',message:''});
      }
      publish({questionId:String(question.id),mode:'server-readonly',connection:'online',canSave:false,readOnly:true,lockToken:'',message:'正在申请编辑锁…'});
      try{
        const grant=await acquireLock(question.id,{clientInstanceId,creatorId});heartbeatFailures=0;
        question.lockToken=grant.lockToken;
        const next=publish({
          mode:'server-editable',connection:'online',canSave:true,readOnly:false,
          lockToken:grant.lockToken,leaseSeconds:Number(grant.leaseSeconds||0),
          heartbeatIntervalSeconds:Number(grant.heartbeatIntervalSeconds||30),
          expiresAt:String(grant.expiresAt||''),message:''
        },'prep:lock-acquired');
        beginHeartbeat(grant);return next;
      }catch(error){
        const offline=error.code==='NETWORK_ERROR';
        return publish({
          mode:offline?'offline-unsynced':'server-readonly',connection:offline?'offline':'online',
          canSave:false,readOnly:!offline,lockToken:'',message:error.message
        },'prep:lock-lost');
      }
    }
    return Object.freeze({
      snapshot,
      async open(question){await releaseCurrent();return acquire(question)},
      async close(options={}){await releaseCurrent(options);currentQuestion=null;return publish({questionId:'',mode:'local-new',connection:'online',canSave:true,readOnly:false,lockToken:'',message:''})},
      async reconfirm(){stopHeartbeat();return acquire(currentQuestion)},
      heartbeat:beat,
      handleSaveError(error){
        if(error?.status===409){stopHeartbeat();return publish({mode:'conflict-copy-required',canSave:false,readOnly:true,message:error.message||'服务器版本冲突'},'prep:lock-lost')}
        if(error?.status===403){stopHeartbeat();return publish({mode:'server-readonly',canSave:false,readOnly:true,message:error.message||'当前账号无权继续编辑'},'prep:lock-lost')}
        return snapshot();
      }
    });
  }

  const ServerCatalogService=Object.freeze({
    Error:ServerCatalogError,
    migrateWorkspaceMetadata,
    withStableIdempotencyKey,
    acquireLock,
    heartbeatLock,
    releaseLock,
    createEditLeaseController,
    async listWritableBanks(subject=''){
      const query=new URLSearchParams({mode:'writable'});if(subject)query.set('subject',subject);
      return (await request(`/question-catalog/banks?${query}`)).banks||[];
    },
    async createBank(input){return (await request('/content-prep/banks',{method:'POST',body:JSON.stringify(input)})).bank},
    async loadQuestion(questionId){return (await request(`/question-catalog/questions/${encodeURIComponent(questionId)}`)).question},
    async getBatch(batchId){return (await request(`/content-prep/batches/${encodeURIComponent(batchId)}`)).batch},
    syncMetadata,
    async uploadBundle(bundle,{workspace,creatorId,questions,prepVersion='0.4.0',workspaceVersion='4'}={}){
      if(!workspace?.serverBankId)throw new ServerCatalogError('BANK_REQUIRED','请先选择目标题库。');
      if(!workspace?.clientInstanceId)throw new ServerCatalogError('CLIENT_INSTANCE_REQUIRED','本地工作区缺少客户端标识。');
      if(!creatorId)throw new ServerCatalogError('CREATOR_REQUIRED','请先选择制作人。');
      const sourceQuestions=bundle?.questionBank?.questions||[];
      const fingerprint=uploadFingerprint(bundle,workspace,creatorId);
      return withStableIdempotencyKey(workspace,fingerprint,async key=>{
        const payload={
        idempotencyKey:key,
        clientInstanceId:workspace.clientInstanceId,
        targetBankId:workspace.serverBankId,
        creatorId,
        prepVersion:String(prepVersion),
        workspaceVersion:String(workspaceVersion),
        questions:sourceQuestions.map(question=>({
          question:stripSyncFields(question),
          baseRevision:Number(question.serverRevision)||null,
          lockToken:question.lockToken||null
        })),
        principles:cloneJson(bundle?.principles||{}),
        synthesisPresets:cloneJson(bundle?.synthesisPresets||{}),
        tagConfig:cloneJson(bundle?.tagConfig||{})
        };
        const posted=await request('/content-prep/batches',{method:'POST',body:JSON.stringify(payload)});
        const batch=await ServerCatalogService.getBatch(posted.batchId);
        const result={...posted,status:String(batch?.status||''),batch};
        if(result.status!=='committed'){
          throw new ServerCatalogError('UPLOAD_NOT_COMMITTED','服务器尚未确认提交，本地草稿已保留。',{detail:batch});
        }
        syncMetadata(workspace,questions||sourceQuestions,result);
        return result;
      });
    }
  });
  global.PMPPrepServerCatalogService=ServerCatalogService;
  if(global.PMPPrepServices&&!('ServerCatalogService' in global.PMPPrepServices)){
    global.PMPPrepServices.ServerCatalogService=ServerCatalogService;
  }
})(window);
