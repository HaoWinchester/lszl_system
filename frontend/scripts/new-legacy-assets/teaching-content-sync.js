'use strict'

;(function (global) {
  const CHANNEL_NAME = 'kg-teaching-content-v1'
  const STORAGE_KEY = '__kg_teaching_content_sync_v1__'
  const DEBOUNCE_MS = 80
  const listeners = new Set()
  let lastSeenRevision = 0
  let pendingDetail = null
  let pendingPollingAdvance = false
  let notifyTimer = 0
  let pollTimer = 0
  let pollInFlight = false
  let pollGeneration = 0
  let polling = null
  let channel = null
  let fallbackStorage = null
  let destroyed = false

  function normalizedDetail(input) {
    const detail = input && typeof input === 'object' ? { ...input } : { revision: input }
    const rawRevision = detail.revision ?? detail.contentRevision
    if (typeof rawRevision !== 'number') return null
    const revision = rawRevision
    if (!Number.isSafeInteger(revision) || revision < 0) return null
    return { ...detail, revision }
  }

  function flushListeners() {
    notifyTimer = 0
    const detail = pendingDetail
    const callPollingAdvance = pendingPollingAdvance
    pendingDetail = null
    pendingPollingAdvance = false
    if (!detail) return
    for (const listener of Array.from(listeners)) {
      try { listener({ ...detail }) } catch (error) {}
    }
    if (callPollingAdvance && typeof polling?.onAdvance === 'function') {
      try { polling.onAdvance({ ...detail }) } catch (error) {}
    }
  }

  function accept(input, { pollingAdvance = false } = {}) {
    if (destroyed) return false
    const detail = normalizedDetail(input)
    if (!detail || detail.revision <= lastSeenRevision) return false
    lastSeenRevision = detail.revision
    pendingDetail = detail
    pendingPollingAdvance ||= pollingAdvance
    global.clearTimeout(notifyTimer)
    notifyTimer = global.setTimeout(flushListeners, DEBOUNCE_MS)
    return true
  }

  function receiveMessage(event) {
    accept(event?.data)
  }

  function receiveStorageMessage(event) {
    if (event?.key !== STORAGE_KEY || !event.newValue) return
    try { accept(JSON.parse(event.newValue)) } catch (error) {}
  }

  if (typeof global.BroadcastChannel === 'function') {
    channel = new global.BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = receiveMessage
  } else {
    try { fallbackStorage = global.localStorage } catch (error) {}
    global.addEventListener('storage', receiveStorageMessage)
  }

  function publish(input) {
    if (destroyed) return false
    const detail = normalizedDetail(input)
    if (!detail || detail.revision <= lastSeenRevision) return false
    lastSeenRevision = detail.revision
    if (channel) {
      channel.postMessage(detail)
    } else if (fallbackStorage) {
      try {
        fallbackStorage.setItem(STORAGE_KEY, JSON.stringify({
          ...detail,
          messageId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        }))
        fallbackStorage.removeItem(STORAGE_KEY)
      } catch (error) {}
    }
    return true
  }

  function subscribe(listener) {
    if (destroyed || typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function revisionFromPollResult(result) {
    return normalizedDetail(result)?.revision
  }

  async function pollNow() {
    if (!polling || pollInFlight || global.document?.visibilityState === 'hidden') return
    const activePolling = polling
    const generation = pollGeneration
    pollInFlight = true
    try {
      const result = await activePolling.getRevision()
      if (destroyed || polling !== activePolling || generation !== pollGeneration) return
      const revision = revisionFromPollResult(result)
      if (revision !== undefined) accept({ revision, source: 'poll' }, { pollingAdvance: true })
    } catch (error) {
      if (!destroyed && polling === activePolling && typeof activePolling.onError === 'function') {
        try { activePolling.onError(error) } catch (callbackError) {}
      }
    } finally {
      pollInFlight = false
    }
  }

  function stopPolling() {
    pollGeneration += 1
    global.clearInterval(pollTimer)
    pollTimer = 0
    polling = null
  }

  function startPolling({ getRevision, onAdvance, onError, intervalMs = 10000 } = {}) {
    stopPolling()
    if (destroyed || typeof getRevision !== 'function') return false
    const delay = Number.isFinite(Number(intervalMs)) && Number(intervalMs) > 0
      ? Number(intervalMs)
      : 10000
    polling = { getRevision, onAdvance, onError }
    pollTimer = global.setInterval(pollNow, delay)
    global.setTimeout(pollNow, 0)
    return true
  }

  function checkVisibleRevision() {
    if (!destroyed && global.document?.visibilityState !== 'hidden') pollNow()
  }

  global.addEventListener('focus', checkVisibleRevision)
  global.document?.addEventListener?.('visibilitychange', checkVisibleRevision)
  global.addEventListener('pagehide', () => {
    destroyed = true
    stopPolling()
    global.clearTimeout(notifyTimer)
    notifyTimer = 0
    pendingDetail = null
    listeners.clear()
    global.removeEventListener?.('focus', checkVisibleRevision)
    global.removeEventListener?.('storage', receiveStorageMessage)
    global.document?.removeEventListener?.('visibilitychange', checkVisibleRevision)
    if (channel) {
      channel.close()
      channel = null
    }
  })

  global.KGTeachingContentSync = Object.freeze({
    publish,
    subscribe,
    startPolling,
    stopPolling,
  })
})(window)
