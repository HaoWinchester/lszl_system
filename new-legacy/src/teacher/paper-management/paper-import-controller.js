'use strict';
(function(global){
  const root=global.KGTeacherDomains=global.KGTeacherDomains||{};
  root.PaperManagement=root.PaperManagement||{};
  const clone=value=>{if(value===undefined)return undefined;try{return JSON.parse(JSON.stringify(value))}catch(error){return value}};
  const actionKey=action=>action==='replace_draft'?'replaceDraft':action;
  function create(options={}){
    const api=options.api||global.KGPaperDraftApi;
    let state={fileName:'',packageData:null,preflight:null,conflictAction:'create',busy:false,error:'',success:null};
    let submitPromise=null,preflightPromise=null,submissionKey='',submissionPayload=null;
    const snapshot=()=>clone({...state,retryImport:!!submissionPayload&&!state.success});
    const emit=()=>{const value=snapshot();options.onChange?.(value);return value};
    const fail=message=>{state={...state,busy:false,error:String(message||'导入失败。'),success:null};emit();return {ok:false,error:state.error}};
    function preflight(){
      if(submitPromise)return submitPromise;
      if(preflightPromise)return preflightPromise;
      preflightPromise=performPreflight().finally(()=>{preflightPromise=null});
      return preflightPromise;
    }
    async function performPreflight(){
      if(!state.fileName||!state.packageData)return fail('请先选择有效的 JSON 试卷文件。');
      state={...state,busy:true,error:'',success:null};emit();
      try{
        const result=await api.importPreflight({fileName:state.fileName,package:clone(state.packageData)});
        state={...state,busy:false,preflight:clone(result),error:''};
        const allowed=result?.allowedActions||{};
        if(!allowed[actionKey(state.conflictAction)]){
          state.conflictAction=allowed.create?'create':allowed.copy?'copy':allowed.replaceDraft?'replace_draft':state.conflictAction;
        }
        emit();return {ok:true,preflight:clone(result)};
      }catch(error){return fail(error?.message||error)}
    }
    async function load(fileName,jsonText){
      if(state.busy)return {ok:false,error:'导入正在处理中，请等待完成。'};
      submissionKey='';submissionPayload=null;
      let packageData;
      try{packageData=JSON.parse(String(jsonText||'').replace(/^\ufeff/,''))}
      catch(error){state={...state,fileName:String(fileName||''),packageData:null,preflight:null};return fail(`JSON 解析失败：${error?.message||error}`)}
      if(root.QuestionBankImportController?.classify?.(packageData)==='question-bank'){
        state={...state,fileName:String(fileName||''),packageData:null,preflight:null};
        return fail('检测到题库 JSON，请使用“导入题库”。');
      }
      state={...state,fileName:String(fileName||'paper.json'),packageData:clone(packageData),preflight:null,error:'',success:null};emit();
      return preflight();
    }
    function setConflictAction(action){if(state.busy)return clone(state);if(state.conflictAction!==String(action||'create')){submissionKey='';submissionPayload=null;}state={...state,conflictAction:String(action||'create')};emit();return clone(state)}
    function confirm(){
      if(submitPromise)return submitPromise;
      if(state.busy)return Promise.resolve({ok:false,error:'预检正在处理中，请等待完成。'});
      if(state.success)return Promise.resolve({ok:true,result:clone(state.success)});
      const report=state.preflight,allowed=report?.allowedActions||{},key=actionKey(state.conflictAction);
      if(!submissionPayload&&(!report?.valid||!allowed[key]))return Promise.resolve(fail((report?.errors||[])[0]?.message||'当前预检结果不能按所选策略导入。'));
      state={...state,busy:true,error:'',success:null};emit();
      submitPromise=(async()=>{
        try{
          if(!submissionPayload)submissionPayload={
            fileName:state.fileName,
            package:clone(state.packageData),
            preflightHash:String(report.payloadHash||''),
            conflictAction:state.conflictAction,
            ...(state.conflictAction==='replace_draft'?{expectedRevision:report.paperConflict?.revision}:{}),
            idempotencyKey:submissionKey||(submissionKey=String(options.idempotencyKey?.()||`paper-import-${global.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2)}`)),
          };
          const result=await api.importPaper(clone(submissionPayload));
          state={...state,error:'',success:clone(result)};
          await options.onReload?.(result);
          state={...state,busy:false};emit();
          return {ok:true,result:clone(result)};
        }catch(error){
          // These responses guarantee no import was committed; a new preflight may repair it.
          if(['REVISION_CONFLICT','PREFLIGHT_STALE','PAPER_IMPORT_INVALID','PAPER_IMPORT_ACTION_NOT_ALLOWED','PUBLISHED_PAPER_REPLACE_FORBIDDEN','PAPER_NOT_FOUND'].includes(error?.code)){
            submissionPayload=null;submissionKey='';state={...state,preflight:null};
          }
          return fail(error?.message||error);
        }
        finally{submitPromise=null}
      })();
      return submitPromise;
    }
    function cancel(){if(state.busy||submitPromise||preflightPromise)return clone(state);submissionKey='';submissionPayload=null;state={fileName:'',packageData:null,preflight:null,conflictAction:'create',busy:false,error:'',success:null};emit();return clone(state)}
    return Object.freeze({snapshot,load,preflight,retry:()=>submissionPayload?confirm():preflight(),setConflictAction,confirm,cancel});
  }
  root.PaperManagement.PaperImportController=Object.freeze({create});
})(globalThis);
