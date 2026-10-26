# 框选时不展示卡片详情：本地验证

日期：2026-10-26。用户反馈：框住卡片时，右侧不需要展示卡片内容。

## 修改

在 `new-legacy/src/10-graph-editor.js` 的统一详情渲染入口区分单击与批量选择。框选开始立即收起已有详情；框选一张、多张，以及 Ctrl/⌘ 多选均不展示默认主卡片的内容，重新渲染也不展开。普通单击卡片仍可查看详情。框选时同步关闭此前卡片的做题抽屉，避免残留单卡片内容。

原因为框选将第一张卡片设为 `selectedNodeId`，详情渲染之前未区分单卡查看和框选主项。修复未清空选择，不影响组合、拖动及批量操作。

## 验证

- 增强 `new-legacy/tests/graph-groups-browser.py`：实际指针框选一张/两张、框选开始已有详情、框选完成后重绘、Ctrl 多选均保持详情隐藏；再次单击正常展示。新增断言在修复前失败、修复后通过。
- 既有组合、拖动、路径移动、精确撤销重做、模拟保存重载、锁定及只读回归继续通过。
- `node --test new-legacy/tests/graph-*.test.js`：150 项通过。
- `cd frontend && pnpm test`：383 项通过，附属 Python 和部署脚本契约通过。
- `cd frontend && pnpm test:design`：5 项通过。
- `python3 new-legacy/tests/graph-groups-browser.py --served`：直接加载实际 release 打包模块，通过；未使用源文件覆盖，业务写请求由测试边界接管，不改写真实用户图谱。
- 后端代码未修改，本次未重跑后端检查。

## 本地交付

通过规定脚本 `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser` 构建并切换为 `v9.0-p4.1.398`。旧 397 和新 398 site 均为 1248 个文件，无文件缺失，关键页面保留；HTTP 返回的实际图谱 bundle 已包含本次逻辑。

入口：http://127.0.0.1:5173/index.html 。刷新已打开页面即可加载新版本。未推送远端、未合入 main/uat、未部署远端环境；本轮按用户本地查看要求保留功能分支。
