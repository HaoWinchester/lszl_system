# 画布、模板与历史保存修复 UAT 部署记录

2026-10-19，用户明确授权“部署到uat吧”。本次将当前窗口全部已验证修复合入、推送并部署到 UAT，未合入或推送 main，等待用户本人业务验收。

## 版本与集成

- 功能分支 `codex/remove-tables-restore-learning-appearance`，授权时末提交 `949a8406`。
- UAT 部署代码提交 `d67cbe817c1ef1ce448c4ef0d42bbd16b8af23d7`；合并无冲突，其 tree 与功能分支完全一致（`a6902054e34f66f73bdb778aaa43ef24b338a404`）。所有推送使用单次命令代理 `http://127.0.0.1:7897`，并以 `git ls-remote` 复核。
- 正式脚本 `bash deploy/update-uat.sh` 退出0，版本 **v9.0-p4.1.361**，总耗时1009秒。
- sourceHash `b7416868a56a3088ee7bfd9b937e448d3b4e954ddcfcafc3260c6b8f651f6c3a`；adapterHash `f07f93b07c09488204eb9c56c9b11e00ca9ccad98536707eaaf84cf502f3f816`。
- 部署前读取运行容器确认实际旧版为v343、1148文件，关键管理页存在。服务器宿主机另有旧v168指针，未把它当作实际运行版本。候选及上线容器均1148文件，管理页保留。
- main 保持 `b76862ed2d12d36a6c3d0b6782f5bd601f12d8a5`；main、uat及功能分支保留。本轮没有新增数据库迁移、依赖升级或关闭验证。

范围包括前述本地画笔、连线、模板发布与预览、弹层布局、主题独立、模式往返和历史画布保存修复，详细原因及历史数据覆盖见[历史画布审计](2026-10-19-historical-canvas-persistence.md)、[图谱完整流程](2026-10-19-graph-full-flow.md)、[旧地址刷新换题修复](2026-10-19-workspace-duplicate-refresh.md)。用户已确认17:09笔迹变化属于主动删除或撤销。

## UAT 备份与回退材料

部署传输及容器重建前，已生成并校验：

- 远端目录 `/home/ubuntu/lszl-uat-backups/20261019T093647Z`，目录及文件采用私有权限。
- `code.tar.gz`：130912808字节。
- `kg_graph_uat.dump`：27509196字节，仅UAT数据库；`pg_restore --list`验证通过。
- `manifest.json`：UTC时间、绝对路径、文件尺寸与SHA-256。
- 原UAT镜像另保留标签 `lszl-kg-backend:uat-backup-20261019T093647Z`，未删除既有备份。

备份未输出数据库内容或凭据；未备份、恢复或更改正式业务库。操作共享PostgreSQL容器时目标数据库明确限定为 `kg_graph_uat`。

## 完整发布门禁

官方 update 按 `full` 运行，最终 validation.json 为 `passed:true`，包含 validatorHash，未复用先前 skip-browser 开发检查冒充门禁。完整门禁退出0、耗时943秒：

- 后端1104项通过，只有3条既有依赖弃用警告。
- 前端365项、E2E契约9项、部署脚本契约通过。
- 扩展契约10项通过；首页/登录及内容录入契约通过。
- 真实浏览器做题、续做、答题卡、报告、即时反馈、弹幕通过。
- 画布浏览器140秒通过：画笔/文字、失败保存与重试、模式和文件切换、旧缓存只读保护、账号隔离、曲线/折线/接口控制点、撤销重做、布局与刷新持久化等。
- 内容录入/题库/并发、会员购买、流程指示、多题学习资产浏览器通过。
- 视觉回归四项通过，差异0.000%、0.001%、0.000%、0.000%。

发布验证使用自动清理的独立本地数据库，未向UAT写入测试练习、图谱或评论。

## 上线核验

- UAT内网、HTTPS、数据库健康正常；小程序29路由/13表检查及教师助手worker/转换器就绪检查通过。
- 官方历史试卷回填/校验通过；公开首页版本与v361一致，部署基线提交记录为d67cbe81。
- 真实Chrome只读公网检查：`/`、`/graph`、`/index.html`、`/practice-mode.html`、`/knowledge-recall.html`、`/question-workspace.html`六入口均200且版本正确。
- 29个关键公网静态资源SHA-256逐字匹配不可变发布包，覆盖共享画笔、连线、工具栏、模板、深度回忆、多题归纳及适配器。图谱和大厅加载pageErrors=[]。
- 运行容器实际active版本/sourceHash/1148文件/管理页/Files API开关核对通过，4个后端关键模块哈希与本地提交一致。
- UAT部署前后只读比较：graph_files 283、file_contents 283、recall_progress 38、canvas_workspaces 16，数量及图谱正文、回忆、归纳画布完整行内容指纹全部一致。本轮部署未改写这些历史画布。

本地证据位于 `artifacts/uat-canvas-361/`：`backup.log`、`deploy.log`、`validation-run.log`、`uat-public-smoke.json`、`uat-verification.json`、`data-before.json`及`data-after.json`，均不含凭据。验证期间未出现需要回滚的部署失败。

入口：[UAT知识图谱](https://uat.aihuanpu.com/graph)。以上为开发自检及部署核验，**不代表用户UAT验收通过**；未经用户明确验收，不合入main、不删除功能分支。
