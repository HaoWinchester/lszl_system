# T13 — server-authoritative card questions

Implemented against base 5813a907. Backend source/test/migration only. No descendants, push, deployment, branch change, merge, generated frontend edits or new template UI.

## Authorization matrix and actual catalog audit

| Action | Teacher/admin | Student | Viewer/guest |
| --- | --- | --- | --- |
| Cross-bank bounded search | Own active card only | 403 | 403/401 |
| Set/order/remove/refresh/revoke bindings | Own active card plus expected file revision | 403 | 403/401 |
| Read frozen card question and submit | Own live file/node/active binding/version | Same, including nonmember paid-release source | 403/401 |
| Frozen asset | Complete exact card tuple; snapshot must contain asset | Same | Denied |
| Historical analysis/assets | Only own submitted attempt, exact immutable version and tuple | Same | Denied |
| Other file/node/binding/asset, forged question ID | 404/409, no grant | Same | Denied |
| Ordinary paid paper release | Existing policy | Nonmember still 404 | Existing policy |

Read task-13-context audit and independently inspected catalog filters, source models, material endpoints and shared grading. Live isolated sample combines private/internal member-only release question, explicitly published/public question, and explicitly public question also included in member paper. Anonymous and nonmember learning lists (including paper_id) and bootstrap exclude private source; public question remains public and its established answer/analysis payload remains unchanged. Managed single-question endpoint is always permission-gated (403 for student), even if a caller appends mode=learning; it is not a public detail route. Member release snapshots and unassociated assets remain denied. No evidence justifies globally excluding explicitly public questions simply because they appear in a paid release, so ordinary semantics were preserved.

## Implementation

- New GraphQuestionBinding retains owner/file/node/source-question IDs, frozen questionRevision and unique sourceVersion, order, creator, active/revoked status and complete frozen snapshot. Unique file/node/question identity deduplicates selection. Non-FK source/file identifiers deliberately preserve frozen records after source question/file removal. Active practice always independently checks current owned live file and existing node, so orphaned records grant no practice.
- Binding PUT receives the complete checked ordered list (max100), removes omitted entries by explicit revoke, preserves existing immutable versions, deduplicates repeated selections and regrants revoked entries with a fresh snapshot/version. File and binding updates are atomic. All mutations compare expectedFileRevision and increment GraphFile/FileContent revision; failed source lookup rolls back the whole request. Refresh and revoke also require exact sourceVersion. Student/viewer/guest cannot maintain grants; admin does not gain crossowner graph editing.
- Search performs one server-side cross-bank count plus bounded page (20, page max500), literal escaped keyword search, subject filter, stable title exact/title substring/concepts-tags/stem ranking with ID tiebreaker and alreadyLinked summaries. Search never emits full snapshots, answers or analysis.
- Source freeze locks the authorized server source question and serializes the existing canonical question payload. Resources resolve under the authorized source bank owner, which permits teacher cross-bank questions with materials/images without opening arbitrary asset IDs. Optional exact_revision=True in existing freeze helper loads the immutable material revision actually referenced by the question; ordinary material/release callers retain existing behavior.
- Pre-submit positive projection allows presentation fields only. Arbitrary metadata, keyPath, translations, status/lifecycle, concepts/clues/reasoning, option correctness/traps, stem clues and matching correctPairs are excluded. Question/material images use canonical URLs carrying fileId/nodeId/bindingId/sourceVersion. Material and matching presentation reuse canonical field structures. No client entitlement booleans or question IDs enter the attempt authority contract; request bodies forbid unknown fields.
- Attempt writes validate choice/pair identifiers, call existing question_answer_service.grade_selection for single/multiple/matching, store normalized selection, full server result and exact frozen snapshot independently from formal learning/exam progress. owner/requestId unique across bindings; identical retries return the original attempt, conflicting content/binding/version returns409. File/binding locks serialize retries versus refresh/revoke; a four-request concurrent HTTP test produces one row. Submit response contains only correctness and submitted selection; full result/analysis requires a separately authorized submitted-attempt endpoint.
- Explicit revoke blocks subsequent practice and normal card assets, including retries. Submitted history remains owner-only readonly after revoke/node/file/source deletion. Historical image URLs additionally carry attemptId; shared asset endpoint checks owner and exact immutable file/node/binding/sourceVersion/attempt tuple plus asset allowlist, never grants fresh practice through attemptId.
- Shared question cleanup inventory records both bindings and attempts as preserve_historical_snapshot references and hashes/version evidence. Source permanent deletion is not blocked solely by graph snapshots. Material deletion protects references from both bindings and attempts, including sole-reference tests. Existing batch cleanup preservation regression passes. File permanent delete and empty-trash preserve attempts without granting access to absent files.

