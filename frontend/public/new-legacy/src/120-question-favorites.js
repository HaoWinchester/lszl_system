'use strict';

/* 题目收藏共享模块：收藏/取消收藏当前题，大厅「我的收藏」抽屉展示题目与解析。
 * 数据在后端 question_favorites 表按 owner 隔离；本模块只维护内存缓存与渲染。
 * 抽屉开关由宿主页（practice-mode）沿用 setDrawerOpen 体系，本模块提供数据、
 * 搜索、分页（游标）与题目详情渲染。
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

  function sourceLine(item) {
    const source = item.source || {}
    const parts = [source.bankName, source.subject, source.difficulty].map(text).filter(Boolean)
    return parts.join(' · ')
  }

  function favoriteItemMarkup(item) {
    const analysis = text(item.analysis).trim()
    const source = sourceLine(item)
    return `<article class="practice-favorite-card" data-favorite-item="${escapeHTML(item.questionId)}">
      <header class="practice-favorite-card-head">
        <span class="practice-favorite-type">${escapeHTML(TYPE_LABELS[item.type] || '题目')}</span>
        <time datetime="${escapeHTML(item.favoritedAt)}">收藏于 ${escapeHTML(formatTime(item.favoritedAt))}</time>
      </header>
      <p class="practice-favorite-stem">${escapeHTML(text(item.stemText).trim() || '（暂无题干）')}</p>
      ${source ? `<p class="practice-favorite-source"><span>来源</span>${escapeHTML(source)}</p>` : ''}
      ${analysis ? `<div class="practice-favorite-analysis"><strong>解析</strong><p>${escapeHTML(analysis)}</p></div>` : ''}
      <footer class="practice-favorite-card-foot">
        <button type="button" class="practice-favorite-detail-btn" data-favorite-open="${escapeHTML(item.questionId)}">查看详情</button>
        <button type="button" data-favorite-remove="${escapeHTML(item.questionId)}">取消收藏</button>
      </footer>
    </article>`
  }

  async function fetchList(cursor, limit = 50, search = '') {
    const query = new URLSearchParams({ limit: String(limit) })
    if (cursor) query.set('cursor', cursor)
    if (search) query.set('search', search)
    return request('?' + query.toString())
  }

  /* —— 抽屉列表状态：搜索 + 游标分页 + 详情弹层 —— */
  const drawerState = { search: '', items: [], nextCursor: null, controls: null, loading: false }

  const boundControls = new Set()

  function bindControls(controls) {
    if (!controls) return
    // 宿主每次打开抽屉都会传入新的 controls 字面量；按元素去重避免重复绑定监听器
    const key = [controls.searchInput, controls.moreBtn, controls.detail, controls.list].map(node => node || '').join('|')
    if (boundControls.has(key)) { drawerState.controls = controls; return }
    boundControls.add(key)
    drawerState.controls = controls
    if (controls.searchInput) {
      let timer = null
      controls.searchInput.addEventListener('input', () => {
        global.clearTimeout(timer)
        timer = global.setTimeout(() => {
          drawerState.search = text(controls.searchInput.value).trim()
          loadFirstPage().catch(() => {})
        }, 280)
      })
    }
    if (controls.moreBtn) {
      controls.moreBtn.addEventListener('click', () => { loadMore().catch(() => {}) })
    }
    if (controls.detail) {
      controls.detail.addEventListener('click', event => {
        if (event.target === controls.detail || event.target.closest('[data-favorite-detail-close]')) closeDetail()
        const removeBtn = event.target.closest('[data-favorite-detail-remove]')
        if (removeBtn) removeFavorite(text(removeBtn.dataset.favoriteDetailRemove))
      })
    }
    if (controls.list) {
      controls.list.addEventListener('click', event => {
        const open = event.target.closest('[data-favorite-open]')
        if (open) openDetail(text(open.dataset.favoriteOpen))
      })
    }
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && controls.detail && !controls.detail.hidden) closeDetail()
    })
  }

  function syncControls() {
    const controls = drawerState.controls
    if (!controls) return
    if (controls.moreBtn) {
      controls.moreBtn.hidden = !drawerState.nextCursor
      controls.moreBtn.disabled = drawerState.loading
      controls.moreBtn.textContent = drawerState.loading ? '正在加载…' : '加载更多'
    }
    const knownTotal = drawerState.items.length + (drawerState.nextCursor ? '+' : '')
    if (controls.summary && drawerState.items.length) controls.summary.textContent = `共收藏 ${knownTotal} 道题`
  }

  async function loadFirstPage() {
    drawerState.items = []
    drawerState.nextCursor = null
    await fetchPage(true)
  }

  async function loadMore() {
    if (drawerState.nextCursor && !drawerState.loading) await fetchPage(false)
  }

  async function fetchPage(reset) {
    const controls = drawerState.controls
    if (!controls || drawerState.loading) return
    drawerState.loading = true
    syncControls()
    try {
      const payload = await fetchList(reset ? null : drawerState.nextCursor, 50, drawerState.search)
      const items = payload.favorites || []
      items.forEach(item => remember(item.questionId, true))
      drawerState.items = reset ? items : drawerState.items.concat(items)
      drawerState.nextCursor = payload.nextCursor || null
      renderDrawerList()
    } finally {
      drawerState.loading = false
      syncControls()
    }
  }

  function renderDrawerList() {
    const controls = drawerState.controls
    if (!controls) return
    const items = drawerState.items
    if (controls.list) controls.list.innerHTML = items.map(favoriteItemMarkup).join('')
    if (controls.empty) {
      controls.empty.hidden = items.length > 0
      if (!items.length) {
        controls.empty.textContent = drawerState.search
          ? `没有匹配“${drawerState.search}”的收藏题目。`
          : '在练习中点击左侧“收藏”，题目就会保存在这里。'
      }
    }
    if (controls.summary) controls.summary.textContent = items.length
      ? (drawerState.search ? `匹配 ${items.length} 道收藏题` : `共收藏 ${items.length}${drawerState.nextCursor ? '+' : ''} 道题`)
      : (drawerState.search ? '没有匹配的收藏题目' : '还没有收藏的题目')
  }

  /* —— 详情弹层 —— */
  function detailOptionMarkup(option) {
    return `<li class="${option.correct ? 'is-correct' : ''}"><span class="practice-favorite-detail-key">${escapeHTML(option.id)}</span><span>${escapeHTML(text(option.text))}</span>${option.correct ? '<em>正确答案</em>' : ''}</li>`
  }

  function detailMarkup(detail) {
    const source = detail.source || {}
    const sourceParts = [source.bankName, source.subject, source.difficulty].map(text).filter(Boolean)
    const stem = (detail.stemParts || [])
      .map(part => text(typeof part === 'string' ? part : (part && part.text) || '').trim())
      .filter(Boolean)
      .map(paragraph => `<p>${escapeHTML(paragraph)}</p>`)
      .join('') || `<p>${escapeHTML(text(detail.title))}</p>`
    const analysis = text(detail.analysis).trim()
    const clues = (detail.clues || []).map(text).filter(Boolean)
    const concepts = (detail.concepts || []).map(text).filter(Boolean)
    return `<section class="practice-favorite-detail-dialog" role="dialog" aria-modal="true" aria-label="收藏题目详情">
      <header class="practice-favorite-detail-head">
        <div>
          <p class="practice-favorite-detail-meta">
            <span class="practice-favorite-type">${escapeHTML(TYPE_LABELS[detail.type] || '题目')}</span>
            ${sourceParts.length ? `<span>${escapeHTML(sourceParts.join(' · '))}</span>` : ''}
            ${detail.favoritedAt ? `<span>收藏于 ${escapeHTML(formatTime(detail.favoritedAt))}</span>` : ''}
          </p>
          <h3>题目详情</h3>
        </div>
        <button type="button" class="practice-favorite-detail-close" data-favorite-detail-close aria-label="关闭题目详情">×</button>
      </header>
      <div class="practice-favorite-detail-body">
        <div class="practice-favorite-detail-stem">${stem}</div>
        ${global.KGQuestionMaterials?.renderMaterials(detail) || ''}
        ${detail.options && detail.options.length ? `<ul class="practice-favorite-detail-options">${detail.options.map(detailOptionMarkup).join('')}</ul>` : ''}
        ${analysis ? `<div class="practice-favorite-analysis"><strong>解析</strong><p>${escapeHTML(analysis)}</p></div>` : ''}
        ${clues.length ? `<div class="practice-favorite-detail-tags"><strong>线索</strong>${clues.map(item => `<span>${escapeHTML(item)}</span>`).join('')}</div>` : ''}
        ${concepts.length ? `<div class="practice-favorite-detail-tags"><strong>知识点</strong>${concepts.map(item => `<span>${escapeHTML(item)}</span>`).join('')}</div>` : ''}
      </div>
      <footer class="practice-favorite-detail-foot">
        <button type="button" class="practice-favorite-detail-remove" data-favorite-detail-remove="${escapeHTML(detail.questionId)}">${detail.favorited ? '取消收藏' : '已取消收藏'}</button>
        <button type="button" class="practice-favorite-detail-done" data-favorite-detail-close>关闭</button>
      </footer>
    </section>`
  }

  async function openDetail(questionId) {
    const controls = drawerState.controls
    if (!controls || !controls.detail) return
    try {
      const detail = await request('detail?question_id=' + encodeURIComponent(questionId))
      controls.detail.innerHTML = detailMarkup(detail)
      global.KGQuestionMaterials?.bindMedia(controls.detail)
      controls.detail.hidden = false
      controls.detail.setAttribute('aria-hidden', 'false')
      document.body.style.overflow = 'hidden'
    } catch (error) {
      if (text(error.message) !== 'UNAUTHENTICATED' && controls.onToast) controls.onToast(error.message || '详情读取失败')
    }
  }

  function closeDetail() {
    const controls = drawerState.controls
    if (!controls || !controls.detail) return
    controls.detail.hidden = true
    controls.detail.setAttribute('aria-hidden', 'true')
    controls.detail.innerHTML = ''
    document.body.style.overflow = ''
  }

  async function removeFavorite(questionId) {
    try {
      await toggle(questionId)
      drawerState.items = drawerState.items.filter(item => text(item.questionId) !== text(questionId))
      renderDrawerList()
      syncControls()
      closeDetail()
      if (drawerState.controls && drawerState.controls.onToast) drawerState.controls.onToast('已取消收藏')
    } catch (error) {
      if (drawerState.controls && drawerState.controls.onToast) drawerState.controls.onToast(text(error.message) === 'UNAUTHENTICATED' ? '请先登录' : (error.message || '操作失败，请稍后重试。'))
    }
  }

  async function renderList(target, emptyTarget, summaryTarget, controls) {
    bindControls({ ...controls, list: target, empty: emptyTarget, summary: summaryTarget })
    await loadFirstPage()
    return { total: drawerState.items.length }
  }

  document.addEventListener('kg-auth-session-change', () => { cache.clear(); countCache.clear(); drawerState.items = [] })

  global.KGQuestionFavorites = Object.freeze({ status, isFavorited, toggle, count, questionCount, counts, renderList, fetchList, openDetail, closeDetail })
})(window);
