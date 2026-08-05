'use strict';

/*
 * 本文件由原单文件 HTML 自动拆分而来。
 * 维护建议：继续把本文件中的强耦合函数逐步迁移为显式模块 API。
 */

const CARD_W=128,CARD_H=132,STORE_KEY='通用知识点关系图谱工具_多科目重点聚焦版_v2';
const DEFAULTS={nodeSize:'',nodeColor:'#64748b',linkStyle:'solid',linkPathStyle:'curve',linkColor:'#2563eb',flashSwipeSpeed:2};
const SAFE_HEX_COLOR=/^#[0-9a-f]{6}$/i,NODE_SIZES=new Set(['','small','big']),LINE_STYLES=new Set(['solid','dashed','dotted']),LINE_PATH_STYLES=new Set(['curve','straight','elbow']),LEVELS=new Set(['基础','中等','重点','难点','易错点']);
const $=id=>document.getElementById(id),stage=$('stage'),world=$('world'),cardsLayer=$('cardsLayer'),edgeGroup=$('edgeGroup'),detailPanel=$('detailPanel'),statusEl=$('status');
const isCoarse=matchMedia('(pointer: coarse)').matches;
function uid(p){const c=globalThis.crypto;return p+(c&&c.randomUUID?c.randomUUID():Math.random().toString(36).slice(2)+Date.now().toString(36))}
function baseState(){return{meta:{title:'知识点关系图谱',subject:'通用课程',audience:'学员自学 / 课堂共创',description:'用于梳理不同学科、课程或考试的知识点关系。'},viewport:{x:260,y:170,scale:1},defaults:{...DEFAULTS},focusMode:false,selectedNodeId:null,selectedLinkId:null,linkSourceId:null,nodes:[],links:[],importedFlashcards:[],flashReviews:{}}}
function makeNode(title,x,y,color,category='',level='基础',keywords='',summary='',notes='',size=''){return{id:uid('n'),title,x,y,color,category,level,keywords,summary,notes,size}}
function makeLink(from,to,type='',note='',lineStyle=DEFAULTS.linkStyle,color=DEFAULTS.linkColor,pathStyle=DEFAULTS.linkPathStyle){return{id:uid('l'),from,to,type,note,lineStyle,color,pathStyle}}
function templateState(kind='pmp'){
  const s=baseState();
  if(kind==='acp'){
    s.meta={title:'ACP敏捷知识图谱',subject:'PMI-ACP / 敏捷项目管理',audience:'敏捷学习者 / ACP备考学员',description:'用于梳理敏捷心态、领导力、产品、交付、团队协作与持续改进之间的关系。'};
    const ns=[
      makeNode('敏捷原则与心态',60,40,'#2563eb','ACP核心域','重点','敏捷宣言,原则,经验主义','理解敏捷价值观、原则和适应性思维，是所有敏捷实践的基础。','先建立心态，再学习工具技术。'),
      makeNode('仆人式领导',340,-90,'#7c3aed','领导力','重点','赋能,移除障碍,服务团队','领导者通过服务团队、清除障碍和建立信任来提升团队绩效。','不要把敏捷领导理解成命令控制。'),
      makeNode('价值驱动交付',620,40,'#16a34a','交付','重点','价值,增量,优先级','持续交付高价值增量，并根据反馈调整下一步工作。','常与产品待办列表优先级一起考。'),
      makeNode('产品待办列表',620,300,'#f59e0b','产品','重点','Backlog,排序,细化','承载需求、价值和优先级，是团队规划与交付的输入。','重点理解排序依据：价值、风险、依赖、成本。'),
      makeNode('迭代与增量',340,430,'#0891b2','交付','中等','Sprint,Increment,Timebox','通过短周期交付可检查的产品增量，获得快速反馈。','注意迭代不是为了赶工，而是为了学习和反馈。'),
      makeNode('干系人参与',60,300,'#db2777','协作','中等','反馈,协作,透明','通过持续沟通和透明化信息，让干系人参与价值判断。','与评审会、产品负责人职责相关。'),
      makeNode('团队绩效',-220,170,'#0f766e','团队','中等','自组织,协作,心理安全','敏捷团队依靠自主协作、透明沟通和持续学习提升绩效。','题目中看到团队冲突，优先考虑引导和协作。'),
      makeNode('持续改进',340,170,'#ef4444','改进','重点','Retrospective,Kaizen,实验','通过回顾、实验和反馈不断优化流程、产品和协作方式。','回顾会不是追责会，是改进会。'),
      makeNode('信息辐射器',850,170,'#4f46e5','工具','基础','看板,燃尽图,透明','用可视化方式让工作状态、风险和进度透明。','能帮助团队和干系人快速对齐。')
    ];s.nodes=ns;const m=Object.fromEntries(ns.map(n=>[n.title,n.id]));s.links=[
      makeLink(m['敏捷原则与心态'],m['仆人式领导'],'前置','敏捷领导建立在敏捷价值观之上'),
      makeLink(m['敏捷原则与心态'],m['价值驱动交付'],'指导','敏捷强调早交付、频繁交付价值'),
      makeLink(m['价值驱动交付'],m['产品待办列表'],'应用','价值判断会影响待办列表排序'),
      makeLink(m['产品待办列表'],m['迭代与增量'],'前置','迭代计划通常从高优先级待办项开始'),
      makeLink(m['干系人参与'],m['产品待办列表'],'关联','反馈会改变需求和优先级'),
      makeLink(m['团队绩效'],m['仆人式领导'],'关联','领导者通过赋能提升团队绩效'),
      makeLink(m['持续改进'],m['团队绩效'],'应用','回顾和实验促进团队成长'),
      makeLink(m['信息辐射器'],m['干系人参与'],'应用','透明信息帮助干系人参与和反馈')
    ];return s;
  }
  if(kind==='cspm'){
    s.meta={title:'CSPM项目管理能力知识图谱',subject:'CSPM / 项目管理能力评价',audience:'项目经理 / 项目管理学习者',description:'用于梳理项目管理能力、复杂项目管理、组织级项目管理和标准化实践之间的关系。'};
    const ns=[
      makeNode('项目管理能力模型',60,40,'#2563eb','总体框架','重点','能力,评价,等级','从知识、经验、绩效和组织环境等维度理解项目管理专业能力。','可作为整张图谱的主节点。'),
      makeNode('项目治理',340,-90,'#7c3aed','治理','重点','决策,授权,监督','通过治理机制明确项目决策、授权和监督方式。','复杂项目中治理比单纯执行更重要。'),
      makeNode('项目集与组合管理',620,40,'#16a34a','组织级能力','重点','项目集,项目组合,战略对齐','从单项目走向多项目协同，关注战略收益和资源配置。','适合与组织级项目管理一起理解。'),
      makeNode('标准化流程',340,210,'#f59e0b','方法体系','重点','流程,模板,基准,复盘','把优秀实践沉淀为流程、模板和组织过程资产。','注意标准化不是僵化，而是可复用和可改进。'),
      makeNode('项目绩效评价',620,300,'#0f766e','评价','中等','绩效,指标,成功标准','从进度、成本、质量、收益、干系人满意度等维度评价项目。','不要只看三重制约。'),
      makeNode('复杂项目管理',60,300,'#ef4444','高级能力','难点','复杂性,不确定性,协同','面对多方关系、高不确定性和动态变化时的综合管理能力。','常需要治理、沟通、风险和系统思维配合。'),
      makeNode('风险与问题管理',-220,170,'#db2777','控制','中等','风险,问题,升级','识别、评估、响应项目风险，并对重大问题进行升级处理。','复杂项目中风险常与干系人和治理相关。'),
      makeNode('组织过程资产',340,430,'#4f46e5','知识资产','重点','经验教训,模板,知识库','沉淀项目经验、模板、标准和复盘成果，支持组织能力提升。','这是标准化和持续改进的载体。'),
      makeNode('职业伦理与责任',850,170,'#0891b2','职业素养','基础','诚信,责任,合规','项目经理需要在复杂利益关系中保持专业责任和合规意识。','能力评价不只看技术，也看职业素养。')
    ];s.nodes=ns;const m=Object.fromEntries(ns.map(n=>[n.title,n.id]));s.links=[
      makeLink(m['项目管理能力模型'],m['项目治理'],'包含','治理能力是高级项目管理能力的重要组成'),
      makeLink(m['项目管理能力模型'],m['标准化流程'],'包含','方法和流程能力支撑专业化管理'),
      makeLink(m['项目治理'],m['项目集与组合管理'],'关联','组织级多项目管理需要治理机制'),
      makeLink(m['标准化流程'],m['组织过程资产'],'产出','流程、模板和经验会沉淀为组织资产'),
      makeLink(m['组织过程资产'],m['项目绩效评价'],'应用','历史数据和标准可支撑评价'),
      makeLink(m['复杂项目管理'],m['风险与问题管理'],'包含','复杂性往往通过风险和问题暴露'),
      makeLink(m['项目集与组合管理'],m['项目绩效评价'],'关联','绩效评价应服务战略和收益'),
      makeLink(m['职业伦理与责任'],m['项目治理'],'关联','治理和决策需要职业责任约束')
    ];return s;
  }
  if(kind==='npdp'){
    s.meta={title:'NPDP产品创新知识图谱',subject:'NPDP / 新产品开发',audience:'产品经理 / 创新管理学习者 / NPDP备考学员',description:'用于梳理产品创新管理、战略、组合、流程、设计开发、市场研究和团队文化。'};
    const ns=[
      makeNode('创新管理',60,40,'#2563eb','总体框架','重点','Innovation Management,治理,组织','从组织层面管理新产品开发和创新活动。','先理解创新不是灵感，而是可管理的系统。'),
      makeNode('产品战略',340,-90,'#7c3aed','战略','重点','战略,定位,路线图','明确产品创新方向、目标市场和竞争定位。','所有项目选择都应回到战略。'),
      makeNode('组合管理',620,40,'#16a34a','组合','重点','Portfolio,资源,优先级','在多个产品机会之间进行选择、平衡和资源配置。','常考战略一致性、风险收益平衡。'),
      makeNode('新产品开发流程',620,300,'#f59e0b','流程','重点','Stage-Gate,敏捷,开发流程','把机会识别、概念、开发、测试和上市转化为可管理流程。','流程不是目的，是降低不确定性的机制。'),
      makeNode('设计与开发',340,430,'#0891b2','开发','中等','设计,原型,验证','把需求和概念转化为可测试、可交付的产品方案。','与用户研究、测试验证紧密关联。'),
      makeNode('市场研究',60,300,'#ef4444','市场','重点','VOC,用户洞察,定量定性','理解客户需求、市场机会和竞争环境。','产品成功通常始于高质量洞察。'),
      makeNode('文化与团队',-220,170,'#db2777','组织','中等','跨职能,创新文化,协作','建立支持创新的组织文化、团队结构和协作机制。','新产品开发通常需要跨职能团队。'),
      makeNode('产品生命周期',340,170,'#0f766e','管理','中等','导入,成长,成熟,衰退','从上市到退市管理产品价值、增长和更新。','可与战略、组合管理结合看。'),
      makeNode('度量与工具',850,170,'#4f46e5','工具','易错点','指标,财务,预测,决策工具','用指标和工具评估机会、过程和结果。','注意不同阶段使用不同度量。')
    ];s.nodes=ns;const m=Object.fromEntries(ns.map(n=>[n.title,n.id]));s.links=[
      makeLink(m['创新管理'],m['产品战略'],'包含','创新管理需要战略方向'),
      makeLink(m['产品战略'],m['组合管理'],'前置','组合选择应与战略一致'),
      makeLink(m['组合管理'],m['新产品开发流程'],'关联','进入流程的项目来自组合决策'),
      makeLink(m['市场研究'],m['产品战略'],'输入','市场洞察支撑战略选择'),
      makeLink(m['市场研究'],m['设计与开发'],'输入','用户需求转化为设计输入'),
      makeLink(m['设计与开发'],m['新产品开发流程'],'包含','设计开发是流程中的核心活动'),
      makeLink(m['文化与团队'],m['新产品开发流程'],'支撑','跨职能团队支撑流程执行'),
      makeLink(m['产品生命周期'],m['组合管理'],'关联','生命周期状态影响组合决策'),
      makeLink(m['度量与工具'],m['组合管理'],'应用','用指标支持筛选和优先级决策')
    ];return s;
  }
  if(kind==='blank'){s.meta={title:'我的知识图谱',subject:'自定义学科',audience:'学员',description:'点击“新增知识点”开始创建。'};return s}
  if(kind==='p2'){
    s.meta={title:'P2 / PRINCE2 知识图谱',subject:'P2 / PRINCE2',audience:'项目管理学习者',description:'用于梳理原则、主题、流程、角色与管理产品之间的关系。'};
    const ns=[
      makeNode('七项原则',60,40,'#2563eb','总体框架','重点','持续业务论证,经验教训,按阶段管理','P2方法论的基本准则，用来指导项目如何被治理和管理。','先记原则，再看主题和流程如何落地。'),
      makeNode('商业论证',340,-90,'#7c3aed','主题','重点','Business Case,收益,价值','说明项目为什么值得做，是项目持续存在的理由。','常和“持续业务论证”原则一起理解。'),
      makeNode('组织',620,40,'#0f766e','主题','中等','角色,责任,项目委员会','定义项目中的角色、职责与决策结构。','注意项目经理、执行、用户、供应商之间的责任。'),
      makeNode('计划',340,210,'#f59e0b','主题','重点','阶段计划,例外计划,产品导向计划','说明如何规划交付物、时间、资源与控制基准。','与按阶段管理、控制阶段关系密切。'),
      makeNode('风险',60,380,'#ef4444','主题','难点','威胁,机会,响应','识别和控制不确定性，既包括威胁，也包括机会。','可与 PMP 风险管理进行对比学习。'),
      makeNode('变更',620,380,'#db2777','主题','易错点','问题,配置,变更控制','处理项目中的问题、变更请求与配置管理。','容易和质量、进展控制混淆。'),
      makeNode('启动项目',60,650,'#0891b2','流程','基础','Starting up,项目授权','确认项目是否值得启动，并为正式立项做准备。','流程学习时建议按时间线排列。'),
      makeNode('指导项目',340,650,'#4f46e5','流程','重点','Directing,项目委员会','项目委员会进行关键授权和决策。','关注“授权”和“容许偏差”。'),
      makeNode('控制阶段',620,650,'#16a34a','流程','重点','Controlling a Stage,工作包','项目经理在阶段内监控进展、分配工作包、处理问题。','适合与“管理产品交付”配套看。')
    ];s.nodes=ns;const m=Object.fromEntries(ns.map(n=>[n.title,n.id]));s.links=[
      makeLink(m['七项原则'],m['商业论证'],'指导','原则支撑主题'),
      makeLink(m['七项原则'],m['计划'],'指导','按阶段管理会影响计划方式'),
      makeLink(m['商业论证'],m['指导项目'],'前置','关键决策需要商业论证支持'),
      makeLink(m['组织'],m['指导项目'],'包含','项目委员会角色来自组织主题'),
      makeLink(m['计划'],m['控制阶段'],'应用','阶段控制基于计划基准'),
      makeLink(m['风险'],m['控制阶段'],'应用','阶段内持续监控风险'),
      makeLink(m['变更'],m['控制阶段'],'应用','问题和变更在阶段控制中处理'),
      makeLink(m['启动项目'],m['指导项目'],'前置','先启动再授权进入后续流程')
    ];return s;
  }
  s.meta={title:'PMP知识点关系图谱',subject:'PMP / 项目管理',audience:'PMP备考学员',description:'用于梳理十大知识领域、过程组和典型工具技术之间的关系。'};
  const ns=[
    makeNode('项目整合管理',60,40,'#2563eb','知识领域','重点','章程,管理计划,变更控制','负责把各知识领域统一起来，关注项目整体协调。','把它看成“总控台”。'),
    makeNode('范围管理',340,-90,'#7c3aed','知识领域','重点','需求,WBS,范围基准','明确做什么、不做什么，并形成范围基准。','WBS 是范围管理的核心可视化产物。'),
    makeNode('进度管理',620,40,'#f59e0b','知识领域','重点','活动,网络图,关键路径','把工作转化为时间计划，确定活动顺序、持续时间和进度基准。','关键路径法是高频考点。'),
    makeNode('成本管理',620,300,'#16a34a','知识领域','中等','估算,预算,EVM','估算成本、制定预算，并通过挣值等方法控制成本。','常与进度一起考综合题。'),
    makeNode('质量管理',340,430,'#0f766e','知识领域','中等','质量标准,审计,检查','确保项目过程和结果满足质量要求。','区分质量保证、质量控制、质量管理。'),
    makeNode('风险管理',60,300,'#ef4444','知识领域','难点','识别,分析,应对,储备','系统处理不确定性，包括威胁和机会。','风险题要分清消极风险和积极风险策略。'),
    makeNode('相关方管理',-220,170,'#db2777','知识领域','重点','识别,参与度,沟通','识别并管理会影响或受项目影响的人。','与沟通管理高度相关。'),
    makeNode('变更控制',340,170,'#4f46e5','核心过程','易错点','CCB,变更请求,配置','对范围、进度、成本等基准变更进行正式控制。','很多情景题都在考“先走变更流程”。'),
    makeNode('WBS',340,-320,'#9333ea','工具/产物','重点','工作分解结构,范围基准','把项目范围分解成可管理的工作包。','WBS 不是活动清单，是交付物导向。'),
    makeNode('关键路径法',850,170,'#ea580c','工具/技术','重点','CPM,浮动时间,最长路径','通过网络路径计算项目最短工期。','总浮动时间为 0 的路径通常是关键路径。'),
    makeNode('敏捷价值观',60,560,'#0891b2','方法理念','基础','迭代,适应性,客户协作','强调快速反馈、持续交付和响应变化。','可和预测型项目管理做对比。')
  ];s.nodes=ns;const m=Object.fromEntries(ns.map(n=>[n.title,n.id]));s.links=[
    makeLink(m['项目整合管理'],m['变更控制'],'包含','整体变更控制属于整合管理核心内容'),
    makeLink(m['范围管理'],m['WBS'],'产出','创建 WBS 形成范围基准'),
    makeLink(m['范围管理'],m['变更控制'],'关联','范围基准变更需要走变更控制'),
    makeLink(m['进度管理'],m['关键路径法'],'应用','关键路径法用于制定和分析进度计划'),
    makeLink(m['进度管理'],m['成本管理'],'关联','进度延误通常会影响成本'),
    makeLink(m['风险管理'],m['变更控制'],'关联','风险应对可能引发变更请求'),
    makeLink(m['相关方管理'],m['项目整合管理'],'关联','相关方诉求会影响整体项目决策'),
    makeLink(m['敏捷价值观'],m['变更控制'],'对比','敏捷更强调适应变化，但仍需透明和共识')
  ];return s;
}
let state=templateState('pmp');
let saveTimer=null,lastSavedSnapshot='',hoverDetailNodeId=null,hoverDetailTimer=null,detailDrag=null,detailPanelDragged=false;
let selectedNodeIds=new Set(),selectedLinkIds=new Set(),boxSelect=null;
function safeString(v,fallback='',max=3000){const s=String(v??fallback).trim();return s.length>max?s.slice(0,max):s}
function safeNumber(v,fallback=0,min=-50000,max=50000){const n=Number(v);return Number.isFinite(n)?clamp(n,min,max):fallback}
function safeColor(v,fallback='#64748b'){const s=String(v||'').trim();return SAFE_HEX_COLOR.test(s)?s:fallback}
function sanitizeFlashcards(list){
  if(!Array.isArray(list))return [];
  return list.slice(0,2000).map(card=>{
    if(!card||typeof card!=='object')return null;
    const title=safeString(card.title,'',120);if(!title)return null;
    return{...card,id:safeString(card.id||uid('f'),'',120),subject:safeString(card.subject||card.source||'导入闪卡','导入闪卡',120),source:safeString(card.source||card.subject||'导入闪卡','导入闪卡',120),category:safeString(card.category||'未分类','未分类',120),title,explanation:safeString(card.explanation||`${title} 是需要复习的知识点。`,'',3000),mnemonic:safeString(card.mnemonic||'','',1200),level:LEVELS.has(card.level)?card.level:'基础',keywords:safeString(card.keywords||'','',500),highlightTerms:safeString(card.highlightTerms||'','',500),color:safeColor(card.color,'#38bdf8')};
  }).filter(Boolean);
}
function sanitizeFlashReviews(reviews){
  if(!reviews||typeof reviews!=='object'||Array.isArray(reviews))return {};
  const out={};
  for(const [key,rec] of Object.entries(reviews).slice(0,4000)){
    if(!rec||typeof rec!=='object')continue;
    const safeKey=safeString(key,'',200);if(!safeKey)continue;
    out[safeKey]={...rec,cardKey:safeString(rec.cardKey||safeKey,safeKey,200),title:safeString(rec.title||'','',160),source:safeString(rec.source||'','',120),category:safeString(rec.category||'','',120),lastResult:rec.lastResult==='remembered'?'remembered':rec.lastResult==='unclear'?'unclear':'',stage:clamp(Math.round(Number(rec.stage)||0),0,REVIEW_INTERVALS.length-1),reviewCount:Math.max(0,Math.round(Number(rec.reviewCount)||0)),rememberCount:Math.max(0,Math.round(Number(rec.rememberCount)||0)),unclearCount:Math.max(0,Math.round(Number(rec.unclearCount)||0)),lastReviewedAt:safeString(rec.lastReviewedAt||'','',80),nextReviewAt:safeString(rec.nextReviewAt||'','',80),history:Array.isArray(rec.history)?rec.history.slice(-60):[]};
  }
  return out;
}
function sanitizeState(data={}){
  const base=baseState(),input=data&&typeof data==='object'?data:{},meta=input.meta&&typeof input.meta==='object'?input.meta:{},defaults=input.defaults&&typeof input.defaults==='object'?input.defaults:{},viewport=input.viewport&&typeof input.viewport==='object'?input.viewport:{};
  const s={...base};
  s.meta={title:safeString(meta.title||base.meta.title,base.meta.title,80),subject:safeString(meta.subject||base.meta.subject,base.meta.subject,80),audience:safeString(meta.audience||base.meta.audience,base.meta.audience,100),description:safeString(meta.description||base.meta.description,base.meta.description,2000)};
  s.viewport={x:safeNumber(viewport.x,base.viewport.x),y:safeNumber(viewport.y,base.viewport.y),scale:safeNumber(viewport.scale,base.viewport.scale,.01,4)};
  s.defaults={...DEFAULTS,nodeSize:NODE_SIZES.has(defaults.nodeSize)?defaults.nodeSize:DEFAULTS.nodeSize,nodeColor:safeColor(defaults.nodeColor,DEFAULTS.nodeColor),linkStyle:LINE_STYLES.has(defaults.linkStyle)?defaults.linkStyle:DEFAULTS.linkStyle,linkPathStyle:LINE_PATH_STYLES.has(defaults.linkPathStyle)?defaults.linkPathStyle:DEFAULTS.linkPathStyle,linkColor:safeColor(defaults.linkColor,DEFAULTS.linkColor),flashSwipeSpeed:clamp(Math.round(Number(defaults.flashSwipeSpeed)||DEFAULTS.flashSwipeSpeed),1,5)};
  s.focusMode=!!input.focusMode;
  const ids=new Set();
  s.nodes=(Array.isArray(input.nodes)?input.nodes:[]).slice(0,2500).map(n=>{
    if(!n||typeof n!=='object')return null;
    let id=safeString(n.id,'',120)||uid('n');if(ids.has(id))id=uid('n');ids.add(id);
    const level=LEVELS.has(n.level)?n.level:safeString(n.level||'基础','基础',40);
    return{id,title:safeString(n.title||'未命名知识点','未命名知识点',80),x:Math.round(safeNumber(n.x,0)),y:Math.round(safeNumber(n.y,0)),color:safeColor(n.color),category:safeString(n.category||'','',100),level,keywords:safeString(n.keywords||'','',500),summary:safeString(n.summary||'','',3000),notes:safeString(n.notes||'','',3000),size:NODE_SIZES.has(n.size)?n.size:'',highlightTerms:safeString(n.highlightTerms||'','',500)};
  }).filter(Boolean);
  const nodeIds=new Set(s.nodes.map(n=>n.id)),linkIds=new Set();
  s.links=(Array.isArray(input.links)?input.links:[]).slice(0,5000).map(l=>{
    if(!l||typeof l!=='object')return null;
    const from=safeString(l.from,'',120),to=safeString(l.to,'',120);if(!nodeIds.has(from)||!nodeIds.has(to)||from===to)return null;
    let id=safeString(l.id,'',120)||uid('l');if(linkIds.has(id))id=uid('l');linkIds.add(id);
    return{id,from,to,type:safeString(l.type??'','',60),note:safeString(l.note||'','',1200),lineStyle:LINE_STYLES.has(l.lineStyle)?l.lineStyle:DEFAULTS.linkStyle,pathStyle:LINE_PATH_STYLES.has(l.pathStyle)?l.pathStyle:DEFAULTS.linkPathStyle,color:safeColor(l.color,DEFAULTS.linkColor)};
  }).filter(Boolean);
  const selectedNode=safeString(input.selectedNodeId,'',120),selectedLink=safeString(input.selectedLinkId,'',120),linkSource=safeString(input.linkSourceId,'',120);
  s.selectedNodeId=nodeIds.has(selectedNode)?selectedNode:null;
  s.selectedLinkId=linkIds.has(selectedLink)?selectedLink:null;
  s.linkSourceId=nodeIds.has(linkSource)?linkSource:null;
  s.importedFlashcards=sanitizeFlashcards(input.importedFlashcards);
  s.flashReviews=sanitizeFlashReviews(input.flashReviews);
  return s;
}
function normalizeState(){state=sanitizeState(state);return state}
function readLegacyState(){
  try{
    const key=currentStoreKey(),store=window.KGAppStorage;
    const data=store&&store.readJSON?store.readJSON(key,null):JSON.parse(localStorage.getItem(key)||'null');
    return data&&typeof data==='object'?sanitizeState(data):null;
  }catch(e){console.warn(e);return null}
}
function load(){
  try{
    const legacy=readLegacyState(),fileStore=window.KGGraphFileStore;
    if(fileStore&&typeof fileStore.ensureInitialized==='function'){
      const file=fileStore.ensureInitialized({legacyKey:currentStoreKey(),graphData:legacy||undefined,fallbackGraphData:legacy?undefined:state});
      if(file&&file.graphData){
        state=sanitizeState(file.graphData);
        lastSavedSnapshot=JSON.stringify(saveableState());
        if(window.KGGraphFileAutosave&&window.KGGraphFileAutosave.clearDirty)window.KGGraphFileAutosave.clearDirty('loaded');
        return true;
      }
    }
    if(legacy){state=legacy;lastSavedSnapshot=JSON.stringify(saveableState());return true}
  }catch(e){console.warn(e)}
  return false;
}
function exportableState(){
  // 导出学习包时仍做完整清洗，保证备份文件干净可靠。
  return sanitizeState({...state,selectedNodeId:null,selectedLinkId:null,linkSourceId:null});
}
function saveableState(){
  // 日常自动保存走轻量路径，避免每次点击/滑动都全量 sanitize，降低长期使用卡顿。
  return {...state,selectedNodeId:null,selectedLinkId:null,linkSourceId:null};
}
function persistCurrentGraphNow(options={}){
  try{
    const snapshot=saveableState(),json=JSON.stringify(snapshot);
    if(json===lastSavedSnapshot&&!options.force)return true;
    const fileStore=window.KGGraphFileStore;
    if(fileStore){
      let current=fileStore.getCurrentFileMeta?fileStore.getCurrentFileMeta():(fileStore.getCurrentFile&&fileStore.getCurrentFile());
      if(!current&&fileStore.ensureInitialized)current=fileStore.ensureInitialized({legacyKey:currentStoreKey(),graphData:snapshot,fallbackGraphData:snapshot});
      const saveOptions={touchOpened:false,emit:options.emit!==false};
      if(options.name!==undefined)saveOptions.name=options.name;
      if(options.syncGraphTitle!==undefined)saveOptions.syncGraphTitle=options.syncGraphTitle;
      const saved=current&&fileStore.saveFile&&fileStore.saveFile(current.id,snapshot,saveOptions);
      if(!saved)throw new Error(fileStore.getLastError&&fileStore.getLastError()||'图谱文件库写入失败');
    }
    // 旧单图谱 key 仅作为兼容镜像。主文件库已成功后再写，镜像失败不影响当前文件的数据安全。
    const store=window.KGAppStorage,key=currentStoreKey();
    let legacySaved=true;
    if(store&&store.writeString)legacySaved=store.writeString(key,json)!==false;
    else{localStorage.setItem(key,json);legacySaved=true}
    if(!legacySaved)console.warn('[GraphSave] legacy mirror write failed:',key);
    lastSavedSnapshot=json;
    return true;
  }catch(e){
    console.warn(e);
    if(!options.silent)showStatus('保存失败：账号存储空间可能已满，请先导出学习包备份。');
    return false;
  }
}
function saveNow(options={}){
  const autosave=window.KGGraphFileAutosave;
  if(autosave&&!options.bypassAutosave&&typeof autosave.saveNow==='function')return autosave.saveNow(options);
  return persistCurrentGraphNow(options);
}
function save(delay=260){
  const autosave=window.KGGraphFileAutosave;
  if(autosave&&typeof autosave.markDirty==='function')return autosave.markDirty('graph-change');
  clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveNow(),delay);
}
window.addEventListener('beforeunload',()=>saveNow({silent:true}))
window.addEventListener('pagehide',()=>saveNow({silent:true}))
