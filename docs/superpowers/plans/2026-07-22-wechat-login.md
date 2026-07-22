# 微信网站登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已审核的网站应用以服务端 OAuth 回调完成微信扫码登录、首次自动创建学员账号，并允许已有账号绑定或解绑微信。

**Architecture:** 浏览器只向后端索取授权地址；微信把 code 回调到 FastAPI；后端从 session 读取一次性 state 和意图，交换身份、创建或绑定用户、写入 `kg_session` 后跳回原页面。AppSecret 仅由容器环境变量提供，浏览器只收到非敏感配置与绑定摘要。

**Tech Stack:** FastAPI、SQLAlchemy async、Starlette SessionMiddleware、httpx、PostgreSQL JSONB、原版 new-legacy JavaScript、Node test runner。

---

## 文件责任

| 文件 | 责任 |
| --- | --- |
| `backend/app/core/config.py` | 读取后端专用微信环境变量。 |
| `backend/app/services/system_service.py` | 合并 DB 非敏感配置与部署凭证，并返回安全配置。 |
| `backend/app/services/wechat_service.py` | 授权 URL、查找、创建、绑定、解绑微信身份。 |
| `backend/app/api/v1/auth.py` | 授权发起、微信回调、解绑和演示登录 HTTP 接口。 |
| `backend/app/services/user_service.py` | 对浏览器返回不含 openid/unionid 的绑定摘要。 |
| `new-legacy/src/32-wechat-login.js` | 现有登录弹窗的正式扫码、演示登录与回跳提示。 |
| `new-legacy/src/33-user-center.js` | 用户中心的绑定和解绑控件。 |
| `new-legacy/src/36-system-settings.js` | 移除浏览器侧密钥/换码接口配置。 |
| `backend/tests/test_wechat_auth.py` | OAuth、绑定、安全和失败路径回归测试。 |
| `frontend/scripts/wechat-login-contract.test.mjs` | 前端源码和发布包的登录契约测试。 |

### Task 1: 以测试定义凭证不出服务器的边界

**Files:**

- Create: `backend/tests/test_wechat_auth.py`
- Modify: `backend/tests/test_system_settings.py`
- Modify: `backend/app/core/config.py`
- Modify: `backend/app/core/permissions.py`
- Modify: `backend/app/services/system_service.py`
- Modify: `backend/app/api/v1/system.py`
- Modify: `backend/app/services/user_service.py`
- Modify: `backend/.env.example`
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: 写失败测试**

```python
def test_admin_wechat_config_never_returns_secret() -> None:
    with TestClient(app) as client:
        login_admin(client)
        saved = client.put(
            "/api/v1/system/wechat-config",
            json={"appId": "wx_test_app", "appSecret": "browser-must-not-see-this"},
        )
        assert saved.status_code == 200
        payload = client.get("/api/v1/system/wechat-config").json()["config"]

    assert payload["appId"] == "wx_test_app"
    assert "appSecret" not in payload
    assert "browser-must-not-see-this" not in str(payload)


def test_current_user_hides_wechat_identifiers() -> None:
    with TestClient(app) as client:
        login_admin(client)
        user = client.get("/api/v1/auth/me").json()["user"]

    assert user["wechat"] is None or "openid" not in user["wechat"]
    assert user["wechat"] is None or "unionid" not in user["wechat"]
```

- [ ] **Step 2: 确认测试因现状失败**

Run: `cd backend && .venv/bin/python -m pytest tests/test_wechat_auth.py tests/test_system_settings.py -q`

Expected: FAIL；当前系统设置会回传 `appSecret`，用户序列化直接返回原始微信 JSONB。

- [ ] **Step 3: 添加仅后端可读的环境配置**

在 `Settings` 中加入以下字段；在 `.env.example` 只写空值或公开回调 URL；在 `docker-compose.prod.yml` 逐项将同名环境变量传给 `backend` 容器。

```python
WECHAT_APP_ID: str = ""
WECHAT_APP_SECRET: str = ""
WECHAT_REDIRECT_URI: str = "https://lszl.aihuanpu.com/api/v1/auth/wechat/callback"
WECHAT_ENABLE_OFFICIAL: bool | None = None
WECHAT_ENABLE_DEMO: bool | None = None
```

- [ ] **Step 4: 实现安全配置和用户摘要**

