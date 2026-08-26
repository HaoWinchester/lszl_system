# Release Packaging and Repository Size Optimization Design

Date: 2026-08-26

Status: approved in conversation; awaiting written-spec review

## 1. Goal

Reduce the local project footprint, deployment payload, and Docker build context without weakening the immutable-release, validation, or rollback guarantees.

The accepted retention rule is:

- keep the release selected by `current.json`;
- keep its `previousVersion` rollback target when one exists;
- archive every other complete release outside the repository;
- ship only the runtime files for the protected releases.

The implementation must not infer importance from version ordering. The version named by `current.json` is authoritative even when a lexically or numerically newer directory exists.

## 2. Current Evidence

The diagnosis on 2026-08-26 found:

- the whole checkout occupied about 2.8 GB;
- `frontend/new-legacy-releases/` occupied about 1.5 GB across 43 release directories;
- one release occupied about 36 MB because it contained an approximately 18 MB `source/` tree and an approximately 18 MB `site/` tree;
- the deployment `rsync` dry run selected 84,586 files totaling 1,509,007,867 bytes;
- the effective Docker context was approximately 2,075,666,177 bytes;
- `backups/` occupied about 565 MB, including a 482 MB repository snapshot;
- `.git/` occupied about 549 MB because Codex checkpoint refs retained that 482 MB backup object;
- the large backup object was not reachable from `main`, `uat`, `origin/main`, or `origin/uat`.

At diagnosis time, `current.json` selected `v9.0-p4.1.164` and named `v9.0-p4.1.162` as its rollback target. These values are evidence only; all implementation logic must reread `current.json` at execution time.

## 3. Non-Goals

This work does not:

- rewrite Git history;
- delete Codex-owned checkpoint refs while other tasks may depend on them;
- change FastAPI's canonical release path or request routing;
- change the generated frontend's DOM, CSS, or business behavior;
- remove `frontend/public/new-legacy/` as the fallback site;
- automatically delete remote historical files before a newly deployed container passes health checks;
- run a real cleanup from the isolated implementation worktree.

## 4. Safety Invariants

The following invariants are mandatory:

1. Protected versions come only from `current.json.version` and `current.json.previousVersion`.
2. The active version is never archived.
3. The rollback version is never archived when it is present.
4. A missing, malformed, unsafe, or internally inconsistent pointer causes a closed failure before mutation.
5. Both protected releases must contain a valid `release.json`, `site/`, and all critical site files before pruning or runtime packaging.
6. Archiving never overwrites a different archive with the same version name.
7. Source removal happens only after an external archive copy has passed file-count and full-tree hash verification.
8. Runtime package replacement is atomic: consumers see either the old complete package or the new complete package.
9. Update, promote, rollback, prune, and runtime packaging share the existing release lock so they cannot mutate or snapshot the store concurrently.
10. Formal deployment stops before remote synchronization when runtime packaging or pruning fails.

## 5. Architecture

### 5.1 Canonical local release store

`frontend/new-legacy-releases/` remains the canonical immutable release store. After maintenance it contains:

- `current.json`;
- the active release directory, including `source/`, `site/`, `release.json`, and `validation.json`;
- the rollback release directory with the same complete structure, when `previousVersion` exists.

Keeping complete protected releases preserves local auditability, adapter rebuild behavior, design-contract compatibility, and one-step rollback.

### 5.2 External archive

The default archive root is a sibling of the repository:

`<repository-parent>/<repository-name>-release-archive/`

The CLI accepts `--archive-root <path>` for an explicit alternative. The resolved archive root must be outside the repository and outside the canonical release root. A path inside either boundary is rejected.

Each archived version keeps its release directory unchanged. No archive-specific transformation is applied, so recovery is a verified copy back into the canonical store.

### 5.3 Runtime package

The generated runtime package lives at:

`frontend/new-legacy-runtime/`

It contains:

- the exact `current.json` pointer;
- active and rollback directories;
- each protected version's `site/`, `release.json`, and `validation.json`;
- `runtime-package.json`, recording schema version, protected versions, source pointer hash, file count, byte count, and creation time.

