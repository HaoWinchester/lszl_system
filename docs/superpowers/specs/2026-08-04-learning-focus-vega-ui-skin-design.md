# 学习端 Focus / Vega UI 兼容皮肤设计

## 1. 决策摘要

在不迁移 React、不重排现有页面、暂不改动画板区域的前提下，为学习端建立一层原生 HTML/CSS/JavaScript 的渐进式 UI 兼容皮肤。

本轮采用用户确认的第二种视觉方向：**Focus / Vega**。整体借鉴 shadcn/ui 的克制、中性、语义化组件风格，以紫色作为学习场景的单一强调色，并以本地 Lucide SVG 作为非画板操作图标来源。

改版前基线已提交并推送：

- Git commit：`c7801bc`
- 项目版本：`v9.0-p4.1.9`
- 分支：`main`

本设计是对旧“学习页面必须与 legacy 视觉完全一致”约束的**局部、明确例外**：仅下述四个学习页面的非画板区域允许更换视觉皮肤；业务功能、页面排版和冻结区域仍保持现状。其他页面继续遵守原有约束。

## 2. 目标与非目标

### 2.1 目标

- 统一学习端颜色、边框、圆角、字体层级、按钮、表单、菜单、卡片和交互状态。
- 替换非画板区域中的 emoji、Unicode 字符图标和风格不一致的手写操作 SVG。
- 保留原生 JavaScript 架构，以兼容皮肤方式逐页迁移，降低功能和布局回归风险。
- 先完成一个可审阅的 `practice-mode.html` 试点，再扩展到另外三个页面。
- 建立可自动验证的“布局不大改、画板不改、无 CDN 图标依赖”契约。

### 2.2 非目标

- 不引入 React、Vue 或新的组件运行时。
- 不重做信息架构，不移动主要区块，不改变页面操作流程。
- 不修改 API、存储、认证、权限、订阅、题目来源或训练计分逻辑。
- 不修改画板、缩放坞、迷你地图、画板悬浮工具条、画板底部工具条及其图标。
- 不在本轮顺带修复改版前已经存在的全量测试失败。
- 不直接编辑 `frontend/public/new-legacy/` 或 active release site 作为源代码。

## 3. 页面范围与迁移顺序

| 顺序 | 页面 | 本轮可修改区域 | 冻结区域 |
| --- | --- | --- | --- |
| 1 | `practice-mode.html` | 顶栏、大厅、练习设置、模式卡片、题目卡片、结果、弹窗、账号菜单 | 无无限画板；仍禁止改动页面总体排版 |
| 2 | `question-training.html` | 画板外应用壳、顶栏、账号/菜单等非画板控件 | `.qt-canvas-shell` 及其全部后代 |
| 3 | `question-workspace.html` | 画板外应用壳、顶栏、账号/菜单等非画板控件 | `.qw-canvas-shell` 及其全部后代 |
| 4 | `knowledge-recall.html` | 顶栏、账号菜单、登录弹窗等画板外控件 | `.kr-viewport` 及其全部后代 |

迁移必须按表中顺序进行。`practice-mode.html` 完成后先生成对比截图并由用户确认，再继续后三页。

## 4. 不变量与允许的微调

### 4.1 必须保持不变

- 既有元素 `id`、`name`、`data-*` 行为钩子、链接目标和表单值。
- JavaScript 事件绑定和可见状态切换所依赖的 DOM 关系。
- 页面主要区块的顺序、栅格关系、固定/绝对定位锚点及响应式断点意图。
- 正常、空数据、未登录、登录、加载、错误、取消和恢复流程。
- 冻结区域的 DOM、CSS、尺寸、位置、图标、交互和画面。

### 4.2 允许的微调

- 为接入皮肤增加无布局影响的 `class`、`data-*`、`aria-*` 或图标占位节点。
- 组件内部 padding、gap、图标与文字对齐最多调整约 `4px`。
- 文字行高、边框宽度和圆角可以按令牌收敛，但不得导致主要区块换位或明显改变密度。
- 可以把字符图标替换为相同功能、近似占位尺寸的 SVG；不得因此扩大按钮或改变点击路径。

## 5. 技术架构

### 5.1 兼容皮肤层

新增单一共享样式文件：

```text
new-legacy/styles/learning-skin.css
```

四个目标页面在现有页面样式之后最后加载该文件，并在 `body` 上增加：

```html
data-learning-skin="focus-vega"
```

所有新规则必须以以下作用域开头：

```css
body[data-learning-skin="focus-vega"]
```

该文件只负责令牌、基础控件和对现有 class 的视觉覆盖，不承载新的页面布局。不得在原有多个历史 CSS 文件中分散复制新主题值。

### 5.2 原生 Lucide 图标层

新增本地资源和小型原生 JavaScript 适配器：

```text
new-legacy/assets/icons/lucide-learning.svg
new-legacy/src/107-learning-ui-icons.js
```

