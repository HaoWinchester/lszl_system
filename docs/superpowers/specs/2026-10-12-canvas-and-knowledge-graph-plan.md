# 画布与知识图谱开发计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 如用户另行选择多智能体执行，再使用 superpowers:subagent-driven-development。步骤采用 `- [ ]` 跟踪；M0／M1 已部署 UAT；用户现已授权继续完成 M2—M5 全部剩余功能，自检后只部署 UAT。

**Goal:** 完成 R01—R16，并以可追溯证据验证编辑、内容复用、题目权限与三个画布的持久化行为。

**Architecture:** 在现有原生图谱与共享画布上增量扩展，复用历史、文件、题目、订阅及发布链路。前端提取交互、线几何、临时上下文、片段、表格等职责明确的模块；后端增加 XMind 导入、图谱资源、卡片题目绑定和模板领域服务。正式文件、临时内容、卡片练习与原试卷权限分别隔离。

**Tech Stack:** 原生 JavaScript、HTML、CSS、DOM/SVG；FastAPI、SQLAlchemy async、PostgreSQL JSONB、Alembic；现有 Node 契约、pytest 及浏览器测试。不替换画布引擎，不安装无关依赖。

## Global Constraints

文档位置采用仓库可跟踪的 `docs/superpowers/specs/`，因为现有 `.gitignore` 忽略整个 `docs/superpowers/plans/`；不修改仓库忽略规则。

- 需求：[R01—R16](2026-10-12-canvas-and-knowledge-graph-requirements.md)；设计：[实现核查与 D01—D10 推荐](2026-10-12-canvas-and-knowledge-graph-design.md)。用户已授权采用推荐方案；本期实现采用 2026-10-12 设计版本。
- M0／M1 已进入实施，进度与偏差以任务清单及验证报告为准；原始 HEAD `6289fa0b`、本地 active `v9.0-p4.1.309` 为证据基线，不保证后续执行时仍相同。
- 修改前检查真实文件和仓库状态，已有未提交文档保留；不将他人工作混入任务提交。功能开发分支使用 `codex/` 前缀。
- 业务前端只改 `new-legacy/`；适配改 `frontend/scripts/new-legacy-assets/`；不直接改同步产物或 active site。
- 公共行为先扩展已有公共模块；大业务文件只接线，不复制多个版本的算法／编辑器／鉴权。
- `main`、`uat` 永久保留，不删除、不重命名、不强制覆盖。功能自检后进入 UAT；用户本人确认验收前不合入／推送 main。
- 推送必须使用命令级代理 `http://127.0.0.1:7897`，推送后核对远端引用；本轮只推送 uat，不推送 main。
- 发布由 `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser` 管理；已有浏览器验证单独执行。文件数量不一致时中止，核清文件清单和合理新增原因，不凭更高版本号继续发布。
- 正式环境部署前备份代码和 PostgreSQL，校验非空并记录 manifest；本轮不部署正式环境。
- 涉及新 ORM 写入继续采用 commit 后 refresh；多对象事务先父表 flush，再子表；迁移需要在 models/__init__.py 注册模型。
- 测试中的新接口、文件和断言是待实现的契约，不表示现在存在。新增 Alembic revision 由工具基于执行时 head 生成，禁止在计划中猜 revision ID。

## 1. 功能组与顺序

| 里程碑 | 任务 | 可验收结果 | 前置条件 |
| --- | --- | --- | --- |
| M0 基线 | T00 | 环境、既有失败、复现样本和契约冻结 | 设计采用版本明确 |
| M1 稳定交互 | T01—T04 | 输入删除、全屏浮层、背景／改色、准确匹配、清晰度与缩放保存 | M0 |
| M2 图谱编辑 | T05—T10 | 曲线手柄、固定端点、片段复制、临时会话、文字拖动、布局／主题 | M1 公共交互可用；复制图片最终联调在 T20 |
| M3 导入与资源 | T11—T12 | 图谱图片保存、两类 XMind 包导入及保真报告 | M2 的片段／布局协议已冻结 |
| M4 模板与练习 | T13—T16 | 教师关联题、学生副本练习、模板免费／会员控制 | T01 浮层、T07 片段、T11 资源 |
| M5 表格与整体验证 | T17—T20 | 三页表格、Excel 粘贴、所有数据往返和授权场景 | 共享交互及三页保存边界可用 |
| 每个里程碑的 UAT | T21、T22 | 可部署候选与用户本人验收记录 | 对应里程碑开发自检通过 |

可独立推进的工作组是职责划分，不代表本轮启动并行智能体。推荐先完成 M1 再扩大功能面；T17 纯表格模型可在 M4 期间独立编写，但 T19 界面接入必须等待 T18 保存契约。

依赖摘要：`T00 → T01 → T05 → T06 → T07 → T08`；`T01+T04 → T09`；`T06 → T10`；`T07+T10+T11 → T12`；`T11 → T13 → T14`；`T07+T11+T13 → T15 → T16`；`T17 → T18 → T19`；全部汇合到 `T20 → T21 → T22`。

## 2. 公共接口约定

以下模块名／签名为推荐新契约，实施时应先落对应任务测试，再接入调用方。

