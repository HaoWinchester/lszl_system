# 认证与用户核心第一步重构说明

## 本次新增

新增 `src/29-auth-core.js`，统一提供：

- localStorage key：
  - `kg_local_users_v1`
  - `kg_local_current_user_v1`
  - `kg_user_admin_logs_v1`
- 用户读取与保存：
  - `users()`
  - `saveUsers()`
  - `normalizeUser()`
  - `upsertUser()`
  - `removeUser()`
- 当前登录上下文：
  - `currentUsername()`
  - `currentUser()`
  - `setCurrentUsername()`
  - `clearSession()`
- 账号工具：
  - `cleanUsername()`
  - `makeSalt()`
  - `hash()`
  - `passwordHash()`
  - `verifyPassword()`
- 系统日志：
  - `logAction()`
- 通用工具：
  - `readJSON()`
  - `writeJSON()`
  - `escapeHTML()`
  - `uid()`
  - `fmtTime()`

## 本次已接入

以下模块已优先使用 `KGAuthCore`：

- `src/34-role-permissions.js`
- `src/37-subscription-core.js`
- `src/31-admin-utils.js`

所有活跃页面均已在权限/订阅模块之前加载：

```html
<script defer src="src/29-auth-core.js"></script>
```

## 为什么暂不大改登录模块

`src/30-auth-guards.js` 和 `src/72-question-training-page.js` 直接控制登录、注册、会话切换、训练页初始化和图谱加载。为了避免一次性改动造成回归，本次只建立公共核心和低风险接入点。

后续第二步建议逐步迁移：

1. `30-auth-guards.js` 使用 `KGAuthCore` 的用户读取、保存、密码验证、session 写入。
2. `72-question-training-page.js` 使用同一套认证核心，消除训练页重复认证逻辑。
3. `33-user-center.js` 和 `35-user-management.js` 再逐步迁移用户保存/日志函数。
4. 最后让微信登录也统一走 `KGAuthCore.upsertUser()` 和 `KGAuthCore.setCurrentUsername()`。

## 订阅功能影响

订阅核心 `src/37-subscription-core.js` 已开始优先使用 `KGAuthCore.currentUser()` 和 `KGAuthCore.currentUsername()`。后续订阅开通、续期、停用等逻辑可以直接依赖统一用户核心。


## 第二步：迁移首页认证运行时

本次将 `src/30-auth-guards.js` 的认证底层逻辑迁移到 `KGAuthCore`：

- `authUsers()` 优先调用 `KGAuthCore.users()`
- `authSaveUsers()` 优先调用 `KGAuthCore.saveUsers()`
- `authCleanUsername()` 优先调用 `KGAuthCore.cleanUsername()`
- `authMakeSalt()` 优先调用 `KGAuthCore.makeSalt()`
- `authPasswordHash()` 优先调用 `KGAuthCore.passwordHash()`
- `authLogAction()` 优先调用 `KGAuthCore.logAction()`
- `authLoadSession()` 优先调用 `KGAuthCore.currentUser()`
- 登录 / 注册 / 第三方登录成功后优先调用 `KGAuthCore.setCurrentUsername()`
- 退出登录优先调用 `KGAuthCore.clearSession()`

保留了原有对外函数名和 UI 行为：

- `authLogin()`
- `authRegister()`
- `authLogout()`
- `authAfterExternalLogin()`
- `authRequire()`
- `window.KGAuthRuntime`

这样首页已有业务模块不需要改调用方式，但用户数据、会话和订阅依赖的当前用户上下文已经统一到 `KGAuthCore`。


## 第三步：迁移独立考题训练页认证运行时

本次将 `src/72-question-training-page.js` 的认证底层逻辑迁移到 `KGAuthCore`：

- `authUsers()` 优先调用 `KGAuthCore.users()`
- `authSaveUsers()` 优先调用 `KGAuthCore.saveUsers()`
- `authNormalizeUserRecord()` 优先调用 `KGAuthCore.normalizeUser()`
- `authCleanUsername()` 优先调用 `KGAuthCore.cleanUsername()`
- `authMakeSalt()` 优先调用 `KGAuthCore.makeSalt()`
- `authPasswordHash()` 优先调用 `KGAuthCore.passwordHash()`
- 登录密码校验优先调用 `KGAuthCore.verifyPassword()`
- `authLogAction()` 优先调用 `KGAuthCore.logAction()`
- `authLoadSession()` 优先调用 `KGAuthCore.currentUser()`
- 登录 / 注册 / 第三方登录成功后优先调用 `KGAuthCore.setCurrentUsername()`
- 退出登录优先调用 `KGAuthCore.clearSession()`