```python
def public_wechat_config(config: dict) -> dict:
    allowed = (
        "enableDemo", "enableOfficial", "autoCreateUser", "appId",
        "redirectUri", "scope", "defaultRole", "defaultSubject",
    )
    return {key: config[key] for key in allowed if key in config}


def wechat_summary(wechat: dict | None) -> dict | None:
    if not wechat or not wechat.get("openid"):
        return None
    return {
        "bound": True,
        "nickname": str(wechat.get("nickname") or "微信用户"),
        "avatar": str(wechat.get("avatar") or ""),
        "boundAt": wechat.get("boundAt"),
        "lastLoginAt": wechat.get("lastLoginAt"),
    }
```

让 `get_wechat_config` 以非空 `WECHAT_APP_ID`、`WECHAT_APP_SECRET` 和 `WECHAT_REDIRECT_URI` 覆盖 DB 配置；布尔覆盖只在非 `None` 时生效。让系统设置的 GET/PUT 仅接受并返回 `public_wechat_config`，让 `user_service.to_dict` 使用 `wechat_summary`。

- [ ] **Step 5: 验证并提交**

Run: `cd backend && .venv/bin/python -m pytest tests/test_wechat_auth.py tests/test_system_settings.py -q`

Expected: PASS；所有浏览器响应都不包含 AppSecret、openid 或 unionid。

```bash
git add backend/tests/test_wechat_auth.py backend/tests/test_system_settings.py backend/app/core/config.py backend/app/core/permissions.py backend/app/services/system_service.py backend/app/api/v1/system.py backend/app/services/user_service.py backend/.env.example docker-compose.prod.yml
git commit -m "feat: keep wechat credentials server-side"
```

### Task 2: 以服务测试实现微信查找、绑定与解绑

**Files:**

- Modify: `backend/tests/test_wechat_auth.py`
- Modify: `backend/app/services/wechat_service.py`

- [ ] **Step 1: 写失败测试**

```python
async def test_bind_rejects_identity_owned_by_another_user(db_session):
    owner = await create_active_user(db_session, "wx_owner")
    target = await create_active_user(db_session, "wx_target")
    await wechat_service.bind_user(
        db_session, owner, {"openid": "openid-owner", "nickname": "甲"}, "wechat-bind"
    )

    with pytest.raises(ValueError, match="已绑定其他账号"):
        await wechat_service.bind_user(
            db_session, target, {"openid": "openid-owner", "nickname": "乙"}, "wechat-bind"
        )


async def test_unbind_preserves_the_user(db_session):
    user = await create_active_user(db_session, "wx_unbind")
    await wechat_service.bind_user(db_session, user, {"openid": "openid-unbind"}, "wechat-bind")
    updated = await wechat_service.unbind_user(db_session, user)

    assert updated.username == "wx_unbind"
    assert updated.wechat is None
```

测试文件用 `AsyncSessionLocal()` 建立 session，并在 `finally` 中删除本测试创建的用户名。

- [ ] **Step 2: 确认缺少服务方法**

Run: `cd backend && .venv/bin/python -m pytest tests/test_wechat_auth.py -q`

Expected: FAIL；`bind_user` 和 `unbind_user` 未定义。

- [ ] **Step 3: 以最小服务实现通过测试**

```python
async def find_by_wechat_identity(db: AsyncSession, openid: str, unionid: str = "") -> User | None:
    conditions = [User.wechat["openid"].astext == openid]
    if unionid:
        conditions.append(User.wechat["unionid"].astext == unionid)
    return (await db.execute(select(User).where(or_(*conditions)))).scalar_one_or_none()


async def bind_user(db: AsyncSession, user: User, profile: dict, source: str) -> User:
    openid = str(profile.get("openid") or "")
    if not openid:
        raise ValueError("微信绑定失败：缺少 openid")
    owner = await find_by_wechat_identity(db, openid, str(profile.get("unionid") or ""))
    if owner and owner.username != user.username:
        raise ValueError("该微信已绑定其他账号，不能重复绑定")
    user.wechat = _wechat_payload(profile, user.wechat, source)
    await db.commit()
    await db.refresh(user)
    return user


async def unbind_user(db: AsyncSession, user: User) -> User:
    user.wechat = None
    await db.commit()
    await db.refresh(user)
    return user
```

抽取 `_wechat_payload`，供绑定和 `find_or_create_user` 共用；未登录扫码仍以原规则自动创建 `student`，暂停/归档账号仍抛出 `PermissionError`。

- [ ] **Step 4: 验证并提交**

Run: `cd backend && .venv/bin/python -m pytest tests/test_wechat_auth.py -q`

Expected: PASS；冲突绑定不覆盖其他账号，解绑不删除用户。

```bash
git add backend/app/services/wechat_service.py backend/tests/test_wechat_auth.py
git commit -m "feat: add wechat account binding service"
```

