# UAT v9.0-p4.1.217 与 PostgreSQL 实例合并

## 发布结果

- 功能提交：`032636a56218f69b5a06d045754c50efccbd9033`，已推送 `uat`。
- 访问地址：https://uat.aihuanpu.com ，active release：`v9.0-p4.1.217`。
- 包含成绩页批量错题复盘、学习记录全部/正确/错误筛选、跨试卷画布题目刷新恢复、错题放入当前画布的来源解析和失败提示。
- 官方 `deploy/update-uat.sh` 完成全部步骤；full release 验证在 2026-09-08 02:29:09 UTC 通过。候选与 active site 均为 985 个文件，关键页面齐全。
- 公网健康检查和两个业务页面返回 200；五个变更 JS/CSS 文件与已验证构建逐字节一致。
- 本文发布后仍待用户业务验收；未合入或推送 `main`。

## 当前数据库拓扑

用户明确要求共用一个 PostgreSQL 实例，因此此前独立 UAT 数据库容器的设计已调整：

| 用途 | 实例容器 | 数据库 | 应用账号 |
| --- | --- | --- | --- |
| 生产 | `lszl-kg-db-1` | `kg_graph` | 原生产账号 |
| UAT | `lszl-kg-db-1` | `kg_graph_uat` | `kg_uat` |

`docker-compose.uat.yml` 只启动 UAT backend，通过外部网络 `lszl-kg_default` 连接 `lszl-kg-db-1`。部署到其他宿主时可设置 `POSTGRES_HOST` 和 `POSTGRES_NETWORK`。共享实例、独立数据库及账号必须预先准备好，UAT compose 不负责创建、升级或停止共享实例。

UAT 使用重新生成的独立密码，只保存在远端 `.env.uat`。`kg_uat` 是 UAT 库及其对象的 owner，不具备超级用户、创建数据库、创建角色、复制或绕过行级权限的能力。`deploy/postgres-uat-access.conf` 中的规则已放在共享实例 `pg_hba.conf` 的通用允许规则之前，通过 reload 生效；实测 UAT 账号不能连接 `kg_graph` 或 `postgres`。将来重建数据库卷时，需要重新配置这些规则及受限账号。生产 PostgreSQL 和后端未重启。

原 `lszl-kg-uat-db-1` 已停止，restart policy 设置为 `no`；原 `lszl-kg-uat_pg_data` 数据卷保留。不要把旧卷当作持续更新的 UAT 数据库。

## 备份、迁移及验证

- 功能部署前 UAT 备份：`/home/ubuntu/backups/lszl-kg-uat/20260908T020633Z`。
- 共享实例变更前生产备份：`/home/ubuntu/backups/lszl-shared-postgres/20260908T023240Z`。
- 该目录包含生产代码归档、`production.dump`、角色备份、原 `pg_hba.conf`、原 UAT compose/env、切换前最终 `uat-final.dump`、表/序列核对记录及 `manifest.txt`。代码归档及数据库 dump 均非空，分别通过归档读取和 `pg_restore --list` 校验；未在日志中输出数据或密码。
- 暂停 UAT backend 后导出最终快照，恢复到共享实例中新建的 `kg_graph_uat`。切换前逐一核对全部 public 表记录数和序列位置，与旧实例一致。
- 使用 UAT 应用账号验证数据库身份、角色权限、建表/插入/读取并回滚，以及禁止连接生产库。
- 停止旧 DB 后再次确认 UAT HTTPS 健康检查通过；生产内网、公网健康检查也通过。
- compose 渲染验证通过；前端现有 Node/Python 契约和四项部署脚本测试全部通过。前端 full release 验证在功能发布时完成；本次实例切换额外执行上述实际数据恢复、访问隔离和读写验证。

## 运维与回退

后续正常发布仍执行 `bash deploy/update-uat.sh`。共享 PostgreSQL 的重启、升级或故障会同时影响两个环境，安排维护时需同时考虑两边。备份时应分别导出 `kg_graph` 和 `kg_graph_uat`；生产库的单库 dump 不包含 UAT 数据。

若需切回独立实例，先停止 UAT backend 并导出共享实例中最新的 UAT 数据，避免丢失切换后的新写入。启动保留的旧 UAT DB，将最新 dump 恢复到独立库，再恢复备份中的 compose 和 env（账号密码与对应实例保持一致），重新创建 UAT backend 并验证。不要直接启动旧 backend 继续使用切换前的旧数据。正常回退无需重启生产服务，也不要删除或覆盖生产库。
