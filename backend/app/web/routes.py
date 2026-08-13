"""Stable aliases and direct new-legacy page/static routes."""

from __future__ import annotations

from urllib.parse import urlencode

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser, get_login_session_id
from app.core.permissions import can
from app.db.session import get_db
from app.web.bootstrap import build_bootstrap, optional_user
from app.web.html import html_response
from app.web.releases import (
    ReleaseNotFoundError,
    WebRelease,
    active_release,
    preview_release,
    resolve_asset,
)
from app.web.schemas import RuntimeStateUpdate
from app.services import runtime_state_service
from app.services import user_service

router = APIRouter(include_in_schema=False)
DB = Annotated[AsyncSession, Depends(get_db)]

ADMIN_ONLY_PAGES = frozenset({
    "admin-operations.html",
    "admin-settings.html",
    "feedback-management.html",
    "message-management.html",
    "system-settings.html",
    "user-management.html",
})
TEACHING_PAGES = frozenset({
    "admin-console.html",
    "admin-subjects.html",
    "content-center.html",
    "content-prep.html",
    "course-admin.html",
    "paper-management.html",
    "question-bank.html",
    "teacher-workbench.html",
})
CONTENT_PREP_PERMISSIONS = (
    "accessQuestionBank",
    "importData",
    "editQuestions",
)


async def _page_access_denied(request: Request, db: AsyncSession, page: str) -> bool:
    allowed_roles: set[str] | None = None
    if page in ADMIN_ONLY_PAGES:
        allowed_roles = {"admin"}
    elif page in TEACHING_PAGES:
        allowed_roles = {"admin", "teacher"}
    if allowed_roles is None:
        return False
    username = request.session.get("username")
    user = await user_service.get_by_username(db, str(username)) if username else None
    return not user or user.status != "active" or user.role not in allowed_roles


