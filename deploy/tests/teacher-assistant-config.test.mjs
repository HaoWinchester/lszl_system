import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
const root = resolve(import.meta.dirname, '../..');

test('assistant overlay isolates converter, credentials, storage and memory limits', t => {
  const dir = mkdtempSync(join(tmpdir(), 'assistant-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'backend'));
  const files = ['docker-compose.uat.yml', 'docker-compose.mini-uat.yml', 'docker-compose.teacher-assistant.yml'];
  for (const file of files) copyFileSync(join(root, file), join(dir, file));
  writeFileSync(join(dir, '.env.uat'), 'POSTGRES_PASSWORD=test-only\nSECRET_KEY=test-only\n');
  writeFileSync(join(dir, 'backend/.env.wechat-mini.local'), 'WECHAT_MINI_APP_ID=test-only\n');
  writeFileSync(join(dir, 'backend/.env.teacher-assistant.local'), 'ANTHROPIC_AUTH_TOKEN=test-only-provider\nANTHROPIC_BASE_URL=https://example.invalid\n');
  const result = spawnSync('docker', ['compose', '--env-file', '.env.uat', ...files.flatMap(f => ['-f', f]), 'config', '--format', 'json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout), worker = config.services['assistant-worker'], converter = config.services['document-converter'];
  assert.equal(worker.build.additional_contexts, undefined);
  assert.equal(worker.build.args.BACKEND_RUNTIME, config.services.backend.image);
  assert.equal(worker.mem_limit, '671088640');
  assert.equal(converter.mem_limit, '402653184');
  assert.equal(worker.environment.TEACHER_ASSISTANT_MODEL, 'glm-5.3-flash[1m]');
  assert.equal(worker.environment.ANTHROPIC_AUTH_TOKEN, 'test-only-provider');
  assert.equal(config.services.backend.environment.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.deepEqual(Object.keys(converter.networks), ['converter']);
  assert.equal(config.networks.converter.internal, true);
  assert.equal(converter.environment?.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(converter.environment?.DATABASE_URL, undefined);
  assert.equal(converter.volumes, undefined);
  assert.equal(converter.ports, undefined);
  for (const service of [worker, converter]) {
    assert.equal(service.read_only, true);
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.ok(service.security_opt.includes('no-new-privileges:true'));
  }
  assert.ok(worker.volumes.some(v => v.target === '/usr/local/bin/claude' && v.read_only));
  assert.ok(worker.volumes.some(v => v.target === '/var/lib/teacher-assistant' && v.type === 'volume'));
});

test('deployment fails closed on readiness before marking the commit and excludes local credentials', () => {
  const script = readFileSync(join(root, 'deploy/update-uat.sh'), 'utf8');
  const readiness = script.indexOf('python -m app.cli.check_teacher_assistant_readiness');
  assert.ok(readiness > 0 && readiness < script.indexOf("'$CURRENT_COMMIT'"));
  assert.match(script.slice(readiness, readiness + 400), /exit 1/);
  assert.match(script, /os\.chown\(p,10001,10001\)/);
  assert.match(readFileSync(join(root, 'deploy/rsync-excludes.txt'), 'utf8'), /\/backend\/\.env\.teacher-assistant\.local/);
  assert.doesNotMatch(script, /config --format|printenv|cat .*env\.teacher/);
});


test('assistant reuses backend Python runtime without a second dependency install', () => {
  const backend = readFileSync(join(root, 'backend/Dockerfile'), 'utf8');
  const assistant = readFileSync(join(root, 'backend/Dockerfile.teacher-assistant'), 'utf8');
  assert.equal(assistant.match(/^FROM python:.+$/m)[0], backend.match(/^FROM .+$/m)[0]);
  assert.match(assistant, /^ARG BACKEND_RUNTIME=lszl-kg-backend:uat-27c39ab\nFROM \$\{BACKEND_RUNTIME\} AS backend-runtime/m);
  assert.match(assistant, /^COPY --from=backend-runtime \/usr\/local \/usr\/local$/m);
  assert.doesNotMatch(assistant, /^RUN .*pip(?:3)? install/m);
  assert.ok(assistant.indexOf('apt-get install') < assistant.indexOf('COPY --from=backend-runtime'));
  assert.ok(assistant.indexOf('COPY --from=backend-runtime') < assistant.indexOf('COPY backend/ /app/backend/'));
  assert.match(assistant, /^USER assistant$/m);
});


test('UAT builds the backend runtime tag before rebuilding and starting the assistant', () => {
  const script = readFileSync(join(root, 'deploy/update-uat.sh'), 'utf8');
  const prebuild = script.indexOf('--env-file $ENV_FILE build backend');
  const start = script.indexOf('--env-file $ENV_FILE up -d --build');
  assert.ok(prebuild > 0 && prebuild < start);
  assert.match(script, /^set -euo pipefail$/m);
  assert.doesNotMatch(script.slice(prebuild, start), /\|\| true/);
});
