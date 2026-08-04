'use strict';

/* Shared display-only bilingual helpers for free-mode learning pages. */
(function(global){
  const schema=()=>global.KGActivitySchemaV1;
  const clean=value=>String(value??'').trim();
  const clone=value=>{try{return JSON.parse(JSON.stringify(value))}catch(error){return value}};
  function mode(){return schema()?.normalizeStudentLanguageMode?.(schema()?.getLanguageMode?.()||'zh')||'zh'}
  function pair(zh,en){
    const left=clean(zh),right=clean(en);
    return {zh:left,en:right&&right!==left?right:'',hasEnglish:Boolean(right&&right!==left)};
  }
  function stemFrom(record={}){
    if(clean(record.stem))return clean(record.stem);
    if(Array.isArray(record.stemParts))return record.stemParts.map(item=>String(item?.text||'')).join('').trim();
    return '';
  }
  function translationRecord(question={}){
    const translations=question.translations&&typeof question.translations==='object'?question.translations:{};
    return translations.en||question.translation?.en||question.english||question.en||question.content?.en||{};
  }
  function chineseRecord(question={}){
    return question.content?.zh&&typeof question.content.zh==='object'?question.content.zh:question;
  }
  function englishOptions(question={},english={}){
    const candidates=english.options||question.optionsEn||question.englishOptions||[];
    const byId=new Map((Array.isArray(candidates)?candidates:[]).map((item,index)=>[String(item?.id||String.fromCharCode(65+index)),item]));
    return byId;
  }
  function questionView(question={},requestedMode=mode()){
    const zh=chineseRecord(question)||{};
    const en=translationRecord(question)||{};
    const bilingual=requestedMode==='bilingual';
    const zhOptions=Array.isArray(zh.options)?zh.options:Array.isArray(question.options)?question.options:[];
    const enById=englishOptions(question,en);
    const options=zhOptions.map((item,index)=>{
      const id=String(item?.id||String.fromCharCode(65+index));
      const peer=enById.get(id)||{};
      return {
        ...clone(item),
        id,
        display:pair(item?.text,peer?.text||item?.textEn||item?.englishText),
        original:item
      };
    });
    const zhTitle=zh.title||question.title||'';
    const enTitle=en.title||question.titleEn||question.englishTitle||'';
    const zhStem=stemFrom(zh)||stemFrom(question);
    const enStem=stemFrom(en)||clean(question.stemEn||question.englishStem);
    const zhExplanation=clean(question.analysis||question.explanation||question.rationale||question.solution||zh.analysis||zh.explanation);
    const enExplanation=clean(en.analysis||en.explanation||en.rationale||en.solution||question.analysisEn||question.explanationEn);
    const zhPath=clean(question.keyPath?.ruleText||question.keyPath?.label||zh.keyPath?.ruleText||zh.keyPath?.label);
    const enPath=clean(en.keyPath?.ruleText||en.keyPath?.label||question.keyPath?.ruleTextEn||question.keyPath?.labelEn);
    return {
      mode:bilingual?'bilingual':'zh',
      title:pair(zhTitle,enTitle),
      stem:pair(zhStem,enStem),
      options,
      explanation:pair(zhExplanation,enExplanation),
      path:pair(zhPath,enPath),
      hasEnglish:Boolean(clean(enTitle)||clean(enStem)||options.some(item=>item.display.hasEnglish)||clean(enExplanation)||clean(enPath)),
      source:question
    };
  }
  function englishNodeTitle(id,data={}){return clean(data.titleEn||data.en?.title||data.translation?.en?.title)}
  function recallNodeView(id,data={},requestedMode=mode(),lookup){
    const titleZh=clean(data.title||id||'知识点');
    const titleEn=englishNodeTitle(id,data);
    const promptZh=clean(data.prompt||'你还能从这里继续回忆到什么？');
    const promptEn=clean(data.promptEn||data.en?.prompt||data.translation?.en?.prompt);
    const hintZh=clean(data.hint||'');
    const hintEn=clean(data.hintEn||data.en?.hint||data.translation?.en?.hint);
    const choices=(Array.isArray(data.choices)?data.choices:[]).map(choice=>{
      const next=String(choice?.next||'');
      const nextData=typeof lookup==='function'?lookup(next):null;
      const fallbackEn=nextData?englishNodeTitle(next,nextData):englishNodeTitle(next,{});
      return {...clone(choice),display:pair(choice?.text,choice?.textEn||choice?.en?.text||fallbackEn)};
    });
    return {
      mode:requestedMode==='bilingual'?'bilingual':'zh',
      title:pair(titleZh,titleEn),
      prompt:pair(promptZh,promptEn),
      hint:pair(hintZh,hintEn),
      choices
    };
  }
  function recallQuestionView(question={},requestedMode=mode()){
    const base=questionView(question,requestedMode);
    const en=translationRecord(question)||{};
    const zhParts=Array.isArray(question.stemParts)?question.stemParts:[];
    const enParts=Array.isArray(en.stemParts)?en.stemParts:[];
    const partsByClue=new Map(enParts.filter(item=>item?.clue).map(item=>[String(item.clue),item]));
    const stemParts=zhParts.map((item,index)=>{
      const peer=(item?.clue&&partsByClue.get(String(item.clue)))||enParts[index]||{};
      return {...clone(item),display:pair(item?.text,peer?.text||item?.textEn)};
    });
    return {...base,stemParts};
  }
  global.KGFreeModeLanguage=Object.freeze({mode,pair,questionView,recallNodeView,recallQuestionView,englishNodeTitle});
})(window);
