'use strict';

const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');

const root=path.resolve(__dirname,'..');
const admin=fs.readFileSync(path.join(root,'src/65-question-bank-admin.js'),'utf8');
const workflow=fs.readFileSync(path.join(root,'src/97-teacher-question-workflow.js'),'utf8');
const prepDomain=fs.readFileSync(path.join(root,'content-prep-studio/src/js/10-state-domain.js'),'utf8');
const prepEvents=fs.readFileSync(path.join(root,'content-prep-studio/src/js/40-events-bootstrap.js'),'utf8');

assert.match(admin,/function canonicalQuestionDuplicateSignature\(question/);
assert.match(admin,/\.normalize\('NFKC'\)/);
assert.match(admin,/function preflightQuestionDuplicates\(incoming,existing/);
assert.match(admin,/已有重复.*本批重复[\s\S]*自动清除/);
assert.match(admin,/global\.confirm/);
assert.match(admin,/cancelled:true/);
assert.doesNotMatch(workflow,/skipDuplicates:byId\('tqSkipDuplicates'\)/);

assert.match(prepDomain,/function canonicalQuestionDuplicateSignature\(q/);
assert.match(prepDomain,/function preflightQuestionDuplicates\(incoming,existing/);
assert.match(prepEvents,/confirmQuestionDuplicateCleanup/);
assert.match(prepEvents,/existingCount/);
assert.match(prepEvents,/batchCount/);
assert.match(prepEvents,/result\?\.cancelled/);
assert.match(prepEvents,/已取消导入，当前内容没有变化/);

console.log('question-import-duplicate-confirmation-ok');
