# Task 6 Report: Relational Course Management API

Date: 2026-08-30
Branch: `codex/runtime-retirement-execution`
Starting commit: `f44ca639ec70e669a16bd1ee6cbd093b523eb1e5`
Starting Alembic head: `b9d2e4f6a810`
New Alembic head: `ca3f5a7b9d20`

## Outcome

Course drafts, immutable course releases, the active-release lifecycle, and
learning tasks now have owner-scoped relational authority under
`/api/v1/course-management`. No Task 5B/Task 7 browser source, Runtime policy,
Runtime migration, UAT branch, deployment, or active frontend release was
changed.

The old UI behavior that deleting a draft does not delete a published version
is preserved deliberately: a release stores stable `course_id` and
`source_draft_id` values plus the frozen JSONB snapshot, but it does not hold a
restricting/cascading draft foreign key. The current release is represented by
the single `published` row for each owner/course, enforced by a partial unique
index. Publishing supersedes the prior current row in the same transaction;
withdrawal leaves the frozen snapshot intact.

## Implementation

- Added `CourseDraft`, `CourseRelease`, and `LearningTask` with user owner/actor
  foreign keys, JSONB structure/audience/content, status checks, integer entity
  revisions, timestamps, and stable string IDs.
- Course releases have monotonic `(owner_id, course_id, version)` uniqueness,
  an immutable service/API snapshot, SHA-256 content hash, source draft
  revision, publisher/withdrawal audit fields, and exactly one current
  `published` row per owner/course.
- Learning tasks use a composite `(release_id, owner_id)` foreign key, so even a
  direct database write cannot attach another owner's release.
- Draft/task update and deletion use atomic
  `UPDATE/DELETE ... WHERE owner_id AND revision RETURNING`; stale mutations
  return HTTP 409 with `currentRevision`. Publish takes the global teaching
  writer lock before `SELECT ... FOR UPDATE`, so concurrent publishers produce
  one version and one conflict.
- All successful draft/release/task mutations take the existing global
  teaching-content writer lock and bump the relational content revision once in
  the same transaction. Publish's supersede, insert, and draft-revision update
  still create only one global bump. Stale, validation, owner, and database
  failures do not bump.
- Admins and teachers use the existing `managePapers`/`publishPapers`
  permissions, while every query still filters by the authenticated owner.
  Students/viewers receive 403 and another manager's identifiers resolve as
  404.
- Typed Pydantic inputs preserve arbitrary nested current/future course and
  task JSON under explicit JSONB fields, cap JSON payloads, reject unknown
  fields, and reject explicit-null mutations instead of silently persisting a
  JSON `null`.

## TDD Evidence

Initial API RED failed all six lifecycle/concurrency/owner tests at the missing
route boundary:

```text
POST /api/v1/course-management/drafts -> 405 Method Not Allowed
6 failed
```

The database-boundary test was then run with the task composite FK and status
check intentionally absent. A direct cross-owner task insert succeeded, so the
test correctly failed with `DID NOT RAISE IntegrityError`. Restoring the
constraints made the direct cross-owner and invalid-status writes fail and the
test pass.

An explicit-null RED exposed PostgreSQL JSONB semantics rather than a SQL NULL
error: `structure: null` returned 200, incremented the draft revision, and was
serialized back as `{}`. Schema validation now rejects it with 422 before any
domain/global revision change.

The global revision RED observed no change after course creation. All eight
successful mutation families now increment it exactly once; a stale draft
update leaves it unchanged. Two real concurrent `AsyncSession` publishers
prove one success, one `REVISION_CONFLICT`, one v1 release, and one global
revision bump. A real database check-constraint failure proves both the task
row and the tentative global bump roll back.

## Migration Verification

Migration `ca3f5a7b9d20` was exercised only against explicitly named temporary
PostgreSQL databases:

1. Empty database `upgrade head` reached the single head.
2. Constraint inventory contained the three status checks, owner/actor FKs,
   composite task-release owner FK, release uniqueness, and current-release
   partial index.
