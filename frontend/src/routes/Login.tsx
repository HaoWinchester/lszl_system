import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../store/auth'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('admin123')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

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

  return (
    <div className="app">
      <div className="toolbar">
        <div className="brand">
          <h1>登录</h1>
        </div>
      </div>
      <div className="stage" style={{ padding: 40, maxWidth: 360, margin: '48px auto' }}>
        <form onSubmit={submit} className="um-form">
          <label className="um-field">
            <span>用户名</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>
          <label className="um-field">
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {err && <p style={{ color: '#dc2626', fontSize: 13 }}>{err}</p>}
          <div className="um-action-row">
            <button className="primary" type="submit" disabled={busy}>
              {busy ? '登录中…' : '登录'}
            </button>
          </div>
          <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 12 }}>
            默认管理员 admin / admin123
          </p>
        </form>
      </div>
    </div>
  )
}
