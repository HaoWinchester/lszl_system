# PMP8 基础模板正式发布

用户于 2026-10-25 在 UAT 交付后回复「好的，继续放在正式环境上」，确认当前 UAT 内容并授权正式发布。

本批为已验收的 30 套免费基础模板（330 张卡片、342 条关系）。图谱 JSON、学习 ZIP 与 UAT 批次完全相同。发布使用现有文件、模板服务，新增环境校验只影响离线运维工具，不修改应用代码。

正式目标：[正式图谱](https://lszl.aihuanpu.com/graph)，容器 `lszl-kg-backend-1`，数据库 `kg_graph`，管理员模板源文件夹「PMP8 · 基础模板源文件」。

发布前实测正式运行版本 `v9.0-p4.1.394`，active release 共 1241 个文件，`admin-console.html` 存在。现有模板 6 套，没有 PMP8 同名冲突。本次不替换站点资产、不构建镜像、不迁移数据库、不重启容器。

## 发布前检查

- 环境校验矩阵：只接受 `uat / kg_graph_uat`、`prod / kg_graph` 两种完整匹配，拒绝其余 25 种组合；生产必须显式传入 `--environment prod`。
- 内容包：30 套、330 张卡片、342 条关系；布局检查交叉 0、穿卡 0、默认灰图标 0。
- 新工具在 UAT 默认只读复查：30 套内容原样复用。
- `cd frontend && pnpm test`：378 项 Node 测试、9 项契约及 4 组部署脚本测试通过。
- 后端模板与资产测试：21 项通过，1 条现有 multipart 弃用警告。未重跑全部后端测试。
- 正式运行的 `graph_template_service.py`、`file_service.py` 与本地已验证版本 SHA-256 一致。

## 正式备份与回退依据

在正式代码/数据写入前已生成并验证备份，目录：`/home/ubuntu/lszl-backups/pmp8-20261025102702Z`。

- 宿主机代码：`production-host-code.tar.gz`（41,884,003 字节）。
- 运行容器代码与 release：`production-runtime-code.tar.gz`（15,216,053 字节）。
- 正式数据库：`kg_graph.dump`（208,323,829 字节，custom 格式，仅 `kg_graph`）。
- 三份归档均非空，tar / pg_restore 目录检查通过；SHA-256 与路径见 `backup-manifest.json`，服务器同目录 `manifest.json`。
- 保留原镜像标签：`lszl-kg-backend:rollback-pmp8-20261025102702Z`。未执行数据库还原演练，未删除既有备份。

## 发布与线上验证结果

- 内容提交 `78f986ac2320284858d30db613465d12e3b2063d` 已由 `uat` 快进合入 `main` 并通过指定代理推送，远程引用已核对。
- 首次发布新增 30 套免费、上架、v1 模板；原有 6 套模板全部保留，合计 36 套。
- 30 套发布正文哈希与已验收 UAT 回执逐一相同，合计 330 张卡片、342 条关系；源文件与发布快照也完全一致。
- 原有 6 套模板的名称、描述、归属、上下架/会员设置、当前版本、全部历史版本、题目绑定与正文哈希均与发布前一致。
- 学生目录可见全部 30 套免费模板；30 套服务端预览均返回 11 张卡片。
- 抽查知识导航、挣值判断、敏捷循环：加载后对象 ID 重建，副本修改可保存，源文件和发布模板正文均不变。3 个服务验证副本已移入可恢复的回收站，服务检查没有改变管理员原当前文件。
- 再执行正式导入：新增 0 套、复用 30 套，没有额外版本。未指定生产目标的默认命令在正式容器中被环境校验明确拒绝。
- Chrome 实际打开正式站：模板中心列出 30 套免费 PMP8 模板，预览与加载均通过；保留知识导航的浏览器加载副本供继续查看。实际截图见 `production-overview-preview.png`、`production-loaded-graph.png`。
- 正式后端的启动时间、重启次数及镜像 ID 与发布前完全相同；正式和 UAT API / 数据库健康检查均通过。

正式入口：登录 [正式图谱](https://lszl.aihuanpu.com/graph) → 左侧「模板」→ `PMP8 · 01` 至 `PMP8 · 30` → 预览或「加载为新图谱」。管理员源文件集中在「PMP8 · 基础模板源文件」文件夹。

服务器内容和回执目录：`/home/ubuntu/lszl-content-imports/pmp8-20261025102702Z`。`published.json`、`recheck.json`、`verification.json` 和 `content-manifest.json` 记录本次内容发布；不修改应用部署代码基线。
