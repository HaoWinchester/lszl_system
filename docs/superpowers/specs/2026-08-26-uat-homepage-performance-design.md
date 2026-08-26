# UAT 首页分阶段加载与传输优化设计

## 背景与目标

UAT 的公共落地页可以快速完成加载，但知识图谱业务首页 `index.html` 会在首屏一次性请求 83 个 JavaScript、21 个 CSS，并触发多项业务初始化。实测正常冷加载约 12 秒；在 300 Kbps、250 ms 往返延迟下约 49 秒。后端本机返回 HTML 约 2.7 ms，相关 API 通常在 17–134 ms，因此瓶颈是 HTTP/1.1 下的大量未压缩静态资源排队，而不是数据库、服务器 CPU 或已退役的 learner runtime。

本次改造采用用户确认的“方案 A”：先交付轻量首屏和认证，再自动在后台加载一个当前知识图谱；题库、做题、文件库和辅助功能按实际进入动作加载。同时将首页 83 个独立脚本构建为少量页面级 bundle，合并重复的认证会话请求，并为 UAT 启用 HTTPS、HTTP/2 与 JS/CSS/JSON gzip。

## 已确认的产品边界

1. 首屏优先显示现有页面框架、导航、账号状态和明确的“图谱加载中”状态，不改变现有视觉结构、DOM 锚点或主要控件。
2. 首屏呈现后自动加载图谱，无需用户再点击一次“进入图谱”。
3. 初始阶段只读取一个“当前图谱”的正文；不批量读取其他图谱正文。
4. 图谱列表、文件夹、标签、回收站和其他图谱元数据在用户打开文件库、页签管理或相应功能时才加载。
5. 如果账号没有当前图谱，显示可用的空白图谱状态，不扫描历史图谱，也不静默创建或覆盖服务器记录。
6. 题库与做题模块只有在用户进入相关功能时加载。
7. 密码登录、微信登录、会员流程、图谱编辑和做题行为保持兼容。
8. learner 页面继续保持零 `/api/v1/runtime` 请求；现有 admin/teacher runtime 白名单不在本次范围内。
9. UAT 部署不创建备份；所有可恢复配置必须先进入 Git，Nginx 变更通过 `nginx -t` 后才 reload。

## 方案比较

### 方案 A：分阶段页面 bundle 与显式加载器（采用）

保留当前原生 JavaScript 的全局 API 和既有执行顺序，由同步/发布链路按显式清单生成少量 bundle。轻量 shell/auth bundle 首屏加载；graph bundle 在首屏绘制后自动加载；file-library、question 和 secondary bundle 在对应交互发生时加载。

优点是能同时减少请求数、降低首屏字节数、保留旧代码行为，并允许逐组验证。风险是旧脚本存在隐式顺序依赖，因此 bundle 清单必须固定顺序并由契约测试保护。

### 方案 B：单一大 bundle

把 83 个脚本按原顺序合并为一个文件。它能减少 HTTP 请求，但仍会在首屏下载全部图谱、题库和辅助代码，弱网传输体积没有根本下降，也不满足按需加载要求。

### 方案 C：整体迁移到 ES Modules/esbuild

把旧全局脚本改成模块导入导出，再由现代 bundler 做 tree-shaking 和 code splitting。长期结构更理想，但现有代码依赖大量 `window.*` 公共对象和脚本顺序，一次迁移的回归面过大，不适合作为本次 UAT 性能修复。

## 架构设计

### 1. UAT HTTPS、HTTP/2 与 gzip

仓库中的 `deploy/nginx-uat.aihuanpu.com.conf` 成为 UAT Nginx 的唯一配置源：

- 80 端口保留 `/.well-known/acme-challenge/`，其余请求 301 到 HTTPS。
- 443 端口使用新签发的 `uat.aihuanpu.com` Let’s Encrypt 证书，并启用 `ssl http2`。
- 443 继续反代到 `127.0.0.1:18087`，保持 UAT 与正式环境隔离。
- 开启 `gzip_vary`、`gzip_proxied any`、适度压缩等级和最小压缩长度。
- `gzip_types` 至少覆盖 `text/css`、`application/json`、`application/javascript`、`text/javascript`、`text/plain`、`application/xml` 和 `image/svg+xml`。
- 首次签证书分两步执行：先部署仍可提供 HTTP challenge 的配置并通过 `nginx -t`，再使用服务器现有 Certbot 账户签发证书；只有证书文件存在且再次 `nginx -t` 成功后才启用 443 和 HTTP 跳转。
- 不在 UAT 初次启用 HSTS，避免证书或测试域配置异常时把客户端锁死在 HTTPS。

