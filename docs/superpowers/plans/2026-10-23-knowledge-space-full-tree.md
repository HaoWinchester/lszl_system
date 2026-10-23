# Full Knowledge Tree Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Preview every published knowledge-tree node with brightness from the signed-in user's related valid answer count; also provide the pending three-group UAT checklist.

**Architecture:** Reuse existing knowledge-universe API and common dashboard/scene. Derive a nonmutating count overlay in the shared dashboard. Keep old backend proficiency API semantics, graph and learning behavior unchanged.

**Tech Stack:** Native JS/CSS, FastAPI/PostgreSQL, Node tests and real Chrome.

## Global Constraints

- Only current workspace writes; new-legacy authoritative source, generated files only via sync. No unrelated dependency installation.
- Feature branch codex/knowledge-space-full-tree from b71914ad. No main/UAT push or remote deployment for this local visual preview.
- All active published catalog nodes from every active subject; no 60-node slice or business pagination. Owner isolation and late-response guards remain.
- Count brightness is 0.12 + 0.88 * min(log(1+n)/log(21), 1); 0 dark, 20+ max. Brightness means practice volume, not mastery. No API scoring change.
- Count relatedAttemptCount includes each node's direct attemptCount plus descendants through parentId once per ancestor path. Guard missing/cyclic parents, nonfinite/negative counts; retain input and direct counts. Parent last-related date can be derived independently.
- Overview must draw all real stars beneath semantic category clusters; zoom detail selection, full canvas, mobile scrolling, refresh, ownership and Canvas fallback remain.
- No fake business data. Clearly label any isolated example as sample. Local preview of real catalog and user overlay is required.

### Task 1: Full catalog dashboard and count brightness

**Files:** Modify new-legacy/src/practice/knowledge-dashboard.js, knowledge-space-scene.js and styles/knowledge-dashboard.css as necessary; update tests/knowledge-dashboard.test.js, knowledge-dashboard-browser.py, knowledge-space-semantic-browser.py, knowledge-space-entry-browser.py and any exact existing expectations that depend on old API/page contract. Existing backend service/API/tests are reference only unless a proven blocker needs root coordination.

**Interfaces:** GET /api/v1/learning/practice/knowledge-universe returns nodes{id,parentId,subject,taxonomyId,primaryNodeId,path,title,attemptCount,lastPracticedAt,brightness,...}, subjects,topicCount,attemptCount,unknownAttemptCount,unmappedAttemptCount. Keep raw attemptCount and create relatedAttemptCount and derived brightness in copied scene nodes. Export the pure derivation for meaningful Node tests.

- [x] Write failing tests proving nodes beyond60 and zero-practice catalog survive, brightness strictly rises for 0/1/5/20 and saturates, parents aggregate without cross-tree collisions, cycles/invalid counts terminate, inputs unchanged; run and capture expected failures.
- [x] Implement shared overlay and universe fetch; remove dashboard slice/pagination and stale recency copy; totals and detail distinguish direct/related attempts. All nodes show dimly when no practices. Server error clears nodes and retry recovers; guests never fetch.
- [x] Render true points under overview clusters so all-tree preview is visually useful before zoom; retain actual catalog edges and point selection. Keep labels readable and no unrelated redesign.
- [x] Update maintained browser expectations from history pagination to whole-catalog behavior, retain physical fallback controls/account/lifecycle checks; add actual endpoint path and >60 count checks.
- [x] Run node --test new-legacy/tests/knowledge-dashboard.test.js new-legacy/tests/knowledge-space-scene.test.js new-legacy/tests/learning-entry-chooser.test.js, dashboard/semantic/scene browsers. Record exact evidence and remaining issues. Do not sync or deploy. Commit source/tests and write report.

### Task 2: Root preview and acceptance guide

**Files:** docs/verification/2026-10-23-learning-feedback-uat-checklist.md and local ignored preview evidence.

