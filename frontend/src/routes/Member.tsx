import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { subsApi, type Subscription } from '../api/subscriptions'
import type { SubscriptionPlan } from '../api/system'
import { AppIcon } from '../components/AppIcon'
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

  return (
    <div className="modal-backdrop user-subscription-detail-backdrop show" style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal kg-subscription-detail-modal" role="dialog" aria-modal="true" aria-labelledby="userSubscriptionDetailTitle">
        <div className="kg-user-center-head">
          <div className="kg-user-center-title">
            <div className="kg-user-avatar">{(me?.display_name || me?.username || '会').slice(0, 1)}</div>
            <div>
              <h2 id="userSubscriptionDetailTitle">会员权益</h2>
              <p>查看各会员方案权益。点击方案提交订阅申请，管理员确认后开通；也可使用卡密直接兑换。</p>
            </div>
          </div>
          <Link className="kg-user-center-close kg-icon-button" to="/" aria-label="关闭" title="返回首页"><AppIcon name="close" size="default" /></Link>
        </div>

        <div className="kg-subscription-detail-body">
          {sub && (
            <div className="kg-user-subscription-main">
              <div className="kg-user-subscription-box">
                <div className="kg-user-subscription-meta">
                  <strong>{PLAN_LABEL[sub.planId] || sub.planId}</strong>
                  <span>{sub.status === 'active' ? '生效中' : sub.status}</span>
                  <span>{sub.expiresAt ? `到期：${new Date(sub.expiresAt).toLocaleDateString('zh-CN')}` : '永久有效'}</span>
                </div>
                <div className="kg-user-subscription-note">当前账号：{me?.username || '未登录'}</div>
              </div>
            </div>
          )}

          <div className="kg-subscription-detail-grid">
            {plans.filter((p) => p.planId !== 'free').map((p) => {
              const current = sub?.planId === p.planId
              const benefits = (p.benefitText || p.usageText || '').split(/[;；\n]/).map((s) => s.trim()).filter(Boolean)
              return (
                <article
                  key={p.planId}
                  className={`subscription-plan-card kg-subscription-purchase-card${p.recommended ? ' recommended' : ''}${current ? ' current' : ''}`}
                  data-plan-id={p.planId}
                >
                  <div className="subscription-plan-head">
                    <h3>{p.name}</h3>
                    <span>{current ? '当前方案' : (p.badgeText || p.name)}</span>
                  </div>
                  <div className="kg-subscription-purchase-price">
                    <strong>{p.originalPriceText || '待配置'}</strong>
                    {p.discountPercent && <em>{p.discountPercent}</em>}
                  </div>
                  <p className="kg-subscription-plan-desc">{p.benefitText || ''}</p>
                  {benefits.length > 0 && (
                    <ul className="kg-subscription-benefit-list">{benefits.map((b, i) => <li key={i}>{b}</li>)}</ul>
                  )}
                  {p.usageText && <div className="subscription-limit-note kg-subscription-usage-text">{p.usageText}</div>}
                  <button
                    className="kg-subscription-card-cta um-action-with-icon"
                    type="button"
                    onClick={() => requestPlan(p.planId)}
                    aria-label={`${current ? '续费' : '选择'} ${p.name}`}
                    title={`${current ? '续费' : '选择'} ${p.name}`}
                  >
                    <AppIcon name="add" size="compact" />{current ? '续费当前方案' : '选择该方案'}
                  </button>
                </article>
              )
            })}
          </div>

          <div className="kg-subscription-redeem-panel">
            <div className="kg-subscription-redeem-title"><strong>卡密使用</strong></div>
            <div className="kg-subscription-redeem-form">
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="请输入会员卡密，例如 VIP-XXXX-XXXX-XXXX" autoComplete="off" />
              <button type="button" className="primary" onClick={redeem}>兑换卡密</button>
            </div>
            <div className="kg-subscription-redeem-msg">{toast}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
