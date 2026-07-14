"""异步数据库引擎与会话工厂。"""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings

# connect_args={"host": "/tmp"} 与 DATABASE_URL 的 ?host=/tmp 双保险，
# 确保走本机 Homebrew PG 的 Unix socket（不监听 TCP）。
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args={"host": "/tmp"},
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
