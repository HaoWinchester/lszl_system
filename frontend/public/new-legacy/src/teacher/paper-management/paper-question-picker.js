'use strict';
(function(global){
 const root=global.KGTeacherDomains=global.KGTeacherDomains||{},Core=root.Core;
 const key=ref=>`${ref.bankId}::${ref.questionId}`;
 function accepts(type,question){return type==='mixed'?['single_choice','multiple_choice','matching'].includes(question?.type||'single_choice'):type==='multiple_choice'?question?.type==='multiple_choice':!['multiple_choice','matching'].includes(question?.type);}
 function create(options={}){
  const lookup=ref=>options.lookup?.(ref)?.question||options.lookup?.(ref)||{};
  const group=ref=>{const q=lookup(ref);return q.caseGroup?.id||q.metadata?.caseGroup?.id||'';};
  function units(refs){const result=[],groups=new Map();for(const ref of refs||[]){const id=group(ref);if(id&&groups.has(id)){groups.get(id).push(ref);}else{const unit=[ref];result.push(unit);if(id)groups.set(id,unit);}}return result;}
  function resequence(paper){paper.questions=paper.questions.map((ref,index)=>({...ref,order:index+1}));paper.updatedAt=Date.now();}
  function add(paper,refs){
   const expanded=[];
   for(const ref of refs||[]){const g=group(ref);if(g){const members=options.groupMembers?.(g,ref.bankId)||[];const expected=lookup(ref).caseGroup?.total||lookup(ref).metadata?.caseGroup?.total;if(members.length!==expected)return Core.result(false,null,['案例小题尚未齐全，请补齐后加入试卷。']);expanded.push(...members);}else expanded.push(ref);}
   const existing=new Set((paper.questions||[]).map(key)),added=[],duplicates=[];paper.questions=paper.questions||[];
   for(const ref of expanded){if(existing.has(key(ref))){duplicates.push(ref);continue;}existing.add(key(ref));paper.questions.push({...Core.clone(ref),score:Number(ref.score??1)});added.push(ref);}
   resequence(paper);return Core.result(true,{paper,added,duplicates},[],duplicates.length?[`跳过 ${duplicates.length} 道重复题。`]:[]);
  }
  function remove(paper,keys){const selected=new Set(keys||[]),groups=new Set((paper.questions||[]).filter(ref=>selected.has(key(ref))).map(group).filter(Boolean)),before=paper.questions.length;paper.questions=paper.questions.filter(ref=>!selected.has(key(ref))&&!groups.has(group(ref)));resequence(paper);return Core.result(true,{paper,removed:before-paper.questions.length});}
  function moveGroup(paper,refKey,delta){const all=units(paper.questions),index=all.findIndex(unit=>unit.some(ref=>key(ref)===refKey)),target=index+Math.sign(delta);if(index<0||target<0||target>=all.length)return Core.result(false,null,['已到试卷边界。']);[all[index],all[target]]=[all[target],all[index]];paper.questions=all.flat();resequence(paper);return Core.result(true,{paper});}
  return Object.freeze({add,remove,moveGroup,units});
 }
 root.PaperManagement=root.PaperManagement||{};root.PaperManagement.PaperQuestionPicker=Object.freeze({create,accepts});
})(globalThis);
