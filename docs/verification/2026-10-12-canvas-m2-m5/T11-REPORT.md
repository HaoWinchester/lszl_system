# T11 — graph image assets and content roundtrip

Status: DONE. Source/test/migration only. No descendants, branch switch, push, merge, deployment or promotion. Base dc2145d0; generated frontend outputs left unstaged.

## Implementation and security

- Added graph_assets immutable independent owner-scoped PostgreSQL blobs, upload for existing graph editors admin/teacher/student, and authenticated GET `/api/v1/graph-assets/{assetId}?fileId=...`. Every read requires BOTH asset owner matching current account and an ACTIVE owned file actually referencing it. Graph JSON is never a grant, including direct forged persisted JSON. No global admin bypass for another owner's graph asset. Read responses private/no-store/nosniff; upload returns reference metadata only; file metadata/list outputs continue excluding binaries.
- All file-service create and save paths validate every content.images assetId against owner; duplicate delegates to create. Legacy import prevalidates all files before existing folder/tag commits. Trusted import/template transactions can use flush-only file creation. Repeated references retained, assets not tied to a source file lifetime; delete source does not delete the reusable owner blob.
- Extracted pure `validate_image_bytes` shared with question material upload: PNG/JPEG/WebP content verification, declared MIME matches decoded format, maximum 5 MiB and 40 million pixels. Question endpoint authorization unchanged; student graph upload does not grant question upload.
- Graph model explicitly preserves `content.images=[{assetId,alt,width?,height?}]`; rejects invalid references/dimensions. Notes retain exact whitespace/content through model, sanitizer, persistence and fragments up to 100000 characters, then throw an explicit error. Backend rejects over-limit notes instead of truncating. Existing fragment deep-copy/remap already preserves media fields; no duplicated fragment algorithm needed. Existing persistence/export uses this normalized content.
- Shared formal/temporary card renderer displays escaped alt and internally constructed URLs; full details display images. CSS object-fit contains images without changing card geometry. Initial remote bootstrap loads the graph before selecting the bridge store: expanded existing `fragmentSource()` to use already loaded remote adapter metadata during that window, fixing first-paint missing images and reusing central context for copy/render.

## Exact transaction APIs for T12/T15

- `validate_image_bytes(data: bytes, mime_type: str) -> (width,height)`: pure validation, HTTPException422.
- `await graph_asset_service.create_asset(db, owner, *, image_bytes, mime_type, filename='', alt='', commit=False) -> {assetId,alt,width,height}`: validate, add, flush; default no commit. With commit=True commits and refreshes.
- `await graph_asset_service.validate_graph_assets(db, owner, graph)`: fail404 on nonexistent/foreign refs and 422 invalid media/notes. Must run on all user-submitted graph saves. No authorization via sourceFileId.
- `await file_service.create_file(db, owner, *, name, graph_data=None, folder_id=None, source='created', source_file_id=None, commit=False) -> GraphFile|None`: validates refs, creates parent then content, flushes both, no commit. Caller handles folder None failure, quota, commit/rollback and refresh before accessing ORM attributes after commit. Existing default commit=True unchanged.
- `await graph_asset_service.clone_graph_assets(db, source_owner, target_owner, trusted_graph) -> (deep_copied_remapped_graph, {oldAssetId:newAssetId})`: validates source ownership, clones each distinct blob once, remaps duplicate image references consistently, flush only. **Internal trusted primitive, never expose raw client graph with client-selected source_owner.** T15 caller must first authorize a server-loaded immutable template/version and its load entitlement; pass stored content/owner, then file create and question grants in SAME transaction. Template preview does not get asset reads from this API. T12 parser calls create_asset + embeds returned refs + create_file within one transaction; failure rolls back both. Same-owner clipboard can keep immutable IDs.

## Verification and evidence

Evidence `artifacts/canvas-m2-m5/t11/`.