```js
// canvas/dom-interaction.js
KGCanvasDomInteraction.isEditingTarget(eventOrElement) // boolean
KGCanvasDomInteraction.overlayHost(surface) // Element，必须位于当前 fullscreenElement 内

// graph/edge-geometry.js；Point = {x:number,y:number}
KGGraphEdgeGeometry.curveHandles(start, controls, end) // [Point, Point]
KGGraphEdgeGeometry.controlsFromHandles(start, handles, end) // [Point, Point]
KGGraphEdgeGeometry.moveRoute(route, startDelta, endDelta) // 新 route，不修改输入
KGGraphEdgeGeometry.portPoint(nodeGeometry, port, oppositeCenter) // Point

// graph/graph-fragment.js
KGGraphFragment.capture(graph, selection) // GraphFragmentV1，内部边与资源引用
KGGraphFragment.remap(fragment, {idFactory, offset}) // {fragment,idMap}

// graph/graph-session.js
KGGraphSession.create({kind, graph, fileId, persist}) // session
// kind='temporary' 时拒绝远端 persist；graph 必须深拷贝。
// session 提供 getState()、replaceState(graph)、history、close()。

// canvas/text-box-geometry.js
KGTextBoxGeometry.resize(startBox, handle, delta, limits) // {x,y,width,height,fontSize}

// graph/mindmap-layout.js
KGGraphMindmapLayout.compute(graph, {rootIds,direction,scopeIds}) // {positions,treeEdges,crossEdges}

// canvas/table-model.js
KGCanvasTableModel.normalize(table) // TableV1，非法结构抛明确错误
KGCanvasTableModel.merge(table, rect) // 新 TableV1；rect={row,column,rowSpan,columnSpan}
KGCanvasTableModel.split(table, row, column) // 新 TableV1
KGCanvasTableModel.paste(table, origin, clipboardGrid) // 新 TableV1，超限／冲突不部分写入
```

新模块沿用现有 `global.KG...` 加 CommonJS 导出或 VM 加载测试模式，不引入打包器。后端服务仍接收 `db: AsyncSession` 和服务端 user；任何 `isMember`、`canAccessQuestion` 客户端布尔字段不得进入授权契约。

## 3. 任务明细

路径约定：本节前端的 `src/`、`styles/`、`tests/` 和 HTML 文件均相对 `new-legacy/`；后端路径均从 `backend/` 明确列出。提到现有模块简称时，以前文已经列出的完整文件为准。所有“新建”路径是计划产物，执行前确认没有同名公共实现。

### T00 核对基线、冻结数据契约与复现样本

**覆盖**：所有需求的基线；D10。**依赖**：无。**规模**：小。

**文件**：读取现有六个定向测试；必要时修改 `new-legacy/tests/v90-p4529-deep-recall-database-adapter.test.js`；新增验证记录 `docs/verification/2026-10-12-canvas-requirements-baseline.md`；样本放 `new-legacy/tests/fixtures/canvas-requirements/` 和 `backend/tests/fixtures/xmind/`。

**接口**：产出最终采用的设计版本、测试样本 ID、基线缺陷表；不改业务权限。

- [x] 在执行时重新记录 branch、HEAD、active 版本、相关源／active 差异；保留原始需求及附件。
- [x] 从 `new-legacy/` 运行本计划第 4 节定向命令。对 adapter 失败核对正常化后增加 `strokes` 的含义；如确属 fixture 过旧则显式期望空 strokes，并增加“非空笔迹失败后仍完整保留”的断言，不能只删 deepEqual。
- [x] 本期使用图谱交互、多选改色、全屏文字、未匹配关键词的合成可复现样本；XMind／Excel 样本随 M3／M5，尚未完成。
- [x] 用现有浏览器测试方式复现 R04、R09、R14，记录实际资源版本、点击路径、console 和截图。无法复现的保持“未复现”，不以静态猜测记为修复。
- [x] 提交仅包含必要基线测试和记录的独立提交，后续任务引用其证据。

### T01 输入焦点与全屏浮层公共入口

**覆盖**：R09、R11；支撑 R10、R12、R14、R16。**依赖**：T00。**规模**：中。

**文件**：新建 `new-legacy/src/canvas/dom-interaction.js`、`new-legacy/tests/canvas-dom-interaction.test.js`、`new-legacy/tests/graph-fullscreen-editing-browser.py`；修改 `index.html`、`question-workspace.html`、`knowledge-recall.html`、`src/20-flashcards-toolbar.js`、`src/10-graph-editor.js`、`src/graph/shared-color-picker-v2.js`、`src/canvas/94-canvas-ink.js`。

**接口**：产出 `isEditingTarget`、`overlayHost`；所有新浮层必须调用，正文输入捕获有优先级。

- [x] 增加覆盖 `contenteditable="plaintext-only"` 子元素、input、textarea、select、IME、失焦的失败用例；浏览器复现删字弹整卡确认框及全屏 nodeModal 不可见。
- [x] 实现公共输入判定，替换删除、复制、粘贴、空格平移、Escape 的重复判断；保留正常对象删除确认。
- [x] 用占位节点保留浮层原位置，全屏切换时移动真实节点，不复制 DOM；颜色窗口、笔迹文字、节点编辑窗口统一宿主，校正宿主坐标。
- [x] 验证全屏输入、滚动、保存、Esc、退出恢复，三页浮层无重复监听；验收 AC09-1/2、AC11-1/2/3。运行新 Node 测试、浏览器脚本和现有图谱交互浏览器测试。
- [x] 与共享背景／文字修复一起作为 M1 提交，避免拆分共享文件造成不完整状态。

### T02 多题背景与水滴改色

**覆盖**：R13、R14。**依赖**：T01。**规模**：中。

**文件**：修改 `src/77-multi-question-workspace.js`、`src/65-canvas-workspace-store.js`、`src/canvas/97-learning-theme.js`、`styles/learning-theme.css`、`styles/question-workspace.css`；扩展 `tests/multi-question-batch-selection-browser.py`、`tests/learning-theme-browser.py`；新建 `tests/workspace-background.test.js`。

**接口**：workspace.background 独立于 theme；颜色窗口使用 T01 宿主和按钮 DOM 锚点。

