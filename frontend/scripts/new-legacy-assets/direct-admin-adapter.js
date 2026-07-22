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
      source: user.source || 'server',
      createdAt: milliseconds(user.created_at),
      updatedAt: milliseconds(user.updated_at),
      lastLoginAt: milliseconds(user.last_login_at),
      lastActiveAt: milliseconds(user.last_active_at),
      archivedAt: milliseconds(user.archived_at),
      salt: '',
      hash: '',
    })
  }

  function listUsers(fallback = {}) {
    const response = request('GET', '/api/v1/users?page=1&page_size=200')
    if (!response.ok) return { ...response, users: service.normalizeUsers(fallback) }
    const previous = service.normalizeUsers(fallback)
    const users = {}
    for (const user of response.payload.users || []) users[user.username] = toLegacy(user, previous[user.username])
    return { ok: true, users: service.normalizeUsers(users) }
  }

  function refreshed(fallback, extra = {}) {
    const result = listUsers(fallback)
    if (!result.ok) return result
    const users = { ...result.users }
    if (extra.user?.username) users[extra.user.username] = extra.user
    return { ok: true, users: service.normalizeUsers(users), ...extra }
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

  service.loadUsers = function () {
    const fallback = original.loadUsers ? original.loadUsers() : {}
    const result = listUsers(fallback)
    if (!result.ok) console.error('[DirectAdminAdapter]', result.message)
    return result.users
  }

  service.createUser = function (users, input = {}) {
    const validated = original.createUser(users, input)
    if (!validated?.ok) return validated
    const body = {
      username: input.username,
      password: input.password,
      ...userPayload(input.user),
    }
    const response = request('POST', '/api/v1/users', body)
    return response.ok
      ? refreshed(users, { username: input.username, user: toLegacy(response.payload.user) })
      : response
  }

  service.updateUser = function (users, username, patch = {}) {
    const validated = original.updateUser(users, username, patch)
    if (!validated?.ok) return validated
    const response = request('PUT', `/api/v1/users/${encodeURIComponent(username)}`, userPayload(patch))
    return response.ok
      ? refreshed(users, { username, user: toLegacy(response.payload.user, users[username]) })
      : response
  }

  service.resetPassword = function (users, username, password) {
    const validated = original.resetPassword(users, username, password)
    if (!validated?.ok) return validated
    const response = request('POST', `/api/v1/users/${encodeURIComponent(username)}/reset-password`, { new_password: password })
    return response.ok ? refreshed(users, { username, user: users[username] }) : response
  }

  service.setStatus = function (users, username, status) {
    const validated = original.setStatus(users, username, status)
    if (!validated?.ok) return validated
    const response = request('PATCH', `/api/v1/users/${encodeURIComponent(username)}/status`, { status })
    return response.ok
      ? refreshed(users, { username, user: toLegacy(response.payload.user, users[username]) })
      : response
  }

  service.duplicateUser = function (users, sourceUsername, input = {}) {
    const validated = original.duplicateUser(users, sourceUsername, input)
    if (!validated?.ok) return validated
    const response = request('POST', `/api/v1/users/${encodeURIComponent(sourceUsername)}/duplicate`, {
      new_username: input.username,
      new_password: input.password,
    })
    return response.ok
      ? refreshed(users, { username: input.username, sourceUsername, user: toLegacy(response.payload.user) })
      : response
  }

  service.deleteUsers = function (users, usernames) {
    const validated = original.deleteUsers(users, usernames)
    if (!validated?.ok) return validated
    const names = Array.from(new Set(Array.isArray(usernames) ? usernames : [usernames])).filter(Boolean)
    const response = request('DELETE', '/api/v1/users/batch', { usernames: names })
    return response.ok ? refreshed(validated.users, { deleted: names }) : response
  }

  service.batchUpdate = function (users, usernames, patch = {}) {
    const validated = original.batchUpdate(users, usernames, patch)
    if (!validated?.ok) return validated
    const names = Array.from(new Set(Array.isArray(usernames) ? usernames : [])).filter(Boolean)
    const response = request('PATCH', '/api/v1/users/batch', {
      usernames: names,
      role: patch.role,
      status: patch.status,
      subject: patch.subject,
    })
    return response.ok ? refreshed(validated.users, { updated: names }) : response
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
        })
      : response
  }
})(window)
