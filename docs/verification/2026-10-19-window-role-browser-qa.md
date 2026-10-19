# 本窗口改动的真实浏览器与角色回归（本地 v350）

## 范围与方法

按用户要求，只更新本地 http://127.0.0.1:5173/graph，不部署 UAT、不合并或推送 main/uat。使用实际安装的 Chrome（Playwright channel=chrome），实际 FastAPI、迁移后的独立 PostgreSQL 测试库和独立 cookie 会话；不在用户实际数据库中发布模板、新建或删除测试图谱。故障用例仅对特定保存/请求临时断网或返回失败，成功流程使用真实接口。

覆盖管理员、教师、另一位教师、普通学员、有效月度会员、只读账号、游客。不是用隐藏按钮代替权限验证：同时核对接口状态、文件所有权、刷新持久化、源文件与副本隔离。

## 本轮发现与修复

1. 模板预览以前只取标题/位置/颜色，再画通用方框和推测曲线，丢失卡片形状、图标、字体、实际端口、手调控制点、折点、箭头、独立文字及笔迹；默认尺寸也与编辑器不一致。现在后端只返回白名单视觉字段，前端复用编辑器的卡片、文字、连线和笔迹渲染。笔迹进入发布快照，加载副本单独重建笔迹 ID，避免和卡片授权 ID 冲突。预览不泄露备注、题目答案、个人学习进度或资源 URL。
2. 新建图谱依赖原生 prompt。改为页面内名称弹窗，验证原生 prompt 返回 null/抛异常时仍可新建；取消、Esc、空名、连续点击、源文件保存失败、新建失败与重试都不丢源图谱。
3. viewer 虽然界面不可编辑，直接调用 Files API 仍能创建/保存图谱。20 个业务写入口统一限制为 admin/teacher/student；viewer 保留读取自己的图谱和切换当前文件游标。
4. 收紧后端权限后，临时画布强制保存导致 viewer 只读查看失败；guest 又能看到临时编辑入口。临时只读视图现在跳过正式图谱写入，并沿用角色和交互模式的编辑权限。
5. viewer 多题归纳编辑提示误导为未登录，而且独立页面的通知退化成 console.info。现在复用页面已有状态提示，明确显示账号只可查看、需联系管理员。初始化存储也曾误触发保存；适配层现在在队列与发送入口验证写权限，只读页面不会自动发业务写请求。
6. 模板预览 Esc 会被底层画布处理。中心与预览弹窗隔离键盘事件，关闭后保持源图谱、选择与撤销历史。

这些问题来自实现和覆盖遗漏，不是用户要求更改卡片配色或隐藏原有功能入口。主工具栏仍直接显示原入口；思维导图设置单独简化，表格入口移除，做题大厅改版继续暂停。

## 验证证据

- `artifacts/window-role-qa/new-files/results.json`：五角色新建流程，管理员/教师/学员正向创建保存刷新，只读 403、游客 401，跨账号 GET 隔离；浏览器原生 prompt 不可用兼容。
- `artifacts/window-role-qa/templates/results.json`：七角色发布、更新、上下架、预览、免费/会员加载、源与副本隔离、另一教师不可维护；保存失败时零发布请求，重试读取最新保存内容。
- `artifacts/window-role-qa/canvas/results.json`：图谱/临时画布/多题归纳/深度回忆/答题页逐角色实测，详见最终结果。
- `artifacts/template-fidelity/readonly-final.log`：六种卡片的实际 computed styles 与原图相同，连线 d/颜色/粗细/虚线/箭头/滤镜相同，文字与笔迹路径相同；缩放、拖动、适应、全屏、窄屏、失败重试、加载刷新、预览键盘不修改源状态。
- `artifacts/window-role-qa/graph-feedback-final.log`：对称分支、旧上弯线重连下方后恢复向下、短距离拖动、重叠切换、折线、设置主题、撤销、工具栏命中、全屏缩放。
- `artifacts/window-role-qa/backend-final.log`：相关后端 44 项通过（模板、Files API、文件顺序、cutover 边界、迁移及 CLI）。
- `artifacts/window-role-qa/source-final.log`：相关源单测 56 项通过。
- `artifacts/window-role-qa/frontend-final.log`：完整 frontend 355 项、E2E 契约 9 项、部署脚本契约通过；脚本测试不执行真实 UAT 部署。
- `artifacts/window-role-qa/design-final.log`：design 契约 5 项通过。

- `artifacts/window-role-qa/workspace-readonly-final.log`：共享 workspace adapter 14 项通过；新增只读初始化 RED→GREEN，原有保存、冲突、账号切换与晚返回隔离覆盖保留。

## 最终画布矩阵结果

实际 immutable v350，85 项，78 通过、7 项符合权限预期被阻止、0 失败：

| 身份 | 通过 | 预期阻断 | 结果 |
|---|---:|---:|---|
| 管理员 | 18 | 0 | 通过 |
| 教师 | 18 | 0 | 通过 |
| 普通学员 | 18 | 0 | 通过 |
| 只读账号 | 13 | 3 | 通过 |
| 游客 | 11 | 4 | 通过 |

覆盖真实左侧导航、表格入口移除、右键高清文字移除、三类画布的画笔/文字/输入法/八个缩放点/空白绘图/右键与 Esc/X 退出/撤销重做、保存刷新与归属隔离、浅色题卡与画笔悬浮稳定性、临时画布不污染正式图谱、答题卡与答题解析、弹幕不显示用户名、触屏尺寸切只读撤回活动缩放。

只读账号仍可使用试卷明确授权的练习功能，不能将角色名称机械解释成所有业务都禁止；其图谱与多题画布编辑受限制。模板矩阵另含有效月度会员和第二位教师，验证会员门槛及发布者之间的维护隔离。

## 本地运行版本

通过 `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser` 更新本地 active release 为 **v9.0-p4.1.350**。未执行 UAT 部署。active site 与原基线 1,148 个文件路径完全一致，admin-console 存在；实际 5173 返回 VERSION、图谱编辑器、新建页签、模板预览、模板中心、多题归纳、workspace adapter、home-graph bundle 八项内容逐字节与 active site 相同（`local-served-version.json`）。

最终画布矩阵改用相同 immutable release 的真实响应，测试数据库仍独立；最终运行禁用三个源码覆盖 route，包装器与原测试脚本 SHA256 留在 artifacts。全量同步契约与浏览器矩阵顺序执行，避免同步测试短暂重建 public 影响浏览器。中间并行轮的临时静态 404 和误将正常 analytics 当业务写的证据保留，最终以 immutable 结果为准。

正常的 `/api/v1/analytics/feature-intervals` 使用统计保留并单列，不把埋点误算成只读内容写入。只读测试仍对其他业务 mutation 做零请求断言。

## 边界

历史模板版本中如果发布时已丢失笔迹，无法从该版本凭空恢复；从保留笔迹的源图谱发布新版本可保留。组合输入验证使用 Chrome CompositionEvent 与真实 DOM 点击，未手工操作系统输入法候选窗。没有运行全量后端套件，没有将自动浏览器测试等同用户 UAT 验收；没有更改用户实际图谱或替用户发布模板。

最终 immutable 模板预览回归通过（`artifacts/template-fidelity/immutable-final.log`）。5263/5264/5265/5266 独立测试服务均关闭，相关临时库正常删除并核对不存在；5173 用户本地服务继续运行。实际 active/public 全部1,148个文件逐字节相同。main、uat及其远端跟踪引用保持原提交。
