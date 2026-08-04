'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const currentVersion=read('VERSION').trim();
if(currentVersion!=='v9.0-p4.1.1'){console.log('v90-p411-data-integrity-skipped',currentVersion);process.exit(0)}
const manifest=JSON.parse(read('V9.0_P4.1.1_DATA_INTEGRITY.json'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');
assert.equal(manifest.release,'v9.0-p4.1.1');
assert.equal(manifest.baseRelease,'v9.0-p4.1');
assert.equal(manifest.uiAlignment.supportButtonCentered,true);
assert.equal(manifest.uiAlignment.dialogCloseUsesSvg,true);
assert.equal(manifest.feedbackReplyNotifications.totalBadgeIncludesReplies,true);
assert.equal(manifest.feedbackReplyNotifications.perAccountReadState,true);
assert.equal(manifest.feedbackReplyNotifications.readStoragePrefix,'kg_user_feedback_reply_reads_v1__');
assert.equal(manifest.deployment.remoteAdapterReady,true);
assert.equal(manifest.deployment.backendImplemented,false);
assert.equal(manifest.modularization.bigBangRewriteRecommended,false);
assert.equal(manifest.modularization.incrementalRefactorRecommended,true);
assert.equal(manifest.safety.questionIdsChanged,false);
assert.equal(manifest.safety.publishedPaperSnapshotsChanged,false);
assert.equal(manifest.safety.browserStorageMigrationRequired,false);
for(const [file,expected] of Object.entries(manifest.changedFileSha256||{})){
  assert(fs.existsSync(path.join(ROOT,file)),`${file} missing`);
  assert.equal(hash(file),expected,`${file} checksum mismatch`);
}
console.log('v90-p411-data-integrity-ok',Object.keys(manifest.changedFileSha256||{}).length);
