"""Database service for learner-owned reusable synthesis cards."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc, uid
from app.models.training import PersonalSynthesisCard
from app.schemas.personal_card import PersonalCardCreate, PersonalCardSourceQuestionRef, PersonalCardUpdate


class PersonalCardConflict(ValueError):
    def __init__(self, current_revision: int):
        super().__init__("归纳卡已在其他页面修改，请重新加载最新版本")
        self.current_revision = current_revision


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def card_to_dict(card: PersonalSynthesisCard) -> dict[str, Any]:
    return {
        "id": card.id,
        "title": card.title,
        "synthesisType": card.synthesis_type,
        "content": card.content,
        "tags": card.tags or [],
        "status": card.status,
        "sourceQuestionRefs": card.source_question_refs or [],
        "archivedAt": _iso(card.archived_at),
        "revision": card.revision,
        "createdAt": _iso(card.created_at),
        "updatedAt": _iso(card.updated_at),
    }


def _clean_tags(values: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in values:
        tag = str(raw or "").strip()
        if not tag or tag in seen:
            continue
        seen.add(tag)
        cleaned.append(tag[:100])
        if len(cleaned) >= 24:
            break
    return cleaned


def _source_refs(values: list[PersonalCardSourceQuestionRef]) -> list[dict[str, str]]:
    return [
        {
            "questionId": ref.question_id,
            "bankId": ref.bank_id,
            "paperId": ref.paper_id,
            "releaseId": ref.release_id,
            "title": ref.title,
        }
        for ref in values
    ]


async def list_cards(
    db: AsyncSession,
    owner: str,
    *,
    archived: bool,
    query: str = "",
) -> list[dict[str, Any]]:
    statement = select(PersonalSynthesisCard).where(
        PersonalSynthesisCard.owner_id == owner,
        PersonalSynthesisCard.archived_at.is_not(None)
        if archived
        else PersonalSynthesisCard.archived_at.is_(None),
    ).order_by(PersonalSynthesisCard.updated_at.desc(), PersonalSynthesisCard.id)
    rows = (await db.execute(statement)).scalars().all()
    normalized_query = str(query or "").strip().casefold()
    if normalized_query:
        rows = [
            row
            for row in rows
            if normalized_query
            in " ".join([row.title, row.content, *(row.tags or [])]).casefold()
        ]
    return [card_to_dict(row) for row in rows]


async def get_card(
    db: AsyncSession,
    owner: str,
    card_id: str,
    *,
    for_update: bool = False,
) -> PersonalSynthesisCard | None:
    statement = select(PersonalSynthesisCard).where(
        PersonalSynthesisCard.owner_id == owner,
        PersonalSynthesisCard.id == card_id,
    )
    if for_update:
        statement = statement.with_for_update()
    return (await db.execute(statement)).scalar_one_or_none()


async def create_card(
    db: AsyncSession,
    owner: str,
    data: PersonalCardCreate,
) -> PersonalSynthesisCard:
    card = PersonalSynthesisCard(
        id=uid("psc_"),
        owner_id=owner,
        title=data.title,
        synthesis_type=data.synthesis_type,
        content=data.content,
        tags=_clean_tags(data.tags),
        status=data.status,
        source_question_refs=_source_refs(data.source_question_refs),
        revision=1,
    )
    db.add(card)
    await db.commit()
    await db.refresh(card)
    return card


async def update_card(
    db: AsyncSession,
    owner: str,
    card_id: str,
    data: PersonalCardUpdate,
) -> PersonalSynthesisCard | None:
    card = await get_card(db, owner, card_id, for_update=True)
    if card is None:
        return None
    if card.revision != data.revision:
        raise PersonalCardConflict(card.revision)
    changes = data.model_dump(exclude_unset=True)
    changes.pop("revision", None)
    if "title" in changes:
        card.title = data.title or card.title
    if "synthesis_type" in changes:
        card.synthesis_type = data.synthesis_type or card.synthesis_type
    if "content" in changes:
        card.content = data.content or ""
    if "tags" in changes:
        card.tags = _clean_tags(data.tags or [])
    if "status" in changes:
        card.status = data.status or card.status
    if "source_question_refs" in changes:
        card.source_question_refs = _source_refs(data.source_question_refs or [])
    card.revision += 1
    await db.commit()
    await db.refresh(card)
    return card


async def set_archived(
    db: AsyncSession,
    owner: str,
    card_id: str,
    archived: bool,
) -> PersonalSynthesisCard | None:
    card = await get_card(db, owner, card_id, for_update=True)
    if card is None:
        return None
    next_archived_at = now_utc() if archived else None
    if (card.archived_at is None) != (next_archived_at is None):
        card.archived_at = next_archived_at
        card.revision += 1
        await db.commit()
        await db.refresh(card)
    return card
