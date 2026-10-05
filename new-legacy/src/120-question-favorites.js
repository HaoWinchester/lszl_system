'use strict';

/* 题目收藏共享模块：收藏/取消收藏当前题，大厅「我的收藏」抽屉展示题目与解析。
 * 数据在后端 question_favorites 表按 owner 隔离；本模块只维护内存缓存与渲染。
 * 抽屉开关由宿主页（practice-mode）沿用 setDrawerOpen 体系，本模块提供数据与列表渲染。
 */
;(function (global) {
  const API_ROOT = '/api/v1/question-favorites'
  // 已确认状态的题目 ID → 是否收藏；未确认过的 ID 才会发起批量查询。
  const cache = new Map()

  function text(value) { return String(value == null ? '' : value) }
  function escapeHTML(value) {
    return text(value).replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[char])
  }
  function formatTime(iso) {
    const date = new Date(text(iso))
    if (Number.isNaN(date.getTime())) return ''
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
  }

  function request(path, options = {}) {
    const separator = path.startsWith('/') || path.startsWith('?') ? '' : '/'
    return fetch(API_ROOT + separator + path, {
      credentials: 'include',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
    }).then(async response => {
      if (response.status === 401) {
        document.dispatchEvent(new CustomEvent('kg:auth-required'))
        throw new Error('UNAUTHENTICATED')
      }
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(text(payload.detail) || 'REQUEST_FAILED')
      return payload
    })
  }

  function remember(questionId, favorited) { cache.set(text(questionId), !!favorited) }

  // 题目收藏总数缓存（侧栏角标，全站维度）：本人 toggle 后失效，由宿主刷新。
  const countCache = new Map()

  /* 批量查询收藏状态：只查缓存里没有的 ID，练习开始时预热一批。 */
  async function status(questionIds) {
    const ids = [...new Set((questionIds || []).map(text).filter(Boolean))].filter(id => !cache.has(id))
    if (ids.length) {
      try {
        const payload = await request('status?ids=' + encodeURIComponent(ids.join(',')))
        Object.entries(payload.status || {}).forEach(([id, favorited]) => remember(id, favorited))
      } catch (error) {
        if (text(error.message) !== 'UNAUTHENTICATED') throw error
      }
    }
    const result = {}
    ;(questionIds || []).map(text).filter(Boolean).forEach(id => { result[id] = !!cache.get(id) })
    return result
  }

  function isFavorited(questionId) { return !!cache.get(text(questionId)) }

  async function toggle(questionId) {
    const id = text(questionId)
    const payload = await request(encodeURIComponent(id) + '/toggle', { method: 'POST' })
    remember(id, payload.favorited)
    countCache.delete(id)
    return { questionId: id, favorited: !!payload.favorited }
  }

  /* 批量题目收藏总数（侧栏角标用）：只查缓存没有的 ID，后端对可见题目补零。 */
  async function counts(questionIds) {
    const ids = [...new Set((questionIds || []).map(text).filter(Boolean))].filter(id => !countCache.has(id))
    if (ids.length) {
      try {
        const payload = await request('counts?ids=' + encodeURIComponent(ids.join(',')))
        Object.entries(payload.counts || {}).forEach(([id, count]) => countCache.set(text(id), Number(count) || 0))
        ids.forEach(id => { if (!countCache.has(id)) countCache.set(id, 0) })
      } catch (error) {
        if (text(error.message) === 'UNAUTHENTICATED') return {}
      }
    }
    const result = {}
    ;(questionIds || []).map(text).filter(Boolean).forEach(id => { result[id] = countCache.get(id) || 0 })
    return result
  }
  /* 单题收藏总数（角标）；与旧的全局 count()（本机收藏条数）同名会互相覆盖，故单独命名。 */
  function questionCount(questionId) { return countCache.get(text(questionId)) }

  function count() { return [...cache.values()].filter(Boolean).length }

  const TYPE_LABELS = { single_choice: '单选题', multiple_choice: '多选题', matching: '匹配题' }

  function favoriteItemMarkup(item) {
    const analysis = text(item.analysis).trim()
    return `<article class="practice-favorite-card" data-favorite-item="${escapeHTML(item.questionId)}">
      <header class="practice-favorite-card-head">
        <span class="practice-favorite-type">${escapeHTML(TYPE_LABELS[item.type] || '题目')}</span>
        <time datetime="${escapeHTML(item.favoritedAt)}">收藏于 ${escapeHTML(formatTime(item.favoritedAt))}</time>
      </header>
      <p class="practice-favorite-stem">${escapeHTML(text(item.stemText).trim() || '（暂无题干）')}</p>
      ${analysis ? `<div class="practice-favorite-analysis"><strong>解析</strong><p>${escapeHTML(analysis)}</p></div>` : ''}
      <footer class="practice-favorite-card-foot">
        <button type="button" data-favorite-remove="${escapeHTML(item.questionId)}">取消收藏</button>
      </footer>
    </article>`
  }

  async function fetchList(cursor, limit = 50) {
    const query = new URLSearchParams({ limit: String(limit) })
    if (cursor) query.set('cursor', cursor)
    return request('?' + query.toString())
  }

  /* 渲染收藏列表到宿主容器；返回 {total} 供页脚统计。数据不可用时抛错由宿主提示。 */
  async function renderList(target, emptyTarget, summaryTarget) {
    const payload = await fetchList()
    const items = payload.favorites || []
    items.forEach(item => remember(item.questionId, true))
    if (target) target.innerHTML = items.map(favoriteItemMarkup).join('')
    if (emptyTarget) emptyTarget.hidden = items.length > 0
    if (summaryTarget) summaryTarget.textContent = items.length ? `共收藏 ${items.length} 道题` : '还没有收藏的题目'
    return { total: items.length }
  }

  document.addEventListener('kg-auth-session-change', () => { cache.clear(); countCache.clear() })

  global.KGQuestionFavorites = Object.freeze({ status, isFavorited, toggle, count, questionCount, counts, renderList, fetchList })
})(window);
