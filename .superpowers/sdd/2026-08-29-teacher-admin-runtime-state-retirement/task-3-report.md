# Task 3 Report: Question and Paper Management Cutover

Date: 2026-08-29
Branch: `codex/runtime-retirement-execution`
Starting HEAD: `8d56a12`
Alembic head preserved: `c8e4f1a2b930`

## Outcome

`question-bank.html` and `paper-management.html` now use the existing typed question, paper draft, category, and release APIs through `KGDomainApi`. Formal question/paper reads and writes no longer fall back to Runtime or browser business persistence. Both Runtime policies are byte-identical and exclude the two pages. Server-authoritative publish/withdraw replaces the former browser-built publish snapshot path.

The isolated browser matrix proves API/database-visible bank, question, category, and paper CRUD; publish/withdraw; permission and validation denial; stale-revision recovery; visible API failure/reload recovery; refresh and re-login persistence; exact cleanup; and zero Runtime requests.

## Implementation

- Rebased all three question/paper adapters on the Task 1 `KGDomainApi` boundary, preserving typed error status/code/detail and auth-required signalling.
- Added typed question-bank test-record cleanup through `KGQuestionCatalogAdapter`.
- Added authoritative `KGPaperReleaseApi.publish(paperId, body)` and `withdrawPaper(paperId)` calls; removed browser `publishPayload`, compatibility storage invalidation keys, and management-catalog `questionSnapshots`.
- Made question catalog and paper draft/release dependencies required. Missing or failed APIs render a visible retry panel and do not fall back to local data.
- Removed formal question banks, question selection, papers, categories, published-paper history, audit/demo/tag configuration, and migration-preview persistence from the affected management code.
- Kept layout/collapse preferences only through `KGDevicePreferences`.
- Preserved server release snapshots only behind the learner release repository; the teacher management page no longer constructs or submits frozen snapshots.
- Changed safe delete to inspect caller-supplied typed reference snapshots instead of enumerating browser storage.
- Changed the admin reference index to accept typed reference snapshots and load banks, papers, and the lightweight release management catalog through `KGDomainApi`.
- Removed the two pages from both Runtime policies and updated sync/runtime contracts so generated pages are direct pages without `server-state-bootstrap.js`.
- Injected the paper draft adapter into `question-bank.html`, before the shared admin application.
- Fixed a cutover regression found by the dirty-editor test: loading paper summaries on the question-bank page no longer replaces its question-bearing bank state with summary-only banks.
- Extended the isolated Playwright harness with `--question-paper-only --assert-no-runtime`; its login helper now supplies the backend-required current legal-consent version.

## Files

Production and policy:

- `backend/app/web/runtime_page_policy.json`
- `frontend/e2e/shared_teacher_workspace.py`
- `frontend/scripts/new-legacy-assets/paper-draft-adapter.js`
- `frontend/scripts/new-legacy-assets/paper-release-adapter.js`
- `frontend/scripts/new-legacy-assets/question-catalog-adapter.js`
- `frontend/scripts/runtime-page-policy.json`
- `frontend/scripts/sync-new-legacy.js`
- `new-legacy/src/60-question-bank.js`
- `new-legacy/src/65-question-bank-admin.js`
- `new-legacy/src/98-question-classification.js`
- `new-legacy/src/admin/30-reference-index-service.js`
- `new-legacy/src/teacher/question-bank/safe-delete-service.js`

Tests and contracts:

- `frontend/scripts/paper-draft-adapter.test.mjs`
- `frontend/scripts/paper-release-adapter.test.mjs`
- `frontend/scripts/question-catalog-adapter.test.mjs`
- `frontend/scripts/runtime-retirement-contract.test.mjs`
- `new-legacy/tests/content-prep-question-bank-integration.test.js`
- `new-legacy/tests/paper-management-api-contract.test.js`
- `new-legacy/tests/question-paper-runtime-free.test.js`
- `new-legacy/tests/v90-p35-paper-management.test.js`

Generated `frontend/public/new-legacy/`, manifest, and sync report outputs were used for verification and then explicitly restored/removed. No immutable release or active pointer was edited or promoted.

## TDD Evidence

### Formal-data boundary RED -> GREEN

RED:

```text
$ cd new-legacy && node --test tests/question-paper-runtime-free.test.js
1..2
# pass 0
# fail 2
```

After expanding the behavior gates, the expected RED was `0/4`: formal compatibility keys/local storage remained, both policies still allowed the pages, safe delete enumerated browser storage, and reference indexing did not call typed APIs.

GREEN (fresh final focused run, including related regressions):

```text
$ cd new-legacy && node --test tests/question-paper-runtime-free.test.js tests/paper-management-api-contract.test.js tests/content-prep-question-bank-integration.test.js tests/v90-p35-paper-management.test.js
1..7
# pass 7
# fail 0
```

### Shared adapter RED -> GREEN

The question catalog and paper draft fixtures were changed to provide only `KGDomainApi` and no global `fetch`.

```text
RED:  13/16 passed; 3 failed with `global.fetch is not a function`
GREEN: 16/16 passed after routing through KGDomainApi
```

Paper release authoritative lifecycle:

```text
RED:  17/18 passed; `publish is not a function`
GREEN: 18/18 passed after typed publish/withdraw implementation
```

The legacy storage-invalidation contract then intentionally went RED `17/18`; it returned GREEN after removing old storage keys/events. The question-catalog clear-record behavior likewise went RED with `clearBankTestRecords is not a function` before the typed method was added.

Fresh final adapter/runtime command:

```text
$ cd frontend && node --test scripts/question-catalog-adapter.test.mjs scripts/paper-draft-adapter.test.mjs scripts/paper-release-adapter.test.mjs scripts/runtime-retirement-contract.test.mjs
1..39
# pass 39
# fail 0
```

### Dirty-editor recovery RED -> GREEN

```text
$ cd new-legacy && node --test tests/question-paper-runtime-free.test.js tests/paper-management-api-contract.test.js tests/content-prep-question-bank-integration.test.js
1..6
# pass 5
# fail 1
```

The first failure exposed an incomplete test double (`Catalog.banks()`); after matching the real adapter, the remaining failure exposed the product regression where paper-summary loading erased question state. The minimal page-mode guard restored the expected merge behavior.

```text
1..6
# pass 6
# fail 0
```

### Runtime generation RED -> GREEN

Before policy/sync changes:

```text
runtime-retirement-contract: 3/5 passed, 2 failed
paper-draft sync injection: 6/7 passed, 1 failed
```

The policies still contained both pages and the generated question page lacked the paper-draft dependency. After updating the policies/synchronizer and syncing the candidate tree, the final adapter/runtime command passed `39/39` and the explicit storage/policy/source scan exited `0`.

## Verification

Backend focused domains:

```text
$ cd backend && .venv/bin/python -m pytest tests/test_question_api_compatibility.py tests/test_paper_draft_api.py tests/test_paper_releases.py tests/test_paper_access_entitlements.py -q
31 passed, 1 warning in 14.72s
```

The warning is the existing Starlette `python_multipart` pending deprecation.

Frontend full contract suite (run once after sync):

```text
$ cd frontend && node scripts/sync-new-legacy.js && pnpm test
1..275
# pass 275
# fail 0
```

