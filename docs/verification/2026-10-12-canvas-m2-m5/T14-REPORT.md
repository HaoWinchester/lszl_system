# T14 — card-scoped linked-question drawer

Implemented against c25284ab. Source/test scoped; no descendants, branch changes, push, deployment or merge. Generated synchronization output is deliberately unstaged.

## Implementation and authority

- Added shared question drawer controller and stylesheet. The graph detail panel exposes a visible 做题 button; no current persisted file disables entry, and opening a temporary related canvas closes/denies the drawer. Desktop width440px, max40vw; width100vw below700px. Shared fullscreen overlay mounting keeps header/close/scroll/submission usable inside actual fullscreenElement. Drawer sits above global floating navigation but below account/member dialogs.
- Teacher/admin title-prefilled search, keyword supplements, subject filter,20-item pagination, ordered checkbox selection, server alreadyLinked summaries and local dedupe. Checkbox changes are pending only. Confirm PUT combines existing IDs and additions; explicit remove confirmation sends the remaining complete ordered list. Errors are explicit; failed save keeps the previous visible bindings. Students/member students/viewers have no search/maintenance UI; all grants still checked by T13 backend.
- Only graph-questions authorized bindings feed the drawer. No bootstrap/full-answer catalog fallback. Attempts carry immutable sourceVersion and random idempotent requestId; grading always comes from the server. Single/multiple choices normalize with117; matching binding/presentation and materials/images use118. Frozen analysis uses119 sections and117 answer labels only after the server-confirmed attempt and separately authorized history request. Matching becomes read-only with revealed frozen pairs after submission. No duplicate grader added.
- Shared118 safeUrl supports only complete fileId/nodeId/bindingId/sourceVersion graph tuples, optional attemptId, rejects duplicate/unknown query keys and external URLs, and preserves ordinary query-free URLs. Image zoom mounts inside the current fullscreen host.
- Loading/failure/empty/search-none/save-failure/submission-failure states are distinct. AbortController plus epoch checks prevent card/search responses from rendering after close/card/file/account switches; graph file transitions also cancel immediately. Confirm flushes pending graph saves, compares current file context, supplies expectedFileRevision, and accepts returned revision through the remote adapter so subsequent graph saves do not use the pre-binding revision.

## API contracts exercised

GET `/api/v1/graph-questions/search?fileId&nodeId&q&subject&page`; GET/PUT `/api/v1/graph-questions/files/{fileId}/nodes/{nodeId}/bindings`; POST `.../{bindingId}/attempts`; GET `/api/v1/graph-questions/attempts/{attemptId}/analysis`; exact graph tuple image GET. PUT sends `{expectedFileRevision,questionIds}`; attempt sends `{sourceVersion,requestId,selectedOptionIds}` or selectedPairs. Full tuple comes from server-rewritten image URLs, never inferred source owner or catalog grants.

## Verification

Evidence: `artifacts/canvas-m2-m5/t14/`.

- `node frontend/scripts/sync-new-legacy.js` succeeded; source index and homepage-bundles contain dependency-ordered117/118/119/drawer registrations and stylesheet registrations.
- `node --test frontend/scripts/graph-question-drawer.test.mjs new-legacy/tests/multiple-choice-answer-set.test.js new-legacy/tests/question-analysis.test.js`:10 passed,0 failed, `unit.log`. Shared media tuple rejection/acceptance, dependency registration, existing answer-set and analysis regressions.
- Isolated server: `backend/.venv/bin/python new-legacy/tests/helpers/graph_question_server.py`, port5194. Reuses existing conftest unique migrated kg_pytest database lifecycle and graceful disposable server teardown; fixtures freeze private paid-source questions with server helpers, copy immutable grants into separate learner/member/admin owned files, and provide a second source bank plus23 pagination rows. Real240x96 PNG diagram in both question and material. No normal dev/UAT/prod database writes.
- Browser: `python3 new-legacy/tests/graph-question-drawer-browser.py`: live teacher/admin/member/nonmember/student/viewer sessions. Teacher no-question search/add, existing append,20/8 pagination, pending checkbox count unchanged before confirm, linked disabled/dedupe, confirmed removal. Admin subject-filtered search/add and wrong-answer result. Both member and nonmember students complete single/multiple/matching with frozen analysis, denied search/PUT/crossowner graph/ordinary managed catalog. Viewer bindings denied. Full graph image tuple succeeds and wrong node fails404. Search503, PUT409, list503 distinguish failures from empty and allow retry; held old request cannot reopen after switching cards. Temporary canvas hides practice and rejects formal drawer opening. Fullscreen host verified,900px screenshot,390px full overlay and visible close hit-test; submission remains within scroll viewport.
- Browser screenshots dismiss learning-entry onboarding, guided tour and help through their actual UI. Initial locator automatic scrolling changed underlying stage view, so the final harness uses actual visible coordinates plus elementFromPoint checks for card/practice entry and does not reset scroll. `native-bounds.json`: stage1440×862 at(0,38), window scroll(0,0), stage scroll(0,0). Screenshot `teacher-1440.png` uses full native stage and actual material diagram. `teacher-fullscreen.png`, `teacher-900.png`, `student-analysis.png`, `student-mobile.png`, member counterparts contain drawer evidence. Navigation overlap found visually in the first390px screenshot and fixed with scoped drawer stacking.
- `node --check` drawer/editor and Python py_compile passed; `git diff --check` passed.

