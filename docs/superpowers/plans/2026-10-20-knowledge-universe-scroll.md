# 全量知识星空与弹窗滚动 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** 完整展示后台当前已发布知识树，以本人真实作答点亮，并允许星空弹窗纵向滚动。
**Architecture:** 复用现有knowledge_dashboard_service冻结作答聚合+current_taxonomy；新增protected完整universe读接口；复用scene和dashboard扩展全量数据与滚动交互，无依赖/schema变化。
**Tech Stack:** FastAPI/SQLAlchemy/PostgreSQL + 原生JS/Canvas/Playwright。

## 最新用户执行顺序（优先）
用户明确要求“问题一个一个的改，改完之后我本地要看一下，没问题再发uat”。当前停在Task5本地验看，不自动启动Task6/7，也不递增版本、promote、推送或部署UAT。后续每个问题按用户本地确认逐项推进；原集成交付清单保留为未来待办，不能视为当前部署授权。

## Global Constraints
- 用户已确认全部已发布知识树及弹窗内滚动；规格docs/superpowers/specs/2026-10-20-knowledge-universe-scroll-design.md。
- 只当前工作区，权威new-legacy，公共能力原共享模块扩展，无新依赖/schema/角色变更，不手改public/release。
- 目录是active科目当前published树active节点，全部返回/渲染，不硬编码320/317，不slice60或用展示分页代替全部。
- 每个节点的练习亮度只由当前owner有效保存作答产生，未练也显示，不能泄露其他owner或未发布内容；亮度最终按用户追加确认的综合练习熟练度计算（见Task3），不可沿用初版纯时间亮度。
- 普通wheel/触摸纵向滚动弹窗；Ctrl/Meta wheel或双指缩放；鼠标/触摸横向旋转、现有按钮/选择/生命周期保持。
- 用户最新强调主题保留原来的选项、操作方式和入口位置，禁止改主题或其他页面布局；Task5仅恢复误改画笔与隐藏图标文字，Task6仅明确授权的色板复用/滴管图标。
- 所有Python命令PYTHONDONTWRITEBYTECODE=1。永久main/uat保留，完成自检只部署UAT并等用户本人验收。

### Task 1: 已发布完整知识目录与个人练习叠加API

**Files:** Modify backend/app/services/knowledge_dashboard_service.py, backend/app/api/v1/learning.py; Create backend/tests/test_knowledge_universe.py; existing backend/tests/test_knowledge_dashboard.py保持兼容。
**Interfaces:** 新GET /api/v1/learning/practice/knowledge-universe(CurrentUser) -> get_universe(db,owner)完整单响应，不分页；复用current_taxonomy和原有效作答聚合读取。节点id稳定hash(taxonomyId,nodeId)，parentId同命名空间父id；保留nodes已有字段，增加parentNodeId/parentId/subjectId/taxonomyTitle/practiced。整体返回nodes,topicCount,practicedTopicCount,unpracticedTopicCount,attemptCount,recentAttemptCount,unknownAttemptCount,unmappedAttemptCount,subjects,now,brightnessMeaning:'practice-activity',dimAfterDays:30。
- [x] 先写RED：未登录401；无作答仍出现完整目录暗色；121+节点无60/100截断；当前published版本选择/draft/archived/inactive过滤；真实父子/path；两个owner仅各自点亮；草稿/超时/无时间/未来作答不点亮；未知/未匹配历史计数保留；路径更名不重复当前节点；原历史接口契约不变。
```python
assert len(result['nodes']) == result['topicCount']
assert result['practicedTopicCount'] == 1
assert all(n['attemptCount']==0 and n['brightness']==.12 for n in result['nodes'] if not n['practiced'])
```
- [x] 复用原service聚合state读取，不复制session有效性。目录用active ContentSubject与current_taxonomy（有效pointer+published fallback），节点statusactive。精确taxonomyId/nodeId叠加，冻结path改变不重复目录。未练.12，已练max(.4,1-.6*ageDays/30)，时间来自真实作答，三十天后保留已练亮度下限。
- [x] current节点title/path用发布树；不回传题干/答案/私有题库内容；父路径防循环/缺失。未知引用保持unknownAttemptCount，识别但不在目录的次数unmappedAttemptCount。
- [x] 运行新旧knowledge测试及相关teaching-current测试，报告RED/GREEN/命令/结果、自查，仅提交本任务源/测试，不碰root版本/同步/文档/发布。

### Task 2: 全量三维场景与可滚动交互

