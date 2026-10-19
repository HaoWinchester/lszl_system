import test from 'node:test'
import assert from 'node:assert/strict'
import {runNodeTestProcess} from './node-test-process.mjs'
import { fileURLToPath } from 'node:url'
test('card links use directional side midpoints and matching default tangents', () => {
  const result = runNodeTestProcess( [fileURLToPath(new URL('../../new-legacy/tests/graph-edge-midpoints.test.js', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})
test('edge geometry and editor gestures keep bound routes intact', () => {
  const result = runNodeTestProcess( ['--test', fileURLToPath(new URL('../../new-legacy/tests/graph-edge-geometry.test.js', import.meta.url)), fileURLToPath(new URL('../../new-legacy/tests/graph-feedback.test.js', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})

test('fixed card ports follow the outline and survive creation, storage and rebinding', () => {
  const result = runNodeTestProcess( ['--test', fileURLToPath(new URL('../../new-legacy/tests/graph-fixed-ports.test.js', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})

test('graph fragments preserve internal relations and remap independent objects', () => {
  const result = runNodeTestProcess( ['--test', fileURLToPath(new URL('../../new-legacy/tests/graph-fragment.test.js', import.meta.url))], { encoding: 'utf8', cwd: fileURLToPath(new URL('../../', import.meta.url)) })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})

test('temporary related sessions isolate one-hop edits and history', () => {
  const result = runNodeTestProcess( ['--test', fileURLToPath(new URL('../../new-legacy/tests/graph-temporary-session.test.js', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})

test('mindmap layouts and themes preserve graph content and manual appearance',()=>{
  const result=runNodeTestProcess(['--test',fileURLToPath(new URL('../../new-legacy/tests/graph-mindmap-layout.test.js',import.meta.url))],{encoding:'utf8'});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`)
})


test('graph image content and notes roundtrip without truncation',()=>{
  const result=runNodeTestProcess(['--test',fileURLToPath(new URL('../../new-legacy/tests/graph-media-roundtrip.test.js',import.meta.url))],{encoding:'utf8'});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`)
})

test('XMind confirmation and shared import entry points',()=>{
  const result=runNodeTestProcess(['--test',fileURLToPath(new URL('../../new-legacy/tests/graph-xmind-import.test.js',import.meta.url))],{encoding:'utf8',cwd:fileURLToPath(new URL('../../',import.meta.url))});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`)
})
