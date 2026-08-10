# Paper Principle Quota and Single-Deep Retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a teacher supplement a paper with exactly one of two quota strategies—domain quota or principle quota—while preserving manual choices, and retire single-question deep study from all active workflows without destroying historical records.

**Architecture:** Extract deterministic quota supplementation into a pure service used by paper management. Persist the chosen strategy plus both independently editable quota maps in the shared paper draft, and execute only the chosen map. Centralize active learning-mode policy at three modes, retain legacy IDs only in compatibility readers, and replace the old single-deep page with a parameter-preserving redirect to practice.

**Tech Stack:** Native JavaScript, existing `new-legacy` HTML/CSS, Node VM/contract tests, Playwright, shared runtime persistence from plan 1.

## Global Constraints

- Complete plan 1 before this plan so paper drafts and principles are shared for all administrators/teachers.
- An individual supplementation action uses either `domain` or `principle`, never both.
- Domain and principle quota maps are both saved on the draft; switching the active strategy does not erase the inactive configuration.
- Existing manually selected questions remain in the paper and count toward the active quota.
- Supplementation never duplicates a question already in the paper or selected earlier in the same operation.
- When a candidate matches multiple principles, it fills exactly one outstanding principle quota, chosen deterministically.
- Shortages are reported per quota bucket; existing selections are never removed to manufacture balance.
- “单题深学” is removed from active UI, new tasks, navigation, documentation, and mode selectors.
- Historical records with `single_deep_study` remain readable; compatibility code maps attempts to a retired-mode label and practice fallback.
- `question-training.html` remains only as a compatibility redirect, preventing broken bookmarks.
- Do not change protected canvas DOM descendants covered by the approved Focus / Vega UI exception.
- Modify `new-legacy/` source and release scripts, never `legacy/` or the active release directly.
- This is plan 3 of 4.

---

## File Structure

### Paper quota implementation

- Create `new-legacy/src/teacher/paper-management/paper-quota-service.js`: pure normalization, deficit calculation, deterministic assignment, and supplementation.
- Modify `new-legacy/paper-management.html`: mutually exclusive strategy control and principle quota editor.
- Modify `new-legacy/src/65-question-bank-admin.js`: integrate the pure service and persist the strategy-specific draft shape.
- Modify `frontend/scripts/sync-new-legacy.js`: inject the quota service before paper management code.

### Learning-mode retirement

- Modify `new-legacy/src/59a-paper-learning-modes.js`: three active modes plus historical compatibility lookup.
- Modify `new-legacy/src/77-multi-question-workspace.js`: remove the active single-deep entry/action.
- Modify `new-legacy/src/100-practice-mode.js`: show retired-mode fallback notice and preserve source parameters.
- Modify `new-legacy/src/91-course-admin-app.js`, `93-assessment-config-app.js`, and `93-content-organization-core.js`: forbid new tasks with the retired mode while rendering historical tasks.
- Modify `new-legacy/question-training.html`: compatibility redirect shell only.
- Modify `new-legacy/question-workspace.html`, `course-admin.html`, `src/102-help-content.js`, and `src/admin/module-help-content.js`: remove active controls/copy.

### Tests

- Create `new-legacy/tests/paper-quota-service.test.js`.
- Modify `new-legacy/tests/v90-p43-paper-management-integration.test.js`.
- Create `new-legacy/tests/single-deep-retirement.test.js`.
- Modify `new-legacy/tests/v90-p4325-paper-mode-policy.test.js`, `v862-p1-course-workflow.test.js`, and affected published-paper tests that assert four active modes.
- Create `frontend/e2e/paper_quota_and_retirement.py`.

---

### Task 1: Extract deterministic quota supplementation

**Files:**
- Create: `new-legacy/src/teacher/paper-management/paper-quota-service.js`
- Create: `new-legacy/tests/paper-quota-service.test.js`

