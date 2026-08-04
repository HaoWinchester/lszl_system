'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');
const currentVersion=read('VERSION').trim();
if(currentVersion!=='v9.0-p3.4'){console.log('v90-p34-data-integrity-historical-skip',{currentVersion});process.exit(0);}
assert.equal(read('VERSION').trim(),'v9.0-p3.4');
assert(read('src/admin/00-admin-core.js').includes("VERSION='9.0-p3.4'"));
const manifest=JSON.parse(read('V9.0_P3.4_DATA_INTEGRITY.json'));
assert.equal(manifest.release,'v9.0-p3.4');
assert.equal(manifest.baseline,'v9.0-p3.3.5');
const c=manifest.constraints||{};
assert.equal(c.currentPageSelectionOnly,true);
assert.equal(c.questionPageSize,20);
assert.equal(c.bulkPrimaryKnowledgeMove,true);
assert.equal(c.bulkMoveToUnclassified,true);
assert.equal(c.bulkTagAddRemove,true);
assert.equal(c.questionIdStableAcrossBulkOperations,true);
assert.equal(c.safeDeleteRecoverable,true);
assert.equal(c.historicalReferencesPreserved,true);
assert.equal(c.permanentDeleteReferenceProtected,true);
assert.equal(c.disabledKnowledgeTargetBlocked,true);
assert.equal(c.questionAuditTrail,true);
assert.equal(c.studentClassificationMetadataExposed,false);
for(const [file,expected] of Object.entries(manifest.changedFileSha256||{})){
  assert(fs.existsSync(path.join(ROOT,file)),`${file} missing`);
  assert.equal(hash(file),expected,`${file} integrity mismatch`);
}
console.log('v90-p34-data-integrity-ok',Object.keys(manifest.changedFileSha256||{}).length);
