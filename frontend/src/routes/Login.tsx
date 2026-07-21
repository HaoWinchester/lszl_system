import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { authApi, type WechatLoginConfig } from '../api/auth'
import { useAuth } from '../store/auth'
import { useNewLegacyStyles } from '../hooks/useNewLegacyStyles'

export default function Login() {
  useNewLegacyStyles(['main.css', 'subscription.css', 'user-center.css'], '登录｜项目管理学习营')
  const { login, wechatDemoLogin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('admin123')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const [wx, setWx] = useState<WechatLoginConfig | null>(null)
  const [wxOpen, setWxOpen] = useState(false)
  const [wxErr, setWxErr] = useState('')

  useEffect(() => {
    authApi.wechatConfig().then(setWx).catch(() => setWx(null))
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await login(username, password)
      navigate(from, { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  const demoLogin = async () => {
    setBusy(true)
    setWxErr('')
    try {
      await wechatDemoLogin()
      navigate(from, { replace: true })
    } catch (e) {
      setWxErr(e instanceof Error ? e.message : '微信登录失败')
    } finally {
      setBusy(false)
    }
  }

  const officialLogin = async () => {
    setWxErr('')
    try {
      const { authUrl } = await authApi.wechatAuthUrl()
      window.location.href = authUrl
    } catch (e) {
      setWxErr(e instanceof Error ? e.message : '获取微信授权地址失败')
    }
  }

  const showWx = !!wx && (wx.enableDemo || wx.mode === 'official')

  return (
    <div className="modal-backdrop auth-backdrop show" style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="authTitle">
        <div className="auth-head">
          <div>
            <h2 id="authTitle">登录后可编辑</h2>
            <p>登录后可以新增、编辑、连线和保存自己的内容。</p>
          </div>
        </div>
        <form className="auth-body" onSubmit={submit}>
          <label>用户名
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="请输入用户名" />
          </label>
          <label>密码
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="请输入密码" />
          </label>
          <div className="auth-msg">{err}</div>
          <div className="auth-actions">
            <button className="primary" type="submit" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
          </div>
          {showWx && (
            <div className="wechat-login-section">
              <div className="wechat-divider"><span>或使用微信</span></div>
              <button
                type="button"
                className="wechat-login-entry"
                onClick={() => setWxOpen((v) => !v)}
              >
                微信扫码登录
              </button>
              {wxOpen && (
                <div className="wechat-login-panel">
                  <div className="wechat-login-card">
                    <div className="wechat-login-title">
                      <span className="wechat-icon">微</span>
                      <div>
                        <strong>微信扫码登录</strong>
                        <small>{wx?.mode === 'official' ? '已配置微信开放平台 AppID。' : '未配置 AppID，正式扫码暂不可用。'}</small>
                      </div>
                    </div>
                    <div className="wechat-login-body">
                      <div className="wechat-pseudo-qr" aria-hidden="true" />
                      <div className="wechat-login-copy">
                        <div className="wechat-login-actions">
                          <button
                            type="button"
                            className="wechat-official-btn"
                            disabled={wx?.mode !== 'official' || busy}
                            onClick={officialLogin}
                          >
                            打开微信授权二维码页
                          </button>
                          <button
                            type="button"
                            className="wechat-demo-btn"
                            disabled={!wx?.enableDemo || busy}
                            onClick={demoLogin}
                          >
                            本地演示扫码成功
                          </button>
                        </div>
                        <small className="wechat-login-tip">
                          {wx?.mode === 'official'
                            ? '点击打开微信授权页，扫码确认后自动登录。'
                            : '本地演示会创建一个微信演示账号；正式上线请关闭演示模式。'}
                        </small>
                        {wxErr && <div className="wechat-login-error">{wxErr}</div>}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="auth-note">默认管理员 admin / admin123。账号和数据保存在服务端数据库；不同用户的数据互相隔离。</div>
        </form>
      </div>
    </div>
  )
}
