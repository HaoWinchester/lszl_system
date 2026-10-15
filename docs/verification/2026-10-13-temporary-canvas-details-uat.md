# 临时画布详情、自动聚拢与菜单隐藏：UAT v323

用户已确认设计；功能提交 `9a18e5b26528cc738ba95513614e4a4ecac9b77d` 合入并推送 UAT。`bash deploy/update-uat.sh` 退出码 0，线上 `v9.0-p4.1.323`；main 与正式环境维持 v322，等待用户业务验收。

## 行为

- 正式卡牌与临时画布共用 `src/graph/node-detail-view.js`，显示标题、分类/等级、局部关系、关键词、说明、学习提示及图片；文本转义。
- 临时画布默认展示入口卡牌详情，选择其他卡牌切换；编辑表单折叠在「临时编辑」中，保留修改能力并修正说明字段读取/保存。
- 不创建底部布局/主题菜单；首次进入通过已有 mindmap-layout 对临时副本紧凑排列，保留卡牌尺寸和连线几何。布局不进入用户撤销历史。
- 视图适应为详情预留空间；新增临时卡牌放到现有卡牌右侧；窄屏顶部按钮换行。后台原图的移动端恢复逻辑在临时视图打开期间暂停。

## 验证

- 旧实现运行扩展后的 `python3 new-legacy/tests/graph-temporary-canvas-browser.py --base-url http://127.0.0.1:18766`，因完整详情区域不存在失败；修改后通过。
- 同一浏览器用真实 FastAPI 与可销毁 PostgreSQL 数据库验证：相隔两万以上坐标的卡牌聚拢、非首个入口、详情切换、临时编辑/增删/连线/撤销重做、孤立卡牌、关闭重开、切文件/退出/保存失败/待保存新草稿；正式内容、历史与数据库隔离。桌面 1440×1000 与窄屏 390×844 均验证。
- `node --test new-legacy/tests/graph-node-detail-view.test.js new-legacy/tests/graph-mindmap-layout.test.js new-legacy/tests/graph-temporary-session.test.js`：16 通过。
- `cd frontend && pnpm test`：333 Node 测试、9 个 Python 契约及部署脚本测试通过。
- `cd frontend && pnpm test:design`：5 通过。
- UAT 脚本完整门禁：1044 后端测试通过；前端契约、浏览器与视觉回归通过；candidate-site-gate 核对文件 1111→1113（新增共享模块和测试文件）、关键页面无回退。
- UAT HTTPS 健康接口 status=ok/db=ok；公网版本 v323；线上 related-canvas-controller.js SHA-256 与权威源一致。浏览器确认线上共用详情及临时画布模块已加载。
- 本地截图：`artifacts/canvas-m2-m5/t08/temporary-details-gather-desktop.png`、`temporary-details-mobile.png`。测试与部署日志：`artifacts/temporary-canvas-details/`。

开发自检不替代用户 UAT 业务验收；未合入 main、未正式部署本功能。
