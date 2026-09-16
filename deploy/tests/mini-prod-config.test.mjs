import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function fixture(t) {
 mkdirSync(join(root,'artifacts/mini-readiness'),{recursive:true});
 const dir = mkdtempSync(join(root, 'artifacts/mini-readiness/prod-config-'));
 t.after(() => rmSync(dir,{recursive:true,force:true}));
 mkdirSync(join(dir,'backend')); mkdirSync(join(dir,'deploy')); mkdirSync(join(dir,'bin'));
 for (const file of ['update.sh','timing.sh']) copyFileSync(join(root,'deploy',file),join(dir,'deploy',file));
 writeFileSync(join(dir,'bin/ssh'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CHECK_LOG"\ncase "$*" in *"test -s backend/.env.wechat-mini.local"*) exit 7;; *) exit 0;; esac\n', {mode:0o755});
 return dir;
}
test('production configuration preflight checks isolated mini credentials and never starts deployment', t => {
 const dir = fixture(t), log = join(dir,'calls.log');
 const result = spawnSync('bash',[join(dir,'deploy/update.sh'),'--check-config'],{cwd:dir,encoding:'utf8',env:{...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,CHECK_LOG:log}});
 assert.notEqual(result.status,0);
 const calls = readFileSync(log,'utf8');
 assert.match(calls,/test -s backend\/\.env\.wechat-mini\.local/);
 assert.doesNotMatch(calls,/tar -czf|pg_dump|docker tag|up -d|rsync/);
});
test('production mini overlay preserves PC credentials, payment mount, database and ports', t => {
 const dir = fixture(t);
 writeFileSync(join(dir,'docker-compose.prod.yml'),readFileSync(join(root,'docker-compose.prod.yml'),'utf8').replace('/opt/lszl/secrets/wechatpay/payment.env','./payment.env'));
 copyFileSync(join(root,'docker-compose.mini-uat.yml'),join(dir,'docker-compose.mini-uat.yml'));
 writeFileSync(join(dir,'.env.prod'),'POSTGRES_PASSWORD=test-db\nSECRET_KEY=test-key\nWECHAT_APP_ID=pc-app\n');
 writeFileSync(join(dir,'payment.env'),'WECHAT_PAY_MCH_ID=test-merchant\n');
 writeFileSync(join(dir,'backend/.env.wechat-mini.local'),'WECHAT_MINI_APP_ID=wx-mini-test\nWECHAT_MINI_APP_SECRET=mini-test-secret\nWECHAT_MINI_ENABLE_DEMO=true\n');
 const run = overlay => spawnSync('docker',['compose','--env-file','.env.prod','-f','docker-compose.prod.yml',...(overlay?['-f','docker-compose.mini-uat.yml']:[]),'config','--format','json'],{cwd:dir,encoding:'utf8'});
 const before=run(false),after=run(true); assert.equal(before.status,0,before.stderr);assert.equal(after.status,0,after.stderr);
 const a=JSON.parse(before.stdout),b=JSON.parse(after.stdout);assert.deepEqual(a.services.db,b.services.db);assert.deepEqual(a.volumes,b.volumes);
 for(const key of ['ports','volumes','image']) assert.deepEqual(a.services.backend[key],b.services.backend[key]);
 assert.equal(b.services.backend.environment.WECHAT_MINI_ENABLE_DEMO,'false');
 for(const [key,value] of Object.entries(a.services.backend.environment)) assert.equal(b.services.backend.environment[key],value,key);
 assert.equal(b.services.backend.environment.WECHAT_MINI_APP_ID,'wx-mini-test');
 assert.match(b.services.backend.command.join(' '),/httpx.*WARNING/);
});

test('deployment transfer excludes local test credentials and nested worktrees', t => {
 const dir=fixture(t), source=join(dir,'source'),target=join(dir,'target');
 for(const path of ['artifacts/check','.worktrees/another','backend'])mkdirSync(join(source,path),{recursive:true});mkdirSync(target);
 writeFileSync(join(source,'artifacts/check/accounts.json'),'private-test-token');
 writeFileSync(join(source,'.worktrees/another/secret.txt'),'private-nested-data');
 writeFileSync(join(source,'backend/.env.wechat-mini.local'),'private-provider-secret');
 writeFileSync(join(source,'backend/app.py'),'public-code');
 const result=spawnSync('rsync',['-an','--out-format=%n','--exclude-from',join(root,'deploy/rsync-excludes.txt'),source+'/',target+'/'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/backend\/app.py/);assert.doesNotMatch(result.stdout,/accounts|artifacts|\.worktrees|\.env.wechat-mini/);
});

// The backend course seed must be exported before copying the runtime into the image.
test('production build refreshes the backend course seed before transfer', () => {
 const script=readFileSync(join(root,'deploy/update.sh'),'utf8');
 const release=script.indexOf('node scripts/manage-new-legacy.js update');
 const seed=script.indexOf('node scripts/export-guided-course.mjs');
 const transfer=script.indexOf('rsync -az');
 assert.ok(release>=0 && seed>release && transfer>seed);
});
