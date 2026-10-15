'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

test('danmaku actions render real public sprite icons without fallback warnings', () => {
  const warnings = [];
  const window = { location: {hostname:'localhost', protocol:'http:'}, console:{warn: value => warnings.push(value)} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/107-learning-ui-icons.js'), 'utf8'), {window});
  const sprite = fs.readFileSync(path.join(root, 'assets/icons/lucide-learning.svg'), 'utf8');
  for (const name of ['heart', 'message-circle', 'eye-off', 'ellipsis', 'pause', 'x']) {
    const markup = window.KGLearningIcons.render(name);
    assert.ok(markup.includes('#' + name + '"'), name + ' must resolve to its own glyph');
    assert.match(sprite, new RegExp('<symbol id="' + name + '"[^>]*>.+?</symbol>'));
    assert.match(markup, /fill="none" stroke="currentColor"/);
  }
  assert.deepEqual(warnings, []);
});
