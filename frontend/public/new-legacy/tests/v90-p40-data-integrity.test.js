'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');
const currentVersion=read('VERSION').trim();
if(currentVersion!=='v9.0-p4.0'){console.log('v90-p40-data-integrity-historical-skip',{currentVersion});process.exit(0);}
assert.equal(currentVersion,'v9.0-p4.0');
const manifest=JSON.parse(read('V9.0_P4.0_DATA_INTEGRITY.json'));
assert.equal(manifest.release,'v9.0-p4.0');
assert.equal(manifest.baseRelease,'v9.0-p3.5.8');
assert.equal(manifest.safety.questionIdsChanged,false);
assert.equal(manifest.safety.paperReferencesChanged,false);
assert.equal(manifest.safety.publishedPaperSnapshotsChanged,false);
assert.equal(manifest.safety.legacyLearningDataRemoved,false);
assert.equal(manifest.practice.questionCounts.join(','),'10,20,60,180');
assert.equal(manifest.practice.baseExperience,10);
assert.equal(manifest.practice.scholar.initialSeconds,80);
for(const [file,expected] of Object.entries(manifest.changedFileSha256||{})){
  assert(fs.existsSync(path.join(ROOT,file)),`${file} missing`);
  assert.equal(hash(file),expected,`${file} checksum mismatch`);
}
console.log('v90-p40-data-integrity-ok',Object.keys(manifest.changedFileSha256||{}).length);