- [x] Review Task1 specification/quality and resolve important defects; final branch review.
- [x] Sync using existing tool, run frontend tests/design and relevant existing backend universe tests; verify no truncated real published catalog in browser desktop/mobile.
- [x] Start dedicated local preview against real local database without modifying remote UAT or main. Capture real full-tree screenshot; provide a working preview URL and transparent brightness/empty-state meaning.
- [x] Finish pending human UAT382 three-group checklist with entry URLs, operations, expected results, identifiers and pass/fail boxes; distinguish new local preview.
- [x] Save verification notes, commit appropriate source/generated/docs, keep feature branch for visual review. No main integration or UAT deployment in this preview step.

## User visual feedback: enlarge the star network itself

The user rejected the running sample on 2026-10-23: “星空图的大小太小了”. Increase the initial and reset visible star/edge network footprint inside the existing large canvas. For the actual published317-node catalog at1440x960, target at least70% canvas width and75%height with point centers inside a safe margin. For390px retain at least75% width without clipping/overflow. Use responsive spacing/projection/fit as evidence warrants; do not merely enlarge shell or blindly zoom/crop. Explicit camera gestures still persist until reset. Add a real rendered-bounds regression for actual catalog shape (public snapshot may live as named testfixture), preserve320/1000 performance and all lifecycle interactions.

## User visual feedback: lower canvas layer under text

The user additionally requests “星空图的层级可以稍微放下一层，一些其他文字可以叠放在上面”. Put the scene as a lower visual plane across the main shell; header/title/summary and existing details/groups/camera/help may overlay above rather than consume a separate large header band. Preserve existing controls, readable text, accessible close, actual foreground clicks, blank-canvas gestures, mobile native vertical scroll and Canvas-failure normal-flow fallback. Keep source changes scoped shared dashboard/scene/CSS; no unrelated restyle. Verify desktop/mobile rendered geometry and real clicks, not only z-index values.

## User visual feedback: remove top demo and close bands

The user highlighted the full close row plus root-added brightness demo toolbar as unwanted. Remove the reserved full-width close band; float the existing accessible44px close button at top-right above foreground. Header/title/summary/refresh must not overlap it at1440/559/390, and close/Escape/focus/fallback remain usable. Root removes standalone demo toolbar entirely and labels sample brightness in small bottom text; no sample practice data is persisted or presented as real owner history.

## Completion

Local preview is running on5527 (real owner API) and5530 (clearly labeled brightness example, public published317-node snapshot). User visual corrections for larger actual network, background scene, and removal of demo/close bands implemented and directly refreshed in current IAB. Whole-branch source review and scoped P2 summary-scroll fix pass; source40b11e00. See docs/verification/2026-10-23-knowledge-space-full-tree-preview.md. UAT/main unchanged; visual review remains with user.

### Task 3: Spacious topic popup, anchored controls and semantic text toggle

**Files:** new-legacy/src/practice/knowledge-dashboard.js, knowledge-space-scene.js, styles/knowledge-dashboard.css and their existing Node/browser tests. Reference current repository dialog patterns; no duplicated business module.

**Interfaces:** Existing universe and derivePracticeOverlay unchanged. Extend scene with setLabelsVisible(bool), snapshot label-state evidence and exported pure layout/aggregation helper as needed. Keep shared scene picking/geometry, owner loader and parent/child modal lifecycle coherent.

- [x] Add failing behavior tests before implementation: large child popup and focus/lifecycle, upper-right stats/lower-right dock, complete label coverage/aggregation/far hide and toggle.
- [x] Implement popup by moving existing detail/list content into one accessible native dialog, not copying it. Preserve selected node, full real list, category context, next/previous, all owner invalidation paths and Canvas fallback.
- [x] Anchor overview near top right and camera/help near visible bottom right, avoid header close/category collision at1440/559/390, retain full-sized background.
- [x] Implement 显示文字 with immediate visible detailed-label result, deterministic screen-space aggregation with complete represented membership, semantic category text on zoom-out and no text below0.75fit; toggle off keeps baseline category/selection context. No silent label slice or business-data mutation.
- [x] Run Node/dashboard/semantic/scene/entry relevant browser tests, including1000nodes and physical child-popup/Escape/scroll/focus/foreground controls. Commit source/tests and append task report. Do not sync, change VERSION, or deploy.
- [x] Root runs scoped review, syncs preview, refreshes current IAB and verifies screenshot, runs relevant contracts, updates verification/checklist; stop at local visual preview.

