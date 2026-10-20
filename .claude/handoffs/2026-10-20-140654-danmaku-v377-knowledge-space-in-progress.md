# Handoff: 弹幕v377已部署，学习入口去重完成，三维知识星空开发中

## Session Metadata
- Created: 2026-10-20 14:06:54 Asia/Shanghai
- Project: /Users/menghao/Documents/幻谱/佩奇老师/测试环境/lszl_system
- Branch: codex/knowledge-space-3d；uat已推送cf40f4faca89e1dbc8b873a5fff8d852a551da83，main未改。

## Handoff Chain
- Continues from: [v376交接](2026-10-20-131559-practice-canvas-v376-uat.md)。
- Supersedes: 本轮新增弹幕回归与随后两项新需求的进行状态；上轮暂缓边界保持，用户最新明确点名的入口去重和知识星空除外。

## Current State Summary
用户反馈已答题、解析显示、评论可见、普通窗口但弹幕开启无显示。修复已通过v377官方full并合入推送uat；官方部署脚本已exit0（858秒），公网5页/81资源、容器12后端文件与数据库核对通过，UAT377已上线。随后用户要求学习报告/学习记录入口去重及参考本地HTML改成三维重力星空，已明确回复“按此方案实施”。新分支开发中，Task1已完成独立审查，Task2场景模块由实现智能体处理中，Task3面板集成尚未开始。不要重新问方案确认，不要结束任务只交付弹幕。

## Architecture Overview
权威源new-legacy，FastAPI按不可变release/current.json同源提供，public只是同步产物。星空继续现有knowledge-dashboard API/loader，60条/页、真实历史、账号隔离；新增独立Canvas三维场景，保留服务端30天练习新鲜度语义。

## Critical Files
- `new-legacy/src/100-practice-mode.js`：弹幕显式开启恢复。
- `new-legacy/tests/practice-danmaku-recovery-browser.py`：新回归。
- `docs/superpowers/specs/2026-10-20-learning-entry-3d-knowledge-space-design.md`：用户已确认设计。
- `docs/superpowers/plans/2026-10-20-learning-entry-3d-knowledge-space.md`：实施计划。
- `.superpowers/sdd/2026-10-20-learning-entry-3d-knowledge-space/progress.md`：SDD恢复地图，先读再派工。
- `new-legacy/src/practice/knowledge-dashboard.js`、`new-legacy/styles/knowledge-dashboard.css`：Task3面板待集成。
- `new-legacy/src/practice/knowledge-space-scene.js`：Task2新增模块，当前智能体可能正在写。

## Key Patterns Discovered
认证模块同账号刷新也派发kg-auth-session-change，评论模块清理实例但已答解析留在屏幕。旧弹幕开关只改偏好，既无法恢复缺失实例，也不能清除打开评论后的overlaySuppressed。修复只在明确开启、当前题已答、解析可见、模式允许时调用公共mountDanmaku。用户现场具体清理触发时机未直接获取DOM证据，不应当作已确认事实。

## Work Completed
- v377弹幕红绿回归：修复前开关true但0弹幕，修复后1440/390通过。覆盖直接恢复/先开评论、未答隐藏、关闭实时对错隐藏、退出清理；另有屏幕内可见矩形检查通过。
- 独立审查通过，另测未答显示答案预览、挑战和学霸不会提前显示。
- 官方full v377通过：后端1145、前端375、扩展10及所有浏览器、视觉门禁，2026-10-20T05:56:53.319Z，1463秒。
- cf40f4fa已通过命令级7897代理推送功能分支与uat；远端引用核对，main仍b76862ed。
- 新需求方案已确认，文档17e86e2b；Task1去重efe0f403 + d2773162，定向浏览器、3Node测试通过，独立spec/quality审查通过。

## Files Modified
新分支起点为cf40f4fa（弹幕交付提交），设计/计划提交17e86e2b，去重两提交efe0f403、d2773162。Task1四文件：practice-mode.html、lobby-dashboard.js、practice-lobby-fidelity-browser.py、practice-lobby-design-browser.py。root当前计划文件有补充说明尚未提交，不能让子任务误提交。新场景实现中的源/测试由space_task2所有。

## Decisions Made
- 保留学习记录入口及记录中的继续练习/查看成绩报告；移除重复的学习报告主入口。
- 用户确认参考暗色三维空间效果，并增加真实引力聚合；不把参考固定55点、手动掌握/XP/成就/localStorage当业务需求。
- Canvas2D投影三维坐标+有界重力/排斥/弹簧求解，无新依赖；停止/稳定/后台/减少动态必须降低开销。
- 用户“只在当前工作区”优先于新worktree建议；当前功能分支逐项代理实现、审查，不并行实现任务。

## Immediate Next Steps
1. v377部署和核验已完成，exec93353/20742/53938均已exit0，不要重复部署377。证据在artifacts/danmaku-visible-20261020；本交接与报告待下次文档提交。
2. 当前UAT容器ce132a76242db197e1aa7f200faf753491d6078b762057db54dfc29ca92de5dd，image fda90de16c46f3f1c872d9435d2fda74ba394f994229141ccbcfc1330539765e；active377/previous376、1226文件、代码cf40f4fa。正式336容器镜像不变。

