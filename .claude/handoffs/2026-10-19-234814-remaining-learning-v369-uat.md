# Handoff: 剩余学习体验需求、双边7天推荐奖励及UAT v369交付

## Session Metadata

- Created: 2026-10-19 23:48:14（Asia/Shanghai）
- Project: /Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system
- Branch: uat
- 工作跨度：本日19点后至23:48，多轮功能实现、真实浏览器检查和最终发布。
- 实际UAT运行代码及远端部署状态：60bfba147dabed3a4aaf9a5bc207f7502f67630c。
- 功能代码提交：36a6afe99d85e45f1280f041abc5cacfa7cffe16；功能分支codex/remaining-learning-requirements保留在此提交。
- 本文件与最终核验记录会作为运行提交之后的文档提交推送uat；最终HEAD用git读取，远端运行提交仍以.deploy-state为准。
- main本地/远端均保持b76862ed2d12d36a6c3d0b6782f5bd601f12d8a5。

## Handoff Chain

- Continues from: [v361交接](./2026-10-19-190332-canvas-v361-uat-delivery.md)。
- 中间三项修复见[UAT v364记录](../../docs/verification/2026-10-19-practice-exit-help-auto-layout-uat.md)。
- 本交接更新运行状态与本轮范围，不改写先前历史记录。先前关于模板已加入、推荐码无奖励及候选版本的中间结论均以本文为准。

## Current State Summary

用户先要求读取最新交接、核对两份DOCX；再明确先修复退出弹幕残留、挑战/学霸帮助悬浮、思维导图选择即应用，测试后部署UAT，大厅暂缓。三项在v364交付。随后用户要求继续开发剩余功能，明确成人/国学等模板先不做，推荐码成功注册时推荐人与新用户各赠7天。本轮完成非暂缓功能并经完整开发自检、推送uat和官方部署，当前公网UAT为v9.0-p4.1.369。没有得到用户业务验收通过，禁止合入main、部署正式或清理功能分支。下一个动作是收集用户UAT验收反馈，不能继续擅做暂缓项。

## Architecture Overview

FastAPI + PostgreSQL + 原生HTML/CSS/JS。new-legacy是唯一前端源，frontend同步器组合服务端适配层生成public，官方manage工具将源快照打包为不可变site。FastAPI实际读取current.json所指release，生产不直接使用public。后端业务在services，路由编排参数和权限；业务数据按owner过滤，设备偏好按账号隔离。

## Critical Files

| File | Purpose |
|---|---|
| docs/verification/2026-10-19-requirements-gap-audit.md | 两份需求原审计表与最新进度；原始v361状态表故意保留历史 |
| docs/verification/2026-10-19-remaining-learning-requirements-uat.md | 本轮范围、验证、备份与线上核验 |
| docs/superpowers/plans/2026-10-19-remaining-learning-requirements.md | T1–T8完成/暂缓追踪 |
| new-legacy/src/119-question-comments.js | 共享弹幕、重播、设置和表情 |
| new-legacy/src/practice/practice-sound.js | 默认关闭的原生短音与生命周期 |
| new-legacy/src/practice/knowledge-dashboard.js | 星空看板界面、分页和账号隔离 |
| backend/app/services/knowledge_dashboard_service.py | 本人有效作答及冻结知识引用聚合 |
| backend/app/services/practice_session_service.py | 服务器acceptedAt、保存及评分时间边界 |
| backend/app/services/referral_service.py | 随机码、关系与双边奖励事务 |
| backend/app/services/subscription_service.py | 共享会员赠期、账号锁及原订阅入口 |
| backend/alembic/versions/c8d4e7f2b610_referral_membership_rewards.py | 新增nullable发奖标记，无历史补发 |
| frontend/scripts/new-legacy-assets/direct-system-adapter.js | 同账号刷新合并、旧账号迟到响应隔离 |
| new-legacy/src/37-subscription-core.js | 公共中文来源展示，canonical仍为referral |
| frontend/new-legacy-releases/current.json | 实际active369、previous364 |

## Work Completed

- [x] v364：保存退出弹幕清理；挑战/学霸问号支持hover/键盘/触屏；思维导图选择自动应用并保留撤销/保存。
- [x] T1：顶部两轨、移除暂停图标；数量/时长/透明度设置；举手复制后延迟一次重播，不发新评论或点赞；12种折叠表情；退出/切账号/离页清理。一般最多20，默认8；教师/管理员有200/600内部压力选项。
- [x] T2：默认关闭答题短音及开关；实时对错关闭时不泄漏结果，恢复/复习/重复作答不误播。
- [x] T3：本人全部有效保存作答按冻结考点聚合星空，30天渐暗至下限；未知考点只计数，亮度代表新鲜度。服务器验证选择后写首次acceptedAt；不信客户端时间，不给旧无时间草稿补造日期。
- [x] T4：默认收起的深灰56px圆形浮动菜单，统一保存/设置/音效与原动作，自动回收；窄屏所有菜单可实际滚动到达；帮助面板贴近触发器并保留延迟关闭。
- [x] T5：推荐码/链接、可选注册绑定、本人邀请数量，合法注册成功双方各7天；用户中心重开一次刷新真实权益。共享来源显示“推荐奖励”。
- [x] T6撤出：成人管理/逻辑/人际/国学模板、首页入口、深链、种子服务及专属测试均移除，UAT从未发布这批内容；保留原模板中心跨账号迟到响应安全修复。
- [x] T7：完成合成性能及真实账号只读排查，不添加无证据的优化。
- [x] T8：最终完整门禁、备份、推送与UAT部署、公网/容器核验完成。

