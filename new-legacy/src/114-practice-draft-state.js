'use strict';

;(function (global) {
  const TIMEOUT_PLACEHOLDER = '__timeout__'
  const AnswerSet = global.KGQuestionAnswerSet

  function text(value) { return String(value == null ? '' : value) }

  function clone(value, fallback) {
    try { return JSON.parse(JSON.stringify(value)) } catch (error) { return fallback }
  }

  function normalizeIds(value, optionIds) {
    return AnswerSet?.normalizeIds?.(value, optionIds) || []
  }

  function isMultiple(question) { return text(question?.type) === 'multiple_choice' }

  function correctIds(question, optionIds) {
    return normalizeIds(AnswerSet?.correctIds?.(question), optionIds)
  }

  function gradeLocal(question, selectedAnswer, extra = {}) {
    const optionIds = (question?.options || []).map(option => text(option?.id)).filter(Boolean)
    if (isMultiple(question) && extra.timedOut !== true) {
      const selectedAnswerIds = normalizeIds(selectedAnswer, optionIds)
      const correctOptionIds = correctIds(question, optionIds)
      const result = {
        ...extra,
        selectedAnswerIds,
        correct: AnswerSet?.grade?.(selectedAnswerIds, correctOptionIds) === true,
        correctOptionIds,
      }
      return clone(result, result)
    }
    const correctAnswer = text(question.correctAnswer)
    const result = {
      ...extra,
      selectedAnswer: text(selectedAnswer),
      correct: text(selectedAnswer) === correctAnswer,
      correctAnswer,
    }
    return clone(result, result)
  }

  function normalizeAnswers(byId, answers) {
    const draft = {}
    Object.keys(answers || {}).forEach((questionId) => {
      const question = byId.get(text(questionId))
      const value = answers[questionId]
      if (!question || !value || typeof value !== 'object') return
      const multi=isMultiple(question)
      if (!Object.prototype.hasOwnProperty.call(value, multi?'selectedAnswerIds':'selectedAnswer')) return
      const timedOut = value.timedOut === true
      const entry = {
        // 与后端 _judge 同构：timedOut 草稿一律按 '__timeout__' 判 false，
        // 即使旧数据保留真实选项值，也不产生 correct:true 的口径分裂。
        ...(multi&&!timedOut?{selectedAnswerIds:normalizeIds(value.selectedAnswerIds,(question.options||[]).map(option=>text(option.id)))}:{selectedAnswer:timedOut ? TIMEOUT_PLACEHOLDER : text(value.selectedAnswer)}),
        selectionIndex: Number.isInteger(Number(value.selectionIndex)) && value.selectionIndex != null
          ? Number(value.selectionIndex)
          : Object.keys(draft).length + 1,
      }
      if (timedOut) entry.timedOut = true
      draft[text(questionId)] = gradeLocal(question, multi?entry.selectedAnswerIds:entry.selectedAnswer, entry)
    })
    return draft
  }

  function create({ questions = [], answers = {} } = {}) {
    const byId = new Map((Array.isArray(questions) ? questions : []).map(item => [text(item.questionId), item.question || {}]))
    const draft = normalizeAnswers(byId, answers)
    let dirty = false

    function select(questionId, selectedAnswer, { timedOut = false } = {}) {
      const id = text(questionId), question = byId.get(id)
      if (!question || draft[id]) return { accepted: false, answer: draft[id] ? clone(draft[id]) : null }
      const optionIds = new Set(((question && question.options) || []).map(item => text(item.id)))
      if (!timedOut && isMultiple(question) && (!Array.isArray(selectedAnswer) || !selectedAnswer.length || selectedAnswer.some(value=>!optionIds.has(text(value))))) return { accepted: false, answer: null }
      if (!timedOut && !isMultiple(question) && !optionIds.has(text(selectedAnswer))) return { accepted: false, answer: null }
      draft[id] = gradeLocal(question, timedOut ? TIMEOUT_PLACEHOLDER : selectedAnswer, {
        timedOut: timedOut ? true : undefined,
        selectionIndex: Object.keys(draft).length + 1,
      })
      dirty = true
      return { accepted: true, answer: clone(draft[id]) }
    }

    function answer(questionId) {
      const record = draft[text(questionId)]
      return record ? clone(record) : null
    }

    function viewAnswers() {
      return clone(draft, {})
    }

    function submission() {
      const payload = {}
      Object.keys(draft).forEach((questionId) => {
        const record = draft[questionId]
        const entry = Array.isArray(record.selectedAnswerIds)
          ? { selectedAnswerIds: record.selectedAnswerIds, selectionIndex: record.selectionIndex }
          : { selectedAnswer: record.selectedAnswer, selectionIndex: record.selectionIndex }
        if (record.timedOut === true) entry.timedOut = true
        payload[questionId] = entry
      })
      return payload
    }

    function stats() {
      let correct = 0, wrong = 0
      Object.keys(draft).forEach((questionId) => {
        if (draft[questionId].correct === true) correct += 1
        else wrong += 1
      })
      const answered = correct + wrong
      return { total: byId.size, answered, correct, wrong, unanswered: Math.max(0, byId.size - answered) }
    }

    return Object.freeze({
      select,
      answer,
      viewAnswers,
      submission,
      stats,
      isDirty: () => dirty,
      markSaved: () => { dirty = false },
    })
  }

  global.KGPracticeDraftState = Object.freeze({ create })
})(window)
