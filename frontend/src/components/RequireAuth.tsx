import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { useAuth } from '../store/auth'

interface Props {
  children: ReactNode
  /** 允许的角色；不传则任意登录用户 */
  roles?: string[]
}

export default function RequireAuth({ children, roles }: Props) {
  const { user, initialized, init } = useAuth()
  const location = useLocation()

  useEffect(() => {
    if (!initialized) init()
  }, [initialized, init])

  if (!initialized) {
    return <div style={{ padding: 48, color: '#64748b' }}>加载中…</div>
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="app">
        <div className="stage" style={{ padding: 48, color: '#b91c1c' }}>
          当前角色（{user.role}）无权限访问此页面。
        </div>
      </div>
    )
  }
  return <>{children}</>
}
