"""Validate and persist known new-legacy storage mutations in PostgreSQL."""

from __future__ import annotations

import re
import json
import hashlib
from datetime import datetime, timezone
from urllib.parse import quote

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.runtime_state import RuntimeState
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.subscription import Subscription
from app.models.user import User
from app.services import (
    file_service,
    guided_learning_service,
    subscription_service,
    teaching_content_projection_service,
    teaching_content_revision_service,
    user_service,
)
from app.web.bootstrap import PAGE_NAMESPACES
from app.web.schemas import RuntimeMutation, RuntimeStateUpdate

MAX_VALUE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 48 * 1024 * 1024
LOGIN_ENTRY_CONSUMED_PREFIX = "kg_learning_entry_chooser_consumed_v1__"
MAX_LOGIN_ENTRY_CLAIMS = 32
LOGIN_ENTRY_SERVER_OWNED_KEYS = frozenset({
    "kg_learning_entry_chooser_claim_v1",
    "kg_learning_entry_chooser_consumed_v1",
})

DEPRECATED_QUESTION_EXACT_KEYS = frozenset({
    "kg_question_banks_published_v1",
    "kg_principle_repository_v1",
    "kg_synthesis_preset_repository_v1",
    "kg_question_tag_names_v1",
})
DEPRECATED_QUESTION_PREFIXES = ("kg_question_banks_v1__",)

EXACT_KEYS = {
    "kg_default_entry_mode_v1",
    "kg_question_language_mode_v1",
    "kg_global_shortcuts_layout_v1",
    "kg_global_shortcuts_position_v1",
    "kg_graph_user_preferences_v1",
    "kg_canvas_view_preferences_v1",
    "kg_graph_recent_colors_v1",
    "kg_home_interaction_mode_v1",
    "kg_home_professional_flow_v1",
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
    "kg_learning_entry_chooser_claim_v1",
    "kg_learning_entry_chooser_consumed_v1",
    "kg_learning_tasks_v1",
    "kg_paper_workspace_layout_v1",
    "kg_question_classification_collapsed_v1",
    "kg_question_library_workspace_layout_v1",
    "kg_taxonomy_deletion_records_v1",
    "kg_taxonomy_import_records_v1",
    "kg_taxonomy_release_records_v1",
    "kg_teacher_workbench_subject_v1",
    "kg_wechat_login_pending_v1",
    # v9.0-p4.1.1 新增业务键（公告 / 训练 UI 偏好 / 用户反馈）
    "kg_announcements_v1",
    "kg_question_training_filters_collapsed_v1",
    "kg_question_training_workspace_layout_v1",
    "kg_training_workspace_layout_v1",
    "kg_multi_question_release_selection_v1",
    "kg_user_feedback_v1",
    "pmp_recall_acceptance_records_v1",
    "question_studio_draft_v010",
    "question_studio_draft_v020",
    "question_studio_draft_v021",
    "question_studio_backups_v010",
    "question_studio_backups_v020",
    "question_studio_backups_v021",
    "question_studio_recent_knowledge_v1",
    "question_studio_favorite_knowledge_v1",
}

PREFIXES = (
    "kg_graph_file_content_v2__",
    "kg_guided_learning_progress_v1__",
    "kg_guided_learning_progress_v2__",
    "kg_guided_path_scroll_v2__",
    "kg_question_bank_demo_suppressed_v1__",
    "kg_question_current_v1__",
    "kg_exam_papers_v1__",
    "kg_exam_current_v1__",
    "kg_learning_sessions_v2__",
    "kg_learning_active_context_v1__",
    "kg_learning_events_v1__",
    "kg_learning_rounds_v1__",
    LOGIN_ENTRY_CONSUMED_PREFIX,
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
    # P4.5 browser compatibility contract. Practice and management remain
    # owner-scoped runtime state; the subject-scoped library is teacher-shared.
    "kg_practice_mistakes_v1__user__",
    "kg_recall_association_management_v1__subject__",
    "kg_recall_association_library_v1__subject__",
    # v9.0-p4.1.1 新增业务键（动态 id / subject 后缀）
    "kg_practice_history_v1__",
    "kg_practice_active_attempt_v1__",
    "kg_practice_attempts_v1__",
    "kg_multi_question_release_selection_v1__",
    "kg_ui_resizable_region_v1__",
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
    "kg_principle_repository_v1",
    "kg_synthesis_preset_repository_v1",
    # 管理后台全局设置（低频写；审计/事务快照等高频写键暂不加入，避免并发竞态）
    "kg_admin_settings_v1",
})

TEACHING_MANAGER_ROLES = frozenset({"admin", "teacher"})
TEACHER_SHARED_EXACT_KEYS = frozenset({
    "kg_course_config_drafts_v1",
    "kg_assessment_papers_v1",
})
TEACHER_SHARED_SCOPED_PREFIXES = {
    "kg_exam_papers_v1__user__": "kg_exam_papers_v1__teacher_shared",
    "kg_exam_paper_categories_v1__user__": "kg_exam_paper_categories_v1__teacher_shared",
}
TEACHER_SHARED_RESTRICTED_PREFIXES = (
    "kg_exam_papers_v1__",
    "kg_exam_paper_categories_v1__",
)
RECALL_ASSOCIATION_PREFIX = "kg_recall_association_library_v1__"
TEACHER_SHARED_GLOBAL_PREFIXES = (
    f"{RECALL_ASSOCIATION_PREFIX}subject__",
)
TEACHER_SHARED_SCOPED_CANONICAL_KEYS = frozenset(
    TEACHER_SHARED_SCOPED_PREFIXES.values()
)
TEACHER_SHARED_PROMOTION_MARKER_KEY = "kg_teacher_shared_runtime_promotion_v1"
TEACHING_SHARED_KEYS = SHARED_KEYS - {"kg_admin_settings_v1"}
PUBLISHER_COLLECTION_KEYS = frozenset({
    "kg_question_banks_published_v1",
    "kg_exam_papers_published_v1",
    "kg_course_config_releases_v1",
    "kg_learning_tasks_v1",
    "kg_activity_collections_v1",
})
SERVER_OWNED_KEYS = frozenset({"kg_announcements_v1", "kg_user_feedback_v1"})


