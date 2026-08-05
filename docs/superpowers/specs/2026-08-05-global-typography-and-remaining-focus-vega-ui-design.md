# 全站字体统一与剩余页面 Focus / Vega PC 端优化设计

## 1. 决策摘要

在现有原生 HTML、CSS、JavaScript 架构上，先建立全站共享的语义字体体系，再把尚未完成统一的页面按“教师业务页、学习流程页、工具页”三个页面族逐步接入 Focus / Vega 视觉体系。

本轮继续只覆盖 PC 端，验收视口为 `1440 × 900`、`1366 × 768`、`1024 × 768`。不改变业务功能、路由、数据、权限或主要页面布局；允许为字号变大后产生的换行、溢出、基线和控件高度问题做必要的小范围排版修正。

图谱首页 `index.html` 整页保持不动。登录、账号操作内部、会员套餐、购买、兑换、订单和支付区域保持不动。训练、归纳和回忆页面的画板区域保持不动。

## 2. 设计依据

字体审计覆盖 `335` 个文件，共发现 `1,857` 处字号声明：

- `39.2%` 的显式字号低于 `12px`。
- 最常见字号依次为 `12px`、`11px`、`13px`、`10px`、`9px`。
- `file-manager.css` 中 `57.3%` 的显式字号低于 `12px`。
- `question-workspace.css` 中 `71.4%` 的显式字号低于 `12px`，但画板后代属于冻结区域，不能通过全局覆盖修改。
- 同一语义角色跨页漂移：页面标题分布在 `18px—30px`，区块标题分布在 `13px—22px`，按钮文字分布在 `10px—14px`。
- 当前代码把未自托管的 `Inter` 放在多个字体栈首位，不同电脑可能得到不同的中英文混排结果。
- 字重同时使用 `550`、`650`、`680`、`750`、`850`、`900`、`1000` 等值，实际系统字体会映射或合成，层级不稳定。

因此本轮目标不是简单“全站放大”，而是建立少量、稳定、可复用的语义字号和字重角色。

## 3. 页面范围

### 3.1 已完成页面的字体收敛

- 管理后台 Focus / Vega 页面：`admin-console.html`、`admin-operations.html`、`admin-settings.html`、`admin-subjects.html`、`feedback-management.html`、`message-management.html`、`user-management.html`、`system-settings.html`。
- 学习端现有试点：`practice-mode.html`。

这些页面不重新设计，只把现有字号、字体栈、字重和行高映射到共享字体令牌，并修复因此暴露的局部换行或基线问题。

### 3.2 教师业务页面族

- `teacher-workbench.html`
- `question-bank.html`
- `paper-management.html`
- `course-admin.html`
- `content-center.html`

保留现有教师导航、工具区、列表、编辑器、多栏工作区、表格和业务操作顺序。重点统一标题层级、按钮、表单、卡片、页签、筛选区、表格密度和本地 Lucide 图标。

### 3.3 学习流程页面族

- `question-training.html` 的非 `.qt-canvas-shell` 区域
- `question-workspace.html` 的非 `.qw-canvas-shell` 区域
- `knowledge-recall.html` 的非 `.kr-viewport` 区域
- `learning-path.html`
- `guided-learning-node.html`
- `guided-learning-placement-test.html`

保留题目流程、学习路径结构、节点状态和页面布局。训练、归纳和回忆页面只调整顶栏、导航、文件区、说明区、外部操作区、弹窗之外的非画板组件。

### 3.4 工具页面族

- `file-manager.html`
- `help-center.html`
- `multi-question-help.html`

保留文件管理的侧栏、顶栏、文件网格、检查器和现有操作；保留帮助中心目录与正文结构。重点解决大量 `9px—11px` 元数据、标题不一致、按钮密度和卡片视觉漂移。

## 4. 冻结范围

### 4.1 整页冻结

- `index.html`：包括图谱首页顶栏、文件标签、工具栏、画布及所有内部控件。

### 4.2 画板冻结

- `.qt-canvas-shell` 及全部后代。
- `.qw-canvas-shell` 及全部后代。
- `.kr-viewport` 及全部后代。

共享字体和页面族样式不得使用能够穿透这些根节点的通配选择器，也不得依靠继承改变其字体、字号或控件尺寸。

### 4.3 登录、账号与会员冻结

