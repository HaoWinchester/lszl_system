'use strict';
const VERSION='0.4.0';
const KEYWORD_SCHEMA='Question Keyword System v2';
const BASE_TAG_GROUPS=[
  {id:'usage',label:'用途标签',categories:[{id:'stage',label:'训练阶段',options:['基础练习','阶段测试','模拟考试','冲刺复习','预习练习','强化训练','错题复盘']},{id:'scene',label:'使用场景',options:['课后练习','课堂讨论','作业题','专项训练']}]},
  {id:'quality',label:'质量标签',categories:[{id:'feature',label:'题目特征',options:['易错题','高频题','核心题','综合题']},{id:'review',label:'内容状态',options:['待复核','已复核','需更新']}]},
  {id:'source',label:'来源标签',categories:[{id:'origin',label:'来源类型',options:['真题','自编题','改编题','教材例题']},{id:'scope',label:'使用范围',options:['可公开','内部使用']}]}];

/* v0.4.0 internal tag identity.
   Formal/main-program exports still use legacy numeric slots. */
const TAG_SLOT_SEMANTIC_MAP=Object.freeze({
  'usage/stage/0':'global/usage/stage/basic','usage/stage/basic':'global/usage/stage/basic',
  'usage/stage/1':'global/usage/stage/phase-test','usage/stage/phase-test':'global/usage/stage/phase-test',
  'usage/stage/2':'global/usage/stage/mock-exam','usage/stage/mock-exam':'global/usage/stage/mock-exam',
  'usage/stage/3':'global/usage/stage/sprint-review','usage/stage/sprint-review':'global/usage/stage/sprint-review',
  'usage/stage/4':'global/usage/stage/preview','usage/stage/preview':'global/usage/stage/preview',
  'usage/stage/5':'global/usage/stage/intensive','usage/stage/intensive':'global/usage/stage/intensive',
  'usage/stage/6':'global/usage/stage/mistake-review','usage/stage/mistake-review':'global/usage/stage/mistake-review',
  'usage/scene/0':'global/usage/scene/after-class','usage/scene/after-class':'global/usage/scene/after-class',
  'usage/scene/1':'global/usage/scene/classroom-discussion','usage/scene/classroom-discussion':'global/usage/scene/classroom-discussion',
  'usage/scene/2':'global/usage/scene/homework','usage/scene/homework':'global/usage/scene/homework',
  'usage/scene/3':'global/usage/scene/special-training','usage/scene/special-training':'global/usage/scene/special-training',
  'quality/feature/0':'global/quality/feature/error-prone','quality/feature/error-prone':'global/quality/feature/error-prone',
  'quality/feature/1':'global/quality/feature/high-frequency','quality/feature/high-frequency':'global/quality/feature/high-frequency',
  'quality/feature/2':'global/quality/feature/core','quality/feature/core':'global/quality/feature/core',
  'quality/feature/3':'global/quality/feature/comprehensive','quality/feature/comprehensive':'global/quality/feature/comprehensive',
  'quality/review/0':'global/quality/review/pending-review','quality/review/pending-review':'global/quality/review/pending-review',
  'quality/review/1':'global/quality/review/reviewed','quality/review/reviewed':'global/quality/review/reviewed',
  'quality/review/2':'global/quality/review/needs-update','quality/review/needs-update':'global/quality/review/needs-update',
  'source/origin/0':'global/source/origin/real-exam','source/origin/real-exam':'global/source/origin/real-exam',
  'source/origin/1':'global/source/origin/self-authored','source/origin/self-authored':'global/source/origin/self-authored',
  'source/origin/2':'global/source/origin/adapted','source/origin/adapted':'global/source/origin/adapted',
  'source/origin/3':'global/source/origin/textbook-example','source/origin/textbook-example':'global/source/origin/textbook-example',
  'source/scope/0':'global/source/scope/public','source/scope/public':'global/source/scope/public',
  'source/scope/1':'global/source/scope/internal','source/scope/internal':'global/source/scope/internal'
});
/* P4.5.29 差异 26：内部真源一律 global/...；正式导出只回退旧数字槽位（主程序兼容），usage/... 不再作为保存形态 */
const TAG_SLOT_LEGACY_MAP=Object.freeze(Object.fromEntries(Object.entries(TAG_SLOT_SEMANTIC_MAP).filter(([legacy])=>/\d+$/.test(legacy)).map(([legacy,semantic])=>[semantic,legacy])));
function legacyTagSlotKey(g,c,i){return `${g.id}/${c.id}/${i}`}
function semanticTagSlot(slot){slot=String(slot||'').trim();if(!slot)return '';if(slot.startsWith('global/')){return TAG_SLOT_SEMANTIC_MAP[slot.slice(7)]||slot}return TAG_SLOT_SEMANTIC_MAP[slot]||slot}
function formalTagSlot(slot){slot=semanticTagSlot(slot);return TAG_SLOT_LEGACY_MAP[slot]||slot}
function tagSlotKey(g,c,i){return semanticTagSlot(legacyTagSlotKey(g,c,i))}
function tagCategoryKey(g,c){return `${g.id}/${c.id}`}
function tagGroupKey(g){return g.id}
const COMPLETE_CONTENT_BUNDLE_TEMPLATE={"prepContentBundleVersion":1,"format":"pmp-content-prep-complete-bundle-v1","questionBank":{"name":"PMP 完整内容模板题库","subject":"PMP","description":"完整字段示例：双语、知识点、关键词、推理、标签、原则与选项归纳卡映射。","version":"1.0","visibility":"private","questions":[{"title":"已发送不等于已沟通","type":"single_choice","subject":"PMP","difficulty":"基础","domain":"PMP 沟通绩效域 / 利益相关方与沟通管理","topic":"项目沟通管理的概念","tags":["基础练习","核心题","自编题","内部使用"],"stage":"基础练习","stemParts":[{"text":"项目经理按计划向团队发送了一份重要变更通知，但第二天发现多名成员仍按旧方案工作。项目经理首先应该认识到什么？"}],"options":[{"id":"A","text":"只要邮件发送成功，沟通责任就已经完成","trap":"把发送等同于有效沟通","correct":false},{"id":"B","text":"有效沟通不仅是发送信息，还要确认信息被接收和理解","trap":"","correct":true},{"id":"C","text":"应立即处罚没有阅读邮件的成员","trap":"过早升级 / 命令控制","correct":false},{"id":"D","text":"以后所有信息都应由发起人亲自传达","trap":"角色责任错置","correct":false}],"correctAnswer":"B","analysis":"沟通的效果不以“已经发送”为终点，而以信息是否被正确接收、理解并产生预期行动来判断。项目经理应建立反馈或确认机制，而不是把发送动作等同于沟通完成。","translations":{"en":{"title":"Sent Does Not Mean Understood","stemParts":[{"text":"The project manager sent an important change notice to the team as planned, but several members were still working from the old approach the next day. What should the project manager recognize first?"}],"options":[{"id":"A","text":"Once the email is successfully sent, the communication responsibility is complete"},{"id":"B","text":"Effective communication requires more than sending information; receipt and understanding should be confirmed"},{"id":"C","text":"Members who did not read the email should be disciplined immediately"},{"id":"D","text":"All future information should be delivered personally by the sponsor"}],"analysis":"Communication effectiveness is measured by whether the message is received, understood, and translated into the intended action, not merely by transmission.","optionFeedback":{"A":"Incorrect: sending alone does not prove communication effectiveness.","B":"Correct: effective communication requires receipt and understanding.","C":"Incorrect: this is premature escalation.","D":"Incorrect: this shifts communication responsibility to the wrong role."},"keyPath":{"label":"Communication effectiveness → confirmation → B","ruleText":"Communication is effective when the message is received, understood, and acted upon."},"explanationStatus":"complete"}},"clues":[{"id":"kw-001","text":"项目经理","textEn":"project manager","keywordLevel":"normal","isCore":false,"type":"recall-keyword","clueRole":"true","sourceType":"stem","sourceOptionId":"","recallNodeId":"recall-tax-kp-pmp-people-2-2-1-k01","recallEntryLabel":"项目经理","solutionRole":"context","coreReason":"","conceptIds":["kp-pmp-people-1-1-4"],"matchLocations":[{"field":"stem","optionId":"","count":2}],"explain":"关键词“项目经理”连接到联想入口“项目经理”。","sourceMode":"prep-studio-keyword-v2"},{"id":"kw-002","text":"首先","textEn":"first","keywordLevel":"core","isCore":true,"type":"core-keyword","clueRole":"true","sourceType":"stem","sourceOptionId":"","recallNodeId":"recall-keyword-pmp-action-order","recallEntryLabel":"PMP 情景题动作顺序","solutionRole":"decision-cue","coreReason":"题目要求识别优先判断，而不是最终处置。","conceptIds":["kp-pmp-people-1-1-4"],"matchLocations":[{"field":"stem","optionId":"","count":1}],"explain":"关键词“首先”连接到联想入口“PMP 情景题动作顺序”。","sourceMode":"prep-studio-keyword-v2"},{"id":"kw-003","text":"有效沟通","textEn":"effective communication","keywordLevel":"core","isCore":true,"type":"core-keyword","clueRole":"true","sourceType":"option","sourceOptionId":"B","recallNodeId":"recall-tax-kp-pmp-people-1-1-4","recallEntryLabel":"项目沟通管理的概念","solutionRole":"answer-anchor","coreReason":"该词直接区分“发送信息”与“真正完成沟通”。","conceptIds":["kp-pmp-people-1-1-4"],"matchLocations":[{"field":"option","optionId":"B","count":1}],"explain":"关键词“有效沟通”连接到联想入口“项目沟通管理的概念”。","sourceMode":"prep-studio-keyword-v2"}],"concepts":[{"id":"kp-pmp-people-1-1-4","title":"项目沟通管理的概念","category":"PMP 沟通绩效域","level":"基础","keywords":"沟通,有效沟通,反馈,理解","summary":"PMP > 人 > 利益相关方与沟通管理 > 项目沟通管理的概念","notes":"映射稳定知识节点 ID。","rule":"有效沟通需要接收、理解和反馈闭环。"}],"reasoningSteps":[{"id":"rs-1","title":"识别核心线索","content":"首先 + 有效沟通，说明题目在问优先判断与沟通有效性。","relatedKeywords":["首先","有效沟通"],"relatedKnowledgePoints":["kp-pmp-people-1-1-4"]},{"id":"rs-2","title":"匹配知识点","content":"信息发送不等于被正确理解，应检查反馈闭环。","relatedKeywords":["沟通","理解"],"relatedKnowledgePoints":["kp-pmp-people-1-1-4"]},{"id":"rs-3","title":"比较选项","content":"B 直接体现有效沟通的接收与理解确认。","relatedKeywords":["有效沟通"],"relatedKnowledgePoints":["kp-pmp-people-1-1-4"]}],"keyPath":{"label":"沟通有效性 → 反馈确认 → B","clueIds":["kw-002","kw-003"],"conceptIds":["kp-pmp-people-1-1-4"],"primaryConceptId":"kp-pmp-people-1-1-4","ruleConceptId":"kp-pmp-people-1-1-4","answerId":"B","ruleText":"有效沟通不以发送为完成标准，应确认接收、理解和行动。"},"metadata":{"subjectId":"subject-pmp","translationStatus":"bilingual","knowledge":{"primaryNodeId":"kp-pmp-people-1-1-4","relatedNodeIds":[],"mappingStatus":"confirmed","mappingSource":"prep-studio","pathSnapshot":["PMP","人","利益相关方与沟通管理","项目沟通管理的概念"]},"principleIds":["principle-effective-communication","principle-no-premature-escalation","principle-role-accountability"],"optionPrincipleMap":{"A":["principle-effective-communication"],"B":["principle-effective-communication"],"C":["principle-no-premature-escalation"],"D":["principle-role-accountability"]},"tagPaths":[{"groupId":"usage","group":"用途标签","categoryId":"stage","category":"训练阶段","label":"基础练习"},{"groupId":"quality","group":"质量标签","categoryId":"feature","category":"题目特征","label":"核心题"},{"groupId":"source","group":"来源标签","categoryId":"origin","category":"来源类型","label":"自编题"},{"groupId":"source","group":"来源标签","categoryId":"scope","category":"使用范围","label":"内部使用"}],"keywordSystemV2":{"schemaVersion":2,"name":"Question Keyword System v2","keywords":[{"clueId":"kw-001","text":"项目经理","textEn":"project manager","keywordLevel":"normal","isCore":false,"solutionRole":"context","coreReason":"","recallNodeId":"recall-tax-kp-pmp-people-2-2-1-k01","recallEntryLabel":"项目经理"},{"clueId":"kw-002","text":"首先","textEn":"first","keywordLevel":"core","isCore":true,"solutionRole":"decision-cue","coreReason":"题目要求识别优先判断，而不是最终处置。","recallNodeId":"recall-keyword-pmp-action-order","recallEntryLabel":"PMP 情景题动作顺序"},{"clueId":"kw-003","text":"有效沟通","textEn":"effective communication","keywordLevel":"core","isCore":true,"solutionRole":"answer-anchor","coreReason":"该词直接区分“发送信息”与“真正完成沟通”。","recallNodeId":"recall-tax-kp-pmp-people-1-1-4","recallEntryLabel":"项目沟通管理的概念"}]},"englishOptionFeedback":{"A":"Incorrect: sending alone does not prove communication effectiveness.","B":"Correct: effective communication requires receipt and understanding.","C":"Incorrect: this is premature escalation.","D":"Incorrect: this shifts communication responsibility to the wrong role."},"contentPreparation":{"source":"external-ai-or-manual","reviewStatus":"ready-for-human-check","prepStudioTargetVersion":"0.4.0"}},"status":{"contentReady":true,"keywordsReady":true,"knowledgeReady":true,"reasoningReady":true,"published":false},"lifecycle":{"status":"active","deletedAt":""},"teacherNumber":"","explanation":"沟通的效果不以“已经发送”为终点，而以信息是否被正确接收、理解并产生预期行动来判断。项目经理应建立反馈或确认机制，而不是把发送动作等同于沟通完成。"}]},"principles":{"schemaVersion":1,"items":[{"id":"principle-effective-communication","name":"确认沟通是否真正有效","status":"active","confusablePrincipleIds":[]},{"id":"principle-no-premature-escalation","name":"先分析并处理，再考虑升级","status":"active","confusablePrincipleIds":[]},{"id":"principle-role-accountability","name":"按正确角色承担沟通责任","status":"active","confusablePrincipleIds":[]}]},"synthesisPresets":{"schemaVersion":1,"items":[{"id":"preset-effective-communication","principleId":"principle-effective-communication","title":"原则：有效沟通需要反馈闭环","content":"信息已经发送，不代表沟通完成。应确认接收方收到、理解并能够据此行动。","status":"active","version":1},{"id":"preset-no-premature-escalation","principleId":"principle-no-premature-escalation","title":"原则：避免过早升级","content":"遇到沟通偏差时先澄清、确认和解决根因；除非情境要求，否则不要直接处罚或升级。","status":"active","version":1},{"id":"preset-role-accountability","principleId":"principle-role-accountability","title":"原则：角色责任不应被错误转移","content":"项目经理应根据沟通管理计划和角色职责管理沟通，而不是把所有信息传递责任转移给发起人。","status":"active","version":1}]},"tagConfig":{"names":{},"groupNames":{},"categoryNames":{},"aliases":{}}};
const COMPLETE_AI_PROMPT=`你是一名 PMP 内容生产与结构化校核助手。请根据我提供的 Word/文本基础题目，输出 PMP Content Prep Studio v0.3.5 的“完整内容准备包 JSON”。

目标：尽量在外部 AI 阶段完成题干、选项、答案、解析、双语、知识点、普通/核心关键词、推理步骤、标签、原则、归纳卡和选项→原则映射，使进入 Prep Studio 后主要进行人工校核。

规则：
1. 顶层 prepContentBundleVersion=1，包含 questionBank、principles、synthesisPresets、tagConfig。
2. 来源已明确的题干/选项/答案/解析必须忠实保留，不得静默改题。
3. 知识点只能使用我提供知识树中真实存在的稳定 node ID；无法确定时留空。
4. 联想词只能使用我提供联想库中真实存在且唯一匹配的 recallNodeId；无法确定时留空。
5. 关键词必须是词/稳定专业术语，不能是半句话。
6. 普通关键词 keywordLevel=normal；核心关键词 keywordLevel=core，并填写 solutionRole 和 coreReason；每题建议 2～5 个。
7. 标签优先使用主程序预设标签。
8. metadata.stemPrincipleIds 保存题干 / 通用原则；metadata.optionPrincipleMap 保存 A/B/C/D 对应原则；metadata.principleIds 由两者自动汇总。
9. 每道题正确选项必须且只能绑定一条原则；principles 与 synthesisPresets 必须一对一，归纳卡标题固定为“原则：{原则名称}”。
10. 不写死 taxonomyId/taxonomyVersion。
11. 不要生成题目 id、questionId、contentHash、metadata.origin、creatorId、deviceId 或 batchId；这些全部由 Prep Studio 生成。
12. 输出纯 JSON，不要 Markdown 代码围栏，不要额外解释。

完整模板：${JSON.stringify(COMPLETE_CONTENT_BUNDLE_TEMPLATE,null,2)}`;