BOOTSTRAP_COMMON_EXACT_KEYS = frozenset({
    "kg_local_current_user_v1",
    "kg_role_themes_v1",
    "kg_question_language_mode_v1",
    "kg_default_entry_mode_v1",
    "kg_graph_user_preferences_v1",
    "kg_canvas_view_preferences_v1",
    "kg_graph_recent_colors_v1",
    "kg_global_shortcuts_layout_v1",
    "kg_global_shortcuts_position_v1",
    "kg_home_interaction_mode_v1",
    "kg_home_professional_flow_v1",
    "kg_home_file_library_v1",
})

BOOTSTRAP_COMMON_PREFIXES = frozenset({
})

BOOTSTRAP_FILE_EXACT_KEYS = frozenset({
    "kg_graph_file_library_v1",
    "kg_graph_file_index_v2",
    "kg_graph_current_file_v2",
    "kg_graph_current_file_v1",
    "kg_graph_folders_v1",
    "kg_graph_file_tags_v2",
    "kg_graph_file_tags_v1",
    "kg_graph_file_migration_v2",
    "kg_graph_recent_opened_migration_v1",
    "kg_file_manager_details_open_v1",
    "kg_file_manager_folder_section_collapsed_v1",
    "kg_file_manager_recent_folders_v1",
    "kg_file_manager_sidebar_collapsed_v1",
    "kg_file_manager_sort_v1",
    "kg_file_manager_theme_v1",
    "kg_file_manager_layout_v1",
    "kg_graph_closed_tabs_v1",
})

BOOTSTRAP_FILE_PREFIXES = frozenset({
    "kg_graph_file_content_v2__{encoded_owner}__",
})

BOOTSTRAP_GUIDED_EXACT_KEYS = frozenset({
    "kg_guided_practice_return_v1",
})

BOOTSTRAP_GUIDED_PREFIXES = frozenset({
    "kg_guided_learning_progress_v1__",
    "kg_guided_learning_progress_v2__",
    "kg_guided_path_scroll_v2__",
    "kg_guided_path_scroll_v3__",
    "kg_learning_route_context_v1__",
})

BOOTSTRAP_RECALL_EXACT_KEYS = frozenset({
    "kg_deep_recall_current_question_v1",
    "kg_deep_recall_theme_platform_migrated_v1",
    "kg_deep_recall_theme_v1",
})

BOOTSTRAP_RECALL_PREFIXES = frozenset({
    "kg_deep_recall_progress_v1__",
    "kg_deep_recall_progress_v2__",
    "kg_deep_recall_current_question_v2__",
    "kg_deep_recall_explored_v2__",
})

BOOTSTRAP_QUESTION_EXACT_KEYS = frozenset({
    "kg_question_language_mode_v1",
    "kg_question_training_route_v1",
    "kg_question_tag_names_v1",
    "kg_question_training_filters_collapsed_v1",
    "kg_question_training_workspace_layout_v1",
    "kg_training_workspace_layout_v1",
    "kg_multi_question_release_selection_v1",
    "kg_multi_question_analysis_sections_v1",
    "kg_multi_question_font_scale_v1",
    "kg_multi_question_highlight_color_v1",
    "kg_multi_question_paper_selection_v1",
    "kg_paper_workspace_layout_v1",
    "kg_question_library_workspace_layout_v1",
    "kg_deep_recall_current_question_v1",
    "kg_learning_entry_chooser_claim_v1",
    "kg_learning_entry_chooser_consumed_v1",
    "kg_announcements_v1",
    "kg_user_feedback_v1",
    "kg_teacher_workbench_subject_v1",
    "kg_multi_workspace_closed_tabs_v1",
    "pmp_recall_acceptance_records_v1",
    "question_studio_draft_v010",
    "question_studio_draft_v020",
    "question_studio_draft_v021",
    "question_studio_backups_v010",
    "question_studio_backups_v020",
    "question_studio_backups_v021",
    "question_studio_recent_knowledge_v1",
    "question_studio_favorite_knowledge_v1",
    "kg_deep_recall_current_question_v2__",
    "kg_deep_recall_progress_v1__",
    "kg_deep_recall_explored_v2__",
    "kg_deep_recall_progress_v2__",
    "kg_exam_papers_published_v1",  # 多题归纳和深度回忆需要已发布试卷列表
    "kg_exam_paper_release_history_v1",  # 试卷发布历史
    "kg_synthesis_preset_repository_v1",  # 归纳卡原则预设
})

BOOTSTRAP_QUESTION_EXACT_KEYS_WITHOUT_HISTORY = (
    BOOTSTRAP_QUESTION_EXACT_KEYS - {"kg_exam_paper_release_history_v1"}
)

# P4.6 第 1 轮：练题页的已发布试卷改走 /api/v1/paper-releases 细粒度 API
# （轻量目录 + 按 release 分页取题，单响应 ≤1MB），不再通过 bootstrap 整包下发
# 7.65MB 的 kg_exam_papers_published_v1。questions namespace（题库管理页）暂保留旧键。
BOOTSTRAP_QUESTION_EXACT_KEYS_WITHOUT_PUBLISHED = (
    BOOTSTRAP_QUESTION_EXACT_KEYS
    - {"kg_exam_paper_release_history_v1", "kg_exam_papers_published_v1"}
)

BOOTSTRAP_QUESTION_PREFIXES = frozenset({
    "kg_canvas_workspace_v1__",
    "kg_canvas_workspace_catalog_v2__",
    "kg_multi_question_analysis_sections_v1__",
    "kg_multi_question_font_scale_v1__",
    "kg_multi_question_highlight_color_v1__",
    "kg_multi_question_paper_selection_v1__",
    "kg_multi_question_release_selection_v1__",
    "kg_multi_workspace_closed_tabs_v1__",
})

