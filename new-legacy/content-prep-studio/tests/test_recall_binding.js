const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const runtimePath = path.resolve(__dirname, '../src/js/20-page-runtime.js');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');

function functionSource(name) {
  const marker = `function ${name}(`;
  const start = runtimeSource.indexOf(marker);
  assert.notEqual(start, -1, `runtime must define ${name}`);
  const next = runtimeSource.indexOf('\nfunction ', start + marker.length);
  return runtimeSource.slice(start, next === -1 ? runtimeSource.length : next);
}

function loadFunctions(names, globals = {}) {
  const context = vm.createContext({...globals});
  const source = names.map(functionSource).join('\n');
  vm.runInContext(`${source}\nthis.loaded = {${names.join(',')}};`, context, {filename: runtimePath});
  return context.loaded;
}

function countOccurrences(text, term) {
  let count = 0;
  let offset = 0;
  while (term && (offset = String(text || '').indexOf(term, offset)) !== -1) {
    count += 1;
    offset += term.length;
  }
  return count;
}

const recallNodes = [
  {
    id: 'recall:load',
    title: '工作负荷与团队支持',
    titleEn: 'Workload support',
    aliases: ['不堪重负'],
    priority: 8,
  },
  {
    id: 'recall:team',
    title: '团队协作',
    titleEn: 'Team collaboration',
    aliases: ['合作'],
    priority: 3,
  },
];

test('Recall search matches Chinese, English, Alias, stable ID, and subsequences', () => {
  const {recallSearchNodes} = loadFunctions(
    ['normalizeRecallSearchText', 'fuzzySubsequenceMatch', 'recallSearchNodes'],
    {state: {recallLibrary: {nodes: recallNodes}}},
  );

  assert.equal(recallSearchNodes('工作负荷')[0].n.id, 'recall:load');
  assert.equal(recallSearchNodes('workload')[0].n.id, 'recall:load');
  assert.equal(recallSearchNodes('不堪重负')[0].n.id, 'recall:load');
  assert.equal(recallSearchNodes('recall:load')[0].n.id, 'recall:load');
  assert.equal(recallSearchNodes('wrldspprt')[0].n.id, 'recall:load');
  assert.equal(recallSearchNodes('不存在的入口').length, 0);
});

test('Keyword locations stay isolated to their recorded stem or option source', () => {
  const {recomputeKeywordLocations} = loadFunctions(['recomputeKeywordLocations'], {
    questionStem: question => question.stem,
    countOccurrences,
  });
  const question = {
    stem: '团队需要支持，团队不能不堪重负。',
    options: [
      {id: 'A', text: '团队调整工作负荷。'},
      {id: 'B', text: '团队继续协作。'},
    ],
    clues: [
      {id: 'stem-team', text: '团队', sourceType: 'stem', sourceOptionId: ''},
      {id: 'option-team', text: '团队', sourceType: 'option', sourceOptionId: 'B'},
    ],
  };

  recomputeKeywordLocations(question);

  assert.deepEqual(JSON.parse(JSON.stringify(question.clues[0].matchLocations)), [
    {field: 'stem', optionId: '', count: 2},
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(question.clues[1].matchLocations)), [
    {field: 'option', optionId: 'B', count: 1},
  ]);
  assert.equal(question.clues[0].sourceType, 'stem');
  assert.equal(question.clues[1].sourceOptionId, 'B');
});

function validateRecallId(recallNodeId) {
  const {validateKeyword} = loadFunctions(['validateKeyword'], {
    keywordLooksLikeWord: () => ({ok: true, msg: ''}),
    recallIndex: () => ({byId: new Map(recallNodes.map(node => [node.id, node]))}),
    suggestionText: () => '',
  });
  return validateKeyword({}, {
    text: '团队',
    matchLocations: [{field: 'stem', optionId: '', count: 1}],
    recallNodeId,
    keywordLevel: 'normal',
  });
}

test('Blank Recall ID is valid because the binding is optional', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(validateRecallId(''))), []);
});

test('A non-empty missing Recall ID is a validation error', () => {
  const issues = validateRecallId('recall:missing');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].level, 'error');
  assert.match(issues[0].message, /recall:missing/);
});
