# 订阅第八步 B：订阅申请与管理员开通流程

本步骤在第八步 A 的权益限制基础上，补充“前端本地订阅订单 / 开通申请”闭环。当前仍不接真实支付，适合作为内测、演示和后续支付接入前的占位流程。

## 本次新增

### 1. 订阅订单存储

新增本地存储键：

```text
kg_student_subscription_orders_v1
```

订单状态：

- `pending`：待管理员确认
- `approved`：已开通
- `cancelled`：已取消

订单中保留套餐快照，包括套餐名、现价、原价、折扣、权益展示文案和用量展示文案。这样后续修改套餐配置，不会影响历史订单记录的展示。

### 2. 学员端申请流程

会员权益弹窗中点击会员卡片后：

1. 显示确认订阅申请页面。
2. 展示套餐名称、现价、原价、折扣、权益摘要和用量说明。
3. 点击“确认提交申请”后生成一条 `pending` 订单。
4. 学员看到提交成功提示，等待管理员确认。

免费学员方案不生成订单；管理员和教师/教研不需要订阅；游客需要切换为学员账号。

### 3. 管理员端处理流程

系统设置页的“订阅套餐”页签中新增“订阅开通申请”区域。

管理员可以：

- 查看订阅申请列表
- 查看待确认 / 已开通 / 已取消数量
- 确认开通申请
- 取消申请

确认开通后会自动调用订阅核心开通或续期：

- 月度：约 30 天
- 季度：约 90 天
- 半年：约 180 天
- 终身：永久有效

如果用户当前套餐仍未到期，续期会在当前有效期基础上顺延。

## 新增核心 API

`KGSubscription` 新增：

- `ORDER_KEY`
- `ORDER_STATUS_LABELS`
- `readOrders()`
- `saveOrders(list)`
- `orderList(options)`
- `pendingOrders()`
- `currentUserOrders()`
- `hasPendingOrder(username, planId)`
- `createOrder(planId, options)`
- `approveOrder(orderId, options)`
- `cancelOrder(orderId, options)`
- `removeOrder(orderId)`
- `orderStatusLabel(status)`

新增事件：

```text
kg-subscription-order-change
```

## 后续建议

第八步 C 可以继续做：

1. 订单状态入口提示，例如用户中心显示“已有待确认订阅申请”。
2. 订阅订单筛选、搜索、导出。
3. 模拟支付成功模式，便于演示。
4. 后续接真实支付时，将 `createOrder / approveOrder` 替换为后端接口。
