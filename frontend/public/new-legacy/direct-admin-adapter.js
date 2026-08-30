'use strict'

;(function (global) {
  const service = global.KGUserAdminService
  const auth = global.KGAuthCore
  const api = global.KGDomainApi
  if (!service || !auth || !api) return

  if (global.KGRolePermissions) {
    global.KGRolePermissions.canEnterUserManagement = function () {
      return global.KGRolePermissions.can('accessUserManagement')
    }
  }

  const original = Object.fromEntries(
    ['loadUsers', 'createUser', 'updateUser', 'resetPassword', 'setStatus', 'duplicateUser', 'deleteUsers', 'batchUpdate', 'importUsers']
      .map((name) => [name, service[name]?.bind(service)]),
  )

  function failed(error, fallback = {}) {
    return {
      ok: false,
      code: String(error?.code || 'REQUEST_FAILED'),
      message: String(error?.message || error || '服务器请求失败'),
      users: service.normalizeUsers(fallback),
    }
  }

  function milliseconds(value) {
    const parsed = value ? Date.parse(value) : 0
    return Number.isFinite(parsed) ? parsed : 0
  }

  function normalizePager(raw = {}) {
    const page = Number(raw.page || 1)
    const pageSize = Number(raw.page_size || raw.pageSize || 200)
    return {
      page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
      pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 200,
    }
  }

  function normalizeFilter(raw = {}) {
    return {
      query: String(raw.query || '').trim(),
      role: String(raw.role || '').trim(),
      status: String(raw.status || '').trim(),
    }
  }

  function toLegacy(user, previous = {}) {
    return auth.normalizeUser(user.username, {
      ...previous,
      username: user.username,
      role: user.role,
      status: user.status,
      displayName: user.display_name || user.displayName || user.username,
      email: user.email || '',
      phone: user.phone || '',
      subject: user.subject || 'PMP',
      tags: user.tags || [],
      note: user.note || '',
      subscription: user.subscription || null,
      source: user.source || 'server',
      createdAt: milliseconds(user.created_at || user.createdAt),
      updatedAt: milliseconds(user.updated_at || user.updatedAt),
      lastLoginAt: milliseconds(user.last_login_at || user.lastLoginAt),
      lastActiveAt: milliseconds(user.last_active_at || user.lastActiveAt),
      archivedAt: milliseconds(user.archived_at || user.archivedAt),
      graphNodes: Number(user.graph_nodes || user.graphNodes || 0),
      graphLinks: Number(user.graph_links || user.graphLinks || 0),
      questionBanks: Number(user.question_banks || user.questionBanks || 0),
      questionCount: Number(user.question_count || user.questionCount || 0),
      questionPapers: Number(user.papers || user.questionPapers || 0),
      salt: '',
      hash: '',
    })
  }

  function hydrateUiState(users) {
    auth.replaceUsers?.(users)
    const subscriptions = Object.fromEntries(
      Object.values(users).filter(user => user.subscription).map(user => [user.username, user.subscription]),
    )
    global.KGSubscription?.hydrateSubscriptions?.(subscriptions, { merge: true })
  }

  async function listUsers(fallback = {}, options = {}) {
    const pager = normalizePager(options)
    const filter = normalizeFilter(options)
    const query = new URLSearchParams({ page: String(pager.page), page_size: String(pager.pageSize) })
    if (filter.query) query.set('query', filter.query)
    if (filter.role && filter.role !== 'ALL') query.set('role', filter.role)
    if (filter.status && filter.status !== 'ALL') query.set('status', filter.status)
    try {
      const payload = await api.request({ path: `/api/v1/users?${query}` })
      const previous = service.normalizeUsers(fallback)
      const users = {}
      for (const user of payload.users || []) users[user.username] = toLegacy(user, previous[user.username])
      const normalized = service.normalizeUsers(users)
      hydrateUiState(normalized)
      return {
        ok: true,
        users: normalized,
        total: Number(payload.total || 0),
        page: Number(payload.page || pager.page),
        page_size: Number(payload.page_size || pager.pageSize),
        pageSize: Number(payload.page_size || pager.pageSize),
      }
    } catch (error) {
      return failed(error, fallback)
    }
  }

  async function refreshed(fallback, extra = {}, options = {}) {
    const result = await listUsers(fallback, options)
    if (!result.ok) return result
    const users = { ...result.users }
    if (extra.user?.username) users[extra.user.username] = extra.user
    const { users: _page, ...rest } = result
    const normalized = service.normalizeUsers(users)
    hydrateUiState(normalized)
    global.KGSystemDomain?.refreshAdminLogs?.().catch(() => {})
    return { ok: true, ...rest, users: normalized, ...extra }
  }

  function userPayload(user = {}) {
    return {
      display_name: user.displayName ?? user.display_name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      subject: user.subject,
      tags: user.tags,
      note: user.note,
    }
  }

  function pagerOptions(options = {}) {
    return { ...normalizePager(options), ...normalizeFilter(options) }
  }

  service.persist = function (users) {
    const normalized = service.normalizeUsers(users)
    hydrateUiState(normalized)
    return { ok: true, users: normalized }
  }

  service.loadUsers = async function (_fallback = {}, options = {}) {
    const result = await listUsers(service.normalizeUsers(_fallback), pagerOptions(options))
    if (!result.ok) console.error('[DirectAdminAdapter]', result.message)
    return result
  }

  service.createUser = async function (users, input = {}, options = {}) {
    const validated = original.createUser(users, input)
    if (!validated?.ok) return validated
    try {
      const payload = await api.request({ method: 'POST', path: '/api/v1/users', body: {
        username: input.username, password: input.password, ...userPayload(input.user),
      } })
      return refreshed(users, { username: input.username, user: toLegacy(payload.user) }, pagerOptions(options))
    } catch (error) { return failed(error, users) }
  }

  service.updateUser = async function (users, username, patch = {}, options = {}) {
    const validated = original.updateUser(users, username, patch)
    if (!validated?.ok) return validated
    try {
      const payload = await api.request({ method: 'PUT', path: `/api/v1/users/${encodeURIComponent(username)}`, body: userPayload(patch) })
      return refreshed(users, { username, user: toLegacy(payload.user, users[username]) }, pagerOptions(options))
    } catch (error) { return failed(error, users) }
  }

  service.resetPassword = async function (users, username, password, options = {}) {
    const validated = original.resetPassword(users, username, password)
    if (!validated?.ok) return validated
    try {
      await api.request({ method: 'POST', path: `/api/v1/users/${encodeURIComponent(username)}/reset-password`, body: { new_password: password } })
      return refreshed(users, { username, user: users[username] }, pagerOptions(options))
    } catch (error) { return failed(error, users) }
  }

  service.setStatus = async function (users, username, status, options = {}) {
    const validated = original.setStatus(users, username, status)
    if (!validated?.ok) return validated
    try {
      const payload = await api.request({ method: 'PATCH', path: `/api/v1/users/${encodeURIComponent(username)}/status`, body: { status } })
      return refreshed(users, { username, user: toLegacy(payload.user, users[username]) }, pagerOptions(options))
    } catch (error) { return failed(error, users) }
  }

  service.duplicateUser = async function (users, sourceUsername, input = {}, options = {}) {
    const validated = original.duplicateUser(users, sourceUsername, input)
    if (!validated?.ok) return validated
    try {
      const payload = await api.request({ method: 'POST', path: `/api/v1/users/${encodeURIComponent(sourceUsername)}/duplicate`, body: {
        new_username: input.username, new_password: input.password,
      } })
      return refreshed(users, { username: input.username, sourceUsername, user: toLegacy(payload.user) }, pagerOptions(options))
    } catch (error) { return failed(error, users) }
  }

  service.deleteUsers = async function (users, usernames, options = {}) {
    const validated = original.deleteUsers(users, usernames)
    if (!validated?.ok) return validated
    const names = Array.from(new Set(Array.isArray(usernames) ? usernames : [usernames])).filter(Boolean)
    try {
      await api.request({ method: 'DELETE', path: '/api/v1/users/batch', body: { usernames: names } })
      return refreshed(validated.users, { deleted: names }, pagerOptions(options))
    } catch (error) { return failed(error, users) }
  }

  service.batchUpdate = async function (users, usernames, patch = {}, options = {}) {
    const validated = original.batchUpdate(users, usernames)
    if (!validated?.ok) return validated
    const names = Array.from(new Set(Array.isArray(usernames) ? usernames : [])).filter(Boolean)
    try {
      await api.request({ method: 'PATCH', path: '/api/v1/users/batch', body: {
        usernames: names, role: patch.role, status: patch.status, subject: patch.subject,
      } })
      return refreshed(validated.users, { updated: names }, pagerOptions(options))
    } catch (error) { return failed(error, users) }
  }

  service.importUsers = async function (users, payload, options = {}) {
    const validated = original.importUsers(users, payload, options)
    if (!validated?.ok) return validated
    const initialPassword = global.prompt('请设置本次导入账号的初始密码（至少 4 位）。所有导入账号首次登录都使用此密码：', '')
    if (initialPassword == null) return { ok: false, code: 'IMPORT_CANCELLED', message: '已取消导入。', users }
    if (String(initialPassword).length < 4) return { ok: false, code: 'INVALID_INITIAL_PASSWORD', message: '导入账号的初始密码至少 4 位。', users }
    const incoming = payload?.users && typeof payload.users === 'object' ? payload.users : payload
    const records = Array.isArray(incoming)
      ? incoming
      : Object.entries(incoming || {}).map(([username, user]) => ({ username, ...userPayload(user) }))
    try {
      const result = await api.request({ method: 'POST', path: '/api/v1/users/import', body: {
        users: records, initial_password: String(initialPassword),
      } })
      return refreshed(users, {
        count: Number(result.added || 0), skipped: Number(result.skipped || 0),
        message: '导入成功；导入账号的初始密码为管理员本次设置的密码。',
      }, pagerOptions(options))
    } catch (error) { return failed(error, users) }
  }
})(window)
