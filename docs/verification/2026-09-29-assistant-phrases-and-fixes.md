# 测试缺陷修复与教学助手快捷话语

范围：修复多 agent 测试发现的三个问题，给教师工作台现有教学助手增加常用快捷话语和账号私有话语；仅本地开发，不部署 UAT/正式环境，不上传小程序。

实现：
- 小程序重开操作在打开确认弹窗之前置忙碌状态；取消、异常释放，避免排队确认和重复变更。使用真实 dialog controller 的回归覆盖重复点击、取消再试。
- 公共学习图标注册及 sprite 补齐 history、rotate-ccw；试卷管理按顺序加载现有 DifficultyService，并避免可选调用返回 undefined 时拼入文案。
- 助手输入框上方增加四条常用话语：梳理重点、检查题目、设计课程、解释难点。点击先追加到输入，保留已有草稿，不自动发送，不触发文件上传或模型任务。
- “管理我的话语”支持新增、编辑、删除和取消删除；最多20条，名称30字、内容2000字。文本用textContent与输入value渲染。
- 复用助手请求与用户模型，新增 users.assistant_phrases JSONB，通过角色受限的 GET/PUT quick-phrases API 读写。提交携带原账号标识，账号切换时拒绝保存到另一个账号。持久化在PostgreSQL，不在浏览器存储。
- Alembic ed50f24a8633 只已应用到本地 kg_experience_20260928。同步版本 v9.0-p4.1.263；正式环境尚未执行此迁移。

验证：
- `cd backend && .venv/bin/python -m pytest tests/test_assistant_phrases.py tests/test_teacher_assistant.py -q`：7 passed，覆盖权限、账号隔离、保存/读取、删除、空白/数量校验和原助手任务行为。
- `npm --prefix miniprogram test`：317 passed，包含新增重开防重复回归。
- `node --test new-legacy/tests/teacher-assistant.test.js new-legacy/tests/learning-focus-vega-icons.test.js new-legacy/tests/paper-management-api-contract.test.js`：10 passed。
- `pnpm --dir frontend test:design`：5 passed。
- `pnpm --dir frontend test` 最终：301 Node tests、9运行时契约、4部署脚本隔离检查全部通过，未触发真实部署。
- `python3 new-legacy/tests/assistant-phrases-browser.py`：真实Chrome、FastAPI与本地PG；7组，覆盖两处显示修复、默认话语追加、不自动发送、创建刷新使用、编辑失败503保留/重试、删除取消/确认、账号隔离、390px无横向溢出。临时账号全部在finally归档，未调用模型。
- 页面截图与日志：artifacts/learning-experience/phrases/。

前端全量首次检查发现内容准备工作室dist仍引用v262，新版本已为v263；按现有build.py重建并重新同步，不能通过修改断言跳过。最终全量301/301通过，结果见同目录frontend-final.log。

未验证：小程序开发工具服务端口仍关闭，未做模拟器和真机；本轮不测试模型回答质量、不执行真实发布任务，不代替用户UAT验收。

原有 `teacher-assistant-conversation-browser.py` 对话回归已通过（真实DOM、模拟API），覆盖附件、失败重试、SSE、多轮、切会话、刷新、停止、输入法与390px。已为旧测试传输桩补齐新增quick-phrases接口；首次旧桩未识别该路由导致IndexError，不属于产品失败。

原有 `teacher-assistant-browser.py` 亦通过，覆盖校验/方案/原文答案预览/执行取消重试/回执/移动结果面板/CRUD和角色门禁（模拟API，未执行真实发布）。
