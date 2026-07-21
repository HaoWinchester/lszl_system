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
from app.web.routes import router as web_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app")


async def _seed_admin() -> None:
    """幂等创建系统默认账号与教学演示账号。"""
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

        seed_users = (
            ("佩奇007", "admin"),
            ("老师", "teacher"),
            ("学生", "student"),
            ("乔治008", "viewer"),
        )
        for username, role in seed_users:
            if await user_service.get_by_username(db, username):
                continue
            await user_service.create_user(
                db,
                UserCreate(
                    username=username,
                    password="111111",
                    role=role,
                    display_name=username,
                    subject="PMP",
                    source="seed",
                ),
                actor="system",
            )
            logger.info("Seeded role account: %s (%s)", username, role)


async def _seed_guided_course() -> None:
    """校验并幂等导入 new-legacy v8.6 引导学习课程。"""
    from app.services import guided_learning_service

    async with AsyncSessionLocal() as db:
        course = await guided_learning_service.ensure_seeded(db)
        logger.info("Seeded guided course: %s %s", course.id, course.version)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时探活 DB、种入默认管理员；失败不阻塞启动。"""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        app.state.db_ok = True
        logger.info("DB connected: %s", settings.DATABASE_URL.split("@")[-1])
        await _seed_admin()
        await _seed_guided_course()
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
app.include_router(web_router)
