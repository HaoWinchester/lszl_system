# 弹幕设计图落地 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 将用户批准的GPT弹幕稿落到现有共享模块，验证交互和像素差异后发布UAT。

**Architecture:** 共享讨论模块负责组件结构和定位；CSS负责皮肤及响应式；既有公共图标模块扩展线性符号；服务端业务不变。只在当前工作区功能分支写入。

### Task 1: 组件、定位与回归

- [x] 新增 tests/danmaku-design.test.js 和 danmaku-design-browser.py，证明现有实现缺头像/关闭/线性动作和边界定位；先红后绿。
- [x] 扩展 src/107-learning-ui-icons.js、assets/icons/lucide-learning.svg 的 pause/eye-off/ellipsis，保留现有图标契约。
- [x] 修改 src/119-question-comments.js 的弹幕条/互动浮层，复用头像/安全转义/时间和图标，关闭/Esc和更多展开重定位；现有API行为保持。
- [x] 局部整理 styles/question-comments.css 中重复弹幕规则，防全局按钮样式覆盖；桌面/手机/reduced-motion/hover/focus状态真实检查。
- [x] 原评论、讨论抽屉、侧栏、收藏浏览器和Node契约回归通过；独立审查后修复复测。

### Task 2: 真实数据与设计对照

- [x] 使用隔离PostgreSQL/FastAPI和Chrome验证点赞/回复/收藏/隐藏、失败恢复、换题和权限，避免UAT测试写入。
- [x] 固定原稿文案/作者/时间和动画帧，截图同尺寸组件参考框，生成无遮罩对照/差异图与指标，逐项检查样式、圆角、头像和动作间距。
- [x] 设计原图、提示/工具记录、实际截图及剩余差异可追溯，页面源与发布视觉校验单独列出。

### Task 3: 发布

- [x] 同步源/适配层、版本/seed/manifest；与当前active核对文件清单和关键页，按改动范围运行标准候选门禁。
- [x] 合入uat、代理推送并核对引用，标准update-uat.sh部署；容器实际指针、公网资源与样式检查。
- [x] 提交发布记录，工作区干净，main/uat永久分支保留，等待用户UAT。
