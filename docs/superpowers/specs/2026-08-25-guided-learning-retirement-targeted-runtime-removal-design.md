# 旧引导学习下线与学员页 Runtime 定向清理设计

**日期：** 2026-08-25  
**状态：** 已批准  
**目标分支：** `codex/runtime-retirement`  
**发布目标：** UAT（不执行生产发布）

## 1. 背景

晚间高并发事故中，Nginx 连接数耗尽是网站失效的直接原因，而旧 `runtime` 整包读写会放大每次访问的连接占用、响应体大小与服务端处理时间。当前学员主链路中，图谱文件、刷题、深度回忆、多题工作区和认证已有正式领域 API，但页面仍被全局注入 `server-state-bootstrap.js`，导致无必要的 `/api/v1/runtime/*` 请求。

另外，学员端仍保留一套旧游戏化引导学习：

- `learning-path.html`：学习路径；
- `guided-learning-node.html`：节点练习；
- `guided-learning-placement-test.html`：跳级测试。

用户已确认这套学员功能不再需要，并要求保留完整的账号密码登录和微信扫码登录。

## 2. 目标与成功标准

1. 下线学员端学习路径、节点练习和跳级测试，产品中不再存在可达入口。
2. 旧 URL 不返回 404，统一重定向到 `/practice-mode.html`，且不加载旧页面脚本。
3. 以下页面在访客、学员及登录/退出过程中不产生任何 `/api/v1/runtime/*` 请求：
   - `index.html`；
   - `file-manager.html`；
   - `practice-mode.html`；
   - `knowledge-recall.html`；
   - `question-workspace.html`；
   - 已退役跳转壳 `question-training.html`。
4. 图谱文件、作答、错题、回忆进度、个人卡片和工作区继续从正式领域 API 读写，不回退到 runtime 或新的通用 KV API。
5. 账号密码登录、微信扫码登录、OAuth 回调、微信绑定/解绑、后台微信配置和微信支付保持可用。
6. 教师/管理端尚未完成领域迁移的草稿数据不受影响；本次不全站删除 runtime 路由或旧数据表。
7. UAT 候选 release 通过文件数、关键页、API、契约和浏览器验证后才 promote。

## 3. 范围边界

### 3.1 本次下线

- 文件管理及其他页面中指向旧引导学习的导航、按钮、帮助文案和埋点入口。
- 三个学员页的实际功能、进度写入、学习事件和 runtime 同步。
- `/learning/node` 和 `/learning/placement-test` 的旧路由目标。
- 应用启动时的引导课程 seed，以及学员端 `/api/v1/guided-learning/*` 路由注册。
- 只服务于这三个页面的脚本和样式执行内容。

### 3.2 必须保留

- `src/32-wechat-login.js` 及其正式扫码 UI。
- `/api/v1/auth/wechat/config`、`/auth-url`、`/callback`、`/binding` 及受控的 demo 登录。
- `/api/v1/system/wechat-config` 管理配置和微信支付相关 API。
- 教师内容中心、科目/课程管理仍在使用的活动 schema 和内容共享模块，包括被管理页直接引用的 `87-guided-learning-data.js`。
- 教师/管理页当前仍需的 runtime 访问，直到对应草稿领域迁移单独完成。
- 现有引导学习数据表暂不 drop，仅停止路由与 seed，避免在功能下线提交中附带不可逆数据销毁。

### 3.3 非目标

- 不修改微信 AppID、AppSecret、APIv3 密钥或支付回调配置。
- 不重设登录弹窗、账号菜单或微信二维码视觉。
- 不在本次删除 runtime 后端总路由和两张通用状态表。
- 不执行生产部署。

## 4. 目标架构

### 4.1 页面级 runtime 允许列表

`sync-new-legacy.js` 不再向所有 HTML 统一注入 `server-state-bootstrap.js`。改为显式允许列表：只有经审计确认尚依赖 runtime 的教师/管理页才注入。学员目标页面必须默认无注入，新页也不得因默认逻辑重新获得 runtime。

后端 `build_bootstrap` 拆分为：

- 通用认证元数据：用户、角色、session id、release 版本；
- 仅允许页需要的 runtime 状态。

学员页仍可同步获得服务端认证信息，但后端不读取 runtime 表，页面也不拦截 `window.localStorage`。

### 4.2 数据归属

| 功能 | 权威数据源 | 浏览器本地范围 |
|---|---|---|
| 登录与当前用户 | `/api/v1/auth/*` + FastAPI session | 短期交互状态 |
| 微信登录/绑定 | `/api/v1/auth/wechat/*` | OAuth 结果展示，不存密钥 |
| 微信管理配置 | `/api/v1/system/wechat-config` | 管理页内存缓存 |
| 图谱文件/当前文件 | `/api/v1/files*` | 画布外观、最近颜色等 UI 偏好 |
| 发布试卷与练习 | `/api/v1/paper-releases*` + `/api/v1/learning/practice*` | 本设备显示偏好 |
| 深度回忆 | `/api/v1/recall*` | 主题、折叠、视口偏好 |
| 多题工作区/个人卡片 | `/api/v1/workspaces*` + `/api/v1/learning/personal-cards*` | 选中项、面板和视口偏好 |

纯 UI 偏好使用浏览器原生 `localStorage`；它们不上传、不跨设备同步。未提交的短期导航上下文使用 `sessionStorage` 或内存。

### 4.3 微信登录解耦

`direct-system-adapter.js` 当前把微信配置投影到 `KGServerStateStorage` 的 `kg_wechat_login_config_v1`，且在没有 runtime storage 时会提前返回，这会连带阻断角色主题、订阅和微信配置预载。

本次将其改为直接 API 边界：

