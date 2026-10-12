# T09 — shared text sessions, blur persistence and edge/font resizing

Status: DONE. Source-only commit `a73554a5` — `feat(canvas): resize and autosave editable text boxes` (23 files). No descendants, branch changes, merge, push or deployment. Generated public/sync artifacts deliberately remain unstaged.

## Implemented contracts

- Backend shared ink schema accepts text font sizes 6–288, empty existing text, optional finite `boxWidth` 40–4000 and `boxHeight` 24–4000. Numeric booleans and unknown fields remain rejected; non-text tool fields remain bounded and text-only fields rejected. Both recall and workspace consumers use this same validator.
- `KGTextBoxGeometry.resize(startBox, handle, {x,y}, limits)` returns x/y/width/height/fontSize from the frozen start. Font is clamp(f0 * sqrt(w1*h1/(w0*h0)),6,288); west/north keep opposite edges anchored. Minimum 40×24, maximum 4000×4000. 200×100 at font20 → east400 gives 28.284271; corner400×200 gives40.
- `KGTextEditSession.create({original,persist})` owns draft/version/composition and statuses draft/committing/committed/failed. `update`, async `commit`, `cancel`, `setComposing`, `state` preserve failed drafts, support retry and prevent old async completion closing a newer draft. Synchronous persistence throws remain retryable.
- Shared ink editor on all three pages removes Save/Cancel buttons and text font slider. Canvas zoom controls remain. Outside pointer/blur commits, Ctrl/Command+Enter remains, Escape cancels. Toolbar colors/bold retain the session and input; IME outside commits defer until composition end. Native editing/deletion is untouched.
- Existing empty text remains as an object and is undoable; new empty text creates no object. Wire normalization preserves box sizes/bold. Canvas measurement wraps SVG text by available world width, with full Unicode code points and explicit newlines; content grows box height rather than scaling down/cropping.
- Eight ink edge/corner handles preview from the initial snapshot and call existing change/history once at pointerup; Escape/pointercancel restore the original without a resize history entry. Legacy text frame derives from measured rendered-font lines; persisted boxed text is hit by its frame.
- Each page supplies an acknowledged persistence callback: homepage graph autosave `saveNow({force:true})`; workspace adapter `flush({throwOnError:true})`; recall `flushProgress()`. Failed remote persistence retains mounted editor/draft and visible failed state. Retrying identical applied draft does not repeat the history mutation. Working state remains dirty/undoable while save fails.
- Homepage formal card title/independent text controller uses the shared session and waits for autosave before cleanup. Formatting toolbar stays accessible; editable DOM is preserved during targeted updates. Empty title remains “未命名知识点”; emptied independent text remains empty (Chromium's lone contenteditable newline canonicalizes to empty). Cancel restores original model content.
- Graph independent text resize supplies font snapshot to existing shared resize controller, applies area-scaled font and grows height to real laid-out content. Node resize keeps its old default geometry path. Existing graph transaction produces one undo step and Escape restores initial size/font/manualSize.
- Formal file switching, workspace switching, recall question switching and temporary related-canvas opening wait for text draft commit and refuse transition on failure. Unexpected reset while an editor remains explicitly preserves a stale draft, marks it unavailable for saving into the new canvas, permits native copying/Escape, and clears old own history. Destroy refuses to silently discard an active draft.
- Removed selected text glyph `drop-shadow(0 0 2px #2563eb)`; selection remains visible through borders/handles. Clear selected/unselected/editing screenshots inspected at homepage100%; shared browser exercises world scale2. No glyph stretching.
- Shared scripts registered before consumers in all three source pages and homepage-bundles.json. New normal frontend wrapper runs shared session/geometry and existing ink wire tests.

## RED / GREEN evidence

Logs/screenshots: `artifacts/canvas-m2-m5/t09/`.

- `node --test new-legacy/tests/canvas-text-box.test.js`: RED missing geometry/session modules (`unit-red.log`), GREEN exact east/corner formula, all edges/clamps, immutable start, failed retry/cancel, newer draft and composition protections. Final wrapper also covers synchronous persistence throw retry (4 unit cases).
- `cd backend && .venv/bin/python -m pytest tests/test_canvas_ink.py -q`: RED new optional-box/empty/font acceptance rejected (`backend-red.log`,1failed/43passed), final GREEN **44passed** (`backend-green.log`). Existing Starlette multipart deprecation warning remains; no new test warning.
- `python3 new-legacy/tests/canvas-ink-text-browser.py`: RED old text-font slider still present (`browser-red.log`); final GREEN `canvas-ink-text-browser: passed` (`browser-green.log`). Tests actual typing/newline/format focus, drag/cancel, undo/redo, Escape, failed write draft retry, native editing/IME, readonly, all four edge font/geometry changes and one undo per gesture; corner cancel retains original. Clarity RED asserted selected computed filter none before CSS fix (`clarity-red.log`), final GREEN computed filter none.
- `python3 new-legacy/tests/canvas-text-persistence-browser.py --base-url http://127.0.0.1:62819`: final **PASS home / recall / workspace** (`persistence-green.log`). Each performs external/IME commit, actual native Backspace editing and formatting focus, real edge drag with sqrt font assertion, one-step undo/redo, actual server503 failure retention/retry, API DB readback of width/height/font, reload and exact line-count/wrapping, existing text clear/undo. Generates selected/unselected/editing screenshots for every page. Fixture clears prior disposable ink to avoid multiple runs' data ambiguity.
- `python3 new-legacy/tests/canvas-graph-text-browser.py --base-url http://127.0.0.1:62819`: GREEN (`graph-green.log`) actual contenteditable and own format toolbar interaction, actual remote503 retention/retry, DB readback, east resize20→28.28 and exactly one history count, Escape frame/font restoration, empty title fallback and empty independent text. First final assertion RED exposed Chromium empty contenteditable returning lone newline (`graph-second.log`), corrected in shared inline normalization.
- `python3 new-legacy/tests/graph-temporary-canvas-browser.py --base-url http://127.0.0.1:62819`: **PASS** (`temporary-regression.log`) including original relation fidelity, isolated edits/zero writes, pending/newer draft failure boundaries, formal switch/logout.
- `node --test frontend/scripts/canvas-text-box.test.mjs frontend/scripts/graph-logout.test.mjs frontend/scripts/graph-edge-midpoints.test.mjs`: final **13/13 wrappers passed** (`regressions.log`), including4 session/geometry cases and5 ink units. Autosave/version/logout and edge/temporary contracts retained.
- `node new-legacy/tests/v90-p420-graph-kernel.test.js`: `v90-p420-graph-kernel-ok` (`kernel.log`).
- Syntax checks for modified JS controllers/adapters exit0. `git diff --check` exit0. `pnpm --dir frontend sync:new-legacy` successful (`sync.log`); generated files excluded from commit.

An intermediate browser run overlapped two fixtures on the same helper/current-file user, producing a home composition-save failure; final three-page run was sequential and passed. Another earlier reload test forgot to dismiss homepage onboarding; fixture corrected and all three final pages passed. No product behavior bypass was used.

## Self-review, limits and cleanup

- Reused existing source/adapters/history; no dependency added, no direct edits to generated/site files. Geometry/session isolated in named shared modules; ink layout stays in shared ink implementation. Existing graph editor remains large; task only adds hooks.
- Empty text frontend/backend contracts are coordinated. Failed edits remain dirty working data; failure never closes/relabels as successful. Newer pending input remains editable, and retry avoids duplicate identical mutation. Unexpected lifecycle reset cannot save an old draft into a new canvas.
- Browser coverage is Chromium with100% browser zoom and screenshot homepage100% canvas plus shared scale2; full Safari/DPR/browser zoom matrix and integrated full CI/release/UAT remain controller/T20 work. No full pnpm test run. User UAT is not claimed.
- Owned disposable helper PID95305 on port62819 received SIGTERM after tests. Tracked exec session75833 exited0; `ps -p95305` confirmed absence. Disposable helper teardown drops its own isolated test database. No shared/UAT server was changed.

Final cleanup: Git index empty after commit; tracked source/config/test changes are committed. Only generated public/sync files remain dirty.

## Review fix round 1 — reconcile original input and acknowledge current write

Base `a73554a5`. Important findings confirmed and fixed; minor wheel-during-resize cancellation and pre-existing multipart dependency warning intentionally deferred as directed. No descendants, branch changes, push, deployment or full test suite.

- Inline controller tracks a commit attempt. The unchanged-original shortcut only applies before any model-mutating commit attempt; after a failed save, returning input to the original runs the normal reconciliation/persistence callback and closes only after success. Both title and independent text now restore their actual model and server value.
- Added `KGGraphFileAutosave.saveAcknowledged(options,isCurrent)` in the existing shared persistence module. `saveNow` retains its existing pending-request contract. The new helper waits for pending success and then drains dirty writes until current graph is clean; any failure returns false. It captures formal file ID and checks it plus caller-supplied graph state identity before/after each awaited request, refusing stale contexts and further writes after replacement. Homepage ink and graph inline editor both use this helper, avoiding duplicated loops.
- Existing temporary-modal drain remains intact; no unrelated transition work added.

RED:
- `python3 new-legacy/tests/canvas-graph-text-browser.py --base-url http://127.0.0.1:62819` before inline fix: failed-save→original→outside reproduced `('node','未命名知识点','拒绝的中间草稿')` (`review-original-red.log`). New browser regression checks both card title and independent text, including GET graphData server readback.
- Same command after original-input fix and before shared acknowledgement fix: old pending success removed the inline editor rather than giving `data-save-state=failed` (`review-pending-red.log`). Harness waits for current title model mutation before releasing old request, so the required ordering is deterministic. An earlier immediate-release run also reproduced premature ink closure.
- `node --test new-legacy/tests/canvas-text-box.test.js`: missing shared saveAcknowledged API (`review-ack-red.log`). Test uses real autosave implementation and controlled persistence completions.

GREEN:
- Same graph browser command: PASS (`review-browser-green.log`). Alongside original graph editing/resize coverage, both original-restoration cases pass; inline and ink each hold an old request, apply latest input, resolve old success, observe exactly2 requests with new save failure, retain failed current input and dirty graph, then retry successfully and close. No page errors.
- `node --test new-legacy/tests/canvas-text-box.test.js`: **5/5 passed** (`review-ack-green.log`), including older pending success followed by current failure, dirty retention, and captured file context changing while awaiting save (refuses acknowledgment).
- `node --test frontend/scripts/canvas-text-box.test.mjs frontend/scripts/graph-logout.test.mjs`: **8/8 wrapper tests passed** (`review-wrapper-green.log`); shared5 tests and ink5 tests run through normal wrapper. Autosave/version/logout contracts retained.
- Syntax checks for autosave/graph/inline controller and `git diff --check`: exit0. Sync successful (`review-sync.log`), generated outputs remain unstaged. Backend unchanged; no backend or full frontend rerun needed.

Cleanup: owned disposable helper PID1342, port62819, received SIGTERM; tracked session98718 exited0 and `ps -p1342` confirms absence. Initial browser launch before helper finished booting failed connection; rerun after its explicit DB startup completed produced the RED behavior above, then GREEN after fixes. No shared/UAT server changed.

Fix-round commit: `debacb8f` — `fix(canvas): acknowledge current text drafts before closing` (6 scoped source/test files). Final Git index empty; generated sync/public files remain unstaged.


## Independent review

### Finding Verdicts

- **Failed inline save followed by restoring original input closes with wrong model** — ADDRESSED. `new-legacy/src/graph/inline-text-editor-controller.js:72–73` now permits the unchanged-original shortcut only before a commit attempt. A failed/model-mutating attempt followed by original input invokes the ordinary model reconciliation and acknowledged persistence callback. `new-legacy/tests/canvas-graph-text-browser.py:30–36` covers both title and independent text, checking live model and server readback.
- **Older pending save falsely acknowledges current draft** — ADDRESSED. `new-legacy/src/24-graph-file-autosave.js:53–61` adds a shared acknowledgement helper that awaits the older pending request, drains remaining dirty writes, rejects any failed write, and checks captured file/context identity before and after every await. Both callers use it (`new-legacy/src/canvas/95-home-canvas-tools.js:14`, `new-legacy/src/10-graph-editor.js:3087`). `new-legacy/tests/canvas-text-box.test.js:21–27` controls old success/current failure and context replacement; `new-legacy/tests/canvas-graph-text-browser.py:38–47` verifies retained current drafts for both homepage inline and ink editors with successful retry.

### New Breakage in the Fix Diff

- None identified. The helper preserves the existing saveNow contract and centralizes acknowledgement rather than duplicating page loops (`new-legacy/src/24-graph-file-autosave.js:53`). The inline flag is per-session and does not disable the untouched-editor fast path (`new-legacy/src/graph/inline-text-editor-controller.js:72`).

### Out-of-Scope Observations

- Previously recorded minor wheel-during-text-resize cancellation gap (`new-legacy/src/canvas/94-canvas-ink.js:375`) and pre-existing backend multipart warning remain intentionally deferred; neither lies in the fix diff or blocks this scoped round.
- Full D10 Safari/DPR/browser-zoom validation, integrated release checks and human UAT remain controller/integration gates; this scoped approval does not verify them.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.

**Spec compliance:** ✅ T09 compliant within the reviewed scope; integration-only cannot-verify items above remain.

**Task quality:** Approved.

### Checks

- Read supplied `review-a73554a5..debacb8f.diff` once and the appended fix report; no broader code review, suites rerun, descendants, source/index/branch changes, push or deployment.
- Inspected existing run logs: `artifacts/canvas-m2-m5/t09/review-ack-green.log` shows 5 tests passed/0 failed, `review-browser-green.log` shows graph browser PASS, and `review-wrapper-green.log` shows 8 wrapper tests passed/0 failed. Diff regression assertions cover both reported fixes; report documents corresponding RED failures.