验证必须同时证明：HTTP 正确跳转、HTTPS 证书域名正确、浏览器协商 HTTP/2、JS/CSS/JSON 响应带 gzip，并且 `/api/v1/health` 正常。

### 2. 页面级 bundle 构建

`new-legacy/` 继续是权威前端源。同步层新增一个显式的首页资源清单和确定性 bundle 构建步骤；生成物写入 `frontend/public/new-legacy/`，再由正式 release 工具构建不可变 site。禁止手工修改 public 或 active release。

首页生成以下资源组：

1. `home-shell`：运行配置、共享认证会话、认证核心、角色权限、登录对话框、最小账号状态和首屏加载状态。
2. `home-graph`：图模型、画布控制器、图谱编辑器、当前图谱适配器、保存与必要的图谱工具。首屏绘制和认证状态确定后自动加载。
3. `home-file-library`：文件库、完整页签列表、文件夹、标签和回收站。首次打开文件库或完整页签管理时加载。
4. `home-question`：首页中与题库、训练或闪卡相关的代码。首次进入相应功能时加载；独立做题页面继续使用各自页面资源，不由首页预取。
5. `home-secondary`：用户中心、订阅、帮助、反馈、消息和非首屏分析 UI，在首次点击对应入口或浏览器空闲且不影响 graph 加载时加载。

CSS 同样按 shell、graph 和 deferred feature 分组，防止 21 个独立样式请求继续成为首屏瓶颈。每个 bundle 严格保持源清单顺序，以分号和来源边界分隔；构建过程检查文件存在、重复条目、未分组条目和输出哈希，避免静默漏脚本。

首页加载器需要保证：

- 每组最多加载一次，并向并发调用方返回同一个 Promise。
- graph 自动加载失败时显示具体失败状态和“重试”动作，首屏、登录和导航仍可使用。
- 用户在 graph 尚未完成时触发 graph 控件，复用正在执行的加载 Promise，不重复下载或初始化。
- deferred 功能加载失败只影响对应功能，并允许再次点击重试。
- bundle URL 继续带发布版本；构建内容变化必须进入 manifest、sync report 和 release hash。

### 3. 只加载一个当前图谱

远程图谱 store 新增“当前图谱轻量初始化”入口：

1. 认证会话确定后请求 `/api/v1/files/current`。
2. 有当前 ID 时，只请求一次 `/api/v1/files/{current_id}`，使用响应中的 meta、graphData 和 learningState 初始化当前页签、编辑器和正文缓存。
3. 没有当前 ID 时建立仅存在于当前页面内存的空白视图，等待用户明确新建或保存。
4. 初始过程不请求 active/trash 文件列表、文件夹或标签。
5. 用户打开文件库、完整页签列表或管理动作时，才调用现有完整 `refresh()`，加载轻量索引和管理数据；仍不读取其他图谱正文。
6. 切换账号或退出登录时清除当前图谱初始化缓存，新的登录会话重新执行一次轻量初始化。

任何时刻，同一图谱正文的并发读取需要由 in-flight Promise 合并；失败后必须清除失败 Promise，允许用户重试。

### 4. 合并 `/api/v1/auth/me`

同步适配层新增一个跨页面共享认证会话模块，提供以下稳定接口：

- `load()`：返回当前 in-flight 或已解析会话 Promise。
- `refresh()`：在登录、退出或绑定状态变化后开启一个新代次；同一代次内的并发刷新仍只发送一个请求。
- `peek()`：同步读取最近一次已解析快照，不访问网络。
- `invalidate()`：使旧快照失效，但不自行发请求。

`direct-entry`、`feature-analytics`、学习入口选择器和其他直接读取 `/auth/me` 的共享调用方统一改为使用该模块。首次页面加载只允许一次 `/api/v1/auth/me`。登录或退出后的新会话允许一次新的 refresh，但旧响应不得覆盖较新的认证状态。

### 5. 错误处理与兼容性

