# 登录入口使用新版做题页背景

## 目标

访问 `/login` 时，登录弹窗应打开在 `practice-mode.html` 上，不再使用 `learning-path.html` 作为背景。当访客没有可用的已发布试卷时，页面保持新版做题页的空状态：“暂时没有可练习的已发布试卷”。

## 范围

- 修改后端 `/login` 稳定别名的目标页。
- 保留 `auth=login` 参数，让现有 `direct-entry.js` 在新页上自动打开登录弹窗。
- 保留请求中的其他查询参数，不破坏 `next` 等调用方上下文。
- 不改变 `/` 和显式 `/learning-path.html` 的现有访问行为。
- 不改变认证、试卷权限、空状态数据判定或 active release 内容。

## 数据与交互流

1. 访客请求 `/login`。
2. 后端返回 `307` 到 `/practice-mode.html?auth=login`。
3. 新版做题页读取服务端注入的访客 bootstrap 和已发布试卷数据。
4. `direct-entry.js` 识别 `auth=login` 并调用 `authOpen`。
5. 无试卷时，弹窗背后展示“暂时没有可练习的已发布试卷”；有试卷时显示当前可用试卷。
6. 登录成功后沿用现有远程认证刷新机制，在同一做题页重建账号状态。

## 验证

- 后端路由测试：`/login` 返回到 `practice-mode.html?auth=login` 的 `307`。
- 查询参数测试：`/login?next=...` 保留 `next` 并同时带上 `auth=login`。
- 浏览器回归：未登录访问 `/login` 时，最终 URL 是 `practice-mode.html?auth=login`，登录弹窗打开，无试卷空状态存在。
- 负向/恢复路径：关闭登录弹窗后仍留在可用的新版做题页，可再次从账号菜单打开登录。