const QUESTION_TEMPLATE={
  name:"PMP 基础题库模板",
  subject:"PMP",
  description:"外部 AI 只负责内容；题库 ID、题目全局 ID、制作人/设备/批次信息和 Content Hash 由 Prep Studio 自动生成。",
  version:"1.0",
  visibility:"private",
  questions:[{
    title:"示例题目",
    difficulty:"中等",
    domain:"",
    topic:"",
    tags:[],
    stage:"",
    stemParts:[{text:"项目经理……应该首先做什么？"}],
    options:[
      {id:"A",text:"选项 A",correct:false},
      {id:"B",text:"选项 B",correct:true},
      {id:"C",text:"选项 C",correct:false},
      {id:"D",text:"选项 D",correct:false}
    ],
    correctAnswer:"B",
    analysis:"中文解析。",
    translations:{en:{title:"",stemParts:[{text:""}],options:[{id:"A",text:""},{id:"B",text:""},{id:"C",text:""},{id:"D",text:""}],analysis:""}},
    clues:[],
    reasoningSteps:[],
    metadata:{knowledge:{primaryNodeId:"",relatedNodeIds:[],mappingStatus:"unmapped",pathSnapshot:[]}},
    lifecycle:{status:"active",deletedAt:""}
  }]
};
const WORD_TO_JSON_AI_PROMPT=`你是一名 PMP 题库结构化编辑助手。
请把我提供的 Word/文本题目转换成“PMP Content Prep Studio”可导入的 Question Bank JSON。

硬性要求：
1. 顶层必须是一个对象，包含 name、subject、questions；不要生成题库 id 或题目 id。
2. 每道题保留原始题干、A/B/C/D、正确答案、解析；不得擅自补写原资料没有的事实。
3. correctAnswer 使用 A/B/C/D。
4. 中文题干放 stemParts:[{text:"..."}]。
5. 中文解析同时放 analysis。
6. 如果原资料没有英文，不要编造英文；translations.en 对应字段可留空。
7. 如果原资料没有知识点，不要猜；metadata.knowledge.primaryNodeId 留空。
8. 如果原资料没有关键词，不要猜；clues 留空，后续在 Prep Studio 人工标记。
9. 不写死 taxonomyId / taxonomyVersion。
10. 不要生成题目 id、questionId、contentHash、creatorId、deviceId、batchId 或 metadata.origin；这些由 Prep Studio 自动生成。
11. 输出纯 JSON，不要 Markdown 代码围栏，不要解释。

参考模板：
${JSON.stringify(QUESTION_TEMPLATE,null,2)}
`;

