"""图谱文件管理路由。所有操作按当前登录用户 owner 隔离。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.db.session import get_db
from app.services import file_service

router = APIRouter(prefix="/files", tags=["files"])
DB = Annotated[AsyncSession, Depends(get_db)]


def _nf() -> HTTPException:
    return HTTPException(status_code=404, detail="文件不存在")


# ---------- 列表 / 创建 ----------
@router.get("")
async def list_files(
    db: DB,
    user: CurrentUser,
    folder_id: str | None = Query(None),
    status: str = Query("active"),
    query: str | None = Query(None),
    sort: str = Query("updated"),
    page: int = 1,
    page_size: int = 50,
):
    files, total = await file_service.list_files(
        db, user.username, folder_id=folder_id, status=status, query=query, sort=sort, page=page, page_size=page_size
    )
    return {"files": files, "total": total, "page": page, "page_size": page_size}


@router.post("")
async def create_file(body: dict, db: DB, user: CurrentUser):
    f = await file_service.create_file(
        db,
        user.username,
        name=body.get("name", "新图谱"),
        graph_data=body.get("graphData"),
        folder_id=body.get("folderId"),
    )
    return {"file": file_service.file_meta(f)}


# ---------- 固定路径（须在 {id} 之前）----------
@router.get("/current")
async def get_current(db: DB, user: CurrentUser):
    return {"fileId": await file_service.get_current(db, user.username)}


@router.put("/current")
async def set_current(body: dict, db: DB, user: CurrentUser):
    await file_service.set_current(db, user.username, body.get("fileId"))
    return {"ok": True}


@router.get("/stats")
async def stats(db: DB, user: CurrentUser):
    return await file_service.storage_stats(db, user.username)


@router.post("/import-legacy")
async def import_legacy(body: dict, db: DB, user: CurrentUser):
    return await file_service.import_legacy(db, user.username, body)


@router.post("/trash/empty")
async def empty_trash(db: DB, user: CurrentUser):
    n = await file_service.empty_trash(db, user.username)
    return {"deleted": n}


@router.get("/folders")
async def list_folders(db: DB, user: CurrentUser, status: str = Query("active")):
    return {"folders": [file_service.folder_to_dict(f) for f in await file_service.list_folders(db, user.username, status)]}


@router.post("/folders")
async def create_folder(body: dict, db: DB, user: CurrentUser):
    f = await file_service.create_folder(db, user.username, body.get("name", "新建文件夹"), body.get("parentId"))
    return {"folder": file_service.folder_to_dict(f)}


@router.patch("/folders/{folder_id}")
async def rename_folder(folder_id: str, body: dict, db: DB, user: CurrentUser):
    f = await file_service.rename_folder(db, user.username, folder_id, body.get("name", ""))
    if not f:
        raise _nf()
    return {"folder": file_service.folder_to_dict(f)}


@router.delete("/folders/{folder_id}")
async def delete_folder(folder_id: str, db: DB, user: CurrentUser):
    ok = await file_service.delete_folder(db, user.username, folder_id)
    if not ok:
        raise _nf()
    return {"ok": True}


@router.get("/tags")
async def list_tags(db: DB, user: CurrentUser):
    return {"tags": [file_service.tag_to_dict(t) for t in await file_service.list_tags(db, user.username)]}


@router.post("/tags")
async def create_tag(body: dict, db: DB, user: CurrentUser):
    t = await file_service.create_tag(db, user.username, body.get("name", "标签"), body.get("color", "#64748b"))
    return {"tag": file_service.tag_to_dict(t)}


@router.patch("/tags/{tag_id}")
async def update_tag(tag_id: str, body: dict, db: DB, user: CurrentUser):
    t = await file_service.update_tag(db, user.username, tag_id, body)
    if not t:
        raise _nf()
    return {"tag": file_service.tag_to_dict(t)}


@router.delete("/tags/{tag_id}")
async def delete_tag(tag_id: str, db: DB, user: CurrentUser):
    await file_service.delete_tag(db, user.username, tag_id)
    return {"ok": True}


@router.put("/{file_id}/tag")
async def set_file_tag(file_id: str, body: dict, db: DB, user: CurrentUser):
    ok = await file_service.set_file_tag(db, user.username, file_id, body.get("tagId"))
    if not ok:
        raise _nf()
    return {"ok": True}


# ---------- 单文件 ----------
@router.get("/{file_id}")
async def open_file(file_id: str, db: DB, user: CurrentUser):
    r = await file_service.open_file(db, user.username, file_id)
    if not r:
        raise _nf()
    return r


@router.put("/{file_id}")
async def save_file(file_id: str, body: dict, db: DB, user: CurrentUser):
    f = await file_service.save_file(
        db, user.username, file_id, body.get("graphData", {}), body.get("learningState")
    )
    if not f:
        raise _nf()
    return {"file": file_service.file_meta(f)}


@router.patch("/{file_id}")
async def patch_file(file_id: str, body: dict, db: DB, user: CurrentUser):
    if "name" in body:
        f = await file_service.rename_file(db, user.username, file_id, body["name"])
    elif "folderId" in body:
        f = await file_service.move_file(db, user.username, file_id, body.get("folderId"))
    else:
        raise HTTPException(status_code=400, detail="未指定操作（name 或 folderId）")
    if not f:
        raise _nf()
    return {"file": file_service.file_meta(f)}


@router.delete("/{file_id}")
async def trash_file(file_id: str, db: DB, user: CurrentUser):
    if not await file_service.trash_file(db, user.username, file_id):
        raise _nf()
    return {"ok": True}


@router.post("/{file_id}/restore")
async def restore_file(file_id: str, db: DB, user: CurrentUser):
    f = await file_service.restore_file(db, user.username, file_id)
    if not f:
        raise _nf()
    return {"file": file_service.file_meta(f)}


@router.delete("/{file_id}/permanent")
async def delete_permanent(file_id: str, db: DB, user: CurrentUser):
    if not await file_service.delete_permanent(db, user.username, file_id):
        raise _nf()
    return {"ok": True}


@router.post("/{file_id}/duplicate")
async def duplicate_file(file_id: str, body: dict, db: DB, user: CurrentUser):
    f = await file_service.duplicate_file(db, user.username, file_id, body.get("name"))
    if not f:
        raise _nf()
    return {"file": file_service.file_meta(f)}
