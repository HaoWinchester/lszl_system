# 个人学习工具反馈 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for task implementation and task-scoped review. Steps use checkbox syntax. Current directory is retained per repository instructions; work on codex/learning-tool-feedback, never main. Only one implementation subagent runs at a time; the controller may work on disjoint files.

**Goal:** 实现已澄清的分享定位、图谱/模板/画布交互及答题页轻量化，自检后部署 UAT；大厅本次不改。

**Architecture:** 保留原生页面、同源 FastAPI、现有持久化/历史/权限。共享图谱几何、画笔文字、浮层入口统一修复；模板新增服务端受控预览投影，前端只读渲染与导航；答题页样式限定在 game 视图。

**Tech Stack:** 原生 HTML/CSS/JS；FastAPI、SQLAlchemy async、PostgreSQL；Node test、pytest、现有 Playwright 浏览器脚本。

## Global Constraints

- 用户最新指示：大厅暂不改；选卷、科目、模式卡片、大厅帮助保持当前实现，概念图只作存档。答题页与大厅在同一 HTML 时只改 game 区及文档分享元信息。
- 修改权威源 new-legacy/ 或 frontend/scripts/new-legacy-assets/；不手改 generated/public、release/site。
- 只在当前工作区写入；不装无关依赖；功能分支 codex/learning-tool-feedback。
- 跨页能力修改现有共享模块，不复制变体。保持后端 owner/role/会员隔离，不用浏览器存储替代数据库。
- 原始设计 docs/superpowers/specs/2026-10-18-learning-tool-feedback-design.md 中大厅设计延后，其余范围已获实施授权。
- 正式发布只用 manage-new-legacy update；核对 active 与候选文件清单和关键页面。只部署 UAT；用户验收前禁止合入/推送 main；保留 main/uat。
- git push 只用命令级代理 http://127.0.0.1:7897，并核对远端引用。

### Task 1: 图谱工具栏、几何、点击层叠与缩放

**Files:** new-legacy/src/10-graph-editor.js、src/graph/edge-geometry.js、mindmap-themes.js、viewport-controller.js、node-toolbar-controller.js；styles/home-graph-components.css、unified-canvas-runtime.css、home-canvas-performance.css；tests/graph-edge-geometry.test.js、graph-mindmap-layout.test.js、graph-mindmap-browser.py 及新定向浏览器测试。
**Interfaces:** 沿用 KGGraphEdgeGeometry/GraphKernel 与历史 checkpoint/restore；必要的 midpoint/segment 几何纯函数统一从 edge-geometry.js 导出。不得改 template-center-controller、related-canvas-controller 或共享 ink 文件（其他任务负责）。
- [x] 添加能失败的几何用例：短距离中段拖动仍绑定端点、对称分支、折线段轴向/重叠与原形恢复；运行 node --test new-legacy/tests/graph-edge-geometry.test.js。
- [x] 复现现有 UI：1源2个向右对称节点；线中部小位移；选中框覆盖工具栏命中；记录实际根因。
- [x] 增量实现中点主手柄、折线段中点拖动及快捷线型切换；保留显式端点解除绑定；重复线可选择；每手势一次撤销，取消恢复。
- [x] 思维导图面板按短工具条+方向/主题小弹层收紧；高级根节点/手工样式保护折叠；保留原 data-mm-* 入口并更新真实浏览器用例。
- [x] 修复蓝框装饰和工具栏的 stacking/pointer 命中；验证缩放/全屏/多选。
- [x] 缩放期间不做全图重绘，必要清晰化延迟至停稳且仅必要目标；记录同数据前后指标，不仅看 diagnostics 常数。
- [x] 定向 Node/真实浏览器验证，报告行为、指标、未复现项；提交只包含本任务文件。

### Task 2: 回忆文字与画笔交互

**Files:** new-legacy/src/canvas/94-canvas-ink.js、text-box-geometry.js、text-edit-session.js、styles/canvas-ink.css、src/graph/related-canvas-controller.js（仅临时画布画笔接入）；tests/canvas-text-box.test.js、canvas-ink-text-browser.py、canvas-ink-controller-browser.py、graph-temporary-canvas-browser.py。
**Interfaces:** 保留 KGCanvasInkController.create/getViewport/persistText/isInside/reset/destroy；复用 KGTextEditSession 的草稿和异步失败恢复，不在 UI 编辑期间提前 commit。
- [x] 先测短文本、删行、字号/缩放后的自然尺寸；例：单行 24px 文本的初始框不得保留 100px 高下限，删除多余换行可缩短。
- [x] 编辑框测量真实内容，用户显式换行保留；边框拖动保持 focus/selection/IME 与草稿；Esc 恢复，失败仍可重试。
- [x] 画笔面板右端增加真实关闭入口，统一退出到选择态，清理手势；右键遵循现有策略且可退出。
- [x] 临时画布空白绘画、文字、关闭/右键取消走同一共享实现；只读禁止写入，关闭不把临时笔迹写回正式文件。
- [x] 绘画状态下卡片 hover/选中装饰稳定，无红框阴影闪烁。
- [x] 跑共享单测和真实浏览器，涵盖编辑保持拖动、删行、保存失败、临时空白、只读；报告并提交本任务文件。

