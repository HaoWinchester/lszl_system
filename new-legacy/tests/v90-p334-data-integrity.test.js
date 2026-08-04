'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');
const currentVersion=read('VERSION').trim();
if(currentVersion!=='v9.0-p3.3.4'){console.log('v90-p334-data-integrity-skipped-for',currentVersion);process.exit(0)}
assert.equal(currentVersion,'v9.0-p3.3.4');
assert(read('src/admin/00-admin-core.js').includes("VERSION='9.0-p3.3.4'"));
const manifest=JSON.parse(read('V9.0_P3.3.4_DATA_INTEGRITY.json'));
assert.equal(manifest.release,'v9.0-p3.3.4');
assert.equal(manifest.baseline,'v9.0-p3.3.3.3');
const c=manifest.constraints||{};
assert.equal(c.lightweightTagRenameIncluded,true);
assert.equal(c.tagManagerInsidePicker,true);
assert.equal(c.doubleClickInlineRename,true);
assert.equal(c.renameSyncsExistingQuestions,true);
assert.equal(c.legacyTagAliasCompatibility,true);
assert.equal(c.batchSessionTagRenameSync,true);
assert.equal(c.tagHierarchyUnchanged,true);
assert.equal(c.tagDeleteImplemented,false);
assert.equal(c.batchPreviewMatchesSingle,true);
assert.equal(c.fullWidthQuestionWorkspace,true);
assert.equal(c.p34QuestionBulkMoveImplemented,false);
for(const [file,expected] of Object.entries(manifest.changedFileSha256||{})){
  assert(fs.existsSync(path.join(ROOT,file)),`${file} 缺失`);
  assert.equal(hash(file),expected,`${file} 完整性校验失败`);
}
console.log('v90-p334-data-integrity-ok',Object.keys(manifest.changedFileSha256||{}).length);
