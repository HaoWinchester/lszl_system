import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import test from 'node:test'

const timing = fileURLToPath(new URL('../../deploy/timing.sh', import.meta.url))
function run(body, args = []) {
  return spawnSync('bash', ['-c', `set -euo pipefail
source "$1"
deployment_timing_start test
trap 'deployment_timing_finish "$?"' EXIT
${body}`, 'test', timing, ...args], { encoding: 'utf8' })
}

test('records completed stages and a total without exposing command arguments', () => {
  const result = run('deployment_timing_stage build\nprintf "secret-token" >/dev/null\ndeployment_timing_stage upload\ntrue')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stderr, /TIMING scope=test stage=build seconds=\d+ status=0/)
  assert.match(result.stderr, /TIMING scope=test stage=upload seconds=\d+ status=0/)
  assert.match(result.stderr, /TIMING scope=test stage=total seconds=\d+ status=0/)
  assert.doesNotMatch(result.stderr, /secret-token/)
})

test('a failed command keeps its exit code and identifies the failed stage', () => {
  const result = run('deployment_timing_stage validate\n(exit 17)\ndeployment_timing_stage upload')
  assert.equal(result.status, 17, result.stderr)
  assert.match(result.stderr, /stage=validate seconds=\d+ status=17/)
  assert.match(result.stderr, /stage=total seconds=\d+ status=17/)
  assert.doesNotMatch(result.stderr, /stage=upload/)
})


test('release cleanup is included in timing while preserving the original failure', (t) => {
  const parent = fileURLToPath(new URL('../../.superpowers/', import.meta.url))
  mkdirSync(parent, { recursive: true })
  const temporary = mkdtempSync(`${parent}/timing-`)
  t.after(() => rmSync(temporary, { recursive: true, force: true }))
  const script = readFileSync(new URL('./validate-new-legacy-release.sh', import.meta.url), 'utf8')
  const cleanup = script.match(/^cleanup\(\) \{[\s\S]*?^\}/m)[0]
  const result = run(`${cleanup}
INTEGRATED_PID=""
RAW_PID=""
VALIDATION_DATABASE_CREATED=1
VALIDATION_DATABASE_NAME=disposable
VALIDATION_ROOT="$2"
postgres_database_command() { sleep 1; }
trap cleanup EXIT
deployment_timing_stage validate
(exit 17)`, [temporary])
  assert.equal(result.status, 17, result.stderr)
  const total = result.stderr.match(/stage=total seconds=(\d+) status=17/)
  assert.ok(total, result.stderr)
  assert.ok(Number(total[1]) >= 1, 'total must include database cleanup time')
})
