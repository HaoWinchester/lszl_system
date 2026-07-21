'use strict'

;(function () {
  if (window === window.parent) return

  const PAGE_ROUTES = Object.freeze({
    'index.html': '/graph',
    'workbench.html': '/graph',
    'learning-path.html': '/',
    'guided-learning-node.html': '/learning/node',
    'guided-learning-placement-test.html': '/learning/placement-test',
    'question-training.html': '/training',
    'question-workspace.html': '/workspace',
    'file-manager.html': '/files',
    'question-bank.html': '/question-bank',
    'knowledge-recall.html': '/recall',
    'user-management.html': '/users',
    'system-settings.html': '/settings',
  })

  const currentPage = location.pathname.split('/').pop() || 'learning-path.html'

  function send(type, payload) {
    window.parent.postMessage({
      channel: 'kg:new-legacy',
      version: 1,
      page: currentPage,
      type,
      payload,
    }, location.origin)
  }

  function routeFor(url) {
    const target = new URL(url, location.href)
    if (target.origin !== location.origin) return null
    const file = target.pathname.split('/').pop() || ''
    const route = PAGE_ROUTES[file]
    return route ? `${route}${target.search}${target.hash}` : null
  }

  document.addEventListener('click', (event) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!anchor) return
    const route = routeFor(anchor.href)
    if (!route) return
    event.preventDefault()
    event.stopPropagation()
    send('navigation', { to: route })
  }, true)

  let logoutSent = false
  window.addEventListener('kg-auth-session-change', (event) => {
    if (event.detail?.username) {
      logoutSent = false
      return
    }
    if (!logoutSent) {
      logoutSent = true
      send('logout', {})
    }
  })

  window.addEventListener('DOMContentLoaded', () => send('ready', {}), { once: true })
})()
