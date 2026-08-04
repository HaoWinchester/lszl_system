'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const currentVersion=fs.readFileSync(path.join(root,'VERSION'),'utf8').trim();
if(currentVersion!=='v9.0-p3.3.3'){console.log('v90-p333-data-integrity-skipped-for',currentVersion);process.exit(0)}
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
assert.equal(read('VERSION').trim(),'v9.0-p3.3.3');
assert(read('src/admin/00-admin-core.js').includes("VERSION='9.0-p3.3.3'"));
const manifest=JSON.parse(read('V9.0_P3.3.3_DATA_INTEGRITY.json'));
assert.equal(manifest.release,'v9.0-p3.3.3');
assert.equal(manifest.baseline,'v9.0-p3.3.2');
assert.equal(manifest.constraints.singlePrimaryKnowledgePoint,true);
assert.equal(manifest.constraints.semanticKnowledgeGuessing,false);
assert.equal(manifest.constraints.questionTypeLayoutChanged,false);
for(const [file,expected] of Object.entries(manifest.changedFileSha256)){
  assert(fs.existsSync(path.join(root,file)),`${file} 缺失`);
  assert.equal(hash(file),expected,`${file} 完整性校验失败`);
}
const bank=read('question-bank.html');
assert(bank.includes('id="qbClassificationBar"'));
assert(bank.includes('id="qbKnowledgePickerDialog"'));
assert(bank.includes('id="qbTagPickerDialog"'));
assert(!bank.includes('questionEntryWorkspace'));
assert(!bank.includes('data-question-business-tab="entry"'));
console.log('v90-p333-data-integrity-ok',Object.keys(manifest.changedFileSha256).length);
