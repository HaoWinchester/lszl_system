import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(scriptsDir, '..', '..')
const sourcePath = resolve(root, 'new-legacy/src/teacher/question-bank/question-family-compatibility-core.js')

function question(id, family) {
  return {
    id,
    difficulty: family?.difficultyLevel === 4 ? '专家' : '中等',
    metadata: { questionFamily: family },
  }
}

function loadCore() {
  const context = vm.createContext({ console })
  context.globalThis = context
  vm.runInContext(readFileSync(sourcePath, 'utf8'), context, { filename: sourcePath })
  return context.KGQuestionFamilyCompatibilityCore
}

test('question family compatibility core derives a same-bank, diagnosis-ready family from database-backed metadata', () => {
  const core = loadCore()
  const rootQuestion = question('q-root', {
    familyId: 'scope-family', role: 'root', rootQuestionId: 'q-root', difficultyLevel: 2,
  })
  const member = (id, patch) => question(id, {
    familyId: 'scope-family', role: 'member', rootQuestionId: 'q-root',
    relationToRoot: 'equivalent', equivalenceGrade: 'A', diagnosticTarget: 'general',
    difficultyLevel: 2, purposes: ['practice'], qualityConfirmed: true, ...patch,
  })
  const bank = { id: 'db-bank-1', questions: [
    rootQuestion,
    member('q-equivalent-1'),
    member('q-equivalent-2'),
    member('q-concept', { diagnosticTarget: 'concept', relationToRoot: 'decomposed', equivalenceGrade: 'B' }),
    member('q-understanding', { diagnosticTarget: 'understanding', relationToRoot: 'extension', equivalenceGrade: 'B' }),
    member('q-verification', {
      diagnosticTarget: 'application', relationToRoot: 'extension', equivalenceGrade: 'B', difficultyLevel: 2,
      purposes: ['post-remediation-verification'],
    }),
  ] }

  const report = core.validateBank(bank)
  const diagnosis = core.diagnosisQuery(bank, 'q-root')
  assert.equal(report.ok, true)
  assert.equal(diagnosis.coverage.coverage, 5)
  assert.equal(diagnosis.coverage.ready, true)
  assert.equal(diagnosis.strongEquivalent.length, 2)
  assert.equal(diagnosis.verification[0].id, 'q-verification')
})

test('question family core refuses cross-bank resolution and reports duplicate roots', () => {
  const core = loadCore()
  const elsewhere = question('q-root', { familyId: 'family-a', role: 'root', rootQuestionId: 'q-root' })
  const foreignMember = question('q-member', {
    familyId: 'family-a', role: 'member', rootQuestionId: 'q-root', relationToRoot: 'equivalent',
  })
  const unresolved = core.validateBank({ id: 'db-bank-2', questions: [foreignMember] })
  assert.equal(core.rootFor({ id: 'db-bank-2', questions: [foreignMember] }, 'q-member'), null)
  assert.ok(unresolved.errors.some(issue => issue.code === 'family_root_unresolved'))

  const duplicate = core.validateBank({ id: 'db-bank-3', questions: [
    elsewhere,
    question('q-other-root', { familyId: 'family-a', role: 'root', rootQuestionId: 'q-other-root' }),
  ] })
  assert.ok(duplicate.errors.some(issue => issue.code === 'duplicate_family_id_root'))
})

test('question-bank page loads the read-only compatibility core without browser persistence', () => {
  const core = readFileSync(sourcePath, 'utf8')
  const page = readFileSync(resolve(root, 'new-legacy/question-bank.html'), 'utf8')
  assert.match(page, /question-family-compatibility-core\.js/)
  assert.match(core, /metadataPath:'metadata\.questionFamily'/)
  assert.match(core, /scope:'single-question-bank'/)
  assert.doesNotMatch(core, /localStorage|sessionStorage|indexedDB/)
})
