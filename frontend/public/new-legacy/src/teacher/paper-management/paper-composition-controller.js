'use strict';
(function(global){
  const root=global.KGTeacherDomains=global.KGTeacherDomains||{};
  root.PaperManagement=root.PaperManagement||{};
  const clone=value=>{if(value===undefined)return undefined;try{return JSON.parse(JSON.stringify(value))}catch(error){return value}};
  const defaultVariants=()=>[
    {code:'A',name:'PMP 模拟卷 A',totalCount:60,enabled:true},
    {code:'B',name:'PMP 模拟卷 B',totalCount:60,enabled:true},
    {code:'C',name:'PMP 模拟卷 C',totalCount:60,enabled:true},
  ];
  function create(options={}){
    const api=options.api||global.KGPaperDraftApi;
    let state={mode:'quick',subject:'PMP',bankIds:[],filters:{},variants:defaultVariants(),hardWeights:{people:42,process:50,'business-environment':8},softWeights:{governance:1,scope:1,schedule:1,finance:1,stakeholder:1,resource:1,risk:1},randomSeed:'',preflight:null,busy:false,error:'',success:null};
    let submitPromise=null;
    const emit=()=>{const value=clone(state);options.onChange?.(value);return value};
    const fail=message=>{state={...state,busy:false,error:String(message||'组卷失败。'),success:null};emit();return {ok:false,error:state.error}};
    function setMode(mode){state={...state,mode:mode==='custom'?'custom':'quick',preflight:null,error:''};emit();return clone(state)}
    function setBankIds(bankIds){state={...state,bankIds:[...new Set((bankIds||[]).map(String).filter(Boolean))],preflight:null,error:''};emit();return clone(state)}
    function setVariant(code,patch={}){state={...state,variants:state.variants.map(item=>item.code===String(code)?{...item,...clone(patch),code:item.code}:item),preflight:null,error:''};emit();return clone(state)}
    function setHardWeights(weights){state={...state,hardWeights:{...state.hardWeights,...clone(weights)},preflight:null,error:''};emit();return clone(state)}
    function setSoftWeights(weights){state={...state,softWeights:{...state.softWeights,...clone(weights)},preflight:null,error:''};emit();return clone(state)}
    function setFilters(filters){state={...state,filters:clone(filters)||{},preflight:null,error:''};emit();return clone(state)}
    function requestBody(){
      const variants=state.variants.filter(item=>item.enabled).map(item=>({code:item.code,name:String(item.name||`${item.code} 卷`),totalCount:Math.max(1,Number(item.totalCount)||1)}));
      const body={subject:state.subject,bankIds:clone(state.bankIds),filters:clone(state.filters),variants,hardQuota:{dimensionId:'exam-domain',weights:clone(state.hardWeights)}};
      if(Object.values(state.softWeights||{}).some(value=>Number(value)>0))body.softQuota={dimensionId:'performance-domain',weights:clone(state.softWeights)};
      if(state.randomSeed)body.randomSeed=state.randomSeed;
      return body;
    }
    async function preflight(){
      const body=requestBody();
      if(!body.bankIds.length)return fail('请至少选择一个候选题库。');
      if(!body.variants.length)return fail('请至少启用一套试卷。');
      state={...state,busy:true,error:'',success:null};emit();
      try{
        const result=await api.compositionPreflight(body);
        state={...state,busy:false,preflight:clone(result),randomSeed:String(result?.normalizedRequest?.randomSeed||state.randomSeed),error:''};emit();
        return {ok:true,preflight:clone(result)};
      }catch(error){return fail(error?.message||error)}
    }
    async function repreflightFeasible(){
      const codes=new Set(state.preflight?.feasibleVariantCodes||[]);
      if(!codes.size)return fail('当前没有可单独生成的试卷，请调整题量或题库后重试。');
      state={...state,variants:state.variants.map(item=>({...item,enabled:codes.has(item.code)})),preflight:null,error:''};emit();
      return preflight();
    }
    function confirm(){
      if(submitPromise)return submitPromise;
      const report=state.preflight;
      if(!report?.feasible||!report?.planHash)return Promise.resolve(fail('请先完成全部可行的预检，再确认生成。'));
      state={...state,busy:true,error:'',success:null};emit();
      submitPromise=(async()=>{
        try{
          const request=clone(report.normalizedRequest||requestBody());
          const result=await api.createCompositionBatch({...request,planHash:String(report.planHash),idempotencyKey:String(options.idempotencyKey?.()||`paper-batch-${Date.now()}`)});
          state={...state,busy:false,error:'',success:clone(result)};emit();await options.onReload?.(result);return {ok:true,result:clone(result)};
        }catch(error){
          const message=error?.status>=500?`创建失败，所选试卷已全部回滚，未保留任何一套：${error?.message||error}`:(error?.message||error);
          return fail(message);
        }finally{submitPromise=null}
      })();
      return submitPromise;
    }
    function cancel(){submitPromise=null;state={...state,preflight:null,busy:false,error:'',success:null};emit();return clone(state)}
    return Object.freeze({snapshot:()=>clone(state),setMode,setBankIds,setVariant,setHardWeights,setSoftWeights,setFilters,preflight,retry:preflight,repreflightFeasible,confirm,cancel});
  }
  root.PaperManagement.PaperCompositionController=Object.freeze({create});
})(globalThis);
