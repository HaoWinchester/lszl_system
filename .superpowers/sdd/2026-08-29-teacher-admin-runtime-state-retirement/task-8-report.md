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

## Review Fix Round 2

The second review closed five remaining proof and domain-authority gaps:

- A run created from caller-provided fixtures may exercise migration and
  verification, but it can never authorize Runtime deletion. Both ledger and
  unified drop gates now require a frozen `live` inventory scope; non-live
  scope is an explicit `inventoryScope` blocker and CLI exit 2.
- Question banks, questions, paper categories, papers, and paper composition
  are missing-only migrations. Canonical variants are compared before source
  priority is applied. Existing relational metadata/content/references remain
  byte-for-byte authoritative, while divergent Runtime variants add
  identifier/source/hash-only conflicts.
- Question/paper evidence is computed per exact
  `(source_type, source_key, owner_scope)` from that ledger item's frozen
  Runtime payload, not from the domain-priority merged snapshot. Targets are
  freshly read relational rows; missing rows are omitted rather than counted
  as `None` placeholders. Shared paper/category owner fallback uses the exact
  `SharedRuntimeState.updated_by` rule used by migration. File proofs reject
  every non-`runtime` source even when it carries an owner-shaped scope.
- Required mapper exceptions now make the domain stage
  `verification_failed`; unified reports expose `requiredFailures`, so all CLI
  stages exit 2 rather than returning a false successful `applied` result.
- Tag collision preflight uses the same `strip()[:40].casefold()` identity as
  persistence and rejects long-name aliases before any write.

### Round 2 TDD evidence

- First RED batch: `3 failed` for a provided inventory incorrectly reaching
  ready, a required mapper exception returning `applied`, and two 41-character
  tag names collapsing silently. Focused GREEN: `3 passed`.
- Domain authority RED: `2 failed` because bank and paper/category variants
  were silently source-prioritized. Focused GREEN: `2 passed`, preserving
  existing question content, paper metadata, category metadata, and reference
  score.
- Exact-proof RED: `4 failed` because exact helpers were absent and source type
  was missing from proof identity. Follow-up REDs observed aggregate
  `targetCount=2` for zero target rows, a shared owner fallback producing one
  invalid record, a shared file item being verified from a Runtime proof, and
  unified `requiredFailures` being absent. Every focused case is GREEN.

Final Round 2 focused regression:

- `.venv/bin/python -m pytest tests/test_runtime_retirement.py tests/test_files_runtime_migration.py tests/test_question_runtime_migration.py tests/test_runtime_domain_migration_ledger.py -q`
  completed with `52 passed, 1 pre-existing dependency warning`.
- `py_compile` succeeded for the CLI, unified/domain/files/question/engagement
  migration services; `git diff --check` is clean.
- A new disposable PostgreSQL database was migrated to head and seeded with
  one live device-preference Runtime item. All four CLI commands exited 0:
  `scan=planned`, `migrate=applied`, `verify=verified`, and
  `drop-check=ready`; source/verified counts were `1/1`, every blocker was 0,
  `inventoryScopeInvalid=0`, and final `ready=true`. All four reports contained
  none of `source_payload`, `canonical_payload`, or `target_payload`; the
  disposable database was removed by trap.

No existing database, UAT environment, active release, `main`, or remote branch
was mutated.

## Review Fix Round 3

Exact question and paper proof ownership now preserves the full Runtime
identity namespace. A normal `runtime` item always uses its own non-empty
`owner_scope`, including the valid username `shared`; it never consults a
same-key `SharedRuntimeState` row. Only the exact combination
`shared_runtime` plus owner scope `shared` may use that shared row's
`updated_by` actor. Empty Runtime owners, mismatched shared scopes, unknown
source types, and missing shared actors fail closed as invalid proof records.

### Round 3 TDD evidence

- RED: three focused tests failed. Both colliding Runtime/SharedRuntime
  question and paper identities produced different source/target hashes, and
  invalid source-type/scope shapes reported zero invalid records.
- GREEN: the same three tests passed after routing both exact verifiers through
  one source-type-aware owner resolver.
- Focused question/runtime regression:
  `.venv/bin/python -m pytest tests/test_question_runtime_migration.py tests/test_runtime_retirement.py -q`
  completed with `32 passed, 1 pre-existing dependency warning`.
- Full Task 8 focused regression:
  `.venv/bin/python -m pytest tests/test_runtime_retirement.py tests/test_files_runtime_migration.py tests/test_question_runtime_migration.py tests/test_runtime_domain_migration_ledger.py -q`
  completed with `55 passed, 1 pre-existing dependency warning`.
- `py_compile` for the question migrator, retirement orchestrator/CLI, and the
  two focused test modules succeeded; `git diff --check` is clean.

No live database, UAT environment, deployment, push, `main`, or active release
was changed.
