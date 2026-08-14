'use strict';

/*
 * G4 · 三档难度与 Global Tag 语义 ID（P4.5.29 差异 21、26）
 *
 * 难度：
 * 1. 正式难度统一 简单/中等/困难；旧"基础"只在导入迁移时兼容为"简单"
 * 2. easy/medium/hard、L1–L4 误写为普通 difficulty 时自动归一（L4 不代表存在第四档难度）
 * 3. Family difficultyLevel 始终 1–4，不写回普通 difficulty
 * Global Tag：
 * 4. 槽位 ID 统一 global/...（数字槽位与 usage/... 语义槽位只在导入层迁移）
 * 5. 保存后单一真源（global/...）；导出兼容旧数字槽位往返
 */

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ROOT=path.resolve(__dirname,'..');
const source=name=>fs.readFileSync(path.join(ROOT,'src/js',name),'utf8');
const document={getElementById:()=>null,body:{},createElement:()=>({})};
const window={__KG_DIRECT_BOOTSTRAP__:{},crypto:{randomUUID:()=>'11111111-1111-4111-8111-111111111111'},addEventListener:()=>{}};
const context=vm.createContext({window,document,crypto:window.crypto,Date,JSON,Math,Map,Set,Array,Object,String,Number,console,setTimeout,clearTimeout,setInterval:()=>0,Blob:function(){},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}}});
vm.runInContext(source('00-core-bootstrap.js'),context,{filename:'00-core-bootstrap.js'});
vm.runInContext(source('10-state-domain.js'),context,{filename:'10-state-domain.js'});
vm.runInContext(source('12-p45-authoring-domain.js'),context,{filename:'12-p45-authoring-domain.js'});

const run=expr=>JSON.parse(vm.runInContext(`JSON.stringify(${expr})`,context));

/* ── 难度（差异 21）──────────────────────────────────────── */

// 旧"基础"迁移为"简单"
assert.equal(run(`normalizeQuestionDifficulty('基础')`),'简单');
assert.equal(run(`normalizeQuestionDifficulty('easy')`),'简单');
assert.equal(run(`normalizeQuestionDifficulty('  简单 ')`),'简单');
assert.equal(run(`normalizeQuestionDifficulty('中等')`),'中等');
assert.equal(run(`normalizeQuestionDifficulty('hard')`),'困难');
// L1–L4 误写为普通 difficulty：归一到三档（L4 不代表第四档难度）
assert.equal(run(`normalizeQuestionDifficulty('L1')`),'简单');
assert.equal(run(`normalizeQuestionDifficulty('L2')`),'中等');
assert.equal(run(`normalizeQuestionDifficulty('L3')`),'困难');
assert.equal(run(`normalizeQuestionDifficulty('L4')`),'困难');
assert.equal(run(`normalizeQuestionDifficulty('')`),'中等','缺省中等');

// normalizeQuestion 归一难度；Family difficultyLevel 独立保留
const nq=run(`normalizeQuestion({difficulty:'基础',metadata:{questionFamily:{role:'root',familyKey:'F-1',difficultyLevel:4}}},0,'PMP')`);
assert.equal(nq.difficulty,'简单','旧"基础"在导入时迁移为"简单"');
assert.equal(nq.metadata.questionFamily.difficultyLevel,4,'Family 诊断层级独立保留');

/* ── Global Tag（差异 26）────────────────────────────────── */

// 数字槽位 / usage 语义槽位 / global 槽位全部归一到 global/...
assert.equal(run(`semanticTagSlot('usage/stage/0')`),'global/usage/stage/basic');
assert.equal(run(`semanticTagSlot('usage/stage/basic')`),'global/usage/stage/basic');
assert.equal(run(`semanticTagSlot('global/usage/stage/basic')`),'global/usage/stage/basic','已是 global 的直通');
assert.equal(run(`semanticTagSlot('quality/feature/2')`),'global/quality/feature/core');
assert.equal(run(`semanticTagSlot('source/scope/1')`),'global/source/scope/internal');

// 保存后单一真源：normalizeTagConfig 的 names/slotAliases key 全部 global/...
const cfg=run(`normalizeTagConfig({names:{'usage/stage/0':'入门练习','global/quality/feature/2':'必考题'},slotAliases:{'usage/stage/6':['复盘题']}})`);
assert.equal(cfg.slotIdStrategy,'global-semantic-v1');
assert.equal(cfg.schemaVersion,3);
assert.deepEqual(Object.keys(cfg.names).sort(),['global/quality/feature/core','global/usage/stage/basic'].sort(),JSON.stringify(cfg.names));
assert.deepEqual(Object.keys(cfg.slotAliases),['global/usage/stage/mistake-review']);

// 导出兼容旧数字槽位（往返）
assert.equal(run(`formalTagSlot('global/usage/stage/basic')`),'usage/stage/0','正式导出映射回旧数字槽位供主程序消费');
assert.equal(run(`formalTagSlot('global/quality/feature/core')`),'quality/feature/2');

// 槽位目录：内部 slot 一律 global/...，legacySlot 保留供兼容
const entries=run(`tagCatalogEntries()`);
assert.ok(entries.every(x=>x.slot.startsWith('global/')),'目录 slot 全部 global/...');
assert.ok(entries.every(x=>/^\w+\/\w+\/\d+$/.test(x.legacySlot)),'legacySlot 保留数字槽位');

console.log('p45-difficulty-tags: passed');
