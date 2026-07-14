import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { subsApi, type Subscription } from '../api/subscriptions'
import type { SubscriptionPlan } from '../api/system'
import { useAuth } from '../store/auth'

const PLAN_LABEL: Record<string, string> = {
  free: '免费学员',
  monthly: '月度会员',
  quarterly: '季度会员',
  half_year: '半年会员',
  lifetime: '终身会员',
}

export default function Member() {
  const me = useAuth((s) => s.user)
  const [sub, setSub] = useState<Subscription | null>(null)
  const [plans, setPlans] = useState<SubscriptionPlan[]>([])
  const [code, setCode] = useState('')
  const [toast, setToast] = useState('')
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2400) }

  useEffect(() => {
    subsApi.me().then(setSub)
    subsApi.plans().then(setPlans)
  }, [])

  const redeem = async () => {
    if (!code.trim()) return
    try {
      const s = await subsApi.redeem(code.trim())
      setSub(s)
      setCode('')
      notify('卡密兑换成功')
    } catch (e) {
      notify(e instanceof Error ? e.message : '兑换失败')
    }
  }

  const requestPlan = async (planId: string) => {
    try {
      await subsApi.createOrder(planId)
      notify('已提交订阅申请，等待管理员确认')
    } catch (e) {
      notify(e instanceof Error ? e.message : '申请失败')
    }
  }

  const isPaid = sub && sub.planId !== 'free'

  return (
    <div className="app" style={{ minHeight: '100vh', background: '#f8fafc' }}>
      <header className="toolbar" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px', background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
        <Link className="um-back" to="/">←</Link>
        <h1 style={{ fontSize: 18, margin: 0 }}>会员中心</h1>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#64748b' }}>{me?.display_name || me?.username}</span>
      </header>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
        {/* 当前订阅 */}
        <div className="um-panel" style={{ padding: 20, marginBottom: 20, background: isPaid ? 'linear-gradient(135deg,#fef3c7,#fde68a)' : '#fff' }}>
          <h2 style={{ marginTop: 0 }}>我的订阅</h2>
          {sub ? (
            <div>
              <p style={{ fontSize: 20, fontWeight: 700, margin: '8px 0' }}>
                {PLAN_LABEL[sub.planId] || sub.planId}
                <span style={{ fontSize: 13, color: '#64748b', marginLeft: 12, fontWeight: 400 }}>
                  {sub.status === 'active' ? '生效中' : sub.status}
                </span>
              </p>
              <p style={{ color: '#64748b', fontSize: 13 }}>
                {sub.expiresAt ? `到期：${new Date(sub.expiresAt).toLocaleDateString('zh-CN')}` : '永久有效'}
              </p>
            </div>
          ) : <p>加载中…</p>}
        </div>

        {/* 卡密兑换 */}
        <div className="um-panel" style={{ padding: 20, marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>卡密兑换</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="输入会员卡密" style={{ flex: 1, padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 6 }} />
            <button className="primary" type="button" onClick={redeem}>兑换</button>
          </div>
        </div>

        {/* 套餐列表 */}
        <h3>套餐方案（点击申请，管理员确认后开通）</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>
          {plans.filter((p) => p.planId !== 'free').map((p) => (
            <div key={p.planId} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, background: p.recommended ? '#fffbeb' : '#fff' }}>
              {p.badgeText && <span style={{ fontSize: 11, color: '#d97706' }}>{p.badgeText}</span>}
              <div style={{ fontWeight: 700, fontSize: 16 }}>{p.name}</div>
              <div style={{ color: '#0ea5e9', fontWeight: 700, margin: '6px 0' }}>{p.originalPriceText}</div>
              <div style={{ fontSize: 12, color: '#64748b', minHeight: 32 }}>{p.benefitText}</div>
              <button type="button" onClick={() => requestPlan(p.planId)} style={{ marginTop: 8, width: '100%' }}>申请开通</button>
            </div>
          ))}
        </div>
      </main>

      {toast && <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#0f172a', color: '#fff', padding: '8px 16px', borderRadius: 8, zIndex: 100 }}>{toast}</div>}
    </div>
  )
}