BOOTSTRAP_MANAGEMENT_EXACT_KEYS = frozenset({
    "kg_admin_audit_log_v1",
    "kg_admin_settings_v1",
    "kg_admin_transaction_snapshots_v1",
    "kg_wechat_login_config_v1",
    "kg_student_subscriptions_v1",
    "kg_student_subscription_orders_v1",
    "kg_student_subscription_redeem_codes_v1",
    "kg_subscription_plan_model_v2_migrated",
    "kg_subscription_plan_settings_v1",
    "kg_course_config_active_release_v1",
    "kg_course_config_releases_v1",
    "kg_course_config_drafts_v1",
    "kg_course_admin_recent_v862_p2",
    "kg_course_admin_workspace_v862_p1",
    "kg_teacher_workbench_subject_v1",
    "kg_assessment_papers_v1",
    "kg_learning_tasks_v1",
})

BOOTSTRAP_MANAGEMENT_PREFIXES = frozenset({
})

BOOTSTRAP_NAMESPACE_EXACT_KEYS: dict[str, frozenset[str]] = {
    "files": BOOTSTRAP_FILE_EXACT_KEYS,
    "guided-learning": BOOTSTRAP_GUIDED_EXACT_KEYS,
    "questions": BOOTSTRAP_QUESTION_EXACT_KEYS | BOOTSTRAP_RECALL_EXACT_KEYS,
    "workspace": BOOTSTRAP_QUESTION_EXACT_KEYS_WITHOUT_PUBLISHED | BOOTSTRAP_RECALL_EXACT_KEYS,
    "recall": BOOTSTRAP_QUESTION_EXACT_KEYS_WITHOUT_PUBLISHED | BOOTSTRAP_RECALL_EXACT_KEYS,
    "practice": frozenset({
        # P4.6：kg_exam_papers_published_v1 改走 paper-releases API，不再整包下发
        "kg_announcements_v1",
        "kg_user_feedback_v1",
        "kg_learning_entry_chooser_claim_v1",
        "kg_learning_entry_chooser_consumed_v1",
        "pmp_recall_acceptance_records_v1",
    }),
    "users": frozenset({"kg_local_users_v1", "kg_user_admin_logs_v1"}),
    "system": frozenset({"kg_wechat_login_config_v1", "kg_student_subscription_orders_v1", "kg_student_subscription_redeem_codes_v1", "kg_student_subscriptions_v1", "kg_subscription_plan_model_v2_migrated", "kg_subscription_plan_settings_v1"}),
    "teacher": BOOTSTRAP_MANAGEMENT_EXACT_KEYS,
    "papers": BOOTSTRAP_MANAGEMENT_EXACT_KEYS,
    "admin": BOOTSTRAP_MANAGEMENT_EXACT_KEYS,
    "operations": BOOTSTRAP_MANAGEMENT_EXACT_KEYS,
    "subjects": BOOTSTRAP_MANAGEMENT_EXACT_KEYS,
    "content": BOOTSTRAP_MANAGEMENT_EXACT_KEYS | frozenset({"pmp_recall_acceptance_records_v1"}),
    "courses": BOOTSTRAP_MANAGEMENT_EXACT_KEYS,
}

BOOTSTRAP_NAMESPACE_PREFIXES: dict[str, frozenset[str]] = {
    "files": BOOTSTRAP_FILE_PREFIXES,
    "guided-learning": BOOTSTRAP_GUIDED_PREFIXES,
    "questions": BOOTSTRAP_QUESTION_PREFIXES,
    "workspace": BOOTSTRAP_QUESTION_PREFIXES,
    "recall": BOOTSTRAP_QUESTION_PREFIXES | BOOTSTRAP_RECALL_PREFIXES,
    "practice": frozenset(),
    "users": frozenset(),
    "system": frozenset(),
    "teacher": BOOTSTRAP_MANAGEMENT_PREFIXES,
    "papers": BOOTSTRAP_MANAGEMENT_PREFIXES,
    "admin": BOOTSTRAP_MANAGEMENT_PREFIXES,
    "operations": BOOTSTRAP_MANAGEMENT_PREFIXES,
    "subjects": BOOTSTRAP_MANAGEMENT_PREFIXES,
    "content": BOOTSTRAP_MANAGEMENT_PREFIXES,
    "courses": BOOTSTRAP_MANAGEMENT_PREFIXES,
}


class RuntimeStateValidationError(ValueError):
    pass


class RuntimeStateConflictError(ValueError):
    def __init__(
        self,
        message: str,
        *,
        current_content_revision: int | None = None,
    ):
        super().__init__(message)
        self.current_content_revision = current_content_revision


class RuntimeStatePermissionError(ValueError):
    pass


def _bootstrap_selector_tokens(owner: str, role: str, page: str | None) -> tuple[set[str], set[str]]:
    namespace = PAGE_NAMESPACES.get(page or "", "page")
    exact = set(BOOTSTRAP_COMMON_EXACT_KEYS)
    prefixes = set(BOOTSTRAP_COMMON_PREFIXES)
    exact.update(BOOTSTRAP_NAMESPACE_EXACT_KEYS.get(namespace, frozenset()))
    prefixes.update(BOOTSTRAP_NAMESPACE_PREFIXES.get(namespace, frozenset()))
    if namespace in {"admin", "teacher", "content", "subjects", "operations", "papers", "courses"}:
        if role == "admin":
            exact.update(BOOTSTRAP_MANAGEMENT_EXACT_KEYS)
            prefixes.update(BOOTSTRAP_MANAGEMENT_PREFIXES)
        else:
            # 非管理员页面不下发大范围管理面板状态，避免把未授权数据也塞进首包
            exact.discard("kg_local_users_v1")
            exact.discard("kg_admin_audit_log_v1")
            exact.discard("kg_admin_settings_v1")
            exact.discard("kg_admin_transaction_snapshots_v1")
    if page and page == "file-manager.html":
        # 文件管理器侧重文件与导航树信息；避免一次下发 owner 全量图谱内容，仅保留当前打开文件。
        pass
    encoded_owner = quote(owner, safe="")
    expanded_exact: set[str] = set()
    expanded_prefixes: set[str] = set()
    for key in exact:
        try:
            expanded_exact.add(str(key).format(owner=encoded_owner, raw_owner=owner))
        except KeyError:
            expanded_exact.add(key)
    for prefix in prefixes:
        try:
            expanded_prefixes.add(str(prefix).format(owner=encoded_owner, raw_owner=owner))
        except KeyError:
            expanded_prefixes.add(prefix)
    return expanded_exact, expanded_prefixes


