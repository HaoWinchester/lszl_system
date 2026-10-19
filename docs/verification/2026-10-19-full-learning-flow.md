# 深度回忆 / 多题归纳完整流程验证（本地 v357）

本轮按用户要求验证实际使用、保存和刷新，不只检查布局。最终服务版本为 `v9.0-p4.1.357`，sourceHash `58ae7d6be05315b4dcd0d7764ff0dd13d7c38088a53a8a5031ecb6d69d63b121`。仅更新本地 5173，不部署 UAT、不推送或合入 main/uat。

## 确认的问题及修复

这些是实现和之前测试覆盖不足造成的缺陷，不是用户要求修改卡片样式或丢弃学习进度。

1. **深度回忆选项刷新丢失**：controller 产出的选中/常绿 `optionState` 被适配器和严格进度契约漏掉。复用已有可扩展 JSON `metrics.optionState` 持久化并兼容原读取形式，统计计数读取方式不变，无数据库迁移。
2. **个人回忆卡草稿丢失**：正文或标题未点击保存就关闭卡片、切题、切模式或返回时，没有提交输入。统一提交当前卡片草稿及画布文字，再等待保存；空标题保留编辑器并提示补全；失败时留在当前页面。补测两张个人卡经搜索切换，确认标题/正文不串卡。
3. **全局切换绕过保存**：原生链接直接导航，可能取消尚未发出的保存或正在进行的请求。共享 LearningProgress 增加异步 `prepareLeave`，两页分别提供自己的提交与保存逻辑；全局快捷入口等待成功再跳转，失败可重试，只读不产生写入。
4. **文字并发提交误判失败**：pointerdown 的外部点击保存和 click 的离页保存同时发生，第一次成功清除编辑器后，第二次误判为失败。共享画笔控制器现在复用同一次完整提交 Promise，避免重复提交及错误阻止导航。
5. **多题作答同步静默丢失**：失败或正在发送的作答批次没有被离页流程等待。复用实际进行中的 Promise，离页严格等待，失败保留原 requestId 和重试记录；恢复后先写入再离开，验证错题次数仅增加一次。
6. **立即点选并离开漏作答**：为了区分单击/双击的 230ms 计时器尚未入保存队列。离页先兑现待提交单击，再等待作答同步；保持原双击取消单击规则，验证恰好提交一次。
7. **刷新未提交内容无保护**：共享 beforeunload 仅在个人卡/文字草稿、待提交选项、待同步作答或保存未完成/失败时提示。取消刷新保留内容；确认保存后刷新无提示并从服务器恢复。显式选择离开仍按浏览器的丢弃语义处理。

没有额外重设计大厅、主题配色、题卡或工具栏。七种主题、两页主题独立、背景设置取消/确认及模式往返保留原画布均继续验证。

## 最终真实浏览器验证

全部最终流程运行 **官方不可变 v357，无 source override**，使用实际 Google Chrome、鼠标和键盘操作页面。正向保存走真实 FastAPI/PostgreSQL；503 和请求暂停只用于故障注入，不伪造保存成功。API 用于核对真实落库结果，主要编辑/切换动作通过可见 UI 完成。