- [x] 增加“同一背景切换七种主题后配置不变”“多选点击面板后 selectionCount 不变”的断言，先验证当前失败或记录未复现差异。
- [x] 将旧 workspace 首次有效背景作为缺省值保留，theme 不再覆盖 `.qw-background` 与 `--uc-canvas-bg`；存取 background。
- [x] 按 T00 证据修复颜色面板的选区保持／事件关闭／定位；已支持的卡片与分组继续支持，混合选区按现有能力给出可理解提示。
- [x] 逐页回归主题同步，确认深度回忆主题未被连带禁用；多题保存重开后背景与卡色分别保持，覆盖全部 AC13、AC14。
- [x] 测试通过，与 T01／T03／T04 合并为同一 M1 集成提交。

### T03 关键词精确匹配与自定义根卡

**覆盖**：R15、D08。**依赖**：T00。**规模**：中。

**文件**：修改 `src/95-recall-association-library.js`、`src/86-knowledge-recall.js`、`src/recall/deep-recall-flow-model.js`；新建 `tests/recall-keyword-resolution.test.js`、`tests/recall-unmatched-custom-browser.py`；扩展现有 `tests/v90-p4529-deep-recall-database-adapter.test.js`。

**接口**：新增 `KGRecallAssociationLibrary.resolveExact(library,value)`，返回唯一命中节点或 null；自定义根卡使用现有 personal dataId／customNodes。

- [x] 测试“进度”不能自动绑定“进度基准”、同名不同候选返回 null、有效显式绑定优先、合法 concept 关联不丢失。
- [x] 为自动创建链路接入精确匹配；保留主动搜索需要的模糊 resolve，不全局删除其他页面搜索能力。
- [x] 无唯一命中生成可编辑 custom 根卡；按来源关键词复用，保存并恢复内容，历史卡牌只在用户明确转换时改变。
- [x] 对修改前后的现有自定义子卡、输入法和重置进行回归；覆盖全部 AC15，运行新测试与现有 deep-recall-flow-continuity 测试。
- [x] 测试通过，与其余 M1 修复一并提交。

### T04 文字清晰度实验及缩放保存契约

**覆盖**：R04、D10。**依赖**：T00、T01。**规模**：中至大，取决于浏览器实验。

**文件**：修改 `src/canvas/79-canvas-viewport-controller.js`、`src/graph/viewport-controller.js`、三个画布相关 CSS、`backend/app/schemas/deep_recall.py`；新建 `new-legacy/tests/canvas-text-clarity-browser.py`；扩展 `backend/tests/test_deep_recall_models.py`。

**接口**：三页有效缩放 0.01—4；后端接受同范围有限数值；viewport 世界坐标定义不变。

- [x] 新增 `RecallTransform(scale=.01)` 接受、0／负值／NaN 拒绝的测试；在三页采集字体就绪后的 DPR／倍率基线。
- [x] 先把后端缩放契约修正为 .01—4；核查 adapter 和 normalization 无二次截断。
- [x] 比较“常驻 will-change”“交互期 will-change”“2D transform”实验，选择有真实字形改善且命中／性能不回退的最小改动；记录选择依据。
- [x] 验证 1%、10%、20%、50%、100%、200%、400% 及回到 100%，普通／全屏和 DPR 1／2；极小比例按设计标准评估，不宣称每字可读。
- [x] 相关定向测试通过，与其余 M1 修复一并提交；R04 在 T09、T19 后再次纳入联调，不重复无关全量测试。

### T05 曲线上手柄与路线变换

**覆盖**：R01、D01。**依赖**：T01。**规模**：中。

**文件**：新建 `src/graph/edge-geometry.js`、`tests/graph-edge-geometry.test.js`；修改 `src/10-graph-editor.js`；扩展 `tests/graph-edge-midpoints.test.js`、`tests/graph-interaction-focus-browser.py`，在 `index.html` 注册脚本。

**接口**：`curveHandles`、`controlsFromHandles`、`moveRoute`，沿用 curveControls／waypoints 存储。

- [ ] 写纯函数往返测试：任意合法起终点与两个 controls，正反变换误差小于 1e-6；同位移后每点坐标恰好平移一次。
- [ ] 将可见手柄改为 t=1/3、2/3 位置，拖手柄反解 controls；保留自动曲线复位及折线路径。
- [ ] 多卡拖动开始捕获相关路线，一端按权重变换、两端同位移刚性变换；取消、undo／redo 恢复完整坐标和绑定。
- [ ] 运行新纯函数测试及 graph-edge-midpoints，浏览器验证 AC01 全部场景，特别是两个节点同时移动而不是只拖整线。
- [ ] 提交 `fix(graph): edit curves through on-path handles`。

### T06 固定端口及存储

**覆盖**：R02。**依赖**：T05。**规模**：中。

**文件**：修改 `src/graph/edge-geometry.js`、`src/10-graph-editor.js`、`src/00-config-state.js`、`src/graph/connection-controller.js`、`src/graph/graph-persistence.js`；新建 `tests/graph-fixed-ports.test.js`；扩展图谱交互浏览器测试。

**接口**：fromPort／toPort 为 auto/top/right/bottom/left，缺省 auto。

- [ ] 测试四边固定、圆／三角真实轮廓、旧数据缺字段、未知枚举拒绝或规范化为 auto。
- [ ] 连线工具增加两端位置选择和恢复自动；所有建立、重绑、路线快照与 sanitizer 路径保留枚举。
- [ ] 移动、改大小、长文本自动增高后仍固定同侧，重开不变；自动端口的旧避障行为保持。
- [ ] 验证全部 AC02，运行 fixed-ports、edge-midpoints、graph-kernel。
- [ ] 提交 `feat(graph): persist fixed card connection ports`。

### T07 图谱片段与跨文件剪贴板

**覆盖**：R06、D04 基础。**依赖**：T06。**规模**：中。

