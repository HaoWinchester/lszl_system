# UAT 小程序登录配置记录

> 后续更新（同日）：以下保留首次配置时的历史记录。`deploy/update-uat.sh` 现已统一使用小程序 overlay，并提供只读 `--check-config`。后续代码、镜像及综合复测结果以 [小程序审计修复报告](audit-fixes-2026-09-08.md) 为准；本段不代表重新验证了真实 `wx.login` 流程。

2026-09-08，仅配置 UAT，未发布正式环境、未提交或推送代码。

## 隔离与运行

- 服务器项目：`/home/ubuntu/lszl-kg-uat`，Compose 项目 `lszl-kg-uat`。
- 独立凭据：`backend/.env.wechat-mini.local`，权限 `0600`，仅含 `WECHAT_MINI_APP_ID`、`WECHAT_MINI_APP_SECRET`、`WECHAT_MINI_ENABLE_DEMO=false`。未复制本地数据库或 PC 配置。
- 使用 `docker-compose.uat.yml` 加 `docker-compose.mini-uat.yml`，保留现有镜像 `lszl-kg-backend:uat-27c39ab`。
- overlay 关闭 httpx/httpcore 的 INFO 请求日志，避免微信查询参数中的密钥进入日志。
- 仅重建 UAT backend 容器；逐项核对旧环境变量、镜像 ID、端口和数据库配置不变，正式 backend 容器 ID 与启动时间不变。
- 重启前数据库 revision 与 head 同为 `f4c8b6d9e120`，无待执行迁移。

后续重启/部署必须带上小程序 overlay，否则基础 Compose 不会加载独立凭据。配置文件已存在，不应覆盖为整份本地 `.env`。当前 `deploy/update-uat.sh` 尚未集成 overlay，不能直接用它刷新此环境后宣称小程序配置仍有效。

```sh
cd /home/ubuntu/lszl-kg-uat
docker compose -p lszl-kg-uat --env-file .env.uat \
  -f docker-compose.uat.yml -f docker-compose.mini-uat.yml \
  up -d --no-deps --no-build --pull never backend
```

## 已验证

- 本地配置隔离测试：2 通过；`git diff --check` 通过。
- 微信 stable_token 校验成功，仅记录校验结果，未输出或持久化令牌。
- UAT 健康接口：HTTP 200，数据库正常。
- 无效 code 登录：从 `WECHAT_MINI_NOT_CONFIGURED` / 503 变为 `WECHAT_CODE_INVALID` / 401，符合预期。
- UAT PC 微信配置接口：HTTP 200。
- 正式健康接口：HTTP 200。

## 未验证

- 本次未使用真实 `wx.login` code 完成 UAT 登录。
- 尚未验证真实用户在 UAT 的会员权限、做题、交卷和记录同步全流程。
- 以上仅开发自检，不代表用户 UAT 验收通过或正式发布就绪。
