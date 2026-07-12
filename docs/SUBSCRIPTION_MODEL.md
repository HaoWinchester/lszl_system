# 订阅模型校准记录

本次为第七步优化：只校准订阅数据模型和展示，不接入真实支付，不直接限制具体业务按钮。

## 角色边界

订阅权益只对学员角色 `student` 生效：

- `admin` 管理员：绕过订阅限制。
- `teacher` 教师/教研：绕过订阅限制。
- `student` 学员：进入订阅判断。
- `viewer` 游客：不进入订阅体系，只保留公开示例体验。
- `guest` 未登录访客：不进入订阅体系。

## 套餐 ID

当前正式套餐模型：

| planId | 名称 | 有效期 | 用途 |
| --- | --- | --- | --- |
| `free` | 免费学员 | 长期有效 | 示例体验和轻量练习 |
| `monthly` | 月度会员 | 30 天 | 短期备考、低门槛订阅 |
| `quarterly` | 季度会员 | 90 天 | 阶段性备考套餐 |
| `half_year` | 半年会员 | 180 天 | 主推备考周期套餐 |
| `lifetime` | 终身会员 | 永久有效 | 长期学习与高级能力 |

## 第七步补充调整

- 新增 `quarterly` 季度会员，位于月度会员和半年会员之间。
- 所有学员套餐均包含学习包导入和学习包导出权益。
- 免费学员不再限制学习包导入/导出次数；免费学员首页图谱卡牌上限为 50。
- 学员订阅权益不再包含“发布试卷”；发布试卷属于教师/教研角色职责。
- 套餐价格展示改为填写 `originalPriceText`（原价）和 `discountPercent`（折扣系数百分比），由订阅核心自动计算 `priceText`（现价）和 `discountText`（折扣标签）。

历史占位套餐会自动兼容映射：

| 旧 planId | 新 planId |
| --- | --- |
| `free_student` | `free` |
| `basic_student` | `monthly` |
| `pro_student` | `half_year` |

## 数据结构

订阅数据仍保存在本地：

```text
kg_student_subscriptions_v1
```

单个学员订阅记录结构：

```js
{
  username: "student1",
  planId: "monthly",
  status: "active",
  startedAt: 0,
  expiresAt: 0,
  updatedAt: 0,
  source: "manual",
  orderId: "",
  note: ""
}
```

`lifetime` 和 `free` 的 `expiresAt` 为 `0`，表示不按日期过期。

## 统一 API

业务页面后续不要直接判断套餐字段，应统一调用：

```js
KGSubscription.canUse('learningPackageImport')
KGSubscription.canUse('learningPackageExport')
KGSubscription.requireFeature('advancedRecall')
KGSubscription.usageLimit('dailyTraining')
KGSubscription.setStudentSubscription(username, patch)
```

这样后续接支付、后端校验或套餐改名时，不需要大面积改业务页面。

## 后续开发建议

第八步正式订阅功能可以在这个模型上继续做：

1. 用户中心显示“我的订阅”。
2. 用户管理页支持管理员给学员开通、续期、停用订阅。
3. 系统设置页支持套餐价格和权益文案配置。
4. 逐步将学习包导出、深度回忆高级能力、完整题库训练等接入 `data-subscription-feature` 或 `KGSubscription.requireFeature()`。


补充：免费学员深度回忆单题知识点回顾上限为 30；付费会员不限。学习包导入/导出所有学员均可使用且不按次数限制。


## 第八步 B：订阅申请与开通

当前版本不接真实支付。学员点击会员卡片后生成 `pending` 订阅申请，管理员在系统设置页确认后调用订阅核心开通或续期。详见 `docs/SUBSCRIPTION_STEP8B.md`。
