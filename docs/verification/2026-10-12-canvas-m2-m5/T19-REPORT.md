# T19 — implementation report (2026-10-13)

## Implemented

- 共享控制器 `new-legacy/src/canvas/table-controller.js`（`KGCanvasTableController.create`）：
  - world 内渲染真实 DOM table（绝对定位 x/y，宽=列宽和/高=行高和，随各页 world transform 平移缩放坐标一致；1px 边框+真实文字，无位图，DPR 清晰）。
  - 单元格 `contenteditable="plaintext-only"` 直接编辑（中英文/换行，3000 字符上限截断提示）；Tab 跨格；编辑态 keydown/paste 全部 `stopPropagation`，画布快捷键与 Delete 不误删整表/底层卡片（cell 内粘贴：表格结构优先按表格粘贴，普通文本 `insertText` 纯文本插入）。
  - 选中：点击起始格 + Shift 点击终点格（`selectionRect` 自动扩展覆盖相交合并区）；合并/拆分/删除表格/撤销/重做面板随表格挂 world（面板字号按 1/scale 反向补偿；画布 fullscreen 宿主内天然可见，无需 overlayHost 挂载）。
  - 整体拖动（movebar）、四边 resize（e/w 等比列宽、n/s 等比行高，n/w 同步平移 x/y，min 28px/行列）、列边界拖宽、行边界拖高；拖动过程直写、pointerup 一次 `mutate` 进历史（单次撤销），pointercancel 回滚。
  - 粘贴：`KGCanvasTableClipboard.parseClipboardData` → `model.paste`（超限/冲突整体拒绝并中文提示）；选中起始格粘贴（合并锚点解析）；空画布表格状数据（>1 格）新建表，普通句子不建表。
  - 插入面板：10×10 悬停网格（1-10）+ 数字输入（max 100 行×50 列，`clampGridCount`），挂 `KGCanvasDomInteraction.mountOverlay(overlayHost)`（T01 全屏宿主），插入点取页面记忆指针世界坐标并钳制进可视区（否则视口中心）。
  - 历史三态：`options.change(next,label)` 页面自管（图谱 checkpoint/run）；`options.history` 命令栈 push {undo,redo}（多题 kernel）；都无则内部命令栈+面板按钮+Ctrl/⌘+Z capture 接管（回忆页，`undoKeyDelegated` 供多题页让位）。label=null 为单元格输入轻量写入（不进历史，页面负责防抖持久化）。
  - 写入前逐表 `model.normalize` + 画布 20000 格预算校验，非法拒绝写入并 `onStatus` 提示（后端 422/400 不会收到非法数据）；`isReadonly` 时禁写/禁插/手柄隐藏/单元格不可编辑（`refreshControls` 即时生效）。
- 三页接入：
  - 图谱：`95-home-canvas-tools.js` 创建 `KGHomeTables`（change→`ensureGraphHistoryController().run(label,…)+save()`；`getLastWorldPoint` 用 `lastGraphPointerWorldPosition`；isReadonly=`canWriteGraph()`）；`10-graph-editor.js` render() 接 `KGHomeTables.sync()`；**graphUndoSnapshot/applyGraphHistorySnapshot 补 tables**（T18 缺口，否则表格操作无法撤销）；`19-home-toolbar-registry.js` 新增 `addTableBtn`（图标+efficient 模式白名单+editGraph 权限），`20-flashcards-toolbar.js` 注册 `insertTable` action。
  - 多题：`77-multi-question-workspace.js` 创建 `KGWorkspaceTables`（setTables→65 store `write({...workspace,tables})`，history=kernel.history + `undoKeyDelegated`），`activateWorkspace` renderCards 后 `tablesController.render()`；`question-workspace.html` 新增 `qwTableBtn`；测试用 `activeWorkspace()` 往返。
  - 回忆：`86-knowledge-recall.js` 创建 `KGRecallTables`（setTables→`state.tables=…;saveProgress()`，内部历史+面板按钮+Ctrl/⌘+Z），`renderAll()` 接 sync，deep_recall `clearTransient` 追加 `tableController.reset()`（临时会话关闭丢弃）；`startCanvasPan`/dblclick 守卫加 `.kg-canvas-table-wrap`；`knowledge-recall.html` 新增 `krTableBtn`；isReadonly=`isRecallReadonly()||isTeacherDraftPreview()`。
