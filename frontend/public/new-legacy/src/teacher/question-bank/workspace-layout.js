'use strict';
(function(global){
  const root=global.KGTeacherDomains=global.KGTeacherDomains||{};
  function create(options={}){const key=String(options.key||'kg_question_library_workspace_layout_v1'),store=options.store||global.KGAppStorage||{};const read=()=>{try{return store.readJSON?.(key,{})||{}}catch(error){return {}}};const save=patch=>{const next={...read(),...patch,updatedAt:Date.now()};store.writeJSON?.(key,next);return next};return Object.freeze({key,read,save,reset:()=>{store.remove?.(key);return {}}})}
  root.QuestionBank=root.QuestionBank||{};root.QuestionBank.WorkspaceLayout=Object.freeze({create});
})(globalThis);
