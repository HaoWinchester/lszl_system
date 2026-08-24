"""图谱文件管理业务逻辑。

按 owner_id（username）隔离。索引（GraphFile）与正文（FileContent）分离：
列表/搜索/排序只读索引；打开/保存才读写正文。
"""

import hashlib
import json

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import now_utc, uid
from app.models.file import (
    ACTIVE,
    CurrentFile,
    FileContent,
    FileTag,
    Folder,
    GraphFile,
    Tag,
    TRASHED,
)


class FileRevisionConflict(ValueError):
    def __init__(self, current_revision: int):
        super().__init__("图谱文件已更新，请重新加载后重试")
        self.current_revision = current_revision


class FolderNotEmpty(ValueError):
    pass


def blank_graph_data(title: str = "知识点关系图谱") -> dict:
    return {
        "meta": {"title": title, "subject": "通用课程", "audience": "", "description": ""},
        "viewport": {"x": 0, "y": 0, "scale": 1},
        "defaults": {
            "nodeSize": "",
            "nodeColor": "#64748b",
            "linkStyle": "solid",
            "linkPathStyle": "curve",
            "linkColor": "#2563eb",
            "flashSwipeSpeed": 2,
        },
        "focusMode": False,
        "selectedNodeId": None,
        "selectedLinkId": None,
        "linkSourceId": None,
        "nodes": [],
        "links": [],
        "importedFlashcards": [],
        "flashReviews": {},
    }


def _byte_size(graph_data: dict) -> int:
    return len(json.dumps(graph_data, ensure_ascii=False).encode("utf-8"))


def _structure_hash(graph_data: dict) -> str:
    nodes = graph_data.get("nodes") or []
    links = graph_data.get("links") or []
    title = (graph_data.get("meta") or {}).get("title", "")
    h = hashlib.md5(f"{len(nodes)}:{len(links)}:{title}".encode("utf-8")).hexdigest()
    return h[:16]


def file_meta(file: GraphFile, tag: Tag | None = None) -> dict:
    return {
        "id": file.id,
        "name": file.name,
        "description": file.description,
        "folderId": file.folder_id,
        "restoreFolderId": file.restore_folder_id,
        "favorite": bool(file.favorite),
        "ownerId": file.owner_id,
        "status": file.status,
        "order": file.order_index,
        "nodeCount": file.node_count,
        "linkCount": file.link_count,
        "byteSize": file.byte_size,
        "revision": file.revision,
        "source": file.source,
        "preview": file.preview,
        "structureHash": file.structure_hash,
        "tag": tag_to_dict(tag) if tag else None,
        "createdAt": file.created_at.isoformat() if file.created_at else None,
        "updatedAt": file.updated_at.isoformat() if file.updated_at else None,
        "lastOpenedAt": file.last_opened_at.isoformat() if file.last_opened_at else None,
        "deletedAt": file.deleted_at.isoformat() if file.deleted_at else None,
    }


def tag_to_dict(tag: Tag) -> dict:
    return {"id": tag.id, "name": tag.name, "color": tag.color}


def folder_to_dict(folder: Folder) -> dict:
    return {
        "id": folder.id,
        "name": folder.name,
        "parentId": folder.parent_id,
        "restoreParentId": folder.restore_parent_id,
        "status": folder.status,
        "order": folder.order_index,
        "createdAt": folder.created_at.isoformat() if folder.created_at else None,
        "updatedAt": folder.updated_at.isoformat() if folder.updated_at else None,
        "deletedAt": folder.deleted_at.isoformat() if folder.deleted_at else None,
    }


SORT_MAP = {
    "updated": GraphFile.updated_at.desc(),
    "created": GraphFile.created_at.desc(),
    "name": GraphFile.name.asc(),
    "size": GraphFile.byte_size.desc(),
    "opened": GraphFile.last_opened_at.desc(),
}


