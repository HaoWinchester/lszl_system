'use strict';

/*
 * 规格书 Test 9 · Global Tag v3 round-trip（P4.5.29 合并规格 §6）
 *
 * 1. names / slotAliases / looseAliases 导出再导入后完全保留
 * 2. 旧数字槽位 usage/stage/0 与 v0.4 语义槽位 usage/stage/basic 都迁移到 global/usage/stage/basic
 * 3. 导出为 schemaVersion 3 + global-semantic-v1，槽位 key 一律 global/... canonical
 * 4. formalTagSlot 仅作为旧主程序读取兼容工具保留，正式导出不再回退数字槽位
 */

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const source=name=>fs.readFileSync(path.join(ROOT,'src/js',name),'utf8');
const stubEl=()=>({textContent:'',innerHTML:'',value:'',classList:{add(){},remove(){},toggle(){},contains:()=>false},addEventListener(){},appendChild(){},remove(){},contains:()=>false,closest:()=>null,dataset:{},style:{}});
const document={getElementById:()=>stubEl(),body:stubEl(),createElement:()=>stubEl(),querySelectorAll:()=>[],querySelector:()=>null,addEventListener:()=>{}};
const window={__KG_DIRECT_BOOTSTRAP__:{},crypto:{randomUUID:()=>'11111111-1111-4111-8111-111111111111'},addEventListener:()=>{}};
const context=vm.createContext({window,document,crypto:window.crypto,Date,JSON,Math,Map,Set,Array,Object,String,Number,console,setTimeout,clearTimeout,setInterval:()=>0,Blob:function(){},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}}});
vm.runInContext(source('00-core-bootstrap.js'),context,{filename:'00-core-bootstrap.js'});
vm.runInContext(source('10-state-domain.js'),context,{filename:'10-state-domain.js'});
vm.runInContext(source('20-page-runtime.js'),context,{filename:'20-page-runtime.js'});

const run=expr=>JSON.parse(vm.runInContext(`JSON.stringify(${expr})`,context));

/* ── 三代 ID 读取兼容：都归一到 global/... ────────────────── */

const cfg=run(`normalizeTagConfig(${JSON.stringify({
  names:{'usage/stage/0':'入门练习','usage/stage/basic':'同名迁移','global/quality/feature/2':'必考题'},
  slotAliases:{'usage/stage/6':['复盘题']},
  looseAliases:{'旧自由别名':'global/usage/stage/basic'},
})})`);
assert.equal(cfg.schemaVersion,3,'导入后 schemaVersion 3');
assert.equal(cfg.slotIdStrategy,'global-semantic-v1','导入后策略 global-semantic-v1');
assert.equal(cfg.names['global/usage/stage/basic'],'同名迁移','数字槽位与语义槽位合并到同一 global canonical（后者覆盖）');
assert.ok(!('usage/stage/0' in cfg.names),'旧数字槽位 key 不保留');
assert.deepEqual(cfg.slotAliases['global/usage/stage/mistake-review'],['复盘题'],'slotAliases 迁移到 global key');
assert.equal(cfg.looseAliases['旧自由别名'],'global/usage/stage/basic','looseAliases 保留');

/* ── 导出：v3 形状 + global canonical + 别名字段不丢 ───────── */

vm.runInContext(`state.tagConfig=${JSON.stringify(cfg)}`,context);
const exported=run(`exportTagConfig()`);
assert.equal(exported.schemaVersion,3,'导出 schemaVersion 3');
assert.equal(exported.slotIdStrategy,'global-semantic-v1','导出策略 global-semantic-v1');
assert.ok(Object.keys(exported.names).every(k=>k.startsWith('global/')),'导出 names key 全部 global/...');
assert.deepEqual(exported.slotAliases['global/usage/stage/mistake-review'],['复盘题'],'导出不丢 slotAliases');
assert.equal(exported.looseAliases['旧自由别名'],'global/usage/stage/basic','导出不丢 looseAliases');
assert.ok(typeof exported.updatedAt==='string','导出带 updatedAt');

/* ── round-trip：导出物再导入，字段完全保留 ───────────────── */

const roundTrip=run(`normalizeTagConfig(${JSON.stringify(exported)})`);
assert.equal(roundTrip.names['global/usage/stage/basic'],exported.names['global/usage/stage/basic'],'names round-trip');
assert.deepEqual(roundTrip.slotAliases['global/usage/stage/mistake-review'],['复盘题'],'slotAliases round-trip');
assert.equal(roundTrip.looseAliases['旧自由别名'],'global/usage/stage/basic','looseAliases round-trip');
assert.equal(roundTrip.schemaVersion,3,'round-trip 后仍 v3');

/* ── formalTagSlot 保留为旧程序读取兼容工具 ───────────────── */

assert.equal(run(`formalTagSlot('global/usage/stage/basic')`),'usage/stage/0','旧数字槽位映射保留（读取兼容）');
assert.ok(!Object.keys(exported.names).includes('usage/stage/0'),'正式导出不再输出数字槽位');

console.log('tag v3 migration round-trip: passed');
