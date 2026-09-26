# Teacher assistant UAT deployment gate

`update-uat.sh` now composes the UAT backend, mini-program overlay and teacher-assistant overlay. `--check-config` performs remote read-only presence/executable checks and `docker compose config --quiet`; it never starts services or displays expanded configuration. Normal deployment repeats this gate after synchronization, then aborts unless backend, mini-program and assistant readiness pass. A failed assistant gate does not mark the deployed Git commit successful; it does not automatically roll back services already restarted.

Before the first deployment, the operator must provision these **on the UAT server only**:

- `backend/.env.teacher-assistant.local`: the existing approved Coding Plan endpoint in `ANTHROPIC_BASE_URL` and its `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_API_KEY`. Preserve the existing account/provider configuration; never put secrets in Git, shell output or this document. Restrict file permissions to its owner. The worker model stays `glm-5.3-flash[1m]`.
- The existing Linux Claude executable at `/usr/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe`, executable by container UID 10001 and compatible with the worker image. The file is mounted read-only. A successful `--version` probe verifies execution, not provider authentication or entitlement.
- The UAT database account/network already required by the base compose file. Migrations run through the backend; worker readiness checks the current Alembic heads and assistant tables read-only.

The API owns upload admission. The new shared volume root is initialized to UID/GID 10001 and mode 0750 by the API container after startup; existing per-session files remain untouched. Worker readiness requires access to this root. The converter has **no shared file volume, provider/DB environment or host ports**, belongs only to an `internal: true` Docker network, and receives only the bounded document conversion request. Both services use the unprivileged image user, read-only root, tmpfs, dropped capabilities and no-new-privileges.

Worker 640 MiB plus converter 384 MiB permits **1 GiB additional container memory**. These are ceilings, not reservations. The UAT backend has no memory ceiling, and production/database workloads share the host; these settings alone do not establish sufficient host headroom. Before rollout, measure available memory, existing workload peaks, swap/OOM activity, image-build disk/memory needs, and leave margin for the OS and Docker. After rollout, record `docker stats` peaks with representative scanning/Office jobs. Do not silently lower limits to make the deployment pass.

The deployment CLI checks worker process, configured provider/model, executable availability, private storage, migrations and converter HTTP health. It does **not** submit a model prompt, authenticate with the provider, open an Office sample or certify OCR accuracy. Complete a real Coding Plan conversation and JSON/Word/PDF/PPT smoke test in UAT after deployment; user UAT acceptance is still required before main/production integration.

Local checks:

```sh
bash -n deploy/update-uat.sh
node --test deploy/tests/*.test.mjs
python3 -m unittest discover -s deploy/tests -p 'test_teacher_assistant_readiness.py' -v
bash deploy/tests/update-uat-dirty-tree.test.sh
bash deploy/tests/update-uat-fast-path.test.sh
bash deploy/tests/update-uat-version-bump.test.sh
bash deploy/tests/update-uat-validation.test.sh
```

## Reusing the backend Python runtime

The assistant Dockerfile retains its existing `python:3.12-slim` final base and Office/OCR apt instructions. A separate `backend-runtime` stage uses the local backend image (`lszl-kg-backend:uat-27c39ab` by default); the final stage copies `/usr/local` from it instead of running another `pip install`. Both images use the same Python base and backend requirements, so the backend remains the dependency installation authority. The non-root user, converter isolation and business code copy are unchanged.

`update-uat.sh` explicitly runs `compose build backend` before `compose up -d --build`. A failed prebuild stops deployment, preventing accidental reuse of stale installed dependencies. Server Compose 2.28 accepted `additional_contexts` in configuration but its real builder treated `service:backend` as a missing path; this implementation intentionally uses an image stage instead and requires no Docker upgrade.

`BACKEND_RUNTIME` can override the stage image through the Compose build argument (or `docker build --build-arg BACKEND_RUNTIME=...`). If overridden, the operator must provide an already built, compatible image with the current backend dependencies; the default deployment prebuild creates the normal backend tag, not an arbitrary override. Keep the Python base images aligned when upgrading. Actual cache reuse and imports in the resulting server container remain deployment checks.
