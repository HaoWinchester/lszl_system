# 多题画布跨标签页闪烁排查（本地修复，未部署）

用户要求先不部署，直接检查已经打开的 UAT 页面。运行版本为 v9.0-p4.1.254。

## 现场证据

- 原页面空闲 3 秒：选中卡片 style 更新 136 次、class 更新 92 次，world 更新 34 次。
- 卡片 DOM 重建调用链：storage 回调（77-multi-question-workspace.js:5633）→ rebuildQuestionSources → renderCards。
- 2 秒内跨标签页事件：试卷选择偏好 5 次、发布版本选择偏好 5 次，另有学习会话更新 17 次。
- 用户同时打开多份试卷。storage 回调通过 key.includes('question') 粗略匹配，误把 kg_multi_question_paper_selection_v1__* / kg_multi_question_release_selection_v1__* 当成题库更新；重建又执行 savePaperSelection，各标签页写回自己的选择形成循环。
- 初次 agent-browser 连接重试导致多次调试授权提示，已停止本次连接进程。后续使用原生 Chrome 开发者工具检查，没有再次建立 CDP 连接。只读观察结束后已收起开发者工具，没有关闭用户标签页或修改题目数据。

## 修复

在权威源 new-legacy/src/77-multi-question-workspace.js 中，将 storage 监听范围收紧到发布目录与发布历史两个明确的数据键，与已有 kg-app-storage-change 监听保持一致。试卷选择、界面偏好、其他包含 question 的键不再触发卡片重建。

深度回忆的原生 storage 监听仅处理联想词库前缀，不存在相同的宽泛匹配，因此本次未修改该页。

## 浏览器回归

复用现有 disposable PostgreSQL/FastAPI 测试服务器，增加可选 --multiple-papers 数据夹具。独立的本地 Chrome 使用隔离账号，不连接用户浏览器。

运行方法（先执行 node frontend/scripts/sync-new-legacy.js）：

```sh
backend/.venv/bin/python new-legacy/tests/helpers/canvas_ink_server.py --multiple-papers --port 5197
python3 new-legacy/tests/workspace-multitab-browser.py --base-url http://127.0.0.1:5197
```

修复前：断言失败 `A foreign paper preference replaced the selected card`。

修复后通过：

- 其他标签页写入试卷选择偏好，不重建选中卡片。
- 两个真实画布页面分别打开不同试卷，空闲观察期间两个页面卡片替换次数均为 0；各自保留正确试卷和 1 张选中卡片。
- 发布目录、发布历史确实变化时，仍正常刷新另一页面。
- 页面无未捕获 JavaScript 错误。

证据：artifacts/canvas-flicker/multitab-before.log、multitab-after.log。

现有检查：frontend/pnpm test 通过（280 项 Node 契约、9 项 Python 契约、4 个 UAT 部署脚本夹具）；git diff --check 通过。首次检查指出重复声明旧存储键，已将两处监听统一调用页面内现有判断，再次完整运行通过。日志：artifacts/canvas-flicker/frontend-tests.log。隔离测试服务器已正常退出并清理临时数据库。本次未改后端业务逻辑，未运行后端全量测试。

尚未在部署后的 UAT 验证本次修复；没有执行部署或 promote，用户原页面仍运行旧版本。此前尚未部署的画笔 hover 修复一并保留在工作区。
