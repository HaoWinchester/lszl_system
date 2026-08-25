'use strict';
(function(global){
  const root=global.KGTeacherDomains=global.KGTeacherDomains||{};
  const clone=value=>{if(value===undefined)return undefined;try{return JSON.parse(JSON.stringify(value))}catch(error){return value}};
  const bankLike=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&String(value.id||value.sourceId||'').trim()&&String(value.name||'').trim()&&Array.isArray(value.questions);
  function classify(payload){
    if(payload&&typeof payload==='object'&&!Array.isArray(payload)&&payload.schema==='kg-paper-package-v1'&&payload.paper&&typeof payload.paper==='object')return 'paper-package';
    if(bankLike(payload))return 'question-bank';
    if(Array.isArray(payload)&&payload.length>0&&payload.every(bankLike))return 'question-bank';
    if(payload&&typeof payload==='object'&&Array.isArray(payload.banks)&&payload.banks.length>0&&payload.banks.every(bankLike))return 'question-bank';
    return 'unknown';
  }
  function normalizeBanks(payload){
    if(classify(payload)!=='question-bank')return [];
    const banks=Array.isArray(payload)?payload:(Array.isArray(payload?.banks)?payload.banks:[payload]);
    return clone(banks);
  }
  function importPlan(error){return clone(error?.detail?.detail?.importPlan||error?.detail?.importPlan||error?.importPlan||{})}
  function replacementMessage(plan={}){
    const rows=Array.isArray(plan?.summaries)?plan.summaries:[];
    const details=rows.map(row=>`${row?.bankName||row?.bankId||'未命名题库'}：新增 ${Number(row?.addedQuestions||0)} 题，更新 ${Number(row?.modifiedQuestions||0)} 题，移除 ${Number(row?.removedQuestions||0)} 题`).join('\n');
    return `检测到同一来源题库的内容更新。${details?`\n${details}`:''}\n确认覆盖这些变更吗？`;
  }
  function duplicateMessage(plan={}){return `检测到重复题目：已有重复 ${Number(plan?.duplicateExistingCount||0)} 道，本批重复 ${Number(plan?.duplicateBatchCount||0)} 道。是否自动清除重复题目后继续导入？`}
  function create(options={}){
    const api=options.api||global.KGQuestionCatalog;
    const initialState=()=>({fileName:'',fileNames:[],fileCount:0,packageData:null,banks:[],bankCount:0,questionCount:0,busy:false,error:'',success:null});
    let state=initialState();
    let submitPromise=null;
    const emit=()=>{const snapshot=clone(state);options.onChange?.(snapshot);return snapshot};
    const fail=message=>{state={...state,busy:false,error:String(message||'导入题库失败。'),success:null};emit();return {ok:false,error:state.error}};
    function parseFile(file){
      const name=String(file?.name||'question-bank.json');
      let payload;
      try{payload=JSON.parse(String(file?.text||'').replace(/^\ufeff/,''))}
      catch(error){throw new Error(`${name}：JSON 解析失败：${error?.message||error}`)}
      const kind=classify(payload);
      if(kind==='paper-package')throw new Error(`${name}：检测到试卷包 JSON，请使用“导入试卷”。`);
      if(kind!=='question-bank')throw new Error(`${name}：不支持的题库 JSON：需要单个题库、题库数组或包含 banks 数组的数据包。`);
      return {name,payload,banks:normalizeBanks(payload)};
    }
    async function loadFiles(files){
      const entries=Array.from(files||[]),fileNames=entries.map(file=>String(file?.name||'question-bank.json'));
      if(!entries.length){state=initialState();return fail('请至少选择一个题库 JSON 文件。')}
      try{
        const parsed=entries.map(parseFile),banks=parsed.flatMap(item=>item.banks);
        state={fileName:fileNames.join('、'),fileNames,fileCount:fileNames.length,packageData:clone(parsed.map(item=>item.payload)),banks,bankCount:banks.length,questionCount:banks.reduce((total,bank)=>total+(Array.isArray(bank.questions)?bank.questions.length:0),0),busy:false,error:'',success:null};
        emit();return {ok:true,banks:clone(banks)};
      }catch(error){state={...initialState(),fileName:fileNames.join('、'),fileNames,fileCount:fileNames.length};return fail(error?.message||error)}
    }
    async function load(fileName,jsonText){return loadFiles([{name:fileName,text:jsonText}])}
    async function ask(kind,plan){
      const message=kind==='replace'?replacementMessage(plan):duplicateMessage(plan);
      const confirm=options.confirm||global.confirm;
      if(typeof confirm!=='function')return false;
      return (await Promise.resolve(confirm({kind,message,plan:clone(plan)})))===true;
    }
    async function submit(confirmReplace=false,confirmDuplicateCleanup=false){
      try{return await api.importBanks({banks:clone(state.banks),confirmReplace,confirmDuplicateCleanup})}
      catch(error){
        if(error?.code==='IMPORT_REPLACEMENT_CONFIRMATION_REQUIRED'&&!confirmReplace){
          if(!await ask('replace',importPlan(error)))throw Object.assign(new Error('已取消覆盖导入。'),{cancelled:true});
          return submit(true,confirmDuplicateCleanup);
        }
        if(error?.code==='QUESTION_DUPLICATES_CONFIRMATION_REQUIRED'&&!confirmDuplicateCleanup){
          if(!await ask('duplicates',importPlan(error)))throw Object.assign(new Error('已取消重复题清理。'),{cancelled:true});
          return submit(confirmReplace,true);
        }
        throw error;
      }
    }
    function confirm(){
      if(submitPromise)return submitPromise;
      if(!state.banks.length)return Promise.resolve(fail('请先选择有效的题库 JSON 文件。'));
      state={...state,busy:true,error:'',success:null};emit();
      submitPromise=(async()=>{
        try{
          const result=await submit();
          state={...state,busy:false,error:'',success:clone(result)};emit();
          await options.onReload?.(result);
          return {ok:true,result:clone(result)};
        }catch(error){return fail(error?.message||error)}
        finally{submitPromise=null}
      })();
      return submitPromise;
    }
    function cancel(){submitPromise=null;state=initialState();emit();return clone(state)}
    return Object.freeze({snapshot:()=>clone(state),load,loadFiles,confirm,retry:confirm,cancel});
  }
  root.QuestionBankImportController=Object.freeze({classify,normalizeBanks,create});
})(globalThis);
