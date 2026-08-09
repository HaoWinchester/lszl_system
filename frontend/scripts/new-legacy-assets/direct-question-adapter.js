'use strict'

;(function (global) {
  const Catalog = global.KGQuestionCatalogAdapter
  const HEARTBEAT_INTERVAL_MS = 30000
  let activeQuestion = null
  let grant = null
  let heartbeatTimer = 0
  let readonly = false

  function clearHeartbeat() {
    if (heartbeatTimer) global.clearInterval(heartbeatTimer)
    heartbeatTimer = 0
  }

  function showError(message) {
    const toast = document.getElementById('qbToast')
    if (!toast) return
    toast.textContent = message
    toast.classList.add('show')
    global.clearTimeout(showError.timer)
    showError.timer = global.setTimeout(() => toast.classList.remove('show'), 2600)
  }

  function applyReadonlyState(nextReadonly = readonly) {
    readonly = Boolean(nextReadonly)
    document.body?.setAttribute('data-question-catalog-readonly', readonly ? 'true' : 'false')
    const roots = ['qbQuestionBaseCard', 'qbAnnotationCard']
      .map(id => document.getElementById(id))
      .filter(Boolean)
    roots.flatMap(root => Array.from(root.querySelectorAll('input, textarea, select, button'))).forEach(control => {
      if (readonly) {
        if (!control.hasAttribute('data-catalog-disabled-before-lock')) {
          control.setAttribute('data-catalog-disabled-before-lock', control.disabled ? 'true' : 'false')
        }
        control.disabled = true
      } else if (control.hasAttribute('data-catalog-disabled-before-lock')) {
        control.disabled = control.getAttribute('data-catalog-disabled-before-lock') === 'true'
        control.removeAttribute('data-catalog-disabled-before-lock')
      }
    })
    return readonly
  }

  async function release(options = {}) {
    clearHeartbeat()
    const previousQuestion = activeQuestion
    const previousGrant = grant
    activeQuestion = null
    grant = null
    readonly = false
    applyReadonlyState(false)
    if (options.forgetOnly) return true
    if (!previousQuestion?.id || !previousGrant?.lockToken || !Catalog) return true
    try {
      await Catalog.releaseQuestionLock(previousQuestion.id, {
        lockToken: previousGrant.lockToken,
        keepalive: Boolean(options.keepalive),
      })
      return true
    } catch (error) {
      if (!options.keepalive) showError(error.message || '题目编辑锁释放失败。')
      return false
    }
  }

  function scheduleHeartbeat() {
    clearHeartbeat()
    if (!activeQuestion?.id || !grant?.lockToken) return
    heartbeatTimer = global.setInterval(async () => {
      try {
        grant = await Catalog.heartbeatQuestionLock(activeQuestion.id, { lockToken: grant.lockToken })
      } catch (error) {
        clearHeartbeat()
        readonly = true
        applyReadonlyState(true)
        showError(error.message || '编辑锁已失效，当前题目已切换为只读。')
      }
    }, Number(grant.heartbeatIntervalSeconds || 30) === 30 ? 30000 : HEARTBEAT_INTERVAL_MS)
  }

  async function open(question) {
    const next = question && typeof question === 'object' ? JSON.parse(JSON.stringify(question)) : null
    if (activeQuestion?.id && String(activeQuestion.id) === String(next?.id || '') && grant?.lockToken) {
      activeQuestion = next
      applyReadonlyState(readonly)
      return { readonly, question: next, grant: JSON.parse(JSON.stringify(grant)) }
    }
    if (activeQuestion?.id && String(activeQuestion.id) !== String(next?.id || '')) await release()
    activeQuestion = next
    grant = null
    readonly = false
    if (!next?.id || Number(next.revision || 0) < 1 || !Catalog) {
      applyReadonlyState(false)
      return { readonly: false, question: next, grant: null }
    }
    try {
      grant = await Catalog.acquireQuestionLock(next.id, { creatorId: next.creatorId || null })
      scheduleHeartbeat()
    } catch (error) {
      readonly = true
      showError(error.message || '该题正在由其他人编辑，当前为只读模式。')
    }
    applyReadonlyState(readonly)
    return { readonly, question: next, grant: grant ? JSON.parse(JSON.stringify(grant)) : null }
  }

  async function save(question, options = {}) {
    if (!Catalog) throw new Error('题目目录服务尚未加载。')
    const existing = Number(question?.revision || options.baseRevision || 0) > 0
    if (existing && (readonly || !grant?.lockToken || String(activeQuestion?.id) !== String(question?.id))) {
      throw new Error('当前没有这道题的有效编辑锁，不能保存。')
    }
    const saved = await Catalog.saveQuestion(question, {
      bankId: options.bankId || question?.bankId,
      creatorId: question?.creatorId || options.creatorId,
      baseRevision: Number(question?.revision || options.baseRevision || 0) || undefined,
      lockToken: existing ? grant.lockToken : undefined,
      idempotencyKey: options.idempotencyKey,
    })
    activeQuestion = saved
    if (existing && saved?.id) {
      try {
        grant = await Catalog.acquireQuestionLock(saved.id, { creatorId: saved.creatorId || null })
        readonly = false
        scheduleHeartbeat()
      } catch (error) {
        grant = null
        readonly = true
        clearHeartbeat()
        applyReadonlyState(true)
        showError(error.message || '题目已保存，但未能继续取得编辑锁。')
      }
    }
    return saved
  }

  global.KGQuestionCatalogEditController = Object.freeze({
    open,
    save,
    release,
    applyReadonlyState,
    status: () => ({ readonly, questionId: activeQuestion?.id || '', lockToken: grant?.lockToken || '' }),
  })

  const button = document.getElementById('qbSaveQuestionBtn')
  const stem = document.getElementById('questionStemInput')
  if (!button || !stem) return

  function reject(event, field, message) {
    event.preventDefault()
    event.stopImmediatePropagation()
    showError(message)
    if (field) {
      field.setCustomValidity(message)
      field.focus()
      field.reportValidity()
      const clear = () => field.setCustomValidity('')
      field.addEventListener('input', clear, { once: true })
    }
  }

  button.addEventListener('click', (event) => {
    if (!stem.value.trim()) {
      reject(event, stem, '请先填写题干。')
      return
    }
    const options = Array.from(document.querySelectorAll('#qbOptionsEditor .option-text'))
    const completed = options.filter((input) => input.value.trim())
    if (completed.length < 2) {
      reject(event, options.find((input) => !input.value.trim()) || options[0], '请至少填写两个非空选项。')
    }
  }, true)
})(window)