## API contract for T14

Prefix `/api/v1/graph-questions`:

- GET `/search?fileId=...&nodeId=...&q=...&subject=...&page=...` -> page/pageSize/total/questions summaries.
- GET `/files/{fileId}/nodes/{nodeId}/bindings` -> bindings with safe question, questionRevision, sourceVersion, orderIndex.
- PUT same bindings path with `{expectedFileRevision,questionIds:[...]}` -> bindings and fileRevision. This is the complete ordered desired list; append callers first combine existing questionIds with checked additions.
- POST binding path `/{bindingId}/refresh` or `/revoke` with `{expectedFileRevision,sourceVersion}` -> binding and fileRevision.
- POST binding path `/{bindingId}/attempts` with `{sourceVersion,requestId,selectedOptionIds:[...]}` or `{sourceVersion,requestId,selectedPairs:{...}}` -> attempt (id, bindingId, sourceVersion, questionRevision, requestId, normalized selection, correct, submittedAt).
- GET `/attempts/{attemptId}/analysis` -> own submitted attempt, complete frozen question, result and analysis. No unsubmitted analysis API exists.
- Existing binary/base64 question-asset endpoints accept optional complete graph tuple and optional attemptId. Any partial supplied graph tuple returns422; explicit invalid graph tuple does not fall back to ordinary asset grants. Ordinary requests without graph context preserve original policy.

## Trusted transaction APIs for T15/T16 and lock order

- `await graph_question_service.export_card_bindings(db,user,fileId,nodeId)` authorizes a live owned card and returns deep-copied ordered descriptors `{questionId,questionRevision,snapshot}` for active bindings only. Export is internal and never an HTTP endpoint; descriptors include answer keys and must never be rendered to pre-submit clients.
- `await graph_question_service.clone_card_bindings(db,target_owner,target_file_id,target_node_id,trusted_bindings)` checks target owner/live file/node, creates fresh IDs/sourceVersions, deep-copies frozen content, flushes only and returns ORM rows. Caller owns commit/rollback and refresh before accessing committed ORM properties. Existing duplicate card/source uniqueness aborts the transaction instead of silently mutating grants.
- TRUST BOUNDARY: caller must first authorize the server-loaded immutable template/version or source owned card and its entitlement. Never pass raw client-selected snapshots, source owner IDs or file IDs as authority. Clone preserves legitimate immutable question assets via card snapshot allowlist; it does not grant catalog/release/maintenance permissions.
- LOCK ORDER IS REQUIRED: acquire `teaching_content_revision_service.acquire_lock(db)` before any EXISTING source/target file, question, binding or material row locks in the caller transaction. Public binding/revise/attempt writers do this internally before file/binding/source locking. Clone acquires this advisory lock before its own reads/flush, but cannot undo locks already acquired by its caller. Creating a new invisible uncommitted target file before clone is safe; for existing targets/copy transactions acquire the advisory lock first. Same advisory lock protects material delete before its material row lock and cleanup snapshot recheck/deletion. No helper commits behind its caller.

## Migration and verification

Actual tool `cd backend && .venv/bin/python -m alembic heads` initially returned f947502425ac. Tool-created revision adb222e8e3a0 has down_revision f947502425ac, creates binding/attempt tables and uniqueness/indexes, and downgrades only these tables. Every pytest run created and migrated its own disposable PostgreSQL database via existing conftest, including all new tables; normal test teardown drops that database. No dev/production/UAT DB writes or helper server.

Evidence directory `artifacts/canvas-m2-m5/t13/`:

- Initial new matrix: 5 passed, single existing python_multipart PendingDeprecationWarning.
- Expanded required regression initial attempt (`backend-check.log`): 37 passed/1 failed. Failure was a test incorrectly expecting a public managed detail route; actual route requires CatalogManager and returns403. Corrected test to existing contract, not implementation permissions.
- Required tests (`backend-green.log`): `cd backend && .venv/bin/python -m pytest tests/test_graph_question_access.py tests/test_graph_question_attempts.py tests/test_question_catalog.py tests/test_paper_releases.py tests/test_question_materials.py -q`: 38 passed, existing warning.
- Expanded matrix (`backend-final-matrix.log`): 8 passed after sole binding/attempt material protections and history assets.
- Final focused regression (`backend-final-lock.log`): same required files plus `tests/test_question_pool_cleanup.py::test_apply_repairs_current_references_preserves_history_and_audits_once`: **41 passed**, existing warning, 38.70s. Covers concurrent retry, catalog/member crossover, all roles and tuple tampering, matching/multiple/single correct and incorrect grading, answer-leak carriers, rollback, source deletion, refresh/revoke/regrant/order/dedupe, complete history asset tuple, permanent/empty-trash deletion and cleanup inventory/preservation.
- Material-delete advisory lock was added in final self-review to close clone/freeze versus deletion race; affected matrix + existing materials rerun is recorded below.
- One final command initially used nonexistent test_question_cleanup.py; pytest exited4 without executing cases. Correct path verified by rg --files before running actual focused regression. No hidden failed implementation assertions remain.
- No pre-implementation failing test run was performed, so this report does NOT claim a tests-first RED/GREEN cycle. Executed failure evidence above is preserved accurately.
- `git diff --check` exit0. No frontend changes means no browser/wrapper/build/release wave. Full release integration and human UAT remain controller work.

## Scope and limits

13 scoped files: new backend models/schemas/service/router modules for graph questions; models/__init__, v1/router, question_catalog_service, question_cleanup_reference_service, question_material_service and API, migration adb222e8e3a0, test_graph_question_access, test_graph_question_attempts. Reports/evidence are separate from source commit; generated frontend artifacts remain unstaged.

Private file ownership remains unchanged. Learner grants arrive through trusted template/copy loading in later tasks; no public way allows students to bind raw question IDs. Copies get independent frozen grants; revoke applies to the named card binding, not all legal copies globally. No template UI, publisher permissions, formal exam scoring or graph-asset ownership changes. Snapshot/history resource garbage collection is intentionally absent. Exclusive teaching-content advisory lock favors correctness and cleanup consistency; possible future throughput optimization must preserve ordering and cleanup guarantees.

Final material lock verification: `cd backend && .venv/bin/python -m pytest tests/test_graph_question_access.py tests/test_graph_question_attempts.py tests/test_question_materials.py -q` -> **14 passed**, one existing multipart warning, 26.59s (`backend-material-lock.log`). Includes all 9 new matrix tests and existing 5 materials tests after the final lock change. Final Alembic heads confirms single adb222e8e3a0 head; final whitespace check exit0.

Commit: **e85caf98 — feat(graph): authorize card-scoped question practice**. Postcommit backend paths clean and index empty; only previously generated frontend artifacts remain outside this task. No push/merge/deploy/branch changes performed.


## Independent review

### Spec Compliance

- ✅ T13 backend scope compliant at e85caf98. Role enforcement and owned active file/node/binding/version checks are centralized (`backend/app/services/graph_question_service.py:22`, `:27`, `:44`); immutable revisions, ordered deduplication and expected file revision checks are implemented (`:57`, `:102`, `:132`). No ordinary catalog/release bypass was added.
- ✅ Pre-submit projection explicitly selects presentation fields, omits option correctness/matching answers and arbitrary metadata, and rewrites assets with the complete grant tuple (`backend/app/services/graph_question_service.py:69`, `:85`, `:208`). Material revisions use exact referenced versions (`backend/app/services/question_material_service.py:109`).
- ✅ Submit uses the existing canonical grader, validates selection shape and binds request identity to owner/binding/version/normalized selection (`backend/app/services/graph_question_service.py:150`, `:172`). Separate submitted history preserves frozen content after revoke/source/file deletion (`:194`). Binding and attempt references participate in cleanup inventory and material retention (`backend/app/services/question_cleanup_reference_service.py:545`, `backend/app/services/question_material_service.py:83`).
- ⚠️ Future T15/T16 template entitlement and concurrent copy transactions cannot be verified here: production callers do not yet exist (`backend/app/services/graph_question_service.py:222`, `:229`). The helper is an internal trusted-snapshot API, not independently sufficient authorization for client data.
- ⚠️ Public-versus-member semantics have representative isolated API coverage (`backend/tests/test_graph_question_access.py:117`), not proof of every deployment's source-data classification. Human UAT, frontend integration and production data audit remain outside this task.

