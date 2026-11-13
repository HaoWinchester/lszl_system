"""公司财务消费记录：录入、查询、按月汇总与发票附件管理。

发票文件落盘在 FINANCE_INVOICE_STORAGE/<record_id>/invoice.bin，
仅能通过带 admin/teacher 校验的 API 路由读取，无静态直出。
"""

import asyncio
import hashlib
import re
import shutil
from datetime import date
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from sqlalchemy import extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.finance import FinanceRecord
from app.schemas.finance import (
    FinanceInvoiceInfo,
    FinanceMonthlySummary,
    FinanceRecordCreate,
    FinanceRecordOut,
    FinanceRecordUpdate,
)

INVOICE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".pdf"}
INVOICE_MIMES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
}
MAX_INVOICE_SIZE = 20 * 1024 * 1024
_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


def new_record_id() -> str:
    return "fin_" + uuid4().hex


def invoice_dir(record_id: str) -> Path:
    # 目录名来自服务端生成的 id，不含用户输入，天然规避路径穿越。
    return Path(settings.FINANCE_INVOICE_STORAGE) / record_id


def _month_range(month: str) -> tuple[date, date]:
    year, mon = int(month[:4]), int(month[5:7])
    if mon == 12:
        return date(year, 12, 1), date(year + 1, 1, 1)
    return date(year, mon, 1), date(year, mon + 1, 1)


def _parse_month(month: str | None) -> tuple[date, date] | None:
    if not month:
        return None
    if not _MONTH_RE.match(month):
        raise HTTPException(status_code=422, detail="月份格式应为 YYYY-MM")
    return _month_range(month)


def invoice_info(record: FinanceRecord) -> FinanceInvoiceInfo | None:
    if not record.invoice_path:
        return None
    return FinanceInvoiceInfo(
        name=record.invoice_name or "invoice",
        mime=record.invoice_mime or "application/octet-stream",
        size=record.invoice_size or 0,
        by=record.invoice_by,
        url=f"/api/v1/finance/records/{record.id}/invoice",
    )


def record_to_out(record: FinanceRecord) -> FinanceRecordOut:
    return FinanceRecordOut(
        id=record.id,
        amount=record.amount,
        purpose=record.purpose,
        spent_on=record.spent_on,
        note=record.note,
        invoice=invoice_info(record),
        created_by=record.created_by,
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


async def save_invoice(record_id: str, upload: UploadFile) -> dict:
    """校验并把发票写入 <storage>/<record_id>/invoice.bin，失败时清理。"""
    name = Path(upload.filename or "").name[:255]
    suffix = Path(name).suffix.lower()
    if suffix not in INVOICE_SUFFIXES:
        raise HTTPException(status_code=422, detail="发票仅支持 png/jpg/jpeg/webp/pdf")
    directory = invoice_dir(record_id)
    try:
        directory.mkdir(parents=True, exist_ok=False)
        directory.chmod(0o750)
        size = 0
        digest = hashlib.sha256()
        with (directory / "invoice.bin").open("wb") as target:
            while chunk := await upload.read(64 * 1024):
                size += len(chunk)
                if size > MAX_INVOICE_SIZE:
                    raise HTTPException(status_code=422, detail="发票文件限 20 MiB")
                digest.update(chunk)
                target.write(chunk)
        if size == 0:
            raise HTTPException(status_code=422, detail="发票文件为空")
        (directory / "invoice.bin").chmod(0o640)
        if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
            from app.services.teacher_assistant_documents import validate_image

            await asyncio.to_thread(validate_image, directory / "invoice.bin", suffix)
    except BaseException:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    finally:
        await upload.close()
    return {
        "path": f"{record_id}/invoice.bin",
        "name": name,
        "mime": INVOICE_MIMES[suffix],
        "size": size,
        "digest": digest.hexdigest(),
    }


def resolve_invoice_file(record: FinanceRecord) -> Path:
    if not record.invoice_path:
        raise HTTPException(status_code=404, detail="该记录没有发票附件")
    root = Path(settings.FINANCE_INVOICE_STORAGE).resolve()
    path = (root / record.invoice_path).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise HTTPException(status_code=404, detail="发票文件不存在")
    return path


async def get_record(db: AsyncSession, record_id: str) -> FinanceRecord:
    record = (
        await db.execute(select(FinanceRecord).where(FinanceRecord.id == record_id))
    ).scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="财务记录不存在")
    return record


