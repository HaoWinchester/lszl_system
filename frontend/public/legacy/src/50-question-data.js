'use strict';

/*
 * 本文件由原单文件 HTML 自动拆分而来。
 * 维护建议：继续把本文件中的强耦合函数逐步迁移为显式模块 API。
 */

/* PMP 考题破案训练核心脚本 */
let PMP_QUESTION_MVP={
  id:'pmp-agile-change-001',
  title:'敏捷迭代中期的新需求',
  stemParts:[
    {text:'一个 '},{text:'敏捷团队',clue:'agile-team'},
    {text:' 正在进行 '},{text:'为期两周的迭代',clue:'two-week-iteration'},
    {text:'。'},{text:'迭代进行到一半',clue:'mid-iteration'},
    {text:' 时，'},{text:'客户提出一个新的高价值功能',clue:'new-high-value-feature'},
    {text:'，并要求团队 '},{text:'立即加入当前迭代',clue:'add-now'},
    {text:'。团队成员表示，如果加入该功能，'},{text:'当前迭代承诺的工作可能无法完成',clue:'commitment-risk'},
    {text:'。项目经理应该怎么做？'}
  ],
  options:[
    {id:'A',text:'要求团队加班完成新功能和原计划工作。',trap:'命令控制 / 加班解决'},
    {id:'B',text:'拒绝客户请求，因为迭代开始后不能接受任何变更。',trap:'绝对化表达 / 误解敏捷欢迎变化'},
    {id:'C',text:'与产品负责人讨论该功能的价值和优先级，并考虑将其加入产品待办列表。',correct:true},
    {id:'D',text:'立即提交变更请求，并召开变更控制委员会会议审批。',trap:'预测型 CCB 流程误用'}
  ],
  clues:[
    {id:'agile-team',text:'敏捷团队',type:'method',clueRole:'true',conceptIds:['agile-change'],explain:'题目处于敏捷环境，不能直接套用预测型变更控制流程。'},
    {id:'two-week-iteration',text:'为期两周的迭代',type:'time',clueRole:'true',conceptIds:['iteration-goal'],explain:'说明当前工作以短周期迭代为单位进行。'},
    {id:'mid-iteration',text:'迭代进行到一半',type:'time',clueRole:'true',conceptIds:['iteration-goal'],explain:'关键时间线索：迭代已经开始，当前目标和承诺需要被保护。'},
    {id:'new-high-value-feature',text:'新的高价值功能',type:'change',clueRole:'true',conceptIds:['product-backlog','product-owner'],explain:'新需求需要评估价值与优先级，通常进入产品待办列表。'},
    {id:'add-now',text:'立即加入当前迭代',type:'action',clueRole:'decoy',conceptIds:['iteration-goal','product-owner'],explain:'这是诱导性动作，不应未经评估就打断当前迭代。'},
    {id:'commitment-risk',text:'当前迭代承诺的工作可能无法完成',type:'constraint',clueRole:'true',conceptIds:['iteration-goal'],explain:'说明强行加入新功能会冲击迭代目标和团队承诺。'}
  ],
  concepts:[
    {id:'agile-change',title:'敏捷变更管理',color:'#16a34a',category:'敏捷',level:'重点',keywords:'敏捷,变化,价值,反馈',summary:'敏捷欢迎变化，但变化需要通过产品待办列表、价值排序和团队协作来管理。',notes:'看到敏捷环境，不要第一反应套用 CCB。',rule:'敏捷欢迎变化，但不能机械套用预测型 CCB；应通过待办列表、价值排序和团队协作管理变化。'},
    {id:'product-backlog',title:'产品待办列表',color:'#f59e0b',category:'敏捷',level:'重点',keywords:'Backlog,优先级,需求排序',summary:'产品待办列表承载需求和优先级，新功能通常进入待办列表，由产品负责人排序。',notes:'题目出现新需求、高价值功能、优先级，常关联产品待办列表。',rule:'新功能应进入产品待办列表进行价值和优先级管理，而不是直接插入当前迭代。'},
    {id:'product-owner',title:'产品负责人',color:'#7c3aed',category:'敏捷角色',level:'重点',keywords:'PO,价值,优先级',summary:'产品负责人负责价值判断和待办列表优先级排序。',notes:'客户提出新需求时，应与产品负责人评估价值与优先级。',rule:'产品待办列表由产品负责人管理；涉及高价值新功能和优先级判断时，应找产品负责人一起评估。'},
    {id:'iteration-goal',title:'迭代目标 / 当前承诺',color:'#ef4444',category:'敏捷',level:'重点',keywords:'迭代目标,Sprint Goal,承诺',summary:'迭代开始后，团队应保护当前迭代目标，避免随意插入新工作导致承诺无法完成。',notes:'题干出现“迭代中期”“当前承诺无法完成”是强线索。',rule:'当前迭代承诺需要被保护，不能未经评估就把新工作强行塞进当前迭代。'}
  ],
  correctAnswer:'C',
  keyPath:{
    label:'高价值功能 → 产品待办列表 → 产品负责人 → 答案 C',
    clueIds:['new-high-value-feature'],
    conceptIds:['product-backlog','product-owner'],
    primaryConceptId:'product-backlog',
    ruleConceptId:'product-owner',
    answerId:'C',
    ruleText:'看到“高价值功能”，先想到产品待办列表；产品待办列表由产品负责人管理，所以下一步应找产品负责人评估价值与优先级。'
  }
};
let qMvpState={found:new Set(),selected:null,submitted:false,graph:false,reasoning:{recallDone:{},ruleDone:{},trapDone:{},answerUnlocked:false,lockedAnswer:''}};
