# Mini Spekra Growth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task. User approved the design and implementation in this session.

**Goal:** Deliver a polished four-tab practice mini program and trustworthy daily growth tracking to UAT.

**Architecture:** Keep existing practice/session APIs and mini-program architecture. Record deduplicated effective answers and frozen daily targets transactionally in a dedicated backend service. Render summaries through shared mini services and domain helpers.

**Tech Stack:** FastAPI, SQLAlchemy async/PostgreSQL, Alembic, native WeChat TypeScript/WXML/WXSS, Node tests.

## Global Constraints
- Work only in this feature worktree; do not install unrelated dependencies.
- Preserve main and uat. Stop after UAT deployment pending user acceptance; no production or public WeChat release.
- Default daily goal 10; selectable goals 5/10/20/30; changes effective next Asia/Shanghai day; history and today targets immutable.
- Count each owner/date/source-question once, only after valid server-side saved answers; wrong answers count too. Failed requests, replay events and duplicates do not count.
- Current streak may end today or yesterday; longest streak unlocks 7/30/100 milestones. No fabricated pre-launch check-ins.
- All business records use PostgreSQL and owner isolation. Keep existing roles/subscriptions, all question types, save/exit/resume, reports, revenge and cross-client sync compatible.
- Warm white/deep green/orange visual system; retain dark mode, large reading fonts and accessible touch targets. Self-authored graphics only.
- Bottom tabs 首页 / 练习 / 成长 / 我的; history remains reachable under growth and profile.
- Tests cover actual handlers, persistence, failures, boundary dates, retries and navigation; do not weaken existing behavior assertions to hide regressions.

### Task 1: Transactional growth API and accounting
**Files:** create backend/app/models/practice_growth.py, backend/app/services/practice_growth_service.py, backend/app/schemas/practice_growth.py, backend/app/api/v1/practice_growth.py, one Alembic migration, backend/tests/test_practice_growth.py; modify models/__init__.py, api/v1/router.py and the authoritative practice answer-save service.
**Interfaces:** GET /api/v1/learning/practice/growth returns date, timezone, today {answered, goal, completed}, configuredGoal, goalEffectiveDate, currentStreak, longestStreak, totalCompletedDays, week [{date, answered, goal, completed, isToday}], milestones [{days, unlocked}]. PUT same path /goal with {goal: number} returns the same summary. `record_answers(db, owner, question_ids, now)` participates in caller transaction, never commits independently; use stable source question IDs. Expose summary helper for deterministic date tests.
- [ ] Write meaningful API/service tests first, covering unauthed denial, owner isolation, empty default, invalid goals, next-day change, exact midnight Shanghai rollover, wrong-answer credit, duplicate retry/same question new session, invalid-save rollback, streak across month/year/gaps, PC+mini entry parity, server-only event guard, and concurrency of duplicate requests.
```python
assert summary['today'] == {'answered': 0, 'goal': 10, 'completed': False}
assert len(summary['week']) == 7
assert [x['days'] for x in summary['milestones']] == [7, 30, 100]
# Re-saving the same accepted answer must not increase growth.
assert after_retry['today']['answered'] == after_first['today']['answered']
```
- [ ] Run .venv/bin/python -m pytest tests/test_practice_growth.py -q and record expected missing-feature failures.
- [ ] Implement dedicated owner-keyed settings, day snapshots and daily answer uniqueness with PostgreSQL upsert and appropriate owner/day serialization. Target updates freeze today's old goal before changing future configuration. Derive streak/weekly summaries from persisted daily rows using ZoneInfo('Asia/Shanghai'). Do not trust client timestamps or arbitrary LearningEvent submissions.
```python
local_day = now.astimezone(ZoneInfo('Asia/Shanghai')).date()
# One logical credit per (owner_id, local_day, question_id); all writes
# share the transaction which validates and stores the practice answer.
```
- [ ] Create/check migration using project Alembic workflow, run targeted tests, run adjacent practice and experience tests; record results and commit task files only.

