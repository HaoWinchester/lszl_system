'use strict';
const fs=require('fs');
const vm=require('vm');
const storage=new Map();
const context={
  console,
  Date,
  URLSearchParams,
  CustomEvent:function(type,init){this.type=type;this.detail=init?.detail},
  localStorage:{getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
  dispatchEvent(){},
  KGAuthCore:{currentUsername:()=> 'tester'},
  KGLearningEventRepository:{append(){}},
};
context.window=context;
vm.createContext(context);
for(const file of ['src/86-activity-schema-v1.js','src/87-guided-learning-data.js','src/88-guided-learning-store.js','src/89-guided-learning-icon-registry.js','src/89-guided-learning-activity-registry.js','src/89-guided-learning-deep-recall.js','src/89-guided-learning-multi-induction.js','src/89-guided-learning-knowledge-graph.js']){
  vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});
}
const data=context.KGGuidedLearningData;
const store=context.KGGuidedLearningStore;
const course=data.getCourse();
function assert(condition,message){if(!condition)throw new Error(message)}
const mainCSS=fs.readFileSync('styles/main.css','utf8');
const pathCSS=fs.readFileSync('styles/guided-learning-path.css','utf8');
const placementCSS=fs.readFileSync('styles/guided-learning-placement-test.css','utf8');
const nodeCSS=fs.readFileSync('styles/guided-learning-node.css','utf8');
const nodeHTML=fs.readFileSync('guided-learning-node.html','utf8');
const placementHTML=fs.readFileSync('guided-learning-placement-test.html','utf8');
const placementJS=fs.readFileSync('src/89-guided-learning-placement-test.js','utf8');
const nodeJS=fs.readFileSync('src/90-guided-learning-node-app.js','utf8');
assert(!/\.gl-stage-switch:hover\s*\{[^}]*filter\s*:\s*saturate/i.test(pathCSS),'阶段按钮悬停不应使用 filter 合成效果');
assert(/\.gl-stage-switch:hover\s*\{[^}]*transform\s*:\s*none/i.test(pathCSS),'阶段按钮悬停应显式取消全局上移');
assert(/\.gl-stage-switch:hover\s*\{[^}]*box-shadow\s*:\s*0\s+var\(--gl-stage-depth\)\s+0\s+var\(--gl-part-base\)/i.test(pathCSS),'阶段按钮悬停应保留深色立体底层');
assert(!/\.gl-path-node\.is-current \.gl-node-button\s*\{[^}]*animation/i.test(pathCSS),'当前节点按钮本体不应再执行呼吸动画');
assert(/\.gl-path-node\.is-current \.gl-node-button::before\s*\{[\s\S]*gl-current-node-ring-pulse/i.test(pathCSS),'当前节点应使用独立外围脉冲环');
assert(/--gl-node-width:82px;--gl-node-face-height:68px/.test(pathCSS),'桌面节点应使用轻微横向椭圆比例');
assert(/button:hover\{transform:none/.test(mainCSS),'全局按钮悬浮不应再上移');
assert(/\.ui-button\{[\s\S]*min-width:160px;[\s\S]*width:160px;height:48px/.test(mainCSS),'统一主操作按钮应为 160×48px');
assert(/\.ui-button:active[^}]*transform:translateY\(4px\)[^}]*box-shadow:0 0 0/.test(mainCSS),'统一主操作按钮应具备 4px 下压反馈');
assert(/\.ui-button:disabled,\.ui-button\[aria-disabled=\"true\"\]\{[^}]*box-shadow:0 4px 0 var\(--ui-button-depth\)/.test(mainCSS),'统一主操作按钮禁用时应保留 4px 深色底座');
assert(!/\.gln-footer-actions button:disabled\{[^}]*box-shadow:none/.test(nodeCSS),'节点答题按钮禁用时不得隐藏深色底座');
assert(!/\.glp-primary-action:disabled\{[^}]*box-shadow:none/.test(placementCSS),'跳级测试按钮禁用时不得隐藏深色底座');
assert(placementHTML.includes('id="gptPrimaryAction"')&&!placementHTML.includes('id="gptCheckBtn"')&&!placementHTML.includes('id="gptContinueBtn"'),'跳级测试应只保留一个固定主按钮');
assert(placementJS.includes("setPrimaryAction('check','提交答案',true)")&&placementJS.includes("setPrimaryAction('continue'"),'跳级测试应仅切换同一按钮的文字和动作');
assert(/\.glp-test-actions\{display:grid;grid-column:2;grid-template-columns:160px;width:160px;min-height:48px/.test(placementCSS),'跳级测试主操作槽位应固定尺寸');
assert(/body\.guided-placement-page \.glp-choice-list button\.is-selected,[\s\S]*box-shadow:0 0 0 2px/.test(placementCSS),'跳级测试选中答案悬浮时应保留选中边框');
assert(/\.gln-footer-actions\{display:grid;grid-template-columns:160px 160px/.test(nodeCSS),'节点页应使用固定的辅助与主按钮槽位');
assert(nodeJS.includes('gln-footer-slot--secondary')&&nodeJS.includes('gln-footer-slot--primary'),'节点页按钮应渲染到固定槽位');
assert(!/\.gln-choice-list button\.is-selected\{[^}]*translateY\(-1px\)/.test(nodeCSS),'答案选中状态不应上移');
assert(course.stages.length===3,'应包含 3 个阶段');
assert(course.parts.length===9,'应包含 9 个部分（每阶段 3 个）');
assert(course.nodes.length===108,'应包含 108 个节点（每部分 12 个）');
const firstPart=course.nodes.slice(0,12);
const ordinary=firstPart.filter(node=>node.runMode!=='composite'&&node.nodeType!=='memory_match');
ordinary.forEach(node=>{
  const count=data.activitiesForNode(node.id).length;
  assert(count>=5&&count<=8,node.id+' 应固定配置 5～8 个活动');
});
const memoryNodes=firstPart.filter(node=>node.nodeType==='memory_match');
assert(memoryNodes.length===1,'第一部分应包含 1 个翻牌记忆节点');
memoryNodes.forEach(node=>{
  const list=data.activitiesForNode(node.id);
  assert(list.length===1,node.id+' 应配置 1 个翻牌游戏活动');
  const pairs=list[0].pairs||[];
  assert(pairs.length>=3&&pairs.length<=5,node.id+' 应配置 3～5 对卡片');
});
const firstPartTypes=firstPart.map(node=>node.nodeType);
for(const type of ['choice','keyword','matching','open_text','memory_match','deep_recall','multi_question_induction','knowledge_graph','part_challenge'])assert(firstPartTypes.includes(type),'课程应覆盖题型：'+type);
const processNode=firstPart.find(node=>node.id==='understanding-process');
const processActivities=data.activitiesForNode(processNode.id);
assert(processActivities.length===5,'处理顺序表达节点应固定为 5 个活动');
assert(processActivities.slice(0,4).every(activity=>activity.type==='choice'),'处理顺序表达前 4 题应为选择题');
assert(processActivities[4].type==='open_text','处理顺序表达最后 1 题应为简答题');
assert(processActivities[4].minLength===1,'简答题只要求非空，不应限制至少 30 字');
assert(processActivities[4].evaluationMode==='show_reference'&&processActivities[4].referenceAnswer,'简答提交后应显示参考答案');
const structureNode=firstPart.find(node=>node.id==='analysis-structure');
const structureActivities=data.activitiesForNode(structureNode.id);
assert(structureNode.title==='题干结构图','节点标题应更新为题干结构图');
assert(structureActivities.every(activity=>(activity.hints||[]).length>=1&&activity.hintAfterWrong===1),'题干结构图每题应在首次答错后的再次出现提供提示');
const compositeNodes=firstPart.filter(node=>node.runMode==='composite');
assert(compositeNodes.length===3,'第一部分应包含深度回忆、多题归纳与知识图谱三个复合节点');
const deepNode=compositeNodes.find(node=>node.nodeType==='deep_recall');
const inductionNode=compositeNodes.find(node=>node.nodeType==='multi_question_induction');
const graphNode=compositeNodes.find(node=>node.nodeType==='knowledge_graph');
assert(deepNode&&inductionNode&&graphNode,'三个复合节点类型均应存在');
const deepContent=data.contentForNode(deepNode.id);
assert(deepContent.mode==='composite','深度回忆节点应使用 composite 运行模式');
assert(deepContent.activities.length===1&&deepContent.activities[0].type==='deep_recall','深度回忆节点应加载 deep_recall 活动');
assert(deepContent.activities[0].conceptQuestions.length>=2&&deepContent.activities[0].conceptQuestions.length<=4,'深度回忆应配置 2～4 道知识判断题');
assert(deepContent.activities[0].reasoningTask.correctOrder.length===5,'深度回忆应配置推理路径排序');
const inductionContent=data.contentForNode(inductionNode.id);
const induction=inductionContent.activities[0];
assert(inductionContent.mode==='composite','多题归纳节点应使用 composite 运行模式');
assert(induction?.type==='multi_question_induction','多题归纳节点应加载 multi_question_induction 活动');
assert(induction.sourceQuestions.length===3,'多题归纳应固定配置三道源题');
assert(induction.classificationTask.categories.length===3,'多题归纳应配置三个分类区');
assert(induction.classificationTask.cards.length===3,'多题归纳应配置三张题目卡片');
assert(induction.classificationTask.cards.every(card=>card.correctCategoryId),'每张题目卡片应配置正确分类');
assert(induction.orderingTask.correctOrder.length===5,'多题归纳应配置五步通用规则');
assert((induction.orderingTask.hints||[]).length===2,'多题归纳排序应配置两级渐进提示');
assert(inductionContent.stages.join(',')==='questions,classification,ordering','多题归纳内容应声明三个内部阶段');
const graphContent=data.contentForNode(graphNode.id);
const graphActivity=graphContent.activities[0];
assert(graphNode.id==='integration-rule','知识图谱应沿用第 10 节点 ID，保持既有进度兼容');
assert(graphNode.title==='知识图谱','第 10 节点标题应为知识图谱');
assert(graphContent.mode==='composite','知识图谱节点应使用 composite 运行模式');
assert(graphActivity?.type==='knowledge_graph','知识图谱节点应加载 knowledge_graph 活动');
assert(graphActivity.graph.nodes.length>=5&&graphActivity.graph.nodes.length<=8,'知识图谱应配置 5～8 个知识节点');
assert(graphActivity.graph.edges.length>=4&&graphActivity.graph.edges.length<=7,'知识图谱应配置 4～7 条基础关系');
assert(graphActivity.missingNodeTasks.length===1,'知识图谱应包含 1 个知识点补全任务');
assert(graphActivity.relationTasks.length===2,'知识图谱应包含 2 个关系选择任务');
assert(graphActivity.errorConnectionTasks.length===1,'知识图谱应包含 1 个错误连接任务');
assert(graphActivity.missingNodeTasks.length+graphActivity.relationTasks.length+graphActivity.errorConnectionTasks.length===4,'知识图谱第一版应包含 4 个待完成项目');
assert([...graphActivity.missingNodeTasks,...graphActivity.relationTasks,...graphActivity.errorConnectionTasks].every(task=>(task.hints||[]).length===2),'知识图谱每项任务应配置两级渐进提示');
assert(graphActivity.errorConnectionTasks[0].candidateEdges.length===7,'错误连接任务应展示 7 条候选连接');
assert(graphContent.stages.join(',')==='missing,relation,error','知识图谱内容应声明三个内部阶段');
const challengeNodes=course.nodes.filter(node=>node.isChallenge);
assert(challengeNodes.length===9,'每个部分应包含 1 个综合挑战节点');
challengeNodes.forEach((node,index)=>{
  const list=data.activitiesForNode(node.id);
  const config=node.challengeConfig||{};
  const expectedComposite=['deep_recall','multi_question_induction','knowledge_graph'][index%3];
  assert(node.nodeType==='part_challenge'&&node.runMode==='challenge',node.id+' 应使用 part_challenge / challenge');
  assert(node.title==='部分综合挑战'&&node.estimatedMinutes===8,node.id+' 应显示正式挑战标题和预计时长');
  assert(list.length===8,node.id+' 应固定配置 8 个挑战活动');
  assert(list.slice(0,4).every(activity=>activity.type==='choice'),node.id+' 前 4 项应为单项选择');
  assert(list[4]?.type==='keyword'&&list[5]?.type==='matching'&&list[6]?.type==='open_text',node.id+' 应包含关键词、连线和开放表达');
  assert(list[7]?.type===expectedComposite,node.id+' 应按部分轮换复合任务');
  assert(config.schemaVersion===1&&config.selectionMode==='fixed'&&config.partId===node.partId,node.id+' 应提供后台友好的固定挑战配置');
  assert(config.requiredFinalCorrect===true&&config.showTypePerformance===true,node.id+' 应要求最终全对并展示分题型表现');
  assert(config.sourceNodeIds.length===11&&config.sourceNodeIds.every(sourceId=>course.nodes.some(source=>source.id===sourceId&&source.partId===node.partId&&!source.isChallenge)),node.id+' 应只引用当前部分前置节点');
  assert(config.activityIds.join(',')===node.activityIds.join(','),node.id+' 挑战配置与运行活动应一致');
  assert(data.contentForNode(node.id).challengeConfig?.partId===node.partId,node.id+' 内容接口应返回挑战配置');
});
const placementTests=course.parts.map(part=>data.placementTestForPart(part.id));
assert(placementTests.length===9&&placementTests.every(Boolean),'每个部分应配置 1 个跳级测试');
placementTests.forEach((test,index)=>{
  const part=course.parts[index];
  const firstNode=course.nodes.find(node=>node.partId===part.id&&node.order===1);
  assert(test.schemaVersion===1&&test.selectionMode==='fixed',part.id+' 跳级测试应使用结构化固定配置');
  assert(test.activities.length===12&&test.expectedActivityCount===12,part.id+' 跳级测试应包含 12 项代表性任务');
  assert(test.activities.filter(activity=>activity.type==='choice').length===10,part.id+' 跳级测试应包含 10 道选择题');
  assert(test.activities.filter(activity=>activity.type==='keyword').length===1,part.id+' 跳级测试应包含 1 个关键词任务');
  assert(test.activities.filter(activity=>activity.type==='matching').length===1,part.id+' 跳级测试应包含 1 个连线任务');
  assert(test.activities.every(activity=>['choice','keyword','matching'].includes(activity.type)),part.id+' 跳级测试只应使用可自动判分客观题型');
  assert(test.requiredCorrect===10&&test.passPercent===80,part.id+' 跳级测试应答对至少 10 项');
  assert(test.sourceNodeIds.length===11&&test.sourceNodeIds.every(id=>course.nodes.some(node=>node.id===id&&node.partId===part.id&&!node.isChallenge)),part.id+' 跳级测试只应取自当前部分前置节点');
  assert(firstNode.allowsPlacementTest===true&&firstNode.placementTestId===test.id,part.id+' 首节点应声明跳级测试入口');
});
assert(context.KGGuidedLearningActivityRegistry.has('deep_recall'),'活动注册表应包含 deep_recall 插件');
assert(context.KGGuidedLearningActivityRegistry.has('multi_question_induction'),'活动注册表应包含 multi_question_induction 插件');
assert(context.KGGuidedLearningActivityRegistry.has('knowledge_graph'),'活动注册表应包含 knowledge_graph 插件');
assert(context.KGGuidedLearningIconRegistry.has('deep_recall'),'SVG 图标注册表应包含 deep_recall');
assert(context.KGGuidedLearningIconRegistry.has('multi_question_induction'),'SVG 图标注册表应包含多题归纳图标');
assert(context.KGGuidedLearningIconRegistry.has('knowledge_graph'),'SVG 图标注册表应包含知识图谱图标');
assert(context.KGGuidedLearningIconRegistry.has('ordering'),'SVG 图标注册表应包含独立排序题图标');
assert(context.KGGuidedLearningIconRegistry.render('unknown-type').includes('data-icon-key="fallback"'),'未知活动类型应回退到默认 SVG 图标');
const pathAppSource=fs.readFileSync('src/89-guided-learning-app.js','utf8');
const nodeAppSource=fs.readFileSync('src/90-guided-learning-node-app.js','utf8');
assert(/isAdminUser\(\)/.test(pathAppSource)&&/admin-open/.test(pathAppSource),'学习路径应为管理员开放全部节点入口');
assert(/state\.adminPreview=isAdminUser\(\)/.test(nodeAppSource)&&/不写入学员解锁进度/.test(nodeAppSource),'管理员节点测试应绕过锁定并保持预览隔离');
assert(/firstAttemptAccuracy/.test(nodeAppSource)&&/typePerformance/.test(nodeAppSource)&&/weakestTypeLabel/.test(nodeAppSource),'综合挑战应计算首答正确率、分题型表现和最薄弱题型');
assert(/本部分挑战完成/.test(nodeAppSource)&&/gln-type-performance/.test(nodeAppSource),'综合挑战应使用专属完成页');
const placementSource=fs.readFileSync('src/89-guided-learning-placement-test.js','utf8');
const pathHTML=fs.readFileSync('learning-path.html','utf8');
assert(/data-gl-placement-part/.test(pathAppSource)&&/openPlacementChoice/.test(pathAppSource),'路径首节点应提供正常开始与跳级测试选择');
assert(/id="glPlacementChoice"/.test(pathHTML)&&/参加跳级测试/.test(pathHTML),'学习路径应包含跳级选择弹窗');
assert(/glPlacementNormalBtn/.test(pathHTML)&&/ui-button ui-button--secondary/.test(pathHTML)&&/glPlacementTestBtn/.test(pathHTML)&&/ui-button ui-button--primary/.test(pathHTML)&&!/ui-button ui-button--primary primary/.test(pathHTML),'学习方式弹窗应使用统一主辅按钮组件');
assert(!/ui-button--primary primary/.test(nodeAppSource)&&!/ui-button--secondary secondary/.test(placementJS),'引导学习统一按钮不应再混用旧版 primary / secondary 标记类');
assert(/completePartByPlacementTest/.test(placementSource)&&/recordPlacementTestAttempt/.test(placementSource),'跳级运行器应区分通过与失败记录');
assert(/requiredCorrect/.test(placementSource)&&/未通过不会改变/.test(placementHTML),'跳级测试应按通过标准判分且失败不解锁');
assert(!/is-placement|跳级记录/.test(pathAppSource+pathCSS),'跳级通过节点不应使用特殊视觉状态');
assert(/title=\"'\+escapeHTML\(nodeTitle\)/.test(pathAppSource)&&!/<small>'\+escapeHTML\(node\.subtitle/.test(pathAppSource),'节点悬浮说明应只显示节点名称');
assert(firstPart.every(node=>node.iconKey&&!Object.prototype.hasOwnProperty.call(node,'icon')),'首页节点应使用 iconKey，不再保存单字图标');
assert((deepContent.activities[0].clueTask.hints||[]).length===2,'线索识别应配置两级渐进提示');
assert(deepContent.activities[0].conceptQuestions.every(question=>(question.hints||[]).length===2),'每道知识判断应配置两级渐进提示');
assert((deepContent.activities[0].reasoningTask.hints||[]).length===2,'路径排序应配置两级渐进提示');
assert(Object.keys(course.activities).length===82,'移除旧挑战补位副本后应包含 82 个可复用固定活动');
assert(course.activitySchemaVersion===1&&course.schemaVersion===1,'课程应声明 Activity Schema v1');
assert(course.assessmentLanguage==='zh'&&course.questionLanguageModes.join(',')==='zh,bilingual','学员端应只开放中文和中英对照，判定语言固定为中文');
assert(!nodeHTML.includes('data-question-language="en"')&&!placementHTML.includes('data-question-language="en"'),'学员答题页不应开放纯英文模式');
assert(nodeHTML.includes('英文仅供对照，请使用中文作答')&&placementHTML.includes('英文仅供对照，请使用中文作答'),'中英对照模式应明确提示使用中文作答');
const firstChoiceSchema=Object.values(course.activities).find(activity=>activity.type==='single_choice');
assert(firstChoiceSchema&&firstChoiceSchema.schemaVersion===1,'活动库应保存规范化活动记录');
assert(firstChoiceSchema.assessment?.language==='zh','每个活动都应明确中文判定语言');
assert(firstChoiceSchema.answer.optionId&&firstChoiceSchema.content.zh.options.every(option=>!Object.prototype.hasOwnProperty.call(option,'correct')),'正确答案应与双语显示选项分离并使用稳定 optionId');
assert(data.validateActivityLibrary().valid===true,'迁移后的 Activity Schema v1 活动库应通过严重错误校验');
const runtimeChoice=data.activityById(firstChoiceSchema.id,'en');
assert(runtimeChoice.type==='choice'&&runtimeChoice.options.some(option=>option.correct),'兼容层应把规范活动物化为现有运行器结构');
assert(runtimeChoice.languageMode==='en'&&runtimeChoice.languageFallback===true,'英文内容缺失时应明确回退中文');
const activityPackage=data.exportActivityPackage({packageId:'test-package',author:'test'});
assert(activityPackage.schemaVersion===1&&activityPackage.activities.length===82&&/^fnv1a32:/.test(activityPackage.contentHash),'应能导出带版本和内容哈希的标准活动包');
assert(context.KGActivitySchemaV1.validatePackage(activityPackage).valid===true,'刚导出的标准活动包应能通过完整校验');
const normalizedMetadataPackage=context.KGActivitySchemaV1.createPackage({[firstChoiceSchema.id]:firstChoiceSchema},{packageId:'normalized-metadata-package',packageVersion:1.5,createdAt:'not-a-date'});
assert(normalizedMetadataPackage.packageVersion===1&&/^\d{4}-\d{2}-\d{2}T/.test(normalizedMetadataPackage.createdAt),'导出器应把无效包版本和创建时间规范为可校验值');
const previousV1Package=JSON.parse(JSON.stringify(activityPackage));
previousV1Package.activities.forEach(activity=>delete activity.assessment);
previousV1Package.contentHash=context.KGActivitySchemaV1.createPackage(Object.fromEntries(previousV1Package.activities.map(activity=>[activity.id,activity])),{packageId:'hash-helper'}).contentHash;
assert(context.KGActivitySchemaV1.validatePackage(previousV1Package).valid===true,'导入器应兼容早期 Activity Schema v1 中尚未写入 assessment 的活动');
const malformedPackage={schemaVersion:1,packageId:'bad-package',packageVersion:1,contentHash:'fnv1a32:00000000',activities:{}};
assert(context.KGActivitySchemaV1.validatePackage(malformedPackage).valid===false,'activities 类型错误时应返回校验错误而不是抛出异常');
const stringVersionPackage=JSON.parse(JSON.stringify(activityPackage));stringVersionPackage.packageVersion='1';
assert(context.KGActivitySchemaV1.validatePackage(stringVersionPackage).errors.some(message=>message.includes('packageVersion')),'活动包版本必须是数字整数，不能使用字符串');
const standardOffsetPackage=JSON.parse(JSON.stringify(activityPackage));standardOffsetPackage.createdAt='2026-07-21T08:00:00+08:00';standardOffsetPackage.updatedAt='2026-07-21T09:00:00+08:00';
assert(context.KGActivitySchemaV1.validatePackage(standardOffsetPackage).valid===true,'活动包应接受标准 RFC3339 时区偏移时间');
const duplicatePackage=JSON.parse(JSON.stringify(activityPackage));
duplicatePackage.activities.push(JSON.parse(JSON.stringify(duplicatePackage.activities[0])));
assert(context.KGActivitySchemaV1.validatePackage(duplicatePackage).errors.some(message=>message.includes('活动 ID 重复')),'导入包必须拒绝内容相同的重复活动 ID');
const conflictPackage=JSON.parse(JSON.stringify(activityPackage));
const conflictActivity=JSON.parse(JSON.stringify(conflictPackage.activities[0]));
conflictActivity.metadata={...conflictActivity.metadata,conflictMarker:true};
conflictPackage.activities.push(conflictActivity);
assert(context.KGActivitySchemaV1.validatePackage(conflictPackage).errors.some(message=>message.includes('活动 ID 冲突')),'导入包必须识别同一 ID 的内容冲突');
const invalidDatePackage=JSON.parse(JSON.stringify(activityPackage));
invalidDatePackage.createdAt='2026-07-20';
assert(context.KGActivitySchemaV1.validatePackage(invalidDatePackage).errors.some(message=>message.includes('createdAt')),'导入包必须校验 createdAt 标准时间格式');
const reversedDatePackage=JSON.parse(JSON.stringify(activityPackage));
reversedDatePackage.createdAt='2026-07-21T00:00:00.000Z';
reversedDatePackage.updatedAt='2026-07-20T00:00:00.000Z';
assert(context.KGActivitySchemaV1.validatePackage(reversedDatePackage).errors.some(message=>message.includes('updatedAt 不能早于 createdAt')),'导入包更新时间不得早于创建时间');
const tamperedPackage=JSON.parse(JSON.stringify(activityPackage));
tamperedPackage.activities[0].content.zh=JSON.parse(JSON.stringify(tamperedPackage.activities[0].content.zh));
tamperedPackage.activities[0].content.zh[Object.keys(tamperedPackage.activities[0].content.zh)[0]]='被篡改的内容';
assert(context.KGActivitySchemaV1.validatePackage(tamperedPackage).errors.some(message=>message.includes('contentHash')),'内容被修改后必须无法通过哈希校验');
const parsedPackage=context.KGActivitySchemaV1.parsePackage(JSON.stringify(activityPackage));
assert(parsedPackage.valid&&Object.keys(parsedPackage.library).length===82,'导入接口应支持 JSON 文本并生成规范活动库');
const mergeNewActivity=JSON.parse(fs.readFileSync('schemas/activity-schema-v1.ordering.example.json','utf8'));
const mergePackage=context.KGActivitySchemaV1.createPackage({[mergeNewActivity.id]:mergeNewActivity},{packageId:'merge-package'});
const mergeAnalysis=context.KGActivitySchemaV1.analyzePackageMerge(course.activities,mergePackage);
assert(mergeAnalysis.valid&&mergeAnalysis.report.newActivities.some(item=>item.activityId===mergeNewActivity.id),'导入分析应识别新活动');
const merged=context.KGActivitySchemaV1.mergePackage(course.activities,mergePackage);
assert(merged.valid&&merged.library[mergeNewActivity.id],'无冲突活动包应可合并为新活动库');
const conflictImport=JSON.parse(JSON.stringify(firstChoiceSchema));
conflictImport.content.zh.stem+='（更新）';
const conflictMergePackage=context.KGActivitySchemaV1.createPackage({[conflictImport.id]:conflictImport},{packageId:'conflict-merge-package'});
const rejectedMerge=context.KGActivitySchemaV1.mergePackage(course.activities,conflictMergePackage);
assert(rejectedMerge.valid===false&&rejectedMerge.report.conflicts.length===1,'默认合并策略应拒绝同 ID 内容冲突');
const replacedMerge=context.KGActivitySchemaV1.mergePackage(course.activities,conflictMergePackage,{conflictPolicy:'replace'});
assert(replacedMerge.valid&&replacedMerge.library[conflictImport.id].content.zh.stem.endsWith('（更新）'),'显式 replace 策略应允许替换冲突活动');
const blankChoice={id:'blank-choice',type:'single_choice',schemaVersion:1,content:{zh:{stem:'',options:[{id:'A',text:''},{id:'B',text:''}]},en:null},answer:{optionId:'A'},explanation:{zh:{short:'',detailed:'',incorrect:'',general:''},en:null},config:{},metadata:{translationStatus:'zh_only'}};
assert(context.KGActivitySchemaV1.validate(blankChoice).valid===false,'空题干和空选项不得通过活动校验');
const unknownType={...JSON.parse(JSON.stringify(firstChoiceSchema)),id:'unknown-type',type:'singel_choice'};
assert(context.KGActivitySchemaV1.validate(unknownType).errors.some(message=>message.includes('不支持的活动类型')),'未知或拼写错误的活动类型必须被阻止');
const numericActivityId=JSON.parse(JSON.stringify(firstChoiceSchema));numericActivityId.id=123;
assert(context.KGActivitySchemaV1.validate(numericActivityId).errors.some(message=>message.includes('字符串形式的稳定活动 ID')),'活动 ID 必须保持字符串类型');
const stringSchemaVersion=JSON.parse(JSON.stringify(firstChoiceSchema));stringSchemaVersion.id='string-schema-version';stringSchemaVersion.schemaVersion='1';
assert(context.KGActivitySchemaV1.validate(stringSchemaVersion).errors.some(message=>message.includes('数字 1')),'活动 schemaVersion 必须保持数字类型');
const mismatchedAdapter=JSON.parse(JSON.stringify(firstChoiceSchema));
mismatchedAdapter.id='mismatched-adapter';mismatchedAdapter.metadata.adapter='matching';
assert(context.KGActivitySchemaV1.validate(mismatchedAdapter).errors.some(message=>message.includes('metadata.adapter')),'metadata.adapter 与 type 不一致时必须被阻止');
const mismatchedRuntime=JSON.parse(JSON.stringify(firstChoiceSchema));
mismatchedRuntime.id='mismatched-runtime';mismatchedRuntime.metadata.runtimeType='matching';
assert(context.KGActivitySchemaV1.validate(mismatchedRuntime).errors.some(message=>message.includes('metadata.runtimeType')),'metadata.runtimeType 与 type 不一致时必须被阻止');
const englishAssessment=JSON.parse(JSON.stringify(firstChoiceSchema));
englishAssessment.id='english-assessment';englishAssessment.assessment.language='en';
assert(context.KGActivitySchemaV1.validate(englishAssessment).errors.some(message=>message.includes('assessment.language')),'当前版本不得启用英文判定');
const missingEnglishSlot=JSON.parse(JSON.stringify(firstChoiceSchema));
missingEnglishSlot.id='missing-english-slot';delete missingEnglishSlot.content.en;
assert(context.KGActivitySchemaV1.validate(missingEnglishSlot).errors.some(message=>message.includes('content 缺少 en 字段')),'没有英文内容时也必须显式保留 content.en=null');
const missingEnglishExplanationSlot=JSON.parse(JSON.stringify(firstChoiceSchema));
missingEnglishExplanationSlot.id='missing-english-explanation-slot';delete missingEnglishExplanationSlot.explanation.en;
assert(context.KGActivitySchemaV1.validate(missingEnglishExplanationSlot).errors.some(message=>message.includes('explanation 缺少 en 字段')),'没有英文解析时也必须显式保留 explanation.en=null');
const impossibleEnglishOnly=JSON.parse(JSON.stringify(firstChoiceSchema));
impossibleEnglishOnly.id='english-only-status';impossibleEnglishOnly.metadata.translationStatus='en_only';
assert(context.KGActivitySchemaV1.validate(impossibleEnglishOnly).errors.some(message=>message.includes('translationStatus')),'中文必填的当前版本不得声明 en_only');
const orderingExample=JSON.parse(fs.readFileSync('schemas/activity-schema-v1.ordering.example.json','utf8'));
assert(context.KGActivitySchemaV1.validate(orderingExample).valid===true,'标准排序活动应通过 Activity Schema v1 校验');
const orderingRuntime=context.KGActivitySchemaV1.materialize(orderingExample,'bilingual');
assert(orderingRuntime.type==='ordering'&&orderingRuntime.correctOrder.join(',')==='step-1,step-2,step-3','排序活动应物化为稳定 itemId 顺序');
assert(orderingRuntime.items[0].text.includes('识别项目环境')&&orderingRuntime.items[0].text.includes('Identify the project environment'),'排序活动应支持中英对照展示');
assert(nodeJS.includes("target.register('ordering'")&&nodeJS.includes('submitOrdering'),'节点运行器应注册独立排序活动插件');
const bilingualExample=JSON.parse(fs.readFileSync('schemas/activity-schema-v1.example.json','utf8'));
assert(context.KGActivitySchemaV1.validate(bilingualExample).valid===true,'中英双语示例应通过 Activity Schema v1 校验');
const bilingualRuntime=context.KGActivitySchemaV1.materialize(bilingualExample,'bilingual');
assert(bilingualRuntime.stem.includes('项目需求频繁变化')&&bilingualRuntime.stem.includes('Project requirements change frequently'),'双语物化应同时输出中英文题干');
assert(bilingualRuntime.options.find(option=>option.id==='B').correct===true,'双语物化后仍应通过稳定 optionId 判定正确答案');
const partialEnglish=JSON.parse(JSON.stringify(bilingualExample));
partialEnglish.content.en.options[2].text='';
partialEnglish.explanation.en.detailed='';
const partialRuntime=context.KGActivitySchemaV1.materialize(partialEnglish,'en');
assert(partialRuntime.options.find(option=>option.id==='C').text===partialEnglish.content.zh.options[2].text,'英文选项缺失时应按稳定 ID 回退对应中文选项');
assert(partialRuntime.detailedExplanation===partialEnglish.explanation.zh.detailed&&partialRuntime.languageFallback===true,'部分英文解析缺失时应回退中文并标记 languageFallback');
const partialOpen=context.KGActivitySchemaV1.fromLegacy({id:'partial-open',type:'open_text',prompt:'中文题目',requiredConcepts:[{id:'c1',acceptedExpressions:['中文一'],missingHint:'提示一'},{id:'c2',acceptedExpressions:['中文二'],missingHint:'提示二'}]});
partialOpen.content.en={prompt:'English prompt',placeholder:'',referenceAnswer:''};
partialOpen.answer.acceptedConcepts.en=[{id:'c1',acceptedExpressions:['english one'],missingHint:'hint one'}];
const partialOpenRuntime=context.KGActivitySchemaV1.materialize(partialOpen,'bilingual');
assert(partialOpenRuntime.requiredConcepts.length===2&&partialOpenRuntime.requiredConcepts.every(item=>item.acceptedExpressions.every(expression=>!expression.startsWith('english'))),'英文只用于展示，开放表达判定必须始终使用中文概念');
assert(partialOpenRuntime.assessmentLanguage==='zh'&&partialOpenRuntime.answerLanguage==='zh','运行器必须明确中文作答与判定');
assert(/white-space:pre-line/.test(nodeCSS)&&/white-space:pre-line/.test(placementCSS),'双语内容换行应由节点页和跳级测试页样式保留');
assert(/currentNodeId\|\|currentNode\(\)\?\.id/.test(pathAppSource)&&/\(isCurrent\?' is-current'/.test(pathAppSource),'路径脉冲环应只绑定 progress.currentNodeId 指向的唯一可学习节点');
let progress=store.read(course,'tester');
assert(progress.nodes[course.nodes[0].id].status==='available','首节点应可学习');
assert(progress.nodes[course.nodes[1].id].status==='locked','第二节点应锁定');
progress=store.completeNode(course,course.nodes[0].id,{metrics:{accuracy:80,activeDurationSeconds:321,maxCorrectStreak:4,totalAttempts:6,correctAttempts:5,hintUsedCount:1}},'tester');
assert(progress.nodes[course.nodes[0].id].status==='completed','首节点应完成');
assert(progress.nodes[course.nodes[0].id].metrics.accuracy===80,'应保存节点完成统计');
assert(progress.nodes[course.nodes[1].id].status==='available','第二节点应解锁');
assert(progress.nodes[course.nodes[2].id].status==='locked','第三节点仍应锁定');
progress=store.completeNode(course,course.nodes[2].id,{},'tester');
assert(progress.nodes[course.nodes[2].id].status==='locked','不能越过锁定节点完成');
progress=store.completeScopeByTest(course,'part',course.parts[0].id,'tester');
assert(progress.nodes[course.nodes[0].id].metrics.accuracy===80,'已经正常完成的节点统计不应被跳级测试覆盖');
assert(!Object.prototype.hasOwnProperty.call(progress.nodes[course.nodes[1].id],'completionMethod'),'节点记录不应再保存跳级完成方式');
const summary=store.summary(course,progress);
assert(summary.completed===12,'第一部分应有 12 个完成节点');
const partSummary=store.partSummary(course,course.parts[0].id,progress);
assert(partSummary.done===true&&partSummary.completed===12,'第一部分应统一显示为完成');

// 失败测试只记录成绩，不改变解锁链路。
const placementUser='placement-student';
let placementProgress=store.read(course,placementUser);
const placementPart=course.parts[0];
const placementConfig=data.placementTestForPart(placementPart.id);
placementProgress=store.recordPlacementTestAttempt(course,placementPart.id,{
  testId:placementConfig.id,correct:8,total:12,passed:false,activeDurationSeconds:91,answers:[]
},placementUser);
assert(placementProgress.placementTests[placementPart.id].attemptCount===1,'失败测试应保存尝试次数');
assert(placementProgress.placementTests[placementPart.id].passed===false&&placementProgress.placementTests[placementPart.id].bestCorrect===8,'失败测试应保存最好成绩');
assert(placementProgress.nodes[course.nodes[0].id].status==='available'&&placementProgress.nodes[course.nodes[1].id].status==='locked','失败测试不得改变节点解锁状态');

// 通过后整部分统一标记为完成，并开放下一部分首节点；测试来源只保留在 placementTests。
placementProgress=store.completePartByPlacementTest(course,placementPart.id,{
  testId:placementConfig.id,correct:10,total:12,percent:83,passed:true,activeDurationSeconds:104,answers:[]
},placementUser);
const firstPartNodes=course.nodes.filter(node=>node.partId===placementPart.id);
assert(firstPartNodes.every(node=>placementProgress.nodes[node.id].status==='completed'),'通过跳级测试后应完成整个部分');
assert(firstPartNodes.every(node=>!Object.prototype.hasOwnProperty.call(placementProgress.nodes[node.id],'completionMethod')),'跳级完成节点应使用统一完成数据结构');
const nextPartFirst=course.nodes.find(node=>node.partId===course.parts[1].id&&node.order===1);
assert(placementProgress.nodes[nextPartFirst.id].status==='available','通过后应开放下一部分首节点');
assert(placementProgress.placementTests[placementPart.id].attemptCount===2&&placementProgress.placementTests[placementPart.id].passed===true,'通过记录应保留失败与成功两次尝试');
assert(placementProgress.placementTests[placementPart.id].bestCorrect===10&&placementProgress.placementTests[placementPart.id].bestPercent===83,'通过记录应更新最好成绩');

// 跳级后回头完整学习节点，只更新该节点练习统计，不引入完成方式字段。
const learnedNode=firstPartNodes[0];
const placementCompletedAt=placementProgress.nodes[learnedNode.id].completedAt;
placementProgress=store.completeNode(course,learnedNode.id,{metrics:{accuracy:100}},placementUser);
assert(placementProgress.nodes[learnedNode.id].completedAt===placementCompletedAt,'统一完成状态应保留首次完成时间');
assert(placementProgress.nodes[learnedNode.id].metrics.accuracy===100,'回头练习后应保存节点学习统计');
assert(!Object.prototype.hasOwnProperty.call(placementProgress.nodes[learnedNode.id],'completionMethod'),'回头练习不应新增完成方式字段');

// 兼容旧 passed_by_test / completionMethod 数据，并迁移为统一完成状态。
const legacyUser='legacy-placement';
const legacyKey=store.PREFIX+encodeURIComponent(legacyUser)+'__'+encodeURIComponent(course.id);
storage.set(legacyKey,JSON.stringify({
  schemaVersion:3,userId:legacyUser,courseId:course.id,
  nodes:{[course.nodes[0].id]:{status:'completed',completionMethod:'placement_test',completionType:'passed_by_test',completedAt:12345,metrics:null}}
}));
const migrated=store.read(course,legacyUser);
assert(migrated.schemaVersion===4,'旧进度应迁移到 schemaVersion 4');
assert(migrated.nodes[course.nodes[0].id].status==='completed','旧跳级节点应迁移为普通完成状态');
assert(!Object.prototype.hasOwnProperty.call(migrated.nodes[course.nodes[0].id],'completionMethod'),'迁移后应移除节点级完成方式');

// 非连续历史完成记录允许补学旧缺口，但唯一当前位置应保持在最靠后的学习前沿。
const gapUser='legacy-gap';
const gapKey=store.PREFIX+encodeURIComponent(gapUser)+'__'+encodeURIComponent(course.id);
storage.set(gapKey,JSON.stringify({
  schemaVersion:4,userId:gapUser,courseId:course.id,
  nodes:{[course.nodes[1].id]:{status:'completed',completedAt:22222,metrics:null}}
}));
const gapProgress=store.read(course,gapUser);
const gapAvailable=course.nodes.filter(node=>gapProgress.nodes[node.id].status==='available');
assert(gapAvailable.length===2&&gapAvailable[0].id===course.nodes[0].id&&gapAvailable[1].id===course.nodes[2].id,'非连续完成数据应同时保留旧缺口与最新学习前沿的可学习入口');
assert(gapProgress.currentNodeId===course.nodes[2].id,'当前位置必须指向课程顺序中最靠后的 available 节点');
assert(gapProgress.nodes[course.nodes[3].id].status==='locked','最新学习前沿之后的节点仍应保持锁定');
console.log(JSON.stringify({stages:course.stages.length,parts:course.parts.length,nodes:course.nodes.length,activities:Object.keys(course.activities).length,ordinaryCounts:ordinary.map(node=>data.activitiesForNode(node.id).length),mixedProcess:{types:processActivities.map(activity=>activity.type),openMinLength:processActivities[4].minLength},structureHints:structureActivities.length,memoryPairs:memoryNodes.map(node=>data.activitiesForNode(node.id)[0].pairs.length),deepRecall:{nodeId:deepNode.id,conceptQuestions:deepContent.activities[0].conceptQuestions.length,reasoningSteps:deepContent.activities[0].reasoningTask.correctOrder.length},multiInduction:{nodeId:inductionNode.id,sourceQuestions:induction.sourceQuestions.length,categories:induction.classificationTask.categories.length,ruleSteps:induction.orderingTask.correctOrder.length},knowledgeGraph:{nodeId:graphNode.id,nodes:graphActivity.graph.nodes.length,edges:graphActivity.graph.edges.length,tasks:graphActivity.missingNodeTasks.length+graphActivity.relationTasks.length+graphActivity.errorConnectionTasks.length},partChallenges:{count:challengeNodes.length,types:data.activitiesForNode(challengeNodes[0].id).map(activity=>activity.type)},placementTests:{count:placementTests.length,activities:placementTests[0].activities.length,requiredCorrect:placementTests[0].requiredCorrect},partSummary},null,2));