# ---------- 文件查询 ----------
async def list_files(
    db: AsyncSession,
    owner: str,
    *,
    folder_id: str | None = None,
    status: str = ACTIVE,
    query: str | None = None,
    sort: str = "updated",
    page: int = 1,
    page_size: int = 50,
):
    q = select(GraphFile).where(GraphFile.owner_id == owner, GraphFile.status == status)
    if folder_id is not None:
        q = q.where(GraphFile.folder_id == folder_id)
    if query:
        like = f"%{query}%"
        q = q.where(or_(GraphFile.name.ilike(like), GraphFile.description.ilike(like)))

    total = int((await db.execute(select(func.count()).select_from(q.subquery()))).scalar() or 0)

    order = SORT_MAP.get(sort, SORT_MAP["updated"])
    q = q.order_by(order).offset((page - 1) * page_size).limit(page_size)
    files = (await db.execute(q)).scalars().all()

    # 一次性查标签
    tag_map = {}
    if files:
        fids = [f.id for f in files]
        rows = (
            await db.execute(select(FileTag, Tag).join(Tag, Tag.id == FileTag.tag_id).where(FileTag.file_id.in_(fids)))
        ).all()
        for ft, t in rows:
            tag_map[ft.file_id] = t

    return [file_meta(f, tag_map.get(f.id)) for f in files], total


async def get_meta(
    db: AsyncSession,
    owner: str,
    file_id: str,
    *,
    status: str | None = None,
) -> GraphFile | None:
    query = select(GraphFile).where(GraphFile.owner_id == owner, GraphFile.id == file_id)
    if status is not None:
        query = query.where(GraphFile.status == status)
    r = await db.execute(query)
    return r.scalar_one_or_none()


async def get_content(db: AsyncSession, file_id: str) -> FileContent | None:
    return await db.get(FileContent, file_id)


async def open_file(db: AsyncSession, owner: str, file_id: str) -> dict | None:
    f = await get_meta(db, owner, file_id)
    if not f:
        return None
    c = await get_content(db, file_id)
    f.last_opened_at = now_utc()
    await db.commit()
    await db.refresh(f)
    return {
        "meta": file_meta(f),
        "graphData": c.graph_data if c else blank_graph_data(f.name),
        "learningState": c.learning_state if c else None,
    }


# ---------- 文件写 ----------
async def create_file(
    db: AsyncSession,
    owner: str,
    *,
    name: str,
    graph_data: dict | None = None,
    folder_id: str | None = None,
    source: str = "created",
    source_file_id: str | None = None,
) -> GraphFile | None:
    if folder_id is not None:
        folder = await db.scalar(select(Folder).where(
            Folder.id == folder_id,
            Folder.owner_id == owner,
            Folder.status == ACTIVE,
        ))
        if folder is None:
            return None
    graph_data = graph_data or blank_graph_data(name)
    file_id = uid("f_")
    file = GraphFile(
        id=file_id,
        owner_id=owner,
        name=name,
        folder_id=folder_id,
        node_count=len(graph_data.get("nodes") or []),
        link_count=len(graph_data.get("links") or []),
        byte_size=_byte_size(graph_data),
        source=source,
        source_file_id=source_file_id,
        structure_hash=_structure_hash(graph_data),
    )
    db.add(file)
    await db.flush()  # 先写入 graph_files 行，满足 file_contents 外键依赖
    db.add(FileContent(file_id=file_id, graph_data=graph_data, learning_state={}))
    await db.commit()
    await db.refresh(file)
    return file


async def save_file(
    db: AsyncSession,
    owner: str,
    file_id: str,
    graph_data: dict,
    learning_state: dict | None = None,
    expected_revision: int | None = None,
) -> GraphFile | None:
    f = await db.scalar(
        select(GraphFile).where(
            GraphFile.owner_id == owner,
            GraphFile.id == file_id,
            GraphFile.status == ACTIVE,
        ).with_for_update()
    )
    if not f:
        return None
    current_revision = max(1, int(f.revision or 1))
    if expected_revision is not None and expected_revision != current_revision:
        raise FileRevisionConflict(current_revision)
    c = await get_content(db, file_id)
    next_revision = current_revision + 1
    if c:
        c.graph_data = graph_data
        if learning_state is not None:
            c.learning_state = learning_state
        c.revision = next_revision
        c.saved_at = now_utc()
    else:
        db.add(FileContent(
            file_id=file_id,
            graph_data=graph_data,
            learning_state=learning_state or {},
            revision=next_revision,
        ))
    f.node_count = len(graph_data.get("nodes") or [])
    f.link_count = len(graph_data.get("links") or [])
    f.byte_size = _byte_size(graph_data)
    f.revision = next_revision
    f.structure_hash = _structure_hash(graph_data)
    await db.commit()
    await db.refresh(f)
    return f


