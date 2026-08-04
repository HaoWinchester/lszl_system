# 引导学习模式 v2

## v8.6.0.3 活动数据与双语边界

- 学员端只提供“中文”和“中英对照”；英文仅作为辅助展示，作答与自动判定固定使用中文。
- 标准活动统一使用 Activity Schema v1、稳定活动 ID 和稳定答案 ID；节点只引用 `activityIds`。
- 新增独立 `ordering` 排序题运行插件；深度回忆、多题归纳和知识图谱中的内部排序继续由各自复合插件运行。
- 活动包可在正式导入前完成 JSON 解析、数据校验、重复内容识别、同 ID 冲突分析和合并。

## v8.5.4.4 禁用按钮底座修复

- 节点答题页主操作按钮在未选择答案的禁用状态下，仍稳定显示 4px 深色立体底座。
- 禁用状态只降低透明度并阻止点击，不再通过 `box-shadow: none` 删除底座。
- 跳级测试页及角色主题下的统一按钮同步遵循相同规则。
- 禁用按钮悬浮和按下均保持原位，不产生可点击的下压反馈。

## v8.5.4.3 普通状态底座修复

- 统一按钮不再携带旧版 `primary` / `secondary` 标记类，避免角色主题和历史按钮规则覆盖组件样式。
- 节点答题页主按钮、学习路径跳级入口及跳级测试操作按钮在普通态和悬浮态均稳定显示 4px 深色底座。
- 按下时仍下沉 4px 并收起底座，松开后恢复，不改变 v8.5.4.2 的固定按钮槽位。
- 全局样式末尾增加组件保护层，后续即使页面启用角色主题，也不能替换 `.ui-button` 的背景、边框和立体底座。

## v8.5.4.2 统一按钮规范

- 学习路径的学习方式弹窗、跳级测试页、节点答题页和结果页统一使用 `.ui-button` 组件。
- 主操作按钮固定为 160×48px；桌面端主按钮保持固定槽位，移动端按可用宽度展开。
- 悬浮只调整亮度，不改变按钮位置；按下时下沉 4px并收起深色底座。
- 答案选项不套用主按钮外观，但统一取消悬浮上移，并保留 2px 轻量按压反馈。

## 已确认的产品规则

- 课程层级：课程 → 阶段 → 部分 → 节点 → 活动。
- 首页一次展示一个完整阶段；阶段内按部分组织节点。
- 节点完成后高亮，当前节点可进入，后续节点严格锁定。
- 点击节点进入独立练习路由 `guided-learning-node.html?node=<nodeId>`。
- 普通节点由教师固定配置 5～8 个同类型活动；翻牌记忆节点按 3～5 对卡片配置。
- 节点内进度只保存在页面内存；刷新、返回或关闭后从头开始。
- 答错活动进入当前节点队列末尾，直到所有活动都正确完成。
- 只有队列清空时才写入一次节点完成记录，并解锁下一个节点。
- 第一版不做随机抽题、自动穿插、个性化推荐和中途恢复。
- 后续可通过 `completeScopeByTest(course, 'part'|'stage', scopeId)` 接入部分或阶段跳级测试。


## 首页路径布局

- 顶部阶段卡片是唯一的阶段切换入口，点击后打开阶段列表。
- 首页一次展示所选阶段的全部部分，部分之间只使用灰色竖线和竖排标题衔接，不显示完成比例，也不使用独立内容卡片。
- PC 端节点按横向曲线节奏排列，并允许长阶段横向滚动；节点之间不绘制连线，以保持大量节点场景下的轻量渲染。
- 路径页只读取节点标题、图标、顺序和完成状态；题目正文只在独立节点练习页加载。
- 已完成节点和当前节点使用高亮状态，后续节点保持灰色锁定；当前节点可通过悬浮定位按钮快速返回。
- 第一版不使用 NPC 角色、动态插题或随机节点内容。

## 固定后台配置模型

节点通过 `activityIds` 引用统一活动库，不复制题目正文：

```javascript
{
  id: 'understanding-process',
  partId: 'roles-process',
  order: 2,
  nodeType: 'choice',
  title: '处理顺序',
  estimatedMinutes: 6,
  activityIds: [
    'process-choice-01',
    'process-choice-02',
    'process-choice-03',
    'process-choice-04',
    'process-choice-05'
  ]
}
```

当前示范课程包含 3 个阶段、9 个部分、108 个演示节点和 82 个可复用固定活动；每个阶段包含 3 个部分，每个部分包含 12 个节点。

## 页面职责

- `learning-path.html`：只加载阶段、部分、节点和完成状态，不加载题目正文。
- `guided-learning-node.html`：按节点 ID 加载固定活动，在内存中运行错题循环。
- `87-guided-learning-data.js`：课程和活动固定配置。
- `88-guided-learning-store.js`：只保存完成节点及跳级完成类型。
- `89-guided-learning-app.js`：阶段路径页。
- `89-guided-learning-activity-registry.js`：活动插件注册表。
- `89-guided-learning-deep-recall.js`：深度回忆复合活动插件。
- `89-guided-learning-multi-induction.js`：多题归纳复合活动插件。
- `90-guided-learning-node-app.js`：统一节点练习运行器。
## 第一批节点学习页