- `#authModal`、`.auth-backdrop`、`.auth-modal` 及后代。
- 后台账号胶囊与账号菜单内部内容。
- `.subscription-*`、`.membership-*`、`.payment-*`、`.wechat-pay-*` 及相关购买、兑换、订单和支付区域。
- 会员入口的业务行为和内部视觉。

允许调整冻结区域外层在页面头栏中的位置和外部间距，不得修改其内部 DOM、字号、颜色、尺寸和交互。

## 5. 技术架构

### 5.1 共享字体基础层

新增：

```text
new-legacy/styles/focus-vega-typography.css
```

该文件只定义共享字体栈、字号、字重、行高、字距和数字排版令牌，不包含具体页面布局。令牌采用“基础值 → 语义角色 → 页面组件消费”的三层结构。

共享层只在明确 opt-in 的页面根节点生效：

```html
data-ui-skin="focus-vega"
```

现有 `data-admin-skin="focus-vega"` 和 `data-learning-skin="focus-vega"` 页面继续兼容。字体基础层不得对未 opt-in 的 `index.html` 生效。

### 5.2 三个页面族适配层

新增：

```text
new-legacy/styles/focus-vega-teacher.css
new-legacy/styles/focus-vega-learning.css
new-legacy/styles/focus-vega-utility.css
```

- `teacher` 只负责教师业务页面的视觉映射和 PC 排版修正。
- `learning` 只负责学习流程页面的非画板视觉映射。
- `utility` 只负责文件管理与帮助页面。

所有规则必须以页面 opt-in 属性和页面族根类共同限定，避免相邻页面或冻结区域被误伤。适配层只消费共享令牌，不复制新的字号体系。

### 5.3 本地图标

剩余页面中的 emoji、Unicode 操作符和不统一手写图标逐步替换为本地 Lucide SVG。使用共享白名单适配器输出 `currentColor`、`fill="none"`、`stroke-width="2"` 图标；未知图标必须安全回退，不允许 CDN、远程字体或空白图标按钮。

图标替换只改视觉载体，不改变按钮 `id`、`data-*`、事件绑定、可访问名称或操作行为。

## 6. 字体体系

### 6.1 字体栈

本轮不引入新的远程字体，也不依赖用户电脑是否安装 Inter。产品界面统一使用中文系统无衬线字体：

```css
--ui-font-sans:"PingFang SC","Microsoft YaHei",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
```

代码、JSON、批量文本或技术标识可以使用独立等宽字体令牌，其他界面只使用一套无衬线字体。

### 6.2 语义字号

```css
--ui-text-meta:.75rem;          /* 12px：辅助信息、元数据、kicker，下限 */
--ui-text-control:.875rem;      /* 14px：按钮、标签、后台表格、紧凑正文 */
--ui-text-body:1rem;            /* 16px：学习正文、题干、解析、输入内容 */
--ui-text-shell-title:1.5rem;   /* 24px：紧凑顶栏标题 */
--ui-text-card-title:1.125rem;  /* 18px：卡片和子区标题 */
--ui-text-section-title:1.25rem;/* 20px：区块标题 */
--ui-text-page-title:1.75rem;   /* 28px：页面标题 */
--ui-text-kpi:1.5rem;          /* 24px：普通数据数字 */
--ui-text-kpi-lg:1.75rem;       /* 28px：主 KPI */
```

紧凑学习壳标题允许使用 `1.125rem` 作为明确的组件例外。装饰性图标容器允许 `font-size:0`；不可见的辅助技术文本不参与视觉下限。除这些明确例外和冻结区域外，用户可见文字不得低于 `0.75rem`。

### 6.3 字重、行高和字距

- 字重仅使用 `400 / 500 / 600 / 700`。
- 正文使用 `400`，控件使用 `500`，区块标题使用 `600`，页面标题和关键数字使用 `700`。
- 标题行高使用 `1.2—1.3`，紧凑控件使用 `1.25—1.4`，中文正文和说明使用 `1.6—1.75`。
- 中文标签默认 `letter-spacing:0`。
- kicker 最低 `0.75rem`，字距控制在 `.04em—.06em`，不再使用 `10px + .12em/.18em`。
- KPI、计数、表格数字使用 `font-variant-numeric:tabular-nums`。
- 长说明文本使用 `max-inline-size:65ch`，避免宽屏下一行过长。

## 7. Focus / Vega 视觉规则