def _select_current_graph_file_id(storage: dict[str, object], owner: str) -> str | None:
    current = storage.get("kg_graph_current_file_v2")
    if not isinstance(current, str):
        return None
    try:
        parsed = json.loads(current)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(parsed, dict):
        if isinstance(parsed, str):
            return parsed.strip() or None
        return None
    file_id = parsed.get(owner)
    if not file_id:
        encoded_owner = quote(owner, safe="")
        file_id = parsed.get(encoded_owner)
    return str(file_id).strip() if file_id else None


def _filter_bootstrap_storage(
    storage: dict[str, str],
    owner: str,
    role: str,
    page: str | None,
) -> dict[str, str]:
    namespace = PAGE_NAMESPACES.get(page or "", "page")
    exact, prefixes = _bootstrap_selector_tokens(owner, role, page or "")
    selected: dict[str, str] = {}

    if not exact and not prefixes:
        return selected

    for key, value in storage.items():
        if key in exact:
            selected[key] = str(value)
            continue
        if any(key.startswith(prefix) for prefix in prefixes):
            selected[key] = str(value)
            continue

    if namespace == "files":
        current_file_id = _select_current_graph_file_id(storage, owner)
        if current_file_id:
            key = f"kg_graph_file_content_v2__{quote(owner, safe='')}__{current_file_id}"
            value = storage.get(key)
            if value is not None:
                selected[key] = str(value)
    if not selected:
        selected.update({key: str(storage[key]) for key in exact if key in storage})
    return selected


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
    return (
        key in EXACT_KEYS
        or key in DEPRECATED_QUESTION_EXACT_KEYS
        or any(key.startswith(prefix) for prefix in PREFIXES)
        or any(key.startswith(prefix) for prefix in DEPRECATED_QUESTION_PREFIXES)
    )


def deprecated_question_key(key: str) -> bool:
    return key in DEPRECATED_QUESTION_EXACT_KEYS or any(
        key.startswith(prefix) for prefix in DEPRECATED_QUESTION_PREFIXES
    )


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
    if update.key in teaching_content_projection_service.PROJECTION_KEYS:
        try:
            teaching_content_projection_service.validate_projection_value(
                update.key,
                str(update.value or '{"schemaVersion":1,"items":[]}'),
            )
        except (TypeError, ValueError) as exc:
            raise RuntimeStateValidationError(str(exc)) from exc
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
        if mutation.key in teaching_content_projection_service.PROJECTION_KEYS:
            try:
                teaching_content_projection_service.validate_projection_value(
                    mutation.key,
                    str(
                        mutation.value
                        or '{"schemaVersion":1,"items":[]}'
                    ),
                )
            except (TypeError, ValueError) as exc:
                raise RuntimeStateValidationError(str(exc)) from exc
    total = sum(
        len(key.encode("utf-8")) + len(value.encode("utf-8"))
        for key, value in update.storage.items()
    )
    if total > MAX_TOTAL_BYTES:
        raise RuntimeStateValidationError("账号运行数据超过大小限制")
    if not re.fullmatch(r"[A-Za-z0-9._:-]+", update.requestId):
        raise RuntimeStateValidationError("请求 ID 格式不正确")


def _is_teacher_shared_key(key: str) -> bool:
    return (
        key in TEACHER_SHARED_EXACT_KEYS
        or key in TEACHER_SHARED_SCOPED_CANONICAL_KEYS
        or any(key.startswith(prefix) for prefix in TEACHER_SHARED_RESTRICTED_PREFIXES)
        or any(key.startswith(prefix) for prefix in TEACHER_SHARED_GLOBAL_PREFIXES)
        or key.startswith(f"{RECALL_ASSOCIATION_PREFIX}user__")
    )


def canonical_teacher_shared_key(
    key: str,
    role: str,
    owner: str | None = None,
) -> str | None:
    """Resolve one manager-facing draft key to its shared database key."""
    if role not in TEACHING_MANAGER_ROLES:
        return None
    if key in TEACHER_SHARED_EXACT_KEYS or key in TEACHER_SHARED_SCOPED_CANONICAL_KEYS:
        return key
    for prefix in TEACHER_SHARED_GLOBAL_PREFIXES:
        if key.startswith(prefix) and key != prefix:
            return key
    if owner is None:
        return None
    encoded_owner = quote(owner, safe="")
    for prefix, canonical in TEACHER_SHARED_SCOPED_PREFIXES.items():
        if key == f"{prefix}{encoded_owner}":
            return canonical
    legacy_association_prefix = (
        f"{RECALL_ASSOCIATION_PREFIX}user__{encoded_owner}__"
    )
    if key.startswith(legacy_association_prefix):
        encoded_subject = key[len(legacy_association_prefix):]
        if encoded_subject:
            return f"{RECALL_ASSOCIATION_PREFIX}subject__{encoded_subject}"
    return None