**文件**：新建 `src/graph/graph-fragment.js`、`tests/graph-fragment.test.js`、`tests/graph-cross-file-copy-browser.py`；修改 `src/graph/clipboard-controller.js`、`src/10-graph-editor.js`、`src/25-graph-file-tabs.js`、`src/23-graph-file-editor-store-bridge.js`。

**接口**：GraphFragmentV1、capture、remap；复制仅收选区内部线，剪贴板生命周期与文件历史分离。

- [ ] 测试两次粘贴 ID 均不同、边只引用新节点、外部边丢弃、来源不变、非法格式不粘贴。
- [ ] 片段深拷贝内容／外观／几何／新端口；切文件不清剪贴板，登出换账号清理；文本编辑优先交给原生复制粘贴。
- [ ] 支持同标签切文件及显式剪贴板事件跨标签；不依赖后台任意读取系统剪贴板。
- [ ] 用无图片样本跑全部 AC06 基础场景；新增资源在 T11、题目授权在 T16、表格在 T20 补上完整验收，不提前把整个 R06 标完成。
- [ ] 提交 `feat(graph): copy graph fragments across files`。

### T08 独立临时图谱上下文

**覆盖**：R03、D02。**依赖**：T07、T01。**规模**：大。

**文件**：新建 `src/graph/graph-session.js`、`src/graph/related-canvas-controller.js`、`tests/graph-temporary-session.test.js`、`tests/graph-temporary-canvas-browser.py`；修改 `src/10-graph-editor.js`、`src/graph/graph-renderer.js`、`src/24-graph-file-autosave.js`、`src/25-graph-file-tabs.js`、`src/20-flashcards-toolbar.js`。

**接口**：GraphSession；正式 persist adapter 不得绑定 temporary；一跳 scope 对任意非空选集有效。

- [ ] 测试多选一跳并集、孤立节点、原对象深拷贝、临时变更后服务器写请求次数始终为零、正式历史不受影响。
- [ ] 从现有 relatedCanvas 分支提取上下文控制器；将本次所需编辑操作接收当前 session，不复制整页实现、不通过换全局 state 暂停计时器来隔离。
- [ ] 打开前 flush 正式编辑与保存；失败保留原会话。关闭销毁临时历史、listeners 和资源预览 URL，保留原 fileId 与视图。
- [ ] 浏览器覆盖改文、连线、增删、移动、关闭／再开、切文件／登出；禁用临时题目入口并说明临时视图语义，覆盖 AC03 全部。
- [ ] 提交 `feat(graph): isolate editable related canvas sessions`。

### T09 文字编辑会话、失焦保存与拖边字号

**覆盖**：R12、D07；回归 R04、R11。**依赖**：T01、T04。**规模**：大。

**文件**：新建 `src/canvas/text-box-geometry.js`、`src/canvas/text-edit-session.js`、`tests/canvas-text-box.test.js`；修改 `src/graph/inline-text-editor-controller.js`、`src/graph/element-resize-controller.js`、`src/canvas/94-canvas-ink.js`、`src/00-config-state.js`、`backend/app/schemas/canvas_ink.py`；扩展 `tests/canvas-ink-text-browser.py`、`tests/canvas-text-persistence-browser.py`、`backend/tests/test_canvas_ink.py`。

**接口**：resize 的面积平方根字号公式；旧 width=字号，新增 boxWidth／boxHeight；共享编辑会话返回 draft／committed／failed。

- [ ] 添加 w0=200、h0=100、f0=20，右边拖到 w1=400 时字号约 28.284 的断言；角点宽高都加倍时字号=40；取消恢复初值。
- [ ] 先扩展后端可选字段、空文本和 6—288 字号校验，再更新前端文字工具，避免新数据被旧 schema 拒绝。
- [ ] 移除画笔文字保存／取消按钮和字号滑轨；外部点击保存，自身格式工具保持会话，IME 安全，失败草稿保留；保留画布缩放滑轨。
- [ ] 接入文本边框拖动、重新换行和内容溢出增高；一个拖动只生成一次历史操作。
- [ ] 三页逐个运行文本编辑／持久化浏览器测试、后端笔迹测试；覆盖 AC12 全部，复验 R04；提交 `feat(canvas): resize and autosave editable text boxes`。

### T10 四向布局与六套预设主题

**覆盖**：R07、D05。**依赖**：T06。**规模**：中。

**文件**：新建 `src/graph/mindmap-layout.js`、`src/graph/mindmap-themes.js`、`tests/graph-mindmap-layout.test.js`、`tests/graph-mindmap-browser.py`；修改 `src/10-graph-editor.js`、`src/00-config-state.js`、`src/graph/style-controller.js`、`src/graph/graph-model.js`、`src/19-home-toolbar-registry.js`。

**接口**：compute 返回 positions／treeEdges／crossEdges；`mindmap` 元数据不替代真实坐标与 appearance。

- [ ] 测试左右镜像、上下层级、左右子树均衡、断开分量、环和多父边；节点与边总数不变，重复布局结果一致。
- [ ] 实现尺寸驱动的稳定树布局和根节点选择；保留所有非树关系，调用 T05 变换路线。
- [ ] 用已有样式字段组合六种系统主题，预览可见；默认保护手动外观，显式覆盖才重设。
- [ ] 保存重开、undo／redo、选区／全图作用范围正确；运行全部 AC07 对应测试。
- [ ] 提交 `feat(graph): add mindmap layouts and preset themes`。

### T11 图谱图片资源及内容往返

**覆盖**：R05／R06／R08 的图片前置能力。**依赖**：T00、T07 协议。**规模**：大。

