"""认证依赖：从 session 取当前用户、角色鉴权。

session 由 starlette SessionMiddleware（itsdangerous 签名 cookie）提供，
request.session 是 dict，登录时写入 username，登出时清空。
"""

from typing import Annotated, Callable

from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import ACTIVE, User
from app.services import user_service


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="未登录")
    user = await user_service.get_by_username(db, username)
    if not user or user.status != ACTIVE:
        request.session.clear()
        raise HTTPException(status_code=401, detail="会话已失效，请重新登录")
    return user


def require_role(*roles: str) -> Callable:
    """角色鉴权依赖工厂：require_role('admin') 或 require_role('admin','teacher')。"""

    async def _dependency(user: Annotated[User, Depends(get_current_user)]) -> User:
        if roles and user.role not in roles:
            raise HTTPException(status_code=403, detail="当前角色无权限执行此操作")
        return user

    return _dependency


# 便捷类型别名
CurrentUser = Annotated[User, Depends(get_current_user)]
