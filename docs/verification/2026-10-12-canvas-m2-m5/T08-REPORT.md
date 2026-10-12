# T08 — isolated editable related canvas

Status: DONE. Commit `f208fcb4` — `feat(graph): isolate editable related canvas sessions` (12 scoped source/test/config files). No descendants, push, branch change, merge or deployment.

## Implementation and APIs

- `KGGraphSession.create({kind,graph,fileId,persist})`: independent JSON clone; temporary sessions reject supplied persistence adapters and expose memory-only `persist()`. Formal file ID is never changed. Session owns history (`KGGraphHistoryController`), replacement state, tracked preview URLs and idempotent close. Closed state is inaccessible; close clears history and revokes tracked URLs.
- `KGRelatedCanvasController.scopeOneHop(graph,selectedIds)` includes every valid selected node (no eight-node cap), all one-hop neighbors for every relation type/direction, and all induced internal links. Unknown IDs are ignored; isolated nodes remain. Only explicitly referenced resource descriptors enter the clone.
- `KGRelatedCanvasController.create(...)` owns the overlay, local viewport, pointer sessions, keyboard/clipboard capture and listeners. Existing selection, style, connection, history and renderer factories receive session-bound callbacks. Presentation reuses context-aware `renderCardElement`; no global state swapping, timer suspension, duplicate editor page or formal save callback.
- UI: title/summary/color edit, movement, add/delete cards, add/delete connections, undo/redo, fit, wheel zoom, right-button pan, fullscreen and close/discard. The semantic notice states modifications are temporary and question actions unavailable. Empty association explains isolated-card behavior. Initial coordinates are retained, with local fit only.
- Entry accepts any nonempty selected node set. Commits formal inline text/edge drafts before awaiting formal autosave, repeats pending dirty flushes, refuses transition on failure and refuses while explicit node/link/graph form is open. Generation/state guards discard stale async opening after a lifecycle change. Existing formal history is never cleared on temporary open/close.
- Successful sanitized file replacement closes the session before installing its next formal graph. Auth account replacement/logout and pagehide close it. Failed save/file transitions retain the current temporary session. Autosave additionally refuses explicit non-formal session options.
- Capture keyboard and clipboard routing prevents formal canvas delete/undo/paste while temporary view owns interaction. Normal native text editing remains available. Cleanup removes listeners, pointer capture, overlay and session.
- Scripts registered in source homepage and homepage-bundles.json; unit suite added to existing normal frontend wrapper.

## RED / GREEN and verification

Evidence: `artifacts/canvas-m2-m5/t08/`.

- RED `node --test new-legacy/tests/graph-temporary-session.test.js`: expected missing graph-session module (unit-red.log).
- GREEN same command: **4/4 pass** (unit-green.log). Tests cover arbitrary multi-selection union, isolated nodes, induced edge closure/no recursion, clone/resource identity, remote-adapter rejection, zero writes, independent formal history/file ID, undo/redo, disposal, resource URL revocation, unknown selection and explicit autosave adapter refusal.
- Self-review identified combined form submission reading color after a content render reset the form. Added exact color assertion first; browser RED reproduced assertion failure (style-red.log). Fixed by capturing both patches before either mutation; final browser GREEN passes.
- `python3 new-legacy/tests/graph-temporary-canvas-browser.py --base-url http://127.0.0.1:62774`: **PASS** (browser-green.log). Real Chrome UI edits title/summary/color, drags a card, selects/deletes an existing rendered SVG edge, adds/deletes cards and connections, undo/redo and keyboard deletion. Formal serialized graph, viewport, file ID and undo count unchanged. GET saved source record still has original five cards/title. Zero file/question/training write requests after opening. Close/reopen drops modifications, isolated node works with explicit empty state, failed formal flush refuses opening, successful file switch and real authLogout close. No page errors. Screenshot temporary.png inspected.
- Browser-first.log exposed a context variable inadvertently passed in formal refreshCardClasses during extraction; fixed before subsequent browser passes. Second harness error arose from Playwright evaluating a returned function when restoring a mock; harness corrected with a block callback. Unrelated periodic analytics requests are not counted as temporary graph/practice persistence; graph/file/question/training mutation requests are monitored.
- `node --test frontend/scripts/graph-edge-midpoints.test.mjs`: **5/5 wrapper cases pass**, including 4 temporary tests (wrapper-green.log).
- `node new-legacy/tests/v90-p420-graph-kernel.test.js`: `v90-p420-graph-kernel-ok` (kernel-green.log).
- `pnpm --dir frontend sync:new-legacy`: successful (sync.log); all generated outputs deliberately unstaged.
- Syntax checks for editor/session/controller and `git diff --check` / staged check: exit 0.
- One full `pnpm --dir frontend test` run: **321/322 Node cases pass**, failure in unrelated `new-legacy-release.test.mjs:394` dangling-symlink reusable-report test: candidate validation reported source/site/runtime context changed during validation. Sync/source work was ongoing in shared workspace. Full downstream e2e/deploy scripts did not run because Node command failed. No full rerun; coordinator owns final integrated validation.

