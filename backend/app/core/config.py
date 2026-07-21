"""应用配置：从 .env 读取。"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ENV: str = "dev"
    APP_NAME: str = "KG Graph API"
    API_V1_PREFIX: str = "/api/v1"

    # itsdangerous 签名密钥（生产必改）
    SECRET_KEY: str = "change-me-in-prod"

    # PostgreSQL（async）。本机 Homebrew PG 用 /tmp socket，不监听 TCP。
    DATABASE_URL: str = "postgresql+asyncpg://menghao@/kg_graph_dev?host=/tmp"

    # CORS 允许来源（allow_credentials=True 时不能用 *）
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    NEW_LEGACY_RELEASE_ROOT: str = str(PROJECT_ROOT / "frontend" / "new-legacy-releases")
    NEW_LEGACY_FALLBACK_SITE: str = str(PROJECT_ROOT / "frontend" / "public" / "new-legacy")


settings = Settings()
