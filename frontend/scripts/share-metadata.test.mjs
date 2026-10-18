import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('public share cards describe a personal learning tool', () => {
  for (const [page, suffix] of [['landing.html', '/'], ['index.html', '/graph'], ['practice-mode.html', '/practice-mode.html']]) {
    const html = fs.readFileSync(new URL(`../../new-legacy/${page}`, import.meta.url), 'utf8');
    const head = html.split('</head>')[0];
    assert.match(head, /<title>个人学习工具｜知识图谱与主动回忆<\/title>/, page);
    assert.match(head, /property="og:title" content="个人学习工具｜知识图谱与主动回忆"/, page);
    assert.match(head, /property="og:description" content="用知识图谱、笔记与主动回忆，构建自己的知识体系。"/, page);
    assert.ok(head.includes(`property="og:url" content="https://lszl.aihuanpu.com${suffix}"`), page);
    assert.ok(head.includes(`rel="canonical" href="https://lszl.aihuanpu.com${suffix}"`), page);
    assert.doesNotMatch(head, /做题|刷题|项目管理学习者/, page);
  }
  const landing = fs.readFileSync(new URL('../../new-legacy/landing.html', import.meta.url), 'utf8');
  assert.match(landing, /href="\/practice-mode.html">做题模式<\/a>/);
});