**Files:** Modify new-legacy/src/practice/knowledge-space-scene.js, new-legacy/tests/knowledge-space-scene.test.js, new-legacy/tests/knowledge-space-scene-browser.py。
**Interfaces:** createModel/stepModel/projectPoint/mount与snapshot保持；输入全部nodes，不截断，新增parentId真实树边。onSelect/选择、group、相机生命周期契约不变。
- [x] 先写RED：320/1000输入points数完全一致；真实树边正确、不跨taxonomy；收敛有界/坐标有限/不改输入。普通wheel上滚动容器scrollTop变化且zoom不变，Ctrl/Meta wheelzoom变化且scrollTop不变；touch纵向滚动、横向旋转、pinch缩放。
```javascript
assert.equal(api.createModel(Array.from({length:320},(_,i)=>({id:String(i)}))).points.length,320);
```
- [x] 移除LIMIT60，短距离排斥用3D空间桶邻域（cell75，邻27桶）保持原力模型/有界求解，避免全量n²；保留DPR2与idle停止/隐藏/reducedmotion/destroy。真实parentId边优先，旧无父引用形状保持组织fallback；未练.12的亮度可见但明显低于已练，不再clamp到.2。
- [x] wheel只有ctrlKey/metaKey时preventDefault并缩放，其余交给native scroll；canvas touch-action:pan-y，单触摸方向判别避免纵向旋转/误选，横向旋转及双指缩放保持。鼠标拖动两轴旋转不改。
- [x] 实际Chromium测试嵌套overflow容器的wheel和touch，含cancel与destroy，1440/390；现有fit/选择/相机/生命周期断言保持。记录320/1000可交互/求解耗时，无隐藏节点截断。只提交本任务文件并报告。

### Task 3: 综合练习熟练度与分级亮度（用户追加确认）

**Files:** Modify backend/app/services/knowledge_dashboard_service.py, backend/tests/test_knowledge_universe.py；旧backend/tests/test_knowledge_dashboard.py保持原历史契约。
**Interfaces:** get_universe完整目录/owner/parent/统计契约保留，新增节点proficiencyScore(nullable0..100),proficiencyLevel(unpracticed/pending/developing/familiar/proficient),gradedAttemptCount,correctCount,recentGradedAttemptCount,recentCorrectCount,recentAccuracy(nullable0..1),correctStreak。brightnessMeaning='practice-proficiency'，新universe不再宣称时间衰减dimAfterDays；旧dashboard不改。
- [x] 先RED：同一知识点1/5/10次全对熟练度27.3/62.5/100，亮度严格递增；加入近期错误后降低，全部错不靠刷次数升熟练；最近20窗口、顺序无关、同时间稳定、冻结path变体合并、两个owner隔离；未练暗.12，已练尚无可结算成绩待评估.2且正确率null；活动/暂停会话不提前影响分值，completed后更新；草稿/超时/无有效时间/未来/missingbool不计熟练。保留Task1所有目录和历史契约断言，修改旧亮度断言是本次用户明确改变规则。
```python
assert score([True]) == 27.3
assert score([True]*5) == 62.5
assert score([True]*10) == 100
assert score([True]*10+[False]) < 100
```
- [x] 复用共享有效答案处理，在_owner_state传入session完成态及稳定sessionid，只有已完成练习的服务端bool判题能计分；不复制第二套判题，不读客户端correct或按题目猜。每知识点最近20记录用有界heap/列表，所有历史会话仍正确计次数；先按稳定tuple(timestamp,sessionid,questionid)取最近20后算尾部连对。
- [x] P=round(100*(.8*近期准确率+.2*min(连对/5,1))*(.25+.75*min(N/10,1)),1)，N0scoreNone(未练score0可用)，practicebrightness .2+.8*P/100，未练.12。分级<40developing/40..<75familiar/>=75proficient，未练/无判题分别unpracticed/pending。近期窗口count<=20，lifetime graded/correct单独统计，未匹配历史仍计原unknown/unmapped，不产生假目录点。
- [x] 运行新旧knowledge/当前发布选择/做题提交结果相关定向测试，报告RED/GREEN/精确接口/异常边界，仅提交任务文件。Task2完成并审查后才启动本任务，不并行实现。

### Task 4: 全量面板、科目筛选与真实弹窗滚动

