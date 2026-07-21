"""Validate and persist known new-legacy storage mutations in PostgreSQL."""

from __future__ import annotations

import re
import json
from urllib.parse import quote

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.runtime_state import RuntimeState
from app.models.user import User
from app.services import file_service, guided_learning_service, user_service
from app.web.bootstrap import PAGE_NAMESPACES
from app.web.schemas import RuntimeStateUpdate

MAX_VALUE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 48 * 1024 * 1024

EXACT_KEYS = {
    "kg_default_entry_mode_v1",
    "kg_question_language_mode_v1",
    "kg_global_shortcuts_layout_v1",
    "kg_global_shortcuts_position_v1",
    "kg_graph_user_preferences_v1",
    "kg_graph_closed_tabs_v1",
    "kg_graph_current_file_v1",
    "kg_graph_current_file_v2",
    "kg_graph_file_index_v2",
    "kg_graph_file_library_v1",
    "kg_graph_file_migration_v2",
    "kg_graph_file_tags_v1",
    "kg_graph_file_tags_v2",
    "kg_graph_folders_v1",
    "kg_graph_recent_opened_migration_v1",
    "kg_home_file_library_v1",
    "kg_file_manager_details_open_v1",
    "kg_file_manager_folder_section_collapsed_v1",
    "kg_file_manager_layout_v1",
    "kg_file_manager_recent_folders_v1",
    "kg_file_manager_sidebar_collapsed_v1",
    "kg_file_manager_sort_v1",
    "kg_file_manager_theme_v1",
    "kg_deep_recall_current_question_v1",
    "kg_deep_recall_theme_platform_migrated_v1",
    "kg_deep_recall_theme_v1",
    "kg_multi_question_analysis_sections_v1",
    "kg_multi_question_font_scale_v1",
    "kg_multi_question_highlight_color_v1",
    "kg_multi_question_paper_selection_v1",
    "kg_question_training_route_v1",
    "pmp_question_font_size_v1",
    "pmp_question_font_size_v2",
    "kg_role_themes_v1",
    "kg_student_subscription_orders_v1",
    "kg_student_subscription_redeem_codes_v1",
    "kg_student_subscriptions_v1",
    "kg_subscription_plan_model_v2_migrated",
    "kg_subscription_plan_settings_v1",
    "kg_user_admin_logs_v1",
    "kg_wechat_login_config_v1",
    "kg_wechat_login_pending_v1",
    "kg_local_users_v1",
    "kg_local_current_user_v1",
    "通用知识点关系图谱工具_多科目重点聚焦版_v2",
    "通用知识点关系图谱工具_悬浮菜单位置_v1",
    "通用知识点关系图谱工具_新手引导已看_v1",
}

PREFIXES = (
    "kg_graph_file_content_v2__",
    "kg_guided_learning_progress_v1__",
    "kg_guided_learning_progress_v2__",
    "kg_guided_path_scroll_v2__",
    "kg_question_bank_demo_suppressed_v1__",
    "kg_question_banks_v1__",
    "kg_question_current_v1__",
    "kg_exam_papers_v1__",
    "kg_exam_current_v1__",
    "kg_learning_sessions_v2__",
    "kg_learning_events_v1__",
    "kg_learning_rounds_v1__",
    "kg_canvas_workspace_catalog_v2__",
    "kg_canvas_workspace_v1__",
    "kg_deep_recall_progress_v1__",
)


class RuntimeStateValidationError(ValueError):
    pass


class RuntimeStateConflictError(ValueError):
    pass


async def _lock_owner(db: AsyncSession, owner: str) -> None:
    """Serialize state creation and revision checks for one account.

    A row lock cannot protect the first write because the row may not exist yet.
    PostgreSQL's transaction advisory lock covers both first-write creation and
    later optimistic revision checks without blocking unrelated accounts.
    """
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:owner, 0))"),
        {"owner": owner},
    )


def key_allowed(key: str) -> bool:
    return key in EXACT_KEYS or any(key.startswith(prefix) for prefix in PREFIXES)


