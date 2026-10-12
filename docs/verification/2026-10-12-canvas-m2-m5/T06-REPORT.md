# T06 — Fixed connection ports

Status: DONE. Scoped implementation on `codex/canvas-m2-m5`; no branch switches, pushes, deployments, main/uat edits, or active-release changes.

## Implemented behavior

- Every new homepage graph link defaults to `fromPort: 'auto', toPort: 'auto'`. Each side accepts exactly `auto|top|right|bottom|left`. Missing fields, unknown strings (including inherited object-property names), and invalid types normalize to `auto`.
- Selected links expose independent start/end connection choices plus “恢复自动连接” in a compact dedicated connection-position popover. The shared toolbar renders that capability only when both real `onPort` and `onPortsReset` handlers are supplied; other canvases get no inert controls. Selected-link batches use the existing mixed-value behavior.
- Endpoints intersect rectangle side centers, ellipse outlines, and the actual triangle outline. Cardinal triangle fixtures at `{x:10,y:20,width:200,height:100}` produce right `{x:160,y:70}` and left `{x:60,y:70}`, rather than the outer rectangle edges. Existing automatic rectangular midpoints, shape ray intersections, and automatic overlapping-projection detours remain tested.
- Automatically generated cubic controls use the selected fixed side's outward tangent; explicitly stored manual curves/waypoints remain intact.
- Creation, controller connection, sanitizer/export, persistence hydration/storage, route snapshots, drag cancellation, history, and rebinding preserve both ports. View transforms do not change their stored values.

## Files changed

1. `new-legacy/src/graph/edge-geometry.js`: shared outline-port math and cardinal directions.
2. `new-legacy/src/00-config-state.js`: link defaults and sanitizer.
3. `new-legacy/src/10-graph-editor.js`: consume shared math, route snapshots/restoration, automatic fixed-side cubic tangents, selected-link port mutations/tool wiring.
4. `new-legacy/src/graph/connection-controller.js`: optional endpoint choices during connection.
5. `new-legacy/src/graph/graph-persistence.js`: shared enum normalization and hydrate/storage integration.
6. `new-legacy/src/canvas/92-canvas-edge-toolbar-controller.js`: optional compact port popover, mixed values, focus preserving commits.
7. `new-legacy/tests/graph-fixed-ports.test.js`: six behavioral unit tests.
8. `new-legacy/tests/graph-edge-midpoints.test.js`: load the real persistence module required by route snapshots.
9. `new-legacy/tests/graph-interaction-focus-browser.py`: `ports` section and configurable output directory.
10. `frontend/scripts/graph-edge-midpoints.test.mjs`: fixed-port unit test integrated into normal `pnpm test` wildcard wrapper.

No new homepage module: T05 already registers edge-geometry in source index.html and homepage-bundles.json. Generated sync artifacts were produced by the existing sync command for browser verification and are deliberately left unstaged for the controller.

## Exact interfaces

- `KGGraphEdgeGeometry.portPoint(nodeGeometry, port, oppositeCenter) -> {x,y}`. `nodeGeometry` is `{x,y,width,height,cardStyle?}`; `cardStyle` is the existing canonical style, with `circle` and `triangle` handled by their outlines. `oppositeCenter` is `{x,y}` and drives automatic ports. Unknown ports use automatic geometry.
- `KGGraphEdgeGeometry.portDirection(port) -> {x,y}|null`. Fixed sides return cardinal outward vectors; auto/invalid return null. CommonJS export remains available for geometry.
- `KGGraphPersistence.normalizePort(value) -> enum`, default `'auto'`.
- `KGGraphPersistence.normalizeLinkPorts(link) -> new link`, retaining other fields; malformed legacy nonobject entries are left for the sanitizer to discard. Both hydrate/toStorageState invoke this. Default operations do not mutate the input graph.
- `KGGraphConnectionController.create(options).connectTo(targetId, ports={})`, where `ports` optionally supplies fromPort/toPort; absent choices retain valid factory fields or default auto. Existing single-argument callers remain valid.
- Shared edge toolbar `create({onPort(side,value),onPortsReset(),...})`; `side` is `'from'|'to'`. `show/update` accepts `fromPort/toPort`, with null representing a mixed selection.
- Existing `edgeRouteSnapshot/restoreEdgeRoute` include both normalized fields. Existing T05 gesture transaction/history fields are unchanged. `moveRoute` retains ports through its existing route object spread.

## RED evidence

All evidence is under `artifacts/canvas-m2-m5/t06/`.

