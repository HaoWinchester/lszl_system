/* 同批题目补录 / 按 Question ID 合并（自单机版 P4.5.29 移植，格式契约 pmp-question-supplement-v1）。
 * 合并核心与单机版逐行一致（常量/数组键/合并策略/保护字段），保证两版产出的模板与合并报告互通。
 * 只匹配当前工作区已存在的 Question ID；未匹配跳过不新建；题干/选项/答案等锁定字段永远保留本机值。 */
'use strict';

const SUPPLEMENT_PROTECTED_PREFIXES=Object.freeze([
  'id','questionId','title','type','subject','stemParts','options','correctAnswer','contentHash','lifecycle','status',
  'metadata.origin','metadata.idSystem','metadata.lastImport','metadata.lastSupplementImport','metadata.supplementHistory',
  'metadata.questionFamily.familyId','metadata.questionFamily.rootQuestionId','metadata.questionFamily.qualityConfirmed'
]);
const SUPPLEMENT_UNION_ARRAY_PATHS=new Set([
  'tags','metadata.stemPrincipleIds','metadata.principleIds','metadata.questionFamily.purposes',
  'metadata.optionPrincipleMap.A','metadata.optionPrincipleMap.B','metadata.optionPrincipleMap.C','metadata.optionPrincipleMap.D'
]);
function extractSupplementQuestions(payload){
  if(Array.isArray(payload))return payload;
  if(Array.isArray(payload?.questions))return payload.questions;
  if(Array.isArray(payload?.questionBank?.questions))return payload.questionBank.questions;
  if(Array.isArray(payload?.banks)&&Array.isArray(payload.banks[0]?.questions))return payload.banks[0].questions;
  throw new Error('补录文件未找到 questions 数组。支持：questions[]、questionBank.questions[]、banks[0].questions[] 或题目数组。');
}
function supplementIsEmpty(v){
  if(v===undefined||v===null)return true;
  if(typeof v==='string')return !v.trim();
  if(Array.isArray(v))return v.length===0;
  if(v&&typeof v==='object')return Object.keys(v).length===0;
  return false;
}
function stableAuditValue(value){
  if(Array.isArray(value))return value.map(stableAuditValue);
  if(value&&typeof value==='object'){const out={};Object.keys(value).sort().forEach(k=>out[k]=stableAuditValue(value[k]));return out}
  return value;
}
function supplementStableSignature(v){return JSON.stringify(stableAuditValue(v))}
function supplementSame(a,b){return supplementStableSignature(a)===supplementStableSignature(b)}
function supplementPathProtected(path){return SUPPLEMENT_PROTECTED_PREFIXES.some(prefix=>path===prefix||path.startsWith(prefix+'.'))}
function supplementArrayKey(path,item,index){
  if(!item||typeof item!=='object')return '';
  if(path==='clues')return String(item.id||'')||`${item.text||''}|${item.sourceType||''}|${item.sourceOptionId||''}`;
  if(path==='reasoningSteps')return String(item.id||'')||String(item.title||'');
  if(path==='translations.en.options')return String(item.id||'')||String(index);
  if(path==='translations.en.stemParts')return String(index);
  if(path==='metadata.subjectFacets')return String(item.facetId||item.id||'')||supplementStableSignature(item);
  return '';
}
function supplementMark(set,path){if(path)set.add(path)}
function mergeSupplementValue(local,incoming,path,strategy,stat){
  if(incoming===undefined)return clone(local);
  if(supplementPathProtected(path)){
    if(!supplementIsEmpty(incoming)&&!supplementSame(local,incoming))supplementMark(stat.protected,path);
    return clone(local);
  }
  if(supplementIsEmpty(incoming))return clone(local);

  if(Array.isArray(incoming)){
    const current=Array.isArray(local)?clone(local):[];
    if(strategy==='overwrite'){
      if(!supplementSame(current,incoming)){supplementMark(stat.changed,path);return clone(incoming)}
      return current;
    }
    if(!current.length){supplementMark(stat.changed,path);return clone(incoming)}
    if(SUPPLEMENT_UNION_ARRAY_PATHS.has(path)){
      const out=clone(current),seen=new Set(out.map(supplementStableSignature));let changed=false;
      incoming.forEach(item=>{const sig=supplementStableSignature(item);if(!seen.has(sig)){seen.add(sig);out.push(clone(item));changed=true}});
      if(changed)supplementMark(stat.changed,path);
      return out;
    }
    if(['clues','reasoningSteps','translations.en.options','translations.en.stemParts','metadata.subjectFacets'].includes(path)){
      const out=clone(current);let changed=false;
      incoming.forEach((item,idx)=>{
        const key=supplementArrayKey(path,item,idx);
        const pos=key?out.findIndex((row,j)=>supplementArrayKey(path,row,j)===key):-1;
        if(pos<0){out.push(clone(item));changed=true;return}
        if(item&&typeof item==='object'&&!Array.isArray(item)){
          const before=supplementStableSignature(out[pos]);
          out[pos]=mergeSupplementValue(out[pos],item,`${path}.${key}`,strategy,stat);
          if(before!==supplementStableSignature(out[pos]))changed=true;
        }else if(!supplementSame(out[pos],item))supplementMark(stat.conflicts,path);
      });
      if(changed)supplementMark(stat.changed,path);
      return out;
    }
    if(!supplementSame(current,incoming))supplementMark(stat.conflicts,path);
    return current;
  }

  if(incoming&&typeof incoming==='object'){
    const out=local&&typeof local==='object'&&!Array.isArray(local)?clone(local):{};
    Object.keys(incoming).forEach(key=>{
      const childPath=path?`${path}.${key}`:key;
      out[key]=mergeSupplementValue(out[key],incoming[key],childPath,strategy,stat);
    });
    return out;
  }

  if(strategy==='overwrite'){
    if(!supplementSame(local,incoming)){supplementMark(stat.changed,path);return clone(incoming)}
    return clone(local);
  }
  if(supplementIsEmpty(local)){supplementMark(stat.changed,path);return clone(incoming)}
  if(!supplementSame(local,incoming))supplementMark(stat.conflicts,path);
  return clone(local);
}
function refreshQuestionReadiness(q){
  q.status=q.status||{};
  const primary=q.metadata?.knowledge?.primaryNodeId||'';
  q.status.contentReady=!!(questionStem(q)&&q.options.every(o=>String(o.text||'').trim())&&String(q.analysis||q.explanation||'').trim());
  q.status.keywordsReady=!!(q.clues.length&&q.clues.every(c=>(c.matchLocations||[]).length&&(c.keywordLevel!=='core'||(c.solutionRole&&c.solutionRole!=='context'&&String(c.coreReason||'').trim()))));
  q.status.knowledgeReady=!!primary;
  q.status.reasoningReady=!!(q.reasoningSteps||[]).length;
}
function questionSupplementTemplatePayload(){
  return {
    schemaVersion:1,format:'pmp-question-supplement-v1',generatedAt:nowIso(),
    generatedBy:{prepStudioTargetVersion:VERSION},
    sourceQuestionBank:{id:state.questionBank.id||'',name:state.questionBank.name||'',questionCount:state.questionBank.questions.length},
    mergeContract:{
      matchKey:'Question ID (question.id)',unmatchedPolicy:'skip-no-create',
      protectedFields:['id','title','type','subject','stemParts','options','correctAnswer','metadata.origin','metadata.idSystem','lifecycle','status','metadata.questionFamily.familyId','metadata.questionFamily.rootQuestionId','metadata.questionFamily.qualityConfirmed'],
      recommendedMode:'fill-empty'
    },
    questions:state.questionBank.questions.map(q=>({
      id:q.id,title:q.title,stemParts:clone(q.stemParts||[]),options:clone(q.options||[]),correctAnswer:q.correctAnswer,
      difficulty:q.difficulty||'',domain:q.domain||'',topic:q.topic||'',stage:q.stage||'',tags:clone(q.tags||[]),
      analysis:q.analysis||q.explanation||'',translations:{en:clone(q.translations?.en||{})},
      clues:clone(q.clues||[]),reasoningSteps:clone(q.reasoningSteps||[]),keyPath:clone(q.keyPath||{}),
      metadata:{
        knowledge:clone(q.metadata?.knowledge||{}),stemPrincipleIds:clone(q.metadata?.stemPrincipleIds||[]),
        principleIds:clone(q.metadata?.principleIds||[]),optionPrincipleMap:clone(q.metadata?.optionPrincipleMap||{}),
        subjectFacets:clone(q.metadata?.subjectFacets||[]),
        questionFamily:q.metadata?.questionFamily?{
          role:q.metadata.questionFamily.role||'',relationToRoot:q.metadata.questionFamily.relationToRoot||'',
          variantType:q.metadata.questionFamily.variantType||'',equivalenceGrade:q.metadata.questionFamily.equivalenceGrade||'',
          diagnosticTarget:q.metadata.questionFamily.diagnosticTarget||'',difficultyLevel:q.metadata.questionFamily.difficultyLevel||'',
          purposes:clone(q.metadata.questionFamily.purposes||[]),notes:q.metadata.questionFamily.notes||''
        }:{}
      }
    }))
  };
}
function renderQuestionSupplementReport(report){
  const status=document.getElementById('questionSupplementStatus'),box=document.getElementById('questionSupplementReport');if(!status||!box)return;
  if(!report){status.textContent='';status.className='supplement-status';box.innerHTML='';return}
  status.className='supplement-status '+((report.unmatched||report.invalid||report.protectedConflictFields)?'warn':'ok');
  status.textContent=`已匹配 ${report.matched}/${report.incoming} · 实际更新 ${report.changedQuestions} 题 · 未匹配 ${report.unmatched} · 无效 ${report.invalid} · 冲突字段 ${report.conflictFields} · 保护字段拦截 ${report.protectedConflictFields}`;
  const rows=report.rows||[];
  box.innerHTML=`<details class="supplement-report"${(report.unmatched||report.invalid||report.conflictFields||report.protectedConflictFields)?' open':''}>
    <summary>查看补录合并明细</summary>
    ${rows.slice(0,100).map(r=>`<div class="supplement-report-row"><b>${esc(r.id||`第 ${r.index+1} 条`)}</b> · ${esc(r.status)}
      ${r.title?` · ${esc(r.title)}`:''}
      ${r.changed?.length?`<br>更新：${esc(r.changed.join('、'))}`:''}
      ${r.conflicts?.length?`<br>保留本机：${esc(r.conflicts.join('、'))}`:''}
      ${r.protected?.length?`<br>保护拦截：${esc(r.protected.join('、'))}`:''}
    </div>`).join('')}
    ${rows.length>100?`<div class="muted tiny">仅显示前 100 条；总计 ${rows.length} 条。</div>`:''}
  </details>`;
}
async function mergeQuestionSupplement(payload,strategy='fill-empty',options={}){
  if(!['fill-empty','overwrite'].includes(strategy))throw new Error('不支持的补录合并策略。');
  const incoming=extractSupplementQuestions(payload);
  if(!state.questionBank?.questions?.length)throw new Error('当前工作区没有题目，无法执行“按 Question ID 合并”。请先导入基础题库。');
  const sourceFileName=String(options.sourceFileName||'question-supplement.json');
  const sourcePayloadHash='sha256:'+sha256Hex(JSON.stringify(payload));
  const identity=currentIdentitySnapshot(),batchId=generateBatchId(),mergeId=generateSystemId('supplement');
  const localById=new Map(state.questionBank.questions.map((q,index)=>[String(q.id),{q,index}]));
  const report={format:'pmp-question-supplement-merge-report-v1',at:nowIso(),mergeId,batchId,strategy,sourceFileName,sourcePayloadHash,incoming:incoming.length,matched:0,changedQuestions:0,unmatched:0,invalid:0,conflictFields:0,protectedConflictFields:0,rows:[]};
  incoming.forEach((raw,index)=>{
    const id=String(raw?.id||'').trim();
    if(!id){report.invalid++;report.rows.push({index,id:'',title:String(raw?.title||''),status:'无效（缺少 Question ID）',changed:[],conflicts:[],protected:[]});return}
    const found=localById.get(id);
    if(!found){report.unmatched++;report.rows.push({index,id,title:String(raw?.title||''),status:'未匹配（不新建）',changed:[],conflicts:[],protected:[]});return}
    const local=found.q;report.matched++;
    const stat={changed:new Set(),conflicts:new Set(),protected:new Set()};
    let merged=mergeSupplementValue(local,raw,'',strategy,stat);

    merged.id=local.id;merged.title=local.title;merged.type=local.type;merged.subject=local.subject;
    merged.stemParts=clone(local.stemParts);merged.options=clone(local.options);merged.correctAnswer=clone(local.correctAnswer);
    merged.lifecycle=clone(local.lifecycle);merged.status=clone(local.status);
    merged.metadata=merged.metadata||{};
    if(local.metadata?.origin)merged.metadata.origin=clone(local.metadata.origin);else delete merged.metadata.origin;
    if(local.metadata?.idSystem)merged.metadata.idSystem=clone(local.metadata.idSystem);
    if(local.metadata?.lastImport)merged.metadata.lastImport=clone(local.metadata.lastImport);
    const localFamily=local.metadata?.questionFamily||{},mf=merged.metadata?.questionFamily||{};
    ['familyId','rootQuestionId','qualityConfirmed'].forEach(k=>{if(k in localFamily)mf[k]=clone(localFamily[k])});
    merged.metadata.questionFamily=mf;

    const changed=[...stat.changed],conflicts=[...stat.conflicts],protectedPaths=[...stat.protected];
    report.conflictFields+=conflicts.length;report.protectedConflictFields+=protectedPaths.length;

    if(changed.length){
      const supplementStamp={mergeId,batchId,source:'question-supplement-json',sourceFileName,sourcePayloadHash,strategy,importedAt:nowIso(),...identity};
      const history=Array.isArray(local.metadata?.supplementHistory)?clone(local.metadata.supplementHistory):[];
      history.push(supplementStamp);merged.metadata.supplementHistory=history.slice(-50);merged.metadata.lastSupplementImport=clone(supplementStamp);

      const normalized=normalizeQuestion(merged,found.index,state.questionBank.subject);
      recomputeKeywordLocations(normalized);syncQuestionPrinciples(normalized);
      normalized.tags=unique((normalized.tags||[]).map(canonicalTagName));normalized.metadata.tagPaths=normalized.tags.map(tagPathFor).filter(Boolean);
      normalized.contentHash=computeQuestionContentHash(normalized);refreshQuestionReadiness(normalized);
      state.questionBank.questions[found.index]=normalized;found.q=normalized;report.changedQuestions++;
      report.rows.push({index,id,title:normalized.title,status:'已更新',changed,conflicts,protected:protectedPaths});
    }else{
      report.rows.push({index,id,title:local.title,status:(conflicts.length||protectedPaths.length)?'已匹配但无可应用更新':'已匹配，无变化',changed:[],conflicts,protected:protectedPaths});
    }
  });

  if(report.changedQuestions){resolveQuestionFamilies();refreshQuestionTagPaths();refreshAll();markWorkspaceDirty()}
  state.lastSupplementMergeReport=report;renderQuestionSupplementReport(report);
  recordAuditEvent({
    eventType:'supplement-import',exportType:'question-supplement-merge',fileName:sourceFileName,
    payload:{mergeId,batchId,strategy,sourcePayloadHash,incoming:report.incoming,matched:report.matched,changedQuestions:report.changedQuestions,unmatched:report.unmatched,invalid:report.invalid,conflictFields:report.conflictFields,protectedConflictFields:report.protectedConflictFields},
    details:{mergeId,strategy,sourcePayloadHash,matched:report.matched,changedQuestions:report.changedQuestions,unmatched:report.unmatched,invalid:report.invalid,conflictFields:report.conflictFields,protectedConflictFields:report.protectedConflictFields}
  });
  return report;
}

document.addEventListener('DOMContentLoaded',()=>{
  const exportBtn=document.getElementById('btnExportSupplementTemplate');
  if(exportBtn)exportBtn.addEventListener('click',()=>{
    downloadJson(questionSupplementTemplatePayload(),`${safeName(state.questionBank.name||'PMP题库')}_Question_Supplement_Template.json`,{auditType:'question-supplement-template'});
  });
  const file=document.getElementById('fileQuestionSupplement');
  if(file)file.addEventListener('change',async e=>{
    const f=e.target.files&&e.target.files[0];
    if(!f)return;
    const mode=document.getElementById('questionSupplementMode')?.value||'fill-empty';
    try{
      const report=await mergeQuestionSupplement(await readJsonFile(f),mode,{sourceFileName:f.name});
      toast(`补录完成：更新 ${report.changedQuestions} / 匹配 ${report.matched}${report.unmatched?` · 跳过 ${report.unmatched}`:''}`);
    }catch(err){
      const status=document.getElementById('questionSupplementStatus');if(status){status.textContent='补录失败：'+err.message;status.className='supplement-status bad'}
      alert('补录失败：'+err.message);
    }finally{e.target.value=''}
  });
});
