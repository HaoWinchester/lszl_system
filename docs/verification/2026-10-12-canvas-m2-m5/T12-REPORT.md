# T12 — XMind preview and editable transactional import

Status: DONE_WITH_CONCERNS (declared fidelity gaps remain R05 acceptance differences). Base 87c68665. Commit **4d04ff7f — feat(graph): import editable XMind documents**. Source, focused tests and provenance fixtures only. No descendants, branch switch, merge, push, release promotion or deployment.

## Product and APIs

- Shared `KGXMindImport.open(file)` is wired into BOTH real homepage learning-package file input and standalone file-library file input. Both accept `.xmind` alongside existing ZIP/JSON. Homepage source script and homepage-bundles registry updated. Existing ZIP/JSON behavior retained.
- Authenticated admin/teacher/student POST `/api/v1/graph-imports/xmind/preview`: multipart `file`; bounded parse, account quota check and public worksheet counts/samples/compatibility warnings. No GraphFile/GraphAsset creation. Viewer denied403. Every worksheet initially selected; per-sheet names are `original stem—sheet title`, each new file. Current file is preserved.
- POST `/api/v1/graph-imports/xmind/import`: multipart same `file`, JSON string arrays `sheetIds` and `acceptedWarnings`. Reparse, require valid nonempty unique sheet selection and all selected warnings explicitly accepted. Warning IDs include a prefix of archive SHA256 so confirmations from a different archive are rejected. Unknown warning IDs rejected. Server does not trust client subscription booleans, graph JSON or resource refs.
- On confirmation, lock authenticated owner row, recheck authoritative account limits, create referenced validated images with T11 `create_asset(...commit=False)`, substitute persisted image refs, and `create_file(...commit=False)` for all selected sheets; single commit, refresh objects before reading attributes. Any creation failure rolls back files AND assets; same ZIP resource shared across selected worksheets creates one owner asset. Results return sheetId/file metadata, format and exact accepted warnings. New files appear in existing library and open through existing graph tabs; no current-file overwrite.
- Preview uses human sheet/topic names grouped by topic and compatibility category; raw IDs available only inside expandable diagnostic records. Limits are practical plain language. One unchecked explicit acceptance box covers all selected differences; changing worksheet selection clears acceptance. Import is disabled before acceptance. Compatibility text and acceptance explicitly distinguish approximation from fidelity acceptance.

## Formats, samples and actual evidence

Tracked `backend/tests/fixtures/xmind/`:

1. **Native desktop-created JSON archive**, XMind24.04.10311/build2024052619230. Root created and saved it through actual native UI. Archive bytes remain unchanged: SHA256 **ed28068749ec7caa799aa00fe710fbafcfe6cf8578634434d0600e363a91f77d**,450248bytes. `PROVENANCE.md` and `expected.json` copied unchanged. Two sheets9+5topics, Chinese/English and third-level hierarchy, PNG, exact739-character notes, second root26pt/700. API tests compare every source title, exact notes and hierarchy to expected values and read PNG bytes via file-bound asset access. Browser compares all first-sheet topics/notes/hierarchy, tests both native sheets separately, second root34.67 CSS px (26pt) and bold, actual node-title edit via modal, save/reopen equality and loaded images.
2. **Synthetic XML-only fixture**, created with Python ZIP/XML structures, not an old desktop software export. Two sheets3+1topics, PNG from our native test content, two-line Chinese notes, styles.xml root20pt/bold/#112233/#ffeecc/rounded, dashed2pt links. Corrected theme image attribute to namespaced `xhtml:src`; initial `xlink:href` did not display in native reader. Root actually reopened corrected unchanged XML archive in XMind24.04 and checked PNG, notes,2sheets, hierarchy, bold yellow shape and dashed links. SHA256 **95ea36d4dcf2b62b66172f6d2049e36aec89ef458347876b99520274b2c50b05**. `XML-PROVENANCE.md` and root `XML-NATIVE-CHECK.md` record honest synthetic source plus current-desktop reader evidence. Browser imports both worksheets from real library input, verifies first root26.67px, notes, colors, rounded shape, dashed2.67px hierarchy, displayed card/detail PNG, edits notes and reopens exact saved graph. This does NOT verify any old desktop version's exported archive.
3. **Unmodified official embed test1 archive**, fixed public repo provenance/SHA recorded in OFFICIAL-PROVENANCE.md. Contains JSON正文 and XML compatibility warning. Test asserts JSON wins and actual title `test-1.xmind`, never XML warning.
4. **Unmodified official Swift example0**,2sheets + actual SVG resource. Explicitly rejected with unsupported image-format message; SVG not dropped/converted silently.
5. **Unmodified official Swift example1**,encrypted JSON plus XML compatibility notice. Rejected422 as damaged/encrypted JSON; never fallback to XML warning. Provenance does not invent a desktop version.

