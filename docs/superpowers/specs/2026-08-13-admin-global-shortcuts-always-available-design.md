# 后台全局快捷栏常驻设计

## 背景与目标

后台顶部一级导航覆盖 12 个页面，但现有全局快捷悬浮栏只在题库、用户管理和基础系统设置页面装载。目标是在所有带 `.admin-context-nav` 的后台页面持续提供同一快捷栏，方便管理员和教师跨页面跳转；登录页与学员端现状不变。

## 覆盖范围

以下页面必须装载全局快捷栏：

- `admin-console.html`
- `admin-subjects.html`
- `teacher-workbench.html`
- `question-bank.html`
- `paper-management.html`
- `course-admin.html`
- `user-management.html`
- `feedback-management.html`
- `message-management.html`
- `admin-operations.html`
- `admin-settings.html`
- `system-settings.html`

不扩大登录页或学员端页面的快捷栏覆盖范围。

## 实现设计

采用逐页显式装载方案。每个后台页面显式引用 `styles/global-shortcuts.css` 和 `src/39-global-shortcuts.js`；缺少 `src/34-role-permissions.js` 的页面同时补齐角色权限模块。脚本顺序必须保证认证模块先于角色权限模块，角色权限模块先于快捷栏模块。

继续复用现有 `src/39-global-shortcuts.js`，不改变快捷入口、视觉样式、默认折叠、展开切换、横纵排布、拖拽、位置记忆、当前页提示或角色权限过滤。页面内只允许存在一个 `#kgGlobalShortcuts`。

该变更不引入新组件、业务 API 或业务数据。快捷栏位置与排布仍属于临时界面偏好，沿用现有浏览器存储是合理例外。

## 需求追踪与验收

| 场景 | 页面 | 预期结果 | 验证方式 |
| --- | --- | --- | --- |
| 正向：后台访问 | 12 个后台页 | 快捷栏可见且唯一，默认折叠 | 静态覆盖测试 + 浏览器逐页测试 |
| 正向：展开 | 任一后台页 | 点击折叠按钮后显示角色允许的快捷入口 | 浏览器交互测试 |
| 正向：跳转 | 任一后台页 | 点击非当前页入口进入目标页面 | 浏览器交互测试 |
| 权限边界 | 管理员与教师 | 仅展示该角色允许的入口 | 浏览器角色测试 |
| 恢复 | 刷新或跨页 | 拖拽位置与排布沿用现有记忆行为 | 现有快捷栏回归测试 |
| 负向：非后台 | 登录页及未新增覆盖的学员页 | 不因本次变更新增快捷栏引用 | 静态边界测试 |

## 发布约束

源文件是 `new-legacy/`。正式发布只能走 `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser`；发布前必须核对待发布 site 与当前 active release 的文件数，并确认后台关键页面存在。若工作区包含其他未提交功能改动，不得把它们混入本次发布。
