# WeChat Mini Program Advanced Modes and Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish challenge, scholar, and revenge experiences, harden offline/conflict behavior, and produce a verifiable UAT-ready mini-program build.

**Architecture:** Advanced modes remain views over the existing authoritative practice and mistake-remediation APIs. A single mode-policy module controls labels, timers, answer reveal, and completion behavior; a single sync coordinator serializes writes and resolves revision conflicts across every mode.

**Tech Stack:** Native WeChat WXML/WXSS/TypeScript, existing FastAPI practice/mistake APIs, Node.js tests, pytest, WeChat Developer Tools manual/device verification.

## Global Constraints

- No gradients, glow, English slogans, oversized decorative cards, or game HUD competing with question content.
- Challenge and scholar modes reveal no answer, correctness marker, or analysis before completion.
- Revenge mode uses the existing remediation and verification endpoints; do not invent a second mistake ledger.
- Never infer a successful save after timeout; show offline/local state until the server acknowledges the same idempotency key.
- Respect existing subscription access rules and server authorization; do not add in-mini payment.
- Do not merge or push `main` without explicit user UAT approval.
- Real AppID, legal/privacy declarations, and device verification are release gates, not values to fake in source.

---

## File Structure

- `miniprogram/domain/mode-policy.ts`: one policy table for all four modes.
- `miniprogram/domain/sync-coordinator.ts`: serialized writes, idempotency, retry, and revision-conflict decisions.
- `miniprogram/pages/revenge/`: remediation queue and verification loop.
- `miniprogram/pages/profile/`: identity, experience, subscription state, privacy/legal links, and logout.
- `miniprogram/docs/release-checklist.md`: environment, privacy, device, and UAT evidence.

### Task 1: Centralize normal, challenge, scholar, and revenge policies

**Files:**
- Create: `miniprogram/domain/mode-policy.ts`
- Modify: `miniprogram/pages/practice/index.{wxml,wxss,ts}`
- Modify: `miniprogram/pages/practice-setup/index.{wxml,ts}`
- Test: `miniprogram/tests/mode-policy.test.mjs`

**Interfaces:**
- Produces: `getModePolicy(mode: PracticeMode) -> ModePolicy` with `title`, `showTimer`, `revealAfterAnswer`, `revealAfterComplete`, `allowPause`, and `accent`.
- Consumes: backend modes `normal`, `challenge`, `scholar`, `revenge` without client-side renaming.

- [x] **Step 1: Write failing policy tests**

```javascript
test('competitive modes never reveal per-question answers', () => {
  for (const mode of ['challenge', 'scholar']) {
    const policy = getModePolicy(mode);
    assert.equal(policy.revealAfterAnswer, false);
    assert.equal(policy.revealAfterComplete, true);
  }
});
```

- [x] **Step 2: Run to verify failure**

Run: `node --test miniprogram/tests/mode-policy.test.mjs`
Expected: FAIL because the policy module is absent.

- [x] **Step 3: Implement and consume one policy table**

```typescript
export const MODE_POLICIES: Record<PracticeMode, ModePolicy> = {
  normal: { title: '普通练习', showTimer: false, revealAfterAnswer: true, revealAfterComplete: true, allowPause: true, accent: 'green' },
  challenge: { title: '挑战模式', showTimer: true, revealAfterAnswer: false, revealAfterComplete: true, allowPause: false, accent: 'clay' },
  scholar: { title: '学霸模式', showTimer: true, revealAfterAnswer: false, revealAfterComplete: true, allowPause: false, accent: 'gold' },
  revenge: { title: '错题复仇', showTimer: false, revealAfterAnswer: true, revealAfterComplete: true, allowPause: true, accent: 'clay' },
};
```

Use a small text timer beside progress, one accent line, and mode-specific copy; do not add badges, streak flames, confetti, or full-width status cards.

- [x] **Step 4: Run policy and practice contracts**

Run: `node --test miniprogram/tests/mode-policy.test.mjs miniprogram/tests/practice-page-contract.test.mjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add miniprogram/domain/mode-policy.ts miniprogram/pages/practice miniprogram/pages/practice-setup miniprogram/tests/mode-policy.test.mjs
git commit -m "feat: add restrained advanced practice modes"
```

### Task 2: Build the wrong-question revenge loop