**Interfaces:**
- Global: `KGPaperQuotaService`.
- `normalizeConfig(input) -> { mode, domainQuotas, principleQuotas }`.
- `supplement({paperQuestionIds, candidates, mode, quotas, random}) -> {addedQuestionIds, assignments, shortages}`.
- Candidate shape: `{id, domainId, principleIds, eligible, archived}`.
- Quotas are non-negative integers keyed by stable domain/principle ID.

- [ ] **Step 1: Write failing pure-service tests**

Cover manual preservation, no duplicates, exact quota fill, ineligible filtering, insufficient supply, multi-principle candidates, deterministic order, and idempotent rerun.

```javascript
const result = service.supplement({
  paperQuestionIds: ['q-manual'],
  candidates: [
    {id: 'q-manual', domainId: 'd1', principleIds: ['p1'], eligible: true},
    {id: 'q2', domainId: 'd1', principleIds: ['p1', 'p2'], eligible: true},
    {id: 'q3', domainId: 'd2', principleIds: ['p2'], eligible: true}
  ],
  mode: 'principle',
  quotas: {p1: 1, p2: 1},
  random: () => 0.5
})
assert.deepEqual(result.addedQuestionIds, ['q2'])
assert.deepEqual(result.assignments, {p1: ['q-manual'], p2: ['q2']})
```

- [ ] **Step 2: Run and confirm the service is missing**

Run: `node --test new-legacy/tests/paper-quota-service.test.js`

Expected: FAIL because the asset/global does not exist.

- [ ] **Step 3: Implement normalization and deficit calculation**

Reject unknown modes and fractional/negative quotas. For domain mode, count each existing question only under its normalized `domainId`. For principle mode, assign each existing paper question to one quota bucket in configured-key order, preferring a bucket with positive remaining demand. Keep an `unassignedExistingIds` list for questions that match no configured bucket.

- [ ] **Step 4: Implement deterministic candidate assignment**

Filter archived/ineligible/current IDs, sort candidates by stable ID before Fisher–Yates using the injected `random`, then repeatedly choose the candidate/bucket pair with the greatest remaining deficit. Resolve ties by quota key order, then candidate order. A candidate is consumed after one assignment even if it has multiple principle IDs.

- [ ] **Step 5: Return explicit shortage data**

Return one row per nonzero deficit:

```javascript
{
  bucketId: 'p2',
  requested: 3,
  existing: 1,
  added: 1,
  missing: 1
}
```

- [ ] **Step 6: Run the pure tests**

Run: `node --test new-legacy/tests/paper-quota-service.test.js`

Expected: PASS.

- [ ] **Step 7: Commit the pure service**

```bash
git add new-legacy/src/teacher/paper-management/paper-quota-service.js new-legacy/tests/paper-quota-service.test.js
git commit -m "feat: add deterministic paper quota service"
```

### Task 2: Add the mutually exclusive paper strategy UI

**Files:**
- Modify: `new-legacy/paper-management.html:90-132`
- Modify: `new-legacy/src/65-question-bank-admin.js:630-705,2770-2935`
- Modify: `frontend/scripts/sync-new-legacy.js:630-690`
- Modify: `new-legacy/tests/v90-p43-paper-management-integration.test.js`

**Interfaces:**
- Draft fields:

```javascript
{
  supplementMode: 'domain',
  domainQuotas: {domainId: 10},
  principleQuotas: {principleId: 6},
  manualQuestionIds: ['q1'],
  questionIds: ['q1', 'q2']
}
```

- Changing mode preserves and saves the inactive quota map; no supplement operation combines both maps.

- [ ] **Step 1: Write failing DOM and persistence contracts**

Assert two strategy options with values `domain` and `principle`, one checked at a time, distinct quota containers, and quota-service injection before `65-question-bank-admin.js`. Assert normalization defaults old drafts to `domain` without changing their existing domain quotas.

- [ ] **Step 2: Run and verify current domain-only UI fails**

Run: `node --test new-legacy/tests/v90-p43-paper-management-integration.test.js`

Expected: FAIL because principle mode and the quota-service script are absent.

- [ ] **Step 3: Rebuild the quota section with existing visual classes**