**Files:** Modify new-legacy/src/practice/knowledge-dashboard.js, new-legacy/styles/knowledge-dashboard.css, new-legacy/tests/knowledge-dashboard.test.js, new-legacy/tests/knowledge-dashboard-browser.py, new-legacy/tests/practice-lobby-design-browser.py; frontend/scripts/remaining-learning-requirements.test.mjs/frontend/scripts/validate-new-legacy-release.sh若已有注册无需重复。
**Interfaces:** GET新universe完整响应+Task3熟练度字段；保留public init/open/close/createLoader(owner/generation)API，refresh不再分页。Task1 schema与Task2相机/选择/group契约直接用；groupKey同JSON.stringify([subject,taxonomyId])，当前每科目一树可复用group按钮作为科目筛选。
- [x] 先RED：320nodes全部Canvas/list可检索而不是60；零作答有暗节点；部分作答仅对应亮；统计“全部/已练/未练”；科目筛选count与详情同步；请求newendpoint一次；保留安全/owner迟到/401/error/retry/Canvasfallback/关闭清理。
- [x] 清除PAGE_SIZE/slice/可见分页逻辑，完整nodes保留；科目button全/科目名+数量，人类可读title，无内部taxonomy ID。未练日期文案“尚未练习”，次数0；空目录提示暂无发布知识树，不再要求先答题才能有星点。亮度图例未练暗色/待巩固/逐渐熟悉/较熟练，越熟练越亮；详情显示综合分值、近期正确率/样本数和连对，pending显示待评估而非0%错误；说明完成练习后更新熟练度。
- [x] 弹窗所有视口明确可滚动shell，关闭栏独立可达，不滚动背景；保持当前暗色视觉，避免宽泛改大厅CSS。1440×900/1440×650/390×844/320×568实际wheel从Canvas开始scrollTop变化，真实touch上下滑能看到详情/底部，close后大厅恢复wheel，键盘焦点可达。
- [x] 更新真实API companion使用有效发布目录节点作为metadata.knowledge；真实完成作答后新universe目录全量出现，只有确切匹配的节点点亮，未练保持暗；关闭重开/刷新/另一owner隔离。不能mock成功数据。复用抛弃DB helper，root officialsync后运行；如本任务仅语法需诚实报告待跑。
- [x] 运行scene/dashboard/大厅/弹幕语言回归与当前前端全套一次；截图自查，报告命令/结果，仅提交任务文件。修正browser脚本旧SDD输出路径，证据统一artifacts/knowledge-universe-20261020/task-4/，不要重建已清理的兄弟计划workspace。完整前端套件需officialsync后由root执行；实现报告若尚未同步应明确待集成验证，避免拿旧public通过冒充新源通过。

### Task 5: 恢复多题归纳原有紧凑画笔排版，仅隐藏图标按钮文字

**背景与范围纠正：** 用户两张截图明确反对多题归纳画笔排版被顺带重做，原先授权仅临时相关画布图标/顶部工具栏；最新确认多题归纳顶部选择/画笔等及底部绘制图标不显示文字，悬浮提示即可。不得继续重设计。根因已追到98a96f8b向共享94-canvas-ink注入label/group并将palette移到末尾，inner flexwrap与绝对定位shrink-to-fit使桌面换行。原98a96f8b^在1440/1024为596×50单排，现1440为720×78、1024为512×92；390旧79高变137，320旧79变183。证据artifacts/knowledge-universe-20261020/toolbar-diagnostic/{before,reference}.json与截图，reference用git保存的前版真实模块。
**Files:** Modify new-legacy/src/canvas/94-canvas-ink.js, new-legacy/src/canvas/toolbar.js, new-legacy/src/77-multi-question-workspace.js, new-legacy/styles/canvas-toolbar.css或canvas-ink.css（只必要局部），new-legacy/tests/workspace-ink-toolbar-browser.py，必要现有frontend/scripts/practice-canvas-interaction.test.mjs。禁止整文件回退98a96：其中已有dialogs/theme/保存保护须保留。
- [x] 先RED：真实共享模块+完整页面CSS可见label、palette第二行；断言恢复多题归纳既有紧凑按钮/颜色顺序，桌面1840/1440/1024单排无巨大空白；390/320仍可达不越界，允许原移动两排。不能只测未加载KGCanvasToolbar的旧isolated fixture。
- [x] 复用共享模块加入职责清晰的可选紧凑/只图标呈现，在多题归纳入口显式使用；恢复原palette在撤销重做之后、设置之前，保留按钮原title/aria-label及状态/快捷键。顶部选择/画笔/截图/字号/重置等已有图标的工具按钮隐藏label，中文title悬浮提示保留；不要隐藏智能整理下拉/归纳卡等业务动作文字或主题选项值。不得全局更改临时相关画布/深度回忆已授权视觉，其他caller默认行为保持。
- [x] 鼠标与键盘实际切换选择/画笔/高亮/文字/橡皮、颜色、设置、收起、撤销重做；绘画真实生成、撤销/重做同history、刷新保留。无编辑权限保持禁用；恢复过程中不触碰保存/文本草稿/共享dialogs/theme行为。用现有抛弃DB helper测试多题归纳真实页面，同时遍历共享调用方相关画布/深度回忆/首页画笔的入口与图标及可用性防范围回归，只对授权多题恢复布局。
- [x] 截图原/修复对比及hover标题/aria证据写artifacts/knowledge-universe-20261020/task-5/，运行现有定向契约及浏览器；只提交授权源/测试，报告精确命令与已验证边界，root最终sync/full/UAT。此任务在Task4审查通过后实施，禁止并行改产品代码。

