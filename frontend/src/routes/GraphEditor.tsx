import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent, type MouseEvent as RMouseEvent } from 'react'
import { Link } from 'react-router-dom'

import { filesApi, type FileMeta } from '../api/files'
import { useAuth } from '../store/auth'

const LEVELS = ['基础', '中等', '重点', '难点', '易错点']
const IMPORTANT = new Set(['重点', '难点', '易错点'])
const TEMPLATES: [string, string, string][] = [
  ['blank', '空白图谱', '从零开始，让学员自行添加知识点和关系。'],
  ['pmp', 'PMP 示例', '内置项目管理常见知识点。'],
  ['p2', 'P2 / PRINCE2 示例', '原则、主题、流程等基础节点。'],
  ['acp', 'ACP 示例', '敏捷心态、领导力、产品、交付。'],
  ['cspm', 'CSPM 示例', '能力评价、复杂项目、组织级能力。'],
  ['npdp', 'NPDP 示例', '产品创新战略、组合、流程、市场研究。'],
]
const LINK_TYPES = ['关联', '前置', '包含', '属于', '对比', '易混淆', '因果', '应用', '例题支撑']

interface GraphNode {
  id: string
  title: string
  x: number
  y: number
  color: string
  category?: string
  level?: string
  keywords?: string
  summary?: string
  notes?: string
  size?: string
}
interface GraphLink {
  id: string
  from: string
  to: string
  type?: string
  note?: string
  lineStyle?: string
  color?: string
}
interface GraphData {
  meta: { title: string; subject?: string; audience?: string; description?: string }
  viewport: { x: number; y: number; scale: number }
  defaults: Record<string, unknown>
  nodes: GraphNode[]
  links: GraphLink[]
  [k: string]: unknown
}

function blankGraph(title: string): GraphData {
  return {
    meta: { title, subject: '通用课程', audience: '', description: '' },
    viewport: { x: 260, y: 170, scale: 1 },
    defaults: { nodeColor: '#64748b', linkColor: '#2563eb', linkStyle: 'solid', linkPathStyle: 'curve' },
    nodes: [],
    links: [],
  }
}
function uid(p: string) {
  return p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}