Reuse the current form, card, input, and segmented-control classes. Add accessible radio inputs labelled “按领域配额” and “按原则配额”. Render principle rows from the shared principle repository; show active principles only, stable ID in data attributes, name in visible copy, and a numeric input with `min="0"` and `step="1"`.

- [ ] **Step 4: Extend paper normalization**

`normalizePaper` must migrate old `domainTargets`/domain quota fields into `domainQuotas`, derive `manualQuestionIds` from preexisting selected questions when the field is absent, discard dangling duplicate IDs, and default absent `principleQuotas` to an empty object.

- [ ] **Step 5: Integrate supplementation**

Replace inline domain-fill logic with `KGPaperQuotaService.supplement`. Pass all eligible shared-pool questions, active mode, active quotas, and `Math.random`. Merge additions after the preserved manual/existing order. Surface each shortage in the existing validation panel and keep Save enabled so a partial supplement can be reviewed.

- [ ] **Step 6: Persist both quota maps and one active strategy**

On save:

```javascript
paper.supplementMode = selectedMode
paper.domainQuotas = readDomainQuotas()
paper.principleQuotas = readPrincipleQuotas()
```

Retain creator/updater fields and shared revision semantics from plan 1.

- [ ] **Step 7: Run integration contracts**

Run: `node --test new-legacy/tests/paper-quota-service.test.js new-legacy/tests/v90-p43-paper-management-integration.test.js`

Expected: PASS.

- [ ] **Step 8: Commit paper UI integration**

```bash
git add new-legacy/paper-management.html new-legacy/src/65-question-bank-admin.js frontend/scripts/sync-new-legacy.js new-legacy/tests/v90-p43-paper-management-integration.test.js
git commit -m "feat: choose domain or principle paper quotas"
```

### Task 3: Centralize the three active learning modes

**Files:**
- Modify: `new-legacy/src/59a-paper-learning-modes.js`
- Create: `new-legacy/tests/single-deep-retirement.test.js`
- Modify: `new-legacy/tests/v90-p4325-paper-mode-policy.test.js`
- Modify: `new-legacy/tests/v90-p403-published-paper-learning-pages.test.js`

**Interfaces:**
- Active IDs: `practice_mode`, `deep_recall`, `multi_question_canvas`.
- Active labels: `刷题`, `深度回忆`, `归纳`.
- Historical-only IDs include canonical `single_deep_study` and aliases `single_deep`/`single-deep`.
- Global API separates `listActive()` from `resolveHistorical(id)`; callers cannot get the retired mode from `listActive()`.

- [ ] **Step 1: Write the failing retirement contract**

```javascript
assert.deepEqual(
  modes.listActive().map(item => item.id),
  ['practice_mode', 'deep_recall', 'multi_question_canvas']
)
assert.equal(modes.resolveHistorical('single_deep_study').retired, true)
assert.equal(modes.resolveHistorical('single_deep_study').fallbackId, 'practice_mode')
```

Scan served HTML/JS entry definitions and assert no active selector or task-creation option carries `single_deep_study`.

- [ ] **Step 2: Run and confirm four-mode policy fails**

Run: `node --test new-legacy/tests/single-deep-retirement.test.js`

Expected: FAIL because single-deep is still active.

- [ ] **Step 3: Split active and historical registries**

Export frozen `ACTIVE_MODES` with the three confirmed modes and frozen `HISTORICAL_MODE_ALIASES`. `normalizeForLaunch` returns the practice fallback for a retired identifier plus `{retiredFrom: originalId}`. `resolveHistorical` retains the Chinese historical label “单题深学（已停用）” for reports.

- [ ] **Step 4: Update tests to assert deliberate compatibility**

Replace obsolete “four active modes” assertions with separate active-count and historical-read assertions. Do not delete fixtures solely because they contain the historical ID.

- [ ] **Step 5: Run mode contracts**

Run: `node --test new-legacy/tests/single-deep-retirement.test.js new-legacy/tests/v90-p4325-paper-mode-policy.test.js new-legacy/tests/v90-p403-published-paper-learning-pages.test.js`

Expected: PASS.

- [ ] **Step 6: Commit mode policy**

