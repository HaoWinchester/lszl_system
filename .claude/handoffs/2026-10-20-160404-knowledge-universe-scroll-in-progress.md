# Handoff: 全量知识星空与弹窗滚动修复进行中

## Session Metadata
- Created: 2026-10-20T16:04:04.998922+08:00
- Project: /Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system
- Branch: codex/knowledge-universe-scroll，源基线uat1130e83e，方案提交f125f257。

## Handoff Chain
- Continues from: 2026-10-20-153642-knowledge-space-free-import-v378-uat.md。
- Supersedes: 用户已追加新反馈，本轮不能停在之前“只等待验收”；必须完成全量知识星空和弹窗滚动后新版本部署UAT。

## Current State Summary
用户反馈practice-mode.html无法滑动、知识点只有3个。异步问题已明确回复：无法滑动发生在打开知识星空后；全部采用“全部已发布知识树（推荐）”，未练也显示暗色、练过变亮、科目筛选。产品范围已确认，不再重复问方案批准。新设计与计划已提交。Task1 universe_backend正在实现新protected全量知识目录API，已首轮35测试通过，补充测试重跑中；Task2场景与Task3面板尚未启动，不重复派Task1。完成全部任务/独立审查/真实API/官方full379后部署UAT，仍不得合main。

## Architecture Overview
new-legacy权威，FastAPI按immutable active release服务。当前UAT378，source1218/site1230，正式336/mainb76862ed不变。新API /api/v1/learning/practice/knowledge-universe 全量active科目当前published树active节点+本人真实冻结作答；旧knowledge-dashboard历史分页API保持。场景移除60cap并空间分桶求解；普通滚轮/触摸纵向滚动，Ctrl/Meta滚轮或pinch缩放，横向触摸/鼠标拖动旋转。

## Critical Files
- docs/superpowers/specs/2026-10-20-knowledge-universe-scroll-design.md
- docs/superpowers/plans/2026-10-20-knowledge-universe-scroll.md
- .superpowers/sdd/2026-10-20-knowledge-universe-scroll/progress.md（先读防重派）
- backend/app/services/knowledge_dashboard_service.py、backend/app/api/v1/learning.py、backend/tests/test_knowledge_universe.py（Task1）
- new-legacy/src/practice/knowledge-space-scene.js、knowledge-dashboard.js及对应CSS/测试（Task2/3待做）。

## Key Patterns Discovered
旧后端只聚合练过的冻结考点，不是全部知识库；前端/场景另截60，不存在硬编码3。UAT只读目录核验PMP317+CSPM1+ACP1+NPDP1=320，不能硬编码这些数字。current_taxonomy已有有效current指针+published fallback，复用。
弹窗Canvas对所有wheel preventDefault并touch-action:none。真实布局probe（实际模块/CSS+隔离3节点）1440×650内容848>616、390×844 shell1181>765，Canvas上wheel500后scrollTop均0、zoom3→1.417，证明滚轮被当缩放；大厅真实UAT访客1440×900/650、390×844本身可滚。旧测试只验缩放/scrollIntoView，漏真实滚屏输入。证据artifacts/knowledge-universe-20261020/modal-scroll-red.json与uat-scroll-probe.json。

## Work Completed
用户scope确认，设计/计划f125f257；root数据与滚动根因probe；SDD setup和Task1分派。Task1报告路径task-1-report.md同SDDdir，模型gpt-6.1-sol high。API subjects约定[{id,code,name,topicCount,practicedTopicCount,unpracticedTopicCount}]；node.subject=code，parentId仅有效active树内父。新字段practiced/parentNodeId/subjectId/taxonomyTitle；未练brightness.12，已练max(.4,1-.6*age/30)，非掌握。

## Files Modified
root plan补充滚动RED与subjects接口尚未提交，子代理不可误提交；Task1只提交三个backend文件。root准备了artifacts/knowledge-universe-20261020/run-lobby-api.py，复用旧isolatedDBrunner，Task3后officialsync新源跑新目录，不能复用旧已删除DB的fixture输出目录。

## Decisions Made
按每科目当前发布版本，不重复历史已发布版本；未识别引用unknown计数、已识别但不在当前目录unmapped计数保留。仅精确taxonomy/node匹配，不按题干标题猜测。真实目录路径用当前发布tree，历史path更名不重复当前节点。无schema/依赖/角色/订阅变更，其余大厅暂缓不动。

## Immediate Next Steps
1. 等universe_backend报告/commit，按Task1basef125f257完整范围生成review-package，独立spec+quality审查。通过后记ledger再Task2新实现。
2. Task2 brief明确320/1000全量+空间hash、真实嵌套wheel/touch，不仅改CSS；Task3接完整endpoint+科目/统计/scrollshell，真实完整CSS和1440×900/650、390×844、320×568 wheel/touch/关闭后恢复大厅。
3. Task3真实API companion当前题目metadata使用不存在的lobby-knowledge-token，必须改为从真实universe读取20个有效发布PMP知识节点作为引用；backend/tests/conftest.py已seed内置317树。实际答题后应显示完整目录、仅20练过亮，另一owner暗、刷新重开保持。
4. 完成逐任务审查与最强模型全分支审查后，递增VERSION379/重建content-prep/officialsync/暂存新public，然后官方full（不skip）。记录源/目录/hash，无旧路径删除。
5. 发布前新鲜备份UAT378（不能把上次063848Z的377备份当378备份），非空/SHA/manifest，磁盘>=5GiB。FFuat、命令级7897代理push核对，官方deploy/update-uat.sh，公网/容器核验。backend learning.py和knowledge_dashboard_service.py会变，旧verify-uat-container.py静态hash必须基于新源更新，不冒用378hash。
6. 新验证/交接提交，停UAT等待用户明确验收，不合main/不删main/uat或功能分支。

