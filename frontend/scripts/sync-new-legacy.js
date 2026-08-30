import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildHomepageBundles } from './homepage-bundles.mjs'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const repoDir = resolve(frontendDir, '..')
const contract = JSON.parse(readFileSync(resolve(scriptsDir, 'new-legacy-contract.json'), 'utf8'))
const homepageBundlePlan = JSON.parse(readFileSync(resolve(scriptsDir, 'homepage-bundles.json'), 'utf8'))
const p45PersistenceContract = JSON.parse(readFileSync(resolve(scriptsDir, 'p45-persistence-contract.json'), 'utf8'))
const runtimePolicyPath = existsSync(resolve(repoDir, 'backend/app/web/runtime_page_policy.json'))
  ? resolve(repoDir, 'backend/app/web/runtime_page_policy.json')
  : resolve(scriptsDir, 'runtime-page-policy.json')
const runtimePagePolicy = JSON.parse(readFileSync(runtimePolicyPath, 'utf8'))
const runtimePages = new Set(runtimePagePolicy.runtimePages)
const learningEntryChooserAssets = ['src/31-learning-entry-chooser.js']
const learningEntryChooserStorageKeys = ['kg_learning_entry_chooser_claim_v1', 'kg_learning_entry_chooser_consumed_v1']
const legacyUnmigratedIndexedDbModules = Object.freeze([
  'content-prep-studio/src/js/10-state-domain.js',
  'content-prep-studio/dist/content-prep.html',
])

function parseArgs(argv) {
  const args = { source: resolve(repoDir, 'new-legacy'), out: resolve(frontendDir, 'public', 'new-legacy') }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--source' || token === '--out') {
      const value = argv[index + 1]
      if (!value) throw new Error(`${token} 缺少目录参数`)
      args[token.slice(2)] = resolve(value)
      index += 1
    } else {
      throw new Error(`未知参数：${token}`)
    }
  }
  return args
}

function walk(root, base = root) {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(root, entry.name)
      return entry.isDirectory() ? walk(path, base) : [relative(base, path)]
    })
    .sort()
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before)
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label} 结构已变化，请复核兼容补丁`)
  }
  return source.replace(before, after)
}

function replaceVisibleCopy(source, before, after, label) {
  if (!source.includes(before)) return source
  return replaceExactlyOnce(source, before, after, label)
}

function skipQuotedLiteral(source, start, quote) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1
    } else if (source[index] === quote) {
      return index + 1
    }
  }
  return source.length
}

function skipLineComment(source, start) {
  const newline = source.indexOf('\n', start + 2)
  return newline < 0 ? source.length : newline
}

function skipBlockComment(source, start) {
  const close = source.indexOf('*/', start + 2)
  return close < 0 ? source.length : close + 2
}

function matchingDelimiterIndex(source, openIndex, open, close) {
  let depth = 1
  for (let index = openIndex + 1; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]
    if (character === "'" || character === '"') {
      index = skipQuotedLiteral(source, index, character) - 1
      continue
    }
    if (character === '`') {
      index = skipTemplateLiteral(source, index) - 1
      continue
    }
    if (character === '/' && next === '/') {
      index = skipLineComment(source, index) - 1
      continue
    }
    if (character === '/' && next === '*') {
      index = skipBlockComment(source, index) - 1
      continue
    }
    if (character === open) depth += 1
    if (character === close) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function skipTemplateLiteral(source, start) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1
    } else if (source[index] === '`') {
      return index + 1
    } else if (source[index] === '$' && source[index + 1] === '{') {
      const close = matchingDelimiterIndex(source, index + 1, '{', '}')
      if (close < 0) return source.length
      index = close
    }
  }
  return source.length
}

function nextCodeIndex(source, start) {
  let index = start
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1
    } else if (source[index] === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index)
    } else if (source[index] === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index)
    } else {
      return index
    }
  }
  return index
}

function namedFunctionRegion(source, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const signature = new RegExp(
    `(^|\\n)([ \\t]*)(?:async[ \\t]+)?function[ \\t]+${escapedName}[ \\t]*\\(`,
  )
  const match = signature.exec(source)
  if (!match) return null
  const start = match.index + match[1].length
  const openParenthesis = match.index + match[0].length - 1
  const closeParenthesis = matchingDelimiterIndex(source, openParenthesis, '(', ')')
  if (closeParenthesis < 0) return null
  const openBrace = nextCodeIndex(source, closeParenthesis + 1)
  if (source[openBrace] !== '{') return null
  const closeBrace = matchingDelimiterIndex(source, openBrace, '{', '}')
  if (closeBrace < 0) return null
  const end = closeBrace + 1
  return { start, end, text: source.slice(start, end) }
}

const architectureCopyRules = {
  'index.html': [[
    '当前为本地单文件多用户：账号和数据保存在本浏览器 localStorage 中。不同用户的数据互相隔离；如需跨设备/真正安全登录，需要后续接入服务器。',
    '当前账号和学习数据已同步至服务器，并按用户隔离；重新登录或更换设备后可继续使用。',
  ]],
  'question-training.html': [[
    '当前为本地单文件多用户：账号和数据保存在本浏览器 localStorage 中。不同用户的数据互相隔离；如需跨设备/真正安全登录，需要后续接入服务器。',
    '当前账号和学习数据已同步至服务器，并按用户隔离；重新登录或更换设备后可继续使用。',
  ]],
  'user-management.html': [
    [
      '管理本浏览器中的账号资料、角色状态、归档记录和常规操作日志。后续接入服务器时可迁移为正式后台。',
      '管理服务器中的账号资料、角色状态、归档记录和常规操作日志。所有变更都会同步保存到后台。',
    ],
    [
      '删除账号：移除账号资料；是否清除学习数据需后续接服务器后细化。',
      '删除账号：移除账号资料；关联学习数据按服务器数据保留策略处理。',
    ],
    [
      '当前版本为前端权限提示与拦截；正式网络版仍需后端二次校验。',
      '页面与服务器共同执行权限校验，敏感操作会在后端再次验证。',
    ],
  ],
  'system-settings.html': [
    [
      '配置微信开放平台扫码登录。当前纯前端版本保留本地演示扫码能力，正式接入需要后端换取 openid/unionid。',
      '配置微信开放平台扫码登录。账号认证与扫码配置由服务器统一管理。',
    ],
    [
      '当前版本为前端权限提示与拦截；正式网络版仍需后端二次校验。',
      '页面与服务器共同执行权限校验，敏感操作会在后端再次验证。',
    ],
  ],
  'src/32-wechat-login.js': [
    ['本地演示扫码成功', '模拟扫码成功'],
    [
      '本地演示会创建一个微信演示账号；正式上线时请关闭演示模式。',
      '测试模式仅用于验证扫码界面；正式环境请关闭测试模式。',
    ],
  ],
  'src/33-user-center.js': [
    [
      '查看各会员方案权益。当前纯前端版本暂未接入支付，购买按钮用于后续支付入口预留。',
      '查看各会员方案权益。套餐开通方式由管理员在系统设置中统一配置。',
    ],
    [
      '当前纯前端版本暂不接真实支付。确认后会生成一条“待确认”的订阅申请，由管理员在系统设置中确认开通。',
      '确认后会生成一条“待确认”的订阅申请，由管理员在系统设置中确认开通。',
    ],
    [
      '例如：所在班级、学习目标、备考进度等，仅保存在本浏览器。',
      '例如：所在班级、学习目标、备考进度等，保存后会同步到服务器。',
    ],
  ],
  'src/35-user-management.js': [[
    '本浏览器 localStorage',
    '服务器账号',
  ]],
  'src/36-system-settings.js': [
    [
      '当前纯前端版支持“本地演示扫码登录”；正式微信扫码登录需要微信开放平台 AppID、授权回调域名和后端换取 openid/unionid 的接口。',
      '微信扫码配置由服务器统一保存；正式模式需要微信开放平台 AppID、授权回调域名和服务器换取 openid/unionid 的接口。',
    ],
    ['启用本地演示扫码', '启用扫码测试模式'],
    [
      '当前版本用于本地演示和管理员手动开通；价格只填写原价和折扣系数，现价会自动计算。正式收费时应由后端保存价格、订单和订阅状态。',
      '套餐价格、订单和订阅状态统一保存到服务器；价格填写原价和折扣系数，现价会自动计算。',
    ],
  ],
}