图标资源仅包含本轮实际使用的 Lucide symbol，不加载完整图标包，不使用 CDN。适配器提供有限语义名称，并支持静态 HTML 与 JavaScript 动态内容：

```js
KGLearningIcons.render('search', { label: '搜索题目' })
KGLearningIcons.hydrate(container)
```

适配器职责：

- 输出统一的 `<svg class="kg-icon"><use ...></use></svg>`。
- 默认使用 `currentColor`、`fill="none"`、`stroke-width="2"`。
- 装饰图标输出 `aria-hidden="true"` 和 `focusable="false"`。
- 图标独立承担操作含义时要求调用方提供可访问名称。
- 未登记图标回退到安全的通用图标，并在开发环境给出警告；不得输出空白按钮。

已有 `src/89-guided-learning-icon-registry.js` 继续负责引导学习活动的内容图形，不与本轮应用操作图标适配器合并。

### 5.3 依赖与安全边界

- 不新增运行时网络请求。
- 不通过 `innerHTML` 接收任意外部 SVG 字符串。
- 图标名称采用白名单映射，调用参数不得直接拼接资源路径。
- 首批白名单以实际页面需求为准，包括账号、帮助、登录/退出、关闭、返回、搜索、计时、挑战和状态类图标。
- 画板冻结区域内即使存在字符图标或手写 SVG，本轮也不替换，作为明确的临时例外登记。

## 6. Focus / Vega 视觉系统

### 6.1 语义令牌

```css
body[data-learning-skin="focus-vega"] {
  --learn-background: #fafafa;
  --learn-foreground: #18181b;
  --learn-card: #ffffff;
  --learn-card-foreground: #18181b;
  --learn-primary: #6d5dfc;
  --learn-primary-foreground: #ffffff;
  --learn-secondary: #f4f4f5;
  --learn-secondary-foreground: #27272a;
  --learn-muted: #f4f4f5;
  --learn-muted-foreground: #71717a;
  --learn-accent: #f1efff;
  --learn-accent-foreground: #4c3fd1;
  --learn-border: #e4e4e7;
  --learn-input: #e4e4e7;
  --learn-ring: #6d5dfc;
  --learn-success: #15803d;
  --learn-warning: #b45309;
  --learn-destructive: #dc2626;
  --learn-radius-control: 8px;
  --learn-radius-panel: 10px;
  --learn-shadow-float: 0 4px 12px rgb(24 24 27 / 0.08);
}
```

规则：

- 紫色只用于主操作、选中、进度和焦点，不用于大面积背景装饰。
- 红、绿、琥珀色只表达错误、成功和警告。
- 常态面板优先使用白底加 `1px` 边框；只有菜单、弹窗等浮层使用轻阴影。
- 不使用渐变文字、玻璃拟态、厚重多层阴影或无语义彩色卡片。

### 6.2 排版与密度

- 字体栈：`Inter`、`PingFang SC`、`Microsoft YaHei`、系统 sans-serif；不引入远程字体。
- 正文以现有尺寸为基线，目标范围 `14–16px`；辅助文字不低于 `12px`。
- 标题用字号、字重和间距建立层级，不再依靠全大写英文标签或渐变装饰制造层级。
- 控件高度以现有几何为硬边界，只调整内部对齐，不统一强制改成新的固定高度。
- 胶囊形状只保留给状态、分段选择和确有语义的标签，普通按钮和卡片不使用超大圆角。

### 6.3 图标尺寸

- `16px`：输入框、菜单项、行内辅助操作。
- `18px`：默认按钮、顶栏和工具区。
- `20px`：模式入口或需要强调的图形。
- 图标容器统一 `inline-flex` 居中；SVG 使用 `display:block` 和 `flex:0 0 auto`。
- 有文本的操作保留文本；不把清晰的文字按钮改成仅图标按钮。

## 7. 组件与交互状态

兼容皮肤覆盖以下既有组件类别：

- 顶栏、品牌区、模式切换和账号菜单。
- 主次按钮、危险按钮、图标按钮和文本操作。
- 输入框、选择器、单选组、搜索框和筛选控件。
- 设置卡片、题目卡片、结果卡片、空状态和历史记录。
- 下拉菜单、抽屉外层、确认弹窗和登录弹窗；冻结区域内部例外。
- 进度条、状态点、成功/错误反馈和加载提示。

每个可交互控件至少定义：

| 状态 | 要求 |
| --- | --- |
| default | 文本、图标、边框对比明确 |
| hover | 仅改变语义色、浅背景或边框，不造成布局位移 |
| active/pressed | 有可见按压或选中反馈 |
| focus-visible | 使用 `2px` 主色 ring，并与背景有间隔 |
| disabled | 降低对比度并禁止交互，仍能识别控件类型 |
| loading | 保持按钮宽度，阻止重复提交并提供状态文案 |
| success/error | 就近显示结果和下一步恢复动作 |