Browser CRUD/persistence matrix with the available Playwright interpreter:

```text
$ /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 frontend/e2e/shared_teacher_workspace.py --question-paper-only --assert-no-runtime
task7-isolated-server ... candidateFiles=979 activeFiles=975 ...
question-paper-e2e-ok crud=bank,question,category,paper publish=1 withdraw=1 runtimeRequests=0 refresh=2 relogin=1 cleanup=verified
```

The brief's `backend/.venv/bin/python` interpreter has no `playwright` module (`ModuleNotFoundError`). No dependency was installed; the existing system Python 3.11 Playwright interpreter was used instead.

Explicit boundary scan:

```text
$ cmp -s frontend/scripts/runtime-page-policy.json backend/app/web/runtime_page_policy.json \
  && ! rg -n 'localStorage|sessionStorage|indexedDB|kg_(question_banks|exam_papers|exam_paper_categories|exam_papers_published|exam_paper_release_history)|publishPayload|questionSnapshots' <formal Task 3 sources> \
  && ! rg -n 'server-state-bootstrap\\.js' frontend/public/new-legacy/question-bank.html frontend/public/new-legacy/paper-management.html
exit 0
```

Extra non-gating legacy source sweep:

```text
$ cd new-legacy && node --test tests/*.test.js
1..332
# pass 267
# fail 65
```

These failures are stale, cross-version source/visual/retired-page/legacy Runtime expectations outside Task 3 (for example old Focus Vega script lists and retired learning-page layouts). The authoritative frontend full suite, Task 3 focused source tests, typed backend domains, and browser matrix are green. This extra sweep is recorded rather than expanding the task into unrelated legacy-baseline repair.

## Self-review

- `git diff --check`: clean.
- Both Runtime policy JSON files are byte-equivalent.
- No changed formal source contains direct `localStorage`, `sessionStorage`, `indexedDB`, retired formal keys, browser publish payloads, or teacher-built question snapshots.
- All request adapters reuse `KGDomainApi`; no duplicate generic client was introduced.
- All layout/collapse persistence is routed through `KGDevicePreferences`.
- The E2E uses a unique isolated database/release, seeded allow/deny identities, unique row names, API cleanup, database drop, and temporary-release cleanup.
- No Alembic files, main/uat/deployment files, active release pointer, immutable release, or promotion path changed.
- Generated sync outputs were removed after the last verification.
- One real API/brief mismatch was resolved by evidence: there is no root `GET /api/v1/paper-releases`; the typed management endpoint is `GET /api/v1/paper-releases/management-catalog?page=1&pageSize=100` and returns lightweight `papers` without frozen snapshots.

## Checkpoint Recovery

The exact interrupted checkpoint `464f4ad1b17c71ae8fbf3f09da5446c948a5626f` (`stash@{0}`, message `sdd-task3-interrupted-checkpoint`) was applied without conflicts and retained throughout implementation. After report creation and implementation commit `e7c97d8`, the exact object was verified and dropped:

```text
stash@{0} 464f4ad1b17c71ae8fbf3f09da5446c948a5626f On codex/runtime-retirement-execution: sdd-task3-interrupted-checkpoint
Dropped stash@{0} (464f4ad1b17c71ae8fbf3f09da5446c948a5626f)
```

## Concerns

1. The backend virtualenv does not include Playwright; use the existing system Python 3.11 interpreter for this E2E unless project tooling later standardizes the dependency.
2. The extra raw `new-legacy/tests/*.test.js` sweep contains 65 unrelated stale expectations. Task 3 does not update those broad historical design baselines; the relevant v90 paper contract was updated and passes.
3. The reference-index management-catalog call requests the API maximum first page (`pageSize=100`). Current admin use is lightweight; if an installation exceeds 100 simultaneous active releases, a later task should add pagination aggregation at the caller boundary.

---

## Review Fix Round 1/5 (2026-08-29)

Fix starting HEAD: `e7c97d8`
Fix commit: `3de665c`
Alembic head: `c8e4f1a2b930` (unchanged)

### Outcome

All three review findings are addressed:

1. Permanent deletion now acquires the existing teaching-content transaction advisory lock and checks every relational `paper_questions` and immutable `paper_release_questions` row before deleting. A reference returns HTTP 409 `QUESTION_REFERENCED`; neither the question nor any draft/release reference is modified.
2. The admin reference loader now calls one complete typed `GET /api/v1/questions/reference-snapshot` endpoint. The snapshot holds the shared teaching-content read lock while reading all banks/questions, all draft paper references, and every release reference including withdrawn history. Production registry hydration is wired and fail-closed: its consumers await readiness, failures are visible, and no destructive usage check can treat “not loaded” as zero references. Paper subject codes such as `PMP` are normalized through the production subject registry to `subject-pmp`.
3. The Playwright matrix now performs bank/question/category/paper CRUD, publish, withdraw, validation recovery, API-failure recovery, refresh, re-login, draft deletion, and role denial with visible native page controls. Request-context calls are limited to one preflight-qualified publish fixture, exact cleanup infrastructure, and independent GET verification. Runtime request count is zero.

The complete snapshot remains available to authenticated teaching managers because this domain deliberately shares managed banks and papers across teachers; existing regression tests explicitly reject restoring owner-only filters. Students/viewers remain denied by the permission dependency and page access boundary.

### Files changed in the fix

- `backend/app/api/v1/questions.py`
- `backend/app/services/question_cleanup_reference_service.py`
- `backend/app/services/question_service.py`
- `backend/tests/test_question_api_compatibility.py`
- `frontend/e2e/shared_teacher_workspace.py`
- `new-legacy/src/admin/30-reference-index-service.js`
- `new-legacy/src/admin/40-admin-service-registry.js`
- `new-legacy/src/admin/50-admin-shell-app.js`
- `new-legacy/src/admin/51-admin-subjects-app.js`
- `new-legacy/src/admin/53-admin-settings-app.js`
- `new-legacy/tests/question-paper-runtime-free.test.js`

No Alembic migration, Runtime policy, active release, immutable release, UAT, deployment, or promotion file changed. Generated `frontend/public/new-legacy`, manifest, and sync report output was used for verification and then restored/removed.

### Strict TDD evidence

#### Authoritative permanent-delete guard

RED:

```text
$ cd backend && .venv/bin/python -m pytest tests/test_question_api_compatibility.py::test_permanent_question_delete_rejects_every_draft_and_release_reference -q
E assert 200 == 409
1 failed
```

The old service deleted every matching `PaperQuestion` before deleting the question and had no immutable-release check.

GREEN:

```text
$ cd backend && .venv/bin/python -m pytest tests/test_question_api_compatibility.py::test_permanent_question_delete_rejects_every_draft_and_release_reference -q
1 passed
```

The test creates two unselected draft-paper links and one withdrawn immutable-release link, attempts both deletions, asserts exact conflict counts, and compares fresh-session state before/after including question rows, all links, paper question IDs, and the frozen release snapshot.

#### Complete typed reference snapshot and production wiring

Initial backend RED:

```text
$ cd backend && .venv/bin/python -m pytest tests/test_question_api_compatibility.py::test_question_reference_snapshot_includes_unselected_drafts_and_releases -q
E assert 404 == 200
1 failed
```

Initial frontend REDs:

