# 历史画布保存、刷新与切换审计（本地 v361）

## 范围与历史数据来源

本轮针对用户“其他画布也全面检查，不能只测新建数据”的要求，检查正式知识图谱、临时相关画布、深度回忆、多题归纳四种使用场景及三套持久化链路。仅本地更新，没有推送、部署或合并 UAT/main。

对开发库使用只读事务盘点并留存私有快照，再将实际历史对象匿名复制到隔离 PostgreSQL 进行有写入的浏览器验证；没有对原库批量迁移、合并或删除历史行。

| 数据域 | 原库存量 | 浏览器验证来源与范围 |
| --- | --- | --- |
| 正式图谱 | 2 份，两份均 11 节点/8 连线 | 全部复制，保留无顶层 graph ID 的旧格式、geometry、appearance、节点/边 ID |
| 深度回忆 | 35 行，29 行没有 release scope；8 行非空 | 全部非空旧画布：7 legacy+1 scoped，46 节点/27 边；保留真实字段形态和 revision |
| 多题归纳 | 5 份，4 份服务器 ID 与 payload.id 不同，3 份缺 background | 全部复制；旧时间戳、布局、样式、别名、卡片及笔迹形态保留，最早记录为 2026-08-26 |

复制时重绑隔离 owner/question/bank/release 引用并匿名化可见文字，避免向真实账号写入测试内容。深度回忆隔离库的 library hash 重绑为隔离库当前版本，业务节点结构保持原样。多题归纳旧记录未出现 schema<10，深度回忆均 schema3；不把合成格式冒充实际旧数据。

正式图谱实际旧学习状态只有三个空域和 `{}`，不存在可复制的非空学习进度，另在历史图副本上增加明确标记的合成嵌套进度，补测保存、刷新、文件往返后仍保留。

## 确认并修复的问题

1. **刷新误清空旧回忆图**：页面遇到题目/联想库版本 mismatch 时自动调用 reset。真实旧图副本可复现 20 节点直接变为 0。改为保留历史图并只读，只有用户明确确认重置才清空；API 同时拒绝绕过只读直接覆盖旧绑定。
2. **引入发布版本前的进度在新入口不可见**：查 scoped 进度未查到时直接显示空图。仅在同 owner、question、bank、revision/contentHash 精确匹配且发布归属唯一时兼容读取 legacy。首次保存或重置派生独立 scoped 行，原 legacy 行不变；已有 scoped 优先，多发布或内容不匹配时不混用。沿用 advisory lock，首次派生并发请求为 200/409，不重复创建或改写旧行。
3. **深度回忆保存作用域丢失**：服务端题目快照替换前端上下文时，丢失 sourceReleaseId/CollectionId/PaperId。同题快照现在保留已解析的发布上下文，刷新及切题后继续写正确作用域。
4. **图谱学习状态缓存丢失**：仅含 metadata 的保存响应替换已加载对象，remote store 还会在未传 learningState 时编造空对象。现在合并 metadata、保留已知学习状态；未知正文不虚构缓存，下一次从 API 读取。后端原本就不因省略 learningState 清空数据库，此项没有声称已复现原库进度被直接删除。
5. **迟到保存响应覆盖当前图谱**：增加选择代次校验，发送及处理保存/重命名响应都校验，包括 A→B→A。
6. **改名失败后普通重试漏同步文件名**：统一保存入口默认带上图谱标题，重试后文件名与 graphData.meta.title 一致，刷新不会恢复旧名。

多题归纳 5 份实际历史副本未发现 v359 身份修复之外的新丢卡问题。本轮没有改动该域产品源码，扩展既有浏览器测试覆盖全部存量副本。

## 验证与证据

下列浏览器运行均使用真实 Google Chrome、真实 FastAPI/PostgreSQL、最终本地包且无 source override。