/* P4.5.29 差异 18：题目家族 JSON 模板与外部 AI 生成提示词 */
function familyTemplateQuestion({title,role,relationToRoot='standalone',variantType='none',equivalenceGrade='',diagnosticTarget='general',difficultyLevel=2,purposes=['practice'],difficulty='中等',stem='请填写题干',answer='B'}){
  return {title,difficulty,domain:'',topic:'',tags:[],stage:'',stemParts:[{text:stem}],options:[{id:'A',text:'选项 A',correct:answer==='A'},{id:'B',text:'选项 B',correct:answer==='B'},{id:'C',text:'选项 C',correct:answer==='C'},{id:'D',text:'选项 D',correct:answer==='D'}],correctAnswer:answer,analysis:'请填写解析。',translations:{en:{title:'',stemParts:[{text:''}],options:[{id:'A',text:''},{id:'B',text:''},{id:'C',text:''},{id:'D',text:''}],analysis:''}},clues:[],reasoningSteps:[],metadata:{knowledge:{primaryNodeId:'',relatedNodeIds:[],mappingStatus:'unmapped',pathSnapshot:[]},subjectFacets:[],tagPaths:[],questionFamily:{schemaVersion:1,familyKey:'FAMILY-001',role,relationToRoot:role==='root'?'root':relationToRoot,variantType:role==='root'?'none':variantType,equivalenceGrade:role==='member'?equivalenceGrade:'',diagnosticTarget,difficultyLevel,purposes,qualityConfirmed:false,notes:''}},lifecycle:{status:'active',deletedAt:''}};
}
const QUESTION_FAMILY_TEMPLATE={name:'PMP 题目家族最低配置模板',subject:'PMP',description:'Question Family v1。外部文件不填写 Question ID / Family ID / rootQuestionId；导入后由 Prep Studio 生成并按 familyKey 绑定。qualityConfirmed 必须由教师人工确认。',version:'1.0',visibility:'private',questions:[
  familyTemplateQuestion({title:'母题',role:'root',diagnosticTarget:'application',difficultyLevel:2,purposes:['practice'],stem:'母题题干……'}),
  familyTemplateQuestion({title:'强等价变体 1',role:'member',relationToRoot:'equivalent',variantType:'stem',equivalenceGrade:'A',diagnosticTarget:'application',difficultyLevel:2,purposes:['practice','error-confirmation'],stem:'更换表述但保持同知识目标、同能力层级和核心推理链……'}),
  familyTemplateQuestion({title:'强等价变体 2',role:'member',relationToRoot:'equivalent',variantType:'scenario',equivalenceGrade:'A',diagnosticTarget:'application',difficultyLevel:2,purposes:['post-remediation-verification','delayed-verification'],stem:'更换情境但保持同知识目标、同能力层级和核心推理链……'}),
  familyTemplateQuestion({title:'概念诊断',role:'member',relationToRoot:'decomposed',variantType:'decomposed',equivalenceGrade:'C',diagnosticTarget:'concept',difficultyLevel:1,purposes:['diagnosis'],difficulty:'简单',stem:'检测最基础概念是否建立……'}),
  familyTemplateQuestion({title:'理解诊断',role:'member',relationToRoot:'decomposed',variantType:'decomposed',equivalenceGrade:'C',diagnosticTarget:'understanding',difficultyLevel:2,purposes:['diagnosis'],stem:'检测概念边界、含义或相近概念辨析……'}),
  familyTemplateQuestion({title:'高阶验证',role:'member',relationToRoot:'equivalent',variantType:'advanced',equivalenceGrade:'A',diagnosticTarget:'analysis',difficultyLevel:4,purposes:['post-remediation-verification','mastery-check'],difficulty:'困难',stem:'新的复杂情境 / 案例，用于证明能够迁移并回到母题能力层级……'})
]};
const QUESTION_FAMILY_AI_PROMPT=`你是一名题目家族设计助手。请围绕我提供的一道母题，生成符合 External AI Question Authoring Contract v1、可导入 PMP Content Prep Studio 的 Question Bank JSON。\n\n目标：建立一个可用于高可信学习诊断的题目家族，而不是简单换皮。\n最低覆盖：A 级强等价变体至少 2 道、concept 概念诊断至少 1 道、understanding 理解诊断至少 1 道、高阶验证至少 1 道。教师可以后续继续增加。\n\n关键边界：\n0. 普通题目 difficulty 使用三档“简单 / 中等 / 困难”；metadata.questionFamily.difficultyLevel 使用 L1–L4 诊断层级。L4 不代表主程序存在第四档题目难度。\n1. “与母题的关系”与“学习用途”分开。一道题可同时是情境变体 + 应用检测 + 补救后验证。\n2. A 级强等价必须保持：主知识目标相同、核心能力层级相同或相近、核心推理链相同、难度相近；同时改变足够的表面情境/题干/选项，使学员不能靠记忆母题答案通过。\n3. 能力拆解题用于定位概念/理解等问题，不能单独证明原母题能力已掌握。\n4. 高阶验证必须回到与母题相同或更高的应用/分析/案例迁移层级，并使用学员未见过的新情境。\n5. qualityConfirmed 一律输出 false；只有教师人工审核后才能在 Prep Studio 勾选确认。\n6. 同一题目家族所有题使用同一个 metadata.questionFamily.familyKey（例如 FAMILY-001），且只能有 1 道 role=root。\n7. 不要生成 question id、familyId、rootQuestionId、contentHash、creatorId、deviceId、batchId 或 metadata.origin；全部由 Prep Studio 生成。\n8. 输出纯 JSON，不要 Markdown 围栏。\n\n字段参考：metadata.questionFamily = {familyKey, role, relationToRoot, variantType, equivalenceGrade, diagnosticTarget, difficultyLevel, purposes, qualityConfirmed:false, notes}。\n\n模板：\n${JSON.stringify(QUESTION_FAMILY_TEMPLATE,null,2)}`;