def teacher_shared_aliases(owner: str, role: str) -> dict[str, str]:
    """Expose canonical scoped rows under the legacy key expected by this account."""
    if role not in TEACHING_MANAGER_ROLES:
        return {}
    encoded_owner = quote(owner, safe="")
    return {
        canonical: f"{prefix}{encoded_owner}"
        for prefix, canonical in TEACHER_SHARED_SCOPED_PREFIXES.items()
    }


def shared_key_writable(key: str, role: str, owner: str | None = None) -> bool:
    if key == "kg_admin_settings_v1":
        return role == "admin"
    if _is_teacher_shared_key(key):
        return canonical_teacher_shared_key(key, role, owner) is not None
    return key in TEACHING_SHARED_KEYS and role in {"admin", "teacher"}


def shared_key_readable(key: str, role: str) -> bool:
    if _is_teacher_shared_key(key):
        return role in TEACHING_MANAGER_ROLES
    return key != "kg_admin_settings_v1" or role == "admin"


def server_owned_key(key: str) -> bool:
    return (
        key in SERVER_OWNED_KEYS
        or key in LOGIN_ENTRY_SERVER_OWNED_KEYS
        or key.startswith(LOGIN_ENTRY_CONSUMED_PREFIX)
    )


def private_runtime_storage(raw: object) -> dict[str, str]:
    values = raw if isinstance(raw, dict) else {}
    return {
        str(key): str(value)
        for key, value in values.items()
        if str(key) not in SHARED_KEYS
        and str(key) not in SERVER_OWNED_KEYS
        and not _is_teacher_shared_key(str(key))
    }


def update_mutations(update: RuntimeStateUpdate) -> list[RuntimeMutation]:
    if update.mutations:
        return list(update.mutations)
    if update.operation in {"setItem", "removeItem"} and update.key:
        return [RuntimeMutation(operation=update.operation, key=update.key, value=update.value)]
    return []


def explicit_shared_mutations(update: RuntimeStateUpdate) -> list[RuntimeMutation]:
    return [
        mutation
        for mutation in update_mutations(update)
        if mutation.key in SHARED_KEYS or _is_teacher_shared_key(mutation.key)
    ]


def teaching_shared_mutations(update: RuntimeStateUpdate) -> list[RuntimeMutation]:
    return [
        mutation
        for mutation in explicit_shared_mutations(update)
        if mutation.key in TEACHING_SHARED_KEYS or _is_teacher_shared_key(mutation.key)
    ]


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


def visible_published_papers(value: str, *, can_access_member: bool) -> str:
    """Keep VIP catalog metadata visible while withholding paid question payloads."""
    try:
        rows = json.loads(value or "[]")
    except (TypeError, ValueError, json.JSONDecodeError):
        return "[]"
    if not isinstance(rows, list):
        return "[]"
    visible = []
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        row = dict(raw)
        policy = row.get("accessPolicy") if isinstance(row.get("accessPolicy"), dict) else {}
        access_level = str(
            policy.get("accessLevel") or row.get("accessLevel") or "free"
        ).lower()
        is_member = access_level in {"member", "vip", "paid", "premium"}
        row["accessPolicy"] = {"accessLevel": "member" if is_member else "free"}
        if is_member and not can_access_member:
            questions = row.get("questions") if isinstance(row.get("questions"), list) else []
            configured_count = int(row.get("configuredCount") or len(questions))
            row["configuredCount"] = configured_count
            row["totalCount"] = int(row.get("totalCount") or configured_count)
            row["questions"] = []
            row["questionSnapshots"] = []
            row["contentRestricted"] = True
        visible.append(row)
    return _json(visible)


def visible_shared_value(
    key: str,
    value: str,
    owner: str,
    *,
    can_access_member: bool = False,
) -> str:
    """Remove account-private records before a shared collection reaches a browser."""
    if key in {
        "kg_exam_papers_published_v1",
        "kg_exam_paper_release_history_v1",
    }:
        return visible_published_papers(value, can_access_member=can_access_member)
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


def _source_timestamp(value: datetime | None) -> datetime:
    if value is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _merge_id_rows(
    key: str,
    payloads: list[tuple[str, list]],
) -> tuple[list, list[dict]]:
    merged: dict[str, object] = {}
    owners: dict[str, str] = {}
    conflicts: list[dict] = []
    anonymous = 0
    for owner, rows in payloads:
        for row in rows:
            if not isinstance(row, dict) or not str(row.get("id") or ""):
                merged[f"__anonymous__:{anonymous}"] = row
                anonymous += 1
                continue
            entity_id = str(row["id"])
            previous = merged.get(entity_id)
            if previous is not None and previous != row:
                conflicts.append({
                    "key": key,
                    "entityId": entity_id,
                    "loserOwner": owners[entity_id],
                    "winnerOwner": owner,
                })
            merged[entity_id] = row
            owners[entity_id] = owner
    return list(merged.values()), conflicts


def _base36(value: int) -> str:
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    if value == 0:
        return "0"
    digits = []
    while value:
        value, remainder = divmod(value, 36)
        digits.append(alphabet[remainder])
    return "".join(reversed(digits))


def _association_hash(value: str) -> str:
    hashed = 2166136261
    for character in str(value or ""):
        hashed ^= ord(character)
        hashed = (hashed * 16777619) & 0xFFFFFFFF
    return _base36(hashed)


def _association_node_id(title: str) -> str:
    cleaned = str(title or "").strip()
    if cleaned.startswith("recall-"):
        return cleaned
    slug = re.sub(r"[^a-z0-9]+", "-", cleaned.lower()).strip("-")[:40]
    return f"recall-{slug or f'n-{_association_hash(cleaned)}'}"


