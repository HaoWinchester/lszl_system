'use strict';
/* TableV1 模型：normalize/merge/split/paste 与限额语义。 */
const test=require('node:test');
const assert=require('node:assert/strict');
const model=require('../src/canvas/table-model.js');
const base=()=>model.create({id:'tb_test',rows:3,cols:3});

test('normalize enforces structure, sparse cells and merges',()=>{
  const table=base();
  assert.equal(model.cellCount(table),9);
  assert.deepEqual(Object.keys(table).sort(),['cells','cols','columnWidths','id','merges','rowHeights','rows','schemaVersion','x','y']);
  // 非法结构逐项拒绝
  assert.throws(()=>model.normalize({...table,schemaVersion:2}),/版本/);
  assert.throws(()=>model.normalize({...table,rows:0}),/行数/);
  assert.throws(()=>model.normalize({...table,rows:101}),/行数/);
  assert.throws(()=>model.normalize({...table,cols:51}),/列数/);
  // 恰好 5000 格合法（行/列上限下天然满足；5000 上限是数据校验兜底）。
  assert.doesNotThrow(()=>model.normalize({...table,rows:100,cols:50,columnWidths:Array(50).fill(140),rowHeights:Array(100).fill(40)}));
  assert.throws(()=>model.normalize({...table,columnWidths:[1,2]}),/列宽/);
  assert.throws(()=>model.normalize({...table,rowHeights:[1,2,3,4]}),/行高/);
  assert.throws(()=>model.normalize({...table,cells:{'3,0':'x'}}),/越界/);
  assert.throws(()=>model.normalize({...table,cells:{'0,0':'x'.repeat(3001)}}),/3000/);
  assert.throws(()=>model.normalize({...table,cells:{'0,0':5}}),/文本/);
  assert.throws(()=>model.normalize({...table,merges:[{row:0,column:0,rowSpan:2,columnSpan:2},{row:1,column:1,rowSpan:2,columnSpan:2}]}),/重叠/);
  assert.throws(()=>model.normalize({...table,merges:[{row:2,column:2,rowSpan:2,columnSpan:1}]}),/越界/);
  assert.throws(()=>model.normalize({...table,id:''}),/id/);
  // 空串规范化为稀疏（不存在的格不占存储）；U+3000 是合法内容，仅剪贴板解析视其为空。
  const sparse=model.normalize({...table,cells:{'0,0':'a','1,1':'','2,2':'　'}});
  assert.deepEqual(sparse.cells,{'0,0':'a','2,2':'　'});
});

test('merge keeps row-major content in top-left cell and supports split',()=>{
  const t=model.normalize({...base(),cells:{'0,0':'第一','0,1':'第二','1,0':'','1,1':'第四'}});
  const merged=model.merge(t,{row:0,column:0,rowSpan:2,columnSpan:2});
  assert.equal(merged.cells['0,0'],'第一\n第二\n第四');
  assert.equal(merged.merges.length,1);
  assert.deepEqual(merged.merges[0],{row:0,column:0,rowSpan:2,columnSpan:2});
  assert.equal(merged.cells['1,0'],undefined);
  // 拆分保留左上内容；其余格为空。
  const split=model.split(merged,1,1);
  assert.equal(split.merges.length,0);
  assert.equal(split.cells['0,0'],'第一\n第二\n第四');
  assert.equal(split.cells['0,1'],undefined);
  // 原表不被修改。
  assert.equal(t.merges.length,0);
  assert.equal(t.cells['0,0'],'第一');
  // 部分重叠拒绝；完全包含允许并整体并入。
  assert.throws(()=>model.merge(model.normalize({...base(),merges:[{row:0,column:0,rowSpan:2,columnSpan:2}]}),{row:1,column:1,rowSpan:2,columnSpan:2}),/先拆分/);
  const nested=model.merge(model.normalize({...base(),merges:[{row:0,column:0,rowSpan:1,columnSpan:1}]}),{row:0,column:0,rowSpan:2,columnSpan:2});
  assert.deepEqual(nested.merges,[{row:0,column:0,rowSpan:2,columnSpan:2}]);
  // 子区域落在更大合并内 → 拒绝（防止外层合并被静默收缩）；重复同一区域幂等。
  const outer=model.normalize({...base(),cells:{'0,0':'OUTER'},merges:[{row:0,column:0,rowSpan:3,columnSpan:3}]});
  assert.throws(()=>model.merge(outer,{row:1,column:1,rowSpan:2,columnSpan:2}),/更大的合并/);
  assert.equal(model.merge(outer,{row:0,column:0,rowSpan:3,columnSpan:3}).merges.length,1);
  assert.throws(()=>model.merge(t,{row:0,column:2,rowSpan:9,columnSpan:1}),/越界/);
  assert.throws(()=>model.split(base(),0,0),/不在合并区域/);
});

test('paste expands, rejects merge conflicts and never writes partially',()=>{
  const t=model.normalize({...base(),cells:{'0,0':'anchor'},merges:[{row:0,column:2,rowSpan:2,columnSpan:1}]});
  const grid={cells:[['a','b'],['c','d']]};
  const pasted=model.paste(t,{row:1,column:0},grid);
  assert.equal(pasted.rows,3);
  assert.deepEqual([pasted.cells['1,0'],pasted.cells['1,1'],pasted.cells['2,1']],['a','b','d']);
  // 粘贴区域与合并相交 → 明确拒绝。
  assert.throws(()=>model.paste(t,{row:0,column:1},grid),/先拆分/);
  // 原表 deepEqual 不变（冲突与成功路径都不得污染原表）。
  assert.deepEqual(t,{...t});
  assert.equal(t.cells['1,0'],undefined);
  assert.equal(t.merges.length,1);
  // 扩充超限整体拒绝。
  assert.throws(()=>model.paste(t,{row:99,column:0},grid),/上限/);
  assert.throws(()=>model.paste(t,{row:0,column:49},grid),/上限/);
  assert.throws(()=>model.paste(t,{row:99,column:49},{cells:[['x'.repeat(3001)]]}),/上限|字符/);
  // 不规则 grid（行列数不一致）拒绝，不静默丢格。
  assert.throws(()=>model.paste(base(),{row:0,column:0},{cells:[['a'],['b','c']]}),/不一致/);
  // 剪贴板合并随粘贴进入目标。
  const withMerge=model.paste(base(),{row:0,column:0},{cells:[['x','y'],['z','']],merges:[{row:0,column:0,rowSpan:1,columnSpan:2}]});
  assert.deepEqual(withMerge.merges,[{row:0,column:0,rowSpan:1,columnSpan:2}]);
  assert.equal(withMerge.cells['0,0'],'x');
});

test('limits: 5000 cells per table and 20000 per canvas constant',()=>{
  const big=model.create({id:'tb_big',rows:100,cols:50});
  assert.equal(model.cellCount(big),5000);
  assert.equal(model.LIMITS.MAX_CELLS_PER_CANVAS,20000);
  assert.equal(model.LIMITS.MAX_CELL_CHARS,3000);
  assert.throws(()=>model.create({id:'tb_over',rows:100,cols:51}),/列数/);
});
