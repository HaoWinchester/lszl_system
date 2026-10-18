# 后端全量与左侧菜单布局回归（本地 v351）

用户要求后端全量测试、有问题一并修复，并修复左侧“关系”菜单打开后内容出现在屏幕底部；只更新本地，不部署 UAT。

## 后端全量结果

执行 `cd backend && .venv/bin/python -m pytest tests/ -q`，退出码 0：**1103 passed, 3 warnings in 733.05s (0:12:13)**。未发现失败，不需要修改后端业务代码。3 条警告为 Starlette multipart 导入、websockets legacy / WebSocketServerProtocol 依赖弃用提示；没有为消除提示升级无关依赖。

使用 conftest 的独立迁移 PostgreSQL 测试库，未操作用户 kg_graph_dev。日志：`artifacts/window-role-qa/backend-full.log`。本轮 backend 的唯一 Git 改动为前端同步产生的 guided-course seed 版本/hash。

## 菜单根因与修复

真实 Chrome 复现：关系按钮 y=456–496，菜单却显示在 y=627.76–716.76。DOM 证据表明菜单是 fixed，但 offsetParent 是带背景模糊的 floatingToolbox；原定位函数将 fixed 当作屏幕坐标直接写入，叠加了工具栏位置。避让算法又优先尝试整条工具栏下方，进一步拉远菜单。证据：`artifacts/toolbar-placement/before.json`、`before.png`、`browser-red.log`。

- 三个主工具栏菜单统一改用相对菜单壳的 absolute 坐标，沿用共享定位器扣除 offsetParent 的逻辑，不再混用坐标系。
- 共享定位器新增可选 right 优先侧向避让，关系/尺寸/线型优先贴近按钮向右展开，右侧空间不足时向左，保持屏幕边界；其他既有调用仍沿用默认上下展开。
- 缩放窗口、全屏切换后，在工具栏自身位置收敛后重新定位已打开菜单。
- 拖到右下角另复现缩略图遮挡按钮，主工具栏层级调整到缩略图上方，保留原双列布局与原功能入口。

修改限于既有19注册模块、89共享运行时与 home-graph-components 样式，没有重做工具栏。几何单测与真实浏览器均先在旧行为失败，再验证修复后通过。

## 验证

| 检查 | 结果 |
|---|---|
| 后端完整 pytest tests/ | 1103 通过，0 失败，3 依赖弃用提示 |
| frontend pnpm test | 355 通过；9 项 E2E 契约和部署脚本契约通过（不执行真实部署） |
| frontend pnpm test:design | 5 通过 |
| 相关共享运行时、定位器、连线回归源测试 | 28 通过 |
| 真实 Chrome，1440×900 / 1280×720 / 1024×768，四个工具栏位置×三个菜单 | 36 组合均有界、贴近按钮、按钮命中正确 |
| 已打开菜单时缩放窗口、Esc、选项实际切换与还原、画布全屏 | 通过 |
| 实际 immutable v351 资源重复完整浏览器回归 | 通过，无源码覆盖 route |
| 教师 / viewer / guest 的阅读模式关系菜单 | 实际 v351 均通过 |
| 320px 容器的共享弹层尺寸限制与变宽恢复 | 通过 |

额外运行的旧 v90-p430 测试仍把已停用的 question-training 重定向页当作画布页，错误要求加载画布 CSS/JS。已按当前明确退役行为改为验证跳转到 practice-mode 且不启动旧画布，保留三个现用画布页的运行时契约；没有恢复停用功能。

主要证据在 `artifacts/toolbar-placement/`：geometry-red/final、browser-red/final、source-final、frontend-final、design-final、immutable-browser-final、reading-roles.json、menus.json、served-assets.json。修复后截图：[关系菜单](../../artifacts/toolbar-placement/relation-after.png)。

## 本地与清理

正式本地打包采用 `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser`，active 为 **v9.0-p4.1.351**。site 与原基线均为1,148个完全相同路径，admin-console 存在；5173 与隔离5267返回 VERSION、两个关键JS、样式及两个bundle共六项均逐字节匹配 immutable site。

5267 两次独立测试服务已正常关闭；两次测试库与后端全量进程的临时库查询剩余0。5173用户本地服务继续运行。没有修改用户实际图谱，没有合并/推送 main 或 uat，没有部署 UAT。自动化开发自检不代替用户业务验收。
