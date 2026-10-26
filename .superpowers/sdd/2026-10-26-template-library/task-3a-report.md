# Task 3A — DONE

Scope: source-backed content/shared authoring/geometry/ZIP validation only. No database mutation, local import/repair, remote writes, deployment, backend/frontend source changes, dependencies or worktree creation. Task 3B publisher/local repair remains pending for a separate implementation agent as directed by root.

## Deliverables and design

- Added `内置数据/项目管理基础图谱/`: 18 original graphs, 18 canonical learning ZIPs, source `topics.mjs`, build wrapper, catalog, geometry report, README. Package ID `project-management-foundations-20261026`; category IDs prince2/cspm/gaoxiang, 6 topics each, matching all approved design titles.
- Every graph has exactly 11 cards: root + 7 concept cards with substantive descriptions and notes + original scenario + explanatory answer + misconception. Total new 198 cards, 198 links. Each has an authored conceptual relation with note plus root/concept/application links. Each concept is authored specifically to its topic rather than generic title substitutions.
- All new diagrams use existing bilateral layout; concepts cluster with related neighbors; semantic relations use exterior lanes. PRINCE2 seven processes are explicitly non-linear, not drawn as seven mandatory sequential steps. New graph/link IDs use category-topic prefixes and stable source keys.
- Shared `内置数据/shared/authoring.mjs` extracts the existing parser/render/export pipeline, supports explicit new-package metadata and category fields, validates duplicate identities, unsafe filenames, complete content, endpoints, finite geometry, directed reachability and nonoverlap. Old PMP wrapper delegates to it. Old graph output and catalog objects reproduce exactly in memory; old graph/package/catalog bytes were never regenerated.
- Shared `validate-layout.mjs` extracts original validation against actual editor edge geometry. Both package wrappers use it. Existing PMP layout report remained identical.
- Catalog retains old publisher row fields and adds `sourceKey`, `sha256` (graph file bytes), `packageFile`, `packageSha256` (ZIP bytes); package has exact counts and official provenance URLs. These are content digests, distinct from publisher's normalized immutable snapshot digest.
- Graph metadata includes edition, category, package/topic/source IDs, source URLs and scope disclaimer. Canonical legacy node aliases remain synchronized using model.updateContent.

## Source verification and editorial review

Read provided official-source research notes. Independently opened PeopleCert process-evolution page, official CSPM-2 2026 PDF (confirmed pages 3–4 knowledge-depth distinctions), and official Tsinghua publisher page (fourth edition, ISBN, publication date). Full URLs and scope distinctions are in package README and graph metadata. All cards, scenarios and relation notes are original Chinese teaching text.

PRINCE2: practices not old themes; principles remain applicable under tailoring; directing spans project, stage/product interactions and repeating boundaries explained; business/board/PM/team responsibilities distinguished; forecast tolerance breach escalates. Stage scenario precisely states total forecast upward 8万元 vs tolerance5万元, exceeding tolerance by3万元.
CSPM: five capability levels not lifecycle; no automatic PMP equivalence; no application/pass/fee claims; standard dimensions vs syllabus groupings distinguished; CSPM-2 depth limitations on change and lessons expressly stated.
高项: fourth-edition IT, governance, engineering and configuration/change coverage retained; no false 2026 edition; case/essay structures explicitly original study aids. EVM numbers independently checked: PV10 EV8 AC9万元; SV-2 CV-1万元; SPI.8 CPI8/9≈.889. EAC model states assumption.

## Commands and evidence

TDD RED: `node --test 内置数据/shared/authoring.test.mjs` initially failed ERR_MODULE_NOT_FOUND before shared implementation; later duplicate identity test failed “Missing expected rejection” before guard implementation. GREEN final:

- `node --test 内置数据/shared/authoring.test.mjs`: 4/4 passed. Covers 18 graphs/198 nodes/3 categories/meaningful card fields/unique source keys; actual geometry of all48; duplicate/path rejection; full reproduction of all30 original PMP graphs and catalog.
- `node 内置数据/项目管理基础图谱/build.mjs`: graphs18 nodes198 links198.
- `node 内置数据/项目管理基础图谱/validate-layout.mjs`: graphs18 cardObstructions0 edgeCrossings0.
- `node 内置数据/PMP8知识图谱/validate-layout.mjs`: graphs30 cardObstructions0 edgeCrossings0.
- `python3 -m unittest discover -s 内置数据/shared -p 'test_*.py' -v`: 2/2 passed. Traverses all48 graph snapshots and ZIP CRC/manifest/extracted graph equality, all endpoints/reachability/notes/aliases; new graph and ZIP SHA256 and stable source identity. Checks62 original graph/ZIP/catalog/outer ZIP files byte-for-byte against pre-task commit d631e115.

Combined authored counts:48 graphs,528 cards,540 links; new18=198/198, old30=330/342. No non-endpoint card obstruction or sampled edge crossing among48. No full frontend suite run per scope; no API/browser acceptance of newly loaded18 yet because root will perform controlled local import later. No remote compatibility execution yet.

## Task 3B interfaces / invocation handoff

Leave old publisher/import-local unchanged in this commit. Publisher must accept arbitrary package path, derive counts from catalog, support both current old catalog and new schema, enforce duplicate identities/path confinement/hash agreement, persist `PublicationInput.category` for new publications, classify old PMP without creating versions. For old PMP category metadata should be pmp even though old catalog category contains topic labels (immutable catalog unchanged). New package's row category is already the stable ID.

Recommended interface: shared Python publication helper with explicit package directory + selected environment; UAT default, prod explicit; --check-package performs read-only content validation independent of DB; dry-run must never mutate. Keep same-name/source/snapshot digest conflict and source owner/version linkage checks. Existing source kind builtin-template must be created only through service layer, not reserved-source client API.

Local helper must separately enforce loopback origin + exact ENV=dev/database=kg_graph_dev. Exact prior receipt IDs + owner + current version source + semantic snapshot equivalence + immutable snapshot package ID are the only permitted old-source repair evidence; preserve graph_data/defaults/versions/personal loaded copies. Fresh backup/evidence guard required before apply; do not infer by title. Root will invoke after review; nothing imported/repaired here.

Exact invocation guidance for authoring/validation is in package README. Final local/remote publication command names depend on Task3B implementation and must be documented there; do not invoke existing import-local.py for the new package, because it currently creates source=imported and hardcodes PMP.

## Concerns / limits

Learning ZIP export includes current timestamp in manifest/README; rebuilding new package refreshes ZIP bytes/hash. This is existing exporter behavior; immutable committed artifacts are verified, graph hashes stable. No change to exporter or old ZIP bytes.
Geometry uses existing 201-point cubic sampling and segment intersection policy, not formal analytic proof. It matches actual editor paths and the established package validator. Visual browser inspection of new content remains root's later acceptance step. Content is introductory original teaching, not certification eligibility guidance or exhaustive official coverage.
