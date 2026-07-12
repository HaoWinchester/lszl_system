# 基线重构 B：KGAppStorage 通用存储模块

## 目标

在不改变现有业务逻辑、localStorage key 和数据格式的前提下，新增统一的本地存储适配层 `src/28-app-storage.js`，为后续首页用户文件库、学习分析、深度回忆高级记录、训练推理图谱等新功能提供统一数据入口。

## 新增模块

```text
src/28-app-storage.js
```

对外导出：

```js
window.KGAppStorage = {
  readString,
  writeString,
  readJSON,
  writeJSON,
  updateJSON,
  remove,
  exists,
  keys,
  namespacedKey,
  migrateJSON
}
```

## 本次接入范围

本轮只接入低风险、基础层和跨页面公共模块：

- `29-auth-core.js`
- `30-auth-guards.js`
- `31-admin-utils.js`
- `32-wechat-login.js`
- `33-user-center.js`
- `34-role-permissions.js`
- `36-system-settings.js`
- `37-subscription-core.js`
- `37-subscription-plans.js`
- `39-global-shortcuts.js`
- `00-config-state.js`
- `20-flashcards-toolbar.js`
- `40-guided-tour.js`
- `80-question-font-scale.js`
- `86-knowledge-recall.js`

题库管理等大文件中的业务数据读写暂未整体迁移，避免一次性改动过大。后续如果要大改题库管理，再单独做服务层拆分。

## 保持不变

- 不改任何现有 localStorage key。
- 不改已有 JSON 结构。
- 不改用户、角色、订阅、订单、卡密、题库、训练、深度回忆 UI 流程。
- `KGAuthCore`、`KGSubscription`、`KGRolePermissions` 对外 API 保持兼容。

## 页面加载顺序

所有活跃页面新增加载顺序：

```text
28-app-storage.js
29-auth-core.js
34-role-permissions.js
37-subscription-plans.js
37-subscription-orders.js
37-subscription-redeem-codes.js
37-subscription-core.js
页面业务脚本
```

## 后续建议

基线重构 C 可以继续拆：首页学习包 / 用户文件库服务层：

```text
src/21-home-package-service.js
src/22-home-file-library.js
styles/home-file-library.css
```

这样新功能不会继续塞进 `20-flashcards-toolbar.js`。
