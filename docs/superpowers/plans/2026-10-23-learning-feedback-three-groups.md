# Learning feedback: three groups implementation plan

> Execute in this session using subagent-driven-development for scoped implementation and review. User approved the requirements on 2026-10-23 and explicitly authorized development, self-tests and UAT deployment. Do not request the same approval again.

**Goal:** Deliver the three approved groups to UAT for user acceptance; do not merge or push main.

**Architecture:** Extend existing shared graph geometry/controllers, practice/learning modules, and the knowledge-space scene. Keep graph relationships as independent persisted objects while sharing rendered trunks. Use the existing release and UAT deployment pipeline.

**Tech Stack:** Native JavaScript/HTML/CSS, Node test runner, Python browser tests, FastAPI/PostgreSQL.

## Global Constraints

- Modify authoritative frontend source in new-legacy/ and adapters in frontend/scripts/new-legacy-assets/; generated files only through synchronization/release tools.
- Only write inside the current workspace; no unrelated dependencies. Current clean checkout has a dedicated feature branch codex/learning-feedback-three-groups.
- main and uat are permanent. Preserve both; user acceptance is required before main integration. Stop after UAT deployment.
- Every shared capability extends a common module. Preserve existing card/edge persistence and owner isolation.
- Add regression tests that fail on the reported behavior before implementing fixes. Exercise actual browser gestures, save/refresh, repeated actions and cancellation where relevant.
- Record exact verification evidence and gaps. Test success is developer self-check, not UAT acceptance.

### Task 1: Orthogonal routes, explicit ports, trunks and toolbar anchoring

**Files:** Inspect and locally extend new-legacy/src/graph/{edge-geometry,edge-bundle,connection-controller}.js, new-legacy/src/10-graph-editor.js, new-legacy/src/canvas/{toolbar,92-canvas-edge-toolbar-controller}.js, relevant toolbar styles and existing graph tests. Find actual callers before editing.

**Interfaces:** Keep existing persisted from/to ids, fromPort/toPort and waypoints compatible. Render-only bundling must not destroy relations or relocate explicit ports.

- [x] Add failing geometry/controller regressions for batch elbow conversion, arbitrary old waypoints, explicit endpoints, drag/rebind and redundant collinear corners.
- [x] Implement strictly horizontal/vertical elbow routes. Image two is the desired pattern: leave a bottom port vertically, traverse horizontally, approach a top port vertically. Do not override user-selected source/target ports by nearest-edge-center routing.
- [x] Support same-route collinear simplification and overlapping shared trunks across independent relations, including manually dragged routes. Preserve all edge ids, arrows, direction and bindings. Move cards and save/refresh without losing relations. Keep intentional backtracks when necessary for explicit port direction.
- [x] Anchor edge settings near the triggering control and every toolbar submenu below its own button, with viewport clamping. Cover graph and shared learning canvases.
- [x] Run existing graph geometry, bundle, fixed-port, feedback and toolbar tests plus actual browser regression; document failures and results.

### Task 2: New case learning, practice controls, UAT sample and external references

**Files:** Inspect new-legacy/src/59a-paper-learning-modes.js, 59c-active-learning-mode-policy.js, 100-practice-mode.js, practice/ shared modules, multi-question/deep-recall adapters, styles, backend learning eligibility services and existing tests. Place the UAT seeding CLI under backend/app/cli/ if no existing reusable seed tool exists.

**Interfaces:** Existing database question payloads, case material/group metadata, matching/multiple/single question types and learning APIs; no automatic external question import.

- [x] Reproduce and add failing tests for existing case questions entering multi-question induction and deep recall; preserve case material and answer contracts through both paths. Do not fake unavailable author-created recall materials.
- [x] Reproduce report review -> next wrong question -> danmaku toggle; one click must reflect the new enabled state and playback. Extend the shared comment controller/mount behavior rather than copying implementations.
- [x] Move report actions to the top of the wrong-answer list and keep them sticky during scrolling without covering questions. Verify at desktop/mobile sizes.
- [x] Search authoritative external PMP new-type/sample pages, verify links and write a short Chinese source list for user review. Do not import any external questions until user selection.
- [x] Seed exactly one clearly identified UAT test question to a total of 200 tagged test comments, idempotently. Do not change production or other questions. Record question/paper identifiers for acceptance. Prefer a dedicated test paper/question over real user questions; preserve existing real comments.
- [x] Run focused unit/API/browser tests and record results.

### Task 3: Knowledge-space aggregation and four learning entries

**Files:** Inspect new-legacy/src/practice/{knowledge-space-scene,knowledge-dashboard}.js, new-legacy/styles/knowledge-dashboard.css, actual learning-entry module/markup and existing knowledge-space tests.

**Interfaces:** Preserve real knowledge-dashboard API data, pagination, accessible list, selection, refresh/retry and scene cleanup. One entry opens the existing knowledge-space dialog.

- [x] Add failing scene tests for semantic zoom: zoomed-out class clusters; zoomed-in individual points; stable grouping by subject/category; cluster click/zoom usability.
- [x] Implement cluster display using existing model; retain per-point selection at detailed scale. Label clusters meaningfully using available classification names/paths, not opaque ids.
- [x] Expand the entire scene canvas to the large main content area in the user screenshot. Keep details accessible without a permanently wide left column. Convert overview statistics to a compact top-right line and retain refresh functionality. Keep responsive controls within the viewport.
- [x] Place exactly four entries together at the learning entry: 知识图谱、多题归纳、深度回忆、知识星空. Remove duplicate star entry where appropriate. Preserve auth and empty-state behavior.
- [x] Run scene/dashboard/entry unit tests and real browser layout, zoom, selection, keyboard/list, close/reopen/refresh regressions.

### Task 4: Integration, release and UAT

- [x] Review each task and the complete diff for spec compliance and quality; resolve significant findings before release.
- [x] Run frontend pnpm test, pnpm test:design, backend .venv/bin/python -m pytest tests/ -q, relevant browser tests and release validation.
- [x] Before release, compare current active site file inventory against source/sync and candidate. Confirm admin-console.html and all prior paths remain. Use manage-new-legacy.js update; never hand-copy site files.
- [x] Commit source/generated manifests and release metadata. Merge the tested feature branch to uat, push using command-scoped http://127.0.0.1:7897 proxy, verify remote ref.
- [x] Back up remote UAT code and database, validate nonempty archives/dump, write manifest and retain previous image. Deploy only UAT through deploy/update-uat.sh. If release generation changes tracked files, commit and push those results and verify the deployed commit baseline.
- [x] Verify public version, health, static hashes and file inventory, test the acceptance paths, seed the designated test question, and record backup path. Confirm main ref and production version remain unchanged.
- [x] Report UAT URL/version, test question location, PMP source list, tests and material limitations. Wait for user acceptance; preserve the feature branch.

## Completion evidence

Development self-checks and UAT deployment completed on 2026-10-23. See `docs/verification/2026-10-23-learning-feedback-three-groups-uat.md` for exact tests, deployment deviations, backup, data identifiers and limitations. UAT business acceptance is pending; main unchanged.