function patchArchitectureCopy(path, source) {
  return (architectureCopyRules[path] || []).reduce(
    (generated, [before, after], index) => replaceVisibleCopy(
      generated,
      before,
      after,
      `new-legacy ${path} 架构文案补丁 ${index + 1}`,
    ),
    source,
  )
}

function sourceFiles(source) {
  return Object.fromEntries(walk(source).map((path) => [path, hashFile(resolve(source, path))]))
}

function patchTrainingSessionReentrancy(source) {
  const declaration = "  let active=null;\n  let runtimeKey='';"
  if (!source.includes(declaration)) {
    throw new Error('new-legacy 训练会话协调器结构已变化，请复核 src/64-flow-orchestrator.js 的重入补丁')
  }
  const eventCandidates = [
    "    try{global.dispatchEvent(new CustomEvent('kg:learning-session-changed',{detail:{reason,session:clone(active)}}))}catch(e){}",
    "    try{global.dispatchEvent(new CustomEvent('kg:learning-session-changed',{detail:{reason,session:active}}))}catch(e){}",
  ]
  const event = eventCandidates.find((candidate) => source.includes(candidate))
  if (!event) {
    throw new Error('new-legacy 训练会话事件结构已变化，请复核 src/64-flow-orchestrator.js 的重入补丁')
  }
  const persistAssignment = '    active=saved;\n    runtimeKey=makeRuntimeKey(saved);'
  if (!source.includes(persistAssignment)) {
    throw new Error('new-legacy 训练会话持久化结构已变化，请复核 src/64-flow-orchestrator.js 的空结果保护')
  }
  return source
    .replace(declaration, `${declaration}\n  let publishingSessionChange=false;`)
    .replace(event, [
      '    if(!publishingSessionChange){',
      '      publishingSessionChange=true;',
      `      try{${event.trim()}}finally{publishingSessionChange=false}`,
      '    }',
    ].join('\n'))
    .replace(persistAssignment, `    if(!saved)return clone(current);\n${persistAssignment}`)
}

function patchGraphInteractions(source) {
  const migratedMarkers = [
    'function findAvailableNodePosition(',
    'editingNodeIsNew=false',
    'closeNodeModal({discardNew:true})',
    'const existing=linksForNodeId(source).find(',
  ]
  if (migratedMarkers.every((marker) => source.includes(marker))) return source
  let generated = replaceExactlyOnce(
    source,
    "function createNodeAt(x,y){const sub=window.KGSubscription;if(sub&&typeof sub.requireUsageLimit==='function'&&!sub.requireUsageLimit('graphNodes',state.nodes.length,1,{label:'图谱卡牌'}))return null;clearRelatedGatherLayout({render:false,message:false});clearMultiSelection();const size=state.defaults.nodeSize||'',color=safeColor(state.defaults.nodeColor,DEFAULTS.nodeColor),d=dimsForSize(size),n=makeNode('新知识点',Math.round(x-d.w/2),Math.round(y-d.h/2),color,'','基础','','','',size);state.nodes.push(n);state.selectedNodeId=n.id;state.selectedLinkId=null;state.linkSourceId=null;render({persist:true});openNodeModal(n.id,true);return n}",
    [
      "function graphNodeRectsOverlap(x,y,w,h,node){const d=nodeDims(node),gap=12;return x<node.x+d.w+gap&&x+w+gap>node.x&&y<node.y+d.h+gap&&y+h+gap>node.y}",
      "function findAvailableNodePosition(x,y,w,h){const origin={x:Math.round(x),y:Math.round(y)};for(let attempt=0;attempt<64;attempt++){const candidate={x:origin.x+(attempt%8)*36,y:origin.y+Math.floor(attempt/8)*36};if(!state.nodes.some(node=>graphNodeRectsOverlap(candidate.x,candidate.y,w,h,node)))return candidate}return{x:origin.x+36,y:origin.y+36}}",
      "function createNodeAt(x,y){const sub=window.KGSubscription;if(sub&&typeof sub.requireUsageLimit==='function'&&!sub.requireUsageLimit('graphNodes',state.nodes.length,1,{label:'图谱卡牌'}))return null;clearRelatedGatherLayout({render:false,message:false});clearMultiSelection();const size=state.defaults.nodeSize||'',color=safeColor(state.defaults.nodeColor,DEFAULTS.nodeColor),d=dimsForSize(size),position=findAvailableNodePosition(x-d.w/2,y-d.h/2,d.w,d.h),n=makeNode('新知识点',position.x,position.y,color,'','基础','','','',size);state.nodes.push(n);state.selectedNodeId=n.id;state.selectedLinkId=null;state.linkSourceId=null;render({persist:true});openNodeModal(n.id,true);return n}",
    ].join('\n'),
    'new-legacy 新节点自动错位',
  )
  generated = replaceExactlyOnce(
    generated,
    [
      'let editingNodeId=null,editingLinkId=null;',
      "function openNodeModal(id,isNew=false){const n=nodeById(id);if(!n)return;editingNodeId=id;$('nodeModalTitle').textContent=isNew?'创建知识点':'编辑知识点';$('nTitle').value=n.title||'';$('nCategory').value=n.category||'';$('nColor').value=safeColor(n.color,'#64748b');$('nSize').value=n.size||'';$('nLevel').value=n.level||'基础';$('nKeywords').value=n.keywords||'';$('nSummary').value=n.summary||'';$('nNotes').value=n.notes||'';$('deleteNodeBtn').style.display=isNew?'none':'';$('nodeModal').classList.add('show');setTimeout(()=>$('nTitle').focus(),80)}",
      "function closeNodeModal(){$('nodeModal').classList.remove('show')}",
      "$('cancelNodeBtn').onclick=closeNodeModal;",
    ].join('\n'),
    [
      'let editingNodeId=null,editingNodeIsNew=false,editingLinkId=null;',
      "function openNodeModal(id,isNew=false){const n=nodeById(id);if(!n)return;editingNodeId=id;editingNodeIsNew=!!isNew;$('nodeModalTitle').textContent=isNew?'创建知识点':'编辑知识点';$('nTitle').value=n.title||'';$('nCategory').value=n.category||'';$('nColor').value=safeColor(n.color,'#64748b');$('nSize').value=n.size||'';$('nLevel').value=n.level||'基础';$('nKeywords').value=n.keywords||'';$('nSummary').value=n.summary||'';$('nNotes').value=n.notes||'';$('deleteNodeBtn').style.display=isNew?'none':'';$('nodeModal').classList.add('show');setTimeout(()=>$('nTitle').focus(),80)}",
      "function closeNodeModal(options={}){const draftId=options.discardNew&&editingNodeIsNew?editingNodeId:null;$('nodeModal').classList.remove('show');editingNodeId=null;editingNodeIsNew=false;if(draftId){state.nodes=state.nodes.filter(node=>node.id!==draftId);state.links=state.links.filter(link=>link.from!==draftId&&link.to!==draftId);selectedNodeIds.delete(draftId);if(state.selectedNodeId===draftId)state.selectedNodeId=null;if(state.linkSourceId===draftId)state.linkSourceId=null;render({persist:true});showStatus('已取消创建知识点。')}}",
      "$('cancelNodeBtn').onclick=()=>closeNodeModal({discardNew:true});",
    ].join('\n'),
    'new-legacy 取消新节点草稿',
  )
  generated = replaceExactlyOnce(
    generated,
    "['nodeModal','linkModal','graphModal','templateModal','flashcardModal'].forEach(id=>{$(id).addEventListener('click',e=>{if(e.target===$(id))$(id).classList.remove('show')})});",
    "$('nodeModal').addEventListener('click',e=>{if(e.target===$('nodeModal'))closeNodeModal({discardNew:true})});\n['linkModal','graphModal','templateModal','flashcardModal'].forEach(id=>{$(id).addEventListener('click',e=>{if(e.target===$(id))$(id).classList.remove('show')})});",
    'new-legacy 新节点遮罩取消',
  )
  generated = replaceExactlyOnce(
    generated,
    "    if(relationExists(source,id)){\n      showStatus(`“${a?a.title:'起点'}”与“${b.title}”之间已有关系线。`);\n    }else{",
    "    if(relationExists(source,id)){\n      const existing=linksForNodeId(source).find(link=>(link.from===source&&link.to===id)||(link.from===id&&link.to===source));\n      state.selectedLinkId=existing?existing.id:null;\n      showStatus(`“${a?a.title:'起点'}”与“${b.title}”之间已有关系线。`);\n    }else{",
    'new-legacy 重复关系保持可见',
  )
  return generated
}

