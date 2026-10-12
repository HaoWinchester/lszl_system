# T02 背景与水滴改色

范围：R13/R14；源文件局部修改，无 commit / 发布 / 分支切换。

## 诊断证据

- 原版普通模式：真实点击水滴能创建颜色窗口，真实色块能给两张卡改色，选区仍为 2；因此普通模式“完全无反应”没有复现。
- 原版窗口实际 `position:static`、宽度 1440；页面未加载颜色窗口所属样式。全屏状态真实色块点击被 `.qw-world` 拦截。浏览器命中证据已交 T01，父任务提取公共颜色窗口样式并补加载。`T02-fullscreen.png` 为最后 GREEN 截图（286×494，absolute，z-index 72，实际命中色块）。
- 委托 click 的 `currentTarget` 是整个 `qwSelectionToolbar`，而非水滴按钮；锚点断言在旧版失败。
- 旧版主题切换到 parchment 后背景渐变变化；旧文档保存 ocean 的首次加载在最初方案下变成默认灰底，迁移断言失败并修正。
- 色块实时提交后，关闭颜色窗口再次提交同色会制造只有时间戳改变的历史记录，导致首次撤销看似无效；组颜色撤销浏览器断言捕获，增加幂等判断。

## 实现

- `workspace.background` 独立保存 appearance、表面网格墨色与渐变层，旧文档初始为 null，首次有效显示捕获后持久化。
- 旧主题背景 CSS 仅在尚未捕获背景时生效。先应用已保存学习主题，再捕获有效背景，最后锁定文档背景；七种学习主题继续装饰卡片和学习壳层，深度回忆保持原逻辑。
- 设置菜单调整颜色或点/网格/纯色仍走现有公共 appearance controller，同时更新活动文档背景。切换旧文档首次捕获前清除上个文档内联背景。
- 水滴按实际按钮定位，继续通过现有颜色选择器与 T01 全屏宿主保持选区；同色重复提交不增加撤销步骤。
- 依父任务要求键盘输入判断使用共享 DOM interaction 模块并传入事件，包含 IME 状态。
- 依 T04 对照试验去掉 `.qw-world` 永久 will-change:transform，未改变变换实现。

## RED / GREEN

- `node --test new-legacy/tests/workspace-background.test.js`：RED 3（旧默认 undefined、第二文档 undefined、非法原始值未归一化）；GREEN 3。
- 新真实服务器浏览器测试：RED 错误按钮锚点、主题渐变变化、旧 ocean 迁移丢色、旧 ocean 网格墨色未保存、窗口 static、全屏色块被拦截。
- 最新运行普通/全屏水滴、七主题背景、服务器 payload + reload、旧 ocean 背景+墨色迁移已通过；组颜色撤销最终同步复验通过。多工作区负向检查通过：新 legacy 文档捕获自己的 ocean 渐变和网格墨色，返回旧文档准确恢复护眼黄网格。只读 viewer（body data-qw-readonly=1）主题切换+renderCards 后背景不变，当前 fixture 未复现只读重捕获问题。
- `python3 new-legacy/tests/learning-theme-browser.py`：跨标签页双向同步、无存储回音、移除 fallback 通过。
- Node 源码语法检查通过。

## 边界

- 混合边/卡选区沿用现有禁用颜色按钮规则，没有新增混合着色行为。
- 浏览器只连接一次性数据库 FastAPI 127.0.0.1:5189，使用独立 T02 文档；没有生产数据修改。
- 本报告属于开发自检，不能替代用户 UAT 验收。

## 独立复审修复：文档设置污染

独立复审发现 P1 并实测复现：A 护眼黄/网格、B 蓝色/纯色，回 A 后仅收缩缩略图，A 会被整份全局 B 偏好覆盖。新增 `--settings-only` 真实 UI 测试先 RED。

- appearance 事件携带 `changedKeys`，仅缩略图的事件只合并 minimapExpanded，不修改文档颜色、网格或墨色。
- 设置对话框接受可选 per-open read/write 回调，runtime 通过文档 adapter 提供；其它画布默认路径仍使用原全局 preference controller。
- 多题设置读取当前文档；预览只影响当前 runtime 表面和当前文档，不写全局默认。取消恢复完整 appearance、渐变层和网格墨色。
- 第二轮复审确认两处取消漏洞：预览污染 global preference，以及切换 B 后取消把 A 快照写入 B。追加 RED 断言；改为局部预览并在 loadWorkspace 开始时取消旧设置，再保存切换；快照还绑定 workspace ID。
- 设置对话框用公共 overlay mount 进入全屏宿主，标记 canvas UI、阻止 wheel 向画布冒泡，destroy 释放订阅。
- `--settings-only` 覆盖 A/B 切换、真实缩略图按钮、预览取消、只改 pattern 保持 color、服务器 payload/重开，以及全屏设置真实点击。

最终同步后验证（全部退出码 0）：

- `python3 new-legacy/tests/workspace-theme-color-browser.py --settings-only`：A/B 缩略图与文档设置、取消保持全局 defaults、打开设置时切换文档自动取消且不污染 B、仅改 pattern、API payload 和 reload、全屏设置交互均通过。
- `--migration-only`、`--readonly-only`、完整 `workspace-theme-color-browser.py` 均通过。
- Node background 3/3、源码语法、learning-theme-browser 均通过。
- 额外手动调用的历史静态 `v90-p430-unified-canvas-runtime.test.js` 在未修改的 question-training.html CSS 引用字符串断言失败；父任务明确不扩大范围，正式 `pnpm test` 全量已通过（父任务运行）。
