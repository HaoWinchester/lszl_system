import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const frontendDir = resolve(scriptsDir, '..')
const repoDir = resolve(frontendDir, '..')
const contract = JSON.parse(readFileSync(resolve(scriptsDir, 'new-legacy-contract.json'), 'utf8'))

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

function patchFileManagerNavigation(source) {
  let generated = replaceExactlyOnce(
    source,
    "  function selectFolder(id,options){selectItem('folder',id,options)}\n  function openFolder(id)",
    "  function selectFolder(id,options){selectItem('folder',id,options)}\n  async function flushServerStateBeforeNavigation(){\n    if(global.KGServerStateStorage&&typeof global.KGServerStateStorage.flush==='function')await global.KGServerStateStorage.flush();\n  }\n  function openFolder(id)",
    'new-legacy 文件管理保存屏障',
  )
  generated = replaceExactlyOnce(
    generated,
    '  function openFile(id){',
    '  async function openFile(id){',
    'new-legacy 文件打开异步入口',
  )
  generated = replaceExactlyOnce(
    generated,
    "    state.navigating=true;location.href='index.html';",
    "    state.navigating=true;\n    try{await flushServerStateBeforeNavigation();location.href='index.html?mode=free'}catch(err){state.navigating=false;toast(err&&err.message||'服务器保存失败，请稍后重试。','error')}",
    'new-legacy 文件打开跳转',
  )
  generated = replaceExactlyOnce(
    generated,
    "submitLabel:'创建并打开',onSubmit:value=>{",
    "submitLabel:'创建并打开',onSubmit:async value=>{",
    'new-legacy 创建并打开异步入口',
  )
  generated = replaceExactlyOnce(
    generated,
    "      if(!file)throw new Error(store.getLastError&&store.getLastError()||'新建图谱失败。');\n      location.href='index.html';",
    "      if(!file)throw new Error(store.getLastError&&store.getLastError()||'新建图谱失败。');\n      await flushServerStateBeforeNavigation();\n      location.href='index.html?mode=free';",
    'new-legacy 创建文件跳转',
  )
  return generated
}