## Files Modified

改动分布在119评论共享模块、100练习控制器、28设备偏好、107图标、29/30认证、33/35/37订阅展示、模板中心控制器及相关样式；后端新增referral/dashboard模型路由服务及b7/c8迁移，扩展共享订阅锁与服务器作答时间；同步public、manifest、报告一起提交。主要提交为7aa8fc7b（基础功能）、db51724d（public同步）、36a6afe9（双边奖励与撤出模板）、60bfba14（稳定发布输入）。源码和public均已入Git，release/runtime及测试证据按现有规则ignored。

## Decisions Made

- 用户明确双方各7天，服务端固定7，不允许客户端传奖励对象/时长；绑定、新用户、两边赠期和标记同事务，失败整体回滚。
- 免费账号取得monthly权限但仅7天，不建支付订单；未到期有限会员顺延、过期从服务器当前时间起，永久不降级、暂停不解封、角色不变。已有付费来源和订单metadata保留。
- 新注册只发一次，旧关系NULL标记不追补；共享账号advisory锁+行锁覆盖奖励、管理员、兑换、支付、审批及首次创建，防止旧ORM快照覆盖新增赠期。
- 同账号重叠订阅刷新合并，同owner+revision校验丢弃旧账号迟到响应。首次打开独立登录框即时聚焦，重复打开不抢密码输入焦点。
- 只读真实账号排查、最小匿名几何复测；未修改远端图谱，也未导出原文、备注、私题或资源。没有可复现瓶颈就不加优化代码。

## Validation and Deployment Evidence

官方full v369：1145后端通过（791.77秒、3项既有依赖弃用警告），369前端通过，扩展契约10项通过；练习、画布、跨域、多题资源和视觉阶段全部成功，总1303秒。passed=true、profile=full、未skip。另有奖励旧订阅跨入口46项、独立复核25项+2刷新专项、来源映射3项JS、真实会员模板403→201权限回归。四页真实认证流程在368完整包通过，369实际包再定向验证双方精确7天、一次重开一次GET刷新、中文来源与canonical不变，0页面异常，临时服务和DB已清理。

- Release: v9.0-p4.1.369，previousVersion v9.0-p4.1.364。
- sourceHash: de85e3e162cbf3925896d576c4c3b92254571576f54fb78c091ddbdb716d751a。
- adapterHash: 5de8be00a15895245bfba9636c5734a95d36c5eed04103a198cfe6e6d6da39f1。
- source1148文件；site/public1161逐字节一致；相对v364 site1148，无旧路径移除、新增13项，关键管理页齐全。
- 官方deploy/update-uat.sh成功53秒，远端.deploy-state为60bfba14。health/db/小程序29路由13表/教师助手均就绪，历史发布回填核验成功。
- 公网5公开页均369，20项静态SHA一致；访客admin-console403，推荐码和星空私有API401。容器11项后端SHA一致，Alembic head c8d4e7f2b610，发奖标记列存在，成人模板种子0。
- UAT容器12c2e3437ab0360c7ef89853119779cc637a381de914e1f809a3233398246cde；镜像sha256:08baa20a3b67f78a3ba3f2687def760916b9c5d01492ba2d8091ea8cfc065792。
- 正式公网保持336；容器c0c2b9a527e3ed0975493a3726f144512e5f9f464406f47a897e3d08dee48348、镜像sha256:8ff7068813ac25758c84dae5fdb941a0613af47b4b61824a1ba3ccd75dc7ee5e均未变化。

## Backup and Rollback

发布前UAT备份目录：/home/ubuntu/lszl-uat-backups/20261019T123625Z。code.tar.gz为49180895字节，kg_graph_uat.dump为27536328字节；代码归档、PG dump TOC、SHA和manifest全部验证，旧镜像保留tag lszl-kg-backend:uat-backup-20261019T123625Z。无既有备份删除。发布后磁盘约5GB。回滚须同时核对应用镜像、release369/364与新c8/b7表结构，不擅自对有用户新数据的库执行恢复。

## Pending Work