- 样式 `new-legacy/styles/canvas-table.css`：层级/边框/选中高亮/编辑态/拖拽把手（1/scale 反向补偿恒定屏幕大小）/面板/插入网格；三 HTML 引用 + `homepage-bundles.json` 登记（home-shell 加 css、home-graph 加 table-clipboard.js【补登记】+ table-controller.js）。
- 测试：
  - `new-legacy/tests/canvas-table-ui.test.js`（Node）：selectionRect 合并扩展、scaleSizes 等比+钳制、clampGridCount/isTabularGrid、LIMITS 与 model 对齐、三页 HTML+bundles 注册契约、控制器无业务 API 请求断言；登记进 `frontend/scripts/canvas-table.test.mjs` wrapper。
  - `new-legacy/tests/canvas-table-browser.py`（Playwright chrome，--base-url）：图谱页完整流程（插入 3×3→中英文输入→退格删字不删表→整体拖动→四边等比缩放→列边界拖宽→合并两格内容换行拼接→Excel native 样本 HTML 粘贴到起始格逐格全等（对 expected.json）→单次撤销分层（先撤粘贴再撤合并）→重做→服务端落库→刷新重开全保留）；空画布粘贴建 5×4 表+普通句子不建表；多题页（干净工作区插入 2×3、编辑、合并、kernel Meta+Z 单次撤销/重做、刷新重开保留）；回忆页（member 正式会话插入/编辑/面板撤销重做/刷新重开保留/kr-readonly 禁写禁插）。

## Test commands & results

- `node --test frontend/scripts/canvas-table.test.mjs` → 4/4 pass（model、clipboard、adapters、新 UI 契约）。
- `python3 new-legacy/tests/canvas-table-browser.py --base-url http://127.0.0.1:5195`（helper `graph_template_server.py` 已按规程启动/kill -TERM，自身 fixture 库 `kg_pytest_8091_*` 已随退出删除，已确认无残留）→ **PASS**（全程无 pageerror）。
- `python3 new-legacy/tests/canvas-table-clipboard-browser.py` → PASS（T17 回归）。
- `node --check` 全部改动 JS → OK；`node frontend/scripts/sync-new-legacy.js` → v9.0-p4.1.311 同步成功；`git diff --check` → OK。
- 回归：`homepage-bundles`（2）、`design-contract`（5）、`new-legacy-release`（21）、`new-legacy-validation-cache`（22）全部 pass。
- 截图：`artifacts/canvas-m2-m5/t19/{graph-table-edited,graph-table-pasted,graph-empty-paste,qw-table,kr-table}.png`。

## Deviations from brief（以现状为准）

1. **图谱撤销快照补 tables**：T18 只通了持久化，`graphUndoSnapshot/applyGraphHistorySnapshot` 未含 tables；本任务补齐，否则“合并/粘贴单次撤销”在图谱页不成立。旧快照无 tables 字段时保持现状不清空。
2. **格式面板挂 world 而非 overlayHost**：表格工具面板随表格渲染在 world 内（画布全屏目标是 stage 的祖先，面板天然在全屏宿主内），仅插入选择面板挂 overlayHost。与 brief 字面不同，但满足 T01 全屏宿主要求且免面板跟随缩放/平移的同步成本。
3. **编辑格内的 Excel 表格 HTML 按表格粘贴**（非文本）：D09“编辑格内常规文本粘贴优先”中“常规文本”解释为非表格结构剪贴板；Excel 复制的表格区域即使光标在格内也按 AC16-3 走表格粘贴路径。
4. **Delete 键不提供“删除整表”**：删除走面板“删除表格”按钮（confirm+可撤销）；点击单元格即进入编辑态，Delete 始终是文本编辑语义，杜绝误删。
5. **回忆页只读测试用 `kr-readonly` class**（与服务端 `canWrite=false` 同一判定路径 `isRecallSessionReadonly()`）模拟，未构造独立的只读服务端会话。

## Scope & limitations / 已知遗留

- 临时相关画布（T08 related-canvas）：其临时会话是独立渲染器，本就不渲染/不回写 tables，正式图谱 tables 不会被动到——“可改但关闭丢弃”在该画布中按现状自然满足，未单独实现 UI（如需在临时画布内编辑表格，属后续任务）。
- 单元格 contenteditable 用 `plaintext-only`（Chrome/Edge/Safari 17+），旧 Firefox 降级为只读展示；浏览器测试以 chrome channel 验证。
- 缩放清晰度：表格为真实 DOM 文字，随 transform 缩放与卡牌/文本框同一清晰度机制，未单独做 1%–400% DPR 截图矩阵（D10 全局任务覆盖）。
- 移动端触屏（coarse）未做专项浏览器验证；把手有 touch-action:none，行为上可用但未断言。
- 残留 `kg_pytest_*` 库 19 个属于其他仍在运行的本地 server（5183/5199/5174 等其它任务会话），未代为 DROP，避免破坏并行任务。
- 未覆盖：粘贴超限（>100×50）浏览器级断言（Node 层 model/`clampGridCount` 已测拒绝路径）；行边界拖拽与列边界同一代码路径，浏览器断言只做了列宽。

## Commit

- `03014f1c feat(canvas): add shared editable table tools`（15 文件，仅 new-legacy 源/测试 + homepage-bundles 登记 + wrapper；frontend/public/new-legacy 生成产物保持未暂存，由正式发布流程统一提交）。

## Independent review & fixes (2026-10-13)

审查结论（4 项需修复）→ 全部关闭，修复提交 `71904a04 fix(canvas): keep multi-table history and paste semantics correct`：

