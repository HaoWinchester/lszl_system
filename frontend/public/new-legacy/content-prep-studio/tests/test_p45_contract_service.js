'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../src/js/32-p45-contract-service.js'),'utf8');
const window={__KG_DIRECT_BOOTSTRAP__:{releaseVersion:'v9.0-p4.1.74'}};
const context=vm.createContext({window,Object,String,JSON,Array,Date});
vm.runInContext(source,context,{filename:'32-p45-contract-service.js'});

const compatibility=JSON.parse(JSON.stringify(window.PMPPrepAuthoringContract.buildProgramCompatibility({
  serverBuildEvidence:{buildId:'backend-api-v1',contentRevision:42},
})));

assert.equal(compatibility.authoringContract.id,'pmp-authoring-contract-v1');
assert.equal(compatibility.testedAgainstProductRelease,'v9.0-p4.1.74');
assert.equal(compatibility.prepBuild,'0.4.0');
assert.equal(compatibility.policies.keywordLocation,'source-isolated-derived');
assert.equal(compatibility.policies.recallBinding,'optional-existing-id-only');
assert.equal(compatibility.policies.deepRecallReveal,'click-to-reveal-all-keywords');
assert.equal(compatibility.policies.keywordCorePriority,'overlap-match-priority-only');
assert.ok(compatibility.contractSnapshot.schemas.questionFamily);
assert.ok(compatibility.registryManifest.version);
assert.equal(compatibility.serverBuildEvidence.contentRevision,42);

const core=fs.readFileSync(path.join(__dirname,'../src/js/00-core-bootstrap.js'),'utf8');
for(const required of [
  'PMP Content Prep Studio v0.4.0',
  'metadata.questionFamily',
  'metadata.subjectFacets',
  'reasoningSteps',
  'metadata.stemPrincipleIds',
  'Source Facts',
]){
  assert.ok(core.includes(required),`External AI Contract 缺少 ${required}`);
}

console.log('p45-contract-service: passed');
