"""训练作答与深度回忆进度的读写。"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import uid
from app.models.question import Question
from app.models.training import RecallProgress, TrainingProgress
from app.services import question_service


# ---------- 训练作答 ----------
async def get_progress(db: AsyncSession, owner: str, question_id: str) -> dict | None:
    r = await db.execute(
        select(TrainingProgress).where(
            TrainingProgress.owner_id == owner, TrainingProgress.question_id == question_id
        )
    )
    p = r.scalar_one_or_none()
    if not p:
        return None
    return {
        "selectedAnswer": p.selected_answer,
        "submitted": p.submitted,
        "foundClues": p.found_clues or [],
        "reasoningState": p.reasoning_state or {},
    }


async def save_progress(db: AsyncSession, owner: str, question_id: str, data: dict) -> dict:
    r = await db.execute(
        select(TrainingProgress).where(
            TrainingProgress.owner_id == owner, TrainingProgress.question_id == question_id
        )
    )
    p = r.scalar_one_or_none()
    if p:
        if "selectedAnswer" in data:
            p.selected_answer = data["selectedAnswer"]
        if "submitted" in data:
            p.submitted = data["submitted"]
        if "foundClues" in data:
            p.found_clues = data["foundClues"]
        if "reasoningState" in data:
            p.reasoning_state = data["reasoningState"]
        if "bankId" in data:
            p.bank_id = data["bankId"]
        if "paperId" in data:
            p.paper_id = data["paperId"]
    else:
        p = TrainingProgress(
            id=uid("tp_"),
            owner_id=owner,
            question_id=question_id,
            bank_id=data.get("bankId"),
            paper_id=data.get("paperId"),
            selected_answer=data.get("selectedAnswer"),
            submitted=data.get("submitted", False),
            found_clues=data.get("foundClues") or [],
            reasoning_state=data.get("reasoningState") or {},
        )
        db.add(p)
    await db.commit()
    return {
        "selectedAnswer": p.selected_answer,
        "submitted": p.submitted,
        "foundClues": p.found_clues or [],
        "reasoningState": p.reasoning_state or {},
    }


# ---------- 深度回忆 ----------
async def get_question_for_recall(db: AsyncSession, owner: str, question_id: str) -> dict | None:
    q = await question_service.get_question(db, owner, question_id)
    if not q:
        return None
    return question_service.question_to_dict(q)


async def get_recall(db: AsyncSession, owner: str, question_id: str) -> dict | None:
    r = await db.get(RecallProgress, (owner, question_id))
    if not r:
        return None
    return {
        "nodes": r.nodes or [],
        "edges": r.edges or [],
        "customNodes": r.custom_nodes or {},
        "activeKeywords": r.active_keywords or [],
        "choiceOffsets": r.choice_offsets or {},
        "metrics": r.metrics or {},
        "transform": r.transform or {},
    }


async def save_recall(db: AsyncSession, owner: str, question_id: str, data: dict) -> dict:
    r = await db.get(RecallProgress, (owner, question_id))
    payload = {
        "nodes": data.get("nodes") or [],
        "edges": data.get("edges") or [],
        "customNodes": data.get("customNodes") or {},
        "activeKeywords": data.get("activeKeywords") or [],
        "choiceOffsets": data.get("choiceOffsets") or {},
        "metrics": data.get("metrics") or {},
        "transform": data.get("transform") or {},
    }
    if r:
        r.nodes = payload["nodes"]
        r.edges = payload["edges"]
        r.custom_nodes = payload["customNodes"]
        r.active_keywords = payload["activeKeywords"]
        r.choice_offsets = payload["choiceOffsets"]
        r.metrics = payload["metrics"]
        r.transform = payload["transform"]
    else:
        db.add(
            RecallProgress(
                owner_id=owner,
                question_id=question_id,
                nodes=payload["nodes"],
                edges=payload["edges"],
                custom_nodes=payload["customNodes"],
                active_keywords=payload["activeKeywords"],
                choice_offsets=payload["choiceOffsets"],
                metrics=payload["metrics"],
                transform=payload["transform"],
            )
        )
    await db.commit()
    return payload


async def list_recall_progress_question_ids(
    db: AsyncSession,
    owner: str,
    *,
    bank_id: str | None = None,
    question_ids: list[str] | None = None,
) -> list[str]:
    """Return explored ids for one bank or a bounded published-collection snapshot."""

    filters = [RecallProgress.owner_id == owner]
    if bank_id:
        filters.append(Question.bank_id == bank_id)
    elif question_ids:
        filters.append(RecallProgress.question_id.in_(question_ids))
    else:
        return []
    rows = await db.execute(
        select(RecallProgress.question_id)
        .join(Question, Question.id == RecallProgress.question_id)
        .where(*filters)
        .order_by(RecallProgress.saved_at.desc(), RecallProgress.question_id)
    )
    return [str(question_id) for question_id in rows.scalars().all()]


async def delete_recall(db: AsyncSession, owner: str, question_id: str) -> bool:
    progress = await db.get(RecallProgress, (owner, question_id))
    if progress is None:
        return False
    await db.delete(progress)
    await db.commit()
    return True
