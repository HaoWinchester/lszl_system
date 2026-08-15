'use strict';

/*
 * P4.5.29 合并规格 §13 + §9 · programCompatibility 完整性与 Deep Recall 策略声明
 */

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

/* §13 扁平合同键 */
assert.equal(compatibility.contractVersion,1);
assert.equal(compatibility.targetMainVersion,'V9.0-P4.5.29');
assert.equal(compatibility.architecture,'service-layer-v1');
assert.equal(compatibility.classificationArchitecture,'global-tags+subject-facets-v1');
assert.equal(compatibility.globalTagSchemaVersion,3);
assert.equal(compatibility.globalTagSlotIdStrategy,'global-semantic-v1');
assert.equal(compatibility.subjectFacetRegistry,'subject-facet-registry-v1');
assert.equal(compatibility.pmpSubjectFacetSchema,'pmp-facet-schema-v1');
assert.equal(compatibility.keywordSystem,'Question Keyword System v2');
assert.equal(compatibility.knowledgeBindingStrategy,'current-default-taxonomy-by-subject');
assert.equal(compatibility.questionFamilySchema,'question-family-v1');
assert.equal(compatibility.questionFamilyScope,'single-question-bank');
assert.equal(compatibility.questionIdStrategy,'uuid-v4');
assert.equal(compatibility.questionDifficultyScale,'three-level');
assert.deepEqual(compatibility.questionDifficultyLabels,['简单','中等','困难']);
assert.deepEqual(compatibility.questionDifficultyMainValues,['easy','medium','hard']);
assert.equal(compatibility.questionFamilyDiagnosticLevelScale,'L1-L4');
assert.equal(compatibility.externalAIQuestionAuthoringContract,'external-ai-question-authoring-v1');

/* §9 四个 Deep Recall / Keyword 策略字符串 */
assert.equal(compatibility.deepRecallKeywordRevealPolicy,'click-to-reveal-all-keywords');
assert.equal(compatibility.keywordCorePriorityPolicy,'overlap-match-priority-only');
assert.equal(compatibility.keywordLocationPolicy,'source-isolated-derived-matchLocations');
assert.equal(compatibility.recallBindingPolicy,'optional-existing-node-only');

/* 上线版自身证据保留 */
assert.equal(compatibility.authoringContract.id,'pmp-authoring-contract-v1');
assert.equal(compatibility.testedAgainstProductRelease,'v9.0-p4.1.74');
assert.equal(compatibility.prepBuild,'0.4.0');
assert.ok(compatibility.contractSnapshot.schemas.questionFamily);
assert.ok(compatibility.registryManifest.version);
assert.equal(compatibility.serverBuildEvidence.contentRevision,42);

/* External AI Contract v1：完整 AI 格式覆盖 §10.1 全部结构 */
const core=fs.readFileSync(path.join(__dirname,'../src/js/00-core-bootstrap.js'),'utf8');
for(const required of [
  'PMP Content Prep Studio v0.4.0',
  'metadata.questionFamily',
  'metadata.subjectFacets',
  'reasoningSteps',
  'metadata.principleIds',
  'metadata.optionPrincipleMap',
  'metadata.keywordSystemV2',
  'External AI Question Authoring Contract v1',
  'Source Facts',
]){
  assert.ok(core.includes(required),`External AI Contract 缺少 ${required}`);
}

console.log('p45-contract-service: passed');
