# 知识图谱画笔、连线、模板完整流程验证

用户要求仅更新本地，不部署 UAT。图谱三个域的最终真实 Chrome 验证使用本地不可变 **v9.0-p4.1.358**，无 source/bundle override；之后的 v359 仅补修多题归纳历史画布恢复，图谱业务代码保持一致。v359 的画布恢复专项见 [重复画布刷新报告](2026-10-19-workspace-duplicate-refresh.md)。

## 发现并修复

1. 连线端点拖离卡片后，手柄自身始终在鼠标下，`elementFromPoint` 命中手柄而非下方目标卡片，无法稳定重新连接。命中检测跳过连线控制层，仍尊重真实工具栏、弹窗与锁定卡片的阻挡。
2. viewer 的后端写入会被拒绝，但前端只按交互模式放行，仍能在内存删除/拖动连线，刷新后又恢复。共享交互能力入口现在结合写权限禁止编辑，保留选择、浏览及阅读模式的只读相关画布。
3. 正常退出账号后画笔面板仍残留。图谱画笔适配器在账号实际变化时关闭面板并重置选择；同账号状态刷新不打断使用。保存失败时退出仍被原保存保护阻止；重新登录另一账号不继承旧草稿、选框或笔迹。
4. 模板发布入口反复点击会叠出多份表单。改为保留一份现有编辑表单和输入，完成/取消后才能另开。
5. 全空格名称能发布模板。前后端均先清理首尾空白，空白名称不产生保存/发布请求，正常名称按清理结果保存。

以上问题均保留真实浏览器或针对实际实现的单测 RED 证据，再修复并复测；没有重设计卡片、画布主题或大厅。

## 最终浏览器验证

| 领域 | 实际动作 / 持久化检查 | 结果与证据 |
|---|---|---|
| 画笔与文字 | 正式画布颜色/粗细/透明度、荧光笔、选择移动、擦除、撤销重做、多行文字与加粗、编辑边缘拖动与缩放、保存刷新、切文件、503草稿保留/重试、保存失败阻止退出、退出与重新登录隔离 | 教师34、原生文字10、student/viewer10，**54/54**；`artifacts/full-graph-flow/pen/candidate358-summary.json`，pageErrors=[] |
| 临时画布 | 绘画、文字、撤重做、Esc退出/关闭、重开丢弃临时笔迹，正式图谱完整快照不变；viewer阅读模式仅可看 | 已包含画笔54项，正式数据不污染 |
| 连线 | 真实UI创建卡片和连线，双方四端口及几何位置、直/折/曲切换、粗细/颜色/箭头/标签、中点多方向往返、折线段拖动、端点脱离重绑、卡片移动跟随、CtrlZ/Redo、框选、布局保留自定义路线并Undo还原、保存刷新切文件、503重试、删除Undo、只读防修改 | teacher/student完整矩阵、viewer高效/专业模式与刷新通过；`artifacts/full-graph-flow/edges/edge-flow-results.json`，三角色pageerrors=[] |
| 模板发布与使用 | 编辑源卡片标题；重复发布入口、空白校验、503保留表单/重试；免费/会员模板；student禁止发布/非会员拒绝付费、有效会员可加载；独立副本编辑刷新不改源；更新v2内容/预览、旧副本保持；下架重上架、admin维护、viewer403/guest401 | **30/30**，`artifacts/full-graph-flow/templates/candidate-results.json`，无override、errors=[] |
| 模板预览还原 | 与原图逐项比较卡片大小、形状、字体、区域配色和图标；曲线/折线/自由端点/箭头及线型；独立文字和笔迹；缩略图/详细预览、拖拽/缩放/适应/全屏/五尺寸窗口；键盘只读、加载失败重试、从展示版本创建新图谱、源图谱不变；未保存源图发布遇503后重试保存最新内容 | `python3 new-legacy/tests/template-preview-browser.py --base-url http://127.0.0.1:5296` 退出0，`preview-candidate.log` |
| 数据库 | 最新教师/学生笔迹与原生文字三文件API正文与PG逐对象相等；模板版本/副本记录存在，空白名称0、加载副本与源文件同ID为0 | 画笔 **3/3**；模板PG统计 `database-summary.json`：10模板、14版本、9加载，均为隔离库 |

连线学生首次运行完成了产品断言但挂在视频关闭，未将该进程计为成功。最终以同一个持久 `run_full_ui` 函数仅省略录屏重跑，保留所有UI/保存断言、trace和截图，干净退出后才计通过。viewer相关画布按现有阅读模式入口测试，不将专业/高效模式下隐藏编辑工具栏误判为丢功能。

## 测试执行器补漏与完整检查

发现当前Node的嵌套测试继承 `NODE_TEST_CONTEXT=child-v8` 时，故意失败的子测试也可能返回0。受控探针实证：继承时status0，清理此私有flag后status1。新增公共 `frontend/scripts/node-test-process.mjs`，迁移10份已有wrapper并保留其他环境参数；新增受控失败/成功回归，避免只看外层绿色计数。

- 修正执行器后的 `pnpm --dir frontend test`：**357/357**，E2E契约 **9/9**，部署脚本契约通过；日志 `artifacts/full-graph-flow/frontend-full-verified-runner.log`。
- `pnpm --dir frontend test:design`：**5/5**。
- 模板定向Node **15/15**；后端模板 **17/17**。
- 连线路径Node **10/10**、bundle **4/4**、中点命中静态/行为断言与交互模式权限回归通过；退出账号 **7/7**。
- `cd backend && .venv/bin/python -m pytest tests/ -q`：**1104 passed, 3 warnings in 758.24s**（12:38），退出0。警告为multipart/websockets已有依赖弃用提示，未升级无关依赖。日志 `artifacts/full-graph-flow/backend-full.log`。
- 官方本地 `manage-new-legacy.js update new-legacy --skip-browser` 候选验证通过，并另行完成上述真实浏览器验证；之后同步public与site。
- v358 public与active site均 **1148文件**，路径对齐基线且内容逐字节一致；实际5173 VERSION、HTML、两主页bundle、图谱编辑/权限/画笔/模板等10项资源匹配，HTML仅允许服务器bootstrap注入。`artifacts/full-graph-flow/served-assets.json`。

## 隔离与交付

测试分别使用5294/5295/5296独立FastAPI/PostgreSQL，未在用户5173图谱造测试卡片或模板。上述服务均已正常停止，精确SQL确认各自唯一测试库删除，5173保持运行。当前浏览器验证为桌面Chrome；缩窄尺寸覆盖预览控件，并不宣称完成所有浏览器/移动设备验收。没有推送、合并或部署UAT/main；main/uat本地和远端跟踪引用保持原值。
