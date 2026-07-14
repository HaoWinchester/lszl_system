"""FastAPI 应用入口。"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.middleware.sessions import SessionMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.db.session import AsyncSessionLocal, engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app")


async def _seed_admin() -> None:
    """首次启动且无任何用户时，创建默认管理员 admin / admin123。"""
    from sqlalchemy import func, select

    from app.models.user import User
    from app.schemas.user import UserCreate
    from app.services import user_service

    async with AsyncSessionLocal() as db:
        count = int((await db.execute(select(func.count()).select_from(User))).scalar() or 0)
        if count == 0:
            await user_service.create_user(
                db,
                UserCreate(
                    username="admin",
                    password="admin123",
                    role="admin",
                    display_name="管理员",
                    subject="PMP",
                    source="seed",
                ),
                actor="system",
            )
            logger.info("Seeded default admin: admin / admin123")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时探活 DB、种入默认管理员；失败不阻塞启动。"""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        app.state.db_ok = True
        logger.info("DB connected: %s", settings.DATABASE_URL.split("@")[-1])
        await _seed_admin()
    except Exception as e:  # noqa: BLE001
        app.state.db_ok = False
        app.state.db_err = str(e)
        logger.warning("DB connection failed: %s", e)
    yield
    await engine.dispose()


app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)

app.add_middleware(
    SessionMiddleware,
    secret_key=settings.SECRET_KEY,
    session_cookie="kg_session",
    max_age=60 * 60 * 24 * 7,  # 7 天
    same_site="lax",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "服务器内部错误" if settings.ENV == "prod" else str(exc)},
    )


app.include_router(api_router, prefix=settings.API_V1_PREFIX)
