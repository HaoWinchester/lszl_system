'use strict';
(function(global){
  const domains=global.KGTeacherDomains||{};
  const registry={
    version:'9.0-p4.1.7',
    questionBank:domains.QuestionBank||{},
    questionEditor:domains.QuestionEditor||{},
    questionClassification:domains.QuestionClassification||{},
    trainingConfig:domains.TrainingConfig||{},
    paperManagement:domains.PaperManagement||{},
    knowledgeTree:domains.KnowledgeTree||{},
    associationLibrary:domains.AssociationLibrary||{},
    core:domains.Core||{}
  };
  global.KGTeacherDomainRegistry=Object.freeze(registry);
  try{global.dispatchEvent?.(new CustomEvent('kg:teacher-domains-ready',{detail:{version:registry.version}}))}catch(error){}
})(globalThis);
