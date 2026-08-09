'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const admin = read('src/65-question-bank-admin.js');
const questionPage = read('question-bank.html');
const paperPage = read('paper-management.html');
const directAdapter = fs.readFileSync(
  path.join(REPO, 'frontend/scripts/new-legacy-assets/direct-question-adapter.js'),
  'utf8',
);
const catalogAdapter = fs.readFileSync(
  path.join(REPO, 'frontend/scripts/new-legacy-assets/question-catalog-adapter.js'),
  'utf8',
);
const syncScript = fs.readFileSync(
  path.join(REPO, 'frontend/scripts/sync-new-legacy.js'),
  'utf8',
);

for (const [name, html, shellClass] of [
  ['question-bank.html', questionPage, 'teacher-admin-shell'],
  ['paper-management.html', paperPage, 'paper-management-page'],
]) {
  assert(html.includes(`class="${shellClass}`) || html.includes(` ${shellClass}`), `${name} must retain its teacher DOM shell`);
  assert(html.includes('styles/focus-vega-teacher.css'), `${name} must retain the Focus/Vega teacher skin`);
  assert(html.includes('data-ui-skin="focus-vega"'), `${name} must retain its current UI skin marker`);
  assert(html.includes('data-question-catalog-mode="managed"'), `${name} must declare managed catalog mode`);
}

assert.match(admin, /const Catalog\s*=\s*window\.KGQuestionCatalogAdapter/);
assert.match(admin, /const CatalogEditor\s*=\s*window\.KGQuestionCatalogEditController/);
assert.match(admin, /async function init\(\)[\s\S]*?await Catalog\.ready[\s\S]*?state\.banks\s*=\s*loadBanks\(\)/);
assert.match(admin, /async function initPaperManagementPage\(\)[\s\S]*?await Catalog\.ready[\s\S]*?state\.banks\s*=\s*loadBanks\(\)/);
assert.match(admin, /function loadBanks\(\)[\s\S]*?Catalog\.snapshot\(\)/);
assert.match(admin, /function loadLegacyBanksForMigrationPreview\(\)[\s\S]*?readString\(banksKey\(\)/);
assert.equal((admin.match(/banksKey\(\)/g) || []).length, 2, 'banksKey may only be declared and read by migration preview');
assert.doesNotMatch(admin, /writeJSON\(banksKey\(|kg_question_banks_published_v1/, 'teacher pages must not write a formal Runtime State catalog');

const saveBanksBody = admin.match(/function saveBanks\([^]*?\n  \}/)?.[0] || '';
assert(saveBanksBody, 'saveBanks compatibility function is missing');
assert.doesNotMatch(saveBanksBody, /writeJSON\(banksKey\(|syncPublishedBanks\(/, 'saveBanks must not write the formal Runtime State catalog');

assert.match(admin, /async function saveBankForm\(\)[\s\S]*?await Catalog\.saveBank\(/);
assert.match(admin, /async function addBank\([^]*?await Catalog\.saveBank\(/);
assert.match(admin, /async function addQuestion\(\)[^]*?await Catalog\.saveQuestion\(/);
assert.match(admin, /async function cloneQuestion\(\)[^]*?await Catalog\.saveQuestion\(/);
assert.match(admin, /async function deleteBankById\([^]*?await Catalog\.deleteBank\(/);
assert.match(admin, /async function saveQuestionForm\([^]*?await CatalogEditor\.save\(/);
assert.match(admin, /async function selectQuestion\([^]*?await CatalogEditor\.open\(/);
assert.match(admin, /beforeunload[^\n]*CatalogEditor\.release/);
assert(admin.includes('questionSnapshots'), 'published paper releases must retain immutable questionSnapshots');

for (const member of ['open', 'save', 'release', 'applyReadonlyState']) {
  assert(directAdapter.includes(`${member}(`), `edit controller missing ${member}()`);
}
assert(directAdapter.includes('heartbeatIntervalSeconds') && directAdapter.includes('30000'), 'edit controller must renew the server lock every 30 seconds');
assert(directAdapter.includes('baseRevision') && directAdapter.includes('lockToken'), 'existing-question saves must include revision and lock token');
assert(catalogAdapter.includes('deleteBank') && catalogAdapter.includes('deleteQuestion'), 'catalog adapter must expose explicit delete operations');

const catalogInjection = syncScript.indexOf('question-catalog-adapter.js');
const directInjection = syncScript.indexOf('direct-question-adapter.js');
const adminMarker = syncScript.indexOf('src/65-question-bank-admin.js');
assert(catalogInjection >= 0 && directInjection >= 0 && adminMarker >= 0, 'teacher adapter injection markers are missing');
assert(syncScript.includes('kg-question-editor:generated'), 'teacher edit controller must be injected before the admin initializer');

console.log('content-prep-question-bank-integration-ok');