## Blockers/Open Questions
没有产品确认待定。当前Task1还在处理，不能宣称全量接口已审查/发布。完整scroll方案/数据源是用户明确修正，不需重复审批。

## Deferred Items
其他大厅暂缓、成人模板/公开课、原164/20原场景待证继承；推荐双方7天不变。旧可选test缺question-training.css继承记录不本轮重写。

## Important Context
当前UAT运行be947a60/v378，uat文档HEAD1130e83e；正式mainb76862ed/336。v378 full1145/377全部通过；新后端变更必须新full。根因是交互与数据范围，不能只增加假背景星点或将分页页大小改大。

## Assumptions Made
全部知识目录对登录用户可见，只有本人练习overlay私有。新完整API无旧分页截断，旧历史接口保留兼容。所有新测试成功数据最终需真实API闭环；隔离UIprobe只作为滚动布局证据。

## Potential Gotchas
PYTHONDONTWRITEBYTECODE=1防sourceHash被pyc影响。只当前工作区写入，无新worktree/deps。新full前冻结handoff，期间不能修改受validationContext影响的源/新文件；证据写ignored artifacts。immutable release目录按gitignore不强行跟踪。版本号不代表内容新，旧路径检查不能省。

## Environment State
PostgreSQL本地/tmp，抛弃DB helper自建并清理kg_pytest_PID。UAT SSHresume-prod root/home/ubuntu/lszl-kg-uat，backend18087/lszl-kg-uat-backend-1，PGkg_graph_uat共享lszl-kg-db-1。当前UAT378镜像d5b99a73...、正式336镜像8ff70688...详见上轮交接；磁盘部署378后约5.9GiB，保留备份/回滚镜像。旧SDD计划已归档artifacts/knowledge-space-20261020/sdd-review-archive，新本计划workspace活跃不可清理。

## Related Resources
本轮证据artifacts/knowledge-universe-20261020/；最新业务规格/计划路径见上。Task1报告、diff和review结果使用本计划SDD目录持续记录。

Task1最新补充：ea854558完成，37定向测试+独立spec/quality审查通过，无findings。下一步Task2新agent场景/滚动；Task1不能重复派。其跨任务UI/部署边界留给Task2/3/root。

## 2026-10-20 用户追加熟练度规则后的恢复入口
用户已明确选择“综合计算熟练度”：按近期正确率、连续答对、有效练习次数计算，越熟练越亮。无确认待定。上文纯活动时间亮度与旧 Task3 编号均由本节及最新计划覆盖。
- Task1 已完成并审查通过：ea854558，37 项定向测试通过。
- Task2 场景/滚动正在由 universe_scene 实现，base1568b375，仅三个授权 scene 文件；root 不重复派发。
- 新 Task3 是后端综合熟练度；Task2 审查通过后才启动，不并行实现。最近20条已完成会话中的服务端有效判题，精确公式/字段见最新计划 Task3。活动/暂停会话仍记录已练，但不提前泄露成绩。未练亮度.12，已练待评估.2，其他 .2+.8*score/100。旧历史 dashboard 接口保持。
- 原面板任务改为 Task4，显示全部目录/科目筛选/熟练度及说明“完成练习后更新熟练度”；真实 API companion 必须使用发布树真实引用并覆盖不同成绩产生不同亮度、错误回落。
- 最新规格/计划已更新，root 自有文档尚待提交；SDD progress.md 为持续恢复入口。下一步等 Task2 报告后做独立审查，再 Task3、Task4、全分支审查、官方 full379、全新 UAT378 备份、部署 UAT 并等待本人验收。

进展检查点：Task2 fcf7df26 已独立审查通过，无 findings，16 Node 与实际 Chromium 1440/390 滚轮/触摸通过。Task3 ee944636 已实现并通过57定向测试（1既有弃用警告），universe_proficiency_review 正在审查；未通过审查前不启动 Task4。Task4 brief 已准备。当前 UAT378 与正式336容器/镜像只读核对未变，磁盘6079392KiB。

最新用户追加：多题归纳画笔变宽换行未经授权；原任务只说临时相关画布。root已明确承认共享工具栏范围扩大并道歉，承诺恢复原紧凑排版，仅隐藏箭头所指工具图标旁文字、保留悬浮提示。已追到98a96f8b共同ink注入group/label与palette末尾。新增Task5在Task4审查后执行；不可整文件回退破坏theme/dialogs/保存保护，不可全局改其他页面。root before/reference实际模块probe证据在toolbar-diagnostic。Task3审查通过（1既有弃用警告列minor），Task4 universe_dashboard正在实现base3c8eb04d，Task5尚未派。

用户再追加：画笔自定义颜色复用截图现有“卡牌或分组颜色”悬浮色板。已确认现有KGColorPickerV2.open/shared-color-picker-v2.js链路可用且question-workspace已加载，绝不重写面板。新增Task6在Task5审查后，以共享ink可选提供者在多题归纳显式接入，其他caller默认不变。生命周期/readonly/切画布迟到commit保护和真实颜色落库/刷新测试见计划Task6。Task4仍在实际650触摸诊断，真实API13项已过/DB清理，尚未审查完。

Task6追加明确授权：共用色板⌖按钮改通用滴管SVG（参考图2），公共入口统一图标，保留原EyeDropper和不可用隐藏，不重设计整个色板。计划/brief已更新。
