'use strict';
(function(global){
  const root=global.KGTeacherDomains=global.KGTeacherDomains||{};
  root.PaperManagement=root.PaperManagement||{};
  const clone=value=>{if(value===undefined)return undefined;try{return JSON.parse(JSON.stringify(value))}catch(error){return value}};
  const actionKey=action=>action==='replace_draft'?'replaceDraft':action;
  function create(options={}){
    const api=options.api||global.KGPaperDraftApi;
    let state={fileName:'',packageData:null,preflight:null,conflictAction:'create',busy:false,error:'',success:null};
    let submitPromise=null;
    const emit=()=>{const value=clone(state);options.onChange?.(value);return value};
    const fail=message=>{state={...state,busy:false,error:String(message||'导入失败。'),success:null};emit();return {ok:false,error:state.error}};
    async function preflight(){
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
      let packageData;
      try{packageData=JSON.parse(String(jsonText||'').replace(/^\ufeff/,''))}
      catch(error){state={...state,fileName:String(fileName||''),packageData:null,preflight:null};return fail(`JSON 解析失败：${error?.message||error}`)}
      state={...state,fileName:String(fileName||'paper.json'),packageData:clone(packageData),preflight:null,error:'',success:null};emit();
      return preflight();
    }
    function setConflictAction(action){state={...state,conflictAction:String(action||'create')};emit();return clone(state)}
    function confirm(){
      if(submitPromise)return submitPromise;
      const report=state.preflight,allowed=report?.allowedActions||{},key=actionKey(state.conflictAction);
      if(!report?.valid||!allowed[key])return Promise.resolve(fail((report?.errors||[])[0]?.message||'当前预检结果不能按所选策略导入。'));
      state={...state,busy:true,error:'',success:null};emit();
      submitPromise=(async()=>{
        try{
          const result=await api.importPaper({
            fileName:state.fileName,
            package:clone(state.packageData),
            preflightHash:String(report.payloadHash||''),
            conflictAction:state.conflictAction,
            ...(state.conflictAction==='replace_draft'?{expectedRevision:report.paperConflict?.revision}:{}),
            idempotencyKey:String(options.idempotencyKey?.()||`paper-import-${Date.now()}`),
          });
          state={...state,busy:false,error:'',success:clone(result)};emit();
          await options.onReload?.(result);
          return {ok:true,result:clone(result)};
        }catch(error){return fail(error?.message||error)}
        finally{submitPromise=null}
      })();
      return submitPromise;
    }
    function cancel(){submitPromise=null;state={fileName:'',packageData:null,preflight:null,conflictAction:'create',busy:false,error:'',success:null};emit();return clone(state)}
    return Object.freeze({snapshot:()=>clone(state),load,preflight,retry:preflight,setConflictAction,confirm,cancel});
  }
  root.PaperManagement.PaperImportController=Object.freeze({create});
})(globalThis);