- Base-regression RED, reconstructed against dc2145d0 with `git show ...:new-legacy/src/graph/graph-model.js | node -e ...`: 4000-character notes become 3000; assertion fails (`notes-red.log`). This was a baseline probe, not a claimed tests-first implementation sequence.
- Initial scoped browser run failed waiting for image elements, despite loaded node content and current file. Diagnosed first-paint bridge context; resolved in shared bridge fallback. Initial backend iteration failed only because test used nonexistent `/files/import`; corrected harness to actual `/files/import-legacy`.
- `cd backend && .venv/bin/python -m pytest tests/test_graph_assets.py tests/test_question_materials.py -q`: **8 passed**, existing multipart deprecation warning only (`backend-green.log`). Covers valid three formats, forged MIME, oversize bytes/pixels, save/create/import foreign refs, explicitly persisted forged owned-file foreign reference read attack, other-account reads, same-owner source permanent deletion, duplicate refs, trusted cross-owner clone ID remap, combined resource/file rollback, unchanged question upload roles, existing question material revisions/releases/access.
- `cd backend && .venv/bin/python -m pytest tests/test_files_api_contract.py tests/test_graph_files_cutover_boundary.py -q`: **4 passed**, same existing warning (`files-green.log`).
- `node --test frontend/scripts/graph-edge-midpoints.test.mjs`: **7/7 wrappers pass**, T11 inner **3/3** media tests; includes existing edge/fixed-port/fragment/session/mindmap regressions (`wrapper-green.log`). T11 sanitizer exact whitespace and 16000-character notes, storage/hydration, fragment remap duplicates, explicit over-limit errors, safe URL and initial remote context covered. Normal wrapper integration done.
- `python3 new-legacy/tests/graph-media-browser.py --base-url http://127.0.0.1:62781`: **PASS** (`browser-green.log`). Actual Chrome loaded two images at decoded naturalWidth12 in cards, displayed both details images, saved/reopened structurally equal graph, duplicated file, trashed source, switched/reopened copy, reloaded image bytes and 6000-character notes. Zero page errors. Backend separately checks permanent deletion.
- `pnpm --dir frontend sync:new-legacy` successful (`sync.log`), only to serve source. Generated sync artifacts deliberately unstaged.
- node syntax on editor/model and git diff whitespace check exit0. Alembic revision tool generated **f947502425ac**, down_revision **b3882ab31623**, actual heads command confirms single head; each isolated pytest/helper database migrated successfully from scratch.

## Cleanup, self-review and limits

Owned disposable helper port62781/PID9139 identity verified before SIGTERM; tracked session exit0 and process lookup absent confirms database cleanup. No production/UAT data touched. Full pnpm/release/feature integration and human UAT remain controller work. Binary assets persist for owner lifetime; garbage collection is deliberately absent so source deletion never revokes legal copies. No standalone media upload UI or template reader introduced: T12 imports and T15 template loading use transaction primitives. Temporary cards use existing source context; temporary drawer redesign remains later task. Existing large editor received only shared markup wiring, no duplicated rendering implementation. No new homepage module/script means no bundle registry change required.

Scoped files: backend core/image_validation.py; models/graph_asset.py and __init__; schemas/graph_asset.py; services/graph_asset_service.py, question_material_service.py, file_service.py; api/v1/graph_assets.py and router; migration f947502425ac; tests/test_graph_assets.py. Frontend graph-model.js, config sanitizer, editor, existing store bridge, card CSS; graph-media-roundtrip.test.js, graph-media-browser.py; existing graph-edge-midpoints wrapper.

Commit: **25a457cf — feat(graph): persist image resources for reusable content**. Final staged whitespace check passes after removing an extra model EOF blank line; post-commit index empty and all scoped source/test/migration paths clean. Generated frontend/public/manifest/sync outputs remain unstaged for integration.

## Review fix round 1 — I1 image dimension persistence integrity

Base 25a457cf. Read task-11-review.md. Fixed Important I1 only; Minor M1 reusable updateContent pre-validation mutation/editor error feedback and M2 existing multipart dependency warning remain deferred as requested.