function patchAddQuestionTab(source) {
  // v9 改了 render（qb-base-panel 只在 activeLayoutNav='base' 展开），但 addQuestion 仍设
  // 'questions'（v8.6 遗留值）→ 新建题目后编辑表单 display:none 不显示。仅 v9 修；
  // v8.6.29 的 render 兼容 'questions'，不动。
  if (!source.includes('knowledge-recall.html?bankId=')) return source
  const addQuestion = namedFunctionRegion(source, 'addQuestion')
  if (addQuestion?.text.includes('Catalog.saveQuestion(')) return source
  return replaceExactlyOnce(
    source,
    "    state.activeSidebarTab = 'questions';\n    state.activeLayoutNav = 'questions';\n    bank.updatedAt = Date.now();\n    saveBanks();\n    render();\n  }",
    "    state.activeSidebarTab = 'questions';\n    state.activeMainTab = 'base';\n    state.activeLayoutNav = 'base';\n    bank.updatedAt = Date.now();\n    saveBanks();\n    render();\n  }",
    'new-legacy 新建题目激活编辑视图',
  )
}

// 定制层（1305e16 admin 功能偏好分析面板）：v9 上游无此面板，从 new-legacy 提取并注入。
// 三段式 idempotent：new-legacy 已含则跳过（meta 测试 source=new-legacy 时直接 pass-through）。
function patchSystemSettingsAnalyticsJs(generated) {
  if (generated.includes('ANALYTICS_FEATURE_LABELS')) return generated
  const nlPath = resolve(repoDir, 'new-legacy/src/36-system-settings.js')
  if (!existsSync(nlPath)) return generated
  const nlSource = readFileSync(nlPath, 'utf8')
  const blockStart = nlSource.indexOf('  const ANALYTICS_FEATURE_LABELS')
  const blockEnd = nlSource.indexOf('  function setTab', blockStart)
  if (blockStart < 0 || blockEnd < 0) {
    // new-licity 不含 analytics 定制块（v9 上游无此面板）时跳过注入，避免阻塞 sync。
    return generated
  }
  const block = nlSource.slice(blockStart, blockEnd).replace(/\n+$/, '')
  let out = replaceExactlyOnce(
    generated,
    "    toast('日志已清空');\n  }\n\n  function setTab(tab){",
    `    toast('日志已清空');\n  }\n\n${block}\n\n  function setTab(tab){`,
    'new-legacy 系统设置 analytics 函数块',
  )
  out = replaceExactlyOnce(
    out,
    "    document.querySelectorAll('[data-ss-panel]').forEach(panel=>panel.classList.toggle('active',panel.dataset.ssPanel===next));\n  }",
    "    document.querySelectorAll('[data-ss-panel]').forEach(panel=>panel.classList.toggle('active',panel.dataset.ssPanel===next));\n    if(next==='analytics'){initAnalyticsControls();if(!analyticsAutoLoaded){analyticsAutoLoaded=true;loadFeatureAnalytics();}}\n  }",
    'new-legacy 系统设置 setTab analytics 分支',
  )
  out = replaceExactlyOnce(
    out,
    "    const clear=$('ssClearLogsBtn');\n    if(clear)clear.addEventListener('click',clearLogs);",
    "    const clear=$('ssClearLogsBtn');\n    if(clear)clear.addEventListener('click',clearLogs);\n    const analyticsApply=$('ssAnalyticsApply');\n    if(analyticsApply)analyticsApply.addEventListener('click',loadFeatureAnalytics);",
    'new-legacy 系统设置 bindEvents analytics 绑定',
  )
  out = replaceExactlyOnce(
    out,
    '    bindEvents();\n    render();',
    '    bindEvents();\n    render();\n    initAnalyticsControls();',
    'new-legacy 系统设置 init analytics 控件',
  )
  return out
}

function patchSystemSettingsAnalyticsHtml(generated) {
  if (generated.includes('data-ss-tab="analytics"')) return generated
  if (!generated.includes('data-ss-tab="logs">操作日志')) return generated
  const analyticsTab = '        <button type="button" data-ss-tab="analytics">功能分析</button>'
  const analyticsPanel = [
    '',
    '        <section class="ss-pane" data-ss-panel="analytics">',
    '          <div class="um-panel">',
    '            <div class="um-card-head small"><div><h2>用户功能偏好</h2><p>比较常用程度与成果用户率，仅展示汇总数据。</p></div></div>',
    '            <div class="ss-analytics-filters">',
    '              <label>开始日期<input id="ssAnalyticsStart" type="date"></label>',
    '              <label>结束日期<input id="ssAnalyticsEnd" type="date"></label>',
    '              <label>角色<select id="ssAnalyticsRole"><option value="">全部角色</option><option value="teacher">教师/教研</option><option value="student">学员</option><option value="viewer">游客</option></select></label>',
    '              <button id="ssAnalyticsApply" type="button">查询</button>',
    '            </div>',
    '            <div id="ssAnalyticsContent" aria-live="polite"></div>',
    '          </div>',
    '        </section>',
  ].join('\n')
  let out = replaceExactlyOnce(
    generated,
    '        <button type="button" data-ss-tab="logs">操作日志</button>\n      </aside>',
    `        <button type="button" data-ss-tab="logs">操作日志</button>\n${analyticsTab}\n      </aside>`,
    'new-legacy 系统设置 analytics 标签按钮',
  )
  out = replaceExactlyOnce(
    out,
    '            <div class="um-log-list" id="ssLogList"></div>\n          </div>\n        </section>',
    `            <div class="um-log-list" id="ssLogList"></div>\n          </div>\n        </section>\n${analyticsPanel}`,
    'new-legacy 系统设置 analytics 面板',
  )
  return out
}

function patchSystemSettingsAnalyticsCss(generated) {
  if (generated.includes('.ss-analytics-filters')) return generated
  const nlPath = resolve(repoDir, 'new-legacy/styles/system-settings.css')
  if (!existsSync(nlPath)) return generated
  const nlSource = readFileSync(nlPath, 'utf8')
  const blockStart = nlSource.indexOf('/* 用户功能偏好分析仪表板 */')
  if (blockStart < 0) {
    return generated
  }
  const block = nlSource.slice(blockStart).replace(/\n+$/, '')
  const out = replaceExactlyOnce(
    generated,
    'grid-template-columns:repeat(5,minmax(0,1fr));',
    'grid-template-columns:repeat(6,minmax(0,1fr));',
    'new-legacy system-settings.css 侧栏 6 列',
  )
  return `${out}\n/* kg:analytics-custom */\n${block}\n@media(max-width:768px){\n  .ss-analytics-summary{grid-template-columns:1fr;}\n  .ss-analytics-filters{flex-direction:column;align-items:stretch;}\n}\n`
}

// 定制层（fe45237 会员中心 UI）：membership-ui.css 紧跟 user-center.css 之后注入。
// 仅在产物含 membership-ui.css（定制块已 cp）时对每页注入；idempotent。
// v9 上游 user-center.css link 有两种自闭合写法（有空格 / 无空格），都要兼容。
function patchMembershipUiLink(generated) {
  if (generated.includes('styles/membership-ui.css')) return generated
  const variants = [
    '<link rel="stylesheet" href="styles/user-center.css"/>',
    '<link rel="stylesheet" href="styles/user-center.css" />',
  ]
  for (const link of variants) {
    if (generated.includes(link)) {
      return replaceExactlyOnce(
        generated,
        link,
        `${link}\n<link rel="stylesheet" href="styles/membership-ui.css"/>`,
        'new-legacy membership-ui.css link 注入',
      )
    }
  }
  return generated
}

