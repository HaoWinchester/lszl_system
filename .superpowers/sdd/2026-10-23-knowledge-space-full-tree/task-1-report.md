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
