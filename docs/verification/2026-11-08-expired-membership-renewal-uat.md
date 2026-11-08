# 到期会员同套餐续费修复与 UAT 验证

日期：2026-11-08，Asia/Shanghai。用户要求月度、季度、半年会员到期后可购买相同套餐，先部署 UAT 等本人验收。

状态：UAT `v9.0-p4.1.430` 已部署并完成开发自检，等待用户本人业务验收。正式环境和 main 未变。

## 原因与改动

正式实际运行版本为 v9.0-p4.1.420，UAT 基线为 v9.0-p4.1.427。共享用户中心只比较历史套餐 ID 就标记“当前方案”并禁用购买按钮，没有消费订阅核心已经计算的 expired 状态。三个有限期套餐都有同一问题。

- 权威源 `new-legacy/src/33-user-center.js` 复用订阅摘要中的有效状态；已过期套餐不再按“当前方案”禁用，可以走现有 Native 下单接口。
- 有效同套餐、免费和终身套餐的原规则保留。没有修改价格、布局、字号、颜色或样式覆盖顺序。
- 会员弹窗内增加默认隐藏的支付错误文本，失败后按钮恢复可操作；解决做题页没有全局 showStatus 时错误不可见的问题。
- 重绘和关闭弹窗使旧异步结果失效，并停止旧支付轮询，避免旧请求更新已替换的弹窗或继续请求状态。
- 后端实现无需修改：过期套餐在支付成功后从服务端当前时间续期 30/90/180 天，下单本身不激活会员，重复支付通知不重复加时。

## 专项验证

- Node 行为测试先复现 7 个失败，局部修复后通过；随后补提示及异步重开场景，均先红后绿。最终新 13 项通过；合并既有支付/来源专项共 24 项通过，设计契约 5 项通过。
- 后端三套餐 × 原始 active/显式 expired 共 6 个新真实 API/数据库回归通过；连同订单取消与权益专项共 23 项通过。仅微信外部下单/回调密码学边界使用合成测试替身，不访问商户。
- 独立审查发现并复现关闭重开时错误写入旧 DOM 的问题，已用代次保护修复并复测。未发现其余 P1/P2 阻断项。
- 修复前旧 UAT 使用真实可见入口打开、待账号订阅就绪后关闭重开，稳定复现月度同套餐按钮禁用；0 个订单、0 次支付。证据位于 `artifacts/subscription-renewal/old-uat-reopened/`。
- 最终本地二维码浏览器矩阵：三套餐 × 首页桌面/做题页手机，6/6 通过。8 个真实本地 API/数据库订单、8 张真实二维码图片 GET/解码/展示、一次 HTTP503 后恢复、切换套餐再回原套餐通过。未调用 notify/demo-notify，订阅与权益均未变，订单均清理，独立服务和测试库已删除。证据：`artifacts/subscription-renewal/local-browser-final/`。本地进程启用演示支付，不宣称真实商户下单或实际付款。

## 环境与备份

UAT 微信支付商户参数全部未配置，demo=false；保持该环境配置。UAT 浏览器检查验证真实下单、错误反馈与重试，不把支付不可用称作真实扫码或付款成功。完整成功结算与回调幂等使用隔离数据库验证；本地浏览器的二维码测试使用仅本地进程启用的演示通道，不能真实付款。

UAT 部署前备份：`/home/ubuntu/lszl-uat-backups/20261108T081926Z-membership-renewal`。代码包 148964602 字节、数据库 dump 54570558 字节，非空、tar/pg_restore 目录及 SHA256 校验通过，manifest 已保存。

仅创建三个专用 UAT student 到期验收账号，不借用正式用户；凭据保留在工作区私有 `artifacts/subscription-renewal/uat-accounts.json`，不提交。UAT 浏览器脚本只取消自己创建且未支付的订单。

永久分支基线：main `6256275850e25c30cd7f3c696167c9d779122a46`；uat `c18a0eb46d43ef2e7fca91985ec5b34d9a5cb1b9`。功能分支 `codex/subscription-expired-renewal`。正式容器和 active 指针已在备份 manifest 记录，部署后再次核对。

## 发布阶段

最终 430 已在干净发布工作树 `.worktrees/subscription-renewal-release` 通过完整门禁，耗时 1766 秒，无跳过或降级。后端 1347 项、前端 434 项、账号恢复 82 项、扩展契约和全部浏览器流程通过。视觉对照：做题桌面/手机与自由图谱手机均 0%，自由图谱桌面 0.001%。完整证据：`artifacts/subscription-renewal/validation-430.json` 与 `validation-run-430.log`。

