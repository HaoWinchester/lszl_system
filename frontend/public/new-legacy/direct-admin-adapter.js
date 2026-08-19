'use strict'

;(function (global) {
  const service = global.KGUserAdminService
  const auth = global.KGAuthCore
  if (!service || !auth) return

  if (global.KGRolePermissions) {
    global.KGRolePermissions.canEnterUserManagement = function () {
      return global.KGRolePermissions.can('accessUserManagement')
    }
  }

  const original = Object.fromEntries(
    ['loadUsers', 'createUser', 'updateUser', 'resetPassword', 'setStatus', 'duplicateUser', 'deleteUsers', 'batchUpdate', 'importUsers']
      .map((name) => [name, service[name]?.bind(service)]),
  )

  function errorMessage(payload, status) {
    const detail = payload?.detail ?? payload?.message ?? payload?.error
    if (Array.isArray(detail)) return detail.map((item) => item?.msg || String(item)).join('；')
    return String(detail || `服务器请求失败（${status || 0}）`)
  }

  function request(method, path, body) {
    const xhr = new XMLHttpRequest()
    try {
      xhr.open(method, path, false)
      xhr.withCredentials = true
      xhr.setRequestHeader('Accept', 'application/json')
      if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json')
      xhr.send(body === undefined ? null : JSON.stringify(body))
      let payload = {}
      try { payload = xhr.responseText ? JSON.parse(xhr.responseText) : {} } catch (_) {}
      if (xhr.status < 200 || xhr.status >= 300) {
        return { ok: false, code: `HTTP_${xhr.status}`, message: errorMessage(payload, xhr.status) }
      }
      return { ok: true, payload }
    } catch (error) {
      return { ok: false, code: 'NETWORK_ERROR', message: `无法连接服务器：${error?.message || error}` }
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
      displayName: user.display_name || user.username,
      email: user.email || '',
      phone: user.phone || '',
      subject: user.subject || 'PMP',
      tags: user.tags || [],
      note: user.note || '',
      subscription: user.subscription || null,
      source: user.source || 'server',
      createdAt: milliseconds(user.created_at),
      updatedAt: milliseconds(user.updated_at),
      lastLoginAt: milliseconds(user.last_login_at),
      lastActiveAt: milliseconds(user.last_active_at),
      archivedAt: milliseconds(user.archived_at),
      graphNodes: Number(user.graph_nodes || 0),
      graphLinks: Number(user.graph_links || 0),
      questionBanks: Number(user.question_banks || 0),
      questionCount: Number(user.question_count || 0),
      questionPapers: Number(user.papers || 0),
      salt: '',
      hash: '',
    })
  }

  function listUsers(fallback = {}, options = {}) {
    const pager = normalizePager(options)
    const filter = normalizeFilter(options)
    const query = new URLSearchParams({
      page: String(pager.page),
      page_size: String(pager.pageSize),
    })
    if (filter.query) query.set('query', filter.query)
    if (filter.role && filter.role !== 'ALL') query.set('role', filter.role)
    if (filter.status && filter.status !== 'ALL') query.set('status', filter.status)

    const response = request('GET', `/api/v1/users?${query}`)
    if (!response.ok) return { ...response, users: service.normalizeUsers(fallback) }

    const previous = service.normalizeUsers(fallback)
    const users = {}
    for (const user of response.payload.users || []) users[user.username] = toLegacy(user, previous[user.username])

    return {
      ok: true,
      users: service.normalizeUsers(users),
      total: Number(response.payload.total || 0),
      page: Number(response.payload.page || pager.page),
      page_size: Number(response.payload.page_size || pager.pageSize),
      pageSize: Number(response.payload.page_size || pager.pageSize),
    }
  }

  function refreshed(fallback, extra = {}, options = {}) {
    const result = listUsers(fallback, options)
    if (!result.ok) return result
    const users = { ...result.users }
    if (extra.user?.username) users[extra.user.username] = extra.user
    // ...result 的 users 只是首页分页，必须在合并结果之前展开，避免覆盖 extra.user
    const { users: _firstPage, ...rest } = result
    return { ok: true, ...rest, users: service.normalizeUsers(users), ...extra }
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

  service.loadUsers = function (_fallback = {}, options = {}) {
    const fallback = service.normalizeUsers(_fallback)
    const result = listUsers(fallback, pagerOptions(options))
    if (!result.ok) {
      console.error('[DirectAdminAdapter]', result.message)
      return fallback
    }
    return result.users  // 只返回 users 对象，不返回完整的 {ok, users, total, ...}
  }

  service.createUser = function (users, input = {}, options = {}) {
    const validated = original.createUser(users, input)
    if (!validated?.ok) return validated
    const body = {
      username: input.username,
      password: input.password,
      ...userPayload(input.user),
    }
    const response = request('POST', '/api/v1/users', body)
    return response.ok
      ? refreshed(users, { username: input.username, user: toLegacy(response.payload.user) }, pagerOptions(options))
      : response
  }

  service.updateUser = function (users, username, patch = {}, options = {}) {
    const validated = original.updateUser(users, username, patch)
    if (!validated?.ok) return validated
    const response = request('PUT', `/api/v1/users/${encodeURIComponent(username)}`, userPayload(patch))
    return response.ok
      ? refreshed(users, { username, user: toLegacy(response.payload.user, users[username]) }, pagerOptions(options))
      : response
  }

  service.resetPassword = function (users, username, password, options = {}) {
    const validated = original.resetPassword(users, username, password)
    if (!validated?.ok) return validated
    const response = request('POST', `/api/v1/users/${encodeURIComponent(username)}/reset-password`, { new_password: password })
    return response.ok
      ? refreshed(users, { username, user: users[username] }, pagerOptions(options))
      : response
  }

  service.setStatus = function (users, username, status, options = {}) {
    const validated = original.setStatus(users, username, status)
    if (!validated?.ok) return validated
    const response = request('PATCH', `/api/v1/users/${encodeURIComponent(username)}/status`, { status })
    return response.ok
      ? refreshed(users, { username, user: toLegacy(response.payload.user, users[username]) }, pagerOptions(options))
      : response
  }

  service.duplicateUser = function (users, sourceUsername, input = {}, options = {}) {
    const validated = original.duplicateUser(users, sourceUsername, input)
    if (!validated?.ok) return validated
    const response = request('POST', `/api/v1/users/${encodeURIComponent(sourceUsername)}/duplicate`, {
      new_username: input.username,
      new_password: input.password,
    })
    return response.ok
      ? refreshed(users, { username: input.username, sourceUsername, user: toLegacy(response.payload.user) }, pagerOptions(options))
      : response
  }

  service.deleteUsers = function (users, usernames, options = {}) {
    const validated = original.deleteUsers(users, usernames)
    if (!validated?.ok) return validated
    const names = Array.from(new Set(Array.isArray(usernames) ? usernames : [usernames])).filter(Boolean)
    const response = request('DELETE', '/api/v1/users/batch', { usernames: names })
    return response.ok ? refreshed(validated.users, { deleted: names }, pagerOptions(options)) : response
  }

  service.batchUpdate = function (users, usernames, patch = {}, options = {}) {
    const validated = original.batchUpdate(users, usernames)
    if (!validated?.ok) return validated
    const names = Array.from(new Set(Array.isArray(usernames) ? usernames : [])).filter(Boolean)
    const response = request('PATCH', '/api/v1/users/batch', {
      usernames: names,
      role: patch.role,
      status: patch.status,
      subject: patch.subject,
    })
    return response.ok ? refreshed(validated.users, { updated: names }, pagerOptions(options)) : response
  }

  service.importUsers = function (users, payload, options = {}) {
    const validated = original.importUsers(users, payload, options)
    if (!validated?.ok) return validated
    const initialPassword = global.prompt('请设置本次导入账号的初始密码（至少 4 位）。所有导入账号首次登录都使用此密码：', '')
    if (initialPassword == null) {
      return { ok: false, code: 'IMPORT_CANCELLED', message: '已取消导入。' }
    }
    if (String(initialPassword).length < 4) {
      return { ok: false, code: 'INVALID_INITIAL_PASSWORD', message: '导入账号的初始密码至少 4 位。' }
    }
    const incoming = payload?.users && typeof payload.users === 'object' ? payload.users : payload
    const records = Array.isArray(incoming)
      ? incoming
      : Object.entries(incoming || {}).map(([username, user]) => ({ username, ...userPayload(user) }))
    const response = request('POST', '/api/v1/users/import', {
      users: records,
      initial_password: String(initialPassword),
    })
    return response.ok
      ? refreshed(users, {
          count: Number(response.payload.added || 0),
          skipped: Number(response.payload.skipped || 0),
          message: '导入成功；导入账号的初始密码为管理员本次设置的密码。',
        }, pagerOptions(options))
      : response
  }

  service.exportUsers = function (usernames) {
    const list = Array.from(new Set(Array.isArray(usernames) ? usernames : []))
      .filter(Boolean)
      .map((username) => String(username).trim())
      .filter(Boolean)
    const query = list.length ? `?usernames=${encodeURIComponent(list.join(','))}` : ''
    const response = request('GET', `/api/v1/users/export${query}`)
    if (!response.ok) return response
    return { ok: true, payload: response.payload }
  }
})(window)