async def rename_file(db: AsyncSession, owner: str, file_id: str, name: str) -> GraphFile | None:
    f = await get_meta(db, owner, file_id)
    if not f:
        return None
    f.name = name
    # 同步 graphData.meta.title
    c = await get_content(db, file_id)
    if c and isinstance(c.graph_data, dict):
        meta = c.graph_data.setdefault("meta", {})
        meta["title"] = name
    await db.commit()
    await db.refresh(f)
    return f


async def set_file_favorite(
    db: AsyncSession,
    owner: str,
    file_id: str,
    favorite: bool,
) -> GraphFile | None:
    f = await get_meta(db, owner, file_id)
    if not f:
        return None
    f.favorite = bool(favorite)
    await db.commit()
    await db.refresh(f)
    return f


async def move_file(db: AsyncSession, owner: str, file_id: str, folder_id: str | None) -> GraphFile | None:
    f = await get_meta(db, owner, file_id)
    if not f:
        return None
    if folder_id is not None:
        folder = await db.scalar(select(Folder).where(
            Folder.id == folder_id, Folder.owner_id == owner, Folder.status == ACTIVE
        ))
        if folder is None:
            return None
    f.folder_id = folder_id
    await db.commit()
    await db.refresh(f)
    return f


async def trash_file(db: AsyncSession, owner: str, file_id: str) -> bool:
    f = await get_meta(db, owner, file_id, status=ACTIVE)
    if not f:
        return False
    f.status = TRASHED
    f.restore_folder_id = f.folder_id
    f.folder_id = None
    f.deleted_at = now_utc()
    current = await db.get(CurrentFile, owner)
    if current and current.file_id == file_id:
        replacement = await db.scalar(
            select(GraphFile)
            .where(
                GraphFile.owner_id == owner,
                GraphFile.status == ACTIVE,
                GraphFile.id != file_id,
            )
            .order_by(GraphFile.order_index, GraphFile.created_at, GraphFile.id)
        )
        current.file_id = replacement.id if replacement else None
    await db.commit()
    return True


async def restore_file(db: AsyncSession, owner: str, file_id: str) -> GraphFile | None:
    f = await get_meta(db, owner, file_id, status=TRASHED)
    if not f:
        return None
    f.status = ACTIVE
    f.deleted_at = None
    desired_folder_id = f.restore_folder_id
    if desired_folder_id is not None:
        folder = await db.scalar(select(Folder).where(
            Folder.id == desired_folder_id,
            Folder.owner_id == owner,
            Folder.status == ACTIVE,
        ))
        f.folder_id = desired_folder_id if folder is not None else None
    f.restore_folder_id = None
    await db.commit()
    await db.refresh(f)
    return f


async def delete_permanent(db: AsyncSession, owner: str, file_id: str) -> bool:
    f = await get_meta(db, owner, file_id, status=TRASHED)
    if not f:
        return False
    c = await get_content(db, file_id)
    if c:
        await db.delete(c)
    # 标签关联
    links = (await db.execute(select(FileTag).where(FileTag.file_id == file_id))).scalars().all()
    for l in links:
        await db.delete(l)
    current = await db.get(CurrentFile, owner)
    if current and current.file_id == file_id:
        current.file_id = None
    await db.delete(f)
    await db.commit()
    return True


