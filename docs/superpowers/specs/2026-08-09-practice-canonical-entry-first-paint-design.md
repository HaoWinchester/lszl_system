# 做题模式统一入口设计

## 背景

当前 `/` 与 `/learning-path.html` 返回旧学习路径页面，`/practice-mode.html` 才是应当展示的做题模式。访客因此会先进入错误页面；`/login` 虽然已经改到做题模式，但它只覆盖主动登录入口，没有修正用户实际访问的学习入口。

本次按用户要求只修改入口路径，不改做题模式页面源码、不增加首屏状态控制，也不重建前端发布包。

## 目标行为

| 入口 | 结果 |
| --- | --- |
| `/` | 服务端返回 `307 /practice-mode.html` |
| `/learning-path.html` | 服务端返回 `307 /practice-mode.html` |
| `/login` | 保持 `307 /practice-mode.html?auth=login` |
| `/practice-mode.html` | 继续直接返回做题模式页面 |

未登录用户进入做题模式后，由现有业务显示“暂时没有可练习的已发布试卷”；登录用户进入同一个做题模式，并由现有目录逻辑显示该账号可用试卷。普通入口不附带 `auth=login`，因此不会自动弹出登录框。

## 实现方案

### 服务端规范路径

FastAPI 在发送旧学习路径 HTML 之前处理 `/` 和 `/learning-path.html`，对二者返回固定的 `/practice-mode.html` 重定向。固定目标不复制来访查询参数，避免旧页面的 `stage`、`part` 或 `auth` 参数影响做题模式。

这是服务端重定向，不是页面加载后的 JavaScript 跳转。浏览器不会收到或绘制旧学习路径 HTML，因此该入口不会再先显示旧页面再切换。

### 保持主动登录语义

`/login` 继续跳转到 `/practice-mode.html?auth=login`，只有主动访问登录入口时才自动打开登录框。账号菜单中现有的主动登录操作保持不变。

## 测试

- 路由测试验证 `/` 与 `/learning-path.html` 都精确返回 `307 /practice-mode.html`。
- 路由测试验证来访查询参数不会传给做题模式。
- 现有 `/login` 三项测试继续验证登录入口、`next` 参数和强制登录模式。
- 浏览器 smoke 从 `/learning-path.html` 进入，确认最终地址为 `/practice-mode.html`、存在 `.practice-app`、不存在 `.gl-app`，且登录框未自动打开。
- 运行后端完整测试及现有发布契约回归，确认其他稳定别名未受影响。

## 非目标

- 不修改 `new-legacy/`、`frontend/public/new-legacy/` 或 active release。
- 不修改做题模式的 HTML、CSS、JavaScript、试卷目录、订阅或认证逻辑。
- 不新增加载动画、遮罩或客户端延时跳转。
- 不修改 `/graph`、`/training`、`/workspace` 等其他稳定别名。
