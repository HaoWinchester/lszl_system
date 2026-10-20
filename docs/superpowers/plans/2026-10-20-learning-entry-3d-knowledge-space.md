# 学习入口去重与三维知识星空 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去除重复学习报告入口，并把真实学习记录的静态星空升级为参考HTML风格的三维重力网络。

**Architecture:** 复用现有知识星空loader和API，独立Canvas场景模块处理三维力学、投影、绘图和相机。面板模块负责服务端状态、语义详情、分页和生命周期；大厅只做入口去重。

**Tech Stack:** 原生JavaScript、Canvas2D、现有HTML/CSS、Node test、Playwright；不新增依赖。

## Global Constraints

- 用户已明确确认方案，设计文件为`docs/superpowers/specs/2026-10-20-learning-entry-3d-knowledge-space-design.md`。
- 只在当前工作区写入；复用功能分支，不创建其他目录的工作树。所有业务源修改在`new-legacy/`，不手改public或release。
- 参考文件为用户提供的`pmp_space_map_v2(2).html`；参考其中三维暗色空间呈现与操作，不复制固定55点、手动点亮、XP/成就或localStorage业务状态。
- 保留真实账号隔离、60条/页和服务端统计；亮度表示30天练习新鲜度，连线只表示科目/分类组织。
- 除学习入口去重和知识星空外，其他大厅暂缓项目保持不变。
- Python命令统一`PYTHONDONTWRITEBYTECODE=1`。不安装依赖、不修改后端规则、角色和数据库结构。
- main/uat永久保留；开发自检后只部署UAT，用户业务验收前不合入main或部署正式环境。

---

### Task 1: 学习报告重复入口去重

**Files:** Modify `new-legacy/practice-mode.html`, `new-legacy/src/practice/lobby-dashboard.js`, `new-legacy/tests/practice-lobby-fidelity-browser.py`, `new-legacy/tests/practice-lobby-design-browser.py`.

**Interfaces:** 保持`KGPracticeLobbyDashboard.create(options)`的`onHistory/onResume/onReport/onFavorites`回调契约。只移除`data-lobby-open="reports"`重复按钮及多余分支；每条记录的`data-recent-report`继续调用`onReport(sessionId)`。

- [ ] 先在真实大厅浏览器用例中增加失败断言，再运行，确认当前重复入口使其失败：

```python
assert page.locator('[data-lobby-open="reports"]').count() == 0
assert page.locator('#practiceHistoryOpenBtn').count() == 1
page.locator('[data-recent-report]').click()
assert ['report','report-1'] in page.evaluate('__actions')
```

先核实实际学习记录按钮ID后使用真实ID；不改变已有业务回调断言、样式和权限断言。

- [ ] 移除重复按钮及`action==='reports'`同义分支，保留history/recent/history report行为。
- [ ] 运行`PYTHONDONTWRITEBYTECODE=1 python3 new-legacy/tests/practice-lobby-fidelity-browser.py`及`node --test new-legacy/tests/practice-lobby-dashboard.test.js`，记录红绿日志到`artifacts/knowledge-space-20261020/`。
- [ ] 仅提交本任务文件，完成自查并报告具体测试命令、结果和commit。

### Task 2: 独立三维重力场景模块

**Files:** Create `new-legacy/src/practice/knowledge-space-scene.js`, `new-legacy/tests/knowledge-space-scene.test.js`, `new-legacy/tests/knowledge-space-scene-browser.py`.

**Interfaces:** 导出浏览器全局`KGKnowledgeSpaceScene`与CommonJS同一API：

```javascript
createModel(nodes) // => {points, edges, groups}; points包含node,index,x,y,z,vx,vy,vz,group
stepModel(model) // => boolean，true表示尚需继续求解；最多固定迭代次数后false
projectPoint(point, camera, width, height) // => {x,y,scale,depth}; camera={yaw,pitch,zoom}
mount({host,nodes,onSelect}) // => {select(index),focusGroup(key),rotate(dx,dy),zoomBy(factor),reset(),destroy(),snapshot()}
```

`snapshot()`只提供当前场景可检验的运行状态：相机、投影位置、选择、group、settled/running/destroyed；它是诊断接口，不持久化业务数据。`onSelect(node,index)`只响应真实节点选择。`focusGroup('')`显示全部；组key固定由subject和taxonomyId组成。输入节点不可变；缺失id用稳定index作为场景内键，不写回API数据。

- [ ] 先写Node红测，缺模块时失败；测试确定性、有深度的初始化，节点有限坐标且互不全部重叠，分组边不跨科目/分类，收敛和迭代上限，空/单节点，投影旋转缩放及保持输入不变：

```javascript
const model=api.createModel(nodes);
assert.ok(new Set(model.points.map(p=>p.z)).size>1);
let moving=true,steps=0;
while(moving&&steps<1000){moving=api.stepModel(model);steps++;}
assert.equal(moving,false);
assert.ok(model.points.every(p=>[p.x,p.y,p.z].every(Number.isFinite)));
```

