"""公司财务消费路由：admin/teacher 可读写，删除仅 admin。"""

from datetime import date
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_role
from app.db.session import get_db
from app.models.user import User
from app.services import finance_service

router = APIRouter(prefix="/finance", tags=["finance"])
DB = Annotated[AsyncSession, Depends(get_db)]
Actor = Annotated[User, Depends(require_role("admin", "teacher"))]
AdminUser = Annotated[User, Depends(require_role("admin"))]

_ALLOWED_MIMES = set(finance_service.INVOICE_MIMES.values())


@router.get("/records")
async def list_records(
    db: DB,
    _: Actor,
    month: str | None = Query(default=None, description="按月过滤，格式 YYYY-MM"),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    return await finance_service.list_records(db, month=month, limit=limit, offset=offset)


@router.post("/records", status_code=201)
async def create_record(
    db: DB,
    actor: Actor,
    amount: float = Form(..., gt=0, description="金额（元）"),
    purpose: str = Form(..., min_length=1, max_length=200),
    spent_on: date = Form(...),
    note: str | None = Form(default=None, max_length=2000),
    invoice: UploadFile | None = File(default=None),
):
    from decimal import Decimal

    from app.schemas.finance import FinanceRecordCreate

    record = await finance_service.create_record(
        db,
        FinanceRecordCreate(
            amount=Decimal(str(amount)),
            purpose=purpose,
            spent_on=spent_on,
            note=note,
        ),
        actor.username,
    )
    if invoice is not None and (invoice.filename or "").strip():
        record = await finance_service.attach_invoice(db, record.id, invoice)
    return record


@router.post("/records/{record_id}/invoice")
async def upload_invoice(db: DB, _: Actor, record_id: str, invoice: UploadFile = File(...)):
    return await finance_service.attach_invoice(db, record_id, invoice)


@router.get("/records/{record_id}")
async def get_record(db: DB, _: Actor, record_id: str):
    from app.services.finance_service import record_to_out

    return record_to_out(await finance_service.get_record(db, record_id))


@router.put("/records/{record_id}")
async def update_record(db: DB, _: Actor, record_id: str, body: dict):
    from app.schemas.finance import FinanceRecordUpdate
    from pydantic import ValidationError

    try:
        payload = FinanceRecordUpdate(**body)
    except ValidationError as error:
        raise HTTPException(status_code=422, detail=error.errors()[0]["msg"]) from error
    return await finance_service.update_record(db, record_id, payload)


@router.delete("/records/{record_id}")
async def delete_record(db: DB, _: AdminUser, record_id: str):
    await finance_service.delete_record(db, record_id)
    return {"ok": True}


@router.get("/records/{record_id}/invoice")
async def download_invoice(db: DB, _: Actor, record_id: str):
    record = await finance_service.get_record(db, record_id)
    mime = record.invoice_mime or ""
    if mime not in _ALLOWED_MIMES:
        raise HTTPException(status_code=404, detail="发票文件类型不受支持")
    path = finance_service.resolve_invoice_file(record)
    return FileResponse(
        path,
        filename=record.invoice_name or "invoice",
        media_type=mime,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
