# new-legacy 前端发布工具

生产页面只使用 `new-legacy` 原版 HTML、CSS 和 JavaScript，由 FastAPI 同源直出。此目录不再包含 React、Vite、iframe 宿主或第二套路由。

常用命令：

```bash
pnpm dev                 # 数据库迁移后，在 5173 启动 FastAPI
pnpm sync:new-legacy     # 从仓库中的 new-legacy 生成当前站点
pnpm test                # 运行发布、同步和直接运行契约测试
../manage-new-legacy status
../manage-new-legacy update ../new-legacy
../manage-new-legacy rollback
```

浏览器统一访问 `http://127.0.0.1:5173`。版本更新和回滚流程见 `docs/new-legacy-updates.md`。
