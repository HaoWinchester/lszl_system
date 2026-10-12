# T07 — Graph fragments and cross-file clipboard

Status: DONE. Source/test implementation only, on existing `codex/canvas-m2-m5`. No branch switch, push, deployment, merge or active-release edits. Other agents' commits advanced shared HEAD during implementation; this commit stages only the ten T07 files listed below.

## Implementation

- Introduced GraphFragmentV1 with exact `format:'kg-graph-fragment'`, `version:1`, nodes, internal links, elements, tables, resource references and source `{fileId,nodeIds,revision}`. Capture deep copies nested content/appearance/geometry and ports. Unselected nodes and incident external/free-ended links are excluded.
- `KGGraphFragment.capture(graph, selection)` accepts `{nodeIds,elementIds,tableIds}`; returns a validated independent fragment. Explicit resourceId/assetId/resourceIds references select corresponding resource descriptors. It does not copy unrelated graph resource descriptors.
- `KGGraphFragment.remap(fragment,{idFactory,offset})` returns `{fragment,idMap}` with unique fresh node/link/element/table IDs, new internal edge endpoints, translated positions and explicit route controls/waypoints. Source/provenance and reference identity remain original. Fixed fromPort/toPort fields remain intact. No input objects are mutated. ID factories colliding with an original or newly generated ID are rejected.
- `parse` supports plain-text serialized JSON with the format marker. Version, collection, ID, internal edge, coordinate, route and provenance validation reject malformed payloads before graph writes. Parse never evaluates text. Editor passes remapped objects through existing sanitizer before insertion and checks target edit permission, login and card limits before history/mutation.
- Extended existing clipboard controller with `writeFragment/readFragment/exportEvent/importEvent`, retaining legacy node-list read/write callers. Clipboard events write both `application/x-kg-graph-fragment+json` and `text/plain`; imports prefer custom MIME and accept marked plain text. Invalid imports do not replace the existing memory fragment.
- Clipboard history/lifetime now belongs to the account session rather than file undo history. File switching/resetting history keeps the memory fragment. Same account auth refresh retains it; account replacement or logout clears it. Source metadata is obtained through existing file-store bridge.
- Native copy/paste events handle canvas fragments and leave text editing targets to the browser. Keyboard C/V no longer prevent the native event, enabling explicit cross-tab transfer. There is no background system-clipboard read, polling, local-storage clipboard or permission request.
- Registered graph-fragment before clipboard-controller in source homepage and homepage bundle list. Added focused tests to the existing related geometry wrapper, so `frontend` normal test discovery includes this test.

## RED / GREEN evidence

Evidence directory: `artifacts/canvas-m2-m5/t07/`.

1. `node --test new-legacy/tests/graph-fragment.test.js` initially failed all three initial behavioral tests because graph-fragment.js did not exist (`unit-red.log`, ENOENT). Requirements asserted internal edge capture, independent nested content, unique IDs across two remaps, translated explicit routes, ports, source immutability, invalid versions/duplicate IDs/external edges.
2. After initial implementation those tests passed (`unit-green.log` updated for final expanded suite).
3. Added malformed provenance/endpoint test before tightening validation: 6 pass / 1 fail; malformed source null was accepted (`invalid-red.log`). Added corresponding shared schema checks; final run: **7 pass / 0 fail** (`unit-green.log`). Additional tests cover text geometry/appearance, selected resource isolation, explicit custom MIME transfer, invalid text preserving clipboard, deep-copy reads, same-account refresh and account replacement/logout.
4. `node --test frontend/scripts/graph-edge-midpoints.test.mjs`: **4 wrapper cases pass / 0 fail** (`wrapper-green.log`), including fragment suite and unchanged cubic/directional/fixed-port coverage.
5. `node new-legacy/tests/v90-p420-graph-kernel.test.js`: `v90-p420-graph-kernel-ok` (`kernel-green.log`).
6. `node --check new-legacy/src/10-graph-editor.js`, `node --check new-legacy/src/graph/graph-fragment.js`, `git diff --check` and staged diff check: exit 0.
7. `pnpm --dir frontend sync:new-legacy`: successful (`sync.log`), generated outputs deliberately remain unstaged for controller integration.
8. `python3 new-legacy/tests/graph-cross-file-copy-browser.py --base-url http://127.0.0.1:62773`: **PASS** (`browser-green.log`). Real Chrome UI chooses two source cards and native Meta+C; opens target via file tab; two pastes create four IDs and only two internal links with original ports/relative geometry/notes/style; invalid version preserves graph; changing first target and save/reload retains modification without modifying second paste or source; separate tab accepts explicit serialized clipboard event; native textarea Meta+C/Meta+V affects text only; real logout clears memory. Source is compared to initial full saved graph. No page errors. Screenshot: `cross-file-copy.png`.

The first browser run (`browser-first.log`) used Control+C on macOS and received no native copy event. It was a harness modifier mismatch, not implementation RED evidence. Switching to macOS native Meta+C made the original browser scenarios pass. Browser runs use a fresh unique file name set each time and isolated helper database.

## Files changed

1. `new-legacy/src/graph/graph-fragment.js` (new shared format/capture/remap/parser)
2. `new-legacy/src/graph/clipboard-controller.js`
3. `new-legacy/src/10-graph-editor.js` (editor wiring)
4. `new-legacy/src/23-graph-file-editor-store-bridge.js` (source metadata)
5. `new-legacy/src/25-graph-file-tabs.js` (lifetime contract comment)
6. `new-legacy/tests/graph-fragment.test.js`
7. `new-legacy/tests/graph-cross-file-copy-browser.py`
8. `new-legacy/index.html`
9. `frontend/scripts/homepage-bundles.json`
10. `frontend/scripts/graph-edge-midpoints.test.mjs`

