# 全量知识星空与弹窗滚动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** 完整展示后台当前已发布知识树，以本人真实作答点亮，并允许星空弹窗纵向滚动。
**Architecture:** 复用现有knowledge_dashboard_service冻结作答聚合+current_taxonomy；新增protected完整universe读接口；复用scene和dashboard扩展全量数据与滚动交互，无依赖/schema变化。
**Tech Stack:** FastAPI/SQLAlchemy/PostgreSQL + 原生JS/Canvas/Playwright。

## Global Constraints
- 用户已确认全部已发布知识树及弹窗内滚动；规格docs/superpowers/specs/2026-10-20-knowledge-universe-scroll-design.md。
- 只当前工作区，权威new-legacy，公共能力原共享模块扩展，无新依赖/schema/角色变更，不手改public/release。
- 目录是active科目当前published树active节点，全部返回/渲染，不硬编码320/317，不slice60或用展示分页代替全部。
- 每个节点的练习亮度只由当前owner有效保存作答产生，未练也显示，不能泄露其他owner或未发布内容；亮度非正确率/掌握度。
- 普通wheel/触摸纵向滚动弹窗；Ctrl/Meta wheel或双指缩放；鼠标/触摸横向旋转、现有按钮/选择/生命周期保持。
- 所有Python命令PYTHONDONTWRITEBYTECODE=1。永久main/uat保留，完成自检只部署UAT并等用户本人验收。

### Task 1: 已发布完整知识目录与个人练习叠加API

**Files:** Modify backend/app/services/knowledge_dashboard_service.py, backend/app/api/v1/learning.py; Create backend/tests/test_knowledge_universe.py; existing backend/tests/test_knowledge_dashboard.py保持兼容。
**Interfaces:** 新GET /api/v1/learning/practice/knowledge-universe(CurrentUser) -> get_universe(db,owner)完整单响应，不分页；复用current_taxonomy和原有效作答聚合读取。节点id稳定hash(taxonomyId,nodeId)，parentId同命名空间父id；保留nodes已有字段，增加parentNodeId/parentId/subjectId/taxonomyTitle/practiced。整体返回nodes,topicCount,practicedTopicCount,unpracticedTopicCount,attemptCount,recentAttemptCount,unknownAttemptCount,unmappedAttemptCount,subjects,now,brightnessMeaning:'practice-activity',dimAfterDays:30。
- [ ] 先写RED：未登录401；无作答仍出现完整目录暗色；121+节点无60/100截断；当前published版本选择/draft/archived/inactive过滤；真实父子/path；两个owner仅各自点亮；草稿/超时/无时间/未来作答不点亮；未知/未匹配历史计数保留；路径更名不重复当前节点；原历史接口契约不变。
```python
assert len(result['nodes']) == result['topicCount']
assert result['practicedTopicCount'] == 1
assert all(n['attemptCount']==0 and n['brightness']==.12 for n in result['nodes'] if not n['practiced'])
```
- [ ] 复用原service聚合state读取，不复制session有效性。目录用active ContentSubject与current_taxonomy（有效pointer+published fallback），节点statusactive。精确taxonomyId/nodeId叠加，冻结path改变不重复目录。未练.12，已练max(.4,1-.6*ageDays/30)，时间来自真实作答，三十天后保留已练亮度下限。
- [ ] current节点title/path用发布树；不回传题干/答案/私有题库内容；父路径防循环/缺失。未知引用保持unknownAttemptCount，识别但不在目录的次数unmappedAttemptCount。
- [ ] 运行新旧knowledge测试及相关teaching-current测试，报告RED/GREEN/命令/结果、自查，仅提交本任务源/测试，不碰root版本/同步/文档/发布。

### Task 2: 全量三维场景与可滚动交互

