# 退款协议恢复与发布回退排查

## 已确认的问题

正式 PC 的实际容器 active release 是 v9.0-p4.1.225。线上只读访问证实缺少退款规则、练习页评论/弹幕资源、两类登录弹窗的 `kg:auth-required` 监听。主机目录中的 .159 指针属于残留，不能代表运行镜像；这次已直接读取实际容器与线上页面核实。

退款条款存在于历史 .207–.210、.212 源快照，协议版本为 1.1，生效日期 2026-09-12。当前分支此前没有继承该文本，小程序从旧源生成也就同步丢失。两端一致并不代表使用正确版本。历史包版本号并不按实际创建时间递增，不能据此推断某次提交删除了功能。

完整文件清单比较覆盖17个本地release source快照；独立审计详见 `2026-09-16-release-regression-audit-review.md`。生产后端133个源文件、53个数据库迁移另行做只读哈希比对。审计结果与范围不能当作所有功能无缺陷或用户UAT通过。

## 修复

- 从 .212/source 恢复 `new-legacy/terms-of-service.html` 原文，逐字节一致，未自行修改退款条件。
- 不足100题全退；100至不足150题退20%；150题及以上不退。按同一注册账户已提交记录计数，每订单一次申请，通过帮助入口申请，由管理员在微信支付商户后台人工原路退回。
- 运行现有sync脚本生成小程序正文，隐私政策保持原文同步。
- 标准 `manage-new-legacy update` 增加协议版本降级拦截，同版本正文变化拒绝发布；检查在缓存复用和skip-browser分支之前执行。此处不声称显式rollback命令也受同一限制。
- 独立回归测试固定已发布退款规则，避免PC和小程序同时变旧仍通过一致性测试。
- 评论/弹幕和401登录监听已由当前集成分支恢复，本次保留，不重复覆盖新答题页。

## 验证与交付记录

- 回归测试先失败：PC与小程序缺退款2项失败；同文件数下协议回退未拦截2项失败。
- 修复后法律测试4/4通过，发布防退2/2通过。
- 小程序完整246项测试通过。
- 微信开发者工具实际打开“我的→用户协议”，确认1.1版完整规则可滚动阅读。截图：`artifacts/refund-mini-verified.png`。
- 小程序开发版本1.0.5已成功上传，成功截图：`artifacts/refund-mini-upload-success.png`。尚未设置为体验版本、提审或正式发布。
- PC完整release校验与UAT部署结果将在完成后追加。
- UAT代码和数据库已备份并校验归档、dump、manifest：`/home/ubuntu/lszl-uat-backups/regression-recovery-20260916_161528`。
- 未修改正式环境、未合入main；main与uat保留。用户业务验收仍需本人执行。

## 原始证据（工作区artifacts，未纳入Git）

- `release-regression-inventory.json`：17份快照逐文件清单与差异。
- `refund-production-readonly.json`：正式HTTP资源特征核实。
- `production-code-hashes.json`：实际正式容器后端文件哈希。
- `legal-regression-red.log`、`legal-gate-red.log`、`legal-gate-green.log`。
- `refund-mini-tests.log`、`refund-release-validation.log`。

### PC候选完整校验

`v9.0-p4.1.234` 完整验收通过（598秒）：后端737项，前端279项，原生浏览器业务流程和四组视觉回归通过（差异均0%）。候选site与当前active均999文件，关键页面存在。独立题目评论浏览器契约通过。评审指出的测试命名问题已处理：同版本退款丢失用例现已真正删除退款段落；两项发布防退回归重新运行通过。

已同步234版本的public产物、manifest、sync report与课程seed元数据。部署脚本将对最终同步产物执行其自身验收。

额外执行 `python3 frontend/e2e/graph_logout.py`：首页、练习页、知识回忆、多题工作区四页的登录/退出及 `kg:auth-required` 登录弹窗均通过；保存失败阻止退出、恢复后保存退出、重开持久化也通过（隔离数据库，未改真实账号）。

### UAT更新完成

- 业务提交：`3e1a5b96c95d4653fb7d7ba149f7318236ae4e59`，已合入并推送uat。
- `bash deploy/update-uat.sh` 完整成功，635秒，exit 0；最终同步产物再次通过完整校验（598秒），737后端、279前端、浏览器流程、四组视觉差异0%。
- 实际UAT公开版本 `v9.0-p4.1.234`，健康检查通过，历史已发布试卷回填核查通过。
- 部署后直接HTTP核验7个资源：退款6项关键条文、评论脚本/样式、练习与成绩单挂载点、两类登录模块监听全部通过。在线隐私政策和使用条款article与源原文完全一致。
- 小程序后端就绪检查通过（29条必需路由、13张必需表）。
- `artifacts/refund-uat-deploy.log`、`artifacts/refund-uat-live-verification.json`保存部署与线上证据。
- 远端备份目录：`/home/ubuntu/lszl-uat-backups/regression-recovery-20260916_161528`。
- 正式PC仍保持原版本；此次没有合入main、部署正式或提审小程序。请用户在UAT及小程序1.0.5体验版验收后，再进入正式发布。
