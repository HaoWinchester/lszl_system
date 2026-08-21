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
    QUESTION_CATALOG_CUTOVER_ENABLED: bool = False
    # runtime KV 同步开关：true 时 PUT/POST /runtime/state 接收即弃（回当前版本号，不落库）。
    # 2026-08-21 回退退役切换（原设计 §11）：教师试卷/分类草稿尚未迁入领域 API，
    # 仍依赖 runtime KV 持久化；丢弃写入会导致"保存显示成功但刷新即回退"。
    # 待业务数据全部迁入领域 API 后再置回 true。
    RUNTIME_SYNC_DISABLED: bool = False
    # Content Prep 题目级校验临时关闭（2026-08 录入提速需求）：
    # true 时共享草稿同步/批量上传/单题保存跳过题目校验阻断（仅记录 warning 日志，批次内重复 ID 仍拦截）。
    # 恢复校验：删掉环境变量并重启即可，无需改代码。
    CONTENT_PREP_VALIDATION_DISABLED: bool = False
    # Production authentication requires the browser to submit this release's
    # legal-consent version. Tests disable it only for pre-existing fixtures.
    LEGAL_CONSENT_REQUIRED: bool = True

    # itsdangerous 签名密钥（生产必改）
    SECRET_KEY: str = "change-me-in-prod"

    # 会话 Cookie 配置（本地联机默认同站点同浏览器 7 天）
    SESSION_COOKIE_NAME: str = "kg_session"
    SESSION_MAX_AGE_SECONDS: int = 60 * 60 * 24 * 7
    SESSION_HOST_CANONICAL: str = "127.0.0.1"
    SESSION_CANONICALIZE_LOCALHOST: bool = False

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

    # 微信 Native 支付凭证仅允许由部署环境和受限文件提供，禁止写入数据库。
    WECHAT_PAY_ENABLE_DEMO: bool | None = None
    WECHAT_PAY_MCH_ID: str = ""
    WECHAT_PAY_API_V3_KEY: str = ""
    WECHAT_PAY_MCH_SERIAL_NO: str = ""
    WECHAT_PAY_MCH_PRIVATE_KEY_FILE: str = ""
    WECHAT_PAY_WX_PUBLIC_KEY_FILE: str = ""
    WECHAT_PAY_WX_PUBLIC_KEY_ID: str = ""
    WECHAT_PAY_APP_ID: str = ""
    WECHAT_PAY_NOTIFY_URL: str = ""
    WECHAT_PAY_MONTHLY_AMOUNT_FEN: int = 2900

    NEW_LEGACY_RELEASE_ROOT: str = str(PROJECT_ROOT / "frontend" / "new-legacy-releases")
    NEW_LEGACY_FALLBACK_SITE: str = str(PROJECT_ROOT / "frontend" / "public" / "new-legacy")


settings = Settings()
