import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Folder as FolderIcon, MoreHorizontal, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { filesApi, type FileMeta, type Folder } from '../api/files'
import { useAuth } from '../store/auth'

type View = 'recent' | 'favorites' | 'all' | 'trash'
type Display = 'grid' | 'list'

const SORTS: [string, string][] = [
  ['updated', '最近更新'],
  ['opened', '最近打开'],
  ['name', '名称 A–Z'],
  ['size', '文件大小'],
  ['created', '创建时间'],
]

function fmtTime(s: string | null): string {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString('zh-CN', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return s
  }
}

// 简易字符串 hash（用于封面节点稳定布局）
function hashSeed(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/** 卡片封面：根据节点/关系数绘制一张迷你知识网络（与 legacy fm-file-cover 视觉一致） */
function FileCover({ id, nodes, links, a, b }: { id: string; nodes: number; links: number; a: string; b: string }) {
  const seed = hashSeed(id)
  const n = Math.max(3, Math.min(12, nodes || 5))
  const pts = useMemo(() => {
    const arr: { x: number; y: number; r: number; primary: boolean }[] = []
    let s = seed || 1
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      return s / 0x7fffffff
    }
    for (let i = 0; i < n; i++) {
      arr.push({ x: 20 + rnd() * 160, y: 16 + rnd() * 78, r: 2.6 + rnd() * 3.6, primary: rnd() > 0.45 })
    }
    return arr
  }, [seed, n])
  const gid = 'fmCover' + (seed % 100000)
  const edgeCount = Math.max(2, Math.min(links || 4, n * 2))
  const edges = useMemo(() => {
    const arr: { i: number; j: number; primary: boolean }[] = []
    let s = (seed >> 3) || 1
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
    for (let k = 0; k < edgeCount; k++) {
      const i = Math.floor(rnd() * n)
      let j = Math.floor(rnd() * n)
      if (j === i) j = (j + 1) % n
      arr.push({ i, j, primary: rnd() > 0.4 })
    }
    return arr
  }, [seed, n, edgeCount])
  return (
    <svg aria-hidden="true" viewBox="0 0 200 110" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={gid + 'Bg'} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--cover-bg,#e7f4ef)" />
          <stop offset=".62" stopColor={b} stopOpacity="0.055" />
          <stop offset="1" stopColor={a} stopOpacity="0.11" />
        </linearGradient>
      </defs>
      <rect width="200" height="110" fill={`url(#${gid}Bg)`} />
      <g className="fm-cover-network">
        {edges.map((e, k) => (
          <path key={k} className={`fm-cover-edge${e.primary ? ' is-primary' : ''}`} d={`M${pts[e.i].x} ${pts[e.i].y} Q${(pts[e.i].x + pts[e.j].x) / 2} ${(pts[e.i].y + pts[e.j].y) / 2 - 6} ${pts[e.j].x} ${pts[e.j].y}`} />
        ))}
        {pts.map((p, k) => (
          <circle key={k} className={`fm-cover-node${p.primary ? ' is-primary' : ''}`} style={{ ['--node' as string]: b }} cx={p.x} cy={p.y} r={p.r} />
        ))}
      </g>
    </svg>
  )
}

const COVER_PAIRS: [string, string, string][] = [
  ['#4f9b8c', '#86c2b4', '#e7f4ef'],
  ['#3b82f6', '#93c5fd', '#eef4ff'],
  ['#a855f7', '#d8b4fe', '#f6f0ff'],
  ['#f59e0b', '#fcd34d', '#fff7e6'],
  ['#ef4444', '#fca5a5', '#fff0f0'],
  ['#0ea5e9', '#7dd3fc', '#eef9ff'],
]

