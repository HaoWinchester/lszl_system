# Task 1 report — full catalog and practice volume

Implemented in authoritative source only. No VERSION change, generated file edit, sync, release promote, deployment or remote push.

Files:
- new-legacy/src/practice/knowledge-dashboard.js: universe endpoint, all catalog nodes, exported pure derivePracticeOverlay, defensive ancestry aggregation, count-based brightness, direct/descendant detail counts and revised explanation; removed pagination.
- new-legacy/src/practice/knowledge-space-scene.js: real stars/edges drawn beneath overview category labels; catalog parent edges retained across semantic category boundaries within the same subject/taxonomy.
- new-legacy/tests/knowledge-dashboard.test.js: full catalog, zero practice, formula ordering/saturation, ownership and refresh races, cycles/invalid counts/input immutability.
- new-legacy/tests/knowledge-space-scene.test.js: cross-category real parent edge regression.
- new-legacy/tests/knowledge-dashboard-browser.py: maintained 81-node whole-universe endpoint, accessibility, mobile scrolling, account lifecycle and physical fallback controls.
- new-legacy/tests/knowledge-space-semantic-browser.py: 81 zero-practice nodes, last-frame real star draw evidence under overview, existing semantic controls.
- new-legacy/tests/knowledge-space-entry-browser.py: real endpoint expectation updated to knowledge-universe; execution delegated to root once local preview is synced.

## Red → green

1. `node --test new-legacy/tests/knowledge-dashboard.test.js`: 6 passed / 3 expected failed because derivePracticeOverlay was absent. Implemented derivation; all three passed.
2. `python3 new-legacy/tests/knowledge-space-semantic-browser.py`: expected assertion failure `overview must draw real catalog stars beneath clusters` using real Canvas arc calls reset each frame. Moved real point drawing before cluster overlay; desktop/mobile passed.
3. `node --test new-legacy/tests/knowledge-space-scene.test.js`: expected assertion `[]` versus `[[0,1]]` for catalog parent edges spanning semantic categories. Scoped parent lookup to subject/taxonomy rather than visual group; passed. Initial test scope typo was corrected before recording the genuine assertion failure.

Final Node command:
`node --test new-legacy/tests/knowledge-dashboard.test.js new-legacy/tests/knowledge-space-scene.test.js new-legacy/tests/learning-entry-chooser.test.js`
Result: 39 passed, 0 failed. `git diff --check` passed.

Browser:
- `python3 new-legacy/tests/knowledge-dashboard-browser.py`: 13 checks passed; 81-node exact universe URL, no refetch during selection/camera, stale account protection, retry, guest no fetch, native focus restoration, 1440/390/320 layouts, wheel/vertical touch scroll, physical Canvas fallback group/refresh controls. Evidence: artifacts/star-original-restore-20261020/ui/results.json and dashboard/detail screenshots.
- `python3 new-legacy/tests/knowledge-space-semantic-browser.py`: 1440/390 semantic zoom, cluster click, full-width canvas, drawer/list, full catalog, retry, auth invalidation and reopen passed. Evidence: artifacts/learning-feedback-three-groups/task-3/space-1440.png and space-390.png. Fixture has no practices: all 81 derived brightness values equal 0.12.
- `python3 new-legacy/tests/knowledge-space-scene-browser.py`: desktop/mobile 320/1000 nodes, real Canvas, selection, camera, native scroll/touch, visibility lifecycle and Canvas failure passed. 1000-node p95 callback: 14.7ms desktop / 14.8ms mobile; 109 frames, ~1.9 seconds settlement. Evidence: artifacts/knowledge-universe-20261020/task-2.

Limitations: browser source tests use isolated, explicitly API-shaped sample fixtures; root owns real catalog/owner local preview and entry API verification. Backend untouched, so proficiency/scoring API contract unchanged. Last practice remains explicitly labeled direct practice date. No UAT business acceptance is claimed.

## Review round 1 — 2026-10-23

Addressed both P2 findings and the recommended unmapped count in `knowledge-dashboard.js`; maintained browser fixture/assertions in `knowledge-dashboard-browser.py`.

