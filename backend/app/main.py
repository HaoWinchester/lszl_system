"""FastAPI 应用入口。"""

import logging
import math
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import text
from starlette.middleware.sessions import SessionMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.db.session import AsyncSessionLocal, engine
from app.services.builtin_teaching_content_seed_service import BuiltinSeedSummary
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
                    password="jbgsnmm~123",
                    role="admin",
                    display_name="管理员",
                    subject="PMP",
                    source="seed",
                ),
                actor="system",
            )
            logger.info("Seeded default admin account")

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


async def _seed_builtin_teaching_content() -> BuiltinSeedSummary | None:
    """Synchronize packaged teaching data without changing DB health state on failure."""
    from app.services import builtin_teaching_content_seed_service

    try:
        async with AsyncSessionLocal() as db:
            summary = await builtin_teaching_content_seed_service.sync_builtin_teaching_content(
                db
            )
        logger.info(
            "Built-in teaching content synced: created=%s updated=%s unchanged=%s",
            summary.created,
            summary.updated,
            summary.unchanged,
        )
        return summary
    except Exception:  # noqa: BLE001
        logger.exception("Built-in teaching content sync failed")
        return None


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
    if app.state.db_ok:
        await _seed_builtin_teaching_content()
    yield
    await engine.dispose()


app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)


def _validation_error_json(value: Any) -> Any:
    """Keep invalid non-finite numbers from breaking the validation response itself."""
    if isinstance(value, float) and not math.isfinite(value):
        return "non-finite number"
    if isinstance(value, dict):
        return {key: _validation_error_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_validation_error_json(item) for item in value]
    return value


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(
    _request: Request, exc: RequestValidationError
):
    errors = _validation_error_json(jsonable_encoder(exc.errors()))
    return JSONResponse(status_code=422, content={"detail": errors})


def _normalize_localhost_request(request: Request):
    if (
        not settings.SESSION_CANONICALIZE_LOCALHOST
        or settings.ENV == "prod"
        or (hostname := request.url.hostname or "") == ""
        or settings.SESSION_HOST_CANONICAL is None
    ):
        return None

    # Accept localhost family hostnames (including local test domains) for stable
    # cookie/session sharing in development environments.
    if request.url.path.startswith("/api/"):
        return None

    if hostname != "localhost" and not hostname.startswith("localhost."):
        return None

    canonical_host = settings.SESSION_HOST_CANONICAL
    canonical_netloc = (
        str(canonical_host)
        if request.url.port is None
        else f"{canonical_host}:{request.url.port}"
    )
    canonical_url = request.url.replace(netloc=canonical_netloc)
    return RedirectResponse(str(canonical_url), status_code=307)


@app.middleware("http")
async def ensure_shared_local_session(request: Request, call_next):
    redirect_response = _normalize_localhost_request(request)
    if redirect_response is not None:
        return redirect_response
    return await call_next(request)

app.add_middleware(
    SessionMiddleware,
    secret_key=settings.SECRET_KEY,
    session_cookie=settings.SESSION_COOKIE_NAME,
    max_age=settings.SESSION_MAX_AGE_SECONDS,
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