**文件**：新建 `backend/app/models/graph_asset.py`、`backend/app/services/graph_asset_service.py`、`backend/app/api/v1/graph_assets.py`、`backend/app/schemas/graph_asset.py`、`backend/app/core/image_validation.py`、`backend/tests/test_graph_assets.py`；修改 `question_material_service.py` 抽出通用字节验证、models/__init__.py、api/v1/router.py；新增 Alembic migration；前端改 graph-model、sanitizer、renderer、fragment，新增 `tests/graph-media-roundtrip.test.js`。

**接口**：`content.images=[{assetId,alt,width,height}]`；资源读取必须绑定可访问图谱／模板引用。

- [ ] 测试有效 PNG／JPEG／WebP、伪造 MIME、超 5 MiB／像素、无权引用他人 asset、合法副本图片读取、重复引用不丢失。
- [ ] 提取纯图片验证，保留题目原上传授权；新增图谱资源存储和授权，commit 后 refresh。
- [ ] 新增卡片图片／详情图片显示，接通 sanitizer、copy、保存重开及输出；导入备注不能因现有 notes 长度截断而静默损失，超限报告。
- [ ] 扩展文件组合事务内部创建函数，失败时资源／文件一起回滚；表单和列表接口不泄露资源二进制。
- [ ] 运行 graph assets、既有 question materials、graph media 往返测试后提交 `feat(graph): persist image resources for reusable content`。

### T12 XMind 解析、预览和事务导入

**覆盖**：R05、D03。**依赖**：T10、T11。**规模**：大。

**文件**：新建 `backend/app/services/xmind_import_service.py`、`backend/app/schemas/xmind_import.py`、`backend/app/api/v1/graph_imports.py`、`backend/tests/test_xmind_import.py`、`new-legacy/src/graph/xmind-import-controller.js`、`new-legacy/tests/graph-xmind-import-browser.py`；修改 api/v1/router.py、图谱文件工具入口；使用 T00 的 fixtures。

**接口**：preview(file) 不写；import(file,sheetIds,acceptedWarnings) 原子创建新文件／图片；返回每工作表结果与准确兼容报告。

- [ ] 测 JSON／XML 包、多表、图片、备注、样式、实体／损坏 ZIP、配额超限和拒绝近似导入；测试数据库不存在半导入文件。
- [ ] 使用 zipfile／JSON／XML 标准能力解析，限制真实解压大小、条目和路径；不调用 shell 解压，不执行外链。
- [ ] 按映射输出可编辑图谱，展示工作表选择、保真差异及确认；不覆盖当前图谱，创建结果可从原文件列表打开。
- [ ] 两类样本逐项核对保存重开；不支持的样式与特殊对象明确列入验收差异，不只比节点数量。
- [ ] 运行后端导入测试和浏览器 AC05 后提交 `feat(graph): import editable XMind documents`。

### T13 服务器权威卡片绑定、搜索与练习

**覆盖**：R10 后端、D06。**依赖**：T11。**规模**：大。

**文件**：新建 `backend/app/models/graph_question.py`、`backend/app/schemas/graph_question.py`、`backend/app/services/graph_question_service.py`、`backend/app/api/v1/graph_questions.py`、`backend/tests/test_graph_question_access.py`、`backend/tests/test_graph_question_attempts.py`；修改 `backend/app/models/__init__.py`、`backend/app/api/v1/router.py`、`backend/app/services/question_catalog_service.py`、`backend/app/services/question_cleanup_reference_service.py`、`backend/app/services/question_material_service.py`；新增 Alembic migration。

**接口**：Binding／Attempt 和设计 API；搜索仅教师／管理员；普通题库和 paper release 权限不增加全局 bypass。

- [ ] 先写授权矩阵：教师跨库可见、学生搜索403、非会员关联会员题可做、其他 file/node/binding/asset403或404、伪造题号无效、普通会员试卷仍拒绝。
- [ ] 核对匿名／学生的公开 catalog、普通题目详情、试卷快照、材料接口，以“仅受限发布”和“明确公开但也进入会员试卷”两类样本检查实际内容边界；发现受限内容误公开时修正相应服务，不把卡片例外扩散，也不误封原有公开题。
- [ ] 实现跨库有界分页检索与关联去重，按 expectedFileRevision 检查卡片存在／并发变更；写绑定冻结题目与材料版本。
- [ ] 提交作答调用 `question_answer_service.grade_selection` 等现有题型公共判分；requestId 唯一幂等，提交前无答案解析，提交后单独读取解析。
- [ ] 新增 attempt 记录，注册题目清理引用；源题改动不自动换卷，显式撤回绑定后新请求拒绝，旧记录保留。
- [ ] 用隔离测试数据库运行新用例及 test_question_catalog、test_paper_releases、test_question_materials，确认原链路未放宽后提交 `feat(graph): authorize card-scoped question practice`。

### T14 图谱题目抽屉与教师关联界面

**覆盖**：R10 前端。**依赖**：T01、T13。**规模**：中至大。

**文件**：新建 `new-legacy/src/graph/question-drawer-controller.js`、`new-legacy/styles/graph-question-drawer.css`、`new-legacy/tests/graph-question-drawer-browser.py`；修改图谱详情入口和 index.html；复用 `src/117-question-answer-set.js`、`src/119-question-analysis.js`、`src/118-question-materials.js` 的通用呈现，必要时提取现有公共函数。

**接口**：抽屉只持有 fileId/nodeId/bindingId；通过 T13 接口取得 authorized view，禁止回退到公开 catalog 的全量答案载荷。

- [ ] 写角色浏览器用例：教师无题时搜索并添加、有题继续加；学生没有搜索／维护入口。
- [ ] 实现标题预填、关键词补充、学科筛选、分页多选、已关联状态与去重；未确认勾选不提前写入。
- [ ] 支持完整题干／图片、单选多选匹配等已有题型、作答和解析；失败不显示为无题，切卡取消旧请求，避免结果串卡。
- [ ] 全屏抽屉可用、窄屏不挡关键关闭／提交入口，覆盖全部 AC10 和 AC09-3。
- [ ] 提交 `feat(graph): add linked-question learning drawer`。