def _association_targets(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [
        item.strip()
        for item in re.split(r"[,，、;；|]", str(value or ""))
        if item.strip()
    ]


def _normalize_association_payload(payload: dict) -> dict:
    structured = any(
        field in payload for field in {"nodes", "edges", "schemaVersion"}
    )
    if structured:
        normalized = dict(payload)
        normalized["nodes"] = (
            list(payload.get("nodes", []))
            if isinstance(payload.get("nodes", []), list)
            else []
        )
        normalized["edges"] = (
            list(payload.get("edges", []))
            if isinstance(payload.get("edges", []), list)
            else []
        )
        return normalized

    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    edge_index = 0
    for raw_source, raw_targets in payload.items():
        source = str(raw_source or "").strip()
        if not source:
            continue
        source_id = _association_node_id(source)
        nodes.setdefault(source_id, {"id": source_id, "title": source})
        for target in _association_targets(raw_targets):
            target_id = _association_node_id(target)
            nodes.setdefault(target_id, {"id": target_id, "title": target})
            edges.append({
                "id": f"edge-{_association_hash(f'{source}>{target}#{edge_index}')}",
                "from": source_id,
                "to": target_id,
            })
            edge_index += 1
    return {"schemaVersion": 1, "nodes": list(nodes.values()), "edges": edges}


def merge_teacher_shared_payload(
    key: str,
    sources: list[tuple[str, datetime, str]],
    *,
    existing_shared: str | None = None,
) -> tuple[str, list[dict]]:
    """Deterministically merge confirmed legacy draft JSON shapes."""
    ordered = sorted(
        sources,
        key=lambda source: (_source_timestamp(source[1]), source[0]),
    )
    raw_payloads = [(owner, raw) for owner, _, raw in ordered]
    if existing_shared is not None:
        raw_payloads.append(("shared", existing_shared))

    decoded: list[tuple[str, object]] = []
    for owner, raw in raw_payloads:
        try:
            decoded.append((owner, json.loads(raw)))
        except (TypeError, ValueError, json.JSONDecodeError):
            decoded.append((owner, None))

    is_association = any(
        key.startswith(prefix) for prefix in TEACHER_SHARED_GLOBAL_PREFIXES
    )
    expected = dict if is_association else list
    if any(not isinstance(payload, expected) for _, payload in decoded):
        winner_owner, winner_raw = raw_payloads[-1] if raw_payloads else ("shared", "[]")
        conflicts = [
            {
                "key": key,
                "entityId": "__payload__",
                "loserOwner": owner,
                "winnerOwner": winner_owner,
            }
            for owner, raw in raw_payloads[:-1]
            if raw != winner_raw
        ]
        return winner_raw, conflicts

    if is_association:
        decoded = [
            (owner, _normalize_association_payload(payload))
            for owner, payload in decoded
            if isinstance(payload, dict)
        ]

    if not is_association:
        rows, conflicts = _merge_id_rows(
            key,
            [(owner, payload) for owner, payload in decoded if isinstance(payload, list)],
        )
        return _json(rows), conflicts

    merged_metadata: dict = {}
    node_payloads: list[tuple[str, list]] = []
    edge_payloads: list[tuple[str, list]] = []
    for owner, payload in decoded:
        if not isinstance(payload, dict):
            continue
        merged_metadata.update({
            field: value
            for field, value in payload.items()
            if field not in {"nodes", "edges"}
        })
        node_payloads.append((owner, payload.get("nodes", [])))
        edge_payloads.append((owner, payload.get("edges", [])))
    nodes, node_conflicts = _merge_id_rows(key, node_payloads)
    edges, edge_conflicts = _merge_id_rows(key, edge_payloads)
    merged_metadata["nodes"] = nodes
    merged_metadata["edges"] = edges
    return _json(merged_metadata), [*node_conflicts, *edge_conflicts]


def _same_json_value(left: str, right: str) -> bool:
    try:
        return json.loads(left) == json.loads(right)
    except (TypeError, ValueError, json.JSONDecodeError):
        return left == right


async def _promote_legacy_teacher_state(db: AsyncSession) -> int | None:
    """Promote pre-shared manager drafts once without deleting rollback copies."""
    if await db.get(SharedRuntimeState, TEACHER_SHARED_PROMOTION_MARKER_KEY):
        return None
    await teaching_content_revision_service.acquire_lock(db)
    revision_before = int(
        (await teaching_content_revision_service.current(db))["revision"]
    )
    await _lock_owner(db, f"promotion:{TEACHER_SHARED_PROMOTION_MARKER_KEY}")
    if await db.get(SharedRuntimeState, TEACHER_SHARED_PROMOTION_MARKER_KEY):
        return None

    result = await db.execute(
        select(RuntimeState, User.role)
        .join(User, User.username == RuntimeState.owner_id)
        .where(User.role.in_(TEACHING_MANAGER_ROLES))
    )
    contributions: dict[str, list[tuple[str, datetime, str]]] = {}
    source_owners: set[str] = set()
    for row, role in result:
        for legacy_key, raw_value in dict(row.storage or {}).items():
            canonical = canonical_teacher_shared_key(
                str(legacy_key), str(role), row.owner_id
            )
            if canonical is None:
                continue
            contributions.setdefault(canonical, []).append((
                row.owner_id,
                row.updated_at,
                str(raw_value),
            ))
            source_owners.add(row.owner_id)

    all_conflicts: list[dict] = []
    promoted_keys: list[str] = []
    changes: list[dict[str, str]] = []
    for key in sorted(contributions):
        shared_row = await db.get(SharedRuntimeState, key)
        merged, conflicts = merge_teacher_shared_payload(
            key,
            contributions[key],
            existing_shared=shared_row.value if shared_row else None,
        )
        if shared_row is None:
            db.add(SharedRuntimeState(
                key=key,
                value=merged,
                updated_by="runtime-promotion",
            ))
            changes.append(
                {"entityType": "runtimeShared", "entityId": key, "action": "migrated"}
            )
        elif not _same_json_value(shared_row.value, merged):
            shared_row.value = merged
            shared_row.updated_by = "runtime-promotion"
            changes.append(
                {"entityType": "runtimeShared", "entityId": key, "action": "migrated"}
            )
        promoted_keys.append(key)
        all_conflicts.extend(conflicts)

    all_conflicts.sort(key=lambda row: (
        str(row.get("key") or ""),
        str(row.get("entityId") or ""),
        str(row.get("winnerOwner") or ""),
        str(row.get("loserOwner") or ""),
    ))
    marker = {
        "schemaVersion": 1,
        "status": "complete",
        "sourceOwners": sorted(source_owners),
        "promotedKeys": promoted_keys,
        "conflicts": all_conflicts,
        "completedAt": datetime.now(timezone.utc).isoformat(),
    }
    db.add(SharedRuntimeState(
        key=TEACHER_SHARED_PROMOTION_MARKER_KEY,
        value=_json(marker),
        updated_by="runtime-promotion",
    ))
    if changes:
        await teaching_content_revision_service.bump(
            db,
            "runtime-promotion",
            changes,
        )
    await db.commit()
    return revision_before if changes else None


async def _read_state_snapshot_locked(
    db: AsyncSession,
    owner: str,
    role: str,
    mode: str = "full",
    page: str | None = None,
) -> tuple[dict[str, str], int, int]:
    row = await db.get(RuntimeState, owner)
    subscription = await db.get(Subscription, owner)
    entitlements = subscription_service.entitlements_for(role, subscription)
    storage = private_runtime_storage(row.storage if row else {})
    revision = row.revision if row else 0
    # 合并 v9 全局共享键（published 类）：所有用户读同一份，教师发布 → 学员可读。
    aliases = teacher_shared_aliases(owner, role)
    result = await db.execute(select(SharedRuntimeState.key, SharedRuntimeState.value))
    for key, value in result:
        if key in SHARED_KEYS and shared_key_readable(key, role):
            storage[key] = visible_shared_value(
                key,
                str(value),
                owner,
                can_access_member=entitlements["allExamPapers"],
            )
            continue
        canonical = canonical_teacher_shared_key(str(key), role, owner)
        if canonical == key and shared_key_readable(str(key), role):
            storage[aliases.get(str(key), str(key))] = str(value)
    content_revision = int(
        (await teaching_content_revision_service.current(db))["revision"]
    )
    if mode == "bootstrap":
        storage = _filter_bootstrap_storage(storage, owner, role, page)
    return storage, revision, content_revision


async def get_state(
    db: AsyncSession,
    owner: str,
    role: str,
    mode: str = "full",
    page: str | None = None,
) -> tuple[dict[str, str], int, int]:
    if role in TEACHING_MANAGER_ROLES:
        await _promote_legacy_teacher_state(db)
    await teaching_content_revision_service.acquire_read_lock(db)
    if mode == "bootstrap":
        user = await db.get(User, owner)
        if user is not None:
            return await ensure_domain_seed(
                db,
                user,
                page=page,
                storage={},
                revision=0,
            )
    snapshot = await _read_state_snapshot_locked(db, owner, role, mode=mode, page=page)
    await db.commit()
    return snapshot


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _milliseconds(value) -> int:
    return int(value.timestamp() * 1000) if value else 0


async def _seed_users(db: AsyncSession, owner: str, storage: dict[str, str]) -> bool:
    # 用户管理页需要全量账号镜像（admin 能看到 teacher/student/viewer），
    # 只装 owner+admin 会让旧 UI 首屏缺账号。
    accounts, _ = await user_service.list_users(db, page=1, page_size=200)

    user_map: dict[str, User] = {}
    for user in accounts:
        user_map[user.username] = user
    owner_user = await user_service.get_by_username(db, owner)
    if owner_user:
        user_map[owner_user.username] = owner_user

    users = list(user_map.values())
    if not users:
        return False

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
    page: str | None,
    storage: dict[str, str],
    revision: int,
) -> tuple[dict[str, str], int, int]:
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
        changed = await _seed_users(db, user.username, storage) or changed
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
        return await _read_state_snapshot_locked(
            db,
            user.username,
            user.role,
            mode="bootstrap",
            page=page,
        )

    if row is None:
        row = RuntimeState(owner_id=user.username, storage=storage, revision=1)
        db.add(row)
    else:
        row.storage = storage
        row.revision += 1
    await db.commit()
    await db.refresh(row)
    return await _read_state_snapshot_locked(
        db,
        user.username,
        user.role,
        mode="bootstrap",
        page=page,
    )


