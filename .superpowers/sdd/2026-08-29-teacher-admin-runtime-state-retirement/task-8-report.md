# Task 8 Report: Runtime Migration and Drop Gate

Date: 2026-08-30
Branch: `codex/runtime-retirement-execution`

## Outcome

The new `runtime_retirement` service and CLI compose the existing Runtime
domain ledger and files/question/paper migrators. They add course drafts,
immutable course releases, learning tasks, and the derived active-release
pointer without creating a second migration ledger. Relational rows win;
Runtime fills only missing rows; divergence remains an explicit blocker.

Public reports contain source identity, disposition, counts, and canonical
SHA-256 only. Internal ledger items retain the frozen source snapshot required
for resumability; public sanitization never overwrites that internal snapshot.
Device preferences and one-shot compatibility markers have explicit safe
dispositions. Unknown keys are never implicitly dropped.

Verification re-reads files/folders/tags/file-tag associations/current-file,
question banks/questions, paper categories/papers/references, and all course
targets. The target proof and ledger verification run in one PostgreSQL
`REPEATABLE READ` transaction and commit statuses once after all proof reads.
Drop-check performs no DDL and also requires both Runtime page policies to be
empty.

## TDD Evidence

- Initial RED: collection failed because `runtime_retirement_service` did not
  exist.
- File association RED: a second Runtime tag reference was not migrated;
  migration and proof now cover every unique association.
- Current-file RED: invalid/missing legacy pointer falsely mismatched the
  deterministic active-file fallback; proof now canonicalizes the same
  fallback used by migration.
- Relational tamper coverage proves target changes produce a hash-mismatch
  drop blocker.
- PostgreSQL `SHOW TRANSACTION ISOLATION LEVEL` observes `repeatable read`
  inside the domain-proof hook.

## Local Safety Evidence

Final focused regression:

- `.venv/bin/python -m pytest tests/test_runtime_retirement.py tests/test_files_runtime_migration.py tests/test_question_runtime_migration.py tests/test_runtime_domain_migration_ledger.py -q`
  completed with `35 passed, 1 warning`.
- Python compilation completed successfully for the retirement orchestrator,
  CLI, and the three reused migration services.

The live database was scanned read-only only. The payload-free scan reported
984 source items, 464 unknown dispositions, 1 parse blocker, and 12 unresolved
paper conflicts. Therefore no migrate/verify/drop action was run against the
live database. The report contained zero payload-field tokens.

An isolated disposable PostgreSQL database was migrated to head and seeded
with one teacher-owned legacy course draft. All four payload-free CLI reports
were written below a `mktemp -d` directory and the database was dropped by a
shell trap:

- `scan`: exit 0, `planned`, source 1, all blocker counts 0.
- `migrate`: exit 0, `applied`, source 1, all blocker counts 0.
- `verify`: exit 0, `verified`, source 1, verified 1, all blocker counts 0.
- `drop-check`: exit 0, `ready=true`, source 1, verified 1, all blocker counts
  0.

All four reports contained zero payload-field tokens. No fixed shared `/tmp`
report path or existing database was modified.

## Safety

No UAT action, deployment, push, merge to `main`, active-release promotion, or
mutation of the existing live database was performed.
