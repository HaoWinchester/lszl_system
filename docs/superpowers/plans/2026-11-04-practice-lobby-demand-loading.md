# Practice Lobby Demand Loading Implementation Plan

> **For agentic workers:** Use subagent-driven-development for isolated backend implementation and review. Shared frontend integration is performed in this session. Steps use checkbox syntax for tracking.

**Goal:** 大厅仅请求当前需要的摘要与代码，稳定首屏布局，保持学习功能并部署 UAT。

**Architecture:** 复用发布目录与原生前端，采用分页摘要、功能资源组和稳定占位。公共加载入口负责去重、顺序、版本和失败重试；现有业务模块保持权威。

**Tech Stack:** FastAPI / PostgreSQL / SQLAlchemy async / 原生 JavaScript / Node test / Playwright。

## Global Constraints

- 仅在当前工作区写入，不安装无关依赖；new-legacy 是权威源。
- 复用现有模块、权限和 owner 隔离；不使用浏览器持久化业务数据。
- 只部署 UAT；main 与 uat 永久保留，用户验收前不合 main。
- 已有 docs/local-preview 与 docs/promo 未跟踪文件保持原样。

### Task 1: 目录字段与查询

Files: backend/app/services/paper_release_service.py, backend/app/api/v1/paper_releases.py, backend/tests/test_paper_releases.py。
Interface: GET /api/v1/paper-releases/catalog 支持可选 mode=practice_mode，保留 page/pageSize/search/subject/access；返回 releases/subjects/total/page/pageSize。
- [ ] 增加失败测试：目录不含 metadata/sourcePayload/题目/答案；mode 过滤、分页、角色可见性和 coverage 正确。
- [ ] 直接字段投影摘要，查询不读冻结正文；只对当前页取 coverage。
- [ ] 跑定向测试并提交独立后端文件，审查字段与权限兼容性。

### Task 2: 大厅数据分页

Files: frontend/scripts/new-legacy-assets/paper-release-adapter.js, new-legacy/src/100-practice-mode.js, corresponding existing adapter tests。
Interface: adapter 增加 queryCatalog({page,pageSize,search,subject,access,mode}) 与 catalogPage() 元数据；原其他页面接口保持兼容。
- [ ] 增加失败测试证明大厅不循环取全量，搜索/筛选/更多按需读取并拒绝过期响应。
- [ ] 首屏读取 12 条，更多页按需，筛选由服务器执行，科目来自全目录 facets。
- [ ] 保留历史会话按 releaseId 查详情，当前目录页之外的已选试卷不凭空丢失。

### Task 3: 功能脚本与样式

Files: new-legacy/src/feature-assets.js, practice feature loader, practice-mode.html, existing bundler/sync tooling, 100-practice-mode.js。
- [ ] 写失败测试：功能加载并发去重、依赖顺序、失败可重试；大厅请求中无答题/成绩/评论/账号大模块。
- [ ] 复用构建器生成首屏与按需资源组；按实际入口等待功能加载并执行原行为。
- [ ] 动态模块在 DOM 已就绪时初始化；清理大厅无用题库 bootstrap；非当前界面不读取历史、收藏和管理数据。
- [ ] 测试登录、微信、会员、账号、记录/收藏、开始/继续/提交/成绩和失败恢复。

### Task 4: 布局与性能门槛

Files: practice-mode.html, styles/practice-mode.css, existing browser tests and new demand-loading browser checks。
- [ ] 初始 data-practice-view=lobby，固定目录与配置占位尺寸。
- [ ] 记录布局偏移，桌面/手机用延迟 API 检查主导航和模式卡位置稳定。
- [ ] 比较 v412 的 54 外部脚本、首次约 4 秒、缓存后目录约 1.3 秒与布局移动基线。

### Task 5: 回归、发布与记录

- [ ] 独立审查实际 diff，修复发现的问题；跑前端、设计、后端定向与浏览器检查。
- [ ] 递增 VERSION、同步、生成内容；提交源、产物和验证记录。
- [ ] 合入 uat，使用命令级 http.proxy=http://127.0.0.1:7897 推送并核对远程引用。
- [ ] bash deploy/update-uat.sh 执行完整校验和发布；核对文件增减、关键页面、健康状态和公网页面。
- [ ] 复测公网性能与按需加载，记录结果；保留功能分支等待用户 UAT 验收。
