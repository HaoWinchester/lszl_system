'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('../src/graph/graph-model.js');
const detail=require('../src/graph/node-detail-view.js');
test('shared detail renders complete content and escapes user text',()=>{
  const html=detail.render({title:'<标题>',category:'分类',level:'重点',keywords:'词一,词二',summary:'<script>说明</script>',notes:'学习提示'}, {relationMarkup:'<div>2 个相关知识点</div>'});
  for(const text of ['&lt;标题&gt;','分类','重点','词一,词二','&lt;script&gt;说明&lt;/script&gt;','学习提示','2 个相关知识点'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('<script>'));
});
test('shared detail accepts normalized nested content and empty values',()=>{
  const html=detail.render({content:{title:'nested',description:'说明',notes:'提示'}});
  assert.ok(html.includes('nested')&&html.includes('说明')&&html.includes('提示'));
  assert.ok(html.includes('未填写分类'));
});