def _forbidden_page() -> HTMLResponse:
    return HTMLResponse(
        """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>无权访问</title>
<style>body{margin:0;display:grid;min-height:100vh;place-items:center;background:#f5f7fa;font-family:system-ui,-apple-system,'PingFang SC',sans-serif;color:#24324a}.card{width:min(520px,calc(100vw - 40px));box-sizing:border-box;padding:36px;border:1px solid #dfe5ec;border-radius:18px;background:#fff;box-shadow:0 18px 50px rgba(30,50,80,.08);text-align:center}h1{margin:0 0 12px;font-size:26px}p{margin:0 0 24px;color:#667085;line-height:1.7}a{display:inline-flex;min-height:42px;align-items:center;padding:0 20px;border-radius:10px;background:#0f766e;color:#fff;text-decoration:none;font-weight:700}</style></head>
<body><main class="card"><h1>无权访问</h1><p>当前账号没有访问此页面的权限，请返回学习首页或联系管理员。</p><a href="/practice-mode.html">返回学习首页</a></main></body></html>""",
        status_code=403,
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


def _release_or_503() -> WebRelease:
    try:
        return active_release()
    except ReleaseNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _asset_or_404(release: WebRelease, path: str):
    try:
        return resolve_asset(release, path)
    except ReleaseNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _static_headers(request: Request, release: WebRelease) -> dict[str, str]:
    cache_control = (
        "public, max-age=31536000, immutable"
        if request.query_params.get("v") == release.version
        else "no-cache"
    )
    return {"Cache-Control": cache_control, "X-Content-Type-Options": "nosniff"}


def _redirect(request: Request, page: str, defaults: dict[str, str] | None = None) -> RedirectResponse:
    params = dict(defaults or {})
    params.update(request.query_params)
    query = f"?{urlencode(params)}" if params else ""
    return RedirectResponse(f"/{page}{query}", status_code=307)


@router.get("/")
async def landing_page(request: Request):
    release = _release_or_503()
    try:
        path = resolve_asset(release, "landing.html")
    except ReleaseNotFoundError as exc:
        raise HTTPException(status_code=503, detail="当前版本缺少官网首页") from exc
    return FileResponse(path, headers=_static_headers(request, release))


@router.get("/learning-path.html")
async def learning_path_alias():
    return RedirectResponse("/practice-mode.html", status_code=307)


@router.get("/graph")
async def graph_alias(request: Request):
    return _redirect(request, "index.html", {"mode": "free"})


@router.get("/training")
async def training_alias(request: Request):
    return _redirect(request, "question-training.html")


@router.get("/workspace")
async def workspace_alias(request: Request):
    return _redirect(request, "question-workspace.html")


@router.get("/learning/node")
async def learning_node_alias(request: Request):
    return _redirect(request, "guided-learning-node.html")


@router.get("/learning/placement-test")
async def placement_test_alias(request: Request):
    return _redirect(request, "guided-learning-placement-test.html")


@router.get("/files")
async def files_alias(request: Request):
    return _redirect(request, "file-manager.html")


@router.get("/question-bank")
async def question_bank_alias(request: Request):
    return _redirect(request, "question-bank.html")


@router.get("/recall")
async def recall_alias(request: Request):
    return _redirect(request, "knowledge-recall.html")


@router.get("/users")
async def users_alias(request: Request):
    return _redirect(request, "user-management.html")


@router.get("/settings")
async def settings_alias(request: Request):
    return _redirect(request, "system-settings.html")


@router.get("/login")
async def login_alias(request: Request):
    params = {"auth": "login"}
    params.update({key: value for key, value in request.query_params.items() if key != "auth"})
    return RedirectResponse(
        f"/practice-mode.html?{urlencode(params)}",
        status_code=307,
    )


@router.get("/member")
async def member_alias(request: Request):
    return _redirect(request, "index.html", {"mode": "free", "member": "1"})


# v9 新增的管理/教学页面稳定别名；权限由各页面自身与后端 API 二次校验。
@router.get("/papers")
async def papers_alias(request: Request):
    return _redirect(request, "paper-management.html")


@router.get("/courses")
async def courses_alias(request: Request):
    return _redirect(request, "course-admin.html")


@router.get("/content")
async def content_alias(request: Request):
    return _redirect(request, "content-center.html")


@router.get("/content-prep")
async def content_prep_page(request: Request, db: DB):
    actor = await optional_user(request, db)
    if actor is None:
        query = urlencode({"next": "/content-prep"})
        return RedirectResponse(f"/login?{query}", status_code=307)
    if not all(can(actor.role, permission) for permission in CONTENT_PREP_PERMISSIONS):
        return _forbidden_page()
    release = _release_or_503()
    bootstrap = await build_bootstrap(
        request,
        db,
        page="content-prep.html",
        release_version=release.version,
    )
    return html_response(
        _asset_or_404(release, "content-prep-studio/dist/content-prep.html"),
        bootstrap,
    )


@router.get("/teacher")
async def teacher_alias(request: Request):
    return _redirect(request, "teacher-workbench.html")


@router.get("/admin")
async def admin_alias(request: Request):
    return _redirect(request, "admin-console.html")


@router.get("/__preview/{version}")
async def preview_root_redirect(version: str, request: Request):
    query = f"?{request.url.query}" if request.url.query else ""
    return RedirectResponse(f"/__preview/{version}/{query}", status_code=307)


@router.get("/__preview/{version}/")
async def preview_root(version: str, request: Request):
    try:
        release = preview_release(version)
    except ReleaseNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(
        _asset_or_404(release, "landing.html"),
        headers=_static_headers(request, release),
    )


@router.get("/__preview/{version}/{asset_path:path}")
async def preview_asset(version: str, asset_path: str, request: Request, db: DB) -> Response:
    try:
        release = preview_release(version)
    except ReleaseNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    path = _asset_or_404(release, asset_path)
    if path.name == "landing.html":
        return FileResponse(path, headers=_static_headers(request, release))
    if path.suffix.lower() == ".html":
        if await _page_access_denied(request, db, path.name):
            return _forbidden_page()
        bootstrap = await build_bootstrap(
            request, db, page=path.name, release_version=release.version, read_only=True
        )
        return html_response(path, bootstrap)
    return FileResponse(path, headers=_static_headers(request, release))


@router.put("/api/v1/runtime/state")
@router.post("/api/v1/runtime/state")
async def save_runtime_state(update: RuntimeStateUpdate, user: CurrentUser, db: DB):
    """Persist one validated mutation in the user's PostgreSQL runtime state."""
    try:
        _, revision, content_revision = await runtime_state_service.apply_update(
            db, user.username, user.role, update
        )
    except runtime_state_service.RuntimeStateConflictError as exc:
        detail: str | dict = str(exc)
        if exc.current_content_revision is not None:
            detail = {
                "code": "CONTENT_REVISION_CONFLICT",
                "message": str(exc),
                "currentContentRevision": exc.current_content_revision,
            }
        raise HTTPException(status_code=409, detail=detail) from exc
    except runtime_state_service.RuntimeStateValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except runtime_state_service.RuntimeStatePermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return {
        "ok": True,
        "username": user.username,
        "namespace": update.namespace,
        "revision": revision,
        "contentRevision": content_revision,
        "requestId": update.requestId,
    }


@router.get("/api/v1/runtime/state")
async def read_runtime_state(user: CurrentUser, db: DB):
    storage, revision, content_revision = await runtime_state_service.get_state(
        db, user.username, user.role
    )
    return {
        "storage": storage,
        "revision": revision,
        "contentRevision": content_revision,
    }


@router.post("/api/v1/runtime/learning-entry-claim")
async def claim_learning_entry(request: Request, user: CurrentUser, db: DB):
    return await runtime_state_service.claim_learning_entry(
        db,
        user.username,
        get_login_session_id(request),
    )


@router.get("/{asset_path:path}")
async def active_asset(asset_path: str, request: Request, db: DB) -> Response:
    release = _release_or_503()
    path = _asset_or_404(release, asset_path)
    if path.name == "landing.html":
        return FileResponse(path, headers=_static_headers(request, release))
    if path.suffix.lower() == ".html":
        if await _page_access_denied(request, db, path.name):
            return _forbidden_page()
        bootstrap = await build_bootstrap(
            request, db, page=path.name, release_version=release.version
        )
        return html_response(path, bootstrap)
    return FileResponse(path, headers=_static_headers(request, release))
