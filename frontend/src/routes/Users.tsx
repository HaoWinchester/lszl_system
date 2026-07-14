import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { type AppUser } from '../api/auth'
import { systemApi, type AdminLog } from '../api/system'
import { usersApi } from '../api/users'
import { useAuth } from '../store/auth'

const ROLES: [string, string][] = [
  ['admin', '管理员'],
  ['teacher', '教师/教研'],
  ['student', '学员'],
  ['viewer', '游客'],
]
const STATUSES: [string, string][] = [
  ['active', '正常'],
  ['paused', '暂停'],
  ['archived', '已归档'],
]
const SUBJECTS = ['PMP', 'CSPM', 'P2', 'ACP', 'NPDP', 'PgMP', 'PfMP', 'CUSTOM']

const ROLE_LABEL: Record<string, string> = Object.fromEntries(ROLES)
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES)

interface EditForm {
  display_name: string
  email: string
  phone: string
  role: string
  status: string
  subject: string
  tags: string
  note: string
}

const emptyForm: EditForm = {
  display_name: '',
  email: '',
  phone: '',
  role: 'student',
  status: 'active',
  subject: 'PMP',
  tags: '',
  note: '',
}

function formFromUser(u: AppUser): EditForm {
  return {
    display_name: u.display_name ?? '',
    email: u.email ?? '',
    phone: u.phone ?? '',
    role: u.role,
    status: u.status,
    subject: u.subject ?? 'PMP',
    tags: (u.tags ?? []).join(', '),
    note: u.note ?? '',
  }
}

