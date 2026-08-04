# Engagement API v1

P4.1 的前端默认使用 `local-demo` 存储适配器。正式服务器部署时，在 `src/01-runtime-config.js` 或页面加载前的 `window.KG_APP_CONFIG.engagement` 中设置：

```js
{
  mode: 'remote',
  baseUrl: 'https://example.com',
  credentials: 'include'
}
```

接口统一返回 JSON；失败时返回非 2xx 状态及 `{ "message": "错误说明" }`。

## 用户反馈

- `POST /api/feedback`：提交反馈。
- `GET /api/feedback/mine`：读取当前用户反馈与管理员回复；每条反馈返回 `unreadReplyCount` 和 `lastReadAt`。
- `POST /api/feedback/:id/read`：将当前用户看到的该反馈管理员回复标记为已读。
- `GET /api/admin/feedback`：管理员读取反馈列表。
- `PATCH /api/admin/feedback/:id`：更新处理状态。
- `POST /api/admin/feedback/:id/replies`：回复用户。

反馈状态：`pending`、`in_progress`、`resolved`、`closed`。

## 站内消息

- `GET /api/messages`：读取当前用户可见消息，并返回 `read`、`readAt`。
- `POST /api/messages/:id/read`：标记单条已读。
- `POST /api/messages/read-all`：全部标记已读。
- `GET /api/admin/messages`：管理员读取消息列表。
- `POST /api/admin/messages`：创建草稿。
- `PATCH /api/admin/messages/:id`：更新消息。
- `POST /api/admin/messages/:id/publish`：发布或定时发布。
- `POST /api/admin/messages/:id/withdraw`：撤回。
- `DELETE /api/admin/messages/:id`：删除未发布或已撤回消息。

消息状态：`draft`、`published`、`withdrawn`。受众支持：

```json
{ "type": "all", "roles": [], "users": [] }
{ "type": "roles", "roles": ["student", "viewer"], "users": [] }
{ "type": "users", "roles": [], "users": ["alice", "bob"] }
```

服务端必须依据登录会话校验管理员权限，不能依赖前端页面隐藏。


## 反馈回复未读状态

`GET /api/feedback/mine` 返回的单条反馈至少包含：

```json
{
  "id": "feedback-001",
  "replies": [],
  "lastReadAt": 0,
  "unreadReplyCount": 1
}
```

服务端必须按当前登录用户隔离已读状态。管理员仅修改处理状态而没有新增用户可见回复时，不增加未读数。`POST /api/feedback/:id/read` 只能标记当前用户本人提交的反馈，不能读取或修改其他用户的反馈状态。
