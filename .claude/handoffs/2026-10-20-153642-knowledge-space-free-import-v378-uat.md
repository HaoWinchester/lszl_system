# Handoff: 三维星空、学习入口去重与免费导入v378已部署UAT

## Session Metadata
- Created: 2026-10-20T15:36:42+08:00
- Project: /Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system
- Branch: uat。运行提交be947a602b2ff33c9acd803714482d3978f15b86；main b76862ed不变。功能分支codex/knowledge-space-3d保留。

## Handoff Chain
- Continues from: 2026-10-20-151147-knowledge-space-free-import-v378-preflight.md。
- Supersedes: 本轮全部实施/审查/真实API进度；早期文档进行态已过时，以本交接为准。

## Current State Summary
本轮四项实施任务已完成并部署UAT v9.0-p4.1.378。官方full1145后端/377前端/9运行时/4部署脚本/10扩展及全部浏览器通过（1243秒）；源1218/site-public1230一致。官方部署52秒exit0，公网5页/88资源与容器1230/12后端SHA、DB核验通过。免费个人图谱菜单权限、服务端持久化/失败恢复/异步编辑锁、入口去重与真实三维重力星空均已上线。当前阶段只等用户本人业务验收；不再重复开发/完整门禁/部署，不合main、不删功能分支。

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
业务源、测试与同步生成产物均已提交并合uat，运行提交be947a60；本次收尾只更新同步报告与验证/交接文档。完整release目录按仓库约定ignored，不强行纳入Git。所有实现和审查完成，不重复派工。

## Decisions Made
只按已批准两项大厅例外和免费个人导入修复；其余大厅暂缓保持。Canvas无依赖；保留真实数据，参考HTML原型固定55/XP/手动掌握不实现。所有通用能力复用共享模块。

## Immediate Next Steps
1. 提交本次交付记录及同步报告，命令级7897代理push uat并核对main/uat引用。
2. 停在UAT等待用户本人明确“验收通过/可以合main”。自动化通过不代表业务验收。
3. 只有收到明确验收后才可集成main；永久main/uat绝不删、不强推。未验收前功能分支/工作区保留。

## Blockers/Open Questions
无开发/发布阻塞；唯一待办是用户本人UAT验收。已通过的完整门禁和部署不重复执行。

## Deferred Items
原大厅其余暂缓、成人内容模板/公开课、164/20原场景待证等保持此前边界；推荐人与新用户各7天保持。旧可选learning-entry-answer-feedback.test.js引用早已缺失question-training.css，未纳入活动套件，已记录；当前活动377契约通过。

## Important Context
UAT实际active378/previous377，sourceHash2f74d835425fa7ab43678b23a904f960e2f407eb6ed28fd6e5d51f44ea817d4e，adapterHashd8a633866d899791325f322f287bae340e2650c66680242d83807f048f4873f0。full证据2026-10-20T07:33:01.238Z、validatorHashe0f001f06bcc699181661f94c4d840244ec8a3076b70c32e9fe92d9f61b1e43c。运行代码be947a60，正式336/main不变。后续文档提交会使本地validator context发生变化，但不修改已部署源或使这次通过记录失真；不可把文档HEAD误作运行提交。真实ink/ZIP/XMind边界与历史可选脚本缺CSS见验证记录。

## Assumptions Made
免费个人图谱导入JSON/ZIP用相同parser/persistence；此次实际成功用JSON，不声称另跑ZIP/XMind完整E2E。三维亮度只为练习新鲜度，不表示掌握度。其余订阅权限保持。

## Potential Gotchas
当前root docs收尾后应干净；不重启完整门禁仅为了文档变化。实际运行层是容器/app/frontend/new-legacy-releases/current.json；远端host旧current.json不代表actual。不要强加ignoredrelease到git。未来业务变更仍要官方发布、source/site/public核对，所有Python命令PYTHONDONTWRITEBYTECODE=1。

## Environment State
UAT SSHresume-prod root/home/ubuntu/lszl-kg-uat，backend18087、PGkg_graph_uat/共享lszl-kg-db-1。UAT容器/镜像：fff9e8ec32bad2bd069c964e925b9255a12a17b707c2b93110349fd1a3cd7627 sha256:d5b99a73fdc19a838c890852cd67e62e8da67f1ff7615180fa52ab47064088af。正式保持：c0c2b9a527e3ed0975493a3726f144512e5f9f464406f47a897e3d08dee48348 sha256:8ff7068813ac25758c84dae5fdb941a0613af47b4b61824a1ba3ccd75dc7ee5e。备份/home/ubuntu/lszl-uat-backups/20261020T063848Z，代码/PG归档/TOC/manifest/SHA已确认，377回滚镜像保留、既有备份未删。部署后df约5.9GiB，无需清理缓存。无本轮常驻本地测试服务器或临时DB；exec16531(full)与98537(deploy)均exit0。

## Related Resources
SDD全部任务/审查/diff/截图已归档artifacts/knowledge-space-20261020/sdd-review-archive/，原该计划SDD工作目录按skill已清理，兄弟目录未动。不要重新派工。
验证记录docs/verification/2026-10-20-knowledge-space-free-import-uat.md（发布状态尚待更新）。公网/容器/本地校验脚本均在artifacts/knowledge-space-20261020/；旧377全证据在artifacts/danmaku-visible-20261020/。

本交接写入于部署和所有核验通过之后；收尾文档提交后remote runtime代码仍be947a60，文档HEAD另记。验证记录docs/verification/2026-10-20-knowledge-space-free-import-uat.md。
