import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
test('card links use directional side midpoints and matching default tangents', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../new-legacy/tests/graph-edge-midpoints.test.js', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})
test('edge geometry keeps handles on the cubic and moves manual routes from snapshots', () => {
  const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('../../new-legacy/tests/graph-edge-geometry.test.js', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})

test('fixed card ports follow the outline and survive creation, storage and rebinding', () => {
  const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('../../new-legacy/tests/graph-fixed-ports.test.js', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})

test('graph fragments preserve internal relations and remap independent objects', () => {
  const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('../../new-legacy/tests/graph-fragment.test.js', import.meta.url))], { encoding: 'utf8', cwd: fileURLToPath(new URL('../../', import.meta.url)) })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})

test('temporary related sessions isolate one-hop edits and history', () => {
  const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('../../new-legacy/tests/graph-temporary-session.test.js', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})

test('mindmap layouts and themes preserve graph content and manual appearance',()=>{
  const result=spawnSync(process.execPath,['--test',fileURLToPath(new URL('../../new-legacy/tests/graph-mindmap-layout.test.js',import.meta.url))],{encoding:'utf8'});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`)
})
