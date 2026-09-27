# 教师持久对话与历史练习入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Tasks have independent source ownership; execute implementation tasks sequentially with task review.

**Goal:** ChatGPT 式教师对话界面连接服务器 Claude Code 持久 session，以实际流式消息和工具事件处理附件；修复3题历史试卷重进422。

**Architecture:** 复用 FastAPI 私有会话/任务、现有 worker 和导入服务；新增持久 Claude session 映射与数据库事件流，账号任务锁保证单个活动进程，文件工具限定本会话。前端保留授权API和回执业务，重排成聊天布局。

**Tech Stack:** 现有 Python/FastAPI/SQLAlchemy、Claude Code CLI stream-json、原生 HTML/CSS/JS、现有Office/OCR。禁止为界面引入新框架。

## Global Constraints
- 每账号最多一个活动 Claude Code 进程；跨标签、跨 worker 生效；切换须旧进程结束后才恢复所选 session。空闲释放、重启恢复同一 session ID。
- 模型 glm-5.3-flash[1m]，GLM Coding Plan，无按量回退；复用现有二进制和依赖缓存。
- 20MiB/文件、5文件/批、50MiB/会话、200页/文档、500题/计划；全局1个重任务。
- 原题答案/原则/联想词不擅改；权限、所有权、幂等、CAS与不可变发布继续复用已有服务。
- 源 new-legacy；仅 UAT，禁止 main/生产。成绩和评论保留。

### Task 1: 历史进入小试卷
Files: new-legacy/src/100-practice-mode.js 与现有 practice 浏览器测试；必要时现有公共适配服务。
- [ ] 读取 admin 唯一有成绩的3题会话，不改数据，复现 count10 ->422。
- [ ] 浏览器回归进入10题卷后从历史打开3题卷，断言进入请求 count<=3 且成功；完成并评论后退出重进。
```python
assert enter_request['count'] <= 3
assert page.locator('#practiceToast').inner_text() != '试题读取失败，请稍后重试。'
```
- [ ] 复用 selectPaper 同步，跑定向测试，提交并独立审查。

### Task 2: 持久 Claude session、限权工具与实时事件
Files: backend/app/services/teacher_assistant_model.py、teacher_assistant_service.py、worker/teacher_assistant.py、models/teacher_assistant.py、api/v1/teacher_assistant.py；新增职责单一 teacher_assistant_events.py、teacher_assistant_tools.py/stdio入口与相应迁移/测试。扩展既有 documents.py 图片能力。
Interfaces: 保留既有 sessions/messages/uploads/execute；新 GET /sessions/{sid}/events?after=<cursor> 返回 SSE `{id,jobId,type,data}`；新 POST /sessions/{sid}/activate 进行账号会话切换。session响应新增 runtime `{sessionId,active,status}`，不传主机路径。事件 type=status|text_delta|tool_start|tool_end|error|done。
- [ ] 先测跨账号404、同账号双会话并发受限、停止释放前不能新开、相同 session 恢复标识、SSE断线cursor恢复无重复。
```python
assert max_active_cli_for_owner == 1
assert resumed_cli_session_id == original_cli_session_id
assert other_actor_event_status == 404
```
- [ ] 模型新增自然对话流入口，CLI stream-json/include-partial-messages、持久 session ID/私有history/cwd，保留原 ask 给兼容测试或明确内部旧路径，主对话不得重复临时无状态调用。子进程与其工具进程退出后才释放账号/全局锁。队列等待/停止/失败事件来自真实生命周期。
- [ ] 首先做实际 CLI 套餐 streaming+resume 小验证，确认所用版本支持；不更新/下载 Claude Code。stdout有界逐行解析，不泄漏stderr；取消终止受控进程组。
- [ ] 文件工具提供 list_files、read_file（按上传id与页/偏移读取完整内容，大小受限）、read_image 与 prepare_import；限定 session owner。CLI 默认内置shell/任意文件读关闭，不开放宿主环境。若选用MCP stdio，复用现有Python实现限定协议，不安装无关运行时。生成预览复用build_plan，执行仍走execute_plan，不直接SQL改业务数据。
- [ ] 普通问答只读文件、不强制提取题目；JSON读取完整结构可分页，文档利用现有解析器，图片验证/OCR和视觉适配如实区分。题目提取由外层唯一agent完成，不能在其工具里再启动第二个Claude进程。
- [ ] 不让模型根据“我已上传”口头声明确认附件；每轮服务器传真实文件清单，无附件明确无附件。工具结果必须反映读取成功/失败。
- [ ] 持久事件限大小/条数，API分页/stream不常驻长DB事务；已完结会话刷新可恢复可见输出，删除/过期保护活跃进程与历史来源。
- [ ] 既有导入回归＋新增并发/stream/权限/文档问答测试，通过后提交和独立审查。记录真实模型与图像能力验证局限。

### Task 3: ChatGPT 式对话界面
Files: new-legacy/teacher-assistant.html、styles/teacher-assistant.css、src/teacher/teacher-assistant.js，现有助手tests和真实浏览器测试。
Interfaces: 使用 Task2 SSE 与activate；保留旧执行/导出/预览服务。
- [ ] 按 ChatGPT 官方页面布局：260px可收起侧栏，中央约760px消息，底部固定输入框、附件按钮/发送或停止；手机抽屉。使用本站品牌，不伪称ChatGPT；白灰中性色、系统中文字体，避免原永久双栏表单。
- [ ] UI选文件后即显示待发送附件；发送时先上传再消息，失败保留文本和附件，成功入对话文件卡。拖拽/粘贴图片共用同一入口。不得出现已选但没传却发送了消息。
```python
assert upload_request_finished_before_message_request
assert not assistant_confirmed_files_when_server_files_empty
assert mobile_scroll_width == 390
```
- [ ] streaming增量显示，真实文件/工具状态可折叠，发送立即可见“等待处理”，停止、中断、失败可恢复；切会话调用activate，旧SSE关闭，不串消息。
- [ ] 预览/回执入口放入聊天结果，按需打开侧面板/手机全屏，不暴露原始JSON主界面。
- [ ] 1440/390截图、附件立即发送、三轮普通问答、A/B切换、刷新/多标签、停止/失败和成果链接真实浏览器测试；逐项修复后提交并独立审查。

### Task 4: 集成与UAT验收
Files: docs/verification/2026-09-27-assistant-conversation-v2.md、deploy运行说明、生成产物。
- [ ] 独立代码审查；完整后端/前端/设计检查。
- [ ] UAT备份代码和数据库并验证；按既有脚本同步构建不可变release，核旧文件不丢，生成产物一同提交，代理推送uat。
- [ ] 部署后使用实际served release无源覆盖复测：3题历史进入、评论保留、聊天附件自然问答、真实stream与session切换、图片、进程数/内存。
- [ ] 记录通过和局限；等待用户UAT验收，不动main和生产。
