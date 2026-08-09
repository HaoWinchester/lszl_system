"""Content Prep bank setup and fixed creator attribution."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import uid
from app.models.question import QuestionBank
from app.models.user import User


CREATORS = {
    "creator_001": "波塞冬",
    "creator_002": "狗娃",
    "creator_003": "阿浩",
    "creator_004": "杰瑞",
    "creator_005": "天才",
    "creator_006": "女帝",
}


class ContentPrepInputError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def resolve_creator(creator_id: object) -> tuple[str, str]:
    normalized_id = str(creator_id or "").strip()
    creator_name = CREATORS.get(normalized_id)
    if creator_name is None:
        raise ContentPrepInputError("UNKNOWN_CREATOR", "请选择有效的固定制作人")
    return normalized_id, creator_name


async def create_bank(
    db: AsyncSession,
    actor: User,
    body: dict,
) -> QuestionBank:
    resolve_creator(body.get("creatorId"))
    visibility = str(body.get("visibility") or "private").strip().lower()
    if visibility not in {"private", "published"}:
        raise ContentPrepInputError(
            "INVALID_BANK_VISIBILITY",
            "题库可见性必须为 private 或 published",
        )
    name = str(body.get("name") or "").strip()
    if not name:
        raise ContentPrepInputError("BANK_NAME_REQUIRED", "题库名称不能为空")
    subject = str(body.get("subject") or actor.subject or "PMP").strip().upper()
    bank = QuestionBank(
        id=uid("b_"),
        owner_id=actor.username,
        name=name[:200],
        subject=subject[:32],
        description=(str(body["description"]).strip() if body.get("description") else None),
        visibility=visibility,
        revision=1,
        created_by=actor.username,
        updated_by=actor.username,
    )
    db.add(bank)
    await db.commit()
    await db.refresh(bank)
    return bank


def created_bank_payload(bank: QuestionBank) -> dict:
    return {
        "id": bank.id,
        "name": bank.name,
        "subject": bank.subject,
        "description": bank.description,
        "visibility": bank.visibility,
        "revision": bank.revision,
        "ownerId": bank.owner_id,
        "createdBy": bank.created_by,
        "updatedBy": bank.updated_by,
        "createdAt": bank.created_at.isoformat() if bank.created_at else None,
        "updatedAt": bank.updated_at.isoformat() if bank.updated_at else None,
    }