function patchGraphInteractions(source) {
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

function patchQuestionRecallPreview(source) {
  if (!source.includes('function previewDeepRecall()')) return source
  // 兼容两个基线：
  //  - v9：previewDeepRecall 已自带 `const bank = currentBank()`，window.open 带 `bankId=`。
  //  - v8.6：用 `questionId=` 且无 bank 传递（需补 bank）。
  // 两版都要在打开深度回忆页前先 flush 到服务器，避免 120ms 防抖让新窗口读不到刚写入的题。
  const isV9 = source.includes('knowledge-recall.html?bankId=')
  let generated = isV9
    ? replaceExactlyOnce(
      source,
      '  function previewDeepRecall(){',
      '  async function previewDeepRecall(){',
      'new-legacy 深度回忆异步入口',
    )
    : replaceExactlyOnce(
      source,
      "  function previewDeepRecall(){\n    if(!saveQuestionForm({silent:true})) return;\n    const q = currentQuestion();",
      "  async function previewDeepRecall(){\n    if(!saveQuestionForm({silent:true})) return;\n    const bank = currentBank();\n    const q = currentQuestion();",
      'new-legacy 深度回忆当前题传递',
    )
  const openBefore = isV9
    ? "    }catch(e){}\n    window.open('knowledge-recall.html?bankId=' + encodeURIComponent(bank.id||'') + '&questionId=' + encodeURIComponent(q.id || 'current'), '_blank');"
    : "    }catch(e){}\n    window.open('knowledge-recall.html?questionId=' + encodeURIComponent(q.id || 'current'), '_blank');"
  const openAfter = openBefore.replace('    }catch(e){}\n    ', [
    '    }catch(e){}',
    '    try{',
    "      if(window.KGServerStateStorage&&typeof window.KGServerStateStorage.flush==='function')await window.KGServerStateStorage.flush();",
    '    }catch(error){',
    "      toast(error&&error.message||'服务器保存失败，请稍后重试。');",
    '      return;',
    '    }',
    '    ',
  ].join('\n'))
  generated = replaceExactlyOnce(generated, openBefore, openAfter, 'new-legacy 深度回忆打开前保存')
  return generated
}

function patchAddQuestionTab(source) {
  // v9 改了 render（qb-base-panel 只在 activeLayoutNav='base' 展开），但 addQuestion 仍设
  // 'questions'（v8.6 遗留值）→ 新建题目后编辑表单 display:none 不显示。仅 v9 修；
  // v8.6.29 的 render 兼容 'questions'，不动。
  if (!source.includes('knowledge-recall.html?bankId=')) return source
  return replaceExactlyOnce(
    source,
    "    state.activeSidebarTab = 'questions';\n    state.activeLayoutNav = 'questions';\n    bank.updatedAt = Date.now();\n    saveBanks();\n    render();\n  }",
    "    state.activeSidebarTab = 'questions';\n    state.activeMainTab = 'base';\n    state.activeLayoutNav = 'base';\n    bank.updatedAt = Date.now();\n    saveBanks();\n    render();\n  }",
    'new-legacy 新建题目激活编辑视图',
  )
}

function versionPageStyles(html, version) {
  const query = `?v=${encodeURIComponent(version)}`
  return html.replace(
    /(\bhref=(['"]))((?!https?:|\/\/|data:|#)[^'"?#]+\.css)\2/gi,
    (_, prefix, quote, asset) => `${prefix}${asset}${query}${quote}`,
  )
}

function injectPage(html, page, version) {
  const injection = [
    '<script src="./server-state-bootstrap.js"></script><!-- kg-state:generated -->',
    '<script src="./runtime-config.override.js"></script><!-- kg-runtime:generated -->',
    '<script defer src="./direct-entry.js"></script><!-- kg-direct-entry:generated -->',
    '<script defer src="./feature-analytics.js"></script><!-- kg-feature-analytics:generated -->',
  ].join('\n')
  let generated = html.includes('kg-runtime:generated')
    ? html
    : /<head(?:\s[^>]*)?>/i.test(html)
      ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}\n${injection}`)
      : `${injection}\n${html}`
  if (page === 'question-training.html' && !generated.includes('kg-runtime-fixes:generated')) {
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
    const wechatLoginTag = '<script defer src="src/32-wechat-login.js"></script>'
    // 较早的发布包没有订阅模块；只在提供微信登录与订阅运行时的首页注入支付适配器。
    if (generated.includes(wechatLoginTag)) {
      generated = generated.replace(
        wechatLoginTag,
        `${wechatLoginTag}\n<script defer src="./direct-system-adapter.js"></script><!-- kg-system:generated -->`,
      )
    }
  }
  if (page === 'question-bank.html') {
    const editorTag = '<script defer src="src/65-question-bank-admin.js"></script>'
    if (!generated.includes(editorTag)) {
      throw new Error('new-legacy 题库脚本顺序已变化，请复核题目校验适配器')
    }
    generated = generated.replace(
      editorTag,
      `${editorTag}\n<script defer src="./direct-question-adapter.js"></script><!-- kg-question:generated -->`,
    )
  }
  if (page === 'system-settings.html') {
    const settingsTag = '<script defer src="src/36-system-settings.js"></script>'
    if (!generated.includes(settingsTag)) {
      throw new Error('new-legacy 系统设置脚本顺序已变化，请复核归一化设置适配器')
    }
    generated = generated.replace(
      settingsTag,
      `<script defer src="./direct-system-adapter.js"></script><!-- kg-system:generated -->\n${settingsTag}`,
    )
  }
  const authTag = page === 'index.html'
    ? '<script defer src="src/30-auth-guards.js"></script>'
    : page === 'question-training.html'
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
  return versionPageStyles(generated, version)
}

function diffFiles(previous = {}, next = {}) {
  const added = Object.keys(next).filter((path) => !(path in previous)).sort()
  const removed = Object.keys(previous).filter((path) => !(path in next)).sort()
  const changed = Object.keys(next).filter((path) => path in previous && previous[path] !== next[path]).sort()
  return { added, changed, removed }
}

function validateStorageContract(source) {
  const storage = contract.runtimeStorage || {}
  const exact = new Set(storage.exactKeys || [])
  const prefixes = storage.prefixes || []
  const ignored = new Set(storage.ignoredLiterals || [])
  const candidates = new Set()
  const literalPattern = /(['"])(kg_[A-Za-z0-9_]+|pmp_question_font_size_v\d+|通用知识点关系图谱工具_[^'"\\\r\n]+)\1/g
  for (const path of walk(source).filter((item) => item.endsWith('.js') || item.endsWith('.html'))) {
    const contents = readFileSync(resolve(source, path), 'utf8')
    for (const match of contents.matchAll(literalPattern)) candidates.add(match[2])
  }
  const unknown = Array.from(candidates)
    .filter((key) => !ignored.has(key) && !exact.has(key) && !prefixes.some((prefix) => key.startsWith(prefix)))
    .sort()
  if (unknown.length) {
    throw new Error(`new-legacy 出现未登记的业务存储键：${unknown.join(', ')}`)
  }
}

function validate(source) {
  if (!existsSync(source) || !statSync(source).isDirectory()) throw new Error(`找不到 new-legacy 目录：${source}`)
  const required = ['VERSION', ...contract.requiredPages, ...contract.requiredFiles]
  const missing = required.filter((path) => !existsSync(resolve(source, path)))
  if (missing.length) throw new Error(`new-legacy 缺少必需文件：${missing.join(', ')}`)
  const version = readFileSync(resolve(source, 'VERSION'), 'utf8').trim()
  if (!version) throw new Error('new-legacy/VERSION 不能为空')
  validateStorageContract(source)
  return version
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
      generated = patchQuestionRecallPreview(generated)
      generated = patchAddQuestionTab(generated)
    }
    if (path === '64-flow-orchestrator.js') generated = patchTrainingSessionReentrancy(generated)
    if (path === '27-graph-file-manager.js') generated = patchFileManagerNavigation(generated)
    writeFileSync(target, generated)
  }

  for (const page of walk(out).filter((path) => !path.includes('/') && path.endsWith('.html'))) {
    const path = resolve(out, page)
    writeFileSync(path, injectPage(patchArchitectureCopy(page, readFileSync(path, 'utf8')), page, version))
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
