'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');
const current=read('VERSION').trim();
if(current!=='v9.0-p3.3.3.2'){console.log('v90-p3332-data-integrity-skipped-for',current);process.exit(0);}
assert.equal(read('VERSION').trim(),'v9.0-p3.3.3.2');
assert(read('src/admin/00-admin-core.js').includes("VERSION='9.0-p3.3.3.2'"));
const manifest=JSON.parse(read('V9.0_P3.3.3.2_DATA_INTEGRITY.json'));
assert.equal(manifest.release,'v9.0-p3.3.3.2');
assert.equal(manifest.baseline,'v9.0-p3.3.3.1');
const c=manifest.constraints||{};
assert.equal(c.batchSeparatorStable,true);
assert.equal(c.multiQuestionPreviewNavigation,true);
assert.equal(c.batchDefaultPanelViewportSafe,true);
assert.equal(c.batchDefaultClassificationPreserved,true);
assert.equal(c.perQuestionClassificationOverridePreserved,true);
assert.equal(c.lightweightTagRenameIncluded,false);
assert.equal(c.p34QuestionBulkMoveImplemented,false);
for(const [file,expected] of Object.entries(manifest.changedFileSha256||{})){
  assert(fs.existsSync(path.join(ROOT,file)),`${file} 缺失`);
  assert.equal(hash(file),expected,`${file} 完整性校验失败`);
}
console.log('v90-p3332-data-integrity-ok',Object.keys(manifest.changedFileSha256||{}).length);