def validate_update(update: RuntimeStateUpdate) -> None:
    expected_namespace = PAGE_NAMESPACES.get(update.page)
    if expected_namespace != update.namespace:
        raise RuntimeStateValidationError("页面与数据域不匹配")
    if update.operation == "clear":
        raise RuntimeStateValidationError("正式数据不允许整库清空")
    if not key_allowed(update.key):
        raise RuntimeStateValidationError(f"存储键未登记：{update.key}")
    if update.value is not None and len(update.value.encode("utf-8")) > MAX_VALUE_BYTES:
        raise RuntimeStateValidationError("单项数据超过大小限制")
    for key, value in update.storage.items():
        if not key_allowed(key):
            raise RuntimeStateValidationError(f"存储键未登记：{key}")
        if len(value.encode("utf-8")) > MAX_VALUE_BYTES:
            raise RuntimeStateValidationError(f"存储项超过大小限制：{key}")
    total = sum(
        len(key.encode("utf-8")) + len(value.encode("utf-8"))
        for key, value in update.storage.items()
    )
    if total > MAX_TOTAL_BYTES:
        raise RuntimeStateValidationError("账号运行数据超过大小限制")
    if not re.fullmatch(r"[A-Za-z0-9._:-]+", update.requestId):
        raise RuntimeStateValidationError("请求 ID 格式不正确")


async def get_state(db: AsyncSession, owner: str) -> tuple[dict[str, str], int]:
    row = await db.get(RuntimeState, owner)
    if row is None:
        return {}, 0
    return {str(key): str(value) for key, value in (row.storage or {}).items()}, row.revision


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _milliseconds(value) -> int:
    return int(value.timestamp() * 1000) if value else 0


async def _seed_users(db: AsyncSession, storage: dict[str, str]) -> bool:
    users, _ = await user_service.list_users(db, page=1, page_size=1000)
    payload = {
        user.username: {
            "username": user.username,
            "role": user.role,
            "status": user.status,
            "displayName": user.display_name or user.username,
            "email": user.email or "",
            "phone": user.phone or "",
            "subject": user.subject or "PMP",
            "tags": user.tags or [],
            "note": user.note or "",
            "source": user.source or "server",
            "createdAt": _milliseconds(user.created_at),
            "updatedAt": _milliseconds(user.updated_at),
            "lastLoginAt": _milliseconds(user.last_login_at),
            "lastActiveAt": _milliseconds(user.last_active_at),
            "archivedAt": _milliseconds(user.archived_at),
            "salt": "",
            "hash": "",
        }
        for user in users
    }
    serialized = _json(payload)
    if storage.get("kg_local_users_v1") == serialized:
        return False
    storage["kg_local_users_v1"] = serialized
    return True


async def _seed_files(db: AsyncSession, owner: str, storage: dict[str, str]) -> bool:
    if "kg_graph_file_index_v2" in storage:
        return False
    active, _ = await file_service.list_files(db, owner, status="active", page=1, page_size=200)
    trashed, _ = await file_service.list_files(db, owner, status="trashed", page=1, page_size=200)
    files = [*active, *trashed]
    index = []
    for order, meta in enumerate(files, start=1):
        file_id = str(meta["id"])
        content_key = f"kg_graph_file_content_v2__{quote(owner, safe='')}__{quote(file_id, safe='')}"
        opened = await file_service.open_file(db, owner, file_id)
        graph_data = opened["graphData"] if opened else file_service.blank_graph_data(str(meta.get("name") or "图谱"))
        learning_state = opened.get("learningState") if opened else {}
        entry = {
            "schemaVersion": 2,
            "id": file_id,
            "owner": owner,
            "name": meta.get("name") or "我的知识图谱",
            "description": meta.get("description") or "",
            "tags": [meta["tag"]["name"]] if meta.get("tag") else [],
            "favorite": bool(meta.get("tag")),
            "folderId": meta.get("folderId"),
            "restoreFolderId": None,
            "createdAt": _iso_milliseconds(meta.get("createdAt")),
            "updatedAt": _iso_milliseconds(meta.get("updatedAt")),
            "lastOpenedAt": _iso_milliseconds(meta.get("lastOpenedAt")),
            "order": order * 1000,
            "status": meta.get("status") or "active",
            "deletedAt": None,
            "nodeCount": int(meta.get("nodeCount") or 0),
            "linkCount": int(meta.get("linkCount") or 0),
            "byteSize": int(meta.get("byteSize") or 0),
            "revision": int(meta.get("revision") or 1),
            "source": meta.get("source") or "server-import",
            "sourceFileId": "",
            "preview": meta.get("preview"),
            "contentKey": content_key,
        }
        index.append(entry)
        storage[content_key] = _json({
            "schemaVersion": 2,
            "graphData": graph_data,
            "learningState": learning_state or {},
            "revision": entry["revision"],
            "savedAt": entry["updatedAt"],
        })
    folders = [
        *await file_service.list_folders(db, owner, "active"),
        *await file_service.list_folders(db, owner, "trashed"),
    ]
    tags = await file_service.list_tags(db, owner)
    current = await file_service.get_current(db, owner)
    storage["kg_graph_file_index_v2"] = _json(index)
    storage["kg_graph_current_file_v2"] = _json({owner: current or (index[0]["id"] if index else "")})
    storage["kg_graph_folders_v1"] = _json([
        {
            "schemaVersion": 1,
            "id": folder.id,
            "owner": owner,
            "name": folder.name,
            "parentId": folder.parent_id,
            "status": folder.status,
            "createdAt": _milliseconds(folder.created_at),
            "updatedAt": _milliseconds(folder.updated_at),
        }
        for folder in folders
    ])
    storage["kg_graph_file_tags_v2"] = _json({
        owner: [file_service.tag_to_dict(tag) for tag in tags]
    })
    storage["kg_graph_file_migration_v2"] = _json({
        "schemaVersion": 2,
        "source": "postgresql",
    })
    return True


