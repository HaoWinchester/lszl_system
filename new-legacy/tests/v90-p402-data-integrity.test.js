'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const currentVersion=read('VERSION').trim();
if(currentVersion!=='v9.0-p4.0.2'){console.log('v90-p402-data-integrity-skipped',currentVersion);process.exit(0)}
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');
assert.equal(read('VERSION').trim(),'v9.0-p4.0.2');
const manifest=JSON.parse(read('V9.0_P4.0.2_DATA_INTEGRITY.json'));
assert.equal(manifest.release,'v9.0-p4.0.2');
assert.equal(manifest.baseRelease,'v9.0-p4.0.1');
assert.equal(manifest.navigation.homeRestoredToGraph,true);
assert.equal(manifest.navigation.multiQuestionCanvasRestored,true);
assert.equal(manifest.navigation.deepRecallRestored,true);
assert.equal(manifest.navigation.practiceEntryFromHome,true);
assert.deepEqual(manifest.navigation.learnerShortcutItems,['home','workspace','recall']);
assert.equal(manifest.ui.scholarDangerVignetteThresholdSeconds,20);
assert.equal(manifest.ui.dangerVignetteProgressiveIntensity,true);
assert.equal(manifest.safety.questionIdsChanged,false);
assert.equal(manifest.safety.paperReferencesChanged,false);
assert.equal(manifest.safety.publishedPaperSnapshotsChanged,false);
assert.equal(manifest.safety.practiceHistorySchemaChanged,false);
for(const [file,expected] of Object.entries(manifest.changedFileSha256||{})){
  assert(fs.existsSync(path.join(ROOT,file)),`${file} missing`);
  assert.equal(hash(file),expected,`${file} checksum mismatch`);
}
console.log('v90-p402-data-integrity-ok',Object.keys(manifest.changedFileSha256||{}).length);