1. 普通微信扫码直接请求 `/api/v1/auth/wechat/auth-url`，不依赖 runtime 配置键。
2. 是否显示可用入口由 `/api/v1/auth/wechat/config` 决定；配置加载失败显示可恢复错误，不回退伪配置。
3. 管理端保存调用 `/api/v1/system/wechat-config`，页内使用内存快照，不回写 runtime。
4. 角色主题、订阅和微信支付初始化不再以 `KGServerStateStorage` 存在为前置条件。
5. AppSecret、token、code 和支付密钥仍不进入浏览器、日志或 runtime。

### 4.4 旧引导学习退役形式

项目的 release validator 会阻止文件数少于当前 active release 的候选版本。为了同时满足“功能彻底下线”和“不降低发布完整性门禁”：

- 三个 HTML 保留同名文件，内容改为无业务脚本、无 runtime 的最小跳转壳；
- FastAPI 对 `.html` 和旧 alias 都返回 307 到 `/practice-mode.html`；
- 仅服务于这三页的 JS/CSS 保留同名退役占位文件，清除可执行业务内容，避免候选文件数回退；
- 共享给教师内容中心的 schema/内容模块按引用关系保留，不根据文件名误删。

## 5. 实施边界

### 5.1 后端

- 为三个旧 `.html` URL 和两个 alias 建立一致重定向。
- 从 API router 移除 guided-learning 学员路由注册。
- 停止 lifespan 引导课程 seed。
- 保留 ORM 表定义和现有表，不执行 drop migration。
- `build_bootstrap` 对目标学员页跳过 runtime 读取，但仍注入认证与 release 元数据。

### 5.2 前端源与同步层

- 修改只落在 `new-legacy/` 权威源、`frontend/scripts/new-legacy-assets/` 公共适配器和 `frontend/scripts/sync-new-legacy.js`。
- 不手改 `frontend/public/new-legacy/` 或 active release；它们只由正式 sync/update 生成。
- 入口调整统一指向“做题模式”，不在多页面复制跳转脚本。
- 将 `direct-system-adapter.js` 中认证与系统预载从 runtime storage 存在性判断中拆出。
- 对目标页做静态依赖审计和真实浏览器 Network 跟踪；如发现有意义的业务键仍只有 runtime 权威源，必须切换到已有领域 API 后再关闭该页 runtime，不得静默丢数据。

## 6. 错误处理与恢复

- 认证 API 401 显示登录态；403 显示权限态，不用空数据伪装成功。
- 微信配置或授权地址加载失败时，保留“重新生成二维码”和“使用账号密码登录”恢复路径。
- 旧引导学习 URL 的查询参数不传入做题页，避免 `node`/`part` 污染新页路由上下文。
- UAT 验证失败时不 promote 候选 release；已 promote 时使用 release manager 回滚到 `previousVersion`，不重新打开学员 runtime 双写。

## 7. 测试设计

实施遵循 TDD，每类修改先加失败契约，确认 RED 后再写最小实现。

### 7.1 静态与单元契约

1. 三个旧页是最小跳转壳，不包含 `server-state-bootstrap`、`KGServerStateStorage` 或旧业务脚本。
2. 文件管理和其他激活页不再链接 `learning-path.html`。
3. 目标页生成物中 runtime bootstrap 注入数为零；教师草稿页的允许列表注入仍存在。
4. `direct-system-adapter.js` 没有“缺少 `KGServerStateStorage` 即整段退出”的行为。
5. 微信扫码登录从正式 API 读配置并启动 OAuth，不读写 `kg_wechat_login_config_v1` runtime 键。
6. 后端学员页 bootstrap 测试断言 runtime service 未被调用，教师允许页仍按需调用。

### 7.2 后端认证与微信

- 账号密码登录成功/失败、退出和 `/auth/me`。
- 微信配置未就绪、正常 auth URL、正确回调、错误/重复 state、第三方失败、绑定冲突和解绑。
- 断言回调结果建立正常 FastAPI session，且返回原站内目标。

### 7.3 浏览器逐页验收

对 `index.html`、`file-manager.html`、`practice-mode.html`、`knowledge-recall.html`、`question-workspace.html` 及其退役跳转壳：

- 访客首次打开；
- 账号密码登录、刷新、退出；
- 微信登录入口、二维码容器、回调结果和重试；
- student 的一次真实读及一次真实写；
- teacher/admin 访问学员页；
- 401/403/网络错误后恢复；
- 捕获 Network 和 console，断言 `/api/v1/runtime/` 请求数为 0。

认证、退出和账号菜单必须遍历所有目标页，不得只测一个页面。

## 8. 发布与验证

1. 运行后端完整测试和 `frontend/pnpm test`。
2. 运行定向设计契约及上述浏览器遍历。
3. 使用 `node frontend/scripts/manage-new-legacy.js update new-legacy --skip-browser` 生成不可变 release，禁止手工覆盖 active site。
4. 发布前核对 source、public、candidate 与 active 的文件数，并抽查 `admin-console.html`、`practice-mode.html`、`index.html` 和微信登录脚本。
5. 只部署到 UAT，遵循现有 UAT 不备份流程；不执行生产部署脚本。
6. 完成后将功能分支合入 `uat` 并使用代理推送，再核对远程引用。

## 9. 完成定义

- 旧引导学习无可达产品入口，旧 URL 仅重定向做题模式。
- 目标学员页和全部登录/退出操作的 runtime 网络请求为零。
- 账号密码与微信登录全链路验收通过。
- 图谱和做题业务读写全部由明确领域 API 完成。
- 教师/管理端旧草稿无回归，现有数据表未被破坏性删除。
- UAT release 文件数不少于当前 active，关键页齐全，契约、后端、浏览器及健康检查全部通过。