3. `downgrade b9d2e4f6a810` removed all three new relations.
4. Offline SQL for `b9d2e4f6a810:ca3f5a7b9d20` was piped into `psql` with
   `ON_ERROR_STOP=1`; it created all three tables and advanced the version row.
5. A fresh online head passed `alembic check` with no ORM/migration drift.

## Verification

- Course management focused tests: 10 passed.
- Course + teaching revision + cleanup + shared content + paper release +
  database-isolation regression: 155 passed.
- Task 5A stale Runtime assertion correction plus its authoritative recall
  server-owned coverage: included in a 15-test focused pass.
- Python compileall: passed.
- Alembic online/offline upgrade, downgrade, single head, and check: passed.
- Runtime/old course-key scan of new production files: clean.
- `git diff --check`: clean.
- Final full backend: 662 passed, 1 existing dependency deprecation warning,
  0 failures in 362.18 seconds.

## Prior-Test Correction

`test_teacher_drafts_round_trip_across_managers_but_not_students_or_viewers`
still expected a teacher to write a recall user-prefix through Runtime. Task 5A
made every recall library/management subject/user prefix server-owned and
already has parameterized tests proving 403 plus relational/global-revision
non-mutation. With controller approval, only the obsolete recall success/read
assertions were removed from this old course/paper Runtime round-trip test; its
course/paper purpose and student/viewer denial assertions remain unchanged.

## Safety

- No `main`, `uat`, push, deploy, frontend source/generated site, active release,
  Runtime policy, or Runtime migration was touched.
- Migration round trips used disposable, explicitly named PostgreSQL databases
  and dropped them after verification; the development/UAT database was never
  downgraded.

## Independent Review Follow-up

The post-implementation review found that the create schemas still accepted a
caller-selected global `id`. Besides allowing route-breaking values such as
`bad/id`, this made a globally unique identifier collision observable across
owners. The public create schemas, routes, and service signatures now have no
caller ID input at all: draft/task IDs are always generated by the service, and
an extra `id` is rejected with the ordinary typed 422 response before a row or
global revision can change.

The same review found that the JSON size validator used Python's permissive
`json.dumps` default, so `NaN`/`Infinity` reached asyncpg JSONB and produced a
500 containing SQL parameters. JSON fields now serialize with
`allow_nan=False` before the size check, covering draft/task create and update.
A schema validator alone was not sufficient for a safe HTTP response: FastAPI's
default validation handler echoed the original non-finite float in
`detail[].input`, and its own strict `JSONResponse` serialization then failed
with another 500. The application validation handler therefore preserves the
default `detail`/`type`/`loc`/`msg`/`input` contract and recursively replaces
only non-finite floats in the error representation with `"non-finite number"`.

Review coverage also now proves exact 2,000,000-byte JSON acceptance and the
one-byte-over rejection, complete admin mutation success, viewer mutation
denial, and no row/global-revision effects for stale publish, draft delete,
task delete, or release withdrawal.

### Follow-up TDD Evidence

The focused RED run reproduced both findings before production changes:

```text
custom draft id: expected 422, received 200 and bad/id row was persisted
NaN draft JSON: expected 422, received 500 with INSERT statement and parameters
2 failed, 1 passed
```

After the finite schema check was added, the database write was stopped but the
test still returned 500 because the default validation error body contained the
original `NaN`. Adding only the safe validation-error representation made the
same test return a non-leaking 422.

### Follow-up Verification

- Task 6 course management tests: 15 passed.
- Every backend test file containing an HTTP 422 contract: 237 passed; the
  ordinary extra-field response is asserted exactly and remains compatible.
- Final full backend: 667 passed, 1 existing dependency deprecation warning,
  0 failures in 361.57 seconds.
- Alembic remains the single `ca3f5a7b9d20` head. A fresh disposable database
  passed empty `upgrade head` and `alembic check`; downgrade to `b9d2e4f6a810`
  removed all three relations; actual offline SQL applied to a second
  base-revision database recreated all three and advanced the version row.
- Both explicitly named follow-up migration databases were dropped after the
  checks. `compileall` and `git diff --check` passed.
