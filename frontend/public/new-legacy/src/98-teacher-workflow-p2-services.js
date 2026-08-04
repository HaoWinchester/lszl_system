'use strict';

(function(global){
  const clean=value=>String(value??'').trim();
  const normalizeLine=line=>String(line||'').replace(/\u00a0/g,' ').trim();
  const optionMatch=line=>normalizeLine(line).match(/^\s*(?:[（(]?\s*([A-Ha-h])\s*[）).、:：．.]|([A-Ha-h])\s{1,})(.*)$/);
  const questionHeading=line=>/^\s*(?:第\s*)?\d+\s*(?:题|[、.．:)）])\s*/.test(normalizeLine(line));
  const answerLine=line=>/^\s*(?:正确答案|参考答案|答案)\s*[：:]?\s*([A-Ha-h])\b/i.test(normalizeLine(line));
  const analysisLine=line=>/^\s*(?:答案解析|参考解析|解析|复盘说明)\s*[：:]?/i.test(normalizeLine(line));
  const STRUCTURED_FIELD=/【[^】]+】/;
  const NEXT_QUESTION_LINE=/^[ \t]*[=＝]{3,}[ \t]*下一题[ \t]*[=＝]{3,}[ \t]*$/;

  const templateTexts={
    bilingual:`【科目】
PMP

【知识点】
PMP/敏捷方法

【标签】
阶段测试、核心题

【题干-中文】
请填写中文题干

【题干-English】
Please enter the English question stem

【A-中文】
请填写中文选项 A

【A-English】
Please enter English option A

【B-中文】
请填写中文选项 B

【B-English】
Please enter English option B

【C-中文】
请填写中文选项 C

【C-English】
Please enter English option C

【D-中文】
请填写中文选项 D

【D-English】
Please enter English option D

【答案】
B

【解析-中文】
请填写中文解析

【解析-English】
Please enter the English explanation

【关键词】
关键相关方 | key stakeholder
新的需求 | new requirements`,
    example:`【科目】
PMP

【知识点】
PMP/敏捷方法

【标签】
阶段测试、易错题

【题干-中文】
项目执行期间，关键相关方频繁提出新的需求。团队最合适的处理方式是什么？

【题干-English】
During project execution, a key stakeholder frequently proposes new requirements. What is the most appropriate approach for the team?

【A-中文】
拒绝全部新需求，以确保原计划完全不变

【A-English】
Reject all new requirements to keep the original plan unchanged

【B-中文】
通过迭代、持续反馈和正式变更流程逐步评估与调整

【B-English】
Evaluate and adapt incrementally through iteration, continuous feedback, and the formal change process

【C-中文】
立即实施所有新需求，不进行影响分析

【C-English】
Implement every new requirement immediately without impact analysis

【D-中文】
暂停项目，直到相关方不再提出变化

【D-English】
Pause the project until stakeholders stop requesting changes

【答案】
B

【解析-中文】
需求频繁变化时，应采用迭代和持续反馈，同时遵循适用的变更控制流程，避免无分析地直接实施。

【解析-English】
When requirements change frequently, use iteration and continuous feedback while following the applicable change-control process.

【关键词】
关键相关方 | key stakeholder -> 关键干系人
新的需求 | new requirements -> 需求管理
迭代 | iteration -> 迭代开发
持续反馈 | continuous feedback -> 持续反馈
正式变更流程 | formal change process -> 整体变更控制`,
    chinese:`【科目】
PMP

【知识点】
PMP/敏捷方法

【标签】
基础练习

【题干-中文】
请填写中文题干

【A-中文】
请填写中文选项 A

【B-中文】
请填写中文选项 B

【C-中文】
请填写中文选项 C

【D-中文】
请填写中文选项 D

【答案】
B

【解析-中文】
请填写中文解析

【关键词】
关键词一
关键词二`,
    batch:''
  };
  const batchQuestionTemplate=templateTexts.bilingual.replace(/【科目】\nPMP/,'【科目】\n').replace(/【知识点】\nPMP\/敏捷方法/,'【知识点】\n').replace(/【标签】\n阶段测试、核心题/,'【标签】\n');
  templateTexts.batch=`${batchQuestionTemplate}\n\n===== 下一题 =====\n\n${batchQuestionTemplate}`;
  const TEMPLATE_TEXTS=Object.freeze(templateTexts);
  const TEMPLATE_FILES=Object.freeze({
    bilingual:{filename:'标准双语单题模板.txt',label:'标准双语单题模板',text:TEMPLATE_TEXTS.bilingual},
    example:{filename:'双语单题示例.txt',label:'双语单题示例',text:TEMPLATE_TEXTS.example},
    batch:{filename:'双语批量录题模板.txt',label:'双语批量录题模板',text:TEMPLATE_TEXTS.batch},
    chinese:{filename:'仅中文录题模板.txt',label:'仅中文模板',text:TEMPLATE_TEXTS.chinese}
  });

  function parseQuestionLegacy(raw){
    const source=String(raw||'').replace(/\r\n?/g,'\n').trim();
    const result={format:'plain',language:'zh_only',subject:'',knowledge:'',stem:'',stemEn:'',options:[],answer:'',analysis:'',analysisEn:'',keywords:[],tags:[],warnings:[],errors:[],source};
    if(!source){result.errors.push('请先粘贴题目文本。');return result}
    const lines=source.split('\n');
    const stemLines=[];let currentOption=null;let inAnalysis=false;let answerFound=false;
    const flushOption=()=>{if(currentOption){currentOption.text=clean(currentOption.text);currentOption.textEn='';result.options.push(currentOption);currentOption=null}};
    lines.forEach(original=>{
      const line=normalizeLine(original);
      const subject=line.match(/^\s*(?:所属科目|科目)\s*[：:]\s*(.+)$/i);
      const knowledge=line.match(/^\s*(?:主要知识点|主知识点|知识点)\s*[：:]\s*(.+)$/i);
      const tags=line.match(/^\s*(?:普通标签|标签)\s*[：:]\s*(.+)$/i);
      const answer=line.match(/^\s*(?:正确答案|参考答案|答案)\s*[：:]?\s*([A-Ha-h])\b/i);
      const analysis=line.match(/^\s*(?:答案解析|参考解析|解析|复盘说明)\s*[：:]?\s*(.*)$/i);
      if(subject){result.subject=clean(subject[1]);return}
      if(knowledge){result.knowledge=clean(knowledge[1]);return}
      if(tags){result.tags=tags[1].split(/[,，;；、]+/).map(clean).filter(Boolean);return}
      if(answer){flushOption();result.answer=answer[1].toUpperCase();answerFound=true;inAnalysis=false;return}
      if(analysis){flushOption();inAnalysis=true;if(clean(analysis[1]))result.analysis=clean(analysis[1]);return}
      if(inAnalysis){if(line)result.analysis+=(result.analysis?'\n':'')+line;return}
      const match=optionMatch(line);
      if(match){flushOption();currentOption={id:(match[1]||match[2]||'').toUpperCase(),text:clean(match[3]||''),textEn:''};return}
      if(currentOption){if(line)currentOption.text+=(currentOption.text?'\n':'')+line;return}
      if(line)stemLines.push(line);
    });
    flushOption();
    result.stem=stemLines.join('\n').replace(/^\s*(?:第?\s*\d+\s*[题、.．:)）]\s*)/,'').trim();
    if(!answerFound){const inline=source.match(/(?:正确答案|参考答案|答案)\s*[：:]?\s*([A-Ha-h])\b/i);if(inline)result.answer=inline[1].toUpperCase()}
    const seen=new Set();result.options=result.options.filter(option=>{if(!option.id||seen.has(option.id))return false;seen.add(option.id);return true});
    validateQuestion(result);
    return result;
  }

  function localSections(raw){
    const source=String(raw||'').replace(/\r\n?/g,'\n');const sections={};
    const regex=/【([^】]+)】[ \t]*\n?([\s\S]*?)(?=\n?【[^】]+】|$)/g;let match;
    while((match=regex.exec(source)))sections[clean(match[1]).toLowerCase()]=clean(match[2]);
    return sections;
  }
  function section(sections,...names){for(const name of names){const value=sections[clean(name).toLowerCase()];if(clean(value))return clean(value)}return ''}
  function countOccurrences(text,term){const source=String(text||''),needle=String(term||'');if(!needle)return 0;let count=0,index=0;while((index=source.indexOf(needle,index))>=0){count+=1;index+=Math.max(1,needle.length)}return count}
  function keywordLocations(stem,options,term){const result=[];const stemCount=countOccurrences(stem,term);if(stemCount)result.push({field:'stem',optionId:'',count:stemCount});(options||[]).forEach(option=>{const count=countOccurrences(option.text,term);if(count)result.push({field:'option',optionId:String(option.id||''),count})});return result}
  function parseKeywordLines(raw,context={}){
    const sections=localSections(raw);const source=section(sections,'关键词','关键词映射');if(!source)return [];
    const zhOptions=(context.options||[]).map(item=>({id:item.id,text:item.text||''}));
    const enOptions=(context.options||[]).map(item=>({id:item.id,text:item.textEn||''}));
    const seen=new Set();const items=[];
    source.split(/\r?\n/).map(line=>clean(line.replace(/^[-*•·]\s*/,''))).filter(Boolean).forEach(line=>{
      const arrow=line.split(/\s*(?:➡️|➡|→|->|=>)\s*/);const pair=clean(arrow.shift()||'');const entry=clean(arrow.join(' -> '));
      const bilingual=pair.split(/\s*[|｜]\s*/);let zh=clean(bilingual[0]||''),en=clean(bilingual[1]||'');
      if(!en&&!/[\u3400-\u9fff]/.test(zh)){en=zh;zh=''}
      const key=`${zh}\u0000${en}`;if(!zh&&!en||seen.has(key))return;seen.add(key);
      items.push({
        zh,en,entry,
        locationsZh:zh?keywordLocations(context.stem||'',zhOptions,zh):[],
        locationsEn:en?keywordLocations(context.stemEn||'',enOptions,en):[]
      });
    });
    return items;
  }

  function parseStructuredQuestion(raw){
    const source=String(raw||'').replace(/\r\n?/g,'\n').trim();
    const parser=global.QuestionStudioParser;const sections=localSections(source);
    const parsed=parser?.parseOne?.(source,0);const activity=parsed?.activity||{};
    const zh=activity.content?.zh||{};const en=activity.content?.en||{};
    const zhStem=clean(zh.stem||section(sections,'题干-中文','题干-zh','题干'));
    const enStem=clean(en.stem||section(sections,'题干-english','题干-en'));
    const zhById=new Map((Array.isArray(zh.options)?zh.options:[]).map(item=>[String(item.id||''),clean(item.text)]));
    const enById=new Map((Array.isArray(en.options)?en.options:[]).map(item=>[String(item.id||''),clean(item.text)]));
    const options=[];for(const id of ['A','B','C','D']){const text=zhById.get(id)||section(sections,`${id}-中文`,`${id}-zh`,id);const textEn=enById.get(id)||section(sections,`${id}-english`,`${id}-en`);if(text||textEn)options.push({id,text,textEn})}
    const answer=clean(activity.answer?.optionId||section(sections,'答案','正确答案')).toUpperCase().replace(/[^A-D].*$/,'');
    const analysis=clean(activity.explanation?.zh?.detailed||activity.explanation?.zh?.general||section(sections,'解析-中文','解析-zh','解析'));
    const analysisEn=clean(activity.explanation?.en?.detailed||activity.explanation?.en?.general||section(sections,'解析-english','解析-en'));
    const title=section(sections,'题目简称','主题');const titleEn=section(sections,'题目简称-english','主题-english');
    const hasEnglish=Boolean(enStem||analysisEn||options.some(item=>item.textEn));
    const result={
      format:'structured',language:hasEnglish?'bilingual':'zh_only',subject:section(sections,'科目','所属科目'),knowledge:section(sections,'知识点','主要知识点','主知识点'),stem:zhStem,stemEn:enStem,options,answer,analysis,analysisEn,title,titleEn,
      topic:section(sections,'主题'),tags:section(sections,'标签','普通标签').split(/[,，;；、]+/).map(clean).filter(Boolean),
      keywords:[],warnings:[],errors:[],source
    };
    result.keywords=parseKeywordLines(source,result);
    validateQuestion(result);
    result.keywords.forEach(item=>{
      if(item.zh&&!item.locationsZh.length)result.warnings.push(`中文关键词“${item.zh}”未在中文题干或选项中找到。`);
      if(item.en&&hasEnglish&&!item.locationsEn.length)result.warnings.push(`英文关键词“${item.en}”未在英文题干或选项中找到。`);
    });
    return result;
  }

  function validateQuestion(result){
    const hasEnglish=Boolean(result.stemEn||result.analysisEn||(result.options||[]).some(item=>clean(item.textEn)));
    if(!result.stem&&!result.stemEn)result.errors.push('未识别到题干。');
    if(!result.stem&&result.stemEn)result.warnings.push('没有中文题干；当前学员端默认中文显示将回退英文。');
    const ids=(result.options||[]).map(item=>item.id).join('');
    if(result.options.length!==4||ids!=='ABCD')result.errors.push(`当前识别到 ${result.options.length} 个选项（${ids||'无编号'}）；单选题需要 A/B/C/D 共 4 个选项。`);
    if((result.options||[]).some(item=>!clean(item.text)&&!clean(item.textEn)))result.errors.push('存在中英文内容均为空的选项。');
    if(result.stem&&(result.options||[]).some(item=>!clean(item.text)))result.errors.push('中文题目需要完整的 A/B/C/D 中文选项。');
    if(hasEnglish){
      if(!result.stemEn)result.errors.push('检测到英文内容，但缺少英文题干。');
      const missing=(result.options||[]).filter(item=>!clean(item.textEn)).map(item=>item.id);
      if(missing.length)result.errors.push(`英文选项缺失：${missing.join('、')}。`);
    }
    if(!result.answer)result.errors.push('未识别到正确答案。');
    else if(!(result.options||[]).some(item=>item.id===result.answer))result.errors.push(`答案 ${result.answer} 不在已识别选项中。`);
    if(!result.analysis)result.warnings.push('未识别到中文解析，可保存后继续补充。');
    if(hasEnglish&&!result.analysisEn)result.warnings.push('未识别到英文解析，可保存后继续补充。');
    result.language=hasEnglish?'bilingual':(result.stem?'zh_only':'en_only');
  }

  function parseQuestion(raw){return STRUCTURED_FIELD.test(String(raw||''))?parseStructuredQuestion(raw):parseQuestionLegacy(raw)}

  function hasOptionSequence(lines,start){
    const found=[];
    for(let index=start;index<Math.min(lines.length,start+16);index++){
      const match=optionMatch(lines[index]);if(match){const id=(match[1]||match[2]||'').toUpperCase();if(!found.includes(id))found.push(id)}
      if(answerLine(lines[index])&&found.length<4)break;
    }
    return ['A','B','C','D'].every(id=>found.includes(id));
  }
  function splitQuestionBlocks(raw){
    const source=String(raw||'').replace(/\r\n?/g,'\n').replace(/^\ufeff/,'').trim();if(!source)return [];
    const sourceLines=source.split('\n');
    if(sourceLines.some(line=>NEXT_QUESTION_LINE.test(line))){
      const separated=[];let current=[];
      const flushSeparated=()=>{const text=clean(current.join('\n'));if(text)separated.push(text);current=[]};
      sourceLines.forEach(line=>{if(NEXT_QUESTION_LINE.test(line)){flushSeparated();return}current.push(line)});
      flushSeparated();if(separated.length>1)return separated;
    }
    const hard=source.split(/\n\s*(?:-{3,}|={3,}|\*{3,})\s*\n/).map(clean).filter(Boolean);if(hard.length>1)return hard;
    if(STRUCTURED_FIELD.test(source))return [source];
    const lines=sourceLines;const blocks=[];let current=[];let answerSeen=false;let optionCount=0;
    const flush=()=>{const text=clean(current.join('\n'));if(text)blocks.push(text);current=[];answerSeen=false;optionCount=0};
    lines.forEach((line,index)=>{const normalized=normalizeLine(line);const candidateStart=normalized&&!optionMatch(normalized)&&!answerLine(normalized)&&!analysisLine(normalized)&&hasOptionSequence(lines,index);if(current.length&&((questionHeading(normalized)&&(optionCount>=2||answerSeen))||(answerSeen&&candidateStart)))flush();current.push(line);if(optionMatch(normalized))optionCount+=1;if(answerLine(normalized))answerSeen=true});
    flush();return blocks.length?blocks:[source];
  }
  function parseQuestionBatch(raw){const blocks=splitQuestionBlocks(raw);const items=blocks.map((block,index)=>({...parseQuestion(block),index:index+1}));const validCount=items.filter(item=>!item.errors.length).length;return {items,total:items.length,validCount,invalidCount:items.length-validCount}}

  function markStemParts(text,keywords,language='zh'){
    const source=String(text||'');const candidates=[];
    (keywords||[]).forEach((item,index)=>{const term=clean(language==='en'?item.en:item.zh);if(!term)return;let start=0;while((start=source.indexOf(term,start))>=0){candidates.push({start,end:start+term.length,id:item.id||`clue-${index+1}`,text:term});start+=Math.max(1,term.length)}});
    candidates.sort((a,b)=>a.start-b.start||b.end-a.end);const accepted=[];let cursor=0;candidates.forEach(item=>{if(item.start<cursor)return;accepted.push(item);cursor=item.end});
    const parts=[];cursor=0;accepted.forEach(item=>{if(item.start>cursor)parts.push({text:source.slice(cursor,item.start)});parts.push({text:source.slice(item.start,item.end),clue:item.id});cursor=item.end});if(cursor<source.length)parts.push({text:source.slice(cursor)});return parts.length?parts:[{text:source}];
  }

  const NODE_TYPES=new Set(['standard','challenge','deep_recall','multi_question','knowledge_graph']);
  const TYPE_ALIASES={'普通':'standard','普通学习':'standard','标准':'standard','standard':'standard','挑战':'challenge','综合挑战':'challenge','challenge':'challenge','深度回忆':'deep_recall','回忆':'deep_recall','deep_recall':'deep_recall','多题归纳':'multi_question','多题':'multi_question','multi_question':'multi_question','multi_question_induction':'multi_question','知识图谱':'knowledge_graph','图谱':'knowledge_graph','knowledge_graph':'knowledge_graph'};
  function nodeType(value){const key=clean(value);return TYPE_ALIASES[key]||(NODE_TYPES.has(key)?key:'standard')}
  function parseCourseOutline(raw){
    const lines=String(raw||'').replace(/\r\n?/g,'\n').split('\n');const result={stages:[],errors:[],warnings:[],counts:{stages:0,parts:0,nodes:0}};let currentStage=null,currentPart=null;
    lines.forEach((original,index)=>{const line=clean(original);if(!line||/^\/\//.test(line))return;let match=line.match(/^#{1}\s+(.+)$/)||line.match(/^阶段\s*[：:]\s*(.+)$/);if(match){currentStage={title:clean(match[1]),parts:[]};result.stages.push(currentStage);currentPart=null;return}match=line.match(/^#{2}\s+(.+)$/)||line.match(/^章节\s*[：:]\s*(.+)$/);if(match){if(!currentStage){result.errors.push(`第 ${index+1} 行：章节前缺少阶段。`);return}currentPart={title:clean(match[1]),nodes:[]};currentStage.parts.push(currentPart);return}match=line.match(/^(?:[-*]\s+|步骤\s*[：:]\s*)(.+)$/);if(match){if(!currentPart){result.errors.push(`第 ${index+1} 行：学习步骤前缺少章节。`);return}const parts=match[1].split(/\s*[|｜]\s*/);const title=clean(parts[0]);if(!title){result.errors.push(`第 ${index+1} 行：学习步骤名称为空。`);return}currentPart.nodes.push({title,nodeType:nodeType(parts[1]||'standard')});return}result.warnings.push(`第 ${index+1} 行未识别：${line}`)});
    result.counts.stages=result.stages.length;result.counts.parts=result.stages.reduce((sum,item)=>sum+item.parts.length,0);result.counts.nodes=result.stages.reduce((sum,item)=>sum+item.parts.reduce((n,p)=>n+p.nodes.length,0),0);if(!result.stages.length&&!result.errors.length)result.errors.push('没有识别到阶段。');return result;
  }
  const COURSE_TEMPLATES=Object.freeze({question_basic:{id:'question_basic',name:'原题基础四步',description:'题干观察、关键词识别、原题作答、选项复盘',steps:[{title:'题干观察',nodeType:'standard'},{title:'关键词识别',nodeType:'deep_recall'},{title:'原题作答',nodeType:'standard'},{title:'选项复盘',nodeType:'standard'}]},knowledge_recall:{id:'knowledge_recall',name:'知识串联三步',description:'关键词回忆、知识图谱、多题归纳',steps:[{title:'关键词回忆',nodeType:'deep_recall'},{title:'知识图谱',nodeType:'knowledge_graph'},{title:'多题归纳',nodeType:'multi_question'}]},complete_learning:{id:'complete_learning',name:'完整七步学习',description:'基础原题训练与知识串联组合',steps:[{title:'题干观察',nodeType:'standard'},{title:'关键词识别',nodeType:'deep_recall'},{title:'知识定位',nodeType:'knowledge_graph'},{title:'原题作答',nodeType:'standard'},{title:'选项复盘',nodeType:'standard'},{title:'知识回忆',nodeType:'deep_recall'},{title:'多题归纳',nodeType:'multi_question'}]}});

  global.KGTeacherWorkflowP2=Object.freeze({parseQuestion,parseStructuredQuestion,parseKeywordLines,splitQuestionBlocks,parseQuestionBatch,markStemParts,TEMPLATE_TEXTS,TEMPLATE_FILES,parseCourseOutline,nodeType,COURSE_TEMPLATES});
})(globalThis);