async def empty_trash(db: AsyncSession, owner: str) -> dict[str, int]:
    files = (
        await db.execute(select(GraphFile).where(GraphFile.owner_id == owner, GraphFile.status == TRASHED))
    ).scalars().all()
    deleted_files = 0
    for f in files:
        links = (await db.execute(select(FileTag).where(FileTag.file_id == f.id))).scalars().all()
        for link in links:
            await db.delete(link)
        content = await get_content(db, f.id)
        if content:
            await db.delete(content)
        await db.delete(f)
        deleted_files += 1
    folders = list((await db.scalars(select(Folder).where(
        Folder.owner_id == owner,
        Folder.status == TRASHED,
    ))).all())
    current = await db.get(CurrentFile, owner)
    if current and any(file.id == current.file_id for file in files):
        current.file_id = None
    # 先断开自引用，再删除，避免 ORM 将父子 DELETE 合并成无序 executemany。
    for folder in folders:
        folder.parent_id = None
    await db.flush()
    remaining = {folder.id: folder for folder in folders}
    deleted_folders = 0
    while remaining:
        leaf_ids = {
            folder_id
            for folder_id in remaining
            if not any(candidate.parent_id == folder_id for candidate in remaining.values())
        }
        if not leaf_ids:
            leaf_ids = {next(iter(remaining))}
        for folder_id in leaf_ids:
            await db.delete(remaining.pop(folder_id))
            deleted_folders += 1
    await db.commit()
    return {"deletedFiles": deleted_files, "deletedFolders": deleted_folders}


async def duplicate_file(db: AsyncSession, owner: str, file_id: str, name: str | None = None) -> GraphFile | None:
    f = await get_meta(db, owner, file_id)
    if not f:
        return None
    c = await get_content(db, file_id)
    new_name = name or f"{f.name} 副本"
    return await create_file(
        db,
        owner,
        name=new_name,
        graph_data=c.graph_data if c else None,
        folder_id=f.folder_id,
        source="duplicate",
        source_file_id=f.id,
    )


# ---------- 文件夹 ----------
async def list_folders(db: AsyncSession, owner: str, status: str = ACTIVE) -> list[Folder]:
    r = await db.execute(
        select(Folder)
        .where(Folder.owner_id == owner, Folder.status == status)
        .order_by(Folder.order_index, Folder.created_at, Folder.id)
    )
    return list(r.scalars().all())


async def get_folder(
    db: AsyncSession,
    owner: str,
    folder_id: str,
    *,
    status: str | None = None,
) -> Folder | None:
    query = select(Folder).where(Folder.owner_id == owner, Folder.id == folder_id)
    if status is not None:
        query = query.where(Folder.status == status)
    return await db.scalar(query)


async def _folder_descendant_ids(
    db: AsyncSession,
    owner: str,
    folder_id: str,
) -> set[str]:
    folders = list((await db.scalars(select(Folder).where(Folder.owner_id == owner))).all())
    descendants: set[str] = set()
    queue = [folder_id]
    while queue:
        parent_id = queue.pop(0)
        for folder in folders:
            if folder.parent_id == parent_id and folder.id not in descendants:
                descendants.add(folder.id)
                queue.append(folder.id)
    return descendants


async def create_folder(
    db: AsyncSession,
    owner: str,
    name: str,
    parent_id: str | None = None,
) -> Folder | None:
    if parent_id is not None and await get_folder(
        db, owner, parent_id, status=ACTIVE
    ) is None:
        return None
    folder = Folder(id=uid("d_"), owner_id=owner, name=name, parent_id=parent_id)
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return folder


async def rename_folder(db: AsyncSession, owner: str, folder_id: str, name: str) -> Folder | None:
    f = await get_folder(db, owner, folder_id)
    if not f:
        return None
    f.name = name
    await db.commit()
    await db.refresh(f)
    return f


async def move_folder(
    db: AsyncSession,
    owner: str,
    folder_id: str,
    parent_id: str | None,
) -> Folder | None:
    folder = await get_folder(db, owner, folder_id, status=ACTIVE)
    if folder is None or parent_id == folder_id:
        return None
    if parent_id is not None:
        parent = await get_folder(db, owner, parent_id, status=ACTIVE)
        if parent is None:
            return None
        if parent_id in await _folder_descendant_ids(db, owner, folder_id):
            return None
    folder.parent_id = parent_id
    await db.commit()
    await db.refresh(folder)
    return folder


