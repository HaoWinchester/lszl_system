# 模块说明

| 文件 | 职责 |
|---|---|
| `index.html` | 只保留页面结构和脚本/CSS 引用 |
| `styles/main.css` | 原始样式拆出后的主样式文件 |
| `src/00-config-state.js` | 常量、默认值、模板数据、状态清洗、读写存储 |
| `src/10-graph-editor.js` | 图谱渲染、节点/连线交互、编辑弹窗、画布拖拽/缩放 |
| `src/20-flashcards-toolbar.js` | 工具栏、闪卡、导入导出、样式控制、通用工具函数 |
| `src/30-auth-guards.js` | 本地登录、多用户、本地空间、编辑权限守卫 |
| `src/40-guided-tour.js` | 新手引导、高亮遮罩和步骤控制 |
| `src/50-question-data.js` | PMP 考题破案模式的内置题目数据和训练状态 |
| `src/60-question-bank.js` | 题库管理 MVP，题库导入、导出、选择、保存 |
| `src/70-question-trainer.js` | 考题训练界面渲染、答题、生成图谱、生成闪卡 |
| `src/80-question-font-scale.js` | 考题训练字体缩放兜底修复 |
| `src/90-bootstrap.js` | 最终启动入口，保证所有函数声明加载完成后再初始化 |

## 为什么没有一次性改成 ES Module

原始代码大量依赖共享闭包变量和函数提升。直接改成 `import/export` 需要重新设计状态边界，风险较高。  
本版先完成“文件级模块化 + 启动入口隔离”，确保功能稳定；下一轮再逐步替换成显式 API。


## 2026-07 界面调整

顶部操作区已改为左侧可拖拽图标菜单；图谱标题区域支持双击编辑。业务模块和状态结构未改动。

## 2026-07 深度知识回忆

| 文件 | 职责 |
|---|---|
| `knowledge-recall.html` | 独立深度知识回忆页面，提供无限画布和中心题目卡 |
| `styles/knowledge-recall.css` | 深度回忆页专属样式、三维圆形按钮、寻宝地图连线动画 |
| `src/85-knowledge-recall-data.js` | 深度回忆预设知识网数据和关键词入口配置 |
| `src/86-knowledge-recall.js` | 无限画布拖拽缩放、关键词生成节点、引导提问、节点连线和本地进度保存 |

## 题库认知标注管理独立页

- `question-bank.html`：独立题库管理页面，面向项目管理类认证科目维护题目、关键词、知识点与推理步骤。
- `styles/question-bank-admin.css`：题库管理独立页样式。
- `src/65-question-bank-admin.js`：题库管理独立页交互逻辑，使用与原题库 MVP 兼容的 localStorage key：
  - `kg_question_banks_v1__<scope>`
  - `kg_question_current_v1__<scope>`
  - `kg_deep_recall_current_question_v1`
- 默认科目：PMP、CSPM、P2、ACP、NPDP；可继续扩展 PgMP、PfMP 等项目管理类认证。


## 题库管理页交互增强

- `question-bank.html`：新增题库/题目标签栏、关键词悬浮标记操作台、关键词来源字段。
- `styles/question-bank-admin.css`：新增标签栏、编辑按钮组、来源标识、悬浮关键词面板样式。
- `src/65-question-bank-admin.js`：新增关键词/知识点编辑流程，支持题干与选项选中文本标记关键词。

## 2026-07 题库管理布局优化

- `question-bank.html`：题库管理页改为左侧布局导航 + 题库/题目标签栏；题库信息表单迁移到题库管理栏；题目管理增加搜索与按章节/领域/难度/题型归集；关键词、知识点、推理逻辑合并为认知标注标签栏。
- `styles/question-bank-admin.css`：新增左侧布局导航、题库信息侧栏、题目分组列表、标注标签栏和响应式样式。
- `src/65-question-bank-admin.js`：新增题目搜索/分组、分组折叠、布局导航、标注标签栏状态切换逻辑。

## 2026-07 题库管理体验优化

- `question-bank.html`：顶部新增“导出全部题库”，题库信息区新增“删除题库”，右侧新增“当前题库操作”和可操作的“科目快捷管理”。
- `styles/question-bank-admin.css`：新增题库列表操作按钮、完成度跳转按钮、科目快捷管理卡片、右侧操作区样式。
- `src/65-question-bank-admin.js`：新增删除题库、导出全部题库、题库列表单项导出/删除、科目统计/筛选/新建、完成度点击跳转，以及内置示例题库删除后不再自动恢复的本地标记。

## 组卷与发布模块

- `question-bank.html`
  - 新增“组卷与发布”卡片。
  - 后台支持新建试卷、按领域配额组卷、发布/取消发布、删除试卷、导出试卷。

- `src/65-question-bank-admin.js`
  - 新增 `kg_exam_papers_v1__<scope>` 试卷存储。
  - 新增试卷结构：`id/name/subject/totalCount/status/quotas/questions`。
  - `questions` 采用题目引用：`bankId + questionId`，不会复制或破坏原题库题目。

- `index.html` + `src/60-question-bank.js`
  - 考题训练页新增“综合试卷”下拉选择。
  - 只展示已发布试卷。
  - 选择试卷后，上一题/下一题会按试卷顺序切换。


## 2026-07 题库管理主工作区布局调整

