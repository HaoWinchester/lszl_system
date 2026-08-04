'use strict';
const fs=require('fs');
const vm=require('vm');
const path=require('path');

const ROOT=path.resolve(__dirname,'..');
const parser=require(path.join(ROOT,'question-studio/question-studio-parser.js'));
const storage=new Map();
const context={
  console,
  Date,
  CustomEvent:function(type,init){this.type=type;this.detail=init?.detail},
  localStorage:{
    getItem:key=>storage.has(key)?storage.get(key):null,
    setItem:(key,value)=>storage.set(key,String(value)),
    removeItem:key=>storage.delete(key)
  },
  dispatchEvent(){}
};
context.window=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(ROOT,'src/86-activity-schema-v1.js'),'utf8'),context,{filename:'src/86-activity-schema-v1.js'});
const schema=context.KGActivitySchemaV1;

function assert(condition,message){if(!condition)throw new Error(message)}

const parsed=parser.parseBatch(parser.SAMPLE);
assert(parsed.activities.length===2,'示例模板应解析出两个活动');
assert(parsed.errors.length===0,'示例模板不应产生解析错误');
assert(parsed.activities[0].type==='single_choice','第一项应为单项选择');
assert(parsed.activities[1].type==='ordering','第二项应为排序题');
parsed.activities.forEach(activity=>{
  const result=schema.validate(activity);
  assert(result.valid,activity.id+' 应通过 Activity Schema v1：'+result.errors.join('；'));
  assert(activity.assessment?.language==='zh',activity.id+' 应固定使用中文判定');
  assert(activity.content&&Object.prototype.hasOwnProperty.call(activity.content,'en'),activity.id+' 应保留英文展示槽位');
});
assert(parsed.activities[0].answer.optionId==='B','单选答案应使用稳定 optionId');
assert(parsed.activities[1].answer.itemIds.join(',')==='item-1,item-2,item-3','排序答案应使用稳定 itemId');

const supportedSamples=[
`【题型】关键词识别\n【ID】activity-keyword-test\n【题干-中文】请选择关键词。\n【分段1-中文】持续反馈\n【分段2-中文】一次性交付\n【答案】segment-1`,
`【题型】开放表达\n【ID】activity-open-test\n【题干-中文】请说明为什么需要迭代。\n【概念1-可接受表达】迭代,持续反馈\n【概念1-提示】请提到迭代。\n【参考答案-中文】通过迭代和持续反馈适应变化。`,
`【题型】连线配对\n【ID】activity-match-test\n【题干-中文】请完成配对。\n【配对1-左-中文】预测型\n【配对1-右-中文】范围较稳定\n【配对2-左-中文】敏捷型\n【配对2-右-中文】需求变化频繁`
];
supportedSamples.forEach((source,index)=>{
  const result=parser.parseOne(source,index);
  const validation=schema.validate(result.activity);
  assert(validation.valid,result.activity.id+' 应通过校验：'+validation.errors.join('；'));
});


const templateSource=fs.readFileSync(path.join(ROOT,'question-studio/activity-template.txt'),'utf8');
const templateResult=parser.parseBatch(templateSource);
assert(templateResult.activities.length===5,'完整模板应解析出五种活动');
assert(templateResult.errors.length===0,'完整模板不应产生解析错误');
templateResult.activities.forEach(activity=>{
  const result=schema.validate(activity);
  assert(result.valid,activity.id+' 模板活动应通过校验：'+result.errors.join('；'));
  assert(activity.metadata.translationStatus==='bilingual',activity.id+' 模板活动应包含英文展示内容');
});
assert(new Set(templateResult.activities.map(activity=>activity.type)).size===5,'完整模板应覆盖五种不同题型');

const duplicate=parser.parseBatch(parser.SAMPLE+'\n===== 下一题 =====\n'+parser.SAMPLE.split('===== 下一题 =====')[0]);
assert(duplicate.errors.some(item=>String(item.message).includes('活动 ID 重复')),'批量解析应发现重复活动 ID');

const library=Object.fromEntries(parsed.activities.map(activity=>[activity.id,activity]));
const packageData=schema.createPackage(library,{packageId:'question-studio-test',packageVersion:1,author:'test'});
const packageValidation=schema.validatePackage(packageData);
assert(packageValidation.valid,'Question Studio 导出包应通过校验：'+packageValidation.errors.join('；'));
assert(packageData.activities.every(activity=>activity.assessment.language==='zh'),'导出包不得生成英文判定规则');

const workspaceHTML=fs.readFileSync(path.join(ROOT,'question-workspace.html'),'utf8');
const recallHTML=fs.readFileSync(path.join(ROOT,'knowledge-recall.html'),'utf8');
for(const [name,html] of [['多题画布',workspaceHTML],['深度回忆',recallHTML]]){
  assert(html.includes('data-question-language="zh"'),name+' 应提供中文按钮');
  assert(html.includes('data-question-language="bilingual"'),name+' 应提供中英对照按钮');
  assert(!html.includes('data-question-language="en"'),name+' 不应开放纯英文作答入口');
  assert(html.includes('86-free-mode-language.js')&&html.includes('86-question-language-ui.js'),name+' 应加载自由模式双语模块');
}

console.log('question-studio-parser-ok',{
  parsedActivities:parsed.activities.length,
  supportedTypes:5,
  assessmentLanguage:'zh'
});
