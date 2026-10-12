# T05 implementation report

Status: DONE

## Scope and behavior

- Added `new-legacy/src/graph/edge-geometry.js` and registered it in `new-legacy/index.html` and `frontend/scripts/homepage-bundles.json`.
- Cubic curve handles render at t=1/3 and t=2/3 on the painted path. Dragging one handle solves the two cubic controls while preserving the other handle's on-path location. Existing `curveControls` storage remains unchanged.
- Card dragging and selection-bounds dragging snapshot affected manual routes at pointerdown. Every frame derives manual controls and waypoints from the snapshot and current rendered endpoints. Equal endpoint deltas translate every stored point exactly once; unequal deltas use the original endpoint-axis projection, clamped to [0,1]. Attached endpoints retain their node IDs. Cancel restores card positions, route points, and bindings; undo/redo and persistence use the existing graph history and save flow.
- Whole-edge dragging still explicitly detaches endpoints and translates its underlying cubic controls. The curve style option, when clicked while already selected on a manual curve, restores automatic curve routing; the existing elbow and rounded detour routes remain available.
- Selected curve toolbar placement was moved above the on-path handles after real Chrome testing showed it covered the first handle.

## Shared API for T06 and T10

`window.KGGraphEdgeGeometry` and CommonJS export expose:

```js
curveHandles(start, controls, end)           // two points at t=1/3 and 2/3
controlsFromHandles(start, handles, end)     // two cubic controls
moveRoute(route, startDelta, endDelta)       // new route; input unmodified
```

`Point` is `{x:number,y:number}`. `moveRoute` requires `route.start` and `route.end` as the **rendered outline endpoint coordinates before movement**. Its route shape is `{start, end, from?, to?, fromPoint?, toPoint?, pathStyle?, curveControls?:Point[], waypoints?:Point[]}`. The returned route has translated `start`/`end`, translated manual point arrays, preserved binding fields, and translated free endpoint fields when present. Other fields are carried through. The graph editor builds this shape from `edgeRouteSnapshot(link)` plus `linkRenderPoints(link)` and supplies deltas between the new and snapshot rendered endpoints. The function does not mutate the input route or its point arrays.

## RED / GREEN evidence

- RED: `node --test new-legacy/tests/graph-edge-geometry.test.js new-legacy/tests/graph-edge-midpoints.test.js` failed while `edge-geometry.js` was absent. After adding the module, the updated midpoint test failed because the editor still exposed raw controls and later because `captureNodeDragRoutes` was missing.
- GREEN: the new geometry unit tests passed the cubic round-trip (<1e-6), stationary opposite handle, exact rigid translation, and one-end weighted movement cases. The midpoint test passed the graph integration route snapshot, dual-node translation, and binding restore cases.
- Browser RED: actual Chrome clicking the first visible curve handle hit the floating edge toolbar. Browser GREEN: changing curve toolbar placement let the real pointer drag change the cubic while keeping both handles on the painted path.
- Browser RED/GREEN: selecting curve style again initially left manual controls in place; after the reset behavior was added, the route returned to automatic controls and undo restored the manual route.

## Verification

- `node --test new-legacy/tests/graph-edge-geometry.test.js new-legacy/tests/graph-edge-midpoints.test.js frontend/scripts/graph-edge-midpoints.test.mjs frontend/scripts/homepage-bundles.test.mjs new-legacy/tests/v90-p437-unified-edge-toolbar.test.js`: 10/10 passed.
- `node --check` for modified editor and toolbar scripts, `python3 -m py_compile` for browser test, and `git diff --check`: passed.
- `graph-interaction-focus-browser.py --section all`: tabs, card edit, focus, existing edge midpoint, and new curve scenarios passed in Chrome against a disposable PostgreSQL database. The curve scenarios exercised actual handle drag, dual-card drag, single-end drag, cancel, undo/redo, viewport pan/zoom, save/reload. After the automatic-reset change, `--section curves` passed again, including reset and undo.
- The disposable server was stopped after testing. `pnpm sync:new-legacy` was used only to serve current source for browser verification; generated sync outputs remain unstaged for the controller's release pass.

## Limits