### T15 模板目录、发布、版本和加载

**覆盖**：R08、D04。**依赖**：T07、T11、T13。**规模**：大。

**文件**：新建 `backend/app/models/graph_template.py`、`backend/app/schemas/graph_template.py`、`backend/app/services/graph_template_service.py`、`backend/app/api/v1/graph_templates.py`、`backend/tests/test_graph_templates.py`，在 `backend/app/models/__init__.py`、`backend/app/api/v1/router.py` 注册并新增 migration；新建 `new-legacy/src/graph/template-center-controller.js`、`styles/graph-template-center.css`、`tests/graph-template-center-browser.py`；修改 `src/20-flashcards-toolbar.js` 的 templateModal 入口及 index.html。

**接口**：GraphTemplate＋不可变 Version；合法加载生成私有 GraphFile 和受控关联副本，返回新 fileId。

- [ ] 写管理员／教师发布、学生拒绝、有效期套餐／终身／过期、免费／会员加载矩阵；会员预览不含完整正文和答案。
- [ ] 发布时从真实 sourceFile 读取图谱、资源和绑定，去除临时选择／视口以外的学习个人状态，不相信客户端附带关联；更新产生新版本，无审核状态。
- [ ] 加载事务生成新文件、ID映射、资源授权和题目绑定；同 requestId 不重复创建。新旧模板版本和加载副本互不回写。
- [ ] UI 提供浏览、预览、免费／会员标记、发布／更新／下架；不再默认覆盖当前图谱。未开通用户明确提示，已加载副本沿用设计授权时机。
- [ ] 运行 test_graph_templates、订阅授权回归与浏览器全部 AC08；提交 `feat(graph): publish and load versioned templates`。

### T16 片段、模板与练习授权继承闭环

**覆盖**：R06、R08、R10 组合。**依赖**：T07、T13—T15。**规模**：中。

**文件**：新增 `backend/app/services/graph_fragment_service.py`、`backend/tests/test_graph_fragment_grants.py`、`new-legacy/tests/graph-template-practice-browser.py`；修改 files.py、file_service.py、graph-fragment.js、clipboard-controller.js 及 T13/T15 服务。

**接口**：POST files/{fileId}/fragments；有来源的绑定由服务端读 sourceRevision 并重映射，客户端授权字段忽略。

- [ ] 教师发布含会员题的免费模板→非会员学生加载→卡片抽屉作答解析→普通会员试卷仍不可访问，执行完整真实 API 流程。
- [ ] 学生复制已授权卡片到另一私有图谱：继承原绑定题目、不能附加题号；sourceRevision 不匹配回409、无权来源拒绝。
- [ ] 服务器与浏览器使用同一明确 ID 映射输入／结果；粘贴内容、绑定和文件 revision 在一次事务成功，失败无半完成节点。
- [ ] 检查撤销／重做不会伪造新授权：恢复已有、仍有效的同 ID 绑定；只有服务端受控复制才能创建新绑定。明确撤回后 redo 不恢复权限。
- [ ] 运行新 grants 测试和组合浏览器测试后提交 `feat(graph): preserve scoped grants in trusted copies`。

### T17 共享表格模型与剪贴板解析

**覆盖**：R16 数据规则、D09。**依赖**：T00。**规模**：中。

**文件**：新建 `new-legacy/src/canvas/table-model.js`、`src/canvas/table-clipboard.js`、`tests/canvas-table-model.test.js`、`tests/canvas-table-clipboard.test.js`；后端新建 `backend/app/schemas/canvas_table.py`、`backend/tests/test_canvas_table.py`。

**接口**：TableV1 和 normalize／merge／split／paste；JS／Python 共享相同测试样本及上限语义。

- [ ] 明确 table 字段、cell 坐标、合并矩形与空格表示；准备含中文、空尾列、引号换行和 rowspan／colspan 的固定样本。
- [ ] 实现纯模型、合并行优先内容保留、拆分和冲突判断；任何修改返回新对象，异常不污染原表。
- [ ] HTML 只读取安全文本和行列跨度，TSV 处理引号与换行；不执行脚本、公式或外部资源。
- [ ] 测试 5000 格／20000 格限额、非法重叠、超长文本、粘贴合并冲突、失败原表 deepEqual 不变。
- [ ] 运行 Node 两组及 Python schema 用例后提交 `feat(canvas): model editable tables and spreadsheet paste`。

### T18 三页表格持久化与历史

**覆盖**：R16 保存。**依赖**：T17。**规模**：中。

**文件**：修改 `new-legacy/src/00-config-state.js`、`src/graph/graph-persistence.js`、`src/65-canvas-workspace-store.js`、`src/99-deep-recall-server-adapter.js`、`src/86-knowledge-recall.js`、`src/77-multi-question-workspace.js`；修改 `backend/app/models/training.py`、`backend/app/schemas/deep_recall.py`、`backend/app/services/deep_recall_service.py`、`backend/app/services/learning_service.py`、`backend/app/services/file_service.py`；新增 migration 和 `backend/tests/test_canvas_table_persistence.py`、`new-legacy/tests/canvas-table-adapters.test.js`。

**接口**：graphData.tables／payload.tables／RecallProgress.tables；默认 []，三页共同 schema 校验。

- [ ] 先测试空旧记录、非空合并表往返、越权保存拒绝、revision 冲突、回忆重置清空、取消重置保留。
- [ ] 深度回忆增加 JSONB 列及 request／response／reset 字段；多题与图谱入口调用同一 table 校验器。
- [ ] 前端 snapshot、恢复和失败草稿保留 tables，独立正式／临时历史不串数据；新增列迁移需旧数据库升级验证。
- [ ] 运行三页 adapter 和后端持久化测试，确认未知字段不再被剔除、无回写旧字段损失。
- [ ] 提交 `feat(canvas): persist tables across graph and learning workspaces`。