No claim of complete support for all XMind versions. JSON presence ALWAYS selects JSON; malformed/encrypted JSON never falls back. XML requires correct content/style namespaces and manifest, optional styles.xml; reads attached topics, sheet style theme/defaults, explicit style-id, plain notes and XHTML image src. Unsupported XML rich-only notes rejected instead of dropped. XML relationships/special elements are source records with explicit warnings, not falsely interactive conversions.

## Mapping and fidelity limits

- Titles become editable `content.title`; exact plain notes become editable `content.notes`, image references become durable `content.images`. Parent-child edges point parent→child with strict `hierarchy:true`; JSON ordinary relationships keep endpoints/text and `hierarchy:false`. Detached/summary/callout topics are individually editable and flagged as independent topics with special associations not equivalent. Unsupported markers/labels/boundaries/summaries/href/extensions are explicitly reported and retained in source records.
- Resolved theme category properties plus per-topic overrides map supported font sizes pt→CSSpx rounded2decimals, bold/normal, italic, underline/strike, alignment, literal fill/text colors; supported node shapes become system shapes with explicit geometric approximation warnings. Line color/solid/dash/dot/width/straight/elbow/curve map, original path/arrow/control geometry flagged. Unavailable fonts, unsupported weights/properties, automatic color inheritance and theme palettes/defaults are warned, with original values retained. Native root inherited text color now uses readable contrast on dark fill; this is declared default substitution, not a claim of exact XMind inheritance/palette fidelity.
- Import-only fixed rightward hierarchy coordinates use subtree extents and title/image-aware card dimensions, avoid card overlap, and reserve enough title height. Interactive alternate layouts remain existing T10 shared controls. Source layout/geometry replacement is always a warning.
- Screenshot inspection found rounded nodes' existing title-height100% pushing an image beyond the clipped body. Shared card CSS now allocates visible title/image space for every media card style. Actual browser bounds assertion verifies loaded card image fits inside card; native root title is readable white-on-navy and image fully visible. Original data/notes/images remain editable after save/reopen.
- Shape dimensions/radii, original fonts, inherited palette, theme background, line geometry, rich note formatting and special-object behaviors remain explicit acceptance gaps. **R05 complete style/special-object fidelity is not satisfied by these approximations.** Human UAT must decide those differences; automated checks do not replace UAT.

## Limits and rejection behavior

- Upload bytes50MiB; expanded total60MiB, counting actual streamed bytes;1000ZIP entries. Reject noncanonical/absolute/dot/parent/backslash/colon/NUL paths, duplicate normalized entries, symlinks/special files, encrypted ZIP flags, CRC/decompression errors and damaged ZIP. ZIP is read in memory using Python standard library, never shell-extracted and never external fetched.
- JSON rejects duplicate keys, non-finite numeric constants, malformed structure. XML UTF8 only, forbids DTD/entity declarations before standard ElementTree parsing; UTF16/32 hiding declarations rejected. Both bounded depth128 and200000structural objects. At most100sheets,2500nodes/5000links per sheet, valid unique IDs. Titles exceeding model80chars and relationship titles60chars are rejected rather than sanitized silently; notes100000chars maximum with no truncation; filename/sheet-derived name100chars maximum.
- Referenced assets only safe existing ZIP xap paths and PNG/JPEG/WebP. T11 shared byte validator enforces decoded MIME,5MiB,40million pixels; malformed, unsupported and missing resources reject the whole import. No external image/link execution.
- Existing free student `graphNodes:50` entitlement is per graph, not account aggregate; authoritative backend subscription service determines paid/admin/teacher bypass (still2500technical node bound). Preview rejects exceeding current per-sheet quota before confirmation; confirm rechecks. Repository has **no configured server file-number account quota**; importer adds no invented account entitlement. Batch bound100sheets limits files created; API quota metadata records maxFiles:null and UI plainly shows max100sheets. This existing absence is explicit, not claimed as an enforced file-count plan quota.

## RED/GREEN commands and output

Evidence `artifacts/canvas-m2-m5/t12/`. All backend runs use existing conftest unique migrated disposable PostgreSQL DB, dropped at test exit.