// 定制层（cd38328 业务埋点）：在 v9 重构后的 5 个 src 文件成功操作点注入 KGFeatureAnalytics.track。
// v9 改了 65（saveBanks 签名）与 86（saveProgress debounce）的保存函数，锚点用 v9 专属；
// new-legacy 已含全部埋点，marker guard 跳过。graph 埋点在 bridge（direct-graph-adapter.js，已含）。
const ANALYTICS_TRACK = 'const track=(globalThis.KGFeatureAnalytics&&globalThis.KGFeatureAnalytics.track)||function(){};'

function injectTrack(source, marker, before, after, label) {
  if (source.includes(marker)) return source
  if (!source.includes(before)) return source
  return replaceExactlyOnce(source, before, after, label)
}

function patchFeatureAnalytics(path, source) {
  if (path === '27-graph-file-manager.js') {
    return injectTrack(
      source,
      "track('files','outcome','library_saved')",
      "try{await state.modalHandler(value);closeModal()}catch(err){toast(err.message||String(err),'error')}finally{setBusy(false)}",
      `try{await state.modalHandler(value);${ANALYTICS_TRACK}track('files','key_action','library_saved');track('files','outcome','library_saved');closeModal()}catch(err){toast(err.message||String(err),'error')}finally{setBusy(false)}`,
      'new-legacy 文件库保存埋点',
    )
  }
  if (path === '64-flow-orchestrator.js') {
    return injectTrack(
      source,
      "track('training','key_action','answer_submitted')",
      `          isCorrect:saved.answer.isCorrect,
          confidence:saved.confidence
        },saved);`,
      `          isCorrect:saved.answer.isCorrect,
          confidence:saved.confidence
        },saved);
        ${ANALYTICS_TRACK}
        track('training','key_action','answer_submitted');
        track('training','outcome',saved.answer.isCorrect?'answer_correct':'answer_incorrect');`,
      'new-legacy 训练答题埋点',
    )
  }
  if (path === '65-question-bank-admin.js') {
    let out = injectTrack(
      source,
      "track('question_bank','outcome','bank_saved')",
      `    bank.questions.forEach(q => { q.subject = q.subject || bank.subject; });
    saveBanks(state.banks,{silent:true});
    render();`,
      `    bank.questions.forEach(q => { q.subject = q.subject || bank.subject; });
    saveBanks(state.banks,{silent:true});
    ${ANALYTICS_TRACK}track('question_bank','key_action','bank_saved');track('question_bank','outcome','bank_saved');
    render();`,
      'new-legacy 题库保存埋点',
    )
    return injectTrack(
      out,
      "track('question_bank','outcome','question_saved')",
      '    if(!options.silent) render();',
      `    if(!options.silent){${ANALYTICS_TRACK}track('question_bank','key_action','question_saved');track('question_bank','outcome','question_saved');render()}`,
      'new-legacy 题目保存埋点',
    )
  }
  if (path === '86-knowledge-recall.js') {
    const marker = "track('recall','outcome','recall_saved')"
    if (source.includes(marker)) return source
    const legacyBefore = '      return Boolean(await RecallProgress.write(targetQuestion,progressPayload()));'
    const legacyAfter = `      const saved=Boolean(await RecallProgress.write(targetQuestion,progressPayload()));
      if(saved){${ANALYTICS_TRACK}track('recall','key_action','recall_saved');track('recall','outcome','recall_saved');}
      return saved;`
    if (source.includes(legacyBefore)) {
      return replaceExactlyOnce(source, legacyBefore, legacyAfter, 'new-legacy 回忆数据库保存埋点')
    }
    const databaseBefore = '    try{await recallAdapter.saveGraph(progressPayload());return true}'
    const databaseAfter = `    try{
      const saved=Boolean(await recallAdapter.saveGraph(progressPayload()));
      if(saved){${ANALYTICS_TRACK}track('recall','key_action','recall_saved');track('recall','outcome','recall_saved');}
      return saved
    }`
    return source.includes(databaseBefore)
      ? replaceExactlyOnce(source, databaseBefore, databaseAfter, 'new-legacy 数据库回忆保存埋点')
      : source
  }
  if (path === '88-guided-learning-store.js') {
    let out = injectTrack(
      source,
      "track('learning_path','outcome','node_completed')",
      `        metrics:clone(entry.metrics)
      },{userId:String(userId||currentUserId())});
    }catch(error){}
    return write(progress,course,userId);`,
      `        metrics:clone(entry.metrics)
      },{userId:String(userId||currentUserId())});
    }catch(error){}
    ${ANALYTICS_TRACK}
    track('learning_path','key_action','node_completed');
    track('learning_path','outcome','node_completed');
    return write(progress,course,userId);`,
      'new-legacy 学习路径节点埋点',
    )
    return injectTrack(
      out,
      "track('learning_path','outcome','placement_completed')",
      `        courseId:course.id,partId:key,...clone(attempt)
      },{userId:String(userId||currentUserId())});
    }catch(error){}
    return write(progress,course,userId);`,
      `        courseId:course.id,partId:key,...clone(attempt)
      },{userId:String(userId||currentUserId())});
    }catch(error){}
    ${ANALYTICS_TRACK}
    track('learning_path','key_action','placement_completed');
    track('learning_path','outcome','placement_completed');
    return write(progress,course,userId);`,
      'new-legacy 学习路径测试埋点',
    )
  }
  return source
}