async def apply_update(
    db: AsyncSession,
    owner: str,
    role: str,
    update: RuntimeStateUpdate,
) -> tuple[dict[str, str], int, int]:
    validate_update(update)
    mutations = update_mutations(update)
    if settings.QUESTION_CATALOG_CUTOVER_ENABLED:
        deprecated_mutations = [
            mutation.key
            for mutation in mutations
            if deprecated_question_key(mutation.key)
            and mutation.key not in teaching_content_projection_service.PROJECTION_KEYS
        ]
        if deprecated_mutations:
            raise RuntimeStatePermissionError("正式题库已迁移，请使用题目目录接口")
    protected_mutations = [
        mutation.key for mutation in mutations if server_owned_key(mutation.key)
    ]
    if protected_mutations:
        raise RuntimeStatePermissionError(
            f"该数据只能通过专用接口修改：{protected_mutations[0]}"
        )
    shared_mutations = explicit_shared_mutations(update)
    teaching_mutations = teaching_shared_mutations(update)
    forbidden = [
        mutation.key
        for mutation in shared_mutations
        if not shared_key_writable(mutation.key, role, owner)
    ]
    if forbidden:
        raise RuntimeStatePermissionError(f"当前角色无权限修改共享内容：{forbidden[0]}")
    promotion_base_revision: int | None = None
    if shared_mutations and role in TEACHING_MANAGER_ROLES:
        promotion_base_revision = await _promote_legacy_teacher_state(db)
    await _lock_owner(db, owner)
    row = await db.get(RuntimeState, owner)
    if row is not None and row.last_request_id == update.requestId:
        await db.commit()
        return await get_state(db, owner, role)
    if teaching_mutations:
        await teaching_content_revision_service.acquire_lock(db)
        current_content_revision = int(
            (await teaching_content_revision_service.current(db))["revision"]
        )
        if (
            update.contentRevision != current_content_revision
            and not (
                promotion_base_revision is not None
                and update.contentRevision == promotion_base_revision
                and current_content_revision == promotion_base_revision + 1
            )
        ):
            raise RuntimeStateConflictError(
                "教学内容已更新，请重新加载后重试",
                current_content_revision=current_content_revision,
            )
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

    if settings.QUESTION_CATALOG_CUTOVER_ENABLED:
        # Full browser snapshots can still contain the pre-cutover catalog. Ignore
        # those stale values while retaining the original server copy for audit,
        # migration verification, and rollback.
        storage = {
            key: value for key, value in storage.items() if not deprecated_question_key(key)
        }
        storage.update({
            key: value
            for key, value in current_storage.items()
            if deprecated_question_key(key)
        })

    # 拆分：v9 全局共享键（published 类）→ 虚拟 SHARED_OWNER；其余 → 当前 owner。
    own_part = {
        k: v for k, v in storage.items()
        if k not in SHARED_KEYS
        and not server_owned_key(k)
        and not _is_teacher_shared_key(k)
    }
    own_part.update({
        key: value
        for key, value in current_storage.items()
        if _is_teacher_shared_key(key)
    })
    own_part.update({
        key: value
        for key, value in current_storage.items()
        if server_owned_key(key)
    })

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
    content_changes: list[dict[str, str]] = []
    projection_mutations = [
        mutation
        for mutation in teaching_mutations
        if mutation.key in teaching_content_projection_service.PROJECTION_KEYS
    ]
    projection_mutations.sort(
        key=lambda mutation: (
            mutation.key != teaching_content_projection_service.PRINCIPLE_KEY,
            mutation.key,
        )
    )
    for mutation in projection_mutations:
        try:
            content_changes.extend(
                await teaching_content_projection_service.apply_principle_projection(
                    db,
                    owner,
                    mutation.key,
                    str(mutation.value or '{"schemaVersion":1,"items":[]}'),
                )
            )
        except (TypeError, ValueError) as exc:
            raise RuntimeStateValidationError(str(exc)) from exc
    if projection_mutations:
        await teaching_content_projection_service.write_principle_projection(db, owner)

    for mutation in shared_mutations:
        key = canonical_teacher_shared_key(mutation.key, role, owner) or mutation.key
        if key in teaching_content_projection_service.PROJECTION_KEYS:
            continue
        if mutation not in teaching_mutations:
            await _lock_owner(db, f"shared:{key}")
        shared_row = await db.get(SharedRuntimeState, key)
        if mutation.operation == "removeItem":
            if shared_row is not None:
                if key in PUBLISHER_COLLECTION_KEYS:
                    shared_row.value = remove_publisher_rows(key, shared_row.value, owner)
                    shared_row.updated_by = owner
                else:
                    await db.delete(shared_row)
            if mutation in teaching_mutations:
                content_changes.append(
                    {"entityType": "runtimeShared", "entityId": key, "action": "deleted"}
                )
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
        if mutation in teaching_mutations:
            content_changes.append(
                {"entityType": "runtimeShared", "entityId": key, "action": "updated"}
            )

    if teaching_mutations:
        bumped = await teaching_content_revision_service.bump(
            db,
            owner,
            content_changes,
        )
        response_content_revision = int(bumped["revision"])
    else:
        await teaching_content_revision_service.acquire_read_lock(db)
        current_content_revision = int(
            (await teaching_content_revision_service.current(db))["revision"]
        )
        response_content_revision = (
            int(update.contentRevision)
            if update.contentRevision is not None
            else current_content_revision
        )

    snapshot = await _read_state_snapshot_locked(db, owner, role)
    await db.commit()
    return snapshot[0], snapshot[1], response_content_revision


