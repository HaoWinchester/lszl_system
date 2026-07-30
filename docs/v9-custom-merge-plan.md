# v9 + 定制合并：把 new-legacy 的 8 个定制移植到 v9

## Context（为什么做）

v9（updata-legacy）是上游**纯前端 localStorage 版**，没有合并用户在 new-legacy（v8.6.29）上做的"服务端化"定制。v9 接入后线上微信登录/账号登录坏（v9 的 wechat-login 走纯前端演示、不调后端 OAuth）。已回退线上到 v8.6.29（登录正常，v9 功能下线）。

用户要：**v9 新功能（试卷/课程/内容中心/教师工作台/跨账号共享）+ 保留全部 8 个定制**。本质是把 8 个定制 commit 的改动叠加到 v9 上游。

## 进度（2026-07-31 会话结束，下次接续）

- ✅ **Phase 1 (P0) 完成** — commit `d65acea`：微信登录服务端 OAuth 移植到 v9 sync 层（cp `new-legacy/src/32-wechat-login.js` 覆盖 v9 纯前端版 + `extractWechatLoginCss` 追加微信弹窗 CSS）。本地 `manage update --skip-browser` 构建 v9+Phase1 验证通过：index.html 微信扫码入口 `.wechat-login-entry` 渲染 + 点击调后端 `/api/v1/auth/wechat/auth-url`（服务端 OAuth 流程启动）+ 扫码/返回切换，0 JS 报错（本地无 appId → auth-url 返 400 属配置，生产正常）。
- ⏳ **Phase 2 (P1) 进行中** — admin 面板 + 埋点，下次接续。
- ⏸ **Phase 3 (P2) 待办** — UI 细节。
- **线上 = v8.6.29**（登录正常，v9 未部署）；**本地 release current = v9+Phase1**（未部署，供后续测试）。8020 测试后端已停。

### Phase 2/3 的 v9 适配难点（探查所得，下次直接用，免重复调研）

- **admin 面板（1305e16）**：v9 `36-system-settings.js` 的 setTab 结构和 v8.6 不同（`grep "function setTab"` 无匹配），要重新定位 tab 切换注入点（v9 用 `data-ss-tab` + `ss-pane`，可能 inline 处理）。HTML 标签按钮 + 面板 DOM 可段注入；CSS `.ss-analytics` 段 24 行（new-legacy `system-settings.css`）可直接追加。
- **埋点（cd38328）⚠️ 最大工作量**：v9 的 64/65/27/86/88 **重构了**，v8.6 的 `KGFeatureAnalytics.track` 锚点在 v9 **全 0**（不存在）。不能直接移植，**必须在 v9 新函数里重新定位"成功操作"点加 track**。v8.6 原埋点：`track('training','key_action','answer_submitted')` 等（5 个 JS，每个 2-6 行）。
- **33-user-center.js（fe45237）⚠️ 高风险**：v9(665行) vs new-legacy(699行)，必须 **3-way 手动合并**（不能整 cp，会丢 v9 改动）。v9 无 `membership-ui.css` / `assets/membership-ui/`，需 cp 新文件 + 所有 HTML 加 `<link>`。

## 8 个定制（ef5ce30 基线之后）

| commit | 定制 | 移植载体 |
|---|---|---|
| `fe546e2`/`8930f50`/`7e6dbfd` | 微信登录服务端 OAuth + 弹窗 QR + 精简 | 整文件覆盖 + CSS 追加 |
| `8a512b6` | 认证 + 响应式 UI 抛光 | CSS 追加 |
| `dee961b` | 控件居中 + 账号菜单统一 | CSS 追加 + HTML |
| `fe45237` | 会员中心 / 用户中心 UI | 新文件 cp + JS 合并 |
| `cd38328` | feature analytics 埋点 | sync 补丁（多 JS） |
| `1305e16` | admin 功能偏好面板 | system-settings HTML/JS/CSS |

## 已验证的关键事实

- ✅ 后端 OAuth API 全在（`auth.py` 的 `/wechat/config|auth-url|callback|binding|demo-login`）
- ✅ v9 `KGAuthCore` 有 `escapeHTML`/`refreshSession`，`KGAppStorage` 在 → new-legacy 的 wechat-login 依赖兼容
- ✅ v9 `authModal` DOM 与 new-legacy **完全一致**（`.auth-actions` 在）→ wechat-login.js 整文件覆盖安全
- ✅ analytics 后端齐全（`/feature-events`、`/feature-analytics` 聚合、`FeatureUsageEvent` 模型）
- ⚠️ `33-user-center.js` v9(665行) vs new-legacy(699行) 差 34 行 → 需手动合并（非整文件 cp）
- ⚠️ v9 无 `membership-ui.css`/`assets/membership-ui/` → 新文件 cp + HTML 加 link