**Files:**
- Modify: `miniprogram/services/practice.ts`
- Create: `miniprogram/pages/revenge/index.{json,wxml,wxss,ts}`
- Create: `miniprogram/components/remediation-note/index.{json,wxml,wxss,ts}`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/pages/home/index.{wxml,ts}`
- Modify: `miniprogram/pages/result/index.{wxml,ts}`
- Test: `miniprogram/tests/revenge-page-contract.test.mjs`

**Interfaces:**
- Produces: `getRevengeSummary()`, `submitRevengeAnswer(mistakeId, answer)`, `markRemediationReviewed(mistakeId)`, `getVerificationCandidate(mistakeId)`, `submitVerification(mistakeId, answer)`.
- Consumes: existing `/learning/practice/revenge/summary` and mistake routes.

- [x] **Step 1: Write failing revenge-flow contracts**

```javascript
test('revenge flow requires remediation before verification', () => {
  const ts = read('pages/revenge/index.ts');
  assert.match(ts, /markRemediationReviewed/);
  assert.match(ts, /getVerificationCandidate/);
  assert.match(ts, /submitVerification/);
});
```

- [x] **Step 2: Run to verify failure**

Run: `node --test miniprogram/tests/revenge-page-contract.test.mjs`
Expected: FAIL because the page is absent.

- [x] **Step 3: Implement the three-stage loop**

Render `重答原题 → 阅读纠错 → 变式验证` as a quiet three-step text indicator. Require the server-confirmed remediation-reviewed response before requesting the verification candidate, keep each write idempotent, and return to the revenge queue with the refreshed summary after verification.

- [x] **Step 4: Run frontend and mistake API tests**

Run: `node --test miniprogram/tests/revenge-page-contract.test.mjs`
Expected: PASS.

Run: `cd backend && .venv/bin/python -m pytest tests/test_practice_sessions.py -q -k 'revenge or remediation or verification'`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add miniprogram/app.json miniprogram/components/remediation-note miniprogram/pages/home miniprogram/pages/result miniprogram/pages/revenge miniprogram/services/practice.ts miniprogram/tests/revenge-page-contract.test.mjs
git commit -m "feat: add wrong-question revenge flow"
```

### Task 3: Harden offline writes and revision conflicts

**Files:**
- Create: `miniprogram/domain/sync-coordinator.ts`
- Modify: `miniprogram/services/http.ts`
- Modify: `miniprogram/pages/practice/index.ts`
- Modify: `miniprogram/pages/revenge/index.ts`
- Test: `miniprogram/tests/sync-coordinator.test.mjs`

**Interfaces:**
- Produces: `enqueueWrite(job)`, `retryPending()`, `classifyFailure(error)`, and `resolveConflict(serverDraft, localDraft, choice)`.
- Guarantees: one in-flight write per session, stable idempotency key per logical action, and explicit conflict choice.

- [x] **Step 1: Write failing sync tests**

```javascript
test('a retry keeps the original idempotency key', async () => {
  const seen = [];
  const sync = createSyncCoordinator(async job => { seen.push(job.key); if (seen.length === 1) throw offline(); });
  await assert.rejects(sync.enqueueWrite({ sessionId: 's1', key: 'answer:q1:r3', payload: {} }));
  await sync.retryPending();
  assert.deepEqual(seen, ['answer:q1:r3', 'answer:q1:r3']);
});
```

- [x] **Step 2: Run to verify failure**

Run: `node --test miniprogram/tests/sync-coordinator.test.mjs`
Expected: FAIL because the coordinator is absent.

- [x] **Step 3: Implement serialization and user-visible states**

```typescript
export type SyncState = 'idle' | 'saving' | 'saved' | 'offline' | 'conflict';
export type ConflictChoice = 'server' | 'local';
```

Network failures retain the queue and local draft; 401 clears the mini session and routes to login; 409/revision errors fetch the authoritative session and display both saved times before applying the user's choice. Page unload attempts one final state save but never blocks navigation indefinitely.

- [x] **Step 4: Run sync and domain tests**

Run: `node --test miniprogram/tests/sync-coordinator.test.mjs miniprogram/tests/practice-domain.test.mjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add miniprogram/domain/sync-coordinator.ts miniprogram/services/http.ts miniprogram/pages/practice/index.ts miniprogram/pages/revenge/index.ts miniprogram/tests/sync-coordinator.test.mjs
git commit -m "fix: make mini practice saving resilient"
```

