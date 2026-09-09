# 正式图谱退出修复发布记录（v9.0-p4.1.224）

用户在 UAT 修复完成后明确要求“推送到正式环境吧”。从正式 main 提取已验收修复 51f1135 和 UAT 验证记录 b32ab3d，对应正式提交 eb79acb、b7a7ba6；未合入 UAT 其他业务。2026-09-09 09:53（Asia/Shanghai）完成部署核验。

## 发布行为

无当前文件时浏览默认图谱、平移缩放或初次居中不会触发无效保存，未编辑可以退出。首次真实编辑创建并保存图谱；退出等待实际保存完成，失败保留会话与草稿，重试不重复创建文件。标题保存与自动保存共用等待和并发保护。

## 备份和上线

- 更新正式代码、镜像、服务和迁移前，执行 deploy/update.sh 的备份阶段，代码 tar 与 PostgreSQL custom dump 非空且通过 tar -tzf、pg_restore --list 格式校验。
- 完整备份目录：`/home/ubuntu/lszl-backups/20260909_094910`，时间见目录（Asia/Shanghai）。
- 代码：`repo_20260909_094910.tar.gz`，511722970 字节。
- 数据库：`db_20260909_094910.dump`，134314939 字节。
- 清单：`manifest.txt`；回滚镜像：`lszl-kg-backend:rollback-20260909_094910`。
- 首次备份遇到 SSH 超时，发布中止在同步前；重试完整备份成功后才继续。先前目录 20260909_094658 保留，不作为完整备份使用。未执行数据库还原演练。
- 按要求用 manage-new-legacy.js update new-legacy --skip-browser 构建候选；通过文件门禁，实际验证由此前 UAT 完整运行及本次候选回归提供。运行现有 deploy/update.sh 后续同步、镜像重建与健康检查，传输额外排除本地 artifacts。
- 代码 b7a7ba6 已通过指定代理推送 main，远程引用一致。正式 active release 为 v224，previousVersion 为 v220，数据库迁移头保持 ab9012cd3456。

## 验证证据

- 候选、已全量验证 UAT v224、正式容器内 v224 的全部 985 个静态文件逐项 SHA-256 相同；文件集合与发布前 v220 相同，关键 admin-console.html 存在。
- sourceHash：`bf5e6f3ecb2e56771ca976cfaf86f7ca23a6c0fcd449bb2d0cacb2249d9f02a2`。
- adapterHash：`96a95f83cba13dead590e68834bf228e06304c8777e6df0422c1f4e5882cc5b8`。
- UAT full 验证完成时间：2026-09-09T01:04:16.860Z。正式候选 129 个后端 Python 文件与部署前后实际生产逐项相同，无后端业务变更，本次未重复全量后端测试。
- 本次 pnpm test：250 个 Node、9 个 Python 契约和 4 个部署脚本检查通过；5 项设计契约、6 项退出专项、9 项现有图谱脚本通过。
- 正式候选配合真实 FastAPI、独立 PostgreSQL、agent-browser：未编辑退出，首次编辑落库并重新登录读取，保存失败保留登录与草稿并成功重试，四页登录退出矩阵全部通过。
- 正式公网 /VERSION 为 v9.0-p4.1.224；/api/v1/health 为 status=ok、db=ok。
- 正式浏览器遍历 index、practice-mode、knowledge-recall、question-workspace，登录弹窗正常打开且异步退出入口存在；图谱公共保存入口为新实现。正式检查使用独立匿名会话，未修改用户图谱或使用生产账号进行写入测试。
- 本地 Python CA 库缺失导致第一次 HTTPS 检查失败，改用系统 curl 的正常证书校验后通过；首次浏览器核验脚本错误假定所有页共享 KGAuthRuntime.logout，依据独立页现有 authLogout 入口修正后四页全部通过。

正式入口：https://lszl.aihuanpu.com/index.html?mode=free 。
