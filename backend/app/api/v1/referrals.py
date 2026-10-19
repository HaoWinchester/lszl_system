"""Authenticated self-only referral code and aggregate endpoints."""
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import CurrentUser
from app.db.session import get_db
from app.schemas.referral import ReferralSummary
from app.services import referral_service

router = APIRouter(prefix='/me/referral', tags=['auth'])
DB = Annotated[AsyncSession, Depends(get_db)]


@router.get('', response_model=ReferralSummary)
async def get_referral(user: CurrentUser, db: DB):
    return await referral_service.summary(db, user.username)


@router.post('', response_model=ReferralSummary)
async def create_referral(user: CurrentUser, db: DB):
    username = user.username
    try:
        await referral_service.ensure_code(db, username)
        result = await referral_service.summary(db, username)
        await db.commit()
        return result
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=503, detail=str(exc)) from exc
