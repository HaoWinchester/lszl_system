# Task 1 — 图谱反馈实现报告

日期：2026-10-18。分支：codex/learning-tool-feedback。范围仅图谱控制器、共享几何、思维导图、viewport、首页图谱 CSS 与定向测试。

## 根因与修复

1. **短拖正文解除绑定**：`applyEdgeMoveDragPoint` 原来无条件对两端调用 `setLinkFreeEndpoint`。现有绑定的线改为调整曲线中点或最近折线段，保留 from/to；原本自由的线仍可整条平移。解除/重新绑定仅通过显式端点手柄。
2. **折线局部拖出斜段**：原控件是顶点，一次只改一个点。现在几何模块导出段中点与垂直于该段的移动，两个相邻转折点一并调整；首尾段补正交短腿，端点保持不动。曲线增加主中点并保留 1/3、2/3 控制点；主中点按 cubic 权重精确移动。手势按原始几何计算，返回原位置恢复原形；一次手势一个 checkpoint，Esc/pointercancel 恢复。
3. **蓝框挡工具栏**：unified-canvas-runtime 中工具栏 z570 被后加载的 home-graph-components 覆盖成 z48；locked selection bounds 为 z548 且 pointer-events:auto。首页节点工具栏恢复 z570，多选框仍承担整体移动。
4. **端点实际拖卡片**：真实 Chrome 测试发现 edge SVG z1 低于 cards z2，卡片盖住端点手柄中心。只将选中控制手柄移入独立 SVG z3，底层连线仍在卡片下方。真实拖端点解除绑定已通过。
5. **重复线难选择**：增加 Alt + 单击循环选中命中位置的重叠线，基于共享 polyline 距离函数；真实两条完全重合的线可分别选中。
6. **思维导图拥挤/撤销入口**：改为短工具条，布局/主题各一个小弹层，保留原 data-mm-* 控件；根节点与覆盖手工样式折叠在更多设置中；增加撤销按钮、当前主题 aria-pressed，历史变化同步控件状态。主题 baseline 记录模型归一化后的真实外观，含隐式区域颜色，保留手工样式保护。
7. **缩放成本/清晰度**：viewport 复用显式 selection refresh 维护的控件集合，平移不再每帧查询全图或重复写同一逆比例；缩放只写必要装饰。去除缩放中 edge/cards 的嵌套 will-change，保留 world 临时合成、停稳后原生重栅格。无全图重绘或定时强制重绘。
8. **向右对称分支**：同尺寸、上下对称的 1 源 2 子节点在现有自动路由中本来就对称，未编造新的根因；补纯几何与真实页面逐 sample 对称断言、截图。显式手工路由仍保留，不能将手工曲线强制覆盖成自动线。

## Red → Green

- graph-edge-geometry：新增 midpoint、segment、polyline hit 用例，先因对应行为缺失失败，再通过。
- graph-feedback：实际 editor 函数的短拖绑定断言先得到 `from==''`，segment 断言先未移动，primary midpoint 先缺失；修复后三项通过。
- graph-zoom-performance：40 个平移帧原来 query 41 次，预期 1 次先失败，修复后通过。
- graph-mindmap-layout：theme baseline 与归一化外观不符先失败，修复后通过。
- Chrome source fixture：按钮与 locked selection bounds 重叠时 elementFromPoint 原来命中选框，修复后命中按钮。
- Chrome live：首次 endpoint 试验实际增加的是卡片拖动 history，from/to 仍绑定；分离手柄层后相同端点解除绑定场景通过。

## 最终验证（全部通过）

```sh
node --test new-legacy/tests/graph-edge-geometry.test.js new-legacy/tests/graph-edge-midpoints.test.js new-legacy/tests/graph-feedback.test.js new-legacy/tests/graph-mindmap-layout.test.js new-legacy/tests/graph-zoom-performance.test.js new-legacy/tests/graph-edge-bundle.test.js new-legacy/tests/v90-p435-home-edge-card-performance.test.js new-legacy/tests/v90-p437-unified-edge-toolbar.test.js
```

结果：33 passed，0 failed。

```sh
python3 new-legacy/tests/graph-feedback-browser.py
python3 new-legacy/tests/graph-feedback-live-browser.py --base-url http://127.0.0.1:5198
python3 new-legacy/tests/graph-mindmap-browser.py --base-url http://127.0.0.1:5198
```

- Source Chrome：选框/工具栏命中、同数据 viewport 测量通过。
- Live Chrome（隔离 DB）：对称分支、正文/主中点/折线段短拖保留绑定、单次撤销、Esc、端点解绑、重叠线选择、四方向布局、主题即时应用/撤销、50%/200% 命中、全屏、缩放 renderer counts 不变、停稳 world/cards `will-change:auto` 通过。
- 原 mindmap 浏览器：四方向幂等、六主题、手工外观保护、undo/redo、保存重载、端口/手工路线、选区作用域、临时画布打开隔离、1440/900/390px 主题可达通过。其旧临时主题表单断言已改为当前界面：当前 related controller 早已没有该表单，打开时只自动向右整理；未重新增加临时主题编辑功能。
- `node --check` 两个修改的主 JS；`git diff --check` 通过。

## 实测指标与证据

同一个 300 卡片、10 选中、120 帧（前 60 帧平移，后 60 帧缩放）Chrome fixture，基线固定 a55c06bdf560a78f5f8ae5cc5274e1ffc414b23a：

| 指标 | Before | After |
|---|---:|---:|
| world 选中目标查询 | 120 | 1 |
| 逆比例装饰写入 | 1200 | 600 |
| 卡片 childList mutation | 0 | 0 |
| 帧 P95 | 16.800ms | 16.800ms |
| 帧中位数 | 16.700ms | 16.700ms |

已减少工作量；该 60Hz 样本未证明帧率提升，不将 diagnostics 常数当实测结果。

本地证据（artifacts，未加入提交）：
- artifacts/learning-tool-feedback/graph/symmetric-branches.png
- artifacts/learning-tool-feedback/graph/compact-layout.png
- artifacts/learning-tool-feedback/graph/compact-theme.png
- artifacts/learning-tool-feedback/graph/fullscreen-selection-toolbar.png
- artifacts/learning-tool-feedback/graph/live-results.json
- artifacts/learning-tool-feedback/graph/viewport-comparison.json
- artifacts/canvas-m2-m5/t10/mindmap-{1440,900,390}.png
- artifacts/canvas-m2-m5/t10/{saved,reopened}.json

## 限制与集成交接

- 本任务只完成开发自检，未代替用户 UAT。未运行全仓检查、release、部署或推送；父任务统一集成处理。
- Chrome 桌面真实手势已验证；未覆盖 Safari/触摸笔、所有 DPR 的量化清晰度与超大图压力。清晰度验证是停稳合成状态和截图，没有主观锐度评分或像素清晰度增益声明。
- 根据父任务后续授权，为隔离服务执行过 `pnpm --dir frontend sync:new-legacy`；生成产物留父任务统一提交，未纳入本任务提交。
- 未修改 template-center、related-canvas controller、共享 ink/text、practice、元信息、VERSION/release 文件。
