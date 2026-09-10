# 2026-09-10 部署提速 UAT 验证

已部署到 UAT，等待用户业务验收。实现提交 `4f2bd80c37a1b6208b98f63e8c9e5a057b33a9e6`；main 保持 `2bb4c7b8e4db2061f36ae2a09c0591bc5a828c4f`，没有部署正式环境。

## 实测

同一工作树、同一 v9.0-p4.1.226 release 连续执行两次 `bash deploy/update-uat.sh`，均未传递任何跳过验证参数，均成功退出。第二次仅依据同输入的成功验证证据复用。

| 阶段 | 首次完整发布 | 相同包再次发布 |
| --- | ---: | ---: |
| 预检 | 2 秒 | 2 秒 |
| 前端同步 | 1 秒 | 1 秒 |
| release 验证及 runtime 准备 | 701 秒 | 1 秒 |
| 传输 | 3 秒 | 2 秒 |
| 镜像构建与服务启动 | 9 秒 | 4 秒 |
| 本机健康检查 | 7 秒 | 0 秒 |
| HTTPS 与 Nginx 检查 | 1 秒 | 1 秒 |
| 历史数据指纹/目标校验 | 9 秒 | 8 秒 |
| 空间维护 | 1 秒 | 1 秒 |
| 公网版本核对 | 1 秒 | 1 秒 |
| 总计 | 735 秒 | 21 秒 |

总耗时从 735 秒到 21 秒，缩短约 97.1%。这衡量的是同一发布包的重复部署，不是新代码完整验收加速比；新代码、依赖、环境等变化仍会重新验证。首次包含新证据格式要求的一次完整验证。

完整验证内部：后端测试阶段 470 秒（707 passed，1 个已有 warning，pytest 本身 463.11 秒）；前端契约 46 秒；首页契约/浏览器 21 秒；扩展契约 1 秒；隔离环境 6 秒；做题浏览器 104 秒；跨业务浏览器 39 秒；视觉/清理 11 秒；合计 698 秒。

另从真实 UAT 工作树执行相同管理器 `update`，指向同一 release root，耗时 **0.830 秒**。两次复用前后 `validation.json` 和 `validation-run.log` 的 SHA-256、mtime 纳秒值全部不变，证明未重跑完整 validator。验证报告 SHA-256：`e808cbb42ae933b5c84bf1a7b90273abffabf18da737353e4f0cde1797badcee`。

## 验证范围

- 完整前端命令 `pnpm -C frontend test`：273 Node 测试、9 Python 契约、4 组 UAT shell 夹具通过；发布内部再次通过。
- 新回归覆盖跨 checkout/validator 路径复用、运维记录不失效、后端/未知文件/运行环境/权限变化失效、source/site 损坏保护、验证中输入变化、旧/失败/跳过/不兼容证据、实时日志及失败日志保留。
- 独立审查发现的清理耗时漏算、adapter staging 失败日志丢失均通过先失败后成功的回归修复，并复审通过。
- UAT 公网 `/api/v1/health` 返回应用/数据库正常；首页、practice-mode、knowledge-recall 均 HTTPS 200 且版本 v9.0-p4.1.226。使用默认校验证书的 curl；本机 Python urllib CA 配置缺失导致其探测失败，改用 curl 后验证通过，没有关闭 TLS 校验。
- 远端部署基线为实现提交 4f2bd80；远端管理器文件 SHA-256 与本机一致（`633ce8c57847831af8ff0c996e9a3c518596364fe227c62bf4b4178fa1ba92e8`）。UAT 后端正常运行。
- 当前源与原 UAT v226 sourceHash 一致，候选/原 UAT site 均 990 文件。没有前端业务源改动；版本保持 v226。
- 两次历史数据检查均因快照、代码及目标完整性未变跳过 backfill；没有变更 Nginx 配置。

原始日志保留在本功能工作树 `.superpowers/deployment-speed-uat.log`、`.superpowers/deployment-speed-uat-reuse.log`、`.superpowers/deployment-speed-reuse-proof.json`，完整验证日志在 `frontend/new-legacy-releases/v9.0-p4.1.226/validation-run.log`。这些是本地验证产物，不入 Git。

## 边界

新增优化适用于验证输入完全相同的发布包；没有把任意前端改动加入快速白名单。已有做题快速路径只增加两类目录下 Markdown 运维记录作为伴随变更。

正式环境备份和部署脚本的新增计时已做代码/语法审查；本次未实际执行正式环境部署，不能宣称正式环境速度已实测。功能分支保留，用户明确 UAT 验收通过后才可合入 main。
