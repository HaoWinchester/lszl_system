// PMP 示例图谱数据：首次无文件时创建的初始图谱。
// 数据与 legacy/src/00-config-state.js 的 templateState('pmp') 对齐，保证首页默认体验一致。

export interface SampleNode {
  id: string
  title: string
  x: number
  y: number
  color: string
  level: string
  category: string
  keywords: string
  summary: string
  notes: string
}
export interface SampleLink {
  id: string
  from: string
  to: string
  type: string
  color: string
  lineStyle: string
}
export interface SampleGraph {
  meta: { title: string; subject: string; audience: string; description: string }
  viewport: { x: number; y: number; scale: number }
  defaults: Record<string, unknown>
  nodes: SampleNode[]
  links: SampleLink[]
}

function uid(p: string): string {
  return p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export function pmpSampleGraph(): SampleGraph {
  const n = (
    title: string, x: number, y: number, color: string, level: string,
    category: string, keywords: string, summary: string, notes: string,
  ): SampleNode => ({ id: uid('n_'), title, x, y, color, level, category, keywords, summary, notes })

  const integration = n('项目整合管理', 60, 40, '#2563eb', '重点', '整合管理', '项目章程,变更控制,整体协调,知识管理', '识别、定义、组合、统一与协调各项目管理过程组活动，确保项目目标达成。', '整合是核心枢纽，考变更必看整合；项目章程与管理计划是起点。')
  const scope = n('范围管理', 340, -90, '#7c3aed', '重点', '范围管理', 'WBS,需求收集,范围基准,范围蔓延', '确保项目做且仅做所需的全部工作，定义和控制项目范围。', 'WBS 是范围核心；需求须与相关方确认并形成基准。')
  const schedule = n('进度管理', 620, 40, '#f59e0b', '重点', '进度管理', '关键路径,浮动时间,进度基准,渐进明细', '管理项目按时完成，规划、估算、排序与控制进度。', '关键路径法是重点；总浮动与自由浮动要分清。')
  const cost = n('成本管理', 620, 300, '#16a34a', '中等', '成本管理', '预算,挣值管理EVM,成本基准,储备', '规划、估算、预算与控制成本，使项目在批准预算内完成。', '挣值管理(CV/SV/CPI/SPI)常考；应急储备应对已识别风险。')
  const quality = n('质量管理', 340, 430, '#0f766e', '中等', '质量管理', '质量计划,管理质量QA,控制质量QC,持续改进', '确保项目和产品满足需求，预防胜于检查。', '管理质量(QA)重在过程，控制质量(QC)重在结果。')
  const risk = n('风险管理', 60, 300, '#ef4444', '中等', '风险管理', '风险识别,定性定量分析,应对策略', '识别、分析并应对项目风险，提升正面影响、降低负面。', '威胁：规避/转移/减轻/接受；机会：开拓/分享/提高/接受。')
  const stakeholder = n('相关方管理', -220, 170, '#db2777', '重点', '相关方管理', '相关方识别,参与度,沟通,权力利益', '识别、分析并管理相关方的期望与参与程度。', '权力/利益方格是重点；高权力高利益相关方需重点管理。')
  const change = n('变更控制', 340, 170, '#4f46e5', '中等', '整合管理', '变更,CCB,整体变更控制,基准', '通过变更控制委员会(CCB)审批并统一管理所有变更。', '变更必走流程：提出→评估→CCB审批→实施→更新基准。')
  const wbs = n('WBS', 340, -320, '#9333ea', '重点', '范围管理', '工作分解结构,工作包,8/80规则,分解', '将项目可交付成果逐层分解为更小、可管理的工作包。', '工作包是 WBS 最低层；8/80规则指工作包耗时约8-80小时。')
  const cpm = n('关键路径法', 850, 170, '#ea580c', '重点', '进度管理', 'CPM,最长路径,零浮动,最短工期', '通过网络图找出决定项目最短工期的关键路径。', '关键路径上活动总浮动为零；关键路径可能不止一条。')
  const agile = n('敏捷价值观', 60, 560, '#0891b2', '基础', '敏捷', '敏捷宣言,四大价值观,个体互动,可工作软件', '敏捷宣言四大价值观：个体互动高于流程工具、可工作软件高于详尽文档、客户合作高于合同谈判、响应变化高于遵循计划。', '价值观是敏捷基础；右项也有价值，但左项更受重视。')

  const lk = (from: string, to: string, type: string): SampleLink => ({ id: uid('l_'), from, to, type, color: '#2563eb', lineStyle: 'solid' })

  return {
    meta: { title: 'PMP知识点关系图谱', subject: 'PMP / 项目管理｜PMP备考学员', audience: 'PMP备考学员', description: 'PMP 十大知识领域与敏捷价值观的关系图谱示例。' },
    viewport: { x: 260, y: 170, scale: 1 },
    defaults: { nodeColor: '#64748b', linkColor: '#2563eb', linkStyle: 'solid', linkPathStyle: 'curve' },
    nodes: [integration, scope, schedule, cost, quality, risk, stakeholder, change, wbs, cpm, agile],
    links: [
      lk(integration.id, scope.id, '包含'), lk(integration.id, schedule.id, '包含'), lk(integration.id, cost.id, '包含'),
      lk(integration.id, quality.id, '包含'), lk(integration.id, risk.id, '包含'), lk(integration.id, stakeholder.id, '包含'),
      lk(scope.id, wbs.id, '分解'), lk(schedule.id, cpm.id, '应用'), lk(integration.id, change.id, '关联'),
      lk(change.id, scope.id, '关联'), lk(risk.id, stakeholder.id, '关联'), lk(quality.id, schedule.id, '关联'),
    ],
  }
}
