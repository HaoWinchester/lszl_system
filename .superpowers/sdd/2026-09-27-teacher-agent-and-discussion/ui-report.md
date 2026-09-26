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

## 后续源预览与下载

新增按用户展开后才 GET upload.previewUrl 的来源预览（加载、失败重试、位置分组、lazy图片、原件下载）；正常任务轮询不读取原文。新增真实会话导出标准 JSON / 校验报告下载控件并在 Chromium 实际点击验证附件内容。题目包含实际后端 stemParts/analysis/correctOptionIds/reasoningSteps/metadata，原则包与合并预检可展开。需要核对的文档提供“已逐题核对原文与答案”按钮，仅用户明确点击后发送核对确认消息，由后端更新方案。

新增行为验证：来源读取失败/重试、未展开不拉取、图片 loading=lazy、真实点击两种导出下载、明确核对按钮。仍为 mock API Chromium 自检，不代表真实后端验收。

只读后端审查发现并已通知根任务：
- worker 第89–90行生成 metadata.sourceLocation/needsReview，但 import 第137–142行读取 source.location/顶层needsReview，非JSON方案阻断；根任务修复。
- worker 第140–142行忽略 execute_plan 返回 partial 并标 succeeded，service 第116行拒绝 succeeded 重试；根任务修复。
- import 第116行筛选触发词不含“恢复/保留”，旧selectedQuestionIds可导致排除无法撤销；import任务修复。
- Office图像只有文件名，worker第33行把名字交给模型；无图像内容/OCR不能理解图片题。根任务已授权本代理补 Office 图片 OCR。

## Office 图片 OCR 补齐

在现有 Office 提取模块局部扩展：图片原件仍按段落/幻灯片定位保存；逐图片通过已有受限 subprocess `_run` 调用 Tesseract chi_sim+eng，文字注入该来源片段并附 OCR 必须核对警告。最多 200 张图片，所有文本含 OCR 不超过 8 MiB；缺语言包、超限或 OCR 失败明确报错。未新增依赖。复用当前 parser 的文件、CPU、内存与超时限制。

实际检查：使用主工作区已有 backend/.venv Python 执行 `-m pytest tests/test_teacher_assistant_documents.py -q`，18 passed；包括真实图像 DOCX 与 PPTX Tesseract OCR、真实文字/扫描 PDF、缺语言包、OCR文本超限、图片数量超限，以及原有 XML/ZIP/宏/外链拒绝。这些是提取器实际工具测试，仍不代表真实模型/导入发布/UAT验收。

最新 Chromium 完整控件测试已通过，实际 JSON / 报告附件内容通过本地测试 HTTP 服务模拟验证（Chromium attachment 下载可能绕过 Playwright 路由，已将附件 fixture 移到本地测试 HTTP Handler）。Node 5/5 再次通过。

## 轻量状态、可读预览与保留期限

轮询改为 GET `/sessions/{sid}/status`，排队/执行期间只更新任务标识；只有方案 revision 改变或任务进入终态才读完整会话。消息完成明确显示“预览已更新”；预览显著区分私有草稿、待发布、已导入、已发布。旧 revision 回执不能禁用新方案或暗示新方案已发布。题目正文、中文题型、选项及正确答案、联想词/原则/解析采用可读排版；详细来源元数据折叠，完整内容仍可导出。回执链接使用服务器提供的具体 label，桌面两面板独立滚动保持对话与输入上下文。暂态网络错误显示中文恢复提示，状态恢复自动清除，业务错误仍保留。

新增 `teacher_assistant_retention.cleanup(db, now=None)`：每次最多20会话；30天未执行私人原件/解析缓存清理、上传标记expired、原会话/草稿保留并添加重新上传阻断及revision；任何执行任务、成功回执或活动任务/活动lease保护原文件；180天完整回执压缩为稳定业务ID与结果状态，保留任务操作键与payload。路径字符与resolve严格检查，拒绝目录symlink逃逸；不触碰发布内容资源。

Hybrid PDF 检查 embedded image 页（pdfimages）或少量 selectable text 的页并执行有界OCR，保留原可选文字并附OCR来源/核对警告，防止仅有页眉导致扫描题目漏识别。

最新验证：
- parser + retention 21项通过，含真实 PostgreSQL 保留期限/活动与执行保护/第二次清理幂等、目录逃逸拒绝，实际hybridPDF（可选Page1+扫描QuestionB789）OCR。
- Node 5/5通过。
- Chromium控制交互再次通过，新增无完整会话轮询、网络中断中文提示/恢复清除、中文可读选项答案、旧版本回执与新预览状态覆盖。

仍未把自动化自检当作用户UAT验收；根任务负责集成worker维护调度、同步产物与真实模型业务联调。