No full backend/frontend suite, release promotion, UAT deployment, or human business acceptance was performed in this scoped task. The controller owns those gates and generated artifact commits. The browser test covers ordinary cubic edges; the existing overlapping-card rounded detour intentionally retains waypoint handles.

## Review round 1: cancelled gesture history

The reviewer found that cancelled card and selection-bounds moves restored graph coordinates but retained a provisional undo entry and erased prior redo. The same checkpoint pattern also affected curve-handle, whole-edge, and endpoint drags. These gestures now begin a history transaction, capture their pre-move state on first movement (or before a handle's derived route initialization), commit only on successful completion, and roll back on cancellation. `resetGraphPointerInteractions` and graph-mode cancellation use the same rollback path. Rollback restores graph state and leaves pre-existing undo/redo stacks intact.

The new `--section cancel-history` Chrome regression seeds two real model-geometry edits, undoes the second to establish both stacks, then cancels each of the five gestures after actual movement. For each, it asserts exact graph and history state equality, redoes the prior edit, undoes it, and confirms the next undo reaches the earlier edit. Before the fix, the card case failed with `undoCount: 2, redoCount: 0` versus expected `undoCount: 1, redoCount: 1`; see `artifacts/canvas-m2-m5/t05/cancel-history-red.log`. The initial GREEN test run exposed a test-fixture error: its seed changed only the flat `node.x`, while model normalization retained `geometry.x`; the seed now uses `KGGraphModel.updateGeometry`.

Focused verification on 2026-10-12:

- `node --check new-legacy/src/10-graph-editor.js && python3 -m py_compile new-legacy/tests/graph-interaction-focus-browser.py && git diff --check -- new-legacy/src/10-graph-editor.js new-legacy/tests/graph-interaction-focus-browser.py`: passed.
- `cd frontend && pnpm sync:new-legacy`: passed; log `artifacts/canvas-m2-m5/t05/sync-green.log`. Generated outputs were left unstaged.
- `node --test new-legacy/tests/graph-edge-geometry.test.js new-legacy/tests/graph-edge-midpoints.test.js new-legacy/tests/v90-p420-graph-kernel.test.js`: passed; log `artifacts/canvas-m2-m5/t05/node-green.log`.
- `python3 new-legacy/tests/graph-interaction-focus-browser.py --base-url http://127.0.0.1:59790 --section cancel-history`: passed; log `artifacts/canvas-m2-m5/t05/cancel-history-green.log`.
- `python3 new-legacy/tests/graph-interaction-focus-browser.py --base-url http://127.0.0.1:59790 --section curves`: passed; log `artifacts/canvas-m2-m5/t05/curves-green.log`.

The targeted browser test used the disposable database helper server on port 59790. No full suite or release validation was repeated for this review fix.

## Independent review

### Finding Verdicts

- **Cancelled card/group and selection-bounds drags leave a checkpoint and erase prior redo** — ADDRESSED. Both gestures now begin a history transaction and use `finishGraphGestureHistory` to roll it back on cancel (`new-legacy/src/10-graph-editor.js:1659-1660`, `new-legacy/src/10-graph-editor.js:1871`, `new-legacy/src/10-graph-editor.js:1903`, `new-legacy/src/10-graph-editor.js:2837`, `new-legacy/src/10-graph-editor.js:2894`). `resetGraphPointerInteractions` also cancels an active selection-bounds transaction (`new-legacy/src/10-graph-editor.js:2197`) and rolls back a card transaction (`new-legacy/src/10-graph-editor.js:2205`).

### New Breakage in the Fix Diff

- None. The same transaction flow covers curve-handle, whole-edge, and endpoint cancellation (`new-legacy/src/10-graph-editor.js:1158-1256`), including graph-mode cancellation (`new-legacy/src/10-graph-editor.js:4250-4252`).

### Out-of-Scope Observations

- None.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage. The focused Chrome regression asserts exact graph/history state after five cancelled gestures and verifies prior redo and next undo (`new-legacy/tests/graph-interaction-focus-browser.py:162-195`). The supplied `cancel-history-green.log`, `curves-green.log`, and `node-green.log` report passing runs with no warnings; no suites were rerun during this review.
