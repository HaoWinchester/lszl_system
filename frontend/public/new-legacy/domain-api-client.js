'use strict'

;(function (global) {
  class ApiError extends Error {
    constructor(message, { status = 0, code = 'API_ERROR', detail = null, retryable = false } = {}) {
      super(message)
      this.name = 'ApiError'
      Object.assign(this, { status, code, detail, retryable })
    }
  }

  function responseDetail(result) {
    return result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'detail')
      ? result.detail
      : result
  }

  function errorMessage(status, detail) {
    if (typeof detail === 'string' && detail) return detail
    if (detail && typeof detail === 'object' && typeof detail.message === 'string') return detail.message
    return `服务器请求失败（${status}）`
  }

  function fromResponse(status, result) {
    const detail = responseDetail(result)
    const code = detail && typeof detail === 'object' && typeof detail.code === 'string'
      ? detail.code
      : `HTTP_${status}`
    return new ApiError(errorMessage(status, detail), {
      status,
      code,
      detail,
      retryable: status === 408 || status === 429 || status >= 500,
    })
  }

  async function request({ method = 'GET', path, body, signal, timeoutMs = 15000, revision } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason)
      else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
    }
    const payload = body === undefined ? undefined : { ...body, ...(revision === undefined ? {} : { revision }) }
    try {
      const response = await global.fetch(path, {
        method,
        credentials: 'include',
        headers: payload === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: controller.signal,
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw fromResponse(response.status, result)
      return result
    } catch (error) {
      if (controller.signal.aborted && !signal?.aborted) {
        throw new ApiError('请求超时，请重试', { code: 'REQUEST_TIMEOUT', retryable: true })
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  global.KGDomainApi = Object.freeze({ request, ApiError })
})(window)
