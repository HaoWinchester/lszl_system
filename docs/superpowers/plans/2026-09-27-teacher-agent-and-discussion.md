# 教师导入助手与答题后讨论 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 老师以连续对话上传 JSON/Word/PDF/PPT，预览并按权限导入/发布；学员答题后使用全屏互动弹幕和抽屉评论。

**Architecture:** 保留现有导入服务和评论数据，新增教师私有任务、文件与消息。独立 worker 通过服务器套餐配置的 Claude Code 调用显式模型，受限执行；前端仅轮询任务状态。讨论共享模块负责页面生命周期。

**Tech Stack:** FastAPI、SQLAlchemy/PostgreSQL、原生 JS/CSS、Claude Code、LibreOffice/Poppler/Tesseract。

## Global Constraints
- 依据已批准设计 `docs/superpowers/specs/2026-09-27-teacher-import-agent-design.md`，用户已于本轮授权实施全部功能。
- 模型 `glm-5.3-flash[1m]`，使用服务器现有套餐调用方式；不得自动切换普通计费 API。多轮对话历史由数据库保存；CLI 不授予 Shell/文件工具权限。
- 单文件 20 MiB、单批 5 文件且合计 50 MiB、单文档 200 页/幻灯片、单任务 500 题；初始全局 1 个重任务，每教师 1 个活动任务。
- 保留已有答案、原则与联想词；默认私有草稿；完整明确的直接发布指令才可直接发布。学员可见范围、免费与学习模式分开校验。
- 弹幕只出现在答题后解析和报告页，回忆与归纳画布不挂载；复用题目评论 ID；收藏可找回、回复可展开。
- 所有业务数据由数据库持久化，幂等、防重复点击、任务超时恢复、角色隔离必须真实验证。
- 权威源 new-legacy，发布脚本创建 active release；先 UAT，必须用户验收后才 main/生产。

### Task 1: 全屏弹幕与抽屉讨论
**Files:** 修改 backend/app/models/question_comment.py、services/question_comment_service.py、api/v1/question_comments.py、new-legacy/src/119-question-comments.js、styles/question-comments.css、src/100-practice-mode.js、src/113-practice-result-report.js；新增对应迁移和测试。
**Interfaces:** 兼容 list/create/like/delete；增加 parentId 回复、收藏 PUT/DELETE、个人收藏列表、分页 nextCursor；前端保留 KGQuestionComments.mountPanel/mountCard/mountCards，新增 teardown。
- [ ] 先补 API 测试：同一用户两次收藏只产生一条记录；另一个用户不能看到其收藏；刷新仍保留；回复只能归属同一题。
```python
assert first.status_code == repeated.status_code == 200
assert len(client.get('/api/v1/question-comments/favorites').json()['comments']) == 1
```
- [ ] 实现迁移/服务，旧评论不丢失；接口必须验证题目可访问，分页稳定。
- [ ] 全视口多轨弹幕，点击暂停后点赞/收藏/回复，开关记忆；空白区透传，关键按钮避让。抽屉手机底部拖动，桌面侧边，关闭恢复焦点，输入草稿不因点赞消失。
- [ ] 报告页只播放当前聚焦题目，切题/关闭解析清理；考试提交前零讨论挂载；收藏页能回到题目。
- [ ] 跑既有与新增评论 API/前端测试，记录失败修复与回归结果，提交。

