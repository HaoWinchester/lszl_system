'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const currentVersion=read('VERSION').trim();
if(currentVersion!=='v9.0-p4.0.1'){console.log('v90-p401-data-integrity-skipped',currentVersion);process.exit(0)}
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');
assert.equal(read('VERSION').trim(),'v9.0-p4.0.1');
const manifest=JSON.parse(read('V9.0_P4.0.1_DATA_INTEGRITY.json'));
assert.equal(manifest.release,'v9.0-p4.0.1');
assert.equal(manifest.baseRelease,'v9.0-p4.0');
assert.equal(manifest.safety.questionIdsChanged,false);
assert.equal(manifest.safety.paperReferencesChanged,false);
assert.equal(manifest.safety.publishedPaperSnapshotsChanged,false);
assert.equal(manifest.safety.practiceHistorySchemaChanged,false);
assert.equal(manifest.ui.modeSwitch,true);
assert.equal(manifest.ui.persistentStreakPopup,true);
assert.equal(manifest.ui.scholarAlarmIcon,true);
assert.equal(manifest.ui.scholarDangerVignetteThresholdSeconds,20);
for(const [file,expected] of Object.entries(manifest.changedFileSha256||{})){
  assert(fs.existsSync(path.join(ROOT,file)),`${file} missing`);
  assert.equal(hash(file),expected,`${file} checksum mismatch`);
}
console.log('v90-p401-data-integrity-ok',Object.keys(manifest.changedFileSha256||{}).length);
