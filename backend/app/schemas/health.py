"""健康检查响应 schema。"""

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    db: str
    time: str
    db_time: str | None = None