- RED initial `cd backend && .venv/bin/python -m pytest tests/test_xmind_import.py -q`: **11failed**, live new routes404 before implementation (`backend-red.log`). Tests themselves use authenticated HTTP; first implementation iteration revealed wrong existing /files/.../content harness paths and a rounding expectation, corrected to actual /files/{id} and model2-decimal CSS px. No product success claimed from these harness failures.
- Additional RED `...pytest tests/test_xmind_import.py -q`: **3failed,18passed**, malformed children arrays/plain-note/map shapes not correctly rejected (`security-red.log`). Fixed explicit object validation + malformed-shape422 normalization. `...::test_special_object_warnings_require_matching_document -q`: **1failed**, old archive w0 warning could approve a changed document (`warning-bind-red.log`); fixed SHA-prefixed IDs.
- Initial expanded GREEN `...pytest tests/test_xmind_import.py tests/test_graph_assets.py -q`: **25passed**, existing single multipart PendingDeprecationWarning only. Includes T11 owner/privacy/clone/write regression and all T12 security cases. After final mapping/readability changes, final `...pytest tests/test_xmind_import.py -q`: **22passed**, same existing warning (`backend-green.log`). Includes native exact payload/media, XML selection/styles, zero-write previews, explicit warnings, viewer403, free51 and2501nodes, injected failure on SECOND sheet with files+assets0, real compressed/expanded/entry boundaries, CRC, symlink, malformed image, external/missing refs, DTD/UTF16, duplicate ZIP paths, malformed objects, long text/notes, official dual archives/encryption/SVG, stale warning rejection, readable media geometry/human labels.
- Frontend RED `node --test new-legacy/tests/graph-xmind-import.test.js`: missing shared module (`frontend-red.log`). GREEN inner **3passed** (initial2 plus human grouping); final `node --test frontend/scripts/graph-edge-midpoints.test.mjs`: **8wrappers passed** including all existing scoped edge/fragment/temporary/mindmap/media and T12 wrapper (`wrapper-green.log`). No full pnpm suite.
- Readability RED `...pytest ...::test_native_readable_media_geometry_and_human_warning_labels -q`: **1failed**, dark fill used dark default text (`readability-red.log`), fixed contrast/dimensions/human label metadata.
- Browser card clipping RED `python3 new-legacy/tests/graph-xmind-import-browser.py --base-url http://127.0.0.1:62783`: actual rounded image bounding rect outside card (`card-image-red.log`). Fixed shared media CSS and tested loaded image bounds.
- Final same browser command: **PASS**, no pageerrors (`browser-green.log`): actual both file inputs, JSON/2sheets selection and XML/2sheets import, preview zero files, unchecked acceptance/import-disabled state, exact title/notes/declared hierarchy, visible PNG card/detail images, original current graph unchanged, native26pt/700, XML20pt/colors/shape/dashed2pt, actual modal title edit, notes/model edit, save/reopen structural equality, all original graph data preserved and file-library entry rendered. Harness encountered onboarding/learning chooser and floating toolbar intercepting screenshot UI cleanup; dismissed real onboarding/chooser/help/flow buttons in appropriate order. These were evidence preparation failures, not importer failures.
- Final inspected screenshots `native-preview.png`, `native-imported.png`, `xml-import-reopened.png`: grouped human names/category, diagnostics collapsed, practical limits, native readable uncut root title+PNG+notes; XML root PNG+notes/detail+hierarchy visible without onboarding/help overlays. Root separately inspected earlier corrected visual evidence. Original native image itself contains a screenshot of project content; it is the intended PNG fixture, not a static substitute for graph conversion.
- `pnpm --dir frontend sync:new-legacy` passes (`sync.log`) to serve source on helper. Generated frontend/public/manifests/sync report remain UNSTAGED for controller integration.
- Final node syntax, Python py_compile, source and staged `git diff --check`: exit0. Source fixture SHA recorded above remains unchanged.

## Cleanup and scope

Owned disposable helper port62783. Restarted isolated helper as needed to load revised Python service; previous sessions exit0 and clean disposable databases. Final PID17556 process identity verified, SIGTERM; tracked server session exited0 after engine/database cleanup. No production/UAT data touched. Post-commit index empty and task source/test paths clean; only existing/generated frontend artifacts remain dirty. No full final suite, release/promote, deployment, human UAT or other feature implementation.

Files: backend service/schema/router and focused test; five archived fixtures + provenance/expected; shared frontend controller and actual two import entrypoint wiring; index/library script + bundle registration; shared card-media CSS; focused frontend/browser tests and existing CI wrapper. Existing large toolbar/file manager received local wiring only, no duplicated parser/controller.

## Review fix round1 — all three Important findings

