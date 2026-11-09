# 学习记录分页正式发布 434

日期：2026-11-09，Asia/Shanghai。

用户明确确认“验收通过，合入 main 并部署到正式环境”。已验收uat提交`abda3bb2`从`f6baec43`快进合入main，使用命令级`http://127.0.0.1:7897`代理推送并核对远端引用。发布范围为已验收的学习记录分页及其生成产物，不复制UAT账号或练习数据。

## 发布前验证与备份

独立按原生管理器算法重算source、adapter、site、validator四项指纹，与434的`passed=true/profile=full`完整门禁一致：后端1364项、前端457项、真实浏览器及视觉检查均通过，总1825秒。正式原active432的1291个文件在434的1296个文件中全部保留，缺失0；管理页等关键页面齐全。原数据库head为`456f42ad29df`，本次无迁移文件。

**正式备份目录：`/home/ubuntu/lszl-backups/20261109_115618`**。原生发布脚本在任何代码同步、镜像重建、重启及迁移前生成并验证：

- 代码包`repo_20261109_115618.tar.gz`，43293932字节，SHA256 `96003e82cce5fd112dc549318ca402accaab820af0acaba9bc5f56d9998706b5`。
- 数据库`db_20261109_115618.dump`，244486349字节，SHA256 `5bf4d3b3d988cc05f2b93c5f52b60f3ce781efbbbbe8bbdd7f11708486bfcfd1`。
- 非空、tar目录、pg_restore目录及manifest均已校验；目录0700，文件0600。既有备份未删除。
- 回退镜像`lszl-kg-backend:rollback-20261109_115618`已核对为原实际运行432的`sha256:6bf6a512b5b473b77daa9fccf99fe8ce6bb1d0e2aa7b47298764f3e5896afa33`。

## 正式执行与复核

原工作区的三个用户未跟踪素材目录保持原样。为保持已验证输入及干净main发布条件，沿用已验收隔离目录运行`PYTHONDONTWRITEBYTECODE=1 bash deploy/update.sh`，退出0，总99秒：备份65秒、前端构建2秒、传输4秒、镜像及重启12秒、健康维护15秒。原生管理器复核指纹后复用同一份434完整验证，profile维持full。引导课程seed与已验收内容一致，业务payload不变。

- 正式公网、实际容器active均为`v9.0-p4.1.434`，previous为432；健康接口status/db均ok，小程序29路由/13表及教师助手readiness通过。
- 独立回读正式容器全部1296个站点文件，与已验收候选逐文件SHA256全部相等；三个变更业务文件及引导课程seed同样逐字节一致。
- 对受影响账号执行显式READ ONLY事务，用正式原生历史服务逐页读取：243条、13页、每页20条，首个20条摘要8156字节，无重复或遗漏；旧数组入口仍返回100条。部署前后243条会话的ID、答案及统计指纹全部不变，未恢复或改写学员数据。
- 数据库head仍为`456f42ad29df`；本次UAT合成验收账号在正式库为0条。
- 公网1440px和390px真实浏览器打开做题大厅、打开/关闭记录抽屉，访客正确显示登录提示，私有历史API拒绝为401，记录模块只在打开时加载。页面错误0、无水平溢出、练习写请求0；6项关键JS/CSS/manifest公网SHA256与实际release相同。

正式账号登录后的重复答题/清空操作未执行。本轮依靠用户已完成的UAT业务验收、正式同包核对、正式原生服务只读数据验证及公网浏览器检查确认发布；不把匿名界面检查写成登录后全流程验证。UAT仍保留已验收434，UAT测试数据未导入正式。

## 收尾与证据

本次功能分支`codex/practice-history-pagination`已确认完整合入main后删除，其远端分支原本不存在；仅移除本次自建`practice-history-pagination`工作树，main/uat永久分支与其他工作树保留。

清理前，整个工作树`artifacts/`的218个证据文件已按SHA256确认完整保留：历史分页专项目录移入主工作区`artifacts/practice-history-pagination/`，其他26个目录归档到`artifacts/production-history-434/uat-validation-artifacts/`。434完整不可变release的2546个文件逐字节核对后移回主工作区原先不存在的434目录，使用原生promote/prepareRuntime恢复本地current434/previous432；未手工覆盖release site。其余候选及原指针归档于`artifacts/production-history-434/local-release-evidence/`。

正式证据位于主工作区`artifacts/production-history-434/`，包括deploy.log、backup-verification.json、runtime-before/after.json、runtime-verification.json、public-browser-smoke.json及截图、candidate-superset.json和本地证据保全记录。真实账号标识、数据库内容及凭据仅存本地ignored证据，不提交Git。
