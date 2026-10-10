# UAT 功能与 UI 测试报告 · 2026-10-10

**结论：主学习流程抽测可用，但不能判定页面全部正常。确认 5 项缺陷，其中 2 项影响手机宽度下的后台操作。**

- 环境：https://uat.aihuanpu.com，公网页面版本 `v9.0-p4.1.302`。
- 上下文：已读取最新 `.claude/handoffs/2026-10-10-095008-uat-canvas-ink-upgrade.md` 及其上一份交接；当前分支 `uat`，交接后无新增提交，测试前工作树干净。handoff 检查器把分支名后的中文说明误识别为分支差异，实际分支一致。
- Persona：使用浏览器备考的中文学习者，日常使用桌面，兼顾手机回看；后台页面按需要在窄屏临时操作的管理员检查。实际登录角色为管理员，另测试未登录状态。
- 覆盖：26 个 URL 入口 × 1440×900、768×900、390×844；包含 2 个回到做题大厅的旧入口。检查加载、控制台、网络、布局与 WCAG 自动扫描。另深入操作做题、收藏、深度回忆、多题归纳、知识图谱。
- **严格全量 UX 审计标记：Incomplete**。本次为广覆盖页面检查和重点功能回归，没有对所有页面每个按钮、每种角色及压力场景穷举；不能把 26 页加载检查写成 26 页所有业务通过。
- 已登录页面扫描：console error 0、warning 0、pageerror 0、HTTP 4xx/5xx 0、requestfailed 0；axe-core 4.10.3 WCAG 2A/2AA/2.1AA 扫描报告违规 0。以上仅对应被扫描的默认状态。
- 布局硬门槛：2 页失败。首次游客进入做题大厅时有 3 条 401 控制台记录，不计作登录后接口故障；未做逐请求归因。
- 做题大厅性能抽样（未限速）：LCP 724 ms、CLS 0.1663、最大已观察交互事件时长 160 ms。最后一项是短时浏览器样本，不是完整现场 INP。
- 问题数：Critical 0 / High 2 / Medium 2 / Low 1。独立复核：Drafted 5 / Kept 5 / Generic 0 / Duplicate 0。
- 交互证据：`auth-flows.json` 提供真实时间戳；`observations.json` 是主会话观测摘要，不伪造逐步时间戳。完整 Interaction Manifest 未覆盖所有页面，且未统计跨全部操作的时间间隔，因此不宣称 exhaustive Pass。

## 优先处理的 5 项

### H1 · 科目与知识树在手机宽度下详情区仅 86px

- 层级：Visual；优先级：High；页面 `/admin-subjects.html`，390×844，默认双栏；Persona：管理员。
- 复现：登录 → 打开“科目与知识树” → 窗口缩至 390px → 查看当前科目及操作按钮。
- 实际：布局仍为 `240px 86px`；右栏有左右各 20px 内边距，正文仅约 44px，文字纵向挤压，操作区被快捷导航进一步遮挡。
- 预期：手机宽度下单列，科目列表与详情纵向排列，按钮与字段完整可读。
- 证据：[顶部截图](admin-subject-mobile-top.png)、[中部截图](admin-subject-mobile-repro.png)、`observations.json`。
- 位置：`new-legacy/styles/admin-focus-vega-common.css:159` 覆盖 `admin-console.css` 已有移动单列规则。
- 最小修复：在现有皮肤文件增加同特异性 `max-width:880px` 单列规则，复核详情按钮和二级页签。

### H2 · 用户管理在手机宽度下编辑区仅 48px，页面横向溢出

