"""Build request-scoped state before upstream synchronous scripts execute."""

from __future__ import annotations

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import user_service

PAGE_NAMESPACES = {
    "index.html": "files",
    "learning-path.html": "guided-learning",
    "guided-learning-node.html": "guided-learning",
    "guided-learning-placement-test.html": "guided-learning",
    "question-training.html": "training",
    "question-workspace.html": "workspace",
    "question-bank.html": "questions",
    "knowledge-recall.html": "recall",
    # practice-mode 无条目：默认 namespace "page"，与前端 server-state-bootstrap 的派发一致，
    # 否则 validate_update 会以 namespace 不匹配拒绝做题页保存。
    "file-manager.html": "files",
    "user-management.html": "users",
    "system-settings.html": "system",
    "paper-management.html": "papers",
    "content-prep.html": "content",
    "course-admin.html": "courses",
    "content-center.html": "content",
    "teacher-workbench.html": "teacher",
    "admin-console.html": "admin",
    "admin-operations.html": "operations",
    "admin-settings.html": "admin",
    "admin-subjects.html": "subjects",
}


async def optional_user(request: Request, db: AsyncSession):
    username = request.session.get("username")
    if not username:
        return None
    user = await user_service.get_by_username(db, str(username))
    if not user or user.status != "active":
        request.session.clear()
        return None
    return user


async def build_bootstrap(
    request: Request,
    db: AsyncSession,
    *,
    page: str,
    release_version: str,
    read_only: bool = False,
) -> dict:
    from app.core.auth import get_login_session_id
    from app.services import runtime_state_service

    user = await optional_user(request, db)
    auth_user = user_service.to_dict(user) if user else None
    if auth_user:
        auth_user["loginSessionId"] = get_login_session_id(request)
    revision = 0
    content_revision = 0
    inline_storage: dict[str, str] | None = None
    if user:
        # 快照配对：contentRevision 必须与页面所见状态同一时刻。
        storage, revision, content_revision = await runtime_state_service.get_state(
            db, user.username, user.role
        )
        seeded, revision, content_revision = await runtime_state_service.ensure_domain_seed(
            db, user, page, storage, revision
        )
        # 水合（bootstrap API）是登录后异步进行的；完成前页面脚本读到的内存
        # Map 为空，图谱文件存储会误判"无索引"而新建初始文件并覆盖服务器索引
        # （2026-08-23 生产事故：73 个用户索引被覆盖）。把按页面过滤后的快照
        # 在体积可控时内联进首包，消除竞态；超限时放弃内联（保持首包体积
        # 可控），由前端"首次水合完成前挂起保存"兜底。
        inline_storage = _inline_bootstrap_storage(seeded)
    return {
        "schemaVersion": 1,
        "releaseVersion": release_version,
        "page": page,
        "namespace": PAGE_NAMESPACES.get(page, "page"),
        "authenticated": user is not None,
        "username": user.username if user else None,
        "authUser": auth_user,
        "revision": revision,
        "contentRevision": content_revision,
        "storage": inline_storage,
        "readOnly": read_only,
    }


# 与前端 scripts/new-legacy-assets/server-state-bootstrap.js 的
# INLINE_STORAGE_MAX_BYTES 保持一致；单方调整会造成首包超限或竞态复现。
INLINE_STORAGE_MAX_BYTES = 512 * 1024


def _inline_bootstrap_storage(storage: dict[str, str]) -> dict[str, str] | None:
    """体积可控时返回可内联的快照，超限返回 None（整体放弃，保证原子性）。"""
    if not storage:
        return None
    total = 0
    for value in storage.values():
        total += len(str(value).encode("utf-8"))
        if total > INLINE_STORAGE_MAX_BYTES:
            return None
    return dict(storage)
