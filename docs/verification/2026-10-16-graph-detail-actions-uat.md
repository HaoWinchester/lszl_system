# 知识卡片详情按钮精简（2026-10-16）

用户要求做题按钮“先隐藏”、设为连线起点按钮“去除”。权威源 `10-graph-editor.js` 的既有详情渲染中，做题入口加 native hidden，保留原抽屉与权限逻辑；移除 toggleSourceBtn DOM 和绑定，其他连线入口不变。批量配题成功提示不再引导点击隐藏入口。

## 开发验证

- 修改前真实页面检查明确失败：graphPracticeBtn 没有 hidden 属性（`artifacts/graph-detail-actions/red.log`）。修改后通过：`python3 artifacts/graph-detail-actions/run-browser.py`，真实隔离 FastAPI/PostgreSQL 的图谱批量配题、持久化、恢复、移动端、权限流程通过；服务退出0、临时库无残留。
- 同次浏览器检查：普通/锁定/悬停重绘、桌面/390px手机下做题按钮隐藏、起点按钮不存在；编辑弹窗/取消、关闭详情均正常。
- 为保留内部能力回归，既有抽屉/模板测试统一通过 `tests/helpers/graph_detail_actions.py` 先断言入口隐藏/去除，再程序调用隐藏入口；不把该内部调用描述为用户可见流程。
- `node --test frontend/scripts/graph-question-drawer.test.mjs` 通过（包装2项底层Node测试）；两个生产模块语法检查及六个Python文件编译通过。
- 历史T14/T15/T16独立抽屉及模板脚本依赖各自fixture，本次迁移后做编译检查，未单独运行；共享隐藏入口和保留抽屉行为已由真实批量图谱回归覆盖。
- 独立审查21ae4a26通过，无待处理问题，记录`artifacts/graph-detail-actions/review.md`。

## 发布检查

336候选文件1138，旧active335为1137，唯一新增为共享测试助手；无文件删除，关键页面均在。完整full候选门禁通过，933秒：后端1068、前端335、Python契约9、部署脚本4及完整浏览器流程通过，包含新的详情操作断言和真实批量配题。即将执行标准UAT部署，随后补充容器active与公网结果；main保持不变，等待用户UAT验收。