| 范围 | 验证内容 | 最终结果 / 证据 |
|---|---|---|
| 深度回忆主流程 | 教师、学生、只读访客；七主题及刷新；选项/常绿；关键词/联想；自定义卡标题正文；拖动、搜索、删除关联边；保存失败重试；切题、退出重进 | 34/34，`artifacts/full-learning-flow/recall/candidate357-results.json`，页面 errors=[] |
| 深度回忆草稿 | 关闭自动提交、切题提交、空标题阻止、503 阻止全局切换/返回、恢复后重试 | 8/8，`candidate357-draft-results.json` |
| 深度回忆刷新 | 未保存刷新确认、取消保留、显式保存、已保存刷新无提示、正文恢复 | 5/5，`candidate357-refresh-results.json` |
| 个人卡隔离 / 落库 | 搜索切两张卡无串写；teacher/student/viewer 的 API 与 PostgreSQL 原始 nodes/edges/customNodes/metrics/revision 一致 | 卡间切换通过；3/3 数据核对，`candidate357-binding-result.json` / `candidate357-database-assertions.json` |
| 多题归纳主流程 | 页面登录、新建改名、题库点击/拖入两题、归纳卡正文标签及内联标题、文字笔迹、移动连线删除、503 保存重试、背景取消确认、A/B 切换、刷新及深度回忆往返；API payload 精确对照完整画布 | 教师 17/17、学生 17/17 |
| 多题归纳权限 / 边界 | 访客只读及 API403；草稿刷新保护/503 恢复；作答503、正在请求、立即选项后导航；错题计数与 requestId 核对 | 访客5、草稿5、作答失败3、请求等待2、立即导航1，合计多题 **50/50**；`artifacts/full-learning-flow/workspace/candidate-final-results.json` 含每条命令/exit0 |
| 两页共享行为 | 主题互不影响、七主题、五档宽度主题入口/键盘、背景可见、三轮恢复原画布/原题、背景取消确认、活动文字遇503阻止离开并恢复保存/往返刷新 | 6/6，`artifacts/full-learning-flow/root/immutable/browser-results.json` |

## 自动检查与可复跑命令

- `node --test new-legacy/tests/workspace-background.test.js new-legacy/tests/canvas-ink-workspace-save.test.js new-legacy/tests/v90-p4529-deep-recall-database-adapter.test.js new-legacy/tests/v90-p430-unified-canvas-runtime.test.js`：**30/30**。
- `python3 new-legacy/tests/canvas-ink-polish-browser.py`：共享画笔事务/文字等 **20/20**，包含新增并发提交回归。
- `python3 new-legacy/tests/learning-theme-browser.py --base-url http://127.0.0.1:5293 --out-dir artifacts/full-learning-flow/root/immutable`：上述共享真实浏览器 **6/6**。需先用既有 `canvas_ink_server.py --port 5293 --multiple-papers --role-matrix` 和 active release 启动隔离 fixture，勿指向用户开发数据库。
- `pnpm --dir frontend test`：**355/355**，E2E 契约 **9/9**，发布脚本契约通过。执行发布脚本的测试不等于部署 UAT。
- `pnpm --dir frontend test:design`：**5/5**。
- 官方本地 `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser`：退出0，内置候选校验通过；之后另行完成上述真实浏览器验证。再执行 `pnpm --dir frontend sync:new-legacy` 对齐同步产物。
- 文件清单保持基线 **1148**；public 与 active site 的路径/内容全部一致。5173 实际 11 项关键资源核对通过；HTML 只含源码允许的服务器 bootstrap 注入，注入 releaseVersion 也为357。`artifacts/full-learning-flow/root/served-assets.json`。
- 新缺陷均先保留浏览器或单测失败证据再修复；证据位于 `artifacts/full-learning-flow/` 的 before/red/source/candidate 结果中。

## 范围与限制

本轮没有修改后端业务实现，后端 seed 文件仅由同步更新版本与内容哈希；没有再次运行12分钟的后端1103项全量。此前 **1103 passed** 的完整结果见 [后端全量报告](2026-10-19-backend-full-and-toolbar-layout.md)。本轮额外通过真实 API 与隔离 PostgreSQL 核对持久化。

扩展检查时，两份归档静态测试 `deep-recall-qw-option-analysis.test.js`、`v862-p2225-deep-recall-scene-card-state.test.js` 仍因引用已移除/合并的旧 CSS 文件报 ENOENT；未修改或将它们计为通过。现行完整前端检查和本轮定向测试均通过。完整使用流程使用桌面 Chrome；五档宽度用于主题入口检查，不声称完成所有移动端/其它浏览器验收。

业务写入测试使用5291/5292/5293三套独立测试库，未在用户5173图谱及开发库造测试卡片。测试完成后精确停止这些 fixture 并核对各自数据库删除，保留5173运行。自动化自检不替代用户UAT验收。
