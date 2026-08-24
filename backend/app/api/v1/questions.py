"""Question bank and question management routes."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_permissions
from app.db.session import get_db
from app.models.user import User
from app.schemas.question_catalog import QuestionBankImportRequest, QuestionBankImportResponse
from app.services import question_service
from app.services import question_migration_service

router = APIRouter(tags=["question-bank"])
DB = Annotated[AsyncSession, Depends(get_db)]
QuestionBankReader = Annotated[
    User,
    Depends(require_permissions("accessQuestionBank")),
]
QuestionBankManager = Annotated[
    User,
    Depends(require_permissions("accessQuestionBank", "manageQuestionBank")),
]
QuestionEditor = Annotated[
    User,
    Depends(require_permissions("accessQuestionBank", "editQuestions")),
]


def _nf() -> HTTPException:
    return HTTPException(status_code=404, detail="不存在或无权访问")


def _parse_id_set(ids: list[str] | None) -> set[str] | None:
    if not ids:
        return None
    result: set[str] = set()
    for item in ids:
        for chunk in str(item).split(","):
            value = chunk.strip()
            if value:
                result.add(value)
    return result


# ---------- 题库 ----------
@router.get("/banks")
async def list_banks(db: DB, user: QuestionBankReader, subject: str | None = Query(None)):
    return {"banks": await question_service.list_banks(db, user, subject)}


@router.post("/banks")
async def create_bank(body: dict, db: DB, user: QuestionBankManager):
    b = await question_service.create_bank(db, user, body)
    return {"bank": question_service.bank_to_dict(b)}


@router.post("/banks/import", response_model=QuestionBankImportResponse)
async def import_banks(
    request: QuestionBankImportRequest,
    db: DB,
    user: QuestionBankManager,
):
    return await question_service.import_question_banks(db, user, request)


@router.put("/banks/{bank_id}")
async def update_bank(bank_id: str, body: dict, db: DB, user: QuestionBankManager):
    b = await question_service.update_bank(db, user, bank_id, body)
    if not b:
        raise _nf()
    return {"bank": question_service.bank_to_dict(b)}


@router.delete("/banks/{bank_id}")
async def delete_bank(bank_id: str, db: DB, user: QuestionBankManager):
    if not await question_service.delete_bank(db, user, bank_id):
        raise _nf()
    return {"ok": True}


@router.post("/banks/{bank_id}/test-learning-records/clear")
async def clear_bank_test_learning_records(
    bank_id: str,
    db: DB,
    user: QuestionBankManager,
):
    result = await question_service.clear_bank_test_learning_records(db, user, bank_id)
    if result is None:
        raise _nf()
    return result


# ---------- 题目 ----------
@router.get("/banks/{bank_id}/questions")
async def list_questions(
    db: DB,
    user: QuestionBankReader,
    bank_id: str,
    query: str | None = Query(None),
    domain: str | None = Query(None),
    difficulty: str | None = Query(None),
    page: int = 1,
    page_size: int = 20,
):
    items, total = await question_service.list_questions(
        db, user, bank_id, query=query, domain=domain, difficulty=difficulty, page=page, page_size=page_size
    )
    return {"questions": items, "total": total, "page": page, "page_size": page_size}


@router.post("/banks/{bank_id}/questions")
async def create_question(bank_id: str, body: dict, db: DB, user: QuestionEditor):
    q = await question_service.create_question(db, user, bank_id, body)
    if not q:
        raise _nf()
    return {"question": question_service.question_to_dict(q)}


@router.post("/banks/{bank_id}/questions/import")
async def import_questions(bank_id: str, body: dict, db: DB, user: QuestionEditor):
    items = body.get("questions") if isinstance(body.get("questions"), list) else []
    if not items:
        raise HTTPException(status_code=422, detail="没有可导入的题目")
    return await question_service.import_questions_into_bank(
        db,
        user,
        bank_id,
        items,
        confirm_duplicate_cleanup=body.get("confirmDuplicateCleanup") is True,
    )


@router.get("/questions/{question_id}")
async def get_question(question_id: str, db: DB, user: QuestionBankReader):
    q = await question_service.get_question(db, user, question_id)
    if not q:
        raise _nf()
    return {"question": question_service.question_to_dict(q)}


@router.put("/questions/{question_id}")
async def update_question(question_id: str, body: dict, db: DB, user: QuestionEditor):
    q = await question_service.update_question(db, user, question_id, body)
    if not q:
        raise _nf()
    return {"question": question_service.question_to_dict(q)}


@router.delete("/questions/{question_id}")
async def delete_question(question_id: str, db: DB, user: QuestionEditor):
    if not await question_service.delete_question(db, user, question_id):
        raise _nf()
    return {"ok": True}


@router.get("/banks/migration/runtime/scan")
async def scan_runtime_bank_state(
    db: DB,
    user: QuestionBankManager,
    ownerIds: list[str] | None = Query(default=None),
    bankIds: list[str] | None = Query(default=None),
):
    return {
        "report": await question_migration_service.scan_runtime_question_sources(
            db,
            owner_ids=_parse_id_set(ownerIds),
            bank_ids=_parse_id_set(bankIds),
        )
    }

@router.post("/banks/migration/runtime")
async def migrate_runtime_banks(
    db: DB,
    user: QuestionBankManager,
    apply: bool = Query(default=False),
    ownerIds: list[str] | None = Query(default=None),
    bankIds: list[str] | None = Query(default=None),
):
    return {
        "report": await question_migration_service.migrate_runtime_questions(
            db,
            apply=apply,
            owner_ids=_parse_id_set(ownerIds),
            bank_ids=_parse_id_set(bankIds),
        )
    }
