# T10 — four mindmap layouts and six system themes

Status: DONE. Scope only T10; no descendants, branch changes, pushes, merge, promotion or deployment.

## Implementation

- Added common `KGGraphMindmapLayout.compute(graph,{rootIds,direction,scopeIds})` returning positions, original treeEdges, all remaining crossEdges, resolved rootIds and direction. Directions are right/left/bilateral/down. Dimension-aware tree/subtree spacing uses 80 layer and 32 sibling world units. Stable node/link order, directed descendants before reverse fallback, each node exactly once, balanced first-level subtree weights, and separated disconnected regions. Ambiguous ordinary graphs require an explicit root; unique directed roots and singleton components are inferred. Default scope is all nodes; explicit scope restricts geometry to its nodes. Repeated layout keeps the first root and all resulting coordinates stable.
- `KGGraphMindmapLayout.apply(graph,options)` mutates real model geometry only and metadata; endpoint callback snapshots rendered routes before all geometry edits, then calls existing T05 moveRoute once per manual relation. Port bindings, manual controls, waypoints, content and relation identity remain intact. Editor and temporary controller both inject the existing outline/port geometry with explicit local node map/ignoreGather.
- Added `KGGraphMindmapThemes.presets/apply/controls`: six named free presets, visible theme previews and independent apply buttons, root/direction selectors, whole-graph default vs explicit selected scope, explicit override checkbox initially off. Node theme baseline and individual manual field provenance distinguish normalized defaults from actual overrides; model edits after theme application record fields, and repeated themes retain original manual differences. Links preserve manual color/line style/width across repeated presets. Override clears protection for preset-owned fields. Theme operation leaves geometry, resources, content and ports/routes unchanged. Capsule presentation reuses rounded nodes with CSS radius, retaining real dimensions.
- Added homepage toolbar entry in efficient/professional modes; source index and homepage bundle registry contain both scripts. Formal operations use existing history/render/save. mindmap metadata enters undo snapshots and sanitized persisted state; link theme provenance survives sanitizer. Existing style controller remains the public user-edit source; no duplicate appearance controller introduced.
- D02 temporary controller uses exactly the shared controls/modules with session graph/history and existing renderer memory-only persistence, never formal state/history/save callbacks. Controls wrap and reserve right navigation space; all six preset bounds checked at 1440px and 900px viewport widths.

## Tests and evidence

Evidence directory: `artifacts/canvas-m2-m5/t10/`.

- RED: `node --test new-legacy/tests/graph-mindmap-layout.test.js` failed because `mindmap-layout.js` was missing; `unit-red.log` records MODULE_NOT_FOUND.
- GREEN: initial layout/theme tests plus homepage registration: 5/5 in `unit-green.log`. Later focused meaningful tests cover all directions, mirror dimensions, root requirement, cross-edge counts, stable repeated layout, selection scope, manual route endpoint snapshots, unchanged ports, disjoint down components, repeated node/edge manual protection and explicit override. Self-review added directed-hierarchy priority over incoming cycle shortcut regression.
- Final `node --test new-legacy/tests/graph-mindmap-layout.test.js frontend/scripts/graph-edge-midpoints.test.mjs`: **13/13 pass**, `wrapper-green.log`. Seven T10 cases plus six normal wrapper cases; wrapper integrates these tests into normal frontend CI. Existing geometry/fixed-port/fragment/temporary cases remain included. Homepage registration test had already passed and scripts were unchanged afterward.
- `python3 new-legacy/tests/graph-mindmap-browser.py --base-url http://127.0.0.1:62779`: **PASS**, `browser-green.log`. Actual Chrome buttons switch all four directions and six presets; checks default whole scope despite single node selection, explicit selection excludes others, content and five relationships retained, manual node fill/font protected, override works, real pill class visible, undo/redo exact graph snapshot, save/reopen structural equality including mindmap and theme provenance, notes/images/question links survive, fixed ports/manual controls retained, and temporary layout/theme/undo leaves formal serialized graph and history unchanged. No page errors. All six preview buttons remain within navigation-safe bounds at desktop 1440 and narrower 900 widths. Screenshots `mindmap-1440.png` / `mindmap-900.png`.
- First browser attempt used JSON string comparison across reload and failed only on object property order; `saved.json`/`reopened.json` were structurally identical. Changed test to object equality; second and final browser passes confirm no persistence mismatch. Do not treat this harness issue as a product defect.
- `pnpm --dir frontend sync:new-legacy`: passes (`sync.log`); used solely to serve current source to disposable helper, generated public/manifest/sync outputs deliberately unstaged.
- `node --check` for editor/layout/theme, `python3 -m py_compile` browser and `git diff --check`: exit 0.

