'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const currentVersion=read('VERSION').trim();
if(currentVersion!=='v9.0-p3.3.5'){console.log('v90-p335-data-integrity-skipped-for',currentVersion);process.exit(0)}
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');
assert.equal(read('VERSION').trim(),'v9.0-p3.3.5');
assert(read('src/admin/00-admin-core.js').includes("VERSION='9.0-p3.3.5'"));
const manifest=JSON.parse(read('V9.0_P3.3.5_DATA_INTEGRITY.json'));
assert.equal(manifest.release,'v9.0-p3.3.5');
assert.equal(manifest.baseline,'v9.0-p3.3.4');
const c=manifest.constraints||{};
assert.equal(c.tagGroupRename,true);
assert.equal(c.tagCategoryRename,true);
assert.equal(c.tagOptionRenamePreserved,true);
assert.equal(c.tagHierarchyStructureChanged,false);
assert.equal(c.stickyAdminPrimaryNavigation,true);
assert.deepEqual(c.stickyAdminPages,['overview','subjects','users','operations','settings']);
assert.equal(c.adminAccountCapsule,true);
assert.equal(c.adminAccountMenuHasBackendHelp,true);
assert.equal(c.adminTeacherSwitchRemoved,true);
assert.equal(c.adminAccountSwitchRemoved,true);
assert.equal(c.userManagementBackButtonRemoved,true);
assert.equal(c.userManagementDuplicateShortcutsRemoved,true);
assert.equal(c.questionAndPaperDataModelChanged,false);
assert.equal(c.p34QuestionBulkMoveImplemented,false);
for(const [file,expected] of Object.entries(manifest.changedFileSha256||{})){
  assert(fs.existsSync(path.join(ROOT,file)),`${file} missing`);
  assert.equal(hash(file),expected,`${file} integrity mismatch`);
}
console.log('v90-p335-data-integrity-ok',Object.keys(manifest.changedFileSha256||{}).length);