```text
$ cd new-legacy && node --test tests/question-paper-runtime-free.test.js
reference loader: unexpected path /api/v1/banks
production registry: expected typed request; calls=[]
```

Self-review then added transaction-consistency/readiness/subject-identity gates. Their observed RED was:

```text
$ cd backend && .venv/bin/python -m pytest tests/test_question_api_compatibility.py::test_question_reference_snapshot_includes_unselected_drafts_and_releases -q
E assert [] == [True]
1 failed

$ cd new-legacy && node --test tests/question-paper-runtime-free.test.js
not ok - production admin registry hydrates unselected draft and release references
error: Missing expected exception.
# pass 4
# fail 1
```

Final GREEN:

```text
$ cd backend && .venv/bin/python -m pytest \
  tests/test_question_api_compatibility.py::test_permanent_question_delete_rejects_every_draft_and_release_reference \
  tests/test_question_api_compatibility.py::test_question_reference_snapshot_includes_unselected_drafts_and_releases -q
2 passed, 1 warning in 1.95s

$ cd new-legacy && node --test tests/question-paper-runtime-free.test.js \
  tests/paper-management-api-contract.test.js \
  tests/content-prep-question-bank-integration.test.js \
  tests/v90-p35-paper-management.test.js
1..8
# pass 8
# fail 0
```

The Starlette `python_multipart` pending-deprecation warning is pre-existing.

### Native browser matrix and debugging evidence

The rewritten test uses the visible `[data-main-tab="banks"]` control, visible form fields/buttons, native prompt/confirm/dialog behavior, and normal Playwright clicks. It never force-clicks or activates hidden controls.

One important orchestration failure was HTTP 409 `LOCK_TOKEN_INVALID` on the second question save. Network/controller evidence showed this was not a product defect: Playwright's response event completed before the page's first save handler finished refreshing the catalog and reacquiring its one-use edit lock, so the immediate second click reused the consumed token. The final test waits on the public `KGQuestionCatalogEditController.status()` until `questionId` is correct, the editor is writable, and `lockToken` rotates. It contains no fixed sleep.

The new-paper response had the same response-event-versus-late-render boundary: a background `kg:paper-drafts-changed` refresh could restore the previously selected paper after POST. The final condition waits for the created row and settled previous selection, then clicks the new row visibly and waits for active selection plus an enabled delete button. Again, no fixed sleep, hidden click, or forced click is used.

The preflight-qualified publish question is the only business-data seed performed by request context; it supplies the API-required `process` subject facet. The teacher still creates/edits the tested bank and question, creates/renames/deletes categories, creates/edits/deletes papers, composes, publishes, and withdraws through native controls. Publish validation is visibly rejected before a question is added, a bank save and publish are separately route-aborted and visibly recovered, and API GETs independently verify outcomes. After re-login, both the question and paper are visibly rehydrated on their real pages. Student visits to both real URLs assert the server-native visible 403 `无权访问` page.

Final E2E GREEN:

```text
$ /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 frontend/e2e/shared_teacher_workspace.py --question-paper-only --assert-no-runtime
task7-isolated-server ... candidateFiles=979 activeFiles=975 ...
question-paper-e2e-ok nativeCrud=bank,question,category,paper publish=1 withdraw=1 validationRecovery=1 apiFailureRecovery=2 roleDenial=2 runtimeRequests=0 refresh=2 relogin=1 cleanup=isolated-db-drop
```

### Final verification

```text
$ cd backend && .venv/bin/python -m pytest tests/test_question_api_compatibility.py tests/test_paper_draft_api.py tests/test_paper_releases.py tests/test_paper_access_entitlements.py -q
33 passed, 1 warning in 19.85s

$ cd frontend && pnpm test
1..275
# pass 275
# fail 0
```

Focused generated adapter/Runtime contracts after candidate sync:

```text
$ cd frontend && node --test scripts/question-catalog-adapter.test.mjs scripts/paper-draft-adapter.test.mjs scripts/paper-release-adapter.test.mjs scripts/runtime-retirement-contract.test.mjs
1..39
# pass 39
# fail 0
```

Additional gates:

```text
$ cmp -s frontend/scripts/runtime-page-policy.json backend/app/web/runtime_page_policy.json \
  && <formal storage/Runtime source scan> \
  && ! rg -n 'server-state-bootstrap\\.js' frontend/public/new-legacy/question-bank.html frontend/public/new-legacy/paper-management.html
exit 0

$ cd backend && .venv/bin/alembic heads
c8e4f1a2b930 (head)

$ git diff --check
exit 0
```

One deliberately extra legacy-source command (`admin-focus-vega-skin-contract`, typography, and v9.0-p31 tests) produced `13 passed / 6 failed`; all six are already-recorded stale version/script-order/skin expectations at source version `v9.0-p4.1.186`, not changed-path behavior failures. The authoritative frontend suite, changed-path source contract, typed backend domains, and real browser matrix are green.

### Self-review

- Transaction safety: question deletion and every supported paper/release writer share the same transaction advisory lock; count and delete occur in one transaction. Snapshot reads hold the matching shared read lock.
- Completeness: no page, selection, release status, or pagination filter exists in the reference endpoint; empty papers/releases are retained and all reference rows are hydrated.
- Failure posture: reference consumers cannot build an empty formal index while hydration is pending or failed; admin pages wait and render a recoverable visible error.
- Identity mapping: `PMP`/other database subject codes pass through `subjectById` before entering `subjectRefs`; the test proves both an unselected draft and withdrawn release protect `subject-pmp`.
- E2E authority: request context is only seed/cleanup/independent verification; all required behavior actions use visible controls.
- Generated/immutable safety: generated sync outputs were cleaned; no active pointer, immutable release, deployment, UAT, or migration file changed.
- `git diff --check`, JavaScript syntax checks, both policy byte comparison, generated-page Runtime scan, and changed-path status gate pass.

### Concerns after the fix

1. The complete reference endpoint intentionally returns the entire shared teaching corpus in one response so correctness cannot be weakened by pagination gaps. Very large installations may later need a server-built compact reference graph or streaming transport, but any optimization must preserve one transaction-consistent complete view.
2. The project backend virtualenv still lacks Playwright; the already-installed system Python 3.11 interpreter remains required for this E2E.
3. Historical raw `new-legacy` suites still contain stale version/visual/script-order baselines, as already documented above. No new changed-path product failure remains.

---

## Review Fix Round 2/5 (2026-08-29)

Fix starting HEAD: `3de665c`
Fix commit: `d5f4425`

### Outcome and design decisions

1. Runtime release migration now acquires the same teaching-content transaction advisory write lock used by permanent question deletion before every published-paper or paper-release-history mapper attempt. The lock is reacquired after rollback, and migration ordering now has a stable item-ID tie-breaker so the remaining pending release mapper cannot be skipped after a rollback.
2. The admin reference snapshot is no longer allowed to authorize local permanent subject/taxonomy deletion. Those mutations currently persist through the legacy local management transaction, so a fresh server snapshot would still leave a check-to-delete race with other teachers/tabs. Production therefore fails closed for permanent subject and taxonomy deletion while retaining non-destructive deactivate/archive flows. This is a Task 5 safety gate. It may be removed only after subject/taxonomy deletion is moved to a backend transaction that performs the authoritative formal question/draft paper/immutable release reference check under the same teaching-content lock and commits the destructive mutation atomically.
3. Paper mutation adapters now update/invalidate authoritative detail/list caches before broadcasting `kg:paper-drafts-changed`. The production page uses the changed response paper ID as its preferred selection. Native create/save therefore settles on the new/edited paper in one visible path.
4. The browser matrix now also creates and permanently deletes a disposable empty bank through visible page controls. The paper save retry loop and the old-selection/manual-reselect workaround were removed.

