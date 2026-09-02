'use strict';

// 契约：seededShuffle 必须确定性（同 seed 同序、不同 seed 不同序、元素集合不变）。
// 该函数被会话恢复使用：随机顺序会话跨刷新/跨设备必须稳定重排。

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/100-practice-mode.js'), 'utf8');

// seededShuffle 在 IIFE 内部，无法直接导出；通过源码契约断言 + 提取执行两种方式验证。
// 1) 源码契约：函数存在且使用确定性 PRNG（禁止 Math.random）。
assert(/function seededShuffle\(items,seed\)/.test(source), 'seededShuffle must exist');
assert(
  !/function seededShuffle[\s\S]{0,800}?Math\.random/.test(source),
  'seededShuffle must not use Math.random',
);

// 2) 行为验证：提取函数体在受控上下文执行。
const fnSource = source.slice(
  source.indexOf('function seededShuffle'),
  source.indexOf('function streakBonus'),
);
const context = {};
vm.createContext(context);
vm.runInContext(`${fnSource}\nthis.seededShuffle = seededShuffle;`, context);
const seededShuffle = context.seededShuffle;

const base = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'];
const first = seededShuffle(base, 'ps_abc');
const again = seededShuffle(base, 'ps_abc');
const different = seededShuffle(base, 'ps_xyz');

assert.deepEqual(first, again, 'same seed must produce identical order');
assert.notDeepEqual(first, different, 'different seeds should differ');
assert.deepEqual(
  [...base].sort(),
  [...first].sort(),
  'shuffling must not add/drop elements',
);
assert.deepEqual(base, ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'], 'input must not be mutated');
assert.deepEqual(seededShuffle([], 'ps_abc'), [], 'empty input stays empty');
assert.deepEqual(seededShuffle(['q1'], 'ps_abc'), ['q1'], 'single item stays put');

console.log('practice-seeded-shuffle-ok');
