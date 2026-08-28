# 做题模式、解析与经验结算验收

日期：2026-08-28。目标版本：`v9.0-p4.1.186`。

发布范围更正：16:18 的 promote 仅更新本机 `127.0.0.1:5173`，当时公网 UAT 仍为 `v9.0-p4.1.183`。此前将本机发布表述为“测试环境已发布”不准确。下面分别记录本机验证和 17:18 完成的公网 UAT 部署核验。

用户随后授权先备份再部署正式站，17:35 正式站已更新为同一版本。备份、恢复演练及公网核验详见 [正式环境 v186 部署记录](2026-08-28-production-v186-deployment.md)。

## 实现范围

- 普通练习恢复为 `practice` 会话：从学习记录“进入练习”进入，保留独立“查看成绩”，没有生命或计时限制；同轮答案锁定，按现有题量与顺序设置开始或恢复。
- 挑战/学霸作答、回看、切语言与超时均不展示解析；没有手动交卷入口，兼容 DOM 点击也受模式策略约束。全卷答完自动结算，学霸生命归零结束。
- 普通练习使用一个“显示解析”开关，仅已答题可见解析；删除动态“查看解析”按钮。完成后可只读回看全部题目。
- 选择答案、切题、切换标签与取消离开确认不保存。保存退出、结束本轮、正常关闭和完成统一保存整卷；关闭补发沿用在途意图。
- 经验由服务端冻结快照重算，按差额入账；暂停/结束本轮也入账。行锁、revision 和稳定事件 ID 防重复。公开事件接口禁止伪造经验事件，历史清理不回收已获经验。
- 已完成旧会话迁移建立一次性基线，保留原日期；旧活动会话不擅自完成。迁移 `a8c1d4e7f920`。
- 保存过程中冻结学霸超时判题；往返缓存恢复期间冻结操作并读取 revision。已答满却在结算前关闭的会话恢复后自动结算。

## 自动化证据

| 命令 | 已核验结果 |
| --- | --- |
| `cd backend && .venv/bin/python -m pytest tests/ -q` | 614 passed；1 条既有 python_multipart 弃用警告 |
| `pnpm --dir frontend test` | 268 passed |
| `pnpm --dir frontend test:design` | 5 passed |
| `node --test new-legacy/tests/practice-session-core.test.js new-legacy/tests/practice-session-save.test.js new-legacy/tests/practice-draft-state.test.js frontend/scripts/practice-learning-contract.test.mjs` | 21 passed |
| `node new-legacy/tests/v90-p40-practice-mode.test.js` | 通过 |
| `python3 new-legacy/tests/practice-answer-sheet-browser.py` | 普通练习、开关、自动结束及失败重试、隐藏提交事件拦截、历史手机布局 |
| `python3 new-legacy/tests/practice-challenge-health-browser.py` | 180 题、3/4/53/54 错误边界、保存恢复、末题失败结果、题量切换确认、保存期间不新增超时 |
| `python3 new-legacy/tests/practice-challenge-loading-browser.py` | 开始/保存/结束/报告/复仇提交加载及失败重试 |
| `python3 new-legacy/tests/practice-server-answer-browser.py` | 作答本地即时判定、自动完成 |
| `python3 new-legacy/tests/practice-result-report-browser.py` | 冻结报告、只读回看、经验与普通练习全部回看入口 |
| `python3 frontend/e2e/practice_resumable_report.py` | 15 组场景；独立 PostgreSQL 库、随机端口后端、临时候选 release，退出后清理 |

真实 API 矩阵涵盖：作答零写入、整卷暂停、重登录恢复、最后题先答不提前完成、全卷自动完成、后端权威报告/错题、学霸超时、复仇回归、owner 隔离、重复保存拦截、1280/1024/768/390 布局、普通练习解析、切标签与取消关闭零保存、实际关闭标签页落库、刷新落库、重复 pagehide、模拟 bfcache 生命周期的 revision 对齐、满卷草稿恢复、完成在途与关闭竞争。

经验实测：普通练习先退出入账 10，继续后关闭累计 20，刷新累计 30，重复关闭累计 42，结束本轮累计 54；账户总经验仅增加 54。完成在途关闭补发相同 complete 载荷，不发送 pause，服务端维持 completed。

发现问题时先保留失败用例再修复：伪造经验事件、暂停后新增答案、动态解析按钮、恢复满卷停滞、结果页丢失挑战判定、保存期间新增超时、隐藏提交按钮绕过策略、手机学习进度被旧 CSS 隐藏。

## 本机发布检查（不是公网 UAT）