No Alembic migration, Runtime policy, immutable release, active release pointer, deployment, main, or UAT file changed.

### Files changed

- `backend/app/services/runtime_domain_migration_service.py`
- `backend/tests/test_runtime_domain_migration_ledger.py`
- `frontend/e2e/shared_teacher_workspace.py`
- `frontend/scripts/new-legacy-assets/paper-draft-adapter.js`
- `frontend/scripts/paper-draft-adapter.test.mjs`
- `new-legacy/src/65-question-bank-admin.js`
- `new-legacy/src/admin/30-reference-index-service.js`
- `new-legacy/src/admin/31-subject-service.js`
- `new-legacy/src/admin/32-taxonomy-service.js`
- `new-legacy/src/admin/40-admin-service-registry.js`
- `new-legacy/src/admin/51-admin-subjects-app.js`
- `new-legacy/tests/paper-quota-ui-integration.test.js`
- `new-legacy/tests/question-paper-runtime-free.test.js`

### Strict TDD evidence

#### Migration writer lock and rollback reacquisition

RED:

```text
$ cd backend && .venv/bin/python -m pytest \
  tests/test_runtime_domain_migration_ledger.py::test_release_migration_serializes_against_permanent_question_delete \
  tests/test_runtime_domain_migration_ledger.py::test_migration_reacquires_teaching_lock_after_mapper_rollback -q
FAILED ... test_release_migration_serializes_against_permanent_question_delete - Failed: DID NOT RAISE TimeoutError
FAILED ... test_migration_reacquires_teaching_lock_after_mapper_rollback - assert [] == [True, True]
2 failed, 1 warning in 0.44s
```

After adding the lock, the whole ledger exposed a real rollback-order boundary: equal timestamps could reorder the refreshed list and leave the second mapper pending. A stable `RuntimeMigrationItem.id` tie-breaker fixed that failure path.

GREEN:

```text
$ cd backend && .venv/bin/python -m pytest tests/test_runtime_domain_migration_ledger.py -q
13 passed, 1 warning in 1.37s
```

The concurrency test pauses after the immutable `PaperReleaseQuestion` flush, proves permanent deletion blocks until the migration transaction commits, then proves deletion returns 409 and both the question and release reference remain. The rollback test proves two lock acquisitions around a mapper rollback and one subsequent successful migration.

#### Stale admin snapshot fail-closed behavior

RED:

```text
$ node --test --test-name-pattern='production subject and taxonomy permanent deletes fail closed' new-legacy/tests/question-paper-runtime-free.test.js
not ok - production subject and taxonomy permanent deletes fail closed after snapshot hydration
Expected values to be strictly equal: true !== false
1 failed
```

GREEN:

```text
$ cd new-legacy && node --test tests/question-paper-runtime-free.test.js
1..7
# pass 7
# fail 0
```

The test hydrates an initially empty typed server snapshot, then simulates another teacher creating a formal server reference after hydration. Both production subject and taxonomy permanent-delete calls remain blocked and neither local save method runs. A behavioral DOM harness also proves the shell does not render reference metrics and the subjects/settings destructive/index controls are not bound while hydration is pending; after load failure, the subject delete and settings rebuild controls remain disabled/unbound and the shell renders the visible fail-closed state. This replaces the previous lexical readiness assertions.

#### Paper adapter/page event and selection race

Adapter RED:

```text
$ node --test --test-name-pattern='paper mutation caches settle' frontend/scripts/paper-draft-adapter.test.mjs
not ok - paper mutation caches settle before change observers reload the selected paper
Expected 'paper-new'; actual 'paper-old'
1 failed
```

Page RED:

```text
$ node --test --test-name-pattern='paper page prefers' new-legacy/tests/paper-quota-ui-integration.test.js
not ok - paper page prefers the changed paper id when a create event races the prior selection
TypeError: api.paperChangePreferredId is not a function
1 failed
```

GREEN:

```text
$ cd frontend && node --test --test-name-pattern='paper mutation caches settle' scripts/paper-draft-adapter.test.mjs
1 passed

$ cd new-legacy && node --test --test-name-pattern='paper page prefers' tests/paper-quota-ui-integration.test.js
1 passed
```

The adapter observer now sees the response-backed detail without an extra detail GET and sees an invalidated/refetched list containing the new paper. The page contract selects `event.detail.payload.paper.id` over the old selection.

### Native browser matrix

Final command and result:

```text
$ /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 \
  frontend/e2e/shared_teacher_workspace.py --question-paper-only --assert-no-runtime
task7-isolated-server ... candidateFiles=979 activeFiles=975 ...
question-paper-e2e-ok nativeCrud=bank,question,category,paper publish=1 withdraw=1 validationRecovery=1 apiFailureRecovery=2 roleDenial=2 runtimeRequests=0 refresh=2 relogin=1 cleanup=isolated-db-drop
```

All business actions use native visible controls. Request context is limited to the preflight-qualified publish fixture, independent outcome verification, and isolated cleanup. The new paper is active with its delete control enabled immediately after the single visible create; the single visible save receives one successful PUT and is independently verified. There is no fixed sleep, forced/hidden click, save retry, old-selection wait, or manual reselect.

### Final verification

```text
$ cd backend && .venv/bin/python -m pytest \
  tests/test_runtime_domain_migration_ledger.py \
  tests/test_question_api_compatibility.py \
  tests/test_paper_draft_api.py tests/test_paper_releases.py \
  tests/test_paper_access_entitlements.py -q
46 passed, 1 warning in 21.05s

$ cd frontend && pnpm sync:new-legacy && pnpm test
1..276
# pass 276
# fail 0

$ cd new-legacy && node --test tests/question-paper-runtime-free.test.js
1..7
# pass 7
# fail 0

$ cd new-legacy && node --test --test-name-pattern='paper page prefers' tests/paper-quota-ui-integration.test.js
1 passed

$ cd new-legacy && node tests/paper-management-api-contract.test.js
paper-management-api-contract-ok

$ cd backend && .venv/bin/alembic heads
c8e4f1a2b930 (head)
```

The Starlette `python_multipart` pending-deprecation warning remains pre-existing.

### Self-review and cleanup

- Runtime release writers and question deletion now share one transaction-level advisory lock; rollback retries reacquire it.
- Local permanent subject/taxonomy deletion cannot fail open on pending, failed, or stale formal-reference snapshots.
- The native E2E reports zero Runtime requests and now truthfully covers bank deletion as part of bank CRUD.
- Both Runtime policy JSON files remain byte-equivalent.
- `git diff --check` passes.
- Generated `frontend/public/new-legacy`, manifest, and sync-report output was restored/removed after verification.
- No active release, immutable release, migration, main/UAT/deployment, or promotion file changed.

### Concerns