## Self-review / limitations

- Reviewed source against AC06 base scenarios, malformed imports, nested object identity, route translation, account isolation and source safety. Tightened provenance/route validation and geometry-aware clipboard bounds during self-review; corresponding focused suites passed.
- Existing editor is large; algorithm/schema/transport live in focused shared modules. Editor only captures selection, coordinates permission/history/insert/render, and connects native events. No unrelated restructuring.
- This is **R06 / D04 foundation only**, not complete R06 acceptance. New resource/media registration and full image fidelity remain T11; server-authoritative question binding authorization/revision checks remain T16; full table insertion/selection and merged-cell reference remapping remain T20. Current editor inserts nodes, links and supported text elements. Fragment format carries tables/resource references for later integration, not a claim of their completed UI/persistence support.
- Client-provided provenance is metadata only, never authorization; no new server question permission API was introduced. Existing sanitizer remains the import allowlist.
- `source.revision` is optional/null when current file metadata has no revision. Later T16 must supply and enforce authoritative revision rather than trusting this field.
- Browser test targets this macOS Chrome environment (native Meta+C/V). Cross-tab transfer is explicitly exercised through ClipboardEvent/DataTransfer as required; no arbitrary clipboard-read permission is used.
- Full release suite, promote, UAT deploy and user business acceptance remain controller responsibility. Generated frontend/public sync output is untouched manually and unstaged.

## Owned helper cleanup

Used `backend/.venv/bin/python new-legacy/tests/helpers/canvas_ink_server.py --port 62773`, which migrates/seeds a unique disposable PostgreSQL database. Initial helper PID 76776 and final validation PID 78140 received verified SIGTERM and their tracked sessions exited 0, disposing/dropping helper DB. Additional final strengthened browser assertion run uses same isolated helper port with fresh DB, verified cleanup below. No production/UAT database used.

## Commit

See final commit and cleanup record below.

Final scoped commit: `3b702e57` — `feat(graph): copy graph fragments across files` (ten source/test/config files). Final strengthened browser run passed with persisted target-title and independently unchanged repeated-paste-title assertions. Last helper PID 78479 was verified before SIGTERM; follow-up process lookup returned no matching process. Git index is empty and T07 source/config/test paths are clean; generated sync files remain unstaged.

## Review fix round 1 — valid dense graph link count

Review finding: one shared 2,500 limit incorrectly rejected valid graphs containing 2,501–5,000 internal links, although existing sanitizeState supports 5,000. Confirmed actual current sanitizer caps through source inspection: nodes 2,500; links 5,000; elements 1,500. No implemented sanitizer table cap exists yet (T20).

Changed graph-fragment validation to explicit collection-specific caps matching those existing contracts. Tables keep their provisional 2,500 cap pending T20. Added a dense directed graph fixture with 101 selected nodes and exactly 5,000 distinct internal links; capture and remap must retain every link and all endpoints must reference new nodes. The same test rejects a 5,001st link. Added node/text-element cap boundaries to prevent collection limits drifting silently.

RED: `node --test new-legacy/tests/graph-fragment.test.js` before correction: 7 pass / 1 fail; dense capture threw `Error: Invalid fragment collection` at graph-fragment.js:10 (`artifacts/canvas-m2-m5/t07/dense-red.log`). This reproduced the reported valid-graph copy failure.

GREEN: same command after correction: **9 pass / 0 fail**, including all-5,000-link capture/remap and collection cap boundaries (`dense-green.log`). `node --test frontend/scripts/graph-edge-midpoints.test.mjs`: **4 wrapper cases pass / 0 fail** (`dense-wrapper-green.log`), including the expanded 9-test fragment suite. `git diff --check` and staged diff check: exit 0. No browser rerun: this is a shared validation-cap correction with focused real capture/remap coverage; UI/event wiring is unchanged.

Self-review: limits now match current sanitizer values; table limit remains explicitly provisional. Only two T07 source/test files staged. No unrelated formatting changes, descendants, generated-file edits, browser servers, branch mutations, push or deployment.

Commit: `a3614fac` — `fix(graph): preserve dense fragment link collections`.


## Independent review

### Finding Verdicts

- **Collection cap rejects valid 2,501–5,000-link graphs** — ADDRESSED. new-legacy/src/graph/graph-fragment.js:5 now defines links:5000, nodes:2500 and elements:1500; line 12 uses the per-collection value. These match the unchanged sanitizer caps inspected in the prior review. new-legacy/tests/graph-fragment.test.js:35–54 captures/remaps all 5,000 internal links, verifies remapped endpoints and rejects a 5,001st link; lines 55–62 test node/text limits.

### New Breakage in the Fix Diff

- None identified. The fix only replaces the shared limit with collection-specific limits and adds behavioral boundary tests (new-legacy/src/graph/graph-fragment.js:4–12; new-legacy/tests/graph-fragment.test.js:35–62).

### Out-of-Scope Observations

- Prior Minor formatting finding remains deferred in the controller ledger; this fix does not broaden scope to reformat original code. T11/T16/T20 and release/UAT limitations from the previous review remain unchanged.

### Checks

- Read supplied fix diff once and appended fix report. Report names focused fragment run with RED 7 pass / 1 fail and GREEN 9 pass / 0 fail, plus wrapper 4 pass / 0 fail. The new tests exercise the reported failed/successful contract. No suite rerun or branch/index changes; execution outputs remain reported evidence rather than independently rerun results.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.

**Spec compliance after fix:** Approved for T07 foundation scope; later integration and UAT cannot be verified here.

**Task quality after fix:** Approved with the previously deferred Minor formatting observation.
