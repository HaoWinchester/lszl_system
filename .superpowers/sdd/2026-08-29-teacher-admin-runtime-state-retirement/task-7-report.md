# Task 7 Report: Teacher/Admin Runtime Retirement

Date: 2026-08-30
Branch: `codex/runtime-retirement-execution`
Starting commit: `c67fe6383c89d58e747d133f51b92b8bb3383764`

## Outcome

Course management, teacher workbench, assessment task configuration, and the
admin console/operations/settings/subjects surfaces now use typed domain APIs
as their only business-data authority. Both Runtime page policies are exactly
`{"runtimePages": []}`. The four former course/task Runtime keys are
server-owned, absent from Runtime GET/bootstrap, and rejected by Runtime PUT.

All mutations are awaited. A 409 refreshes the authoritative snapshot once and
never resends the stale mutation; queued stale saves are invalidated until a
new user edit. Course and task creation retain server-assigned identifiers, and
tasks require a real published release.

Admin summaries are built from relational teaching/course/question/paper/
engagement/system APIs. Teacher-only 403 responses are fail-soft only for the
known restricted summary endpoints; admin 403, 5xx, and network failures remain
visible. Generic browser audit/snapshot writes are explicitly unsupported and
the retired admin-settings snapshot control cannot report false success.

Taxonomy import/release history is derived read-only from persisted taxonomy
fields; deletion results are explicitly operation-local until a typed deletion
history API exists. Lifecycle normalization now preserves publish, activation,
archive, restore, actor, notes, and deterministic last-action metadata.

## Browser Verification

`frontend/e2e/admin_runtime_retirement.py` supports two explicit modes:

- `--isolated` builds under a temporary release `--root`, uses a unique
  PostgreSQL database, and never changes the default release pointer.
- `--base-url` tests the supplied deployed target and requires dedicated admin,
  teacher, and student E2E credentials; it never silently redirects to local.

The isolated 12-page run covered admin/teacher/student access, native login and
logout, real DOM subject/course writes with reload persistence, typed API
fixtures, planned API failure and recovery, native Storage methods, absence of
`KGServerStateStorage`, and zero Runtime/bootstrap requests. Final evidence:

```text
candidateFiles=984 activeFiles=976
admin-runtime-retirement-ok pages=12 runtimeRequests=0 pageErrors=0 consoleErrors=0
```

Expected 401/403/503 browser network responses are audited independently by
exact status/path rules; they are not allowed to hide application console or
page errors.

## Verification

- Source cutover and legacy authority tests: 11 passed.
- Focused frontend Runtime/sync/release tests: 77 passed.
- Full frontend: 284 passed.
- Design contract: 5 passed.
- Focused course/system/engagement/teaching backend: 34 passed.
- Runtime shared policy and web bootstrap authority: 75 passed.
- Formal sync repeated with identical diff hash; no `__pycache__`,
  `.pytest_cache`, `.pyc`, or `.pyo` entries in source/public manifests.
- `git diff --check`: passed.

## Safety

No merge to `main`, UAT branch creation/push, deployment, remote push, default
release-root mutation, or active-release promotion was performed.
