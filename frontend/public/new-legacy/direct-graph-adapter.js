'use strict'

;(function (global) {
  const autosave = global.KGGraphFileAutosave
  if (!autosave || autosave.__serverDebounceInstalled) return

  const originalMarkDirty = autosave.markDirty.bind(autosave)
  let timer = 0

  async function persistToServer() {
    const saved = autosave.saveNow({ force: true, silent: true, reason: 'server-debounce' })
    if (saved === false) throw new Error('图谱文件保存失败。')
    autosave.reportSaved?.('server-saved')
    const track=(global.KGFeatureAnalytics&&global.KGFeatureAnalytics.track)||function(){}
    track('graph','key_action','graph_saved')
    track('graph','outcome','graph_saved')
  }

  autosave.markDirty = function (reason) {
    const result = originalMarkDirty(reason)
    global.clearTimeout(timer)
    timer = global.setTimeout(() => {
      persistToServer().catch((error) => {
        autosave.reportError?.(error, 'server-error')
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
