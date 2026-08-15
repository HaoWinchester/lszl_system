/*
 * P4.5.29 G6 · Authoring Contract 与版本治理。
 * 只描述机器契约和兼容证据，不持久化业务数据。
 */
(function(global){
  const AUTHORING_CONTRACT=Object.freeze({
    id:'pmp-authoring-contract-v1',
    version:'1.0.0',
  });
  const CONTRACT_SNAPSHOT=Object.freeze({
    format:'pmp-authoring-contract-snapshot-v1',
    schemas:Object.freeze({
      question:'pmp-question-v1',
      questionBank:'pmp-question-bank-v1',
      questionFamily:'question-family-v1',
      principle:'pmp-principle-v1',
      principleBundle:'pmp-principle-preset-bundle-v1',
      keyword:'question-keyword-v2',
      recallBinding:'recall-binding-v1',
      programCompatibility:'program-compatibility-v1',
    }),
  });
  const REGISTRY_MANIFEST=Object.freeze({
    id:'pmp-authoring-registries',
    version:'1.0.0',
    hash:'sha256:8d641db17cc2cf6ccccab5332f25fa11419f318ed7f08c9d67796402899dd030',
    registries:Object.freeze({
      difficulty:'difficulty-v1',
      globalTags:'global-tags-v1',
      subjectFacets:'subject-facets-v1',
    }),
  });
  const POLICIES=Object.freeze({
    deepRecallKeywordRevealPolicy:'click-to-reveal-all-keywords',
    keywordCorePriorityPolicy:'overlap-match-priority-only',
    keywordLocationPolicy:'source-isolated-derived-matchLocations',
    recallBindingPolicy:'optional-existing-node-only',
  });
  /* P4.5.29 合并规格 §13：对外兼容声明以扁平合同键为准 */
  const TARGET_MAIN_VERSION='V9.0-P4.5.29';
  const EXTERNAL_AI_AUTHORING_CONTRACT='external-ai-question-authoring-v1';

  function productRelease(){
    const bootstrap=global.__KG_DIRECT_BOOTSTRAP__||{};
    return String(bootstrap.releaseVersion||global.__PMP_PRODUCT_RELEASE__||'unknown');
  }
  function buildProgramCompatibility({serverBuildEvidence={}}={}){
    return {
      contractVersion:1,
      targetMainVersion:TARGET_MAIN_VERSION,
      architecture:'service-layer-v1',
      classificationArchitecture:'global-tags+subject-facets-v1',
      globalTagSchemaVersion:3,
      globalTagSlotIdStrategy:'global-semantic-v1',
      subjectFacetRegistry:'subject-facet-registry-v1',
      pmpSubjectFacetSchema:'pmp-facet-schema-v1',
      keywordSystem:'Question Keyword System v2',
      knowledgeBindingStrategy:'current-default-taxonomy-by-subject',
      questionFamilySchema:'question-family-v1',
      questionFamilyScope:'single-question-bank',
      questionIdStrategy:'uuid-v4',
      questionDifficultyScale:'three-level',
      questionDifficultyLabels:['简单','中等','困难'],
      questionDifficultyMainValues:['easy','medium','hard'],
      questionFamilyDiagnosticLevelScale:'L1-L4',
      externalAIQuestionAuthoringContract:EXTERNAL_AI_AUTHORING_CONTRACT,
      ...POLICIES,
      authoringContract:{...AUTHORING_CONTRACT},
      contractSnapshot:JSON.parse(JSON.stringify(CONTRACT_SNAPSHOT)),
      registryManifest:JSON.parse(JSON.stringify(REGISTRY_MANIFEST)),
      testedAgainstProductRelease:productRelease(),
      prepBuild:'0.4.0',
      serverBuildEvidence:JSON.parse(JSON.stringify(serverBuildEvidence||{})),
    };
  }
  function attachToQuestionBank(bank,options={}){
    bank.programCompatibility=buildProgramCompatibility(options);
    return bank;
  }
  function renderVersionHeader(metadata={}){
    const release=document.getElementById('hdrProductRelease');
    const prep=document.getElementById('hdrPrepBuild');
    const contract=document.getElementById('hdrAuthoringContract');
    if(release)release.textContent=`Product Release ${productRelease()}`;
    if(prep)prep.textContent='Prep Build 0.4.0';
    if(contract)contract.textContent=`Authoring Contract ${AUTHORING_CONTRACT.id}`;
    const server=document.getElementById('hdrServerBuild');
    if(server&&metadata.serverBuild)server.textContent=`Server Build ${metadata.serverBuild}`;
  }

  global.PMPPrepAuthoringContract=Object.freeze({
    AUTHORING_CONTRACT,
    CONTRACT_SNAPSHOT,
    REGISTRY_MANIFEST,
    POLICIES,
    buildProgramCompatibility,
    attachToQuestionBank,
    renderVersionHeader,
  });
})(window);
