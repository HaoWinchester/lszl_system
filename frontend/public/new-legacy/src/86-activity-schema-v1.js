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
  const STUDENT_LANGUAGE_MODES=Object.freeze(['zh','bilingual']);
  const ASSESSMENT_LANGUAGE='zh';
  const TYPE_TO_CANONICAL=Object.freeze({
    choice:'single_choice',
    keyword:'keyword_recognition',
    ordering:'ordering',
    order:'ordering',
    matching:'matching',
    open_text:'open_response',
    memory_match:'memory_match',
    deep_recall:'deep_recall',
    multi_question_induction:'multi_question_induction',
    knowledge_graph:'knowledge_graph',
    part_challenge:'part_challenge'
  });
  const TYPE_TO_RUNTIME=Object.freeze({
    single_choice:'choice',
    keyword_recognition:'keyword',
    ordering:'ordering',
    matching:'matching',
    open_response:'open_text',
    memory_match:'memory_match',
    deep_recall:'deep_recall',
    multi_question_induction:'multi_question_induction',
    knowledge_graph:'knowledge_graph',
    part_challenge:'part_challenge'
  });
  const STANDARD_TYPES=new Set(['single_choice','keyword_recognition','ordering','matching','open_response','memory_match']);
  const SUPPORTED_TYPES=new Set(Object.keys(TYPE_TO_RUNTIME));

  function clone(value){try{return JSON.parse(JSON.stringify(value))}catch(error){return value}}
  function text(value){return String(value??'')}
  function cleanText(value){return text(value).trim()}
  function normalizeLanguageMode(mode){return LANGUAGE_MODES.includes(String(mode||''))?String(mode):'zh'}
  function normalizeStudentLanguageMode(mode){
    const value=normalizeLanguageMode(mode);
    return STUDENT_LANGUAGE_MODES.includes(value)?value:(value==='en'?'bilingual':'zh');
  }
  function getLanguageMode(){
    try{return normalizeLanguageMode(global.localStorage?.getItem(LANGUAGE_STORAGE_KEY)||'zh')}catch(error){return 'zh'}
  }
  function setLanguageMode(mode){
    const value=normalizeLanguageMode(mode);
    try{global.localStorage?.setItem(LANGUAGE_STORAGE_KEY,value)}catch(error){}
    try{global.dispatchEvent?.(new CustomEvent('kg:question-language-mode',{detail:{mode:value}}))}catch(error){}
    return value;
  }
  function getPracticeAutoExplain(){
    try{const value=global.localStorage?.getItem('kg_practice_auto_explanation_v1');return value===null?true:value==='1'}catch(error){return true}
  }
  function setPracticeAutoExplain(enabled){
    try{global.localStorage?.setItem('kg_practice_auto_explanation_v1',enabled?'1':'0')}catch(error){}
  }
  function canonicalType(type){
    const value=String(type||'').trim();
    return TYPE_TO_CANONICAL[value]||(SUPPORTED_TYPES.has(value)?value:value||'unknown');
  }
  function runtimeType(type){return String(TYPE_TO_RUNTIME[String(type||'')]||'unknown')}
  function adapterForType(type){return STANDARD_TYPES.has(String(type||''))?String(type):'legacy_passthrough'}
  function normalizeActivityRecord(activity){
    const record=clone(activity)||{};
    if(Number(record.schemaVersion)===SCHEMA_VERSION&&!record.assessment)record.assessment={language:ASSESSMENT_LANGUAGE};
    return record;
  }
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
  function baseSchema(legacy){
    const type=canonicalType(legacy.type);
    return {
      id:String(legacy.id||''),
      type,
      schemaVersion:SCHEMA_VERSION,
      content:{zh:null,en:null},
      answer:{},
      explanation:{zh:explanationRecord(legacy),en:null},
      assessment:{language:ASSESSMENT_LANGUAGE},
      config:{},
      metadata:{
        adapter:adapterForType(type),
        runtimeType:runtimeType(type),
        source:'guided-learning-legacy',
        repeatOf:legacy.repeatOf?String(legacy.repeatOf):'',
        translationStatus:'zh_only'
      }
    };
  }
  function choiceFromLegacy(legacy){
    const schema=baseSchema(legacy);
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
    const schema=baseSchema(legacy);
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
  function orderingFromLegacy(legacy){
    const schema=baseSchema(legacy);
    const items=(legacy.items||[]).map((item,index)=>({
      id:String(item?.id||stableId(legacy.id,'item',index)),
      text:text(item?.text)
    }));
    const correctOrder=(legacy.correctOrder||legacy.itemIds||items.map(item=>item.id)).map(String);
    schema.content.zh={
      instruction:text(legacy.instruction||'请按照正确顺序排列。'),
      items,
      hints:(legacy.hints||[]).map(text)
    };
    schema.answer={itemIds:correctOrder};
    schema.config={displayOrder:Array.isArray(legacy.displayOrder)?legacy.displayOrder.map(String):[...items].reverse().map(item=>item.id)};
    return schema;
  }
  function matchingFromLegacy(legacy){
    const schema=baseSchema(legacy);
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
    const schema=baseSchema(legacy);
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
      acceptedConcepts:{zh:concepts}
    };
    return schema;
  }
  function memoryFromLegacy(legacy){
    const schema=baseSchema(legacy);
    const pairs=(legacy.pairs||[]).map((pair,index)=>({
      id:String(pair.id||stableId(legacy.id,'pair',index)),left:text(pair.left),right:text(pair.right)
    }));
    schema.content.zh={instruction:text(legacy.instruction||'翻开两张卡片，找出正确配对。'),pairs};
    schema.answer={matches:pairs.map(pair=>({leftId:pair.id,rightId:pair.id}))};
    schema.config={cardOrder:Array.isArray(legacy.cardOrder)?legacy.cardOrder.map(String):[]};
    return schema;
  }
  function passthroughFromLegacy(legacy){
    const schema=baseSchema(legacy);
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
      case 'ordering':
      case 'order':schema=orderingFromLegacy(legacy);break;
      case 'matching':schema=matchingFromLegacy(legacy);break;
      case 'open_text':schema=openResponseFromLegacy(legacy);break;
      case 'memory_match':schema=memoryFromLegacy(legacy);break;
      default:schema=passthroughFromLegacy(legacy);break;
    }
    if(translation&&typeof translation==='object')schema=deepMerge(schema,translation);
    schema.metadata={...(schema.metadata||{}),translationStatus:localeStatus(schema.content)};
    return schema;
  }
  function peerIndex(items,item,index,used){
    if(item&&typeof item==='object'&&item.id!==undefined){
      const id=String(item.id);
      const found=items.findIndex((candidate,candidateIndex)=>!used.has(candidateIndex)&&candidate&&typeof candidate==='object'&&String(candidate.id)===id);
      if(found>=0)return found;
    }
    return index<items.length&&!used.has(index)?index:-1;
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
      const used=new Set();
      const output=left.map((item,index)=>{
        const matchedIndex=peerIndex(right,item,index,used);
        if(matchedIndex>=0)used.add(matchedIndex);
        return mergeLocalized(item,matchedIndex>=0?right[matchedIndex]:undefined);
      });
      right.forEach((item,index)=>{if(!used.has(index))output.push(clone(item))});
      return output;
    }
    if(zh&&typeof zh==='object'&&en&&typeof en==='object'){
      const output={};
      new Set([...Object.keys(zh),...Object.keys(en)]).forEach(key=>{output[key]=mergeLocalized(zh[key],en[key])});
      return output;
    }
    return clone(en??zh);
  }
  function preferLocalized(preferred,fallback){
    if(!localeHasContent(preferred))return clone(fallback);
    if(!localeHasContent(fallback))return clone(preferred);
    if(typeof preferred==='string'||typeof fallback==='string'){
      return cleanText(preferred)?text(preferred):text(fallback);
    }
    if(Array.isArray(preferred)||Array.isArray(fallback)){
      const primary=Array.isArray(preferred)?preferred:[],backup=Array.isArray(fallback)?fallback:[];
      const used=new Set();
      const output=backup.map((item,index)=>{
        const matchedIndex=peerIndex(primary,item,index,used);
        if(matchedIndex>=0)used.add(matchedIndex);
        return preferLocalized(matchedIndex>=0?primary[matchedIndex]:undefined,item);
      });
      primary.forEach((item,index)=>{if(!used.has(index))output.push(clone(item))});
      return output;
    }
    if(preferred&&typeof preferred==='object'&&fallback&&typeof fallback==='object'){
      const output={};
      new Set([...Object.keys(fallback),...Object.keys(preferred)]).forEach(key=>{output[key]=preferLocalized(preferred[key],fallback[key])});
      return output;
    }
    return clone(preferred??fallback);
  }
  function localeNeedsFallback(fallback,preferred){
    if(!localeHasContent(fallback))return false;
    if(!localeHasContent(preferred))return true;
    if(typeof fallback==='string'||typeof preferred==='string')return Boolean(cleanText(fallback)&&!cleanText(preferred));
    if(Array.isArray(fallback)||Array.isArray(preferred)){
      const backup=Array.isArray(fallback)?fallback:[],primary=Array.isArray(preferred)?preferred:[];
      const used=new Set();
      return backup.some((item,index)=>{
        const matchedIndex=peerIndex(primary,item,index,used);
        if(matchedIndex>=0)used.add(matchedIndex);
        return matchedIndex<0||localeNeedsFallback(item,primary[matchedIndex]);
      });
    }
    if(fallback&&typeof fallback==='object'&&preferred&&typeof preferred==='object'){
      return Object.keys(fallback).some(key=>localeNeedsFallback(fallback[key],preferred[key]));
    }
    return false;
  }
  function localizedValue(localized,mode){
    const normalized=normalizeLanguageMode(mode);
    const zh=localized?.zh,en=localized?.en;
    if(normalized==='en')return preferLocalized(en,zh);
    if(normalized==='bilingual')return mergeLocalized(zh,en);
    return preferLocalized(zh,en);
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
  function acceptedConcepts(schema){
    const localized=schema.answer?.acceptedConcepts||{};
    return clone(Array.isArray(localized.zh)?localized.zh:[]);
  }
  function materialize(schema,mode=getLanguageMode()){
    if(!schema||typeof schema!=='object')return null;
    const normalized=normalizeLanguageMode(mode);
    const content=localizedValue(schema.content,normalized)||{};
    const explanation=localizedExplanation(schema,normalized);
    const base={
      id:String(schema.id||''),
      type:runtimeType(schema.type),
      ...explanation,
      schemaVersion:Number(schema.schemaVersion)||SCHEMA_VERSION,
      activitySchemaVersion:SCHEMA_VERSION,
      languageMode:normalized,
      languageFallback:normalized!=='zh'&&localeNeedsFallback(schema.content?.zh,schema.content?.en),
      canonicalType:String(schema.type||''),
      assessmentLanguage:ASSESSMENT_LANGUAGE,
      answerLanguage:ASSESSMENT_LANGUAGE,
      repeatOf:schema.metadata?.repeatOf||undefined
    };
    switch(String(schema.type||'')){
      case 'single_choice':{
        const answerId=String(schema.answer?.optionId||'');
        return {...base,stem:text(content.stem),options:(content.options||[]).map(option=>({...clone(option),id:String(option.id),text:text(option.text),correct:String(option.id)===answerId}))};
      }
      case 'keyword_recognition':{
        const targets=new Set((schema.answer?.segmentIds||[]).map(String));
        return {...base,instruction:text(content.instruction),segments:(content.segments||[]).map(segment=>({...clone(segment),id:String(segment.id),text:text(segment.text),target:targets.has(String(segment.id))})),hints:(content.hints||[]).map(text),requiredSelectionCount:Number(schema.answer?.requiredSelectionCount)||targets.size,hintAfterWrong:Math.max(1,Number(schema.config?.hintAfterWrong)||1)};
      }
      case 'ordering':{
        return {...base,instruction:text(content.instruction),items:(content.items||[]).map(item=>({...clone(item),id:String(item.id),text:text(item.text)})),correctOrder:(schema.answer?.itemIds||[]).map(String),displayOrder:(schema.config?.displayOrder||[]).map(String),hints:(content.hints||[]).map(text)};
      }
      case 'matching':{
        return {...base,instruction:text(content.instruction),pairs:(content.pairs||[]).map(pair=>({...clone(pair),id:String(pair.id),left:text(pair.left),right:text(pair.right)})),rightOrder:(schema.config?.rightOrder||[]).map(String)};
      }
      case 'open_response':{
        return {...base,prompt:text(content.prompt),placeholder:text(content.placeholder),referenceAnswer:text(content.referenceAnswer),evaluationMode:String(schema.answer?.evaluationMode||'concept_match'),minLength:Math.max(1,Number(schema.answer?.minLength)||1),maxLength:Math.max(20,Number(schema.answer?.maxLength)||140),requiredConcepts:acceptedConcepts(schema)};
      }
      case 'memory_match':{
        return {...base,instruction:text(content.instruction),pairs:(content.pairs||[]).map(pair=>({...clone(pair),id:String(pair.id),left:text(pair.left),right:text(pair.right)})),cardOrder:(schema.config?.cardOrder||[]).map(String)};
      }
      default:return {...base,...clone(content)};
    }
  }
  function idsForLocale(record,key){return (record?.[key]||[]).map(item=>String(item?.id||'')).filter(Boolean)}
  function sameIds(left,right){return left.length===right.length&&left.every((id,index)=>id===right[index])}
  function duplicateValues(values){
    const seen=new Set(),duplicates=new Set();
    (values||[]).forEach(value=>{const id=String(value||'');if(!id)return;if(seen.has(id))duplicates.add(id);else seen.add(id)});
    return [...duplicates];
  }
  function validatePairAnswer(schema,pairIds,errors){
    const matches=Array.isArray(schema.answer?.matches)?schema.answer.matches:[];
    if(matches.length!==pairIds.length)errors.push('配对答案数量必须与配对项目数量一致。');
    const leftIds=matches.map(item=>String(item?.leftId||''));
    const rightIds=matches.map(item=>String(item?.rightId||''));
    if(duplicateValues(leftIds).length||duplicateValues(rightIds).length)errors.push('配对答案中的 leftId 和 rightId 必须唯一。');
    if(matches.some(item=>!pairIds.includes(String(item?.leftId||''))||!pairIds.includes(String(item?.rightId||''))))errors.push('配对答案引用了不存在的项目 ID。');
  }
  function validatePrimaryTextList(items,fields,label,errors){
    (items||[]).forEach((item,index)=>fields.forEach(field=>{if(!cleanText(item?.[field]))errors.push(label+'第 '+(index+1)+' 项缺少 '+field+'。')}));
  }
  function validateConceptList(items,label,errors){
    const list=Array.isArray(items)?items:[];
    const ids=list.map(item=>String(item?.id||''));
    if(duplicateValues(ids).length)errors.push(label+'概念 ID 必须唯一。');
    list.forEach((item,index)=>{
      if(!cleanText(item?.id))errors.push(label+'第 '+(index+1)+' 个概念缺少稳定 ID。');
      if(!unique(item?.acceptedExpressions||[]).length)errors.push(label+'第 '+(index+1)+' 个概念缺少可接受表达。');
    });
  }
  function validate(schema){
    const errors=[],warnings=[];
    if(!schema||typeof schema!=='object')return {valid:false,errors:['活动必须是对象。'],warnings};
    if(typeof schema.id!=='string'||!cleanText(schema.id))errors.push('缺少字符串形式的稳定活动 ID。');
    if(schema.schemaVersion!==SCHEMA_VERSION)errors.push('schemaVersion 必须为数字 1。');
    if(typeof schema.type!=='string'||!cleanText(schema.type))errors.push('缺少字符串形式的活动类型。');
    const type=String(schema.type||'');
    if(type&&!SUPPORTED_TYPES.has(type))errors.push('不支持的活动类型：'+type+'。');
    if(!schema.content||typeof schema.content!=='object'||Array.isArray(schema.content))errors.push('content 必须是中英文内容对象。');
    else{
      if(!Object.prototype.hasOwnProperty.call(schema.content,'zh'))errors.push('content 缺少 zh 字段。');
      if(!Object.prototype.hasOwnProperty.call(schema.content,'en'))errors.push('content 缺少 en 字段；没有英文时请显式填写 null。');
    }
    if(schema.content?.zh!==undefined&&(!schema.content.zh||typeof schema.content.zh!=='object'||Array.isArray(schema.content.zh)))errors.push('content.zh 必须是中文内容对象。');
    if(schema.content?.en!==null&&schema.content?.en!==undefined&&(typeof schema.content.en!=='object'||Array.isArray(schema.content.en)))errors.push('content.en 必须是英文内容对象或 null。');
    if(!localeHasContent(schema.content?.zh))errors.push('中文内容 content.zh 为必填项。');
    if(!schema.answer||typeof schema.answer!=='object'||Array.isArray(schema.answer))errors.push('answer 必须是对象。');
    if(!schema.explanation||typeof schema.explanation!=='object'||Array.isArray(schema.explanation))errors.push('explanation 必须是中英文解析对象。');
    else{
      if(!Object.prototype.hasOwnProperty.call(schema.explanation,'zh'))errors.push('explanation 缺少 zh 字段。');
      if(!Object.prototype.hasOwnProperty.call(schema.explanation,'en'))errors.push('explanation 缺少 en 字段；没有英文解析时请显式填写 null。');
      if(!schema.explanation.zh||typeof schema.explanation.zh!=='object'||Array.isArray(schema.explanation.zh))errors.push('explanation.zh 必须是中文解析对象。');
    }
    if(schema.explanation?.en!==null&&schema.explanation?.en!==undefined&&(typeof schema.explanation.en!=='object'||Array.isArray(schema.explanation.en)))errors.push('explanation.en 必须是英文解析对象或 null。');
    if(!schema.assessment||typeof schema.assessment!=='object'||Array.isArray(schema.assessment))errors.push('assessment 必须是对象。');
    else if(schema.assessment.language!==ASSESSMENT_LANGUAGE)errors.push('当前版本 assessment.language 必须为字符串 zh。');
    if(!schema.metadata||typeof schema.metadata!=='object'||Array.isArray(schema.metadata))errors.push('metadata 必须是对象。');
    else{
      if(schema.metadata.subjectId!==undefined&&!cleanText(schema.metadata.subjectId))errors.push('metadata.subjectId 必须是非空字符串。');
      if(schema.metadata.knowledge!==undefined){
        const knowledge=schema.metadata.knowledge;
        if(!knowledge||typeof knowledge!=='object'||Array.isArray(knowledge))errors.push('metadata.knowledge 必须是对象。');
        else{
          if(!cleanText(knowledge.taxonomyId))errors.push('metadata.knowledge.taxonomyId 不能为空。');
          if(!Number.isInteger(Number(knowledge.taxonomyVersion))||Number(knowledge.taxonomyVersion)<1)errors.push('metadata.knowledge.taxonomyVersion 必须是正整数。');
          if(knowledge.primaryNodeId!==null&&knowledge.primaryNodeId!==undefined&&!cleanText(knowledge.primaryNodeId))errors.push('metadata.knowledge.primaryNodeId 必须是知识点 ID 或 null。');
          if(!Array.isArray(knowledge.relatedNodeIds))errors.push('metadata.knowledge.relatedNodeIds 必须是数组。');
          else if(new Set(knowledge.relatedNodeIds.map(String)).size!==knowledge.relatedNodeIds.length)errors.push('metadata.knowledge.relatedNodeIds 不能重复。');
          if(!['unmapped','suggested','confirmed'].includes(String(knowledge.mappingStatus||'')))errors.push('metadata.knowledge.mappingStatus 必须为 unmapped、suggested 或 confirmed。');
          if(String(knowledge.mappingStatus)==='confirmed'&&!cleanText(knowledge.primaryNodeId))errors.push('已确认归类的活动必须填写 primaryNodeId。');
        }
      }
      if(schema.metadata.authorship!==undefined){
        const authorship=schema.metadata.authorship;
        if(!authorship||typeof authorship!=='object'||Array.isArray(authorship))errors.push('metadata.authorship 必须是对象。');
        else if(!cleanText(authorship.createdByUserId)||!cleanText(authorship.updatedByUserId))errors.push('metadata.authorship 必须记录创建者和最后修改者账号 ID。');
      }
    }
    if(schema.config!==undefined&&(!schema.config||typeof schema.config!=='object'||Array.isArray(schema.config)))errors.push('config 必须是对象。');
    if(!localeHasContent(schema.content?.en))warnings.push('尚未提供英文内容，将回退显示中文。');
    else if(localeHasContent(schema.content?.zh)&&localeNeedsFallback(schema.content.zh,schema.content.en))warnings.push('英文内容不完整，缺失字段将回退显示中文。');
    if(localeHasContent(schema.explanation?.en)&&localeHasContent(schema.explanation?.zh)&&localeNeedsFallback(schema.explanation.zh,schema.explanation.en))warnings.push('英文解析不完整，缺失字段将回退显示中文。');
    const zh=schema.content?.zh||{},en=schema.content?.en||{};
    const primary=localeHasContent(zh)?zh:en;
    const expectedAdapter=adapterForType(type);
    const expectedRuntime=runtimeType(type);
    if(cleanText(schema.metadata?.adapter)&&String(schema.metadata.adapter)!==expectedAdapter)errors.push('metadata.adapter 与活动 type 不一致，应为 '+expectedAdapter+'。');
    if(cleanText(schema.metadata?.runtimeType)&&String(schema.metadata.runtimeType)!==expectedRuntime)errors.push('metadata.runtimeType 与活动 type 不一致，应为 '+expectedRuntime+'。');
    if(type==='single_choice'){
      const optionIds=idsForLocale(primary,'options');
      if(!cleanText(primary.stem))errors.push('单项选择缺少题干。');
      if(optionIds.length<2)errors.push('单项选择至少需要两个选项。');
      if(new Set(optionIds).size!==optionIds.length)errors.push('选项 ID 必须唯一。');
      validatePrimaryTextList(primary.options,['id','text'],'单项选择',errors);
      if(!optionIds.includes(String(schema.answer?.optionId||'')))errors.push('正确答案 optionId 不在选项中。');
      if(localeHasContent(zh)&&localeHasContent(en)&&!sameIds(idsForLocale(zh,'options'),idsForLocale(en,'options')))errors.push('中英文选项 ID 或顺序不一致。');
    }else if(type==='keyword_recognition'){
      const segmentIds=idsForLocale(primary,'segments');
      const answers=(schema.answer?.segmentIds||[]).map(String);
      const required=Number(schema.answer?.requiredSelectionCount);
      if(!cleanText(primary.instruction))errors.push('关键词活动缺少操作说明。');
      if(!segmentIds.length)errors.push('关键词活动缺少分段内容。');
      if(new Set(segmentIds).size!==segmentIds.length)errors.push('关键词 segmentId 必须唯一。');
      validatePrimaryTextList(primary.segments,['id','text'],'关键词分段',errors);
      if(duplicateValues(answers).length)errors.push('关键词答案 segmentId 不能重复。');
      if(answers.some(id=>!segmentIds.includes(id)))errors.push('关键词答案引用了不存在的 segmentId。');
      if(!Number.isInteger(required)||required<1||required>segmentIds.length)errors.push('requiredSelectionCount 必须是有效的选择数量。');
      else if(required!==answers.length)errors.push('requiredSelectionCount 必须与正确 segmentId 数量一致。');
      if(localeHasContent(zh)&&localeHasContent(en)&&!sameIds(idsForLocale(zh,'segments'),idsForLocale(en,'segments')))errors.push('中英文分段 ID 或顺序不一致。');
    }else if(type==='ordering'){
      const itemIds=idsForLocale(primary,'items');
      const answerIds=Array.isArray(schema.answer?.itemIds)?schema.answer.itemIds.map(String):[];
      if(!cleanText(primary.instruction))errors.push('排序活动缺少操作说明。');
      if(itemIds.length<2)errors.push('排序活动至少需要两个排序项。');
      if(new Set(itemIds).size!==itemIds.length)errors.push('排序项 ID 必须唯一。');
      validatePrimaryTextList(primary.items,['id','text'],'排序',errors);
      if(!sameIds([...answerIds].sort(),[...itemIds].sort()))errors.push('排序答案 itemIds 必须完整且只包含现有排序项 ID。');
      if(localeHasContent(zh)&&localeHasContent(en)&&!sameIds(idsForLocale(zh,'items'),idsForLocale(en,'items')))errors.push('中英文排序项 ID 或顺序不一致。');
      if(Array.isArray(schema.config?.displayOrder)&&schema.config.displayOrder.length){
        const displayOrder=schema.config.displayOrder.map(String);
        if(!sameIds([...displayOrder].sort(),[...itemIds].sort()))errors.push('displayOrder 必须完整且只包含现有排序项 ID。');
      }
    }else if(type==='matching'||type==='memory_match'){
      const pairIds=idsForLocale(primary,'pairs');
      if(!cleanText(primary.instruction))errors.push('配对活动缺少操作说明。');
      if(!pairIds.length)errors.push('配对活动缺少配对项目。');
      if(new Set(pairIds).size!==pairIds.length)errors.push('配对项目 ID 必须唯一。');
      validatePrimaryTextList(primary.pairs,['id','left','right'],'配对',errors);
      validatePairAnswer(schema,pairIds,errors);
      if(localeHasContent(zh)&&localeHasContent(en)&&!sameIds(idsForLocale(zh,'pairs'),idsForLocale(en,'pairs')))errors.push('中英文配对项目 ID 或顺序不一致。');
      if(type==='matching'&&Array.isArray(schema.config?.rightOrder)&&schema.config.rightOrder.length){
        const rightOrder=schema.config.rightOrder.map(String);
        if(!sameIds([...rightOrder].sort(),[...pairIds].sort()))errors.push('rightOrder 必须完整且只包含现有 pairId。');
      }
      if(type==='memory_match'&&Array.isArray(schema.config?.cardOrder)&&schema.config.cardOrder.length){
        const expected=pairIds.flatMap(id=>[id+':left',id+':right']).sort();
        const actual=schema.config.cardOrder.map(String).sort();
        if(!sameIds(actual,expected))errors.push('cardOrder 必须完整且只包含现有卡片 ID。');
      }
    }else if(type==='open_response'){
      if(!cleanText(primary.prompt))errors.push('开放表达缺少题目提示。');
      if(!cleanText(schema.answer?.evaluationMode))warnings.push('开放表达未指定判定模式。');
      const minLength=Number(schema.answer?.minLength),maxLength=Number(schema.answer?.maxLength);
      if(!Number.isFinite(minLength)||minLength<1)errors.push('开放表达 minLength 必须大于等于 1。');
      if(!Number.isFinite(maxLength)||maxLength<minLength)errors.push('开放表达 maxLength 不能小于 minLength。');
      const zhConcepts=Array.isArray(schema.answer?.acceptedConcepts?.zh)?schema.answer.acceptedConcepts.zh:[];
      const enConcepts=Array.isArray(schema.answer?.acceptedConcepts?.en)?schema.answer.acceptedConcepts.en:[];
      if(String(schema.answer?.evaluationMode||'')==='concept_match'&&!zhConcepts.length)errors.push('概念匹配型开放表达至少需要一个中文判定概念。');
      validateConceptList(zhConcepts,'中文',errors);
      if(enConcepts.length)warnings.push('英文判定概念为未来扩展预留，当前运行器不会使用。');
    }else if(SUPPORTED_TYPES.has(type)&&!STANDARD_TYPES.has(type)){
      warnings.push('复杂活动暂由兼容适配器运行，后续应迁移到专用结构。');
    }
    const declaredStatus=cleanText(schema.metadata?.translationStatus);
    const actualStatus=localeStatus(schema.content);
    if(!declaredStatus)errors.push('metadata.translationStatus 为必填项。');
    else if(!['zh_only','bilingual'].includes(declaredStatus))errors.push('metadata.translationStatus 值无效；当前版本只允许 zh_only 或 bilingual。');
    else if(declaredStatus!==actualStatus)warnings.push('metadata.translationStatus 与实际语言内容不一致。');
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
      const result=validate(activity);
      const entryErrors=[...result.errors];
      if(String(activity?.id||'')!==String(id))entryErrors.push('活动库键名与活动 id 不一致。');
      const entryResult={valid:entryErrors.length===0,errors:entryErrors,warnings:[...result.warnings]};
      results[id]=entryResult;
      entryResult.errors.forEach(message=>errors.push({activityId:id,message}));
      entryResult.warnings.forEach(message=>warnings.push({activityId:id,message}));
    });
    return {valid:errors.length===0,activityCount:Object.keys(library||{}).length,errors,warnings,results};
  }
  function hashString(value){
    let hash=2166136261;
    for(const char of String(value||'')){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619)}
    return (hash>>>0).toString(16).padStart(8,'0');
  }
  function sortedActivities(activities){return (activities||[]).map(clone).sort((a,b)=>String(a?.id||'').localeCompare(String(b?.id||'')))}
  function contentHashForActivities(activities){return 'fnv1a32:'+hashString(JSON.stringify(sortedActivities(activities)))}
  function validIsoDateTime(value){
    if(typeof value!=='string')return false;
    const raw=value.trim();
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw))return false;
    return Number.isFinite(Date.parse(raw));
  }
  function createPackage(library,metadata={}){
    const activities=sortedActivities(Object.values(library||{}));
    const timestamp=new Date().toISOString();
    const packageId=String(metadata.packageId||'activity-package-'+hashString(activities.map(item=>item.id).join('|')));
    const requestedVersion=Number(metadata.packageVersion);
    const packageVersion=Number.isInteger(requestedVersion)&&requestedVersion>=1?requestedVersion:1;
    const createdAt=validIsoDateTime(metadata.createdAt)?String(metadata.createdAt):timestamp;
    const payload={packageId,packageVersion,schemaVersion:SCHEMA_VERSION,createdAt,updatedAt:timestamp,author:String(metadata.author||''),activities};
    payload.contentHash=contentHashForActivities(activities);
    return payload;
  }
  function validatePackage(payload){
    const errors=[];
    if(!payload||typeof payload!=='object'||Array.isArray(payload))return {valid:false,errors:['导入包必须是对象。'],libraryValidation:null};
    if(payload.schemaVersion!==SCHEMA_VERSION)errors.push('导入包 schemaVersion 必须为数字 1。');
    if(typeof payload.packageId!=='string'||!cleanText(payload.packageId))errors.push('导入包缺少字符串 packageId。');
    if(!Object.prototype.hasOwnProperty.call(payload,'author')||typeof payload.author!=='string')errors.push('导入包 author 必须是字符串。');
    if(typeof payload.packageVersion!=='number'||!Number.isInteger(payload.packageVersion)||payload.packageVersion<1)errors.push('导入包 packageVersion 必须是大于等于 1 的数字整数。');
    if(!validIsoDateTime(payload.createdAt))errors.push('导入包 createdAt 必须是标准 ISO 时间。');
    if(!validIsoDateTime(payload.updatedAt))errors.push('导入包 updatedAt 必须是标准 ISO 时间。');
    if(validIsoDateTime(payload.createdAt)&&validIsoDateTime(payload.updatedAt)&&Date.parse(payload.updatedAt)<Date.parse(payload.createdAt))errors.push('导入包 updatedAt 不能早于 createdAt。');
    const activities=Array.isArray(payload.activities)?payload.activities:[];
    if(!Array.isArray(payload.activities))errors.push('导入包 activities 必须是数组。');
    else if(!activities.length)errors.push('导入包至少需要包含一个活动。');
    const library={},seen=new Set();
    activities.forEach((activity,index)=>{
      if(!activity||typeof activity!=='object'||Array.isArray(activity)){errors.push('activities['+index+'] 必须是活动对象。');return}
      const id=cleanText(activity.id);
      if(!id){errors.push('activities['+index+'] 缺少稳定活动 ID。');return}
      if(seen.has(id)){
        const sameContent=JSON.stringify(library[id])===JSON.stringify(normalizeActivityRecord(activity));
        errors.push((sameContent?'活动 ID 重复：':'活动 ID 冲突：')+id);
        return;
      }
      seen.add(id);library[id]=normalizeActivityRecord(activity);
    });
    const expectedHash=contentHashForActivities(activities);
    if(!cleanText(payload.contentHash))errors.push('导入包缺少 contentHash。');
    else if(!/^fnv1a32:[0-9a-f]{8}$/.test(String(payload.contentHash)))errors.push('导入包 contentHash 格式无效。');
    else if(String(payload.contentHash)!==expectedHash)errors.push('导入包 contentHash 校验失败，内容可能已损坏或被修改。');
    const libraryValidation=validateLibrary(library);
    return {valid:errors.length===0&&libraryValidation.valid,errors:[...errors,...libraryValidation.errors.map(item=>item.activityId+': '+item.message)],libraryValidation};
  }

  function parsePackage(input){
    let payload=input;
    if(typeof input==='string'){
      try{payload=JSON.parse(input)}catch(error){return {valid:false,errors:['导入包不是有效 JSON：'+String(error?.message||error)],payload:null,library:null,libraryValidation:null}}
    }
    const validation=validatePackage(payload);
    const library={};
    if(Array.isArray(payload?.activities))payload.activities.forEach(activity=>{if(activity?.id&&!library[String(activity.id)])library[String(activity.id)]=normalizeActivityRecord(activity)});
    return {valid:validation.valid,errors:[...validation.errors],payload:clone(payload),library,libraryValidation:validation.libraryValidation};
  }
  function activityFingerprint(activity,{ignoreId=false}={}){
    const record=normalizeActivityRecord(activity);
    if(ignoreId){
      return hashString(JSON.stringify({type:record.type,schemaVersion:record.schemaVersion,content:record.content,answer:record.answer,explanation:record.explanation,assessment:record.assessment,config:record.config||{}}));
    }
    return hashString(JSON.stringify(record));
  }
  function analyzePackageMerge(existingLibrary,input){
    const parsed=parsePackage(input);
    const report={newActivities:[],unchanged:[],conflicts:[],duplicateContent:[]};
    if(!parsed.valid)return {valid:false,errors:parsed.errors,report,package:parsed.payload};
    const existing=existingLibrary&&typeof existingLibrary==='object'?existingLibrary:{};
    const contentIndex=new Map();
    Object.values(existing).forEach(activity=>{
      const key=activityFingerprint(activity,{ignoreId:true});
      if(!contentIndex.has(key))contentIndex.set(key,[]);
      contentIndex.get(key).push(String(activity?.id||''));
    });
    Object.values(parsed.library).forEach(activity=>{
      const id=String(activity.id);
      const current=existing[id];
      if(current){
        if(activityFingerprint(current)===activityFingerprint(activity))report.unchanged.push({activityId:id,status:'unchanged'});
        else report.conflicts.push({activityId:id,status:'conflict',existing:clone(current),incoming:clone(activity)});
        return;
      }
      const sameContentIds=contentIndex.get(activityFingerprint(activity,{ignoreId:true}))||[];
      if(sameContentIds.length)report.duplicateContent.push({activityId:id,status:'duplicate_content',sameAs:[...sameContentIds]});
      else report.newActivities.push({activityId:id,status:'new'});
    });
    return {valid:report.conflicts.length===0,errors:report.conflicts.length?['存在 '+report.conflicts.length+' 个同 ID 内容冲突，请选择保留或替换策略。']:[],report,package:parsed.payload,library:parsed.library};
  }
  function mergePackage(existingLibrary,input,options={}){
    const analysis=analyzePackageMerge(existingLibrary,input);
    const policy=String(options.conflictPolicy||'reject');
    const allowed=new Set(['reject','keep_existing','replace']);
    if(!allowed.has(policy))return {valid:false,errors:['不支持的 conflictPolicy：'+policy],library:clone(existingLibrary||{}),report:analysis.report};
    if(!analysis.package||!analysis.library)return {valid:false,errors:analysis.errors,library:clone(existingLibrary||{}),report:analysis.report};
    if(analysis.report.conflicts.length&&policy==='reject')return {valid:false,errors:analysis.errors,library:clone(existingLibrary||{}),report:analysis.report};
    const merged=clone(existingLibrary||{});
    Object.entries(analysis.library).forEach(([id,activity])=>{
      if(Object.prototype.hasOwnProperty.call(merged,id)&&policy==='keep_existing')return;
      merged[id]=clone(activity);
    });
    const validation=validateLibrary(merged);
    return {valid:validation.valid,errors:validation.errors.map(item=>item.activityId+': '+item.message),library:merged,report:analysis.report,libraryValidation:validation};
  }

  global.KGActivitySchemaV1=Object.freeze({
    SCHEMA_VERSION,
    LANGUAGE_STORAGE_KEY,
    LANGUAGE_MODES,
    STUDENT_LANGUAGE_MODES,
    ASSESSMENT_LANGUAGE,
    SUPPORTED_TYPES:Object.freeze([...SUPPORTED_TYPES]),
    canonicalType,
    runtimeType,
    normalizeLanguageMode,
    normalizeStudentLanguageMode,
    getLanguageMode,
    setLanguageMode,
    getPracticeAutoExplain,setPracticeAutoExplain,
    fromLegacy,
    normalizeActivityRecord,
    migrateLibrary,
    materialize,
    validate,
    validateLibrary,
    createPackage,
    validatePackage,
    parsePackage,
    analyzePackageMerge,
    mergePackage,
    hasLocale:(schema,locale)=>localeHasContent(schema?.content?.[String(locale||'')]),
    clone
  });
})(window);