It excludes every `source/` tree and every unprotected release.

Inside the Docker image, this directory is copied to the existing canonical location `/app/frontend/new-legacy-releases/`. FastAPI therefore continues to resolve releases without a configuration or routing change.

### 5.4 Shared release-storage module

Reusable storage behavior belongs in a focused shared module under `frontend/scripts/`, rather than being duplicated across deployment scripts. The module owns:

- pointer parsing and validation;
- protected-version resolution;
- critical-file validation;
- deterministic tree inventory and hashing;
- prune planning;
- verified archive copying;
- atomic runtime package assembly;
- size-limit enforcement.

`manage-new-legacy.js` exposes the CLI and retains orchestration responsibility.

## 6. Command Design

### 6.1 Prune planning

The new command is:

```text
node frontend/scripts/manage-new-legacy.js prune \
  [--root <release-root>] \
  [--archive-root <archive-root>] \
  [--apply]
```

Without `--apply`, the command is read-only and prints a JSON plan containing:

- pointer path and hash;
- protected versions;
- archive candidates;
- ignored staging entries;
- per-version file counts and byte counts;
- archive root;
- total reclaimable bytes;
- `applied: false`.

With `--apply`, the command executes exactly that plan while holding the release lock. It rereads and revalidates the pointer after taking the lock so a stale dry-run plan cannot authorize a different mutation.

### 6.2 Runtime preparation

The new command is:

```text
node frontend/scripts/manage-new-legacy.js runtime \
  [--root <release-root>] \
  [--out <runtime-root>]
```

It assembles the runtime package in a sibling staging directory, validates its manifest and critical files, enforces the size threshold, then atomically replaces the output directory.

The formal deployment scripts invoke `runtime` after successful promotion and before `rsync` or Docker build.

### 6.3 Formal retention automation

Low-level `promote` and `rollback` do not silently archive data. Formal production and UAT deployment orchestration explicitly performs:

1. build and validate the release;
2. promote it locally;
3. generate and validate the runtime package;
4. execute `prune --apply` with the configured external archive root;
5. synchronize the reduced deployment payload;
6. build and start the container;
7. pass health checks;
8. perform any separately approved remote cleanup.

This makes retention automatic for formal deployments while preserving a safe, non-destructive default for manual maintenance commands.

## 7. Archive Transaction

For each unprotected version:

1. Reject symlinks or unsafe paths escaping the release directory.
2. Inventory the source tree and compute its deterministic hash.
3. If a final archive exists, inventory it. Reuse it only when count, bytes, and hash match; otherwise fail without touching the source.
4. If no archive exists, copy into `<archive-root>/.staging-<version>-<pid>`.
5. Inventory and hash the staging copy.
6. On mismatch, retain the canonical source, remove only the command-owned incomplete staging directory, and fail.
7. Atomically rename the verified staging directory to `<archive-root>/<version>`.
8. Remove the canonical unprotected release directory.
9. Record the archived version and verified hash in the command result.

If processing several versions and a later version fails, already archived versions remain recoverable and protected versions remain untouched. The command reports partial progress explicitly; retry is idempotent because matching final archives are reusable.

## 8. Deployment and Docker Changes

### 8.1 Docker context

`.dockerignore` adds anchored exclusions for:

- `/backups/`;
- `/frontend/new-legacy-releases/`;
- local source/test material not required by the image;
- existing virtual environment, cache, and test exclusions.

`frontend/new-legacy-runtime/` remains available to the build context.

### 8.2 Docker image

The Dockerfile replaces the full release-store copy with:

```text
COPY frontend/new-legacy-runtime/ /app/frontend/new-legacy-releases/
```

The generated fallback site remains copied from `frontend/public/new-legacy/` for startup resilience.

### 8.3 Production and UAT synchronization

Both deployment scripts:

- generate the runtime package before synchronization;
- exclude `/frontend/new-legacy-releases/`;
- exclude `/backups/` and non-runtime local materials;
- synchronize `frontend/new-legacy-runtime/` once;
- remove UAT's redundant second release `rsync`.

Remote historical release directories are not automatically deleted in the same change. They are excluded from future Docker contexts and can be cleaned only after the new image is healthy and a separate remote dry-run is reviewed.

