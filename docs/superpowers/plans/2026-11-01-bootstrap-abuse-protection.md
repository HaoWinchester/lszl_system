# Bootstrap Abuse Protection Implementation Plan

> **For agentic workers:** Execute inline using executing-plans; the user authorized implementation and UAT deployment in this session.

**Goal:** Block unauthorized bulk bootstrap reads and immediately persist account/IP enforcement without interrupting normal learning.

**Architecture:** Bootstrap has a permission dependency before its existing rate limiter. A shared service persists IP blocks and pauses identified accounts atomically; middleware enforces blocks across requests and administrator APIs release IP locks.

**Tech Stack:** FastAPI, SQLAlchemy async, PostgreSQL, Alembic, pytest, existing release tooling.

## Global Constraints

- Work only inside this workspace; retain unrelated untracked documents.
- Keep normal public summaries, paginated questions and managed teacher exports working.
- Ordinary rate limiting never suspends accounts or locks IPs.
- Only trust configured reverse proxies for client IP forwarding.
- Stop at UAT pending explicit user acceptance; never update main.

### Task 1: Reproduce and define the boundary

- [x] Add `backend/tests/test_bootstrap_security.py` with real HTTP and database checks for forbidden bulk requests, persisted locks, account suspension, safe normal callers, spoofed forwarding and admin recovery.
- [x] Run `.venv/bin/python -m pytest tests/test_bootstrap_security.py -q` and confirm current code returns 200 where 403 is required.

### Task 2: Implement and retain normal behavior

- [x] Add `backend/app/core/client_ip.py`, `backend/app/models/security.py`, the Alembic migration and `backend/app/services/content_security_service.py` for trusted IP resolution and persistent enforcement.
- [x] Wire bootstrap guard before rate limiting, global IP enforcement and administrator listing/unlock APIs; reuse `paused` and audit logging.
- [x] Configure trusted UAT/production Docker gateway forwarding using the verified deployment network, and have the existing rate limiter share the same resolver.
- [x] Update the old graph-access test to use summary bootstrap, keeping public visibility and answer assertions in paginated normal learning tests.
- [x] Run the focused regression tests, then full backend and frontend checks; fix only related regressions.

### Task 3: Integrate and deploy to UAT

- [x] Review diff and verify main/uat still exist. Commit feature, merge into uat and push using the required proxy; verify remote branch hash.
- [x] Run existing `deploy/update-uat.sh` and complete release validation, browser checks and public version checks; commit/push generated tracked release artifacts.
- [x] Verify first-hit enforcement with isolated UAT fixtures, clean up test blocks/accounts, write verification evidence and report the UAT URL to the user.

## UAT 交付状态

用户清理服务器空间后已完成 UAT 404 部署、首次封禁/解锁及四页登录退出在线检查、实际 3 题练习和刷新后进度持久化检查。所有临时账号/测试数据及测试 IP 锁定已清理；回退镜像已保留。等待用户本人业务验收，main 与正式环境未更新。
