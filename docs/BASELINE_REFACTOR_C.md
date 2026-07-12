# 基线重构 C：首页学习包 / 用户文件库服务层

## 目标

在不改变首页现有交互、图谱数据结构和 localStorage 自动保存 key 的前提下，继续拆分首页大文件 `src/20-flashcards-toolbar.js`。

本轮重点是把后续前端新功能最容易复用的“学习包文件处理”和“用户文件库数据服务”先抽成稳定入口，避免新功能继续堆进首页工具栏脚本。

## 新增模块

```text
src/21-home-package-service.js
src/22-home-file-library.js
styles/home-file-library.css
```

## `KGHomePackageService`

`src/21-home-package-service.js` 对外导出：

```js
window.KGHomePackageService = {
  FORMAT,
  VERSION,
  safeFileBase,
  makeZip,
  readZipTextEntries,
  createReadme,
  buildManifest,
  buildPackageBlob,
  downloadPackage,
  parseFile
}
```

职责边界：

- 负责学习包 manifest、README、graph.json 的生成。
- 负责无第三方依赖的 ZIP 打包。
- 负责 ZIP / 旧 JSON 导入解析。
- 不直接读取或修改首页 `state`。
- 不直接调用 `render()`、`save()`、`showStatus()`。

首页 `20-flashcards-toolbar.js` 现在只保留薄封装：导出时传入 `exportableState()`，导入时调用 `sanitizeState()` 并触发 `render({persist:true})`。

## `KGHomeFileLibrary`

`src/22-home-file-library.js` 对外导出：

```js
window.KGHomeFileLibrary = {
  LIBRARY_KEY,
  MAX_RECORDS,
  currentOwner,
  readAll,
  writeAll,
  list,
  get,
  makeRecord,
  save,
  saveCurrent,
  update,
  remove,
  clear,
  duplicate,
  stats
}
```

职责边界：

- 负责“用户文件库 / 我的图谱”的本地数据服务。
- 默认按当前登录用户隔离记录，未登录归为 `guest`。
- 通过 `KGAppStorage` 读写，缺失时回退到 localStorage。
- 不主动改变首页当前图谱的自动保存流程。
- 不新增可见 UI，避免基线重构阶段改变用户操作路径。

预留存储 key：

```text
kg_home_file_library_v1
```

该 key 是新增文件库专用 key，不替换现有首页自动保存 key：

```text
通用知识点关系图谱工具_多科目重点聚焦版_v2
```

## 本次保持不变

- 首页现有导入 / 导出按钮 ID、动作名称和交互文案保持不变。
- 学习包 ZIP 内部结构保持不变：
  - `manifest.json`
  - `graph.json`
  - `README.txt`
- 旧 JSON 导入兼容保持不变。
- 当前图谱自动保存 key 不变。
- 题库、训练、订阅、用户、深度回忆等模块不做业务变更。

## 页面加载顺序

首页新增服务层加载顺序：

```text
00-config-state.js
10-graph-editor.js
19-home-toolbar-registry.js
21-home-package-service.js
22-home-file-library.js
20-flashcards-toolbar.js
30-auth-guards.js
```

`20-flashcards-toolbar.js` 依赖 `KGHomePackageService`，所以必须在 `21-home-package-service.js` 之后加载。

## 后续建议

完成 C 后，可以开始进入前端新功能开发。若下一步要做“首页用户文件库 / 我的图谱”，建议直接复用：

```js
KGHomeFileLibrary.saveCurrent()
KGHomeFileLibrary.list()
KGHomeFileLibrary.get(id)
KGHomeFileLibrary.remove(id)
```

UI 层单独新建模块，不要再把文件库面板逻辑写回 `20-flashcards-toolbar.js`。


## 后续版本

当前基线已继续完成：

- `BASELINE_REFACTOR_C1.md`：正式图谱文件库服务层与 3 分钟 dirty 自动保存。
- `BASELINE_REFACTOR_C1_1.md`：对标式双层顶部布局与固定宽度文件页签。