- **C1 多表数据丢失（Critical）**：merge/split/paste/拖动 pointerup 原来调 `mutate([单表])`，applyTables 整组替换会静默删掉多表画布的其它表并持久化。修复：新增 `withTableReplaced(table,replacement)`，四处全部改为按 tableId 的整集合 map 替换，兄弟表原对象不动。
- **M1 拖动/缩放撤销空操作**：pointermove 直写绕过历史，pointerup 时 getTables() 已是拖后位置，undo 回不到拖前。修复：`mutate` 增加 `before` 参数；pointerup 用 `session.original` 构造拖前整集合快照。三态历史适配：图谱（checkpoint 型）先 `applyTables(previous,null)` 写回拖前状态再走 `change(next,label)`，使 `history.run` 捕获到拖前快照；命令栈型（kernel/内部）直接以 `previous` 构造 undo 命令。pointercancel 回滚逻辑不变。
- **M2 多题页撤销不重绘 DOM**：`undoLayout/redoLayout` 只动 kernel 栈，表格层无重绘入口。修复：77 的 undo/redo 在命令成功后调用 `state.tablesController?.sync?.()`。顺带修掉 sync 的深层缺陷：原实现缓存 `lastSignature`，撤销恢复出与缓存相同的 JSON（如合并前恰是输入后的状态）时会漏重绘；改为把**渲染时签名**记在 `layer.dataset.kgTableSignature`，sync 只在「DOM 落后于数据」时重建（页面 render 循环的零开销跳过语义保留）。
- **M3 粘贴劫持**：doc capture 监听在表格选中时接管一切粘贴，1×1 纯文本也写格并拦截页面语义。修复：capture 监听只接管 `isTabularGrid`（≥2 格）数据，1×1 纯文本/图谱片段放行页面气泡处理器（卡牌复制→Ctrl/⌘+V 主路径回归验证）。
- **Minor**：单元格 `input` 增加 `isComposing` 组词保护，新增 `compositionend` 统一提交（IME 中间态不入库）；`commitCellText` 提取为共享函数。77 拖动 pointermove 直写未加节流（store 写为同步轻路径，与卡牌拖动同量级，暂不加）。

### 补充浏览器断言（全部通过）

- 两表画布：拖动 B（+260/+160）A 位置不动；B 上合并，A 内容/合并区不变；撤销 B 合并后 A 合并保留（C1）。
- 拖动后撤销回拖前：图谱页 Meta+Z 断言 B 恢复到拖前坐标且 A 仍在；回忆页面板撤销断言坐标回拖前（M1，三态中两态直证，多题页 kernel 命令栈与内部栈同构、由 M2 DOM 断言间接覆盖 undo 生效）。
- 多题页撤销/重做后 DOM 重绘：`[colspan]` 数量 1→0→1（M2）。
- 表格选中状态下复制卡牌→Ctrl/⌘+V：节点数增加、片段 JSON 未写入单元格（M3）。

### 复核命令与结果

- `python3 new-legacy/tests/canvas-table-browser.py --base-url http://127.0.0.1:5195` → **PASS**（含全部新增断言；helper 服务器已 kill -TERM，fixture 库 `kg_pytest_8091_*` 确认删除）。
- `node --test frontend/scripts/canvas-table.test.mjs` → 4/4；`python3 new-legacy/tests/canvas-table-clipboard-browser.py` → PASS；`node --check` 改动 JS → OK；`node frontend/scripts/sync-new-legacy.js` → v9.0-p4.1.311；`git diff --check` → OK。

### 提交链

- `03014f1c feat(canvas): add shared editable table tools`
- `71904a04 fix(canvas): keep multi-table history and paste semantics correct`（scoped：table-controller.js / 77-multi-question-workspace.js / canvas-table-browser.py）

## Independent review & fixes（续）

- 首轮审查：C1（merge/split/paste/拖动 mutate([单表]) 覆盖整个集合——多表画布静默丢表，阻断级）、M1（拖动撤销空操作——三态历史都拿到拖后快照）、M2（多题页撤销不重绘 DOM）、M3（表格选中时 capture 粘贴劫持页面语义）。
- 71904a04：四处改 withTableReplaced 按 tableId 整集合替换；mutate 带 before（拖前快照），图谱 checkpoint 型先 applyTables(previous,null) 再 change；undoLayout/redoLayout 后 sync()，sync 签名改记 layer.dataset.kgTableSignature（根治"撤销恢复相同 JSON 漏重绘"，图谱页同益）；doc capture 仅 isTabularGrid 接管；cell input 补 isComposing；补四组浏览器断言。
- 复审：**通过，可合入**（审查员自建 DOM 桩 39+ 断言 + 实跑浏览器全链路 PASS；图谱 checkpoint 无额外历史项、dataset 签名自洽、反劫持断言覆盖）。
- 遗留（不阻断）：77 拖动 pointermove 逐事件 store 写（量级与卡牌一致）、粘贴超限/行边界拖拽无浏览器断言、TSV 引号未闭合提示噪音。
- 提交链：03014f1c → 71904a04。
