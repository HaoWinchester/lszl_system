# PMP8 基础图谱模板 UAT 发布

本批内容：30 套原创教学图谱、330 张卡片、342 条关系，作为免费基础模板发布到 UAT 的现有模板中心。保留原有模板；用户加载后得到可独立编辑的个人副本。

## 本地验证

- 完整内容包、独立学习 ZIP 和总归档均已校验。
- 图谱路径检查使用现有编辑器的真实几何函数，30 套无交叉、无穿卡。
- Chrome 逐套打开 30 套，330 张卡片和 342 条实际 SVG 路径无交叉、无穿卡；标题未发现截断。
- 330 张卡片正文与修改前备份一致；模板预览与编辑器显示一致。
- `overview.png` 与 `agile-flow.png` 为实际浏览器截图。
- 发布工具已验证本地数据库拒绝写入，UAT 中默认只读；完整批次预检成功，无同名冲突。

## 发布方式

内容数据通过 UAT 当前后端的 `file_service` / `graph_template_service` 发布，不替换站点静态文件、不重建镜像、不重启服务，不改变正式环境。

UAT 运行中的页面版本经 HTTP 实测为 `v9.0-p4.1.394`。宿主机旧 release 指针不代表容器当前服务内容，本次以运行容器和实际 HTTP 响应为准。

发布前已备份并校验宿主机代码归档、运行容器代码/active release 归档，以及 `kg_graph_uat` 数据库 custom dump。

备份目录：`/home/ubuntu/lszl-uat-backups/pmp8-20261025091010Z`，目录内含 `manifest.json`、`uat-host-code.tar.gz`、`uat-runtime-code.tar.gz`、`kg_graph_uat.dump`。

## 发布结果（2026-10-25）

- 入口：[UAT 图谱](https://uat.aihuanpu.com/graph) → 左侧「模板」→ `PMP8 · 01` 至 `PMP8 · 30` → 预览或「加载为新图谱」。
- 首次发布新增 30 套，全部为免费、上架、v1；现有 3 套保留，模板库共 33 套。原有 3 套的名称、归属、上架/会员设置、版本及正文哈希均与发布前一致。
- 再次执行发布：新增 0 套、原样复用 30 套，没有重复创建或升级版本。
- 30 套模板的发布快照与源文件哈希完全匹配；每套 11 张卡片。学生角色可见全部 30 套免费模板。
- 抽查知识导航、挣值判断、敏捷循环三种内容：加载会重建对象 ID，副本可以保存修改，源文件与已发布模板均保持原样。三个服务验证副本已移入可恢复的回收站。
- Chrome 实际访问 UAT：看到了 30 套免费模板，打开知识导航、敏捷循环预览，并通过「加载为新图谱」打开知识导航副本。该浏览器副本保留供继续查看。
- `uat-overview-preview.png`、`uat-agile-preview.png`、`uat-loaded-graph.png` 为 UAT 实际浏览器截图。
- `published.json` 为首次发布回执，`recheck.json` 为重复导入回执，`verification.json` 为数据一致性与副本隔离检查结果。

内容提交：`7596876edb1779feacfc6df83ff3db80ff0c154c`，已合入并推送 `uat`。本次为内容数据发布，运行中代码版本与 `.deploy-state/git-commit` 保持原样；单独的 `content-manifest.json` 记录内容提交与备份。

服务器内容与回执留存：`/home/ubuntu/lszl-uat-imports/pmp8-20261025091010Z`。管理员的模板源文件统一位于「PMP8 · 基础模板源文件」文件夹。

## 自动检查与验收边界

- `cd frontend && pnpm test`：378 项 Node 测试、9 项契约测试及 4 组部署脚本测试全部通过。
- `cd backend && .venv/bin/python -m pytest tests/test_graph_templates.py tests/test_graph_assets.py -q`：21 项通过；有 1 条现有 multipart 弃用警告。
- `node 内置数据/PMP8知识图谱/validate-layout.mjs`：30 套图谱，连线交叉 0、穿卡 0、默认灰图标 0。
- 本次未运行全部后端测试；UAT 浏览器抽查不替代用户逐项业务验收。

当前停在 UAT 待用户验收。没有合入或推送 main，没有修改正式环境。