- Header now includes all catalog nodes, lit nodes (`relatedAttemptCount > 0`, including ancestors) and total saved attempts. Explicit unmapped historical attempts explain historical activity that illuminates no current node.
- Empty universe always says `当前暂无已发布的知识目录。`, independent of historical attempt/reference counts. Removed the now-unused lastData state.
- Browser coverage uses the exact observed response shape: 317 nodes, 51 attempts, 23 unknown references, 28 unmapped references, zero current practiced nodes; verifies zero lit and both explanations. An additional parent/child fixture verifies one directly practiced child lights two nodes, while a third stays dark. Empty catalog with 51 historical attempts verifies published-directory empty state.

Red → green: first `python3 new-legacy/tests/knowledge-dashboard-browser.py` failed at empty history state, showing the old missing-reference explanation instead of the expected empty-directory message. After fixing only that state, reran and observed the expected missing `已点亮 0 个` header assertion failure for the 317/51 response. Added header counts/explanation; reran green.

Final focused verification:
- `node --test new-legacy/tests/knowledge-dashboard.test.js`: 8 passed, 0 failed.
- `python3 new-legacy/tests/knowledge-dashboard-browser.py`: 14 checks passed, including exact real-response scenario, ancestry counting, empty history and all retained privacy/mobile/fallback checks. Results: `artifacts/star-original-restore-20261020/ui/results.json`.
- `python3 new-legacy/tests/knowledge-space-semantic-browser.py`: 1440/390 passed.
- `git diff --check`: passed.

No sync, generated edit, VERSION change or deployment performed in this review fix. Root independently owns local preview sync and real endpoint verification.

### Catalog category-root grouping follow-up

Root's actual 317-node preview showed 人/过程/环境 grouped as 未分类 with the subject root. Updated the existing shared `categoryPath` only for catalog nodes (own `parentId` property): when no non-subject parent label remains, retain the node's own non-subject path label. Thus category roots and descendants share a semantic key. A catalog subject-only root is explicitly labeled 科目总览. Legacy noncatalog grouping remains unchanged.

