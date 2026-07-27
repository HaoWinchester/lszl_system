# 微信 Native 支付安全凭证加载设计

## 目标

为 `lszl.aihuanpu.com` 的微信 Native 扫码支付接入生产凭证，并确保私钥、APIv3 密钥和微信支付公钥不会保存到 PostgreSQL、Git 仓库或管理端浏览器。

## 范围与确认项

- 支付方式固定为网页展示二维码、用户微信扫码的 Native 支付。
- 商户号为 `1115389574`，关联 AppID 为 `wx2d8ea5212f8d9f4f`。
- 使用已确认的商户 API 证书序列号与微信支付公钥 ID。
- 回调地址固定为 `https://lszl.aihuanpu.com/api/v1/subscriptions/wechat-pay/notify`。
- 不实现 JSAPI、小程序、APP 支付、退款或新支付渠道。

## 架构

生产服务器保留两份 PEM 文件，Docker 以只读方式挂载到 backend 容器：

```text
/opt/lszl/secrets/wechatpay/
├── apiclient_key.pem       商户 API 私钥，权限 0600
└── wechatpay_pub.pem       微信支付公钥，权限 0644
```

`docker-compose.prod.yml` 将下列环境变量传给 backend：

```text
WECHAT_PAY_API_V3_KEY=<仅服务器 .env.prod 保存，32 位>
WECHAT_PAY_MCH_PRIVATE_KEY_FILE=/run/secrets/wechatpay/apiclient_key.pem
WECHAT_PAY_WX_PUBLIC_KEY_FILE=/run/secrets/wechatpay/wechatpay_pub.pem
WECHAT_PAY_ENABLE_DEMO=false
```

应用配置层读取文件并把 PEM 内容仅交给微信支付签名和验签逻辑。支付配置 API 只返回非敏感状态信息（是否已配置、商户号、AppID、证书序列号、公钥 ID、回调地址和演示开关），不得返回密钥值或 PEM 内容。

## 数据流

1. 学员创建订阅订单。
2. 服务端以商户私钥签名 Native 下单请求，返回微信 `code_url`。
3. 浏览器将 `code_url` 渲染为二维码并轮询订单状态。
4. 微信向 HTTPS 回调地址发送通知。
5. 服务端以微信支付公钥验签、以 APIv3 密钥解密；仅当交易状态为 `SUCCESS` 且订单金额与本地订单一致时，幂等激活订阅。

## 安全与故障处理

- 私钥和 APIv3 密钥绝不写入 system_settings、日志、HTTP 响应或前端存储。
- 缺少任一必需凭证时，不生成真实支付二维码，并向管理员暴露明确的“未配置”状态；演示模式关闭时不回退到假支付。
- 回调验签失败、解密失败、未知订单、金额不一致均返回失败，不开通订阅。
- 部署前验证 PEM 格式和私钥与商户证书序列号匹配；部署后通过真实小额订单验证下单、扫码、回调和订阅开通。

## 验证

- 单元测试覆盖：环境覆盖优先于数据库配置、敏感字段不会从管理 API 返回、缺失凭证不会创建真实订单、合法回调的金额校验。
- 生产部署前运行后端测试套件。
- 生产部署后检查健康接口、容器日志不包含密钥、创建一笔真实 Native 测试订单并完成扫码支付。
