# Handoff: 入口去重、三维星空与免费导入候选378待官方完整发布

## Session Metadata
- Created: 2026-10-20T15:11:47.221637+08:00
- Project: /Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system
- Branch: codex/knowledge-space-3d, finalfix431a6611。main b76862ed，uat cf40f4fa（UAT377）。

## Handoff Chain
- Continues from: 2026-10-20-140654-danmaku-v377-knowledge-space-in-progress.md。
- Supersedes: 本轮全部实施/审查/真实API进度；早期文档进行态已过时，以本交接为准。

## Current State Summary
用户批准的学习入口去重/暗色三维重力知识星空，以及随后截图的免费会员个人图谱文件→导入，源实现与独立审查已全部完成。最终审查P1导入异步期间丢编辑已在431a6611修复、复审ADDRESSED无新Critical/Important。最新frontend全套377+9+4通过，真API两条业务闭环通过。候选VERSION378 source1218/public1230；当前immutable/active仍377，378官方full尚未开始。下一步立即官方full，不再开发/重复派工，成功后提交、合uat代理推送、部署并核验。用户未业务验收，绝不合main/正式环境。

## Architecture Overview
权威new-legacy；public官方sync产物；FastAPI实际使用immutable releases/current.json。3D独立Canvas模块投影有界重力/互斥/弹簧；现有loader owner/generation、60条分页、服务端30天练习新鲜度。导入只用editGraph，不赋予student教师importData；共享bridge远端create/adopt；共享Tabs切换锁提交草稿/保存/阻止并发UI写入。

## Critical Files
- src/practice/knowledge-space-scene.js、knowledge-dashboard.js与styles/knowledge-dashboard.css。
- src/18-graph-user-preferences.js、20-flashcards-toolbar.js、23-graph-file-editor-store-bridge.js、25-graph-file-tabs.js、27-home-interaction-modes.js。
- tests/graph-file-import-permissions-browser.py，graph-file-editor-store-bridge.test.js；frontend/e2e/canvas_release_regression.py正式门禁已接入。
- docs/superpowers/plans/2026-10-20-learning-entry-3d-knowledge-space.md与已批准spec。

## Key Patterns Discovered
菜单误用教师importData；JSON旧导入绕过远端只写本地，刷新丢失；桥create后GET失败需恢复原current并trash→permanent清理新记录；await创建需共享Tabs锁，且实际卡片编辑还走共享modes.can，需统一write能力锁。上述均已红绿/真实API/独立审查。XMind早期分派保持原流程。

## Work Completed
Task1 efe0f403/d2773162去重；Task2 25aa66ec/b8c6e85a场景；Task3 c9c2fb6c面板；Task4 7e78d585/c9a7ff87免费与持久化/失败恢复；最终431a6611编辑保护。root prep bdf73cc7/994e6b51。所有任务和最终复核已通过。

真实学习数据：artifacts/knowledge-space-20261020/api-integration-1.log，20次真实作答→20考点，Canvas/list/details/重开，12检查exit0，fixture36126清理0。
真实免费导入：artifacts/free-graph-import-20261020/final-fix/api-green.log与api-result.json，free套餐、截图菜单chooser→延迟POST写锁/真实inline草稿保存/双击编辑、新建、关闭阻断→保存刷新保留→GET503恢复/无遗留/角色边界通过。fixture56706退出0、无DB。
最新全前端：artifacts/knowledge-space-20261020/frontend-final-preflight.log，377/377+9运行时+4UAT部署脚本exit0。定向场景/面板1440/390/320、语言/弹幕等通过。

## Files Modified
业务源与测试已提交至431a6611；root最后同步产物与本交接待统一提交。新文件4项：sceneJS、sceneNode测试、scene浏览器测试、免费导入浏览器测试。source1218/public1230/旧377site1226，无旧路径删除。admin-console存在。

## Decisions Made
只按已批准两项大厅例外和免费个人导入修复；其余大厅暂缓保持。Canvas无依赖；保留真实数据，参考HTML原型固定55/XP/手动掌握不实现。所有通用能力复用共享模块。

