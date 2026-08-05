---
target: 当前项目 UI（active v9.0-p4.1.9）
total_score: 20
p0_count: 0
p1_count: 4
timestamp: 2026-08-04T06-24-49Z
slug: frontend-new-legacy-releases-v9-0-p4-1-9-site
---
Method: dual-agent (A: /root/design_review · B: /root/detector_evidence)

# 当前项目 UI 可替换性与设计审计

## 结论

技术上可以整体更换 UI，但不建议一次性重写。推荐保留 FastAPI、数据库、现有业务脚本和复杂画布引擎，先统一信息架构与设计系统，再按页面族渐进迁移。当前最大阻力不是后端，而是静态 HTML、全局脚本、DOM 选择器和多层补丁 CSS 的耦合。

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 2/4 | 有已保存、只读、disabled 等状态，但默认入口登录无反馈，空状态缺下一步 |
| 2 | Match System / Real World | 3/4 | PMP、试卷、知识树等领域语言自然，但 READY、ADMIN OVERVIEW、版本号泄漏 |
| 3 | User Control and Freedom | 2/4 | 图谱具备重置、缩放和快捷键，但自动跳转、隐藏映射削弱控制感 |
| 4 | Consistency and Standards | 1/4 | 导航、色彩、按钮、账号状态、空状态跨页明显不一致 |
| 5 | Error Prevention | 2/4 | 有权限禁用和部分警告，但入口及跨页状态契约仍不可靠 |
| 6 | Recognition Rather Than Recall | 2/4 | 部分按钮命名清晰，但隐藏菜单与不同页面名称要求记忆映射 |
| 7 | Flexibility and Efficiency | 3/4 | 图谱具备成熟快捷操作，其他页面效率路径不统一 |
| 8 | Aesthetic and Minimalist Design | 2/4 | 单页主任务可辨，但同构卡片、工具和移动端噪声较多 |
| 9 | Error Recovery | 1/4 | 空状态解释问题，却通常没有可执行恢复动作；登录存在无反馈失败 |
| 10 | Help and Documentation | 2/4 | 有帮助中心和局部提示，关键空状态未连接到任务路径 |
| **Total** |  | **20/40** | **可接受下沿：需要系统性改造** |

## Anti-Patterns Verdict

界面具有明显的“多轮生成与补丁累积”特征。管理员页面出现英文 eyebrow、宽幅彩色 hero、同构指标卡和 01–06 编号入口；图谱、训练、回忆、后台又各自形成蓝紫、紫色、浅蓝/红色、青绿四套产品语言。问题不是熟悉的产品组件，而是同一操作在不同页面采用没有业务理由的不同表达。

detector 扫描 5 个代表 HTML，共得到 3 条发现、2 个规则：`em-dash-overuse` 1 条 warning，`numbered-section-markers` 2 条 advisory。`index.html` 的 5 个破折号是只读数据占位，教程 10–12 是真实顺序，均属误报；`admin-console.html` 的 01–06 是六个并列入口，属于有效提醒。

浏览器完成独立新 tab 的 5 页抽查，但安全策略不允许 mutable injection：地址栏预检未产生 DOM 变更，`javascript:` 导航被拦截，因此未注入 `detect.js`，没有可靠的用户可见 overlay。证据由 CLI JSON、DOM snapshot、截图、computed style 和源文件检查提供。

## Overall Impression

单页功能基础不差，图谱编辑器尤其具有成熟工具能力；但产品缺少统一对象模型、跨角色导航壳层和控件语法。最大机会不是换一套颜色，而是让知识树、题目、试卷、练习、回忆形成稳定工作流，并让账号、按钮、导航、选中、危险、空状态在全站具有同一含义。

## What's Working

1. 图谱的文件页签、保存状态、搜索、缩放、连线、快捷键是真实能力，适合保留引擎后重做外围 UI。
2. 已有按钮可访问名称、`:focus-visible`、disabled、pressed 和部分 reduced-motion 基础，不必从零建设可访问性。
3. release 机制具备 immutable candidate、preview、validation、promote、rollback；当前 `new-legacy` sourceHash 与 active v9.0-p4.1.9 一致，适合逐页安全发布。

## Priority Issues

### [P1] 缺少统一产品对象模型与导航壳层

用户无法稳定理解首页、图谱、内容中心、做题模式、单题深学与深度回忆的层级；旧入口还会跳转到不同命名的落地页。应先定义 canonical IA，将内容生产、学习练习、知识图谱、管理配置分为 3–4 个稳定入口，统一产品切换、当前位置、账号和面包屑。建议：`$impeccable shape`。

