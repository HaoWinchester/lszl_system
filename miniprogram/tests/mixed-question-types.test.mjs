import assert from 'node:assert/strict';
import test from 'node:test';
import {createPracticeRun} from '../domain/pc-practice.ts';
const q={id:'q',type:'matching',options:[],matching:{left:[{id:'l1',text:'一'},{id:'l2',text:'二'}],right:[{id:'r1',text:'甲'},{id:'r2',text:'乙'}],correctPairs:{l1:'r2',l2:'r1'}}};
const session={mode:'practice',questions:[{questionId:'q',question:q}],answers:{},runtimeState:{}};
test('mini matching rejects incomplete, duplicate and foreign answers',()=>{for(const map of [{l1:'r1'},{l1:'r1',l2:'r1'},{l1:'bad',l2:'r1'}])assert.equal(createPracticeRun(session).select('q',map),false);});
test('mini matching freezes mapping and restores without re-awarding points',()=>{const r=createPracticeRun(session);assert.equal(r.select('q',{l1:'r2',l2:'r1'}),true);assert.equal(r.answer('q').correct,true);assert.deepEqual(r.submission().q,{selectedPairs:{l1:'r2',l2:'r1'},selectionIndex:1});const s=createPracticeRun(session,{lockedAnswers:r.submission(),runtimeState:r.runtime()});assert.equal(s.runtime().experience,10);assert.equal(s.select('q',{l1:'r1',l2:'r2'}),false);});
test('mini pending pairs round-trip through runtime and timeout never scores',()=>{const r=createPracticeRun({...session,mode:'scholar'});r.patchRuntime({pendingMatches:{q:{l1:'r2'}}});assert.deepEqual(r.runtime().pendingMatches,{q:{l1:'r2'}});assert.equal(r.select('q',{},true),true);assert.equal(r.answer('q').correct,false);assert.deepEqual(r.submission().q.selectedPairs,{});});
test('mini unknown type cannot be silently answered as single-choice',()=>{const r=createPracticeRun({...session,questions:[{questionId:'q',question:{...q,type:'unknown',options:[{id:'A'}]}}]});assert.equal(r.select('q',['A']),false);});

test('resumed matching remediation retains pair labels and the material snapshot',async()=>{
 const {loadPage,loadModule}=await import('./helpers/page-harness.mjs');
 const {sanitizeRichText}=await import('../domain/rich-text.ts');
 const {normalizeQuestion}=await loadModule('domain/question.ts',{sanitizeRichText},['normalizeQuestion']);
 const {pairLabel}=await import('../domain/pc-practice.ts');
 const question={...q,material:{id:'m',title:'案例',text:'共同材料',revision:1,images:[]}};
 const mistake={id:'m1',status:'needs_remediation',questionSnapshot:question,selectedPairs:{l1:'r1',l2:'r2'},selectedAnswers:[{selectedPairs:{l1:'r1',l2:'r2'}}]};
 const {page}=await loadPage('revenge',{getOverview:async()=>({revengeCandidates:[mistake]}),getRevengeSummary:async()=>({candidates:[mistake],stats:{}}),getRemediation:async()=>mistake,normalizeQuestion,pairLabel,messageOf:error=>error.message});
 await page.loadQueue();
 assert.equal(page.data.stage,'remediation');assert.deepEqual(page.data.selectedPairs,mistake.selectedPairs);assert.ok(page.data.previousAnswer.includes('甲'));assert.ok(!page.data.previousAnswer.includes('[object Object]'));assert.equal(page.data.question.material.text,'共同材料');
});
