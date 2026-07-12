# 基线整理记录

本整理版基于 `kg_graph_modularized_auth_core_step5b_fix01.zip`。

## 已确认保留的核心模块

- `system-settings.html`
- `src/29-auth-core.js`
- `src/33-user-center.js`
- `src/35-user-management-service.js`
- `src/36-system-settings.js`
- `src/37-subscription-core.js`
- `styles/system-settings.css`
- `styles/subscription.css`

## 已移除的历史文件

- `legacy-single-file.html`
- `docs/combined-for-parse-check.js`

## 本轮整理

- 统一 `knowledge-recall.html`、`question-bank.html` 的本地脚本加载方式为 `defer`。
- 更新 README 与模块审计文档中的历史文件说明。
- 未改业务逻辑、localStorage key、主要按钮 ID 与页面 DOM 结构。

## 第六步：统一脚本加载顺序

本次在不改业务逻辑的前提下，统一了所有活跃页面的本地脚本加载方式和顺序。

统一原则：

1. 所有本地脚本统一使用 `defer`，避免阻塞 HTML 解析。
2. 认证核心 `src/29-auth-core.js` 放在权限、订阅和全局组件之前。
3. 权限与订阅基础层优先加载：`src/34-role-permissions.js`、`src/37-subscription-core.js`。
4. 全局组件随后加载：微信登录、用户中心、全局快捷栏。
5. 页面业务脚本最后加载，保留原有依赖顺序。例如首页的 `src/30-auth-guards.js` 仍位于图谱与工具栏函数声明之后，避免守卫包装旧函数时找不到目标函数。

本次涉及页面：

- `index.html`
- `question-training.html`
- `knowledge-recall.html`
- `question-bank.html`
- `user-management.html`
- `system-settings.html`

这一步完成后，后续进入「第七步：校准订阅模型」时，可以稳定依赖 `KGAuthCore`、`KGRolePermissions` 和 `KGSubscription` 的加载顺序。