```bash
git add new-legacy/src/59a-paper-learning-modes.js new-legacy/tests/single-deep-retirement.test.js new-legacy/tests/v90-p4325-paper-mode-policy.test.js new-legacy/tests/v90-p403-published-paper-learning-pages.test.js
git commit -m "feat: retire single deep from active learning modes"
```

### Task 4: Remove active single-deep entry points and task creation

**Files:**
- Modify: `new-legacy/paper-management.html`
- Modify: `new-legacy/question-workspace.html`
- Modify: `new-legacy/course-admin.html`
- Modify: `new-legacy/src/77-multi-question-workspace.js`
- Modify: `new-legacy/src/91-course-admin-app.js`
- Modify: `new-legacy/src/93-assessment-config-app.js`
- Modify: `new-legacy/src/93-content-organization-core.js`
- Modify: `new-legacy/src/102-help-content.js`
- Modify: `new-legacy/src/admin/module-help-content.js`
- Modify: `new-legacy/tests/single-deep-retirement.test.js`

- [ ] **Step 1: Expand the failing source/DOM scan**

Enumerate every source file loaded by paper management, question workspace, recall, teacher workbench, and course admin. Fail when `single_deep_study` appears in a button, option, route builder, new-task payload, launch map, or active help copy. Allow it only inside the centralized historical registry, migration/read serializers, tests, and redirect compatibility shell.

- [ ] **Step 2: Run the scan and capture every active reference**

Run: `node --test new-legacy/tests/single-deep-retirement.test.js`

Expected: FAIL with the exact active reference list.

- [ ] **Step 3: Remove controls and launch branches**

Remove the paper learning-mode option, workspace action, recall link, teacher navigation, and help instructions for single deep. Keep DOM structure/class names of neighboring controls unchanged so layout does not drift.

- [ ] **Step 4: Reject new retired-mode tasks at both UI and service boundary**

Remove the retired option from course task forms. In the task/release normalizer, reject creation/update payloads with `single_deep_study` using the visible error “单题深学已停用，请选择刷题、深度回忆或归纳”. Historical task reads remain allowed and expose `retired: true` plus practice fallback.

- [ ] **Step 5: Update course/paper tests**

Assert new-task rejection, historical task rendering, three-option selectors, and no launch URL targeting `question-training.html` except compatibility tests.

- [ ] **Step 6: Run retirement and affected feature contracts**

Run: `node --test new-legacy/tests/single-deep-retirement.test.js new-legacy/tests/v862-p1-course-workflow.test.js new-legacy/tests/v90-p4325-paper-mode-policy.test.js new-legacy/tests/v90-p403-published-paper-learning-pages.test.js new-legacy/tests/v862-p2211-multi-question-nav-help-minimap.test.js`

Expected: PASS.

- [ ] **Step 7: Commit active entry removal**

```bash
git add new-legacy/paper-management.html new-legacy/question-workspace.html new-legacy/course-admin.html new-legacy/src/77-multi-question-workspace.js new-legacy/src/91-course-admin-app.js new-legacy/src/93-assessment-config-app.js new-legacy/src/93-content-organization-core.js new-legacy/src/102-help-content.js new-legacy/src/admin/module-help-content.js new-legacy/tests/single-deep-retirement.test.js new-legacy/tests/v862-p1-course-workflow.test.js new-legacy/tests/v90-p4325-paper-mode-policy.test.js new-legacy/tests/v90-p403-published-paper-learning-pages.test.js new-legacy/tests/v862-p2211-multi-question-nav-help-minimap.test.js
git commit -m "feat: remove active single deep workflows"
```

### Task 5: Turn the legacy single-deep page into a safe redirect

**Files:**
- Modify: `new-legacy/question-training.html`
- Modify: `new-legacy/src/100-practice-mode.js`
- Modify: `new-legacy/practice-mode.html`
- Modify: `new-legacy/tests/single-deep-retirement.test.js`

