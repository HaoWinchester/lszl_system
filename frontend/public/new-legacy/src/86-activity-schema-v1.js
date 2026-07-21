'use strict';

/*
 * Activity Schema v1
 * Canonical activity records, deterministic legacy migration, bilingual materialization,
 * validation and package export helpers. Existing renderers continue to consume a
 * compatibility view so the data foundation can evolve without rewriting the runner.
 */
(function(global){
  const SCHEMA_VERSION=1;
  const LANGUAGE_STORAGE_KEY='kg_question_language_mode_v1';
  const LANGUAGE_MODES=Object.freeze(['zh','en','bilingual']);
  const TYPE_TO_CANONICAL=Object.freeze({
    choice:'single_choice',
    keyword:'keyword_recognition',
    matching:'matching',
    open_text:'open_response',
    memory_match:'memory_match',
    deep_recall:'deep_recall',
    multi_question_induction:'multi_question_induction',
    knowledge_graph:'knowledge_graph',
    part_challenge:'part_challenge'
  });
  const TYPE_TO_RUNTIME=Object.freeze(Object.fromEntries(Object.entries(TYPE_TO_CANONICAL).map(([runtime,canonical])=>[canonical,runtime])));
  const STANDARD_TYPES=new Set(['single_choice','keyword_recognition','matching','open_response','memory_match']);

  function clone(value){try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
  function text(value){return String(value??'')}
  function cleanText(value){return text(value).trim()}
  function normalizeLanguageMode(mode){return LANGUAGE_MODES.includes(String(mode||''))?String(mode):'zh'}
  function getLanguageMode(){
    try{return normalizeLanguageMode(global.window.KGServerStateStorage?.getItem(LANGUAGE_STORAGE_KEY)||'zh')}catch(error){return 'zh'}
  }
  function setLanguageMode(mode){
    const value=normalizeLanguageMode(mode);
    try{global.window.KGServerStateStorage?.setItem(LANGUAGE_STORAGE_KEY,value)}catch(error){}
    try{global.dispatchEvent?.(new CustomEvent('kg:question-language-mode',{detail:{mode:value}}))}catch(error){}
    return value;
  }
  function canonicalType(type){return TYPE_TO_CANONICAL[String(type||'')]||String(type||'unknown')}
  function runtimeType(type,metadata={}){return String(metadata.runtimeType||TYPE_TO_RUNTIME[String(type||'')]||type||'unknown')}
  function unique(values){return [...new Set((values||[]).map(value=>String(value||'')).filter(Boolean))]}
  function stableId(activityId,kind,index){return String(activityId)+'-'+kind+'-'+String(index+1).padStart(2,'0')}
  function explanationRecord(legacy){
    return {
      short:cleanText(legacy.shortExplanation||''),
      detailed:cleanText(legacy.detailedExplanation||legacy.explanation||''),
      incorrect:cleanText(legacy.incorrectFeedback||''),
      general:cleanText(legacy.explanation||'')
    };
  }
  function without(source,keys){
    const output={};const blocked=new Set(keys||[]);
    Object.entries(source||{}).forEach(([key,value])=>{if(!blocked.has(key))output[key]=clone(value)});
    return output;
  }
  function deepMerge(base,patch){
    if(patch===undefined)return clone(base);
    if(Array.isArray(patch))return clone(patch);
    if(!patch||typeof patch!=='object')return clone(patch);
    const output=base&&typeof base==='object'&&!Array.isArray(base)?clone(base):{};
    Object.entries(patch).forEach(([key,value])=>{output[key]=deepMerge(output[key],value)});
    return output;
  }
  function localeHasContent(value){
    if(value===null||value===undefined)return false;
    if(typeof value==='string')return Boolean(value.trim());
    if(Array.isArray(value))return value.some(localeHasContent);
    if(typeof value==='object')return Object.values(value).some(localeHasContent);
    return true;
  }
  function localeStatus(content){
    const zh=localeHasContent(content?.zh),en=localeHasContent(content?.en);
    return zh&&en?'bilingual':en?'en_only':'zh_only';
  }
  function baseSchema(legacy,adapter){
    return {
      id:String(legacy.id||''),
      type:canonicalType(legacy.type),
      schemaVersion:SCHEMA_VERSION,
      content:{zh:null,en:null},
      answer:{},
      explanation:{zh:explanationRecord(legacy),en:null},
      config:{},
      metadata:{
        adapter,
        runtimeType:String(legacy.type||''),
        source:'guided-learning-legacy',
        repeatOf:legacy.repeatOf?String(legacy.repeatOf):'',
        translationStatus:'zh_only'
      }
    };
  }
  function choiceFromLegacy(legacy){
    const schema=baseSchema(legacy,'single_choice');
    const options=(legacy.options||[]).map((option,index)=>({
      id:String(option.id||String.fromCharCode(65+index)),
      text:text(option.text),
      feedback:cleanText(option.feedback||'')
    }));
    const correct=legacy.options?.find(option=>option?.correct);
    schema.content.zh={stem:text(legacy.stem),options};
    schema.answer={optionId:String(correct?.id||'')};
    return schema;
  }
  function keywordFromLegacy(legacy){
    const schema=baseSchema(legacy,'keyword_recognition');
    const segments=(legacy.segments||[]).map((segment,index)=>({
      id:String(segment.id||stableId(legacy.id,'segment',index)),
      text:text(segment.text)
    }));
    const targets=(legacy.segments||[]).map((segment,index)=>segment?.target?segments[index]?.id:'').filter(Boolean);
    schema.content.zh={
      instruction:text(legacy.instruction||'请选择关键线索。'),
      segments,
      hints:(legacy.hints||[]).map(text)
    };
    schema.answer={segmentIds:targets,requiredSelectionCount:Number(legacy.requiredSelectionCount)||targets.length};
    schema.config={hintAfterWrong:Math.max(1,Number(legacy.hintAfterWrong)||1)};
    return schema;
  }
  function matchingFromLegacy(legacy){
    const schema=baseSchema(legacy,'matching');
    const pairs=(legacy.pairs||[]).map((pair,index)=>({
      id:String(pair.id||stableId(legacy.id,'pair',index)),
      left:text(pair.left),right:text(pair.right)
    }));
    schema.content.zh={instruction:text(legacy.instruction||'完成全部配对。'),pairs};
    schema.answer={matches:pairs.map(pair=>({leftId:pair.id,rightId:pair.id}))};
    schema.config={rightOrder:Array.isArray(legacy.rightOrder)?legacy.rightOrder.map(String):[...pairs].reverse().map(pair=>pair.id)};
    return schema;
  }
  function openResponseFromLegacy(legacy){
    const schema=baseSchema(legacy,'open_response');
    const concepts=(legacy.requiredConcepts||[]).map((concept,index)=>({
      id:String(concept.id||stableId(legacy.id,'concept',index)),
      acceptedExpressions:unique(concept.acceptedExpressions||[]),
      missingHint:cleanText(concept.missingHint||'')
    }));
    schema.content.zh={
      prompt:text(legacy.prompt),
      placeholder:text(legacy.placeholder||''),
      referenceAnswer:text(legacy.referenceAnswer||legacy.explanation||'')
    };
    schema.answer={
      evaluationMode:String(legacy.evaluationMode||'concept_match'),
      minLength:legacy.minLength===undefined?30:Math.max(1,Number(legacy.minLength)||1),
      maxLength:legacy.maxLength===undefined?140:Math.max(20,Number(legacy.maxLength)||140),
      acceptedConcepts:{zh:concepts,en:[]}
    };
    return schema;
  }
  function memoryFromLegacy(legacy){
    const schema=baseSchema(legacy,'memory_match');
    const pairs=(legacy.pairs||[]).map((pair,index)=>({
      id:String(pair.id||stableId(legacy.id,'pair',index)),left:text(pair.left),right:text(pair.right)
    }));
    schema.content.zh={instruction:text(legacy.instruction||'翻开两张卡片，找出正确配对。'),pairs};
    schema.answer={matches:pairs.map(pair=>({leftId:pair.id,rightId:pair.id}))};
    schema.config={cardOrder:Array.isArray(legacy.cardOrder)?legacy.cardOrder.map(String):[]};
    return schema;
  }
  function passthroughFromLegacy(legacy){
    const schema=baseSchema(legacy,'legacy_passthrough');
    schema.content.zh=without(legacy,['id','type','shortExplanation','detailedExplanation','incorrectFeedback','explanation','repeatOf']);
    schema.answer={adapter:'legacy_runtime'};
    return schema;
  }
  function fromLegacy(legacy,translation=null){
    if(!legacy||typeof legacy!=='object')return null;
    let schema;
    switch(String(legacy.type||'')){
      case 'choice':schema=choiceFromLegacy(legacy);break;
      case 'keyword':schema=keywordFromLegacy(legacy);break;
      case 'matching':schema=matchingFromLegacy(legacy);break;
      case 'open_text':schema=openResponseFromLegacy(legacy);break;
      case 'memory_match':schema=memoryFromLegacy(legacy);break;
      default:schema=passthroughFromLegacy(legacy);break;
    }
    if(translation&&typeof translation==='object')schema=deepMerge(schema,translation);
    schema.metadata={...(schema.metadata||{}),translationStatus:localeStatus(schema.content)};
    return schema;
  }
  function mergeLocalized(zh,en){
    if(!localeHasContent(en))return clone(zh);
    if(!localeHasContent(zh))return clone(en);
    if(typeof zh==='string'||typeof en==='string'){
      const left=text(zh),right=text(en);
      return !left?right:!right||left===right?left:left+'\n'+right;
    }
    if(Array.isArray(zh)||Array.isArray(en)){
      const left=Array.isArray(zh)?zh:[],right=Array.isArray(en)?en:[];
      const byId=new Map(right.filter(item=>item&&typeof item==='object'&&item.id!==undefined).map(item=>[String(item.id),item]));
      return left.map((item,index)=>{
        const peer=item&&typeof item==='object'&&item.id!==undefined?byId.get(String(item.id)):right[index];
        return mergeLocalized(item,peer);
      }).concat(right.slice(left.length).map(clone));
    }
    if(zh&&typeof zh==='object'&&en&&typeof en==='object'){
      const output={};
      new Set([...Object.keys(zh),...Object.keys(en)]).forEach(key=>{output[key]=mergeLocalized(zh[key],en[key])});
      return output;
    }
    return clone(en??zh);
  }
  function localizedValue(localized,mode){
    const normalized=normalizeLanguageMode(mode);
    const zh=localized?.zh,en=localized?.en;
    if(normalized==='en')return localeHasContent(en)?clone(en):clone(zh);
    if(normalized==='bilingual')return mergeLocalized(zh,en);
    return localeHasContent(zh)?clone(zh):clone(en);
  }
  function localizedExplanation(schema,mode){
    const record=localizedValue(schema.explanation,mode)||{};
    return {
      shortExplanation:text(record.short||''),
      detailedExplanation:text(record.detailed||record.general||''),
      incorrectFeedback:text(record.incorrect||''),
      explanation:text(record.general||record.detailed||'')
    };
  }
  function acceptedConcepts(schema,mode){
    const localized=schema.answer?.acceptedConcepts||{};
    const normalized=normalizeLanguageMode(mode);
    if(normalized==='bilingual'){
      const zh=Array.isArray(localized.zh)?localized.zh:[];
      const en=Array.isArray(localized.en)?localized.en:[];
      const enById=new Map(en.map(item=>[String(item.id||''),item]));
      return zh.map((item,index)=>{
        const peer=enById.get(String(item.id||''))||en[index]||{};
        return {
          id:String(item.id||peer.id||''),
          acceptedExpressions:unique([...(item.acceptedExpressions||[]),...(peer.acceptedExpressions||[])]),
          missingHint:mergeLocalized(item.missingHint||'',peer.missingHint||'')
        };
      }).concat(en.slice(zh.length).map(clone));
    }
    const selected=normalized==='en'&&Array.isArray(localized.en)&&localized.en.length?localized.en:localized.zh;
    return clone(Array.isArray(selected)?selected:[]);
  }
  function materialize(schema,mode=getLanguageMode()){
    if(!schema||typeof schema!=='object')return null;
    const normalized=normalizeLanguageMode(mode);
    const content=localizedValue(schema.content,normalized)||{};
    const explanation=localizedExplanation(schema,normalized);
    const base={
      id:String(schema.id||''),
      type:runtimeType(schema.type,schema.metadata),
      ...explanation,
      schemaVersion:Number(schema.schemaVersion)||SCHEMA_VERSION,
      activitySchemaVersion:SCHEMA_VERSION,
      languageMode:normalized,
      languageFallback:normalized!=='zh'&&!localeHasContent(schema.content?.en),
      canonicalType:String(schema.type||''),
      repeatOf:schema.metadata?.repeatOf||undefined
    };
    switch(String(schema.metadata?.adapter||'')){
      case 'single_choice':{
        const answerId=String(schema.answer?.optionId||'');
        return {...base,stem:text(content.stem),options:(content.options||[]).map(option=>({...clone(option),id:String(option.id),text:text(option.text),correct:String(option.id)===answerId}))};
      }
      case 'keyword_recognition':{
        const targets=new Set((schema.answer?.segmentIds||[]).map(String));
        return {...base,instruction:text(content.instruction),segments:(content.segments||[]).map(segment=>({...clone(segment),id:String(segment.id),text:text(segment.text),target:targets.has(String(segment.id))})),hints:(content.hints||[]).map(text),requiredSelectionCount:Number(schema.answer?.requiredSelectionCount)||targets.size,hintAfterWrong:Math.max(1,Number(schema.config?.hintAfterWrong)||1)};
      }
      case 'matching':{
        return {...base,instruction:text(content.instruction),pairs:(content.pairs||[]).map(pair=>({...clone(pair),id:String(pair.id),left:text(pair.left),right:text(pair.right)})),rightOrder:(schema.config?.rightOrder||[]).map(String)};
      }
      case 'open_response':{
        return {...base,prompt:text(content.prompt),placeholder:text(content.placeholder),referenceAnswer:text(content.referenceAnswer),evaluationMode:String(schema.answer?.evaluationMode||'concept_match'),minLength:Math.max(1,Number(schema.answer?.minLength)||1),maxLength:Math.max(20,Number(schema.answer?.maxLength)||140),requiredConcepts:acceptedConcepts(schema,normalized)};
      }
      case 'memory_match':{
        return {...base,instruction:text(content.instruction),pairs:(content.pairs||[]).map(pair=>({...clone(pair),id:String(pair.id),left:text(pair.left),right:text(pair.right)})),cardOrder:(schema.config?.cardOrder||[]).map(String)};
      }
      default:return {...base,...clone(content)};
    }
  }
  function idsForLocale(record,key){return (record?.[key]||[]).map(item=>String(item?.id||'')).filter(Boolean)}
  function sameIds(left,right){return left.length===right.length&&left.every((id,index)=>id===right[index])}
  function validate(schema){
    const errors=[],warnings=[];
    if(!schema||typeof schema!=='object')return {valid:false,errors:['活动必须是对象。'],warnings};
    if(!cleanText(schema.id))errors.push('缺少稳定活动 ID。');
    if(Number(schema.schemaVersion)!==SCHEMA_VERSION)errors.push('schemaVersion 必须为 1。');
    if(!cleanText(schema.type))errors.push('缺少活动类型。');
    if(!localeHasContent(schema.content?.zh)&&!localeHasContent(schema.content?.en))errors.push('至少需要一套语言内容。');
    if(!localeHasContent(schema.content?.en))warnings.push('尚未提供英文内容，将回退显示中文。');
    const type=String(schema.type||'');
    const zh=schema.content?.zh||{},en=schema.content?.en||{};
    const primary=localeHasContent(zh)?zh:en;
    if(type==='single_choice'){
      const optionIds=idsForLocale(primary,'options');
      if(optionIds.length<2)errors.push('单项选择至少需要两个选项。');
      if(new Set(optionIds).size!==optionIds.length)errors.push('选项 ID 必须唯一。');
      if(!optionIds.includes(String(schema.answer?.optionId||'')))errors.push('正确答案 optionId 不在选项中。');
      if(localeHasContent(zh)&&localeHasContent(en)&&!sameIds(idsForLocale(zh,'options'),idsForLocale(en,'options')))errors.push('中英文选项 ID 或顺序不一致。');
    }else if(type==='keyword_recognition'){
      const segmentIds=idsForLocale(primary,'segments');
      const answers=(schema.answer?.segmentIds||[]).map(String);
      if(!segmentIds.length)errors.push('关键词活动缺少分段内容。');
      if(answers.some(id=>!segmentIds.includes(id)))errors.push('关键词答案引用了不存在的 segmentId。');
      if(localeHasContent(zh)&&localeHasContent(en)&&!sameIds(idsForLocale(zh,'segments'),idsForLocale(en,'segments')))errors.push('中英文分段 ID 或顺序不一致。');
    }else if(type==='matching'||type==='memory_match'){
      const pairIds=idsForLocale(primary,'pairs');
      if(!pairIds.length)errors.push('配对活动缺少配对项目。');
      if(new Set(pairIds).size!==pairIds.length)errors.push('配对项目 ID 必须唯一。');
      if(localeHasContent(zh)&&localeHasContent(en)&&!sameIds(idsForLocale(zh,'pairs'),idsForLocale(en,'pairs')))errors.push('中英文配对项目 ID 或顺序不一致。');
    }else if(type==='open_response'){
      if(!cleanText(zh.prompt)&&!cleanText(en.prompt))errors.push('开放表达缺少题目提示。');
      if(!cleanText(schema.answer?.evaluationMode))warnings.push('开放表达未指定判定模式。');
    }else if(!STANDARD_TYPES.has(type)){
      warnings.push('复杂活动暂由兼容适配器运行，后续应迁移到专用结构。');
    }
    return {valid:errors.length===0,errors,warnings};
  }
  function migrateLibrary(legacyLibrary,translations={}){
    const output={};
    Object.entries(legacyLibrary||{}).forEach(([id,legacy])=>{
      const schema=fromLegacy({...clone(legacy),id:String(legacy?.id||id)},translations?.[id]);
      if(schema)output[schema.id]=schema;
    });
    return output;
  }
  function validateLibrary(library){
    const results={},errors=[],warnings=[];
    Object.entries(library||{}).forEach(([id,activity])=>{
      const result=validate(activity);results[id]=result;
      result.errors.forEach(message=>errors.push({activityId:id,message}));
      result.warnings.forEach(message=>warnings.push({activityId:id,message}));
    });
    return {valid:errors.length===0,activityCount:Object.keys(library||{}).length,errors,warnings,results};
  }
  function hashString(value){
    let hash=2166136261;
    for(const char of String(value||'')){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}
    return (hash>>>0).toString(16).padStart(8,'0');
  }
  function createPackage(library,metadata={}){
    const activities=Object.values(library||{}).map(clone).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    const timestamp=new Date().toISOString();
    const packageId=String(metadata.packageId||'activity-package-'+hashString(activities.map(item=>item.id).join('|')));
    const packageVersion=Math.max(1,Number(metadata.packageVersion)||1);
    const payload={packageId,packageVersion,schemaVersion:SCHEMA_VERSION,createdAt:String(metadata.createdAt||timestamp),updatedAt:timestamp,author:String(metadata.author||''),activities};
    payload.contentHash='fnv1a32:'+hashString(JSON.stringify(activities));
    return payload;
  }
  function validatePackage(payload){
    const errors=[];
    if(!payload||typeof payload!=='object')return {valid:false,errors:['导入包必须是对象。'],libraryValidation:null};
    if(Number(payload.schemaVersion)!==SCHEMA_VERSION)errors.push('导入包 schemaVersion 必须为 1。');
    if(!cleanText(payload.packageId))errors.push('导入包缺少 packageId。');
    if(!Array.isArray(payload.activities))errors.push('导入包 activities 必须是数组。');
    const library={};
    (payload.activities||[]).forEach(activity=>{if(activity?.id)library[String(activity.id)]=activity});
    const libraryValidation=validateLibrary(library);
    return {valid:errors.length===0&&libraryValidation.valid,errors:[...errors,...libraryValidation.errors.map(item=>item.activityId+': '+item.message)],libraryValidation};
  }

  global.KGActivitySchemaV1=Object.freeze({
    SCHEMA_VERSION,
    LANGUAGE_STORAGE_KEY,
    LANGUAGE_MODES,
    canonicalType,
    runtimeType,
    normalizeLanguageMode,
    getLanguageMode,
    setLanguageMode,
    fromLegacy,
    migrateLibrary,
    materialize,
    validate,
    validateLibrary,
    createPackage,
    validatePackage,
    hasLocale:(schema,locale)=>localeHasContent(schema?.content?.[String(locale||'')]),
    clone
  });
})(window);
