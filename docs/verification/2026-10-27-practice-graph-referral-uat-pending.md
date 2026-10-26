# 做题、图谱与付费推荐：UAT 发布待完成

开始：2026-10-26；状态记录：2026-10-27。用户已授权部署 UAT，尚未完成服务器发布。

## 当前状态

- 功能已合入并推送 `uat`，已核对远端引用：`30dee15ee937df247b135979e3f4fd2a344067c2`。
- `main` 保持 `c36ad7771cbff9b152a58f055fc976e14ecc9f8d`，未合入本轮功能。
- 待发布候选为 `v9.0-p4.1.401`；UAT 实际仍为 `v9.0-p4.1.396`，部署状态提交仍为 `bc3ff54ca840a4bb0e856fa358b552a70d47d3d5`。
- 正式容器仍为 `571424ef42f5e7d9790a5579ab2865acd59c4198f9ca691342fc6108c6e09a75`，镜像仍为 `sha256:a2360d53000007719b9c8fb3d67b8dd75dfd90485573c0401b0bb6a6e98e002f`。
- 原有未跟踪的 `docs/local-preview/`、`docs/promo/` 保留。使用独立发布副本 `artifacts/practice-graph-referral-uat/release-checkout/`，其后端虚拟环境链接复用本机现有依赖，没有安装新依赖。

## 已验证

- 前两轮完整验证的后端各 1261 项通过，包含推荐真实浏览器用例。前端全量 383 项与附属 Python、部署脚本契约也已通过。
- 新旧 site 对照：1243 → 1248 文件，无原有文件缺失，管理控制台等关键页面存在；新增为组合模块及四个专项测试文件。
- 401 的做题和视觉诊断流程全部通过：首屏、完整保存/续做/报告矩阵、答案位置、单选/多选/配对、评论、弹幕、更新后的大厅侧栏检查、知识星空多尺寸、真实评论 API、视觉比较。诊断级别是 `uat-fast`，仅用于提前排查，不替代本轮包含后端改动所需的 `full` 发布门禁。
- 大厅旧检查还要求被本次需求移除的重复记录面板，已更新 `practice_mode_initial_view.py` 和 `practice-lobby-fidelity-browser.py`，改验侧栏学习记录、收藏及评论分类，覆盖失败重试、手机导航和模式卡片。首屏与视觉检查均通过。该调整已提交在 `30dee15e`，未删除发布检查步骤。
- 一次性数据库诊断走通真实保存、续做、成绩回看；后续遇到原旧测试对知识星空旧 API 的等待超时，相关非发布必跑脚本的临时修改已撤回，未将整份诊断描述为通过。

## 发布门禁失败与外部阻碍

1. 399 包包含未跟踪测试缓存的源码指纹，与干净发布副本不同，拒绝同版本覆盖；准备 400 版。功能内容保持一致。
2. 第一轮：后端 1261 通过；前端 1 项因发布副本缺少 `artifacts/` 父目录而 ENOENT。补齐环境后原用例与全量前端通过。
3. 第二轮：后端 1261 与前端 383 通过；浏览器检查仍等待已按需求删除的 `#practiceRecentPanel`。更新入口检查后准备 401 版，相关检查通过。
4. 第三轮：1260 通过、模板库 1 项本地 asyncpg 连接超时；未 promote。随后完整模板库专项重跑 44 项全部通过。
5. 系统日志确认本机在校验期间反复 Maintenance Sleep / DarkWake，导致主动执行时间与实际墙钟时间严重脱节。第四轮在 `caffeinate -is` 下仍发生休眠及连接超时（`test_shortage_requires_repreflight_of_the_feasible_subset`）；阻止自动休眠的声明无法避免当前硬件休眠状态。已向用户请求唤醒并保持开盖运行。
6. 第四轮已有失败后，仅向该轮 pytest 子进程发送 SIGINT，保留失败与中断：549 通过、1 失败，退出 2。发布管理器记录失败，没有放宽门禁或伪造成功报告；校验进程已停止。

所有证据保留在 `artifacts/practice-graph-referral-uat/`，包括 `attempt1-*`、`attempt2-*`、`attempt3-*`、`attempt4-*`、`practice401-diagnostic.log`、`template-library-timeout-recheck.log` 和发布副本的 release 报告。

## 恢复执行

电脑稳定唤醒后，在发布副本先拉取当前 `uat`，确认工作区干净、权威源与 401 指纹一致，再运行完整门禁：

```bash
PYTHONDONTWRITEBYTECODE=1 caffeinate -is node frontend/scripts/manage-new-legacy.js update new-legacy --validation-profile full
```

必须确认报告 `passed=true`、`profile=full`、`skipped!=true`，然后在同一副本执行 `PYTHONDONTWRITEBYTECODE=1 bash deploy/update-uat.sh`。完整结果可由发布管理器按指纹复用，不能以此前诊断或分项结果代替。

上线后执行已准备的只读 `verify-public.py`、`verify-container.py`，核对公网页面版本、关键 JS/CSS SHA-256、UAT 容器全部文件、active 指针与迁移版本，以及正式容器/镜像/版本保持不变；再运行 `graph-groups-browser.py --served --base-url https://uat.aihuanpu.com`，其业务写请求由夹具接管。完成后更新正式发布记录并给用户 UAT 验收入口。

原“整合→最终绩效报告后心流及其他操作失效”尚未复现，仍需用户重点复测；真实微信扣款联调未进行。开发自检不代替用户 UAT 验收，未获用户明确验收前不进入 `main`，也不清理功能分支。
