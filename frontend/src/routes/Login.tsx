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
          <div className="auth-note">默认管理员 admin / admin123。账号和数据保存在服务端数据库；不同用户的数据互相隔离。</div>
        </form>
      </div>
    </div>
  )
}