source SHA256 `ba2da4426e23720190385c06eb8c1c2676d79fc6384c0a1bb8e9c4761902df24`；site SHA256 `9c9d98cd33ed2e0433d21c40e43902470d45ce1e8a7c7ffba2a064ef01ef1032`。同步产物与不可变包完全一致，当前 430、回滚版本 429。

原工作区的既有未跟踪设计、视频和数据库备份未移动、未提交；部署脚本因它们正确中止原工作区的 preflight。改用工作区内的干净发布工作树后重新执行完整门禁。发布脚本因原源包含 30 个忽略的 Python/pytest 缓存而自动从已测 429 编号为 430；独立逐文件复核确认两版 site 均 1291 文件且路径相同，32 个 HTML 归一版本字符串后完全一致，会员模块哈希相同，没有业务回退。保留原本地 release 历史。

实现提交 `88e67227`，合入 uat 的提交 `98419988`；430 的 37 个版本生成物在发布工作树提交为 `dceba30f`，原 uat 纳回为 `6a6abe94`，两者文件树相同。功能分支和 uat 均经命令级代理推送，并核对远端引用；main 始终保持上述基线。

`PYTHONDONTWRITEBYTECODE=1 bash deploy/update-uat.sh` 在发布工作树退出 0，总耗时 2357 秒，含完整门禁 1770 秒和镜像/依赖重建 553 秒。健康、数据库、小程序、教师助手、HTTPS 和历史回填核验均通过，公网版本为 430。部署日志：`artifacts/subscription-renewal/uat-deploy-430.log`。

## 部署后实际核验

- UAT 容器当前 site 的 1291 个文件路径和全部 SHA256 逐项匹配本地已测 430，关键 admin-console.html 存在。HTTPS 首页/做题页的 release 与 bundle meta 均为 430，8 个静态资源哈希一致，健康 status/db 均 ok。报告：`artifacts/subscription-renewal/uat-runtime-430.json`。
- 正式容器 Id/Image 和完整 current.json 在核验前后均与备份 manifest 的 productionBefore 严格相同；本地及远端 main 均为 `6256275850e25c30cd7f3c696167c9d779122a46`。
- 三种到期套餐 × 首页桌面/做题页手机，共 6 个 UAT 真实浏览器场景全部通过。包含一次 HTTP503 恢复、同套餐重复下单重试、切换套餐再返回。14 个真实 UAT 订单均按预期 cancelled/failed，已逐项核对清理状态，会员和权益未改变；未付款、未调用支付激活接口。报告：`artifacts/subscription-renewal/uat-fixed-430/results.json`。
- UAT 商户凭据未配置，因此此环境验证的是可操作按钮、真实下单响应、明确失败提示与恢复；成功二维码由本地演示环境验证，付款激活由隔离数据库回归验证，不能宣称 UAT 真实扫码付款通过。

验收入口：<https://uat.aihuanpu.com/index.html> 或 <https://uat.aihuanpu.com/practice-mode.html>。使用私有 `artifacts/subscription-renewal/uat-accounts.json` 中的三个专用到期账号，打开会员权益，检查原套餐可选并能下单、失败后可重试。用户本人明确验收前不合入 main、不发布正式、不清理功能分支或发布工作树。

执行过的定向命令：`node --test frontend/scripts/subscription-renewal.test.mjs frontend/scripts/wechat-pay-contract.test.mjs new-legacy/tests/subscription-source.test.js`（24 项）；`cd frontend && pnpm test:design`（5 项）；`cd backend && .venv/bin/python -m pytest tests/test_subscription_expired_renewal.py tests/test_subscription_order_cancellation.py tests/test_subscription_entitlements.py -q`（23 项）。完整部署门禁包含 `.venv/bin/python -m pytest tests/ -q`（1347 项）和 `pnpm test`（434 项及附属契约）。

部署后命令：`python3 frontend/e2e/subscription_renewal.py --accounts-file artifacts/subscription-renewal/uat-accounts.json --output-dir artifacts/subscription-renewal/uat-fixed-430 --expect-unavailable`；`python3 artifacts/subscription-renewal/verify-uat-runtime.py`。两者均退出 0。

后续：用户已验收本修复及新增的有效期内同套餐续费，明确要求发布当前 UAT 全部内容；正式 432 的备份、部署和核验见 [2026-11-08-production-432.md](2026-11-08-production-432.md)。上文 main/正式未更新为当时 UAT 阶段状态。
