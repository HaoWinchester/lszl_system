# T18 — implementation report (2026-10-12)

## Implemented

- 共享 helper `KGCanvasTableModel.sanitizeCollection`：逐表 normalize、非法降级丢弃（onInvalid 回调）、画布 20000 格超限整组丢弃。
- 图谱页：baseState 加 tables:[]；sanitizeState 经 sanitizeCollection 读取（坏表不阻断加载）；saveableState 自动携带；index.html/homepage-bundles 登记 table-model.js（在 00-config-state 前）。
- 多题页：65-canvas-workspace-store emptyWorkspace/normalizeWorkspace 接 tables（sanitizeCollection）；模块 IIFE 参数改环境自适应（Node 可加载冒烟）。
- 回忆页：86 state 初始化/重置/载入/清空接 tables，progressPayload 带 tables；99 adapter graphFromSession/normalizeGraph/保存 body 三处白名单加 tables。
- 后端：file_service.validate_graph_tables（GraphTablesInvalid）接入 create_file/save_file；files 路由转 422 GRAPH_TABLES_INVALID；模板 publish 入口校验；learning_service._workspace_values 校验 payload.tables（400）；RecallProgress 新 JSONB tables 列（server_default '[]'，迁移 80e5925339a7 父 d7d641a9f2a9 唯一 head）；deep_recall schema 请求 tables 校验（field_validator）、service save/reset/payload/_empty_progress 全链路。
- 测试：backend test_canvas_table_persistence.py 4 passed（图谱往返+非法422+画布20000边界、模板发布/加载 tables 重映射往返、多题往返+400、回忆保存/默认空/非法422/reset 清空）；Node canvas-table-adapters.test.js 3 passed（sanitizeCollection 边界、65 加载冒烟、99 adapter tables 保存往返）；wrapper canvas-table.test.mjs 3 passed。
- 定向回归：persistence+canvas_table+deep_recall_api+learning_workspace 22 passed。

## Notes

- 65 的 normalizeWorkspace 不导出，前端 payload.tables 往返由后端 API 测试覆盖 + T19 浏览器测试覆盖 UI 往返。
- T16 fragment paste 的 tables 排除决策维持（本任务只打通持久化管道，不含 fragment 合并——待 T19 UI 后按需评估）。
- 迁移在 pytest conftest 隔离库自动升级验证（4 passed 即含新列读写）。

## Commit

- 9cd874fb feat(canvas): persist tables across graph and learning workspaces（20 文件）

## Independent review & fixes

- 首轮审查：M1（tables 含非对象元素两入口 500）、M2（模板负向测试空转 409 假绿）、m1-m3。
- efa93333：M1 关闭（isinstance 拦截，422/400）；M2 重写（正确 revision + 带外直写绕过文件接口，真实覆盖 publish 校验）；m2（回忆 tables max_length=500）；m3（注释如实）。
- 复审新发现 M3（publish 通道第三条 500）：4a950851 一行 try/except + 带合法 id 坏表用例；另修 T15 旧测试占位假表为合法 TableV1。
- 最终复审：**通过，可合入**（M3 三类形态实测 422；14 后端 passed + 3 Node passed）。
- 遗留 Info：旧客户端缓存页全量替换语义的窄窗口、T18 前模板非法 tables 由前端 sanitizeCollection 降级、extra='forbid' 要求前后端字段同步演进。
- 提交链：9cd874fb → efa93333 → 4a950851。