1. Permanent subject/taxonomy deletion is intentionally unavailable in production until Task 5 provides a backend-transactional delete with authoritative reference validation. Deactivation and taxonomy archive/restore remain available.
2. The backend virtualenv still lacks Playwright; the existing system Python 3.11 interpreter is required for the native matrix.

## Submission review round 4: async ownership and public capability closure

Each review finding was reproduced by an exact behavior test before its production change.

### Post-summary/detail TOCTOU

The deferred loader probe first failed with two publications instead of one: old summaries resolved, old detail stayed pending, create invalidation occurred, old detail resolved, and the queued reload failed. The fallback probe first failed because the production runner did not yet exist. `loadSelectedPaper` now receives `shouldApply` and checks it before initial mutation and immediately after the detail await, before every success/error publication. The extracted fallback runner applies the same post-detail guard. Both probes pass and no old state is ever published/applied.

### Coordinator intent priority

The two REDs showed a later non-create event replacing `paper-created` with `paper-old`, both during an active create reload and after a failed create reload. The coordinator now keeps explicit refresh demand and sticky create/import `selectionIntent` separately. Non-create events can request fresh data but cannot replace or invalidate that intent. Failure preserves it; a current successful result clears it only after selecting the intended ID or definitively proving it absent from fresh summaries. The three queue/active/retry behavior tests pass without sleeps or reselect workarounds.

### Complete adapter async ownership

Four deferred REDs proved that stale paper detail could overwrite mutation-cached detail or detach newer work, stale category list could overwrite post-create categories/detach newer work, and an old rejected ready could clear the newer ready promise. The adapter now owns per-paper-ID generations, a category-list generation, and a ready generation. Cache writes and cleanup require the current generation; shared cleanup also requires exact promise identity. Paper/category mutations invalidate their exact older owners before installing new state.

```text
$ cd frontend && node --test scripts/question-catalog-adapter.test.mjs scripts/paper-draft-adapter.test.mjs scripts/paper-management-data-loader.test.mjs scripts/paper-release-adapter.test.mjs scripts/runtime-retirement-contract.test.mjs
1..54
# pass 54
# fail 0
```

### Public service graph and authenticated reconciliation

The first production graph RED reached raw writer identities through `KGAdminServices.references.content.*`; the old gateway also depended on a public unchecked reconcile method. A later full inventory RED found equivalent arbitrary local-projection writers at `KGAdminServices.repository.write/remove/restore` and `transactions.execute/restoreSnapshot`.

The registry now exposes frozen method-only facades for domain services and narrow infrastructure facades. Repository is not public; audit clear, arbitrary transaction execute, and snapshot restore are not public. `rg` over the real admin callers found only `permissions.can/summary`, `audit.list/record/summary`, and `transactions.createSnapshot/snapshots`; a production-class behavior test invokes every one successfully plus `permissions.currentUser` and the compatibility `repositoryMode` read. Raw service dependencies remain closure-private.

The gateway script now registers a factory before the registry loads. The registry passes a closure-bound private reconcile callback and deletes the factory global. The only public reconciliation path follows an authenticated `credentials: 'include'` server request. Reconciliation validates subject/taxonomy identity and taxonomy content, rejects collisions with local draft/history, preserves unrelated versions, replaces only the authenticated current projection, and compensates both taxonomy and subject arrays if the pointer write fails. Reference invalidation occurs only after success. Malformed no-mutation and rollback behavior tests use production taxonomy/registry methods.

`admin-subjects.html` and `content-center.html` only change script order so the gateway factory is available before registry closure assembly. The gateway suite is now `6/6` GREEN, including recursive public-graph reachability and production infrastructure-facade behavior.

### Visible blocked reset

The content-center RED recorded undo history and showed success after `{valid:false}`. The handler now inspects the result before history or `subjectChanged`, leaves history unchanged, and shows the returned recoverable failure. Both hydration/reset behavior tests pass.

### Native E2E regression discovered under RED

The first native run timed out on the configured paper candidate. Read-only diagnostics proved: browser response `200` with one question; `paperDataLoader.snapshot()` had one candidate/total one; page state had zero candidates. Root cause was the extracted reload runner capturing `paperDataLoader === null` during module initialization. The create event later used fallback and applied a candidate-less snapshot over the real loader result. A focused test first failed with `fallback apply must not run`; the runner now resolves `getPaperDataLoader()` at request execution time. All diagnostics were removed.

```text
$ /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 frontend/e2e/shared_teacher_workspace.py --question-paper-only --assert-no-runtime
question-paper-e2e-ok nativeCrud=bank,question,category,paper publish=1 withdraw=1 validationRecovery=1 apiFailureRecovery=2 roleDenial=2 runtimeRequests=0 refresh=2 relogin=1 cleanup=isolated-db-drop
```

### Round 4 final verification

```text
$ cd backend && .venv/bin/python -m pytest tests/test_runtime_domain_migration_ledger.py tests/test_question_api_compatibility.py tests/test_paper_draft_api.py tests/test_paper_releases.py tests/test_paper_access_entitlements.py -q
46 passed, 1 pre-existing Starlette warning in 22.76s

$ cd backend && .venv/bin/alembic heads
c8e4f1a2b930 (head)

$ cd frontend && pnpm sync:new-legacy && pnpm test
1..283
# pass 283
# fail 0

$ cd new-legacy && node --test tests/question-paper-runtime-free.test.js tests/admin-teaching-content-server-gateway.test.js tests/content-center-server-hydration.test.js
1..15
# pass 15
# fail 0

$ cd new-legacy && node --test --test-name-pattern='paper page queues|non-create refresh|failed create reload|fallback paper reload|paper reload runner' tests/paper-quota-ui-integration.test.js
1..5
# pass 5
# fail 0

$ cmp -s frontend/scripts/runtime-page-policy.json backend/app/web/runtime_page_policy.json \
  && <formal Task 3 storage/Runtime scan> \
  && <changed JavaScript syntax checks> \
  && git diff --check
contracts-syntax-diff-ok
```

Generated `frontend/public/new-legacy`, sync report, and manifests were restored to HEAD after verification; the six exact untracked sync copies were removed. No immutable release, active pointer, `main`, UAT branch, or deployment target changed.

### Round 4 detailed RED/GREEN transcript

This round handled each independent-review finding with an exact failing behavior probe before changing production code.

### Detail TOCTOU after summary refresh

RED:

```text
$ cd frontend && node --test --test-name-pattern='invalidation while old detail is pending' scripts/paper-management-data-loader.test.mjs
not ok - invalidation while old detail is pending blocks every later old publish even when the replacement fails
Expected publication count: 1
Actual publication count:   2

$ cd new-legacy && node --test --test-name-pattern='fallback paper reload cannot apply old detail' tests/paper-quota-ui-integration.test.js
not ok - fallback paper reload cannot apply old detail after create invalidation when the queued reload fails
TypeError: api.createPaperReloadRunner is not a function
```

GREEN: `loadSelectedPaper` now receives the coordinator's `shouldApply` capability and checks it before initial mutation and immediately after the awaited detail, before every success/error publication. The no-loader fallback uses the same post-detail guard through the production runner.

