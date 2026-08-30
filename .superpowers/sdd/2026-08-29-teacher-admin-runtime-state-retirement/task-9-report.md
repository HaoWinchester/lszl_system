# Task 9 Report: Runtime Freeze and Runtime-Free Release

Date: 2026-08-30
Branch: `codex/runtime-retirement-execution`
Base: `0faa5e7`

## Outcome

Phase-one Runtime is frozen by default. `GET /api/v1/runtime/state` returns
410 unless the configuration-only `RUNTIME_ROLLBACK_READ_ENABLED` opt-in is
set. Compatibility `PUT` and `POST` drain without mutating Runtime while
`RUNTIME_SYNC_DISABLED` is true. The direct bootstrap contains only
auth/release metadata and its tests monkeypatch Runtime service reads to prove
that neither learner nor admin bootstrap calls them.

Both legacy Runtime page-policy files and the executable browser bootstrap are
removed. The only release asset is the inert, exact JSON marker:

`{"schemaVersion":1,"status":"retired","runtimeRequests":0}`

The retirement drop gate accepts either the pre-deletion transition state
(both policies present and empty) or the final retired state (both policies
absent and exact marker). Any mixed, missing, or malformed combination blocks.

## TDD and regression evidence

- Initial RED: final release contract failed while policies/executable asset
  still existed; backend RED covered default GET, no-mutation drain writes,
  rollback opt-in, bootstrap Runtime-read prohibition, and final-marker gate.
- Focused backend Runtime/retirement tests: `58 passed`.
- Full backend suite: `725 passed, 1 dependency warning` in `393.13s`.
- Frontend full suite: `259 passed`; E2E contract unit suite: `6 passed`.
- Final release contracts: `17 passed`.
- Design contract: `5 passed`.
- Isolated native browser matrix: `12` pages, `runtimeRequests=0`,
  `pageErrors=0`, `consoleErrors=0`.

Historical migration-only tests explicitly opt into rollback read and legacy
sync for their own scope; the default application configuration remains
retired. The frontend compatibility allowlist now equals the explicit retained
online key set, excluding relational catalog keys retained only for offline
migration validation.

## Candidate and source checks

A disposable `manage-new-legacy --root <temporary directory>` candidate was
created without using the real release root. It had `984` files versus the
real active site's read-only `976`, all twelve required key pages, and zero
Runtime script/request references across application HTML/JS (test fixtures
excluded). The temporary release root, isolated database, and local service
were removed by the harness.

The authoritative source and generated public output both have zero
application Runtime references. Their marker SHA-256 is
`81614602f5047f20291804416169fddb92083d6b63d5f0675bab348238a9ab17`.

## Active-release safety

The real active pointer and site were read only. Before and after hashes are
identical:

| Item | SHA-256 |
| --- | --- |
| `current.json` | `db8f64ad21de59a32b07bd039de8acd00ecd94bc5052a16ba0db7dd9963eada0` |
| active site tree | `04e28df6813700d6edf4043fa81db1efe4e0326a8ed6739d8224e2cc422e3450` |

No UAT, deployment, push, merge to `main`, real active-release promotion, or
shared/live database mutation was performed.

## Review fix: side-effect-free drain and exact transition policy

The frozen PUT/POST drain no longer calls `runtime_state_service.get_state`.
It now returns the fixed compatibility values `revision=0` and
`contentRevision=0`, so a teacher/admin drain cannot trigger legacy Runtime
promotion, marker writes, or teaching-revision bumps. Its route docstring now
states the no-read/no-mutation guarantee.

The pre-deletion policy gate is also strict: each of the two present legacy
policy files must equal the historical canonical object
`{"runtimePages":[]}` exactly. Missing or extra fields, a non-empty page
array, a non-object value, or any difference between the two files blocks.
The existing final state remains both policies absent plus the exact inert
retirement marker.

TDD RED reproduced both defects. GREEN evidence:

- New drain test monkeypatches both `get_state` and `apply_update` to fail on
  any call, exercises real authenticated PUT/POST, asserts fixed zero
  revisions, and proves Runtime, shared Runtime, and teaching-revision row
  counts plus hashes are unchanged in the disposable test database.
- New gate negatives cover extra fields, version metadata, non-empty arrays,
  non-object JSON, and unequal policy pairs.
- Focused backend regression:
  `tests/test_web_runtime.py tests/test_runtime_retirement.py
  tests/test_runtime_state.py` — `58 passed, 1 dependency warning`.

## Final review fix: read-only rollback, claim drains, and device preference ownership

