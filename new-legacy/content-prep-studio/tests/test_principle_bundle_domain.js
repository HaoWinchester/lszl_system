'use strict';

/*
 * G1 · 原则包双格式兼容、旧库迁移与安全合并（P4.5.29 差异 6–8）
 *
 * 覆盖：
 * 1. pmp-principle-preset-bundle-v1 / kg-principle-card-bundle-v1 双格式识别与归一
 * 2. 无 format 字段时的结构嗅探
 * 3. 未知 format 拒绝（不 best-effort 猜测）
 * 4. 旧原则库 JSON / 旧归纳卡 JSON 单独导入归一为同一 Principle Domain
 * 5. Added / Unchanged / Conflict 安全合并计划（默认不覆盖、不删除）
 * 6. 冲突分类：同 ID 不同名称 / 不同 ID 同规范化名称 / Preset 改绑
 * 7. 显式裁决后才允许覆盖
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
vm.runInContext(source('14-principle-bundle-domain.js'),context,{filename:'14-principle-bundle-domain.js'});

const P=(id,name,extra={})=>({id,name,status:'active',confusablePrincipleIds:[],...extra});
const S=(id,principleId,title,content)=>({id,principleId,title,content,status:'active',version:1});

/* ── 差异 6：双格式识别与归一 ─────────────────────────────── */

// kg-principle-card-bundle-v1（嵌套 items，含 format）
let dom=vm.runInContext(`canonicalPrincipleDomain(${JSON.stringify({
  principleCardBundleVersion:1,format:'kg-principle-card-bundle-v1',
  principles:{schemaVersion:1,items:[P('principle-a','先识别约束')]},
  synthesisPresets:{schemaVersion:1,items:[S('preset-a','principle-a','原则：先识别约束','识别限制，再比较方案。')]},
})})`,context);
assert.equal(dom.kind,'kg-principle-card-bundle-v1');
assert.equal(dom.principles.items.length,1);
assert.equal(dom.synthesisPresets.items[0].principleId,'principle-a');

// pmp-principle-preset-bundle-v1（顶层数组，含 format）
dom=vm.runInContext(`canonicalPrincipleDomain(${JSON.stringify({
  format:'pmp-principle-preset-bundle-v1',
  principles:[P('principle-b','先澄清需求')],
  presets:[S('preset-b','principle-b','原则：先澄清需求','澄清后行动。')],
})})`,context);
assert.equal(dom.kind,'pmp-principle-preset-bundle-v1');
assert.equal(dom.principles.items[0].id,'principle-b');
assert.equal(dom.synthesisPresets.items[0].principleId,'principle-b');

// 无 format：顶层数组结构嗅探为 pmp 包
dom=vm.runInContext(`canonicalPrincipleDomain(${JSON.stringify({
  principles:[P('principle-c','先确认范围')],
  presets:[S('preset-c','principle-c','原则：先确认范围','确认范围。')],
})})`,context);
assert.equal(dom.kind,'pmp-principle-preset-bundle-v1');

// 无 format：嵌套 items 结构嗅探为 kg 包
dom=vm.runInContext(`canonicalPrincipleDomain(${JSON.stringify({
  principles:{schemaVersion:1,items:[P('principle-d','先识别风险')]},
  synthesisPresets:{schemaVersion:1,items:[S('preset-d','principle-d','原则：先识别风险','识别风险。')]},
})})`,context);
assert.equal(dom.kind,'kg-principle-card-bundle-v1');

// 未知 format：明确报错，不猜测
assert.throws(
  ()=>vm.runInContext(`canonicalPrincipleDomain(${JSON.stringify({format:'unknown-principle-bundle-v9',principles:[P('x','x')]})})`,context),
  /不支持的原则与归纳卡文件格式/,
);

/* ── 差异 7：旧原则库 / 旧归纳卡 JSON 单独迁移 ─────────────── */

// 旧原则库 JSON（只有原则 items，无归纳卡）：允许单独导入，不因缺少归纳卡报错
dom=vm.runInContext(`canonicalPrincipleDomain(${JSON.stringify({
  schemaVersion:1,items:[P('principle-old-1','价值交付第一'),P('principle-old-2','风险偏好决定路径')],
})})`,context);
assert.equal(dom.kind,'legacy-principle-library');
assert.equal(dom.principles.items.length,2);
assert.equal(dom.synthesisPresets.items.length,0);

// 旧归纳卡 JSON（items 带 principleId）：单独导入归一
dom=vm.runInContext(`canonicalPrincipleDomain(${JSON.stringify({
  schemaVersion:1,items:[{id:'preset-old-1',principleId:'principle-old-1',title:'原则：价值交付第一',content:'聚焦价值。',status:'active',version:2}],
})})`,context);
assert.equal(dom.kind,'legacy-synthesis-presets');
assert.equal(dom.synthesisPresets.items.length,1);
assert.equal(dom.synthesisPresets.items[0].version,2);
assert.equal(dom.principles.items.length,0);

