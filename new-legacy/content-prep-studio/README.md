# PMP Content Prep Studio v0.4.0 Source

这是 v0.4.0 的可维护源码包。正式项目构建并发布 `dist/content-prep.html` 单文件。

## 目录

- `src/index.template.html`：HTML 结构
- `src/css/app.css`：全部样式
- `src/js/00-core-bootstrap.js`：常量、ID、hash、IndexedDB、主题、审计基础
- `src/js/10-state-domain.js`：State、导入/normalize、Question/Tag/Principle 等领域逻辑
- `src/js/20-page-runtime.js`：7 个页面和编辑器的渲染逻辑
- `src/js/30-service-layer.js`：v0.4.0 Service Facade
- `src/js/40-events-bootstrap.js`：事件绑定与启动
- `src/tag-slot-schema.json`：内部语义标签槽位与正式程序数字槽位映射
- `tests/`：静态/迁移回归测试
- `build.py`：零第三方依赖构建器

## 构建

```bash
python build.py
```

输出：

`dist/content-prep.html`

## v0.4.0 重构边界

本版不重写已经稳定的页面渲染器，而采用渐进式 Service Layer：
- TagService
- QuestionService
- StorageService
- WorkspaceService
- ImportService
- ExportService
- ValidationService

后续新增功能优先通过 Service 层，不再直接跨页面修改全局 state。

## 标签兼容

内部：
`usage/stage/basic`

正式主程序导出：
`usage/stage/0`

旧 v0.2/v0.3 Workspace 的数字槽位在打开时自动迁移到语义槽位。
