# 用户管理服务层

`src/35-user-management-service.js` 暴露 `window.KGUserAdminService`，负责用户管理页面的数据写操作；`src/35-user-management.js` 只负责 DOM、表单、确认框、提示和页面状态。

## 主要 API

- `loadUsers()`：读取并规范化用户集合。
- `persist(users, options)`：统一保存用户集合、派发用户变更事件，并在当前账号被删除时清理会话。
- `createUser(users, input)`：创建用户并生成密码 salt/hash。
- `updateUser(users, username, patch)`：更新资料，保留未修改字段。
- `resetPassword(users, username, password)`：重置密码。
- `setStatus(users, username, status)`：切换正常、暂停、归档状态。
- `duplicateUser(users, sourceUsername, input)`：复制账号并设置独立密码。
- `deleteUsers(users, usernames)`：单个或批量删除。
- `batchUpdate(users, usernames, patch)`：批量调整角色、状态、科目。
- `pickUsers(users, usernames)`：提取导出所需账号。
- `buildExportPayload(users)`：生成兼容原格式的导出对象。
- `importUsers(users, payload, options)`：合并导入用户，保留导入文件未覆盖的扩展字段。

## 调用约定

所有写操作返回：

```js
{
  ok: true,
  users: {/* 新用户集合 */}
}
```

失败时返回：

```js
{
  ok: false,
  code: '错误代码',
  message: '可展示给用户的说明'
}
```

页面控制器不应直接修改 `state.users[username]`，而应调用服务方法并在成功后统一持久化。