/* ── 差异 8：安全合并计划（Added / Unchanged / Conflict）──── */

const existing={
  principles:{schemaVersion:1,items:[P('p-keep','保持不变'),P('p-rename','旧名称'),P('p-dup','完全重复')]},
  synthesisPresets:{schemaVersion:1,items:[
    S('s-keep','p-keep','原则：保持不变','保持不变内容'),
    S('s-rename','p-rename','原则：旧名称','旧内容'),
    S('s-dup','p-dup','原则：完全重复','重复内容'),
  ]},
};
const incoming={
  kind:'kg-principle-card-bundle-v1',
  principles:{schemaVersion:1,items:[P('p-keep','保持不变'),P('p-rename','新名称'),P('p-dup2','完全重复'),P('p-new','全新原则')]},
  synthesisPresets:{schemaVersion:1,items:[
    S('s-keep','p-keep','原则：保持不变','保持不变内容'),
    S('s-rename','p-rename','原则：新名称','新内容'),
    S('s-dup','p-other','原则：其他','改绑内容'),  // preset 改绑：同 preset ID 换了 principleId
    S('s-dup2','p-dup2','原则：完全重复','重复内容'),
    S('s-new','p-new','原则：全新原则','全新内容'),
  ]},
};

const plan=JSON.parse(vm.runInContext(`JSON.stringify(planPrincipleMerge(${JSON.stringify(incoming)},${JSON.stringify(existing)}))`,context));

// Unchanged：同 ID 同（规范化）名称
assert.deepEqual(plan.unchanged.map(x=>x.id).sort(),['p-keep']);
// Added：新 ID 且名称不与已有冲突
assert.deepEqual(plan.added.map(x=>x.id).sort(),['p-new']);
// Conflict：同 ID 不同名称 / 不同 ID 同规范化名称 / preset 改绑
const conflictById=Object.fromEntries(plan.conflicts.map(c=>[c.principleId,c]));
assert.ok(conflictById['p-rename'],'同 ID 不同名称必须进冲突');
assert.equal(conflictById['p-rename'].type,'same-id-different-name');
assert.equal(conflictById['p-rename'].existingName,'旧名称');
assert.equal(conflictById['p-rename'].incomingName,'新名称');
assert.ok(conflictById['p-dup2'],'不同 ID 同规范化名称必须进冲突');
assert.equal(conflictById['p-dup2'].type,'same-normalized-name-different-id');
assert.equal(conflictById['p-dup2'].existingId,'p-dup');
const rebind=plan.conflicts.find(c=>c.type==='preset-rebind');
assert.ok(rebind,'preset 改绑必须进冲突');
assert.equal(rebind.presetId,'s-dup');
assert.equal(rebind.existingPrincipleId,'p-dup');
assert.equal(rebind.incomingPrincipleId,'p-other');
// 冲突默认不参与应用
assert.ok(!plan.conflicts.some(c=>c.resolution));

/* ── 差异 8：默认应用不覆盖、不删除 ───────────────────────── */

const appliedDefault=JSON.parse(vm.runInContext(`JSON.stringify(applyPrincipleMergePlan(${JSON.stringify(plan)},${JSON.stringify(existing)}))`,context));
const ids=appliedDefault.principles.items.map(x=>x.id).sort();
assert.deepEqual(ids,['p-dup','p-keep','p-new','p-rename'],'默认：新增 p-new，保留全部已有，不删除');
assert.equal(appliedDefault.principles.items.find(x=>x.id==='p-rename').name,'旧名称','默认：同 ID 不同名称不覆盖');
const presetSdup=appliedDefault.synthesisPresets.items.find(x=>x.id==='s-dup');
assert.equal(presetSdup.principleId,'p-dup','默认：preset 改绑不生效');
assert.ok(appliedDefault.synthesisPresets.items.some(x=>x.id==='s-new'),'新增原则的归纳卡一并合入');

/* ── 差异 8：显式裁决后才覆盖 ─────────────────────────────── */

const resolved={
  ...plan,
  conflicts:plan.conflicts.map(c=>({...c,resolution:c.principleId==='p-rename'?'take-incoming':c.principleId==='p-dup2'?'keep-existing':'keep-existing'})),
};
const applied=JSON.parse(vm.runInContext(`JSON.stringify(applyPrincipleMergePlan(${JSON.stringify(resolved)},${JSON.stringify(existing)}))`,context));
assert.equal(applied.principles.items.find(x=>x.id==='p-rename').name,'新名称','take-incoming：采用导入名称');
const renamePreset=applied.synthesisPresets.items.find(x=>x.id==='s-rename');
assert.equal(renamePreset.title,'原则：新名称','take-incoming：归纳卡随原则同步');
assert.ok(applied.principles.items.some(x=>x.id==='p-dup2')===false,'keep-existing：同名的不同 ID 不合入');
assert.equal(applied.principles.items.length,4,'keep-existing 下总数 = 已有 3 + 新增 1 - 0');

console.log('principle-bundle-domain: passed');