### Task 4: User-approved constellation composition and bottom dock

**Files:** Existing shared knowledge-dashboard.js, knowledge-space-scene.js, knowledge-dashboard.css and their maintained Node/browser tests; source-only implementer, root sync/artifacts/docs.

- [x] Read exact approved latest spec section. Add meaningful failing checks for whole-catalog separated groups, compact star rendering/semantic labels, unified visible bottom dock at desktop/mobile; preserve lifecycle/negative checks.
- [x] Extend existing scene model/projection/drawing to keep categories spatially distinct, small dim stars and restrained brightness emphasis, quieter real edges and selected-path emphasis. All nodes/edges identities preserved; initial fit/reset and1000-node cost remain bounded.
- [x] Refine labels toward their members with semantic grouping, deterministic exact coverage and readable positioning; retain toggle/off/far-hide, picking and rotation.
- [x] Reorganize existing DOM into unified responsive bottom dock. Keep original IDs/data attributes and detail native dialog; compact one total summary, real accessible expandable help, no mid-height horizontal cut. Clean conflicting rules in touched CSS rather than append another contradictory patch.
- [x] Verify existing Node/dashboard/semantic/scene browsers, real317 source screenshots at1440/1280/559/390/shortphone. Inspect and refine visual composition before reporting. Commit source/tests; report TDD commands/results/screenshots/concerns. No sync/VERSION/push/deploy.
- [x] Root independent visual+source review, sync preview, inspect same real317 sample desktop/mobile, run relevant contracts, update current IAB and docs. Leave local preview for user.

### Task 5: Larger constellation interiors and modest star lift

- [x] Capture current actual317 projected cluster sizes/brightness as baseline; add focused failing rendered comparison for larger group interiors with retained gaps/allnodes/fit.
- [x] Locally expand within-group coordinates ~1.25, use one coordinate path for fit/draw/pick/anchors. Raise star alpha modestly with existing brightness monotonic; leave edges/dock/modal untouched.
- [x] Run sceneNode+scene browser including317/1000, semantic browser because projection/labels touched; inspect desktop andphone samples. Commit only scene/tests, report full commands/results and actual beforeafter sizes. No sync/VERSION/push/deploy.
- [x] Root scoped review/sync/actual317fiveviewport capture/contracts/currentIAB, update verification then leave localpreview for user.

### Task 6: Three-category layout and gentle self rotation

- [x] Add failing shared structural-root filter/layout and explicit automatic-motion lifecycle checks before production edits.
- [x] Add shared structural-root predicate; dashboard derives full counts then excludes only structural overview. Render316PMP nodes/threecategories, semantic Process central with People/Environment lower and closer; preserve generic layouts.
- [x] Extend scene opt-in selfrotation with shared coordinates, existingRAF/timebased pace, safe fit, pause/resume/hidden/reduce/destroy guards. Default dashboard enabled; staticscene default unchanged.
- [x] Add accessible pause/start control in secondary dock row, modal/interaction pause coordination and true status synchronization. Keep prior UI/lifecycle.
- [x] Update only invalidated published fixture expectations and old layout-size comparison; verify Node/scene/semantic/dashboard browsers + dedicated normal-motion auto test. Capture actual source316 desktop/phone and inspect motion. Commit source/tests; report. No sync/version/deploy/push.
- [x] Root review/sync/samplecaption316/fiveviewport actual checks + contracts + currentIAB observedrotation; update docs andleave preview.
