# UAT 独立部署设计

## 目标

将提交 `a0730614dea9712f8d3e9e16153f5a3c9a956995` 部署到
`http://uat.aihuanpu.com/`，用于验证“题目录入校验默认关闭”的版本。
UAT 与正式环境 `https://lszl.aihuanpu.com/` 位于同一台服务器
`49.235.159.4`，但代码、容器、镜像、端口、网络、数据库、卷、配置和
运行命令必须完全隔离。

## 已确认约束

- UAT 使用正式 PostgreSQL 数据库的一次性原样快照，包括用户、密码哈希、订阅和
  订单标识；复制完成后不再与正式库同步。
- 数据只在远程服务器内通过 `pg_dump` 与 `pg_restore` 管道传输，不下载到本机，
  不落地明文 dump 文件。
- 正式数据库仅作为只读导出源；不得对其执行迁移、写入、停止或重建操作。
- UAT 只提供 HTTP，由独立 Nginx server block 服务。
- UAT 禁用真实支付、邮件、短信、微信登录回调和其他通知外发，不挂载、复制或读取
  正式环境凭证。
- 仅新增或操作 UAT 资源。不得删除、重建、迁移或停止正式环境资源。
- 完成部署后执行完整验收，并核对正式环境状态与部署前一致。

## 隔离架构

| 资源 | 正式环境 | UAT 环境 |
| --- | --- | --- |
| 代码目录 | `/home/ubuntu/lszl-kg` | `/home/ubuntu/lszl-kg-uat` |
| Compose project | `lszl-kg` | `lszl-kg-uat` |
| Compose 文件 | `docker-compose.prod.yml` | `docker-compose.uat.yml` |
| 后端镜像 | `lszl-kg-backend` | `lszl-kg-backend:uat-a073061` |
| 宿主端口 | `127.0.0.1:18086` | `127.0.0.1:18087` |
| Compose 网络 | `lszl-kg_default` | `lszl-kg-uat_default` |
| PostgreSQL 卷 | `lszl-kg_kg_pg_data` | `lszl-kg-uat_pg_data` |
| 数据库 | `kg_graph` | `kg_graph_uat` |
| 数据库用户 | `kg` | `kg_uat` |
| 域名 | `lszl.aihuanpu.com` | `uat.aihuanpu.com` |
| Nginx 配置 | `lszl.aihuanpu.com.conf` | `uat.aihuanpu.com.conf` |
| 外部服务凭证 | 正式凭证目录 | 不挂载任何正式凭证 |

UAT 数据库密码和应用密钥由部署时随机生成，保存在 UAT 目录下权限为
`0600` 的 `.env.uat` 中。UAT Compose 必须显式使用独立镜像标签、独立命名卷和
`127.0.0.1:18087`，所有远程 Compose 命令必须带
`--project-name lszl-kg-uat`，避免依赖当前目录推导 project 名。

## 正式数据复制

正式数据库当前约 43 MB、44 张表，包含真实个人信息和认证、订阅、订单数据。复制
采用一次性事务一致性快照：先启动空的 UAT PostgreSQL 容器，通过服务器内管道将
正式容器中的 `pg_dump` 输出直接交给 UAT 容器中的 `pg_restore`。不得把 dump
下载到本机，也不得在服务器文件系统留下明文 dump。

复制前必须依次验证：

1. 源容器属于 Compose project `lszl-kg`，源数据库为 `kg_graph`，源卷为
   `lszl-kg_kg_pg_data`。
2. 目标容器属于 Compose project `lszl-kg-uat`，目标数据库为 `kg_graph_uat`，
   目标卷为 `lszl-kg-uat_pg_data`。
3. 源数据库与目标数据库的容器 ID、网络、卷和数据库名均不同。
4. UAT 后端尚未启动，避免导入期间产生写入。
5. 正式数据库健康，导出命令只包含只读参数，不包含清库、建库或迁移操作。

任一验证失败时立即停止。导入失败时仅允许清理并重新初始化 UAT 数据库卷；正式库
保持不变。导入完成后检查 schema、表数量和关键表行数，再启动 UAT 后端。当前旧版
应用启动时执行 Alembic 迁移，该迁移只能连接 `db:5432/kg_graph_uat`。

本次快照原样保留 `users`、订阅、订单及其他业务数据，不做脱敏。因此 UAT 访问权限
只开放给必要测试人员，运维输出不得打印邮箱、手机号、密码哈希、token、订单号或
支付交易号。UAT 后续产生的增删改只保存在独立卷，不回写正式库，也不自动刷新。

## 外部能力禁用

UAT Compose 不声明 `/opt/lszl/secrets/wechatpay` 或其他正式凭证目录的 bind mount，
不加载正式 `payment.env`。支付、邮件、短信、微信登录回调和通知外发所需变量保持
为空或使用项目已有禁用开关。部署前必须确认缺少这些凭证时应用能够启动；相关入口
应返回明确的“未配置/不可用”响应，不得用伪造生产密钥绕过检查。

由于原样快照包含真实账号，UAT 不允许通过微信等外部身份提供方登录，也不允许向
真实用户发送消息或发起支付。验收仅使用无需外部凭证的页面、API，或专门创建的 UAT
测试会话。

