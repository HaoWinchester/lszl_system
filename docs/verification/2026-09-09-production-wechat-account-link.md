# 正式环境微信账号关联发布记录（v9.0-p4.1.220）

用户明确要求发布正式环境。本次从正式 main 的 `4b0d6ba` 提取 UAT 已验证的微信账号修复 `e150815`，保留正式分支既有部署备份校验与其他正式修复。未包含 UAT 其他小程序业务改动。

## 发布内容

- 密码注册成功提示可选绑定微信；普通登录与微信注册不重复提示。
- 首次未关联微信先选择绑定原账号或明确创建新账号，避免静默创建另一账号。
- 已存在重复账号支持验证原账号密码后重新关联微信；订单、会员和小程序绑定冲突转人工处理，保留两个账号原有数据。
- 保留 UAT 已迁移的 revision 依赖链：`e7b4c2d8a910 → f4c8b6d9e120 → ab9012cd3456`。补齐原始前置迁移文件仅新增两个小程序认证空表，不包含其接口或业务模块，避免同一 revision 在不同环境具有不同父节点。

## 已完成验证

- 通过规定的 `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser` 构建候选。
- 候选 site 的 985 个文件与 UAT v220 全量验证包逐项 SHA-256 一致；含关键管理页面。
- UAT 完整验证记录：passed=true、profile=full、completedAt=2026-09-08T17:12:45.118Z。sourceHash=`9ff44c83c0a8997eb17dbf651bf7d5c2699e326d7500fcf0777fad5804ad41bb`，adapterHash=`442538f0049e5eb3cc576f69fe629e2cae826e8e0da77cd094cc967bfc587763`。该记录作为静态包一致性证据；正式候选后端另行回归。
- `pnpm test`：244 个 Node、9 个 Python 契约、4 项 UAT 部署脚本检查通过；`pnpm test:design` 通过。
- 正式候选独立浏览器矩阵通过：index、practice-mode、knowledge-recall、question-workspace 的注册、提示、跳过、退出、普通登录，以及首次微信选择、密码重试、绑定已有账号、再次直登、主动创建和找回原账号。仅外部微信换码模拟，API 和数据库真实运行。
- 公网健康接口 status=ok、db=ok；微信配置接口 mode=official、hasAppId=true、hasSecret=true。尚未进行真实手机扫码。

## 后端回归与备份

- 正式候选全量后端测试初次运行：637 通过、18 失败。失败均由既有教学内容迁移测试结束后未恢复 head、后续微信用例缺少新表导致。
- 提取 UAT 已有的迁移测试收尾修正（恢复数据后升级 head），连续运行迁移测试与全部微信用例：35/35 通过，覆盖先前 18 项失败；未再次重复其余已经通过的测试。
- 发布前正式容器 127 个 Python 文件与正式 main 逐项 SHA-256 一致；正式 v219 与候选 v220 文件集合相同（985 个），上一版本 v219 已作为不可变回滚版本保留。
- SSH 重试已恢复。正式当前迁移头为 e7b4c2d8a910；发布前可用磁盘约 12GB。
- 在同步、镜像重建、重启、迁移前，执行现有 deploy/update.sh 的备份阶段并通过 tar -tzf / pg_restore --list 校验。
- 备份目录：`/home/ubuntu/lszl-backups/20260909_081833`。
- 代码：`repo_20260909_081833.tar.gz`（511713660 字节）；数据库：`db_20260909_081833.dump`（134049759 字节）；清单：`manifest.txt`。
- 回滚镜像标签：`lszl-kg-backend:rollback-20260909_081833`。未执行数据库还原演练。

## 部署状态

已于 2026-09-09 08:25（Asia/Shanghai）完成正式部署和上线核验。代码提交 `19c0ebc` 已推送 main 并核对远程引用。

- 部署使用现有 deploy/update.sh 后续步骤，传输额外排除本地 artifacts，避免上传开发验证日志。
- 公网 `/VERSION` 为 `v9.0-p4.1.220`；健康接口 status=ok、db=ok。
- 正式迁移头 `ab9012cd3456`；容器 active release 的 985 个文件以及 129 个后台 Python 文件与本地发布候选逐项 SHA-256 完全一致。
- 正式发布指针 previousVersion 为 v219；备份与回滚镜像保留。
- 正式浏览器逐页检查 index、practice-mode、knowledge-recall、question-workspace，登录弹窗可打开，登录按钮与新微信账号流程公共模块存在。
- 匿名账号关联查询返回 401；正式微信授权地址生成成功，微信域名与正式 OAuth 回调地址匹配。真实手机扫码仍需用户实际体验，本次没有以模拟回调代替真实扫码验收。
- 正式地址：https://lszl.aihuanpu.com 。