function versionPageAssets(html, version) {
  const query = `?v=${encodeURIComponent(version)}`
  const withStyles = html.replace(
    /(\bhref=(['"]))((?!https?:|\/\/|data:|#)[^'"?#]+\.css)\2/gi,
    (_, prefix, quote, asset) => `${prefix}${asset}${query}${quote}`,
  )
  return withStyles.replace(
    /(<script\b[^>]*\bsrc=(['"]))((?!https?:|\/\/|data:)[^'"?#]+\.js)\2/gi,
    (_, prefix, quote, asset) => asset.replace(/^\.\//, '') === 'server-state-bootstrap.js'
      ? `${prefix}${asset}${quote}`
      : `${prefix}${asset}${query}${quote}`,
  )
}

function versionPageRelease(html, version) {
  if (/\bdata-release=(['"])[^'"]*\1/i.test(html)) {
    return html.replace(/\bdata-release=(['"])[^'"]*\1/i, `data-release="${version}"`)
  }
  return html.replace(/<html\b/i, `<html data-release="${version}"`)
}

function injectPage(html, page, version) {
  if (page === 'landing.html') {
    return versionPageAssets(versionPageRelease(html, version), version)
  }
  const retiredSingleDeepRedirectShell = page === 'question-training.html'
    && /location\.replace\(target\.toString\(\)\)/.test(html)
    && /id="practiceRedirectFallback"/.test(html)
  const injection = [
    '<script src="./teaching-content-sync.js"></script><!-- kg-teaching-content-sync:generated -->',
    '<!-- kg-direct-bootstrap-anchor -->',
    runtimePages.has(page) ? '<script src="./server-state-bootstrap.js"></script><!-- kg-state:generated -->' : '',
    '<script src="./runtime-config.override.js"></script><!-- kg-runtime:generated -->',
    '<script src="./auth-session-bootstrap.js"></script><!-- kg-auth-session:generated -->',
    retiredSingleDeepRedirectShell ? '' : '<script src="./domain-api-client.js"></script><!-- kg-domain-api:generated -->',
    retiredSingleDeepRedirectShell || !['admin-console.html', 'admin-operations.html', 'admin-settings.html', 'admin-subjects.html', 'content-center.html', 'course-admin.html', 'knowledge-recall.html', 'paper-management.html', 'question-bank.html', 'question-workspace.html', 'teacher-workbench.html'].includes(page) ? '' : '<script src="./teaching-content-adapter.js"></script><!-- kg-teaching-content-api:generated -->',
    retiredSingleDeepRedirectShell || !['admin-console.html', 'admin-operations.html', 'admin-settings.html', 'admin-subjects.html', 'content-center.html', 'course-admin.html', 'teacher-workbench.html'].includes(page) ? '' : '<script src="./course-management-adapter.js"></script><!-- kg-course-management-api:generated -->',
    retiredSingleDeepRedirectShell || !['admin-console.html', 'admin-operations.html'].includes(page) ? '' : '<script src="./admin-domain-summary.js"></script><!-- kg-admin-domain-summary:generated -->',
    retiredSingleDeepRedirectShell ? '' : '<script src="src/28-device-preferences.js"></script><!-- kg-device-preferences:generated -->',
    '<script defer src="./direct-entry.js"></script><!-- kg-direct-entry:generated -->',
    '<script defer src="./feature-analytics.js"></script><!-- kg-feature-analytics:generated -->',
    page === 'index.html' ? '<script defer src="./homepage-loader.js"></script><!-- kg-homepage-loader:generated -->' : '',
  ].filter(Boolean).join('\n')
  let generated = html.includes('kg-runtime:generated')
    ? html
    : /<head(?:\s[^>]*)?>/i.test(html)
      ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}\n${injection}`)
      : `${injection}\n${html}`
  const localScriptPattern = (asset) => {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return `<script\\b[^>]*\\bsrc=(['"])(?:\\.\\/)?${escaped}(?:\\?[^'"]*)?\\1[^>]*><\\/script>`
  }
  const findLocalScriptTag = (source, asset) => source.match(new RegExp(localScriptPattern(asset), 'i'))?.[0] || ''
  const removeLocalScriptTags = (source, asset) => source
    .replace(new RegExp(`^[ \\t]*${localScriptPattern(asset)}[ \\t]*(?:\\r?\\n)?`, 'gim'), '')
    .replace(new RegExp(localScriptPattern(asset), 'gi'), '')
  const learningModeConsumers = {
    'paper-management.html': 'src/65-question-bank-admin.js',
    'question-workspace.html': 'src/77-multi-question-workspace.js',
    'course-admin.html': 'src/93-content-organization-core.js',
    'knowledge-recall.html': 'src/96-recall-question-source.js',
    'practice-mode.html': 'src/100-practice-mode.js',
    'question-bank.html': 'src/65-question-bank-admin.js',
    'admin-console.html': 'src/93-content-organization-core.js',
    'admin-operations.html': 'src/93-content-organization-core.js',
    'admin-settings.html': 'src/93-content-organization-core.js',
    'admin-subjects.html': 'src/93-content-organization-core.js',
    'content-center.html': 'src/93-content-organization-core.js',
    'teacher-workbench.html': 'src/93-content-organization-core.js',
  }
  const learningModeConsumer = learningModeConsumers[page]
  const questionCatalogPages = {
    'teacher-workbench.html': { mode: 'managed', marker: '<script src="src/91-teacher-workbench-app.js"></script>' },
    'question-bank.html': { mode: 'managed', marker: '<script defer src="src/65-question-bank-admin.js"></script>' },
    'paper-management.html': { mode: 'managed', marker: '<script defer src="src/65-question-bank-admin.js"></script>' },
    'question-workspace.html': { mode: 'learning', marker: '<script defer src="src/59-published-paper-repository.js"></script>' },
    'knowledge-recall.html': { mode: 'learning', marker: '<script defer src="src/59-published-paper-repository.js"></script>' },
    'practice-mode.html': { mode: 'learning', marker: generated.includes('<script defer src="src/59-published-paper-repository.js"></script>') ? '<script defer src="src/59-published-paper-repository.js"></script>' : '<script defer src="src/100-practice-mode.js"></script>' },
    'index.html': { mode: 'learning', marker: '<script defer src="src/60-question-bank.js"></script>' },
  }
  const catalogPage = questionCatalogPages[page]
  if (catalogPage && !generated.includes('kg-question-catalog:generated')) {
    if (!generated.includes(catalogPage.marker)) {
      throw new Error(`new-legacy ${page} 题目目录脚本顺序已变化，请复核目录适配器`)
    }
    generated = generated.replace(
      /<body\b([^>]*)>/i,
      (body, attributes) => /\bdata-question-catalog-mode=/i.test(attributes)
        ? body
        : `<body${attributes} data-question-catalog-mode="${catalogPage.mode}">`,
    )
    generated = generated.replace(
      catalogPage.marker,
      `<script defer src="./question-catalog-adapter.js"></script><!-- kg-question-catalog:generated -->\n${page === 'question-bank.html' ? '<script defer src="./direct-question-adapter.js"></script><!-- kg-question-editor:generated -->\n' : ''}${catalogPage.marker}`,
    )
  }
  if (page === 'practice-mode.html' && !generated.includes('kg-practice-learning:generated')) {
    const practiceTag = '<script defer src="src/100-practice-mode.js"></script>'
    if (!generated.includes(practiceTag)) {
      throw new Error('new-legacy 做题脚本顺序已变化，请复核练习数据库适配器')
    }
    generated = generated.replace(
      practiceTag,
      `<script defer src="./practice-learning-adapter.js"></script><!-- kg-practice-learning:generated -->\n${practiceTag}`,
    )
  }
  if (['file-manager.html', 'question-workspace.html'].includes(page)
    && !generated.includes('kg-canvas-workspaces:generated')) {
    const storeTag = findLocalScriptTag(generated, 'src/65-canvas-workspace-store.js')
    if (storeTag) {
      generated = generated.replace(
        storeTag,
        `${storeTag}\n<script defer src="./canvas-workspace-adapter.js"></script><!-- kg-canvas-workspaces:generated -->`,
      )
    }
  }
  // P4.6 第 1 轮：已发布试卷改走 /api/v1/paper-releases 细粒度 API，
  // 适配器必须先于 59-repository（其同步目录接口读它的内存缓存）注入。
  if (['practice-mode.html', 'question-workspace.html', 'knowledge-recall.html', 'index.html'].includes(page)
    && !generated.includes('kg-paper-releases:generated')) {
    const repositoryTag = findLocalScriptTag(generated, 'src/59-published-paper-repository.js')
      || findLocalScriptTag(generated, 'src/60-question-bank.js')
    if (!repositoryTag) {
      throw new Error(`new-legacy ${page} 发布试卷脚本顺序已变化，请复核发布试卷适配器`)
    }
    generated = generated.replace(
      repositoryTag,
      `<script defer src="./paper-release-adapter.js"></script><!-- kg-paper-releases:generated -->\n${repositoryTag}`,
    )
  }
  if (page === 'question-workspace.html'
    && (!generated.includes('kg-practice-learning:generated') || !generated.includes('kg-personal-cards:generated'))) {
    const workspaceTag = '<script defer src="src/77-multi-question-workspace.js"></script>'
    if (!generated.includes(workspaceTag)) {
      throw new Error('new-legacy 多题归纳脚本顺序已变化，请复核学习资产适配器')
    }
    const adapters = [
      !generated.includes('kg-practice-learning:generated')
        ? '<script defer src="./practice-learning-adapter.js"></script><!-- kg-practice-learning:generated -->'
        : '',
      !generated.includes('kg-personal-cards:generated')
        ? '<script defer src="./personal-card-adapter.js"></script><!-- kg-personal-cards:generated -->'
        : '',
    ].filter(Boolean).join('\n')
    generated = generated.replace(workspaceTag, `${adapters}\n${workspaceTag}`)
  }
  if (page === 'knowledge-recall.html' && !generated.includes('kg-recall-progress:generated')) {
    const recallTag = '<script defer src="src/86-knowledge-recall.js"></script>'
    if (generated.includes(recallTag)) {
      generated = generated.replace(
        recallTag,
        `<script defer src="./recall-progress-adapter.js"></script><!-- kg-recall-progress:generated -->\n${recallTag}`,
      )
    }
  }
  if (page === 'question-bank.html') {
    const adminTag = findLocalScriptTag(generated, 'src/65-question-bank-admin.js')
    if (!adminTag) {
      throw new Error('new-legacy 题库管理脚本顺序已变化，请复核试卷引用 API')
    }
    const draftAdapterAsset = 'paper-draft-adapter.js'
    generated = removeLocalScriptTags(generated, draftAdapterAsset)
    generated = generated.replace(
      adminTag,
      `<script defer src="./${draftAdapterAsset}"></script><!-- kg-paper-drafts:generated -->\n${adminTag}`,
    )
  }
  if (page === 'paper-management.html') {
    const adminTag = findLocalScriptTag(generated, 'src/65-question-bank-admin.js')
    if (!adminTag) {
      throw new Error('new-legacy 试卷管理脚本顺序已变化，请复核配额服务')
    }
    const draftAdapterAsset = 'paper-draft-adapter.js'
    generated = removeLocalScriptTags(generated, draftAdapterAsset)
    const dataLoaderAsset = 'paper-management-data-loader.js'
    generated = removeLocalScriptTags(generated, dataLoaderAsset)
    const quotaAsset = 'src/teacher/paper-management/paper-quota-service.js'
    const quotaTag = `<script defer src="${quotaAsset}"></script>`
    generated = removeLocalScriptTags(generated, quotaAsset)
    generated = generated.replace(
      adminTag,
      `<script defer src="./paper-release-adapter.js"></script><!-- kg-paper-releases:generated -->\n<script defer src="./${draftAdapterAsset}"></script><!-- kg-paper-drafts:generated -->\n${quotaTag}\n<script defer src="./${dataLoaderAsset}"></script><!-- kg-paper-management-loader:generated -->\n${adminTag}`,
    )
  }
  if (page === 'question-training.html' && !retiredSingleDeepRedirectShell && !generated.includes('kg-runtime-fixes:generated')) {
    const styleTag = '<link rel="stylesheet" href="./direct-runtime-fixes.css"><!-- kg-runtime-fixes:generated -->'
    generated = generated.includes('</head>')
      ? generated.replace('</head>', `${styleTag}\n</head>`)
      : `${styleTag}\n${generated}`
  }
  if (page === 'user-management.html') {
    const serviceTag = '<script defer src="src/35-user-management-service.js"></script>'
    if (!generated.includes(serviceTag)) {
      throw new Error('new-legacy 用户管理脚本顺序已变化，请复核直接后端适配器')
    }
    generated = generated.replace(
      serviceTag,
      `${serviceTag}\n<script defer src="./direct-admin-adapter.js"></script><!-- kg-admin:generated -->`,
    )
  }
  if (page === 'index.html') {
    const autosaveTag = '<script defer src="src/24-graph-file-autosave.js"></script>'
    if (!generated.includes(autosaveTag)) {
      throw new Error('new-legacy 图谱自动保存脚本顺序已变化，请复核直接图谱适配器')
    }
    generated = generated.replace(
      autosaveTag,
      `${autosaveTag}\n<script defer src="./direct-graph-adapter.js"></script><!-- kg-graph:generated -->`,
    )
    // 支付适配器（direct-system-adapter）统一由下方 33-user-center 通用规则注入并保证
    // 位于 37-subscription-core 之后；此处不再按 32-wechat-login 位置单独注入。
  }
  {
    // 会员权益弹窗（33-user-center）可能在任何页面打开；支付与服务端套餐价依赖
    // direct-system-adapter。适配器执行时必须已存在 KGSubscription（37-subscription-core）、
    // KGRolePermissions（34-role-permissions）、KGWechatLogin（32-wechat-login），否则开头
    // 直接 return，不预载服务端套餐价——弹窗价格就会回落到前端写死的默认值
    // （月 ¥29 / 季 ¥79 / 半年 ¥139 / 终身 ¥399），与后台配置价不一致。
    // 因此：先剥离历史注入（含错误位置，如曾注入在 32-wechat-login 之后、34/37 之前的
    // practice-mode），再统一注入到 33-user-center 之前，并断言顺序防回退。
    let userCenterTag = findLocalScriptTag(generated, 'src/33-user-center.js')
    if (!userCenterTag) {
      // 兼容 </script> 另起一行的写法（如 message-management.html）：只匹配开始标签。
      userCenterTag = generated.match(/<script\b[^>]*\bsrc=(['"])(?:\.\/)?src\/33-user-center\.js(?:\?[^'"]*)?\1[^>]*>/i)?.[0] || ''
    }
    if (userCenterTag) {
      generated = removeLocalScriptTags(generated, 'direct-system-adapter.js')
      generated = generated.replace(/^[ \t]*<!--\s*kg-system:generated\s*-->[ \t]*(?:\r?\n)?/gim, '')
      const adapterTag = '<script defer src="./direct-system-adapter.js"></script>'
      generated = generated.replace(
        userCenterTag,
        `${adapterTag}<!-- kg-system:generated -->\n${userCenterTag}`,
      )
      const subscriptionCoreTag = findLocalScriptTag(generated, 'src/37-subscription-core.js')
      if (subscriptionCoreTag) {
        const adapterIndex = generated.indexOf(adapterTag)
        const coreIndex = generated.indexOf(subscriptionCoreTag)
        if (adapterIndex < 0 || coreIndex < 0 || adapterIndex < coreIndex) {
          throw new Error(`new-legacy ${page} 支付适配器必须位于 37-subscription-core.js 之后，请复核会员价格加载顺序`)
        }
      }
    }
  }
  if (page === 'question-bank.html') {
    const editorTag = findLocalScriptTag(generated, 'src/65-question-bank-admin.js')
    if (!editorTag) {
      throw new Error('new-legacy 题库脚本顺序已变化，请复核题目校验适配器')
    }
    if (!generated.includes('kg-question-editor:generated')) {
      throw new Error('new-legacy 题目编辑锁适配器未在管理脚本前加载')
    }
  }
  if (page === 'system-settings.html') {
    const settingsTag = '<script defer src="src/36-system-settings.js"></script>'
    if (!generated.includes(settingsTag)) {
      throw new Error('new-legacy 系统设置脚本顺序已变化，请复核归一化设置适配器')
    }
    // 适配器统一由上方 33-user-center 通用规则注入（保证先于 33-user-center），
    // 此处仅兜底：极旧源若没有 33-user-center，仍需在系统设置前注入。
    if (!generated.includes('direct-system-adapter.js')) {
      generated = generated.replace(
        settingsTag,
        `<script defer src="./direct-system-adapter.js"></script><!-- kg-system:generated -->\n${settingsTag}`,
      )
    }
  }
  // 会员中心弹窗(33-user-center)读 KGSubscriptionRemotePlanSettings 展示套餐价格；
  // 凡是同时加载订阅运行时与会员中心的页面都注入 system adapter，让价格与支付始终来自后端接口，
  // 否则学员页(如 practice-mode)会回落到源码默认价，与后台配置脱节。
  if (generated.includes('src/37-subscription-core.js')
    && generated.includes('src/33-user-center.js')
    && !generated.includes('kg-system:generated')) {
    const userCenterTag = findLocalScriptTag(generated, 'src/33-user-center.js')
    if (!userCenterTag) {
      throw new Error('new-legacy 会员中心脚本顺序已变化，请复核系统适配器注入')
    }
    generated = generated.replace(
      userCenterTag,
      `<script defer src="./direct-system-adapter.js"></script><!-- kg-system:generated -->\n${userCenterTag}`,
    )
  }
  const authTag = page === 'index.html'
    ? '<script defer src="src/30-auth-guards.js"></script>'
    : page === 'question-training.html' && !retiredSingleDeepRedirectShell
      ? '<script defer src="src/72-question-training-page.js"></script>'
      : ''
  if (authTag) {
    if (!generated.includes(authTag)) {
      throw new Error(`new-legacy ${page} 认证脚本顺序已变化，请复核直接后端适配器`)
    }
    generated = generated.replace(
      authTag,
      `${authTag}\n<script defer src="./direct-auth-adapter.js"></script><!-- kg-auth:generated -->`,
    )
  }
  if (learningModeConsumer) {
    generated = generated.replace(
      /^[ \t]*<script\b[^>]*\bsrc=(['"])(?:\.\/)?src\/59(?:a-paper-learning-modes|c-active-learning-mode-policy)\.js(?:\?[^'"]*)?\1[^>]*><\/script>[ \t]*(?:<!--\s*kg-learning-mode-policy:generated\s*-->[ \t]*)?(?:\r?\n)?/gim,
      '',
    )
    generated = generated.replace(
      /<script\b[^>]*\bsrc=(['"])(?:\.\/)?src\/59(?:a-paper-learning-modes|c-active-learning-mode-policy)\.js(?:\?[^'"]*)?\1[^>]*><\/script>[ \t]*(?:<!--\s*kg-learning-mode-policy:generated\s*-->[ \t]*)?/gi,
      '',
    )
    const consumerTag = findLocalScriptTag(generated, learningModeConsumer)
    const consumerIndex = generated.indexOf(consumerTag)
    if (!consumerTag || consumerIndex < 0) {
      throw new Error(`new-legacy ${page} 学习模式脚本顺序已变化，请复核已停用模式边界`)
    }
    const lineStart = generated.lastIndexOf('\n', consumerIndex - 1) + 1
    const prefix = generated.slice(lineStart, consumerIndex)
    const indent = /^[ \t]*$/.test(prefix) ? prefix : ''
    const separator = prefix && !indent ? '\n' : ''
    const policyTag = '<script src="src/59c-active-learning-mode-policy.js"></script><!-- kg-learning-mode-policy:generated -->'
    generated = `${generated.slice(0, consumerIndex)}${separator}${policyTag}\n${indent}${generated.slice(consumerIndex)}`
  }
  return versionPageAssets(versionPageRelease(generated, version), version)
}

function diffFiles(previous = {}, next = {}) {
  const added = Object.keys(next).filter((path) => !(path in previous)).sort()
  const removed = Object.keys(previous).filter((path) => !(path in next)).sort()
  const changed = Object.keys(next).filter((path) => path in previous && previous[path] !== next[path]).sort()
  return { added, changed, removed }
}

function p45MigrationManifest(source) {
  const manifestPath = resolve(source, 'p45-migration-manifest.json')
  if (!existsSync(manifestPath)) throw new Error('P4.5 migration manifest is required')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    throw new Error('P4.5 migration manifest is invalid')
  }
  const declaredDebtModules = manifest?.legacyUnmigratedIndexedDbModules
  const expectedDebtModules = new Set(legacyUnmigratedIndexedDbModules)
  if (
    !manifest
    || typeof manifest !== 'object'
    || Array.isArray(manifest)
    || Object.keys(manifest).length !== 1
    || Object.keys(manifest)[0] !== 'legacyUnmigratedIndexedDbModules'
    || !Array.isArray(declaredDebtModules)
    || declaredDebtModules.some((path) => typeof path !== 'string')
    || declaredDebtModules.length !== expectedDebtModules.size
    || new Set(declaredDebtModules).size !== declaredDebtModules.length
    || declaredDebtModules.some((path) => !expectedDebtModules.has(path))
  ) {
    throw new Error('P4.5 migration manifest is invalid')
  }
  return {
    legacyUnmigratedIndexedDbModules: expectedDebtModules,
  }
}

function hasIndexedDbBusinessPersistence(source) {
  const propertyAccess = (names) => String.raw`(?:\?\.\s*(?:${names})\b|\.\s*(?:${names})\b|\?\.\s*\[\s*['"](?:${names})['"]\s*\]|\[\s*['"](?:${names})['"]\s*\])`
  const open = propertyAccess('open')
  const transaction = propertyAccess('transaction')
  const objectStore = propertyAccess('objectStore')
  const mutation = propertyAccess('add|put|delete|clear')
  if (new RegExp(String.raw`\bindexedDB\s*${open}\s*\(`).test(source)) return true
  if (new RegExp(String.raw`${transaction}\s*\([^)]*\)\s*${objectStore}\s*\([^)]*\)\s*${mutation}\s*\(`).test(source)) return true

  const transactions = new Set()
  const transactionPattern = new RegExp(String.raw`\b(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\s*${transaction}\s*\(`, 'g')
  for (const match of source.matchAll(transactionPattern)) {
    transactions.add(match[1])
  }
  const objectStores = new Set()
  const objectStorePattern = new RegExp(String.raw`\b(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*${objectStore}\s*\(`, 'g')
  for (const match of source.matchAll(objectStorePattern)) {
    if (transactions.has(match[2])) objectStores.add(match[1])
  }
  if (!objectStores.size) return false
  return new RegExp(String.raw`\b(?:${Array.from(objectStores).join('|')})\s*${mutation}\s*\(`).test(source)
}

function validateStorageContract(source) {
  const p45Migration = p45MigrationManifest(source)
  const storage = contract.runtimeStorage || {}
  const p45Runtime = p45PersistenceContract.runtime || {}
  const exact = new Set([
    ...(storage.exactKeys || []),
    ...(p45Runtime.exactKeys || []),
    ...learningEntryChooserStorageKeys,
  ])
  const prefixes = [...(storage.prefixes || []), ...(p45Runtime.prefixes || [])]
  const sessionOnlyPrefixes = p45PersistenceContract.sessionOnlyPrefixes || []
  const legacyReadOnly = storage.legacyReadOnlyKeys || {}
  const readOnlyExact = new Set(legacyReadOnly.exactKeys || [])
  const readOnlyPrefixes = legacyReadOnly.prefixes || []
  const ignored = new Set(storage.ignoredLiterals || [])
  const candidates = new Set()
  const sessionOnlyKeys = new Set()
  const readOnlyWrites = new Set()
  const devicePreferenceSource = 'src/28-device-preferences.js'
  const literalPattern = /(['"])(kg_[A-Za-z0-9_]+|pmp_question_font_size_v\d+|通用知识点关系图谱工具_[^'"\\\r\n]+)\1/g
  const writePattern = /(?:localStorage|sessionStorage)\s*(?:\?\.|\.)\s*(?:setItem|removeItem)\s*\(\s*(['"])(kg_[A-Za-z0-9_]+)\1/g
  const sessionTokenPattern = /sessionStorage\s*(?:\?\.|\.)\s*(?:getItem|setItem|removeItem)\s*\(\s*(['"])(kg_[A-Za-z0-9_]+)\1/g
  const devicePreferenceStorageCall = /(?:(?:global|window)\s*(?:\?\.\s*|\.\s*))?(?:localStorage|sessionStorage)\s*(?:\?\.\s*|\.\s*)(?:getItem|setItem|removeItem)\s*(?:\?\.\s*)?\(\s*(assertAllowed\s*\(\s*key\s*\)|[^,\n)]+)/g
  const productionSources = walk(source).filter((item) => {
    const normalized = item.split(sep).join('/')
    return !normalized.startsWith('tests/') && (item.endsWith('.js') || item.endsWith('.html'))
  })
  for (const path of productionSources) {
    const contents = readFileSync(resolve(source, path), 'utf8')
    // This facade owns its own immutable device-only allowlist. Its key declarations
    // are not business-storage candidates; all other sources remain fail-closed.
    if (path === devicePreferenceSource) {
      for (const match of contents.matchAll(devicePreferenceStorageCall)) {
        if (/^assertAllowed\s*\(\s*key\s*\)$/.test(match[1])) continue
        throw new Error('device preference storage call must use assertAllowed(key)')
      }
      continue
    }
    for (const match of contents.matchAll(literalPattern)) candidates.add(match[2])
    for (const match of contents.matchAll(sessionTokenPattern)) {
      if (sessionOnlyPrefixes.some((prefix) => match[2].startsWith(prefix))) sessionOnlyKeys.add(match[2])
    }
    for (const match of contents.matchAll(writePattern)) {
      const key = match[2]
      if (readOnlyExact.has(key) || readOnlyPrefixes.some((prefix) => key.startsWith(prefix))) {
        readOnlyWrites.add(`${path}:${key}`)
      }
    }
  }
  const unknown = Array.from(candidates)
    .filter((key) => (
      !ignored.has(key)
      && !exact.has(key)
      && !readOnlyExact.has(key)
      && !prefixes.some((prefix) => key.startsWith(prefix))
      && !readOnlyPrefixes.some((prefix) => key.startsWith(prefix))
      && !sessionOnlyKeys.has(key)
    ))
    .sort()
  if (unknown.length) {
    throw new Error(`P4.5 persistent state is not registered: ${unknown.join(', ')}`)
  }
  if (readOnlyWrites.size) {
    throw new Error(`new-legacy 只读旧键禁止新增写调用：${Array.from(readOnlyWrites).sort().join(', ')}`)
  }

  for (const path of productionSources) {
    const contents = readFileSync(resolve(source, path), 'utf8')
    if (!hasIndexedDbBusinessPersistence(contents)) continue
    /* walk() 在 Windows 返回反斜杠路径，豁免清单统一为正斜杠，比较前先归一 */
    const normalizedPath = path.split(sep).join('/')
    if (p45Migration.legacyUnmigratedIndexedDbModules.has(normalizedPath)) continue
    throw new Error(`IndexedDB business persistence is forbidden in migrated module: ${normalizedPath}`)
  }
}

function validate(source) {
  if (!existsSync(source) || !statSync(source).isDirectory()) throw new Error(`找不到 new-legacy 目录：${source}`)
  const required = ['VERSION', ...contract.requiredPages, ...contract.requiredFiles, ...learningEntryChooserAssets, 'src/28-device-preferences.js']
  const missing = required.filter((path) => !existsSync(resolve(source, path)))
  if (missing.length) throw new Error(`new-legacy 缺少必需文件：${missing.join(', ')}`)
  const missingGenerated = [...(contract.requiredGeneratedFiles || []), 'domain-api-client.js', 'teaching-content-adapter.js', 'course-management-adapter.js', 'admin-domain-summary.js']
    .filter((path) => !existsSync(resolve(scriptsDir, 'new-legacy-assets', path)))
  if (missingGenerated.length) {
    throw new Error(`new-legacy 缺少必需生成适配器：${missingGenerated.join(', ')}`)
  }
  const version = readFileSync(resolve(source, 'VERSION'), 'utf8').trim()
  if (!version) throw new Error('new-legacy/VERSION 不能为空')
  validateStorageContract(source)
  return version
}

function extractWechatLoginCss(source) {
  // 提取 new-legacy main.css 的微信登录弹窗样式段（.wechat-login-section 起，到
  // #authModal.wechat-login-mode 规则止），用于追加到 v9 site 的 main.css。
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.includes('.wechat-login-section'))
  if (start < 0) return ''
  let end = start
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index].includes('#authModal.wechat-login-mode')) { end = index; break }
  }
  return lines.slice(start, end + 1).join('\n')
}

function sync({ source, out }) {
  const version = validate(source)
  const hashes = sourceFiles(source)
  const defaultOut = resolve(frontendDir, 'public', 'new-legacy')
  const rootManifestPath = resolve(frontendDir, 'new-legacy-manifest.json')
  const previous = existsSync(rootManifestPath)
    ? JSON.parse(readFileSync(rootManifestPath, 'utf8'))
    : null

  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  cpSync(source, out, { recursive: true })

  const bridgeDir = resolve(scriptsDir, 'new-legacy-assets')
  for (const asset of walk(bridgeDir)) cpSync(resolve(bridgeDir, asset), resolve(out, asset))
  for (const path of walk(resolve(out, 'src')).filter((item) => item.endsWith('.js'))) {
    const target = resolve(out, 'src', path)
    let generated = patchArchitectureCopy(`src/${path}`, readFileSync(target, 'utf8'))
    if (path === '10-graph-editor.js') generated = patchGraphInteractions(generated)
    if (path === '65-question-bank-admin.js') {
      generated = patchAddQuestionTab(generated)
    }
    if (path === '64-flow-orchestrator.js') generated = patchTrainingSessionReentrancy(generated)
    if (path === '36-system-settings.js') generated = patchSystemSettingsAnalyticsJs(generated)
    generated = patchFeatureAnalytics(path, generated)
    writeFileSync(target, generated)
  }

  // 定制层：用户在 new-legacy 上的"服务端化"定制，叠加到 sync 产物。
  // 仅当（① 源是真实发布——含 styles/main.css；② 定制权威 new-legacy 可达）时应用。
  // 测试桩 fixture 无 styles；release 元测试把 scripts 复制到 harness（repoDir 指向 harness，
  // 无 new-legacy）——两者都跳过定制，避免 ENOENT。
  const customSource = resolve(repoDir, 'new-legacy')
  if (existsSync(resolve(source, 'styles/main.css')) && existsSync(customSource)) {
    // Phase 1（fe546e2 微信登录服务端 OAuth）：new-legacy 版覆盖 v9 上游纯前端版。
    cpSync(resolve(customSource, 'src/32-wechat-login.js'), resolve(out, 'src/32-wechat-login.js'))
    const wechatCss = extractWechatLoginCss(readFileSync(resolve(customSource, 'styles/main.css'), 'utf8'))
    if (wechatCss) {
      const mainCssPath = resolve(out, 'styles/main.css')
      writeFileSync(mainCssPath, `${readFileSync(mainCssPath, 'utf8')}\n/* kg:wechat-login-custom */\n${wechatCss}\n`)
    }
    // Phase 2.1（1305e16 admin 功能偏好分析面板）：注入侧栏 6 列 + 追加 analytics 样式块。
    const ssAnalyticsCssPath = resolve(out, 'styles/system-settings.css')
    if (existsSync(ssAnalyticsCssPath)) {
      writeFileSync(ssAnalyticsCssPath, patchSystemSettingsAnalyticsCss(readFileSync(ssAnalyticsCssPath, 'utf8')))
    }
    // Phase 3.1（fe45237 会员中心 UI）：membership-ui.css + icons 目录（v9 上游无）。
    cpSync(resolve(customSource, 'styles/membership-ui.css'), resolve(out, 'styles/membership-ui.css'))
    cpSync(resolve(customSource, 'assets/membership-ui'), resolve(out, 'assets/membership-ui'), { recursive: true })
    // Phase 3.2（fe45237 + fe546e2 用户中心 / 会员中心 / 微信绑定）：整文件覆盖。
    // 核查结论——v9 的 33-user-center.js 无专属功能（独有行全是旧 .kg-* 会员设计，已被
    // new-legacy 的 .uc-* / .membership-ui 升级取代）；new-legacy 版自包含 KGWechatPay +
    // renderWechatBox，依赖 KGWechatLogin(P1 已 cp)/KGSubscription/后端 wechat-pay 均就绪。
    // user-center.css 同理：v9 仅 2 行旧值被 new-legacy 改进取代，整 cp 安全。故无需逐函数合并。
    cpSync(resolve(customSource, 'src/33-user-center.js'), resolve(out, 'src/33-user-center.js'))
    cpSync(resolve(customSource, 'styles/user-center.css'), resolve(out, 'styles/user-center.css'))
  }

  const contentPrepPath = resolve(out, 'content-prep-studio/dist/content-prep.html')
  if (existsSync(contentPrepPath)) {
    const contentPrepHtml = readFileSync(contentPrepPath, 'utf8')
    const runtimeMarker = '<script src="/server-state-bootstrap.js"></script>'
    if (!contentPrepHtml.includes('kg-direct-bootstrap-anchor') && contentPrepHtml.includes(runtimeMarker)) {
      writeFileSync(
        contentPrepPath,
        contentPrepHtml.replace(runtimeMarker, `<!-- kg-direct-bootstrap-anchor -->\n${runtimeMarker}`),
      )
    }
  }

  for (const page of walk(out).filter((path) => !path.includes('/') && path.endsWith('.html'))) {
    const path = resolve(out, page)
    let pageHtml = patchArchitectureCopy(page, readFileSync(path, 'utf8'))
    if (page === 'system-settings.html') pageHtml = patchSystemSettingsAnalyticsHtml(pageHtml)
    if (existsSync(resolve(out, 'styles/membership-ui.css'))) pageHtml = patchMembershipUiLink(pageHtml)
    writeFileSync(path, injectPage(pageHtml, page, version))
  }

  if (existsSync(resolve(source, 'styles/main.css'))) {
    buildHomepageBundles({ outputRoot: out, version, plan: homepageBundlePlan })
  }

  const indexPath = resolve(out, 'index.html')
  writeFileSync(resolve(out, 'workbench.html'), readFileSync(indexPath, 'utf8'))

  const manifest = {
    schemaVersion: 1,
    version,
    bridgeVersion: 2,
    sourceFiles: hashes,
  }
  writeFileSync(resolve(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  if (out === defaultOut) {
    const changes = diffFiles(previous?.sourceFiles, hashes)
    const report = {
      schemaVersion: 1,
      fromVersion: previous?.version || null,
      toVersion: version,
      changes,
      incompatible: [],
    }
    writeFileSync(rootManifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    writeFileSync(resolve(frontendDir, 'new-legacy-sync-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  }
  return manifest
}

try {
  const args = parseArgs(process.argv.slice(2))
  const manifest = sync(args)
  process.stdout.write(`[sync:new-legacy] ${manifest.version} -> ${args.out}\n`)
} catch (error) {
  process.stderr.write(`[sync:new-legacy] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
