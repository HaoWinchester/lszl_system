'use strict';
const path=require('path');
global.QuestionStudioParser=require(path.resolve(__dirname,'../question-studio/question-studio-parser.js'));
require(path.resolve(__dirname,'../src/98-teacher-workflow-p2-services.js'));
const S=global.KGTeacherWorkflowP2;
function assert(condition,message){if(!condition)throw new Error(message)}

const template=S.TEMPLATE_TEXTS.bilingual;
assert(!/【ID】|【阶段】|【部分】|【题型】/.test(template),'教师模板不应包含内部 ID、阶段、部分或题型');
assert(/【题干-中文】/.test(template)&&/【题干-English】/.test(template),'双语模板字段缺失');
assert(Object.keys(S.TEMPLATE_FILES).length===4,'应提供四种模板下载');

const parsed=S.parseQuestion(S.TEMPLATE_TEXTS.example);
assert(parsed.errors.length===0,'双语示例解析不应报错：'+parsed.errors.join(';'));
assert(parsed.language==='bilingual','应识别为中英双语');
assert(parsed.options.length===4&&parsed.options.every(item=>item.text&&item.textEn),'中英文 A-D 应完整');
assert(parsed.answer==='B','答案应为 B');
assert(parsed.analysis&&parsed.analysisEn,'中英文解析应完整');
assert(parsed.keywords.length===5,'应识别 5 个关键词');
assert(parsed.keywords.every(item=>item.locationsZh.length&&item.locationsEn.length),'关键词应在两种语言中定位');
assert(parsed.keywords[0].entry==='关键干系人','应保留知识入口名称');

const batch=S.parseQuestionBatch(S.TEMPLATE_TEXTS.batch);
assert(batch.total===2&&batch.validCount===2,'双语批量模板应拆分两题');

const partial=S.parseQuestion(S.TEMPLATE_TEXTS.example.replace('【D-English】\nPause the project until stakeholders stop requesting changes','【D-English】\n'));
assert(partial.errors.some(item=>item.includes('英文选项缺失')),'英文选项不完整应阻止保存');

const zh=S.parseQuestion(`项目经理下一步应该做什么？\nA. 分析\nB. 升级\nC. 忽略\nD. 关闭\n答案：A\n解析：先分析。`);
assert(zh.errors.length===0&&zh.language==='zh_only','原有中文普通文本应继续兼容');

const withIds=parsed.keywords.map((item,index)=>({...item,id:'kw-'+index}));
const marked=S.markStemParts(parsed.stem,withIds,'zh');
assert(marked.some(item=>item.clue),'中文题干应生成关键词标记片段');
console.log('v862-p21-bilingual-entry-ok',{templates:Object.keys(S.TEMPLATE_FILES).length,keywords:parsed.keywords.length,batch:batch.total});
