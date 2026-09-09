# Mixed Question Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver mixed single-choice, multiple-choice, chart, matching and shared-case questions through editing, publishing, resumable practice and review on web and WeChat.

**Architecture:** Extend existing question normalization, immutable releases and session services. Keep answer type separate from image/material and case grouping. Preserve historical contracts and add a structured matching answer.

**Tech Stack:** FastAPI, SQLAlchemy, PostgreSQL/Alembic, vanilla JavaScript/CSS, WeChat TypeScript/WXML.

## Global Constraints

- Approved spec: `docs/superpowers/specs/2026-09-09-mixed-question-paper-design.md`.
- Work ONLY in `.worktrees/mixed-question-types`, branch `codex/mixed-question-types`, based on verified uat `b32ab3d`; original checkout stays untouched except approved design documentation.
- No unrelated dependencies, no source edits in generated release/public files. Shared behavior belongs in existing common modules or focused new common modules.
- Keep standard and multiple_choice paper rules; add mixed and default new teacher-created papers to mixed.
- Matching is one-to-one, all-or-nothing; cases group selection but count/grade each child. No standalone alternate exercise system.
- Include PC, mobile web and mini-program, four current modes, save/resume, timeout, reports, mistakes, immutable history, authenticated data isolation.
- Publish only through manage-new-legacy, push with command-scoped proxy, deploy UAT after verification, never merge main without user acceptance.

## Shared Contract

```ts
type ImageAsset = { id: string; url: string; alt: string };
type Material = { id: string; revision: number; title: string; text: string; images: ImageAsset[] };
type CaseGroup = { id: string; order: number; total: number };
type Matching = { left: {id:string,text:string}[]; right: {id:string,text:string}[]; correctPairs: Record<string,string> };
type MixedQuestionExtension = { type: 'single_choice'|'multiple_choice'|'matching'; images?: ImageAsset[]; material?: Material; caseGroup?: CaseGroup; matching?: Matching };
type MatchingAnswer = { selectedPairs: Record<string,string>; selectionIndex: number; timedOut?: boolean };
// runtimeState.pendingMatches: Record<questionId, Record<leftId,rightId>>
```

Question payload extensions round-trip through existing catalog/import and become part of published snapshots. `caseGroup.id` equals `material.id`. Orders are one-based; all group members must agree on total and material revision. Independent image questions have no caseGroup. Correct matching mappings use independent left/right identifiers, never an ID convention revealing the answer. The API service owns material revisions; clients cannot overwrite published resources.

### Task 1: Backend mixed content, publishing, selection and scoring

**Files:** Modify `backend/app/models/question.py`, `backend/app/models/paper_release.py`, `backend/app/models/__init__.py`, `backend/app/schemas/paper.py`, `backend/app/schemas/paper_release.py`, `backend/app/services/question_content_service.py`, `question_answer_service.py`, `question_catalog_service.py`, `paper_service.py`, `paper_import_service.py`, `paper_release_service.py`, `paper_composition_service.py`, `practice_session_service.py`, `learning_service.py`, relevant API routers and schemas. Create focused `question_material_service.py`, material models/API and Alembic migration. Tests: `backend/tests/test_mixed_question_types.py`, `test_mixed_practice.py`, `test_question_materials.py` plus existing suites.

**Interfaces:** Consumes Shared Contract; produces catalog/paper payloads unchanged for old consumers and mixed payloads for new consumers. Extend common grading entry with `selectedPairs`; validate complete submissions and allow partial pendingMatches. Material APIs under `/api/v1/question-materials`, assets `/api/v1/question-assets`.

- [ ] Add failing tests for a seven-question mixed release, immutable material revision, group-preserving exact-count selection, matching complete/wrong/duplicate/foreign/timeout answers, partial save/resume and revision conflict.
- [ ] Run focused tests and verify failure against missing capabilities.
- [ ] Implement mixed type in every database/API/import normalization boundary and enforce a supported-type whitelist for mixed. Validate full case group membership/order when publishing and editing paper refs.
- [ ] Implement teacher/admin material CRUD, revision conflict and referenced-delete rejection; immutable image bytes and metadata stored in PostgreSQL (PNG/JPEG/WebP, max 5 MiB), no arbitrary remote fetch. Upload JSON `{filename,mimeType,dataBase64,alt}` -> `{asset:{id,url,alt}}`; POST/PUT material `{title,text,images,revision?}` -> `{material}`; GET list -> `{materials}`. Reuse existing role/access checks. Published authorized learners may retrieve only referenced assets.
- [ ] Centralize answer validation/grading. Branch on matching before existing option coercion, preserve selectedPairs in report and mistake snapshots, ignore client correctness. Extend pending state validation and immutable-submission comparisons.
- [ ] Make grouped selection exact-count using stable seeded units, return explicit selection error with available counts if unsatisfiable; case wrong-child review carries material without requiring all siblings.
- [ ] Run new and existing backend tests; commit only owned backend files. Report endpoints and any contract differences before frontend integration.

Example assertions (fixtures construct the above shapes):
```python
assert grade_matching(question, {"l1":"r2", "l2":"r1"})["correct"] is True
assert grade_matching(question, {"l1":"r2", "l2":"r2"})["correct"] is False
assert [row.snapshot["caseGroup"]["order"] for row in selected if row.snapshot.get("caseGroup")] == [1, 2, 3]
assert published.question_count == 7
```
Run: existing backend venv Python `-m pytest tests/test_mixed_question_types.py tests/test_mixed_practice.py tests/test_question_materials.py -q` from worktree backend. Tests already create disposable databases.

### Task 2: Teacher content editing and mixed paper management

