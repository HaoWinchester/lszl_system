# WeChat Mini Program Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native WeChat mini-program shell with secure WeChat sign-in, existing-account binding, and authenticated access to the existing FastAPI API.

**Architecture:** Keep browser cookie authentication unchanged and add an opaque Bearer-token transport for the mini program. Exchange `wx.login` codes only on the backend, persist hashed one-time binding tickets and hashed mini sessions in PostgreSQL, then let the native mini program store only the issued session token.

**Tech Stack:** FastAPI, SQLAlchemy async, Alembic, PostgreSQL JSONB, httpx, native WeChat WXML/WXSS/TypeScript, Node.js contract tests.

## Global Constraints

- The mini program lives in independent `miniprogram/`; do not place it in `new-legacy/` or the active release.
- Use native WXML/WXSS/TypeScript; no React, Vue, Taro, uni-app, WebView, or third-party UI library.
- Never place `WECHAT_MINI_APP_SECRET`, database credentials, or production tokens in mini-program files.
- Preserve the existing website QR-login flow and signed-cookie behavior.
- Use a warm off-white and dark-green visual system, no gradients or glow, 11–15px radii, and touch targets at least 48px high.
- Bind only active existing accounts after username/password verification; new-account creation requires the current legal-consent version.
- Store only hashes of binding tickets and Bearer tokens in PostgreSQL.

---

## File Structure

- `backend/app/models/wechat_mini.py`: binding-ticket and mini-session persistence.
- `backend/app/services/wechat_mini_service.py`: WeChat code exchange, ticket lifecycle, account binding, session issuance and revocation.
- `backend/app/schemas/wechat_mini.py`: request/response contracts.
- `backend/app/api/v1/wechat_mini_auth.py`: mini-program authentication routes only.
- `backend/app/core/auth.py`: shared Cookie-or-Bearer user resolution.
- `miniprogram/services/`: API, session storage, and login orchestration.
- `miniprogram/pages/login/`, `miniprogram/pages/home/`: first usable native screens.
- `miniprogram/styles/`: shared tokens and native component primitives.

### Task 1: Persist one-time binding tickets and mini sessions

**Files:**
- Create: `backend/app/models/wechat_mini.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/alembic/versions/f4c8b6d9e120_add_wechat_mini_auth.py`
- Test: `backend/tests/test_wechat_mini_models.py`

**Interfaces:**
- Produces: `WechatMiniAuthTicket`, `WechatMiniSession`; both use UUID text ids and UTC timestamps.
- Produces: unique `token_digest`, unique `ticket_digest`, and indexed `username` foreign keys to `users.username`.

- [x] **Step 1: Write the failing model test**

```python
from app.models.wechat_mini import WechatMiniAuthTicket, WechatMiniSession

def test_wechat_mini_auth_tables_are_registered():
    assert WechatMiniAuthTicket.__table__.name == "wechat_mini_auth_tickets"
    assert WechatMiniSession.__table__.name == "wechat_mini_sessions"
    assert WechatMiniSession.__table__.c.token_digest.unique is True
```

- [x] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_wechat_mini_models.py -q`
Expected: FAIL with `ModuleNotFoundError: app.models.wechat_mini`.

- [x] **Step 3: Implement the two models and migration**

```python
class WechatMiniSession(Base):
    __tablename__ = "wechat_mini_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    token_digest: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    username: Mapped[str] = mapped_column(ForeignKey("users.username", ondelete="CASCADE"), index=True)
    login_session_id: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    client_metadata: Mapped[dict] = mapped_column(JSONB, default=dict)
```

Create the analogous ticket model with `ticket_digest`, `openid`, nullable `unionid`, `created_at`, `expires_at`, and `consumed_at`. Import both in `models/__init__.py`; migration revision is `f4c8b6d9e120`, down revision is `e7b4c2d8a910`.

- [x] **Step 4: Run migration and model tests**

Run: `cd backend && .venv/bin/alembic upgrade head && .venv/bin/python -m pytest tests/test_wechat_mini_models.py -q`
Expected: PASS and Alembic reaches `f4c8b6d9e120`.

- [x] **Step 5: Commit**

```bash
git add backend/app/models backend/alembic/versions backend/tests/test_wechat_mini_models.py
git commit -m "feat: persist WeChat mini sessions"
```

### Task 2: Implement WeChat code exchange and session lifecycle

**Files:**
- Modify: `backend/app/core/config.py`
- Create: `backend/app/schemas/wechat_mini.py`
- Create: `backend/app/services/wechat_mini_service.py`
- Test: `backend/tests/test_wechat_mini_service.py`

**Interfaces:**
- Consumes: `WechatMiniAuthTicket`, `WechatMiniSession`.
- Produces: `exchange_login_code(db, code, client_meta) -> MiniLoginOutcome`.
- Produces: `bind_existing_account(db, ticket, username, password, client_meta) -> IssuedMiniSession`.
- Produces: `resolve_session_token(db, raw_token) -> User | None` and `revoke_session_token(db, raw_token) -> bool`.

- [x] **Step 1: Write failing service tests**

```python
async def test_hash_token_never_returns_plaintext():
    assert hash_secret("visible-token") != "visible-token"
    assert len(hash_secret("visible-token")) == 64

