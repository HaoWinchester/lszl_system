"""用户管理业务逻辑：CRUD、批量、状态、密码、复制、导入导出、日志。

含唯一有效管理员保护、暂停/归档登录拦截。所有写操作记录到 user_admin_logs。
"""

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password, now_utc, uid, verify_password
from app.models.user import ACTIVE, ADMIN, ARCHIVED, User, UserAdminLog
from app.schemas.user import UserCreate, UserImport, UserUpdate

VALID_ROLES = {"admin", "teacher", "student", "viewer"}
VALID_STATUSES = {"active", "paused", "archived"}


# ---------- 序列化 ----------
def to_dict(user: User) -> dict:
    return {
        "username": user.username,
        "role": user.role,
        "status": user.status,
        "display_name": user.display_name,
        "email": user.email,
        "phone": user.phone,
        "subject": user.subject,
        "tags": user.tags or [],
        "note": user.note,
        "source": user.source,
        "wechat": user.wechat,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "updated_at": user.updated_at.isoformat() if user.updated_at else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        "last_active_at": user.last_active_at.isoformat() if user.last_active_at else None,
        "archived_at": user.archived_at.isoformat() if user.archived_at else None,
        "has_password": bool(user.password_hash),
    }


def log_to_dict(log: UserAdminLog) -> dict:
    return {
        "id": log.id,
        "action": log.action,
        "target_username": log.target_username,
        "actor": log.actor,
        "detail": log.detail,
        "clientIp": log.client_ip,
        "userAgent": log.user_agent,
        "at": log.at.isoformat() if log.at else None,
    }


# ---------- 查询 ----------
async def get_by_username(db: AsyncSession, username: str) -> User | None:
    r = await db.execute(select(User).where(User.username == username))
    return r.scalar_one_or_none()


async def count_active_admins(db: AsyncSession, exclude: str | None = None) -> int:
    q = select(func.count()).select_from(User).where(User.role == ADMIN, User.status == ACTIVE)
    if exclude:
        q = q.where(User.username != exclude)
    r = await db.execute(q)
    return int(r.scalar() or 0)


async def list_users(
    db: AsyncSession,
    *,
    query: str | None = None,
    role: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
):
    q = select(User)
    if query:
        like = f"%{query}%"
        q = q.where(
            or_(
                User.username.ilike(like),
                User.display_name.ilike(like),
                User.email.ilike(like),
                User.subject.ilike(like),
            )
        )
    if role and role != "ALL":
        q = q.where(User.role == role)
    if status and status != "ALL":
        q = q.where(User.status == status)

    total_q = select(func.count()).select_from(q.subquery())
    total = int((await db.execute(total_q)).scalar() or 0)

    q = q.order_by(User.created_at).offset((page - 1) * page_size).limit(page_size)
    users = (await db.execute(q)).scalars().all()
    return list(users), total


async def list_logs(db: AsyncSession, limit: int = 100) -> list[UserAdminLog]:
    r = await db.execute(select(UserAdminLog).order_by(UserAdminLog.at.desc()).limit(limit))
    return list(r.scalars().all())


# ---------- 写操作 ----------
async def create_user(db: AsyncSession, data: UserCreate, actor: str = "system") -> User:
    if await get_by_username(db, data.username):
        raise ValueError("用户名已存在")
    if data.role not in VALID_ROLES:
        raise ValueError("角色非法")
    if data.status and data.status not in VALID_STATUSES:
        raise ValueError("状态非法")
    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        role=data.role,
        status=data.status or ACTIVE,
        display_name=data.display_name,
        email=data.email,
        phone=data.phone,
        subject=data.subject or "PMP",
        tags=data.tags or [],
        note=data.note,
        source=data.source or "user-management",
    )
    db.add(user)
    await log_action(db, "create_user", data.username, actor, f"新建用户，角色 {data.role}")
    await db.commit()
    await db.refresh(user)
    return user


async def update_user(db: AsyncSession, username: str, data: UserUpdate, actor: str) -> User:
    user = await _require(db, username)
    if data.role is not None and data.role != user.role:
        await _guard_last_admin(db, username)
        user.role = data.role
    if data.status is not None and data.status != user.status:
        if data.status not in VALID_STATUSES:
            raise ValueError("状态非法")
        await _guard_last_admin(db, username, allow_only_when_staying_active=data.status)
        user.status = data.status
        user.archived_at = now_utc() if data.status == ARCHIVED else None
    for f in ("display_name", "email", "phone", "subject", "note"):
        v = getattr(data, f)
        if v is not None:
            setattr(user, f, v)
    if data.tags is not None:
        user.tags = data.tags
    await log_action(db, "update_user", username, actor, "更新用户资料")
    await db.commit()
    await db.refresh(user)
    return user


async def set_status(db: AsyncSession, username: str, status: str, actor: str) -> User:
    user = await _require(db, username)
    if status not in VALID_STATUSES:
        raise ValueError("状态非法")
    if user.role == ADMIN and user.status == ACTIVE and status != ACTIVE:
        if await count_active_admins(db, exclude=username) == 0:
            raise ValueError("至少保留一个有效管理员")
    user.status = status
    user.archived_at = now_utc() if status == ARCHIVED else None
    await log_action(db, "set_status", username, actor, f"状态改为 {status}")
    await db.commit()
    await db.refresh(user)
    return user


async def reset_password(db: AsyncSession, username: str, new_password: str, actor: str) -> None:
    user = await _require(db, username)
    user.password_hash = hash_password(new_password)
    await log_action(db, "reset_password", username, actor, "重置密码")
    await db.commit()