async def delete_folder(db: AsyncSession, owner: str, folder_id: str) -> bool:
    """文件夹软删除：其下文件一并移入回收站。"""
    root = await get_folder(db, owner, folder_id, status=ACTIVE)
    if not root:
        return False
    affected = {folder_id} | await _folder_descendant_ids(db, owner, folder_id)
    now = now_utc()
    folders = list((await db.scalars(select(Folder).where(
        Folder.owner_id == owner,
        Folder.id.in_(affected),
    ))).all())
    for folder in folders:
        folder.status = TRASHED
        folder.deleted_at = now
        if folder.id == folder_id:
            folder.restore_parent_id = folder.parent_id
            folder.parent_id = None
    files = (await db.execute(select(GraphFile).where(
        GraphFile.owner_id == owner,
        GraphFile.folder_id.in_(affected),
        GraphFile.status == ACTIVE,
    ))).scalars().all()
    for file in files:
        file.status = TRASHED
        file.deleted_at = now
    current = await db.get(CurrentFile, owner)
    if current and any(file.id == current.file_id for file in files):
        replacement = await db.scalar(
            select(GraphFile)
            .where(GraphFile.owner_id == owner, GraphFile.status == ACTIVE)
            .order_by(GraphFile.order_index, GraphFile.created_at, GraphFile.id)
        )
        current.file_id = replacement.id if replacement else None
    await db.commit()
    return True


async def restore_folder(
    db: AsyncSession,
    owner: str,
    folder_id: str,
) -> Folder | None:
    root = await get_folder(db, owner, folder_id, status=TRASHED)
    if root is None:
        return None
    affected = {folder_id} | await _folder_descendant_ids(db, owner, folder_id)
    desired_parent_id = root.restore_parent_id
    if desired_parent_id is not None and await get_folder(
        db, owner, desired_parent_id, status=ACTIVE
    ) is None:
        desired_parent_id = None
    folders = list((await db.scalars(select(Folder).where(
        Folder.owner_id == owner,
        Folder.id.in_(affected),
    ))).all())
    for folder in folders:
        folder.status = ACTIVE
        folder.deleted_at = None
        if folder.id == folder_id:
            folder.parent_id = desired_parent_id
            folder.restore_parent_id = None
    files = list((await db.scalars(select(GraphFile).where(
        GraphFile.owner_id == owner,
        GraphFile.folder_id.in_(affected),
        GraphFile.status == TRASHED,
    ))).all())
    for file in files:
        file.status = ACTIVE
        file.deleted_at = None
    await db.commit()
    await db.refresh(root)
    return root


async def delete_folder_permanent(
    db: AsyncSession,
    owner: str,
    folder_id: str,
) -> bool:
    root = await get_folder(db, owner, folder_id, status=TRASHED)
    if root is None:
        return False
    affected = {folder_id} | await _folder_descendant_ids(db, owner, folder_id)
    file_count = int((await db.execute(
        select(func.count()).select_from(GraphFile).where(
            GraphFile.owner_id == owner,
            GraphFile.folder_id.in_(affected),
        )
    )).scalar() or 0)
    if file_count:
        raise FolderNotEmpty("文件夹中仍有文件，请先删除其中的文件或清空回收站")
    folders = list((await db.scalars(select(Folder).where(
        Folder.owner_id == owner,
        Folder.id.in_(affected),
    ))).all())
    for folder in folders:
        folder.parent_id = None
    await db.flush()
    for folder in folders:
        await db.delete(folder)
    await db.commit()
    return True


# ---------- 标签 ----------
async def list_tags(db: AsyncSession, owner: str) -> list[Tag]:
    r = await db.execute(select(Tag).where(Tag.owner_id == owner))
    return list(r.scalars().all())


async def create_tag(db: AsyncSession, owner: str, name: str, color: str = "#64748b") -> Tag:
    tag = Tag(id=uid("t_"), owner_id=owner, name=name, color=color)
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return tag


async def update_tag(db: AsyncSession, owner: str, tag_id: str, patch: dict) -> Tag | None:
    r = await db.execute(select(Tag).where(Tag.owner_id == owner, Tag.id == tag_id))
    t = r.scalar_one_or_none()
    if not t:
        return None
    if "name" in patch:
        t.name = patch["name"]
    if "color" in patch:
        t.color = patch["color"]
    await db.commit()
    await db.refresh(t)
    return t


