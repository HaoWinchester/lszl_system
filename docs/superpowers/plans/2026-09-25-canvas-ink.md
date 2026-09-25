# Canvas Ink Implementation Plan

> **For agentic workers:** Use subagent-driven-development for bounded backend work and reviews; root implements shared controller and page integration. Track steps here.

**Goal:** 深度回忆和多题画布提供能保存恢复的画笔与荧光笔，并评审线上反馈。
**Architecture:** 共享笔迹模型/控制器加 SVG 世界坐标层；页面适配已有保存和历史入口；后端校验并持久化 strokes。
**Tech Stack:** 原生 JavaScript、SVG、FastAPI、Pydantic、SQLAlchemy、PostgreSQL。

## Global Constraints
- 仅两类笔；颜色与粗细可调。笔迹固定世界坐标，不随卡片布局移动。
- 画笔 width 1–24，荧光笔 width 4–48；各自默认 3 和 16；荧光笔 opacity .3。
- 笔迹模型：{id, tool, color, width, points:[[x,y], ...]}。最多 2000 笔、单笔最多 5000 点、总点数最多 100000；坐标有限且绝对值 <= 10000000；id 非空不重复且 <= 100 字符；color 为六位十六进制。
- readonly 禁止写入。数据库为唯一持久数据源；保留失败重试和冲突检测。
- 正式发布遵循现有 release 脚本；仅合入并部署 UAT，等待用户验收。

### Task 1: Backend stroke persistence
Files: create backend/app/schemas/canvas_ink.py; modify schemas/deep_recall.py, models/training.py, services/deep_recall_service.py, services/learning_service.py; create Alembic migration and tests/test_canvas_ink.py; extend tests/test_recall_progress_api.py and tests/test_learning_workspace.py.
Interface: validate_strokes(value) -> list[dict] validates common wire model. RecallProgressSaveRequest.strokes defaults []; RecallProgress.strokes JSONB defaults []; recall payload returns strokes; reset clears strokes. Workspaces validate payload.strokes when present, preserve legacy absence.
- [ ] Write tests: valid stroke round trip, malformed tool/color/width/coordinates, duplicate id, resource limits, omitted strokes compatibility; real API persistence, owner isolation, recall reset/conflict.
- [ ] Run tests first and record expected failure; implement validator, schema, migration and service integration.
- [ ] Run focused pytest then full backend suite; commit only owned files and report migration/testing evidence.

### Task 2: Shared ink model and controls
Files: create new-legacy/src/canvas/94-canvas-ink.js, new-legacy/styles/canvas-ink.css, new-legacy/tests/canvas-ink.test.js.
Interface: KGCanvasInk.normalize(strokes) -> cloned validated strokes; KGCanvasInk.path(points) -> SVG path; KGCanvasInk.create({viewport,world,toolbarHost,getViewport,getStrokes,setStrokes,isReadonly,history,onError}) -> {render,cancel,setTool,destroy}. getViewport returns {x,y,scale}; setStrokes(strokes) changes current page data and saves. history optionally supplies push({label,undo,redo}); otherwise controller owns KGCanvasHistoryController instance.
- [ ] Add behavior tests for invalid data, coordinate mapping and serialization; run red.
- [ ] Implement SVG paths with round caps and per-stroke opacity; requestAnimationFrame updates only active path; simplify sampling and bound point count.
- [ ] Implement select/pen/highlighter buttons, color swatches + custom color, width range with preview, undo/redo where no existing history UI, clear with confirmation. Use unique per-instance IDs and accessible labels.
- [ ] Draw with primary pointer only, capture pointer, cancel on pointercancel/lost capture/context switch; avoid clicking card on stroke end. Escape selects, temporary space/right-button pan delegates existing page. Input controls never hijacked. Prevent drawing on overlaid UI.
- [ ] Run shared unit tests; commit.

### Task 3: Both page adapters and durable workflows
Files: knowledge-recall.html, question-workspace.html; src/86-knowledge-recall.js, src/99-deep-recall-server-adapter.js, src/65-canvas-workspace-store.js, src/77-multi-question-workspace.js; relevant adapter/store tests.
- [ ] Extend recall adapter tests showing strokes disappear before implementation; add strokes to graph normalize/read/save and page progressPayload/load/reset.
- [ ] Include shared script/styles on both pages before page initialization; bind controller after viewport setup. Add explicit edit guards to existing drawing-conflicting gestures. Readonly/config changes render controller.
- [ ] Workspace uses store.write and existing kernel history; switching workspace cancels stroke and clears history. Recall uses controller history per question and clears when question changes.
- [ ] Browser test both pages with real pointer actions: pen/highlighter, width/color, zoom alignment, card input conflict, undo/redo, clear cancel/confirm, refresh recovery, readonly, canceled pointer, failed-save retry.
- [ ] Run relevant tests and commit.

### Task 4: Feedback review, regression and UAT
- [ ] Read all feedback using authorized admin session; omit credentials/contact details from report; distinguish reproduction from hypotheses, do not reply or change status.
- [ ] Run frontend pnpm test and pnpm test:design; backend full tests; inspect screenshots and real persistence in both pages.
- [ ] Review whole feature diff, fix actionable findings, rerun relevant checks; record test results and unresolved limitations.
- [ ] Release using manage-new-legacy update; compare active/candidate file counts with expected added assets and verify key pages. Merge feature into uat without discarding unrelated changes; push through current-command proxy and verify remote ref; deploy using update-uat.sh and verify health/assets.
- [ ] Stop at UAT awaiting user business acceptance. Preserve main/uat branches.