export default function Users() {
  const me = useAuth((s) => s.user)
  const setUser = useAuth((s) => s.setUser)

  const [users, setUsers] = useState<AppUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [query, setQuery] = useState('')
  const [roleF, setRoleF] = useState('ALL')
  const [statusF, setStatusF] = useState('ALL')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<AppUser | null>(null)
  const [form, setForm] = useState<EditForm>(emptyForm)
  const [logs, setLogs] = useState<AdminLog[]>([])
  const [perms, setPerms] = useState<{ rows: { role: string; permissions: string[] }[] } | null>(null)
  const [rightTab, setRightTab] = useState<'actions' | 'permissions' | 'logs'>('actions')
  const [toast, setToast] = useState('')

  const notify = (m: string) => {
    setToast(m)
    setTimeout(() => setToast(''), 2400)
  }

  const reload = useCallback(async () => {
    const data = await usersApi.list({ query, role: roleF, status: statusF, page, page_size: pageSize })
    setUsers(data.users)
    setTotal(data.total)
    setSelected(new Set())
  }, [query, roleF, statusF, page, pageSize])

  useEffect(() => {
    reload()
  }, [reload])

  const reloadLogs = () => systemApi.logs(60).then(setLogs)
  useEffect(() => {
    reloadLogs()
    systemApi.permissions().then(setPerms)
  }, [])

  const selectUser = (u: AppUser) => {
    setEditing(u)
    setForm(formFromUser(u))
  }

  const update = (k: keyof EditForm, v: string) => setForm((f) => ({ ...f, [k]: v }))

  // ---------- 操作 ----------
  const newUser = async () => {
    const username = window.prompt('新用户名（≥2字符）')
    if (!username) return
    const password = window.prompt(`为 ${username} 设置初始密码（≥4字符）`) || ''
    try {
      const u = await usersApi.create({ username, password, role: 'student', status: 'active', subject: 'PMP' })
      notify(`已创建用户 ${username}`)
      await reload()
      reloadLogs()
      selectUser(u)
    } catch (e) {
      notify(e instanceof Error ? e.message : '创建失败')
    }
  }

  const save = async () => {
    if (!editing) return
    try {
      const u = await usersApi.update(editing.username, {
        display_name: form.display_name || null,
        email: form.email || null,
        phone: form.phone || null,
        role: form.role,
        status: form.status,
        subject: form.subject,
        tags: form.tags ? form.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [],
        note: form.note || null,
      })
      notify('已保存')
      if (me?.username === editing.username) setUser(u)
      setEditing(u)
      await reload()
      reloadLogs()
    } catch (e) {
      notify(e instanceof Error ? e.message : '保存失败')
    }
  }

  const resetPwd = async () => {
    if (!editing) return
    const pw = window.prompt(`为 ${editing.username} 设置新密码（≥4字符）`)
    if (!pw) return
    try {
      await usersApi.resetPassword(editing.username, pw)
      notify('密码已重置')
      reloadLogs()
    } catch (e) {
      notify(e instanceof Error ? e.message : '重置失败')
    }
  }

  const changeStatus = async (status: string) => {
    if (!editing) return
    try {
      const u = await usersApi.setStatus(editing.username, status)
      notify(`已${STATUS_LABEL[status]}`)
      setEditing(u)
      setForm((f) => ({ ...f, status }))
      await reload()
      reloadLogs()
    } catch (e) {
      notify(e instanceof Error ? e.message : '操作失败')
    }
  }

  const duplicate = async () => {
    if (!editing) return
    const un = window.prompt(`复制 ${editing.username} 为新用户名`)
    if (!un) return
    const pw = window.prompt(`为 ${un} 设置密码`) || ''
    try {
      const u = await usersApi.duplicate(editing.username, un, pw)
      notify('已复制为新用户')
      await reload()
      reloadLogs()
      selectUser(u)
    } catch (e) {
      notify(e instanceof Error ? e.message : '复制失败')
    }
  }

  const remove = async (u: AppUser) => {
    if (!window.confirm(`确认删除账号 ${u.username}？`)) return
    try {
      await usersApi.remove(u.username)
      notify('已删除')
      if (editing?.username === u.username) {
        setEditing(null)
        setForm(emptyForm)
      }
      await reload()
      reloadLogs()
    } catch (e) {
      notify(e instanceof Error ? e.message : '删除失败')
    }
  }

  const toggleSelect = (un: string) => {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(un)) n.delete(un)
      else n.add(un)
      return n
    })
  }

  const selectAllPage = (checked: boolean) => {
    setSelected(checked ? new Set(users.map((u) => u.username)) : new Set())
  }

  const batchApply = async (role: string, status: string, subject: string) => {
    if (selected.size === 0) return notify('未选择用户')
    try {
      await usersApi.batchUpdate({
        usernames: [...selected],
        role: role === 'KEEP' ? undefined : role,
        status: status === 'KEEP' ? undefined : status,
        subject: subject === 'KEEP' ? undefined : subject,
      })
      notify('批量应用完成')
      await reload()
      reloadLogs()
    } catch (e) {
      notify(e instanceof Error ? e.message : '批量失败')
    }
  }

  const batchDelete = async () => {
    if (selected.size === 0 || !window.confirm(`删除所选 ${selected.size} 个用户？`)) return
    try {
      await usersApi.batchDelete([...selected])
      notify('已删除所选用户')
      await reload()
      reloadLogs()
    } catch (e) {
      notify(e instanceof Error ? e.message : '删除失败')
    }
  }

  const exportAll = async () => {
    const payload = await usersApi.exportUsers()
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'users-export.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importFile = async (file: File) => {
    try {
      const payload = JSON.parse(await file.text())
      const r = await usersApi.importUsers(payload)
      notify(`导入 ${r.added} 个，跳过 ${r.skipped} 个`)
      await reload()
      reloadLogs()
    } catch (e) {
      notify(e instanceof Error ? e.message : '导入失败')
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="um-app">
      <header className="um-topbar">
        <div className="um-brand">
          <Link className="um-back" to="/" title="返回首页">←</Link>
          <div>
            <p className="um-kicker">User Administration</p>
            <h1>用户管理</h1>
            <p>管理账号资料、角色状态、归档与操作日志。</p>
          </div>
        </div>
        <div className="um-top-actions">
          <div className="auth-status">{me ? `${me.display_name || me.username} · ${ROLE_LABEL[me.role]}` : '未登录'}</div>
          <button type="button" className="primary" onClick={newUser}>+ 新用户</button>
          <button type="button" onClick={exportAll}>导出用户</button>
          <label className="um-nav-btn" style={{ cursor: 'pointer' }}>
            导入用户
            <input
              type="file"
              hidden
              accept=".json,application/json"
              onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
            />
          </label>
          <Link className="um-nav-btn" to="/settings">系统设置</Link>
        </div>
      </header>

      <main className="um-layout">
        <aside className="um-left-card">
          <div className="um-card-head">
            <div>
              <h2>用户列表</h2>
              <p>共 {total} 个账号</p>
            </div>
          </div>
          <div className="um-list-tools">
            <label className="um-field compact">
              <span>搜索用户</span>
              <input type="search" placeholder="用户名 / 姓名 / 邮箱 / 科目" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} />
            </label>
            <div className="um-filter-row">
              <label className="um-field compact">
                <span>角色</span>
                <select value={roleF} onChange={(e) => { setRoleF(e.target.value); setPage(1) }}>
                  <option value="ALL">全部角色</option>
                  {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="um-field compact">
                <span>状态</span>
                <select value={statusF} onChange={(e) => { setStatusF(e.target.value); setPage(1) }}>
                  <option value="ALL">全部状态</option>
                  {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>

            <section className="um-batch-toolbar">
              <label className="um-select-all">
                <input type="checkbox" checked={selected.size === users.length && users.length > 0} onChange={(e) => selectAllPage(e.target.checked)} />
                <span>全选当前页（已选 {selected.size}）</span>
              </label>
              <div className="um-batch-grid">
                <BatchSelect title="角色" onChange={(v) => batchApply(v, 'KEEP', 'KEEP')} keep options={ROLES} />
                <BatchSelect title="状态" onChange={(v) => batchApply('KEEP', v, 'KEEP')} keep options={STATUSES} />
                <BatchSelect title="科目" onChange={(v) => batchApply('KEEP', 'KEEP', v)} keep options={SUBJECTS.map((s) => [s, s] as [string, string])} />
              </div>
              <div className="um-batch-actions">
                <button className="danger" type="button" onClick={batchDelete}>删除所选</button>
                <button type="button" onClick={() => setSelected(new Set())}>清除选择</button>
              </div>
            </section>
          </div>

          <div className="um-user-list">
            {users.map((u) => (
              <div
                key={u.username}
                className={`um-user-item${editing?.username === u.username ? ' active' : ''}`}
                onClick={() => selectUser(u)}
                style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid #eef2f7' }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(u.username)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSelect(u.username)}
                  style={{ marginRight: 8 }}
                />
                <strong>{u.display_name || u.username}</strong>
                <span style={{ color: '#64748b', marginLeft: 8 }}>({u.username})</span>
                <span style={{ float: 'right', fontSize: 12 }}>
                  <span className={`um-tag role-${u.role}`}>{ROLE_LABEL[u.role]}</span>{' '}
                  <span className={`um-tag status-${u.status}`}>{STATUS_LABEL[u.status]}</span>
                </span>
              </div>
            ))}
            {users.length === 0 && <p style={{ padding: 16, color: '#94a3b8' }}>无匹配用户</p>}
          </div>

          <div className="um-pagination">
            <div className="um-page-info">第 {page} / {totalPages} 页</div>
            <div className="um-page-actions">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</button>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>下一页</button>
            </div>
            <label className="um-page-size">
              <span>每页</span>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}>
                {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        </aside>

        <section className="um-editor-card">
          <div className="um-card-head">
            <div>
              <h2>{editing ? '编辑用户' : '用户资料'}</h2>
              <p>{editing ? `@${editing.username}` : '选择左侧用户后编辑'}</p>
            </div>
            <span className="um-save-state">{editing ? editing.status : '未选择'}</span>
          </div>

          <form className="um-form" onSubmit={(e) => { e.preventDefault(); save() }}>
            <div className="um-grid two">
              <label className="um-field">
                <span>用户名</span>
                <input value={editing?.username ?? ''} readOnly placeholder="username" />
              </label>
              <label className="um-field">
                <span>显示名称</span>
                <input value={form.display_name} onChange={(e) => update('display_name', e.target.value)} disabled={!editing} />
              </label>
              <label className="um-field">
                <span>角色</span>
                <select value={form.role} onChange={(e) => update('role', e.target.value)} disabled={!editing}>
                  {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="um-field">
                <span>状态</span>
                <select value={form.status} onChange={(e) => update('status', e.target.value)} disabled={!editing}>
                  {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="um-field">
                <span>邮箱</span>
                <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} disabled={!editing} />
              </label>
              <label className="um-field">
                <span>手机 / 联系方式</span>
                <input value={form.phone} onChange={(e) => update('phone', e.target.value)} disabled={!editing} />
              </label>
              <label className="um-field">
                <span>主要科目</span>
                <select value={form.subject} onChange={(e) => update('subject', e.target.value)} disabled={!editing}>
                  {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="um-field">
                <span>标签（逗号分隔）</span>
                <input value={form.tags} onChange={(e) => update('tags', e.target.value)} disabled={!editing} />
              </label>
            </div>
            <label className="um-field">
              <span>备注 / 存档说明</span>
              <textarea rows={4} value={form.note} onChange={(e) => update('note', e.target.value)} disabled={!editing} />
            </label>
            <div className="um-action-row">
              <button className="primary" type="submit" disabled={!editing}>保存用户资料</button>
              <button type="button" onClick={resetPwd} disabled={!editing}>重置密码</button>
              <button type="button" onClick={() => editing && changeStatus('paused')} disabled={!editing}>暂停</button>
              <button type="button" onClick={() => editing && changeStatus('active')} disabled={!editing}>设为正常</button>
              <button type="button" onClick={duplicate} disabled={!editing}>复制为新用户</button>
              <button className="danger" type="button" onClick={() => editing && remove(editing)} disabled={!editing}>删除账号</button>
            </div>
          </form>
        </section>

        <aside className="um-right-card">
          <nav className="um-right-tabbar">
            <button className={rightTab === 'actions' ? 'active' : ''} type="button" onClick={() => setRightTab('actions')}>操作</button>
            <button className={rightTab === 'permissions' ? 'active' : ''} type="button" onClick={() => setRightTab('permissions')}>权限</button>
            <button className={rightTab === 'logs' ? 'active' : ''} type="button" onClick={() => setRightTab('logs')}>日志</button>
          </nav>
          {rightTab === 'actions' && (
            <section className="um-panel">
              <div className="um-card-head small"><div><h2>存档说明</h2></div></div>
              <ul className="um-help-list">
                <li>正常：可登录并使用。</li>
                <li>暂停：临时停用，可恢复。</li>
                <li>已归档：保留资料，登录被拦截。</li>
                <li>删除账号：移除账号资料。</li>
              </ul>
            </section>
          )}
          {rightTab === 'permissions' && perms && (
            <section className="um-panel">
              <div className="um-card-head small"><div><h2>角色权限模板</h2></div></div>
              <div className="um-permission-matrix">
                {perms.rows.map((r) => (
                  <div key={r.role} style={{ marginBottom: 10 }}>
                    <strong>{ROLE_LABEL[r.role] || r.role}</strong>
                    <span style={{ color: '#64748b', marginLeft: 8, fontSize: 12 }}>{r.permissions.length} 项</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          {rightTab === 'logs' && (
            <section className="um-panel log-panel">
              <div className="um-card-head small">
                <div><h2>最近操作日志</h2></div>
                <button type="button" onClick={() => { systemApi.clearLogs().then(reloadLogs) }}>清空</button>
              </div>
              <div className="um-log-list">
                {logs.map((l) => (
                  <div key={l.id} className="um-log-item" style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div>{l.action} {l.target_username ? `→ ${l.target_username}` : ''} <span style={{ color: '#94a3b8' }}>@{l.actor}</span></div>
                    <div style={{ color: '#94a3b8' }}>{l.detail}</div>
                  </div>
                ))}
                {logs.length === 0 && <p style={{ color: '#94a3b8' }}>暂无日志</p>}
              </div>
            </section>
          )}
        </aside>
      </main>

      {toast && <div className="um-toast" style={{ opacity: 1 }}>{toast}</div>}
    </div>
  )
}

function BatchSelect({
  title,
  options,
  keep,
  onChange,
}: {
  title: string
  options: [string, string][]
  keep?: boolean
  onChange: (v: string) => void
}) {
  return (
    <select title={`批量设置${title}`} onChange={(e) => { onChange(e.target.value); e.target.selectedIndex = 0 }}>
      {keep && <option value="KEEP">{title}不变</option>}
      {options.map(([v, l]) => <option key={v} value={v}>设为{l}</option>)}
    </select>
  )
}
