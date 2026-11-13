"""财务消费记录的请求/响应 schema。"""

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, alias_generators


class FinanceRecordCreate(BaseModel):
    amount: Decimal = Field(gt=0, decimal_places=2, max_digits=12, description="金额（元）")
    purpose: str = Field(min_length=1, max_length=200, description="用途")
    spent_on: date = Field(description="消费日期")
    note: str | None = Field(default=None, max_length=2000, description="备注")


class FinanceRecordUpdate(BaseModel):
    amount: Decimal | None = Field(default=None, gt=0, decimal_places=2, max_digits=12)
    purpose: str | None = Field(default=None, min_length=1, max_length=200)
    spent_on: date | None = None
    note: str | None = Field(default=None, max_length=2000)


class FinanceInvoiceInfo(BaseModel):
    name: str
    mime: str
    size: int
    url: str


class FinanceRecordOut(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        alias_generator=alias_generators.to_camel,
        populate_by_name=True,
    )

    id: str
    amount: Decimal
    purpose: str
    spent_on: date
    note: str | None
    invoice: FinanceInvoiceInfo | None
    created_by: str
    created_at: datetime
    updated_at: datetime


class FinanceMonthlySummary(BaseModel):
    model_config = ConfigDict(alias_generator=alias_generators.to_camel, populate_by_name=True)

    month: str
    total: Decimal
    count: int


class FinanceRecordListOut(BaseModel):
    items: list[FinanceRecordOut]
    monthly: list[FinanceMonthlySummary]
    pagination: dict
