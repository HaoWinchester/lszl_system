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

## Review Fix Round 1

The first Task 8 review found that the drop gate still trusted an incomplete
inventory and mutated its own ledger while checking readiness. It also found
that several reused domain mappers overwrote relational authority and that an
aggregate external proof could certify an uncovered identity.

The review fixes now provide these guarantees:

- A live scan records that it froze the complete Runtime inventory. Drop-check
  compares every live `(source type, key, owner)` and payload hash against that
  snapshot inside the same `REPEATABLE READ` transaction. A new key, owner, or
  changed source produces `inventoryDrift`; new unknown/parse blockers are
  counted without exposing their payload.
- Unified and domain drop-checks require an existing run and perform no ledger
  mutation. The unified gate rolls back its read transaction, and tests compare
  run/item report, status, hashes, metadata, errors, and timestamps before and
  after the check.
- Announcement/audience, feedback/replies, message and feedback receipts,
  teaching recall, taxonomy aggregates, and paper releases use missing-only
  insertion. Existing relational aggregates remain unchanged; canonical
  source/target divergence is recorded as an identifier plus hashes and blocks
  verification/drop.
- File proofs are exact per owner and source key. Index, content, folders,
  tags, current pointer, and file-tag associations have independently derived
  source/target counts and hashes. Shared or uncovered file identities cannot
  be certified. Question and paper proofs are likewise scoped by the exact
  ledger identity and referenced bank/paper/category IDs.
- Duplicate folder/tag source IDs and different tag IDs with the same
  case-folded name are rejected before writes as a non-bijective mapping.
- The CLI has command-specific parsing: `migrate`, `verify`, and `drop-check`
  require `--run-id`; `scan` does not. Every command exits 2 for blocker,
  pending, required-failure, failure-status, or non-ready reports.

### Review TDD evidence

- Initial drop/CLI RED: `3 failed, 7 passed` proved blocked scan returned 0,
  missing-run drop created a ledger, and a post-verify owner/key was invisible.
- External identity RED: `2 failed` proved a shared file item was aggregate
  verified and duplicate folder/tag aliases were accepted; focused GREEN was
  `2 passed`.
- Domain-wins RED showed announcement content/audience, feedback/replies, and
  recall being overwritten. A second RED showed existing receipt timestamps
  changing from 11 to 999. The combined GREEN preserves all five relational
  aggregates and reports five hash-only conflicts.
- The existing divergent PaperRelease regression now requires
  `verification_failed`, preserves its release and question snapshot, and
  records one unresolved hash conflict.
- The first isolated live CLI rerun exposed an expired-ORM `MissingGreenlet`
  after composed migrators committed. Re-reading ledger items after those
  commits fixed the real command path.

Final focused regression:

- `.venv/bin/python -m pytest tests/test_runtime_retirement.py tests/test_files_runtime_migration.py tests/test_question_runtime_migration.py tests/test_runtime_domain_migration_ledger.py -q`
  completed with `41 passed, 1 pre-existing dependency warning`.
- `py_compile` completed successfully for the CLI, orchestrator, domain,
  files, question/paper, and engagement migration modules.
- A fresh disposable PostgreSQL database was migrated to head and seeded with
  one safe device-preference Runtime item. `scan`, `migrate`, `verify`, and
  `drop-check` all exited 0 with source 1, verified 1 where applicable, every
  blocker count 0, `inventoryDrift=0`, and final `ready=true`. All reports were
  payload-token-free and the database was removed by trap.
