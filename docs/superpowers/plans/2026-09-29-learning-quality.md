# Learning Quality Implementation Plan

> **For agentic workers:** Use subagent-driven-development for independent deliverables and review before completion.

**Goal:** 实现已批准的短练报告、当前发布统计、发布前完整性清单。
**Architecture:** 扩展既有服务端报告和发布校验；网页/小程序消费统一结果；统计使用当前状态。
**Tech Stack:** FastAPI / SQLAlchemy / native JavaScript / mini-program TypeScript.

## Global Constraints
- 仅在当前功能工作树写入；不推送、不部署 UAT/main。
- 新前端业务改动写源，最后统一同步。
- 不安装依赖，使用既有数据库权限和校验模块。

### Task 1: Report semantics
- [x] 阅读 practice_session_service build_report、113-practice-result-report、mini result 的当前数据合同。
- [x] 先补失败测试：短练不判通过、空领域未评估、完整模拟保留；运行定向测试。
- [x] 最小实现共享服务端类型/展示数据；网页小程序一致，兼容旧报告。
- [x] 运行报告和练习回归，记录证据；审查。

### Task 2: Teacher counts
- [x] 测试发布→撤回保留历史版本、归档和删除的统计。
- [x] paperPublished 使用当前 published 状态，保留已有排除条件。
- [x] 运行工作台测试；审查。

### Task 3: Publication checklist
- [x] 检查现有 publish/publish-payload、validator、教师发布弹窗和编辑路由。
- [x] 先补失败测试：单/多选/配对缺答案、解析；权限；重试。
- [x] 共用服务端校验输出结构化题目问题；发布重新校验；界面列清单并跳编辑。
- [x] 按实际语言配置检查，无配置不强迫英文；既有发布内容不回写。
- [x] 运行发布与题型回归、前端测试；审查。

### Task 4: Integration
- [x] 合并检查任务结果；统一同步本地源产物，不 promote。
- [x] 启动本地服务，真实浏览器验证三项及手机布局。
- [x] 更新验证记录，提交本地改动，反馈预览及验证边界。
