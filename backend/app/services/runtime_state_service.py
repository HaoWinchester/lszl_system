"""Validate and persist known new-legacy storage mutations in PostgreSQL."""

from __future__ import annotations

import re
import json
from urllib.parse import quote

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.runtime_state import RuntimeState
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.user import User
from app.services import file_service, guided_learning_service, user_service
from app.web.bootstrap import PAGE_NAMESPACES
from app.web.schemas import RuntimeMutation, RuntimeStateUpdate

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
    "kg_local_users_v1",
    "kg_local_current_user_v1",
    "通用知识点关系图谱工具_多科目重点聚焦版_v2",
    "通用知识点关系图谱工具_悬浮菜单位置_v1",
    "通用知识点关系图谱工具_新手引导已看_v1",
    "kg_activity_collections_v1",
    "kg_activity_tags_v1",
    "kg_admin_audit_log_v1",
    "kg_admin_settings_v1",
    "kg_admin_transaction_snapshots_v1",
    "kg_assessment_papers_v1",
    "kg_content_activity_overrides_v1",
    "kg_content_organization_migration_v1",
    "kg_content_subjects_v1",
    "kg_content_taxonomies_v1",
    "kg_course_admin_recent_v862_p2",
    "kg_course_admin_workspace_v862_p1",
    "kg_course_config_active_release_v1",
    "kg_course_config_drafts_v1",
    "kg_course_config_releases_v1",
    "kg_deep_recall_legacy_owner_v1",
    "kg_exam_paper_release_history_v1",
    "kg_exam_papers_published_v1",
    "kg_guided_practice_return_v1",
    "kg_learning_tasks_v1",
    "kg_paper_workspace_layout_v1",
    "kg_question_banks_published_v1",
    "kg_question_classification_collapsed_v1",
    "kg_question_library_workspace_layout_v1",
    "kg_question_tag_names_v1",
    "kg_taxonomy_deletion_records_v1",
    "kg_taxonomy_import_records_v1",
    "kg_taxonomy_release_records_v1",
    "kg_teacher_workbench_subject_v1",
    "kg_wechat_login_pending_v1",
    # v9.0-p4.1.1 新增业务键（公告 / 训练 UI 偏好 / 用户反馈）
    "kg_announcements_v1",
    "kg_question_training_filters_collapsed_v1",
    "kg_question_training_workspace_layout_v1",
    "kg_user_feedback_v1",
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
    "kg_multi_question_analysis_sections_v1__",
    "kg_multi_question_font_scale_v1__",
    "kg_multi_question_highlight_color_v1__",
    "kg_multi_question_paper_selection_v1__",
    "kg_canvas_workspace_catalog_v2__",
    "kg_canvas_workspace_v1__",
    "kg_deep_recall_progress_v1__",
    "通用知识点关系图谱工具_多科目重点聚焦版_v2__user__",
    "kg_deep_recall_current_question_v2__",
    "kg_deep_recall_explored_v2__",
    "kg_deep_recall_progress_v2__",
    "kg_exam_paper_categories_v1__",
    "kg_guided_path_scroll_v3__",
    "kg_multi_workspace_closed_tabs_v1__",
    "kg_recall_association_library_v1__",
    # v9.0-p4.1.1 新增业务键（动态 id / subject 后缀）
    "kg_practice_history_v1__",
    "kg_practice_active_attempt_v1__",
    "kg_recall_association_management_v1__",
    "kg_user_feedback_reply_reads_v1__",
    "kg_user_message_reads_v1__",
)


# v9 的"全局共享"键——published 类发布内容。前端把它们当全局读（无 scope 前缀），
# 后端存独立 shared_runtime_states 表，所有用户读同一份，从而教师发布 → 学员可读（跨账号共享）。
SHARED_KEYS = frozenset({
    # 发布类（教师发布 → 学员读取）
    "kg_question_banks_published_v1",
    "kg_exam_papers_published_v1",
    "kg_course_config_releases_v1",
    "kg_course_config_active_release_v1",
    "kg_learning_tasks_v1",
    # 全局教学内容（管理员/教师配一份，所有用户看；扫 updata-legacy 确认无 scope 拼接）
    "kg_content_subjects_v1",
    "kg_content_taxonomies_v1",
    "kg_content_activity_overrides_v1",
    "kg_content_organization_migration_v1",
    "kg_activity_collections_v1",
    "kg_activity_tags_v1",
    "kg_question_tag_names_v1",
    "kg_taxonomy_release_records_v1",
    "kg_taxonomy_deletion_records_v1",
    "kg_taxonomy_import_records_v1",
    "kg_exam_paper_release_history_v1",
    # 管理后台全局设置（低频写；审计/事务快照等高频写键暂不加入，避免并发竞态）
    "kg_admin_settings_v1",
})

