# 正式发布 v9.0-p4.1.217

用户于 2026-09-08 确认 UAT 后明确要求合入 main 并部署正式环境。正式地址：https://lszl.aihuanpu.com 。

## 发布范围

- 将已验收的 UAT 提交 `032636a`、`125d373` 按本次范围合入 main，对应 `13c213c`、`05649df`。
- 正式运行代码提交：`05649dfe3712e8149d059745403ab06c14ae9bda`，已推送并通过远端引用核对。
- 成绩页统一查看错题；学习记录支持全部、正确、错误筛选；多题归纳刷新后恢复题目选项；跨试卷错题放入画布支持原始来源解析与失败提示。
- UAT 共用 PostgreSQL 实例的 compose 配置及访问规则纳入 main；现有生产服务配置未变更。
- 延续 v216 的正式发布范围，保留 main 的备份/回滚保护和 smoke 测试修正；UAT 中独立的小程序开发历史未在本次引入。
- 前端生成产物冲突从 `new-legacy/` 权威源重新同步并提交，未手工覆盖 release site。

## 验证结果

- 在 main 工作区运行 `node frontend/scripts/manage-new-legacy.js update new-legacy --validation-profile full`，2026-09-08T02:56:03.376Z 完成，`passed=true`、`profile=full`。
- 后端测试、240 项前端 Node 契约、Python 契约、部署脚本测试、做题/成绩/记录浏览器流程、关联业务流程及页面校验通过。
- 候选、旧 active site 均为 985 文件，关键管理页存在；候选包所有文件逐一比对，与用户验收的 UAT release 完全一致。
- 正式 HTTPS 健康接口返回 `status=ok`、`db=ok`，成绩相关页面及画布页面返回 200，并标记版本 v217。五个变更 JS/CSS 公网内容与构建逐字节一致。
- 直接检查正式容器 active release：版本 v217，全部 985 文件 SHA-256 与已验证候选包一致。
- 正式应用数据库连接身份为 `kg_graph`；共享 PostgreSQL 的启动时间保持 `2026-08-04T16:30:32.864208641Z`，本次未重启数据库。UAT 健康检查通过，旧 UAT 数据库容器继续停止。
- 正式容器镜像：`sha256:91d7e757b30575edd4a16eb18518d78481703199c9a78f1359c261260c5309a9`。
- 业务写入回归在隔离测试环境执行，正式环境执行只读发布核验；未执行正式数据库恢复演练。

## 备份及部署

- 备份目录：`/home/ubuntu/lszl-backups/20260908_104655`。
- 正式代码：`repo_20260908_104655.tar.gz`；正式库：`db_20260908_104655.dump`；清单：`manifest.txt`。
- 共享实例补充备份：`uat.dump`、`globals.sql`、`pg_hba.conf`，路径已追加到 manifest。
- 代码包、数据库 dump 均确认非空，并通过 `tar -tzf` 和 `pg_restore --list` 校验。备份在正式同步、构建及重启前完成。
- 回滚镜像：`lszl-kg-backend:rollback-20260908_104655`。
- 使用既有 `deploy/update.sh` 的备份函数与其后构建、同步、重启、健康检查、维护步骤；备份阶段与本地完整验证并行，二者通过后执行发布阶段。
- 如需回滚应用，可使用上述已保留镜像和代码包；本次后端业务代码、生产 compose 和数据库迁移均无变更。