## Immediate Next Steps
1. 冻结此交接（本文件影响validationContext）；提交root生成产物和文档。所有Python命令PYTHONDONTWRITEBYTECODE=1。
2. 官方 `caffeinate -i node frontend/scripts/manage-new-legacy.js update new-legacy` 完整full，不skip；日志artifacts/knowledge-space-20261020/full-update-378.log，预计基线约24分钟，不修改源/此交接/验证输入。
3. full成功后artifacts/knowledge-space-20261020/verify-local-release.py验证source snapshot与site/public逐字节、1230文件、旧路径/关键页、full证据；只提交生成release/current/manifest/sync，暂不改handoff以保留缓存。
4. mergeFF uat，代理7897push feature+uat，并ls-remote核对；永久main/uat不删除，不合main。
5. 官方 `PYTHONDONTWRITEBYTECODE=1 caffeinate -i bash deploy/update-uat.sh`；使用完整门禁缓存。公网verify-uat.py，容器verify-uat-container.py用docker exec -i运行，正式336容器镜像保持。服务器host旧current.json不是实际容器active，必须读/app。
6. 部署核验后才更新新handoff/验证文档并提交推送uat，停在UAT等用户本人验收。

## Blockers/Open Questions
无产品问题/审批待定。完整发布、部署未执行不代表成功。若full新失败按根因处理，不冒称通过。

## Deferred Items
原大厅其余暂缓、成人内容模板/公开课、164/20原场景待证等保持此前边界；推荐人与新用户各7天保持。旧可选learning-entry-answer-feedback.test.js引用早已缺失question-training.css，未纳入活动套件，已记录；当前活动377契约通过。

## Important Context
UAT377已部署cf40f4fa；正式336/main b76862ed未变。正式1145后端+377前端等仍需新full。真实inline草稿成功覆盖；真实ink草稿成功未浏览器独立验证，保留既有安全中止与草稿，不全局绕过readonly。回滚期间第二次API故障可能保留记录/选择，明确失败不报成功，非静默丢数据。

## Assumptions Made
免费个人图谱导入JSON/ZIP用相同parser/persistence；此次实际成功用JSON，不声称另跑ZIP/XMind完整E2E。三维亮度只为练习新鲜度，不表示掌握度。其余订阅权限保持。

## Potential Gotchas
先sync并暂存新public再full。full期间不写此handoff，不新建受git索引上下文影响的文件。ignored artifacts证据可写。新release manager成功才promote。不要重派已完成代理或复制旧源到release。

## Environment State
UAT SSHresume-prod root/home/ubuntu/lszl-kg-uat，backend18087/lszl-kg-uat-backend-1，PGkg_graph_uat共享lszl-kg-db-1。当前UAT容器ce132a...、imagefda90de...；正式容器c0c2b9...image8ff706...（完整值见备份manifest）。最近df6172912KB约5.88GiB，满足5GiB预检；不删备份/运行镜像。官方Bun缓存已清1.9GiB，Docker构建缓存本轮377已重建，别再全清导致依赖重新下载。
发布前已备份/home/ubuntu/lszl-uat-backups/20261020T063848Z：代码49591150B SHA312cccb29f25601d0373b2583da3379aec085ad2474edc634065a4419a5f8e03，DB27567519B SHAb51f5f2d86475e55e9ec12b9fe71bf51ca25d918070aba20413dd1cdcdf3bbe9；归档/TOC/manifest已校验，377镜像tag保留，不删旧备份。

## Related Resources
SDD全部任务/审查/diff/截图已归档artifacts/knowledge-space-20261020/sdd-review-archive/，原该计划SDD工作目录按skill已清理，兄弟目录未动。不要重新派工。
验证记录docs/verification/2026-10-20-knowledge-space-free-import-uat.md（发布状态尚待更新）。公网/容器/本地校验脚本均在artifacts/knowledge-space-20261020/；旧377全证据在artifacts/danmaku-visible-20261020/。