Rollback `GET /api/v1/runtime/state` now uses the dedicated
`get_rollback_read_state` snapshot path. It never calls legacy promotion,
bootstrap seeding, or commit; it closes its read transaction with rollback.
For both `mode=full` and `mode=bootstrap`, an authenticated admin test removes
the promotion marker, forbids `get_state` and `ensure_domain_seed`, and proves
the disposable database's Runtime, shared Runtime, and teaching-revision row
counts plus hashes remain unchanged.

The two remaining Runtime claim routes now use the same default retirement
drain (`claimed=false`, `revision=0`, `retired=true`) and never call their
Runtime service. The explicit legacy-sync migration test fixture remains the
only scope that exercises their historic write semantics. The retirement marker
validator also checks its exact key set and exact primitive types, rejecting
boolean or float values even where Python equality would otherwise equate them
to integers.

The guided-tour completion key is registered in `KGDevicePreferences.EXACT_KEYS`.
The tour now uses only that facade and has no `KGAppStorage` or direct
`localStorage` fallback. Source was synchronized into generated public assets.
The Runtime retirement contract recursively enumerates production HTML and
JavaScript (excluding test directories), including nested generated pages, for
both Runtime API paths and the retired bootstrap asset.

TDD RED reproduced rollback promotion/seed calls, claim-service calls, malformed
boolean/float/extra-field markers, and generic tour storage. Final GREEN:

- Review-specific backend tests: `3 passed, 1 dependency warning`.
- Focused backend Runtime/retirement/migration regression:
  `60 passed, 1 dependency warning`.
- Frontend source/generated/design contracts after sync: `50 passed`.

The real active hashes were re-read after synchronization and remain exactly
the values in the safety table above. No release manager command, actual active
release mutation, UAT, deployment, main merge, push, or shared database action
was performed.

## Post-review migration-test correction

One historic shared-policy promotion regression still used HTTP Runtime GET as
the first manager read. That route is deliberately read-only after retirement,
so its old assertion correctly failed without a promotion. The test now invokes
the legacy `runtime_state_service.get_state` directly under its existing
explicit legacy-sync fixture, retaining its concurrent promotion and
per-owner-draft preservation assertions while keeping production GET unchanged.

TDD evidence: the unchanged test was RED (`contentRevision` remained at the
pre-promotion value); the corrected individual test was GREEN (`1 passed`),
then the review's four Runtime test modules were GREEN (`111 passed, 1
dependency warning`). No active/UAT/deploy/main/push/shared-DB action occurred.

## Post-review snapshot-test correction

The teaching-content revision snapshot regression was still wrapping
`runtime_state_service.get_state`, while retired HTTP GET correctly calls the
dedicated `get_rollback_read_state` seam. The test now wraps that read-only
snapshot, captures the storage and content revision, then commits a competing
write. It strictly proves the HTTP response retains the captured snapshot while
the database afterwards contains the new shared value and revision increment.
Production routing and the assertion strength are unchanged.

The stale test was RED with an uncaptured snapshot; the updated individual test
was GREEN (`1 passed`) and its full module regression was GREEN (`48 passed, 1
dependency warning`). No active/UAT/deploy/main/push/shared-DB action occurred.

## Final isolated-browser save-race correction

A fresh isolated 12-page run exposed an intermittent course rename rollback.
Boundary diagnostics made the race deterministic: re-selecting the current
draft queued an old-name save, then an immediate input edit and explicit save
queued the new name. All three requests returned 200, but completion of the
older request unconditionally replaced the page's newer in-memory course, so a
later save wrote the old name back.

Course-admin persistence now assigns each course a monotonically increasing
persist epoch. A successful response updates visible page state only when its
epoch is still current; the ordered API save queue continues to own server
revision progression. Errors still refresh the authoritative server snapshot.
The browser matrix intentionally re-selects the same fixture before immediate
edit/save, waits on the actual saved-status condition rather than a fixed
timeout, and records request/response diagnostics on failure.

Evidence after the fix:

- Same-server deterministic overlap stress: `8/8` latest names persisted,
  every PUT returned 200, and each iteration settled at revision 6.
- Isolated native 12-page matrix: `runtimeRequests=0`, `pageErrors=0`,
  `consoleErrors=0`; disposable candidate `984 >= 976` active files.
- Frontend full suite after formal sync: `261 passed`; E2E contracts `6/6`;
  design contracts `5/5`.
- The immediately preceding fresh backend full suite was `727 passed, 1
  dependency warning`; this follow-up changes only browser source, generated
  artifacts, and the isolated E2E harness.

The real active pointer/site were not used as a write target. No UAT,
deployment, main merge, push, active promotion, or shared database action was
performed.
