# Task 2 — 回忆文字与画笔交互

日期：2026-10-18。实现位于 `codex/learning-tool-feedback` 当前共享工作区。未修改大厅、后端、模板、练习、VERSION 或 release；同步生成物留给主任务统一处理。

## 改动与原因

- `new-legacy/src/canvas/94-canvas-ink.js`：新文字不再初始化为 100px 高；每次测量先清除旧高度，以 textarea 当前排版高度更新草稿，保存时以当前实际行数重算高度。已有旧大框重新编辑后也会缩小。测量排除 placeholder，避免空框被帮助文字撑高。显式换行和自动折行继续保留。
- 新增四边透明拖动命中区，移动同一个 textarea 对应的世界坐标草稿；pointerdown 阻止默认聚焦变化，未通过输入框失焦或 commit 来实现拖动。保留 selection/composition；拖动不写正式数据；坐标作为编辑会话版本的一部分，旧保存响应不能关闭新位置草稿。现有文字位置先复制，Esc 不会修改原始对象的 points。
- 工具条右端加入可访问的关闭 X。关闭清理未完成手势、空格平移及绘图态，隐藏工具条并返回选择态。有文本草稿时继续使用现有异步保存入口，失败保留草稿和工具条以重试。
- `new-legacy/src/graph/related-canvas-controller.js`：临时画笔命中包含整个 viewport，修复变换后的 stage 外空白不能写画；从共享控制器同步开关状态，保证 X 后可一次重新打开；编辑框的原生文字/IME/Esc/Ctrl+Enter 由共享编辑会话处理。局部 ink 数组及关闭丢弃保持原样；只读入口继续不创建画笔。
- `new-legacy/styles/canvas-ink.css`：提供编辑框四边拖动命中样式；多题画布绘画态去掉会变化的卡片阴影及过渡，保留已有选择边界和退出绘画后的红色 hover 提示。
- 扩充四个既有真实浏览器脚本，复用原有测试与数据库隔离 helper。`text-box-geometry.js`、`text-edit-session.js` 的公共接口和行为直接复用，无须修改。

## 红灯证据

1. 新增单行断言在修复前失败：24px 字号、2x 缩放时 textarea 高 210px。
2. 关闭按钮断言在修复前失败：不存在 `关闭画笔工具` 按钮。
3. 临时画布扫描真实 viewport 空白并落笔，修复前应有 1 条 path，实际为 0。
4. 桌面真实多题页面绘画态 hover 检查失败：非 hover 阴影为 `0px 2px 8px`，hover 变为紫色 `0px 18px 52px`，虽然红框已被已有规则隐藏。
5. 补充空草稿断言失败：长 placeholder 将 2x 空编辑框撑到 204px；排除 placeholder 测量后通过。

## 验证结果

- `node --test new-legacy/tests/canvas-text-box.test.js new-legacy/tests/canvas-ink*.test.js new-legacy/tests/graph-temporary-session.test.js`：27/27 通过。包括线格式校验、文字几何、composition/旧响应、失败重试、切换保存栅栏与临时会话隔离。
- `node --test frontend/scripts/canvas-text-box.test.mjs`：公共入口包装检查通过。
- `python3 new-legacy/tests/canvas-ink-text-browser.py`：通过。真实 Chrome 中验证空/短文本、显式删行缩短、2x 缩放坐标、编辑态边框拖动保留 focus/selection/composition、无提前提交、保存后紧凑高度、已有旧大框缩小、Esc 恢复内容和位置、失败关闭保留草稿、四边缩放及撤销、只读。
- `python3 new-legacy/tests/canvas-ink-controller-browser.py`：通过。关闭 X 取消未完成笔迹、返回选择/隐藏、重开，保留画笔/荧光笔/橡皮擦、颜色、撤销、空格平移、控件命中、只读及手机工具条边界等既有检查。
- `python3 new-legacy/tests/canvas-text-persistence-browser.py --base-url http://127.0.0.1:5227`：home / recall / workspace 三页全部通过。真实本地隔离 API 中验证自然高度与删行、编辑态位置/选区、文字格式、原生删除、IME 延迟提交、面积缩放撤销/重做、真实服务端写失败保留及重试、数据库读取和 reload、换行与空文本撤销。桌面 recall/workspace 额外比较绘画态 hover 前后阴影和边界保持相同。
- `python3 new-legacy/tests/graph-temporary-canvas-browser.py --base-url http://127.0.0.1:5227`：通过。包含新增 viewport 空白笔迹、文字及 Ctrl+Enter、双右键退出、X 关闭/重开、阅读态无画笔无写入；保留 AC03 卡片/边/详情、撤销、手机、正式保存失败/新草稿恢复、切文件与退出登录检查。临时操作未发正式业务写请求，主图数据、视口、历史及文件隔离断言通过。
- `python3 new-legacy/tests/canvas-ink-browser.py --base-url http://127.0.0.1:5241`：31 项通过。5241 经 lsof 确认为空闲后启动独立 helper，仅使用临时数据库。覆盖 workspace/recall 绘画、触屏、右键、取消、缩放、PNG、API/reload、切换隔离、失败重试、橡皮擦、viewer/readonly、重置及异步保存切换栅栏。
- `pnpm --dir frontend sync:new-legacy`：成功；仅用于本地测试 fallback，无 promote。
- 任务所属文件 `git diff --check -- <七个源/测试文件>`：通过。全局 diff 检查看到另一任务生成的 `frontend/public/new-legacy/styles/answer-page.css` 113–114 行空白，已通知主任务，未越权修改。

## 边界

浏览器使用系统 Python 3 的 Playwright 和真实本地 Google Chrome。IME composition 状态通过 DOM CompositionEvent/KeyboardEvent 驱动；没有声称覆盖真人操作 macOS 输入法候选窗口。宽度保持既有可换行框与显式缩放规则，本任务主要修复高度、拖动编辑连续性及画笔退出。未运行全仓后端/前端总套件，交由主任务集成验证。未构建/发布 UAT，未做用户业务验收。

测试截图位于 `artifacts/uat-canvas-text-fixes/`、`artifacts/canvas-m2-m5/t08/`、`artifacts/canvas-m2-m5/t09/`、`artifacts/canvas-ink/`；独立 helper 日志位于 `artifacts/task-2-server.log`。产物和日志未纳入本任务提交。