## Self-review and limits

- Context selection/positions now explicitly isolate card presentation; temporary mode no longer inherits formal gather/free-resize state. Edge SVG is selected explicitly so close-button SVG cannot capture edge rendering. Actual edge click/delete is browser-tested. Input patches are captured before render. Session persistence/history and lifecycle code reviewed for closure/global leakage.
- Existing graph renderer factory needed no changes: its injected persist callback is session memory-only. Existing editor remains large; removed the old 330-line singleton overlay rather than keeping both.
- Temporary editing intentionally uses a compact scoped panel and shared model/controller operations; it does not expose the entire formal toolbar, question workflows, full resource upload/editor, arbitrary advanced edge property forms or later R07 layout commands. Resource descriptors are cloned and URL ownership is supported; this task creates no new resource previews. These later feature interfaces are not claimed complete.
- No backend changes or production/UAT acceptance. User business UAT remains required.

## Cleanup

Owned helper used disposable database on port 62774. First PID 81912 exited 0 after verified SIGTERM. Final helper PID 88798 received verified SIGTERM after final browser run; tracked process/session exit and disappearance checked below. No shared or UAT server/database used. Only 12 scoped files committed; unrelated coordinator docs and generated artifacts untouched/still unstaged.

Final cleanup confirmed: final helper tracked session exited 0; process lookup found no port-62774 helper. Git index empty and T08 source/config/test paths clean after commit. Generated sync artifacts and coordinator documentation remain unstaged.

## Review fix round 1 — relation fidelity and pending inline drafts

Commit: `7514b69d` — `fix(graph): preserve temporary relations and pending drafts` (3 scoped files). Base `f208fcb4`; no descendants, push, deploy, branch mutation or full frontend rerun.

Confirmed review finding: the temporary path callback discarded original relation properties and used centers. Replaced it with injected `createGraphRelationPresentation` using real `linkRenderPoints` and `linkPathGeometry` with the temporary node map and explicit `ignoreGather:true`. Node center/outline helpers now accept context options; supplied node maps never fall back to formal nodes. Shared `applyGraphEdgeAppearance` is used by both formal rendering and temporary presentation (color, width, arrows, dash style); shared marker construction accepts the target SVG and a session-specific marker ID. Temporary labels use original type/note and path midpoint. Original ports, stored controls and waypoints reach the existing geometry implementation without reconstruction.

Confirmed concurrency gap: after the awaited save a new formal inline draft could remain active while the overlay opened. The transition now checks current lifecycle and active node/text-element/edge/modal drafts after every awaited save, refuses opening and preserves input. On explicit save failure, an initially committed draft is reopened with its same input when no newer editor has replaced it; newer drafts are left untouched. Formal file ID and viewport remain unchanged. No timer pauses or global state swaps.

RED evidence:
- `python3 new-legacy/tests/graph-temporary-canvas-browser.py --base-url http://127.0.0.1:62774` with labeled/manual/fixed-port fixture before relation fix: expected missing relation label assertion failure (`review-relations-red.log`).
- Same command with delayed-save/new-draft assertion before transition fix: `window.openResult` was True rather than False, reproducing overlay covering active draft (`review-draft-red.log`).