## RED/GREEN and limits

No preimplementation RED test was executed; this report does not claim tests-first. First browser invocation used backend venv without Playwright and exited before testing; existing system python3 has Playwright. First harness hit learning-entry modal while trying to dismiss help; added UI-first dismiss. Native-coordinate refinement then deliberately rejected an offscreen empty card at390px and a post-resize obscured card; empty-card learner evidence now runs on initial native desktop before narrowing, without hidden scrolling. These were harness issues, not suppressed product assertions.

No full suite/release wave was run, as requested. The existing graph detail editor remains a large module; edits are limited to entry/close/context wiring. Maintenance revision conflicts ask user to reopen/retry rather than silently retry stale intent. Fixture cloning is trusted test setup only; T15/T16 production template entitlement/transaction guarantees and human UAT remain later integration responsibilities. Historical resource lifecycle stays server-defined. Helper is stopped after final verification; no service left running.

## Scoped files

new-legacy/src/graph/question-drawer-controller.js; new-legacy/styles/graph-question-drawer.css; new-legacy/src/10-graph-editor.js; new-legacy/src/118-question-materials.js; new-legacy/src/23-graph-file-remote-adapter.js; new-legacy/index.html; frontend/scripts/homepage-bundles.json; new-legacy/tests/graph-question-drawer-browser.py; new-legacy/tests/graph-question-drawer.test.js; new-legacy/tests/helpers/graph_question_server.py; frontend/scripts/graph-question-drawer.test.mjs.

## Final result

- Final full live browser matrix: **PASS**, `browser.log`. Final focused displayed-pair browser probe: **PASS l1→一, l2→二**, `matching-label.log`; these literal Unicode answer labels visually resemble one/two horizontal strokes. Main reusable browser test now asserts these rendered labels as well as server correctness.
- Screenshot root review confirmed1440/900/mobile drawer/nav/material presentation. Initial native stage bounds are recorded without scroll normalization.
- Final isolated helper PID34908 received SIGTERM and exited0; disposable database teardown ran. No helper remains on5194.
- Commit **fb3ad89d — feat(graph): add linked-question learning drawer** (11 scoped source/test files). Reports/evidence remain outside source commit; generated frontend artifacts unstaged. No push/merge/deploy/branch mutation.

## Fix 1 — submission race and collapsed search (base fb3ad89d)

Read task-14-review.md. Fixed the Important submission race and root-requested Minor search lifecycle issue; formatting suggestion deliberately deferred per root scope.

- A validated answer is deep-copied into an independently frozen snapshot containing sourceVersion, requestId and ids/pairs before POST. Choice controls are disabled and restored to this exact checked selection; matching is rebound read-only immediately, removing candidate/clear interactions and guarding drop handling through the existing shared118 implementation. All pending attempts reject further changes and repeated submits. Revealed matching uses the submitted snapshot, never a live mutable pairs variable.
- A failed or ambiguously lost POST keeps controls frozen and offers retry of the same snapshot/requestId. This prevents a response loss after server commit from turning retries into different or duplicate attempts. Once the POST is known saved, analysis failure retains the saved attempt and retry performs GET analysis only. Successful history finalizes the submitted state.
- Search collapse aborts the outstanding controller and clears result metadata. Search completion requires active search UI and a nonaborted current request; optional status target checks prevent removed-DOM dereferences. Reopening cannot resurrect the old results. No unrelated UI changes.
- Added `new-legacy/tests/graph-question-drawer-races-browser.py`. Actual held single/matching POST responses are committed by route.fetch then deliberately replaced with503; while pending, forced clicks cannot change disabled choices/pairs. Retry body and requestId are exactly equal, returned attempt ID is identical, visible final answers match backend attempt.selection. Search success is held, panel collapsed, response released, then reopened: no stale results/status, pageerror or unhandledrejection; fresh search still works.

Covering commands/results:

