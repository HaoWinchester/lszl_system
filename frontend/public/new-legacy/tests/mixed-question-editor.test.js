'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const context={console};context.globalThis=context;context.window=context;context.KGTeacherDomains={Core:{clone:v=>JSON.parse(JSON.stringify(v)),result:(ok,value,errors=[],warnings=[])=>({ok,value,errors,warnings})}};vm.createContext(context);
for(const name of ['117-question-answer-set.js','118-question-materials.js','teacher/paper-management/paper-question-picker.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),context);
const P=context.KGTeacherDomains.PaperManagement.PaperQuestionPicker,A=context.KGQuestionAnswerSet;
const rows=[{id:'a',type:'single_choice'},{id:'b',type:'single_choice',caseGroup:{id:'case',order:1,total:3}},{id:'c',type:'single_choice',caseGroup:{id:'case',order:2,total:3}},{id:'d',type:'multiple_choice',caseGroup:{id:'case',order:3,total:3}},{id:'e',type:'matching'}];
const refs=rows.map(q=>({bankId:'bank',questionId:q.id}));
const picker=P.create({lookup:ref=>rows.find(q=>q.id===ref.questionId),groupMembers:()=>refs.slice(1,4)});
test('selecting any case child inserts all siblings once and removal is atomic',()=>{const paper={questions:[]};assert.equal(picker.add(paper,[refs[0],refs[2],refs[1],refs[4]]).ok,true);assert.equal(paper.questions.map(r=>r.questionId).join(','),'a,b,c,d,e');assert.equal(picker.remove(paper,['bank::c']).value.removed,3);assert.equal(paper.questions.map(r=>r.questionId).join(','),'a,e');});
test('moving a case child moves the entire ordered group',()=>{const paper={questions:JSON.parse(JSON.stringify(refs))};assert.equal(picker.moveGroup(paper,'bank::c',1).ok,true);assert.equal(paper.questions.map(r=>r.questionId).join(','),'a,e,b,c,d');assert.equal(paper.questions.map(r=>r.order).join(','),'1,2,3,4,5');});
test('incomplete case is rejected before mutating paper',()=>{const p=P.create({lookup:ref=>rows.find(q=>q.id===ref.questionId),groupMembers:()=>refs.slice(1,3)}),paper={questions:[]};assert.equal(p.add(paper,[refs[2]]).ok,false);assert.equal(paper.questions.length,0);});
test('mixed compatibility accepts three answer kinds without changing specialist paper rules',()=>{for(const q of rows)assert.equal(P.accepts('mixed',q),true);assert.equal(P.accepts('multiple_choice',rows[4]),false);assert.equal(P.accepts('standard',rows[3]),false);assert.equal(P.accepts('standard',rows[4]),false);assert.equal(P.accepts('mixed',{type:'unknown'}),false);});
test('media, material revisions and matching maps participate in content signatures',()=>{const q={type:'matching',matching:{correctPairs:{l1:'r1'}}};assert.notEqual(JSON.stringify(A.contentExtension(q)),JSON.stringify(A.contentExtension({...q,matching:{correctPairs:{l1:'r2'}}})));assert.notEqual(JSON.stringify(A.contentExtension({material:{id:'m',revision:1}})),JSON.stringify(A.contentExtension({material:{id:'m',revision:2}})));});
test('material text is escaped and arbitrary external assets are not rendered',()=>{const html=context.KGQuestionMaterials.renderMaterials({material:{id:'m',title:'<script>',text:'<img onerror=alert(1)>',images:[]},images:[{url:'javascript:alert(1)'}]});assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<img'));assert.equal(context.KGQuestionMaterials.safeUrl('/api/v1/question-assets/a-b'),'/api/v1/question-assets/a-b');});

test('Content Prep accepts complete matching without A/B/C/D options',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../content-prep-studio/src/js/20-page-runtime.js'),'utf8');
 const validator=source.slice(source.indexOf('function validateQuestion('),source.indexOf('function renderCurrentIssues('));
 const q={id:'q',title:'匹配题',type:'matching',stemParts:[{text:'配对'}],options:[],analysis:'解析',clues:[],metadata:{},matching:{left:[{id:'l1',text:'一'},{id:'l2',text:'二'}],right:[{id:'r1',text:'甲'},{id:'r2',text:'乙'}],correctPairs:{l1:'r2',l2:'r1'}}};
 const env={q,globalThis:context,state:{},questionStem:()=> '配对',englishStem:()=>''};vm.createContext(env);vm.runInContext(validator+';var issues=validateQuestion(q,false)',env);
 assert.equal(env.issues.some(issue=>['options','correctAnswer','matching'].includes(issue.field)),false);
});
