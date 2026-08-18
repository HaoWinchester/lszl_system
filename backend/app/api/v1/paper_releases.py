"""关系化发布试卷 API。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_permissions
from app.db.session import get_db
from app.models.user import User
from app.schemas.paper_release import PaperReleasePublishRequest, PaperReleaseWithdrawRequest
from app.services import paper_release_service


router = APIRouter(prefix="/paper-releases", tags=["paper-releases"])
DB = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
Publisher = Annotated[User, Depends(require_permissions("managePapers", "publishPapers"))]


def _nf() -> HTTPException:
    return HTTPException(status_code=404, detail="发布版本不存在或无权访问")


@router.post("/papers/{paper_id}/publish")
async def publish_paper(paper_id: str, body: PaperReleasePublishRequest, db: DB, user: Publisher):
    release = await paper_release_service.publish(
        db, user, paper_id,
        expected_revision=body.revision,
        access_level=body.access_level,
        enabled_modes=body.enabled_modes,
        allowed_roles=body.allowed_roles,
        metadata=body.metadata,
    )
    if release is None:
        raise _nf()
    return {"release": paper_release_service.release_to_dict(release)}


@router.post("/{release_id}/withdraw")
async def withdraw_release(
    release_id: str,
    body: PaperReleaseWithdrawRequest,
    db: DB,
    user: Publisher,
):
    release = await paper_release_service.withdraw(
        db, user, release_id, expected_revision=body.revision
    )
    if release is None:
        raise _nf()
    return {"release": paper_release_service.release_to_dict(release)}


@router.get("/papers/{paper_id}/history")
async def release_history(
    paper_id: str,
    db: DB,
    user: Publisher,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, alias="pageSize", ge=1, le=100),
):
    result = await paper_release_service.history(
        db, user, paper_id, page=page, page_size=page_size
    )
    return {
        **result,
        "releases": [paper_release_service.release_to_dict(item) for item in result["releases"]],
    }


@router.get("/catalog")
async def release_catalog(
    db: DB,
    user: CurrentUser,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, alias="pageSize", ge=1, le=200),
):
    return await paper_release_service.catalog(db, user, page=page, page_size=page_size)


@router.get("/{release_id}")
async def release_detail(release_id: str, db: DB, user: CurrentUser):
    release = await paper_release_service.detail(db, user, release_id)
    if release is None:
        raise _nf()
    return {"release": release}


@router.get("/{release_id}/questions")
async def release_questions(
    release_id: str,
    db: DB,
    user: CurrentUser,
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    seed: str | None = Query(default=None, max_length=128),
):
    result = await paper_release_service.questions(
        db, user, release_id, limit=limit, offset=offset, seed=seed
    )
    if result is None:
        raise _nf()
    return result