**Interfaces:**
- Redirect target: `practice-mode.html`.
- Preserve allow-listed parameters: `paperId`, `releaseId`, `questionId`, `bankId`, `courseId`, `taskId`, `subject`, `returnTo`.
- Add `retiredMode=single_deep_study`; discard unknown parameters and URL fragments.

- [ ] **Step 1: Add failing redirect tests**

Assert HTML uses `location.replace`, encodes all preserved values through `URLSearchParams`, refuses an external `returnTo`, and does not load the retired application scripts. Assert practice recognizes `retiredMode` and shows one nonblocking notice.

- [ ] **Step 2: Run and confirm the old page still boots**

Run: `node --test new-legacy/tests/single-deep-retirement.test.js`

Expected: FAIL.

- [ ] **Step 3: Replace the page with a minimal accessible redirect shell**

Keep the project favicon/title and a visible “正在转到刷题…” fallback link. Build the target using the current origin and fixed relative filename. Normalize `returnTo` to a same-origin relative pathname or omit it.

- [ ] **Step 4: Add the practice fallback notice**

Practice mode displays “单题深学已停用，已为你切换到刷题” once per navigation. If a valid `questionId` is present and belongs to the selected paper/shared pool, focus it; otherwise start at the first eligible question.

- [ ] **Step 5: Run redirect/retirement tests**

Run: `node --test new-legacy/tests/single-deep-retirement.test.js`

Expected: PASS.

- [ ] **Step 6: Commit compatibility redirect**

```bash
git add new-legacy/question-training.html new-legacy/practice-mode.html new-legacy/src/100-practice-mode.js new-legacy/tests/single-deep-retirement.test.js
git commit -m "feat: redirect retired single deep links to practice"
```

### Task 6: Verify quota behavior and retirement in the browser

**Files:**
- Create: `frontend/e2e/paper_quota_and_retirement.py`
- Modify: `frontend/scripts/new-legacy-release.test.mjs`

- [ ] **Step 1: Write the browser flow before final generation**

The script must:

- Log in as a teacher and open paper management.
- Add two manual questions, select domain mode, supplement, and verify manual IDs/order are preserved with no duplicates.
- Switch to principle mode on a second paper, request two principles including a shortage, and verify each added question is counted once.
- Reload and log in as another teacher; verify the shared paper and active strategy are identical.
- Assert paper, workspace, recall, and course task screens expose only the three active modes.
- Navigate directly to an old `question-training.html` bookmark and verify practice fallback plus notice.
- Open a historical course/task record with the retired ID and verify read-only rendering succeeds.

- [ ] **Step 2: Generate a candidate release without promoting it**

Run the repository-supported sync/build test path first. Before any release promotion, compare candidate and active site file counts and assert `admin-console.html`, `paper-management.html`, `course-admin.html`, `practice-mode.html`, and `question-training.html` exist.

- [ ] **Step 3: Run all plan-3 tests**

Run: `node --test new-legacy/tests/paper-quota-service.test.js new-legacy/tests/v90-p43-paper-management-integration.test.js new-legacy/tests/single-deep-retirement.test.js`

Run: `node --test frontend/scripts/new-legacy-release.test.mjs frontend/scripts/online-qa-regressions.test.mjs`

Run: `cd frontend && E2E_BASE_URL=http://127.0.0.1:8000 python e2e/paper_quota_and_retirement.py`

Expected: PASS.

- [ ] **Step 4: Commit E2E coverage**

```bash
git add frontend/e2e/paper_quota_and_retirement.py frontend/scripts/new-legacy-release.test.mjs
git commit -m "test: verify quota strategies and retired mode"
```

## Plan 3 Completion Gate

- Each supplement operation uses exactly the selected strategy; both quota maps survive strategy switching and reload.
- Manual question selections survive supplementation and reload; no duplicate question IDs exist.
- Multi-principle questions fill one principle only, and shortages identify the exact bucket.
- All active selectors, routes, task creation, and help expose only 刷题、深度回忆、归纳.
- Old single-deep links redirect to practice with safe parameter preservation.
- Historical single-deep records remain readable and clearly marked as retired.
- Node contracts, browser E2E, generated-release checks, and cross-teacher persistence pass.