- 首屏认证失败按访客状态渲染，不阻塞图谱 shell；网络恢复后允许刷新会话。
- 当前图谱读取失败时保留空白画布和可见重试，不把空白内容自动保存覆盖服务器图谱。
- 文件库按需加载失败时不清空已显示的当前图谱。
- bundle 任何一组失败都记录带组名的错误，不伪装成功，也不触发 learner runtime 回退。
- 页面现有 DOM ID、class、键盘操作、画布行为、登录弹窗和微信登录入口保持不变。
- 不引入业务数据的 localStorage/IndexedDB 新写入；数据库仍是图谱、题库、账号和订阅的事实来源。

## 需求追踪与测试

| 需求 | 正向路径 | 失败/恢复路径 | 自动验证 |
| --- | --- | --- | --- |
| HTTPS/HTTP2/gzip | HTTPS 200、HTTP/2、静态资源 gzip | 证书或 `nginx -t` 失败时不启用跳转 | Nginx 语法检查、curl/浏览器协议和响应头 |
| 轻量首屏 | shell/auth 先出现，graph 后台加载 | graph bundle 失败时首屏可用且能重试 | bundle 契约 + Playwright 网络/可见状态 |
| 单个当前图谱 | current + 一次 detail 请求后显示并可编辑 | 无 current 显示空白；detail 失败可重试且不覆盖 | API 计数、编辑保存、刷新恢复 E2E |
| 文件库按需 | 打开文件库后加载索引/文件夹/标签 | 加载失败保留当前图谱并允许重试 | 控件矩阵 E2E |
| 题库按需 | 首屏无题库 bundle，请求功能时加载一次 | 加载失败只影响题库功能并允许重试 | 资源请求断言 + 做题正负路径 |
| 认证合并 | 首次三个消费者共享一次 `/auth/me` | 401 为访客；登录后只 refresh 一次；旧响应不能覆盖新会话 | VM 单元测试 + 浏览器请求计数 |
| runtime 退役保持 | learner 页面无 runtime 脚本和请求 | bundle 失败不得回退 runtime | runtime retirement contract + E2E |

测试流程采用 TDD：每项行为先写会失败的契约或浏览器测试，确认失败原因正确后再实现最小改动。完成后运行：

1. 前端定向 bundle、认证合并、当前图谱按需测试。
2. `cd frontend && pnpm test` 全量契约测试。
3. `cd backend && .venv/bin/python -m pytest tests/ -q` 全量后端测试。
4. 正式 `manage-new-legacy.js update` 发布候选门禁，包括浏览器和视觉验证。
5. UAT 公网冷加载验收：learner runtime 0、首次 `/auth/me` 1、图谱正文最多 1、初始无文件库/题库请求。
6. UAT 性能验收：正常网络首屏目标不超过 3 秒；300 Kbps/250 ms 模拟下先显示 shell，不再持续白屏接近一分钟。时间阈值只用于真实浏览器验收，CI 以稳定的请求数、资源组和传输预算为主。

## 发布与恢复

1. 所有代码、生成产物、Nginx 配置和测试先提交到开发分支。
2. 正式 release 必须核对当前 active site 文件数和关键页面，走 `manage-new-legacy.js update`，禁止手工复制 release。
3. UAT 不创建备份。应用发布继续使用现有 UAT 脚本；Nginx 只从已提交配置安装。
4. Certbot 签发失败时保持 HTTP 代理可用，不安装引用不存在证书的 443 配置。
5. `nginx -t` 或 HTTPS 健康检查失败时，重新安装 Git 中上一提交的 UAT Nginx 配置并 reload；应用 release 仍可独立回滚到 previousVersion。
6. 验收通过后把开发分支合入 `uat` 并使用代理推送，部署 UAT 后再次核对远端分支和线上版本。

## 验收结论标准

只有同时满足以下条件才宣布完成：

- UAT HTTPS 有效并协商 HTTP/2；HTTP 自动跳转 HTTPS。
- JS、CSS、JSON 的可压缩响应启用 gzip。
- 首页不再加载 83 个独立脚本，首屏只加载 shell/auth，graph 随后自动加载。
- 首次认证请求严格为 1 次。
- 初始图谱正文请求最多 1 次，其他图谱正文为 0 次。
- 文件库和题库资源在用户进入功能前为 0 次。
- 密码登录、微信登录、图谱编辑保存、文件库打开和做题流程通过正向、失败及恢复测试。
- learner runtime 请求继续为 0，admin/teacher 白名单行为未回退。
- 前端、后端、发布候选和 UAT 线上验证全部通过。