Reviewed `task-12-review.md`; fix base4d04ff7f. Root docs-only76356649 preserved unchanged. Fix commit **8e219776 — fix(graph): bound XMind conversion and reject lossy XML**. Four scoped backend source/schema/API/test files only. No UI source, fixtures, generated files, descendants, branch changes, push/deploy/merge, helper or full-suite run.

### Conversion amplification and usable aggregation

- New aggregate `ConversionBudget` limits conservative converted/source JSON size to **16MiB**, warnings to **2MiB** and **2048 unique category/value differences**, and total affected-object associations to **40000**. The size estimator walks bounded input without serializing/copying strings, uses conservative6bytes per Unicode character plus structural/scalar overhead, and reserves metadata/style/content cost BEFORE inherited dict merge, source deepcopy and per-topic mapping. Warning dictionaries and each association are reserved incrementally before append. Warning metadata budgets include both response and persisted accepted-warning representation. Over-budget documents explicitly413 with simplify/split advice; no truncation or partial import.
- Identical sheet/category/value differences use one shared warning with exact `affectedObjects:[{id,title}]`; first display title adds affected count as references accumulate. Source styles still remain associated with every converted node under the conversion budget. Thus normal inherited differences are not counted once per node. Existing shared UI displays the human title/count and diagnostic affected list using its existing text-node/JSON record flow; no new UI implementation needed.
- Small deterministic **25topics×100inherited unsupported properties** probe now produces **101 shared warnings**, each property has exactly25affectedObjects, rather than2501duplicated dictionaries. No full malicious load performed. Forced small4096-byte warning budget rejects the same small probe413; forced16384-byte converted budget rejects a20KB notes/source probe before node copying.
- Moderate **200topics with actual native fixture theme** passes conversion with **fewer than40warnings**, including records with exactly200affectedObjects. This verifies ordinary repetitive styling does not hit2048count cap. Complex/large metadata may still explicitly exceed aggregate conversion/reference budgets even below2500nodes; that is a disclosed bounded-import limitation, not silent loss or account entitlement.
- Schema maximum `acceptedWarnings` now shares2048count constant with parser. HTTP Form length bound **65538 ASCII characters** (2048×32+2) comfortably accommodates the JSON encoding of the maximum2048 longest actual source-prefixed IDs (22ASCII characters each), tested alongside ordinary accepted output. Existing client JSON.stringify transport fits every permitted warning list. Extra-count confirmations rejected by schema. Byte budget is conservative output estimation; no claim of measuring exact Python RSS.

### XML loss prevention

- Namespaced `xlink:href` is retained as source `href`, reported as a non-executed special object; no external fetch/navigation behavior granted. Other unsupported topic, sheet, document, title/notes/image, child-container and child-group attributes retain exact namespace-qualified keys/value source metadata with specific XML-attribute warnings. Converted image `src` is recognized, so it is not falsely described as unsupported.
- Repeated child groups with the same type explicitly422 **before overwriting any earlier group**. Duplicate single structural title/notes/children/image/root/relationships elements rejected; structured title/plain-note markup or unknown child-container/group elements explicitly rejected instead of flattened/dropped. Coexisting nonplain note source elements and nonmapped worksheet elements are retained as unsupported source records with warnings. Exact behavior covered for hyperlink, custom topic/sheet/container/group attrs and attached A/B duplicate groups.

### Malformed compression

- Archive boundary now catches `zlib.error` and `lzma.LZMAError` in addition to existing OSError/EOFError/BadZipFile/unsupported-method errors. BZIP2 decoder failures use existing OSError/EOFError handling. A valid ZIP with first DEFLATE block changed to reservedBTYPE3 is submitted through real authenticated preview AND confirm APIs; both return controlled422 ZIP-corruption detail and leave files/assets0.

### RED/GREEN and checks

Evidence `artifacts/canvas-m2-m5/t12/`:

- RED `cd backend && .venv/bin/python -m pytest tests/test_xmind_import.py -q`: **3failed,22passed**, existing multipart warning only (`review-backend-red.log`). Small expansion was accepted without budget; XML href absent; corrupt DEFLATE returned500. These are direct regressions for all three findings, not load tests.
- Final GREEN same command: **26passed**, existing multipart PendingDeprecationWarning only (`review-backend-green.log`). Includes all previous native/XML/assets/transaction/permission/quota/path/codec/type checks plus amplification budgets, dedup exact affected references, moderate200topic theme, confirmation maximum transport, XML attribute/group cases and real decoder API rejection.
- `python3 -m py_compile backend/app/services/xmind_import_service.py backend/app/api/v1/graph_imports.py backend/app/schemas/xmind_import.py backend/tests/test_xmind_import.py`: exit0.
- Source and staged `git diff --check`: exit0. Post-commit four scoped paths clean and index empty. No browser rerun required because UI/renderer/style/source entrypoints unchanged; previous actual browser/evidence remains recorded above. No server started, every backend run used conftest disposable DB and cleanup. Existing dependency warning deferred as requested.


