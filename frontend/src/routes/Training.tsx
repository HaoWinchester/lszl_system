import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, ChevronDown, X } from 'lucide-react'

import { papersApi, type Paper, type Question } from '../api/questions'
import { trainingApi } from '../api/training'
import { useAuth } from '../store/auth'

type QTab = 'question' | 'graph' | 'notes'
type FontSize = 'small' | 'normal' | 'large' | 'xlarge'

export default function Training() {
  const me = useAuth((s) => s.user)
  const [tab, setTab] = useState<QTab>('question')
  const [font, setFont] = useState<FontSize>('normal')
  const [papers, setPapers] = useState<Paper[]>([])
  const [paperId, setPaperId] = useState<string | null>(null)
  const [paper, setPaper] = useState<Paper | null>(null)
  const [idx, setIdx] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => { papersApi.list('published').then(setPapers) }, [])
  useEffect(() => {
    if (paperId) {
      papersApi.get(paperId).then((p) => { setPaper(p); setIdx(0); setSelected(null); setSubmitted(false) })
    } else { setPaper(null) }
  }, [paperId])

  const q: Question | undefined = paper?.questions?.[idx]
  useEffect(() => {
    if (!q) return
    setSelected(null); setSubmitted(false)
    trainingApi.getProgress(q.id).then((p) => { if (p) { setSelected(p.selectedAnswer); setSubmitted(p.submitted) } })
  }, [q])

  const choose = async (opt: string) => {
    if (submitted || !q) return
    setSelected(opt)
    await trainingApi.saveProgress(q.id, { selectedAnswer: opt, submitted: false, bankId: q.bankId, paperId })
  }
  const submit = async () => {
    if (!q || !selected) return
    setSubmitted(true)
    await trainingApi.saveProgress(q.id, { selectedAnswer: selected, submitted: true, bankId: q.bankId, paperId })
  }
  const correctId = q?.correctAnswer || q?.options.find((o) => o.correct)?.id || null

  return (
    <div className="question-training-page">
      <div className="question-training-app">
        <header className="qt-topbar">
          <div className="qt-brand">
            <Link className="qt-back-link" to="/" title="返回知识图谱首页"><ArrowLeft size={16} aria-hidden="true" /></Link>
            <div>
              <h1>考题训练</h1>
              <p>独立训练页面：支持单题、当前题库与已发布综合试卷训练。</p>
            </div>
          </div>
          <div className="qt-actions">
            <Link className="qt-nav-btn" to="/question-bank">题库管理</Link>
            <Link className="qt-nav-btn" to="/users">用户管理</Link>
            <Link className="qt-nav-btn" to="/settings">系统设置</Link>
            <Link className="qt-nav-btn" to="/recall">深度回忆</Link>
            <div className={`auth-status${me ? ' logged-in' : ''}`}>{me ? (me.display_name || me.username) : '访客'}</div>
            <button className="auth-login-btn" type="button" hidden>登录</button>
            <button className="auth-logout-btn" type="button" hidden>退出登录</button>
          </div>
        </header>

        <main className={`question-page-shell show q-font-${font}`} id="questionModal" aria-label="考题训练独立页面">
          <div className="modal question-modal" role="dialog" aria-labelledby="questionTitle">
            <div className="question-head">
              <div>
                <h2 id="questionTitle">考题破案模式｜综合训练</h2>
                <div className="sub">像侦探一样点击题干线索，推导答案。</div>
                <div className="question-font-tools" aria-label="字体缩放">
                  <span className="font-tool-label">字体</span>
                  {([['small', 'A-'], ['normal', 'A'], ['large', 'A+'], ['xlarge', 'A++']] as [FontSize, string][]).map(([v, l]) => (
                    <button key={v} type="button" title={`${v} 字体`} className={font === v ? 'active' : ''} onClick={() => setFont(v)}>{l}</button>
                  ))}
                </div>
              </div>
              <Link className="question-close" to="/" title="返回首页"><ArrowLeft size={16} aria-hidden="true" /> 首页</Link>
            </div>

            <div className="q-tabs" aria-label="破案模式内容切换" role="tablist">
              <button className={`q-tab${tab === 'question' ? ' active' : ''}`} role="tab" type="button" onClick={() => setTab('question')}>题目</button>
              <button className={`q-tab${tab === 'graph' ? ' active' : ''}`} role="tab" type="button" onClick={() => setTab('graph')}>推理图谱</button>
              <button className={`q-tab${tab === 'notes' ? ' active' : ''}`} role="tab" type="button" onClick={() => setTab('notes')}>侦探笔记</button>
            </div>

            <div className="question-body q-case-body">
              <section className={`q-panel q-tab-panel${tab === 'question' ? ' active' : ''}`} role="tabpanel" hidden={tab !== 'question'}>
                <div className="q-question-layout">
                  <div className="q-question-main">
                    <div className="q-paper-bar">
                      <label>综合试卷
                        <select value={paperId || ''} onChange={(e) => setPaperId(e.target.value || null)}>
                          <option value="">单题 / 当前题库训练</option>
                          {papers.map((p) => <option key={p.id} value={p.id}>{p.name}（{p.questionCount}题）</option>)}
                        </select>
                      </label>
                      <span id="qPaperProgress">{paper ? `第 ${idx + 1} / ${paper.questions!.length} 题` : '未选择试卷'}</span>
                    </div>

                    {!paper ? (
                      <div className="q-empty">
                        <h3 id="qQuestionHeading">请选择一套综合试卷开始训练</h3>
                        <p style={{ color: '#64748b' }}>仅显示已发布试卷。如需新建，请到题库管理创建并发布。</p>
                      </div>
                    ) : !q ? (
                      <p>该试卷暂无题目。</p>
                    ) : (
                      <>
                        <h3 id="qQuestionHeading">题目：{q.title}</h3>
                        <div className="q-options" id="qOptions">
                          {q.options.map((o) => {
                            const ok = submitted && o.id === correctId
                            const bad = submitted && selected === o.id && o.id !== correctId
                            return (
                              <label key={o.id} className={`q-option${ok ? ' correct' : ''}${bad ? ' wrong' : ''}`}>
                                <input type="radio" name={q.id} checked={selected === o.id} onChange={() => choose(o.id)} disabled={submitted} />
                                <span className="q-option-key">{o.id}</span>
                                <span className="q-option-text">{o.text}</span>
                                {ok && <em className="q-option-mark"><Check size={14} aria-hidden="true" /></em>}
                                {bad && <em className="q-option-mark"><X size={14} aria-hidden="true" /></em>}
                              </label>
                            )
                          })}
                        </div>
                        {submitted && (
                          <div className="q-analysis">
                            <strong>解析：</strong>{q.analysis || '（暂无解析）'}
                            {correctId && <div className="q-answer">正确答案：{correctId}</div>}
                          </div>
                        )}
                        <div className="q-actions">
                          <button type="button" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>上一题</button>
                          <button type="button" disabled={!paper.questions || idx >= paper.questions.length - 1} onClick={() => setIdx(idx + 1)}>下一题</button>
                          {!submitted && <button className="primary" type="button" disabled={!selected} onClick={submit}>提交答案</button>}
                          <button type="button" onClick={() => { setSelected(null); setSubmitted(false) }}>重置本题</button>
                          <Link to={`/recall?qid=${q.id}`} target="_blank" rel="noopener">深度回忆</Link>
                        </div>
                        <div className="q-mini-note">提示：点击题干中你认为有价值的关键词；完整线索解释请到「侦探笔记」查看。</div>
                      </>
                    )}
                  </div>
                  <aside className="q-evidence-dock" aria-label="简易证据栏">
                    <div className="q-evidence-head"><span>证据栏</span><small>简略</small></div>
                    <div className="q-chip-list" id="qClues">
                      {(q?.clues || []).map((c, i) => <span key={i} className="q-chip">{String((c as Record<string, unknown>).text ?? '')}</span>)}
                      {(!q || (q.clues || []).length === 0) && <small className="q-empty-note">暂无线索</small>}
                    </div>
                    <div className="q-score" id="qScore">{submitted ? (selected === correctId ? <><Check size={14} aria-hidden="true" /> 答对</> : <><X size={14} aria-hidden="true" /> 答错</>) : ''}</div>
                  </aside>
                </div>
              </section>

              <section className={`q-panel q-tab-panel${tab === 'graph' ? ' active' : ''}`} role="tabpanel" hidden={tab !== 'graph'}>
                <div className="q-tab-section-head">
                  <div><h3>推理图谱</h3><p>按“关键词 → 回忆知识点 → 提炼判断规则 → 锁定答案”逐步解锁推理链。</p></div>
                </div>
                <div className="q-graph" id="qGraph">
                  {!q ? <p style={{ color: '#64748b' }}>请选择题库与题目后查看推理图谱。</p> : (
                    <div className="q-reasoning-chain" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 560 }}>
                      <div className="q-reasoning-step"><div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><span style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, borderRadius: '50%', background: '#2563eb', color: '#fff', fontSize: 12, fontWeight: 800 }}>1</span><strong>关键词线索</strong></div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{(q.clues || []).length ? (q.clues || []).map((c, i) => <span key={i} style={{ background: '#eef2ff', color: '#3730a3', border: '1px solid #c7d2fe', borderRadius: 999, padding: '3px 10px', fontSize: 13 }}>{String((c as Record<string, unknown>).text ?? '')}</span>) : <span style={{ color: '#94a3b8', fontSize: 13 }}>暂无关键词</span>}</div></div>
                      <div style={{ textAlign: 'center', color: '#94a3b8' }}><ChevronDown size={16} aria-hidden="true" /></div>
                      <div className="q-reasoning-step"><div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><span style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, borderRadius: '50%', background: '#7c3aed', color: '#fff', fontSize: 12, fontWeight: 800 }}>2</span><strong>回忆知识点</strong></div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{(q.concepts || []).length ? (q.concepts || []).map((c, i) => <span key={i} style={{ background: '#f5f3ff', color: '#5b21b6', border: '1px solid #ddd6fe', borderRadius: 8, padding: '3px 10px', fontSize: 13 }}>{String((c as Record<string, unknown>).title ?? '')}</span>) : <span style={{ color: '#94a3b8', fontSize: 13 }}>暂无知识点</span>}</div></div>
                      <div style={{ textAlign: 'center', color: '#94a3b8' }}><ChevronDown size={16} aria-hidden="true" /></div>
                      <div className="q-reasoning-step"><div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><span style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, borderRadius: '50%', background: '#0891b2', color: '#fff', fontSize: 12, fontWeight: 800 }}>3</span><strong>判断规则 / 推理步骤</strong></div><ol style={{ margin: 0, paddingLeft: 22 }}>{(q.reasoningSteps || []).length ? (q.reasoningSteps || []).map((r, i) => <li key={i} style={{ fontSize: 13, color: '#334155', marginBottom: 3 }}>{String((r as Record<string, unknown>).title ?? '')}</li>) : <li style={{ color: '#94a3b8', fontSize: 13, listStyle: 'none', marginLeft: -22 }}>暂无推理步骤</li>}</ol></div>
                      <div style={{ textAlign: 'center', color: '#94a3b8' }}><ChevronDown size={16} aria-hidden="true" /></div>
                      <div className="q-reasoning-step"><div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><span style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, borderRadius: '50%', background: '#16a34a', color: '#fff', fontSize: 12, fontWeight: 800 }}>4</span><strong>锁定答案</strong></div><div>{correctId ? <span style={{ display: 'inline-block', background: '#16a34a', color: '#fff', borderRadius: 8, padding: '4px 14px', fontWeight: 700 }}>{correctId}</span> : <span style={{ color: '#94a3b8', fontSize: 13 }}>未设置正确答案</span>}</div></div>
                    </div>
                  )}
                </div>
              </section>

              <section className={`q-panel q-tab-panel${tab === 'notes' ? ' active' : ''}`} role="tabpanel" hidden={tab !== 'notes'}>
                <div className="q-tab-section-head"><div><h3>侦探笔记</h3><p>集中展示线索解释、知识点、选项陷阱与复盘结论。</p></div></div>
                <div className="q-detective-notes" id="qDetectiveNotes">
                  {(q?.clues || []).map((c, i) => (
                    <div key={i} className="q-note-row"><strong>{String((c as Record<string, unknown>).text ?? '')}</strong>：{String((c as Record<string, unknown>).explain ?? '—')}</div>
                  ))}
                  {(!q || (q.clues || []).length === 0) && <p style={{ color: '#64748b' }}>暂无线索笔记</p>}
                </div>
                <div className="q-review" id="qReview">
                  {submitted && <p>{selected === correctId ? '回答正确。' : `回答错误，正确答案为 ${correctId}。`}</p>}
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
