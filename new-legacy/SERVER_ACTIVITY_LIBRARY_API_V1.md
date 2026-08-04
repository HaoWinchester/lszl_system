# Server Activity Library API v1（部署预留）

v8.6.1 前端可离线运行，也可通过 Question Studio 的同步适配器连接服务器。

## 建议接口

```text
POST /api/activities/import
GET  /api/activities?createdBy=me
GET  /api/activities/{activityId}
PUT  /api/activities/{activityId}
GET  /api/activities/{activityId}/revisions
GET  /api/subjects
GET  /api/knowledge-taxonomies?subjectId=subject-pmp
```

`POST /api/activities/import` 接收一个或多个 Activity Schema v1 活动，服务器必须依次执行：

```text
验证登录会话
→ 从会话写入教师账号
→ Activity Schema 校验
→ 科目和知识点引用校验
→ 重复及冲突检查
→ 权限检查
→ 保存活动
→ 创建修订记录
→ 返回汇总
```

返回示例：

```json
{
  "success": true,
  "summary": {
    "created": 8,
    "updated": 2,
    "unchanged": 1,
    "conflicts": 0,
    "rejected": 0
  }
}
```

## 身份安全

浏览器提交的 `createdByUserId`、`updatedByUserId` 只能作为离线快照信息。正式服务器必须忽略这些客户端身份字段，并根据已验证的登录会话重新写入。原创建者字段创建后不得被普通更新覆盖。

## 启用方式

在 `question-studio/server-config.js` 中设置：

```javascript
activityImportEndpoint: "/api/activities/import"
```

未配置接口时，Question Studio 使用同源浏览器活动库，适合原型、单机或上线前演示。