1. `node frontend/scripts/sync-new-legacy.js` -> succeeded (`fix1-sync.log`), generated output unstaged.
2. `node --test frontend/scripts/graph-question-drawer.test.mjs new-legacy/tests/multiple-choice-answer-set.test.js new-legacy/tests/question-analysis.test.js` -> **10 passed,0 failed** (`fix1-unit.log`).
3. Disposable migrated helper `backend/.venv/bin/python new-legacy/tests/helpers/graph_question_server.py`, port5194, isolated kg_pytest DB only (`fix1-server.log`).
4. `python3 new-legacy/tests/graph-question-drawer-races-browser.py` -> **PASS held choice/matching submissions, ambiguous-failure exact idempotent retries, collapsed search abort/reopen, no unhandled rejections** (`fix1-races.log`).
5. `python3 new-legacy/tests/graph-question-drawer-browser.py` -> **PASS live role/maintenance/material/all3types/error/fullscreen/mobile regression** (`fix1-browser.log`).
6. `node --check new-legacy/src/graph/question-drawer-controller.js` and `git diff --check` -> exit0.

No pre-fix RED execution; not claiming TDD. First new race-harness run failed because it incorrectly accessed flat selectedOptionIds instead of actual attempt.selection.selectedOptionIds; corrected to the documented backend response, then all assertions passed. The final runs include the explicit nested freezes and checkbox snapshot restoration.

Helper PID36735 stopped via SIGTERM, process exited0 and disposable teardown completed. No full suite, descendants, branch changes, push, deployment or merge. Only controller and the new focused browser test changed; generated frontend files remain unstaged.

Fix1 commit: **5e147249 — fix(graph): freeze pending drawer answers and cancel hidden search**. Source/test paths clean and index empty after commit; helper stopped.


## Independent review

### Spec Compliance

- ✅ Fix1 compliant: the Important pending-answer mismatch and root-requested pending-search collapse defect are resolved in `fb3ad89d..5e147249`.
- ✅ Submission deep-copies and freezes the exact answer/sourceVersion/requestId, disables choice controls before POST, and immediately rebinds matching read-only; final matching reveal uses the frozen submission (`new-legacy/src/graph/question-drawer-controller.js:23–37`).
- ✅ Ambiguous POST failure retains that snapshot and requestId, while a confirmed saved attempt is retained so analysis retry uses GET only (`new-legacy/src/graph/question-drawer-controller.js:28–39`).
- ✅ Search toggle aborts its outstanding request and clears results on collapse; completion checks epoch, abort and active search, with guarded DOM access (`new-legacy/src/graph/question-drawer-controller.js:18`, `:51`).
- ⚠️ Cannot verify from this fix-only diff: broader T13 authorization, template entitlement integration and human UAT. Original task review limitations continue to apply; this rereview does not reapprove those unrelated layers.

### Strengths

- Exact idempotent retry evidence exercises a real backend commit followed by a deliberately substituted503 response; assertions compare both retry body and canonical attempt ID and verify displayed answers against server attempt.selection (`new-legacy/tests/graph-question-drawer-races-browser.py:20–37`).
- Matching uses the existing shared readOnly rendering/binding contract rather than a duplicate interaction implementation (`new-legacy/src/graph/question-drawer-controller.js:31`, `:36`; `new-legacy/src/118-question-materials.js:27–32`, `:56–72`).
- Collapsed-search test holds a real response, collapses/reopens the search panel, checks no stale results or unhandled rejection, then exercises a fresh search (`new-legacy/tests/graph-question-drawer-races-browser.py:38–44`).

### Issues

#### Critical (Must Fix)

- None found in the scoped fix.

#### Important (Should Fix)

- None found in the scoped fix. The previously blocking learner display race is resolved.

#### Minor (Nice to Have)

- Existing readability suggestion remains intentionally deferred: compressed controller lines make async flow harder to maintain (`new-legacy/src/graph/question-drawer-controller.js:23–51`). It is not a fix-created defect or approval blocker.

### Assessment

**Task quality:** Approved for the scoped T14 fix.

**Reasoning:** The submitted display now derives from the same immutable payload sent to the server, and ambiguous failure retries cannot create a different answer/request identity. Search collapse cancels and suppresses stale responses before touching removed DOM.

**Checks:** Read the fix diff once and inspected the shared matching readOnly contract as a concrete dependency risk; disabled targets, absent candidates/clear actions, assign guard and drop guard confirm pending matching cannot mutate (`new-legacy/src/118-question-materials.js:27–32`, `:56–72`). Inspected existing `artifacts/canvas-m2-m5/t14/fix1-races.log` and `fix1-browser.log`, both report PASS. No tests were rerun and logs are implementation-run evidence, not independent executions. Analysis GET-only retry is verified by control flow rather than a dedicated held-analysis browser assertion (`new-legacy/src/graph/question-drawer-controller.js:33–39`). Only this report was written; no source, index, branch, descendant, push or deployment mutation.
