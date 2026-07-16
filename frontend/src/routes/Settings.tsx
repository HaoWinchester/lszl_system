import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check } from 'lucide-react'

import { systemApi, type AdminLog, type RoleTheme, type SubscriptionPlan } from '../api/system'
import { useAuth } from '../store/auth'

const ROLES: [string, string][] = [
  ['admin', '管理员'],
  ['teacher', '教师/教研'],
  ['student', '学员'],
  ['viewer', '游客'],
]
type Tab = 'themes' | 'wechat' | 'permissions' | 'subscriptions' | 'logs'
const TABS: [Tab, string][] = [
  ['themes', '角色主题'],
  ['wechat', '微信登录'],
  ['permissions', '权限模板'],
  ['subscriptions', '订阅套餐'],
  ['logs', '操作日志'],
]

export default function Settings() {
  const me = useAuth((s) => s.user)
  const [tab, setTab] = useState<Tab>('themes')
  const [themes, setThemes] = useState<Record<string, RoleTheme>>({})
  const [wechat, setWechat] = useState<Record<string, unknown>>({})
  const [perms, setPerms] = useState<{
    roles: string[]
    keys: string[]
    keyLabels: Record<string, string>
    rows: { role: string; permissions: string[] }[]
  } | null>(null)
  const [plans, setPlans] = useState<SubscriptionPlan[]>([])
  const [logs, setLogs] = useState<AdminLog[]>([])
  const [toast, setToast] = useState('')
  const notify = (m: string) => {
    setToast(m)
    setTimeout(() => setToast(''), 2400)
  }

  useEffect(() => {
    systemApi.themes().then(setThemes)
    systemApi.wechatConfig().then(setWechat)
    systemApi.permissions().then(setPerms)
    systemApi.plans().then(setPlans)
    systemApi.logs(80).then(setLogs)
  }, [])

  const saveTheme = async (role: string, t: RoleTheme) => {
    const saved = await systemApi.updateTheme(role, t)
    setThemes({ ...themes, [role]: saved })
    notify(`${role} 主题已保存`)
  }
  const saveWechat = async () => {
    const cfg = await systemApi.updateWechatConfig(wechat)
    setWechat(cfg)
    notify('微信配置已保存')
  }
  const savePlan = async (planId: string, patch: Record<string, unknown>) => {
    const p = await systemApi.updatePlan(planId, patch)
    setPlans(plans.map((x) => (x.planId === planId ? ({ ...x, ...p } as SubscriptionPlan) : x)))
    notify(`${planId} 已保存`)
  }

  return (
    <div className="ss-app">
      <header className="um-topbar ss-topbar">
        <div className="um-brand">
          <Link className="um-back" to="/" title="返回首页"><ArrowLeft size={16} aria-hidden="true" /></Link>
          <div>
            <p className="um-kicker">System Administration</p>
            <h1>系统设置</h1>
            <p>角色主题、登录配置、权限模板与系统操作日志。</p>
          </div>
        </div>
        <div className="um-top-actions">
          <div className="auth-status">{me ? `${me.display_name || me.username}` : '未登录'}</div>
          <Link className="um-nav-btn" to="/users">用户管理</Link>
        </div>
      </header>

      <main className="ss-layout">
        <aside className="ss-sidebar">
          {TABS.map(([k, l]) => (
            <button key={k} className={tab === k ? 'active' : ''} type="button" data-ss-tab={k} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </aside>

        <section className="ss-content">
          <section className={tab === 'themes' ? 'ss-pane active' : 'ss-pane'}>
            <div className="um-panel">
              <div className="um-card-head small">
                <div>
                  <h2>角色主题</h2>
                  <p>为不同角色设置登录后的主题色。</p>
                </div>
              </div>
              <div className="um-role-theme-panel">
                {ROLES.map(([role, label]) => (
                  <ThemeEditor key={role} role={role} label={label} theme={themes[role]} onSave={saveTheme} />
                ))}
              </div>
            </div>
          </section>

          <section className={tab === 'wechat' ? 'ss-pane active' : 'ss-pane'}>
            <div className="um-panel">
              <div className="um-card-head small">
                <div>
                  <h2>微信登录配置</h2>
                  <p>正式接入需要后端 code 换取 openid/unionid。</p>
                </div>
              </div>
              <div className="um-wechat-config">
                <label className="um-field compact">
                  <input
                    type="checkbox"
                    checked={!!wechat.enableDemo}
                    onChange={(e) => setWechat({ ...wechat, enableDemo: e.target.checked })}
                  />{' '}
                  <span>启用本地演示扫码</span>
                </label>
                <label className="um-field compact">
                  <input
                    type="checkbox"
                    checked={!!wechat.enableOfficial}
                    onChange={(e) => setWechat({ ...wechat, enableOfficial: e.target.checked })}
                  />{' '}
                  <span>启用正式微信开放平台</span>
                </label>
                <label className="um-field compact">
                  <input
                    type="checkbox"
                    checked={!!wechat.autoCreateUser}
                    onChange={(e) => setWechat({ ...wechat, autoCreateUser: e.target.checked })}
                  />{' '}
                  <span>首次登录自动创建用户</span>
                </label>
                <label className="um-field">
                  <span>AppID</span>
                  <input value={(wechat.appId as string) || ''} onChange={(e) => setWechat({ ...wechat, appId: e.target.value })} />
                </label>
                <label className="um-field">
                  <span>授权回调地址</span>
                  <input value={(wechat.redirectUri as string) || ''} onChange={(e) => setWechat({ ...wechat, redirectUri: e.target.value })} />
                </label>
                <label className="um-field">
                  <span>后端 code 换取接口</span>
                  <input value={(wechat.backendExchangeUrl as string) || ''} onChange={(e) => setWechat({ ...wechat, backendExchangeUrl: e.target.value })} />
                </label>
                <label className="um-field">
                  <span>scope</span>
                  <input value={(wechat.scope as string) || ''} onChange={(e) => setWechat({ ...wechat, scope: e.target.value })} />
                </label>
                <label className="um-field">
                  <span>默认角色</span>
                  <select value={(wechat.defaultRole as string) || 'student'} onChange={(e) => setWechat({ ...wechat, defaultRole: e.target.value })}>
                    {ROLES.map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </label>
                <label className="um-field">
                  <span>默认科目</span>
                  <input value={(wechat.defaultSubject as string) || 'PMP'} onChange={(e) => setWechat({ ...wechat, defaultSubject: e.target.value })} />
                </label>
                <button className="primary" type="button" onClick={saveWechat}>保存微信配置</button>
              </div>
            </div>
          </section>

          <section className={tab === 'permissions' ? 'ss-pane active' : 'ss-pane'}>
            {perms && (
              <div className="um-panel">
                <div className="um-card-head small">
                  <div>
                    <h2>角色权限模板</h2>
                    <p>正式网络版仍需后端二次校验。</p>
                  </div>
                </div>
                <div className="um-permission-matrix">
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: 8 }}>权限</th>
                        {perms.roles.map((r) => {
                          const label = ROLES.find(([v]) => v === r)?.[1] || r
                          return <th key={r} style={{ textAlign: 'center', padding: 8 }}>{label}</th>
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {perms.keys.map((pk) => (
                        <tr key={pk} style={{ borderTop: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '6px 8px' }}>{perms.keyLabels[pk]}</td>
                          {perms.roles.map((role) => {
                            const ok = perms.rows.find((row) => row.role === role)?.permissions.includes(pk)
                            return (
                              <td key={role} style={{ textAlign: 'center', color: ok ? '#16a34a' : '#cbd5e1' }}>
                                {ok ? <Check size={14} aria-hidden="true" /> : '—'}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          <section className={tab === 'subscriptions' ? 'ss-pane active' : 'ss-pane'}>
            <div className="um-panel">
              <div className="um-card-head small">
                <div>
                  <h2>学员订阅套餐</h2>
                  <p>订阅权益只对学员生效；管理员和教师自动绕过。</p>
                </div>
              </div>
              <div style={{ display: 'grid', gap: 12 }}>
                {plans.map((p) => (
                  <PlanEditor key={p.planId} plan={p} onSave={savePlan} />
                ))}
              </div>
            </div>
          </section>

          <section className={tab === 'logs' ? 'ss-pane active' : 'ss-pane'}>
            <div className="um-panel log-panel">
              <div className="um-card-head small">
                <div>
                  <h2>系统操作日志</h2>
                </div>
                <button
                  type="button"
                  onClick={() => systemApi.clearLogs().then(() => systemApi.logs(80).then(setLogs))}
                >
                  清空
                </button>
              </div>
              <div className="um-log-list">
                {logs.map((l) => (
                  <div key={l.id} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div>
                      {l.action} {l.target_username ? `→ ${l.target_username}` : ''}{' '}
                      <span style={{ color: '#94a3b8' }}>@{l.actor}</span>
                    </div>
                    <div style={{ color: '#94a3b8' }}>{l.detail}</div>
                  </div>
                ))}
                {logs.length === 0 && <p style={{ color: '#94a3b8' }}>暂无日志</p>}
              </div>
            </div>
          </section>
        </section>
      </main>

      {toast && <div className="um-toast" style={{ opacity: 1 }}>{toast}</div>}
    </div>
  )
}

function ThemeEditor({
  role,
  label,
  theme,
  onSave,
}: {
  role: string
  label: string
  theme?: RoleTheme
  onSave: (r: string, t: RoleTheme) => void
}) {
  const [t, setT] = useState<RoleTheme>(
    theme || { primary_color: '#0ea5e9', accent_color: '#0284c7', soft_color: '#e0f2fe', text_color: '#0c4a6e' }
  )
  useEffect(() => {
    if (theme) setT(theme)
  }, [theme])
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
      <strong style={{ minWidth: 80 }}>{label}</strong>
      <label style={{ fontSize: 13 }}>
        主色 <input type="color" value={t.primary_color} onChange={(e) => setT({ ...t, primary_color: e.target.value })} />
      </label>
      <label style={{ fontSize: 13 }}>
        强调 <input type="color" value={t.accent_color} onChange={(e) => setT({ ...t, accent_color: e.target.value })} />
      </label>
      <label style={{ fontSize: 13 }}>
        柔和 <input type="color" value={t.soft_color} onChange={(e) => setT({ ...t, soft_color: e.target.value })} />
      </label>
      <button type="button" onClick={() => onSave(role, t)}>保存</button>
    </div>
  )
}

function PlanEditor({
  plan,
  onSave,
}: {
  plan: SubscriptionPlan
  onSave: (id: string, patch: Record<string, unknown>) => void
}) {
  const [p, setP] = useState(plan)
  useEffect(() => {
    setP(plan)
  }, [plan])
  const field = (k: string, v: unknown) => setP({ ...p, [k]: v })
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <strong style={{ minWidth: 100 }}>{p.name}（{p.planId}）</strong>
        <label className="um-field compact">
          <span>名称</span>
          <input value={p.name} onChange={(e) => field('name', e.target.value)} />
        </label>
        <label className="um-field compact">
          <span>原价</span>
          <input value={p.originalPriceText} onChange={(e) => field('originalPriceText', e.target.value)} />
        </label>
        <label className="um-field compact">
          <span>折扣%</span>
          <input value={p.discountPercent} onChange={(e) => field('discountPercent', e.target.value)} />
        </label>
        <label className="um-field compact">
          <input type="checkbox" checked={p.enabled} onChange={(e) => field('enabled', e.target.checked)} />{' '}
          <span>启用</span>
        </label>
        <label className="um-field compact">
          <input type="checkbox" checked={p.recommended} onChange={(e) => field('recommended', e.target.checked)} />{' '}
          <span>推荐</span>
        </label>
      </div>
      <label className="um-field" style={{ marginTop: 8 }}>
        <span>权益文案</span>
        <input value={p.benefitText || ''} onChange={(e) => field('benefitText', e.target.value)} />
      </label>
      <label className="um-field">
        <span>用量文案</span>
        <input value={p.usageText || ''} onChange={(e) => field('usageText', e.target.value)} />
      </label>
      <button className="primary" type="button" onClick={() => onSave(p.planId, p)} style={{ marginTop: 8 }}>
        保存
      </button>
    </div>
  )
}