- `question-bank.html`：左侧收敛为纯纵向导航；题库列表、题目列表、组卷发布和题目基础编辑迁移到中间主工作区。
- 中间主工作区新增三个主标签：题库管理、组卷与发布、题目基本信息。
- `styles/question-bank-admin.css`：新增主标签栏、双栏题库/题目管理区和左侧窄导航响应式样式。
- `src/65-question-bank-admin.js`：新增主工作区标签状态 `activeMainTab`，并调整左侧导航跳转逻辑。
- `question-training.html`：独立考题训练页面。
- `src/72-question-training-page.js`：独立训练页运行时、登录态与初始化逻辑。

## 2026-07 用户管理系统

- `user-management.html`：独立用户管理页面，负责本地账号资料、角色状态、归档和常规操作。
- `styles/user-management.css`：用户管理页面样式。
- `src/35-user-management-service.js`：用户创建、资料更新、密码重置、状态切换、复制、删除、批量操作和导入导出数据服务。
- `src/35-user-management.js`：用户列表、筛选、分页、表单交互、操作日志和用户数据概览；业务写操作统一调用用户管理服务层。
- `src/30-auth-guards.js`：主图谱页登录逻辑增强，支持用户资料字段、状态拦截和登录/注册/退出日志。
- `src/72-question-training-page.js`：独立考题训练页登录逻辑增强，底层用户、会话、密码校验和日志优先接入 `KGAuthCore`。
- `index.html`、`question-bank.html`、`question-training.html`：新增用户管理入口。

用户与日志 localStorage key：

- `kg_local_users_v1`
- `kg_local_current_user_v1`
- `kg_user_admin_logs_v1`


## 角色权限与主题模块

本版本新增 `src/34-role-permissions.js`，统一管理管理员、教师/教研、学员、只读用户的前端权限模板和角色主题色。教师/教研允许进入题库管理、维护题目、组卷并发布/取消发布试卷；用户管理和角色主题修改仅限管理员。首页与独立训练页会显示当前登录角色，并按角色自动切换主题色。

## 2026-07 角色权限修复

- `src/34-role-permissions.js`：新增示例题严格判断、只读用户示例题体验规则、有效管理员判断，以及统一的权限按钮隐藏逻辑。
- `src/60-question-bank.js`：训练操作按题目来源校验权限，深度回忆 payload 写入 `sourceBankId/sourceQuestionId`。
- `src/86-knowledge-recall.js`：深度回忆页接入角色权限，非授权题目会显示无权限提示。


## 微信扫码登录说明

本版本新增 `src/32-wechat-login.js`，在登录弹窗中提供“微信扫码登录”入口。由于当前项目仍是纯前端 localStorage 架构，微信登录分为两种模式：

- 本地演示扫码：用于原型体验，会创建/登录一个本地微信演示账号。
- 正式微信开放平台：在用户管理页配置 AppID、redirect_uri 和后端 code 换取 openid/unionid 的接口后，可跳转微信开放平台扫码授权页。真实上线时，AppSecret 与 token 交换必须放在后端完成，不能写在前端。

用户管理页新增“微信登录配置”面板，可设置是否启用演示扫码、正式微信模式、首次登录自动创建用户、默认角色和默认科目。

### 用户分页与题库列表体验优化

- `user-management.html`：新增 `umPagination` 分页控件。
- `src/35-user-management.js`：新增用户分页状态、分页渲染、当前页批量选择。
- `styles/user-management.css`：新增分页控件、用户序号样式。
- `src/65-question-bank-admin.js`：题库序号、题目双击跳转基本信息、试卷列表卡片数据结构。
- `styles/question-bank-admin.css`：题目列表滚动区、试卷横向卡片列表、题库序号样式。


## 整理文档

- `docs/SCRIPT_LOAD_ORDER.md`：记录第六步后的脚本加载顺序和新增页面时的加载约定。


## 订阅核心

- `src/37-subscription-plans.js`：订阅套餐模型、套餐展示设置、权益/用量文案、价格与折扣计算。
- `src/37-subscription-orders.js`：订阅申请、管理员确认开通、取消和删除。
- `src/37-subscription-redeem-codes.js`：订阅卡密生成、查询、启停、删除和学员兑换。
- `src/37-subscription-core.js`：订阅状态、权益校验、页面装饰和 `window.KGSubscription` 统一入口；当前套餐模型为 `free/monthly/quarterly/half_year/lifetime`，并兼容旧版 `free_student/basic_student/pro_student`。
- `styles/subscription.css`：订阅状态、锁定态和系统设置页套餐卡片通用样式。
- `docs/SUBSCRIPTION_MODEL.md`：订阅角色边界、套餐 ID、数据结构和后续接入建议。

## 订阅功能 UI 基础层（第八步）

- `src/37-subscription-plans.js` / `src/37-subscription-orders.js` / `src/37-subscription-redeem-codes.js` / `src/37-subscription-core.js`
  - 套餐、订单、卡密已拆分维护，最终仍由 `window.KGSubscription` 暴露统一 API。
- `src/33-user-center.js`
  - 用户中心展示“我的订阅”。
- `src/35-user-management.js`
  - 用户管理页提供学员订阅手动开通、续期、停用和免费设置。
- `src/36-system-settings.js`
  - 系统设置页提供订阅套餐展示配置。
- `styles/subscription.css`
  - 订阅状态、套餐卡片、用户中心订阅卡、用户管理订阅卡和系统设置订阅配置样式。
