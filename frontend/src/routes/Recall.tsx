import { useEffect, useMemo, useRef, useState, type WheelEvent, type MouseEvent as RMouseEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import type { Question } from '../api/questions'
import { trainingApi } from '../api/training'

const THEMES: [string, string][] = [
  ['platform', '统一默认'], ['parchment', '羊皮纸'], ['aurora', '极光绿'],
  ['neon', '暗夜霓虹'], ['sakura', '樱花粉'], ['ocean', '海盐蓝'], ['latte', '奶油拿铁'],
]

interface RNode { id: string; title: string; x: number; y: number }
interface REdge { from: string; to: string }

export default function Recall() {
  const [sp] = useSearchParams()
  const qid = sp.get('qid')
  const [theme, setTheme] = useState('platform')
  const [q, setQ] = useState<Question | null>(null)
  const [nodes, setNodes] = useState<RNode[]>([])
  const [edges, setEdges] = useState<REdge[]>([])
  const [activeKeywords, setActiveKeywords] = useState<string[]>([])
  const [denied, setDenied] = useState(false)
  const [vp, setVp] = useState({ x: 0, y: 0, scale: 1 })
  const drag = useRef<{ on: boolean; sx: number; sy: number; vx: number; vy: number }>({ on: false, sx: 0, sy: 0, vx: 0, vy: 0 })

  useEffect(() => {
    if (!qid) return
    trainingApi.recallQuestion(qid).then(setQ).catch(() => setDenied(true))
    trainingApi.getRecall(qid).then((p) => { if (p) { setNodes(p.nodes || []); setEdges(p.edges || []); setActiveKeywords(p.activeKeywords || []) } })
  }, [qid])

  const keywords = useMemo(() => {
    const kws: { id: string; text: string }[] = []
    ;(q?.clues || []).forEach((c) => { const id = String((c as Record<string, unknown>).id ?? (c as Record<string, unknown>).text ?? ''); const text = String((c as Record<string, unknown>).text ?? ''); if (id && text) kws.push({ id, text }) })
    ;(q?.concepts || []).forEach((c) => { const id = String((c as Record<string, unknown>).id ?? ''); const text = String((c as Record<string, unknown>).title ?? ''); if (id && text) kws.push({ id, text }) })
    return kws
  }, [q])

  const persist = (n: RNode[], e: REdge[], ak: string[]) => { if (qid) trainingApi.saveRecall(qid, { nodes: n, edges: e, customNodes: {}, activeKeywords: ak }).catch(() => {}) }

  const activate = (kw: { id: string; text: string }) => {
    if (activeKeywords.includes(kw.id) || !qid) return
    const node: RNode = { id: `n_${kw.id}`, title: kw.text, x: 320 + Math.round((Math.random() - 0.5) * 360), y: 180 + Math.round((Math.random() - 0.5) * 220) }
    const nn = [...nodes, node], ne = [...edges, { from: 'root', to: node.id }], ak = [...activeKeywords, kw.id]
    setNodes(nn); setEdges(ne); setActiveKeywords(ak); persist(nn, ne, ak)
  }

  const onWheel = (e: WheelEvent) => setVp((v) => ({ ...v, scale: Math.min(1.75, Math.max(0.45, v.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) }))
  const onDown = (e: RMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.kr-question-card') || (e.target as HTMLElement).closest('.kr-node')) return
    drag.current = { on: true, sx: e.clientX, sy: e.clientY, vx: vp.x, vy: vp.y }
  }
  useEffect(() => {
    const move = (e: globalThis.MouseEvent) => { const d = drag.current; if (!d.on) return; setVp((v) => ({ ...v, x: d.vx + (e.clientX - d.sx), y: d.vy + (e.clientY - d.sy) })) }
    const up = () => { drag.current.on = false }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [])

  const center = () => setVp({ x: 0, y: 0, scale: 1 })
  const reset = () => { setNodes([]); setEdges([]); setActiveKeywords([]); persist([], [], []) }

  if (denied) return <div className="kr-app"><div className="kr-topbar"><Link className="kr-back" to="/training">←</Link> 题目不存在或无权访问</div></div>

  return (
    <div className="kr-app" id="krApp" data-theme={theme}>
      <header className="kr-topbar">
        <div className="kr-brand">
          <Link className="kr-back" to="/training" title="返回训练">←</Link>
          <div>
            <h1>深度知识回忆</h1>
            <p>以题目为中心，点击关键词，像寻宝一样把知识点一层层回忆出来。</p>
          </div>
        </div>
        <div className="kr-tools" aria-label="深度回忆画布工具">
          <label className="kr-theme-control"><span>主题</span>
            <select value={theme} onChange={(e) => setTheme(e.target.value)} aria-label="切换主题">
              {THEMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <button type="button" onClick={center}>回到题目</button>
          <button type="button" onClick={() => setVp((v) => ({ ...v, scale: Math.max(0.45, v.scale / 1.2) }))}>－</button>
          <button type="button" onClick={() => setVp((v) => ({ ...v, scale: Math.min(1.75, v.scale * 1.2) }))}>＋</button>
          <button type="button" onClick={reset}>重置地图</button>
        </div>
      </header>

      <main className="kr-viewport" id="krViewport" aria-label="深度知识回忆无限画布" onWheel={onWheel} onMouseDown={onDown}>
        <div className="kr-world" id="krWorld" style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.scale})`, transformOrigin: 'center center' }}>
          <svg className="kr-edges" id="krEdges" aria-hidden="true">
            {edges.map((e, i) => {
              const a = e.from === 'root' ? { x: 0, y: 0 } : nodes.find((n) => n.id === e.from)
              const b = nodes.find((n) => n.id === e.to)
              if (!a || !b) return null
              return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeWidth={1.5} strokeDasharray="4 4" opacity={0.5} />
            })}
          </svg>
          <section className="kr-question-card" id="krQuestionCard" aria-label="中心题目卡片" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }}>
            {q ? (
              <>
                <div className="kr-question-kicker">{q.domain || '中心题目'}</div>
                <div className="kr-question-text">{q.title}</div>
                <div className="kr-keyword-row">
                  {keywords.length === 0 && <span className="kr-empty-kw">此题暂无关键词标注（请在题库管理补充 clues/concepts）</span>}
                  {keywords.map((kw) => (
                    <button
                      key={kw.id}
                      type="button"
                      className={`kr-keyword-btn${activeKeywords.includes(kw.id) ? ' active' : ''}`}
                      disabled={activeKeywords.includes(kw.id)}
                      onClick={() => activate(kw)}
                    >
                      {kw.text}
                    </button>
                  ))}
                </div>
              </>
            ) : <div className="kr-loading">加载题目…</div>}
          </section>
          <div className="kr-node-layer" id="krNodeLayer">
            {nodes.map((n) => (
              <div key={n.id} className="kr-node" style={{ position: 'absolute', left: n.x, top: n.y, transform: 'translate(-50%,-50%)' }}>
                <span className="kr-node-icon">{n.title.slice(0, 1)}</span>
                <span className="kr-node-title">{n.title}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="kr-hint-pill" id="krHintPill">拖拽空白处移动画布 · 滚轮缩放 · 点击「回到题目」复位</div>
      </main>
    </div>
  )
}