## 策略：增量移植，三阶段，**全部完成再上线**（中间保持 v8.6.29）

移植机制：定制写进 **sync 层**（`sync-new-legacy.js` 的 patch 函数 + 文件 cp），updata-legacy 保持上游原版。这样定制随 sync 进库，上游更新后 sync 仍应用（断点再修）。

每阶段：sync 构建 + UI agent 复测 + commit，**不部署**（线上保持 v8.6.29）。三阶段全部完成、UI agent 全测通过后，才 `manage update` + `deploy/update.sh` 一次上线 v9 + 全部定制。

### Phase 1（P0）—— 微信登录 + 账号登录（让 v9 登录 work，最优先）

1. `sync-new-legacy.js` 加 `cpCustomFile`：sync 时把 `new-legacy/src/32-wechat-login.js` 覆盖到 site（替代 v9 纯前端版）。
2. CSS 追加：`new-legacy/styles/main.css` 的微信登录样式段（`.wechat-login-section/card/qr/back`、`#authModal.wechat-login-mode`）追加到 site main.css 末尾。
3. `33-user-center.js` 的微信绑定/解绑逻辑（fe546e2 +36 行）—— 与 Phase 3 的 user-center 合并一起做。
4. 验证：UI agent 跑"登录页打开 → 微信扫码入口 → 弹窗 QR 渲染"（DOM 兼容已确认，重点测无 JS 报错）。
5. `manage update` + 部署 → v9 上线（含 P0 + v9 功能 + 跨账号共享）。

### Phase 2（P1）—— feature analytics + admin 面板（后端已就绪，纯前端移植）

1. `system-settings.html`：加 `data-ss-tab="analytics"` 标签按钮 + 分析面板 DOM（从 new-legacy 移植）。
2. `src/36-system-settings.js`：加 `ANALYTICS_FEATURE_LABELS`/`loadFeatureAnalytics`/`renderFeatureAnalytics`（从 new-legacy 移植，~71 行）。
3. `styles/system-settings.css`：追加 `.ss-analytics-*` 样式（~130 行）。
4. `cd38328` 埋点：5 个核心 JS（27/64/65/86/88）的成功操作埋点 —— 用 sync 补丁逐个加 `KGFeatureAnalytics.track(...)`。
5. 验证：UI agent 测管理员"系统设置 → 功能分析"面板加载 + 数据渲染。

### Phase 3（P2）—— UI 细节（会员中心 / 账号菜单 / 响应式）

1. `membership-ui.css` + `assets/membership-ui/icons/`：sync cp 新文件 + 所有 HTML 加 `<link>`。
2. `33-user-center.js`：**手动 3-way 合并**（v9 的 665 行 + new-legacy 的会员中心/微信绑定 34 行差异）—— 这是唯一不能整文件 cp 的，要逐函数合并，保留 v9 改动 + 叠加定制。
3. `account-menu.css` + HTML：账号菜单居中 + 移动端"账号"标签。
4. `main.css`/`global-shortcuts.css` 等：响应式抛光、快捷栏折叠（CSS 追加）。
5. 验证：UI agent 测会员中心弹窗、账号菜单、移动端响应式、用户中心微信绑定。

## 关键文件

- 移植载体：`frontend/scripts/sync-new-legacy.js`（加 `cpCustomFile` + patch 函数）
- 定制源（进库，权威）：`new-legacy/src/32-wechat-login.js`、`new-legacy/styles/*`、`new-legacy/src/33-user-center.js`、`new-legacy/src/36-system-settings.js`、`new-legacy/system-settings.html`
- 上游源（保持原版）：`updata-legacy/`

## 验证

**每阶段（不部署）**：
1. sync 构建到 /tmp，确认定制文件覆盖/追加成功、无 `[MISS]`。
2. UI agent 走查该阶段功能（登录 / analytics 面板 / 会员中心 UI）+ 截图 + JS 报错检查。
3. 每阶段一个 commit。

**三阶段全部完成后（上线）**：
4. `./manage-new-legacy update updata-legacy`（完整验收：pytest + 契约 + smoke + visual）。
5. `./deploy/update.sh` 部署，线上验证（登录 / v9 新功能 / 会员中心 / analytics）。

## 风险与回退

- `33-user-center.js` 手动合并（P2）是最高风险点——逐函数小心合并，UI agent 充分测。
- 每阶段独立 commit + 可独立上线；任一阶段出问题 `./manage-new-legacy rollback` 回 v8.6.29 或上一阶段。
- updata-legacy 保持原版（gitignored），定制全在 sync/new-legacy（进库）——上游更新后重新跑 sync 即可发现断点。
