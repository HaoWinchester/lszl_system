# 学习主题、背景与模式往返修复（仅本地 v356）

用户反馈：深度回忆主题入口不好找；往返深度回忆/多题归纳后，画布上已放好的题目卡片发生变化；多题归纳原有背景消失；多题归纳切主题会连带改变深度回忆。用户已确认变化的是已放置的卡片，不是题目库筛选。

## 原因与修复

1. **主题入口**：入口 DOM 并未删除，位于顶部调色盘图标。真实 Chrome 复现了交互缺陷：pointerenter/focusin 先打开 details，随后点击 summary 的默认动作又关闭，使用户点开即收起。保留悬浮，修复点击与焦点的冲突，并补上“主题”文字。验证 1440/1024/800/525/390 五档尺寸，以及 Enter/Space/Escape。
2. **主题互相影响**：两个页面明确共用 `kg_deep_recall_theme_v1` 并监听同一 storage 事件。本轮在现有共享控制器增加模式作用域：深度回忆沿用原键，多题使用单独的显示偏好键；旧共享选择只用作多题首次初始化值，之后独立保存、独立接收事件。同步更新控件事件过滤、UI 文案与存储登记，未新建业务数据缓存。
3. **卡片变了**：全局快捷入口只有裸页面地址，不恢复原画布 ID；当前活动画布发生变化后，返回时会打开另一张画布。真实用例：B 画布包含题目 2，另一页激活 A（题目 1），B→深度回忆→多题旧版返回 A。修复为通过已有 LearningRouteContext 恢复目标模式上次的画布、试卷发布版本、题目和来源参数。多题 URL 重写也不再无条件把当前题目换成列表第一题。修复没有复制、替换或删除用户原有卡片。
4. **背景不见**：文档里原有渐变背景仍然存在，但统一画布 CSS 将 `.qw-background` 的 opacity 设成 0。恢复背景层。显式设置纯色/网格时清除当前草稿的场景背景层，避免旧渐变遮挡新设置；取消会还原整个原始背景快照。保留已有文档背景独立保存规则，主题切换不擅自重写已保存背景。

这是实现与跨流程测试覆盖的问题。上轮布局自检缺少“模式往返保持同一画布”和“页面主题互不影响”两类行为回归，不能用当时的布局命中检查替代这些验证。

## 验证

- 定向 Node：`node --test new-legacy/tests/workspace-background.test.js new-legacy/tests/v90-p430-unified-canvas-runtime.test.js`，7/7 通过。覆盖独立主题、旧值迁移、跨标签页事件、不串模式的恢复 URL、原有背景保存。
- 浏览器复现和修复过程：`artifacts/learning-state-regression/`。旧版卡片跳错画布的证据为 `navigation-red.log`，修复后三轮记录为 `navigation-source.json`；主题单测先复现共享值覆盖后修复通过。
- 真实 Chrome 定向套件 `new-legacy/tests/learning-theme-browser.py` 使用独立 FastAPI/PostgreSQL fixture：主题跨页面/刷新独立，七种主题选择，五尺寸入口，鼠标/键盘操作，背景显示，三轮原画布往返与刷新，设置取消/确认及持久化。
- 完整前端 355/355、E2E 契约 9/9、发布脚本契约通过；设计契约 5/5。第一次全量检查准确拦下新 UI 偏好键尚未登记，随后仅增加该键在 contract 和共享模块中的两条 inventory 登记，未放松 gate。
- 本轮未修改后端业务代码，未重新执行后端 1103 项全量；上一轮结果见 `2026-10-19-backend-full-and-toolbar-layout.md`。

仅本地不可变 release v356，不推送、不合并、不部署 UAT/main。测试使用独立数据库和浏览器上下文，不用用户 kg_graph_dev 执行写入测试。5173 服务保持运行。

最终 v356 无 source override 的真实 Chrome 套件 **5/5 通过**，见 `browser-immutable.log`、`browser-results.json`。三次往返画布 ID、题目 ID、完整节点对象与刷新后数据一致，见 `navigation-immutable.json`。五档视口主题入口均在屏内、命中正常、页面无横向溢出，见 `entry-final.json`。

已核对 active release 与 sync 产物各 1148 文件、路径与原基线一致、全部字节一致；5173 的 11 项实际资源（HTML 仅额外注入预期的服务端 runtime bootstrap，余下静态内容一致；JS/CSS/VERSION 精确字节一致）属于 v356。证据 `served-assets.json`。

隔离 5281 服务已停止，唯一测试库 `kg_pytest_78216_2a7d79fe2bed` 的 SQL 查询确认已删除。