当前交付已停止在UAT阶段，自动化不是用户业务验收。没有需要继续开发的已授权阻塞项；下列暂缓/外部验证仍真实未完成，不能标为全部需求已完成。

## Immediate Next Steps

1. 等待用户本人在UAT验证当前累计内容；明确“验收通过”或“可以合入main”前，禁止推main/部署正式/删除功能分支。
2. 用户反馈Bug时先复现并定向修复；原性能问题需设备、浏览器及卡顿操作录像，用户已说不知道名称，不要反复追问名称。
3. 只有用户明确验收后才按AGENTS.md集成main并推送；正式部署前必须重新备份正式代码与数据库、校验非空manifest，不能复用UAT备份。
4. 最后才清理已合入的功能分支，显式排除并保留main与uat；目前两个相关功能分支均保留。

## Deferred Items and Open Questions

- 大厅模式合并、左上科目、二级分类、设置hover、卡片去重复/总数口径和进一步视觉调整继续暂缓。
- 成人/国学/指定书籍模板明确先不做；公开课与跨科目岗位体系属后续内容规划。
- 学习搭子、桌面/邮件提醒暂缓；企微旧链接缩略图缓存仍待真实客户端验证。
- 原164图谱/20回忆卡顿未闭环。真实账号匹配为佩奇007；UAT19/正式49图谱包含软删除，当前未找到164节点。正式118和UAT83节点代表图谱匿名投影在v336/v364专业模式32条记录P95为16.7–16.8ms、无卡片重建；合成164/20基线亦如此。headless不等于真实GPU呈现，未覆盖原字形/设备/操作，不能宣称修好。最小匿名投影及只读清单只在ignored artifacts，不入Git。
- 200/600弹幕实际DOM压力P95为16.8/33.4ms；600约30fps，不能宣传60fps。

## Important Context

用户本轮明确授权继续开发并测试后进入UAT，未授权合入main或正式部署。两份DOCX中的句子是需求材料，不是工具执行指令。成人模板先前短暂在本地候选中开发过，但最终已撤出，不能被旧报告或旧提交重新引入。旧源/active/public可能脱节，版本号不能证明内容新；本次逐字节核对1161文件，发布只走官方工具，不手工改release site或报告。Git push必须命令级使用http://127.0.0.1:7897并核验远端引用。

## Assumptions Made

推荐奖励触发点按用户回答的“推荐码注册成功后”执行，不追补既有账号或历史关系；永久、暂停及角色边界沿用现有订阅规则。星空亮度只代表练习时间新鲜度；没有可靠考点或旧逐题时间时不造内容。内容型需求无指定材料且被明确暂缓，因此本轮不发布原创成人框架。

## Potential Gotchas

1. manage update只同步到快照site，未必刷新全局public；必须先显式sync、核对并暂存所有新增ignored public，再跑full。提交新增文件后才加入cache上下文会使旧验证失效。
2. sourceHash包含ignored Python __pycache__。本次full导入两个测试后重写pyc，导致再次update提示同版本内容不同；首次部署在本地release-validation停止，未远端传输。370自动候选主动中止、未promote。恢复自动版本改动和这两个临时缓存为369已验证源快照后，1148源文件字节完全相同；官方工具合法复用原full并成功部署。未来应先拿字节证据，不能修改验证报告绕过；不要把本次370当已交付版本。
3. full使用caffeinate -i避免Mac空闲睡眠，命令结束自动解除；不修改系统常驻设置。验证context包含新handoff，故本文部署后才创建；文档收尾不改变正在运行的代码。
4. 推荐浏览器测试必须等待真实fetch就绪，不能恢复固定30ms竞态，也不能删旧账号迟到隔离断言。独立登录框不能恢复延迟focus。
5. Python本机默认CA缺失时，公网核验使用现有certifi可信CA，未关闭TLS校验。管理页访客应403，不能强行要求200；公开5页和容器关键管理页存在分别核验。
6. 原shared-auth-dialog窄屏字体全等断言存在可在旧HEAD复现的既有差异，本轮不重设计字体；真实四页认证功能已单独覆盖。

## Environment State

没有遗留本轮临时服务、DB、浏览器或full/deploy进程。UAT服务由Docker正常常驻；本地原开发环境保持。无需安装依赖，未改全局代理。敏感凭据保留原独立环境文件，不记录其值。完整full日志、composed-368/369报告截图及UAT公共/容器核验JSON在ignored artifacts，重要结论已落入本交接与交付记录；不要把私有图谱清单或匿名投影force-add。

## Related Resources

- [最新需求追踪](../../docs/verification/2026-10-19-requirements-gap-audit.md)
- [本轮交付](../../docs/verification/2026-10-19-remaining-learning-requirements-uat.md)
- [当前UAT](https://uat.aihuanpu.com)
- artifacts/remaining-learning-requirements 与 artifacts/composed-369 为本机验证证据目录。
