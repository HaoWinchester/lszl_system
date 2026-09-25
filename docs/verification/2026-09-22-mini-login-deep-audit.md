# 登录链路再次复查（1.0.10）

## 结论与边界

继续检查 1.0.9 当前客户端，补上存储故障和绑定凭证失效的恢复路径。下列问题均通过故障注入先复现，再修复；未复现微信审核设备的原始白屏，因此不把这些缺陷断言为那次驳回的唯一根因。

未部署正式服务器、未修改后端业务、正式数据库或用户权限。前后端联测使用 pytest 自动创建并销毁的隔离 PostgreSQL 数据库；仅微信 code 换取 openid 的提供方被模拟，客户端 Page、认证服务、HTTP、FastAPI 路由和数据库业务均执行实际代码。不能把这一测试算作真实微信身份或手机验收。

## 复现与修复

1. 会话缓存读取抛异常：原首页初始化在跳转登录之前中断。共享 session 模块安全读取、检查基本类型，读不到会话时按未登录处理。
2. token 写入成功、用户信息写入失败：原实现留下半份会话。现在回滚缓存并给出明确的存储错误；页面返回微信登录步骤，避免继续使用已经被服务器消费的注册/绑定凭证。
3. 绑定凭证过期或无效：原页面保留旧凭证，重复提交继续失败。现在清空凭证并回到微信登录，保留表单输入以便重试。
4. 401 回调清理缓存时再次抛异常：原请求 Promise 无法结束，页面一直等待。现在逐项容错清理，并在当前进程中标记会话失效，即使设备无法删除缓存也不会继续使用已清理的会话；完整保存新会话后解除失效标记。

只修改 `miniprogram/services/session.ts` 和 `miniprogram/pages/login/index.ts` 两个业务源文件，公共会话读写供所有页面复用。

## 验证

- `npm test --prefix miniprogram`：290 通过、0 失败；新增 6 项存储及登录恢复回归用例。
- `cd backend && .venv/bin/python -m pytest tests/test_wechat_mini_auth_api.py tests/test_wechat_mini_service.py tests/test_mini_client_login_flow.py -q`：16 通过，3 条依赖弃用警告。
- 新增前后端联测覆盖：新身份注册、校验会话、读取试卷列表、退出、已绑定微信登录、错误密码、无效凭证重新取得、再次绑定成功、服务器注册已提交但本地存储失败后重新微信登录恢复同一账号且没有重复注册。
- 微信开发者工具直接启动登录页：页面完整显示，未同意协议点击登录有明确提示；Errors 0。没有代用户勾选协议。
- 恢复普通编译后逐一查看首页、练习、成长、我的；页面可切换、账号数据可加载，原草稿保留。调试器未出现业务错误；告警为全局组件按需加载、工具预加载资源及 worker 不支持上报的提示。
- `git diff --check` 通过。

本地证据位于 `artifacts/`：`login-storage-red.log`、`login-storage-cleanup-red.log`、`login-storage-invalidation-red.log`、`login-deep-tests.log`、`login-deep-backend-tests.log`、`login-deep-render.png`、`login-deep-catalog.png`、`login-deep-profile.png`、`login-1.0.10-upload-form.png`、`login-1.0.10-upload.png`。

## 交付与待验收

微信开发者工具上传 **1.0.10** 成功，上传前提示该操作覆盖现有体验版。代码纳入 UAT；main 保持原样。候选包延续 1.0.9 登录保护、好友分享及弱网优化。

尚需用户在手机关闭调试后，以此前未绑定的微信身份完成：微信登录 → 注册或绑定 → 首页 → 进入试卷并做题 → 退出后再次登录。手机端实际微信认证、审核设备网络与后台域名配置并未由本次隔离联测验证；在这一步通过前不宣称审核问题已彻底解决或正式发布就绪。
