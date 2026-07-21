import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../store/auth'

/** 微信扫码登录回调：拿 ?code&state 换登录，成功跳首页，失败回登录页。挂在 RequireAuth 外。 */
export default function WechatCallback() {
  const { wechatLogin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [err, setErr] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const code = params.get('code')
    const state = params.get('state')
    if (!code || !state) {
      setErr('回调缺少 code / state 参数')
      return
    }
    wechatLogin(code, state)
      .then(() => navigate('/', { replace: true }))
      .catch((e) => setErr(e instanceof Error ? e.message : '微信登录失败'))
  }, [location.search, wechatLogin, navigate])

  return (
    <div className="modal-backdrop auth-backdrop show" style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal auth-modal">
        <div className="auth-body" style={{ textAlign: 'center', padding: 32 }}>
          {err ? (
            <div>
              <div style={{ color: '#b91c1c', marginBottom: 16 }}>{err}</div>
              <button className="primary" type="button" onClick={() => navigate('/login', { replace: true })}>返回登录</button>
            </div>
          ) : (
            <div style={{ color: '#64748b' }}>微信登录中…</div>
          )}
        </div>
      </div>
    </div>
  )
}
