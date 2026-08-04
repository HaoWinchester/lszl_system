
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');const assert=(v,m)=>{if(!v)throw new Error(m)};
const kr=read('knowledge-recall.html'),qw=read('question-workspace.html'),qt=read('question-training.html'),qb=read('question-bank.html'),cc=read('content-center.html'),subjects=read('admin-subjects.html');
assert(kr.includes('lp-topbar')&&qw.includes('lp-topbar')&&qt.includes('lp-topbar'),'three learning pages must share shell');
assert(kr.includes('id="krBankSelect"')&&kr.includes('data-kr-question-filter="explored"'),'recall drawer filters missing');
assert(kr.includes('kr-question-library-trigger'),'recall question library must be on canvas');
assert(qw.includes('<span>题目库</span><strong id="qwQuestionCount">0</strong>'),'workspace library label missing');
assert(qt.includes('data-question-language="bilingual"'),'single deep study language switch missing');
assert(!qb.includes('id="qbRecallNodeStudio"')&&!cc.includes('id="ccRecallLibraryPanel"')&&subjects.includes('id="adminRecallPanel"')&&subjects.includes('data-subject-tab="association"'),'subject recall library must be centralized in the subject administration tab');
const recallCore=read('src/95-recall-association-library.js');assert(recallCore.includes('titleEn')&&recallCore.includes('promptEn')&&recallCore.includes('hintEn'),'bilingual recall metadata support missing');
const store=new Map(),context={console,globalThis:null,localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},KGAuthCore:{currentUsername:()=>''}};context.globalThis=context;vm.createContext(context);vm.runInContext(read('src/95-recall-association-library.js'),context);const api=context.KGRecallAssociationLibrary;
let lib=api.normalizeLibrary({nodes:[{id:'recall-agile-team',title:'敏捷团队',titleEn:'Agile team',prompt:'先想什么？',promptEn:'What comes first?',hint:'想角色',hintEn:'Think roles'},{id:'recall-roles',title:'团队职责',titleEn:'Team responsibilities'},{id:'recall-collab',title:'团队协作',titleEn:'Team collaboration'}],edges:[{from:'recall-agile-team',to:'recall-roles',priority:2},{from:'recall-agile-team',to:'recall-collab',priority:1}]});
let node=api.resolve(lib,'recall-agile-team');assert(node.titleEn==='Agile team'&&node.promptEn==='What comes first?'&&node.hintEn==='Think roles','bilingual fields must normalize');let choices=api.choices(lib,'recall-agile-team',{limit:4}).choices;assert(choices[0].textEn==='Team responsibilities','choice English title missing');
api.write('PMP',lib);const saved=api.saveNode('PMP',{id:'recall-agile-team',title:'敏捷团队',titleEn:'Agile Team',prompt:'看到团队先想什么？',promptEn:'What do you recall first?'},[{id:'recall-collab',title:'团队协作'},{id:'recall-roles',title:'团队职责'}]);assert(saved.valid,'visual save failed');assert(saved.node.id==='recall-agile-team','stable node id changed');const ordered=api.choices(saved.library,'recall-agile-team',{limit:4}).choices;assert(ordered[0].next==='recall-collab'&&ordered[1].next==='recall-roles','candidate order not persisted');assert(api.asRecallNode('PMP','recall-agile-team').titleEn==='Agile Team','learner node lacks English metadata');console.log('v862-p22-learning-ui-recall-studio-ok');

