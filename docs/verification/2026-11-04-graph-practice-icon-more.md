# 卡片做题入口与大厅导航

- 需求：启用卡片详情做题入口，用图标代替文字；题目抽屉底部增加 `more`，进入做题大厅。
- 实现：复用 `graphPracticeBtn` 与公共题目抽屉；入口保留“做题”可访问名称和提示；底部链接位于滚动区外，指向 `practice-mode.html`。
- 不增加题目 API 或持久化状态；无文件时沿用禁用逻辑，关联题目访问与批改沿用后端权限。
- 前端完整检查：`cd frontend && pnpm test`，383 个 Node 检查通过、9 个 Python 契约通过、4 个部署脚本检查通过。
- 设计检查：`cd frontend && pnpm test:design`，5 个通过。
- 定向检查：`node --test frontend/scripts/graph-question-drawer.test.mjs frontend/scripts/design-contract.test.mjs`，6 个通过；JS 语法与差异空白检查通过。
- 隔离 PostgreSQL 浏览器检查：`python3 new-legacy/tests/graph-question-drawer-browser.py`，真实点击图标，老师/管理员/学生/会员/访客，维护题目、三种题型、权限、错误重试、空题、全屏与手机端通过；学生和会员在手机端点击 more 后做题大厅可见。
- agent-browser 另行从卡牌点击做题，再点击底部大厅链接，确认目标 URL 与大厅控件。
- 发布前本地 active v405 为 1250 个文件；候选新增 3 个既有测试文件，无文件删除，关键 admin-console 页面存在。
- UAT 业务验收仍需用户本人执行。本次不合入 main。

## UAT 发布结果

- UAT 已发布 `v9.0-p4.1.412`，部署代码提交 `8d5184df`；公网地址 https://uat.aihuanpu.com 。
- 发布管理器完整校验通过：后端 `1290 passed`，前端 383 项通过，以及扩展契约、整站浏览器和视觉回归全部通过。完整校验耗时 1913 秒，部署总耗时 2020 秒。
- 额外提交并发/重试浏览器回归通过。首次复用维护测试后的夹具导致老师关联数为 4，而并发测试要求初始 3 题；还原隔离夹具后通过，未修改产品行为或降低断言。
- 发布后独立通过 HTTPS 核对公网页面版本、可访问图标入口、底部 more 链接、真实做题大厅和 API 健康状态。
- `uat` 已推送；`main` 保持 `6941af5c`，未合入。功能分支保留至用户 UAT 验收与 main 集成后再清理。
- 原有未跟踪目录 `docs/local-preview/`、`docs/promo/` 未纳入提交；发布时仅通过命令级 Git 忽略规则排除其脏工作树检测，未修改或删除这些文件。
