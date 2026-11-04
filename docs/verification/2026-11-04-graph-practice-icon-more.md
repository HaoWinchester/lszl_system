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
