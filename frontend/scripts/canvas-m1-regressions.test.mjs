import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('../../new-legacy/', import.meta.url))
test('M1 focus, exact keyword roots, backgrounds and failed-save recovery', () => {
  const result = spawnSync(process.execPath, ['--test',
    'tests/canvas-dom-interaction.test.js',
    'tests/recall-keyword-resolution.test.js',
    'tests/workspace-background.test.js',
    'tests/v90-p4529-deep-recall-database-adapter.test.js',
    'tests/v90-p4517-deep-recall-large-graph-performance.test.js',
    'tests/v862-p2224-deep-recall-card-delete-reset.test.js',
    'tests/v90-p4519-deep-recall-node-search.test.js',
    'tests/v90-p4529-deep-recall-flow.test.js',
  ], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