## 9. Backups and Git Objects

`.gitignore` and `.dockerignore` add `/backups/`. Existing backup data is moved in a separate, recoverable maintenance step to:

`<repository-parent>/<repository-name>-backups/`

No implementation command deletes the approximately 482 MB Codex checkpoint object. After every active Codex window is complete, Git object cleanup may be handled separately through checkpoint expiration or a verified fresh clone. It must not be bundled into release pruning.

## 10. Error Handling

All CLI failures use a non-zero exit code and a concise error that identifies the failed phase and version. Expected closed failures include:

- missing or malformed `current.json`;
- invalid version syntax or unsafe path traversal;
- missing active or rollback release;
- missing critical site file;
- missing or failed validation report;
- archive root inside the repository;
- archive collision with different content;
- insufficient disk space or copy failure;
- source/archive inventory mismatch;
- runtime package exceeding its size threshold;
- lock contention with update, promote, rollback, prune, or packaging.

Deployment scripts propagate these failures and stop before `rsync`.

## 11. Tests

### 11.1 Release storage unit and contract tests

Temporary test roots cover:

- dry-run never mutates;
- active and rollback are always protected;
- a single active release works when `previousVersion` is null;
- version ordering never changes protection decisions;
- malformed pointers fail closed;
- missing protected manifests, sites, validation, or critical files fail closed;
- staging directories are ignored as candidates;
- a matching archive makes retries idempotent;
- a conflicting archive blocks mutation;
- interrupted or corrupted copies preserve the canonical source;
- runtime packages contain only protected versions;
- runtime packages omit `source/`;
- runtime replacement is atomic;
- rollback works from the reduced runtime package;
- size gates reject oversized runtime packages.

### 11.2 Deployment contracts

Static and dry-run tests assert:

- production and UAT exclude the full release store;
- both generate the runtime package before synchronization;
- UAT no longer performs duplicate release synchronization;
- Docker copies only the runtime package to the canonical container path;
- `.dockerignore` excludes backups and the full local release store;
- deploy failures before synchronization do not contact the remote host.

### 11.3 Regression verification

Required verification includes:

- `cd frontend && pnpm test`;
- targeted backend web-runtime tests;
- release-manager tests against temporary roots;
- deployment script fixture tests;
- a Docker build-context measurement;
- a deployment `rsync --dry-run --stats` measurement;
- active-site key-page and file-count checks required by project policy.

The isolated worktree baseline was established after generating ignored frontend artifacts: 238 frontend tests passed and 0 failed.

## 12. Size Gates and Success Criteria

The default gates are:

- generated runtime package: at most 50 MiB;
- full deployment dry-run payload: at most 100 MiB;
- Docker build context: at most 100 MiB.

The implementation reports exact counts and bytes. A threshold increase requires an explicit code change and test update; it cannot happen silently because another release directory appeared.

The optimization is complete when:

- formal deployment carries only active and rollback runtime sites;
- local canonical release storage contains only active and rollback full releases after approved cleanup;
- every other release is verified in the external archive;
- backups no longer enter Git status or Docker context;
- all required tests and size gates pass;
- the active site and one-step rollback both work after packaging;
- no code or real release data in the other active worktree is modified.

## 13. Rollout

Implementation and automated tests occur on the isolated branch `codex/release-size-optimization`. The real release store is ignored by Git and is not present in that worktree, so tests use temporary fixtures only.

After implementation review and integration:

1. wait for the other functional-diagnosis window to finish;
2. verify the shared checkout is clean except for known user-owned data;
3. generate a real prune dry-run and save its JSON report;
4. confirm the dynamically resolved active and rollback versions;
5. generate and verify the runtime package;
6. run `prune --apply` to the external archive;
7. compare source and archive inventories and measure reclaimed space;
8. move `backups/` outside the repository in a separate recoverable operation;
9. run the formal deployment and health checks;
10. consider Git checkpoint cleanup only after all Codex tasks have ended.

No real release archive, backup move, remote cleanup, merge, or deployment is performed during isolated implementation without its corresponding review gate.
