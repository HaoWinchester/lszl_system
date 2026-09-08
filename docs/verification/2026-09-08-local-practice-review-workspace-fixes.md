# 2026-09-08 本地成绩回顾与多题归纳修复

本次仅供用户本地查看，未推送、未部署 UAT 或正式环境，未修改 active release 指针。

## 修改内容

- 成绩结算页新增连续展开的错题回顾，展示题干、选项、所选答案、正确答案和解析。
- 学习记录的“查看成绩”复用同一回顾组件，提供全部、答对、答错三项筛选和数量；默认显示错题，未作答题目仅进入“全部”。
- 多题画布在异步题目源加载完成后重新渲染卡片，同时按画布引用加载其他试卷的发布版本；题目查找同时匹配试卷与发布版本，避免同一道题的版本混用。
- 切换画布会重新检查所需题目源，保存数据继续通过原画布 API 写入数据库。

## 本地预览

- 做题与学习记录： http://127.0.0.1:5173/practice-mode.html
- 多题归纳： http://127.0.0.1:5173/question-workspace.html
- 本地 FastAPI 启动时将 `NEW_LEGACY_RELEASE_ROOT` 指向工作区内不存在指针的 `.local-review-release-root`，使用原服务已有 fallback 机制读取同步产物；未 promote release。
- 数据库已确认是本机 `/tmp` socket 的 `kg_graph_dev`。
- 运行 `cd frontend && pnpm sync:new-legacy` 后，预览与 active site 均为 983 个文件，文件集合一致，`admin-console.html` 存在。HTTP 返回的四个修改脚本/样式与权威源逐字节一致。

## 验证结果

- `cd frontend && pnpm test`：239 个 Node 契约测试、9 个 Python 契约测试、4 个 UAT 部署脚本隔离测试通过。这里的部署测试没有执行远程部署。
- `cd frontend && pnpm test:design`：5/5 通过。
- `node --test new-legacy/tests/practice-*.test.js new-legacy/tests/multi-question-*.test.js`：35/36 通过。一条既有失败来自 `multi-question-synthesis-fallback.test.js` 的 `/valid:false/` 源码断言；使用 HEAD 修改前的控制器内容重跑也失败，未修改这条断言或无关产品行为。
- 6 个浏览器脚本通过：`practice-result-report-browser.py`、`multi-question-demand-loading-browser.py`、`practice-answer-sheet-browser.py`、`practice-server-answer-browser.py`、`practice-mark-show-answers-browser.py`、`multiple-choice-practice-browser.py`。
- 新增回顾测试覆盖批量内容、多选题答案、空筛选恢复、HTML 转义；画布测试覆盖持久化引用先于异步题目返回、跨试卷恢复和请求失败重试。新增测试均确认在修复前失败。
- 本地真实数据库与浏览器验证：从学习记录打开已完成记录，全部 10 题、答对 2 题、答错 3 题；反复切换筛选及重新进入均一致。
- 本地创建临时画布，放入两份发布试卷的 40 道题（180 个选项），通过原 API 保存，再刷新、离开并重新进入，40 道题和 180 个选项全部恢复；临时画布已删除。
- 桌面 1440px 与手机 390px 截图检查通过，无横向溢出；本地页面检查无 JavaScript 异常。
- `git diff --check` 通过。

本次没有修改后端业务逻辑，没有运行后端完整 pytest，也没有将开发自检视为用户 UAT 验收。既有小程序和后端未提交修改保持原状。截图、运行日志及本地数据库浏览器验证脚本保留在工作区 `.local-review/`。

## 追加：错题集“放入当前画布”无反应

复现：当前选中一份试卷时，从错题集点击另一份已发布试卷的题目，点击后节点数量仍为 0，侧栏却关闭，页面无 JavaScript 报错。根因是 `addQuestionByReference` 仅搜索当前试卷的 `state.questions`，且错题侧栏不检查返回结果便关闭。

修复：复用发布试卷解析器，根据错题的试卷和发布版本按需加载，随后按完整题目引用插入，不切换当前选中的试卷。已存在的题目只定位；读取期间切换画布或账号会取消本次插入，避免误放。侧栏等待插入完成，按钮显示加载状态并防止重复点击；只有成功或定位已有题目后才关闭。来源撤回、不可用、权限不足和网络失败保留侧栏与错误提示。

验证：

- 修复前真实本地数据库 + 浏览器复现跨试卷插入无效；修复后同一路径创建 1 张题卡，经过原 API 保存并刷新后选项仍完整，临时画布已清理。
- `multi-question-learning-assets-browser.py` 覆盖失败不关闭、等待按钮禁用、网络错误恢复、重试成功关闭。
- `multi-question-demand-loading-browser.py` 覆盖尚未加载的跨试卷错题插入、不切换当前试卷、已有题目不重复、来源撤回不回退到其他试卷题目，以及跨试卷选项恢复。
- 以上两项及 `multi-question-batch-selection-browser.py` 通过；3 项相关 Node 契约测试通过。
- 再次运行 `cd frontend && pnpm test`：239 个 Node 测试、9 个 Python 测试和 4 项隔离部署脚本测试全部通过；`pnpm test:design` 5/5 通过。
- 已同步本地预览，HTTP 返回的两个业务模块与权威源一致；`git diff --check` 通过。本次仍未发布，未运行后端完整 pytest。
- 本地同步完成后，遍历当前账号全部来自可用发布试卷的待掌握错题，14 个不同题目引用均成功插入；重复入口不增加节点，保存并刷新后仍为 14 张卡片，无页面脚本异常，临时画布已删除。
