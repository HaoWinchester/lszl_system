'use strict';

/* 单题留言 + 弹幕共享模块。
 * 评论挂题目全局 ID（/api/v1/questions/<id>/comments），跨试卷/练习聚合；
 * 弹幕条是留言的可视化层（≤30 字留言滚动展示），不单独建数据。
 * mountPanel：练习页解析面板（弹幕条嵌面板顶端）；mountCard：报告页题卡（整块插入解析下方）。
 * 提交前/做题中不渲染任何评论 DOM，由调用方在解析可见时调用。
 */
;(function (global) {
  const API_ROOT = '/api/v1/questions/'
  const MAX_CONTENT = 200
  const DANMAKU_LIMIT = 8
  const DANMAKU_DURATION_SECONDS = 18
  // 与后端 MANAGER_ROLES 对齐：可删任意留言的角色。
  const MANAGER_ROLES = new Set(['admin', 'teacher'])

  function text(value) { return String(value == null ? '' : value) }
  function escapeHTML(value) {
    return text(value).replace(/[&<>'"]/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[char])
  }
  function formatTime(iso) {
    const date = new Date(text(iso))
    if (Number.isNaN(date.getTime())) return ''
    const now = new Date()
    const sameDay = date.toDateString() === now.toDateString()
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    return sameDay ? time : `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
  }

  function currentUser() {
    try { return global.KGAuthCore?.currentUser?.() || null } catch (error) { return null }
  }
  function canManage(user) { return !!user && MANAGER_ROLES.has(text(user.role)) }

  function request(path, options = {}) {
    // 按段编码：questionId/commentId 安全转义，保留路径分隔符。
    const url = API_ROOT + path.split('/').map(encodeURIComponent).join('/')
    return fetch(url, {
      credentials: 'include',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
    }).then(async response => {
      if (response.status === 401) {
        document.dispatchEvent(new CustomEvent('kg:auth-required'))
        throw new Error('UNAUTHENTICATED')
      }
      if (response.status === 204) return null
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(text(payload.detail) || 'REQUEST_FAILED')
      return payload
    })
  }

  /* 弹幕取材：他人短留言优先，最多 8 条。 */
  function pickDanmaku(comments) {
    const eligible = comments.filter(comment => comment.danmakuEligible)
    const mine = currentUser()?.username
    const others = eligible.filter(comment => !comment.isMine)
    const own = eligible.filter(comment => comment.isMine)
    return others.concat(own).slice(0, DANMAKU_LIMIT)
  }

  function danmakuMarkup(items) {
    if (!items.length) return ''
    return `<div class="q-danmaku" aria-hidden="true"><div class="q-danmaku-track">${items.map((comment, index) => `<span class="q-danmaku-item" style="--q-danmaku-delay:-${(index * (DANMAKU_DURATION_SECONDS / items.length)).toFixed(2)}s">${escapeHTML(comment.content)}</span>`).join('')}</div></div>`
  }

  function commentItemMarkup(comment) {
    return `<li class="q-comment" data-comment-id="${escapeHTML(comment.id)}">
      <div class="q-comment-main">
        <span class="q-comment-author">${escapeHTML(comment.author)}</span>
        <span class="q-comment-time">${escapeHTML(formatTime(comment.createdAt))}</span>
        <p class="q-comment-content">${escapeHTML(comment.content)}</p>
      </div>
      <div class="q-comment-actions">
        <button type="button" class="q-comment-like${comment.myLike ? ' is-liked' : ''}" data-qc-action="toggle-like" aria-pressed="${comment.myLike ? 'true' : 'false'}" aria-label="点赞">👍 <span data-qc-like-count>${Number(comment.likeCount) || 0}</span></button>
        ${comment.canDelete ? `<button type="button" class="q-comment-delete" data-qc-action="delete" aria-label="删除留言">删除</button>` : ''}
      </div>
    </li>`
  }

  function composerMarkup(user) {
    if (!user) {
      return `<div class="q-composer"><button type="button" class="q-composer-login" data-qc-action="login">登录后参与讨论</button></div>`
    }
    return `<div class="q-composer">
      <textarea class="q-composer-input" rows="2" maxlength="${MAX_CONTENT}" placeholder="说说你对这道题的看法或疑问…"></textarea>
      <div class="q-composer-foot"><span class="q-composer-count" data-qc-count>0/${MAX_CONTENT}</span><button type="button" class="q-composer-send" data-qc-action="send" disabled>发布</button></div>
    </div>`
  }

  function collapsedMarkup(state) {
    const count = state.count
    const label = count ? `查看本题讨论（${count} 条）` : '还没有留言，来说点什么'
    return `<section class="q-comments is-collapsed" data-qc-block aria-label="题目讨论">
      <button type="button" class="q-comments-toggle" data-qc-action="expand" aria-expanded="false">💬 ${escapeHTML(label)}</button>
    </section>`
  }

  function blockMarkup(state) {
    if (state.expanded === false) return collapsedMarkup(state)
    return `<section class="q-comments" data-qc-block aria-label="题目讨论">
      <div data-qc-danmaku>${danmakuMarkup(state.danmaku)}</div>
      <div class="q-comments-head"><span>题目讨论</span><span class="q-comments-count" data-qc-total>${state.comments.length ? `${state.comments.length} 条` : ''}</span>${state.collapsible ? '<button type="button" class="q-comments-collapse" data-qc-action="collapse">收起</button>' : ''}</div>
      ${state.error ? `<div class="q-comments-error" role="status">留言加载失败 <button type="button" data-qc-action="retry">重试</button></div>` : ''}
      <ul class="q-comment-list" data-qc-list>${state.comments.map(commentItemMarkup).join('')}</ul>
      ${state.comments.length ? '' : (state.error ? '' : '<p class="q-comments-empty">还没有留言，来聊聊这道题吧。</p>')}
      ${composerMarkup(state.user)}
    </section>`
  }

  function renderInto(instance) {
    const { root, state } = instance
    root.innerHTML = blockMarkup(state)
    const composer = root.querySelector('.q-composer-input')
    if (composer) {
      composer.addEventListener('input', () => {
        root.querySelector('[data-qc-count]').textContent = `${composer.value.length}/${MAX_CONTENT}`
        root.querySelector('[data-qc-action="send"]').disabled = !composer.value.trim()
      })
    }
  }

  function applyCommentUpdate(instance, comment) {
    const index = instance.state.comments.findIndex(item => item.id === comment.id)
    if (index >= 0) instance.state.comments.splice(index, 1, comment)
    renderInto(instance)
  }

  async function reload(instance) {
    instance.state.error = false
    try {
      const payload = await request(`${instance.questionId}/comments`)
      instance.state.comments = payload.comments || []
      instance.state.danmaku = pickDanmaku(instance.state.comments)
      instance.state.count = instance.state.comments.length
      instance.state.loaded = true
    } catch (error) {
      if (text(error.message) === 'UNAUTHENTICATED') return
      instance.state.error = true
    }
    renderInto(instance)
  }

  function wireEvents(instance) {
    instance.root.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-qc-action]')?.dataset.qcAction
      if (!action) return
      if (action === 'login') { global.KGSharedAuthDialog?.open?.('登录后即可参与题目讨论。'); return }
      if (action === 'expand') {
        instance.state.expanded = true
        if (!instance.state.loaded) reload(instance)
        else renderInto(instance)
        return
      }
      if (action === 'collapse') {
        instance.state.expanded = false
        instance.state.count = instance.state.comments.length
        renderInto(instance)
        return
      }
      if (action === 'retry') { reload(instance); return }
      if (action === 'send') { send(instance); return }
      const commentEl = event.target.closest('[data-comment-id]')
      if (!commentEl) return
      const commentId = commentEl.dataset.commentId
      if (action === 'toggle-like') await toggleLike(instance, commentId)
      if (action === 'delete') await removeComment(instance, commentId)
    })
  }

  async function send(instance) {
    const composer = instance.root.querySelector('.q-composer-input')
    const content = composer?.value.trim()
    if (!content) return
    const button = instance.root.querySelector('[data-qc-action="send"]')
    button.disabled = true
    try {
      const payload = await request(`${instance.questionId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      })
      instance.state.comments.unshift(payload.comment)
      if (payload.comment.danmakuEligible) {
        instance.state.danmaku = pickDanmaku(instance.state.comments)
      }
      renderInto(instance)
    } catch (error) {
      if (text(error.message) !== 'UNAUTHENTICATED') {
        button.disabled = false
        showToast(instance, text(error.message) === 'REQUEST_FAILED' ? '发布失败，请稍后重试' : text(error.message))
      }
    }
  }

  async function toggleLike(instance, commentId) {
    const comment = instance.state.comments.find(item => item.id === commentId)
    if (!comment) return
    try {
      const payload = comment.myLike
        ? await request(`${instance.questionId}/comments/${encodeURIComponent(comment.id)}/like`, { method: 'DELETE' })
        : await request(`${instance.questionId}/comments/${encodeURIComponent(comment.id)}/like`, { method: 'POST' })
      applyCommentUpdate(instance, payload.comment)
    } catch (error) {
      if (text(error.message) !== 'UNAUTHENTICATED') showToast(instance, '操作失败，请稍后重试')
    }
  }

  async function removeComment(instance, commentId) {
    try {
      await request(`${instance.questionId}/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' })
      instance.state.comments = instance.state.comments.filter(comment => comment.id !== commentId)
      instance.state.danmaku = pickDanmaku(instance.state.comments)
      renderInto(instance)
    } catch (error) {
      if (text(error.message) !== 'UNAUTHENTICATED') showToast(instance, '删除失败，请稍后重试')
    }
  }

  function showToast(instance, message) {
    let toast = instance.root.querySelector('[data-qc-toast]')
    if (!toast) {
      toast = document.createElement('div')
      toast.className = 'q-comments-toast'
      toast.setAttribute('data-qc-toast', '')
      instance.root.appendChild(toast)
    }
    toast.textContent = text(message)
    toast.hidden = false
    global.clearTimeout(instance.toastTimer)
    instance.toastTimer = global.setTimeout(() => { toast.hidden = true }, 2400)
  }

  function ensureInstance(anchor, markerAttr, questionId, source) {
    let instance = anchor[markerAttr]
    if (!instance || instance.questionId !== questionId) {
      // 换题：先移除上一题的讨论块，避免面板内随答题数累积旧 DOM。
      if (instance?.root?.parentElement) instance.root.remove()
      instance = {
        questionId,
        source,
        root: null,
        state: {
          comments: [],
          danmaku: [],
          error: false,
          user: currentUser(),
          // 报告页默认折叠成“查看本题讨论（N 条）”，展开才拉取留言；练习页解析面板始终展开。
          expanded: source !== 'report',
          collapsible: source === 'report',
          count: 0,
          loaded: false,
        },
        toastTimer: 0,
      }
      anchor[markerAttr] = instance
      instance.wired = false
    }
    instance.state.user = currentUser()
    return instance
  }

  function attach(instance, host) {
    if (instance.root?.parentElement !== host) {
      instance.root = document.createElement('div')
      host.appendChild(instance.root)
    }
    if (!instance.wired) { wireEvents(instance); instance.wired = true }
  }

  /* 练习页：讨论块（弹幕条+留言）追加到解析面板内（解析文字之后）。 */
  function mountPanel({ panel, questionId }) {
    if (!panel || !questionId) return null
    const instance = ensureInstance(panel, '__kgQuestionComments', text(questionId), 'practice')
    attach(instance, panel)
    reload(instance)
    return instance
  }

  /* 报告页题卡：默认折叠条（点击展开），展开后才拉取留言。 */
  function mountCard({ card, questionId, commentCount }) {
    if (!card || !questionId) return null
    const instance = ensureInstance(card, '__kgQuestionComments', text(questionId), 'report')
    if (commentCount != null && !instance.state.loaded) {
      instance.state.count = Number(commentCount) || 0
    }
    attach(instance, card)
    if (instance.state.expanded && !instance.state.loaded) reload(instance)
    else renderInto(instance)
    return instance
  }

  /* 报告页批量挂载：一次批量请求各题留言数，供折叠条展示“N 条”。 */
  async function mountCards({ cards }) {
    if (!Array.isArray(cards) || !cards.length) return []
    const ids = [...new Set(cards.map(item => text(item.questionId)).filter(Boolean))]
    let counts = null
    if (ids.length) {
      try {
        const response = await fetch(`/api/v1/question-comments/counts?ids=${encodeURIComponent(ids.join(','))}`, { credentials: 'include' })
        if (response.ok) counts = await response.json()
      } catch (error) { /* 条数拿不到就显示无条数折叠条，不阻塞挂载 */ }
    }
    const payload = counts && typeof counts === 'object' ? counts.counts : null
    return cards.map(item => mountCard({
      card: item.card,
      questionId: item.questionId,
      commentCount: payload ? payload[item.questionId] : null,
    }))
  }

  global.KGQuestionComments = Object.freeze({ mountPanel, mountCard, mountCards, pickDanmaku })
})(window)

