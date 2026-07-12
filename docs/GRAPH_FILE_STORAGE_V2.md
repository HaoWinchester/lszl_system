# 图谱文件存储 v2

## 目标

文件存储从“一个 localStorage 数组保存全部图谱正文”升级为“轻量索引 + 每个文件独立内容”，为文件管理、回收站、容量统计和后续 IndexedDB 迁移提供稳定基础。

## 存储键

- `kg_graph_file_index_v2`：轻量文件索引，不包含 `graphData`。
- `kg_graph_file_content_v2__<owner>__<fileId>`：单个文件的图谱正文和学习状态。
- `kg_graph_current_file_v2`：各账号当前文件 ID。
- `kg_graph_file_tags_v2`：标签定义。
- `kg_graph_file_migration_v2`：迁移完成标记。

## 兼容与迁移

首次加载自动迁移：

- `kg_graph_file_library_v1`
- `kg_home_file_library_v1`
- `kg_graph_current_file_v1`
- `kg_graph_file_tags_v1`

旧键暂不主动删除，便于出现异常时回退。`KGHomeFileLibrary` 已改为兼容代理，新代码应直接调用 `KGGraphFileStore`。

## 新增能力

- `schemaVersion` 与 `revision`
- `nodeCount`、`linkCount`、`byteSize` 索引元数据
- 软删除、恢复、清空回收站、过期清理
- `getStorageStats()`
- `estimateStorage()`
- `verifyIntegrity()`

## 删除语义

`deleteFile(id)` 默认移入回收站。永久删除需明确传入：

```js
KGGraphFileStore.deleteFile(id, { permanent: true });
```

## v8.1 接入说明

v8.1 开始，已有首页功能逐步改为直接消费 v2 文件模型：

- 文件页签和标题显示只读取索引元数据：`getFileMeta()` / `getCurrentFileMeta()`。
- 打开文件才读取完整内容：`openFile()` / `getFile()`。
- 文件切换只同步当前文件 ID，最近打开时间通过延迟队列批量写入：`touchFileOpened()` / `flushOpenedTouches()`。
- 导入学习包默认新建图谱文件，避免覆盖当前文件。
- 导出学习包前会先保存当前图谱，再从当前文件内容生成 ZIP。
- 保存标题时会同步文件名和 `graphData.meta.title`，保持现阶段用户界面的一致命名体验。

未来文件管理器 UI 应优先使用轻量索引接口：

```js
KGGraphFileStore.listFiles();
KGGraphFileStore.getFileMeta(id);
KGGraphFileStore.renameFile(id, name);
KGGraphFileStore.deleteFile(id); // 默认进入回收站
```

只有在打开、复制、导出或生成缩略图时再读取正文：

```js
KGGraphFileStore.getFile(id);
KGGraphFileStore.openFile(id);
```