统一页面：

- 普通题型内容区最大宽度约 800px。
- 顶部只显示退出按钮、节点标题和节点内进度条，不重复显示活动数量。
- 底部固定操作栏统一承载“检查答案”、反馈、详细解析和继续按钮。
- 回答错误不展示正确答案，当前活动进入队尾；再次出现时按照题型规则重置。
- 回答正确后显示简短说明，可展开教师配置的详细解析。
- 全部活动正确后在当前页显示正确率、活跃用时和最长连对，并提供“继续下一节点”和“返回学习路径”。

第一批题型：

1. `choice`：单项选择，选择后统一检查。
2. `keyword`：自然题干中的预切分关键词选择，片段默认无可见边界。
3. `matching`：先点左侧、再点右侧，全部配对后统一检查。
4. `open_text`：多行回答，根据核心要点及可接受表达判断；连续答错 2 次后开放方向提示。
5. `memory_match`：翻牌对对碰，通过概念与解释、角色与职责等正确配对完成。

演示节点按固定后台配置引用活动 ID；普通节点可配置 5～8 个活动，翻牌节点配置 3～5 对卡片；不随机抽题，也不保存节点内中途状态。



## 第二批第一小版本：复合节点引擎与深度回忆

节点支持两种运行模式：

```javascript
{ runMode: 'standard', activityIds: [...] }
{ runMode: 'composite', activityIds: ['deep-recall-case-01'] }
```

活动通过 `KGGuidedLearningActivityRegistry.register(type, plugin)` 注册。插件可提供：

- `render`：渲染当前活动；
- `submit`：检查当前提交；
- `handleClick / handleInput / handleDrag*`：处理交互；
- `workUnits / completedWorkUnits`：接入统一节点进度；
- `handleFooterAction`：处理复合活动内部的继续或重试。

深度回忆节点包含：

1. `clueTask`：从代表性案例中选择固定数量的关键线索；
2. `conceptQuestions`：2～4 道知识判断题，答错进入本阶段队尾；
3. `reasoningTask`：拖动或使用上移 / 下移按钮完成推理路径排序。

三个阶段的每次提交都计入统一正确率与最长连对；完成子任务后推进顶部连续进度条。中途退出仍不保存，全部子任务正确后才完成节点。

## 路径视觉与提示约定（v8.5）

- 节点图标由 `KGGuidedLearningIconRegistry` 按 `iconKey` / `nodeType` 渲染，未知类型必须回退为默认 SVG。
- 节点按钮固定使用正面与底座两层；悬浮不改变位置，按下时仅正面下压。`available` 使用当前部分深色和轻量呼吸，`completed` 使用部分亮色，`recompleted` 预留金色。
- 部分颜色使用 8 色调色板循环，也允许课程数据通过 `colorKey` 或 `colorIndex` 覆盖。横向滚动时，以视口 42% 位置作为当前部分激活线。
- 深度回忆三个环节均按子任务独立累计错误次数，并在第 2、4 次错误后分别开放两级提示；提示不得直接标出正确选项或完整顺序。
## v8.5.1：多题归纳复合节点

多题归纳采用固定、结构化的小画布，不加载自由模式中的无限画布：

1. 完成三道相关源题，错误题目进入队尾；
2. 将三张题目卡片拖入敏捷、预测型或混合型分类区；
3. 排列可跨题复用的通用判断规则；
4. 全部任务最终正确后完成节点。

活动类型为 `multi_question_induction`，推荐数据结构包括：

- `sourceQuestions`：固定三道源题、选项、反馈与所属分类；
- `classificationTask.categories`：固定分类区；
- `classificationTask.cards`：题目卡片和 `correctCategoryId`；
- `orderingTask.items`、`displayOrder`、`correctOrder`：通用规则排序；
- `orderingTask.hints`：一级、二级渐进提示。

分类任务只显示错误卡片数量，不标记具体错误卡片。排序任务按错误次数独立开放提示，并统一计入节点的 `hintUsedCount`。

## v8.5.1.1 节点运行补充约定

- 标准节点允许混合不同活动类型；“处理顺序表达”采用 4 道选择题和 1 道轻量简答题。
- `open_text` 活动使用 `evaluationMode: "show_reference"` 时，只校验输入非空，提交后显示 `referenceAnswer`。
- 普通关键词活动可配置 `hints` 和 `hintAfterWrong`；首次答错后进入队尾，第二次出现时开放提示。
- 管理员可直接预览全部节点，预览完成结果不写入学员解锁进度。
- 路径节点按钮采用横向椭圆，当前节点由独立伪元素脉冲环提示，不缩放按钮本体。

## v8.5.2 知识图谱复合节点

知识图谱节点使用：

```javascript
type: "knowledge_graph"
runMode: "composite"
```

