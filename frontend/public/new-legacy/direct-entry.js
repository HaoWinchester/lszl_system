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
    const request = force ? session.refresh() : session.load()
    return request
      .then((snapshot) => {
        const user = snapshot?.user || null
        role = String(user?.role || 'guest')
        publishDirectAuth(user)
        return user || {}
      })
      .catch(() => {
        role = cachedRoleFromAuth()
        return {}
      })
  }

  let resolveInitialLearningEntry
  let initialLearningEntryHandled = false
  const initialLearningEntry = new Promise((resolve) => { resolveInitialLearningEntry = resolve })

  function showLearningEntryChooser() {
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
      requestCurrentUser({ force: true }).then(() => {
        showLearningEntryChooser()
      })
    } else {
      requestCurrentUser({ force: true }).catch(() => {})
    }
  })

  global.addEventListener('kg-auth-session-change', (event) => {
    if (event?.detail?.provider !== 'remote') return
    requestCurrentUser({ force: true }).catch(() => {
      role = cachedRoleFromAuth()
    })
  })

  function decorateMemberEntry() {
    if (currentRole() === 'student') return
    const button = document.getElementById('upgradeMemberBtn')
    if (button) button.hidden = true
  }

  function openRequestedSurface() {
    const params = new URLSearchParams(global.location.search || '')
    if (params.get('auth') === 'login' && currentRole() === 'guest' && typeof global.authOpen === 'function') {
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

  requestCurrentUser().then(decorateMemberEntry)
  if (document.readyState === 'loading') {
    global.addEventListener('DOMContentLoaded', openRequestedSurface, { once: true })
  } else {
    openRequestedSurface()
  }
  global.addEventListener('load', () => global.setTimeout(openRequestedSurface, 0), { once: true })
})(window)
