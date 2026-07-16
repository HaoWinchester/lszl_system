import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { banksApi, papersApi, type Bank, type Paper, type Question } from '../api/questions'
import { AppIcon } from '../components/AppIcon'
import { useAuth } from '../store/auth'

const SUBJECTS = ['PMP', 'CSPM', 'P2', 'ACP', 'NPDP', 'PgMP', 'PfMP']
const TYPES: [string, string][] = [
  ['single_choice', '单选题'],
  ['multiple_choice', '多选题'],
  ['scenario', '情景题'],
  ['case_analysis', '案例分析题'],
]
const DIFFICULTIES = ['基础', '中等', '重点', '难点', '易错点']

type MainTab = 'banks' | 'papers' | 'base'
type AnnoTab = 'clues' | 'concepts' | 'reasoning'

export default function QuestionBank() {
  const me = useAuth((s) => s.user)
  const [mainTab, setMainTab] = useState<MainTab>('banks')
  const [annoTab, setAnnoTab] = useState<AnnoTab>('clues')
  const [banks, setBanks] = useState<Bank[]>([])
  const [bankId, setBankId] = useState<string | null>(null)
  const [questions, setQuestions] = useState<Question[]>([])
  const [editing, setEditing] = useState<Question | null>(null)
  const [papers, setPapers] = useState<Paper[]>([])
  const [toast, setToast] = useState('')
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2000) }

  const reloadBanks = useCallback(() => banksApi.list().then(setBanks), [])
  const reloadQuestions = useCallback(async () => {
    if (!bankId) { setQuestions([]); return }
    setQuestions((await banksApi.listQuestions(bankId, {})).questions)
  }, [bankId])
  const reloadPapers = useCallback(() => papersApi.list().then(setPapers), [])

  useEffect(() => { reloadBanks() }, [reloadBanks])
  useEffect(() => { reloadQuestions() }, [reloadQuestions])
  useEffect(() => { reloadPapers() }, [reloadPapers])

  const createBank = async () => {
    const name = window.prompt('题库名称', '新题库')
    if (!name) return
    const subject = window.prompt('科目', 'PMP') || 'PMP'
    const b = await banksApi.create({ name, subject })
    await reloadBanks(); setBankId(b.id); notify('题库已创建')
  }
  const removeBank = async (b: Bank) => {
    if (!window.confirm(`删除题库「${b.name}」及题目？`)) return
    await banksApi.remove(b.id)
    if (bankId === b.id) setBankId(null)
    await reloadBanks(); notify('已删除')
  }
  const createQuestion = async () => {
    if (!bankId) return notify('请先选择题库')
    const q = await banksApi.createQuestion(bankId, { title: '新题目', type: 'single_choice', options: [{ id: 'A', text: '' }, { id: 'B', text: '' }] })
    await reloadQuestions(); setEditing(q); setMainTab('base'); notify('题目已创建')
  }
  const delQuestion = async (q: Question) => {
    if (!window.confirm('删除此题？')) return
    await banksApi.removeQuestion(q.id); setEditing(null); await reloadQuestions(); notify('已删除')
  }
  const saveQuestion = async () => {
    if (!editing) return
    await banksApi.updateQuestion(editing.id, {
      title: editing.title, type: editing.type, difficulty: editing.difficulty, domain: editing.domain,
      topic: editing.topic, tags: editing.tags, options: editing.options, correctAnswer: editing.correctAnswer,
      analysis: editing.analysis, clues: editing.clues, concepts: editing.concepts, reasoningSteps: editing.reasoningSteps,
    })
    await reloadQuestions(); notify('已保存')
  }
  const openAnnotation = (tab: AnnoTab) => {
    if (!editing) { notify('请先选择一道题目'); return }
    setAnnoTab(tab); setMainTab('base')
  }

  const currentBank = banks.find((b) => b.id === bankId)

  return (
    <div className="qb-app" id="qbApp">
      <header className="qb-topbar">
        <div className="qb-brand">
          <Link className="qb-back" to="/" title="返回知识图谱"><AppIcon name="back" size="compact" /></Link>
          <div>
            <p className="qb-kicker">Question Bank Administration</p>
            <h1>题库认知标注管理</h1>
            <p>面向 PMP、CSPM、P2、ACP、NPDP 等项目管理类科目，统一维护题目、关键词、推理逻辑与知识点。</p>
          </div>
        </div>
        <div className="qb-top-actions">
          <div className="auth-status">{me ? `${me.display_name || me.username}` : '未登录'}</div>
          <button type="button" onClick={() => notify('导入：请用下方题目编辑')}>导入 JSON</button>
          <button type="button" onClick={() => notify('导出当前题库')}>导出当前题库</button>
          <button type="button" onClick={() => notify('导出全部题库')}>导出全部题库</button>
          <Link className="qb-top-link" to="/users">用户管理</Link>
          <Link className="qb-top-link" to="/settings">系统设置</Link>
        </div>
      </header>

      <section className="qb-subject-strip" aria-label="科目快捷入口">
        <div><strong>默认科目体系</strong><span>PMP / CSPM / P2 / ACP / NPDP，可继续扩展 PgMP、PfMP。</span></div>
        <div className="qb-subject-chips">{SUBJECTS.map((s) => <span key={s} className="qb-subject-chip">{s}</span>)}</div>
      </section>

      <main className="qb-layout">
        <aside className="qb-sidebar">
          <nav className="qb-layout-nav" aria-label="页面布局导航">
            <button className={mainTab === 'banks' ? 'active' : ''} type="button" onClick={() => setMainTab('banks')}>题库管理</button>
            <button className={mainTab === 'papers' ? 'active' : ''} type="button" onClick={() => setMainTab('papers')}>组卷与发布</button>
            <button className={mainTab === 'base' ? 'active' : ''} type="button" onClick={() => setMainTab('base')}>题目基本信息</button>
            <button className={mainTab === 'base' && annoTab === 'clues' ? 'active' : ''} type="button" onClick={() => openAnnotation('clues')}>关键词标记</button>
            <button className={mainTab === 'base' && annoTab === 'concepts' ? 'active' : ''} type="button" onClick={() => openAnnotation('concepts')}>知识点绑定</button>
            <button className={mainTab === 'base' && annoTab === 'reasoning' ? 'active' : ''} type="button" onClick={() => openAnnotation('reasoning')}>推理逻辑</button>
          </nav>
        </aside>

        <section className="qb-editor">
          <section className="qb-card qb-workspace-card" id="qbMainWorkspace">
            <div className="qb-workspace-head">
              <div>
                <h2>题库工作区</h2>
                <p>{currentBank ? `${currentBank.name} · ${currentBank.subject} · ${questions.length} 题` : '请选择题库开始管理题目'}{editing ? ` · 正在编辑：${editing.title.slice(0, 16)}` : ''}</p>
              </div>
              <div className="qb-workspace-context" aria-label="当前题库上下文">
                <strong>{currentBank?.name || '未选择题库'}</strong>
                <span>{me?.username || '访客'} 的题库空间</span>
              </div>
            </div>

            {mainTab === 'banks' && (
              <section className="qb-workspace-panel active" role="tabpanel">
                <div className="qb-management-grid">
                  <section className="qb-management-section" role="tabpanel">
                    <div className="qb-sidebar-head">
                      <div><h2>题库</h2><p>{banks.length} 个题库</p></div>
                      <button className="kg-button-with-icon" type="button" onClick={createBank}><AppIcon name="add" size="compact" />新题库</button>
                    </div>
                    <div className="qb-list" id="qbBankList">
                      {banks.map((b) => (
                        <div key={b.id} className={`qb-list-item${bankId === b.id ? ' active' : ''}`} onClick={() => setBankId(b.id)}>
                          <strong>{b.name}</strong>
                          <span>{b.subject} · {b.questionCount} 题</span>
                          <button type="button" onClick={(e) => { e.stopPropagation(); removeBank(b) }}>删除</button>
                        </div>
                      ))}
                      {banks.length === 0 && <p className="qb-empty">点击「+ 新题库」创建</p>}
                    </div>
                    {currentBank && (
                      <section className="qb-bank-info-panel">
                        <div className="qb-side-section-title">
                          <div><h3>题库信息</h3></div>
                          <div className="qb-side-actions">
                            <button type="button" onClick={() => notify('已保存')}>保存</button>
                            <button className="danger" type="button" onClick={() => removeBank(currentBank)}>删除题库</button>
                          </div>
                        </div>
                        <div className="qb-grid one compact-grid">
                          <label className="qb-field"><span>题库名称</span><input defaultValue={currentBank.name} /></label>
                          <label className="qb-field"><span>科目</span><select defaultValue={currentBank.subject}>{SUBJECTS.map((s) => <option key={s}>{s}</option>)}</select></label>
                          <label className="qb-field"><span>题库说明</span><textarea defaultValue={currentBank.description || ''} rows={2} /></label>
                        </div>
                      </section>
                    )}
                  </section>

                  <section className="qb-management-section" role="tabpanel">
                    <div className="qb-sidebar-head questions">
                      <div><h2>题目</h2><p>{questions.length} 题</p></div>
                      <button className="kg-button-with-icon" type="button" onClick={createQuestion}><AppIcon name="add" size="compact" />新题</button>
                    </div>
                    <div className="qb-list question-list" id="qbQuestionList">
                      {questions.map((q) => (
                        <div key={q.id} className={`qb-list-item${editing?.id === q.id ? ' active' : ''}`} onClick={() => { setEditing(q); setMainTab('base') }}>
                          <strong>{q.title.slice(0, 40)}</strong>
                          <span>{q.domain || '未分类'} · {q.difficulty || ''}</span>
                        </div>
                      ))}
                      {questions.length === 0 && <p className="qb-empty">{bankId ? '暂无题目' : <><span className="qb-empty-icon"><AppIcon name="back" size="compact" /></span>先选择题库</>}</p>}
                    </div>
                  </section>
                </div>
              </section>
            )}

            {mainTab === 'papers' && <PapersPanel papers={papers} bankId={bankId} notify={notify} reload={reloadPapers} />}

            {mainTab === 'base' && editing && (
              <section className="qb-workspace-panel qb-base-panel active" role="tabpanel">
                <div className="qb-card-title">
                  <div><h2>题目基础信息</h2></div>
                  <div className="qb-inline-actions">
                    <button className="danger" type="button" onClick={() => delQuestion(editing)}>删除题目</button>
                    <button className="primary" type="button" onClick={saveQuestion}>保存题目</button>
                  </div>
                </div>
                <div className="qb-grid three">
                  <label className="qb-field"><span>题目标题</span><input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></label>
                  <label className="qb-field"><span>题型</span><select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                  <label className="qb-field"><span>难度</span><select value={editing.difficulty || ''} onChange={(e) => setEditing({ ...editing, difficulty: e.target.value })}><option value="">未设置</option>{DIFFICULTIES.map((d) => <option key={d}>{d}</option>)}</select></label>
                  <label className="qb-field"><span>知识领域 / 域</span><input value={editing.domain || ''} onChange={(e) => setEditing({ ...editing, domain: e.target.value })} placeholder="例如：敏捷、治理" /></label>
                  <label className="qb-field"><span>章节 / 主题</span><input value={editing.topic || ''} onChange={(e) => setEditing({ ...editing, topic: e.target.value })} /></label>
                  <label className="qb-field"><span>标签</span><input value={(editing.tags || []).join(',')} onChange={(e) => setEditing({ ...editing, tags: e.target.value.split(/[,，]/).filter(Boolean) })} /></label>
                  <label className="qb-field wide"><span>题干</span><textarea rows={4} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></label>
                  <label className="qb-field wide"><span>解析 / 复盘说明</span><textarea rows={3} value={editing.analysis || ''} onChange={(e) => setEditing({ ...editing, analysis: e.target.value })} /></label>
                </div>
                <div className="qb-mini-section">
                  <div className="qb-mini-head"><h3>选项</h3><button type="button" onClick={() => setEditing({ ...editing, options: [...editing.options, { id: String.fromCharCode(65 + editing.options.length), text: '' }] })}>+ 选项</button></div>
                  <div className="qb-options">
                    {editing.options.map((o, i) => (
                      <div key={i} className="qb-option-row">
                        <input style={{ width: 36 }} value={o.id} onChange={(e) => setEditing({ ...editing, options: editing.options.map((x, idx) => idx === i ? { ...x, id: e.target.value } : x) })} />
                        <input placeholder="选项内容" value={o.text} onChange={(e) => setEditing({ ...editing, options: editing.options.map((x, idx) => idx === i ? { ...x, text: e.target.value } : x) })} />
                        <label style={{ fontSize: 12 }}><input type="checkbox" checked={!!o.correct} onChange={(e) => setEditing({ ...editing, options: editing.options.map((x, idx) => idx === i ? { ...x, correct: e.target.checked } : x), correctAnswer: e.target.checked ? o.id : editing.correctAnswer })} /> 正确</label>
                          <button aria-label="删除选项" title="删除选项" type="button" onClick={() => setEditing({ ...editing, options: editing.options.filter((_, idx) => idx !== i) })}><AppIcon name="close" size="compact" /></button>
                      </div>
                    ))}
                  </div>
                </div>

                <section className="qb-card qb-annotation-card" style={{ marginTop: 16 }}>
                  <div className="qb-card-title">
                    <div><h2>认知标注工作台</h2></div>
                    <div className="qb-annotation-tabs" role="tablist">
                      <button className={annoTab === 'clues' ? 'active' : ''} role="tab" type="button" onClick={() => setAnnoTab('clues')}>关键词标记</button>
                      <button className={annoTab === 'concepts' ? 'active' : ''} role="tab" type="button" onClick={() => setAnnoTab('concepts')}>知识点绑定</button>
                      <button className={annoTab === 'reasoning' ? 'active' : ''} role="tab" type="button" onClick={() => setAnnoTab('reasoning')}>推理逻辑</button>
                    </div>
                  </div>
                  <AnnotationPanel tab={annoTab} editing={editing} setEditing={setEditing} />
                </section>
              </section>
            )}
          </section>
        </section>

        <aside className="qb-inspector">
          <section className="qb-card sticky">
            <h2>标注完成度</h2>
            <div id="qbCompletionPanel">
              {editing ? (
                <ul className="qb-check-list">
                  <li className={editing.title ? 'done' : ''}>题目内容</li>
                  <li className={(editing.clues?.length ?? 0) > 0 ? 'done' : ''}>关键词 ({editing.clues?.length || 0})</li>
                  <li className={(editing.concepts?.length ?? 0) > 0 ? 'done' : ''}>知识点 ({editing.concepts?.length || 0})</li>
                  <li className={(editing.reasoningSteps?.length ?? 0) > 0 ? 'done' : ''}>推理 ({editing.reasoningSteps?.length || 0})</li>
                </ul>
              ) : <p className="qb-empty">选择题目查看完成度</p>}
            </div>
            <hr />
            <h2>当前题库操作</h2>
            <div className="qb-inspector-actions">
              <button className="primary" type="button" onClick={() => setMainTab('papers')}>进入组卷发布</button>
            </div>
            <hr />
            <h2>科目快捷管理</h2>
            <div className="qb-subject-quick">
              {SUBJECTS.map((s) => <span key={s} className="qb-subject-chip">{s}</span>)}
            </div>
            <hr />
            <h2>字段关系提示</h2>
            <ul className="qb-tip-list">
              <li><strong>关键词</strong>：题干中的可点击线索。</li>
              <li><strong>知识点</strong>：这道题真正考察的概念或规则。</li>
              <li><strong>推理步骤</strong>：从线索到答案的判断路径。</li>
            </ul>
          </section>
        </aside>
      </main>

      <button className="qb-selection-mark" id="qbSelectionMark" type="button" hidden>标记关键词</button>
      <div className="qb-floating-keyword-panel" id="qbFloatingKeywordPanel" hidden>
        <div className="floating-head"><strong>关键词标记操作台</strong><button aria-label="关闭" type="button"><AppIcon name="close" size="compact" /></button></div>
        <label className="qb-field"><span>选中文本</span><input placeholder="选中的题干文本" /></label>
      </div>

      <div className="qb-toast" role="status" aria-live="polite">{toast}</div>
    </div>
  )
}

