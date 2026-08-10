"""Owner and collaborator policy for managed question banks."""

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.content_prep import QuestionBankCollaborator
from app.models.question import QuestionBank
from app.models.user import User


TEACHING_MANAGER_ROLES = frozenset({"admin", "teacher"})


async def _collaborator_permission(
    db: AsyncSession,
    username: str,
    bank_id: str,
) -> str | None:
    result = await db.execute(
        select(QuestionBankCollaborator.permission).where(
            QuestionBankCollaborator.bank_id == bank_id,
            QuestionBankCollaborator.username == username,
        )
    )
    return result.scalar_one_or_none()


async def can_view_bank(db: AsyncSession, user: User, bank: QuestionBank) -> bool:
    if user.role in TEACHING_MANAGER_ROLES or bank.owner_id == user.username:
        return True
    return await _collaborator_permission(db, user.username, bank.id) in {"view", "edit"}


async def can_edit_bank(db: AsyncSession, user: User, bank: QuestionBank) -> bool:
    if user.role in TEACHING_MANAGER_ROLES or bank.owner_id == user.username:
        return True
    return await _collaborator_permission(db, user.username, bank.id) == "edit"


async def require_bank_access(
    db: AsyncSession,
    user: User,
    bank_id: str,
    *,
    edit: bool,
) -> QuestionBank:
    bank = await db.get(QuestionBank, bank_id)
    if bank is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "BANK_NOT_FOUND", "message": "题库不存在"},
        )
    allowed = await (can_edit_bank(db, user, bank) if edit else can_view_bank(db, user, bank))
    if not allowed:
        raise HTTPException(
            status_code=403,
            detail={"code": "BANK_ACCESS_DENIED", "message": "当前账号无权访问该题库"},
        )
    return bank