async def test_consumed_binding_ticket_cannot_be_reused(db, monkeypatch):
    ticket = await issue_binding_ticket(db, "openid-1", None, {})
    first = await bind_existing_account(db, ticket.raw, "学生", "test1234", {})
    assert first.token
    with pytest.raises(MiniAuthError, match="绑定凭证已失效"):
        await bind_existing_account(db, ticket.raw, "学生", "test1234", {})
```

- [x] **Step 2: Run the tests to verify failure**

Run: `cd backend && .venv/bin/python -m pytest tests/test_wechat_mini_service.py -q`
Expected: FAIL because the service does not exist.

- [x] **Step 3: Implement exact configuration and lifecycle**

```python
WECHAT_MINI_APP_ID: str = ""
WECHAT_MINI_APP_SECRET: str = ""
WECHAT_MINI_ENABLE_DEMO: bool | None = None
WECHAT_MINI_SESSION_MAX_AGE_SECONDS: int = 60 * 60 * 24 * 30
WECHAT_MINI_BINDING_TICKET_MAX_AGE_SECONDS: int = 10 * 60
```

Use `https://api.weixin.qq.com/sns/jscode2session` with `httpx.AsyncClient`, reject WeChat `errcode`, hash secrets with SHA-256, compare password via the existing user service/security helper, mark tickets consumed in the same transaction that creates a refreshed session row, and return raw secrets only once. Implement account registration through the existing user creation rules, require the active legal-consent version, then bind the ticket's WeChat identity to the new user in the same transaction.

- [x] **Step 4: Run service tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_wechat_mini_service.py -q`
Expected: PASS for exchange, linked login, binding, expiry, reuse, invalid password, revoke, and inactive-user cases.

- [x] **Step 5: Commit**

```bash
git add backend/app/core/config.py backend/app/schemas/wechat_mini.py backend/app/services/wechat_mini_service.py backend/tests/test_wechat_mini_service.py
git commit -m "feat: add WeChat mini authentication service"
```

### Task 3: Expose mini authentication and shared Bearer resolution

**Files:**
- Create: `backend/app/api/v1/wechat_mini_auth.py`
- Modify: `backend/app/api/v1/router.py`
- Modify: `backend/app/core/auth.py`
- Test: `backend/tests/test_wechat_mini_auth_api.py`

**Interfaces:**
- Produces: `POST /api/v1/auth/mini/wechat/login`, `/bind`, `/register`, `/logout` and `GET /api/v1/auth/mini/session`.
- Produces: `request.state.auth_transport` equal to `"bearer"` or `"cookie"` after authentication.
- Preserves: `CurrentUser = Annotated[User, Depends(get_current_user)]` for all existing routes.

- [ ] **Step 1: Write failing API tests**

```python
def test_bearer_token_accesses_existing_current_user_route(client, issued_token):
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {issued_token}"},
    )
    assert response.status_code == 200
    assert response.json()["username"] == "学生"

def test_malformed_bearer_does_not_fall_back_to_cookie(client):
    login(client, "学生")
    response = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer bad"})
    assert response.status_code == 401
```

- [ ] **Step 2: Run the API tests to verify failure**

Run: `cd backend && .venv/bin/python -m pytest tests/test_wechat_mini_auth_api.py -q`
Expected: FAIL because routes and Bearer resolution are absent.

- [ ] **Step 3: Add routes and transport-aware authentication**

```python
authorization = request.headers.get("authorization", "")
if authorization.lower().startswith("bearer "):
    request.state.auth_transport = "bearer"
    user = await wechat_mini_service.resolve_session_token(db, authorization[7:].strip())
    if not user:
        raise HTTPException(status_code=401, detail="小程序会话已失效，请重新登录")
    return user
