"""健康检查：实际连库验证 DB 连通性。"""

from datetime import datetime, timezone

from fastapi import APIRouter
from sqlalchemy import text

from app.db.session import AsyncSessionLocal
from app.schemas.health import HealthResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    db_status = "ok"
    db_time = None
    try:
        async with AsyncSessionLocal() as session:
            result = await session.execute(text("SELECT now()"))
            db_time = result.scalar()
    except Exception as e:  # noqa: BLE001 - 健康检查应返回错误而非抛出
        db_status = f"error: {e}"

    return HealthResponse(
        status="ok",
        db=db_status,
        time=datetime.now(timezone.utc).isoformat(),
        db_time=db_time.isoformat() if db_time else None,
    )
