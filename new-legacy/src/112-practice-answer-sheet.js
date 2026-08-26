'use strict';

;(function (global) {
  const STATUS_LABELS = Object.freeze({
    correct: '正确',
    wrong: '错误',
    unanswered: '未答',
    missing: '不可用',
  })

  function text(value) { return String(value == null ? '' : value) }
  function escapeHTML(value) {
    return text(value).replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[char])
  }

  function mount(root, options = {}) {
    if (!root) return null
    let snapshot = null
    let currentId = ''
    let activeFilter = 'all'

    function visibleQuestions() {
      const core = global.KGPracticeSessionCore
      const questions = Array.isArray(snapshot?.questions) ? snapshot.questions : []
      if (activeFilter === 'all') return questions
      return questions.filter(question => core?.questionStatus?.(snapshot, question.questionId) === activeFilter)
    }

    function render(session, currentQuestionId, filter) {
      snapshot = session || { questions: [], answers: {} }
      currentId = text(currentQuestionId)
      if (['all', 'unanswered', 'wrong'].includes(filter)) activeFilter = filter
      const core = global.KGPracticeSessionCore
      const stats = core?.answerSheetStats?.(snapshot) || { total: 0, answered: 0, correct: 0, wrong: 0, unanswered: 0 }
      const questions = visibleQuestions()
      const numbers = questions.map((question) => {
        const id = text(question?.questionId)
        const index = (snapshot.questions || []).findIndex(item => text(item?.questionId) === id)
        const status = core?.questionStatus?.(snapshot, id) || 'unanswered'
        const current = id === currentId
        const label = `第 ${index + 1} 题，${STATUS_LABELS[status] || status}${current ? '，当前题' : ''}`
        return `<button type="button" class="practice-answer-number is-${escapeHTML(status)}${current ? ' is-current' : ''}" data-question-id="${escapeHTML(id)}" aria-label="${escapeHTML(label)}" aria-current="${current ? 'step' : 'false'}"><span>${index + 1}</span><small>${escapeHTML(STATUS_LABELS[status] || '')}</small></button>`
      }).join('')
      root.innerHTML = `<div class="practice-answer-sheet-head"><div><span>ANSWER SHEET</span><h2>答题概览</h2></div><strong>${stats.answered}/${stats.total}</strong></div>
        <div class="practice-answer-sheet-summary"><span>正确 <b>${stats.correct}</b></span><span>错误 <b>${stats.wrong}</b></span><span>未答 <b>${stats.unanswered}</b></span></div>
        <div class="practice-answer-sheet-filters" role="group" aria-label="答题卡筛选">
          <button type="button" data-answer-filter="all" class="${activeFilter === 'all' ? 'is-active' : ''}">全部</button>
          <button type="button" data-answer-filter="unanswered" class="${activeFilter === 'unanswered' ? 'is-active' : ''}">未答</button>
          <button type="button" data-answer-filter="wrong" class="${activeFilter === 'wrong' ? 'is-active' : ''}">错题</button>
        </div>
        <div class="practice-answer-number-grid">${numbers || '<p class="practice-answer-filter-empty">该筛选下暂无题目</p>'}</div>
        <div class="practice-answer-sheet-legend"><span><i class="is-correct"></i>正确</span><span><i class="is-wrong"></i>错误</span><span><i class="is-unanswered"></i>未答</span></div>
        <button type="button" class="practice-answer-submit" data-answer-submit="true">交卷并查看成绩</button>`
      return stats
    }

    root.addEventListener('click', (event) => {
      const filterButton = event.target.closest?.('[data-answer-filter]')
      if (filterButton) {
        activeFilter = filterButton.dataset.answerFilter || 'all'
        render(snapshot, currentId, activeFilter)
        return
      }
      const numberButton = event.target.closest?.('[data-question-id]')
      if (numberButton) {
        options.onNavigate?.(numberButton.dataset.questionId)
        return
      }
      if (event.target.closest?.('[data-answer-submit]')) options.onSubmit?.()
    })

    return Object.freeze({ render, filter: () => activeFilter })
  }

  global.KGPracticeAnswerSheet = Object.freeze({ mount })
})(window)
