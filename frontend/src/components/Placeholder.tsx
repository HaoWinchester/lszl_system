import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface PlaceholderProps {
  title: string
  stage: number
  children?: ReactNode
}

/** 阶段 1 的页面占位：套用现有 main.css 的 .app/.toolbar/.brand/.stage 样式。 */
export default function Placeholder({ title, stage, children }: PlaceholderProps) {
  return (
    <div className="app">
      <div className="toolbar">
        <div className="brand">
          <h1>{title}（占位 · 阶段 {stage}）</h1>
        </div>
        <Link to="/" style={{ marginLeft: 20 }}>
          ← 返回首页
        </Link>
      </div>
      <div className="stage" style={{ padding: 24, color: '#0f172a' }}>
        {children ?? <p>此页面将在阶段 {stage} 对照原页面实现。</p>}
      </div>
    </div>
  )
}