```text
$ cd frontend && node --test scripts/paper-management-data-loader.test.mjs
# pass 8
# fail 0

$ cd new-legacy && node --test --test-name-pattern='fallback paper reload' tests/paper-quota-ui-integration.test.js
# pass 1
# fail 0
```

Both probes resolve old summaries, hold old detail pending, invalidate with a create intent, resolve old detail, then fail the queued reload; no old detail/snapshot is published or applied.

### Sticky create/import selection intent

RED:

```text
not ok - non-create refresh during an active create reload keeps the create selection intent
Expected second preferred ID: paper-created
Actual second preferred ID:   paper-old

not ok - failed create reload keeps its preferred id for a later non-create retry
Expected retried selection: paper-created
Actual retried selection:   paper-old
```

GREEN: the reload coordinator now keeps an explicit `selectionIntent` distinct from refresh demand. Create/import replaces that intent; later non-create events may queue fresh data but cannot invalidate or replace the sticky ID. A failed reload retains the intent. A current successful reload clears it only after selecting the intended ID or after a fresh summary set definitively proves the ID absent.

```text
$ cd new-legacy && node --test --test-name-pattern='paper page queues|non-create refresh|failed create reload' tests/paper-quota-ui-integration.test.js
# pass 3
# fail 0
```

No fixed delay, manual reselect, or retry sleep was introduced.

### Adapter promise/cache ownership

Four deferred probes first reproduced the stale-owner failures:

```text
not ok - an old paper detail cannot overwrite a mutation-cached detail
not ok - an old paper detail cannot detach or overwrite a newer detail load for the same id
not ok - an old category list cannot overwrite post-create categories or detach newer work
not ok - an old rejected ready cannot clear a newer ready promise
```

The adapter now has per-paper-ID detail generations, a category-list generation, and a ready generation. Every shared-promise cleanup checks both generation and exact promise identity; every cache write checks its generation. Paper mutations increment the exact paper generation before installing the returned detail, and category mutations invalidate the old list generation before installing/refetching current state.

GREEN:

```text
$ cd frontend && node --test scripts/question-catalog-adapter.test.mjs scripts/paper-draft-adapter.test.mjs scripts/paper-management-data-loader.test.mjs scripts/paper-release-adapter.test.mjs scripts/runtime-retirement-contract.test.mjs
1..54
# pass 54
# fail 0
```

### Public admin graph and authenticated projection reconciliation

Production-method integration tests initially proved two independent exposures: the gateway could not be safely constructed before registry initialization, and a recursive public-graph scan reached raw writer identities through `KGAdminServices.references.content.*`. The old public taxonomy reconcile method was also an unchecked projection replacement path.

The registry now publishes frozen, method-only facades for references, subjects, taxonomies, activities, courses, and releases. Raw service dependencies (`legacy`, `content`, `organization`) stay inside the registry closure. The server gateway is registered first as a factory; the registry then supplies its private taxonomy reconcile callback and removes the factory global. The only public hydration path therefore performs an authenticated `credentials: 'include'` request before invoking the private capability.

Reconciliation validates the subject and taxonomy identity/payload, rejects collisions with local drafts/history, preserves every unrelated local version, and replaces only the authenticated current projection. It updates taxonomy and subject pointer as one compensated local operation: failure of the pointer write restores both previous arrays. Reference invalidation occurs only after success.

GREEN:

```text
$ cd new-legacy && node --test tests/admin-teaching-content-server-gateway.test.js
1..6
# pass 6
# fail 0
```

The public graph is recursively checked against the production legacy writer identities (`saveSubjects`, `saveTaxonomies`, `deleteKnowledgeNode`, reset equivalents) and against unchecked reconcile methods. Real gateway hydration, malformed rejection without mutation, and compensated rollback are all covered by production service/registry methods rather than handwritten service fakes.

The final inventory added a second RED for equivalent generic writers: public `repository.write/remove/restore` and `transactions.execute/restoreSnapshot`. Repository is no longer public; permissions, audit, and transactions now expose narrow frozen facades. `rg` over real admin callers plus a production-class behavior test proves every required page call remains available without exposing a composable arbitrary-write capability.

`admin-subjects.html` and `content-center.html` only change script order: `42-teaching-content-server-gateway.js` must register its factory before `40-admin-service-registry.js` binds the non-public reconcile capability. Both pages use the same closure-based assembly.

### Visible blocked-reset recovery

RED proved that a blocked `{valid:false}` taxonomy reset still appended undo history and later presented success. GREEN makes the content-center handler inspect the result first, retain history unchanged, avoid `subjectChanged`, and show a truthful retryable failure including returned errors.

```text
$ cd new-legacy && node --test tests/content-center-server-hydration.test.js
1..2
# pass 2
# fail 0
```

### Native E2E regression found and fixed under RED

The first native run failed waiting for the configured publish-fixture candidate after selecting its bank. Read-only diagnostics proved all three layers separately:

```text
browser response: 200, questions.length=1
paperDataLoader.snapshot(): candidateQuestions.length=1, candidateTotal=1
page state: paperCandidateRows.length=0, paperCandidateTotal=0
```

Root cause: `createPaperReloadRunner` had captured `paperDataLoader === null` during module initialization. A create event therefore used the fallback runner after the real candidate request and applied a candidate-less snapshot over the page, while the loader itself retained the correct question. The focused production-API probe went RED with `fallback apply must not run`. The runner now resolves `getPaperDataLoader()` at request execution time; all temporary diagnostics were removed.

```text
$ cd new-legacy && node --test --test-name-pattern='paper reload runner resolves the page loader after page initialization' tests/paper-quota-ui-integration.test.js
# pass 1
# fail 0

$ /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 frontend/e2e/shared_teacher_workspace.py --question-paper-only --assert-no-runtime
question-paper-e2e-ok nativeCrud=bank,question,category,paper publish=1 withdraw=1 validationRecovery=1 apiFailureRecovery=2 roleDenial=2 runtimeRequests=0 refresh=2 relogin=1 cleanup=isolated-db-drop
```

### Round 4 verification and cleanup

```text
$ cd backend && .venv/bin/python -m pytest tests/test_runtime_domain_migration_ledger.py tests/test_question_api_compatibility.py tests/test_paper_draft_api.py tests/test_paper_releases.py tests/test_paper_access_entitlements.py -q
46 passed, 1 pre-existing Starlette warning in 22.76s

$ cd backend && .venv/bin/alembic heads
c8e4f1a2b930 (head)

$ cd frontend && pnpm sync:new-legacy && pnpm test
1..283
# pass 283
# fail 0

$ cd new-legacy && node --test tests/question-paper-runtime-free.test.js tests/admin-teaching-content-server-gateway.test.js tests/content-center-server-hydration.test.js
1..15
# pass 15
# fail 0

$ cd new-legacy && node --test --test-name-pattern='paper page queues|non-create refresh|failed create reload|fallback paper reload|paper reload runner' tests/paper-quota-ui-integration.test.js
1..5
# pass 5
# fail 0

$ cmp -s frontend/scripts/runtime-page-policy.json backend/app/web/runtime_page_policy.json \
  && <formal Task 3 storage/Runtime source scan> \
  && <changed JavaScript syntax checks> \
  && git diff --check
contracts-syntax-diff-ok
```

