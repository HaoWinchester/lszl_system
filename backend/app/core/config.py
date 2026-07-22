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

    # 微信网站应用凭证仅允许由后端运行环境提供，绝不下发到浏览器。
    WECHAT_APP_ID: str = ""
    WECHAT_APP_SECRET: str = ""
    WECHAT_REDIRECT_URI: str = "https://lszl.aihuanpu.com/api/v1/auth/wechat/callback"
    WECHAT_ENABLE_OFFICIAL: bool | None = None
    WECHAT_ENABLE_DEMO: bool | None = None

    NEW_LEGACY_RELEASE_ROOT: str = str(PROJECT_ROOT / "frontend" / "new-legacy-releases")
    NEW_LEGACY_FALLBACK_SITE: str = str(PROJECT_ROOT / "frontend" / "public" / "new-legacy")


settings = Settings()