TEACHING_SHARED_KEYS = SHARED_KEYS - {"kg_admin_settings_v1"}
PUBLISHER_COLLECTION_KEYS = frozenset({
    "kg_question_banks_published_v1",
    "kg_exam_papers_published_v1",
    "kg_course_config_releases_v1",
    "kg_learning_tasks_v1",
    "kg_activity_collections_v1",
})
SERVER_OWNED_KEYS = frozenset({"kg_announcements_v1", "kg_user_feedback_v1"})


class RuntimeStateValidationError(ValueError):
    pass


class RuntimeStateConflictError(ValueError):
    pass


class RuntimeStatePermissionError(ValueError):
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
    expected_namespace = PAGE_NAMESPACES.get(update.page, "page")
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
    for mutation in update.mutations:
        if not key_allowed(mutation.key):
            raise RuntimeStateValidationError(f"存储键未登记：{mutation.key}")
        if mutation.operation == "setItem" and mutation.value is None:
            raise RuntimeStateValidationError(f"setItem 缺少 value：{mutation.key}")
        if mutation.value is not None and len(mutation.value.encode("utf-8")) > MAX_VALUE_BYTES:
            raise RuntimeStateValidationError(f"存储项超过大小限制：{mutation.key}")
    total = sum(
        len(key.encode("utf-8")) + len(value.encode("utf-8"))
        for key, value in update.storage.items()
    )
    if total > MAX_TOTAL_BYTES:
        raise RuntimeStateValidationError("账号运行数据超过大小限制")
    if not re.fullmatch(r"[A-Za-z0-9._:-]+", update.requestId):
        raise RuntimeStateValidationError("请求 ID 格式不正确")


def shared_key_writable(key: str, role: str) -> bool:
    if key == "kg_admin_settings_v1":
        return role == "admin"
    return key in TEACHING_SHARED_KEYS and role in {"admin", "teacher"}


def shared_key_readable(key: str, role: str) -> bool:
    return key != "kg_admin_settings_v1" or role == "admin"


def server_owned_key(key: str) -> bool:
    return key in SERVER_OWNED_KEYS


def private_runtime_storage(raw: object) -> dict[str, str]:
    values = raw if isinstance(raw, dict) else {}
    return {
        str(key): str(value)
        for key, value in values.items()
        if str(key) not in SHARED_KEYS and str(key) not in SERVER_OWNED_KEYS
    }


def update_mutations(update: RuntimeStateUpdate) -> list[RuntimeMutation]:
    if update.mutations:
        return list(update.mutations)
    if update.operation in {"setItem", "removeItem"} and update.key:
        return [RuntimeMutation(operation=update.operation, key=update.key, value=update.value)]
    return []


def explicit_shared_mutations(update: RuntimeStateUpdate) -> list[RuntimeMutation]:
    return [mutation for mutation in update_mutations(update) if mutation.key in SHARED_KEYS]


def _publisher_id(item: object, key: str) -> str:
    if not isinstance(item, dict):
        return ""
    if key == "kg_learning_tasks_v1":
        authorship = item.get("authorship")
        if isinstance(authorship, dict):
            return str(authorship.get("createdByUserId") or "")
        return ""
    if key == "kg_activity_collections_v1":
        authorship = item.get("authorship")
        if isinstance(authorship, dict):
            return str(authorship.get("createdByUserId") or "")
        return ""
    publisher = item.get("publishedBy")
    if isinstance(publisher, dict):
        return str(publisher.get("id") or publisher.get("username") or "")
    return str(publisher or "")


def visible_shared_value(key: str, value: str, owner: str) -> str:
    """Remove account-private records before a shared collection reaches a browser."""
    if key != "kg_activity_collections_v1":
        return value
    try:
        rows = json.loads(value or "[]")
    except (TypeError, ValueError, json.JSONDecodeError):
        return "[]"
    if not isinstance(rows, list):
        return "[]"
    visible = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("visibility") or "private") == "shared" or _publisher_id(row, key) == owner:
            visible.append(row)
    return _json(visible)


