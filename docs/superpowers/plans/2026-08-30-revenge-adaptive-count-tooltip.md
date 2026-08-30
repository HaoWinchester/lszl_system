# Revenge Adaptive Count And Rules Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make revenge mode use its own adaptive batch size, show the complete deduplicated pool, and explain its rules through an accessible tooltip.

**Architecture:** Add a small page-level policy module that converts the server-owned `revengeStats.active` count into stable revenge batch options. The practice page consumes that policy independently from ordinary paper counts, while existing session APIs and server ranking remain authoritative. The tooltip is static explanatory content with hover, focus, click, outside-click, and Escape behavior implemented in the existing practice page controller.

**Tech Stack:** Native HTML/CSS/JavaScript, Node test runner, Playwright Python browser tests, FastAPI-backed practice APIs, existing new-legacy sync/release tooling.

## Global Constraints

- `new-legacy/` is the authoritative frontend source; generated `frontend/public/new-legacy/` changes only through the sync script.
- Do not change challenge or scholar count behavior.
- Revenge counts come from the server-deduplicated `revengeStats.active` pool.
- A new revenge session sends no `paperId` or `releaseId`.
- Existing resumable revenge sessions are never silently abandoned.
- One revenge session contains at most 180 questions.
- Publish only to UAT; do not deploy production.

---

### Task 1: Revenge Count Policy

**Files:**
- Create: `new-legacy/src/118-revenge-entry-policy.js`
- Test: `frontend/scripts/revenge-entry-policy.test.mjs`

**Interfaces:**
- Consumes: `activeCount: number`, optional `selectedCount: number`.
- Produces: `KGRevengeEntryPolicy.derive(activeCount, selectedCount)` returning `{ total, automatic, selectedCount, requestCount, options }`, where each option is `{ value, label, disabled, kind }`.

- [ ] **Step 1: Write failing count-policy tests**

Cover `active=0`, `active=1`, `active=10`, `active=14`, `active=29`, and `active=200`. Assert that counts up to 10 are automatic, 14 defaults to 10 with disabled 20 and enabled all-14, 29 allows 10/20/all-29, and 200 caps the full-session option at 180.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd frontend && node --test scripts/revenge-entry-policy.test.mjs`

Expected: FAIL because `new-legacy/src/118-revenge-entry-policy.js` does not exist.

- [ ] **Step 3: Implement the minimal pure policy module**

Export a frozen browser API and CommonJS test API. Normalize counts to non-negative integers, keep only `10`, `20`, and the capped full option, preserve a valid selected value, and otherwise default to `10` for pools above 10.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `cd frontend && node --test scripts/revenge-entry-policy.test.mjs`

Expected: all policy cases pass.

- [ ] **Step 5: Commit**

```bash
git add new-legacy/src/118-revenge-entry-policy.js frontend/scripts/revenge-entry-policy.test.mjs
git commit -m "feat: add adaptive revenge count policy"
```

### Task 2: Revenge Card UI And Tooltip

**Files:**
- Modify: `new-legacy/practice-mode.html`
- Modify: `new-legacy/styles/practice-mode.css`
- Modify: `new-legacy/src/100-practice-mode.js`
- Modify: `frontend/scripts/practice-learning-contract.test.mjs`

**Interfaces:**
- Consumes: `KGRevengeEntryPolicy.derive()`, `KGPracticeLearningApi.stats()`, and active-session payloads.
- Produces: `#practiceRevengeActiveCount`, four status counters, `#practiceRevengeCountOptions`, `#practiceRevengeRuleTrigger`, and `#practiceRevengeRuleTooltip`.

- [ ] **Step 1: Add failing static contract tests**

Require the page to load `src/118-revenge-entry-policy.js` before `src/100-practice-mode.js`, render an accessible rules trigger/tooltip, render the active total and `verificationDue` counter, and render a revenge-only count container. Require the controller to call the policy and to build revenge input from its `requestCount`, not `state.selectedCount`.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `cd frontend && node --test scripts/practice-learning-contract.test.mjs`

Expected: FAIL on missing revenge policy, tooltip, full counters, and independent request count.

- [ ] **Step 3: Implement the card markup and styling**

Place an icon-only rules button immediately after the `复仇模式` heading. Add tooltip text for global scope, `question_id` dedupe, eligible states, priority order, and adaptive count. Add `可复仇 N 题`, four status chips, and a revenge-only count option group. Keep the card responsive and ensure the tooltip stays within the viewport on mobile.

- [ ] **Step 4: Implement controller behavior**

Add `state.revengeSelectedCount`, derive policy from `stats.active`, render options, update the new-session button label, and make `practiceEntryInput('revenge')` use the derived `requestCount`. Bind option changes and tooltip hover/focus/click/Escape/outside-click behavior. Let `syncResumableButtons()` override the new-session label with `继续上次复仇 已答/总数` when needed.

- [ ] **Step 5: Run the contract test and verify GREEN**

Run: `cd frontend && node --test scripts/practice-learning-contract.test.mjs scripts/revenge-entry-policy.test.mjs`

Expected: all focused contracts pass.

- [ ] **Step 6: Commit**

```bash
git add new-legacy/practice-mode.html new-legacy/styles/practice-mode.css new-legacy/src/100-practice-mode.js frontend/scripts/practice-learning-contract.test.mjs
git commit -m "feat: clarify adaptive revenge entry"
```

### Task 3: Browser Behavior And UAT Release

**Files:**
- Modify: `new-legacy/tests/practice-answer-sheet-browser.py`
- Modify: `new-legacy/VERSION`
- Generated by sync: `frontend/public/new-legacy/`, `frontend/new-legacy-manifest.json`, `frontend/new-legacy-sync-report.json`, `backend/app/seed/guided_course_v8_6_0.json`

**Interfaces:**
- Consumes: rendered revenge card, mocked global overview/session APIs, release manager.
- Produces: user-level proof for adaptive counts, tooltip interactions, request payloads, retry, and resumable labels.

- [ ] **Step 1: Add failing browser assertions**

Extend the existing browser harness to prove: active 1 sends count 1 despite ordinary count 60; active 14 defaults to 10 and can switch to all 14; 20 is disabled for 14; active 29 can select 20; hover/focus/click reveal the rule tooltip and Escape closes it; a failed start restores the button; a resumable revenge session shows the explicit progress label.

- [ ] **Step 2: Run the browser test and verify RED**

Run: `python3 new-legacy/tests/practice-answer-sheet-browser.py`

Expected: FAIL on the first missing adaptive-count or tooltip assertion.

- [ ] **Step 3: Make only integration corrections needed by the browser test**

Adjust DOM bindings, event order, or label rendering without changing the approved policy. Keep all data database-backed through the existing adapter.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
python3 new-legacy/tests/practice-answer-sheet-browser.py
cd frontend && pnpm test
cd ../backend && .venv/bin/python -m pytest tests/ -q
```

Expected: browser PASS, frontend full suite green, backend full suite green.

- [ ] **Step 5: Build and commit release `v9.0-p4.1.189`**

Run:

```bash
cd frontend
pnpm sync:new-legacy
node scripts/manage-new-legacy.js update ../new-legacy --skip-browser
```

Commit authoritative and tracked generated changes with `release: publish adaptive revenge entry`.

- [ ] **Step 6: Deploy and verify UAT only**

Use `deploy/update-uat.sh` semantics, splitting the long local validator if the host's three-minute command ceiling requires it. Verify UAT health, public `data-release`, core asset SHA-256, container active pointer, migration head, the revenge browser interaction, and unchanged production version/container ID.