- 延续现有 `#fafafa` 背景、白色表面、`#18181b` 前景、`#6d5dfc` 主色和中性边框体系。
- 紫色只用于主要操作、当前导航、选中和焦点；成功、警告、危险使用语义色。
- 普通卡片使用白底、`1px` 中性边框、`8px—10px` 圆角和轻阴影，不使用渐变或厚重多层阴影。
- 按钮、输入框、选择器、页签和图标按钮统一高度、圆角、图文间距和 `focus-visible` 状态。
- 不把页面改造成新的卡片网格，不移动主要业务区块，不改变既有信息架构。
- 为解决字体变大造成的问题，可以调整 `gap`、`padding`、`min-width`、换行、截断和滚动边界。

## 8. 分阶段实施

### 阶段 A：字体基础层

1. 建立字体静态契约和 PC 浏览器计算样式基线。
2. 新增共享字体令牌。
3. 让现有后台与练习模式映射到共享令牌。
4. 为剩余目标页面增加显式 opt-in，但不修改冻结页和冻结后代。
5. 验证用户可见文字下限、标题角色、字重集合、行高、溢出和 200% 浏览器缩放。

### 阶段 B：教师业务页

按 `teacher-workbench → question-bank → paper-management → course-admin → content-center` 顺序适配。每页先建立结构与交互契约，再修改视觉并逐页截图验证。

### 阶段 C：学习流程页

先适配不含无限画板的 `learning-path`、`guided-learning-node`、`guided-learning-placement-test`，再适配 `question-training`、`question-workspace`、`knowledge-recall` 的非画板区域。每个画板根节点都必须进行“前后 DOM 与计算样式不变”冻结检查。

### 阶段 D：工具页

先处理 `file-manager` 的可读性和控件一致性，再处理 `help-center` 和 `multi-question-help`。文件管理页必须额外验证长文件名、标签、列表/网格切换、检查器和弹窗不因字号变大而溢出。

### 阶段 E：候选与发布前检查

从 `new-legacy/` 生成隔离候选，遍历所有目标页面和主要角色，校验候选文件数与关键页面完整性。未经用户确认，不 promote、不发布正式环境。

## 9. 测试与验收

### 9.1 静态契约

- 目标页面加载共享字体文件和正确的页面族适配文件。
- `index.html` 不加载新字体或页面族样式，也不声明 opt-in。
- 新样式全部位于批准的页面作用域内。
- 新样式不包含冻结区域后代选择器。
- 新适配层除明确的图标/隐藏文本例外外，不出现低于 `0.75rem` 的可见文字。
- 字重只使用批准的四档。
- 图标只来自本地白名单资源。
- 页面主要 DOM 锚点、脚本顺序、业务 `id` 和 `data-*` 保持存在。

### 9.2 PC 浏览器回归

每个目标页面在 `1440 × 900`、`1366 × 768`、`1024 × 768` 验证：

- 页面标题、区块标题、正文、控件、元数据和 KPI 层级符合语义令牌。
- 用户可见文字没有小于 `12px` 的非批准例外。
- 按钮、标签、表单、表格、卡片和多栏边界不重叠、不裁切、不横向溢出。
- 长中文、长用户名、长文件名、空状态和错误状态可读。
- 浏览器缩放到 `200%` 时主要操作仍可发现和使用。
- 控制台无新增错误，CSS、脚本和图标无 `404`。

### 9.3 冻结回归

- `index.html` 的关键文件哈希和截图保持不变。
- `.qt-canvas-shell`、`.qw-canvas-shell`、`.kr-viewport` 的 DOM 快照和关键计算样式保持不变。
- 登录、账号菜单内部、会员套餐、购买、兑换、订单和支付区域保持不变。

### 9.4 功能回归

- 运行现有后端、前端契约、新旧页面浏览器和发布完整性测试。
- 按管理员、教师、学生和未登录状态遍历目标页面。
- 对每页主要按钮、链接、页签、筛选、表单、弹窗和空状态执行正向、失败、取消或恢复路径。
- UI 优化不得修改或放宽业务断言来规避失败。

## 10. 完成标准

- 所有目标页面使用同一套字体栈、语义字号、四档字重和行高体系。
- 非冻结区域不存在无业务理由的 `7px—11px` 可见文字。
- 教师业务、学习流程和工具页面使用统一 Focus / Vega 组件语言，同时保留现有主要布局和功能。
- 图谱页、画板、登录、账号操作内部和会员购买支付区域保持不变。
- 三个 PC 验收视口、200% 缩放、静态契约、浏览器回归和功能回归通过。
- 隔离候选完整且通过发布前校验；用户确认前不发布正式环境。