### Task 6: 多题归纳画笔自定义颜色复用现有悬浮色板

**用户明确追加：** 画笔色盘的自定义颜色复用截图中“卡牌或分组颜色”浮层。只接入现有能力，不新增或重设计颜色面板，不改变Task5恢复的紧凑排列。
**Files:** Modify new-legacy/src/canvas/94-canvas-ink.js、new-legacy/src/77-multi-question-workspace.js、new-legacy/src/graph/color-picker-controller.js、new-legacy/styles/canvas-color-picker.css（后两者只滴管图标局部）；必要既有new-legacy/src/canvas/toolbar.js/样式局部；Extend new-legacy/tests/workspace-ink-toolbar-browser.py和必要canvas-ink-controller-browser.py/已有契约。
**现有接口：** KGColorPickerV2.open已加载于question-workspace.html，实际实现src/graph/shared-color-picker-v2.js→floating-color-window-controller.js→color-picker-controller.js，与卡牌共用。open接anchor/title/kind/value{color,opacity}/allowOpacity/allowTransparent/documentColors/onCommit等。现有画笔input[type=color]在94约280行，updateTextStyle为唯一颜色应用路径；复用，不复制HSV、预设/最近使用/取色器实现。
- [ ] RED：在真实多题归纳点画笔自定义色块后，现有同一个graph-floating-color-window出现而非系统native色窗，title为画笔自定义颜色，预设/SV/色相/HEX/最近使用可用。当前该点不打开共用浮层，先记录失败。
- [ ] 通过共享ink模块职责明确的可选回调/提供者由多题归纳显式接入KGColorPickerV2；其余页面默认native色块行为不变。允许复用原input并拦截用户点击默认行为，但键盘激活也必须打开浮层且无native picker。浮层锚定自定义色块，保持Task5原紧凑排版；不增加工具按钮。已有笔迹透明度设置保持，不额外将颜色透明度变成新业务需求。
- [ ] 用户进一步明确共用色板的取色按钮“⌖”改成通用滴管图标：复用同一公共color-picker-controller入口，用清晰描边SVG替换字符，按钮内居中，保持title/aria-label“吸取屏幕颜色”、原EyeDropper功能与不支持时隐藏逻辑。此处全局图标一致是用户明确授权，其他布局不变；不额外重设计整个色板。
- [ ] onCommit经过现有updateTextStyle更新当前笔/高亮/文字颜色与工具图标/光标，随后真实绘画/文字保存服务器并刷新保留颜色。关闭/取消未提交预览不改已提交颜色，非法HEX不产生无效样式。只读不开放/不应用；打开后切工具、切画布、切owner、关闭或destroy不能由迟到commit把颜色应用到其他上下文；使用原module生命周期和上下文校验，不复制存储/判权。不能误改卡牌/分组颜色。
- [ ] 真实浏览器验证鼠标/键盘开启、预设与HEX选择、hover/拖动浮层、关闭重开、最近使用、全屏以及390/320不越界，已有卡牌色板仍可用；OS屏幕取色器只能验证支持性/取消，未实际系统选色须如实记录边界。复用抛弃DB helper，成功业务不mock；截图/evidence artifacts/knowledge-universe-20261020/task-6/。只提交授权源/测试，报告精确已验证/未验证范围。Task5审查后启动，no并行实现，root最后sync/full/UAT。

### Task 7: 阅读模式双击进入临时画布，临时卡牌始终可拖动

