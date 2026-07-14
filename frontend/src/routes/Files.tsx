import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { filesApi, type FileMeta, type Folder } from '../api/files'
import { useAuth } from '../store/auth'

type View = 'recent' | 'favorites' | 'all' | 'trash'

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

export default function Files() {
  const me = useAuth((s) => s.user)
  const navigate = useNavigate()

  const [view, setView] = useState<View>('all')
  const [files, setFiles] = useState<FileMeta[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [stats, setStats] = useState<{ activeCount: number; trashedCount: number; totalNodes: number; totalLinks: number; activeBytes: number; trashedBytes: number } | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('updated')
  const [selected, setSelected] = useState<FileMeta | null>(null)
  const [toast, setToast] = useState('')
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2200) }

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

  return (
    <div className="fm-page">
      <div className="fm-app" id="fileManagerApp">
        {/* 侧栏 */}
        <aside className="fm-sidebar" aria-label="文件管理导航">
          <div className="fm-sidebar-brand-row">
            <Link className="fm-brand" to="/" aria-label="返回知识图谱编辑器">
              <span className="fm-brand-mark" aria-hidden="true">
                <svg viewBox="0 0 48 48"><path d="M12 13 24 7l12 7v13l-12 7-12-7Z" /><circle cx="12" cy="13" r="4" /><circle cx="24" cy="7" r="4" /><circle cx="36" cy="14" r="4" /><circle cx="36" cy="27" r="4" /><circle cx="24" cy="34" r="4" /><circle cx="12" cy="27" r="4" /></svg>
              </span>
              <span className="fm-brand-text"><strong>知识图谱</strong><small>重构版</small></span>
            </Link>
          </div>

          <div className="fm-sidebar-scroll">
            <div className="fm-primary-stack">
              <button className="fm-primary-action" type="button" onClick={create}>
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
                <span>新建图谱</span>
              </button>
            </div>

            <nav className="fm-nav fm-nav-primary" aria-label="文件分类">
              <button className={`fm-nav-item${view === 'all' ? ' is-active' : ''}`} type="button" onClick={() => setView('all')}>
                <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
                <span>全部文件</span><b>{stats?.activeCount ?? 0}</b>
              </button>
              <button className={`fm-nav-item${view === 'trash' ? ' is-active' : ''}`} type="button" onClick={() => setView('trash')}>
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13" /></svg>
                <span>回收站</span><b>{stats?.trashedCount ?? 0}</b>
              </button>
            </nav>

            <section className="fm-folder-nav">
              <div className="fm-folder-nav-head">
                <span className="fm-section-label">文件夹</span>
                <button className="fm-folder-add-btn" type="button" aria-label="新建文件夹" title="新建文件夹" onClick={createFolder}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                </button>
              </div>
              <div className="fm-folder-tree" role="tree">
                {folders.map((f) => (
                  <div key={f.id} className="fm-folder-tree-item" role="treeitem">📂 {f.name}</div>
                ))}
                {folders.length === 0 && <div className="fm-folder-empty" style={{ fontSize: 12, color: '#94a3b8', padding: 4 }}>暂无文件夹</div>}
              </div>
            </section>

            <section className="fm-storage-card">
              <div className="fm-section-label">存储空间</div>
              <div className="fm-storage-head"><strong>{stats ? `${(stats.activeBytes / 1024).toFixed(1)} KB` : '—'}</strong><span>服务端数据库</span></div>
              <dl>
                <div><dt>图谱文件</dt><dd>{stats?.activeCount ?? 0}</dd></div>
                <div><dt>回收站</dt><dd>{stats?.trashedCount ?? 0}</dd></div>
                <div><dt>节点 / 关系</dt><dd>{stats ? `${stats.totalNodes} / ${stats.totalLinks}` : '0 / 0'}</dd></div>
              </dl>
            </section>

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
              <h1>{isTrash ? '回收站' : '文件管理'}</h1>
              <p>{isTrash ? '已删除的文件，30 天内可恢复' : '管理你的知识图谱文件'}</p>
            </div>
            <div className="fm-top-actions">
              <label className="fm-search">
                <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
                <input type="search" autoComplete="off" placeholder="搜索文件名…" value={query} onChange={(e) => setQuery(e.target.value)} />
                <kbd>Ctrl K</kbd>
              </label>
              <label className="fm-icon-btn" title="导入 JSON 文件" style={{ cursor: 'pointer' }}>
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 19h14" /></svg>
                <input type="file" hidden accept=".json,application/json" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
              </label>
              <div className="fm-account-shell">
                <button className="fm-avatar" type="button" aria-label="账号">{(me?.display_name || me?.username || '访').slice(0, 1)}</button>
              </div>
            </div>
          </header>

          <div className="fm-workspace">
            <section className="fm-browser" aria-label="图谱文件">
              <div className="fm-breadcrumb-bar"><span className="fm-breadcrumb">{isTrash ? '回收站' : '全部文件'}</span></div>
              <div className="fm-browser-toolbar">
                <div className="fm-filter-tabs" role="tablist">
                  <button className={isTrash ? '' : 'is-active'} type="button" onClick={() => setView('all')} role="tab">全部 <span>{stats?.activeCount ?? 0}</span></button>
                  <button type="button" role="tab" onClick={() => notify('收藏视图：在文件卡片设置标签')}>有标签</button>
                </div>
                <div className="fm-toolbar-actions">
                  <select aria-label="排序方式" value={sort} onChange={(e) => setSort(e.target.value)}>
                    {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  {isTrash && <button className="fm-danger-ghost" type="button" onClick={emptyTrash}>清空回收站</button>}
                </div>
              </div>

              <div className="fm-content" tabIndex={-1}>
                <section className="fm-file-section">
                  <div className="fm-content-section-head">
                    <h2>{isTrash ? `回收站（${files.length}）` : `文件数（${files.length}）`}</h2>
                  </div>
                  <div className="fm-file-grid" aria-live="polite">
                    {files.map((f) => (
                      <div
                        key={f.id}
                        className={`fm-file-card${selected?.id === f.id ? ' is-selected' : ''}`}
                        onClick={() => setSelected(f)}
                        onDoubleClick={() => open(f)}
                      >
                        <div className="fm-file-name">{f.name}</div>
                        <div className="fm-file-meta">{f.nodeCount} 节点 · {f.linkCount} 关系</div>
                        <div className="fm-file-meta">{isTrash ? `删除于 ${fmtTime(f.updatedAt)}` : `更新于 ${fmtTime(f.updatedAt)}`}</div>
                        <div className="fm-file-tags">{f.tag && <span className="fm-tag-chip" style={{ background: f.tag.color }}>{f.tag.name}</span>}</div>
                        <div className="fm-file-actions" onClick={(e) => e.stopPropagation()}>
                          {isTrash ? (
                            <>
                              <button type="button" onClick={() => restore(f)}>恢复</button>
                              <button type="button" className="is-danger" onClick={() => permanentDelete(f)}>永久删除</button>
                            </>
                          ) : (
                            <>
                              <button type="button" onClick={() => open(f)}>打开</button>
                              <button type="button" onClick={() => rename(f)}>重命名</button>
                              <button type="button" onClick={() => duplicate(f)}>复制</button>
                              <button type="button" className="is-danger" onClick={() => trash(f)}>删除</button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {files.length === 0 && (
                    <div className="fm-empty">
                      <span className="fm-empty-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 7h7l2 2h9v10H3Z" /><path d="M8 14h8" /></svg></span>
                      <h2>{isTrash ? '回收站为空' : '还没有图谱文件'}</h2>
                      <p>{isTrash ? '删除的文件会出现在这里' : '创建一个新图谱，或导入已有文件。'}</p>
                      {!isTrash && <button className="fm-primary-inline" type="button" onClick={create}>新建图谱</button>}
                    </div>
                  )}
                </section>
              </div>
              <footer className="fm-browser-footer"><span>共 {files.length} 个文件</span><span>文件索引正常</span></footer>
            </section>
          </div>
        </main>

        {/* 详情抽屉 */}
        {selected && (
          <>
            <div className="fm-drawer-backdrop" onClick={() => setSelected(null)} />
            <aside className="fm-details-drawer" aria-label="文件详情">
              <section className="fm-panel fm-file-info">
                <div className="fm-panel-title"><h2>文件信息</h2><button className="fm-icon-btn fm-small" type="button" onClick={() => setSelected(null)}>×</button></div>
                <div className="fm-info-body">
                  <div className="fm-info-kind">图谱文件</div>
                  <h3>{selected.name}</h3>
                  <dl>
                    <div><dt>更新时间</dt><dd>{fmtTime(selected.updatedAt)}</dd></div>
                    <div><dt>创建时间</dt><dd>{fmtTime(selected.createdAt)}</dd></div>
                    <div><dt>节点数量</dt><dd>{selected.nodeCount}</dd></div>
                    <div><dt>关系数量</dt><dd>{selected.linkCount}</dd></div>
                    <div><dt>文件大小</dt><dd>{(selected.byteSize / 1024).toFixed(1)} KB</dd></div>
                  </dl>
                  <div className="fm-info-tags">{selected.tag && <span className="fm-tag-chip" style={{ background: selected.tag.color }}>{selected.tag.name}</span>}</div>
                  <div className="fm-info-actions">
                    {!isTrash && <button type="button" onClick={() => open(selected)}>打开编辑</button>}
                  </div>
                </div>
              </section>
            </aside>
          </>
        )}
      </div>

      {toast && <div className="fm-toast-stack" aria-live="polite"><div className="fm-toast">{toast}</div></div>}
    </div>
  )
}
