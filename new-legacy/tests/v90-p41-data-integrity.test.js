'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const currentVersion=read('VERSION').trim();
if(currentVersion!=='v9.0-p4.1'){console.log('v90-p41-data-integrity-skipped',currentVersion);process.exit(0)}
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');
const manifest=JSON.parse(read('V9.0_P4.1_DATA_INTEGRITY.json'));
assert.equal(manifest.release,'v9.0-p4.1');
assert.equal(manifest.baseRelease,'v9.0-p4.0.3');
assert.equal(manifest.p403Audit.blockingBugsFound,0);
assert.equal(manifest.p403Audit.boundaryBugsFixed,2);
assert.equal(manifest.supportCenter.homeQuestionButton,true);
assert.equal(manifest.supportCenter.helpCenter,true);
assert.equal(manifest.supportCenter.feedback,true);
assert.equal(manifest.supportCenter.messages,true);
assert.equal(manifest.feedback.attachmentMaxBytes,2097152);
assert.equal(manifest.feedback.adminPage,'feedback-management.html');
assert.equal(manifest.messages.adminPage,'message-management.html');
assert.equal(manifest.deployment.defaultMode,'local-demo');
assert.equal(manifest.deployment.remoteAdapterReady,true);
assert.equal(manifest.deployment.backendImplemented,false);
assert.equal(manifest.safety.questionIdsChanged,false);
assert.equal(manifest.safety.publishedPaperSnapshotsChanged,false);
assert.equal(manifest.safety.browserStorageMigrationRequired,false);
for(const [file,expected] of Object.entries(manifest.changedFileSha256||{})){
  assert(fs.existsSync(path.join(ROOT,file)),`${file} missing`);
  assert.equal(hash(file),expected,`${file} checksum mismatch`);
}
console.log('v90-p41-data-integrity-ok',Object.keys(manifest.changedFileSha256||{}).length);