- 层级：Visual；优先级：High；页面 `/user-management.html`，390×844，默认列表/编辑区；Persona：管理员。
- 复现：登录 → 打开“用户管理” → 缩至 390px → 滚动到用户列表和编辑区。
- 实际：列宽 `280px 48px`，页面 `scrollWidth=451`，编辑区正文和按钮伸出可视区域。
- 预期：移动端列表与表单单列展示，正常读取、操作字段。
- 证据：[截图](user-management-mobile-editor.png)、`sweep-results.json`、`observations.json`。
- 位置：`new-legacy/styles/admin-focus-vega-users.css:70` 的固定双栏皮肤规则。
- 最小修复：补移动断点下的同特异性单列覆盖，并检查表单控件的最小宽度。
- 与 H1 属同类布局问题，但文件、选择器和业务页面不同，需分别修复。

### M1 · 收藏详情丢失题目附图/材料

- 层级：Interaction；优先级：Medium；页面 `/practice-mode.html` 的收藏详情，1440×900；Persona：学习者。
- 复现：选择“新题型体验卷（图表·案例·连线）” → 开始短练 → 收藏第一道聊天机器人题 → 保存退出 → 我的收藏搜索“聊天机器人” → 查看详情。
- 实际：答题页显示测试协议表图片，收藏详情仍写“参考测试协议表”，但详情内 `img` 数量为 0，也没有对应材料区域。
- 预期：收藏回看具备原题作答所必需的图片和材料。
- 证据：[原题附图](answer-image-modal.png)、[收藏详情](favorite-detail.png)、`observations.json`。
- 位置：`backend/app/services/question_favorite_service.py:121`、`new-legacy/src/120-question-favorites.js:234`。
- 最小修复：详情 API 补共享展示使用的 `material`、`images` 字段；前端复用现有 `KGQuestionMaterials.renderMaterials()` / `bindMedia()`，同时验证图表题和案例题。不要另造不兼容字段。

### M2 · 已打开的另一标签页不会实时跟随画布主题

- 层级：Feedback；优先级：Medium；页面深度回忆与多题归纳，1440×900，两个标签页；Persona：学习者。
- 复现：深度回忆选择“海盐蓝” → 新开多题归纳（读取海盐蓝正常） → 保持两个标签页打开 → 多题归纳改为“樱花粉” → 回到深度回忆。
- 实际：共享 localStorage 为 `sakura`，深度回忆 DOM 仍为 `ocean`。主题保存与重新进入页面读取正常，问题在已有页面的实时更新。
- 预期：按共享模块声明的“含跨标签页跟随”行为，已打开页面同步更新。
- 证据：[滞后标签页](theme-stale-tab.png)、`observations.json`；主会话浏览器检查记录 `rendered:ocean, saved:sakura`。
- 位置：`new-legacy/src/canvas/97-learning-theme.js:24`，目前只有写入和当前 window 事件，没有主题 storage 监听。
- 最小修复：共享控制器监听主题 key 的 storage 事件，应用 DOM 并同步控件；接收外部变化时不要回写 storage，避免回写循环。

### L1 · 做题页登录后读屏仍报“访客只读”

- 层级：Feedback；优先级：Low；页面 `/practice-mode.html`，1440×900；Persona：使用读屏的学习者。
- 复现：以游客打开做题大厅 → 账号菜单登录 → 检查账号按钮的 accessible name。
- 实际：可见文本为“管理员”，`aria-label` 仍为“访客只读，打开账号菜单”；实际登录和退出成功，深度回忆、多题归纳无此标签问题。
- 预期：登录、退出后的可见与无障碍状态一致。
- 证据：`auth-flows.json`、`auth-flows.log`。
- 位置：`new-legacy/src/30-shared-auth-dialog.js:193` 的共享 `renderStatus()`。
- 最小修复：更新账号文字时同时更新 aria-label，并验证退出后的标签恢复。

## 已实际操作并验证

