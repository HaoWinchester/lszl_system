# Task 5 Phase A report — relational teaching projections

Date: 2026-08-30
Branch: `codex/runtime-retirement-execution`
Starting commit: `5cb454dc3c028a49a7c7ab346d1ecf5dd1e7bc5d`

## Scope ruling

Task 5 cannot safely remove all teaching/admin Runtime state before Task 6. The current backend has no complete typed lifecycle for subject update/status/reorder/delete, taxonomy draft/archive/restore/node editing, or activity tag/collection management. Their public admin services and transaction rollback contract are synchronous. Turning their repository writes into Promises would make `!!Promise` report success before persistence and would lose data after reload.

Phase A therefore retires only the relational projections that already have an authoritative API path: principle, synthesis preset and recall association data; taxonomy publication remains an explicit awaited API operation. It does **not** remove the three page Runtime policies and does **not** claim Task 5 complete.

Exact temporary compatibility boundaries:

- `allowedUntilTask5B`: `kg_content_subjects_v1`, `kg_content_taxonomies_v1`, `kg_content_activity_overrides_v1`, `kg_activity_tags_v1`, `kg_activity_collections_v1`, limited to the synchronous repository/lifecycle sources (`11-local-content-repository.js`, `91-learning-content-core.js`, `93-content-organization-core.js`).
- `allowedUntilTask6`: `kg_course_config_drafts_v1`, `kg_course_config_active_release_v1`, `kg_course_config_releases_v1`, `kg_learning_tasks_v1`.

## Implemented

- Removed `SharedRuntimeState` projection writes from content upload, reset and principle/preset lifecycle services. Retired Runtime principle/preset keys are server-owned and Runtime PUT now returns 403 without changing relational rows or the content revision.
- Shared-content reads principle/preset, subject/taxonomy/activity and recall data from relational tables.
- Question cleanup inventories and repairs relational paper-release and recall-library references. Its remaining Runtime scan is an exact four-key course/task compatibility set; retired taxonomy/activity/principle/preset/recall keys and prefix scans are absent.
- Added `teaching-content-adapter.js` with an in-memory snapshot, API bootstrap, one conflict reload/retry for taxonomy saves, typed recall writes, typed principle/preset writes and activity import.
- Gateway writes are ordered. A failed operation rejects its own caller, emits a visible error event, and no longer poisons later writes. There is no success-event fire-and-forget persistence.
- Principle/preset repositories and recall library are API-backed memory facades. The training principle editor, content-center recall editor, question-bank recall editor and admin recall publisher wait for the authoritative request before success feedback.
- Content Prep reads principle/preset snapshots from the shared adapter instead of browser Runtime projections. Its modular source was rebuilt into `dist/content-prep.html`.
- The synchronizer injects the adapter after the domain API client on teaching consumers. Formal sync was executed successfully for verification; broad `frontend/public/new-legacy` staging drift and sync manifests were then removed as required because Phase A is not a release task.

## TDD evidence

Backend RED initially failed three source boundaries because the two projection services imported `SharedRuntimeState`, cleanup scanned retired recall/projection keys, and projection synchronizers still existed. Frontend RED initially failed for browser storage/retired keys, the missing shared adapter, synchronous repository success and a permanently rejected gateway queue. The final boundary suites cover the complete listed source set, exact temporary keys, all recall authoring entry points, awaited principle saves, conflict retry, failed-write recovery and write ordering.

## Verification

- Backend Phase-A boundary + cleanup: 73 passed.
- Backend teaching revision: 43 passed.
- Backend shared-content: 3 passed.
- Backend banks/reference integration: 1 passed.
- Backend upload: 11 passed.
- Backend reset: 4 passed.
- Frontend Phase-A boundary: 9 passed.
- Existing admin teaching gateway: 6 passed.
- Existing recall server sync: 1 passed.
- `pnpm test`: 283 passed.
- `pnpm test:design`: 5 passed.
- Content Prep build: succeeded; Python build contract: 1 passed.
- JavaScript syntax checks and `git diff --check`: clean.

## Hard gaps for Task 5B

1. Add/finish typed endpoints for the exact `allowedUntilTask5B` lifecycles, convert 31/32/33 and their controllers/transactions to awaited mutations, then remove those five browser/Runtime keys.
2. Run Task 6 course/task migration, then remove the four `allowedUntilTask6` keys and cleanup compatibility.
3. Remove `admin-subjects.html`, `content-prep.html` and `content-center.html` from both Runtime policies only after all their data paths are typed.
4. Add the native zero-Runtime request/reload/conflict E2E in Phase B. It is intentionally not asserted in Phase A.
5. Regenerate and stage `frontend/public/new-legacy`, manifest and sync report only in the formal release task.