- `node --test new-legacy/tests/graph-fixed-ports.test.js`: initial 0/4 pass, 4 fail (`unit-red.log`). Missing `portPoint`, dropped sanitizer fields, and absent controller choices failed as expected.
- Same command after adding cubic tangent contract: 4 pass, 1 fail (`tangent-red.log`): a fixed left port incorrectly generated a rightward initial control.
- Same command after inherited-name and malformed-legacy cases: 4 pass, 2 fail (`invalid-red.log`): inherited port name failed automatic geometry and null legacy link crashed hydration.
- `python3 new-legacy/tests/graph-interaction-focus-browser.py --base-url http://127.0.0.1:62771 --section ports --output-dir artifacts/canvas-m2-m5/t06`: initial missing actual toolbar selectors (`browser-red.log`).
- Expanded browser native-scroll assertion also failed before focus/compact-popup changes (`reset-scroll-red.log`). Follow-up diagnostic established that Playwright locator.click's scrollIntoView moved the overflow-hidden stage despite a visible trigger. Direct coordinate mouse clicks at verified visible controls distinguish real human interaction from that harness action. Final tests retain native-scroll assertions and have no scroll normalization.

## GREEN evidence

- `node --test new-legacy/tests/graph-fixed-ports.test.js`: 6 pass, 0 fail (`unit-green.log`).
- `node --test frontend/scripts/graph-edge-midpoints.test.mjs`: 3 wrapper cases pass, 0 fail (`wrapper-green.log`). Runs fixed-port tests, existing cubic geometry tests, and directional/obstacle/manual-route midpoint tests.
- `node new-legacy/tests/v90-p420-graph-kernel.test.js`: `v90-p420-graph-kernel-ok` (`kernel-green.log`).
- `python3 new-legacy/tests/graph-interaction-focus-browser.py --base-url http://127.0.0.1:62771 --section ports --output-dir artifacts/canvas-m2-m5/t06`: PASS (`browser-green.log`). Actual Chrome checks independent start/end choices, repeated card drags, real corner resizing, long-title edit, actual zoom button, restore-auto/undo, actual endpoint drag/cancel, rebind to another card/undo/redo, API persistence/reload, old automatic-link compatibility, and no page errors. Painted SVG endpoints are compared against card DOM boundary coordinates rather than against the port algorithm itself. Every recorded native-scroll sample is `{left:0,top:0}`, including port selection, reset/undo, and fit. Screenshot: `fixed-ports.png`.
- `pnpm --dir frontend sync:new-legacy`: successful (`sync.log`), used only for the disposable browser server.
- `git diff --check`: exit 0.

## Isolated server and cleanup

`backend/.venv/bin/python new-legacy/tests/helpers/canvas_ink_server.py --port 62771` used the existing helper's migrated unique disposable PostgreSQL database. Server log: `artifacts/canvas-m2-m5/t06/server.log`. Exact helper PID 67549 was verified before SIGTERM. Helper session exited 0, executing its engine disposal/database-drop cleanup; matching process lookup afterward returned no process. No production or UAT database was used.

## Scope and limitations

- Homepage card content edits preserve explicit manual dimensions, consistent with T03. The long-title browser edit verifies boundary attachment and unchanged resized geometry. Increased height is exercised by the existing real resize path and changed-geometry unit fixture; this task introduces no separate text auto-height policy. Later text-sizing/integration tasks remain explicit.
- Fixed-port functionality here belongs to the knowledge graph. Workspace/recall fixed ports and later text-sizing behavior are outside T06; their shared toolbar remains compatible because this capability is optional.
- Explicit straight/manual routing still follows its chosen route; no new general obstacle router was introduced. The old automatic-port obstacle behavior is covered by unchanged midpoint regressions.
- This is development self-check, not user UAT acceptance. Full release suites, source/manifest promotion and environment deployment remain controller work. No broader suites were run after the focused pass.

## Commit

`2bd21a8c` — `feat(graph): persist fixed card connection ports`. Ten scoped files committed. Post-commit status contains only generated sync outputs; the index is empty. Controller documentation and this ignored task report were not staged.


## Independent review

# T06 task review — a4e2f7ad..2bd21a8c

## Spec Compliance

