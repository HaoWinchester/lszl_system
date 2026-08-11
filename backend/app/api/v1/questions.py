"""题库管理路由：题库 / 题目 / 试卷（组卷 + 发布）。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_permissions
from app.db.session import get_db
from app.models.user import User
from app.schemas.question_catalog import QuestionBankImportRequest, QuestionBankImportResponse
from app.services import question_service

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
PaperManager = Annotated[
    User,
    Depends(require_permissions("managePapers")),
]
PaperPublisher = Annotated[
    User,
    Depends(require_permissions("managePapers", "publishPapers")),
]


def _nf() -> HTTPException:
    return HTTPException(status_code=404, detail="不存在或无权访问")


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


# ---------- 试卷 ----------
@router.get("/papers")
async def list_papers(db: DB, user: PaperManager, status: str | None = Query(None)):
    return {"papers": await question_service.list_papers(db, user, status)}


@router.post("/papers")
async def create_paper(body: dict, db: DB, user: PaperManager):
    p = await question_service.create_paper(db, user, body)
    return {"paper": question_service.paper_to_dict(p)}


@router.get("/papers/{paper_id}")
async def get_paper(paper_id: str, db: DB, user: PaperManager):
    p = await question_service.get_paper_with_questions(db, user, paper_id)
    if not p:
        raise _nf()
    return {"paper": p}


@router.put("/papers/{paper_id}")
async def update_paper(paper_id: str, body: dict, db: DB, user: PaperManager):
    p = await question_service.update_paper(db, user, paper_id, body)
    if not p:
        raise _nf()
    return {"paper": question_service.paper_to_dict(p)}


@router.delete("/papers/{paper_id}")
async def delete_paper(
    paper_id: str,
    db: DB,
    user: PaperManager,
    revision: str | None = Query(None),
    reason: str | None = Query(None),
):
    deletion = await question_service.delete_paper(
        db,
        user,
        paper_id,
        revision,
        reason,
    )
    if not deletion:
        raise _nf()
    return {"ok": True, "deletion": deletion}


@router.post("/papers/{paper_id}/compose")
async def compose_paper(paper_id: str, body: dict, db: DB, user: PaperManager):
    n = await question_service.compose_paper(
        db,
        user,
        paper_id,
        body.get("bankIds") or [],
        body.get("quotas") or {},
        body.get("revision"),
    )
    if n < 0:
        raise _nf()
    return {"picked": n}


@router.post("/papers/{paper_id}/publish")
async def publish_paper(
    paper_id: str,
    db: DB,
    user: PaperPublisher,
    revision: str | None = Query(None),
):
    p = await question_service.set_published(db, user, paper_id, True, revision)
    if not p:
        raise _nf()
    return {"paper": question_service.paper_to_dict(p)}


@router.post("/papers/{paper_id}/unpublish")
async def unpublish_paper(
    paper_id: str,
    db: DB,
    user: PaperPublisher,
    revision: str | None = Query(None),
):
    p = await question_service.set_published(db, user, paper_id, False, revision)
    if not p:
        raise _nf()
    return {"paper": question_service.paper_to_dict(p)}