export default function Files() {
  const me = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const navigate = useNavigate()

  const [view, setView] = useState<View>('recent')
  const [display, setDisplay] = useState<Display>('grid')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [files, setFiles] = useState<FileMeta[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [stats, setStats] = useState<{ activeCount: number; trashedCount: number; totalNodes: number; totalLinks: number; activeBytes: number; trashedBytes: number } | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('updated')
  const [selected, setSelected] = useState<FileMeta | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [toast, setToast] = useState('')
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2200) }

  useEffect(() => { filesApi.current().then(setCurrentId).catch(() => {}) }, [])

  const reload = useCallback(async () => {
    const params: Record<string, unknown> = { sort }
    if (query) params.query = query
    if (view === 'trash') params.status = 'trashed'
    else params.folder_id = null
    const data = await filesApi.list(params)
    setFiles(data.files)
    filesApi.stats().then(setStats)
  }, [view, query, sort])
  useEffect(() => { reload() }, [reload])
  useEffect(() => { filesApi.folders().then(setFolders) }, [reload])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const open = async (f: FileMeta) => {
    if (view === 'trash') return
    await filesApi.setCurrent(f.id)
    navigate('/')
  }
  const create = async () => {
    const name = window.prompt('新图谱名称', '未命名图谱')
    if (!name) return
    await filesApi.create({ name })
    notify('已创建')
    reload()
  }
  const createFolder = async () => {
    const name = window.prompt('新文件夹名称', '新建文件夹')
    if (!name) return
    await filesApi.createFolder(name)
    filesApi.folders().then(setFolders)
    notify('文件夹已创建')
  }
  const rename = async (f: FileMeta) => {
    const name = window.prompt('重命名', f.name)
    if (!name || name === f.name) return
    await filesApi.rename(f.id, name)
    reload()
  }
  const duplicate = async (f: FileMeta) => { await filesApi.duplicate(f.id); notify('已创建副本'); reload() }
  const trash = async (f: FileMeta) => {
    if (!window.confirm(`将「${f.name}」移入回收站？`)) return
    await filesApi.trash(f.id); notify('已移入回收站'); reload()
  }
  const batchTrash = async () => {
    if (selection.size === 0 || !window.confirm(`将所选 ${selection.size} 个文件移入回收站？`)) return
    try {
      for (const id of selection) await filesApi.trash(id)
      notify(`已将 ${selection.size} 个文件移入回收站`); setSelectMode(false); setSelection(new Set()); reload()
    } catch (e) { notify(e instanceof Error ? e.message : '批量删除失败') }
  }
  const batchExport = async () => {
    if (selection.size === 0) return notify('未选择文件')
    try {
      const out: { files: unknown[]; contents: unknown[] } = { files: [], contents: [] }
      for (const id of selection) {
        const meta = files.find((x) => x.id === id)
        if (!meta) continue
        const opened = await filesApi.open(id)
        out.files.push({ ...opened.meta, id, name: meta.name })
        out.contents.push({ id, graphData: opened.graphData })
      }
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'graphs-export.json'
      a.click()
      URL.revokeObjectURL(a.href)
      notify(`已导出 ${selection.size} 个文件`)
    } catch (e) { notify(e instanceof Error ? e.message : '导出失败') }
  }
  const restore = async (f: FileMeta) => { await filesApi.restore(f.id); notify('已恢复'); reload() }
  const permanentDelete = async (f: FileMeta) => {
    if (!window.confirm(`永久删除「${f.name}」？不可恢复。`)) return
    await filesApi.permanentDelete(f.id); notify('已永久删除'); reload()
  }
  const emptyTrash = async () => {
    if (!window.confirm('清空回收站？')) return
    await filesApi.emptyTrash(); notify('回收站已清空'); reload()
  }
  const importJson = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text())
      let payload: Record<string, unknown>
      if (Array.isArray(raw.files) || Array.isArray(raw.contents)) payload = raw
      else if (raw.nodes && raw.links) payload = { files: [{ name: file.name.replace(/\.json$/i, ''), graphData: raw }] }
      else if (raw.graphData) payload = { files: [{ name: file.name.replace(/\.json$/i, ''), graphData: raw.graphData }] }
      else { notify('无法识别的 JSON'); return }
      const r = await filesApi.importLegacy(payload)
      notify(`已导入 ${r.imported} 个图谱`); reload()
    } catch (e) { notify(e instanceof Error ? e.message : '导入失败') }
  }

  const isTrash = view === 'trash'
  const toggleSelect = (id: string) => setSelection((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const activeBytes = stats?.activeBytes ?? 0
  const quota = 50 * 1024 * 1024
  const usedPct = Math.min(100, (activeBytes / quota) * 100)

  return (
    <>
      <div className="fm-mobile-readonly-notice" id="fmMobileReadonlyNotice" hidden role="status">
        <strong>移动端仅支持查看</strong>
        <span>文件管理与图谱编辑请使用电脑端。</span>
      </div>

      <div className="fm-app" id="fileManagerApp">
        {/* 侧栏 */}
        <aside className="fm-sidebar" aria-label="文件管理导航" style={{ display: sidebarCollapsed ? 'none' : undefined }}>
          <div className="fm-sidebar-brand-row">
            <Link className="fm-brand" to="/" aria-label="返回知识图谱编辑器">
              <span className="fm-brand-mark" aria-hidden="true">
                <svg viewBox="0 0 48 48"><path d="M12 13 24 7l12 7v13l-12 7-12-7Z" /><circle cx="12" cy="13" r="4" /><circle cx="24" cy="7" r="4" /><circle cx="36" cy="14" r="4" /><circle cx="36" cy="27" r="4" /><circle cx="24" cy="34" r="4" /><circle cx="12" cy="27" r="4" /></svg>
              </span>
              <span className="fm-brand-text"><strong>知识图谱</strong><small>v8.4.22</small></span>
            </Link>
            <button className="fm-sidebar-collapse" type="button" aria-label="收起侧栏" title="收起侧栏" onClick={() => setSidebarCollapsed(true)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
            </button>
          </div>

          <div className="fm-sidebar-scroll" id="fmSidebarScroll">
            <div className="fm-primary-stack">
              <button className="fm-primary-action" id="fmNewFileBtn" type="button" onClick={create}>
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
                <span>新建图谱</span>
              </button>
            </div>

            <nav className="fm-nav fm-nav-primary" aria-label="文件分类">
              <button className={`fm-nav-item${view === 'recent' ? ' is-active' : ''}`} type="button" data-view="recent" onClick={() => setView('recent')}>
                <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></svg>
                <span>最近打开</span><b>{stats?.activeCount ?? 0}</b>
              </button>
              <button className={`fm-nav-item${view === 'favorites' ? ' is-active' : ''}`} type="button" data-view="favorites" onClick={() => setView('favorites')}>
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z" /></svg>
                <span>我的收藏</span><b>{stats?.activeCount ?? 0}</b>
              </button>
            </nav>

            <section className="fm-folder-nav" aria-labelledby="fmFolderNavTitle">
              <div className="fm-folder-nav-head">
                <span className="fm-section-label" id="fmFolderNavTitle">文件夹</span>
                <button className="fm-folder-add-btn" type="button" aria-label="新建文件夹" title="新建文件夹" onClick={createFolder}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
              </div>
              <div className="fm-folder-tree" role="tree" aria-label="文件夹目录">
                {folders.map((f) => (
                  <div key={f.id} className="fm-folder-tree-item" role="treeitem"><FolderIcon size={14} aria-hidden="true" /> {f.name}</div>
                ))}
              </div>
            </section>

            <section className="fm-storage-card" aria-labelledby="fmStorageTitle">
              <div className="fm-section-label" id="fmStorageTitle">存储空间</div>
              <div className="fm-storage-head"><strong>{(activeBytes / 1024).toFixed(1)} KB</strong><span>服务端数据库</span></div>
              <div className="fm-progress" aria-hidden="true"><i style={{ width: `${usedPct}%` }} /></div>
              <p>{usedPct.toFixed(1)}% 已使用</p>
              <dl>
                <div><dt>图谱文件</dt><dd>{stats?.activeCount ?? 0}</dd></div>
                <div><dt>回收站</dt><dd>{stats?.trashedCount ?? 0}</dd></div>
                <div><dt>节点 / 关系</dt><dd>{stats ? `${stats.totalNodes} / ${stats.totalLinks}` : '0 / 0'}</dd></div>
              </dl>
            </section>

            <nav className="fm-nav fm-nav-bottom" aria-label="回收站">
              <button className={`fm-nav-item${view === 'trash' ? ' is-active' : ''}`} type="button" data-view="trash" onClick={() => setView('trash')}>
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /><path d="M10 11v5M14 11v5" /></svg>
                <span>回收站</span><b>{stats?.trashedCount ?? 0}</b>
              </button>
            </nav>

            <div className="fm-sidebar-foot">
              <span>{me?.display_name || me?.username || '访客空间'}</span>
              <Link to="/">返回编辑器</Link>
            </div>
          </div>
        </aside>

        {/* 主区 */}
        <main className="fm-main">
          <header className="fm-topbar">
            <div className="fm-heading">
              {sidebarCollapsed && <button className="fm-sidebar-collapse" type="button" aria-label="展开侧栏" title="展开侧栏" style={{ marginRight: 8 }} onClick={() => setSidebarCollapsed(false)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg></button>}
              <h1>{isTrash ? '回收站' : '文件管理'}</h1>
              <p>{isTrash ? '已删除的文件，30 天内可恢复' : '管理你的知识图谱文件'}</p>
            </div>
            <div className="fm-top-actions">
              <label className="fm-search" htmlFor="fmSearchInput">
                <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
                <input id="fmSearchInput" type="search" autoComplete="off" placeholder="搜索文件名、描述或标签…" value={query} onChange={(e) => setQuery(e.target.value)} />
                <kbd>Ctrl K</kbd>
              </label>
              <div className="fm-segment" role="group" aria-label="显示方式">
                <button className={display === 'grid' ? 'is-active' : ''} type="button" title="网格视图" aria-label="网格视图" onClick={() => setDisplay('grid')}><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><rect x="14" y="14" width="6" height="6" /></svg></button>
                <button className={display === 'list' ? 'is-active' : ''} type="button" title="列表视图" aria-label="列表视图" onClick={() => setDisplay('list')}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="5" cy="6" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="5" cy="18" r="1" /></svg></button>
              </div>
              <button className="fm-icon-btn" type="button" title="刷新" aria-label="刷新" onClick={() => reload()}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9m16 6-2 2.5A7 7 0 0 1 5.5 15" /></svg></button>
              <button className="fm-icon-btn" type="button" title="切换浅色/深色主题" aria-label="切换浅色/深色主题" onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}>
                <svg className="fm-theme-sun" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
                <svg className="fm-theme-moon" aria-hidden="true" viewBox="0 0 24 24"><path d="M20 15.5A8 8 0 0 1 8.5 4 8 8 0 1 0 20 15.5Z" /></svg>
              </button>
              <div className={`fm-account-shell${accountOpen ? ' is-open' : ''}`} id="fmAccountShell">
                <button className="fm-avatar" type="button" aria-label="账号菜单" aria-haspopup="menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((v) => !v)}>{(me?.display_name || me?.username || '访').slice(0, 1)}</button>
                <div className="fm-account-menu" role="menu" hidden={!accountOpen}>
                  <div className="fm-account-summary">
                    <span className="fm-account-avatar" aria-hidden="true">{(me?.display_name || me?.username || '访').slice(0, 1)}</span>
                    <div><strong>{me?.display_name || me?.username || '访客'}</strong><small>{me?.role || '返回编辑器可登录账号'}</small></div>
                  </div>
                  <Link to="/" role="menuitem" onClick={() => setAccountOpen(false)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12h14M9 7l-5 5 5 5" /><path d="M14 5h6v14h-6" /></svg><span>返回编辑器</span></Link>
                  <Link to="/settings" role="menuitem" onClick={() => setAccountOpen(false)}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2-.8-.6-1.5.9-2-2.1-2.1-2 .9-1.5-.6L10.5 2h-3l-.8 2-1.5.6-2-.9L1.1 5.8l.9 2-.6 1.5-2 .8v3l2 .8.6 1.5-.9 2 2.1 2.1 2-.9 1.5.6.8 2h3l.8-2 1.5-.6 2 .9 2.1-2.1-.9-2 .6-1.5Z" transform="translate(2.5 0) scale(.8)" /></svg><span>系统设置</span></Link>
                  {me?.role === 'admin' && <Link to="/users" role="menuitem" onClick={() => setAccountOpen(false)}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3" /><path d="M3 19c.6-3.2 2.6-5 6-5s5.4 1.8 6 5M16 7h5M18.5 4.5v5" /></svg><span>用户管理</span></Link>}
                  <hr />
                  <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); logout(); navigate('/login') }}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 5H4v14h6M14 8l4 4-4 4M8 12h10" /></svg><span>退出登录</span></button>
                </div>
              </div>
            </div>
          </header>

          <div className="fm-workspace">
            <section className="fm-browser" aria-label="图谱文件">
              <div className="fm-breadcrumb-bar" id="fmBreadcrumbBar" aria-label="文件夹路径"><span className="fm-breadcrumb">{isTrash ? '回收站' : '全部文件'}</span></div>
              <div className="fm-browser-toolbar">
                <div className="fm-filter-tabs" role="tablist" aria-label="文件筛选">
                  <button className="is-active" type="button" data-filter="all" role="tab" onClick={() => notify('已显示全部')}>全部 <span>{stats?.activeCount ?? 0}</span></button>
                  <button type="button" data-filter="created" role="tab" onClick={() => notify('已筛选我创建的')}>我创建的 <span>{stats?.activeCount ?? 0}</span></button>
                  <button type="button" data-filter="tagged" role="tab" onClick={() => notify('已筛选有标签')}>有标签 <span>0</span></button>
                </div>
                <div className="fm-toolbar-actions">
                  <button className="fm-text-btn" id="fmSelectionModeBtn" type="button" onClick={() => { setSelectMode((v) => !v); setSelection(new Set()) }}>{selectMode ? '完成选择' : '选择'}</button>
                  <button className="fm-text-btn" id="fmDetailsBtn" type="button" title="显示文件详细信息（Alt + Enter）" aria-pressed={!!selected} onClick={() => selected ? null : notify('请先选择一个文件')}>详细信息</button>
                  <label className="fm-text-btn" id="fmImportBtn" style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 19h14" /></svg>导入文件
                    <input type="file" hidden accept=".json,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.currentTarget.value = '' }} />
                  </label>
                  <select aria-label="排序方式" value={sort} onChange={(e) => setSort(e.target.value)}>
                    {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  {isTrash && <button className="fm-danger-ghost" id="fmEmptyTrashBtn" type="button" onClick={emptyTrash}>清空回收站</button>}
                </div>
              </div>

              {selectMode && selection.size > 0 && (
                <div className="fm-batch-bar"><strong>已选择 {selection.size} 项</strong><div><button type="button" onClick={() => notify('批量标签：请在文件详情中单独设置标签')}>标签</button><button type="button" onClick={() => notify('批量移动：可拖拽文件到左侧文件夹')}>移动</button><button type="button" onClick={batchExport}>导出</button><button className="is-danger" type="button" onClick={batchTrash}>移入回收站</button><button type="button" onClick={() => { setSelectMode(false); setSelection(new Set()) }}>取消</button></div></div>
              )}

              <div className="fm-content" tabIndex={-1}>
                <section className="fm-file-section" aria-labelledby="fmFileSectionTitle">
                  <div className="fm-content-section-head">
                    <h2 id="fmFileSectionTitle">{isTrash ? `回收站（${files.length}）` : `文件数（${files.length}）`}</h2>
                  </div>
                  <div className={`fm-file-grid${display === 'list' ? ' fm-list-view' : ''}`} aria-live="polite">
                    {files.map((f, idx) => {
                      const [a, b] = COVER_PAIRS[idx % COVER_PAIRS.length]
                      const isCur = f.id === currentId
                      const isSel = selection.has(f.id)
                      return (
                        <article
                          key={f.id}
                          className={`fm-file-card${selected?.id === f.id ? ' is-selected' : ''}${isSel ? ' is-checked' : ''}`}
                          data-file-id={f.id}
                          tabIndex={0}
                          role="button"
                          aria-label={`${f.name}，双击打开`}
                          onClick={() => (selectMode ? toggleSelect(f.id) : setSelected(selected?.id === f.id ? null : f))}
                          onDoubleClick={() => open(f)}
                        >
                          <button className="fm-select-mark" type="button" aria-label={`选择 ${f.name}`} style={{ opacity: selectMode || isSel ? 1 : undefined }} onClick={(e) => { e.stopPropagation(); if (selectMode) toggleSelect(f.id) }}><Check size={14} aria-hidden="true" /></button>
                          <div className="fm-file-cover-shell">
                            <div className="fm-file-cover" style={{ ['--cover-a' as string]: a, ['--cover-b' as string]: b, ['--cover-bg' as string]: COVER_PAIRS[idx % COVER_PAIRS.length][2] }}>
                              <FileCover id={f.id} nodes={f.nodeCount} links={f.linkCount} a={a} b={b} />
                            </div>
                          </div>
                          {isCur && <span className="fm-current-badge">当前打开</span>}
                          <button className="fm-file-menu-btn" type="button" aria-label={`${f.name}的更多操作`} onClick={(e) => { e.stopPropagation(); setSelected(f) }}><MoreHorizontal size={16} aria-hidden="true" /></button>
                          <div className="fm-file-meta">
                            <div className="fm-file-title-cell">
                              <strong className="fm-file-name" title={f.name}>{f.name}</strong>
                              {isCur && <span className="fm-list-current-badge">当前打开</span>}
                            </div>
                            <span className="fm-file-date">{fmtTime(f.updatedAt)}</span>
                            <div className="fm-file-stats">
                              <span><strong>{f.nodeCount}</strong> 节点</span>
                              <span><strong>{f.linkCount}</strong> 关系</span>
                              <span className="fm-file-size">{(f.byteSize / 1024).toFixed(2)} KB</span>
                            </div>
                            <span className="fm-list-node-count">{f.nodeCount}</span>
                            <span className="fm-list-link-count">{f.linkCount}</span>
                            <span className="fm-list-size">{(f.byteSize / 1024).toFixed(2)} KB</span>
                            <span className="fm-list-tag-cell">{f.tag && <span className="fm-tag-chip" style={{ background: f.tag.color }}>{f.tag.name}</span>}</span>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                  {files.length === 0 && (
                    <div className="fm-empty">
                      <span className="fm-empty-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 7h7l2 2h9v10H3Z" /><path d="M8 14h8" /></svg></span>
                      <h2>{isTrash ? '回收站为空' : '还没有图谱文件'}</h2>
                      <p>{isTrash ? '删除的文件会出现在这里' : '创建一个新图谱，或导入已有学习包。'}</p>
                      {!isTrash && <button className="fm-primary-inline" type="button" onClick={create}>新建图谱</button>}
                    </div>
                  )}
                </section>
              </div>

              {selected && !selectMode && (
                <div className="fm-selection-summary">
                  <div><strong>{selected.name}</strong><span>{selected.nodeCount} 节点 · {selected.linkCount} 关系 · {(selected.byteSize / 1024).toFixed(2)} KB</span></div>
                  <div><button type="button" onClick={() => setSelected(null)}>详细信息</button><button type="button" title="取消选择" aria-label="取消选择" onClick={() => setSelected(null)}><X size={16} aria-hidden="true" /></button></div>
                </div>
              )}
              <footer className="fm-browser-footer"><span>共 {files.length} 个文件</span><span>文件索引正常</span></footer>
            </section>
          </div>
        </main>

        {/* 详情抽屉 */}
        <div className="fm-drawer-backdrop" hidden={!selected} onClick={() => setSelected(null)} />
        <aside className="fm-details-drawer" aria-label="文件详情" aria-hidden={!selected}>
          <section className="fm-panel fm-file-info">
            <div className="fm-panel-title"><h2>文件信息</h2><button className="fm-icon-btn fm-small" type="button" title="关闭详情" aria-label="关闭详情" onClick={() => setSelected(null)}><X size={16} aria-hidden="true" /></button></div>
            {!selected ? (
              <div className="fm-info-empty">
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 6h6l2 2h8v11H4Z" /><path d="M9 13h6M12 10v6" /></svg>
                <p>选择文件查看详细信息</p>
              </div>
            ) : (
              <div className="fm-info-body">
                <div className="fm-info-kind">图谱文件</div>
                <h3>{selected.name}</h3>
                {selected.id === currentId && <div className="fm-info-current">当前打开</div>}
                <dl>
                  <div><dt>更新时间</dt><dd>{fmtTime(selected.updatedAt)}</dd></div>
                  <div><dt>创建时间</dt><dd>{fmtTime(selected.createdAt)}</dd></div>
                  <div><dt>节点数量</dt><dd>{selected.nodeCount}</dd></div>
                  <div><dt>关系数量</dt><dd>{selected.linkCount}</dd></div>
                  <div><dt>文件大小</dt><dd>{(selected.byteSize / 1024).toFixed(2)} KB</dd></div>
                </dl>
                <div className="fm-info-tags">{selected.tag && <span className="fm-tag-chip" style={{ background: selected.tag.color }}>{selected.tag.name}</span>}</div>
                <div className="fm-info-actions">
                  {!isTrash && <><button type="button" onClick={() => open(selected)}>打开编辑</button><button type="button" onClick={() => rename(selected)}>重命名</button><button type="button" onClick={() => duplicate(selected)}>复制</button><button className="is-danger" type="button" onClick={() => trash(selected)}>删除</button></>}
                  {isTrash && <><button type="button" onClick={() => restore(selected)}>恢复</button><button className="is-danger" type="button" onClick={() => permanentDelete(selected)}>永久删除</button></>}
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>

      {toast && <div className="fm-toast-stack" aria-live="polite"><div className="fm-toast">{toast}</div></div>}
    </>
  )
}
