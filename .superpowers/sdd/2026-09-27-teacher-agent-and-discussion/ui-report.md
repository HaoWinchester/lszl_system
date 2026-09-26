# 教师助手 UI 实施报告

新增 `new-legacy/teacher-assistant.html`、职责独立的 `src/teacher/teacher-assistant.js` 和 `styles/teacher-assistant.css`，教师工作台一级工作导航新增“文件整理助手”。保留手工入口。

桌面双面板，窄屏对话/结果标签。所有业务数据从 `/api/v1/teacher-assistant` 加载；通过 `/api/v1/auth/me` 校验教师/管理员，服务端仍负责真实授权。支持历史、新建、删除、文件批量上传、连续需求修订、方案版本、配置/阻断/警告、来源原件/提取片段、展开题目选项答案及联想词、AI新增标记、实际任务状态、当前版本执行、取消、重试及实际回执链接。仅 queued/running 轮询；失败保留输入并先查询会话状态，不伪造成功。

幂等键跨网络失败、浏览器刷新重用。`sessionStorage` 例外仅保存短期不透明 requestId（键为会话/动作/载荷身份的哈希），不存消息、文件、方案、用户资料或结果；成功即清除。所有内容呈现用 textContent，回执链接限定同源 http(s)。

使用 frontend-requirement-quality-gate 的行为覆盖与数据库真源原则，未生成同步产物/发布/部署，未改后端。

## 已验证

- `node --check new-legacy/src/teacher/teacher-assistant.js` 通过。
- `node --test new-legacy/tests/teacher-assistant.test.js`：5/5 通过（服务端读写、版本/请求键、丢响应与刷新重试、并发阻止、上传格式/数量/大小、multipart、worker失败、取消重试删除）。
- `python3 new-legacy/tests/teacher-assistant-browser.py`：真实 Chromium 交互通过（API mock）：上传/空文件、3轮修订、失败输入保留、原文/多选答案/关联/AI建议、注入转义、阻断禁执行、执行/取消/重试、部分失败回执及链接、刷新读取、390px标签、新建历史删除、学生权限。
- `git diff --check`（本次 UI 文件）通过。

## 需要集成验证

- 上述浏览器用 API mock 验证 UI 行为，不代表模型、worker、真实素材准确性或 UAT 业务验收。
- 全仓库检查与真实 API/worker 联调由根任务集成后统一运行。
- 后端 upload.sections 为可选能力；未返回时只显示原件下载与方案来源定位，不编造原文。
- 当前接口输出的枚举/回执结构以实际后端为准；未识别值仍清楚展示服务器原值。