The generated `frontend/public/new-legacy` tree, sync report, and manifests were restored to HEAD after verification; the six exact untracked generated copies created by sync were removed. No immutable release, active pointer, `main`, UAT branch, or deployment target was changed.

---

## Review Fix Round 3/5 (2026-08-29)

Fix starting HEAD: `d5f4425`
Fix commit: `5d3d5cf`

### Outcome and design decisions

1. Paper summary requests now carry an adapter generation. A list response may update the shared summary cache only when its generation is still current, and an old request may clear the in-flight slot only when it still owns that exact promise. Create/invalidate therefore cannot be overwritten or detached by an older response.
2. The paper page now coalesces reloads through a coordinator. A create/import event queues its intentional preferred paper ID even while another reload is pending; later update/archive lifecycle events cannot replace that queued selection. Only create/import change the event-derived preferred ID. Delete keeps the existing ID and falls back naturally if that ID disappears from the returned summaries.
3. Subject/taxonomy destructive authority is centralized through each service's fail-closed `permanentDeleteCheck` gateway. `SubjectService.saveAll` rejects ID-set shrinkage, `TaxonomyService.saveAll` rejects node-set shrinkage, node check/delete uses the same authority, and the compatibility facade routes `resetTaxonomies` through the guarded service instead of exposing the legacy reset. Missing authority itself fails closed.
4. This is intentionally the Task 5 safety gate: subject/taxonomy/node permanent removal still persists through local legacy management transactions, so it cannot be made atomic with authoritative server question, draft-paper, and immutable-release reference validation in Task 3. Recovery requires Task 5 to provide a backend destructive endpoint that performs the reference check and mutation under the same teaching-content transaction/write lock; only then may `requiresServerTransactionalDelete` permit permanent removal.
5. Admin subjects/settings bind permission-allowed safe controls before reference hydration. Create/edit/deactivate/move/import/archive/restore and health/snapshot functions remain available when the snapshot is pending or failed. Reference-dependent permanent delete and index rebuild remain visibly disabled/fail closed.
6. The E2E failure dialog is accepted by a registered dialog listener while `expect_event` provides the condition wait. This fixes an orchestration deadlock where the click had completed but Playwright waited for scheduled navigation while the alert was still open. It is not a product defect and uses no fixed sleep, force click, or hidden control.

No backend model/migration, Runtime policy, generated public tree, immutable release, active release pointer, deployment, main, or UAT file changed.

### Files changed

- `frontend/e2e/shared_teacher_workspace.py`
- `frontend/scripts/new-legacy-assets/paper-draft-adapter.js`
- `frontend/scripts/new-legacy-assets/paper-management-data-loader.js`
- `frontend/scripts/paper-draft-adapter.test.mjs`
- `frontend/scripts/paper-management-data-loader.test.mjs`
- `new-legacy/src/65-question-bank-admin.js`
- `new-legacy/src/admin/30-reference-index-service.js`
- `new-legacy/src/admin/31-subject-service.js`
- `new-legacy/src/admin/32-taxonomy-service.js`
- `new-legacy/src/admin/40-admin-service-registry.js`
- `new-legacy/src/admin/41-learning-content-compat.js`
- `new-legacy/src/admin/42-teaching-content-server-gateway.js`
- `new-legacy/src/admin/51-admin-subjects-app.js`
- `new-legacy/src/admin/53-admin-settings-app.js`
- `new-legacy/tests/admin-teaching-content-server-gateway.test.js`
- `new-legacy/tests/paper-quota-ui-integration.test.js`
- `new-legacy/tests/question-paper-runtime-free.test.js`

### Strict TDD evidence

#### Overlapping paper list/create generation

RED:

```text
$ cd frontend && node --test --test-name-pattern='older pending paper list' scripts/paper-draft-adapter.test.mjs
not ok - an older pending paper list cannot overwrite or detach the post-create generation
Expected values to be strictly equal:
+ actual: paper-old
- expected: paper-new
1 failed
```

GREEN:

```text
$ cd frontend && node --test --test-name-pattern='older pending paper list' scripts/paper-draft-adapter.test.mjs
1..1
# pass 1
# fail 0
```

#### Page reload queue and lifecycle selection

Initial coordinator RED:

```text
$ cd new-legacy && node --test --test-name-pattern='queues the newest preferred id' tests/paper-quota-ui-integration.test.js
not ok - paper page queues the newest preferred id when a reload is already pending
TypeError: api.createPaperReloadCoordinator is not a function
1 failed
```

The lifecycle-order extension then reproduced the exact overwrite:

```text
$ cd new-legacy && node --test --test-name-pattern='queues the newest preferred id' tests/paper-quota-ui-integration.test.js
not ok - paper page queues the newest preferred id when a reload is already pending
Expected: [ 'paper-old', 'paper-new' ]
Actual:   [ 'paper-old', 'paper-old' ]
1 failed
```

Preferred-action RED:

```text
$ cd new-legacy && node --test --test-name-pattern='changes preferred selection' tests/paper-quota-ui-integration.test.js
not ok - paper page changes preferred selection only for create and import events
Expected 'paper-imported'; actual 'paper-old'
1 failed
```

GREEN:

```text
$ cd new-legacy && node --test --test-name-pattern='paper page (changes preferred selection|queues the newest preferred id)' tests/paper-quota-ui-integration.test.js
1..2
# pass 2
# fail 0
```

The pending test starts reload `paper-old`, queues intentional create `paper-new`, then submits a non-create refresh retaining `paper-old`; the executed sequence remains exactly `paper-old`, `paper-new`.

#### Complete subject/taxonomy/node fail-closed inventory

RED, one bypass at a time:

```text
$ cd new-legacy && node --test --test-name-pattern='production subject and taxonomy permanent' tests/question-paper-runtime-free.test.js
not ok - production subject and taxonomy permanent deletes fail closed after snapshot hydration
Expected subjectBulkResult.valid false; actual true
1 failed

$ cd new-legacy && node --test --test-name-pattern='production subject and taxonomy permanent' tests/question-paper-runtime-free.test.js
not ok - production subject and taxonomy permanent deletes fail closed after snapshot hydration
Expected compatReset.valid false; actual undefined
1 failed
```

GREEN:

```text
$ cd new-legacy && node --test --test-name-pattern='production subject and taxonomy permanent' tests/question-paper-runtime-free.test.js
1..1
# pass 1
# fail 0
```

The behavior test proves direct bulk subject shrink, direct taxonomy node shrink, node precheck/delete, compatibility subject/taxonomy bulk saves, compatibility node delete, and compatibility full taxonomy reset all return blocked without invoking any legacy save/delete/reset writer.

#### Safe admin capabilities while destructive authority is unavailable

RED:

```text
$ cd new-legacy && node --test --test-name-pattern='reference failure blocks destructive index actions' tests/question-paper-runtime-free.test.js
not ok - reference failure blocks destructive index actions but keeps safe subjects and settings controls usable
Expected add-subject click listener count 1; actual 0
1 failed
```

GREEN:

```text
$ cd new-legacy && node --test --test-name-pattern='reference failure blocks destructive index actions' tests/question-paper-runtime-free.test.js
1..1
# pass 1
# fail 0
```

The DOM harness actually opens the add-subject dialog while hydration is pending and again after failure, creates snapshots before and after failure, and invokes health checks after failure. It independently proves subject delete remains disabled and reference-index rebuild remains disabled and unbound.