### [P1] 默认入口、登录和空状态没有可恢复路径

默认入口先承诺开始练习，随后只展示暂无试卷；账号菜单登录实测无响应，而图谱页同名入口可工作。应统一账号组件，按角色提供“登录继续”“体验示例”“前往组卷并发布”等 CTA，并把后台 82 题、0 试卷转化为下一步任务。建议：`$impeccable harden` / `$impeccable onboard`。

### [P1] 移动端通过缩放与裁切适配，核心任务不可可靠完成

390px 下图谱卡牌被裁出视口，训练内容缩得过小，后台导航被裁切。画布应采用移动专属视口/聚焦模式和操作抽屉；训练应重排 DOM；后台应使用可发现的折叠菜单；触控目标至少 44px。建议：`$impeccable adapt`。

### [P1] 跨页组件和语义色漂移

同一主要动作、选中、危险、身份和只读状态跨页采用不同颜色与几何。应建立 semantic tokens 与按钮、tabs、账号、modal、toast、空状态、dock 状态矩阵；保留场景性画布差异，但统一控件。建议：`$impeccable document` 后接 `$impeccable polish`。

### [P2] CSS 与 DOM 耦合导致大改容易回归

active release 包含 26 HTML、57 CSS（19,449 行）、251 JS（48,719 行）；CSS 有 2,821 个 `!important`，JS 有 517 次 selector 查询和 691 次 classList 变更。训练页加载 19 份 CSS，同一 `.qt-workflow-step` 在 4 份样式中覆盖。应先整理 ID、data attribute、全局事件和视觉 class 的 UI contract，再迁移。建议：`$impeccable document`。

## Persona Red Flags

### Jordan（第一次使用）

从默认入口看到暂无试卷，没有体验示例或登录后的明确价值；点击登录无反馈；单题深学、做题模式、回忆、学习路径关系不清；旧 URL 又会跳到另一名称页面，首次会话极易流失。

### Alex（高效教师/管理员）

顶栏 9 个同级入口和六张等权工作卡需要反复扫描；82 题、0 试卷没有驱动下一步；跨页上下文不能稳定保留；图谱有快捷键，但后台没有同样稳定的高效操作语言。

### Sam（键盘、读屏或低视力）

图谱空间操作依赖拖拽、连线与视觉坐标；训练移动端字号过小；后台大量 8–10px 灰色辅助标签；导航裁切可能让焦点移到视口外。正面基础是大量按钮已有名称和 focus 状态。

## Minor Observations

- `V9.0-P3.5`、`V9.0-P3.5.7` 等工程版本号不应成为用户品牌信息。
- 英文 eyebrow 与中文主界面混用，增加内部模板感。
- 深度回忆 dock 的红色当前态容易被误解为危险或错误。
- disabled 控件以低 opacity 表达，进一步降低对比度。
- 管理页的许多同构卡片更适合任务列表、表格或优先队列。
- 图谱点阵背景服务真实画布语义，应保留，不属于无意义装饰。

## Technical Feasibility

后端 API、认证和数据库没有锁死当前视觉；真正阻力在前端的全局脚本、DOM ID/class、`innerHTML`、patch CSS 和画布坐标/transform。发布前还必须显式修改三类旧设计契约：AGENTS.md 的 legacy 像素复刻要求、`frontend/scripts/design-contract.test.mjs` 的上游样式约束、现有视觉回归基线。

推荐渐进迁移顺序：

1. 定义 IA、角色、canonical routes、核心对象和设计 token。
2. 建共享壳层，统一导航、账号、帮助、消息、按钮、tabs、toast 和 modal。
3. 先迁移后台总览、科目、题库、试卷、课程等数据型页面。
4. 保留训练状态机，重做练习与回忆布局、空状态和移动端结构。
5. 最后统一图谱外围 shell、工具按钮和属性面板，核心引擎暂不重写。
6. 每页验证桌面/移动、登录/退出、角色权限、空/加载/错误和持久数据。

不推荐为了换 UI 同时迁移 React。当前项目没有 React 依赖，业务 UI 由大量全局脚本直接驱动；框架重写会把设计项目扩大为完整功能重构。

## Questions to Consider

- 核心对象究竟是图谱、题目、试卷还是学习路径，为什么它们都在争夺首页？
- 新学员没有已发布试卷时，产品能否在第一分钟交付价值？
- 哪些页面差异来自真实任务，哪些只是历史补丁留下的视觉口音？
- 管理员看到 82 道题、0 试卷时，为什么界面不直接带他完成组卷发布？
- 如果减少一半卡片、颜色和入口，核心任务是否反而更快？
