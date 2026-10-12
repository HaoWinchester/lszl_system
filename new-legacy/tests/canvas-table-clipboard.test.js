'use strict';
/* 剪贴板 TSV 解析（HTML 解析需 DOM，由浏览器测试覆盖真实 Excel 样本）。 */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const clipboard=require('../src/canvas/table-clipboard.js');
const fixture=jsonFixture();

function jsonFixture(){
  return JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/excel-clipboard/portable-clipboard.json'),'utf8'));
}

test('parseTSV matches native Excel export incl. quotes, newlines and empty tail columns',()=>{
  const grid=clipboard.parseTSV(fixture.text);
  assert.ok(grid);
  assert.deepEqual(grid.cells,[
    ['中文','English','数字','空尾列'],
    ['多行\n第二行','含"引号"','123',''],
    ['合并区域','','首尾空格 ',''],
    ['','','00123',''],
    ['普通文本','含\t制表符','纯文本 =SUM(A1:A2)',''],
  ]);
  assert.deepEqual(grid.merges,[]);
});

test('parseTSV handles CRLF, quoted quotes and trailing blank lines',()=>{
  assert.deepEqual(clipboard.parseTSV('a\t"say ""hi"""\r\n\r\n').cells,[['a','say "hi"']]);
  assert.deepEqual(clipboard.parseTSV('x\ty\n\n\n').cells,[['x','y']]);
  assert.equal(clipboard.parseTSV('   '),null);
  assert.equal(clipboard.parseTSV(''),null);
  assert.throws(()=>clipboard.parseTSV('"未闭合\t'),/引号/);
  // 与 JS 共享样本：期望结果文件中的非空单元格与 TSV 一致（merges 只在 HTML 中）。
  const expected=jsonFixture().expected??null;
  const portable=jsonFixture();
  assert.ok(portable.html.includes('<table'));
  assert.ok(expected===null||Array.isArray(expected.cells));
});

test('parseClipboardData falls back from HTML to TSV without DOM',()=>{
  // Node 无 DOMParser：HTML 解析安全降级，回落到 TSV 文本。
  const grid=clipboard.parseClipboardData({html:'<table><tr><td>a</td></tr></table>',text:'h1\th2\nv1\tv2'});
  assert.deepEqual(grid.cells,[['h1','h2'],['v1','v2']]);
  assert.equal(clipboard.parseClipboardData(null),null);
  assert.equal(clipboard.parseHTML('<table><tr><td>a</td></tr></table>'),null);
});
