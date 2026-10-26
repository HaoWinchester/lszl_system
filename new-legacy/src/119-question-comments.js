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
  // 题目留言数缓存（侧栏角标）：发布/删除时失效并广播。
  const countCache = new Map()
  const preferenceKey = () => 'kg_question_discussion_danmaku_v1__' + encodeURIComponent(currentUser()?.username || 'guest')
  function enabled() { try { return global.KGDevicePreferences?.getString(preferenceKey(), 'on') !== 'off' } catch (_) { return true } }
  function remember(value) { try { global.KGDevicePreferences?.setString(preferenceKey(), value ? 'on' : 'off') } catch (_) {} }
  // 「不喜欢」的弹幕只在本机隐藏（按留言 ID 记录），不影响其他用户。
  const hiddenDanmakuKey = () => 'kg_question_danmaku_hidden_v1__' + encodeURIComponent(currentUser()?.username || 'guest')
  function hiddenDanmaku() {
    try { return new Set((global.KGDevicePreferences?.getString(hiddenDanmakuKey(), '') || '').split(',').filter(Boolean)) } catch (_) { return new Set() }
  }
  function hideDanmakuItem(commentId) {
    try {
      const ids = hiddenDanmaku(); ids.add(commentId)
      global.KGDevicePreferences?.setString(hiddenDanmakuKey(), [...ids].slice(-200).join(','))
    } catch (_) {}
  }
  const API_ROOT = '/api/v1/questions/'
  const MAX_CONTENT = 200
  // Microsoft Fluent Emoji artwork: assets/emoji/fluent/LICENSE (MIT). Text remains portable Unicode.
  const COMMENT_EMOJI = [["😊", "微笑", "faces"], ["👍", "赞", "gestures"], ["🙋", "举手", "gestures"], ["🎉", "庆祝", "learning"], ["🤔", "思考", "faces"], ["💡", "灵感", "learning"], ["✅", "完成", "learning"], ["👏", "鼓掌", "gestures"], ["❤️", "爱心", "learning"], ["📚", "学习", "learning"], ["💪", "加油", "gestures"], ["🙏", "感谢", "gestures"], ["😀", "开心", "faces"], ["😁", "笑容", "faces"], ["😆", "大笑", "faces"], ["😂", "笑哭", "faces"], ["🤣", "捧腹大笑", "faces"], ["🙂", "浅笑", "faces"], ["😉", "眨眼", "faces"], ["🥰", "喜爱", "faces"], ["😍", "心动", "faces"], ["😎", "酷", "faces"], ["🤩", "惊喜", "faces"], ["🥳", "欢呼", "faces"], ["😅", "流汗笑", "faces"], ["😇", "天使", "faces"], ["🤗", "拥抱", "faces"], ["🤭", "偷笑", "faces"], ["🤫", "安静", "faces"], ["🧐", "仔细看看", "faces"], ["😐", "平静", "faces"], ["🙄", "无奈", "faces"], ["😴", "睡觉", "faces"], ["😭", "大哭", "faces"], ["😮", "惊讶", "faces"], ["🥺", "恳求", "faces"], ["😤", "打气", "faces"], ["😔", "难过", "faces"], ["😷", "口罩", "faces"], ["🤯", "震惊", "faces"], ["👋", "你好", "gestures"], ["👌", "好的", "gestures"], ["🤝", "握手", "gestures"], ["✌️", "胜利", "gestures"], ["✍️", "记笔记", "learning"], ["🎯", "目标", "learning"], ["⭐", "星星", "learning"], ["🔥", "热情", "learning"]]
  const emojiAsset = value => 'assets/emoji/fluent/'+Array.from(value).map(char=>char.codePointAt(0).toString(16)).filter(code=>code!=='fe0f').join('-')+'.svg'
  const emojiNames=new Map(COMMENT_EMOJI.map(([emoji,name])=>[emoji,name]))
  const emojiSegments=typeof Intl.Segmenter==='function'?new Intl.Segmenter('zh',{granularity:'grapheme'}):null
  function commentContentMarkup(value) {
    if(!emojiSegments)return escapeHTML(value)
    return [...emojiSegments.segment(text(value))].map(({segment})=>emojiNames.has(segment)?`<img class="q-inline-emoji" data-comment-emoji="${segment}" src="${emojiAsset(segment)}" alt="${segment}" title="${emojiNames.get(segment)}" width="20" height="20" loading="lazy"/>`:escapeHTML(segment)).join('')
  }
  function emojiImageFallback(event) {
    const img=event.target
    if(img.tagName!=='IMG')return
    if(img.dataset.commentEmoji){img.replaceWith(document.createTextNode(img.dataset.commentEmoji));return}
    if(img.closest('[data-qc-emoji]')){img.hidden=true;const fallback=img.nextElementSibling;if(fallback)fallback.hidden=false}
  }
  function emojiPickerMarkup(state) {
    return `<div class="q-emoji-picker" data-qc-emoji-picker ${state.emojiExpanded?'':'hidden'} role="dialog" aria-label="基础表情">
      <div class="q-emoji-head"><strong>基础表情</strong><button type="button" data-qc-action="emoji-close" aria-label="关闭表情">×</button></div>
      <div class="q-emoji-categories" role="group" aria-label="表情分类">${[['all','全部'],['faces','笑脸'],['gestures','手势'],['learning','学习']].map(([id,label])=>`<button type="button" data-qc-action="emoji-category" data-qc-emoji-category="${id}" aria-pressed="${(state.emojiCategory||'all')===id}">${label}</button>`).join('')}</div>
      <div class="q-emoji-grid">${COMMENT_EMOJI.map(([emoji,name,group])=>`<button type="button" data-qc-action="emoji-insert" data-qc-emoji="${emoji}" data-qc-emoji-group="${group}" title="${name}" aria-label="插入${name}" ${(state.emojiCategory&&state.emojiCategory!=='all'&&state.emojiCategory!==group)?'hidden':''}><img src="${emojiAsset(emoji)}" alt="" width="28" height="28"/><span class="q-emoji-fallback" hidden>${emoji}</span></button>`).join('')}</div>
      <small>选择表情后继续输入评论</small></div>`
  }
  function positionEmojiPicker(instance) {
    const picker=instance.drawer?.querySelector('[data-qc-emoji-picker]'),button=instance.drawer?.querySelector('[data-qc-action="emoji-toggle"]')
    if(!picker||picker.hidden||!button)return
    const view=global.visualViewport,width=view?.width||global.innerWidth,height=view?.height||global.innerHeight,x=view?.offsetLeft||0,y=view?.offsetTop||0
    picker.style.width=Math.min(344,width-24)+'px';picker.style.maxHeight=Math.max(120,Math.min(310,height-24))+'px'
    const anchor=(instance.drawer.querySelector('.q-composer')||button).getBoundingClientRect(),rect=picker.getBoundingClientRect()
    picker.style.left=Math.max(x+12,Math.min(anchor.left,x+width-rect.width-12))+'px'
    picker.style.top=Math.max(y+12,Math.min(anchor.top-rect.height-8,y+height-rect.height-12))+'px'
  }
  function closeEmojiPicker(instance,focus=false) {
    instance.state.emojiExpanded=false
    const picker=instance.drawer?.querySelector('[data-qc-emoji-picker]'),button=instance.drawer?.querySelector('[data-qc-action="emoji-toggle"]')
    if(picker)picker.hidden=true
    button?.setAttribute('aria-expanded','false')
    if(focus)button?.focus()
  }
  function positionDanmaku(instance) {
    if(!instance?.overlay)return
    let top=112
    const button=document.getElementById('practiceLanguageCycle'),rect=button?.getBoundingClientRect()
    if(rect&&rect.width&&rect.height&&rect.bottom>0&&rect.top<global.innerHeight)top=Math.max(top,rect.bottom+18)
    instance.overlay.style.setProperty('--q-danmaku-top',Math.ceil(top)+'px')
  }
  let layoutFrame=0
  function queueCommentLayout() {
    if(layoutFrame)return
    layoutFrame=global.requestAnimationFrame(()=>{layoutFrame=0;for(const instance of instances){positionDanmaku(instance);positionEmojiPicker(instance)}})
  }
  global.addEventListener('resize',queueCommentLayout,{passive:true})
  global.addEventListener('scroll',queueCommentLayout,{passive:true,capture:true})
  global.visualViewport?.addEventListener('resize',queueCommentLayout,{passive:true})
  global.visualViewport?.addEventListener('scroll',queueCommentLayout,{passive:true})
  const DANMAKU_LIMIT = 8
  const DANMAKU_DURATION_SECONDS = 18
  const danmakuSettingsKey = () => 'kg_question_danmaku_settings_v1__' + encodeURIComponent(currentUser()?.username || 'guest')
  let settingsDialog = null
  function normalizeDanmakuSettings(value = {}) {
    const number = (input, fallback, min, max) => Number.isFinite(Number(input)) ? Math.max(min, Math.min(max, Number(input))) : fallback
    const maxCount = ['admin', 'teacher'].includes(currentUser()?.role) ? 600 : 20
    return {count:Math.round(number(value.count, DANMAKU_LIMIT, 1, maxCount)),duration:number(value.duration,DANMAKU_DURATION_SECONDS,8,40),opacity:number(value.opacity,100,20,100)}
  }
  function getDanmakuSettings() {
    try { return normalizeDanmakuSettings(global.KGDevicePreferences?.getJSON(danmakuSettingsKey(), {}) || {}) }
    catch (_) { return normalizeDanmakuSettings() }
  }
  function setDanmakuSettings(value) {
    const next = normalizeDanmakuSettings({...getDanmakuSettings(), ...value})
    if (!global.KGDevicePreferences) throw Error('当前设备无法保存弹幕设置')
    global.KGDevicePreferences.setJSON(danmakuSettingsKey(), next)
    for (const instance of instances) {
      instance.state.danmaku = pickDanmaku(instance.state.comments)
      renderOverlay(instance)
    }
    return next
  }
  function openDanmakuSettings() {
    if (settingsDialog) { settingsDialog.focus(); return }
    const current = getDanmakuSettings(), owner = currentUser()?.username || ''
    const dialog = document.createElement('dialog')
    dialog.id = 'questionDanmakuSettings'; dialog.className = 'q-danmaku-settings'
    const counts = [...new Set([1,2,4,8,12,20,current.count,...(['admin','teacher'].includes(currentUser()?.role)?[200,600]:[])])].sort((a,b)=>a-b)
    dialog.innerHTML = `<form><header><h2>弹幕设置</h2><button type="button" data-qc-settings-close aria-label="关闭弹幕设置">×</button></header>
      <label>每轮显示条数<select name="count">${counts.map(count=>`<option value="${count}">${count}${count>20?'（内部压测）':''}</option>`).join('')}</select></label>
      <label>播放时长（秒）<input name="duration" type="number" min="8" max="40" step="1" required><small>时长越短，移动越快</small></label>
      <label>不透明度（%）<input name="opacity" type="number" min="20" max="100" step="5" required></label>
      <p role="status" data-qc-settings-error></p><footer><button type="button" data-qc-settings-close>取消</button><button type="submit">应用设置</button></footer></form>`
    for (const [key,value] of Object.entries(current)) dialog.querySelector(`[name=${key}]`).value = String(value)
    const close = () => { dialog.close(); dialog.remove(); if (settingsDialog === dialog) settingsDialog = null }
    dialog.querySelectorAll('[data-qc-settings-close]').forEach(button=>button.addEventListener('click',close))
    dialog.addEventListener('cancel',event=>{event.preventDefault();close()})
    dialog.querySelector('form').addEventListener('submit',event=>{
      event.preventDefault()
      if ((currentUser()?.username || '') !== owner) { close(); return }
      try { setDanmakuSettings(Object.fromEntries(new FormData(event.currentTarget))); close() }
      catch (error) { dialog.querySelector('[data-qc-settings-error]').textContent = error.message || '设置保存失败，请重试' }
    })
    ;(document.fullscreenElement || document.body).append(dialog); settingsDialog = dialog; dialog.showModal()
  }
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
    const owner=currentUser()?.username
    // 按段编码：questionId/commentId 安全转义，保留路径分隔符。
    const [pathname, query] = path.split('?')
    const url = (pathname.startsWith('@favorites') ? '/api/v1/question-comments/favorites'
      : pathname.startsWith('@counts') ? '/api/v1/question-comments/counts'
      : API_ROOT + pathname.split('/').map(encodeURIComponent).join('/')) + (query ? '?' + query : '')
    return fetch(url, {
      credentials: 'include',
      headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
      ...options,
    }).then(async response => {
      if (response.status === 401) {
        document.dispatchEvent(new CustomEvent('kg:auth-required'))
        throw new Error('UNAUTHENTICATED')
      }
      if(owner!==currentUser()?.username)throw new Error('UNAUTHENTICATED')
      if (response.status === 204) return null
      const payload = await response.json().catch(() => ({}))
      if(owner!==currentUser()?.username)throw new Error('UNAUTHENTICATED')
      if (!response.ok) throw new Error(text(payload.detail) || 'REQUEST_FAILED')
      return payload
    })
  }

  /* 弹幕取材：他人短留言优先，最多 8 条；本机点过「不喜欢」的不再出现。 */
  function pickDanmaku(comments) {
    const hidden = hiddenDanmaku()
    const eligible = comments.filter(comment => comment.danmakuEligible && !hidden.has(comment.id))
    const others = eligible.filter(comment => !comment.isMine)
    const own = eligible.filter(comment => comment.isMine)
    return others.concat(own).slice(0, getDanmakuSettings().count)
  }

  function danmakuMarkup(items) {
    if (!items.length) return ''
    const settings = getDanmakuSettings()
    return `<div class="q-danmaku" aria-label="本题弹幕" style="--q-danmaku-duration:${settings.duration}s;--q-danmaku-opacity:${settings.opacity/100}"><div class="q-danmaku-track">${items.map((comment, index) => `<button type="button" class="q-danmaku-item" data-danmaku-comment-id="${escapeHTML(comment.id)}" style="--q-danmaku-lane:${index % 2};--q-danmaku-delay:-${(index * (settings.duration / items.length)).toFixed(2)}s">${danmakuChipContent(comment)}</button>`).join('')}</div></div>`
  }

  function danmakuIcon(name, fallback = '') {
    return global.KGLearningIcons?.render(name, { size: 18 }) || `<span aria-hidden="true">${escapeHTML(fallback)}</span>`
  }

  function danmakuChipContent(comment) {
    return `<span class="q-danmaku-content">${commentContentMarkup(comment.content)}</span>${danmakuLikeTail(comment)}`
  }

  /* 点赞计数随弹幕滚动；统一复用公共线性图标。 */
  function danmakuLikeTail(comment) {
    const count = Number(comment.likeCount) || 0
    if (!count) return ''
    return `<span class="q-danmaku-like${comment.myLike ? ' is-liked' : ''}" aria-label="${count} 个赞">${danmakuIcon('heart')}<span>${count}</span></span>`
  }

  function avatarMarkup(author, shortName = false) {
    const name = text(author).trim()
    const chars = [...(shortName ? name.replace(/^[小老阿](?=.$)/u, '') : name) || '访']
    const initial = (chars[0] || '访').toUpperCase()
    let hue = 0
    for (const char of chars) hue = (hue * 31 + char.codePointAt(0)) % 360
    return `<span class="q-comment-avatar" style="--avatar-hue:${hue}" aria-hidden="true">${escapeHTML(initial)}</span>`
  }

  function commentItemMarkup(comment) {
    return `<li class="q-comment" data-comment-id="${escapeHTML(comment.id)}">
      ${avatarMarkup(comment.author)}
      <div class="q-comment-main">
        <span class="q-comment-author">${escapeHTML(comment.author)}</span>
        <span class="q-comment-time">${escapeHTML(formatTime(comment.createdAt))}</span>
        ${comment.parentId ? `<small class="q-comment-parent">回复：${escapeHTML(comment.parentContent || "原留言")}</small>` : ''}
        <p class="q-comment-content">${commentContentMarkup(comment.content)}</p>
        <div class="q-comment-actions">
          <button type="button" data-qc-action="reply">回复</button>
          <button type="button" data-qc-action="toggle-favorite" aria-pressed="${!!comment.myFavorite}">${comment.myFavorite ? '已收藏' : '收藏'}</button>
          <button type="button" class="q-comment-like${comment.myLike ? ' is-liked' : ''}" data-qc-action="toggle-like" aria-pressed="${comment.myLike ? 'true' : 'false'}" aria-label="点赞">❤ <span data-qc-like-count>${Number(comment.likeCount) || 0}</span></button>
          ${comment.questionTitle ? `<button type="button" data-qc-action="return">返回题目：${escapeHTML(comment.questionTitle)}</button>` : ''}
          ${comment.canDelete ? `<button type="button" class="q-comment-delete" data-qc-action="delete" aria-label="删除留言">删除</button>` : ''}
        </div>
      </div>
    </li>`
  }

  function composerMarkup(state) {
    if (!state.user) {
      return `<div class="q-composer"><button type="button" class="q-composer-login" data-qc-action="login">登录后参与讨论</button></div>`
    }
    return `<div class="q-composer">
      <textarea class="q-composer-input" rows="2" maxlength="${MAX_CONTENT}" placeholder="留下你的精彩评论吧"></textarea>
      <button type="button" class="q-emoji-toggle" data-qc-action="emoji-toggle" aria-expanded="${!!state.emojiExpanded}">表情</button>
      ${emojiPickerMarkup(state)}
      ${state.sendError ? `<p class="q-composer-error" role="alert">${escapeHTML(state.sendError)}</p>` : ''}
      <div class="q-composer-foot"><span class="q-composer-count" data-qc-count>0/${MAX_CONTENT}</span><button type="button" class="q-composer-send" data-qc-action="send" disabled>发布</button></div>
    </div>`
  }

  function collapsedMarkup(state) {
    const count = state.count
    const label = count ? `查看本题讨论（${count} 条）` : '还没有留言，来说点什么'
    return `<section class="q-comments is-collapsed" data-qc-block aria-label="题目讨论">
      <button type="button" data-qc-action="danmaku-toggle" aria-pressed="${enabled()}">弹幕${enabled() ? '开' : '关'}</button>
      <button type="button" data-qc-action="danmaku-settings">弹幕设置</button>
      <button type="button" data-qc-action="favorites">我的收藏</button>
      <button type="button" class="q-comments-toggle" data-qc-action="expand" aria-expanded="false">💬 ${escapeHTML(label)}</button>
    </section>`
  }

  function listMarkup(state) {
    if (state.favoritesMode) return state.favorites.map(commentItemMarkup).join('')
    // 层级只有两级：顶级留言 + 其全部后代回复（回复的回复也平铺在第二级，不继续嵌套）。
    const ids=new Set(state.comments.map(comment=>comment.id))
    const byParent=new Map()
    for (const comment of state.comments) {
      const key=text(comment.parentId||'')
      if(!byParent.has(key))byParent.set(key,[])
      byParent.get(key).push(comment)
    }
    const collectReplies=id=>{
      const out=[]
      const queue=[id]
      while(queue.length){
        for(const child of byParent.get(queue.shift())||[]){out.push(child);queue.push(child.id)}
      }
      return out
    }
    return state.comments
      .filter(comment=>!comment.parentId || !ids.has(comment.parentId))
      .map(comment=>{
        const replies=collectReplies(comment.id)
        return commentItemMarkup(comment)+(replies.length ? `<li class="q-comment-thread" data-comment-id="${escapeHTML(comment.id)}"><button type="button" data-qc-action="toggle-replies" aria-expanded="${state.expandedReplies.has(comment.id)}">${replies.length} 条回复</button>${state.expandedReplies.has(comment.id)?`<ul>${replies.map(commentItemMarkup).join('')}</ul>`:''}</li>`:'')
      }).join('')
  }

  function blockMarkup(state) {
    const shown = state.favoritesMode ? state.favorites : state.comments
    if (state.expanded === false) return collapsedMarkup(state)
    return `<section class="q-comments" data-qc-block aria-label="题目讨论">
<div class="q-drawer-handle" data-qc-handle aria-label="拖动讨论抽屉"></div>
      <div class="q-comments-head"><span class="q-comments-title">${state.favoritesMode ? '我的收藏' : '全部评论'}<i class="q-comments-count" data-qc-total>${shown.length ? `(${shown.length})` : ''}</i></span>${state.collapsible ? '<button type="button" class="q-comments-collapse" data-qc-action="collapse" aria-label="关闭评论面板">✕</button>' : ''}</div>
      ${state.toastMessage ? `<div class="q-comments-toast" data-qc-toast role="status">${escapeHTML(state.toastMessage)}</div>` : ''}
      ${state.error ? `<div class="q-comments-error" role="status">留言加载失败 <button type="button" data-qc-action="retry">重试</button></div>` : ''}
      <ul class="q-comment-list" data-qc-list>${listMarkup(state)}</ul>
      ${shown.length ? '' : (state.error ? '' : `<p class="q-comments-empty">${state.favoritesMode ? '还没有收藏。' : '还没有留言，来聊聊这道题吧。'}</p>`)}
      ${state.nextCursor ? '<button type="button" data-qc-action="more">加载更多</button>' : ''}
      ${state.replyId ? `<div data-qc-reply>正在回复 <button type="button" data-qc-action="cancel-reply">取消回复</button></div>` : ''}
      ${state.favoritesMode ? '<button type="button" data-qc-action="discussion">回到本题讨论</button>' : composerMarkup(state)}
    </section>`
  }

  function activate(instance) {
    if(instance.disposed)return
    if (active && active !== instance) {
      active.state.expanded = false
      clearReplays(active)
      closeDanmakuPop(active)
      active.overlay?.remove()
      active.drawer?.remove()
      active.drawer = null
      renderInto(active)
    }
    active = instance
    renderOverlay(instance)
  }

  function renderOverlay(instance) {
    clearReplays(instance)
    closeDanmakuPop(instance)
    instance.overlay?.remove()
    instance.overlay = null
    if (active !== instance || instance.disposed || !enabled() || instance.state.overlaySuppressed) return
    const holder = document.createElement('div')
    holder.innerHTML = danmakuMarkup(instance.state.danmaku)
    const overlay = holder.firstElementChild
    if (!overlay) return
    document.body.appendChild(overlay)
    instance.overlay = overlay
    positionDanmaku(instance)
    overlay.addEventListener('error',emojiImageFallback,true)
    overlay.addEventListener('click', event => {
      const item = event.target.closest('[data-danmaku-comment-id]')
      if (item) { showDanmakuPop(instance, item); return }
      if (!event.target.closest('[data-danmaku-pop]')) closeDanmakuPop(instance)
    })
  }

  /* 点击弹幕：弹出短视频式互动面板（点赞 / 回复 / 不喜欢 / 更多），不直接展开抽屉。 */
  function findComment(instance, commentId) {
    return instance.state.comments.find(comment => comment.id === commentId) || null
  }

  function danmakuPopMarkup(comment) {
    return `<div class="q-danmaku-pop" data-danmaku-pop role="dialog" aria-label="弹幕互动">
      <div class="q-danmaku-pop-head"><div class="q-danmaku-pop-meta"><time datetime="${escapeHTML(comment.createdAt)}">${escapeHTML(formatTime(comment.createdAt))}</time></div><button type="button" class="q-danmaku-pop-close" data-qc-pop-action="close" aria-label="关闭弹幕互动">${danmakuIcon('x', '×')}</button></div>
      <p class="q-danmaku-pop-text">${commentContentMarkup(comment.content)}</p>
      <div class="q-danmaku-pop-actions">
        <button type="button" data-qc-pop-action="like" class="${comment.myLike ? 'is-liked' : ''}" aria-pressed="${!!comment.myLike}">${danmakuIcon('heart')}<span>点赞 ${Number(comment.likeCount) || 0}</span></button>
        <button type="button" data-qc-pop-action="reply">${danmakuIcon('message-circle')}<span>回复</span></button>
        <button type="button" data-qc-pop-action="dislike">${danmakuIcon('eye-off')}<span>不喜欢</span></button>
        <button type="button" data-qc-pop-action="more" aria-expanded="false">${danmakuIcon('ellipsis')}<span>更多</span></button>
      </div>
      <p class="q-danmaku-pop-hint">点击空白处继续播放</p>
      <div class="q-danmaku-pop-extra" data-qc-pop-extra hidden>
        <button type="button" data-qc-pop-action="favorite" aria-pressed="${!!comment.myFavorite}">${comment.myFavorite ? '已收藏' : '收藏'}</button>
        <button type="button" data-qc-pop-action="copy">复制内容</button>
        <button type="button" data-qc-pop-action="raise-hand">🙋 举手重播</button>
        <button type="button" data-qc-pop-action="settings">弹幕设置</button>
      </div>
    </div>`
  }

  function showDanmakuPop(instance, item) {
    const comment = findComment(instance, item.dataset.danmakuCommentId)
    if (!comment) return
    closeDanmakuPop(instance)
    item.classList.add('is-paused')
    const pop = document.createElement('div')
    pop.innerHTML = danmakuPopMarkup(comment)
    const panel = pop.firstElementChild
    panel.dataset.danmakuPopFor = comment.id
    instance.overlay.appendChild(panel)
    instance.popItem = item
    positionDanmakuPop(instance)
    bindDanmakuPop(instance, item, panel)
    instance.popResize = () => positionDanmakuPop(instance)
    global.addEventListener('resize', instance.popResize)
    instance.popEscape = event => {
      if (event.key === 'Escape') { event.preventDefault(); closeDanmakuPop(instance) }
    }
    document.addEventListener('keydown', instance.popEscape)
    // 点击弹幕与互动面板以外的任意位置：关闭面板并恢复弹幕运动。
    instance.popOutsideClose = event => {
      if (event.target.closest('[data-danmaku-pop]') || event.target.closest('[data-danmaku-comment-id]')) return
      closeDanmakuPop(instance)
    }
    document.addEventListener('pointerdown', instance.popOutsideClose, true)
  }

  /* 所有打开、更新、展开与 resize 共用一次测量定位，箭头随触发条夹在卡片内。 */
  function positionDanmakuPop(instance) {
    const panel = instance.overlay?.querySelector('[data-danmaku-pop]')
    const item = instance.popItem
    if (!panel || !item?.isConnected) return
    const rect = item.getBoundingClientRect()
    const width = panel.offsetWidth, height = panel.offsetHeight
    const center = rect.left + rect.width / 2
    const left = Math.max(8, Math.min(global.innerWidth - width - 8, center - width / 2))
    const below = rect.bottom + 12
    const above = rect.top - height - 12
    const flip = below + height > global.innerHeight - 8 && (above >= 8 || rect.top > global.innerHeight - rect.bottom)
    const top = Math.max(8, Math.min(global.innerHeight - height - 8, flip ? above : below))
    panel.dataset.placement = flip ? 'top' : 'bottom'
    panel.style.setProperty('--q-pop-arrow-left', Math.max(18, Math.min(width - 18, center - left)) + 'px')
    panel.style.setProperty('--q-pop-arrow-x', left + Math.max(18, Math.min(width - 18, center - left)) + 'px')
    panel.style.setProperty('--q-pop-arrow-y', (flip ? top + height - 1 : top + 1) + 'px')
    panel.style.left = left + 'px'
    panel.style.top = top + 'px'
  }

  function refreshDanmakuPop(instance, item) {
    const panel = instance.overlay?.querySelector('[data-danmaku-pop]')
    if (!panel || panel.dataset.danmakuPopFor !== item.dataset.danmakuCommentId) return
    const comment = findComment(instance, panel.dataset.danmakuPopFor)
    if (!comment) { closeDanmakuPop(instance); return }
    const replacement = document.createElement('div')
    replacement.innerHTML = danmakuPopMarkup(comment)
    const next = replacement.firstElementChild
    next.dataset.danmakuPopFor = comment.id
    const expanded = !panel.querySelector('[data-qc-pop-extra]').hidden
    next.querySelector('[data-qc-pop-extra]').hidden = !expanded
    next.querySelector('[data-qc-pop-action="more"]').setAttribute('aria-expanded', String(expanded))
    const toast = panel.querySelector('[data-qc-toast]')
    if (toast) next.appendChild(toast)
    const focusAction = panel.contains(document.activeElement) ? document.activeElement.closest('[data-qc-pop-action]')?.dataset.qcPopAction : null
    panel.replaceWith(next)
    bindDanmakuPop(instance, item, next)
    positionDanmakuPop(instance)
    if (focusAction) next.querySelector(`[data-qc-pop-action="${focusAction}"]`)?.focus({preventScroll:true})
  }

  function bindDanmakuPop(instance, item, panel) {
    panel.addEventListener('click', async event => {
      const action = event.target.closest('[data-qc-pop-action]')?.dataset.qcPopAction
      if (!action) return
      if (action === 'close') { closeDanmakuPop(instance); return }
      const commentId = panel.dataset.danmakuPopFor
      const latest = findComment(instance, commentId)
      if (!latest) { closeDanmakuPop(instance); return }
      if (action === 'like') {
        await toggleLike(instance, commentId)
        // 原条就地更新，保持暂停位置；等待 API 时若已关闭，不重新打开浮层。
        const updated = findComment(instance, commentId)
        if (updated) instance.state.danmaku = instance.state.danmaku.map(row => row.id === commentId ? updated : row)
        if (updated && item.isConnected) item.innerHTML = danmakuChipContent(updated)
        refreshDanmakuPop(instance, item)
      }
      else if (action === 'favorite') { await toggleFavorite(instance, commentId); refreshDanmakuPop(instance, item) }
      else if (action === 'reply') { openReplyFromDanmaku(instance, item, commentId) }
      else if (action === 'dislike') {
        hideDanmakuItem(commentId)
        instance.state.danmaku = instance.state.danmaku.filter(row => row.id !== commentId)
        closeDanmakuPop(instance)
        renderOverlay(instance)
      }
      else if (action === 'more') {
        const extra = panel.querySelector('[data-qc-pop-extra]')
        if (extra) extra.hidden = !extra.hidden
        panel.querySelector('[data-qc-pop-action="more"]').setAttribute('aria-expanded', String(!extra.hidden))
        positionDanmakuPop(instance)
      }
      else if (action === 'copy') {
        try { await global.navigator.clipboard.writeText(latest.content); showToast(instance, '已复制弹幕内容') }
        catch (_) { showToast(instance, '复制失败，请手动选择内容') }
      }
      else if (action === 'settings') { closeDanmakuPop(instance); openDanmakuSettings() }
      else if (action === 'raise-hand' && !instance.pending.has('raise-hand')) {
        instance.pending.add('raise-hand')
        try {
          await global.navigator.clipboard.writeText(latest.content)
          if (instance.disposed || active !== instance || !instance.overlay?.isConnected) return
          if ((instance.replayTimers?.size || 0)+instance.overlay.querySelectorAll('[data-danmaku-replay]').length >= 20) { showToast(instance,'重播队列已满，请稍后再试'); return }
          showToast(instance,'已复制，将在后续重播')
          const timer = global.setTimeout(()=>{
            instance.replayTimers.delete(timer)
            if (instance.disposed || active !== instance || !instance.overlay?.isConnected || !enabled()) return
            const chip=document.createElement('button');chip.type='button';chip.className='q-danmaku-item q-danmaku-replay';chip.dataset.danmakuCommentId=latest.id;chip.dataset.danmakuReplay=''
            chip.style.setProperty('--q-danmaku-lane',String((instance.replaySequence || 0)%2));instance.replaySequence=(instance.replaySequence || 0)+1
            chip.innerHTML=danmakuChipContent(findComment(instance,latest.id)||latest)
            chip.addEventListener('animationend',()=>{if(instance.popItem===chip)closeDanmakuPop(instance);chip.remove()},{once:true})
            instance.overlay.querySelector('.q-danmaku-track').append(chip)
          },600)
          instance.replayTimers ||= new Set();instance.replayTimers.add(timer)
        } catch (_) { if(!instance.disposed)showToast(instance,'复制失败，请允许剪贴板访问后重试') }
        finally { instance.pending.delete('raise-hand') }
      }
    })
  }

  function clearReplays(instance) {
    instance.replayTimers?.forEach(timer=>global.clearTimeout(timer))
    instance.replayTimers?.clear()
  }

  function closeDanmakuPop(instance) {
    instance.overlay?.querySelectorAll('.q-danmaku-pop').forEach(node => node.remove())
    // 关面板即恢复运动：清掉暂停标记与焦点暂停态。
    instance.overlay?.querySelectorAll('.q-danmaku-item.is-paused').forEach(node => {
      node.classList.remove('is-paused')
      if (node === document.activeElement) node.blur()
    })
    if (instance.popOutsideClose) {
      document.removeEventListener('pointerdown', instance.popOutsideClose, true)
      instance.popOutsideClose = null
    }
    if (instance.popEscape) document.removeEventListener('keydown', instance.popEscape)
    if (instance.popResize) global.removeEventListener('resize', instance.popResize)
    instance.popEscape = instance.popResize = instance.popItem = null
  }

  /* 从弹幕面板点「回复」：暂停该弹幕并展开底部讨论抽屉，定位到对应留言。 */
  function openReplyFromDanmaku(instance, item, commentId) {
    closeDanmakuPop(instance)
    item.classList.add('is-paused')
    instance.state.expanded = true
    instance.state.favoritesMode = false
    instance.state.replyId = commentId
    instance.state.nextCursor = instance.state.commentsCursor
    instance.returnFocus = instance.root.querySelector('[data-qc-action="expand"]')
    renderInto(instance)
    instance.drawer?.querySelector(`[data-comment-id="${CSS.escape(commentId)}"]`)?.scrollIntoView({block:'nearest'})
    instance.drawer?.querySelector('.q-composer-input')?.focus()
  }

  function renderInto(instance) {
    if (instance.disposed) return
    const { root, state } = instance
    const old = instance.drawer?.querySelector('.q-composer-input')
    if (old) {state.draft = old.value;state.selectionStart=old.selectionStart;state.selectionEnd=old.selectionEnd}
    root.innerHTML = collapsedMarkup({...state, expanded:false})
    root.querySelector('[data-qc-action="expand"]')?.setAttribute('aria-expanded', String(state.expanded))
    if (!state.expanded) {
      detachDrawerListeners(instance)
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
        if (event.key === 'Escape') {if(instance.state.emojiExpanded){event.stopPropagation();closeEmojiPicker(instance,true)}else {event.stopPropagation();closeDrawer(instance)}}
        if(event.key.startsWith('Arrow')&&event.target.matches('[data-qc-emoji]')){const buttons=[...instance.drawer.querySelectorAll('[data-qc-emoji]:not([hidden])')],index=buttons.indexOf(event.target),columns=Math.max(1,Math.round(instance.drawer.querySelector('.q-emoji-grid').clientWidth/40)),step=event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:event.key==='ArrowUp'?-columns:columns;event.preventDefault();buttons[Math.max(0,Math.min(buttons.length-1,index+step))]?.focus()}
      })
      // 点击评论区以外的任意位置：收起评论区。
      instance.outsideDrawerClose = event => {
        if (instance.disposed || !instance.drawer) return
        if(instance.state.emojiExpanded&&!event.target.closest('[data-qc-emoji-picker],[data-qc-action=emoji-toggle]')){closeEmojiPicker(instance);if(!instance.drawer.contains(event.target))return}
        if (instance.drawer.contains(event.target)) return
        if (event.target.closest('[data-danmaku-pop]')) return
        closeDrawer(instance)
      }
      document.addEventListener('pointerdown', instance.outsideDrawerClose, true)
    }
    instance.drawer.innerHTML = blockMarkup({...state, collapsible:true})
    const composer = instance.drawer.querySelector('.q-composer-input')
    if (composer) {
      composer.value = state.draft || ''
      if(Number.isInteger(state.selectionStart))composer.setSelectionRange(state.selectionStart,state.selectionEnd)
      const update = () => {
        state.draft = composer.value
        instance.drawer.querySelector('[data-qc-count]').textContent = `${composer.value.length}/${MAX_CONTENT}`
        instance.drawer.querySelector('[data-qc-action="send"]').disabled = !composer.value.trim() || instance.pending.has('send')
      }
      composer.addEventListener('input', update)
      update()
    }
    positionEmojiPicker(instance)
    const handle = instance.drawer.querySelector('[data-qc-handle]')
    handle?.addEventListener('pointerdown', event => {
      const startY = event.clientY, startHeight = instance.drawer.getBoundingClientRect().height
      handle.setPointerCapture(event.pointerId)
      handle.onpointermove = move => { if (global.innerWidth <= 700) instance.drawer.style.height = Math.max(180, Math.min(global.innerHeight * .85, startHeight + startY - move.clientY)) + 'px' }
      handle.onpointerup = () => { handle.onpointermove = null; handle.onpointerup = null }
    })
  }

  /* 抽屉只释放自己暂停的条；仍打开的互动浮层独立持有触发条的暂停。 */
  function detachDrawerListeners(instance) {
    if (instance.outsideDrawerClose) {
      document.removeEventListener('pointerdown', instance.outsideDrawerClose, true)
      instance.outsideDrawerClose = null
    }
    instance.overlay?.querySelectorAll('.q-danmaku-item.is-paused').forEach(item => {
      if (item !== instance.popItem) item.classList.remove('is-paused')
    })
  }

  function closeDrawer(instance) {
    instance.state.expanded = false
    instance.state.emojiExpanded = false
    closeDanmakuPop(instance)
    detachDrawerListeners(instance)
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
    eventRoot.addEventListener('error',emojiImageFallback,true)
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
      if (action === 'danmaku-toggle') {
        // 报告中的各题共用一个开关偏好，必须同时同步所有题卡的状态。
        // 否则换题后仍显示旧状态，用户需要多点一次才能看到预期变化。
        if (active !== instance) activate(instance)
        setDanmakuEnabled(!enabled())
        if (!instance.state.loaded) reload(instance)
        return
      }
      if (action === 'danmaku-settings') { openDanmakuSettings(); return }
      if (action === 'emoji-toggle') {
        instance.state.emojiExpanded=!instance.state.emojiExpanded
        const picker=instance.drawer?.querySelector('[data-qc-emoji-picker]')
        if(picker)picker.hidden=!instance.state.emojiExpanded
        event.target.closest('button').setAttribute('aria-expanded',String(instance.state.emojiExpanded));positionEmojiPicker(instance);return
      }
      if(action==='emoji-close'){closeEmojiPicker(instance,true);return}
      if(action==='emoji-category'){
        const category=event.target.closest('button').dataset.qcEmojiCategory;instance.state.emojiCategory=category
        instance.drawer.querySelectorAll('[data-qc-emoji-category]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.qcEmojiCategory===category)))
        instance.drawer.querySelectorAll('[data-qc-emoji-group]').forEach(button=>button.hidden=category!=='all'&&button.dataset.qcEmojiGroup!==category)
        positionEmojiPicker(instance);return
      }
      if (action === 'emoji-insert') {
        const composer=instance.drawer?.querySelector('.q-composer-input'),emoji=event.target.closest('[data-qc-emoji]')?.dataset.qcEmoji
        if(!composer||!emoji)return
        const start=composer.selectionStart,end=composer.selectionEnd
        if(composer.value.length-(end-start)+emoji.length>MAX_CONTENT){showToast(instance,'评论最多 200 字');return}
        composer.setRangeText(emoji,start,end,'end');closeEmojiPicker(instance);composer.focus();composer.dispatchEvent(new Event('input',{bubbles:true}));return
      }
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
    instance.state.sendError = ''
    try {
      const payload = await request(`${instance.questionId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content, parentId:instance.state.replyId || null }),
      })
      if (instance.disposed) return
      instance.state.draft = ''
      instance.state.sendError = ''
      composer.value = ''
      if(instance.state.replyId)instance.state.expandedReplies.add(instance.state.replyId)
      instance.state.replyId = null
      instance.state.comments.unshift(payload.comment)
      if (payload.comment.danmakuEligible) {
        instance.state.danmaku = pickDanmaku(instance.state.comments)
      }
      renderInto(instance)
      renderOverlay(instance)
      notifyCommentCountChanged(instance.questionId)
    } catch (error) {
      if (text(error.message) !== 'UNAUTHENTICATED') {
        button.disabled = false
        // 发布区内联提示后端拦截原因（如敏感词），toast 同步提醒。
        instance.state.sendError = text(error.message) === 'REQUEST_FAILED' ? '发布失败，请稍后重试' : text(error.message)
        showToast(instance, instance.state.sendError)
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
      notifyCommentCountChanged(instance.questionId)
    } catch (error) {
      if (text(error.message) !== 'UNAUTHENTICATED') showToast(instance, '删除失败，请稍后重试')
    } finally { instance.pending.delete(commentId) }
  }

  /* 题目留言数变化（发布/删除）：失效缓存并广播，宿主页据此刷新角标。 */
  function notifyCommentCountChanged(questionId) {
    if (!text(questionId)) return
    countCache.delete(text(questionId))
    document.dispatchEvent(new CustomEvent('kg:question-comment-counts-changed', { detail: { questionId: text(questionId) } }))
  }

  /* 批量题目留言数（侧栏角标用）：只查缓存没有的 ID，未返回的记 0。 */
  async function commentCounts(questionIds) {
    const ids = [...new Set((questionIds || []).map(text).filter(Boolean))].filter(id => !countCache.has(id))
    if (ids.length) {
      try {
        const payload = await request('@counts?ids=' + encodeURIComponent(ids.join(',')))
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
  function commentCount(questionId) { return countCache.get(text(questionId)) }

  function showToast(instance, message) {
    if(instance.disposed)return
    instance.state.toastMessage = text(message)
    const host = instance.overlay?.querySelector('[data-danmaku-pop]') || instance.drawer || instance.root
    let toast = host.querySelector('[data-qc-toast]')
    if (!toast) {
      toast = document.createElement('div')
      toast.className = 'q-comments-toast'
      toast.setAttribute('data-qc-toast', '')
      host.appendChild(toast)
    }
    toast.textContent = text(message)
    toast.hidden = false
    positionDanmakuPop(instance)
    global.clearTimeout(instance.toastTimer)
    instance.toastTimer = global.setTimeout(() => { instance.state.toastMessage=''; (instance.overlay?.querySelector('[data-danmaku-pop]') || instance.drawer || instance.root).querySelector('[data-qc-toast]')?.remove(); positionDanmakuPop(instance) }, 2400)
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
          overlaySuppressed: false,
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

  /* 练习页标记区「评论」按钮：做题中直接从底部打开讨论抽屉。
   * 挂载点是不可见宿主（纯 CSS 隐藏，不触发 MutationObserver 清理）。
   * 与 mountDanmaku 共用每题同一实例（source='danmaku'）；做题中弹幕层保持抑制，
   * 避免被弹幕剧透；解析可见后由 mountDanmaku 解除抑制。 */
  function openPanel({ questionId }) {
    const id = text(questionId)
    if (!id) return null
    let instance = [...instances].find(row => row.questionId === id && row.source === 'danmaku')
    if (!instance) {
      const host = document.createElement('div')
      host.className = 'q-comments-standalone-host'
      host.setAttribute('aria-hidden', 'true')
      document.body.appendChild(host)
      instance = ensureInstance(host, '__kgQuestionComments', id, 'danmaku')
      instance.state.overlaySuppressed = true
      attach(instance, host)
      instance.state.expanded = true
      reload(instance)
    } else {
      activate(instance)
      instance.state.expanded = true
      instance.state.favoritesMode = false
      instance.state.nextCursor = instance.state.commentsCursor
      if (!instance.state.loaded) reload(instance)
      else renderInto(instance)
    }
    return instance
  }

  /* 练习页：解析可见时只挂弹幕层，不渲染讨论折叠条（讨论入口收敛在侧栏「评论」）。
   * 与 openPanel 共用每题同一实例；解除做题期的弹幕抑制，由 reload/renderOverlay 驱动视口弹幕。 */
  function mountDanmaku({ questionId }) {
    const id = text(questionId)
    if (!id) return null
    let instance = [...instances].find(row => row.questionId === id && row.source === 'danmaku')
    if (!instance) {
      const host = document.createElement('div')
      host.className = 'q-comments-standalone-host'
      host.setAttribute('aria-hidden', 'true')
      document.body.appendChild(host)
      instance = ensureInstance(host, '__kgQuestionComments', id, 'danmaku')
      attach(instance, host)
    }
    const keepOverlay=active===instance&&!instance.state.overlaySuppressed&&instance.overlay?.isConnected
    instance.state.overlaySuppressed = false
    if(!keepOverlay)activate(instance)
    else positionDanmaku(instance)
    if (!instance.state.loaded) reload(instance)
    return instance
  }
  /* 按来源清理实例（练习页换题/隐藏解析时清掉上一题的弹幕层）。 */
  function teardownSource(source,options={}) {
    for (const instance of [...instances]) {
      if (instance.source === source && (!options.exceptQuestionId || instance.questionId!==text(options.exceptQuestionId))) teardown(instance)
    }
  }

  /* 标记区「弹幕」开关：与讨论折叠条上的开关共用同一份本机偏好。 */
  function setDanmakuEnabled(value) {
    remember(!!value)
    for (const instance of instances) {
      if (instance.disposed) continue
      renderInto(instance)
      renderOverlay(instance)
    }
  }
  function danmakuEnabled() { return enabled() }

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
      if(!favorites)instance.state.danmaku=pickDanmaku(instance.state.comments)
      instance.state[favorites?'favoritesCursor':'commentsCursor']=payload.nextCursor
      if(instance.state.favoritesMode===favorites)instance.state.nextCursor=payload.nextCursor
      renderInto(instance)
      if(!favorites)renderOverlay(instance)
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
  function listFavorites(cursor) { return request('@favorites'+(cursor?'?cursor='+encodeURIComponent(cursor):'')) }
  function removeFavorite(comment) { return request(`${comment.questionId}/comments/${comment.id}/favorite`,{method:'DELETE'}) }
  async function openFavorite(comment) {
    if(!comment)throw new Error('评论不存在，请重新读取收藏')
    // Revalidate permission/deletion and follow cursors so old comments can be located.
    const owner=currentUser()?.username, comments=[]
    let cursor=null
    do {
      const page=await request(`${comment.questionId}/comments`+(cursor?'?cursor='+encodeURIComponent(cursor):''))
      comments.push(...(page.comments||[]));cursor=page.nextCursor
    } while(cursor && !comments.some(row=>row.id===comment.id))
    if(owner!==currentUser()?.username)throw new Error('UNAUTHENTICATED')
    if(!comments.some(row=>row.id===comment.id))throw new Error('原评论已删除或不可访问，请重新读取收藏')
    let focused=[...instances].find(row=>row.questionId===comment.questionId && !row.disposed)
    if(!focused){
      const question=comment.question || {},article=document.createElement('article')
      article.className='q-favorite-question'
      article.innerHTML=`<button type="button" data-qc-close-question>关闭题目</button><h2>${escapeHTML(comment.questionTitle)}</h2><p>${escapeHTML(question.stem || (question.stemParts||[]).map(part=>part.text||'').join('') || question.title || '')}</p>${global.KGQuestionMaterials?.render?.(question,{readOnly:true,reveal:true}) || ''}<ol>${(question.options || []).map(option=>`<li>${escapeHTML(option.text || option.content || option)}</li>`).join('')}</ol><p>答案：${escapeHTML((question.correctOptionIds||[]).join('、') || question.correctAnswer || question.answer || '')}</p><p>${escapeHTML(question.analysis || question.explanation || '')}</p>`
      document.body.appendChild(article)
      focused=mountCard({card:article,questionId:comment.questionId})
      article.querySelector('[data-qc-close-question]').onclick=()=>{teardown(focused);article.remove()}
    }
    activate(focused)
    Object.assign(focused.state,{expanded:true,favoritesMode:false,comments,commentsCursor:cursor,nextCursor:cursor,loaded:true,error:false})
    if(comment.parentId)focused.state.expandedReplies.add(comment.parentId)
    renderInto(focused)
    const target=focused.drawer?.querySelector(`[data-comment-id="${CSS.escape(comment.id)}"]`)
    if(target){target.tabIndex=-1;target.scrollIntoView({block:'center'});target.focus()}
    return focused
  }
  function returnToQuestion(instance, commentId) {
    const comment=instance.state.favorites.find(c=>c.id===commentId)
    if(!comment)return
    closeDrawer(instance)
    openFavorite(comment).catch(error=>showToast(instance,error.message || '原题评论暂不可访问，请重试'))
  }
  function teardown(target) {
    const selected=target ? [target.__kgQuestionComments || target] : [...instances]
    for(const instance of selected) {
      instance.disposed=true
      clearReplays(instance)
      detachDrawerListeners(instance)
      closeDanmakuPop(instance)
      instance.overlay?.remove()
      instance.drawer?.remove()
      instance.root?.remove()
      instance.removeFocusListeners?.()
      if(instance.anchor?.classList.contains('q-favorite-question'))instance.anchor.remove()
      if(instance.anchor?.classList.contains('q-comments-standalone-host'))instance.anchor.remove()
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
  function closeSettings(){if(settingsDialog){settingsDialog.close();settingsDialog.remove();settingsDialog=null}}
  global.addEventListener('kg-auth-session-change',()=>{closeSettings();countCache.clear();teardown()})
  global.addEventListener('pagehide',()=>{closeSettings();teardown()})
  global.KGQuestionComments = Object.freeze({ mountPanel, mountCard, mountCards, openPanel, mountDanmaku, teardownSource, pickDanmaku, danmakuEnabled, setDanmakuEnabled, getDanmakuSettings, setDanmakuSettings, openDanmakuSettings, listFavorites, removeFavorite, openFavorite, teardown, commentCounts, commentCount })
})(window)