| 流程 | 结果及证据 |
|---|---|
| 做题/深度回忆/多题归纳登录与退出 | 三页均能打开登录窗、登录、退出；做题页存在 L1。见 `auth-flows.json` 和 `auth-*.png`。 |
| 试卷搜索、开练、作答、保存退出 | 搜索“新题型”得到目标试卷，选 A 后由 0/5 变 1/5，保存退出后大厅显示 1/5 与续做入口。见 `answer-after.png`、`favorites.png`。尚未完成整卷交卷。 |
| 图表查看 | 实际点击附图，放大弹层正常；见 `answer-image-modal.png`。 |
| 收藏搜索、详情与关闭 | 能收藏、按“聊天机器人”过滤并打开详情；Escape 后 body overflow 恢复空值。详情附图缺失见 M1。 |
| 深度回忆文字笔迹 | 中文与重音字符输入正常；切走再切回、刷新后内容仍在；点击原文字能回填编辑，字号保持 24。见 `recall-text.png`、`observations.json`。 |
| 画笔交互 | 双击画笔打开色板；切题后文字工具仍选中；右键轻点恢复 select。见主会话记录与 `observations.json`。未穷举每种光标、长按清整套。 |
| 切题选项重置 | 第二题选 B 后 aria-pressed=true，下一题 A–D 均 false。见 `observations.json`。 |
| 多题归纳 | 搜索“预算” → 加入题目卡 → 输入文字 → 刷新后 1 张卡和文字恢复。见 `workspace-card.png`、`workspace-text-reload.png`。 |
| 主题跨页读取 | 深度回忆 ocean → 进入多题归纳后 ocean 正常；已打开标签页实时同步存在 M2。 |
| 图谱进入及搜索 | 学习入口进入图谱成功，搜索“风险”出现风险管理结果，点击可定位。见 `graph-open.png`、`graph-search.png`、`graph-search-focused.png`。 |
| 页面与排版扫描 | 26 个入口均 HTTP 200，无已登录加载异常；除 H1/H2 外，本次默认状态截图未见同等级布局崩溃。详见 `sweep-results.json`，不能据此推断每项业务写操作通过。 |

## 现有检查

- `cd frontend && pnpm test:design`：5/5 通过，见 `design-test.log`。
- 4 个 canvas ink Node 测试文件：16/16 通过，见 `ink-tests.log`。
- `cd backend && .venv/bin/python -m pytest tests/test_canvas_ink.py -q`：34/34 通过，1 条既有 python_multipart 弃用警告，见 `backend-ink-tests.log`。
- 这些是本地源检查；公网交互结果单独记录。未重跑全量 `pnpm test`、全量后端 pytest、隔离数据库浏览器发布门禁，也未据此覆盖已知全量历史失败。

## 数据影响与验证边界

- 未修改业务源码、未部署、未合并/推送分支。
- 测试添加的收藏、画布卡片及两页文字笔迹已清理；主题偏好恢复“平台默认”。
- UAT 管理员的“新题型体验卷”保留一次测试短练已保存答案（1/5），未删除既有学习历史。认证操作会产生正常登录/退出日志。
- 没有替用户进行 UAT 业务验收，也未操作生产环境。
- 后台创建/删除/发布、实际付款、发送反馈消息、AI 助手完整导入链路未执行；受限学生角色、Safari/手机真机、慢网/离线、500+条造数、时间分布数据和所有断点/多面板组合未穷举。手机截图是 Chromium 视口模拟。
- 本次边界来自测试范围与避免无关业务变更，并非技能要求用户额外批准后才能继续。

## 修复路线

1. **24–48 小时优先**：修 H1/H2 移动断点、M2 共享主题监听、L1 账号标签；对相关页面原步骤重新截图验证。
2. **功能补齐**：M1 复用共享题目材料展示，核对 API 字段与图表/案例两种收藏详情；无需重写收藏模块。
3. **后续验证**：补学生权限和真实移动设备回归。当前没有证据支持新增大规模视觉重构或动效打磨任务。

整体感受：桌面学习区域像一套已经能顺手使用的工具，画布、题库与收藏路径基本连贯；但手机管理页的窄栏和收藏缺图会直接打断操作，因此还不适合把当前版本描述为“所有页面功能和排版都正常”。
