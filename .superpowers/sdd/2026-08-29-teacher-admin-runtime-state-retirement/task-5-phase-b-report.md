# Task 5 Phase B Report: Teaching Catalog Runtime Retirement

Date: 2026-08-30
Branch: `codex/runtime-retirement-execution`
Starting commit: `fea8491`
Alembic head: `e2c6f8a1b304`

## Outcome

The five remaining teaching-catalog resources now use the relational shared-content API as their only online authority: subjects, taxonomies, activity overrides, activity tags, and activity collections. Runtime GET/bootstrap no longer exposes those keys and Runtime PUT rejects them as server-owned. `admin-subjects.html`, `content-center.html`, and `content-prep.html` have been removed from both Runtime page policies.

Course/release/task reference reads on Content Center remain available through the Task 6 relational APIs; their four compatibility Runtime keys were not migrated or removed here. Historical catalog Runtime rows remain in the database only for migration/rollback tooling and are not returned by the online Runtime API.

## Implementation

- Extended shared-content schemas and service serialization for complete subject, taxonomy, activity, tag, and collection round trips, including strict JSON and activity-tag metadata.
- Added the `d1a4c7e9f205` ActivityTag JSONB migration with online upgrade/downgrade and offline SQL coverage.
- Applied every catalog replacement under the global teaching writer lock with optimistic `contentRevision`, one transactional revision bump, conflict-safe rollback, and identical-snapshot no-op behavior.
- Added relationship invariants and fail-closed deletion scans across questions, papers/releases, course drafts/releases, learning tasks, activity knowledge nodes/tags, and collection references. Hidden tag/activity namespaces are isolated by subject and removed when empty.
- Retired the alternate subject/taxonomy/activity mutation routes as deprecated HTTP 410 contracts and removed their dormant service implementations. Recall's compatibility route remains revision checked.
- Extended `KGTeachingContentApi` and the existing repository/service facades so all five resources hydrate from in-memory API snapshots and authoritative writes are awaited. Full-replacement catalog conflicts refresh then reject instead of blindly retrying and overwriting another teacher.
- Converted the subject/taxonomy/activity services and the 31/32/33/51/91/93 controllers to await mutations, keep failures visible, and avoid Promise truthiness or success-before-persistence.
- Disabled the misleading Content Center activity-to-empty-paper action because the typed paper API has no activity-ID contract; it now gives an explicit product-boundary message and performs no browser persistence.
- Removed the five keys from the frontend storage contract and Runtime shared sets. The Content Prep template now retains the direct-bootstrap anchor without `server-state-bootstrap.js`; its dist was rebuilt.
- Formal sync generated the reproducible `frontend/public/new-legacy`, manifest, and sync report artifacts committed with this review follow-up. The candidate contains 991 files versus 975 in the older active release; all required teaching pages are present. No active or immutable release was changed.

## Independent-review follow-up

- Added nullable server-owned `owner_username` foreign keys to collections, tags, and overrides. Admin and teacher now share the same boundary: each sees their own private/favorite collections plus shared collections; full replacement preserves omitted foreign-owner rows and generic errors reject tampering without leaking IDs. Hidden system namespaces remain shared-authoring resources with null owner.
- The ownership migration performs exact authorship backfill, leaves unknown legacy owners locked as null, derives missing non-PMP child subjects from their collection, and moves mismatched historical children to subject-specific hidden namespaces.
- Centralized taxonomy validation now covers object/list types, stable IDs, parent existence, self/cycle rejection, levels 1-9, continuous depth, and taxonomy identity for both catalog and direct Content Prep knowledge-tree writes. Legacy frontend descendant traversal has a visited guard.
- Recursive activity/tag/collection arrays are strictly typed; business-key uniqueness is preflighted; database integrity failures are rolled back and generalized. Subject deletion now detects recall libraries, and cross-owner reference conflicts reveal only an entity category.
- Catalog responses are built under the same writer transaction before commit, and actor-aware identical snapshots do not bump revision. Old retired mutation routes accept their real legacy payload shapes and return documented 410 without requiring the new revision field.

## TDD and verification

- Independent-review backend focused suite: 132 passed; final ownership migration/model checks: 1 + 6 passed.
- Frontend source-focused teaching/admin suite: 32 passed; its one generated-live-sync case was intentionally not rerun after generated output cleanup. The same case passed in the formal synced full suite.
- Formal synced `pnpm test`: 284/284.
- `pnpm test:design`: 5/5.
- Detached clean-checkout reproduction at the review commit: `pnpm test` 284/284 and `pnpm test:design` 5/5. The first audit exposed the ignored generated Content Prep dist page; the formal-sync output was then explicitly committed and the clean run passed.
- Native isolated Playwright teaching flow: admin subject create, taxonomy-node create, tag create, collection create, principle save, recall save, two reload persistence checks, teacher close/re-login persistence, a real two-page stale UI save that returns visible 409 without overwriting the winner, and zero Runtime/bootstrap requests across the three retired pages.
- JavaScript/Python compilation, focused five-key scans, policy/bootstrap scans, and `git diff --check`: clean.

## Browser evidence and remaining UI debt

The stable browser gate is GREEN:

```text
teaching-content-e2e-ok native=subject-create,taxonomy-node,tag,collection principle=control-plus-api recall=typed-api reload=2 relogin=1 uiConflict=409 runtimeRequests=0
```

The existing Admin Subjects edit button has a separate pointer-interaction defect: a Playwright pointer click leaves the dialog closed even though the selected subject is present, the button is enabled, and there is no page error; programmatic activation opens it. A fixed-point comparison against `fea8491` shows the dialog open/bind DOM and CSS path were not changed by Task 5B (only awaited mutation handlers changed). This follow-up does claim native teacher re-login and a UI-rendered 409 check; native subject edit remains the evidenced baseline debt.

## Scope boundary

- The exact Task 7 compatibility set remains: `kg_course_config_drafts_v1`, `kg_course_config_active_release_v1`, `kg_course_config_releases_v1`, and `kg_learning_tasks_v1`.
- Runtime migration-ledger reads of historical taxonomy rows remain migration-only.
- No Task 7 mutation page, `main`, UAT branch, deployment, push, active release, or release promotion was touched.
