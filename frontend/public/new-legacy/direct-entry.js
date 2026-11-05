'use strict'

;(function (global) {
  function cachedRoleFromAuth() {
    try {
      const user = global.KGAuthCore?.currentUser?.()
      if (user && user.username && user.role) return String(user.role)
    } catch (_error) {}
    return 'guest'
  }

  let role = cachedRoleFromAuth()
  let requestSequence = 0
  let authUncertain = false

  function publishDirectAuth(user) {
    const current = global.__KG_DIRECT_BOOTSTRAP__
    if (!current || typeof current !== 'object') return
    const authenticated = Boolean(user?.username)
    Object.assign(current, {
      authenticated,
      username: authenticated ? String(user.username) : null,
      authUser: authenticated ? user : null,
    })
    global.dispatchEvent(new CustomEvent('kg:bootstrap-ready', {
      detail: { authenticated, username: authenticated ? String(user.username) : '' },
    }))
  }

  function requestCurrentUser({ force = false } = {}) {
    const session = global.KGAuthSessionBootstrap
    if (!session) return Promise.resolve({})
    const sequence = ++requestSequence
    const request = force ? session.refresh() : session.load()
    return request
      .then((snapshot) => {
        if (sequence !== requestSequence) return {}
        const user = snapshot?.user || null
        authUncertain = Boolean(snapshot?.uncertain || (!user && global.KGAuthRecovery?.isPaused?.()))
        if (!user && authUncertain) return {}
        role = String(user?.role || 'guest')
        publishDirectAuth(user)
        decorateMemberEntry()
        return user || {}
      })
      .catch(() => {
        if (sequence !== requestSequence) return {}
        authUncertain = true
        return {}
      })
  }

  let resolveInitialLearningEntry
  let initialLearningEntryHandled = false
  const initialLearningEntry = new Promise((resolve) => { resolveInitialLearningEntry = resolve })

  async function showLearningEntryChooser() {
    await global.KGWechatLogin?.waitForAccountFlow?.()
    if (!global.KGLearningEntryChooser || typeof global.KGLearningEntryChooser.init !== 'function') {
      return Promise.resolve({ shown: false })
    }
    return Promise.resolve(global.KGLearningEntryChooser.init()).catch(() => ({ shown: false }))
  }

  function settleInitialLearningEntry(result) {
    if (initialLearningEntryHandled) return
    initialLearningEntryHandled = true
    resolveInitialLearningEntry(result)
  }

  function currentRole() {
    return role
  }

  global.addEventListener('kg:auth-session-changed', (event) => {
    if (event?.detail?.authenticated) {
      requestCurrentUser({ force: true }).then(async () => {
        consumeLoginRequest();
        if (event.detail.authenticationAction === 'register') await global.KGWechatLogin?.promptBindingAfterRegister?.()
        showLearningEntryChooser()
      })
    } else {
      requestCurrentUser({ force: true }).catch(() => {})
    }
  })

  global.addEventListener('kg:auth-recovered', () => {
    requestCurrentUser({ force: true }).catch(() => {})
  })

  global.addEventListener('kg-auth-session-change', (event) => {
    if (event?.detail?.provider !== 'remote') return
    requestCurrentUser({ force: true }).catch(() => {
      role = cachedRoleFromAuth()
    })
  })

  function decorateMemberEntry() {
    if (currentRole() === 'student' && global.KGSubscription?.decorateSubscriptionElements) {
      global.KGSubscription.decorateSubscriptionElements()
      return
    }
    const button = document.getElementById('upgradeMemberBtn')
    if (button) button.hidden = !['guest', 'student'].includes(currentRole())
  }

  function consumeLoginRequest() {
    const params = new URLSearchParams(global.location.search || '');
    if (params.get('auth') !== 'login' || currentRole() === 'guest') return;
    params.delete('auth');
    const query = params.toString();
    global.history.replaceState(global.history.state, '', global.location.pathname + (query ? '?' + query : '') + global.location.hash);
  }

  let requestedSurfaceOpened = false;
  async function openRequestedSurface() {
    if (requestedSurfaceOpened) return;
    requestedSurfaceOpened = true;
    await initialUser;
    consumeLoginRequest();
    const params = new URLSearchParams(global.location.search || '')
    if (!authUncertain && params.get('auth') === 'login' && currentRole() === 'guest' && typeof global.authOpen === 'function') {
      global.authOpen('请登录后继续使用。')
    }
    if (params.get('member') === '1') {
      requestCurrentUser().then(() => {
        const userRole = currentRole()
        if (userRole === 'student') global.KGUserCenter?.openSubscriptionDetail?.()
        else global.KGUserCenter?.open?.()
      }).catch(() => {})
    }
    decorateMemberEntry()
    showLearningEntryChooser().then(settleInitialLearningEntry)
  }

  global.KGDirectEntry = Object.freeze({
    waitForInitialLearningEntry: () => initialLearningEntry,
  })

  const initialUser = requestCurrentUser().then(decorateMemberEntry)
  if (document.readyState === 'loading') {
    global.addEventListener('DOMContentLoaded', openRequestedSurface, { once: true })
  } else {
    openRequestedSurface()
  }
  global.addEventListener('load', () => global.setTimeout(openRequestedSurface, 0), { once: true })
})(window)