第一版采用固定结构的小型图谱，不支持无限缩放、自由创建节点、自由拖线或大规模自动布局。

结构化配置包括：

```text
graph.nodes
graph.edges
missingNodeTasks
relationTasks
errorConnectionTasks
```

当前示例配置：

- 7 个知识节点；
- 7 条基础关系；
- 1 个知识点补全任务；
- 2 个关系选择任务；
- 1 个错误连接任务；
- 每个任务配置两级渐进提示。

内部运行流程：

```text
补全缺失知识点
      ↓
选择节点之间的关系
      ↓
找出错误连接
      ↓
完成节点
```

任务答错后进入当前阶段队尾，最终全部正确后才完成活动。复合活动通过统一运行器记录正确率、活跃用时、最长连对和提示次数。

为避免破坏已有进度，本版本继续沿用每部分第 10 个节点的既有 ID `integration-rule`，仅将节点类型升级为 `knowledge_graph`。

## v8.5.3 部分综合挑战

每个部分的最后一个节点使用：

```javascript
{
  nodeType: "part_challenge",
  runMode: "challenge",
  isChallenge: true,
  challengeConfig: {
    schemaVersion: 1,
    partId: "environment",
    selectionMode: "fixed",
    sourceNodeIds: [],
    activityIds: [],
    requiredFinalCorrect: true,
    showTypePerformance: true,
    expectedActivityCount: 8,
    preferredCompositeType: "deep_recall"
  }
}
```

第一版挑战固定包含 8 个活动：

```text
4 道单项选择
1 个关键词识别
1 个连线配对
1 个开放表达
1 个复合任务
```

复合任务在深度回忆、多题归纳和知识图谱之间按部分轮换。挑战仍使用统一活动注册表运行；答错活动进入队尾，全部活动最终正确后才完成节点和当前部分。

挑战统计以活动为单位记录首答表现。一个活动在最终完成前只要出现过错误，该活动即不计为首答正确。复合活动内部任意任务答错，也会使该复合活动记为非首答正确。

完成记录新增：

```javascript
firstAttemptTotal
firstAttemptCorrect
firstAttemptAccuracy
typePerformance
weakestType
weakestTypeLabel
challengePartId
challengeCompleted
```

完成页展示首答正确率、活跃用时、最长连对、最薄弱题型和各题型首答表现。

## v8.5.4 / v8.5.4.1 部分跳级测试

每个部分的第一个节点配置：

```javascript
{
  allowsPlacementTest: true,
  placementTestId: "environment-placement-test"
}
```

课程级测试配置：

```javascript
placementTests: {
  environment: {
    id: "environment-placement-test",
    schemaVersion: 1,
    partId: "environment",
    stageId: "foundation",
    selectionMode: "fixed",
    sourceNodeIds: [],
    activityIds: [],
    expectedActivityCount: 12,
    requiredCorrect: 10,
    passPercent: 80,
    estimatedMinutes: 10,
    allowedTypes: ["choice", "keyword", "matching"]
  }
}
```

运行规则：

1. 只有已经开放的部分首节点可以发起测试；
2. 测试只进行一轮，错误任务不进入学习队列；
3. 答对至少 10 项通过；
4. 未通过只保存测试成绩，不改变节点解锁状态；
5. 通过后当前部分全部节点统一标记为普通完成，并开放下一部分首节点；
6. 已经完成的节点及其学习统计不会被跳级测试覆盖；
7. 学员仍可回到任何节点重新练习；
8. 学员端和教师端均不显示节点的跳级来源。

节点记录保持简洁：

```javascript
{
  status: "completed",
  completedAt: 1780000000000,
  metrics: null
}
```

进度结构升级为 `schemaVersion: 4`。旧 `completionMethod`、`completionType` 和 `passed_by_test` 数据会自动迁移为统一完成状态。

`placementTests[partId]` 继续单独保存尝试次数、通过状态、最好成绩、最近成绩和最近 10 次历史，仅供未来学习分析使用，不影响节点样式或教师配置界面。

v8.5.4.1 同时隔离跳级测试页面及学习方式弹窗的按钮悬浮样式，防止全局按钮规则造成位移、阴影覆盖和选中状态异常。节点悬浮说明只显示节点名称。

浏览器测试：

```bash
# 发布关键冒烟：路径、部分跳级、部分综合挑战
python tests/browser-smoke.py

# 指定完整用例
KG_BROWSER_CASE=test_deep_recall python tests/browser-smoke.py
KG_BROWSER_CASE=test_knowledge_graph python tests/browser-smoke.py
KG_BROWSER_CASE=test_multi_induction python tests/browser-smoke.py

# 桌面宽度与缩放矩阵
KG_BROWSER_TEST_MODE=matrix python tests/browser-smoke.py
```

可指定的完整用例名称保存在 `CASE_LIST` 中。桌面矩阵覆盖 1366、1440、1920 宽度，并覆盖 80%、100%、125% 缩放代表场景。