### Task 3: 分享标题与干净图谱入口

**Files:** new-legacy/landing.html、index.html、practice-mode.html（仅 title/meta）；backend/app/web/routes.py；现有 web 路由测试与 new-legacy/tests/landing-page-contract.test.js，新增分享契约。
**Interfaces:** 官网 / 保持 landing；/graph 直接返回图谱 HTML，沿既有 bootstrap 与权限逻辑提供，旧 /index.html 继续可用；保留 fileId/mode/auth 参数语义。
- [x] 添加 source HTML 分享元信息测试：title/og:title/og:description 不含做题/刷题；真实页面内部做题导航保留。
- [x] 添加 /graph 直接 200、不跳到 index.html、bootstrap 正确、fileId/auth 仍由前端消费的后端路由测试。
- [x] title/og 文案用“个人学习工具｜知识图谱与主动回忆”，描述“用知识图谱、笔记与主动回忆，构建自己的知识体系。”；canonical/og:url 指向官网 / 或 /graph，练习页使用真实页面 URL。
- [x] 复用现有页面直出封装，避免复制鉴权/bootstrap；定向 Node 与后端路由测试。

### Task 4: 模板图形预览

**Files:** backend/app/services/graph_template_service.py、api/v1/graph_templates.py 与现有模板测试；new-legacy/src/graph/template-center-controller.js、新职责明确的 preview renderer/controller、styles/graph-template-center.css、index.html script 入口；tests/graph-template-center.test.js、graph-template-center-browser.py。
**Interfaces:** 现有 GET /api/v1/graph-templates/{id} 返回 summary 及受控 preview（版本、卡片标题/几何/配色、允许的连线），不包含原始 graphData、题目/答案、备注、学习记录或不受控图片 URL。加载仍使用原 POST loads。
- [x] pytest 先验证登录/下架/维护者边界，投影字段白名单，题目答案/notes/个人数据和不可信样式不会泄露；读预览不创建文件。
- [x] 服务端从当前模板版本 graph_payload 构建白名单投影，有限数值/长度/数量及纯文本；沿现有权限，不信任客户端预览快照。
- [x] 列表缩略图与独立详情预览使用同一个只读 renderer；拖动画布、按钮/滚轮缩放、适应视图、全屏/退出、关闭后取消异步请求，错误可重试。
- [x] 原加载副本/会员限制/幂等不变；预览不复用可写正式编辑器，关闭不污染当前 state。
- [x] 补 Node 和隔离 PostgreSQL 浏览器测试，真实点图、缩放、拖动、全屏、关闭重开、下架/失败与加载副本验证。

### Task 5: 答题页轻量化（大厅冻结）

**Files:** new-legacy/practice-mode.html game 区、styles/practice-mode.css game-scoped CSS、src/100-practice-mode.js（仅答题卡入口/状态）、tests/practice-answer-sheet-browser.py 与前端设计契约。
**Interfaces:** 保留 #practiceAnswerSheetMobileBtn、#practiceAnswerSheetDrawer、进度/保存原 ID 和控制器；主入口移到 game 下 fixed 圆形按钮，aria-expanded/controls 和可读计数保持；drawer 默认 hidden。
- [x] 先补浏览器断言：默认收起、圆形浅色入口、桌面与390px 不遮下一题、打开/关闭/跳题/交卷可达。
- [x] 图标圆形入口使用现有 layout-grid，视觉计数缩小但保留可访问状态；移除重复答题卡入口并保留侧栏其他功能。
- [x] game 进度细化、顶栏/保存控件收紧；失败重试与冲突提示保持显著；复仇交卷提示更新位置文字。
- [x] 大厅 section 字节与源 baseline 一致（除文档 head 元信息）；任何新增 CSS 均不影响 lobby。运行答题卡、实时反馈、四模式续练及设计契约。

### Task 6: 集成、复查、发布 UAT

**Files:** new-legacy/VERSION、生成产物、docs/verification/2026-10-18-learning-tool-feedback-uat.md；不可变 release 由管理脚本生成。
- [x] 汇总每任务证据，任务审查及全分支复查，修复全部重要发现。
- [x] pnpm --dir frontend test 与 test:design；backend/.venv/bin/python -m pytest backend/tests/ -q；相关真实浏览器场景在隔离 DB 跑完。
- [x] 源/同步/候选文件清单核对，检查 admin-console 等关键页，无缺失旧文件；执行 node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser，浏览器验证单独完成并保留日志。
- [x] 提交同步生成产物；合入 uat（不丢已有内容），代理 push 并 ls-remote 核对；执行 bash deploy/update-uat.sh，公网版本/资源 hash/游客页面冒烟。
- [x] 记录准确版本、部署提交、测试数量和真实限制；停止等待用户 UAT 验收，main 不合入不推送。
