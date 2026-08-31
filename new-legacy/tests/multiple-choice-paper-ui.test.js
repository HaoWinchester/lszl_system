'use strict';

const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('paper editor exposes and persists the paper type', () => {
  const page = read('paper-management.html');
  const admin = read('src/65-question-bank-admin.js');
  assert.match(page, /id="paperTypeInput"/);
  assert.match(page, /value="multiple_choice"/);
  assert.match(admin, /paperType:String\(paper\.paperType/);
  assert.match(admin, /paper\.paperType = \$\('paperTypeInput'\)/);
  assert.match(admin, /paper\.questions\|\|\[\]\)\.length>0\|\|Number\(paper\.publishedVersion/);
});

test('candidate loading and parallel composition carry the selected type', () => {
  const loader = read('../frontend/scripts/new-legacy-assets/paper-management-data-loader.js');
  const adapter = read('../frontend/scripts/new-legacy-assets/question-catalog-adapter.js');
  const composition = read('src/teacher/paper-management/paper-composition-controller.js');
  assert.match(loader, /questionType/);
  assert.match(adapter, /question_type/);
  assert.match(composition, /paperType/);
  assert.match(composition, /paperType:state\.paperType/);
  assert.match(read('src/65-question-bank-admin.js'), /wantedType==='multiple_choice'\?row\?\.question\?\.type==='multiple_choice'/);
});