### Task 2: 私有任务、文件解析与套餐模型适配
**Files:** 新增 backend/app/models/teacher_assistant.py、schemas/teacher_assistant.py、services/teacher_assistant_{service,documents,model}.py、api/v1/teacher_assistant.py、worker/teacher_assistant.py、迁移与 tests/test_teacher_assistant*.py；注册 models/__init__.py、api/v1/router.py，扩展 core/config.py。
**Interfaces:** /teacher-assistant/sessions GET/POST；/{id} GET/DELETE；/{id}/uploads POST multipart；/{id}/messages POST {content,requestId}；/{id}/execute POST {revision,requestId}；/{id}/cancel POST。会话含 messages/uploads/plan/revision/job/receipt；所有查询按 owner，admin 不读取其他教师私有内容。
- [ ] 写失败测试，教师跨 owner 404，学生 403，同 requestId 返回已有任务。
```python
assert other_teacher.get(f'/api/v1/teacher-assistant/sessions/{session_id}').status_code == 404
assert student.post('/api/v1/teacher-assistant/sessions',json={}).status_code == 403
```
- [ ] 数据库任务租约和重试回执；流式上传持久卷，类型、大小与压缩展开校验；私有来源下载。
- [ ] JSON 保留原结构；DOCX/PPTX 提取文本表格图片；旧格式隔离 LibreOffice 转换；PDF 分页文字提取，扫描页本地 OCR，保存来源位置与待核对项。
- [ ] 实现有超时的 CLI 模型适配，--bare --tools '' --strict-mcp-config --setting-sources '' --no-session-persistence；stdin 提供明确角色历史和文档数据，限制上下文；解析结构化结果，不执行模型任意工具。
- [ ] 独立 worker 逐任务执行，不在 FastAPI 启动解析或 CLI；失败能重试，超时终止整个子进程组。
- [ ] 单测真实格式样本、非法 ZIP、超限、会话隔离、模型错误与连续对话；提交。

### Task 3: 内容预览与受控导入发布
**Files:** 新增 backend/app/services/teacher_assistant_import.py，复用 question_service.py、paper_import_service.py、paper_release_service.py、content_prep 原则合并能力；必要的明确重复策略扩展只落服务公共入口。
**Interfaces:** build_plan(db, actor, sources, model_result) -> dict；execute_plan(db, actor, session, revision) -> receipt。计划按文件列出原文/规范化/AI新增、阻断项、重复策略、名称/角色/模式/费用，回执含真实对象 IDs 与链接。
- [ ] 用原 12+13 题样本写无损测试，单/多选、原则和联想词均保持，独立习题课副本不覆盖原题。
- [ ] 严格校验模型输出与来源，问题候选只能从授权库受限检索；缺失答案阻断相应文件。
- [ ] 复用服务完成题库/原则导入与试卷发布，稳定操作键，已成功步骤不重放；默认私有，明确指令和完整参数才发布。
- [ ] 测试旧 revision 409、响应丢失后回执恢复、部分成功、非法发布范围、无授权覆盖拒绝；提交。

### Task 4: 教师助手界面
**Files:** 新增 new-legacy/teacher-assistant.html、src/teacher/teacher-assistant.js、styles/teacher-assistant.css；教师内容入口增加导航；测试放 new-legacy/tests 与 frontend/scripts 对应契约。
**Interfaces:** 使用 Task 2 API；左会话右预览，手机切换；原导入入口保留。
- [ ] 先补行为测试：发送重复点击仅一次、失败保留输入、上传限制、会话恢复、revision 失效不能提交。
- [ ] 实现上传/连续对话/任务排队取消重试/来源预览/逐题检查/确认执行/实际结果链接/历史会话删除。
- [ ] 所有数据从 API 读取，错误不显示假成功；对话无需重新上传才能改名称、用途及发布范围。
- [ ] 与真实 worker 连续交互并验证权限，提交。

### Task 5: 部署与多轮浏览器验收
**Files:** deploy/ 独立 worker 配置和安装/运行文档，docs/verification/2026-09-27-teacher-agent-and-discussion.md，浏览器证据 artifacts/。
- [ ] 既有 backend tests、frontend pnpm test、design 与相关浏览器检查全部通过。
- [ ] 本地第一轮：真实界面 JSON 混合题导入、连续三轮需求修订、发布访问；第二轮：Word/PDF/扫描/PPT、无答案、断网和重复点击；第三轮：桌面手机弹幕点击、点赞收藏回复、拖动抽屉、跨题/刷新/切账号。
- [ ] 安装到 UAT 的 worker 复用套餐配置，独立用户/禁网文档转换、内存/并发限制、磁盘持久卷；明确后台健康与错误反馈。
- [ ] 合入 uat、代理 push 并核对远端，按 manage-new-legacy update 验证 release 文件数，部署 UAT 后重测至少两轮；不改 main/生产。
- [ ] 审查原需求逐条证据，记录通过与未通过项；请用户 UAT 验收。