保留了训练页原有对外函数名、登录弹窗行为、题库重新加载逻辑和 `window.KGAuthRuntime`。这样微信登录、题库训练、角色权限模块仍按原入口调用，但训练页用户数据、会话和日志已经与首页共用同一套认证核心。


## 第四步：迁移微信登录与用户中心

本次将 `src/32-wechat-login.js` 和 `src/33-user-center.js` 的用户数据与会话底层继续收敛到 `KGAuthCore`：

- 微信登录：
  - 用户读取优先调用 `KGAuthCore.users()`
  - 用户保存优先调用 `KGAuthCore.saveUsers()`
  - 用户规范化优先调用 `KGAuthCore.normalizeUser()`
  - 会话写入优先调用 `KGAuthCore.setCurrentUsername()`
  - 日志写入优先调用 `KGAuthCore.logAction()`
  - 保留 `window.KGWechatLogin` 对外接口与原本地演示/正式授权流程

- 用户中心：
  - 当前用户优先调用 `KGAuthCore.currentUser({ includeInactive:true })`
  - 用户名优先调用 `KGAuthCore.currentUsername()`
  - 保存资料优先调用 `KGAuthCore.upsertUser()`
  - 密码校验优先调用 `KGAuthCore.verifyPassword()`
  - 密码 hash / salt 优先调用 `KGAuthCore.passwordHash()` 与 `KGAuthCore.makeSalt()`
  - 日志写入优先调用 `KGAuthCore.logAction()`
  - 保存后同步刷新角色权限、订阅标记、全局快捷栏和右上角账号状态

至此，首页登录、考题训练页登录、微信登录、用户中心资料修改已经共用同一套认证与用户数据核心。下一步建议单独迁移 `src/35-user-management.js`，因为它包含新增、归档、删除、重置密码和批量管理，风险比用户中心更高。

## 第五步 A：用户管理页底层工具函数接入认证核心

本次只做用户管理页的低风险迁移，保持 `src/35-user-management.js` 原有页面结构、函数名、表单、批量操作入口和交互流程不变。

已迁移到 `KGAuthCore` 的底层能力：

- 用户读取优先调用 `KGAuthCore.users()`
- 用户保存优先调用 `KGAuthCore.saveUsers()`
- 用户规范化优先调用 `KGAuthCore.normalizeUser()`
- 用户名清洗优先调用 `KGAuthCore.cleanUsername()`
- 密码 salt/hash 优先调用 `KGAuthCore.makeSalt()` 与 `KGAuthCore.passwordHash()`
- 日志写入优先调用 `KGAuthCore.logAction()`
- HTML 转义、时间格式化、JSON 读写优先调用 `KGAuthCore` 对应工具
- 删除当前登录账号时优先调用 `KGAuthCore.clearSession()` 清理会话
- 用户保存后刷新角色权限、订阅标记、全局快捷栏和用户中心状态

本次没有拆分用户管理页的大块 UI 逻辑，也没有改变新增、归档、暂停、删除、复制、导入导出和批量操作的用户体验。下一步建议再做「第五步 B」，把用户管理页的批量操作、导入导出和删除/归档动作进一步收敛为独立的用户管理服务层，减少 `35-user-management.js` 的体积。

## 第五步 B：用户管理业务动作抽取为服务层

本次新增 `src/35-user-management-service.js`，将用户管理页中的数据写操作从 DOM/交互脚本中抽离出来。

服务层统一负责：

- 用户创建与字段规范化
- 用户资料更新
- 密码重置
- 状态切换（正常 / 暂停 / 归档）
- 用户复制
- 单个与批量删除
- 批量调整角色、状态和科目
- 用户导入合并与导出数据结构
- 用户数据持久化及 `kg-auth-users-change` 事件
- 删除当前登录账号后的会话清理

`src/35-user-management.js` 现在主要保留：

- DOM 渲染与分页/筛选状态
- 表单数据收集
- confirm / prompt / toast 交互
- 调用 `KGUserAdminService` 并刷新界面

导入用户时采用“现有字段 + 导入字段”的合并策略，避免旧导入文件意外清除未来新增的订阅等字段。用户管理页脚本也统一改为 `defer` 顺序加载，确保 `KGAuthCore` 与服务层先于页面控制器执行。