#### Submission review follow-up: stale page publication and public bypasses

The required submission review found that adapter cache generation alone did not stop an already-running data-loader refresh from briefly publishing the old summaries/selection before the queued create reload. It also found that `KGAdminServices.legacyContent` still publicly exposed raw destructive writers and that duplicate taxonomy IDs could preserve array length while deleting another taxonomy by omission.

RED:

```text
$ cd frontend && node --test --test-name-pattern='invalidated pending paper refresh' scripts/paper-management-data-loader.test.mjs
not ok - an invalidated pending paper refresh cannot publish stale summaries or selection
Expected false; actual true
1 failed

$ cd new-legacy && node --test --test-name-pattern='queues the newest preferred id' tests/paper-quota-ui-integration.test.js
not ok - paper page queues the newest preferred id when a reload is already pending
Expected applied [ 'paper-new' ]; actual [ 'paper-old', 'paper-new' ]
1 failed

$ cd new-legacy && node --test --test-name-pattern='production subject and taxonomy permanent' tests/question-paper-runtime-free.test.js
not ok - production subject and taxonomy permanent deletes fail closed after snapshot hydration
public legacyContent exposes saveSubjects
Actual: [Function: saveSubjects]; expected undefined
1 failed

$ cd new-legacy && node --test --test-name-pattern='production subject and taxonomy permanent' tests/question-paper-runtime-free.test.js
not ok - production subject and taxonomy permanent deletes fail closed after snapshot hydration
Expected duplicateTaxonomyBulkResult.valid false; actual true
1 failed
```

GREEN:

```text
$ cd frontend && node --test --test-name-pattern='invalidated pending paper refresh' scripts/paper-management-data-loader.test.mjs
1..1
# pass 1
# fail 0

$ cd new-legacy && node --test --test-name-pattern='queues the newest preferred id' tests/paper-quota-ui-integration.test.js
1..1
# pass 1
# fail 0

$ cd new-legacy && node --test --test-name-pattern='production admin registry|production subject and taxonomy permanent' tests/question-paper-runtime-free.test.js \
  && node --test tests/admin-teaching-content-server-gateway.test.js
1..2
# pass 2
# fail 0
1..2
# pass 2
# fail 0
```

The page reload coordinator now increments its generation when it accepts a replacement request and passes `isCurrent` into the loader. An invalidated reload returns to its caller but cannot publish summaries, selection, or detail-loading state. The coordinator restarts draining directly rather than recursively issuing an empty-preference request. Public `legacyContent` is a frozen read view; authoritative server taxonomy hydration uses the existing taxonomy service through a purpose-specific projection reconciliation method. Taxonomy bulk save requires an exact unique ID set and invokes the common destructive authority on any omission.

The reviewer also suggested promoting generated/active release output. That conflicts with this task's explicit prohibition on hand-editing/committing generated `frontend/public/new-legacy`, immutable releases, or release promotion. The authoritative source was synced into the generated candidate for all frontend contracts, then the generated output was cleaned as required.

#### Native failure-recovery orchestration boundary

Observed failure before the condition-wait correction:

```text
$ /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 frontend/e2e/shared_teacher_workspace.py --question-paper-only --assert-no-runtime
Locator.click: Timeout 30000ms exceeded
- click action done
- waiting for scheduled navigations to finish
```

The native bank-save handler had already raised the expected visible alert. `expect_event` observed it but the test accepted it only after `click()` returned, creating a synchronization deadlock. Registering an accept listener before the click while retaining `expect_event` as the condition wait resolved the orchestration defect.

GREEN:

```text
$ /Library/Frameworks/Python.framework/Versions/3.11/bin/python3 frontend/e2e/shared_teacher_workspace.py --question-paper-only --assert-no-runtime
task7-isolated-server ... candidateFiles=979 activeFiles=975 ...
question-paper-e2e-ok nativeCrud=bank,question,category,paper publish=1 withdraw=1 validationRecovery=1 apiFailureRecovery=2 roleDenial=2 runtimeRequests=0 refresh=2 relogin=1 cleanup=isolated-db-drop
```

### Final verification

```text
$ cd backend && .venv/bin/python -m pytest \
  tests/test_runtime_domain_migration_ledger.py \
  tests/test_question_api_compatibility.py \
  tests/test_paper_draft_api.py tests/test_paper_releases.py \
  tests/test_paper_access_entitlements.py -q
46 passed, 1 warning in 21.65s

$ cd new-legacy && node --test tests/question-paper-runtime-free.test.js tests/admin-teaching-content-server-gateway.test.js
1..9
# pass 9
# fail 0

$ cd new-legacy && node --test --test-name-pattern='paper page (changes preferred selection|queues the newest preferred id)' tests/paper-quota-ui-integration.test.js
1..2
# pass 2
# fail 0

$ cd new-legacy && node tests/paper-management-api-contract.test.js
paper-management-api-contract-ok

$ cd frontend && pnpm sync:new-legacy && pnpm test
tests 278
pass 278
fail 0

$ cd frontend && node --test scripts/question-catalog-adapter.test.mjs scripts/paper-draft-adapter.test.mjs scripts/paper-management-data-loader.test.mjs scripts/paper-release-adapter.test.mjs scripts/runtime-retirement-contract.test.mjs
1..49
# pass 49
# fail 0

$ cd backend && .venv/bin/alembic heads
c8e4f1a2b930 (head)

$ cmp -s frontend/scripts/runtime-page-policy.json backend/app/web/runtime_page_policy.json \
  && <formal storage/Runtime source scan> \
  && <JavaScript/Python syntax checks> \
  && git diff --check
contracts-ok
```

The Starlette `python_multipart` pending-deprecation warning remains pre-existing.

### Self-review and cleanup

- Cache ownership uses both generation identity and exact promise identity; a stale request can return to its own caller but cannot mutate or detach current shared state.
- Reload coalescing preserves the newest intentional create/import selection, does not let non-create lifecycle notifications override it, and generation-gates loader publication so an active stale reload cannot regress visible state.
- Every exposed production subject/taxonomy/knowledge-node permanent-removal path found in the common services, compatibility facade, bulk saves, and reset facade is fail closed. Safe lifecycle operations do not call the destructive authority gate.
- The registry no longer exposes raw legacy destructive writers; taxonomy projection hydration remains covered by its two existing positive/error gateway behavior tests.
- Admin behavior tests trigger representative safe controls instead of relying on source-string readiness assertions.
- E2E retains one visible paper create/save path, no save retry, no manual reselect, no fixed sleep, no hidden/forced click, and zero Runtime requests.
- Generated `frontend/public/new-legacy`, manifest, and sync report were restored/removed after verification. No immutable release or active pointer changed.
- Runtime policies remain byte-equivalent; formal question/paper sources remain free of retired persistence keys; syntax and `git diff --check` pass.

### Concerns

1. Permanent subject/taxonomy/node removal is intentionally unavailable until Task 5 supplies a backend-transactional reference check plus deletion under the teaching-content lock. Non-destructive deactivate/archive/restore remains the supported recovery path meanwhile.
2. The backend virtualenv still lacks Playwright; the existing system Python 3.11 interpreter is required for the native matrix.