### T19 三页表格工具与直接编辑

**覆盖**：R16 UI。**依赖**：T01、T04、T17、T18。**规模**：大。

**文件**：新建 `src/canvas/table-controller.js`、`styles/canvas-table.css`、`tests/canvas-table-browser.py`；修改 `src/canvas/94-canvas-ink.js` 工具入口、`src/canvas/95-home-canvas-tools.js`、两学习页适配器及三个 HTML 脚本注册。

**接口**：controller 通过 getTables／change／history／getViewport／isReadonly／overlayHost 接入，不直接请求业务 API。

- [ ] 测三页同一入口：3×3 插入、选行列、输入、四边缩放、单列宽／行高、整体拖动。
- [ ] 实现 DOM table 与编辑焦点，接 T17 合并／拆分／粘贴，格式面板按 T01 全屏宿主显示。
- [ ] 只读禁写，表格编辑 Delete 不删整表，Excel 粘贴到格及空画布都正确；合并／粘贴各为一次历史操作。
- [ ] 三页分别保存重开，复核正常／全屏和 DPR 下清晰度；临时相关画布表格可改但关闭丢弃，覆盖 AC16 全部。
- [ ] 提交 `feat(canvas): add shared editable table tools`。

### T20 导出、完整复制与跨功能回归

**覆盖**：全部需求交叉边界。**依赖**：T01—T19。**规模**：中至大。

**文件**：修改 `new-legacy/src/21-home-package-service.js`、`src/26-graph-export-service.js`、`src/graph/graph-fragment.js`、模板快照和资源打包入口；新增 `new-legacy/tests/canvas-feature-roundtrip.test.js`、`new-legacy/tests/canvas-feature-roundtrip-browser.py`；新增交付验证记录。

**接口**：全部已支持字段在学习包／副本／模板往返保留；导出 JSON 中的绑定 ID 不产生可导入授权。

- [ ] 创建一个包含固定端口、手工曲线、图片、长备注、主题、独立文字、表格及会员题关联的图谱作为完整 fixture。
- [ ] 依次验证保存重开、跨文件复制、模板加载、导出再导入，比较图形内容与服务器授权；离线包不携带可伪造会员权限或用户练习记录。
- [ ] 在复制、模板中补齐图片／表格；学习包加入资源二进制条目读取，保持旧 JSON／ZIP 兼容，不能把 XMind 和自有包格式混用。
- [ ] 覆盖图谱切换、登出换账号、失败重试、undo／redo、临时内容零回写；三个页面逐一跑 AC04、AC12、AC16。
- [ ] 运行第 4 节完整检查，登记每条 AC 的结果及证据；提交 `test(canvas): verify reusable content and scoped practice end to end`。

### T21 里程碑候选构建、合入及部署 UAT

**覆盖**：发布纪律。**依赖**：对应里程碑测试通过；最终候选还需 T20。**规模**：小至中。

**文件**：仅仓库现有发布脚本管理的同步产物、manifest、sync report、seed／版本及验证报告；不手工覆盖 site。

- [ ] 核对功能分支修改范围、永久分支 main／uat 均存在；合并前记录回退提交，审计脏文件不丢有效修改。
- [ ] 运行 `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser` 及已计划的专项浏览器检查；检查 candidate 与 active 文件数、完整清单、关键页面，遇差异先中止核实，不强行 promote。
- [ ] 按仓库流程合入 uat，用 `git -c http.proxy=http://127.0.0.1:7897 push origin uat` 推送，并核对远端提交。
- [ ] 使用现有 `deploy/update-uat.sh` 部署，核对公网版本与关键资源哈希、API／数据库及实际页面；记录未验证项，不把健康接口成功算业务验收。
- [ ] 为每个里程碑交付可访问 UAT 地址、版本、变更与验收清单；不得推送 main 或删除功能分支。

### T22 用户业务验收与后续集成门禁

**覆盖**：用户验收。**依赖**：T21。**规模**：取决于用户反馈，不估算为开发工时。

- [ ] 用户本人在 UAT 按对应里程碑 AC 清单验收，记录明确的通过／未通过结论。
- [ ] 未通过项回到对应任务修复、自检和 UAT 复测；智能体不得自行勾为通过。
- [ ] 未获“验收通过”或“可以合入 main”时保持 UAT 状态；本任务不包含自动推广正式环境。
- [ ] 获得明确授权后才执行 main 集成和按需正式发布；正式部署先完成代码／数据库备份。功能分支与工作树仅在有效修改已集成、main／uat 完整后清理。

## 4. 验证命令与执行上下文

### 4.1 已执行的基线命令

从 `new-legacy/` 执行，避免部分旧测试依赖相对 cwd：

```sh
node --test tests/graph-edge-midpoints.test.js tests/v90-p420-graph-kernel.test.js tests/multi-question-batch-selection.test.js tests/canvas-ink.test.js tests/v90-p4512-deep-recall-flow-continuity.test.js tests/v90-p4529-deep-recall-database-adapter.test.js
```

已知失败与实际执行顺序见设计文档第 1.3 节；本计划没有声称上面这一组目前全绿。

### 4.2 新测试命令约定

- 下表是新增测试文件建立后的定向入口。Node 命令从 `new-legacy/` 执行，Python 命令从 `backend/` 执行；创建前不应把“文件不存在”误记为业务失败。
- 后端连接隔离测试数据库，不在正式库创建 fixture；每项任务列出的旧回归也必须保留。
- 浏览器先阅读对应现有脚本的 CLI／fixture 方式；用户要求的跨页业务验收统一用 agent-browser 实际操作，每页保留角色、URL、版本和结果，已有浏览器脚本作为自动回归补充。
- 用例必须断言业务结果，不只检查源码包含字符串。视觉清晰度须保留实际截图，授权必须有直接 API 负向用例。