function AnnotationPanel({ tab, editing, setEditing }: { tab: AnnoTab; editing: Question; setEditing: (q: Question) => void }) {
  if (tab === 'clues') {
    return (
      <section className="qb-annotation-panel active" role="tabpanel">
        <div className="qb-panel-head"><div><h3>关键词标记</h3><p>关键词会成为深度回忆的第一层按钮。</p></div></div>
        <div className="qb-token-list">
          {(editing.clues || []).map((c, i) => (
            <div key={i} className="qb-token">
              <span>{String(c.text ?? '')}</span>
              <button aria-label="删除关键词" title="删除关键词" type="button" onClick={() => setEditing({ ...editing, clues: (editing.clues || []).filter((_, idx) => idx !== i) })}><AppIcon name="close" size="compact" /></button>
            </div>
          ))}
          {(editing.clues || []).length === 0 && <p className="qb-empty">暂无关键词</p>}
        </div>
        <button className="primary" type="button" onClick={() => {
          const text = window.prompt('关键词文本')
          if (!text) return
          setEditing({ ...editing, clues: [...(editing.clues || []), { text, type: 'core', clueRole: 'true' }] })
        }}>添加关键词</button>
      </section>
    )
  }
  if (tab === 'concepts') {
    return (
      <section className="qb-annotation-panel active" role="tabpanel">
        <div className="qb-panel-head"><div><h3>知识点绑定</h3><p>知识点支撑题目图谱和错题归因。</p></div></div>
        <div className="qb-concept-list">
          {(editing.concepts || []).map((c, i) => (
            <div key={i} className="qb-concept-item">
              <strong>{String(c.title ?? '')}</strong>
              <button type="button" onClick={() => setEditing({ ...editing, concepts: (editing.concepts || []).filter((_, idx) => idx !== i) })}>删除</button>
            </div>
          ))}
          {(editing.concepts || []).length === 0 && <p className="qb-empty">暂无知识点</p>}
        </div>
        <button className="primary" type="button" onClick={() => {
          const title = window.prompt('知识点名称')
          if (!title) return
          setEditing({ ...editing, concepts: [...(editing.concepts || []), { id: 'c_' + Math.random().toString(36).slice(2, 8), title, level: '重点' }] })
        }}>添加知识点</button>
      </section>
    )
  }
  return (
    <section className="qb-annotation-panel active" role="tabpanel">
      <div className="qb-panel-head"><div><h3>推理逻辑</h3><p>把答案拆成步骤。</p></div></div>
      <div className="qb-reasoning-list">
        {(editing.reasoningSteps || []).map((r, i) => (
          <div key={i} className="qb-reasoning-item">
            <span>{i + 1}. {String(r.title ?? '')}</span>
            <button type="button" onClick={() => setEditing({ ...editing, reasoningSteps: (editing.reasoningSteps || []).filter((_, idx) => idx !== i) })}>删除</button>
          </div>
        ))}
        {(editing.reasoningSteps || []).length === 0 && <p className="qb-empty">暂无推理步骤</p>}
      </div>
      <button className="primary" type="button" onClick={() => {
        const title = window.prompt('推理步骤说明')
        if (!title) return
        setEditing({ ...editing, reasoningSteps: [...(editing.reasoningSteps || []), { id: 'r_' + Math.random().toString(36).slice(2, 8), title }] })
      }}>添加推理步骤</button>
    </section>
  )
}