### Task 4: Add profile, access state, and legal entry points

**Files:**
- Create: `miniprogram/pages/profile/index.{json,wxml,wxss,ts}`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/app.ts`
- Modify: `miniprogram/services/auth.ts`
- Test: `miniprogram/tests/profile-contract.test.mjs`

**Interfaces:**
- Consumes: current-user/session, experience summary, subscription state, and mini logout endpoints.
- Produces: explicit logout; legal/privacy links; access-state messaging without payment initiation.

- [x] **Step 1: Write failing profile contracts**

```javascript
test('profile exposes identity, legal links, and logout without payment', () => {
  const page = read('pages/profile/index.wxml');
  for (const label of ['学习数据', '隐私政策', '用户协议', '退出登录']) assert.match(page, new RegExp(label));
  assert.doesNotMatch(allSource(), /requestPayment|支付开通/);
});
```

- [x] **Step 2: Run to verify failure**

Run: `node --test miniprogram/tests/profile-contract.test.mjs`
Expected: FAIL because profile is absent.

- [x] **Step 3: Implement profile and access messaging**

Show username, role, experience/level, completed sessions, and server-returned subscription plan/status. If access is denied, explain that the account must be activated on the web system; do not start WeChat payment. Logout calls the server first, then clears local token/drafts and relaunches login.

- [x] **Step 4: Run profile and authentication contracts**

Run: `node --test miniprogram/tests/profile-contract.test.mjs miniprogram/tests/foundation-contract.test.mjs`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add miniprogram/app.json miniprogram/app.ts miniprogram/pages/profile miniprogram/services/auth.ts miniprogram/tests/profile-contract.test.mjs
git commit -m "feat: add mini program learner profile"
```

### Task 5: Produce a UAT-ready release candidate

**Files:**
- Create: `miniprogram/docs/release-checklist.md`
- Create: `miniprogram/tests/release-contract.test.mjs`
- Modify: `backend/.env.example`
- Modify: `README.md`

**Interfaces:**
- Verifies: environment variables, AppID substitution, request-domain allowlist, privacy declarations, account-binding path, all four modes, weak-network recovery, and no answer leakage.

- [x] **Step 1: Write the failing release contract**

```javascript
test('release documentation names every external gate', () => {
  const doc = read('docs/release-checklist.md');
  for (const item of ['WECHAT_MINI_APP_ID', '服务器域名', '隐私保护指引', '真机', 'UAT']) assert.match(doc, new RegExp(item));
});
```

- [x] **Step 2: Run to verify failure**

Run: `node --test miniprogram/tests/release-contract.test.mjs`
Expected: FAIL because release documentation is absent.

- [x] **Step 3: Document exact configuration and acceptance cases**

Add non-secret environment keys to `backend/.env.example`; document importing the directory, replacing `touristappid` only in private/local config, setting the HTTPS API base URL, adding it to WeChat request-domain allowlists, and declaring network/account/profile data use. Acceptance cases must cover login/bind/logout, resume, single/multiple choice, bilingual/image, all modes, offline/retry/conflict, answer leakage, subscription denial, and device safe areas.

- [x] **Step 4: Run complete automated gates**

Run: `node --test miniprogram/tests/*.test.mjs`
Expected: PASS.

Run: `cd backend && .venv/bin/python -m pytest tests/ -q`
Expected: PASS.

Run: `cd frontend && pnpm test`
Expected: PASS because existing browser behavior remains compatible.

- [ ] **Step 5: Inspect and stage UAT delivery**

Import the project into WeChat Developer Tools, execute the checklist with the configured test AppID, and record exact passes/failures. Then merge the feature branch into `uat`, push with `git -c http.proxy=http://127.0.0.1:7897 push origin uat`, deploy to the UAT environment using the repository's verified deployment procedure, and stop for the user's explicit UAT decision. Do not merge `main`.

Automated evidence is recorded. WeChat Developer Tools compilation and device checks remain external gates because this host has neither the tool nor an authorized test AppID.

- [x] **Step 6: Commit documentation**

```bash
git add backend/.env.example README.md miniprogram/docs/release-checklist.md miniprogram/tests/release-contract.test.mjs
git commit -m "docs: prepare WeChat mini program UAT"
```