GREEN evidence:
- Same browser command final run: **PASS** (`review-browser-green.log`). Fixture has type `先决条件`, both arrows, dashed style at width 6, custom color, explicit left/top ports and stored curve controls. Asserts label, start/end marker references, exact `24 12` dash array, exact shared geometry path and stored control coordinates. Original AC03 tests still pass, including rendered-edge click/deletion, temporary modifications and zero graph/practice writes.
- Delayed request SUCCESS plus a new active inline draft: opening refused and editable input intact. Delayed request FAILURE plus a new inline draft: opening refused, same newer input intact. Delayed FAILURE with a draft active before opening: original editable input reopened with same text. All cases assert no overlay, unchanged formal file ID/viewport. Harness waits two animation frames after starting inline editor before typing, allowing its existing deferred caret placement to finish.
- `node --test frontend/scripts/graph-edge-midpoints.test.mjs`: **5/5 wrappers pass**, including all **4/4 session tests** (`review-wrapper-green.log`).
- `node --test frontend/scripts/graph-logout.test.mjs`: **6/6 pass**, covering pending-save/change-version/logout regressions (`review-autosave-green.log`).
- `node new-legacy/tests/v90-p420-graph-kernel.test.js`: `v90-p420-graph-kernel-ok` (`review-kernel-green.log`).
- Sync successful (`review-sync.log`), syntax checks and diff/staged whitespace checks exit 0. Generated files remain unstaged.

Self-review: shared presentation retains original data while resolving only temporary nodes; marker IDs avoid formal/temporary collisions; pending transition preserves newer input rather than recommitting it blindly. Explicit failure restoration does not replace a newer editor or reopen on a stale lifecycle. Deferred minor findings (remaining dense controller functions and pointercancel committing partial movement) are unchanged as requested. Full integrated CI/UAT remains coordinator responsibility.

Owned disposable helper PID 90782 on port 62774 received verified SIGTERM after final browser pass; cleanup verification follows.
Final fix-round cleanup confirmed: helper tracked session exited 0, process lookup found no owned helper, index empty and source/test paths clean.


## Independent review

### Finding Verdicts

- **Relation labels/arrows/style/ports/manual routes discarded** — ADDRESSED. `new-legacy/src/10-graph-editor.js:535` injects the shared relation presentation and marker builders. `:1242` extracts edge appearance used by the formal renderer; `:1251` passes the full original link and temporary node map through existing port/path geometry. `new-legacy/src/graph/related-canvas-controller.js:27-39` creates session-specific markers, renders the returned path/label, and explicitly ignores formal gather positions. Supplied maps no longer fall back to formal nodes (`new-legacy/src/10-graph-editor.js:233`). The browser fixture now contains a labeled, directed, dashed fixed-port/manual curve and asserts labels, both markers, dash array and stored-control geometry (`new-legacy/tests/graph-temporary-canvas-browser.py:12`, `:29-32`).
- **An active inline draft started during delayed saving could be covered** — ADDRESSED. `new-legacy/src/10-graph-editor.js:501-502` checks draft activity; `:518-525` checks lifecycle and active drafts after every awaited save, aborting the opening while retaining new input. Browser cases exercise delayed success and delayed failure with newer drafts, no overlay, and preserved file ID/viewport (`new-legacy/tests/graph-temporary-canvas-browser.py:57-78`).
- **Failure needed input-preservation proof** — ADDRESSED. `new-legacy/src/10-graph-editor.js:499-513` captures the initial node/text/edge draft and restores editable input on explicit failure only when the lifecycle is still current and no newer draft exists. The added delayed failure case starts with an active draft and asserts the restored editable text plus unchanged file ID/viewport (`new-legacy/tests/graph-temporary-canvas-browser.py:80-88`).

### New Breakage in the Fix Diff

- None found. Existing formal edge appearance is extracted without changing its values/defaults; normal callers retain gather behavior, while temporary callers supply ignoreGather and a local node map. Async transition guards do not overwrite newer editors.

### Out-of-Scope Observations

- Prior Minor findings remain deferred: dense interaction functions and pointercancel committing partial moves (`new-legacy/src/graph/related-canvas-controller.js:40-52`). These do not block this scoped fix round.
- Full integrated CI and human UAT remain outside this task gate; the prior report's 321/322 integration result is not superseded by focused fixes. Resource-preview UI is still outside the implemented scope.

### Checks

- Read the fix package; continued its tool-output-truncated relation/controller segment from the same package. Inspected the fix only, without rereviewing untouched implementations or git operations.
- Verified the appended report identifies relation RED, delayed-draft RED, final browser GREEN, wrapper 5/5, autosave/logout 6/6 and kernel checks. Read existing review-browser-green.log, review-wrapper-green.log and review-autosave-green.log: clean PASS / 5/5 / 6/6 outputs.
- No test reruns or source/index/branch mutations; only this report written.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.

**Spec compliance:** ✅ Task-scoped requirements addressed, subject to the recorded integration/resource-preview limits.

**Task quality:** Approved. Independent state/history/persistence isolation remains intact; this fix restores relation fidelity and guards/restores formal drafts across delayed save outcomes. Deferred minors belong to the final gate.
