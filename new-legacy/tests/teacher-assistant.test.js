'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/teacher/teacher-assistant.js'), 'utf8');
function runtime(fetcher, storage = new Map()) {
  const context = { URL, FormData, sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
  vm.runInNewContext(source, context);
  let sequence = 0;
  return { api: context.KGTeacherAssistant, client: context.KGTeacherAssistant.createClient(fetcher, () => 'request-' + ++sequence), storage };
}
function response(data, status = 200) { return { ok: status < 400, status, json: async () => data }; }
const session = { id: 'session-1', revision: 3, plan: { items: [] }, job: null };
test('sessions reload from server and all mutation payloads use revision/request keys', async () => {
  const calls = [];
  const { client } = runtime(async (url, options) => { calls.push({ url, options }); return response(url.endsWith('/sessions') && options.method !== 'POST' ? { sessions: [session] } : { session }); });
  assert.equal((await client.list())[0].id, session.id);
  await client.load(session.id);
  await client.mutate('messages', { content: '仅回忆和归纳，保留多选答案' });
  await client.mutate('execute', { revision: 3 });
  assert.equal(JSON.parse(calls[2].options.body).content, '仅回忆和归纳，保留多选答案');
  assert.equal(JSON.parse(calls[3].options.body).revision, 3);
  assert.equal(JSON.parse(calls[3].options.body).requestId, 'request-2');
  assert.ok(calls.every(call => call.options.credentials === 'same-origin'));
});
test('lost response reconciles server state and retry after refresh retains opaque request ID only', async () => {
  let fail = true; const bodies = []; const storage = new Map();
  const fetcher = async (url, options) => { if (options.method === 'POST') { bodies.push(JSON.parse(options.body)); if (fail) throw new Error('network lost'); } return response({ session }); };
  const first = runtime(fetcher, storage); await first.client.load(session.id);
  await assert.rejects(first.client.mutate('messages', { content: '不要第 3 题' }), /network lost/);
  assert.equal(first.client.session.revision, 3);
  assert.ok([...storage.values()].every(value => value === 'request-1'));
  const refreshed = runtime(fetcher, storage); await refreshed.client.load(session.id); fail = false;
  await refreshed.client.mutate('messages', { content: '不要第 3 题' });
  assert.equal(bodies[0].requestId, bodies[1].requestId); assert.equal(storage.size, 0);
});
test('concurrent repeated send is blocked and cancel/retry reach real endpoints', async () => {
  let release; let count = 0;
  const { client } = runtime(async (url, options) => { if (url.endsWith('/messages')) { count++; await new Promise(resolve => { release = resolve; }); } return response({ session }); });
  await client.load(session.id); const pending = client.mutate('messages', { content: '修改名称' });
  await assert.rejects(client.mutate('messages', { content: '修改名称' }), /正在提交/); release(); await pending;
  assert.equal(count, 1); await client.mutate('cancel'); await client.mutate('retry');
});
test('upload enforces format/count/size and posts actual multipart files', async () => {
  let uploadBody;
  const { api, client } = runtime(async (url, options) => { if (url.endsWith('/uploads')) uploadBody = options.body; return response({ session }); });
  assert.throws(() => api.validateFiles([]), /选择/);
  assert.throws(() => api.validateFiles(Array.from({ length: 6 }, () => ({ name: 'a.json', size: 1 }))), /5/);
  assert.throws(() => api.validateFiles([{ name: 'a.exe', size: 1 }]), /仅支持/);
  assert.throws(() => api.validateFiles([{ name: 'a.pdf', size: 21 * 1024 * 1024 }]), /20/);
  assert.throws(() => api.validateFiles(Array.from({ length: 3 }, () => ({ name: 'a.pdf', size: 20 * 1024 * 1024 }))), /50/);
  await client.load(session.id); const file = new Blob(['{}'], { type: 'application/json' }); file.name = 'lesson.json';
  await client.upload([file]); assert.equal(uploadBody.getAll('files').length, 1);
});
test('worker unavailable is an error, failed jobs never become client success, delete calls backend', async () => {
  let deny = true; const calls = [];
  const { api, client } = runtime(async (url, options) => { calls.push({ url, options }); if (options.method === 'POST' && deny) return response({ detail: 'worker 未配置，请联系管理员' }, 503); if (options.method === 'DELETE') return response(null, 204); return response({ session: { ...session, job: { status: 'failed', error: 'partial failure' } } }); });
  await client.load(session.id); await assert.rejects(client.mutate('execute', { revision: 3 }), /worker/);
  assert.equal(client.session.job.status, 'failed'); assert.equal(api.activeJob(client.session), false);
  deny = false; await client.mutate('retry'); await client.remove(); assert.equal(client.session, null);
  assert.equal(calls.at(-1).options.method, 'DELETE');
});
test('activation rejects lease conflict with status and protects selection against stale loads', async () => {
  let release; const other = { ...session, id: 'second' };
  const { client } = runtime(async (url, options) => {
    if (url.endsWith('/blocked/activate')) return response({detail:'正在停止'},409);
    if (url.endsWith('/slow')) { await new Promise(resolve => { release = resolve; }); return response({session}); }
    return response({session:other});
  });
  const loading = client.load('slow'); await client.activate('second'); release(); await loading;
  assert.equal(client.session.id,'second');
  await assert.rejects(client.activate('blocked'), error => error.status === 409);
});
test('native images accepted and stopping lease remains an active job', () => {
  const {api}=runtime(async()=>response({session}));
  for(const name of ['a.png','a.jpg','a.jpeg','a.webp']) assert.equal(api.validateFiles([{name,size:8}]).length,1);
  assert.equal(api.activeJob({job:{status:'cancelled'},runtime:{status:'stopping'}}),true);
});

test('file progress updates the original row and coalesces chunks without false running entries', () => {
  const {api}=runtime(async()=>response({session}));
  assert.equal(typeof api.updateActivity,'function');
  let rows=[];
  const event=(type,data)=>{rows=api.updateActivity(rows,{type,data});};
  event('tool_start',{name:'read_file',uploadId:'file-a',label:'正在解析 A'});
  event('tool_end',{name:'read_file',uploadId:'file-a',ok:true});
  for(let i=0;i<3;i++){
    event('tool_start',{origin:'mcp',name:'read_file',uploadId:'file-a',label:'正在读取附件：A'});
    event('tool_end',{origin:'mcp',name:'read_file',ok:true});
  }
  assert.equal(rows.length,2);
  assert.ok(rows.every(row=>row.status==='succeeded'));
  assert.equal(rows[1].count,3);
  assert.match(rows[1].label,/A/);
  event('tool_start',{origin:'mcp',name:'read_image',uploadId:'file-b',label:'查看 B'});
  event('done',{status:'failed'});
  assert.equal(rows[2].status,'failed');
  assert.equal(rows[1].status,'succeeded');
  event('tool_start',{origin:'mcp',name:'read_file',uploadId:'file-a',label:'读取 A'});
  event('done',{status:'cancelled'});
  assert.equal(rows[1].status,'cancelled');
});
