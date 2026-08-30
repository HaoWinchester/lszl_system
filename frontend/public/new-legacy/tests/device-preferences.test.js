'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const preferencePath = path.resolve(__dirname, '../src/28-device-preferences.js')

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

function bootPreferences() {
  const runtime = { console, JSON, localStorage: new MemoryStorage() }
  runtime.window = runtime
  runtime.globalThis = runtime
  vm.createContext(runtime)
  vm.runInContext(fs.readFileSync(preferencePath, 'utf8'), runtime, { filename: preferencePath })
  return runtime
}

function deviceKey(suffix) {
  return `kg_${suffix}`
}

test('device preference facade rejects an exam-paper payload key while allowing global shortcut layout', () => {
  const runtime = bootPreferences()

  assert.throws(
    () => runtime.KGDevicePreferences.setJSON('kg_exam_papers_v1__admin', []),
    error => error.code === 'DEVICE_PREFERENCE_KEY_FORBIDDEN',
  )
  runtime.KGDevicePreferences.setJSON('kg_global_shortcuts_layout_v1', { collapsed: true })
  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.KGDevicePreferences.getJSON('kg_global_shortcuts_layout_v1', {}))),
    { collapsed: true },
  )
})

test('device preference facade permits only approved UI prefixes and returns fallbacks for absent values', () => {
  const runtime = bootPreferences()

  runtime.KGDevicePreferences.setString(deviceKey('resizable_teacher_panel'), '320')
  runtime.KGDevicePreferences.setJSON(deviceKey('workspace_layout_teacher'), { columns: 3 })
  runtime.KGDevicePreferences.setString(deviceKey('recent_selection_subject'), 'pmp')

  assert.equal(runtime.KGDevicePreferences.getString(deviceKey('resizable_teacher_panel'), ''), '320')
  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.KGDevicePreferences.getJSON(deviceKey('workspace_layout_teacher'), {}))),
    { columns: 3 },
  )
  assert.equal(runtime.KGDevicePreferences.getString(deviceKey('recent_selection_subject'), ''), 'pmp')
  assert.equal(runtime.KGDevicePreferences.getString(deviceKey('recent_selection_missing'), 'none'), 'none')
  assert.throws(
    () => runtime.KGDevicePreferences.setString('kg_course_config_drafts_v1', 'forbidden'),
    error => error.code === 'DEVICE_PREFERENCE_KEY_FORBIDDEN',
  )
})

test('device preference facade accepts approved scoped UI keys for admin and guest only', () => {
  const runtime = bootPreferences()

  runtime.KGDevicePreferences.setJSON('kg_multi_question_analysis_sections_v1__admin', ['stem', 'analysis'])
  runtime.KGDevicePreferences.setString('kg_canvas_workspace_catalog_v2__guest', 'collapsed')

  assert.deepEqual(
    JSON.parse(JSON.stringify(runtime.KGDevicePreferences.getJSON('kg_multi_question_analysis_sections_v1__admin', []))),
    ['stem', 'analysis'],
  )
  assert.equal(runtime.KGDevicePreferences.getString('kg_canvas_workspace_catalog_v2__guest', ''), 'collapsed')
  assert.throws(
    () => runtime.KGDevicePreferences.setJSON('kg_exam_papers_v1__admin', []),
    error => error.code === 'DEVICE_PREFERENCE_KEY_FORBIDDEN',
  )
  assert.throws(
    () => runtime.KGDevicePreferences.setString('kg_multi_question_analysis_sections_v1__', 'forbidden'),
    error => error.code === 'DEVICE_PREFERENCE_KEY_FORBIDDEN',
  )
})

test('device preference facade rejects retired migration markers', () => {
  const runtime = bootPreferences()

  assert.throws(
    () => runtime.KGDevicePreferences.setString('kg_deep_recall_theme_platform_migrated_v1', '1'),
    error => error.code === 'DEVICE_PREFERENCE_KEY_FORBIDDEN',
  )
})

test('device preference allowlists are immutable and cannot be extended to store business data', () => {
  const runtime = bootPreferences()
  const { EXACT_KEYS, PREFIXES } = runtime.KGDevicePreferences

  assert.equal(Object.isFrozen(EXACT_KEYS), true)
  assert.equal(Object.isFrozen(PREFIXES), true)
  assert.throws(() => { EXACT_KEYS.push(deviceKey('exam_papers_v1__admin')) }, error => error.name === 'TypeError')
  assert.throws(() => { PREFIXES.push(deviceKey('exam_')) }, error => error.name === 'TypeError')
  assert.throws(
    () => runtime.KGDevicePreferences.setJSON('kg_exam_papers_v1__admin', []),
    error => error.code === 'DEVICE_PREFERENCE_KEY_FORBIDDEN',
  )
})

test('registered content-center and multi-question preferences use the shared facade', () => {
  const root = path.resolve(__dirname, '..')
  for (const relative of [
    'src/91-content-center-app.js',
    'src/77-multi-question-workspace.js',
    'src/80-question-font-scale.js',
  ]) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8')
    assert.doesNotMatch(source, /\blocalStorage\b/, relative)
    assert.match(source, /KGDevicePreferences/, relative)
  }
})
