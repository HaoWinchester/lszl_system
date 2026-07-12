# 基线重构 A：订阅模块拆分

本次重构基于 `kg_graph_modularized_subscription_card_codes_note_removed_fix.zip`，目标是在不改变业务逻辑、不改变 localStorage key、不改变 UI 的前提下，降低订阅模块继续扩展的维护成本。

## 拆分结果

原 `src/37-subscription-core.js` 已拆为：

```text
src/37-subscription-plans.js          套餐模型、套餐设置、价格/折扣、权益和用量文案
src/37-subscription-orders.js         订阅申请、确认开通、取消、删除和订单状态文案
src/37-subscription-redeem-codes.js   卡密生成、查询、启停、删除和学员兑换
src/37-subscription-core.js           统一入口、订阅状态、权益校验、页面装饰和对外 API 汇总
```

## 兼容边界

- `window.KGSubscription` 对外接口保持不变。
- 订阅套餐 ID 保持不变：`free / monthly / quarterly / half_year / lifetime`。
- 兼容旧套餐别名：`free_student / basic_student / pro_student` 等。
- localStorage key 保持不变：
  - `kg_student_subscriptions_v1`
  - `kg_subscription_plan_settings_v1`
  - `kg_student_subscription_orders_v1`
  - `kg_student_subscription_redeem_codes_v1`
  - `kg_subscription_plan_model_v2_migrated`
- 原页面调用仍统一使用 `window.KGSubscription`，不直接依赖拆分后的内部模块。

## 页面加载顺序

所有活跃页面已按以下顺序加载订阅相关脚本：

```html
<script defer src="src/37-subscription-plans.js"></script>
<script defer src="src/37-subscription-orders.js"></script>
<script defer src="src/37-subscription-redeem-codes.js"></script>
<script defer src="src/37-subscription-core.js"></script>
```

`37-subscription-core.js` 会汇总前三个模块并暴露 `window.KGSubscription`。

## 检查项

- `src/*.js` 语法检查通过。
- 活跃页面脚本和样式资源引用检查通过。
- 活跃页面重复 ID 检查通过。
- `window.KGSubscription` 导出项数量与名称保持一致。
- 订阅申请、管理员确认、卡密生成、卡密兑换、套餐价格折扣的基础运行链路已做最小冒烟验证。
