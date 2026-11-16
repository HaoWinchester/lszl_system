"""公司财务消费记录模型（公司级全局数据，不按 owner 隔离）。"""

from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class FinanceRecord(Base):
    """一笔公司消费：金额、用途、日期、备注与可选发票附件。

    与业务表的 owner 隔离不同，财务记录全公司共享：
    admin/teacher 均可读写，删除仅限 admin。
    """

    __tablename__ = "finance_records"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_finance_records_amount_positive"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    amount: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    purpose: Mapped[str] = mapped_column(String(200), nullable=False)
    spent_on: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 发票附件（可空）：磁盘相对路径 / 原始文件名 / mime / 字节数 / sha256
    invoice_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    invoice_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    invoice_mime: Mapped[str | None] = mapped_column(String(80), nullable=True)
    invoice_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    invoice_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 发票上传人（最后替换发票的人；与录入人可以不同）
    invoice_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by: Mapped[str] = mapped_column(
        String(64), ForeignKey("users.username"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
