# Practice and Canvas Interaction Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox tracking.

**Goal:** 落实用户六项答题、评论、弹窗和共享画布问题，验证并进入UAT。
**Architecture:** 现有原生模块局部修改；共享弹窗集中KGDialogs，答题选中态与正确性策略独立，弹幕按题目身份保留，主题由共享canvas模块应用整卡。
**Tech Stack:** 原生HTML/CSS/JS、FastAPI、PostgreSQL、Node契约、Python Playwright。

## Global Constraints

- 权威源仅new-legacy；不手改public/site，不新增框架依赖，只在当前工作区写入。
- 开发分支codex/practice-canvas-interaction-polish，先UAT业务验收，再考虑main；大厅和成人内容仍暂缓。
- Python检查使用PYTHONDONTWRITEBYTECODE=1，避免测试缓存改变release源字节。
- 公共Promise弹窗必须传播await及取消值；数据与权限仍由原后端负责。

## R1: 答案显示与答题卡（remaining_dashboard）

Files: src/100-practice-mode.js, src/112-practice-answer-sheet.js, styles/answer-page.css,专项tests。
- [ ] 复现instantFeedback=false选择后的显示、切题/语言/保存恢复及正确性泄漏边界，添加失败回归。
- [ ] 基于用户选择渲染中性摘要与aria-pressed；答题卡加入选择摘要、统计和清晰状态层级，不使用答案数据。
- [ ] 桌面/390/320及单/多/配对实际浏览器；保留结果回顾、标记/筛选/跳题/交卷原行为。

## R2/R3: 弹幕与浮层表情（root）

Files: src/119-question-comments.js, styles/question-comments.css,专项tests；100两处生命周期由R1 owner协调。
- [ ] 失败回归同题mount保留overlay对象、切语言不新增API/动画、工具按钮与轨道不重叠。
- [ ] teardownSource(source,{exceptQuestionId})保留当前题，mountDanmaku重复调用不重绘；viewport布局按语言工具rect+间距设置top。
- [ ] 表情浮层默认hidden、分组/名称、光标插入、外点/Esc关闭；打开前后正文/发送区bounding rect不变，窄屏不溢出，草稿不清空。
- [ ] 素材选择依据用户回复及GitHub明确许可；保存来源/许可，资源本地化，不采用不明授权原图。
- [ ] 运行原弹幕design/controls和实际练习中英文切换组合流程。

## R4: 公共弹窗及原生调用迁移（remaining_sound）

Files: src/00-dialogs.js, styles/dialogs.css，source HTML加载、homepage bundle配置、native调用文件及适配层、Prep源。
Interfaces: KGDialogs.alert(message,options):Promise<void>; confirm(message,options):Promise<boolean>; prompt(message,defaultValue,options):Promise<string|null>。
- [ ] 共享组件红绿覆盖alert/confirm/prompt、FIFO、Escape、焦点/Tab、危险默认取消、账号/离页取消。
- [ ] 全量扫描真实原生调用，逐个追踪返回依赖，异步迁移；100/77/86/94等由文件owner接入，避免编辑冲突。
- [ ] 真实主页面/管理/图谱/Prep正向与取消路径，浏览器dialog事件为零，禁止简单覆盖原生API。

## R5/R6: 共享画布工具栏和主题（review_exit_help_layout）

Files: src/canvas/94-canvas-ink.js,97-learning-theme.js,77/86接入，canvas/learning-theme CSS，三页HTML工具栏区域及专项tests。
- [ ] 实际复现临时画布图标、模式主题面板差异和卡体未随主题改变，加入失败回归。
- [ ] 共享图标和工具栏分组，保持真实绘制、文字、撤销/重做、保存；窄屏可达。
- [ ] 两模式复用主题面板渲染，整卡主体/正文/边框/文字统一；模式/账号持久化与文档背景不混。
- [ ] 触摸/键盘、取消/保存重开、旧内容与失败重试回归；owned native dialogs按R4接口迁移。

## Integration and UAT（root）

- [ ] 阅读各域diff、截图和证据并独立复查；扫描原生弹窗遗漏及重复公共实现。
- [ ] 将新测试加入既有契约/发布门禁，定向检查后显式sync、版本构建、site/public旧路径和字节核对。
- [ ] 最终冻结、暂存生成物并运行官方完整门禁；证据与源一致后提交合入uat、代理推送并核验远端引用。
- [ ] 验证UAT备份、官方部署与公网/容器核验，更新交付及handoff；等待用户业务验收，保留功能分支。
