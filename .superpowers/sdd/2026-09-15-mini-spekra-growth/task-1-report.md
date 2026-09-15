# Task 1 report: transactional practice growth

## Result

Implemented owner-isolated PostgreSQL growth settings, immutable daily goal snapshots, and one-credit-per-owner/day/source-question accounting. Added authenticated GET `/api/v1/learning/practice/growth` and PUT `/api/v1/learning/practice/growth/goal`. Both endpoints return the same summary shape. The seven-day calendar is the current Asia/Shanghai Monday-through-Sunday week, including future days as zero/incomplete.

Goals accept only 5, 10, 20, or 30. A change becomes effective on the next Asia/Shanghai day. The current week's elapsed goal values are snapshotted before changing configuration, and answered days are snapshotted transactionally when their first accepted answer is recorded.

## Trusted accounting entry points

- PC legacy `/learning/practice/answers`: credit is added only after server-owned question lookup, option validation, and grading.
- Practice session single-answer handler: the accepted question is credited in the same transaction as the session answer and mistake/experience effects.
- Mini save-state, pause, abandon, and whole-paper completion: only question IDs newly added to the server-validated session answer map are credited. Existing immutable answers are subtracted before accounting, so replaying or re-saving an old session on a later day cannot create later-day credit.
- Wrong-question revenge answers and verification variants: both are credited after authoritative snapshot validation and grading. Request replay exits before growth accounting. Variants use their own stable source question ID.
- Client `POST /learning/events` has no growth hook. Existing server-only guards also reject practice replay event types, so fabricated learning events cannot increment growth.

`record_answers()` uses an owner-scoped PostgreSQL transaction advisory lock, creates the day's frozen target, inserts answers with `ON CONFLICT DO NOTHING`, and updates the daily count only for returned inserts. It never commits. Consequently validation failures and caller rollbacks also roll back growth. The owner/date/question unique constraint is the final concurrent retry guard.

## Files

- `backend/app/models/practice_growth.py`
- `backend/app/services/practice_growth_service.py`
- `backend/app/schemas/practice_growth.py`
- `backend/app/api/v1/practice_growth.py`
- `backend/alembic/versions/c8d7e6f5a401_practice_growth.py`
- `backend/tests/test_practice_growth.py`
- `backend/app/models/__init__.py`
- `backend/app/api/v1/router.py`
- `backend/app/services/learning_service.py`
- `backend/app/services/practice_session_service.py`

## TDD and verification

- Pre-implementation baseline: `.venv/bin/python -m pytest tests/test_practice_growth.py -q` -> test file missing, exit 4. This is not a valid TDD RED; the required test-first ordering was missed and is recorded as a process gap.
- First executable new-test run after initial implementation -> 3 failed (two test-harness assumptions and one seeded-password mismatch). After correcting the harness, 1 failed/2 passed: the goal PUT returned stale `configuredGoal` because a bulk upsert left SQLAlchemy's identity map stale. That product defect was fixed by updating the locked ORM setting row directly.
- GREEN: `.venv/bin/python -m pytest tests/test_practice_growth.py -q` -> 5 passed.
- Migration/head: `.venv/bin/python -m pytest tests/test_alembic_single_head.py -q` -> 1 passed; `alembic upgrade head` applied `ab4c8e86b840 -> c8d7e6f5a401` successfully.
- Adjacent: `.venv/bin/python -m pytest tests/test_practice_sessions.py tests/test_practice_learning_api.py tests/test_learning_workspace.py -q` -> 92 passed.
- `git diff --check` and Python compile checks passed.

Tests cover empty defaults, auth denial, invalid/selectable and repeated goal changes, next-day effectiveness, exact Shanghai midnight/month rollover, Monday-to-Sunday boundaries, owner isolation, duplicate and concurrent credit, caller rollback, current streak ending yesterday, year boundary, and migration single-head. A real session API test asserts that a server-validated wrong answer increments growth, a forged option does not, an arbitrary learning event does not, another owner sees zero, and the same immutable saved answer replayed after Shanghai midnight does not gain a new day's credit. Existing adjacent handler suites cover PC/session/mini save, wrong-answer, replay, experience, and invalid-save compatibility with the new hooks installed.

## Review notes and unresolved concerns

- Migration head `c8d7e6f5a401` is stable and must be applied before starting code that writes growth rows.
- No production deployment, push, `uat`, or `main` operation was performed.
- The controller still needs the planned full backend suite and UAT real-interface verification. No task-owned functional concern remains from targeted and adjacent tests.