async def create_record(
    db: AsyncSession, body: FinanceRecordCreate, username: str
) -> FinanceRecordOut:
    purpose = body.purpose.strip()
    if not purpose:
        raise HTTPException(status_code=422, detail="用途不能为空")
    record = FinanceRecord(
        id=new_record_id(),
        amount=body.amount,
        purpose=purpose[:200],
        spent_on=body.spent_on,
        note=(body.note or "").strip() or None,
        created_by=username,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record_to_out(record)


async def attach_invoice(
    db: AsyncSession, record_id: str, upload: UploadFile, username: str
) -> FinanceRecordOut:
    """为已有记录上传/替换发票（先落盘成功再改库，失败不留脏数据）。"""
    record = await get_record(db, record_id)
    info = await save_invoice(record_id, upload)
    record.invoice_path = info["path"]
    record.invoice_name = info["name"]
    record.invoice_mime = info["mime"]
    record.invoice_size = info["size"]
    record.invoice_digest = info["digest"]
    record.invoice_by = username
    await db.commit()
    await db.refresh(record)
    return record_to_out(record)


async def update_record(
    db: AsyncSession, record_id: str, body: FinanceRecordUpdate
) -> FinanceRecordOut:
    record = await get_record(db, record_id)
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="没有需要更新的字段")
    if "purpose" in changes:
        purpose = (changes["purpose"] or "").strip()
        if not purpose:
            raise HTTPException(status_code=422, detail="用途不能为空")
        record.purpose = purpose[:200]
    if "amount" in changes and changes["amount"] is not None:
        record.amount = changes["amount"]
    if "spent_on" in changes and changes["spent_on"] is not None:
        record.spent_on = changes["spent_on"]
    if "note" in changes:
        record.note = (changes["note"] or "").strip() or None
    await db.commit()
    await db.refresh(record)
    return record_to_out(record)


async def delete_record(db: AsyncSession, record_id: str) -> None:
    record = await get_record(db, record_id)
    directory = invoice_dir(record_id)
    await db.delete(record)
    await db.commit()
    shutil.rmtree(directory, ignore_errors=True)


async def list_records(
    db: AsyncSession, month: str | None = None, limit: int = 100, offset: int = 0
) -> dict:
    span = _parse_month(month)
    query = select(FinanceRecord)
    count_query = select(func.count()).select_from(FinanceRecord)
    if span:
        query = query.where(FinanceRecord.spent_on >= span[0], FinanceRecord.spent_on < span[1])
        count_query = count_query.where(
            FinanceRecord.spent_on >= span[0], FinanceRecord.spent_on < span[1]
        )
    total = int((await db.execute(count_query)).scalar() or 0)
    rows = (
        await db.execute(
            query.order_by(FinanceRecord.spent_on.desc(), FinanceRecord.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    return {
        "items": [record_to_out(r) for r in rows],
        "monthly": await monthly_summary(db, month),
        "pagination": {"limit": limit, "offset": offset, "total": total},
    }


async def monthly_summary(db: AsyncSession, month: str | None = None) -> list[dict]:
    """按月汇总全部消费（传 month 时只返回该月）。

    用 extract(year/month) 而非 date_trunc：spent_on 是 Date 列，
    date_trunc 会经 timestamptz 转换引入时区偏移（月初被折到上月末）。
    """
    year_part = extract("year", FinanceRecord.spent_on).label("y")
    month_part = extract("month", FinanceRecord.spent_on).label("m")
    query = select(
        year_part,
        month_part,
        func.coalesce(func.sum(FinanceRecord.amount), Decimal("0")),
        func.count(),
    ).group_by(year_part, month_part)
    if span := _parse_month(month):
        query = query.where(FinanceRecord.spent_on >= span[0], FinanceRecord.spent_on < span[1])
    rows = (await db.execute(query.order_by(year_part.desc(), month_part.desc()))).all()
    return [
        FinanceMonthlySummary(
            month=f"{int(row[0]):04d}-{int(row[1]):02d}",
            total=Decimal(row[2]),
            count=int(row[3]),
        )
        for row in rows
    ]