尊重 `prefers-reduced-motion`。动效仅用于颜色、阴影和不超过 `1px` 的轻微位移，时长控制在约 `120–180ms`。

## 8. 画板冻结契约

`learning-skin.css` 不得出现以下选择器或其内部组件选择器：

```text
.qt-canvas-shell
.qw-canvas-shell
.kr-viewport
.lp-canvas-zoom-dock
.qt-minimap-dock
.qw-minimap
.qt-canvas-*
.qw-canvas-*
.kr-world
```

上述冻结包括画板背景、卡片、连线、节点、缩放、迷你地图、悬浮控制、选择工具条、底部工具条以及画板内所有图标。

如果共享账号菜单或弹窗 class 同时出现在冻结区域之外，可通过页面根作用域精确覆盖；禁止为追求全局一致而修改冻结区域。

## 9. 验收与测试策略

### 9.1 静态契约测试

新增不绑定旧版本号的学习皮肤测试，至少验证：

- 四个页面均最后加载 `learning-skin.css` 并声明正确皮肤属性。
- 图标脚本和 sprite 均为本地路径，不出现 CDN 或远程字体。
- 新皮肤文件中的所有规则均处于限定作用域。
- 新皮肤文件未引用画板冻结选择器。
- 非冻结区目标字符图标和手写操作 SVG 已按迁移清单替换。
- 图标白名单、未知名称回退和无障碍属性符合契约。

### 9.2 浏览器回归

每个页面验证：

- 访客、学生、教师和管理员可达的账号状态。
- 登录、退出、账号菜单、帮助入口及页面主要操作。
- 正常、空数据、加载、错误、取消/关闭和恢复路径。
- 鼠标与键盘操作，尤其是 `Tab` 焦点、`Enter/Space` 激活和 `Escape` 关闭。
- 控制台没有新增错误，资源没有 404。

截图视口至少覆盖：

- `1440 × 900`
- `1366 × 768`
- `390 × 844`（仅验证现有窄屏行为不恶化，不重新设计移动布局）

### 9.3 布局与画板保护

- 改造前基准取自 commit `c7801bc`。
- 对主要非画板区块记录 `getBoundingClientRect()`；位置和尺寸差异原则上不超过 `4px`。
- 对冻结区域根节点记录矩形，要求位置和尺寸保持一致。
- 对冻结区域做裁剪截图比较；像素差异若来自抗锯齿以外的样式变化，视为回归。
- 所有新增失败必须修复；全量测试中已存在的失败按基线单独登记，不在 UI 提交中混改。

当前改版前已知基线：

- `frontend`：66 项中 13 项失败。
- `backend`：67 项中 1 项失败。
- `new-legacy`：102 项中 22 项失败。
- 主要原因是历史测试仍固定旧版本号，以及旧“禁止 iframe”断言与现有管理页实现冲突。

## 10. 分阶段交付

### 阶段 A：基础设施与试点

- 新增令牌/兼容皮肤和本地图标基础设施。
- 只接入 `practice-mode.html`。
- 完成静态测试、关键交互回归和三种视口截图。
- 向用户展示改造前后截图，确认风格和密度。

### 阶段 B：其余学习页面外壳

- 接入 `question-training.html`、`question-workspace.html` 和 `knowledge-recall.html`。
- 只修改各自冻结区域之外的 UI。
- 遍历四页账号菜单、登录/退出与主要操作。

### 阶段 C：验证与发布

- 对比布局矩形和冻结区截图。
- 运行新增契约测试、目标页面测试及现有全量测试，报告相对基线变化。
- 先从 `new-legacy/` 同步生成本地候选，不直接修改 release site。
- 候选 site 文件数不得少于当前 active release；新增文件数必须与图标/皮肤资源清单一致，关键页面必须存在。
- 通过正式脚本发布并提升版本：

```bash
node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser
```

- `--skip-browser` 只跳过脚本内部浏览器步骤；本设计规定的浏览器回归必须在调用前独立完成。

## 11. 回滚策略

- 皮肤接入由单个 `<link>`、单个 `data-learning-skin` 和图标脚本控制，可逐页撤回。
- 第一阶段独立提交，不与后三页迁移混合。
- 若某页出现功能或布局回归，先移除该页皮肤接入，保留已经验证的其他页面。
- 不通过修改 active release 回滚；回滚源代码后重新走正式发布流程。

## 12. 完成标准

本轮只有同时满足以下条件才视为完成：

- 四个学习页面的非画板 UI 使用同一套 Focus / Vega 令牌与组件状态。
- 目标范围内不再残留未登记的 emoji、字符操作图标或手写操作 SVG。
- 页面主要布局无大规模变化，允许微调保持在约 `4px` 内。
- 三个画板页面的冻结区域无视觉或交互变化。
- 登录、退出、账号菜单和主要学习操作在四页均通过回归。
- 新增测试全部通过，全量测试相对 `c7801bc` 不增加失败。
- 候选 release 内容完整、文件数校验通过，并通过正式脚本发布。