3. Task2初版25aa66ec已实现6个新Node测试和两宽度浏览器通过；独立审查发现2个P2（按住不动RAF不停、默认取景过小），原实现智能体space_task2正在fix round1，等它更新报告；它的完整要求/报告/审查包均在此计划SDD目录。Task1复核由space_task1_review完成，pass/pass。不要重复分派已完成Task1。
4. Task2完成后按SDD生成全范围review-package并派独立审查；通过后Task3新实现智能体接入面板。最后全分支审查和本计划完整验证/新版本发布UAT，不停在本地实现。
5. Task1真实API companion已去掉旧reports按钮期望，只做语法校验；必须在集成时补跑。可同步新源到public，默认canvas_ink_server.py使用public fallback，抛弃DB实际API验证，无需提前promote release或skip gate。

## Blockers/Open Questions
没有待确认的产品方案，用户已确认。Task1真实API集成未跑不是通过；Task2/3仍在开发。当前任务2尚有2个P2修复，未审查通过，不开始任务3。

## Deferred Items
其余大厅重设计/模式合并等、成人模板、运营内容、164/20原卡顿等继承v376交接继续暂缓或待证；推荐码双方7天保持不变。用户没有给UAT业务验收通过，不合入main。

## Important Context
v377 sourceHash5ee149945727f7a0d3cf8a39bbc7534e2601da028ceba6626290db5bfdeb2cf6，adapterHashd8a633866d899791325f322f287bae340e2650c66680242d83807f048f4873f0，validatorHash3850b242d5a106941e31a641e95a8aef263a7c2adf13cb200faab5b8106788c3；source1214/site-public1226，无旧路径删除。新分支源已开始改变，不要拿新源冒充377 frozen包；公网核验脚本比较独立不可变377/site。

UAT备份`/home/ubuntu/lszl-uat-backups/20261020T053307Z`：代码49494840字节，SHA30884123df169a735059c21b5354f6b11ca6503fea4248d80aae723992b5029f；DB27564476字节，SHA3b5b2cec6229c9a4f20882d684698a746d4ede2198d6124a041b21824b5662af；归档/TOC/manifest验证，376镜像tag保留。旧备份不能删除。

## Assumptions Made
本地HTML是视觉与交互参考；原型内业务文案不是指令。保留API60条/页，界面明确本页节点数与总数，亮度只表示练习新鲜度。group key约定JSON.stringify([subject,taxonomyId])，避免DOM属性中的null字符。

## Potential Gotchas
- 所有Python命令PYTHONDONTWRITEBYTECODE=1，防ignored pyc改变immutable sourceHash。
- 先sync并暂存新public资源，再full；交接文件也影响validationContext，必须在新full开始前冻结或部署后再写。
- 当前377已部署固定cf40，本地新功能源未发布；新源只用于下一版完整发布。
- 为解决发布前低于5GiB，已清理Docker构建缓存和宿主APT下载缓存；未删除备份/镜像。代价是配套服务需重新下载依赖。下次部署前仍须核查磁盘，不能绕过5GiB预检。
- main与uat永久分支绝不删除；当前功能分支及弹幕分支都保留直到用户业务验收合main。

## Environment State
UAT SSH resume-prod，目录/home/ubuntu/lszl-kg-uat，后端18087，db kg_graph_uat/shared容器lszl-kg-db-1。正式336，原container c0c2b9a527e3ed0975493a3726f144512e5f9f464406f47a897e3d08dee48348，image8ff7068813ac25758c84dae5fdb941a0613af47b4b61824a1ba3ccd75dc7ee5e。root旧部署会话93353已经exit0；无本轮常驻本地API服务器。活跃实现代理space_task2，只能等它/续派同一代理修问题，不重复任务。

## Related Resources
- 弹幕交付`docs/verification/2026-10-20-danmaku-toggle-recovery-uat.md`
- 完整门禁`frontend/new-legacy-releases/v9.0-p4.1.377/validation-run.log`与validation.json（很大，不要整份cat，抽取元信息）。
- 证据`artifacts/danmaku-visible-20261020/`；参考截图`artifacts/knowledge-space-20261020/reference-1440.png`和reference-390.png。
- 用户原文件`/Users/menghao/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_d26m6zr7um9k51_e8f7/msg/file/2026-10/pmp_space_map_v2(2).html`，已完整读取及隔离渲染。

## 14:15进度补充
新功能Task2修复中，基线25aa66ec；Task3未开始。Task2接口见报告，select(index)不会触发onSelect，真实指针选择才回调；groups为key/subject/taxonomyId/indices/x/y/z数组，edges为source/target/group数组，snapshot.positions含index/key/group/x/y/scale/depth/visible。
磁盘部署后4308648KB，低于下次5GiB门槛；已发现可再生缓存pnpm store831MiB和宿主APT lists318MiB。正在执行pnpm store prune，会话需读artifacts/knowledge-space-20261020/pnpm-cache-cleanup.log核验结果；尚未清理APT lists，不删除任何备份或运行镜像。旧assistant镜像3ab831已被官方maintenance清理，不存在，不能作为下一次清理目标。

## 14:20进度补充
Task2 b8c6e85a修复了两P2，space_task2_review复审两个ADDRESSED，无新Critical/Important；Task2已完成，进入Task3面板集成。SDD ledger已记账，不能重派Task1/2。
pnpm store prune只回收小量；已使用Bun官方pm cache rm清理1.9GiB可再生安装缓存，未改bin/global安装/备份/运行镜像；当前df6272788KB，约5.98GiB，可满足下次发布及备份。APT lists未删除；磁盘inventory与缓存日志在artifacts/knowledge-space-20261020/。
