'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');

assert.match(read('VERSION').trim(),/^v9\.0-p4\.1\.\d+$/);
assert(read('src/admin/00-admin-core.js').includes("const VERSION='9.0-p4.1."));

const bankHtml=read('question-bank.html');
assert(bankHtml.includes('id="qbRecallLibraryRelocatedNotice"'));
assert(!bankHtml.includes('id="qbRecallLibrarySection"'));
assert(!bankHtml.includes('id="qbRecallNodeStudio"'));

const bankAdmin=read('src/65-question-bank-admin.js');
assert(bankAdmin.includes('function renderSubjectChipState()'));
assert(bankAdmin.includes("state.banks.filter(bank=>bank.subject===activeSubject)"));
assert(bankAdmin.includes("button.classList.toggle('active',active)"));
assert(!/function renderTrainingBankSelect\(\)[\s\S]{0,1400}<optgroup/.test(bankAdmin));

const workflow=read('src/97-teacher-question-workflow.js');
assert(workflow.includes('题目预览'));
assert(workflow.includes('题干、选项与解析'));
assert(!workflow.includes('<section class="tq-training-answer"'));
assert(!workflow.includes('<section class="tq-training-analysis"'));
assert(workflow.includes("title.textContent='选择训练科目'"));

const content=read('content-center.html'),subjects=read('admin-subjects.html');
assert(!content.includes('id="ccRecallLibraryPanel"'));
assert(subjects.includes('id="adminRecallPanel"'));
assert(subjects.includes('id="adminRecallRows"'));
assert(subjects.indexOf('src/95-recall-association-library.js')<subjects.indexOf('src/admin/53-recall-association-management.js'));
assert(read('src/admin/53-recall-association-management.js').includes('KGRecallAssociationManagement'));
assert(read('src/admin/53-recall-association-management.js').includes('recall_library.publish'));

const library=require(path.join(ROOT,'src/95-recall-association-library.js'));
const empty=library.normalizeLibrary({schemaVersion:1,nodes:[],edges:[]});
assert.deepEqual(empty.nodes,[]);
assert.deepEqual(empty.edges,[]);
const parsed=library.parseText('A -> B | C');
assert(parsed.valid);
assert.equal(parsed.library.nodes.length,3);
assert.equal(parsed.library.edges.length,2);
console.log('v90-p355-training-subject-preview-recall-library-ok');
