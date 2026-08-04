'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QuestionStudioParser=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const TYPE_ALIASES={
    '单项选择':'single_choice','单选':'single_choice','选择题':'single_choice','single_choice':'single_choice','choice':'single_choice',
    '关键词识别':'keyword_recognition','关键词':'keyword_recognition','keyword_recognition':'keyword_recognition','keyword':'keyword_recognition',
    '开放表达':'open_response','开放题':'open_response','简答题':'open_response','open_response':'open_response','open_text':'open_response',
    '排序':'ordering','排序题':'ordering','ordering':'ordering','order':'ordering',
    '连线配对':'matching','配对':'matching','连线':'matching','matching':'matching'
  };
  const RUNTIME={single_choice:'choice',keyword_recognition:'keyword',open_response:'open_text',ordering:'ordering',matching:'matching'};
  const ADAPTER={single_choice:'single_choice',keyword_recognition:'keyword_recognition',open_response:'open_response',ordering:'ordering',matching:'matching'};
  const clean=value=>String(value??'').trim();
  const uniq=items=>[...new Set((items||[]).map(clean).filter(Boolean))];
  function hash(input){
    let value=2166136261;
    for(const ch of String(input||'')){value^=ch.charCodeAt(0);value=Math.imul(value,16777619)}
    return (value>>>0).toString(16).padStart(8,'0');
  }
  function slug(value){
    const ascii=clean(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g,'-').replace(/^-+|-+$/g,'').slice(0,36);
    return ascii||'activity';
  }
  function normalizeLabel(label){return clean(label).toLowerCase().replace(/[\s_]+/g,'').replace(/英文|english|en-us|en-gb/g,'en').replace(/中文|chinese|zh-cn/g,'zh')}
  function parseSections(text){
    const source=String(text||'').replace(/\r\n?/g,'\n');
    const sections={};
    const regex=/【([^】]+)】[ \t]*\n?([\s\S]*?)(?=\n?【[^】]+】|$)/g;
    let match;
    while((match=regex.exec(source))){
      const key=normalizeLabel(match[1]);
      const value=clean(match[2]);
      if(key)sections[key]=value;
    }
    if(Object.keys(sections).length)return sections;
    source.split('\n').forEach(line=>{
      const match=line.match(/^\s*([^：:]{1,30})[：:]\s*(.*)$/);
      if(match)sections[normalizeLabel(match[1])]=clean(match[2]);
    });
    return sections;
  }
  function get(sections,...labels){
    for(const label of labels){const value=sections[normalizeLabel(label)];if(clean(value))return clean(value)}
    return '';
  }
  function splitList(value){return uniq(String(value||'').split(/[\n,，;；|、]+/).map(clean))}
  function typeOf(value){return TYPE_ALIASES[clean(value)]||TYPE_ALIASES[clean(value).toLowerCase()]||'single_choice'}
  function localePresent(record){
    if(!record||typeof record!=='object')return false;
    return Object.values(record).some(value=>Array.isArray(value)?value.some(localePresent):value&&typeof value==='object'?localePresent(value):Boolean(clean(value)));
  }
  function commonBase(sections,index,sourceText){
    const type=typeOf(get(sections,'题型','type'));
    const seed=get(sections,'id','活动id','题目id')||get(sections,'题干-中文','题干-zh','题干','问题-中文','操作说明-中文','提示-中文')||`activity-${index+1}`;
    const id=get(sections,'id','活动id','题目id')||`${slug(seed)}-${hash(seed).slice(0,6)}`;
    return {
      id,
      type,
      schemaVersion:1,
      content:{zh:{},en:null},
      answer:{},
      explanation:{
        zh:{
          short:get(sections,'简短解析-中文','简析-中文'),
          detailed:get(sections,'详细解析-中文','解析-中文','解析'),
          incorrect:get(sections,'错误反馈-中文'),
          general:get(sections,'解析-中文','解析')
        },
        en:null
      },
      assessment:{language:'zh'},
      config:{},
      metadata:{
        stage:get(sections,'阶段'),
        part:get(sections,'部分'),
        topic:get(sections,'主题','知识点'),
        tags:splitList(get(sections,'标签','tags')),
        author:get(sections,'作者'),
        source:'question-studio-v0.1.0',
        runtimeType:RUNTIME[type]||'unknown',
        adapter:ADAPTER[type]||'unknown',
        translationStatus:'zh_only',
        importedTextHash:`fnv1a32:${hash(sourceText)}`
      }
    };
  }
  function applyEnglishExplanation(activity,sections){
    const record={
      short:get(sections,'简短解析-en','简析-en'),
      detailed:get(sections,'详细解析-en','解析-en','explanation'),
      incorrect:get(sections,'错误反馈-en'),
      general:get(sections,'解析-en','explanation')
    };
    activity.explanation.en=localePresent(record)?record:null;
  }
  function parseChoice(activity,sections,warnings){
    const zh={stem:get(sections,'题干-zh','题干-中文','题干','question-zh','question'),options:[]};
    const en={stem:get(sections,'题干-en','question-en'),options:[]};
    for(let i=0;i<12;i++){
      const id=String.fromCharCode(65+i);
      const zhText=get(sections,`${id}-zh`,`${id}-中文`,id);
      const enText=get(sections,`${id}-en`,`${id}-english`);
      if(!zhText&&!enText)continue;
      zh.options.push({id,text:zhText||enText});
      en.options.push({id,text:enText});
    }
    activity.content.zh=zh;
    activity.content.en=localePresent(en)?en:null;
    activity.answer={optionId:get(sections,'答案','正确答案','answer').replace(/[^A-Za-z0-9_-].*$/,'').toUpperCase()};
    if(!activity.answer.optionId)warnings.push('未识别正确答案，请在结构化表单中选择。');
  }
  function indexedRecords(sections,prefixes,fields){
    const output=[];
    for(let index=1;index<=30;index++){
      const record={index};
      fields.forEach(field=>{
        const labels=[];
        prefixes.forEach(prefix=>field.aliases.forEach(alias=>labels.push(`${prefix}${index}-${alias}`,`${prefix}-${index}-${alias}`)));
        record[field.key]=get(sections,...labels);
      });
      if(fields.some(field=>clean(record[field.key])))output.push(record);
    }
    return output;
  }
  function answerIds(raw,prefix,records){
    const tokens=splitList(raw);
    return tokens.map(token=>{
      if(/^\d+$/.test(token))return `${prefix}-${Number(token)}`;
      const letter=token.match(/^[A-Za-z]$/);
      if(letter)return `${prefix}-${letter[0].toUpperCase().charCodeAt(0)-64}`;
      return token;
    }).filter(id=>records.some(record=>record.id===id));
  }
  function parseKeyword(activity,sections,warnings){
    const records=indexedRecords(sections,['分段','关键词段','片段'],[
      {key:'id',aliases:['id']},{key:'zh',aliases:['zh','中文','text-zh']},{key:'en',aliases:['en','english','text-en']}
    ]).map(item=>({id:item.id||`segment-${item.index}`,zh:item.zh,en:item.en}));
    if(!records.length){
      splitList(get(sections,'分段-中文','分段','关键词')).forEach((text,index)=>records.push({id:`segment-${index+1}`,zh:text,en:''}));
    }
    activity.content.zh={instruction:get(sections,'操作说明-zh','操作说明-中文','题干-zh','题干-中文','题干')||'请选择符合要求的关键词或语句。',segments:records.map(item=>({id:item.id,text:item.zh||item.en})),hints:splitList(get(sections,'提示-中文','提示'))};
    const en={instruction:get(sections,'操作说明-en','题干-en'),segments:records.map(item=>({id:item.id,text:item.en})),hints:splitList(get(sections,'提示-en'))};
    activity.content.en=localePresent(en)?en:null;
    const ids=answerIds(get(sections,'答案','正确答案','answer'),'segment',records);
    activity.answer={segmentIds:ids,requiredSelectionCount:ids.length};
    if(!ids.length)warnings.push('未识别关键词答案，请填写正确 segmentId。');
  }
  function parseOrdering(activity,sections,warnings){
    const records=indexedRecords(sections,['排序项','步骤','项目'],[
      {key:'id',aliases:['id']},{key:'zh',aliases:['zh','中文','text-zh']},{key:'en',aliases:['en','english','text-en']}
    ]).map(item=>({id:item.id||`item-${item.index}`,zh:item.zh,en:item.en}));
    if(!records.length)splitList(get(sections,'排序项-中文','步骤-中文','排序项')).forEach((text,index)=>records.push({id:`item-${index+1}`,zh:text,en:''}));
    activity.content.zh={instruction:get(sections,'操作说明-中文','题干-中文','题干')||'请按照正确顺序排列。',items:records.map(item=>({id:item.id,text:item.zh||item.en})),hints:splitList(get(sections,'提示-中文','提示'))};
    const en={instruction:get(sections,'操作说明-en','题干-en'),items:records.map(item=>({id:item.id,text:item.en})),hints:splitList(get(sections,'提示-en'))};
    activity.content.en=localePresent(en)?en:null;
    let ids=answerIds(get(sections,'答案','正确顺序','answer'),'item',records);
    if(!ids.length&&records.length){ids=records.map(item=>item.id);warnings.push('未识别排序答案，暂按录入顺序设置；导出前请确认。')}
    activity.answer={itemIds:ids};
    activity.config={displayOrder:[...records].reverse().map(item=>item.id)};
  }
  function parseMatching(activity,sections){
    const records=indexedRecords(sections,['配对','连线'],[
      {key:'id',aliases:['id']},{key:'leftZh',aliases:['左-zh','左-中文','left-zh']},{key:'rightZh',aliases:['右-zh','右-中文','right-zh']},{key:'leftEn',aliases:['左-en','left-en']},{key:'rightEn',aliases:['右-en','right-en']}
    ]).map(item=>({...item,id:item.id||`pair-${item.index}`}));
    activity.content.zh={instruction:get(sections,'操作说明-中文','题干-中文','题干')||'请完成全部配对。',pairs:records.map(item=>({id:item.id,left:item.leftZh||item.leftEn,right:item.rightZh||item.rightEn}))};
    const en={instruction:get(sections,'操作说明-en','题干-en'),pairs:records.map(item=>({id:item.id,left:item.leftEn,right:item.rightEn}))};
    activity.content.en=localePresent(en)?en:null;
    activity.answer={matches:records.map(item=>({leftId:item.id,rightId:item.id}))};
    activity.config={rightOrder:[...records].reverse().map(item=>item.id)};
  }
  function parseOpen(activity,sections,warnings){
    const conceptRecords=indexedRecords(sections,['概念','要点'],[
      {key:'id',aliases:['id']},{key:'accepted',aliases:['可接受表达','accepted','答案']},{key:'hint',aliases:['提示','missinghint']}
    ]).map(item=>({id:item.id||`concept-${item.index}`,acceptedExpressions:splitList(item.accepted),missingHint:item.hint}));
    if(!conceptRecords.length){
      splitList(get(sections,'关键词','答案要点','可接受表达')).forEach((text,index)=>conceptRecords.push({id:`concept-${index+1}`,acceptedExpressions:[text],missingHint:''}));
    }
    activity.content.zh={prompt:get(sections,'题干-中文','提示-中文','题干','问题')||'请使用中文作答。',placeholder:get(sections,'占位提示-中文','输入提示-中文'),referenceAnswer:get(sections,'参考答案-中文','参考答案','解析-中文')};
    const en={prompt:get(sections,'题干-en','提示-en'),placeholder:get(sections,'占位提示-en','输入提示-en'),referenceAnswer:get(sections,'参考答案-en')};
    activity.content.en=localePresent(en)?en:null;
    activity.answer={evaluationMode:'concept_match',minLength:Math.max(1,Number(get(sections,'最少字数'))||10),maxLength:Math.max(20,Number(get(sections,'最多字数'))||300),acceptedConcepts:{zh:conceptRecords}};
    if(!conceptRecords.length)warnings.push('未识别开放表达的中文答案要点。');
  }
  function parseOne(text,index=0){
    const sections=parseSections(text);
    const warnings=[],errors=[];
    const activity=commonBase(sections,index,text);
    applyEnglishExplanation(activity,sections);
    if(activity.type==='single_choice')parseChoice(activity,sections,warnings);
    else if(activity.type==='keyword_recognition')parseKeyword(activity,sections,warnings);
    else if(activity.type==='ordering')parseOrdering(activity,sections,warnings);
    else if(activity.type==='matching')parseMatching(activity,sections,warnings);
    else if(activity.type==='open_response')parseOpen(activity,sections,warnings);
    activity.metadata.translationStatus=localePresent(activity.content.en)?'bilingual':'zh_only';
    if(!activity.metadata.stage)warnings.push('未填写阶段。');
    if(!activity.metadata.part)warnings.push('未填写部分。');
    if(!activity.content.en)warnings.push('未填写英文展示内容；中英对照模式将回退中文。');
    return {activity,warnings,errors,sections};
  }
  function parseBatch(raw){
    const blocks=String(raw||'').split(/\n?={3,}\s*下一题\s*={3,}\n?/).map(clean).filter(Boolean);
    const results=blocks.map((block,index)=>parseOne(block,index));
    const seen=new Set();
    results.forEach(result=>{
      const id=result.activity.id;
      if(seen.has(id))result.errors.push(`活动 ID 重复：${id}`);
      seen.add(id);
    });
    return {results,activities:results.map(result=>result.activity),warnings:results.flatMap((result,index)=>result.warnings.map(message=>({index,message}))),errors:results.flatMap((result,index)=>result.errors.map(message=>({index,message})))};
  }
  const SAMPLE=`【题型】单项选择
【ID】activity-environment-001
【阶段】基础阶段
【部分】项目环境
【题干-中文】
项目需求频繁变化，团队应采用哪种方式？
【题干-English】
Project requirements change frequently. Which approach should the team use?
【A-中文】严格按照原计划执行
【A-English】Follow the original plan strictly
【B-中文】采用迭代方式持续调整
【B-English】Use an iterative approach and adjust continuously
【C-中文】暂停项目等待需求稳定
【C-English】Pause the project until requirements stabilize
【D-中文】仅由项目经理决定
【D-English】Let only the project manager decide
【答案】B
【解析-中文】
需求频繁变化时，应采用迭代和持续反馈的方式。
【解析-English】
When requirements change frequently, use iteration and continuous feedback.

===== 下一题 =====

【题型】排序
【ID】activity-ordering-001
【阶段】基础阶段
【部分】项目环境
【操作说明-中文】请按照正确顺序排列。
【操作说明-English】Put the steps in the correct order.
【排序项1-中文】识别项目环境
【排序项1-English】Identify the project environment
【排序项2-中文】选择适合的方法
【排序项2-English】Choose an appropriate approach
【排序项3-中文】持续检查并调整
【排序项3-English】Inspect and adapt continuously
【答案】item-1,item-2,item-3`;
  return Object.freeze({TYPE_ALIASES,RUNTIME,ADAPTER,parseSections,parseOne,parseBatch,SAMPLE,hash,slug});
});
