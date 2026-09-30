import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../new-legacy/src/91-teacher-workbench-app.js', import.meta.url), 'utf8')
async function workbench({ questions = [], papers = [] } = {}) {
  const nodes = new Map(), listeners = new Map()
  const document = {
    body: { dataset: {} },
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, { textContent: '', href: '' }); return nodes.get(id) },
    addEventListener(name, callback) { listeners.set(name, callback) },
  }
  const window = {
    KGLearningContent: { currentUser: () => ({ name: '教师', role: 'teacher' }) },
    KGQuestionCatalogAdapter: { ready: Promise.resolve(), snapshot: () => ({ banks: [{ id: 'b' }], questions }) },
    KGCourseManagementApi: { ready: async () => ({}), snapshot: () => ({ drafts: [], tasks: [] }) },
    KGDomainApi: { request: async () => ({ papers }) },
    addEventListener() {},
  }
  vm.runInNewContext(source, { document, window, console })
  listeners.get('DOMContentLoaded')()
  await new Promise(resolve => setImmediate(resolve))
  return id => nodes.get(id)
}
const unconfigured = [{ id: 'q', bankId: 'b', clues: [] }]
test('recent paper draft takes priority over unrelated recall configuration gaps', async () => {
  const node = await workbench({ questions: unconfigured, papers: [
    { id: 'older', name: '旧草稿', status: 'draft', updatedAt: 1 },
    { id: 'recent with space', name: '本周练习', status: 'draft', updatedAt: '2026-09-30T00:00:00Z' },
    { id: 'archived', name: '归档', status: 'archived', updatedAt: '2026-10-01T00:00:00Z' },
  ] })
  assert.match(node('wbNextDescription').textContent, /本周练习/)
  assert.equal(node('wbNextAction').href, 'paper-management.html?paper=recent%20with%20space')
  assert.equal(node('wbTrainingPendingCount').textContent, '1')
})
test('normal paper creation remains available before deep recall configuration', async () => {
  const node = await workbench({ questions: unconfigured })
  assert.equal(node('wbNextAction').href, 'paper-management.html')
  assert.match(node('wbNextDescription').textContent, /普通刷题无需/)
})
test('empty content directs the teacher to the file import task', async () => {
  const node = await workbench()
  assert.equal(node('wbNextAction').href, 'teacher-assistant.html')
  assert.equal(node('wbNextAction').textContent, '上传资料')
})