- 主目录预发布候选 975 个文件；原 active 972 个文件。逐项核对路径集合，零文件丢失。独立工作树候选为 973 个文件，差异为下面的两个 Finder 元数据。
- 新增且仅新增：`src/115-practice-mode-policy.js`、`src/116-practice-session-save.js`、`tests/practice-session-save.test.js`。
- 工作树不含 `.DS_Store`、`assets/.DS_Store` 两个 Finder 元数据；主目录正式候选保留原有两文件。没有将本地 Python 编译缓存发布。
- `admin-console.html`、做题页及共享模块存在；正式 promote 继续使用项目发布工具，不手工覆盖 release site。
- 本机开发数据库已备份至 `/tmp/lszl-before-practice-v186-20260828.dump`（600 权限，已验证归档可读）；停旧后端后执行迁移，新后端健康检查通过。原有 4 份已完成会话均已建立经验基线。该备份不属于 UAT。
- 已通过 `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser` 正式 promote；`current.json` 指向 `v9.0-p4.1.186/site`，时间 2026-08-28 16:18:30（北京时间）。该命令执行文件门禁；API、浏览器与视觉回归由上列独立测试完成，不将 skip 标记当作浏览器测试通过。
- 正式 active 与预发布候选的 975 个文件逐个 SHA-256 完全一致。HTTP 的 8 个关键静态资源与 active 一致，6 个 JS 业务模块同时与权威源一致。HTML 版本正确，差异仅为已核对的服务端游客首屏与 direct-bootstrap 注入。
- 实际 5173 做题页面加载新策略和保存模块，无 JavaScript 页面错误；没有在共享库创建试答会话。完整业务回归使用独立数据库和相同候选内容。
- 主分支合并后再次验证：后端 614 passed（241.43 秒）；前端 268 passed；设计契约 5 passed；真实 API 浏览器矩阵 15 组通过。
- 业务提交：`bd0b80c`（后端）、`dcb054a`（前端与回归）；已快进合入 main。远端引用在任务收尾时按仓库规则通过代理推送并核对。

## 公网 UAT 部署与核验

目标：`https://uat.aihuanpu.com`，服务器目录 `/home/ubuntu/lszl-kg-uat`，Compose 项目 `lszl-kg-uat`。北京时间 2026-08-28 17:18 完成部署和 HTTP 核验；应用代码来自 `c370745` 所在主分支，未新增业务修改。

### 重复反馈的原因

- 部署前公网和 UAT 容器均为 `v9.0-p4.1.183`，本机为 `v9.0-p4.1.186`。请求带新版本查询参数的旧站脚本仍得到旧内容，HTML 响应为 `Cache-Control: no-store`；这次反馈是漏部署公网，不是用户浏览器缓存。
- 旧脚本仍有选项后的解析按钮、每 5 道已答题的阶段弹窗，以及未按模式隐藏的交卷按钮。“先答对 1 题再答错 4 题”触发的是阶段弹窗，不能将其等同于 180 题生命耗尽。

### 部署步骤与保护范围

- 通过 `prepare-new-legacy-runtime.js` 打包已由正式发布工具 promote 的 `186` 和回退版本 `185`，没有手工修改或覆盖 release site。
- 比较服务器当前 site 与候选的路径集合：970 → 973，零文件丢失，仅新增上述 3 个文件；`.DS_Store` 和 `assets/.DS_Store` 按既有 rsync/Docker 规则排除。关键管理页和做题页均存在。
- rsync dry-run 确认删除项仅在被替换的旧 runtime 版本目录内，保留 `.env.uat`、`.env.prod` 和 `deploy/`。同步目标仅为 UAT 目录。
- 分步执行既有更新流程中的 runtime 打包、rsync、UAT `build backend` 和 `up -d --no-deps backend`。未执行不必要的 Nginx 配置安装、历史发布数据回填或全局 Docker 清理，也未创建 UAT 数据备份。
- UAT 容器启动日志确认迁移 `f7a2c4e6b810 → a8c1d4e7f920`，`alembic current` 为新 head；连接库为 `kg_graph_uat`，本机 18087 与公网 HTTPS 健康检查均返回应用和数据库正常。

### 实际服务内容

- 公网 `practice-mode.html` 的 `data-release` 与服务端 bootstrap 均为 `v9.0-p4.1.186`，页面引用 `115-practice-mode-policy.js` 和 `116-practice-session-save.js`；HTML 仍为 `Cache-Control: no-store`。
- UAT active site 的全部 973 个文件与本机候选逐文件 SHA-256 完全一致。公网实际返回的 `100/111/112/113/115/116` 六个做题模块、`practice-learning-adapter.js` 和 `styles/practice-mode.css` 八个资源也逐一一致。
- UAT 容器内 `backend/app` 与 `backend/alembic` 的全部 160 个 Python 文件与本机主分支逐文件 SHA-256 完全一致。
- 公网主做题脚本 SHA-256 为 `75817c09a12175227d5b05de4f5665a2feb268fae53abe1032e0286b5c7aa9c9`，已不同于旧版 `aa0df6070eafd95d43f14bb975ec5077f8f8c35617bff2401eac421e87b6893d`。
- UAT 后端容器已更换为 `d3cdb78b60f0`；UAT 数据库容器未重建。正式站后端 `68a768c89176`、数据库 `282eae570aeb` 的 ID 和运行时间保持不变，公网正式站仍为 `v9.0-p4.1.174`。
- 本次浏览器控制连接超时，未在公网登录账户重新作答 180 题。不能将资源一致性核验称为公网登录业务回归；业务行为依据仍为上文隔离环境测试，本次核验其对应文件确实已上线。

临时核验材料：`/tmp/practice-uat-v186-public-verification.json`、`/tmp/practice-uat-before-manifest.json`、`/tmp/practice-uat-after-manifest.json`。这些文件仅含发布资源哈希和健康状态，不含数据库导出。

## 已知边界

关闭保存只有请求实际送达并提交后才成立。强制杀进程、断网、生命周期不触发等不做兜底；无离线队列，无定时/后台自动保存。关闭与刷新实测使用 Chromium；不宣称所有设备或浏览器都保证关闭送达。往返缓存覆盖的是模拟生命周期和真实服务端状态对齐，不宣称全浏览器真实缓存命中验收。
