'use strict';

/* 深度知识回忆示例知识网：以题目关键词为入口，逐步引导学员主动回忆。 */
window.KNOWLEDGE_RECALL_MAP={
  roots:{
    'agile-team':{title:'敏捷团队',nodeId:'agile-team',matchTexts:['敏捷团队','团队成员','团队']},
    'two-week-iteration':{title:'为期两周的迭代',nodeId:'timebox-iteration',matchTexts:['为期两周的迭代','两周的迭代','迭代']},
    'mid-iteration':{title:'迭代进行到一半',nodeId:'mid-iteration',matchTexts:['迭代进行到一半','迭代中期']},
    'new-high-value-feature':{title:'新的高价值功能',nodeId:'high-value-feature',matchTexts:['新的高价值功能','高价值功能','新功能']},
    'add-now':{title:'立即加入当前迭代',nodeId:'add-to-current-iteration',matchTexts:['立即加入当前迭代','立即加入','加入当前迭代']},
    'commitment-risk':{title:'当前迭代承诺的工作可能无法完成',nodeId:'commitment-risk',matchTexts:['当前迭代承诺的工作可能无法完成','承诺的工作可能无法完成','无法完成']},
    'product-owner':{title:'产品负责人',nodeId:'product-owner',matchTexts:['产品负责人']},
    'product-backlog':{title:'产品待办列表',nodeId:'product-backlog',matchTexts:['产品待办列表','待办列表']},
    'change-request':{title:'变更请求',nodeId:'change-request',matchTexts:['变更请求','变更控制委员会','委员会']},
    'overtime':{title:'加班完成',nodeId:'overtime-trap',matchTexts:['加班完成','加班']},
    'reject-change':{title:'拒绝客户请求',nodeId:'reject-change-trap',matchTexts:['拒绝客户请求','不能接受任何变更','拒绝']}
  },
  nodes:{
    'agile-team':{title:'敏捷团队',prompt:'看到“敏捷团队”，你能先从哪个方向开始回忆？',hint:'先想团队本身，再想角色、协作和沟通。',choices:[
      {text:'团队职责',next:'team-responsibility'},{text:'团队组成',next:'team-composition'},{text:'团队协作方式',next:'team-collaboration'},{text:'团队沟通环境',next:'team-communication'}]},
    'team-responsibility':{title:'团队职责',prompt:'敏捷团队承担工作时，最核心的职责特征是什么？',choices:[
      {text:'自组织团队',next:'self-organizing-team'},{text:'任务自行认领',next:'task-pull'},{text:'共同承担结果',next:'shared-ownership'},{text:'自行决定如何完成工作',next:'decide-how-to-work'}]},
    'self-organizing-team':{title:'自组织团队',prompt:'自组织团队继续往下想，通常会带出哪些考点？',choices:[
      {text:'团队自行决定工作方法',next:'decide-how-to-work'},{text:'Scrum Master 移除障碍',next:'scrum-master-impediment'},{text:'项目经理避免命令控制',next:'avoid-command-control'},{text:'团队共同承诺目标',next:'team-commitment'}]},
    'task-pull':{title:'任务自行认领',prompt:'“任务自行认领”背后的敏捷思想是什么？',choices:[
      {text:'团队拥有计划和执行自主权',next:'team-autonomy'},{text:'看板拉动式工作',next:'pull-system'},{text:'避免强行分派任务',next:'avoid-assignment'},{text:'每日站会暴露阻碍',next:'daily-standup'}]},
    'shared-ownership':{title:'共同承担结果',prompt:'共同承担结果会影响题目里的哪个判断？',choices:[
      {text:'保护当前迭代目标',next:'protect-sprint-goal'},{text:'透明沟通风险',next:'transparent-risk'},{text:'不把压力简单转成加班',next:'avoid-overtime-rule'}]},
    'decide-how-to-work':{title:'自行决定如何完成工作',prompt:'团队自行决定“如何做”，那么谁更适合决定“做什么、先做什么”？',choices:[
      {text:'产品负责人管理价值与排序',next:'product-owner'},{text:'团队估算容量',next:'team-capacity'},{text:'干系人提供反馈',next:'stakeholder-feedback'}]},
    'team-composition':{title:'团队组成',prompt:'敏捷团队组成可以继续回忆哪些角色或能力？',choices:[
      {text:'产品负责人',next:'product-owner'},{text:'Scrum Master',next:'scrum-master'},{text:'开发团队',next:'development-team'},{text:'跨职能团队',next:'cross-functional-team'}]},
    'product-owner':{title:'产品负责人',prompt:'产品负责人最容易和哪些职责一起考？',choices:[
      {text:'管理产品待办列表',next:'product-backlog'},{text:'价值最大化',next:'value-maximization'},{text:'排序优先级',next:'prioritization'},{text:'澄清需求和验收标准',next:'acceptance-criteria'}]},
    'scrum-master':{title:'Scrum Master',prompt:'Scrum Master 看到团队被打断时，更像做什么？',choices:[
      {text:'移除障碍',next:'scrum-master-impediment'},{text:'辅导团队和组织',next:'coach-team'},{text:'保护敏捷规则',next:'protect-agile-process'}]},
    'development-team':{title:'开发团队',prompt:'开发团队在迭代中最需要守住什么？',choices:[
      {text:'可交付增量',next:'potentially-shippable-increment'},{text:'迭代目标',next:'sprint-goal'},{text:'团队容量',next:'team-capacity'}]},
    'cross-functional-team':{title:'跨职能团队',prompt:'跨职能团队继续往下可以想到什么？',choices:[
      {text:'都是主题专家',next:'subject-matter-experts'},{text:'交叉培训',next:'cross-training'},{text:'知识分享',next:'knowledge-sharing'}]},
    'team-collaboration':{title:'团队协作方式',prompt:'敏捷团队协作常见考点有哪些？',choices:[
      {text:'全职专注',next:'full-time-focus'},{text:'集中办公',next:'co-location'},{text:'知识分享',next:'knowledge-sharing'},{text:'持续改进',next:'continuous-improvement'}]},
    'team-communication':{title:'团队沟通环境',prompt:'敏捷团队沟通方式可以回忆到哪些关键词？',choices:[
      {text:'渗透式沟通',next:'osmotic-communication'},{text:'信息发射源',next:'information-radiator'},{text:'每日站会',next:'daily-standup'},{text:'优先集中办公',next:'co-location'}]},
    'osmotic-communication':{title:'渗透式沟通',prompt:'渗透式沟通为什么适合敏捷团队？',choices:[
      {text:'快速同步信息',next:'fast-feedback'},{text:'减少正式文档依赖',next:'lightweight-communication'},{text:'促进共同理解',next:'shared-understanding'}]},
    'information-radiator':{title:'信息发射源',prompt:'信息发射源通常帮助团队获得什么？',choices:[
      {text:'透明化工作状态',next:'transparency'},{text:'暴露风险和阻碍',next:'transparent-risk'},{text:'支持干系人反馈',next:'stakeholder-feedback'}]},
    'co-location':{title:'优先集中办公',prompt:'集中办公的价值可以继续想到什么？',choices:[
      {text:'渗透式沟通',next:'osmotic-communication'},{text:'高带宽沟通',next:'high-bandwidth-communication'},{text:'快速反馈',next:'fast-feedback'}]},
    'full-time-focus':{title:'全职专注',prompt:'全职专注常用来避免什么问题？',choices:[
      {text:'多任务切换损耗',next:'context-switching'},{text:'团队容量被低估',next:'team-capacity'},{text:'承诺无法兑现',next:'commitment-risk'}]},

    'timebox-iteration':{title:'时间盒迭代',prompt:'看到“为期两周的迭代”，你能想到哪个原则？',choices:[
      {text:'时间盒',next:'timebox'},{text:'短周期反馈',next:'short-feedback-loop'},{text:'迭代计划',next:'iteration-planning'},{text:'可交付增量',next:'potentially-shippable-increment'}]},
    'mid-iteration':{title:'迭代中期',prompt:'“迭代进行到一半”最容易触发哪个判断？',choices:[
      {text:'保护当前迭代目标',next:'protect-sprint-goal'},{text:'新需求先不直接插入',next:'avoid-direct-insertion'},{text:'需要重新评估容量',next:'team-capacity'},{text:'透明沟通影响',next:'transparent-risk'}]},
    'protect-sprint-goal':{title:'保护迭代目标',prompt:'保护迭代目标并不等于拒绝变化。下一步应该想到什么？',choices:[
      {text:'把新需求放入待办列表排序',next:'product-backlog'},{text:'与产品负责人讨论价值',next:'product-owner'},{text:'评估对当前承诺的影响',next:'commitment-risk'}]},
    'avoid-direct-insertion':{title:'避免直接插入',prompt:'不直接插入当前迭代，是为了避免什么？',choices:[
      {text:'破坏团队承诺',next:'team-commitment'},{text:'绕过优先级排序',next:'prioritization'},{text:'造成范围蔓延',next:'scope-creep'}]},
    'commitment-risk':{title:'承诺风险',prompt:'题目说承诺工作可能无法完成，应该继续回忆什么？',choices:[
      {text:'团队容量有限',next:'team-capacity'},{text:'保护迭代目标',next:'protect-sprint-goal'},{text:'透明沟通影响',next:'transparent-risk'},{text:'不要用加班掩盖冲突',next:'avoid-overtime-rule'}]},

    'high-value-feature':{title:'高价值功能',prompt:'看到“高价值功能”，最短破题路径应该先回忆什么？',choices:[
      {text:'产品待办列表',next:'product-backlog'},{text:'价值最大化',next:'value-maximization'},{text:'优先级排序',next:'prioritization'},{text:'干系人反馈',next:'stakeholder-feedback'}]},
    'product-backlog':{title:'产品待办列表',prompt:'产品待办列表继续往下想，谁负责管理和排序？',choices:[
      {text:'产品负责人',next:'product-owner'},{text:'待办项按价值排序',next:'prioritization'},{text:'持续细化待办项',next:'backlog-refinement'},{text:'新需求进入待办列表',next:'new-request-to-backlog'}]},
    'value-maximization':{title:'价值最大化',prompt:'价值最大化在 Scrum 中通常是谁的职责？',choices:[
      {text:'产品负责人',next:'product-owner'},{text:'管理产品待办列表',next:'product-backlog'},{text:'排序优先级',next:'prioritization'}]},
    'prioritization':{title:'优先级排序',prompt:'优先级排序需要结合哪些因素？',choices:[
      {text:'商业价值',next:'business-value'},{text:'风险与依赖',next:'risk-and-dependency'},{text:'团队容量',next:'team-capacity'},{text:'干系人反馈',next:'stakeholder-feedback'}]},
    'new-request-to-backlog':{title:'新需求进入待办列表',prompt:'新需求进入待办列表后，下一步如何处理？',choices:[
      {text:'由产品负责人排序',next:'product-owner'},{text:'与当前迭代目标比较',next:'protect-sprint-goal'},{text:'在下次迭代规划时选择',next:'iteration-planning'}]},
    'backlog-refinement':{title:'待办列表细化',prompt:'待办列表细化通常帮助团队澄清什么？',choices:[
      {text:'验收标准',next:'acceptance-criteria'},{text:'估算和拆分',next:'estimation-and-slicing'},{text:'依赖与风险',next:'risk-and-dependency'}]},

    'add-to-current-iteration':{title:'立即加入当前迭代',prompt:'“立即加入当前迭代”为什么可疑？',choices:[
      {text:'跳过产品待办列表排序',next:'prioritization'},{text:'破坏当前迭代承诺',next:'commitment-risk'},{text:'把高价值误解成马上做',next:'value-not-equal-now'},{text:'可能导致范围蔓延',next:'scope-creep'}]},
    'value-not-equal-now':{title:'高价值不等于马上做',prompt:'高价值需求应该被认真处理，但为什么不等于立即插入？',choices:[
      {text:'还要排序和评估容量',next:'prioritization'},{text:'要保护迭代目标',next:'protect-sprint-goal'},{text:'需要产品负责人参与',next:'product-owner'}]},
    'scope-creep':{title:'范围蔓延',prompt:'范围蔓延在敏捷场景中应如何避免？',choices:[
      {text:'通过产品待办列表管理变化',next:'product-backlog'},{text:'透明沟通影响',next:'transparent-risk'},{text:'维持时间盒纪律',next:'timebox'}]},
    'overtime-trap':{title:'加班陷阱',prompt:'为什么 PMP 题目里“让团队加班”常是陷阱？',choices:[
      {text:'没有解决优先级冲突',next:'prioritization'},{text:'掩盖容量限制',next:'team-capacity'},{text:'破坏可持续节奏',next:'sustainable-pace'}]},
    'reject-change-trap':{title:'拒绝变化陷阱',prompt:'为什么“迭代开始后不能接受任何变更”太绝对？',choices:[
      {text:'敏捷欢迎变化',next:'agile-welcome-change'},{text:'变化需要被管理',next:'product-backlog'},{text:'高价值需求可进入待办列表',next:'new-request-to-backlog'}]},
    'change-request':{title:'变更请求 / CCB',prompt:'在敏捷题中看到 CCB，要先判断什么？',choices:[
      {text:'是否误用了预测型流程',next:'predictive-trap'},{text:'题目是否强调敏捷环境',next:'agile-team'},{text:'需求是否应进入待办列表',next:'product-backlog'}]},

    'team-capacity':{title:'团队容量',prompt:'团队容量和本题哪个约束最相关？',choices:[
      {text:'承诺工作可能无法完成',next:'commitment-risk'},{text:'迭代目标需要保护',next:'protect-sprint-goal'},{text:'不要简单加班解决',next:'avoid-overtime-rule'}]},
    'team-commitment':{title:'团队承诺',prompt:'团队承诺被冲击时，项目经理更应该做什么？',choices:[
      {text:'促进透明沟通',next:'transparent-risk'},{text:'与产品负责人协作',next:'product-owner'},{text:'重新评估优先级',next:'prioritization'}]},
    'transparent-risk':{title:'透明沟通影响',prompt:'透明沟通后，需要把影响带给谁一起决策？',choices:[
      {text:'产品负责人',next:'product-owner'},{text:'客户 / 干系人',next:'stakeholder-feedback'},{text:'团队共同评估',next:'team-capacity'}]},
    'avoid-overtime-rule':{title:'不要用加班掩盖冲突',prompt:'不直接要求加班，真正要处理的是什么？',choices:[
      {text:'优先级冲突',next:'prioritization'},{text:'容量限制',next:'team-capacity'},{text:'迭代目标保护',next:'protect-sprint-goal'}]},
    'agile-welcome-change':{title:'敏捷欢迎变化',prompt:'敏捷欢迎变化的同时，变化应该通过什么机制进入工作？',choices:[
      {text:'产品待办列表',next:'product-backlog'},{text:'价值排序',next:'prioritization'},{text:'干系人反馈',next:'stakeholder-feedback'}]},
    'predictive-trap':{title:'预测型流程误用',prompt:'敏捷题中直接走 CCB 为什么常常不优先？',choices:[
      {text:'题目环境是敏捷',next:'agile-team'},{text:'新需求应先进入待办列表',next:'product-backlog'},{text:'产品负责人管理优先级',next:'product-owner'}]},

    'acceptance-criteria':{title:'验收标准',prompt:'验收标准还能联想到什么？',choices:[{text:'用户故事',next:'user-story'},{text:'产品负责人澄清需求',next:'product-owner'}]},
    'business-value':{title:'商业价值',prompt:'商业价值通常服务于哪个排序动作？',choices:[{text:'优先级排序',next:'prioritization'},{text:'价值最大化',next:'value-maximization'}]},
    'risk-and-dependency':{title:'风险与依赖',prompt:'风险与依赖会影响什么？',choices:[{text:'优先级排序',next:'prioritization'},{text:'团队容量评估',next:'team-capacity'}]},
    'stakeholder-feedback':{title:'干系人反馈',prompt:'干系人反馈进入敏捷流程后，通常沉淀在哪里？',choices:[{text:'产品待办列表',next:'product-backlog'},{text:'产品负责人判断价值',next:'product-owner'}]},
    'iteration-planning':{title:'迭代规划',prompt:'迭代规划时，团队通常从哪里选择工作？',choices:[{text:'高优先级产品待办项',next:'product-backlog'},{text:'团队容量',next:'team-capacity'},{text:'迭代目标',next:'sprint-goal'}]},
    'sprint-goal':{title:'迭代目标',prompt:'迭代目标和本题的核心冲突是什么？',choices:[{text:'新增需求冲击承诺',next:'commitment-risk'},{text:'保护当前迭代目标',next:'protect-sprint-goal'}]},
    'timebox':{title:'时间盒',prompt:'时间盒带来的管理约束是什么？',choices:[{text:'固定周期内控制范围',next:'protect-sprint-goal'},{text:'短周期反馈',next:'short-feedback-loop'}]},
    'short-feedback-loop':{title:'短周期反馈',prompt:'短周期反馈收到新需求后，下一步如何管理？',choices:[{text:'放入产品待办列表',next:'product-backlog'},{text:'由产品负责人排序',next:'product-owner'}]},
    'potentially-shippable-increment':{title:'可交付增量',prompt:'可交付增量要求团队保护什么？',choices:[{text:'迭代目标',next:'sprint-goal'},{text:'团队承诺',next:'team-commitment'}]},
    'sustainable-pace':{title:'可持续节奏',prompt:'可持续节奏为什么反对直接加班？',choices:[{text:'加班不能解决优先级冲突',next:'prioritization'},{text:'会损害团队长期绩效',next:'team-collaboration'}]},
    'scrum-master-impediment':{title:'移除障碍',prompt:'移除障碍时要避免什么领导方式？',choices:[{text:'命令控制',next:'avoid-command-control'},{text:'替团队做所有决定',next:'avoid-assignment'}]},
    'avoid-command-control':{title:'避免命令控制',prompt:'项目经理避免命令控制后，更应该促成什么？',choices:[{text:'团队自组织',next:'self-organizing-team'},{text:'产品负责人排序',next:'product-owner'}]},
    'coach-team':{title:'辅导团队',prompt:'辅导团队常见目标是什么？',choices:[{text:'提升自组织能力',next:'self-organizing-team'},{text:'理解敏捷规则',next:'protect-agile-process'}]},
    'protect-agile-process':{title:'保护敏捷规则',prompt:'保护敏捷规则在本题中体现为什么？',choices:[{text:'新需求先进入待办列表',next:'product-backlog'},{text:'保护迭代目标',next:'protect-sprint-goal'}]},
    'subject-matter-experts':{title:'主题专家',prompt:'主题专家继续联想到什么团队特征？',choices:[{text:'跨职能团队',next:'cross-functional-team'},{text:'知识分享',next:'knowledge-sharing'}]},
    'cross-training':{title:'交叉培训',prompt:'交叉培训帮助团队获得什么？',choices:[{text:'减少单点依赖',next:'knowledge-sharing'},{text:'提升跨职能能力',next:'cross-functional-team'}]},
    'knowledge-sharing':{title:'知识分享',prompt:'知识分享适合连接到哪个沟通考点？',choices:[{text:'渗透式沟通',next:'osmotic-communication'},{text:'信息发射源',next:'information-radiator'}]},
    'daily-standup':{title:'每日站会',prompt:'每日站会主要帮助团队做什么？',choices:[{text:'同步进展与阻碍',next:'transparent-risk'},{text:'促进团队自组织',next:'self-organizing-team'}]},
    'pull-system':{title:'拉动式工作',prompt:'拉动式工作强调什么？',choices:[{text:'任务自行认领',next:'task-pull'},{text:'限制在制品',next:'work-in-progress-limit'}]},
    'work-in-progress-limit':{title:'限制在制品',prompt:'限制在制品通常为了什么？',choices:[{text:'保持流动效率',next:'fast-feedback'},{text:'避免多任务切换',next:'context-switching'}]},
    'team-autonomy':{title:'团队自主权',prompt:'团队自主权和产品负责人职责如何区分？',choices:[{text:'团队决定如何做',next:'decide-how-to-work'},{text:'产品负责人决定优先级',next:'product-owner'}]},
    'avoid-assignment':{title:'避免强行分派',prompt:'避免强行分派对应什么敏捷团队特征？',choices:[{text:'自组织团队',next:'self-organizing-team'},{text:'任务自行认领',next:'task-pull'}]},
    'continuous-improvement':{title:'持续改进',prompt:'持续改进常通过哪个活动实现？',choices:[{text:'回顾会',next:'retrospective'},{text:'实验和反馈',next:'fast-feedback'}]},
    'retrospective':{title:'回顾会',prompt:'回顾会的核心不是追责，而是什么？',choices:[{text:'改进流程与协作',next:'continuous-improvement'},{text:'团队共同学习',next:'knowledge-sharing'}]},
    'fast-feedback':{title:'快速反馈',prompt:'快速反馈如何进入需求管理？',choices:[{text:'更新产品待办列表',next:'product-backlog'},{text:'产品负责人排序',next:'product-owner'}]},
    'lightweight-communication':{title:'轻量沟通',prompt:'轻量沟通不等于没有记录，它强调什么？',choices:[{text:'面对面优先',next:'high-bandwidth-communication'},{text:'信息透明',next:'transparency'}]},
    'shared-understanding':{title:'共同理解',prompt:'共同理解帮助团队减少什么？',choices:[{text:'返工',next:'fast-feedback'},{text:'需求误解',next:'acceptance-criteria'}]},
    'high-bandwidth-communication':{title:'高带宽沟通',prompt:'高带宽沟通常见形式是什么？',choices:[{text:'面对面沟通',next:'osmotic-communication'},{text:'集中办公',next:'co-location'}]},
    'context-switching':{title:'多任务切换损耗',prompt:'多任务切换损耗会影响什么？',choices:[{text:'团队容量',next:'team-capacity'},{text:'可持续节奏',next:'sustainable-pace'}]},
    'transparency':{title:'透明化',prompt:'透明化可以继续联想到哪些工具？',choices:[{text:'信息发射源',next:'information-radiator'},{text:'看板',next:'kanban-board'}]},
    'kanban-board':{title:'看板',prompt:'看板常帮助团队看到什么？',choices:[{text:'工作状态',next:'transparency'},{text:'在制品限制',next:'work-in-progress-limit'}]},
    'estimation-and-slicing':{title:'估算与拆分',prompt:'估算与拆分最终服务于什么？',choices:[{text:'团队容量判断',next:'team-capacity'},{text:'迭代规划',next:'iteration-planning'}]},
    'user-story':{title:'用户故事',prompt:'用户故事通常需要搭配什么来确认完成？',choices:[{text:'验收标准',next:'acceptance-criteria'},{text:'产品负责人澄清',next:'product-owner'}]}
  }
};