### Task 3: 以 HTTP 测试实现单次 OAuth 回调

**Files:**

- Modify: `backend/tests/test_wechat_auth.py`
- Modify: `backend/app/api/v1/auth.py`
- Modify: `backend/app/schemas/auth.py`

- [ ] **Step 1: 写授权创建、重放与绑定失败测试**

```python
def test_callback_creates_student_sets_session_and_redirects(monkeypatch) -> None:
    async def exchange(_cfg, _code):
        return {"access_token": "token", "openid": "openid-new", "unionid": "unionid-new"}

    async def userinfo(_cfg, _token, _openid):
        return {"nickname": "扫码新用户", "avatar": "", "unionid": "unionid-new"}

    monkeypatch.setattr(wechat_service, "exchange_code", exchange)
    monkeypatch.setattr(wechat_service, "fetch_userinfo", userinfo)
    configure_official_wechat_for_test(monkeypatch)
    with TestClient(app) as client:
        state = client.get(
            "/api/v1/auth/wechat/auth-url",
            params={"intent": "login", "return_path": "/training"},
        ).json()["state"]
        callback = client.get(
            "/api/v1/auth/wechat/callback",
            params={"code": "one-time-code", "state": state},
            follow_redirects=False,
        )
        current = client.get("/api/v1/auth/me")

    assert callback.status_code == 303
    assert callback.headers["location"].startswith("/training?wechat=login-success")
    assert current.json()["user"]["role"] == "student"


def test_callback_consumes_state_and_rejects_replay(monkeypatch) -> None:
    configure_official_wechat_for_test(monkeypatch)
    with TestClient(app) as client:
        state = client.get("/api/v1/auth/wechat/auth-url").json()["state"]
        client.get("/api/v1/auth/wechat/callback", params={"code": "x", "state": state})
        replay = client.get(
            "/api/v1/auth/wechat/callback",
            params={"code": "x", "state": state},
            follow_redirects=False,
        )

    assert replay.headers["location"].startswith("/?wechat=state-invalid")
```

增加三项：未登录 `intent=bind` 返回 401；已登录用户绑定成功；绑定到他人账号跳回原页并返回 `bind-failed`。再测试 `return_path=https://evil.example` 只跳回 `/`。

- [ ] **Step 2: 确认路由测试失败**

Run: `cd backend && .venv/bin/python -m pytest tests/test_wechat_auth.py -q`

Expected: FAIL；没有 callback 路由，也没有 `intent` 保存和解绑端点。

- [ ] **Step 3: 实现授权事务**

```python
def safe_return_path(value: str | None) -> str:
    path = str(value or "/")
    parsed = urlsplit(path)
    if not path.startswith("/") or path.startswith("//") or parsed.scheme or parsed.netloc:
        return "/"
    return path


@router.get("/wechat/auth-url")
async def wechat_auth_url(
    request: Request,
    db: DB,
    intent: Literal["login", "bind"] = "login",
    return_path: str = "/",
):
    cfg = await system_service.get_wechat_config(db)
    if wechat_service.compute_mode(cfg) != "official":
        raise HTTPException(status_code=400, detail="未配置正式微信登录")
    username = request.session.get("username")
    if intent == "bind" and not username:
        raise HTTPException(status_code=401, detail="请先登录后再绑定微信")
    auth_url, state = wechat_service.build_auth_url(cfg)
    request.session["wechat_oauth"] = {
        "state": state,
        "intent": intent,
        "returnPath": safe_return_path(return_path),
        "username": username or "",
    }
    return {"authUrl": auth_url, "state": state}
```

新增 `GET /wechat/callback`：先 `pop("wechat_oauth", None)`，再验证 state；调用 `exchange_code`、`fetch_userinfo`；login 用 `find_or_create_user` 并写入 session，bind 用 `bind_user` 并确认 session username 未变。回跳使用 303 和固定结果码 `login-success`、`login-failed`、`bind-success`、`bind-failed`、`state-invalid`、`provider-failed`，不把微信错误或 token 放进 URL。

增加解绑端点：

```python
@router.delete("/wechat/binding")
async def unbind_wechat(request: Request, user: CurrentUser, db: DB):
    updated = await wechat_service.unbind_user(db, user)
    ip, ua = _client_info(request)
    await user_service.log_action(db, "wechat_unbind", updated.username, updated.username, "解除微信绑定", ip, ua)
    await db.commit()
    return {"user": user_service.to_dict(updated)}
```

