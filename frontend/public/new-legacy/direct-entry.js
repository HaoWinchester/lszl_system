'use strict'

;(function (global) {
  const bootstrapUsername = String(global.__KG_DIRECT_BOOTSTRAP__?.username || '')
  let reloadingForSession = false

  global.addEventListener('kg-auth-session-change', (event) => {
    if (event?.detail?.provider !== 'remote') return
    const nextUsername = String(event?.detail?.username || '')
    if (reloadingForSession || nextUsername === bootstrapUsername) return
    reloadingForSession = true
    global.location.reload()
  })

  function currentRole() {
    return String(global.__KG_DIRECT_BOOTSTRAP__?.authUser?.role || 'guest')
  }

  function decorateMemberEntry() {
    if (currentRole() === 'student') return
    const button = document.getElementById('upgradeMemberBtn')
    if (button) button.hidden = true
  }

  function openRequestedSurface() {
    const params = new URLSearchParams(global.location.search || '')
    if (params.get('auth') === 'login' && !global.__KG_DIRECT_BOOTSTRAP__?.authenticated && typeof global.authOpen === 'function') {
      global.authOpen('请登录后继续使用。')
    }
    if (params.get('member') === '1') {
      const role = currentRole()
      if (role === 'student') global.KGUserCenter?.openSubscriptionDetail?.()
      else global.KGUserCenter?.open?.()
    }
    decorateMemberEntry()
  }

  if (document.readyState === 'loading') {
    global.addEventListener('DOMContentLoaded', openRequestedSurface, { once: true })
  } else {
    openRequestedSurface()
  }
  global.addEventListener('load', () => global.setTimeout(openRequestedSurface, 0), { once: true })
})(window)