def merge_shared_value(key: str, existing: str, incoming: str, owner: str) -> str:
    """Keep other publishers' rows when one publisher replaces its own catalog."""
    if key not in PUBLISHER_COLLECTION_KEYS:
        return incoming
    try:
        old_rows = json.loads(existing or "[]")
        new_rows = json.loads(incoming or "[]")
    except (TypeError, ValueError, json.JSONDecodeError):
        return incoming
    if not isinstance(old_rows, list) or not isinstance(new_rows, list):
        return incoming
    retained = [row for row in old_rows if _publisher_id(row, key) != owner]
    owned = [row for row in new_rows if _publisher_id(row, key) == owner]
    return _json([*retained, *owned])


def remove_publisher_rows(key: str, existing: str, owner: str) -> str:
    """Remove only the caller's rows from a multi-publisher shared catalog."""
    if key not in PUBLISHER_COLLECTION_KEYS:
        return ""
    try:
        rows = json.loads(existing or "[]")
    except (TypeError, ValueError, json.JSONDecodeError):
        return "[]"
    if not isinstance(rows, list):
        return "[]"
    return _json([row for row in rows if _publisher_id(row, key) != owner])


async def get_state(db: AsyncSession, owner: str) -> tuple[dict[str, str], int]:
    row = await db.get(RuntimeState, owner)
    user = await db.get(User, owner)
    role = user.role if user else "viewer"
    storage = private_runtime_storage(row.storage if row else {})
    revision = row.revision if row else 0
    # 合并 v9 全局共享键（published 类）：所有用户读同一份，教师发布 → 学员可读。
    result = await db.execute(select(SharedRuntimeState.key, SharedRuntimeState.value))
    for key, value in result:
        if key in SHARED_KEYS and shared_key_readable(key, role):
            storage[key] = visible_shared_value(key, str(value), owner)
    return storage, revision


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
        return await get_state(db, user.username)

    if row is None:
        row = RuntimeState(owner_id=user.username, storage=storage, revision=1)
        db.add(row)
    else:
        row.storage = storage
        row.revision += 1
    await db.commit()
    await db.refresh(row)
    return await get_state(db, user.username)


async def apply_update(
    db: AsyncSession,
    owner: str,
    role: str,
    update: RuntimeStateUpdate,
) -> tuple[dict[str, str], int]:
    validate_update(update)
    protected_mutations = [
        mutation.key for mutation in update_mutations(update) if server_owned_key(mutation.key)
    ]
    if protected_mutations:
        raise RuntimeStatePermissionError(
            f"该数据只能通过专用接口修改：{protected_mutations[0]}"
        )
    shared_mutations = explicit_shared_mutations(update)
    forbidden = [mutation.key for mutation in shared_mutations if not shared_key_writable(mutation.key, role)]
    if forbidden:
        raise RuntimeStatePermissionError(f"当前角色无权限修改共享内容：{forbidden[0]}")
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

    # 拆分：v9 全局共享键（published 类）→ 虚拟 SHARED_OWNER；其余 → 当前 owner。
    own_part = {
        k: v for k, v in storage.items()
        if k not in SHARED_KEYS and k not in SERVER_OWNED_KEYS
    }
    for key in SERVER_OWNED_KEYS:
        if key in current_storage:
            own_part[key] = current_storage[key]

    total = sum(len(k.encode("utf-8")) + len(v.encode("utf-8")) for k, v in own_part.items())
    if total > MAX_TOTAL_BYTES:
        raise RuntimeStateValidationError("账号运行数据超过大小限制")

    if row is None:
        row = RuntimeState(
            owner_id=owner,
            storage=own_part,
            revision=1,
            last_request_id=update.requestId,
        )
        db.add(row)
    else:
        row.storage = own_part
        row.revision += 1
        row.last_request_id = update.requestId

    # 共享区只接受本批次显式 mutation，避免完整账号快照把其他发布者的新内容覆盖掉。
    for mutation in shared_mutations:
        key = mutation.key
        await _lock_owner(db, f"shared:{key}")
        shared_row = await db.get(SharedRuntimeState, key)
        if mutation.operation == "removeItem":
            if shared_row is not None:
                if key in PUBLISHER_COLLECTION_KEYS:
                    shared_row.value = remove_publisher_rows(key, shared_row.value, owner)
                    shared_row.updated_by = owner
                else:
                    await db.delete(shared_row)
            continue
        value = str(mutation.value or "")
        if shared_row is None:
            db.add(SharedRuntimeState(
                key=key,
                value=merge_shared_value(key, "[]", value, owner),
                updated_by=owner,
            ))
        else:
            shared_row.value = merge_shared_value(key, shared_row.value, value, owner)
            shared_row.updated_by = owner

    await db.commit()
    await db.refresh(row)
    return await get_state(db, owner)