删除不再被新前端调用的 `WechatLoginRequest` 与 `POST /wechat/login`，保留 `POST /wechat/demo-login` 以正常后端 session 登录。

- [ ] **Step 4: 验证并提交**

Run: `cd backend && .venv/bin/python -m pytest tests/test_wechat_auth.py tests/test_smoke.py tests/test_web_runtime.py -q`

Expected: PASS；state 只能使用一次，登录、绑定和解绑全部由服务端 session 与数据库驱动。

```bash
git add backend/app/api/v1/auth.py backend/app/schemas/auth.py backend/tests/test_wechat_auth.py
git commit -m "feat: complete wechat oauth callback flow"
```

### Task 4: 以契约测试重接原版登录弹窗和账号中心

**Files:**

- Create: `frontend/scripts/wechat-login-contract.test.mjs`
- Modify: `new-legacy/src/32-wechat-login.js`
- Modify: `new-legacy/src/33-user-center.js`
- Modify: `new-legacy/src/36-system-settings.js`

- [ ] **Step 1: 写失败契约测试**

```javascript
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const login = readFileSync(new URL('../../new-legacy/src/32-wechat-login.js', import.meta.url), 'utf8')
const center = readFileSync(new URL('../../new-legacy/src/33-user-center.js', import.meta.url), 'utf8')

test('formal and demo login call FastAPI rather than local OAuth state', () => {
  assert.match(login, /\/api\/v1\/auth\/wechat\/auth-url/)
  assert.match(login, /\/api\/v1\/auth\/wechat\/demo-login/)
  assert.doesNotMatch(login, /backendExchangeUrl/)
  assert.doesNotMatch(login, /kg_wechat_login_pending_v1/)
})

test('user center has actual wechat binding operations', () => {
  assert.match(center, /绑定微信/)
  assert.match(center, /解绑微信/)
  assert.match(center, /\/api\/v1\/auth\/wechat\/binding/)
})
```

- [ ] **Step 2: 确认契约测试失败**

Run: `cd frontend && pnpm exec node --test scripts/wechat-login-contract.test.mjs`

Expected: FAIL；当前源码有 `backendExchangeUrl`、localStorage OAuth state，且账号中心没有绑定操作。

- [ ] **Step 3: 修改微信登录模块，保留原 className 和界面**

在 `32-wechat-login.js` 删除本地用户创建、`WECHAT_PENDING_KEY`、`buildOfficialAuthUrl` 和 `handleOfficialCallback`。用以下 helper 发起服务器动作：

```javascript
async function requestJson(path, options = {}) {
  const response = await fetch(path, { credentials: 'include', ...options })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(String(payload.detail || '微信服务暂不可用，请稍后重试。'))
  return payload
}

async function startOfficialLogin(intent = 'login') {
  const returnPath = location.pathname + location.search + location.hash
  const query = new URLSearchParams({ intent, return_path: returnPath })
  const payload = await requestJson('/api/v1/auth/wechat/auth-url?' + query)
  location.assign(payload.authUrl)
}

async function startDemoLogin() {
  await requestJson('/api/v1/auth/wechat/demo-login', { method: 'POST' })
  location.reload()
}
```

页面加载时读取 URL 中固定 `wechat` 结果码，显示对应反馈后用 `history.replaceState` 移除参数。正式按钮为“继续前往微信扫码”，演示按钮为“模拟扫码登录”；两者都不得写入 localStorage 用户或 OAuth state。

- [ ] **Step 4: 在用户中心加入真实绑定与解绑**

在个人资料 modal 的现有 `kg-user-center-section` 内插入：

```html
<section class="kg-user-center-section kg-user-wechat-binding">
  <div class="kg-user-center-section-title"><strong>微信登录</strong><span id="userWechatBindingState"></span></div>
  <p id="userWechatBindingCopy"></p>
  <div class="kg-user-center-actions">
    <button type="button" class="primary" id="userBindWechatBtn">绑定微信</button>
    <button type="button" id="userUnbindWechatBtn">解绑微信</button>
  </div>
</section>
```

当 `currentUser().wechat?.bound` 为真时显示昵称和“已绑定”、隐藏绑定按钮；否则显示“尚未绑定”、隐藏解绑按钮。绑定按钮调用 `KGWechatLogin.startOfficialLogin("bind")`。解绑按钮调用 `fetch("/api/v1/auth/wechat/binding", {method:"DELETE", credentials:"include"})`，成功后刷新远程 session 和 modal；冲突或网络错误显示具体提示并恢复可点击状态。