**用户明确追加：** 阅读模式选卡后截图中的grip+打开相关画布悬浮小工具栏取消，改为鼠标双击卡牌进入；临时画布不继承阅读模式禁止拖卡，任何入口模式均可拖动临时卡牌。拖动只改变本次临时布局，不回写原图谱，不额外更改主题/布局。
**Files:** Modify new-legacy/src/10-graph-editor.js、new-legacy/src/graph/related-canvas-controller.js；仅必要现有styles/home-interaction-modes-p4330.css；Extend new-legacy/tests/v91-related-canvas-reading-mode.test.js、new-legacy/tests/related-canvas-readonly-browser.py，必要现有前端专项契约。
**已定位：** updateCardQuickActions 当前readingEntry故意放行read-only工具栏；10-graph-editor有两个cardsLayer dblclick处理器（约2804/2870），需统一正确路由并避免stage双击新建/正文编辑冲突。openRelatedCanvasModal使用temporary session并传readOnly=!canWriteGraph()；related-canvas-controller renderCards pointerdown在readOnly直接return，阻断本地拖动。session临时副本/history既有，不要改主图权限或创建持久化工作区。
- [ ] RED：阅读单击/悬浮卡牌不出现小工具栏，双击同卡一次打开相关画布；当前旧版工具栏出现、双击不开应记录失败。模式切换后仍隐藏reading mini-toolbar，efficient/professional原工具栏与双击编辑保持。
- [ ] 在现有公共图谱交互入口实现reading双击→选择目标卡并走原openRelatedCanvasModal保护（草稿保存/文件切换锁/迟到generation/单例）；单击仍看详情。不要拦截卡内链接/按钮/输入/正在编辑正文、不要同时触发主画布新建或编辑；其他模式行为不改。
- [ ] 将临时布局拖动与readOnly内容编辑权限分离；阅读/编辑等模式进入后，卡牌可真实pointer拖动且连线实时跟随，释放/取消正确结束捕获，缩放下坐标正确。readOnly仍隐藏新增/删除/连线/画笔等内容编辑，不得仅为拖动清空整个readonly。说明改为可拖动临时排列、关闭丢弃，内容权限保留。临时数据依旧session副本，无任何原图节点坐标/关系/锁定或后端数据改变。
- [ ] 真实浏览器API创建图谱→切reading→单击无toolbar→双击开→拖动卡牌后坐标变化/连线跟随→关/重开还原→刷新原图/API坐标逐字不变；记录弹层期间files写请求0。正常editable临时仍保留原新增/绘画/history；其他模式主图工具栏/双击不回归。验证关闭/Escape/全屏、缩放拖动/cancel、连续双击仅单例；合法只读查看上下文只能临时拖动、不扩展正式编辑权限，源文件真正403边界保持。
- [ ] 更新旧契约“只读禁止拖动/阅读放行小工具栏”的断言为本次用户明确新规则，同时保留内容禁改/零写入/临时副本/已有ink生命周期断言。不得只删断言过测试。证据artifacts/knowledge-universe-20261020/task-7/，复用抛弃DB，报告实际/未验证边界；仅授权文件提交。Task6审查后启动，不并行实现，root统一sync/full/UAT。

## 集成与交付（root）
- [ ] 按任务spec+quality审查并修复明确问题，最终全分支独立审查。
- [ ] 复用抛弃DB实际API闭环，加入真实UAT320目录只读核验；截图与滚轮/触摸为真实输入，不能仅scrollIntoView。
- [ ] VERSION379（当前378），重建content-prep、officialsync、暂存新增public后官方manage-new-legacy.js update new-legacy完整full，不skip；source/site/public一致，无旧路径删除。
- [ ] 新鲜备份UAT378代码+PG，验证非空/SHA/manifest和磁盘；FFuat命令级7897push并lsremote核对，官方update-uat部署、公网和容器源/版本/DB核验，正式main不变。
- [ ] 更新验证记录与session-handoff，停UAT等用户本人验收，不删除功能分支或永久分支。

Root滚动RED证据：artifacts/knowledge-universe-20261020/modal-scroll-red.json。用真实scene/dashboard/CSS、isolated3节点布局fixture，1440×650 dialog content848/client616和390×844 shellcontent1181/client765均有可滚区域，但Canvas上wheel500后两scrollTop都0，zoom3→1.417099658。该probe是UI布局测试，不冒称成功真实API；先前UAT访客大厅三尺寸wheel真实通过。Task2/3需物理wheel/触摸覆盖而非scrollIntoView代替。
Task1接口约定subjects=[{id,code,name,topicCount,practicedTopicCount,unpracticedTopicCount}]，node.subject=ContentSubject.code。

用户追加熟练度确认已落Task3；Task1已审查通过的活动亮度仅为中间实现，最终以Task3覆盖。Task2只消费传入brightness，不实现评分，不与Task3并行改后端。Task4真实API闭环还需真实完成不同正确率/次数的练习，证明熟练度/亮度差异及答错回落；不得通过前端随机明暗冒充。
