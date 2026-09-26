'use strict';

/* 单题留言 + 弹幕共享模块。
 * 评论挂题目全局 ID（/api/v1/questions/<id>/comments），跨试卷/练习聚合；
 * 弹幕条是留言的可视化层（≤30 字留言滚动展示），不单独建数据。
 * mountPanel/mountCard 只在解析后提供入口；当前聚焦题目独占全屏弹幕与抽屉。
 * 提交前/做题中不渲染任何评论 DOM，由调用方在解析可见时调用。
 */
;(function (global) {
  const instances = new Set()
  let active = null
  const preferenceKey = 'kg.questionDiscussion.danmaku'
  function enabled() { try { return localStorage.getItem(preferenceKey) !== 'off' } catch (_) { return true } }
  function remember(value) { try { localStorage.setItem(preferenceKey, value ? 'on' : 'off') } catch (_) {} }
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
    const [pathname, query] = path.split('?')
    const url = (pathname.startsWith('@favorites') ? '/api/v1/question-comments/favorites' : API_ROOT + pathname.split('/').map(encodeURIComponent).join('/')) + (query ? '?' + query : '')
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
    return `<div class="q-danmaku" aria-label="本题弹幕"><div class="q-danmaku-track">${items.map((comment, index) => `<button type="button" class="q-danmaku-item" data-danmaku-comment-id="${escapeHTML(comment.id)}" style="--q-danmaku-lane:${index % 4};--q-danmaku-delay:-${(index * (DANMAKU_DURATION_SECONDS / items.length)).toFixed(2)}s">${escapeHTML(comment.content)}</button>`).join('')}</div></div>`
  }

  function commentItemMarkup(comment) {
    return `<li class="q-comment" data-comment-id="${escapeHTML(comment.id)}">
      <div class="q-comment-main">
        <span class="q-comment-author">${escapeHTML(comment.author)}</span>
        <span class="q-comment-time">${escapeHTML(formatTime(comment.createdAt))}</span>
        ${comment.parentId ? `<small class="q-comment-parent">回复：${escapeHTML(comment.parentContent || "原留言")}</small>` : ''}
        <p class="q-comment-content">${escapeHTML(comment.content)}</p>
      </div>
      <div class="q-comment-actions">
        <button type="button" class="q-comment-like${comment.myLike ? ' is-liked' : ''}" data-qc-action="toggle-like" aria-pressed="${comment.myLike ? 'true' : 'false'}" aria-label="点赞">👍 <span data-qc-like-count>${Number(comment.likeCount) || 0}</span></button>
        <button type="button" data-qc-action="toggle-favorite" aria-pressed="${!!comment.myFavorite}">${comment.myFavorite ? '已收藏' : '收藏'}</button>
        <button type="button" data-qc-action="reply">回复</button>
        ${comment.questionTitle ? `<button type="button" data-qc-action="return">返回题目：${escapeHTML(comment.questionTitle)}</button>` : ''}
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
      <button type="button" data-qc-action="danmaku-toggle" aria-pressed="${enabled()}">弹幕${enabled() ? '开' : '关'}</button>
      <button type="button" data-qc-action="favorites">我的收藏</button>
      <button type="button" class="q-comments-toggle" data-qc-action="expand" aria-expanded="false">💬 ${escapeHTML(label)}</button>
    </section>`
  }

  function listMarkup(state) {
    if (state.favoritesMode) return state.favorites.map(commentItemMarkup).join('')
    const ids=new Set(state.comments.map(comment=>comment.id))
    const render = comment => {
      const replies=state.comments.filter(row=>row.parentId===comment.id)
      return commentItemMarkup(comment)+(replies.length ? `<li class="q-comment-thread" data-comment-id="${escapeHTML(comment.id)}"><button type="button" data-qc-action="toggle-replies" aria-expanded="${state.expandedReplies.has(comment.id)}">${replies.length} 条回复</button>${state.expandedReplies.has(comment.id)?`<ul>${replies.map(render).join('')}</ul>`:''}</li>`:'')
    }
    return state.comments.filter(comment=>!comment.parentId || !ids.has(comment.parentId)).map(render).join('')
  }

  function blockMarkup(state) {
    const shown = state.favoritesMode ? state.favorites : state.comments
    if (state.expanded === false) return collapsedMarkup(state)
    return `<section class="q-comments" data-qc-block aria-label="题目讨论">
<div class="q-drawer-handle" data-qc-handle aria-label="拖动讨论抽屉"></div>
      <div class="q-comments-head"><span>${state.favoritesMode ? '我的收藏' : '题目讨论'}</span><span class="q-comments-count" data-qc-total>${shown.length ? `${shown.length} 条` : ''}</span>${state.collapsible ? '<button type="button" class="q-comments-collapse" data-qc-action="collapse">收起</button>' : ''}</div>
      ${state.toastMessage ? `<div class="q-comments-toast" data-qc-toast role="status">${escapeHTML(state.toastMessage)}</div>` : ''}
      ${state.error ? `<div class="q-comments-error" role="status">留言加载失败 <button type="button" data-qc-action="retry">重试</button></div>` : ''}
      <ul class="q-comment-list" data-qc-list>${listMarkup(state)}</ul>
      ${shown.length ? '' : (state.error ? '' : `<p class="q-comments-empty">${state.favoritesMode ? '还没有收藏。' : '还没有留言，来聊聊这道题吧。'}</p>`)}
      ${state.nextCursor ? '<button type="button" data-qc-action="more">加载更多</button>' : ''}
      ${state.replyId ? `<div data-qc-reply>正在回复 <button type="button" data-qc-action="cancel-reply">取消回复</button></div>` : ''}
      ${state.favoritesMode ? '<button type="button" data-qc-action="discussion">回到本题讨论</button>' : composerMarkup(state.user)}
    </section>`
  }

  function activate(instance) {
    if(instance.disposed)return
    if (active && active !== instance) {
      active.state.expanded = false
      active.overlay?.remove()
      active.drawer?.remove()
      active.drawer = null
      renderInto(active)
    }
    active = instance
    renderOverlay(instance)
  }

  function renderOverlay(instance) {
    instance.overlay?.remove()
    instance.overlay = null
    if (active !== instance || instance.disposed || !enabled()) return
    const holder = document.createElement('div')
    holder.innerHTML = danmakuMarkup(instance.state.danmaku)
    const overlay = holder.firstElementChild
    if (!overlay) return
    document.body.appendChild(overlay)
    instance.overlay = overlay
    overlay.addEventListener('click', event => {
      const item = event.target.closest('[data-danmaku-comment-id]')
      if (!item) return
      item.classList.toggle('is-paused')
      instance.state.expanded = true
      instance.state.favoritesMode = false
      instance.state.nextCursor = instance.state.commentsCursor
      instance.returnFocus = instance.root.querySelector('[data-qc-action="expand"]')
      renderInto(instance)
      instance.drawer?.querySelector(`[data-comment-id="${CSS.escape(item.dataset.danmakuCommentId)}"]`)?.scrollIntoView({block:'nearest'})
    })
  }

  function renderInto(instance) {
    if (instance.disposed) return
    const { root, state } = instance
    const old = instance.drawer?.querySelector('.q-composer-input')
    if (old) state.draft = old.value
    root.innerHTML = collapsedMarkup({...state, expanded:false})
    root.querySelector('[data-qc-action="expand"]')?.setAttribute('aria-expanded', String(state.expanded))
    if (!state.expanded) {
      instance.drawer?.remove()
      instance.drawer = null
      return
    }
    if (!instance.drawer) {
      instance.drawer = document.createElement('div')
      instance.drawer.className = 'q-comments-drawer'
      instance.drawer.setAttribute('role','dialog')
      instance.drawer.setAttribute('aria-label','题目讨论')
      instance.drawer.tabIndex = -1
      document.body.appendChild(instance.drawer)
      instance.drawer.focus()
      wireEvents({...instance, root:instance.drawer, owner:instance})
      instance.drawer.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeDrawer(instance)
      })
    }
    instance.drawer.innerHTML = blockMarkup({...state, collapsible:true})
    const composer = instance.drawer.querySelector('.q-composer-input')
    if (composer) {
      composer.value = state.draft || ''
      const update = () => {
        state.draft = composer.value
        instance.drawer.querySelector('[data-qc-count]').textContent = `${composer.value.length}/${MAX_CONTENT}`
        instance.drawer.querySelector('[data-qc-action="send"]').disabled = !composer.value.trim() || instance.pending.has('send')
      }
      composer.addEventListener('input', update)
      update()
    }
    const handle = instance.drawer.querySelector('[data-qc-handle]')
    handle?.addEventListener('pointerdown', event => {
      const startY = event.clientY, startHeight = instance.drawer.getBoundingClientRect().height
      handle.setPointerCapture(event.pointerId)
      handle.onpointermove = move => { if (global.innerWidth <= 700) instance.drawer.style.height = Math.max(180, Math.min(global.innerHeight * .85, startHeight + startY - move.clientY)) + 'px' }
      handle.onpointerup = () => { handle.onpointermove = null; handle.onpointerup = null }
    })
  }

  function closeDrawer(instance) {
    instance.state.expanded = false
    instance.overlay?.querySelectorAll('.is-paused').forEach(item=>item.classList.remove('is-paused'))
    renderInto(instance)
    const action = instance.returnFocus?.dataset.qcAction || 'expand'
    instance.root.querySelector(`[data-qc-action="${action}"]`)?.focus()
  }

  function applyCommentUpdate(instance, comment) {
    const index = instance.state.comments.findIndex(item => item.id === comment.id)
    if (instance.disposed) return
    if (index >= 0) instance.state.comments.splice(index, 1, comment)
    instance.state.favorites=instance.state.favorites.map(row=>row.id===comment.id?{...row,...comment}:row)
    renderInto(instance)
  }

  async function reload(instance) {
    instance.state.error = false
    try {
      const payload = await request(`${instance.questionId}/comments`)
      if (instance.disposed) return
      instance.state.commentsCursor = payload.nextCursor
      if(!instance.state.favoritesMode)instance.state.nextCursor = payload.nextCursor
      instance.state.comments = payload.comments || []
      instance.state.danmaku = pickDanmaku(instance.state.comments)
      instance.state.count = instance.state.comments.length
      instance.state.loaded = true
    } catch (error) {
      if (text(error.message) === 'UNAUTHENTICATED') {renderInto(instance);return}
      instance.state.error = true
    }
    renderInto(instance)
    renderOverlay(instance)
  }

  function wireEvents(instance) {
    const eventRoot = instance.root
    instance = instance.owner || instance
    eventRoot.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-qc-action]')?.dataset.qcAction
      if (!action) return
      if (action === 'login') { global.KGSharedAuthDialog?.open?.('登录后即可参与题目讨论。'); return }
      if (action === 'expand') {
        instance.returnFocus = event.target.closest('button')
        activate(instance)
        instance.state.favoritesMode = false
        instance.state.nextCursor = instance.state.commentsCursor
        instance.state.expanded = true
        if (!instance.state.loaded) reload(instance)
        else renderInto(instance)
        return
      }
      if (action === 'collapse') {
        closeDrawer(instance)
        return
      }
      if (action === 'danmaku-toggle') { remember(!enabled()); renderInto(instance); renderOverlay(instance); return }
      if (action === 'favorites') { await loadFavorites(instance); return }
      if (action === 'discussion') { instance.state.favoritesMode=false; instance.state.nextCursor=instance.state.commentsCursor; renderInto(instance); return }
      if (action === 'cancel-reply') { instance.state.replyId=null; renderInto(instance); return }
      if (action === 'more') { await loadMore(instance); return }
      if (action === 'retry') { reload(instance); return }
      if (action === 'send') { send(instance); return }
      const commentEl = event.target.closest('[data-comment-id]')
      if (!commentEl) return
      const commentId = commentEl.dataset.commentId
      if(action==='toggle-replies'){const expanded=instance.state.expandedReplies;expanded.has(commentId)?expanded.delete(commentId):expanded.add(commentId);renderInto(instance);return}
      if (action === 'reply' && instance.state.favoritesMode) { returnToQuestion(instance,commentId); return }
      if (action === 'reply') { instance.state.replyId=commentId; instance.state.favoritesMode=false; renderInto(instance); instance.drawer?.querySelector('.q-composer-input')?.focus(); return }
      if (action === 'return') { returnToQuestion(instance, commentId); return }
      if (action === 'toggle-favorite') await toggleFavorite(instance, commentId)
      if (action === 'toggle-like') await toggleLike(instance, commentId)
      if (action === 'delete') await removeComment(instance, commentId)
    })
  }

  async function send(instance) {
    const composer = instance.drawer?.querySelector('.q-composer-input')
    const content = composer?.value.trim()
    if (!content || instance.pending.has('send')) return
    instance.pending.add('send')
    const button = instance.drawer.querySelector('[data-qc-action="send"]')
    button.disabled = true
    try {
      const payload = await request(`${instance.questionId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content, parentId:instance.state.replyId || null }),
      })
      if (instance.disposed) return
      instance.state.draft = ''
      composer.value = ''
      if(instance.state.replyId)instance.state.expandedReplies.add(instance.state.replyId)
      instance.state.replyId = null
      instance.state.comments.unshift(payload.comment)
      if (payload.comment.danmakuEligible) {
        instance.state.danmaku = pickDanmaku(instance.state.comments)
      }
      renderInto(instance)
      renderOverlay(instance)
    } catch (error) {
      if (text(error.message) !== 'UNAUTHENTICATED') {
        button.disabled = false
        showToast(instance, text(error.message) === 'REQUEST_FAILED' ? '发布失败，请稍后重试' : text(error.message))
      }
    } finally { instance.pending.delete('send'); if(!instance.disposed) renderInto(instance) }
  }

  async function toggleLike(instance, commentId) {
    const comment = instance.state.comments.concat(instance.state.favorites).find(item => item.id === commentId)
    if (!comment || instance.pending.has(commentId)) return
    instance.pending.add(commentId)
    try {
      const payload = comment.myLike
        ? await request(`${comment.questionId}/comments/${comment.id}/like`, { method: 'DELETE' })
        : await request(`${comment.questionId}/comments/${comment.id}/like`, { method: 'POST' })
      applyCommentUpdate(instance, payload.comment)
    } catch (error) {
      if (text(error.message) !== 'UNAUTHENTICATED') showToast(instance, '操作失败，请稍后重试')
    } finally { instance.pending.delete(commentId) }
  }

  async function removeComment(instance, commentId) {
    if(instance.pending.has(commentId))return
    instance.pending.add(commentId)
    try {
      await request(`${instance.questionId}/comments/${commentId}`, { method: 'DELETE' })
      instance.state.comments = instance.state.comments.filter(comment => comment.id !== commentId)
      instance.state.danmaku = pickDanmaku(instance.state.comments)
      renderInto(instance)
    } catch (error) {
      if (text(error.message) !== 'UNAUTHENTICATED') showToast(instance, '删除失败，请稍后重试')
    } finally { instance.pending.delete(commentId) }
  }

  function showToast(instance, message) {
    if(instance.disposed)return
    instance.state.toastMessage = text(message)
    const host = instance.drawer || instance.root
    let toast = host.querySelector('[data-qc-toast]')
    if (!toast) {
      toast = document.createElement('div')
      toast.className = 'q-comments-toast'
      toast.setAttribute('data-qc-toast', '')
      host.appendChild(toast)
    }
    toast.textContent = text(message)
    toast.hidden = false
    global.clearTimeout(instance.toastTimer)
    instance.toastTimer = global.setTimeout(() => { instance.state.toastMessage=''; (instance.drawer || instance.root).querySelector('[data-qc-toast]')?.remove() }, 2400)
  }

  function ensureInstance(anchor, markerAttr, questionId, source) {
    let instance = anchor[markerAttr]
    if (!instance || instance.questionId !== questionId) {
      // 换题：先移除上一题的讨论块，避免面板内随答题数累积旧 DOM。
      if (instance) teardown(instance)
      instance = {
        questionId,
        source,
        root: null,
        state: {
          comments: [],
          favorites: [],
          favoritesMode: false,
          draft: '',
          replyId: null,
          expandedReplies: new Set(),
          nextCursor: null,
          danmaku: [],
          error: false,
          user: currentUser(),
          // 报告页默认折叠成“查看本题讨论（N 条）”，展开才拉取留言；练习页解析面板始终展开。
          expanded: false,
          collapsible: source === 'report',
          count: 0,
          loaded: false,
        },
        pending: new Set(),
        toastTimer: 0,
      }
      instance.anchor = anchor
      instances.add(instance)
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

  /* 练习页：解析后追加讨论入口，弹幕和抽屉使用独立视口层。 */
  function mountPanel({ panel, questionId }) {
    if (!panel || !questionId) return null
    const instance = ensureInstance(panel, '__kgQuestionComments', text(questionId), 'practice')
    attach(instance, panel)
    activate(instance)
    reload(instance)
    return instance
  }

  /* 报告页题卡：默认折叠条（点击展开），展开后才拉取留言。 */
  function mountCard({ card, questionId, commentCount }) {
    if (!card || !questionId || !card.isConnected) return null
    const instance = ensureInstance(card, '__kgQuestionComments', text(questionId), 'report')
    if (commentCount != null && !instance.state.loaded) {
      instance.state.count = Number(commentCount) || 0
    }
    attach(instance, card)
    if(!instance.focusWired) {
      card.tabIndex=card.tabIndex < 0 ? 0 : card.tabIndex
      const focusQuestion=()=>{if(instance.disposed)return;activate(instance);if(!instance.state.loaded)reload(instance)}
      card.addEventListener('focusin', focusQuestion)
      const clickQuestion=event=>{if(!event.target.closest('[data-qc-action]'))focusQuestion()}
      card.addEventListener('click',clickQuestion)
      instance.focusWired=true
      instance.removeFocusListeners=()=>{card.removeEventListener('focusin',focusQuestion);card.removeEventListener('click',clickQuestion)}
    }
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

  async function loadFavorites(instance) {
    activate(instance)
    instance.returnFocus = instance.root.querySelector('[data-qc-action="favorites"]')
    try {
      const payload = await request('@favorites')
      if(instance.disposed)return
      instance.state.favorites=payload.comments || []
      instance.state.favoritesCursor=payload.nextCursor
      instance.state.nextCursor=payload.nextCursor
      instance.state.favoritesMode=true
      instance.state.expanded=true
      renderInto(instance)
    } catch(error) { showToast(instance, text(error.message)) }
  }
  async function loadMore(instance) {
    if(!instance.state.nextCursor || instance.pending.has('more'))return
    instance.pending.add('more')
    try {
      const favorites=instance.state.favoritesMode
      const payload=await request(`${favorites ? '@favorites' : instance.questionId+'/comments'}?cursor=${encodeURIComponent(instance.state.nextCursor)}`)
      if(instance.disposed)return
      const key=favorites?'favorites':'comments'
      const ids=new Set(instance.state[key].map(c=>c.id))
      instance.state[key].push(...(payload.comments||[]).filter(c=>!ids.has(c.id)))
      instance.state[favorites?'favoritesCursor':'commentsCursor']=payload.nextCursor
      if(instance.state.favoritesMode===favorites)instance.state.nextCursor=payload.nextCursor
      renderInto(instance)
    } catch(error) { showToast(instance,text(error.message)) }
    finally { instance.pending.delete('more') }
  }
  async function toggleFavorite(instance, commentId) {
    const comment=instance.state.comments.concat(instance.state.favorites).find(c=>c.id===commentId)
    if(!comment || instance.pending.has(commentId))return
    instance.pending.add(commentId)
    try {
      const payload=await request(`${comment.questionId}/comments/${commentId}/favorite`,{method:comment.myFavorite?'DELETE':'PUT'})
      if(instance.disposed)return
      for(const key of ['comments','favorites']) instance.state[key]=instance.state[key].map(c=>c.id===commentId?{...c,...payload.comment}:c)
      if(instance.state.favoritesMode && !payload.comment.myFavorite) instance.state.favorites=instance.state.favorites.filter(c=>c.id!==commentId)
      renderInto(instance)
    } catch(error) { showToast(instance,text(error.message)) }
    finally { instance.pending.delete(commentId) }
  }
  function returnToQuestion(instance, commentId) {
    const comment=instance.state.favorites.find(c=>c.id===commentId)
    if(!comment)return
    const target=[...instances].find(row=>row.questionId===comment.questionId)
    if(target) { closeDrawer(instance); target.anchor.scrollIntoView({block:'center'}); activate(target); target.state.expanded=true; target.state.favoritesMode=false; reload(target); return }
    const question=comment.question || {}
    closeDrawer(instance)
    const article=document.createElement('article')
    article.className='q-favorite-question'
    article.innerHTML=`<button type="button" data-qc-close-question>关闭题目</button><h2>${escapeHTML(comment.questionTitle)}</h2><p>${escapeHTML(question.stem || (question.stemParts||[]).map(part=>part.text||'').join('') || question.title || '')}</p>${global.KGQuestionMaterials?.render?.(question,{readOnly:true,reveal:true}) || ''}<ol>${(question.options || []).map(option=>`<li>${escapeHTML(option.text || option.content || option)}</li>`).join('')}</ol><p>答案：${escapeHTML((question.correctOptionIds||[]).join('、') || question.correctAnswer || question.answer || '')}</p><p>${escapeHTML(question.analysis || question.explanation || '')}</p>`
    document.body.appendChild(article)
    const focused=mountCard({card:article,questionId:comment.questionId})
    article.querySelector('[data-qc-close-question]').onclick=()=>{teardown(focused);article.remove();instance.root.querySelector('[data-qc-action="favorites"]')?.focus()}
    activate(focused)
    focused.state.expanded=true
    reload(focused)
  }
  function teardown(target) {
    const selected=target ? [target.__kgQuestionComments || target] : [...instances]
    for(const instance of selected) {
      instance.disposed=true
      instance.overlay?.remove()
      instance.drawer?.remove()
      instance.root?.remove()
      instance.removeFocusListeners?.()
      if(instance.anchor?.classList.contains('q-favorite-question'))instance.anchor.remove()
      global.clearTimeout(instance.toastTimer)
      if(instance.anchor) delete instance.anchor.__kgQuestionComments
      instances.delete(instance)
      if(active===instance)active=null
    }
  }
  const lifecycle = new MutationObserver(() => {
    for(const instance of instances) {
      if(!instance.anchor.isConnected || instance.anchor.closest('[hidden]')) teardown(instance)
    }
  })
  lifecycle.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden']})
  global.addEventListener('kg-auth-session-change',()=>teardown())
  global.addEventListener('pagehide',()=>teardown())
  global.KGQuestionComments = Object.freeze({ mountPanel, mountCard, mountCards, pickDanmaku, teardown })
})(window)