async def duplicate_user(
    db: AsyncSession, src_username: str, new_username: str, new_password: str, actor: str
) -> User:
    if await get_by_username(db, new_username):
        raise ValueError("用户名已存在")
    src = await _require(db, src_username)
    copied_display_name = f"{src.display_name or src.username} 副本"[:120]
    new = User(
        username=new_username,
        password_hash=hash_password(new_password),
        role=src.role,
        status=ACTIVE,
        display_name=copied_display_name,
        email=src.email,
        phone=src.phone,
        subject=src.subject,
        tags=list(src.tags or []),
        note=src.note,
        source="duplicated",
    )
    db.add(new)
    await log_action(db, "duplicate_user", new_username, actor, f"复制自 {src_username}")
    await db.commit()
    await db.refresh(new)
    return new


async def delete_users(db: AsyncSession, usernames: list[str], actor: str) -> int:
    if not usernames:
        return 0
    admins_to_delete = []
    for un in usernames:
        u = await get_by_username(db, un)
        if u and u.role == ADMIN and u.status == ACTIVE:
            admins_to_delete.append(un)
    if (await count_active_admins(db)) - len(admins_to_delete) < 1:
        raise ValueError("至少保留一个有效管理员")
    users = (await db.execute(select(User).where(User.username.in_(usernames)))).scalars().all()
    for u in users:
        await db.delete(u)
    await log_action(db, "delete_users", ",".join(usernames), actor, f"删除 {len(users)} 个用户")
    await db.commit()
    return len(users)


async def batch_update(db: AsyncSession, data, actor: str) -> int:
    if not data.usernames:
        return 0
    users = (await db.execute(select(User).where(User.username.in_(data.usernames)))).scalars().all()
    n = 0
    for u in users:
        if data.role and data.role != "KEEP":
            u.role = data.role
        if data.status and data.status != "KEEP":
            u.status = data.status
            u.archived_at = now_utc() if data.status == ARCHIVED else None
        if data.subject and data.subject != "KEEP":
            u.subject = data.subject
        n += 1
    await log_action(db, "batch_update", ",".join(data.usernames), actor, f"批量更新 {n} 个用户")
    await db.commit()
    return n


async def clear_logs(db: AsyncSession, actor: str) -> None:
    logs = (await db.execute(select(UserAdminLog))).scalars().all()
    for log in logs:
        await db.delete(log)
    await log_action(db, "clear_logs", None, actor, "清空操作日志")
    await db.commit()


# ---------- 认证 ----------
async def authenticate(db: AsyncSession, username: str, password: str) -> User | None:
    user = await get_by_username(db, username)
    if not user or not verify_password(password, user.password_hash):
        return None
    if user.status != ACTIVE:
        raise PermissionError("账号已停用或归档，无法登录")
    user.last_login_at = now_utc()
    user.last_active_at = now_utc()
    await db.commit()
    await db.refresh(user)
    return user


# ---------- 导入导出 ----------
async def build_export(db: AsyncSession, usernames: list[str] | None = None) -> dict:
    if usernames:
        users = (await db.execute(select(User).where(User.username.in_(usernames)))).scalars().all()
    else:
        users = (await db.execute(select(User))).scalars().all()
    return {
        "format": "kg-users-export",
        "version": 1,
        "users": [
            {
                "username": u.username,
                "role": u.role,
                "status": u.status,
                "display_name": u.display_name,
                "email": u.email,
                "phone": u.phone,
                "subject": u.subject,
                "tags": u.tags or [],
                "note": u.note,
                "source": u.source,
                "wechat": u.wechat,
            }
            for u in users
        ],
    }


async def import_users(db: AsyncSession, payload: UserImport, actor: str) -> tuple[int, int]:
    added = 0
    skipped = 0
    for rec in payload.users:
        un = rec.username
        if not un or await get_by_username(db, un):
            skipped += 1
            continue
        role = rec.role if rec.role in VALID_ROLES else "student"
        status = rec.status if rec.status in VALID_STATUSES else ACTIVE
        db.add(
            User(
                username=un,
                password_hash=hash_password(payload.initial_password),
                role=role,
                status=status,
                display_name=rec.display_name,
                email=rec.email,
                phone=rec.phone,
                subject=rec.subject or "PMP",
                tags=rec.tags or [],
                note=rec.note,
                source="import",
            )
        )
        added += 1
    await log_action(db, "import_users", None, actor, f"导入 {added} 个用户，跳过 {skipped} 个")
    await db.commit()
    return added, skipped


# ---------- 辅助 ----------
async def _require(db: AsyncSession, username: str) -> User:
    user = await get_by_username(db, username)
    if not user:
        raise ValueError("用户不存在")
    return user


async def _guard_last_admin(db: AsyncSession, username: str, allow_only_when_staying_active: str | None = None) -> None:
    """防止把唯一有效管理员降级或停用。"""
    user = await get_by_username(db, username)
    if not user or user.role != ADMIN or user.status != ACTIVE:
        return
    if await count_active_admins(db, exclude=username) == 0:
        raise ValueError("至少保留一个有效管理员")


async def log_action(
    db: AsyncSession,
    action: str,
    target_username: str | None,
    actor: str,
    detail: str | None = None,
    client_ip: str | None = None,
    user_agent: str | None = None,
) -> None:
    db.add(
        UserAdminLog(
            id=uid("log_"),
            action=action,
            target_username=target_username,
            actor=actor,
            detail=detail,
            client_ip=client_ip,
            user_agent=user_agent,
        )
    )
