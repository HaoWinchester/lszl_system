# 脚本加载顺序说明

本文件记录第六步整理后的脚本加载基线。

## 总原则

所有活跃页面的本地脚本统一使用 `defer`，避免阻塞页面解析，并保证脚本按 HTML 中的顺序执行。

推荐顺序：

```text
1. 认证核心：src/28-app-storage.js
29-auth-core.js
2. 角色权限：src/34-role-permissions.js
3. 订阅基础层：src/37-subscription-plans.js → src/37-subscription-orders.js → src/37-subscription-redeem-codes.js → src/37-subscription-core.js
4. 全局组件：微信登录、用户中心、全局快捷栏
5. 页面业务脚本
```

## 首页特殊顺序

`index.html` 中的 `src/30-auth-guards.js` 不是纯核心脚本，它会包装首页图谱与工具栏函数，例如：

- `openNodeModal`
- `createNodeAt`
- `applyNodeSize`
- `applyLineStyle`
- `applyLineColor`

因此首页加载顺序保留为：

```text
29-auth-core.js
34-role-permissions.js
37-subscription-plans.js
37-subscription-orders.js
37-subscription-redeem-codes.js
37-subscription-core.js
32-wechat-login.js
33-user-center.js
39-global-shortcuts.js
00-config-state.js
10-graph-editor.js
19-home-toolbar-registry.js
21-home-package-service.js
22-home-file-library.js
23-graph-file-store.js
24-graph-file-autosave.js
25-graph-file-tabs.js
20-flashcards-toolbar.js
30-auth-guards.js
...
90-bootstrap.js
```

这样既保证认证/权限/订阅核心提前可用，也避免权限守卫包装函数时目标函数尚未声明。

## 后续要求

新增页面时应优先复用这套顺序。新增订阅、用户中心或全局快捷栏相关能力时，不要让页面业务脚本早于 `29-auth-core.js`、`34-role-permissions.js`、`37-subscription-plans.js`、`37-subscription-orders.js`、`37-subscription-redeem-codes.js`、`37-subscription-core.js` 加载。


## 基线重构 B 补充

所有活跃页面已在 `29-auth-core.js` 前加载 `28-app-storage.js`，确保认证、权限、订阅和全局组件可优先使用统一存储入口。


## 基线重构 C 补充

首页新增两个服务层脚本：

```text
21-home-package-service.js
22-home-file-library.js
```

它们必须放在 `20-flashcards-toolbar.js` 之前。`21-home-package-service.js` 提供学习包 ZIP / JSON 解析与导出能力，`22-home-file-library.js` 提供后续“我的图谱 / 用户文件库”的本地数据服务。`30-auth-guards.js` 仍保留在工具栏动作注册之后加载。


## C-1 / C-1.1 首页文件模块顺序

```text
src/21-home-package-service.js
src/22-home-file-library.js
src/23-graph-file-store.js
src/24-graph-file-autosave.js
src/25-graph-file-tabs.js
src/20-flashcards-toolbar.js
```

## C-1.2 账号菜单加载顺序

首页在引导模块之后加载账号菜单：

```text
src/30-auth-guards.js
src/40-guided-tour.js
src/41-account-menu.js
...
src/90-bootstrap.js
```

`41-account-menu.js` 依赖认证运行时、用户中心和引导函数，因此应放在 `30-auth-guards.js`、`33-user-center.js`、`40-guided-tour.js` 之后，并在 `90-bootstrap.js` 之前加载。