| 任务 | 定向命令 |
| --- | --- |
| T01 | `node --test tests/canvas-dom-interaction.test.js` |
| T02 | `node --test tests/workspace-background.test.js tests/multi-question-batch-selection.test.js` |
| T03 | `node --test tests/recall-keyword-resolution.test.js tests/v90-p4512-deep-recall-flow-continuity.test.js` |
| T04 | `.venv/bin/python -m pytest tests/test_deep_recall_models.py -q` |
| T05 | `node --test tests/graph-edge-geometry.test.js tests/graph-edge-midpoints.test.js` |
| T06 | `node --test tests/graph-fixed-ports.test.js tests/graph-edge-midpoints.test.js tests/v90-p420-graph-kernel.test.js` |
| T07 | `node --test tests/graph-fragment.test.js` |
| T08 | `node --test tests/graph-temporary-session.test.js` |
| T09 | `node --test tests/canvas-text-box.test.js tests/canvas-ink.test.js`；`.venv/bin/python -m pytest tests/test_canvas_ink.py -q` |
| T10 | `node --test tests/graph-mindmap-layout.test.js` |
| T11 | `node --test tests/graph-media-roundtrip.test.js`；`.venv/bin/python -m pytest tests/test_graph_assets.py tests/test_question_materials.py -q` |
| T12 | `.venv/bin/python -m pytest tests/test_xmind_import.py -q` |
| T13 | `.venv/bin/python -m pytest tests/test_graph_question_access.py tests/test_graph_question_attempts.py tests/test_question_catalog.py tests/test_paper_releases.py tests/test_question_materials.py -q` |
| T15 | `.venv/bin/python -m pytest tests/test_graph_templates.py tests/test_subscription_entitlements.py -q` |
| T16 | `.venv/bin/python -m pytest tests/test_graph_fragment_grants.py -q` |
| T17 | `node --test tests/canvas-table-model.test.js tests/canvas-table-clipboard.test.js`；`.venv/bin/python -m pytest tests/test_canvas_table.py -q` |
| T18 | `node --test tests/canvas-table-adapters.test.js`；`.venv/bin/python -m pytest tests/test_canvas_table_persistence.py -q` |
| T20 | `node --test tests/canvas-feature-roundtrip.test.js`，随后运行下方完整检查 |

T14、T19 以相应任务中明确列出的浏览器脚本和实际三页操作为主要新增验证。浏览器脚本启动参数在实现时沿用相邻已验证脚本及隔离服务器 fixture，不在尚未创建脚本时编造 CLI 参数。

最终从仓库根目录分别执行：

```sh
git diff --check
cd frontend && pnpm test
cd frontend && pnpm test:design
cd backend && .venv/bin/python -m pytest tests/ -q
```

上述每行的 `cd` 命令独立从根目录开始，不在一个 shell 中顺序粘贴造成嵌套目录。

### 4.3 核心断言样例

以下是应写进对应任务测试的确定断言，夹具与加载方式采用仓库已有测试模式。

```js
// T05：输入点换算、旧曲线保真。
const start = {x: 0, y: 0}, end = {x: 300, y: 120};
const controls = [{x: 80, y: -40}, {x: 200, y: 190}];
const handles = KGGraphEdgeGeometry.curveHandles(start, controls, end);
const restored = KGGraphEdgeGeometry.controlsFromHandles(start, handles, end);
restored.forEach((point, i) => {
  assert.ok(Math.abs(point.x - controls[i].x) < 1e-6);
  assert.ok(Math.abs(point.y - controls[i].y) < 1e-6);
});

// T09：宽度变化同时改变字号，不能退化成只改框。
const box = KGTextBoxGeometry.resize(
  {x: 0, y: 0, width: 200, height: 100, fontSize: 20},
  'e', {x: 200, y: 0}, {minFontSize: 6, maxFontSize: 288}
);
assert.equal(box.width, 400);
assert.ok(Math.abs(box.fontSize - 20 * Math.sqrt(2)) < 0.01);
```

```python
# T04：服务端范围和前端一致。
assert RecallTransform(scale=0.01).scale == 0.01
assert RecallTransform(scale=4).scale == 4
with pytest.raises(ValidationError):
    RecallTransform(scale=0)
```

对 T13／T16 的 API 测试，必须在同一组 fixture 中创建非会员学生、教师图谱、学生加载副本及另一张未授权会员题；依次断言授权题提交成功、其他题读取失败、替换 fileId 失败、重复 requestId 不重复记分、普通试卷订阅门禁仍失败。不得只 mock 成“用户已授权”跳过核心链路。

## 5. 工作量与不确定性

- 小任务：T00；里程碑发布的实际耗时受环境影响。
- 中任务：T01、T02、T03、T05、T06、T07、T10、T16、T17、T18。
- 大任务：T08、T09、T11、T12、T13、T15、T19；T04、T14、T20 视实测情况为中至大。
- 不提供未经验证的交付日期。主要不确定性来自真实 XMind 保真样本、文字模糊复现、图谱图片新链路及跨文件授权传播；先执行 T00／T04 样本实验可以明显缩小范围。
- 每个任务完成时记录代码、测试和证据，再推进依赖任务；不靠一次超大提交或最后统一补测试交付。

## 6. 完成定义

开发完成要求需求映射全覆盖、测试和异常场景有结果、所有新增数据可往返、权限负向用例通过、UAT 版本可核查。业务完成另需用户本人验收。任务完成勾选见独立任务清单，不以本文出现代码或测试样例代表实现已完成。