Added a real-shape root + 人 + child + 过程 regression in `knowledge-space-scene.test.js`: observed expected red (`["PMP","1",""]` did not equal child's `["PMP","1","人"]`), then green. Existing cross-category edge fixture was adjusted to remain cross-category after the corrected root grouping. Added desktop/mobile semantic browser assertions for `PMP · 科目总览 / 1`, `PMP · 人 / 2`, `PMP · 过程 / 1`, with no 未分类 label.

Verification: combined dashboard/scene/learning-entry Node command: 40 passed; semantic browser 1440/390 passed; git diff --check passed. No sync or generated changes by this agent.

## User visual steering — larger network and foreground overlays

The user rejected the small network and requested text over the star scene. Changes remain in the existing shared modules/CSS:
- Initial/reset fit uses 8% padding and responsive horizontal/vertical projection spread to fill the available aspect ratio without discarding or clipping catalog nodes. Point drawing, edges, category projections and hit testing share the same projection. Explicit rotate/zoom/selection still opts out of fit; resize and later force settlement preserve the manual camera.
- The existing network host is moved to the first child of the scrolling shell, then placed in the background layer across that shell. Header/summary, details, category buttons, camera/help/meaning stay in the foreground with existing dark backing. Noninteractive text lets gestures reach canvas, controls receive their own pointer events. Close stays outside the scrolling shell. Canvas fallback retains normal-flow details.
- Public 317-node catalog metadata is frozen as a named fixture at `new-legacy/tests/fixtures/knowledge-space-published-catalog.json`; it contains no user practice data.

Red evidence:
- Real-catalog scene browser failed at desktop actual network width **28.2%** (height72.1%), below70% required width.
- New semantic geometry assertion failed because scene started below the header rather than spanning behind it.
- A targeted actual317 portrait check failed at47.0% height before vertical aspect spread, motivating filling portrait background height too.

Green evidence:
- `node --test new-legacy/tests/knowledge-dashboard.test.js new-legacy/tests/knowledge-space-scene.test.js new-legacy/tests/learning-entry-chooser.test.js`:40 passed.
- `python3 new-legacy/tests/knowledge-space-scene-browser.py`: passed all existing320/1000 performance, fit, reset, early/manual camera, selection, gesture, scroll and lifecycle checks plus real317 bounds at initial/reset. Real317 desktop footprint **89.2% width ×79.7% height**, mobile **80.0% width ×85.2% height**, every point inside16px padding. The standalone canvas test uses1408×560 desktop and358×560 mobile; root owns actual full-shell1440×960 sample inspection.1000-node p95 callbacks14.7ms desktop/14.4ms mobile.
- `python3 new-legacy/tests/knowledge-dashboard-browser.py`:14 checks passed after layered layout, including native wheel/touch when shell overflows, unchanged camera during scroll, visible close, no horizontal overflow, foreground controls and desktop/mobile Canvas fallback. Scroll assertions now allow no scrolling when desktop content fits entirely, while overflow still requires movement.
- Semantic browser assertions passed at1440,559×854 and390: scene behind title/summary, physical refresh receives clicks, noninteractive title hit resolves to canvas, cluster selection, detail/list, retry/account/lifecycle and readable grouping. One rerun completed all three viewports but hung in Chromium `browser.close()` teardown and was interrupted; no assertion failed. A clean rerun was started to verify teardown independently.
- `git diff --check` passed.

Evidence images: `artifacts/knowledge-universe-20261020/task-2/real317-{1440,390}-{initial,reset}.png`; layered foreground `artifacts/learning-feedback-three-groups/task-3/space-{1440,559,390}.png`. No source VERSION change, sync, generated edit, deployment or UAT acceptance by this agent.

Clean semantic rerun `PYTHONUNBUFFERED=1 python3 new-legacy/tests/knowledge-space-semantic-browser.py` completed1440/559/390 and Chromium teardown successfully with exit0; the earlier teardown hang is transient, not an outstanding failure.

### Floating-close follow-up

User explicitly rejected the reserved top close row. Existing close button now floats at dialog top-right with no full-width background/border/reserved height; the shell and network start at dialog top. Header reserves82px on desktop/76px on mobile for the44px-or-larger close target. Root owns removing the sample-only toolbar; production contains no new demo toolbar.

New semantic test first failed `scene should reach dialog top without a reserved close band`, then passed after CSS change.1440/559×854/390 verify canvas reaches dialog top, refresh/close do not overlap, both physically receive pointer hits, and close target remains at least44px. Existing physical close, native focus/Escape restoration, scroll reachability and fallback checks retained.

`python3 new-legacy/tests/knowledge-dashboard-browser.py`:14 passed after floating close, including390/320 physical close after list/detail scrolling, no overflow and Canvas fallback controls. Semantic assertions passed all1440/559/390 viewports. `git diff --check` passed. This follow-up changes only existing CSS and maintained browser assertions; no sync/deploy by this agent.

## Final P2 — scrolling foreground summary

Restored pointer events only for the existing horizontal-scroll `[data-knowledge-summary]` paragraph; single-line compact layout and noninteractive title gesture passthrough remain. No other production changes.

Added real-response317 nodes/51 attempts/23 unknown/28 unmapped semantic browser cases at559 and390: prove paragraph overflows, physically dispatch horizontal wheel over its bounding box, require positive scrollLeft, and require unchanged scene camera. Existing title hit-test still resolves to Canvas, with all floating-close/refresh/fallback/lifecycle coverage retained.

Red: semantic browser passed1440 then failed559 at `physical horizontal wheel must reveal trailing summary counts` (scrollLeft remained0). Green: scoped pointer-events fix;559 and390 physical summary wheel assertions passed while title passthrough and camera invariance passed. `python3 new-legacy/tests/knowledge-dashboard-browser.py`:14 checks passed. `git diff --check`:passed. No sync/deployment by this agent.
