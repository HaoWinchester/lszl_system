# Minimal Frontend Release Runtime Packaging Design

Date: 2026-08-26

Status: verified in an isolated worktree; handoff only

## 1. Decision

This document supersedes the earlier archive/prune/hash proposal. The accepted
scope is **packaging only**: build a small, deployable frontend runtime from the
releases selected by `current.json`.

Automatic archive copying, release pruning, full-tree hashing, archive
collision handling, retention automation, archive recovery, and any real
release-store cleanup are intentionally removed from this change. They remain
separate future work if they are needed, with their own review and safety plan.

## 2. Runtime package

`frontend/scripts/prepare-new-legacy-runtime.js` reads the canonical local
release store and produces `frontend/new-legacy-runtime/`. It includes only:

- `current.json`;
- the active release named by `current.json.version`;
- the rollback release named by `current.json.previousVersion`, when present;
- each selected release's `site/`, `release.json`, and `validation.json`.

It never copies a release `source/` tree or any unselected release. The output
is assembled in a staging directory and then renamed into place. The existing
storage validation remains fail-closed for malformed pointers, missing selected
releases or required files, failed validation reports, and symbolic links in
selected paths.

## 3. Deployment boundary

The local full release store remains the source of truth and is not moved,
archived, or pruned by this implementation. Deployment packaging runs before
the existing synchronization step; deployment synchronization excludes
`/frontend/new-legacy-releases` and the Docker image copies the prepared
runtime to the canonical release path. These code paths were contract-tested
only. This task did not contact a remote host, run a deployment, alter a real
release, or alter a backup.

## 4. Non-goals and safeguards

This scope does not:

- change FastAPI routing or frontend application behavior;
- move, prune, archive, hash, or delete any real release or backup;
- run remote synchronization, Docker builds, deployments, or health checks;
- infer release retention from directory or version ordering.

Before a future real deployment, an operator must regenerate the runtime from
the real selected pointer, inspect the resulting versions and size, and follow
the existing release/deployment review process. Any archive or prune proposal
requires a new design and explicit approval.

## 5. Isolated verification evidence

All commands below ran in the isolated `codex/release-size-optimization`
worktree. The required ignored frontend artifacts were generated with
`pnpm sync:new-legacy`; it created only the known tracked generated diffs in
`backend/app/seed/guided_course_v8_6_0.json` and
`frontend/new-legacy-sync-report.json`. Those two diffs were inspected and
restored before the handoff.

| Check | Result |
| --- | --- |
| `cd frontend && pnpm test` | 256 passed, 0 failed; duration 20,975.810 ms |
| main checkout `.venv`, `cd backend && python -m pytest tests/test_web_runtime.py -q` | 24 passed; 1 third-party deprecation warning; duration 4.90 s |
| two-release disposable fixture through `prepare-new-legacy-runtime.js` | selected exactly `v-active` and `v-rollback`; 19 files, 943 bytes; no `source/` directory |
| local-only deployment-shaped `rsync -azn --delete --stats` to a temporary local destination | 1,435 listed files; 1,334 files transferred; 23,025,025-byte payload; 119,673-byte file list |

The fixture contained only synthetic data and was removed after measurement.
The rsync destination was a temporary local directory; no remote endpoint was
contacted.

## 6. Handoff

The implementation is ready for review as a packaging-only change. Stop at
review/merge boundaries: do not promote a real release, modify backups, archive
or prune storage, synchronize to a server, or deploy from this worktree.
