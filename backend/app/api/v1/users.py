"""用户管理路由（仅管理员）。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_role
from app.db.session import get_db
from app.models.user import User
from app.schemas.user import (
    BatchDelete,
    BatchUpdate,
    DuplicateUser,
    ResetPassword,
    StatusUpdate,
    UserCreate,
    UserImport,
    UserUpdate,
)
from app.services import user_service

router = APIRouter(prefix="/users", tags=["users"])
DB = Annotated[AsyncSession, Depends(get_db)]
AdminUser = Annotated[User, Depends(require_role("admin"))]


def _bad(e: ValueError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(e))


# ---------- 列表与统计 ----------
@router.get("")
async def list_users(
    db: DB,
    _: AdminUser,
    query: str | None = Query(None),
    role: str | None = Query(None),
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
):
    users, total = await user_service.list_users(
        db, query=query, role=role, status=status, page=page, page_size=page_size
    )
    return {
        "users": [user_service.to_dict(u) for u in users],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/export")
async def export_users(db: DB, _: AdminUser, usernames: str | None = Query(None)):
    uns = usernames.split(",") if usernames else None
    return await user_service.build_export(db, uns)


@router.post("/import")
async def import_users(payload: UserImport, db: DB, admin: AdminUser):
    added, skipped = await user_service.import_users(db, payload, actor=admin.username)
    return {"added": added, "skipped": skipped}


# ---------- 批量（固定路径，须在 {username} 之前）----------
@router.patch("/batch")
async def batch_update(data: BatchUpdate, db: DB, admin: AdminUser):
    n = await user_service.batch_update(db, data, actor=admin.username)
    return {"updated_count": n}


@router.delete("/batch")
async def batch_delete(data: BatchDelete, db: DB, admin: AdminUser):
    try:
        n = await user_service.delete_users(db, data.usernames, actor=admin.username)
    except ValueError as e:
        raise _bad(e)
    return {"deleted_count": n}


# ---------- 单用户 ----------
@router.post("")
async def create_user(data: UserCreate, db: DB, admin: AdminUser):
    try:
        user = await user_service.create_user(db, data, actor=admin.username)
    except ValueError as e:
        raise _bad(e)
    return {"user": user_service.to_dict(user)}


@router.get("/{username}")
async def get_user(username: str, db: DB, _: AdminUser):
    user = await user_service.get_by_username(db, username)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {"user": user_service.to_dict(user)}


@router.put("/{username}")
async def update_user(username: str, data: UserUpdate, db: DB, admin: AdminUser):
    try:
        user = await user_service.update_user(db, username, data, actor=admin.username)
    except ValueError as e:
        raise _bad(e)
    return {"user": user_service.to_dict(user)}


@router.delete("/{username}")
async def delete_user(username: str, db: DB, admin: AdminUser):
    try:
        n = await user_service.delete_users(db, [username], actor=admin.username)
    except ValueError as e:
        raise _bad(e)
    return {"deleted_count": n}


@router.post("/{username}/reset-password")
async def reset_password(username: str, data: ResetPassword, db: DB, admin: AdminUser):
    try:
        await user_service.reset_password(db, username, data.new_password, actor=admin.username)
    except ValueError as e:
        raise _bad(e)
    return {"ok": True}


@router.patch("/{username}/status")
async def set_status(username: str, data: StatusUpdate, db: DB, admin: AdminUser):
    try:
        user = await user_service.set_status(db, username, data.status, actor=admin.username)
    except ValueError as e:
        raise _bad(e)
    return {"user": user_service.to_dict(user)}


@router.post("/{username}/duplicate")
async def duplicate_user(username: str, data: DuplicateUser, db: DB, admin: AdminUser):
    try:
        user = await user_service.duplicate_user(
            db, username, data.new_username, data.new_password, actor=admin.username
        )
    except ValueError as e:
        raise _bad(e)
    return {"user": user_service.to_dict(user), "source_username": username}


@router.get("/{username}/stats")
async def user_stats(username: str, db: DB, _: AdminUser):
    """用户数据概览。图谱/题库统计在阶段 3、5 接入后补全，阶段 2 返回占位。"""
    user = await user_service.get_by_username(db, username)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {
        "username": username,
        "graph_nodes": 0,
        "graph_links": 0,
        "banks": 0,
        "questions": 0,
        "papers": 0,
    }
