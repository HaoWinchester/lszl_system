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

本文件将在发布后的验证完成后补充最终结果。用户 UAT 业务验收尚未完成；main 和正式环境保持原状。