- ✅ Spec compliant. Fixed `auto|top|right|bottom|left` ports are implemented in shared geometry, creation, selected-link editing, sanitization, persistence and route restoration. Evidence: `new-legacy/src/graph/edge-geometry.js:33`, `new-legacy/src/00-config-state.js:16`, `new-legacy/src/00-config-state.js:226`, `new-legacy/src/graph/connection-controller.js:20`, `new-legacy/src/graph/graph-persistence.js:7`, `new-legacy/src/10-graph-editor.js:1099`.
- ✅ Four fixed sides and actual circle/triangle outline intersections are independently asserted, including triangle left/right intersections inside the enclosing rectangle. Missing fields and invalid values retain automatic behavior. Evidence: `new-legacy/tests/graph-fixed-ports.test.js:17`, `new-legacy/tests/graph-fixed-ports.test.js:24`, `new-legacy/tests/graph-fixed-ports.test.js:30`.
- ✅ Both endpoint selections and restoration to automatic are exposed through the shared toolbar; persistence and undo use the existing editor history/render paths. Evidence: `new-legacy/src/canvas/92-canvas-edge-toolbar-controller.js:65`, `new-legacy/src/canvas/92-canvas-edge-toolbar-controller.js:98`, `new-legacy/src/10-graph-editor.js:1331`.
- ✅ AC02 coverage exercises independent choices, repeated actual card movement, increased dimensions through actual resizing, long-title content edits preserving manual dimensions, actual zoom, endpoint cancellation/rebinding, undo/redo and API save/reload. It compares painted SVG endpoints with DOM card boundaries, rather than reusing the port algorithm as its oracle. Evidence: `new-legacy/tests/graph-interaction-focus-browser.py:96` and `artifacts/canvas-m2-m5/t06/browser-green.log:2`.
- ✅ Scope follows the explicit clarification: no new content auto-height policy is introduced. The browser test asserts preserved manually resized dimensions after a long title edit. Evidence: `new-legacy/tests/graph-interaction-focus-browser.py:134`.
- ⚠️ Later integration, release promotion, UAT deployment and user acceptance cannot be verified from this task diff and are explicitly outside this gate. The controller must perform them under the global constraints. `task-6-brief.md` sections “Execution boundaries” and “Global Constraints”; `task-6-report.md` section “Scope and limitations”.

## Strengths

- Shared `portPoint` replaces the editor's prior shape intersection implementation instead of creating parallel algorithms. Automatic geometry remains equivalent, while fixed positions use actual outline intersections. `new-legacy/src/graph/edge-geometry.js:36`, `new-legacy/src/10-graph-editor.js:227`.
- Enum validation has one persistence entry point used by sanitization, connection creation and snapshot restoration; it rejects invalid types and inherited-property names without unsafe object-key lookups. `new-legacy/src/graph/graph-persistence.js:7`, `new-legacy/tests/graph-fixed-ports.test.js:24`.
- Manual route controls remain authoritative; outward tangents are introduced only for generated cubic controls, and existing automatic-port obstacle handling is retained. `new-legacy/src/10-graph-editor.js:325`, `new-legacy/tests/graph-fixed-ports.test.js:59`, `frontend/scripts/graph-edge-midpoints.test.mjs:5`.
- The toolbar capability is conditional on actual handlers, preserving callers that do not support fixed ports. Its select/reset actions return focus with `preventScroll`, with native-scroll evidence from actual browser interaction. `new-legacy/src/canvas/92-canvas-edge-toolbar-controller.js:65`, `new-legacy/src/canvas/92-canvas-edge-toolbar-controller.js:114`, `artifacts/canvas-m2-m5/t06/browser-green.log:1`.

## Issues

### Critical (Must Fix)

- None found in the task diff.

### Important (Should Fix)

- None found in the task diff.

### Minor (Nice to Have)

- None requiring action for this task gate.

## Checks and Review Boundaries

- Reviewed the supplied diff package, including its initially truncated middle through bounded continuation reads. No changed source file was separately read in full; no suites were rerun and no source, Git state or branches were modified.
- Named risk: new direct calls to `KGGraphPersistence.normalizePort` could execute before that module loads. Focused registration check confirms persistence precedes connection-controller and config-state in both source HTML and generated-homepage bundle configuration. `new-legacy/index.html:388`, `new-legacy/index.html:393`, `new-legacy/index.html:414`; `frontend/scripts/homepage-bundles.json:74`, `frontend/scripts/homepage-bundles.json:79`, `frontend/scripts/homepage-bundles.json:100`. The focused search also confirms the graph-kernel harness includes persistence before connection-controller: `new-legacy/tests/v90-p420-graph-kernel.test.js:14`, `new-legacy/tests/v90-p420-graph-kernel.test.js:18`.
- Read recorded GREEN outputs: six fixed-port unit cases passed; three wrapper cases passed; graph-kernel reports success; browser ports section reports success and all nine recorded stage native-scroll samples are zero. No warnings or failures appear in these logs. Evidence: `artifacts/canvas-m2-m5/t06/unit-green.log:1`, `artifacts/canvas-m2-m5/t06/wrapper-green.log:1`, `artifacts/canvas-m2-m5/t06/kernel-green.log:1`, `artifacts/canvas-m2-m5/t06/browser-green.log:1`.
- Test execution and server/database cleanup were reported by the implementer; this review inspected the existing output evidence and did not independently rerun execution or cleanup. Development self-check is not user UAT acceptance.

## Assessment

**Task quality:** Approved.

**Reasoning:** The scoped change provides fixed boundary ports without changing legacy automatic routing or explicit manual route storage. Geometry, persistence, real browser interactions and restoration behavior have concrete test evidence, and the introduced module dependency is correctly ordered in both homepage registrations.