- Shared backend graph media reference validation now rejects supplied non-null width/height unless convertible to a finite positive number <=40000000, matching the frontend dimension range. Invalid dimensions return422 before create/save/import persistence. Numeric strings normalize to numeric values only after the whole graph and all asset ownership checks pass; absent/null dimensions are omitted, consistent with frontend normalization. The same validator protects trusted clone sources and read references.
- Added real authenticated API regression for both width and height across negative/zero/out-of-range/NaN/Infinity/object/non-numeric values. Every invalid create/save/legacy-import returns422. Each rejected save preserves exact prior graphData and revision. Rejected imports create neither file nor requested folder; listing verifies no rejected file leaked. Positive fractional numeric-string and inclusive40000000 boundary save successfully and persist normalized dimensions; omitted dimensions also accepted.

RED: `cd backend && .venv/bin/python -m pytest tests/test_graph_assets.py -q` before validator change: **1 failed,3 passed** (`artifacts/canvas-m2-m5/t11/review-backend-red.log`). New regression expected422 for width=-1 create, actual200; confirms live HTTP repro rather than stub.

GREEN: `cd backend && .venv/bin/python -m pytest tests/test_graph_assets.py tests/test_question_materials.py tests/test_files_api_contract.py -q`: **12 passed**, existing single multipart PendingDeprecationWarning (`artifacts/canvas-m2-m5/t11/review-backend-green.log`). Includes prior owner-reference security, immutable copy/delete, transactional rollback and question material/file API regressions. Each run reused conftest unique migrated disposable PostgreSQL DB. No browser/source model changes, no full suite, no helper started. `git diff --check` exit0. Only service and covering backend test changed; generated files remain unstaged.

Review fix commit: **e41b2538 — fix(graph): validate image dimensions before file persistence**. Post-commit index empty and both scoped paths clean. No descendants/push/deploy/merge/branch changes.


## Independent review

Spec compliance: ✅ T11 Important I1 is resolved by fix e41b2538; no new blocking issue found in this scoped delta.
Task quality: Approved with existing Minor M1/M2 retained in the final ledger.

### Verified fix and strengths
- `backend/app/services/graph_asset_service.py:31` validates both optional dimensions, catches conversion errors, rejects non-finite numbers and enforces 0 < dimension <= 40000000. The original width=-1 case now fails before asset/file persistence.
- `backend/app/services/graph_asset_service.py:49` canonicalizes values only after the complete reference scan and ownership query succeed, ensuring numeric strings become frontend-safe numbers and null/absent dimensions are omitted. No ownership, clone trust-boundary, commit or refresh checks were removed.
- `backend/tests/test_graph_assets.py:113` adds authenticated API coverage of invalid width and height through create, save and legacy import, including exact graph/revision preservation after rejected saves and absence of rejected files/folders. Positive fractional numeric strings, the inclusive upper bound and omitted dimensions are covered.
- `task-11-report.md` fix-round evidence reports the regression failing against the old implementation (create returned 200 instead of 422), followed by 12 passing graph-asset, question-material and file-contract tests after the fix. The tests assert real API behavior, not the original review's query stub.

### Remaining nonblocking ledger
- Minor M1 remains: `new-legacy/src/graph/graph-model.js:290` assigns a content patch before throwing validation; direct callers can retain inconsistent state. Normal editor history rolls back, but reusable mutation atomicity and visible editor error feedback remain follow-up work.
- Minor M2 remains: existing Starlette multipart PendingDeprecationWarning in the reported backend run. No new warning is attributed to this fix.

### Checks and limits
- Read `review-25a457cf..e41b2538.diff` once and the appended implementation report. Reviewed only I1 resolution and fix-created breakage; no broader source inspection or suite rerun.
- ⚠️ The reported 12-test execution was not independently rerun, per review instructions. Earlier browser, complete export-mode, fresh-migration and future template-integration limitations remain unchanged. This is a development review, not human UAT approval.