function tint(hex: string, f: number) {
  const h = hex.replace('#', '')
  if (h.length !== 6) return hex
  const r = Math.round(parseInt(h.slice(0, 2), 16) * f + 255 * (1 - f))
  const g = Math.round(parseInt(h.slice(2, 4), 16) * f + 255 * (1 - f))
  const b = Math.round(parseInt(h.slice(4, 6), 16) * f + 255 * (1 - f))
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export default function GraphEditor() {
  const me = useAuth((s) => s.user)
  const [meta, setMeta] = useState<FileMeta | null>(null)
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null)
  const [linkSource, setLinkSource] = useState<string | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [editing, setEditing] = useState<GraphNode | null>(null)
  const [editingLink, setEditingLink] = useState<GraphLink | null>(null)
  const [showTemplate, setShowTemplate] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const worldRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: 'pan' | 'node' | null; id?: string; sx: number; sy: number; vx: number; vy: number; nx?: number; ny?: number }>({ mode: null, sx: 0, sy: 0, vx: 0, vy: 0 })

  const flash = (m: string) => { setStatusMsg(m); setTimeout(() => setStatusMsg(''), 1800) }

  const loadCurrent = useCallback(async () => {
    let fid = await filesApi.current()
    if (!fid) {
      const f = await filesApi.create({ name: '我的知识图谱' })
      fid = f.id
      await filesApi.setCurrent(fid)
    }
    const opened = await filesApi.open(fid)
    setMeta(opened.meta)
    setGraph(opened.graphData as GraphData)
  }, [])
  useEffect(() => { loadCurrent().catch((e) => flash(e instanceof Error ? e.message : '加载失败')) }, [loadCurrent])

  useEffect(() => {
    if (!graph || !meta || !dirty) return
    const t = setTimeout(async () => {
      setSaving(true)
      try { setMeta(await filesApi.save(meta.id, graph)); setDirty(false) }
      catch (e) { flash(e instanceof Error ? e.message : '保存失败') }
      finally { setSaving(false) }
    }, 1500)
    return () => clearTimeout(t)
  }, [graph, meta, dirty])

  const mutate = (fn: (g: GraphData) => GraphData) => { setGraph((g) => (g ? fn(g) : g)); setDirty(true) }

  const addNode = (x?: number, y?: number) => {
    const id = uid('n_')
    mutate((g) => ({ ...g, nodes: [...g.nodes, { id, title: '新知识点', x: x ?? 420, y: y ?? 300, color: (g.defaults.nodeColor as string) || '#64748b', level: '基础' }] }))
    setSelectedNodeId(id); setSelectedLinkId(null)
  }
  const updateNode = (id: string, patch: Partial<GraphNode>) => mutate((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }))
  const delNode = (id: string) => { mutate((g) => ({ ...g, nodes: g.nodes.filter((n) => n.id !== id), links: g.links.filter((l) => l.from !== id && l.to !== id) })); setSelectedNodeId(null); setEditing(null) }
  const addLink = (from: string, to: string) => {
    if (from === to) return
    mutate((g) => g.links.some((l) => l.from === from && l.to === to) ? g : { ...g, links: [...g.links, { id: uid('l_'), from, to, type: '关联', color: (g.defaults.linkColor as string) || '#2563eb', lineStyle: 'solid' }] })
  }
  const updateLink = (id: string, patch: Partial<GraphLink>) => mutate((g) => ({ ...g, links: g.links.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
  const delLink = (id: string) => { mutate((g) => ({ ...g, links: g.links.filter((l) => l.id !== id) })); setSelectedLinkId(null); setEditingLink(null) }

  const applyTemplate = (kind: string) => {
    const g = blankGraph(kind === 'blank' ? '我的知识图谱' : `${kind.toUpperCase()} 知识图谱`)
    if (kind !== 'blank') {
      const a = uid('n_'), b = uid('n_'), c = uid('n_')
      g.nodes = [
        { id: a, title: kind === 'pmp' ? '项目管理框架' : '核心概念', x: 360, y: 220, color: '#2563eb', level: '重点' },
        { id: b, title: kind === 'pmp' ? '过程组与知识领域' : '关键实践', x: 620, y: 320, color: '#16a34a', level: '重点' },
        { id: c, title: kind === 'pmp' ? '商业文档与治理' : '工具与度量', x: 200, y: 380, color: '#7c3aed', level: '中等' },
      ]
      g.links = [
        { id: uid('l_'), from: a, to: b, type: '包含', color: '#2563eb', lineStyle: 'solid' },
        { id: uid('l_'), from: c, to: a, type: '前置', color: '#2563eb', lineStyle: 'solid' },
      ]
    }
    setGraph(g); setSelectedNodeId(null); setSelectedLinkId(null); setDirty(true); setShowTemplate(false)
    flash(`已应用模板：${kind.toUpperCase()}`)
  }

  const vp = graph?.viewport ?? { x: 260, y: 170, scale: 1 }
  const setVp = (p: Partial<{ x: number; y: number; scale: number }>) => mutate((g) => ({ ...g, viewport: { ...g.viewport, ...p } }))

  const fitView = () => {
    if (!graph || graph.nodes.length === 0 || !stageRef.current) { setVp({ x: 260, y: 170, scale: 1 }); return }
    const xs = graph.nodes.map((n) => n.x), ys = graph.nodes.map((n) => n.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs) + 150, minY = Math.min(...ys), maxY = Math.max(...ys) + 150
    const w = stageRef.current.clientWidth, h = stageRef.current.clientHeight
    const s = Math.max(0.1, Math.min(1.5, Math.min((w - 120) / (maxX - minX), (h - 120) / (maxY - minY))))
    setVp({ x: (w - (minX + maxX) * s) / 2, y: (h - (minY + maxY) * s) / 2, scale: s })
  }

  const onWheel = (e: WheelEvent) => {
    if (!stageRef.current) return
    const r = stageRef.current.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const ns = Math.min(4, Math.max(0.05, vp.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))
    setVp({ x: mx - (mx - vp.x) * (ns / vp.scale), y: my - (my - vp.y) * (ns / vp.scale), scale: ns })
  }
  const onStageDown = (e: RMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('world') || (e.target as HTMLElement).classList.contains('edge-layer')) {
      setSelectedNodeId(null); setSelectedLinkId(null); setLinkSource(null)
      drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: vp.x, vy: vp.y }
    }
  }
  const onCardDown = (e: RMouseEvent, n: GraphNode) => {
    e.stopPropagation()
    drag.current = { mode: 'node', id: n.id, sx: e.clientX, sy: e.clientY, vx: vp.x, vy: vp.y, nx: n.x, ny: n.y }
  }
  useEffect(() => {
    const move = (e: globalThis.MouseEvent) => {
      const d = drag.current; if (!d.mode) return
      if (d.mode === 'pan') setVp({ x: d.vx + (e.clientX - d.sx), y: d.vy + (e.clientY - d.sy) })
      else if (d.mode === 'node' && d.id) updateNode(d.id, { x: (d.nx ?? 0) + (e.clientX - d.sx) / vp.scale, y: (d.ny ?? 0) + (e.clientY - d.sy) / vp.scale })
    }
    const up = () => { drag.current.mode = null }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [vp.scale])

  const onCardClick = (e: RMouseEvent, n: GraphNode) => {
    e.stopPropagation()
    if (linkSource && linkSource !== n.id) { addLink(linkSource, n.id); setLinkSource(null); flash('已建立关系'); return }
    setSelectedNodeId(n.id); setSelectedLinkId(null)
  }
  const onCardDouble = (e: RMouseEvent, n: GraphNode) => {
    e.stopPropagation()
    if (linkSource) { setLinkSource(null); return }
    setLinkSource(n.id); setSelectedNodeId(n.id); flash('已设为连线起点，单击目标节点连线')
  }
  const onStageDouble = (e: RMouseEvent<HTMLDivElement>) => {
    if (!stageRef.current) return
    const r = stageRef.current.getBoundingClientRect()
    addNode((e.clientX - r.left - vp.x) / vp.scale - 70, (e.clientY - r.top - vp.y) / vp.scale - 60)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement)?.tagName
      if (t === 'INPUT' || t === 'TEXTAREA' || editing || editingLink || showTemplate) return
      if (e.key === 'Delete' || e.key === 'Backspace') { if (selectedLinkId) delLink(selectedLinkId); else if (selectedNodeId) delNode(selectedNodeId) }
      else if (e.key === 'n' || e.key === 'N') addNode()
      else if (e.key === 'f' || e.key === 'F') setFocusMode((v) => !v)
      else if (e.key === 't' || e.key === 'T') setShowTemplate(true)
      else if (e.key === '0') fitView()
      else if (e.key === '+' || e.key === '=') setVp({ scale: Math.min(4, vp.scale * 1.2) })
      else if (e.key === '-' || e.key === '_') setVp({ scale: Math.max(0.05, vp.scale / 1.2) })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedNodeId, selectedLinkId, editing, editingLink, showTemplate, vp.scale, graph])

  const nodeById = useMemo(() => { const m: Record<string, GraphNode> = {}; graph?.nodes.forEach((n) => (m[n.id] = n)); return m }, [graph])
  const selNode = selectedNodeId ? nodeById[selectedNodeId] : null

  if (!graph) return <div className="app"><div className="stage" style={{ padding: 48, color: '#64748b' }}>加载图谱…</div></div>

  const saveText = saving ? '保存中…' : dirty ? '未保存' : '已保存'

  return (
    <div className="app">
      {/* 顶部页签栏 */}
      <div className="graph-file-tabbar" aria-label="图谱文件页签栏">
        <Link className="graph-file-home" to="/files" title="打开文件管理" aria-label="打开文件管理">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" /></svg>
        </Link>
        <div className="graph-file-tabs" role="tablist">
          <div className="graph-file-tab active">{graph.meta.title}</div>
        </div>
        <button className="graph-file-add" type="button" title="新建图谱文件" aria-label="新建图谱文件" onClick={() => filesApi.create({ name: '新图谱' }).then((f) => filesApi.setCurrent(f.id).then(() => loadCurrent()))}>＋</button>
      </div>

      <div className="stage" id="stage" ref={stageRef} onWheel={onWheel} onMouseDown={onStageDown} onDoubleClick={onStageDouble}>
        {/* 左上工具栏 */}
        <div className="canvas-toolbar-left" data-stage-ui="true">
          <button className="graph-save-state" type="button" title="立即保存（Ctrl+S）" onClick={() => mutate(() => graph)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .8-7.9A6 6 0 0 0 6.4 8.5 4.8 4.8 0 0 0 7 18Z" /><path d="m9.5 13 1.7 1.7 3.5-3.7" /></svg>
            <span className="graph-save-state-text">{saveText}</span>
          </button>
          <div className="brand graph-meta-display" role="button" tabIndex={0} title="双击编辑标题" onDoubleClick={() => { const t = window.prompt('图谱标题', graph.meta.title); if (t) mutate((g) => ({ ...g, meta: { ...g.meta, title: t } })) }}>
            <h1 id="appTitle">{graph.meta.title}</h1>
            <span id="appSubtitle">{(graph.meta.subject as string) || '通用知识图谱工具'}</span>
          </div>
          <button className="graph-meta-preferences-btn" title="模板" type="button" onClick={() => setShowTemplate(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
          </button>
          <button className="graph-meta-search-btn" title="搜索定位" type="button" onClick={() => { const kw = window.prompt('搜索知识点'); if (!kw) return; const hit = graph.nodes.find((n) => (n.title + n.category + n.keywords).includes(kw)); if (hit) { setSelectedNodeId(hit.id); setVp({ x: 600 - hit.x * vp.scale, y: 360 - hit.y * vp.scale }) } else flash('未找到') }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" /></svg>
          </button>
        </div>

        {/* 右上：升级会员 + 账号菜单 */}
        <div className="canvas-toolbar-right" data-stage-ui="true">
          <Link className="upgrade-member-btn" to="/member" data-open-subscription-detail>升级会员</Link>
          <div className="account-menu-shell">
            <button className="auth-status account-menu-trigger" type="button" title={me?.username}>
              <span className="role-dot" />{me?.display_name || me?.username || '访客'}
            </button>
            <div className="account-menu" role="menu">
              <Link className="account-menu-item" to="/member" role="menuitem">用户中心</Link>
              <Link className="account-menu-item" to="/files" role="menuitem">文件管理</Link>
              <Link className="account-menu-item" to="/users" role="menuitem">用户管理</Link>
              <div className="account-menu-separator" role="separator" />
              <Link className="account-menu-item account-menu-session" to="/login" role="menuitem">切换账号</Link>
            </div>
          </div>
        </div>

        {/* 左侧悬浮工具栏 */}
        <aside className="floating-toolbox" aria-label="图谱操作工具" data-home-toolbar="registry">
          <button className="tool-btn" title="新增知识点 (N)" onClick={() => addNode()}><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></button>
          <button className={`tool-btn${linkSource ? ' active-toggle' : ''}`} title="连线模式：选中起点再点目标" onClick={() => { if (selectedNodeId) setLinkSource(linkSource ? null : selectedNodeId); else flash('先选中一个知识点') }}><svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8 8l8 8" /></svg></button>
          <button className={`tool-btn${focusMode ? ' active-toggle' : ''}`} title="重点聚焦 (F)" onClick={() => setFocusMode((v) => !v)}><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg></button>
          <button className="tool-btn" title="模板 (T)" onClick={() => setShowTemplate(true)}><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 9v12" /></svg></button>
          <span className="tool-sep" />
          <button className="tool-btn" title="居中 (0)" onClick={fitView}><svg viewBox="0 0 24 24"><path d="M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4" /><rect x="8" y="8" width="8" height="8" rx="2" /></svg></button>
          <button className="tool-btn" title="缩小" onClick={() => setVp({ scale: Math.max(0.05, vp.scale / 1.2) })}><svg viewBox="0 0 24 24"><path d="M5 12h14" /></svg></button>
          <button className="tool-btn" title="放大" onClick={() => setVp({ scale: Math.min(4, vp.scale * 1.2) })}><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></button>
        </aside>

        {/* 画布世界 */}
        <div className="world" id="world" ref={worldRef} style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})`, transformOrigin: '0 0' }}>
          <svg className="edge-layer" id="edgeLayer" viewBox="-50000 -50000 100000 100000" xmlns="http://www.w3.org/2000/svg">
            <g id="edgeGroup">
              {graph.links.map((l) => {
                const a = nodeById[l.from], b = nodeById[l.to]
                if (!a || !b) return null
                const onSel = l.id === selectedLinkId
                return (
                  <g key={l.id} className={`edge-group${onSel ? ' selected' : ''}`} onClick={(e) => { e.stopPropagation(); setSelectedLinkId(l.id); setSelectedNodeId(null) }} onDoubleClick={(e) => { e.stopPropagation(); setEditingLink(l) }}>
                    <line className="edge-line" x1={a.x + 75} y1={a.y + 66} x2={b.x + 75} y2={b.y + 66} stroke={l.color || '#2563eb'} strokeWidth={onSel ? 4 : 2} strokeDasharray={l.lineStyle === 'dashed' ? '8 5' : undefined} />
                    {l.type && <text className="edge-label" x={(a.x + b.x) / 2 + 75} y={(a.y + b.y) / 2 + 66} fill="#475569" fontSize={13} textAnchor="middle">{l.type}</text>}
                  </g>
                )
              })}
            </g>
          </svg>
          <div className="cards-layer" id="cardsLayer">
            {graph.nodes.map((n) => {
              const isSel = n.id === selectedNodeId
              const isSrc = n.id === linkSource
              const isImp = IMPORTANT.has(n.level || '')
              const dim = focusMode && !isImp
              const sizeCls = n.size === 'small' ? ' size-small' : n.size === 'big' ? ' size-big' : ''
              const cls = `knowledge-card${sizeCls}${isSel ? ' active' : ''}${isSrc ? ' link-source' : ''}${isImp ? ' focus-card' : ''}`
              return (
                <div
                  key={n.id}
                  className={cls}
                  data-node-id={n.id}
                  style={{ left: n.x, top: n.y, ['--node-color' as string]: n.color, opacity: dim ? 0.25 : 1 }}
                  onMouseDown={(e) => onCardDown(e, n)}
                  onClick={(e) => onCardClick(e, n)}
                  onDoubleClick={(e) => onCardDouble(e, n)}
                >
                  <div className="card-body">
                    <div className="node-top" style={{ background: `linear-gradient(180deg, ${tint(n.color, 0.88)}, #e5e7eb)` }}>
                      <div className="node-icon" style={{ background: n.color }}>{(n.title || '?').trim().slice(0, 1)}</div>
                    </div>
                    <div className="node-title">{n.title || '未命名知识点'}</div>
                  </div>
                  <div className="node-size-tools" aria-label="卡牌尺寸">
                    <button type="button" className="node-size-btn" data-size="small" title="小卡" onClick={(e) => { e.stopPropagation(); updateNode(n.id, { size: 'small' }) }}>-</button>
                    <button type="button" className="node-size-btn" data-size="big" title="大卡" onClick={(e) => { e.stopPropagation(); updateNode(n.id, { size: 'big' }) }}>+</button>
                    <button type="button" className="node-size-btn" data-size="" title="默认尺寸" onClick={(e) => { e.stopPropagation(); updateNode(n.id, { size: '' }) }}>o</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="help-card" id="helpCard">
          <strong>通用知识图谱操作</strong><br />
          双击空白处新增知识点；双击卡牌设为连线起点，再点目标卡牌建立关系；拖动卡牌移动，拖动空白平移，滚轮缩放；Delete 删除选中。
        </div>

        {/* 详情面板 */}
        {selNode && (
          <aside className="detail-panel" id="detailPanel">
            <div className="detail-head"><h3>{selNode.title}</h3><button className="detail-edit" onClick={() => setEditing(selNode)}>编辑</button></div>
            <div className="detail-body">
              {selNode.category && <div className="detail-row"><span>分类</span><strong>{selNode.category}</strong></div>}
              {selNode.level && <div className="detail-row"><span>难度</span><strong>{selNode.level}</strong></div>}
              {selNode.keywords && <div className="detail-row"><span>关键词</span><strong>{selNode.keywords}</strong></div>}
              {selNode.summary && <div className="detail-summary">{selNode.summary}</div>}
              {selNode.notes && <div className="detail-notes"><em>提示：</em>{selNode.notes}</div>}
            </div>
          </aside>
        )}

        <div className="status-chip" id="status">{statusMsg}</div>

        {/* 左下缩放 */}
        <div className="canvas-zoom-dock" data-stage-ui="true" role="group" aria-label="画布缩放控制">
          <button className="canvas-zoom-btn" title="缩小" onClick={() => setVp({ scale: Math.max(0.05, vp.scale / 1.2) })}>−</button>
          <button className="canvas-zoom-percent" onClick={() => setVp({ scale: 1 })}>{Math.round(vp.scale * 100)}%</button>
          <button className="canvas-zoom-btn" title="放大" onClick={() => setVp({ scale: Math.min(4, vp.scale * 1.2) })}>＋</button>
          <span className="canvas-zoom-divider" aria-hidden="true" />
          <button className="canvas-zoom-btn canvas-fit-btn" title="居中" onClick={fitView}><svg viewBox="0 0 24 24"><path d="M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4" /><rect x="8" y="8" width="8" height="8" rx="2" /></svg></button>
        </div>
      </div>

      {/* 节点编辑弹窗（原版 #nodeModal 结构）*/}
      {editing && (
        <NodeModal node={editing} onClose={() => setEditing(null)} onSave={(p) => { updateNode(editing.id, p); setEditing(null) }} onDelete={() => { delNode(editing.id); flash('已删除') }} />
      )}
      {editingLink && (
        <LinkModal link={editingLink} onClose={() => setEditingLink(null)} onSave={(p) => { updateLink(editingLink.id, p); setEditingLink(null) }} onDelete={() => { delLink(editingLink.id); flash('已删除') }} />
      )}
      {showTemplate && (
        <div className="modal-backdrop" id="templateModal" onClick={() => setShowTemplate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>选择模板</h2>
            <p>选择模板会替换当前图谱。</p>
            <div className="template-grid">
              {TEMPLATES.map(([k, t, d]) => (
                <div key={k} className="template-card" data-template={k} onClick={() => applyTemplate(k)}>
                  <h3>{t}</h3>
                  <div>{d}</div>
                </div>
              ))}
            </div>
            <div className="modal-actions"><button onClick={() => setShowTemplate(false)}>关闭</button></div>
          </div>
        </div>
      )}
    </div>
  )
}

function NodeModal({ node, onClose, onSave, onDelete }: { node: GraphNode; onClose: () => void; onSave: (p: Partial<GraphNode>) => void; onDelete: () => void }) {
  const [f, setF] = useState<GraphNode>(node)
  useEffect(() => { setF(node) }, [node])
  const set = (k: keyof GraphNode, v: string) => setF((s) => ({ ...s, [k]: v }))
  return (
    <div className="modal-backdrop" id="nodeModal" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>编辑知识点</h2>
        <div className="form-grid">
          <label>知识点名称</label><input value={f.title} maxLength={40} onChange={(e) => set('title', e.target.value)} placeholder="例如：关键路径法" />
          <label>分类/章节</label><input value={f.category || ''} maxLength={50} onChange={(e) => set('category', e.target.value)} placeholder="例如：进度管理" />
          <label>节点颜色</label><input type="color" value={f.color} onChange={(e) => set('color', e.target.value)} />
          <label>卡牌尺寸</label><select value={f.size || ''} onChange={(e) => set('size', e.target.value)}><option value="">默认</option><option value="small">小</option><option value="big">大</option></select>
          <label>难度</label><select value={f.level || '基础'} onChange={(e) => set('level', e.target.value)}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
          <label>关键词</label><input value={f.keywords || ''} maxLength={80} onChange={(e) => set('keywords', e.target.value)} placeholder="逗号分隔" />
          <label>知识点说明</label><textarea value={f.summary || ''} onChange={(e) => set('summary', e.target.value)} placeholder="给学员看的简明解释" />
          <label>学习提示</label><textarea value={f.notes || ''} onChange={(e) => set('notes', e.target.value)} placeholder="记忆方法、考试提示" />
        </div>
        <div className="modal-actions">
          <button className="danger left" onClick={onDelete}>删除知识点</button>
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => onSave(f)}>保存</button>
        </div>
      </div>
    </div>
  )
}

function LinkModal({ link, onClose, onSave, onDelete }: { link: GraphLink; onClose: () => void; onSave: (p: Partial<GraphLink>) => void; onDelete: () => void }) {
  const [f, setF] = useState<GraphLink>(link)
  useEffect(() => { setF(link) }, [link] )
  const set = (k: keyof GraphLink, v: string) => setF((s) => ({ ...s, [k]: v }))
  return (
    <div className="modal-backdrop" id="linkModal" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>编辑关系线</h2>
        <div className="form-grid">
          <label>关系类型</label><select value={f.type || '关联'} onChange={(e) => set('type', e.target.value)}>{LINK_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          <label>线型</label><select value={f.lineStyle || 'solid'} onChange={(e) => set('lineStyle', e.target.value)}><option value="solid">实线</option><option value="dashed">虚线</option></select>
          <label>线色</label><input type="color" value={f.color || '#2563eb'} onChange={(e) => set('color', e.target.value)} />
          <label>备注</label><textarea value={f.note || ''} onChange={(e) => set('note', e.target.value)} placeholder="关系说明" />
        </div>
        <div className="modal-actions">
          <button className="danger left" onClick={onDelete}>删除关系线</button>
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={() => onSave(f)}>保存</button>
        </div>
      </div>
    </div>
  )
}
