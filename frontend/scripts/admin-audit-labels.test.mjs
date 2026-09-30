import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
test('administrator summaries explain account events and retain original event codes',async()=>{
 const actions=['login_success','login_failed','logout','unmapped_event'];
 const w={KGDomainApi:{request:async({path})=>path.includes('/system/logs')?{logs:actions.map((action,id)=>({id,action,actor:'tester',target_username:'learner',detail:{},at:'2026-09-30T00:00:00Z'}))}:{}},dispatchEvent(){},addEventListener(){}};w.window=w;
 vm.runInNewContext(readFileSync('scripts/new-legacy-assets/admin-domain-summary.js','utf8'),w);
 const {audit}=await w.KGAdminDomainSummary.ready();
 assert.deepEqual(Array.from(audit.map(row=>row.summary)),['登录成功','登录失败','退出登录','unmapped_event']);
 assert.equal(audit[0].action,'login_success');assert.equal(audit[0].actionLabel,'登录成功');assert.equal(audit[0].entityTypeLabel,'账号');assert.equal(audit[1].status,'failed');
});