**Files:** Modify new-legacy/src/practice/knowledge-space-scene.js, new-legacy/tests/knowledge-space-scene.test.js, new-legacy/tests/knowledge-space-scene-browser.py。
**Interfaces:** createModel/stepModel/projectPoint/mount与snapshot保持；输入全部nodes，不截断，新增parentId真实树边。onSelect/选择、group、相机生命周期契约不变。
- [ ] 先写RED：320/1000输入points数完全一致；真实树边正确、不跨taxonomy；收敛有界/坐标有限/不改输入。普通wheel上滚动容器scrollTop变化且zoom不变，Ctrl/Meta wheelzoom变化且scrollTop不变；touch纵向滚动、横向旋转、pinch缩放。
```javascript
assert.equal(api.createModel(Array.from({length:320},(_,i)=>({id:String(i)}))).points.length,320);
```
- [ ] 移除LIMIT60，短距离排斥用3D空间桶邻域（cell75，邻27桶）保持原力模型/有界求解，避免全量n²；保留DPR2与idle停止/隐藏/reducedmotion/destroy。真实parentId边优先，旧无父引用形状保持组织fallback；未练.12的亮度可见但明显低于已练，不再clamp到.2。
- [ ] wheel只有ctrlKey/metaKey时preventDefault并缩放，其余交给native scroll；canvas touch-action:pan-y，单触摸方向判别避免纵向旋转/误选，横向旋转及双指缩放保持。鼠标拖动两轴旋转不改。
- [ ] 实际Chromium测试嵌套overflow容器的wheel和touch，含cancel与destroy，1440/390；现有fit/选择/相机/生命周期断言保持。记录320/1000可交互/求解耗时，无隐藏节点截断。只提交本任务文件并报告。

### Task 3: 全量面板、科目筛选与真实弹窗滚动

**Files:** Modify new-legacy/src/practice/knowledge-dashboard.js, new-legacy/styles/knowledge-dashboard.css, new-legacy/tests/knowledge-dashboard.test.js, new-legacy/tests/knowledge-dashboard-browser.py, new-legacy/tests/practice-lobby-design-browser.py; frontend/scripts/remaining-learning-requirements.test.mjs/frontend/scripts/validate-new-legacy-release.sh若已有注册无需重复。
**Interfaces:** GET新universe完整响应；保留public init/open/close/createLoader(owner/generation)API，refresh不再分页。Task1 schema与Task2相机/选择/group契约直接用；groupKey同JSON.stringify([subject,taxonomyId])，当前每科目一树可复用group按钮作为科目筛选。
- [ ] 先RED：320nodes全部Canvas/list可检索而不是60；零作答有暗节点；部分作答仅对应亮；统计“全部/已练/未练”；科目筛选count与详情同步；请求newendpoint一次；保留安全/owner迟到/401/error/retry/Canvasfallback/关闭清理。
- [ ] 清除PAGE_SIZE/slice/可见分页逻辑，完整nodes保留；科目button全/科目名+数量，人类可读title，无内部taxonomy ID。未练日期文案“尚未练习”，次数0；空目录提示暂无发布知识树，不再要求先答题才能有星点。亮度图例未练暗色/已练更亮/最近最亮，非掌握。
- [ ] 弹窗所有视口明确可滚动shell，关闭栏独立可达，不滚动背景；保持当前暗色视觉，避免宽泛改大厅CSS。1440×900/1440×650/390×844/320×568实际wheel从Canvas开始scrollTop变化，真实touch上下滑能看到详情/底部，close后大厅恢复wheel，键盘焦点可达。
- [ ] 更新真实API companion使用有效发布目录节点作为metadata.knowledge；真实完成作答后新universe目录全量出现，只有确切匹配的节点点亮，未练保持暗；关闭重开/刷新/另一owner隔离。不能mock成功数据。复用抛弃DB helper，root officialsync后运行；如本任务仅语法需诚实报告待跑。
- [ ] 运行scene/dashboard/大厅/弹幕语言回归与当前前端全套一次；截图自查，报告命令/结果，仅提交任务文件。

## 集成与交付（root）
- [ ] 按任务spec+quality审查并修复明确问题，最终全分支独立审查。
- [ ] 复用抛弃DB实际API闭环，加入真实UAT320目录只读核验；截图与滚轮/触摸为真实输入，不能仅scrollIntoView。
- [ ] VERSION379（当前378），重建content-prep、officialsync、暂存新增public后官方manage-new-legacy.js update new-legacy完整full，不skip；source/site/public一致，无旧路径删除。
- [ ] 新鲜备份UAT378代码+PG，验证非空/SHA/manifest和磁盘；FFuat命令级7897push并lsremote核对，官方update-uat部署、公网和容器源/版本/DB核验，正式main不变。
- [ ] 更新验证记录与session-handoff，停UAT等用户本人验收，不删除功能分支或永久分支。
