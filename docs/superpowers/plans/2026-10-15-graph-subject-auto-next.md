# 图谱科目匹配修复与普通练习自动切题 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 修复 UAT 图谱科目描述与题库代码不一致导致零匹配；按用户明确要求，普通练习关闭实时反馈时作答约 0.5 秒后进入下一题，验证后部署 UAT。

**Architecture:** 后端只在现有批量匹配 service 规范化图谱科目路径的第一段，大小写/空白兼容，保留跨科目过滤。前端在既有共享模式 policy 中定义 autoAdvance，在既有反馈定时器和切题入口消费，避免新的计时体系；手动导航、重新开启反馈和退出时取消待执行切题。多选/配对确认后触发，末题保留原有完成与结算逻辑。

**Tech Stack:** FastAPI/SQLAlchemy/PostgreSQL、原生 JS、现有 pytest/Node/Chrome fixture。

### Task 1: 科目匹配

- [x] 扩展 backend/tests/test_graph_question_batch.py：PMP 描述路径、标准代码、空白/大小写及 PMI-ACP 隔离；证明当前失败。
- [x] 局部修改 backend/app/services/graph_question_batch_service.py 的 subject 查询条件；定向 API 回归通过。
- [x] 只读 UAT 数据复现，验证真实图谱科目和卡片有候选，不写业务数据。

### Task 2: 自动切题

- [x] 扩展 new-legacy/tests/practice-instant-feedback.test.js 和 practice-instant-feedback-browser.py，证明关闭反馈后未在约500ms切题的失败。
- [x] 扩展 src/115-practice-mode-policy.js 的 autoAdvance 与 src/100-practice-mode.js 的已有 timer/nav；补充开关说明，保持成绩与其他模式语义。
- [x] 浏览器覆盖单选/多选/配对、确认前不跳、开启不跳、手动导航/重新开启/退出取消、最后一题不越界；原显示答案/标记与练习回归通过。

### Task 3: 用户补充：科目下拉与大厅样式

- [x] 批量弹窗增加匹配科目下拉，默认 PMP，列表来自服务端现有有效题目的科目；切换使旧预览失效。API 接受显式 subject，规范化后写入签名预览；兼容旧客户端无参数时使用图谱科目。
- [x] 测试科目列表角色、默认值、PMP/ACP 隔离与覆盖图谱描述、空值/失败/重试和切换后预览作废。
- [x] 按用户指定修复大厅学习记录/收藏标签与行操作的全局样式覆盖；对照原批准 UI 稿生成实际页面比较及像素差异证据，动态数据限制如实记录。

### Task 4: 发布

- [x] 递增版本，标准管理器同步并执行 full 发布门禁；检查 active 与候选文件数和关键页。
- [ ] 合入 uat、代理推送并核对引用，标准 deploy/update-uat.sh 部署；实际容器/公网页面与资源核验。
- [ ] 发布记录与工作区干净，main 不变，等待用户 UAT 验收。
