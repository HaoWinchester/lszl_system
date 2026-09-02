'use strict';

;(function (global) {
  const RUNTIME_FIELDS = Object.freeze([
    'currentIndex', 'health', 'streak', 'maxStreak', 'experience',
    'remainingMs', 'durationMs', 'languageMode', 'autoExplain',
    'order', 'showAnswers', 'markedQuestionIds',
  ])

  function clone(value, fallback) {
    try { return JSON.parse(JSON.stringify(value)) } catch (error) { return fallback }
  }

  function normalizeSession(input) {
    const source = input && typeof input === 'object' ? input : {}
    const questions = Array.isArray(source.questions) ? clone(source.questions, []) : []
    const answers = source.answers && typeof source.answers === 'object'
      ? clone(source.answers, {})
      : {}
    const runtimeState = source.runtimeState && typeof source.runtimeState === 'object'
      ? clone(source.runtimeState, {})
      : {}
    const maximumIndex = Math.max(0, questions.length - 1)
    const requestedIndex = Number(runtimeState.currentIndex)
    runtimeState.currentIndex = Number.isInteger(requestedIndex)
      ? Math.max(0, Math.min(maximumIndex, requestedIndex))
      : 0
    return {
      ...clone(source, {}),
      questions,
      answers,
      runtimeState,
      stats: { ...clone(source.stats, {}), ...answerSheetStats({ questions, answers }) },
    }
  }

  function questionStatus(session, questionId) {
    const questions = Array.isArray(session?.questions) ? session.questions : []
    const exists = questions.some(item => String(item?.questionId || '') === String(questionId || ''))
    if (!exists) return 'missing'
    const answer = session?.answers?.[questionId]
    if (!answer || typeof answer !== 'object') return 'unanswered'
    return answer.correct === true ? 'correct' : 'wrong'
  }

  function answerSheetStats(session) {
    const questions = Array.isArray(session?.questions) ? session.questions : []
    let correct = 0
    let wrong = 0
    questions.forEach((question) => {
      const answer = session?.answers?.[question?.questionId]
      if (!answer || typeof answer !== 'object') return
      if (answer.correct === true) correct += 1
      else wrong += 1
    })
    const answered = correct + wrong
    return {
      total: questions.length,
      answered,
      correct,
      wrong,
      unanswered: Math.max(0, questions.length - answered),
    }
  }

  function resumableRuntime(session) {
    const runtime = session?.runtimeState && typeof session.runtimeState === 'object'
      ? session.runtimeState
      : {}
    const result = {}
    RUNTIME_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(runtime, field)) result[field] = clone(runtime[field], runtime[field])
    })
    return result
  }

  global.KGPracticeSessionCore = Object.freeze({
    normalizeSession,
    questionStatus,
    answerSheetStats,
    resumableRuntime,
  })
})(window)
