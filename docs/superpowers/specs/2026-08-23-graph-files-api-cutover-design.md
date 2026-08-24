# 全量图谱服务化迁移与 Files API 切换设计

## 背景与目标

登录用户的图谱当前通过 `runtime_states.storage` 和 `/api/v1/runtime/state` 保存。异步水合期间，图谱编辑器可能读到空索引并创建默认图谱，覆盖用户真实索引。目标是将所有旧图谱迁移至 `graph_files`、`file_contents`、`folders`、`tags`、`file_tags`、`current_files`，并让登录用户只通过 `/api/v1/files` 读写；旧 runtime 图谱键保留用于回滚，访客继续使用本地存储。

## 数据迁移

新增专用迁移服务和 CLI，采用现有 runtime migration 的 canonical hash、scan/migrate/verify/drop-check 模式。扫描每个 `runtime_states.storage`：

- `kg_graph_file_index_v2` 提供索引元数据；
- `kg_graph_file_content_v2__<owner>__<id>` 提供正文和学习状态；
- 仅有正文的孤儿记录也必须迁移；缺正文的索引记录使用空图谱并记录 warning；
- 原 ID 可用时保留，跨用户或全局冲突时生成确定性 ID 并记录来源；
- current 无效时选择 active 文件首项；
- 迁移按 owner 幂等，失败回滚关系化写入，旧 storage 原样保留。

## Files API 切换

登录用户的图谱列表、打开、创建、保存、重命名、当前文件、回收站、恢复、复制、文件夹和标签统一走 `/api/v1/files`。首屏规则为：有 active 文件则加载列表首项；只有空列表才创建默认 11 节点文件。服务端必须验证 owner、active 状态、folder/tag 所属和 revision 冲突。

前端保留访客的同步本地 store；登录用户使用内存 cache 和 Files API transport，避免把 API 调用暴露到画布层。登录/登出时清空旧 session cache 和请求队列，旧响应不能应用到新账号。自动保存失败保留 dirty，409 不静默覆盖。

## runtime state 边界

迁移完成后，runtime state 不再承担图谱索引、正文和 current file 的权威读写；停止 SQL files 到 runtime v2 的反向 seed。旧 v2 键只读保留，不删除。

## 验证与发布

后端迁移测试覆盖完整索引、孤儿正文、缺正文、损坏记录、幂等、ID 冲突、current fallback、事务回滚和源保留。Files API 测试覆盖 owner 隔离、revision 冲突与 CRUD。前端测试覆盖访客、已有文件首项、空列表默认文件、登录切换和保存失败。UAT 完成真实浏览器验证后，才执行生产备份、全量 plan/scan/migrate/verify 和前端发布；不执行 runtime 键删除。

## 自检结果

- 迁移源与目标权威边界明确，无双写设计。
- 首屏选择规则明确，空列表才创建默认图谱。
- owner、revision、session epoch、网络失败和回滚均有处理要求。
- 本次变更限制在迁移服务、Files API、图谱适配器及对应测试；不覆盖工作区既有无关脏文件。
