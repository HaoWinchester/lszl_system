'use strict'

;(function (global) {
  const autosave = global.KGGraphFileAutosave
  if (!autosave || autosave.__serverDebounceInstalled) return

  const originalMarkDirty = autosave.markDirty.bind(autosave)
  let timer = 0

  async function persistToServer() {
    autosave.saveNow({ force: true, silent: true, reason: 'server-debounce' })
    const storage = global.KGServerStateStorage
    if (storage && typeof storage.flush === 'function') await storage.flush()
  }

  autosave.markDirty = function (reason) {
    const result = originalMarkDirty(reason)
    global.clearTimeout(timer)
    timer = global.setTimeout(() => {
      persistToServer().catch((error) => {
        console.warn('[DirectGraphAdapter] graph persistence failed:', error)
      })
    }, 400)
    return result
  }

  Object.defineProperty(autosave, '__serverDebounceInstalled', {
    configurable: false,
    enumerable: false,
    value: true,
  })
})(window)