async def claim_learning_entry(
    db: AsyncSession,
    owner: str,
    login_session_id: str,
) -> dict[str, object]:
    """Atomically claim the chooser once for one server-issued login session."""

    digest = hashlib.sha256(login_session_id.encode("utf-8")).hexdigest()
    key = f"{LOGIN_ENTRY_CONSUMED_PREFIX}{digest}"
    await _lock_owner(db, owner)
    row = await db.get(RuntimeState, owner)
    storage = dict(row.storage or {}) if row else {}
    existing = storage.get(key)
    if existing is not None:
        await db.commit()
        return {
            "claimed": False,
            "key": key,
            "value": str(existing),
            "revision": int(row.revision if row else 0),
        }

    consumed_at = int(datetime.now(timezone.utc).timestamp() * 1000)
    value = _json({
        "schemaVersion": 1,
        "consumedDigest": digest,
        "consumedAt": consumed_at,
    })
    storage[key] = value

    scoped: list[tuple[int, str]] = []
    for candidate_key, candidate_value in storage.items():
        if not str(candidate_key).startswith(LOGIN_ENTRY_CONSUMED_PREFIX):
            continue
        try:
            parsed = json.loads(str(candidate_value))
            timestamp = int(parsed.get("consumedAt") or 0) if isinstance(parsed, dict) else 0
        except (TypeError, ValueError, json.JSONDecodeError):
            timestamp = 0
        scoped.append((timestamp, str(candidate_key)))
    prior_scoped = [item for item in scoped if item[1] != key]
    for _timestamp, stale_key in sorted(prior_scoped, reverse=True)[MAX_LOGIN_ENTRY_CLAIMS - 1:]:
        storage.pop(stale_key, None)

    if row is None:
        row = RuntimeState(owner_id=owner, storage=storage, revision=1)
        db.add(row)
    else:
        row.storage = storage
        row.revision += 1
    await db.commit()
    await db.refresh(row)
    return {
        "claimed": True,
        "key": key,
        "value": value,
        "revision": int(row.revision),
    }