在 `36-system-settings.js` 删除“后端 code 换取用户接口”输入框及 `backendExchangeUrl` 保存字段，替换成只读说明：`redirect_uri 由服务器固定为 https://lszl.aihuanpu.com/api/v1/auth/wechat/callback，AppSecret 仅在服务器环境变量设置。`

- [ ] **Step 5: 验证并提交**

Run: `cd frontend && pnpm exec node --test scripts/wechat-login-contract.test.mjs`

Expected: PASS；浏览器不再保留旧 OAuth 流程，本地 UI 有可执行的绑定和解绑操作。

```bash
git add new-legacy/src/32-wechat-login.js new-legacy/src/33-user-center.js new-legacy/src/36-system-settings.js frontend/scripts/wechat-login-contract.test.mjs
git commit -m "feat: connect wechat login UI to server oauth"
```

### Task 5: 发布新前端版本并进行完整验证

**Files:**

- Modify (generated): `frontend/public/new-legacy/`
- Modify (generated): `frontend/new-legacy-releases/`
- Modify: `frontend/scripts/*.test.mjs`（只在发布契约需要同步时）

- [ ] **Step 1: 运行完整前端测试**

Run: `cd frontend && pnpm test`

Expected: PASS；新微信契约和现有发布、页面结构测试均通过。

- [ ] **Step 2: 从源目录生成新 release**

Run: `cd frontend && pnpm build`

Expected: PASS；脚本以 `new-legacy/` 为唯一源，生成 `frontend/public/new-legacy/` 并用既有流程创建/选择新版本。禁止手改 `frontend/new-legacy-releases/` 下的发布站点目录。

- [ ] **Step 3: 扫描生成包并运行全量后端测试**

Run: `rg -n "backendExchangeUrl|kg_wechat_login_pending_v1|appSecret" frontend/public/new-legacy frontend/new-legacy-releases`

Expected: 无浏览器运行时匹配旧 OAuth 逻辑或 AppSecret。

Run: `cd backend && .venv/bin/python -m pytest tests/ -q`

Expected: PASS。

- [ ] **Step 4: 运行页面冒烟和正反向人工验收**

Run: `cd new-legacy && python3 tests/browser-smoke.py`

Expected: PASS。

手动验收：

```text
未配置正式凭证：点击正式入口得到明确错误，页面仍可用。
演示模式：点击模拟扫码后刷新，页面显示同一后端演示账号；退出后回到访客态。
普通账号：账号中心点击绑定会跳转至后端授权地址；取消授权不会显示假成功。
已绑定账号：账号中心显示已绑定；点击解绑后刷新显示尚未绑定。
```

- [ ] **Step 5: 提交发布产物**

```bash
git add frontend/public/new-legacy frontend/new-legacy-releases frontend/new-legacy-manifest.json frontend/new-legacy-sync-report.json frontend/scripts
git commit -m "build: publish wechat login release"
```

### Task 6: 独立审查和交付检查

**Files:**

- Modify: `docs/superpowers/specs/2026-07-22-wechat-login-design.md`（仅在实现与确认设计不同且已补充说明时）

- [ ] **Step 1: 逐项核对规格**

核对服务端 callback、首次 student 创建、原账号绑定、冲突拒绝、解绑、无 Secret 浏览器暴露、演示登录、版本化发布、成功/失败/恢复测试；遗漏项必须先增加失败测试再修复。

- [ ] **Step 2: 执行最终命令**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q && cd ../frontend && pnpm test && pnpm build`

Expected: 三个阶段均 PASS，Git 不包含真实凭证、私钥或支付密钥。

- [ ] **Step 3: 发起独立代码审查**

审查范围为本计划实施开始前的 HEAD 与完成后的 HEAD。重点：一次性 state、开放重定向、绑定冲突、Secrets 输出、生成包一致性、登录和账号中心可点击行为、正反向测试覆盖。

- [ ] **Step 4: 处理审查发现**

Critical 和 Important 问题必须增加回归测试、修正实现、重新运行 Task 6 Step 2，再以 `git commit -m "fix: address wechat login review findings"` 提交。

## 自检

- 设计中的所有要求都有任务：callback 与自动创建（Task 3）、绑定和解绑（Tasks 2–4）、凭证边界（Task 1）、前端保真（Task 4）、测试与发布（Tasks 5–6）。
- 端点一致：`/auth/wechat/auth-url`、`/auth/wechat/callback`、`/auth/wechat/demo-login`、`DELETE /auth/wechat/binding`。
- 本计划不含真实 AppID、AppSecret、APIv3 密钥或商户私钥。
- Native 支付二维码、订单和回调明确不在本计划内。
