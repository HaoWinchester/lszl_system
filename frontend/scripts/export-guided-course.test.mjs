import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

import { exportCourse } from './export-guided-course.mjs'

const upstreamRoot = resolve(import.meta.dirname, '../../new-legacy')

test('exports the complete v8.6 course and canonical activity library', () => {
  const pkg = exportCourse(upstreamRoot)
  assert.equal(pkg.version, readFileSync(resolve(upstreamRoot, 'VERSION'), 'utf8').trim())
  assert.equal(pkg.course.stages.length, 3)
  assert.equal(pkg.course.parts.length, 9)
  assert.equal(pkg.course.nodes.length, 108)
  assert.equal(pkg.activities.length, 82)
  assert.equal(pkg.activitySchemaVersion, 1)
  assert.match(pkg.contentHash, /^sha256:[a-f0-9]{64}$/)
})

test('every activity and every course reference is valid', () => {
  const pkg = exportCourse(upstreamRoot)
  const activityIds = new Set(pkg.activities.map((activity) => activity.id))
  assert.equal(activityIds.size, pkg.activities.length)
  for (const result of pkg.validation.results) assert.equal(result.valid, true, `${result.activityId}: ${result.errors.join('; ')}`)
  for (const node of pkg.course.nodes) {
    for (const activityId of node.activityIds ?? []) assert.equal(activityIds.has(activityId), true, `${node.id} -> ${activityId}`)
  }
})

test('the standard new-legacy sync also refreshes the backend course seed', () => {
  const packageJson = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'))
  assert.match(packageJson.scripts['sync:new-legacy'], /sync-new-legacy\.js.*export-guided-course\.mjs/)
})