## Cleanup and limits

Owned disposable server: helper port 62779/PID 4145, unique disposable database. Verified process identity, SIGTERM, tracked session exited 0 and cleanup completed; no production/UAT database touched. Full pnpm test, release candidate/promote, UAT deployment and human business acceptance belong to T20/controller. Themes protect preset-owned known fields and preserve unrelated node properties; no new theme marketplace or general obstacle router. Formal panel is a compact command panel, not a new editor architecture. The existing large editor receives wiring and metadata only.

Scoped files: index.html; 00-config-state.js; 10-graph-editor.js; 19-home-toolbar-registry.js; graph-model.js; related-canvas-controller.js; new mindmap-layout.js/mindmap-themes.js; home-graph-components.css; new graph-mindmap-layout.test.js/graph-mindmap-browser.py; frontend homepage-bundles.json/graph-edge-midpoints.test.mjs. Existing style-controller.js needed no new implementation because shared theme application uses the current model and existing injected history/render flows.

Commit: `c0657799` — `feat(graph): add mindmap layouts and preset themes`. Post-commit index empty and all scoped source/test/config paths clean. Process lookup found no owned port-62779 helper. Generated sync/public outputs remain unstaged for controller integration.

## Review fix round 1 — overlay disposal and explicit hierarchy contract

Base `c0657799`. Read `task-10-review.md`; addressed its Important lifecycle issue and confirmed hierarchy preference gap. Deferred formatting-only Minor stays final triage.

- Formal panel owns one stored `formalMindmapCleanup`; replacement and close both run mountOverlay disposer before removing host. Repeated opens no longer retain markers/fullscreen listeners or resurrect an old host.
- Import contract for T12: `link.hierarchy === true` is a declared directed **from parent → to child** hierarchy edge. Missing, false and invalid/truthy string values normalize to **false** (ordinary relation). `KGGraphModel.normalizeGraph`, sanitizer and persistence hydration/storage preserve/normalize the boolean; existing fragment capture/remap preserves it, covered by a real copied fragment test. No new importer in T10.
- Inferred roots prefer roots of declared hierarchy edges; ordinary back-relations no longer obscure the hierarchy root. Tree builder exhausts declared outgoing hierarchy before ordinary edges and reserves children with an unvisited declared parent, avoiding earlier ordinary shortcuts even with an explicit ordinary root. Ordinary relations, cycle conflicts and extra parents remain original crossEdges; no relation deletion or duplication. Explicit roots still take precedence. Hierarchy cycles with no unique inferred root retain the explicit-root requirement.

RED:
- `node --test new-legacy/tests/graph-mindmap-layout.test.js` with hierarchy regression before implementation failed with `Error: 请为普通关系图指定根节点`, recorded in `review-unit-red.log`; ordinary back-edge incorrectly prevented root inference.
- `python3 new-legacy/tests/graph-mindmap-browser.py --base-url http://127.0.0.1:62779` against pre-fix synchronized source reproduced native fullscreen resurrecting duplicate panels: close-button locator resolved to **2 elements**, `review-browser-red.log`. Initial probe helper button needed fixed positioning to be clickable; subsequent run reproduced the product defect.