async def delete_tag(db: AsyncSession, owner: str, tag_id: str) -> bool:
    r = await db.execute(select(Tag).where(Tag.owner_id == owner, Tag.id == tag_id))
    t = r.scalar_one_or_none()
    if not t:
        return False
    links = (await db.execute(select(FileTag).where(FileTag.tag_id == tag_id))).scalars().all()
    for l in links:
        await db.delete(l)
    await db.delete(t)
    await db.commit()
    return True


async def set_file_tag(db: AsyncSession, owner: str, file_id: str, tag_id: str | None) -> bool:
    if not await get_meta(db, owner, file_id):
        return False
    if tag_id is not None:
        tag = await db.scalar(select(Tag).where(Tag.id == tag_id, Tag.owner_id == owner))
        if tag is None:
            return False
    existing = (
        await db.execute(select(FileTag).where(FileTag.file_id == file_id))
    ).scalar_one_or_none()
    if existing:
        await db.delete(existing)
    if tag_id:
        db.add(FileTag(file_id=file_id, tag_id=tag_id))
    await db.commit()
    return True


# ---------- 当前文件 ----------
async def get_current(db: AsyncSession, owner: str) -> str | None:
    r = await db.get(CurrentFile, owner)
    return r.file_id if r else None


async def set_current(db: AsyncSession, owner: str, file_id: str | None) -> bool:
    if file_id is not None:
        file = await db.scalar(select(GraphFile).where(
            GraphFile.id == file_id, GraphFile.owner_id == owner, GraphFile.status == ACTIVE
        ))
        if file is None:
            return False
    r = await db.get(CurrentFile, owner)
    if r:
        r.file_id = file_id
    else:
        db.add(CurrentFile(owner_id=owner, file_id=file_id))
    await db.commit()
    return True


# ---------- 统计 ----------
async def storage_stats(db: AsyncSession, owner: str) -> dict:
    base = select(GraphFile).where(GraphFile.owner_id == owner)
    active_q = base.where(GraphFile.status == ACTIVE)
    trashed_q = base.where(GraphFile.status == TRASHED)
    active = (await db.execute(active_q)).scalars().all()
    trashed = (await db.execute(trashed_q)).scalars().all()
    return {
        "activeCount": len(active),
        "trashedCount": len(trashed),
        "activeBytes": sum(f.byte_size for f in active),
        "trashedBytes": sum(f.byte_size for f in trashed),
        "totalNodes": sum(f.node_count for f in active),
        "totalLinks": sum(f.link_count for f in active),
    }


# ---------- 旧数据导入（localStorage v2 → SQL）----------
async def import_legacy(db: AsyncSession, owner: str, payload: dict) -> dict:
    """导入前端打包的旧数据：{files:[{id,name,folderId,graphData,createdAt,...}], folders:[...]}"""
    folders = payload.get("folders") or []
    tags = payload.get("tags") or []
    files = payload.get("files") or payload.get("contents") or []

    folder_id_map: dict[str, str] = {}
    for fd in folders:
        new = await create_folder(db, owner, fd.get("name", "文件夹"), None)
        folder_id_map[fd.get("id")] = new.id

    tag_id_map: dict[str, str] = {}
    for tg in tags:
        new = await create_tag(db, owner, tg.get("name", "标签"), tg.get("color", "#64748b"))
        tag_id_map[tg.get("id")] = new.id

    imported = 0
    for rec in files:
        graph_data = rec.get("graphData") or rec.get("graph_data") or blank_graph_data(rec.get("name", "图谱"))
        name = rec.get("name") or (graph_data.get("meta") or {}).get("title") or "导入的图谱"
        folder_id = folder_id_map.get(rec.get("folderId") or rec.get("folder_id"))
        f = await create_file(
            db, owner, name=name, graph_data=graph_data, folder_id=folder_id, source="legacy-import"
        )
        imported += 1

    return {"imported": imported, "folders": len(folder_id_map), "tags": len(tag_id_map)}