### Task 2: Four-tab mini program and Spekra-inspired experience
**Files:** modify miniprogram/app.json, app.wxss, styles/tokens.wxss, domain/appearance.ts, domain/primary-tabs.ts, domain/navigation.ts, custom-tab-bar/*, components/ui-icon/*, pages/home/*, pages/papers/*, pages/profile/* and relevant reading/setup/result/history/revenge/login/membership/appearance styles; create pages/growth/*, services/growth.ts, domain/growth-view.ts and tests/growth.test.mjs plus affected tests.
**Interfaces:** consume Task 1 GET growth and PUT growth/goal. Export getGrowthSummary() and updateGrowthGoal(goal), typed with backend response. Use shared view formatting for home/growth, not duplicate calculations. Four tabs map home, papers, growth, profile; papers must use switchTab and preserve requested mode through a documented transient route mechanism. History is a secondary page with back action.
- [ ] Add failing handler tests for growth loading/error/retry, goal saving/failure and next-day notice, milestone/weekly formatting, home resume vs start and growth failures not hiding practice, four-tab navigation and mode propagation. Existing tests must be updated to approved navigation/visual requirements while retaining behavior coverage.
```javascript
assert.deepEqual(PRIMARY_TABS.map(x => x.label), ['首页', '练习', '成长', '我的']);
// Failed goal save leaves the previous server-derived summary visible and retryable.
assert.equal(page.data.summary.configuredGoal, 10);
```
- [ ] Establish warm near-white background (#f8f7f2 family), forest main surfaces (#174d3b family), orange primary action with readable dark label, mint secondary emphasis, consistent rounded cards and line icons. Draw simple learning-progress artwork using native layout/CSS or self-authored SVG, not third-party assets. Maintain dark and text-size variants via existing appearance system.
- [ ] Implement homepage hierarchy: greeting and goal chip, short learning headline, rich green continue/start card plus complementary wrong-question card, goal progress and real statistics, recent papers. No fake recommended content/counts.
- [ ] Promote paper catalog to 练习 tab with subject/search and mode selector; implement 成长 page goal picker, today's progress, seven-day calendar, current/longest streak, milestones and links to history/report flows. Profile compact identity card and grouped functional rows; reading UI large clean question surface and persistent accessible actions.
- [ ] Use semantic loading/error/empty states, loading/disabled buttons and real API handlers. New page actions obey existing login/permission/access behavior. Preserve mixed matching/case/image rendering and all practice lifecycle behavior.
- [ ] Run node --experimental-strip-types --test miniprogram/tests/*.test.mjs; capture and review rendered screenshots where environment permits; fix all regressions and commit task files only.

### Task 3: Integration verification, review and UAT
**Files:** docs/verification/2026-09-15-mini-spekra-growth.md, generated web manifest/release files only if release tool requires them; test/deploy artifacts stored under artifacts/spekra-growth.
**Interfaces:** completed Tasks 1 and 2; existing deploy/update-uat.sh and mini preview/upload scripts.
- [ ] Independent whole-branch review of spec/quality, repair actionable issues and re-review fixes.
- [ ] Run backend .venv/bin/python -m pytest tests/ -q, frontend pnpm test and pnpm test:design, mini npm test. Exercise home->practice->save/exit->resume->report->growth, goal save/retry, history back, membership and logout through real handlers and developer-tool UI as available. Verify new API under actual session identity and wrong-owner requests.
- [ ] Verify active UAT release source hashes/file inventory and use existing release validator with full verification when deployment requires it; do not overwrite newer web source from stale release. Snapshot UAT code/database before deploying schema change and verify nonempty manifest/archive/dump.
- [ ] Merge clean feature branch into uat, push with command-local http.proxy=http://127.0.0.1:7897 and verify remote refs. Run deploy/update-uat.sh and verify API, migrations, active release and public UAT health. Use existing mini UAT preview/experience workflow if configured; never publish production mini release.
- [ ] Record exact tested counts, screenshots/evidence, UAT version and any unavailable device checks. Keep feature branch/worktree through user UAT acceptance.
