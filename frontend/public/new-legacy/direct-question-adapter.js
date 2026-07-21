'use strict'

;(function (global) {
  const button = document.getElementById('qbSaveQuestionBtn')
  const stem = document.getElementById('questionStemInput')
  if (!button || !stem) return

  let toastTimer = 0

  function showError(message) {
    const toast = document.getElementById('qbToast')
    if (!toast) return
    toast.textContent = message
    toast.classList.add('show')
    global.clearTimeout(toastTimer)
    toastTimer = global.setTimeout(() => toast.classList.remove('show'), 2600)
  }

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
