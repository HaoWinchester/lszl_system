'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT = path.resolve(ROOT, '..', 'frontend', 'scripts', 'new-legacy-contract.json');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const html = read('landing.html');
const css = read('styles/landing.css');
const script = read('src/landing.js');
const screenshotSources = read('assets/landing/SOURCES.md');
const contract = JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));

assert.match(html, /<html[^>]*lang="zh-CN"[^>]*class="landing-page"/);
assert.match(html, /<title>幻谱｜PMP 知识图谱学习平台<\/title>/);
assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/);
assert.match(html, /<h1[^>]*>[\s\S]*把零散考点[\s\S]*会生长的图谱[\s\S]*<\/h1>/);
assert.match(html, /PMP 难的不是内容多，[\s\S]*知识始终[\s\S]*没有连起来/);
assert.match(html, /构建图谱[\s\S]*做题验证[\s\S]*归纳错因[\s\S]*主动回忆/);

const graphLinks = [...html.matchAll(/href="\/graph"/g)];
assert.ok(graphLinks.length >= 3, '首屏、导航和终态至少各有一个知识图谱入口');
assert.match(html, /href="\/login"[^>]*>登录<\/a>/);
assert.match(html, /href="#why-huanpu"/);
assert.match(html, /href="#learning-loop"/);
assert.match(html, /href="#product-tour"/);
assert.match(html, /href="#faq"/);

const products = [
  ['graph', '知识图谱', 'assets/landing/graph.png'],
  ['practice', '做题模式', 'assets/landing/practice.png'],
  ['workspace', '知识归纳', 'assets/landing/workspace.png'],
  ['recall', '深度回忆', 'assets/landing/recall.png'],
];
for (const [key, label, image] of products) {
  assert.match(html, new RegExp(`data-product-tab="${key}"`));
  assert.match(html, new RegExp(`data-product-panel="${key}"`));
  assert.match(html, new RegExp(`src="${image.replace('.', '\\.') }"[^>]+alt="[^"]+"`));
  assert.match(html, new RegExp(label));
  assert.ok(fs.existsSync(path.join(ROOT, image)), `${image} 必须是站内真实产品截图`);
}

assert.equal([...html.matchAll(/data-faq-trigger/g)].length, 4, '首版必须提供四个 FAQ');
assert.equal([...html.matchAll(/aria-controls="faqAnswer/g)].length, 4, '每个 FAQ 触发器必须关联答案区域');
assert.match(html, /没有整理过知识图谱，可以直接开始吗/);
assert.match(html, /幻谱适合哪个阶段的 PMP 学员/);
assert.match(html, /需要安装软件吗/);
assert.match(html, /我的学习内容会自动保存吗/);

assert.match(html, /styles\/landing\.css/);
assert.match(html, /src\/landing\.js/);
assert.match(css, /\.landing-page/);
const htmlWithoutDataUrls = html.replace(/href="data:[^"]+"/g, 'href=""');
assert.doesNotMatch(htmlWithoutDataUrls, /https?:\/\//, '官网不能依赖外部运行资源');
assert.doesNotMatch(html, /价格|套餐|通过率|1000万|客户评价|合作机构/);
assert.doesNotMatch(script, /localStorage|sessionStorage|indexedDB/);
for (const name of ['graph.png', 'practice.png', 'workspace.png', 'recall.png']) {
  assert.match(screenshotSources, new RegExp(name.replace('.', '\\.')));
}
assert.match(screenshotSources, /1440\s*[×x]\s*(900|1000)/);

assert.ok(contract.requiredPages.includes('landing.html'));
for (const required of [
  'styles/landing.css',
  'src/landing.js',
  'assets/landing/graph.png',
  'assets/landing/practice.png',
  'assets/landing/workspace.png',
  'assets/landing/recall.png',
  'assets/landing/SOURCES.md',
]) {
  assert.ok(contract.requiredFiles.includes(required), `${required} 必须纳入 release contract`);
}

console.log('landing-page-contract-ok');
