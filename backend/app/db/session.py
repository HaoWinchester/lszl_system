"""异步数据库引擎与会话工厂。"""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings

# 本机开发走 Homebrew PG 的 Unix socket（DATABASE_URL 带 ?host=/tmp 时加双保险）；
# 生产容器走 TCP 连接 compose 的 db 服务，此时不能传 host（asyncpg 会误判为 socket 路径）。
_connect_args = {"host": "/tmp"} if "host=" in settings.DATABASE_URL else {}
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args=_connect_args,
    poolclass=NullPool,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def get_db():
    """FastAPI 依赖：提供一个异步 DB 会话。"""
    async with AsyncSessionLocal() as session:
        yield session
