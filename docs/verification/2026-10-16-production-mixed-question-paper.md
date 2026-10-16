# 正式环境新题型体验卷数据发布

用户明确要求把 UAT 的 5 道题和体验卷一起更新到正式环境，并在中断后再次确认继续。此次只通过正式容器已有业务服务新增题库、题目、材料、图片和试卷发布版本；未部署应用代码、迁移数据库或更改分支。

- 正式入口：https://lszl.aihuanpu.com/practice-mode.html 。在试卷列表选择或搜索《新题型体验卷（图表·案例·连线）》。免费，admin/teacher/student/viewer 均有访问权限，登录后开始练习。
- 共 5 题：第 1 题图表单选，第 2～4 题共享案例材料，第 5 题连线匹配；1 张原始图片完整复制。
- 来源 UAT active release：`pr_49c833ab66634bf9a9281a1777446eb9`。
- 正式 paper：`p_8177a68493b1402085b2c54d290f2677`。
- 正式 release：`pr_00b5c7162abd499fa46b952b3baabdde`，v1，`practice_mode`。
- 正式题库：`b_e81ecdf401304914addc1988cd943619`，名称《新题型体验题库（2026-09-10）》。

## 备份与提交

正式环境写入前，已备份并校验代码归档与 PostgreSQL dump，远端备份目录：`/home/ubuntu/lszl-backups/mixed-question-20261016_164829`。目录包含 `code.tar.gz`（45 MiB）、`database.dump`（189 MiB）、`manifest.txt`；非空、tar/pg_restore 列表检查成功，manifest 记录上海时间、完整路径和 SHA-256。未删除旧备份。

导出精确读取 UAT 当前发布快照及引用图片。正式导入复用 `question_service`、`question_material_service`、`paper_service`、`paper_release_service`；外层事务配合会话 savepoint，确保内部服务 commit 不会提前提交整个操作。先完成回滚演练并通过新连接证实未留下试卷与题库，再执行正式提交。遇到同名现有试卷或题库时拒绝重复创建。

## 验证

- 本地现有混合题型、案例练习、材料测试：14 passed（从 backend 目录运行）。
- 发布 preflight 通过；正式提交后独立只读查询核对 5 题顺序、完整题干/选项/答案/解析/案例材料/匹配数据；图片 SHA-256 与 UAT 相同。
- 正式运行中后端 GET 试卷题目返回 200、共 5 题；GET 图片返回 200、字节摘要一致。所有角色访问策略均通过。
- 公网练习页 200，正式公开目录可查到新发布版本。agent-browser 实际打开页面、搜索试卷、点击试卷，显示免费、5 题及“全部 5”题量选择。
- 浏览器以访客身份验证大厅入口；未创建生产练习记录或提交答案，未进行登录后的完整答题交互或手机真机验收。此次数据发布未重跑全部前后端测试。

本地操作脚本、回滚演练/提交/独立核验结果与大厅截图位于 `artifacts/mixed-question-production-20261016/`。记录不含凭据或题目正文。