- **正式图谱 v361，10 组通过、退出 0**：两份历史图 UI 改名、保存/刷新、跨文件往返、持续 503 后禁止切换、恢复后手动重试、真实 PUT 已提交但响应延迟时切换、临时相关画布新增卡片零正式写入、关闭刷新恢复，以及合成非空学习状态补充。最终 22 节点的几何/外观与历史副本逐值一致。证据 `artifacts/historical-graph-audit-20261019/browser-release361/evidence.json`、`final-release-verification.json`。
- **深度回忆 v361，完整 8 份历史副本全部通过、退出 0**：从清理并重建独立 fixture 开始完整一轮，加载→真实缩放触发保存→刷新，核对节点 ID、边端点、customNodes、choiceOffsets、API 正文和 scoped 行唯一性；7 份 legacy 原行均不变。证据 `artifacts/deep-recall-history-audit/all-results-361-full.json`、`final-361-summary.json`。
- 初次批量中出现刷新超时，后以 HTTP429、console、服务端限流日志确认是请求限流，数据库节点仍在。最终完整轮第7份按真实 `Retry-After=36` 等待后重开并完成全部保存/刷新断言，第8份也通过；没有调大产品阈值、跳过断言或把429当通过。证据 `rate-limits-361-full.json`，此前失败证据保留。
- **深度回忆代表性负向流程 v361，退出 0**：20 节点历史图的保存/刷新、下一题再返回、503 阻止切题、重试、题目版本更新后历史只读、直接覆盖409、取消重置保留旧图。命令 `python3 new-legacy/tests/v90-p4529-deep-recall-database-browser.py --historical-base http://127.0.0.1:5298 --historical-db <本轮隔离库> --served --reset-history`；日志 `artifacts/historical-canvas-audit/recall-browser361.log`。
- **多题归纳 v361，5 份全部通过、退出 0**：每份手动保存、3次刷新、追加真实文字再保存刷新、API/页面正文一致、逆序重开不串数据。命令 `python3 new-legacy/tests/learning-theme-browser.py --base-url http://127.0.0.1:5297 --case historical-refresh --historical-workspaces <只读快照> --out-dir artifacts/historical-canvas-audit/workspaces361`；`historical-refresh.json` 的 pageErrors=[]。
- **主题及往返 v361，6/6通过、退出 0**：主题独立、五尺寸入口、背景、模式往返、设置保存、文字草稿保存失败不离开及重试。日志 `artifacts/historical-canvas-audit/general361.log`。
- `cd backend && .venv/bin/python -m pytest tests/ -q`：**1104 passed，3条既有弃用警告，退出0**；`backend-full.log`。追加的历史兼容/首次派生并发/显式重置断言另以最新测试文件复验：`test_deep_recall_api.py test_recall_progress_api.py` **9 passed，退出0**，`recall-api-final.log`。
- `pnpm --dir frontend test`：**365/365，E2E契约9/9、部署脚本契约通过，退出0**；`frontend-full-final.log`。`pnpm --dir frontend test:design`：**5/5**。
- 定向 RED/GREEN 覆盖自动清旧图、丢release上下文、legacy不可见、API历史覆盖、图谱metadata/cache丢学习状态、迟到响应及改名重试。先有失败证据再修复。已有导航测试补充实际依赖 commitRecallDrafts stub 和异步等待，没有弱化产品断言。

## 原库保护与待确认事项

原库 recall_progress 35行、file_contents 2行、graph_files 2行、current_files 1行，前后完整逐行一致。本轮测试对原库只执行只读 SQL；所有浏览器写入均指向5297/5298/5299隔离服务。

但原库不是完全静止的：一份真实多题归纳画布在 **17:09:50** 出现保存，笔迹7条变4条（少3条荧光笔），节点成员和内容不变，仅节点 updatedAt、视图与更新时间变化。该当前正文不含任何匿名测试标记。仅凭现有证据不能确定操作者，也不能声称全库完全未变。已同时保留排查前与当前私有快照，向用户询问是否主动删除/撤销，**没有回滚这次真实保存**。用户回复前此项保持待确认，不把它包装成已证实的新数据丢失 Bug。

私有快照和详细题目内容仅保存在被忽略的 artifacts 下，不提交仓库。

## 本地版本与收尾

最终 active **v9.0-p4.1.361**，sourceHash `b7416868a56a3088ee7bfd9b937e448d3b4e954ddcfcafc3260c6b8f651f6c3a`，adapterHash `f07f93b07c09488204eb9c56c9b11e00ca9ccad98536707eaaf84cf502f3f816`。

使用官方 update 构建并 promote。首次359同版本内容不同被正确拒绝；初次360全量检查发现 content-prep 产物版本标签未预先重建，因此先构建该产物再生成不可变361，重跑全量通过，没有覆盖既有 release。360→361站点差异只有版本标签及生成manifest，画布业务模块逐字节相同，证据 `360-to-361.json`。

权威源与 active 的 sourceHash 一致；public/site均1148文件、路径及内容一致；实际5173共19项关键资源逐字匹配（HTML仅含已校验的服务端bootstrap注入），`served-assets.json`。所有隔离服务与对应数据库已精确清理，私有证据保留，5173继续运行。main/uat引用未改变；没有把开发自检当作用户UAT验收。