- [ ] 实现同科目/分类中心引力、有限节点互斥、同组弹簧连接、阻尼和有界步数，60节点/页。稳定后停止求解，用户相机操作不必重启物理求解。
- [ ] 实现参考风格Canvas渲染：有深度的透视、星点背景、节点光晕、组织连线、选中圈与标题。背景装饰不得伪装成业务考点。DPR最多2；绘图适配host，不能固定浏览器全屏坐标。空Canvas容器返回null以便面板保留列表降级。
- [ ] 实现真实pointer旋转、惯性、点击命中（前景节点优先）、双指缩放、滚轮缩放（只在host内阻止滚动），按钮调用上述同一公共接口。pointercancel清理拖拽，不误选；拖拽阈值后不触发点击选择；缩放有上下界。科目聚焦隐藏不匹配节点，reset恢复全部和默认相机，select同步选中。
- [ ] `ResizeObserver`适配大小。页面隐藏/场景不可见时停止RAF，重新可见按需恢复；减少动态偏好停止惯性和持续漂浮。收敛且无相机变化时停止RAF。destroy取消RAF/观察器/监听器/指针状态，清除Canvas，不允许回调重绘。禁止无边界持续全对全求解。
- [ ] 浏览器红绿测试覆盖真实鼠标旋转、滚轮、节点点击、触摸旋转/缩放、group与reset、resize、reduced-motion、hidden和destroy无残留。支持1440/390，截图放在任务artifacts目录。
- [ ] 运行两个新测试并记录输出，仅提交本任务文件。不要修改面板集成文件。

### Task 3: 真实数据面板与三维场景集成

**Files:** Modify `new-legacy/src/practice/knowledge-dashboard.js`, `new-legacy/styles/knowledge-dashboard.css`, `new-legacy/practice-mode.html`, `new-legacy/tests/knowledge-dashboard.test.js`, `new-legacy/tests/knowledge-dashboard-browser.py`, `frontend/scripts/remaining-learning-requirements.test.mjs`, `frontend/scripts/validate-new-legacy-release.sh`.

**Interfaces:** 使用Task2的`KGKnowledgeSpaceScene.mount`。保留`KGKnowledgeDashboard.init/open/close/createLoader`外部契约及API路径与页大小；旧SVG专用starPositions/networkMarkup改为真实场景，不保留死代码。

- [ ] 先扩展已有浏览器测试并观察失败：要求canvas存在且有三维投影，按钮/列表选择同步详情、group、上/下节点、复位、缩放、分页；点击关闭后旧场景destroy、焦点回到入口。保留原有错误重试、延迟响应跨账号、访客不请求和防注入断言。
- [ ] 面板采用近全视口原生dialog。桌面左详情右星空、底部分组/工具；手机上星空下详情，1440/390/320无横向溢出，按钮最小触达44px，暗色文字可读且键盘focus可见。
- [ ] 刷新/换页先销毁旧场景并清空旧详情；loader仅在当前owner与代际匹配时渲染。数据ready后mount场景，选首个有效考点，并用`textContent`渲染标题/科目/路径/次数/最近时间。列表用真实可聚焦按钮选择；场景选中回调更新同一详情和列表状态，不额外发请求。
- [ ] 科目/分类分组按钮来自本页nodes；明确显示“本页N个考点”和服务器总数/分页。空、guest、error和401不绘制假考点；Canvas失败时列表仍可用。关闭、原生cancel、外部close、账号变化和pagehide均销毁；页面隐藏交给场景模块暂停。
- [ ] 删除重复的旧SVG布局测试，改成验证数据/标签/分组安全和新场景契约；这是已确认需求变更，不降低真实账号、请求、分页和错误边界测试。
- [ ] HTML在knowledge-dashboard前加载scene脚本。把新Node与浏览器测试纳入现有契约/完整门禁。运行三维模块、面板、入口回归、弹幕恢复/语言切换与现有前端契约，检查截图，再提交本任务文件。

## 集成、复核与发布（控制任务）

- [ ] 对每个任务按其完整变更范围复核规范与质量，修复明确问题后再进入下一任务；记录独立审查结果。
- [ ] 全分支审查通过后递增新版本；重建content-prep，官方sync，暂存生成产物，再运行官方`manage-new-legacy.js update new-legacy`完整门禁；不跳过检查。
- [ ] 检查site/public逐字节一致、新版本文件数与当前377旧路径无缺失、admin-console存在；更新交付记录。
- [ ] 备份UAT当前代码和PG，验证非空、SHA和manifest；磁盘不足只清理可确认的构建/包缓存，保留既有备份和运行/回滚镜像。
- [ ] 按AGENTS使用命令级代理合入/推送uat并核对远端引用，官方部署UAT，核对公网版本、资源字节及健康。main和正式环境不变。
- [ ] 更新交接，停在UAT等待用户业务验收，不删除功能分支或永久分支。

Task 1补充发现：旧真实API浏览器用例`practice-lobby-design-browser.py`的侧栏循环仍要求reports按钮存在；移除该重复项并增加零入口断言，保留后面的`data-recent-report`实际成绩回放测试。该用例依赖可抛弃后端，列入集成阶段在新release上运行，不冒称本任务已运行。