### Strengths

- ✅ Real API tests cover cross-bank resources, full tuple tampering, denied ordinary member releases, explicitly public questions also included in member releases, wrong answers, historical assets and source deletion (`backend/tests/test_graph_question_access.py:88`, `:117`; `backend/tests/test_graph_question_attempts.py:15`, `:45`). These are behavioral assertions rather than mocked authorization.
- ✅ Snapshot payloads remain independent of mutable source questions, and historical image grants require the exact owner/attempt/file/node/binding/version tuple (`backend/app/services/graph_question_service.py:182`, `:208`). No client-authored entitlement or snapshot input is accepted (`backend/app/schemas/graph_question.py:5`).
- ✅ Current public write lock order is advisory → active file → binding → source, with material deletion advisory → material and cleanup advisory → cleanup lock → source rows. No lock inversion found in inspected current paths (`backend/app/services/graph_question_service.py:104`, `:134`, `:174`; `backend/app/services/question_material_service.py:85`; `backend/app/services/teaching_content_revision_service.py:116`; `backend/app/services/question_cleanup_service.py:687`).

### Issues

#### Critical (Must Fix)

- None found in the reviewed T13 scope.

#### Important (Should Fix)

- None found in the current public T13 execution paths.

#### Minor (Nice to Have)

- `backend/app/services/graph_question_service.py:222`, `:229`: Put the complete transaction precondition in these helper docstrings, not only the implementer report. Export does not take the advisory lock, and clone reads an existing target with unlocked `db.get`; the advisory lock alone does not serialize `file_service.save_file`, which uses its own row lock (`backend/app/services/file_service.py:277`). Before any T15/T16 production use with an existing target, the caller must acquire the advisory lock before export/any existing row locks, lock source/target files in a consistent order as needed, and revalidate current node/source authority in that transaction. A new uncommitted target is different and does not have this existing-target race. The current callers are tests, so this is a mandatory future integration check rather than a demonstrated current endpoint exploit or deadlock.
- `artifacts/canvas-m2-m5/t13/backend-material-lock.log:4`: The reported verification is not warning-free: Starlette emits the existing `python_multipart` PendingDeprecationWarning. Track dependency cleanup separately; it is not a T13 behavior regression.

### Assessment

- **Task quality: Approved**, with the internal clone transaction condition carried into T15/T16 review.
- **Reasoning:** The public API boundaries, positive redaction, immutable grading history and cleanup references are coherent and specifically exercised. Concurrent retry coverage verifies one important race, but does not establish future template/copy lock correctness.
- **Checks:** Read the supplied diff once in chunks; recovered only the projection lines truncated by tool output. Focused outside-diff checks addressed named risks: shared grader input/result compatibility (`question_answer_service.py:94`, `:116`, `:175`); canonical material/image payload safety (`question_material_service.py:19`, `:53`, `:64`); cleanup/material/source writer lock order (`teaching_content_revision_service.py:98`, `:116`, `question_cleanup_service.py:687`, `question_service.py:1143`); file save/deletion ordering and clone callers (`file_service.py:264`, `:356`, `:400`, `:419`, test-only export/clone usages). Existing material edits acquire their row lock within already advisory-protected question mutations or standalone material transactions that do not subsequently request the advisory lock.
- **Checks:** No suites rerun: code inspection raised no unanswered current-path doubt requiring another test. Reported 41-test and affected 14-test runs are supporting evidence, not substituted for inspection. No source/index/branch changes, descendants, deployment or push; only this report was written.
