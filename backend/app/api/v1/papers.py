"""Paper draft, lifecycle, category, and compatibility routes."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_permissions
from app.db.session import get_db
from app.models.user import User
from app.schemas.paper import (
    PaperCategoryCreateRequest,
    PaperCategoryUpdateRequest,
    PaperCompositionBatchRequest,
    PaperCompositionPreflightRequest,
    PaperCreateRequest,
    PaperQuestionReplaceRequest,
    PaperImportPreflightRequest,
    PaperImportRequest,
    PaperUpdateRequest,
)
from app.services import (
    paper_composition_service,
    paper_import_service,
    paper_service,
    question_migration_service,
    question_service,
)

router = APIRouter(tags=["papers"])
DB = Annotated[AsyncSession, Depends(get_db)]
PaperManager = Annotated[User, Depends(require_permissions("managePapers"))]
PaperPublisher = Annotated[
    User,
    Depends(require_permissions("managePapers", "publishPapers")),
]


def _nf() -> HTTPException:
    return HTTPException(status_code=404, detail="不存在或无权访问")


def _parse_id_set(ids: list[str] | None) -> set[str] | None:
    if not ids:
        return None
    return {
        value
        for item in ids
        for chunk in str(item).split(",")
        if (value := chunk.strip())
    }


@router.post("/papers/composition/preflight")
async def preflight_paper_composition(
    body: PaperCompositionPreflightRequest,
    db: DB,
    user: PaperManager,
):
    return {
        "preflight": await paper_composition_service.preflight_composition(
            db,
            user,
            body,
        )
    }


@router.post("/papers/composition/batches")
async def create_paper_composition_batch(
    body: PaperCompositionBatchRequest,
    db: DB,
    user: PaperManager,
):
    return {
        "result": await paper_composition_service.create_composition_batch(
            db,
            user,
            body,
        )
    }


@router.post("/papers/import/preflight")
async def preflight_paper_import(
    body: PaperImportPreflightRequest,
    db: DB,
    user: PaperManager,
):
    return {
        "preflight": await paper_import_service.preflight_package(db, user, body)
    }


@router.post("/papers/import")
async def import_paper(
    body: PaperImportRequest,
    db: DB,
    user: PaperManager,
):
    return {"result": await paper_import_service.import_package(db, user, body)}


@router.get("/papers")
async def list_papers(db: DB, user: PaperManager, status: str | None = Query(None)):
    return {"papers": await paper_service.list_papers(db, user, status)}


@router.post("/papers")
async def create_paper(body: PaperCreateRequest, db: DB, user: PaperManager):
    return {"paper": await paper_service.create_paper(db, user, body)}


@router.get("/papers/{paper_id}")
async def get_paper(paper_id: str, db: DB, user: PaperManager):
    paper = await paper_service.get_paper(db, user, paper_id)
    if not paper:
        raise _nf()
    return {"paper": paper}


@router.put("/papers/{paper_id}")
async def update_paper(
    paper_id: str,
    body: PaperUpdateRequest,
    db: DB,
    user: PaperManager,
):
    paper = await paper_service.update_paper(db, user, paper_id, body)
    if not paper:
        raise _nf()
    return {"paper": paper}


@router.put("/papers/{paper_id}/questions")
async def replace_paper_questions(
    paper_id: str,
    body: PaperQuestionReplaceRequest,
    db: DB,
    user: PaperManager,
):
    paper = await paper_service.replace_questions(db, user, paper_id, body)
    if not paper:
        raise _nf()
    return {"paper": paper}


@router.post("/papers/{paper_id}/archive")
async def archive_paper(
    paper_id: str,
    db: DB,
    user: PaperManager,
    revision: str | None = Query(None),
):
    paper = await paper_service.set_archived(db, user, paper_id, True, revision)
    if not paper:
        raise _nf()
    return {"paper": paper}


@router.post("/papers/{paper_id}/restore")
async def restore_paper(
    paper_id: str,
    db: DB,
    user: PaperManager,
    revision: str | None = Query(None),
):
    paper = await paper_service.set_archived(db, user, paper_id, False, revision)
    if not paper:
        raise _nf()
    return {"paper": paper}


@router.delete("/papers/{paper_id}")
async def delete_paper(
    paper_id: str,
    db: DB,
    user: PaperManager,
    revision: str | None = Query(None),
    reason: str | None = Query(None),
):
    deletion = await paper_service.delete_paper(
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
    picked = await question_service.compose_paper(
        db,
        user,
        paper_id,
        body.get("bankIds") or [],
        body.get("quotas") or {},
        body.get("revision"),
    )
    if picked < 0:
        raise _nf()
    return {"picked": picked}


@router.post("/papers/{paper_id}/publish")
async def publish_paper(
    paper_id: str,
    db: DB,
    user: PaperPublisher,
    revision: str | None = Query(None),
):
    paper = await question_service.set_published(db, user, paper_id, True, revision)
    if not paper:
        raise _nf()
    return {"paper": paper_service.serialize_paper(paper)}


@router.post("/papers/{paper_id}/unpublish")
async def unpublish_paper(
    paper_id: str,
    db: DB,
    user: PaperPublisher,
    revision: str | None = Query(None),
):
    paper = await question_service.set_published(db, user, paper_id, False, revision)
    if not paper:
        raise _nf()
    return {"paper": paper_service.serialize_paper(paper)}


@router.get("/paper-categories")
async def list_paper_categories(db: DB, user: PaperManager):
    return {"categories": await paper_service.list_categories(db, user)}


@router.post("/paper-categories")
async def create_paper_category(
    body: PaperCategoryCreateRequest,
    db: DB,
    user: PaperManager,
):
    return {"category": await paper_service.create_category(db, user, body)}


@router.put("/paper-categories/{category_id}")
async def update_paper_category(
    category_id: str,
    body: PaperCategoryUpdateRequest,
    db: DB,
    user: PaperManager,
):
    category = await paper_service.update_category(db, user, category_id, body)
    if not category:
        raise _nf()
    return {"category": category}


@router.delete("/paper-categories/{category_id}")
async def delete_paper_category(
    category_id: str,
    db: DB,
    user: PaperManager,
    revision: str | None = Query(None),
):
    deletion = await paper_service.delete_category(
        db,
        user,
        category_id,
        revision,
    )
    if not deletion:
        raise _nf()
    return {"ok": True, "deletion": deletion}


@router.get("/papers/migration/runtime/scan")
async def scan_runtime_paper_state(
    db: DB,
    user: PaperManager,
    ownerIds: list[str] | None = Query(default=None),
    paperIds: list[str] | None = Query(default=None),
):
    return {
        "report": await question_migration_service.scan_runtime_paper_sources(
            db,
            owner_ids=_parse_id_set(ownerIds),
            paper_ids=_parse_id_set(paperIds),
        )
    }


@router.post("/papers/migration/runtime")
async def migrate_runtime_papers(
    db: DB,
    user: PaperManager,
    apply: bool = Query(default=False),
    ownerIds: list[str] | None = Query(default=None),
    paperIds: list[str] | None = Query(default=None),
):
    return {
        "report": await question_migration_service.migrate_runtime_papers(
            db,
            actor=user,
            apply=apply,
            owner_ids=_parse_id_set(ownerIds),
            paper_ids=_parse_id_set(paperIds),
        )
    }
