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

- [ ] Write failing tests proving nodes beyond60 and zero-practice catalog survive, brightness strictly rises for 0/1/5/20 and saturates, parents aggregate without cross-tree collisions, cycles/invalid counts terminate, inputs unchanged; run and capture expected failures.
- [ ] Implement shared overlay and universe fetch; remove dashboard slice/pagination and stale recency copy; totals and detail distinguish direct/related attempts. All nodes show dimly when no practices. Server error clears nodes and retry recovers; guests never fetch.
- [ ] Render true points under overview clusters so all-tree preview is visually useful before zoom; retain actual catalog edges and point selection. Keep labels readable and no unrelated redesign.
- [ ] Update maintained browser expectations from history pagination to whole-catalog behavior, retain physical fallback controls/account/lifecycle checks; add actual endpoint path and >60 count checks.
- [ ] Run node --test new-legacy/tests/knowledge-dashboard.test.js new-legacy/tests/knowledge-space-scene.test.js new-legacy/tests/learning-entry-chooser.test.js, dashboard/semantic/scene browsers. Record exact evidence and remaining issues. Do not sync or deploy. Commit source/tests and write report.

### Task 2: Root preview and acceptance guide

**Files:** docs/verification/2026-10-23-learning-feedback-uat-checklist.md and local ignored preview evidence.

- [ ] Review Task1 specification/quality and resolve important defects; final branch review.
- [ ] Sync using existing tool, run frontend tests/design and relevant existing backend universe tests; verify no truncated real published catalog in browser desktop/mobile.
- [ ] Start dedicated local preview against real local database without modifying remote UAT or main. Capture real full-tree screenshot; provide a working preview URL and transparent brightness/empty-state meaning.
- [ ] Finish pending human UAT382 three-group checklist with entry URLs, operations, expected results, identifiers and pass/fail boxes; distinguish new local preview.
- [ ] Save verification notes, commit appropriate source/generated/docs, keep feature branch for visual review. No main integration or UAT deployment in this preview step.