## 部署流程

1. 记录正式环境基线：Compose project、容器 ID 和状态、端口、卷、网络、正式首页
   HTTP 状态、数据库只读统计，以及正式 Nginx 配置校验结果。
2. 在本地当前提交生成 UAT Compose、环境变量模板、Nginx 配置和部署脚本。脚本只向
   `/home/ubuntu/lszl-kg-uat` 同步，不使用正式 `deploy/update.sh` 中的正式目录和
   `lszl-kg` project。
3. 在服务器创建 UAT 目录和 `.env.uat`。同步代码时不使用可能覆盖正式目录的路径，
   并排除本地密钥、缓存、虚拟环境和 Git 元数据。
4. 使用 `docker compose --project-name lszl-kg-uat` 构建 UAT 专属镜像，只启动 UAT
   数据库。确认 UAT 数据库为空且隔离检查全部通过。
5. 使用服务器内 `pg_dump` 到 `pg_restore` 管道，从正式数据库生成一次性一致性
   快照并直接导入 UAT 数据库；不产生本机或服务器明文 dump 文件。
6. 核对 UAT schema、表数量和关键表行数后启动后端。后端启动命令执行当前提交的
   Alembic 迁移；迁移目标必须确认为 `kg_graph_uat`。
7. 在服务器请求 `127.0.0.1:18087` 完成健康检查、外发禁用检查和基础 API 冒烟。
8. 新增 `/etc/nginx/conf.d/uat.aihuanpu.com.conf`，只监听 80 并反代到
   `127.0.0.1:18087`。运行 `nginx -t` 成功后 reload，不修改正式 server block。
9. 从公网访问 `http://uat.aihuanpu.com/` 完成验收。

## 失败处理与回滚

- 构建、数据复制、迁移或健康检查失败时，不启用 UAT Nginx 配置。
- 数据复制失败时只停止 UAT project，并在确认目标卷名称为
  `lszl-kg-uat_pg_data` 后重新初始化 UAT 卷。不得对正式卷执行任何删除操作。
- UAT 已启动后需要回滚，只允许执行
  `docker compose --project-name lszl-kg-uat down`。默认保留 UAT 数据卷供排障；只有
  明确确认销毁含正式快照的 UAT 数据时才可带 `--volumes`。
- Nginx 失败时移除或恢复本次新增的 `uat.aihuanpu.com.conf`，通过 `nginx -t` 后
  reload。不得编辑或替换 `lszl.aihuanpu.com.conf`。
- 禁止针对正式目录运行 `rsync --delete`，禁止执行 `docker system prune`，禁止对
  `lszl-kg` project 执行 `down`、`up --force-recreate` 或数据库迁移。
- 若部署后正式环境基线发生非预期变化，立即停止后续 UAT 操作，保留现场并报告，
  不自动修改正式环境进行补救。

## 验收

### 隔离检查

- UAT 容器名、镜像、网络、卷均属于 `lszl-kg-uat`。
- UAT 后端只绑定 `127.0.0.1:18087`，数据库不发布宿主端口。
- UAT 数据库连接串指向 `db:5432/kg_graph_uat`，数据库用户为 `kg_uat`。
- UAT 后端挂载列表中不存在正式支付或其他外部服务凭证目录。
- 正式数据卷未挂载到任何 UAT 容器，UAT 数据卷未挂载到正式容器。

### 数据检查

- UAT 数据库 schema 和表数量与快照源一致，关键业务表行数与导出时统计一致。
- Alembic 版本为当前提交对应的最新迁移，迁移只发生在 UAT 数据库。
- 检查结果只输出表名、行数和迁移版本，不输出任何个人信息或认证数据。
- UAT 写入一条可识别的测试记录后，正式库对应表行数和内容保持不变。

### 功能检查

- `127.0.0.1:18087` 和 `http://uat.aihuanpu.com/` 均返回预期页面。
- 关键静态资源、健康接口、无需第三方登录的基础 API 可用。
- 题目录入流程不再被校验阻断；产生的测试数据只存在于 UAT 数据库。
- 支付、邮件、短信、微信登录回调和通知外发入口不可用，且没有外部请求发出。

### 正式环境回归检查

- 正式容器 ID、运行状态和端口映射与部署前一致。
- 正式卷 `lszl-kg_kg_pg_data` 和网络 `lszl-kg_default` 保持不变。
- 正式数据库仍健康，关键表行数未因部署或 UAT 测试发生变化。
- `https://lszl.aihuanpu.com/` 正常响应。
- 正式 Nginx server block 和正式凭证目录未修改。

## 安全边界

部署会读取正式数据库以生成一次性快照，并在隔离的 UAT 卷中保存其原样副本。因此
UAT 数据必须按正式数据同等敏感级别管理。部署还会新增远程目录、Docker 资源和
Nginx 配置，并 reload Nginx；这些是明确的远程变更。

部署不会推送 Git、修改 DNS、签发证书、把数据库下载到本机、保留明文 dump、调用
真实支付或向真实用户发送消息。任何发现与本设计不符的现有 UAT 资源时，应停止覆盖
并先报告冲突。
