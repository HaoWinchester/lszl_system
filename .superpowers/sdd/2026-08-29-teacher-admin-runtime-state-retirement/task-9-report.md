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
