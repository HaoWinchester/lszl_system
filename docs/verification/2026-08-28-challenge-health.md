# 180 题挑战血量修复验证

## 问题与修复

- 原恢复逻辑直接采用 `runtimeState.health`；180 题会话若保存了旧值 3，会显示 3/54 并在再错三题后失败。新增浏览器回归在修改前以 `AssertionError: 3/54` 失败。
- 挑战无回血，恢复时由既有草稿模块重判保存答案，按 `max(3, ceil(实际题量 × 30%)) - 已答错题数` 计算剩余生命（最低 0）。学霸保留自己的回血和超时规则。
- 原入口只按试卷匹配旧会话，忽略新选择的题量；现在正常进入与 409 恢复共用题量校验。题量不一致须明确确认放弃旧练习后再新建；取消不修改旧会话，放弃失败不发起新建。
- 将失败判定放到末题提前返回之前，覆盖第 54 次答错恰好在末题的情况。

未修改共享开发库内已有练习记录。真实 API 验证使用独立临时 PostgreSQL 数据库，结束后已清理。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `python3 new-legacy/tests/practice-challenge-health-browser.py` | 通过：10/20/60/180 题选择，3/53/54 错题边界，旧血量、缺血量、正常低血量恢复，保存恢复，末题失败，继续作答，学霸兼容，题量冲突取消/确认，网络失败，409 恢复 |
| `python3 new-legacy/tests/practice-challenge-loading-browser.py` | 通过 |
| `python3 new-legacy/tests/practice-server-answer-browser.py` | 通过 |
| `python3 new-legacy/tests/practice-answer-sheet-browser.py` | 通过 |
| `python3 new-legacy/tests/practice-result-report-browser.py` | 通过 |
| `python3 frontend/e2e/practice_resumable_report.py` | 10 组真实 API / 浏览器流程通过，包括保存、重新登录恢复、交卷、学霸超时、复仇、owner 隔离和响应式布局 |
| `cd backend && .venv/bin/python -m pytest tests/ -q` | 607 passed；1 条既有 python_multipart 弃用警告 |
| `cd frontend && pnpm test` | 267 passed |
| `cd frontend && pnpm test:design` | 5 passed |
| `python3 new-legacy/content-prep-studio/build.py`、`pnpm --dir frontend build` | 通过；同步版本与 seed |
| `node --test new-legacy/tests/*practice*.test.js` | 20 passed，1 条既有静态契约失败（见下文） |

额外使用现有 E2E 的隔离数据库、release builder 和 fixture 生命周期执行真实 180 题场景（临时驱动脚本 `/tmp/lszl-challenge-180-api-e2e.py`，日志 `/tmp/lszl-challenge-180-api-e2e.log`）：

```text
real-api-180 wrong=3 health=51 dialog=False
real-api-180 wrong=53 health=1 dialog=False
real-api-180 wrong=54 health=0 dialog=True
```

该场景通过真实 API 写入测试会话的旧 health=3，刷新恢复到 54；作答三题保存后重新加载保持 51。截图 `/tmp/lszl-challenge-180-threshold.png` 已目视检查：答题卡 54/180、血量 0/54、挑战失败弹窗，点击继续后可继续作答。临时测试未替代仓库中持久化的挑战血量回归测试。

## 既有失败与范围

`v90-p43-practice-library-integration.test.js` 仍要求源码页面直接加载 `src/59a-paper-learning-modes.js` 等旧脚本；源码页已经不包含该脚本。该测试及它唯一读取的 `new-legacy/practice-mode.html` 相对修复前 HEAD 均未变更，因此这条失败不由本次修改引入，未通过修改测试绕过。

未运行整个项目所有历史浏览器脚本；运行了上述相关浏览器/API 流程与设计契约。

## 发布

- 使用 `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser`，未手工复制 active release。
- 从 v9.0-p4.1.183 升至 v9.0-p4.1.184。
- 发布前原 active 与同步候选均为 972 文件，文件路径集合一致，关键页面 admin-console.html / practice-mode.html 及公共草稿模块存在。
- `--skip-browser` 仅执行发布器文件门禁；API、浏览器、设计与全量测试由以上命令单独执行，不将跳过验证标记当作测试通过证据。
