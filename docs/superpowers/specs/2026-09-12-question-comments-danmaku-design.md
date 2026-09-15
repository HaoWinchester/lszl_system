# 单题留言 + 弹幕功能设计

日期：2026-09-12
状态：已与用户确认（弹幕形态选 B · 解析区内嵌弹幕条）

## 目标

学员对单道题目存在争议时，可以在题目页留言、看别人的讨论，以异步方式增强学习交流感。不做实时聊天。

## 需求结论（已确认）

| 维度 | 结论 |
|---|---|
| 端 | Web（new-legacy）先做；后端 API 跨端通用，小程序后续接入 |
| 页面 | 练习模式页（100-practice-mode.js）+ 练习结果报告（113-practice-result-report.js） |
| 时机 | 做题中（未提交）不渲染任何评论 DOM；提交后随解析展示；报告页天然做题后直接展示 |
| 互动 | 点赞 + 删除自己的留言；不做回复/盖楼 |
| 管理 | 免审直接可见；admin/teacher 可删除任意留言 |
| 形态 | 解析框顶部内嵌横向滚动弹幕条（最多 8 条）+ 下方留言列表 + 发送框 |

## 技术方案：独立题目评论域（方案一，已确认）

评论直接挂题目全局 ID（questions.id），同一道题的讨论跨试卷、跨练习自然聚合。

## 数据模型（2 张新表）

### question_comments
| 字段 | 类型 | 说明 |
|---|---|---|
| id | String(64) PK | uuid hex，与现有表风格一致 |
| question_id | String(64) FK→questions.id，索引 | 题目 |
| owner_id | String(64) FK→users.username | 发言人 |
| content | String(500) | 前端限 200 字，后端兜底 500 |
| like_count | Integer 默认 0 | 冗余计数 |
| status | String(16) 默认 visible | hidden=软删（管理删除） |
| created_at | DateTime | 排序依据 |

### question_comment_likes
- comment_id FK + owner_id 联合唯一，防重复点赞；含 created_at。

## API（api/v1/question_comments.py，前缀 /api/v1/questions/{question_id}/comments）

| 方法 | 路径 | 权限 | 行为 |
|---|---|---|---|
| GET | / | 任意登录用户 | 最近 50 条倒序；含昵称、like_count、is_mine、my_like、danmaku_eligible |
| POST | / | 任意登录用户 | 发留言；空/超长 422；题目不存在 404 |
| POST | /{comment_id}/like | 任意登录用户 | 点赞（幂等） |
| DELETE | /{comment_id}/like | 任意登录用户 | 取消点赞 |
| DELETE | /{comment_id} | 本人或 admin/teacher | 软删置 hidden |

- 评论是公共讨论内容，读不限 owner（与 owner 隔离规则不冲突——隔离的是私有数据）。
- 写操作 commit 后 refresh（规避 async MissingGreenlet）。
- 弹幕取材：content ≤ 30 字的留言由后端标记 danmaku_eligible（他人留言优先），前端抽最多 8 条；不单独建弹幕数据，弹幕即留言的可视化层。

## 前端

### 共享模块 new-legacy/src/question-comments.js（新建）

`QuestionComments.mount({ anchorEl, questionId, source })` → 拉取留言，渲染弹幕条+列表+发送框；`unmount()` 供切题时释放。

- 弹幕条：CSS 动画右→左匀速循环；prefers-reduced-motion 降级为静态横滑。
- 列表：倒序 50 条，昵称/时间/内容/点赞按钮（高亮 my_like）/删除按钮（is_mine 或 admin/teacher）。
- 发送框：textarea 限 200 字 + 字数提示；401 走现有 kg:auth-required 机制。
- 样式落 new-legacy/styles/question-comments.css。

### 挂载点

1. `100-practice-mode.js` renderQuestion()：仅解析已渲染时，解析容器末尾挂载；切题时 unmount。
2. `113-practice-result-report.js` renderQuestionReview()：practice-review-card 内解析下方挂载。

### API 调用

模块内直接 `fetch('/api/v1/questions/<id>/comments', {credentials:'include'})`，与页面现状一致，无需新增适配器。

## 错误处理

- 网络失败/5xx：留言区显示轻量重试提示，不影响做题主流程。
- 401：派发 kg:auth-required 唤起登录框。
- 发送失败：保留输入内容，提示后可重发。
- 删除他人留言（后端 403）：前端按钮本就不可见，双保险。

## 测试与验证

- 后端：backend/tests/test_question_comments.py（发表/列表/点赞幂等/删除权限/401/404）。
- 前端：new-legacy/tests/ 浏览器测试（弹幕渲染、发送、点赞、删除、做题中不显示）。
- 契约：cd frontend && pnpm test。
- 发布纪律：正式发布走 manage-new-legacy.js update，且发布产物随源一起提交（本次先功能分支内验证，不发布）。

## 分支策略（已确认）

基于 codex/wechat-practice-miniprogram（含大量在途 WIP）拉出 feat/question-comments 开发，后续随 WIP 一起合入。