## Independent review

# T12 fix1 scoped rereview — 4d04ff7f..8e219776

## Spec Compliance

- ✅ Fix scope compliant: all three previous Important findings are resolved. The conversion budget is incremental, repeated inherited differences aggregate with bounded exact affected-object records, XML attributes are preserved/reported and repeated child groups reject, and decompressor errors become controlled archive failures (`backend/app/services/xmind_import_service.py:57`, `:120`, `:175`, `:279`, `:351`).
- ✅ Ordinary-document practicality is covered: the added native-theme 200-topic test requires fewer than 40 differences and an exact 200-object affected list (`backend/tests/test_xmind_import.py:227`). This uses the production parser and actual fixture theme, not a mocked mapping result. The reported final 26-test run was not repeated.
- ✅ Every permitted warning-ID list fits confirmation transport. The schema and parser share the 2,048 warning cap (`backend/app/schemas/xmind_import.py:4`); maximum real ID list JSON measures **52,138 characters**, below the **65,538** HTTP Form cap (`backend/app/api/v1/graph_imports.py:32`). Client-generated IDs are ASCII, so byte/character interpretation does not alter this conclusion.
- ⚠️ Full R05 style/special-object fidelity, genuine historical XML-exporter compatibility and human UAT remain unverified/unfulfilled as previously declared. This fix does not change those acceptance limitations or turn accepted approximations into full fidelity. The documentation-only fixture links preserve the synthetic XML provenance (`docs/verification/2026-10-12-canvas-m2-m5/UAT-CHECKLIST.md:17`).

## Strengths

- The fix charges replicated topic/source/style data before dictionary merge/deepcopy and checks warning/reference budgets before append; it avoids allocating the original millions-of-records expansion (`backend/app/services/xmind_import_service.py:57`, `:279`, `:351`). Identical sheet/category/detail differences share a record while retaining exact affected IDs/titles. The existing text-node UI displays the first title plus count and exposes full affected records in diagnostics; source-bound acceptance still applies.
- XML href and namespace-qualified unsupported attributes now survive in source records and produce compatibility warnings; duplicate attached groups no longer overwrite earlier topics (`backend/app/services/xmind_import_service.py:175`; regression `backend/tests/test_xmind_import.py:198`). No external-link execution was introduced.
- Corrupt DEFLATE now follows the existing explicit malformed-ZIP rejection. The added real authenticated preview/import test requires 422 and zero persisted files/assets (`backend/app/services/xmind_import_service.py:120`; `backend/tests/test_xmind_import.py:215`).

## Issues

### Critical / Important

- None remaining within the three-finding fix scope; no blocking fix-created regression identified.

### Minor

- **[P3] The size estimator is not conservative for arbitrary JSON integers.** `backend/app/services/xmind_import_service.py:54` returns 32 for every scalar, although a supported 1,000-digit integer serializes to 1,000 bytes. A small pure-function check confirms estimate=32 versus actual=1,000. Thus the new advertised 16 MiB converted-JSON ceiling is not a strict byte ceiling for source metadata containing large integers. Account for integer decimal length, or explicitly reject/bound unusually large numeric values. This does not reopen the demonstrated inherited-warning amplification: emitted detail strings and affected references are independently charged, and the existing ZIP/input structural bounds remain in force.
- Existing multipart `PendingDeprecationWarning` remains acknowledged in the appended report; this fix does not introduce it or claim pristine backend test output (`backend/tests/test_xmind_import.py:9`).

## Checks and scope

- Read only the fix review package and appended implementation report. The first tool output truncated part of the diff; read the missing conversion/test hunks in a smaller chunk. No changed source files were separately reread.
- Ran only the unreported, named size-estimator edge probe and a pure maximum-ID transport measurement, with `PYTHONDONTWRITEBYTECODE=1`. No suite repeats, database writes, browser reruns, source/index/branch mutations, descendants, push or deployment.
- Original transaction/UI/old ZIP+JSON compatibility assessment carries forward: this fix changes parser/schema bounds and errors, not the shared import routing or flush-only transaction primitives.

## Assessment

**Task quality: Approved, with the minor numeric-estimator follow-up above.**

**Reasoning:** The three blocking cases now have direct production-code fixes and focused regression coverage; ordinary repeated styling and maximum confirmation transport are explicitly covered. Approval is for this implementation/fix gate, not complete R05 fidelity or human UAT acceptance.
