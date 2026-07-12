# 基线重构 C-1：首页图谱文件库服务层

## 目标

在保留旧单图谱存储 key、既有图谱数据结构和其他业务流程的前提下，将首页升级为“一个用户一个文件库、每个图谱一个文件”的本地文件模型。

## 新增模块

```text
src/23-graph-file-store.js
src/24-graph-file-autosave.js
```

### `window.KGGraphFileStore`

提供：

```js
listFiles()
getFile()
getCurrentFile()
createFile()
openFile()
saveFile()
renameFile()
deleteFile()
duplicateFile()
setFileTags()
getFileTags()
listTags()
createTag()
deleteTag()
setCurrentFileId()
getCurrentFileId()
migrateLegacyGraph()
ensureInitialized()
```

存储 key：

```text
kg_graph_file_library_v1
kg_graph_current_file_v1
kg_graph_file_tags_v1
```

文件按当前登录账号隔离；未登录时使用 `guest` 空间。

### `window.KGGraphFileAutosave`

保存策略：

- 图谱发生变化时只标记 dirty，不再进行 260ms 近实时写入。
- 每 3 分钟检查一次，只有 dirty 时才保存。
- 切换文件前同步保存。
- 页面刷新、关闭、pagehide 和退出登录前同步保存。
- 保存时同时更新当前图谱文件，并镜像写回旧单图谱 key，保持旧模块兼容。

## 旧数据迁移

首次进入某个用户空间且文件库为空时，读取原有：

```text
通用知识点关系图谱工具_多科目重点聚焦版_v2__user__<username>
```

或游客公共图谱 key，并迁移为该用户的第一个图谱文件。旧 key 不删除。