GREEN:
- Final `node --test new-legacy/tests/graph-mindmap-layout.test.js frontend/scripts/graph-edge-midpoints.test.mjs`: **16/16 pass**, `review-wrapper-green.log`. Covers conflicting ordinary-before-hierarchy parent choice, inferred hierarchy root despite ordinary back-edge, explicit ordinary root with reserved hierarchy child, all cross links, strict boolean normalization, hydrate/storage and fragment-copy preservation; existing layout/theme/route/ports/session wrapper regressions remain passing.
- Final `python3 new-legacy/tests/graph-mindmap-browser.py --base-url http://127.0.0.1:62779`: **PASS**, `review-browser-green.log`. Actual two opens, native `#stage.requestFullscreen()` via a clicked button, one live panel, close and native exitFullscreen, zero resurrected panels and baseline overlay comment count. Saved/reopened graph retains exactly declared hierarchy IDs ab/bd. All original AC07, D02, selected scope and 1440/900 controls assertions pass; no page errors.
- Sync successful (`review-sync.log`), editor/layout syntax, browser py_compile and git diff/staged whitespace checks exit 0. No full suite.

Owned disposable helper port62779/PID6695 verified then SIGTERM; tracked session exit0 confirms cleanup. Only seven scoped source/test files committed; public/sync artifacts deliberately unstaged. No descendants/push/deploy/merge/branch changes.

Review fix commit: `a4104ed7` — `fix(graph): dispose mindmap panels and prefer hierarchy edges`. Post-commit scoped paths clean/index empty; process lookup confirms no port62779 helper remains.


## Independent review

### Spec Compliance

- ✅ Both scoped fixes satisfy the requested contracts. Formal panel replacement and close share one stored disposer (`new-legacy/src/10-graph-editor.js:4038-4046`); it clears ownership before disposing the overlay and removing its host, preventing removed panels from retaining fullscreen callbacks.
- ✅ Declared `hierarchy === true` parent→child edges drive root inference and are exhausted before ordinary shortcuts; children with an unvisited declared parent are reserved until ordinary traversal cannot make progress (`new-legacy/src/graph/mindmap-layout.js:11-35`). Extra/cyclic/multiple-parent relations remain cross edges through the unchanged original-object tree partition (`mindmap-layout.js:48`).
- ✅ Strict hierarchy booleans survive model normalization (`new-legacy/src/graph/graph-model.js:266`), link hydration/storage normalization (`new-legacy/src/graph/graph-persistence.js:8`), and sanitized reload (`new-legacy/src/00-config-state.js:227`). This resolves the previous hierarchy-priority verification gap under the controller-confirmed import contract.
- ⚠️ The future T12 importer must emit this declared parent→child boolean contract; importer implementation remains outside T10 and this fix diff.

### Strengths

- `new-legacy/tests/graph-mindmap-browser.py:21-29` exercises two real panel opens, native fullscreen entry/exit, one live panel and restoration of baseline marker count. It reproduces the original lifecycle failure rather than merely asserting a cleanup function call.
- `new-legacy/tests/graph-mindmap-layout.test.js:30-43` covers an ordinary shortcut preceding hierarchy, an ordinary back-edge obscuring the root, explicit ordinary roots, strict booleans, storage/hydration and copied fragments. The new traversal retains stable existing order and does not mutate relation identity.

### Issues

#### Critical (Must Fix)

- None.

#### Important (Should Fix)

- None found in the scoped fixes.

#### Minor (Nice to Have)

- Prior formatting finding remains: dense layout/placement and theme/provenance statements in `new-legacy/src/graph/mindmap-layout.js:9,14,40-45` and `new-legacy/src/graph/mindmap-themes.js:15-23` should be expanded into readable blocks. This is nonblocking and was explicitly deferred.

### Checks

- Read `review-c0657799..a4104ed7.diff` once and the appended fix report. No outside-diff source inspection, source/index mutations, suite reruns, descendants, pushes or deployments.
- Reported verification: focused unit/wrapper 16/16 and browser PASS, including overlay regression plus hierarchy save/reopen. No new code-reading doubt warranted another test run.

### Assessment

**Task quality:** Approved.

**Reasoning:** The stored overlay cleanup resolves the demonstrated resurrection leak, and explicit hierarchy priority now uses a normalized persisted contract with focused regression coverage. No blocking regression was found in the fix diff; formatting remains a minor follow-up.