def _iso_milliseconds(value) -> int:
    if not value:
        return 0
    from datetime import datetime

    try:
        return int(datetime.fromisoformat(str(value)).timestamp() * 1000)
    except (ValueError, TypeError):
        return 0


async def _seed_guided(db: AsyncSession, owner: str, storage: dict[str, str]) -> bool:
    package = await guided_learning_service.default_course_package(db)
    course_id = str(package["course"]["id"])
    key = f"kg_guided_learning_progress_v2__{quote(owner, safe='')}__{quote(course_id, safe='')}"
    if key in storage:
        return False
    progress, _ = await guided_learning_service.get_progress(db, owner, course_id)
    preferences = progress.get("preferences") if isinstance(progress.get("preferences"), dict) else {}
    storage[key] = _json(progress)
    storage.setdefault("kg_question_language_mode_v1", str(preferences.get("languageMode") or "zh"))
    storage.setdefault("kg_default_entry_mode_v1", str(preferences.get("defaultMode") or "learning"))
    return True


async def ensure_domain_seed(
    db: AsyncSession,
    user: User,
    page: str,
    storage: dict[str, str],
    revision: int,
) -> tuple[dict[str, str], int]:
    await _lock_owner(db, user.username)
    row = await db.get(RuntimeState, user.username)
    if row is None:
        storage = {}
        revision = 0
    else:
        storage = dict(row.storage or {})
        revision = row.revision

    changed = False
    if page in {"user-management.html", "system-settings.html"} and user.role == "admin":
        changed = await _seed_users(db, storage) or changed
    if page in {"index.html", "file-manager.html"}:
        changed = await _seed_files(db, user.username, storage) or changed
    if page in {
        "learning-path.html",
        "guided-learning-node.html",
        "guided-learning-placement-test.html",
    }:
        changed = await _seed_guided(db, user.username, storage) or changed
    if not changed:
        await db.commit()
        return storage, revision

    if row is None:
        row = RuntimeState(owner_id=user.username, storage=storage, revision=1)
        db.add(row)
    else:
        row.storage = storage
        row.revision += 1
    await db.commit()
    await db.refresh(row)
    return dict(row.storage or {}), row.revision


async def apply_update(
    db: AsyncSession,
    owner: str,
    update: RuntimeStateUpdate,
) -> tuple[dict[str, str], int]:
    validate_update(update)
    await _lock_owner(db, owner)
    row = await db.get(RuntimeState, owner)
    if row is not None and row.last_request_id == update.requestId:
        return dict(row.storage or {}), row.revision
    current_revision = row.revision if row else 0
    if update.revision != current_revision:
        raise RuntimeStateConflictError("数据已更新，请重新加载后重试")

    current_storage = dict(row.storage or {}) if row else {}
    storage = dict(update.storage) if update.snapshotMode == "full" else {
        **current_storage,
        **update.storage,
    }
    if update.operation == "setItem":
        if update.value is None:
            raise RuntimeStateValidationError("setItem 缺少 value")
        storage[update.key] = update.value
    elif update.operation == "removeItem":
        storage.pop(update.key, None)

    total = sum(len(key.encode("utf-8")) + len(value.encode("utf-8")) for key, value in storage.items())
    if total > MAX_TOTAL_BYTES:
        raise RuntimeStateValidationError("账号运行数据超过大小限制")

    if row is None:
        row = RuntimeState(
            owner_id=owner,
            storage=storage,
            revision=1,
            last_request_id=update.requestId,
        )
        db.add(row)
    else:
        row.storage = storage
        row.revision += 1
        row.last_request_id = update.requestId
    await db.commit()
    await db.refresh(row)
    return dict(row.storage or {}), row.revision
