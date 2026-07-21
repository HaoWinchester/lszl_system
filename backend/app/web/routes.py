"""Stable aliases and direct new-legacy page/static routes."""

from __future__ import annotations

from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, Response

from app.web.html import html_response
from app.web.releases import (
    ReleaseNotFoundError,
    WebRelease,
    active_release,
    preview_release,
    resolve_asset,
)

router = APIRouter(include_in_schema=False)


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


def _redirect(request: Request, page: str, defaults: dict[str, str] | None = None) -> RedirectResponse:
    params = dict(defaults or {})
    params.update(request.query_params)
    query = f"?{urlencode(params)}" if params else ""
    return RedirectResponse(f"/{page}{query}", status_code=307)


@router.get("/")
async def learning_path_page():
    release = _release_or_503()
    return html_response(_asset_or_404(release, "learning-path.html"))


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
    return _redirect(request, "learning-path.html", {"auth": "login"})


@router.get("/member")
async def member_alias(request: Request):
    return _redirect(request, "index.html", {"mode": "free", "member": "1"})


@router.get("/__preview/{version}")
@router.get("/__preview/{version}/")
async def preview_root(version: str):
    try:
        release = preview_release(version)
    except ReleaseNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return html_response(_asset_or_404(release, "learning-path.html"))


@router.get("/__preview/{version}/{asset_path:path}")
async def preview_asset(version: str, asset_path: str) -> Response:
    try:
        release = preview_release(version)
    except ReleaseNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    path = _asset_or_404(release, asset_path)
    if path.suffix.lower() == ".html":
        return html_response(path)
    return FileResponse(path, headers={"X-Content-Type-Options": "nosniff"})


@router.get("/{asset_path:path}")
async def active_asset(asset_path: str) -> Response:
    release = _release_or_503()
    path = _asset_or_404(release, asset_path)
    if path.suffix.lower() == ".html":
        return html_response(path)
    return FileResponse(path, headers={"X-Content-Type-Options": "nosniff"})
