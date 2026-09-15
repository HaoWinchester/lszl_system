from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.db.session import get_db
from app.schemas.practice_growth import PracticeGrowthGoalUpdate
from app.services import practice_growth_service

router = APIRouter(prefix="/learning/practice/growth", tags=["learning"])
DB = Annotated[AsyncSession, Depends(get_db)]


@router.get("")
async def get_growth(db: DB, user: CurrentUser):
    return await practice_growth_service.growth_summary(db, user.username)


@router.put("/goal")
async def put_growth_goal(body: PracticeGrowthGoalUpdate, db: DB, user: CurrentUser):
    return await practice_growth_service.update_goal(db, user.username, body.goal)
