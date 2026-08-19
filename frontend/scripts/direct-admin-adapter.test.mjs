import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const frontend = resolve(import.meta.dirname, '..')
const adapter = readFileSync(resolve(frontend, 'scripts/new-legacy-assets/direct-admin-adapter.js'), 'utf8')

test('creating a user retains the POST result when the first list page is already full', () => {
  const existing = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [
    `existing_${index}`,
    { username: `existing_${index}`, role: 'student', status: 'active' },
  ]))
  const created = {
    username: 'newly_created_user',
    role: 'student',
    status: 'active',
    display_name: '新建学员',
    email: '',
    phone: '',
    subject: 'PMP',
    tags: [],
    note: '',
    source: 'user-management',
  }
  const service = {
    normalizeUsers: (users = {}) => ({ ...users }),
    createUser: (users, input) => ({ ok: true, users: { ...users, [input.username]: input.user }, username: input.username }),
  }
  class FakeXMLHttpRequest {
    open(method, path) { this.method = method; this.path = path }
    setRequestHeader() {}
    send() {
      this.status = this.method === 'POST' ? 201 : 200
      this.responseText = JSON.stringify(this.method === 'POST'
        ? { user: created }
        : { users: Object.values(existing) })
    }
  }
  const context = {
    JSON,
    Object,
    Array,
    String,
    Number,
    URLSearchParams,
    XMLHttpRequest: FakeXMLHttpRequest,
    KGUserAdminService: service,
    KGAuthCore: { normalizeUser: (username, user) => ({ ...user, username }) },
  }
  context.window = context
  vm.runInNewContext(adapter, context)

  const result = service.createUser(existing, {
    username: created.username,
    password: '111111',
    user: { role: 'student', status: 'active', subject: 'PMP' },
  })

  assert.equal(result.ok, true)
  assert.equal(result.users[created.username].displayName, '新建学员')
})