**Files:** Modify `new-legacy/src/65-question-bank-admin.js`, relevant `new-legacy/src/teacher/paper-management/` modules, `new-legacy/question-bank.html`, `new-legacy/paper-management.html`, `new-legacy/content-prep-studio/` canonical sources where necessary; create `new-legacy/src/118-question-materials.js` and `new-legacy/styles/question-materials.css`; add behavioral tests in `new-legacy/tests/mixed-question-editor.test.js`.

**Interfaces:** Use Shared Contract and Task 1 material/assets APIs. Expose `KGQuestionMaterials` for material rendering/editor operations; all displayed text escaped, imported media only trusted asset URLs.

- [ ] Add normalization/serialization and editor interaction tests covering save/reload, invalid pair counts, incomplete answer mapping, image failure/retry, cancel and denied saves.
- [ ] Extend teacher question editor to choose matching, add/remove left/right rows, assign correct pairs; image upload with accessible description and persisted asset reference.
- [ ] Add case material selection/create/edit and case group ordering/count; provide group creation/management that produces real child questions. Preview uses common material/matching rendering.
- [ ] Add mixed paper option/default, preserve old paper restrictions, fix all type-coercion paths and candidate filters. Whole-case add/remove/move, import/export and count labels use child counts.
- [ ] Run relevant node editor/paper/import tests and commit scoped source/test files.

```js
assert.equal(normalized.paperType, 'mixed');
assert.deepEqual(saved.matching.correctPairs, {l1:'r2',l2:'r1'});
assert.equal(caseRefs.length, 3);
```

### Task 3: Web mixed exercise and review

**Files:** Modify `new-legacy/src/100-practice-mode.js`, `114-practice-draft-state.js`, `117-question-answer-set.js`, `113-practice-result-report.js`, `77-multi-question-workspace.js`, `new-legacy/src/practice/practice-selection-service.js`, relevant preview/renderers and practice styles/HTML. Common rendering/interaction in `118-question-materials.js`. Tests `new-legacy/tests/mixed-practice.test.js`, `frontend/e2e/mixed_questions.py`.

**Interfaces:** `KGQuestionMaterials.render(question, options)`, `bind(container, options)` provide materials/images/matching view with onChange(selectedPairs); Shared Contract pendingMatches and selectedPairs; existing session transport persists unchanged shape extensions.

- [ ] Add failed behavioral tests for pair reassignment and duplicate prevention, incomplete draft, refresh/resume, complete submission, timeout, read-only review and unknown-type rejection.
- [ ] Retain mixed extensions in every question normalization/filter. Render cases in responsive split view, preserve material scroll position, render zoom/retry image control and accessible keyboard/click/drag matching.
- [ ] Extend common draft/answer state to grade local feedback and submit selectedPairs without client authority; persist tentative pairs in pendingMatches and strip them after submission.
- [ ] Update all mode entries, reports, answer sheet, mistakes, revenge and multi-question workspace. Display correct pair-by-pair explanations and child counts.
- [ ] Verify targeted node tests and real browser create/publish/practice/save/resume/report flow; commit source/test changes.

```js
assert.deepEqual(draft.submission().answers.q1.selectedPairs, {l1:'r2',l2:'r1'});
assert.equal(draft.viewAnswers().q1.correct, true);
```

### Task 4: WeChat mixed practice and review

**Files:** Modify `miniprogram/types/api.ts`, `domain/question.ts`, `domain/pc-practice.ts`, `domain/practice-state.ts`, `services/practice.ts`, `components/question-view/`, `pages/practice/`, `pages/result/`, `pages/revenge/`; tests `miniprogram/tests/mixed-question-types.test.mjs`.

**Interfaces:** Same backend contracts; native components mirror web semantics with tap selection, undo, asset zoom/retry, collapsible case material. Keep unknown type distinct and block submit.

- [ ] Add tests for contract normalization, pending pair restoration, pair grading, duplicate prevention, timeout, serialized answer maps and unknown types.
- [ ] Extend typed question/answer/runtime definitions and normalization with independent matching/image/case fields. Resolve relative asset URLs with configured API base.
- [ ] Wire question-view native matching and material views, practice pending state/submission and four-mode feedback; restore partial and final maps from server.
- [ ] Extend result and revenge views to preserve structured selections/material; maintain existing single/multiple behavior.
- [ ] Run full mini `npm test`, type/config validation available in repository; commit scoped files.

```js
assert.equal(normalizeQuestion({type:'matching',matching}).type, 'matching');
assert.deepEqual(progress.runtimeState.pendingMatches.q1, {l1:'r2'});
assert.equal(normalizeQuestion({type:'unknown'}).type, 'unknown');
```

### Task 5: Integrated verification and UAT

**Files:** Source-derived sync outputs, manifest/report/seed artifacts, `docs/verification/2026-09-09-mixed-question-types.md` and deployment scripts only if a verified defect requires it.

- [ ] Review complete branch against every approved requirement; repair correctness and usability gaps without weakening tests.
- [ ] Run backend full pytest, frontend `pnpm test`, `pnpm test:design`, mini full tests and mixed workflow browser tests covering seven-question counts, all modes, save/retry, image errors, case grouping and history.
- [ ] Produce and inspect desktop/mobile screenshots. Record real outcomes and any unavailable device checks.
- [ ] Run prescribed release manager and compare file counts/critical pages against active release. Commit all source-derived outputs.
- [ ] Integrate verified feature into uat without overwriting existing changes, rerun affected checks, proxy-push and confirm remote SHA, deploy using verified UAT procedure.
- [ ] Record UAT URL/release/SHA and user acceptance checklist. Stop before main until the user explicitly accepts UAT.
