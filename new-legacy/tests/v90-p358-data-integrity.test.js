'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,'V9.0_P3.5.8_DATA_INTEGRITY.json'),'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');
const currentVersion=fs.readFileSync(path.join(ROOT,'VERSION'),'utf8').trim();
if(currentVersion!=='v9.0-p3.5.8'){console.log('v90-p358-data-integrity-historical-skip',{currentVersion});process.exit(0);}
assert.equal(fs.readFileSync(path.join(ROOT,'VERSION'),'utf8').trim(),'v9.0-p3.5.8');
assert.equal(manifest.release,'v9.0-p3.5.8');
assert.equal(manifest.baseRelease,'v9.0-p3.5.7');
assert.equal(manifest.safety.questionIdsChanged,false);
assert.equal(manifest.safety.paperReferencesChanged,false);
assert.equal(manifest.safety.courseDataChanged,false);
assert.equal(manifest.safety.learningTaskDataChanged,false);
for(const [file,expected] of Object.entries(manifest.changedFileSha256||{})){
  assert(fs.existsSync(path.join(ROOT,file)),`${file} missing`);
  assert.equal(hash(file),expected,`${file} checksum mismatch`);
}
console.log('v90-p358-data-integrity-ok',Object.keys(manifest.changedFileSha256||{}).length);