function PapersPanel({ papers, bankId, notify, reload }: { papers: Paper[]; bankId: string | null; notify: (m: string) => void; reload: () => void }) {
  const [selId, setSelId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [quotaText, setQuotaText] = useState('')
  const sel = papers.find((p) => p.id === selId)

  const create = async () => {
    const n = window.prompt('试卷名称', '新试卷')
    if (!n) return
    await papersApi.create({ name: n, subject: 'PMP' })
    reload(); notify('试卷已创建')
  }
  const compose = async () => {
    if (!selId || !bankId) return notify('需选择题库与试卷')
    const quotas: Record<string, number> = {}
    quotaText.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean).forEach((p) => { const [d, c] = p.split(/[:：]/).map((s) => s.trim()); if (d && c) quotas[d] = Number(c) })
    await papersApi.compose(selId, [bankId], quotas)
    reload(); notify('已按配额组卷')
  }
  const publish = async (p: Paper) => { await papersApi.publish(p.id); reload(); notify('已发布') }

  return (
    <section className="qb-workspace-panel qb-paper-card active" role="tabpanel">
      <div className="qb-card-title">
        <div><h2>组卷与发布</h2><p>按知识领域/主题配额从题库抽题，发布后训练页可选择。</p></div>
        <div className="qb-inline-actions">
          <button className="kg-button-with-icon" type="button" onClick={create}><AppIcon name="add" size="compact" />新试卷</button>
          <button className="primary" type="button" onClick={compose}>按配额组卷</button>
        </div>
      </div>
      <div className="qb-paper-layout">
        <aside className="qb-paper-list-panel">
          <div className="qb-mini-head"><h3>试卷列表</h3></div>
          <div className="qb-list paper-list">
            {papers.map((p) => (
              <div key={p.id} className={`qb-list-item${selId === p.id ? ' active' : ''}`} onClick={() => setSelId(p.id)}>
                <strong>{p.name}</strong>
                <span>{p.questionCount} 题 · {p.status === 'published' ? '已发布' : '草稿'}</span>
              </div>
            ))}
            {papers.length === 0 && <p className="qb-empty">无试卷</p>}
          </div>
        </aside>
        <section className="qb-paper-editor-panel">
          {sel ? (
            <>
              <div className="qb-grid three">
                <label className="qb-field"><span>试卷名称</span><input value={name || sel.name} onChange={(e) => setName(e.target.value)} /></label>
                <label className="qb-field"><span>科目</span><input defaultValue={sel.subject} /></label>
                <label className="qb-field"><span>目标题量</span><input type="number" defaultValue={sel.totalCount || 180} /></label>
              </div>
              <div className="qb-mini-section">
                <div className="qb-mini-head"><h3>领域配额</h3></div>
                <label className="qb-field"><span>配额（领域:数量，逗号分隔）</span><textarea rows={2} value={quotaText} onChange={(e) => setQuotaText(e.target.value)} placeholder="范围:10, 进度:8" /></label>
              </div>
              <div className="qb-inline-actions">
                {sel.status === 'published'
                  ? <button type="button" onClick={async () => { await papersApi.unpublish(sel.id); reload() }}>取消发布</button>
                  : <button className="primary" type="button" onClick={() => publish(sel)}>发布试卷</button>}
                <Link className="qb-top-link" to="/training">去训练</Link>
              </div>
            </>
          ) : <p className="qb-empty"><span className="qb-empty-icon"><AppIcon name="back" size="compact" /></span>选择试卷</p>}
        </section>
      </div>
    </section>
  )
}
