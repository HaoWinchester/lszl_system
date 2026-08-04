'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const currentVersion=read('VERSION').trim();
if(currentVersion!=='v9.0-p4.0.3'){console.log('v90-p403-data-integrity-skipped',currentVersion);process.exit(0)}
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,file))).digest('hex');
const manifest=JSON.parse(read('V9.0_P4.0.3_DATA_INTEGRITY.json'));
assert.equal(manifest.release,'v9.0-p4.0.3');
assert.equal(manifest.baseRelease,'v9.0-p4.0.2');
assert.equal(manifest.publishedPaperRepository.storageKey,'kg_exam_papers_published_v1');
assert.equal(manifest.publishedPaperRepository.immutableSnapshotsOnly,true);
assert.deepEqual(manifest.publishedPaperRepository.fallbackSources,[]);
assert.equal(manifest.learningPages.deepRecall.backHref,'index.html');
assert.equal(manifest.learningPages.multiQuestionCanvas.releaseIdPersisted,true);
assert.equal(manifest.learningPages.singleDeepStudy.forcedPracticeRedirectRemoved,true);
assert.equal(manifest.transientMenus.hideOnCanvasPan,true);
assert.equal(manifest.transientMenus.hideOnWheelZoom,true);
assert.equal(manifest.safety.questionIdsChanged,false);
assert.equal(manifest.safety.publishedPaperDataSchemaChanged,false);
assert.equal(manifest.safety.publishedPaperSnapshotsChanged,false);
assert.equal(manifest.safety.browserStorageMigrationRequired,false);
for(const [file,expected] of Object.entries(manifest.changedFileSha256||{})){
  assert(fs.existsSync(path.join(ROOT,file)),`${file} missing`);
  assert.equal(hash(file),expected,`${file} checksum mismatch`);
}
console.log('v90-p403-data-integrity-ok',Object.keys(manifest.changedFileSha256||{}).length);