request.state.auth_transport = "cookie"
```

Map service errors to stable payloads shaped as `{"detail":{"code": str, "message": str}}`; do not expose `openid`, `session_key`, hashes, or secrets in responses or logs.

- [ ] **Step 4: Run auth regressions**

Run: `cd backend && .venv/bin/python -m pytest tests/test_wechat_mini_auth_api.py tests/test_wechat_auth.py tests/test_auth_self_profile.py tests/test_auth_legal_consent.py -q`
Expected: PASS for new Bearer flow and unchanged browser flows.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/v1/wechat_mini_auth.py backend/app/api/v1/router.py backend/app/core/auth.py backend/tests/test_wechat_mini_auth_api.py
git commit -m "feat: expose WeChat mini authentication API"
```

### Task 4: Build the native mini-program shell and login screens

**Files:**
- Modify: `.gitignore`
- Create: `miniprogram/project.config.json`
- Create: `miniprogram/app.json`
- Create: `miniprogram/app.ts`
- Create: `miniprogram/app.wxss`
- Create: `miniprogram/sitemap.json`
- Create: `miniprogram/styles/tokens.wxss`
- Create: `miniprogram/config/index.ts`
- Create: `miniprogram/services/http.ts`
- Create: `miniprogram/services/session.ts`
- Create: `miniprogram/services/auth.ts`
- Create: `miniprogram/pages/login/index.{json,wxml,wxss,ts}`
- Create: `miniprogram/pages/home/index.{json,wxml,wxss,ts}`
- Create: `miniprogram/tests/foundation-contract.test.mjs`

**Interfaces:**
- Produces: `request<T>(options)`, `getSessionToken()`, `setSessionToken(token)`, `loginWithWechat()`, `bindExistingAccount(credentials)`.
- Consumes: Task 3 routes and stable error payloads.

- [ ] **Step 1: Write the failing static contract test**

```javascript
test('mini program keeps secrets server-side and declares login/home', () => {
  const app = JSON.parse(read('app.json'));
  assert.deepEqual(app.pages.slice(0, 2), ['pages/home/index', 'pages/login/index']);
  assert.doesNotMatch(allSource(), /WECHAT_MINI_APP_SECRET|session_key/);
  assert.match(read('services/http.ts'), /Authorization.*Bearer/);
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `node --test miniprogram/tests/foundation-contract.test.mjs`
Expected: FAIL because `miniprogram/app.json` does not exist.

- [ ] **Step 3: Implement the shell and authentication state machine**

```typescript
export type AuthState =
  | { status: 'anonymous' }
  | { status: 'binding'; bindingTicket: string }
  | { status: 'authenticated'; token: string };

export async function loginWithWechat(): Promise<AuthState> {
  const { code } = await wx.login();
  const result = await request<MiniLoginResponse>({
    path: '/api/v1/auth/mini/wechat/login', method: 'POST', data: { code }, auth: false,
  });
  if (result.status === 'authenticated') setSessionToken(result.token);
  return result;
}
```

Home must show a compact greeting, continue-practice area, mode entry row, and bottom tab bar; login must offer WeChat login first and existing-account binding only after a binding ticket exists. Use `touristappid` in committed project config and ignore `miniprogram/project.private.config.json`.

- [ ] **Step 4: Run contracts and inspect in WeChat Developer Tools**

Run: `node --test miniprogram/tests/foundation-contract.test.mjs`
Expected: PASS. Manual: import `miniprogram/`, compile without WXML/WXSS errors, verify 390×844 layout and 48px minimum controls.

- [ ] **Step 5: Commit**

```bash
git add .gitignore miniprogram
git commit -m "feat: scaffold native WeChat mini program"
```

### Task 5: Foundation regression gate

**Files:**
- Modify: `docs/superpowers/specs/2026-09-04-wechat-practice-miniprogram-design.md`

**Interfaces:**
- Verifies: migration reversibility, browser-cookie compatibility, Bearer authentication, and native-shell static contracts.

- [ ] **Step 1: Run the focused backend suite**

Run: `cd backend && .venv/bin/python -m pytest tests/test_wechat_mini_models.py tests/test_wechat_mini_service.py tests/test_wechat_mini_auth_api.py tests/test_wechat_auth.py tests/test_auth_self_profile.py -q`
Expected: PASS.

- [ ] **Step 2: Verify migration downgrade/upgrade**

Run: `cd backend && .venv/bin/alembic downgrade e7b4c2d8a910 && .venv/bin/alembic upgrade head`
Expected: both commands succeed and head returns to `f4c8b6d9e120`.

- [ ] **Step 3: Run mini-program contracts**

Run: `node --test miniprogram/tests/*.test.mjs`
Expected: PASS.

- [ ] **Step 4: Record implementation status in the design spec**

Add a dated implementation-status note listing automated checks and the remaining real-AppID/device verification; do not describe unperformed device testing as passed.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-09-04-wechat-practice-miniprogram-design.md
git commit -m "docs: record mini program foundation verification"
```
