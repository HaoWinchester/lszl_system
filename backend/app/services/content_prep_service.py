"""Content Prep bank setup and fixed creator attribution."""

from __future__ import annotations

import hashlib
import json
import logging
from copy import deepcopy
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import now_utc, uid
from app.models.content_prep import (
    Principle,
    QuestionAuditLog,
    QuestionBankCollaborator,
    QuestionEditLock,
    QuestionTagConfig,
    QuestionUploadBatch,
    SynthesisPreset,
)
from app.models.question import Question, QuestionBank
from app.models.user import User
from app.schemas.content_prep import (
    CatalogError,
    CatalogIssue,
    ContentPrepBatchRequest,
    ContentPrepBatchResult,
    ContentPrepQuestionSaveRequest,
    ContentPrepQuestionResult,
)
from app.services import (
    content_reference_service,
    idempotency_service,
    question_access_service,
    question_catalog_service,
    teaching_content_projection_service,
    teaching_content_revision_service,
)
from app.services.question_content_service import (
    canonical_question_hash,
    duplicate_question_signature,
    normalize_question_payload,
)

logger = logging.getLogger(__name__)


CREATORS = {
    "creator_001": "波塞冬",
    "creator_002": "狗娃",
    "creator_003": "阿浩",
    "creator_004": "杰瑞",
    "creator_005": "天才",
    "creator_006": "女帝",
}


class ContentPrepInputError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class ContentPrepOperationError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        issues: list[CatalogIssue] | None = None,
        status_code: int = 422,
        batch_id: str | None = None,
        record_failure: bool = True,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.issues = issues or []
        self.status_code = status_code
        self.batch_id = batch_id
        self.record_failure = record_failure

    def error_payload(self) -> dict:
        return CatalogError(
            code=self.code,
            message=self.message,
            batchId=self.batch_id,
            issues=self.issues,
        ).model_dump(by_alias=True)


@dataclass(frozen=True)
class _ActorContext:
    username: str
    role: str
    subject: str | None


@dataclass
class _PreparedQuestion:
    item_index: int
    normalized: dict[str, Any]
    content_hash: str
    existing: Question | None
    status: str
    lock: QuestionEditLock | None = None
    # 内容签名覆盖：题目 ID 在库内不存在，但题干+选项+答案与库内已有题相同，
    # 此时沿用已有题 ID 用新内容覆盖（保留稳定 ID），且跳过该题的编辑锁校验。
    duplicate_override: bool = False


BASE_TAG_OPTIONS: dict[tuple[str, str], set[str]] = {
    ("usage", "stage"): {
        "基础练习",
        "阶段测试",
        "模拟考试",
        "冲刺复习",
        "预习练习",
        "强化训练",
        "错题复盘",
    },
    ("usage", "scene"): {"课后练习", "课堂讨论", "作业题", "专项训练"},
    ("quality", "feature"): {"易错题", "高频题", "核心题", "综合题"},
    ("quality", "review"): {"待复核", "已复核", "需更新"},
    ("source", "origin"): {"真题", "自编题", "改编题", "教材例题"},
    ("source", "scope"): {"可公开", "内部使用"},
}


def resolve_creator(creator_id: object) -> tuple[str, str]:
    normalized_id = str(creator_id or "").strip()
    creator_name = CREATORS.get(normalized_id)
    if creator_name is None:
        raise ContentPrepInputError("UNKNOWN_CREATOR", "请选择有效的固定制作人")
    return normalized_id, creator_name


async def create_bank(
    db: AsyncSession,
    actor: User,
    body: dict,
    *,
    include_content_revision: bool = False,
) -> QuestionBank | tuple[QuestionBank, int]:
    await teaching_content_revision_service.acquire_lock(db)
    resolve_creator(body.get("creatorId"))
    visibility = str(body.get("visibility") or "private").strip().lower()
    if visibility not in {"private", "published"}:
        raise ContentPrepInputError(
            "INVALID_BANK_VISIBILITY",
            "题库可见性必须为 private 或 published",
        )
    name = str(body.get("name") or "").strip()
    if not name:
        raise ContentPrepInputError("BANK_NAME_REQUIRED", "题库名称不能为空")
    subject = str(body.get("subject") or actor.subject or "PMP").strip().upper()
    bank = QuestionBank(
        id=uid("b_"),
        owner_id=actor.username,
        name=name[:200],
        subject=subject[:32],
        description=(str(body["description"]).strip() if body.get("description") else None),
        visibility=visibility,
        revision=1,
        created_by=actor.username,
        updated_by=actor.username,
    )
    db.add(bank)
    revision_state = await teaching_content_revision_service.bump(
        db,
        actor.username,
        [{"entityType": "bank", "entityId": bank.id, "action": "created"}],
    )
    await db.commit()
    await db.refresh(bank)
    if include_content_revision:
        return bank, int(revision_state["revision"])
    return bank


def created_bank_payload(bank: QuestionBank) -> dict:
    return {
        "id": bank.id,
        "name": bank.name,
        "subject": bank.subject,
        "description": bank.description,
        "visibility": bank.visibility,
        "revision": bank.revision,
        "ownerId": bank.owner_id,
        "createdBy": bank.created_by,
        "updatedBy": bank.updated_by,
        "createdAt": bank.created_at.isoformat() if bank.created_at else None,
        "updatedAt": bank.updated_at.isoformat() if bank.updated_at else None,
    }


def _actor_context(actor: User | _ActorContext) -> _ActorContext:
    if isinstance(actor, _ActorContext):
        return actor
    cached = actor.__dict__.get("_content_prep_actor_context")
    if isinstance(cached, _ActorContext):
        return cached
    context = _ActorContext(
        username=str(actor.username),
        role=str(actor.role),
        subject=(str(actor.subject) if actor.subject else None),
    )
    actor.__dict__["_content_prep_actor_context"] = context
    return context


def _manifest_hash(request: ContentPrepBatchRequest) -> str:
    manifest = {
        "clientInstanceId": request.client_instance_id,
        "targetBankId": request.target_bank_id,
        "creatorId": request.creator_id,
        "prepVersion": request.prep_version,
        "workspaceVersion": request.workspace_version,
        "questions": [
            {
                "id": item.question.id,
                "baseRevision": item.base_revision,
                "contentHash": canonical_question_hash(
                    item.question.model_dump(by_alias=True)
                ),
            }
            for item in request.questions
        ],
        "principles": request.principles,
        "synthesisPresets": request.synthesis_presets,
        "tagConfig": request.tag_config,
    }
    if request.knowledge_tree is not None or request.recall_library is not None:
        manifest.update(
            {
                "subjectId": request.subject_id,
                "knowledgeTree": request.knowledge_tree,
                "recallLibrary": request.recall_library,
            }
        )
    canonical = json.dumps(
        manifest,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _legacy_save_manifest_hash(
    request: ContentPrepQuestionSaveRequest,
    bank_id: str,
) -> str:
    manifest = {
        "clientInstanceId": request.client_instance_id,
        "targetBankId": bank_id,
        "creatorId": None,
        "prepVersion": request.prep_version,
        "workspaceVersion": request.workspace_version,
        "questions": [
            {
                "id": request.question.id,
                "baseRevision": request.base_revision,
                "contentHash": canonical_question_hash(
                    request.question.model_dump(by_alias=True)
                ),
            }
        ],
        "principles": request.principles,
        "synthesisPresets": request.synthesis_presets,
        "tagConfig": request.tag_config,
    }
    canonical = json.dumps(
        manifest,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _single_save_manifest_hash(
    request: ContentPrepQuestionSaveRequest,
    batch: QuestionUploadBatch,
) -> str:
    if batch.creator_id is None:
        if request.creator_id is not None:
            return ""
        return _legacy_save_manifest_hash(request, batch.bank_id)
    if request.creator_id is not None and request.creator_id != batch.creator_id:
        return ""
    batch_request = ContentPrepBatchRequest(
        idempotencyKey=request.idempotency_key,
        clientInstanceId=request.client_instance_id,
        targetBankId=batch.bank_id,
        creatorId=batch.creator_id,
        prepVersion=request.prep_version,
        workspaceVersion=request.workspace_version,
        questions=[
            {
                "question": request.question,
                "baseRevision": request.base_revision,
                "lockToken": request.lock_token,
            }
        ],
        principles=request.principles,
        synthesisPresets=request.synthesis_presets,
        tagConfig=request.tag_config,
    )
    return _manifest_hash(batch_request)


async def _lock_configuration_inputs(
    db: AsyncSession,
    request: ContentPrepBatchRequest,
) -> None:
    # The teaching-content revision lock is already held before this helper.
    # Only the independent singleton tag-config row needs its historical lock;
    # principle/preset per-ID advisory locks would add N round-trips without
    # increasing serialization.
    if not request.tag_config:
        return
    digest = hashlib.sha256(b"content-prep:active-tag-config").digest()
    advisory_key = int.from_bytes(digest[:8], byteorder="big", signed=True)
    await db.execute(select(func.pg_advisory_xact_lock(advisory_key)))


async def _existing_batch_for_update(
    db: AsyncSession,
    actor_username: str,
    idempotency_key: str,
) -> QuestionUploadBatch | None:
    result = await db.execute(
        select(QuestionUploadBatch)
        .where(
            QuestionUploadBatch.actor_username == actor_username,
            QuestionUploadBatch.idempotency_key == idempotency_key,
        )
        .with_for_update()
    )
    return result.scalar_one_or_none()


def _error_from_failed_batch(batch: QuestionUploadBatch) -> ContentPrepOperationError:
    summary = batch.error_summary or {}
    issues = [CatalogIssue.model_validate(issue) for issue in summary.get("issues") or []]
    return ContentPrepOperationError(
        str(summary.get("code") or "BATCH_PREVIOUSLY_FAILED"),
        str(summary.get("message") or "该上传批次此前已失败"),
        issues=issues,
        status_code=int(summary.get("statusCode") or 422),
        batch_id=batch.id,
        record_failure=False,
    )


async def _locked_writable_bank(
    db: AsyncSession,
    actor: _ActorContext,
    bank_id: str,
) -> QuestionBank:
    result = await db.execute(
        select(QuestionBank).where(QuestionBank.id == bank_id).with_for_update()
    )
    bank = result.scalar_one_or_none()
    if bank is None:
        raise ContentPrepOperationError(
            "BANK_NOT_FOUND",
            "目标题库不存在",
            status_code=404,
            record_failure=False,
        )
    allowed = actor.role == "admin" or bank.owner_id == actor.username
    if not allowed:
        permission = (
            await db.execute(
                select(QuestionBankCollaborator.permission).where(
                    QuestionBankCollaborator.bank_id == bank_id,
                    QuestionBankCollaborator.username == actor.username,
                )
            )
        ).scalar_one_or_none()
        allowed = permission == "edit"
    if not allowed:
        raise ContentPrepOperationError(
            "BANK_ACCESS_DENIED",
            "当前账号无权编辑该题库",
            status_code=403,
            record_failure=False,
        )
    return bank


def _question_issue(
    question_id: str,
    field: str,
    code: str,
    message: str,
) -> CatalogIssue:
    return CatalogIssue(
        questionId=question_id,
        field=field,
        code=code,
        message=message,
    )


def _validate_question_content(
    normalized: dict[str, Any],
    *,
    is_new: bool,
) -> list[CatalogIssue]:
    question_id = str(normalized.get("id") or "")
    issues: list[CatalogIssue] = []
    if is_new:
        try:
            UUID(question_id)
        except (TypeError, ValueError, AttributeError):
            issues.append(
                _question_issue(
                    question_id,
                    "id",
                    "QUESTION_ID_INVALID",
                    "新题 ID 必须是 UUID",
                )
            )
    if not str(normalized.get("title") or "").strip():
        issues.append(
            _question_issue(
                question_id,
                "title",
                "QUESTION_TITLE_REQUIRED",
                "题目标题不能为空",
            )
        )
    options = normalized.get("options") or []
    option_ids = {
        str(option.get("id"))
        for option in options
        if isinstance(option, dict) and option.get("id")
    }
    if not options:
        issues.append(
            _question_issue(
                question_id,
                "options",
                "OPTIONS_REQUIRED",
                "题目必须包含选项",
            )
        )
    correct_answer = normalized.get("correctAnswer")
    correct_answer_text = str(correct_answer or "")
    question_type = str(normalized.get("type") or "single_choice").strip()
    selected_option_ids: list[str] = []
    if correct_answer_text in option_ids:
        selected_option_ids = [correct_answer_text]
    elif (
        question_type == "multiple_choice"
        and correct_answer_text
        and all(len(option_id) == 1 for option_id in option_ids)
        and all(option_id in option_ids for option_id in correct_answer_text)
    ):
        selected_option_ids = list(correct_answer_text)
    valid_answer = (
        len(selected_option_ids) == len(set(selected_option_ids))
        and (
            len(selected_option_ids) >= 2
            if question_type == "multiple_choice"
            else len(selected_option_ids) == 1
        )
    )
    if not valid_answer:
        issues.append(
            _question_issue(
                question_id,
                "options",
                "CORRECT_ANSWER_MISSING",
                "必须设置且只能引用现有选项的正确答案",
            )
        )
    return issues


def _incoming_items(container: dict[str, Any]) -> list[dict[str, Any]]:
    items = container.get("items") if isinstance(container, dict) else None
    return [item for item in (items or []) if isinstance(item, dict)]


async def _validate_principle_and_preset_inputs(
    db: AsyncSession,
    request: ContentPrepBatchRequest,
) -> tuple[set[str], list[CatalogIssue]]:
    principle_items = _incoming_items(request.principles)
    incoming_ids = {
        str(item.get("id") or "").strip()
        for item in principle_items
        if str(item.get("id") or "").strip()
    }
    issues: list[CatalogIssue] = []
    for index, item in enumerate(principle_items):
        principle_id = str(item.get("id") or "").strip()
        if not principle_id:
            issues.append(
                CatalogIssue(
                    field=f"principles.items[{index}].id",
                    code="PRINCIPLE_ID_REQUIRED",
                    message="原则 ID 不能为空",
                )
            )
        if not str(item.get("name") or "").strip():
            issues.append(
                CatalogIssue(
                    field=f"principles.items[{index}].name",
                    code="PRINCIPLE_NAME_REQUIRED",
                    message="原则名称不能为空",
                )
            )

    referenced_ids: set[str] = set()
    for item in principle_items:
        referenced_ids.update(
            str(value)
            for value in (item.get("confusablePrincipleIds") or [])
            if value
        )
    preset_items = _incoming_items(request.synthesis_presets)
    referenced_ids.update(
        str(item.get("principleId"))
        for item in preset_items
        if item.get("principleId")
    )
    existing_ids = set()
    if referenced_ids:
        existing_ids = set(
            (
                await db.execute(
                    select(Principle.id).where(Principle.id.in_(referenced_ids))
                )
            ).scalars().all()
        )
    allowed = incoming_ids | existing_ids
    for index, item in enumerate(preset_items):
        principle_id = str(item.get("principleId") or "").strip()
        if not str(item.get("id") or "").strip():
            issues.append(
                CatalogIssue(
                    field=f"synthesisPresets.items[{index}].id",
                    code="PRESET_ID_REQUIRED",
                    message="归纳卡 ID 不能为空",
                )
            )
        if principle_id not in allowed:
            issues.append(
                CatalogIssue(
                    field=f"synthesisPresets.items[{index}].principleId",
                    code="REFERENCE_NOT_FOUND",
                    message=f"归纳卡引用的原则不存在：{principle_id}",
                )
            )
    return incoming_ids, issues


async def _effective_tag_config(
    db: AsyncSession,
    incoming: dict[str, Any],
) -> dict[str, Any]:
    has_incoming_values = any(
        bool(incoming.get(key))
        for key in (
            "names",
            "groupNames",
            "categoryNames",
            "aliases",
            "slotSchema",
            "slotAliases",
            "looseAliases",
        )
    )
    if has_incoming_values:
        return incoming
    active = (
        await db.execute(
            select(QuestionTagConfig).where(QuestionTagConfig.active.is_(True))
        )
    ).scalar_one_or_none()
    if active is None:
        return incoming
    return {
        "names": active.names or {},
        "groupNames": active.group_names or {},
        "categoryNames": active.category_names or {},
        "aliases": active.aliases or {},
        "slotSchema": active.slot_schema or {},
        "schemaVersion": active.schema_version,
    }


_FAMILY_ROLES = {"standalone", "root", "member"}
_FAMILY_MEMBER_RELATIONS = {"equivalent", "decomposed", "extension"}


def _question_family(normalized: dict[str, Any]) -> dict[str, Any]:
    metadata = normalized.get("metadata") if isinstance(normalized.get("metadata"), dict) else {}
    family = metadata.get("questionFamily")
    return family if isinstance(family, dict) else {}


def _validate_question_family(normalized: dict[str, Any]) -> list[CatalogIssue]:
    """单题级 Question Family v1 校验（P4.5.29 差异 28 / P0-FAMILY-01）。

    Root-only 批次合法：覆盖不足不在这里报错（是编辑端的就绪提示，不是导入错误）。
    """
    family = _question_family(normalized)
    if not family:
        return []
    question_id = str(normalized.get("id") or "")
    issues: list[CatalogIssue] = []
    role = str(family.get("role") or "").strip()
    if role not in _FAMILY_ROLES:
        issues.append(
            _question_issue(
                question_id,
                "metadata.questionFamily.role",
                "FAMILY_ROLE_INVALID",
                f"题目家族角色非法：{role or '（空）'}（允许 standalone/root/member）",
            )
        )
        return issues
    if role == "member":
        relation = str(family.get("relationToRoot") or "").strip()
        if relation not in _FAMILY_MEMBER_RELATIONS:
            issues.append(
                _question_issue(
                    question_id,
                    "metadata.questionFamily.relationToRoot",
                    "FAMILY_MEMBER_RELATION_INVALID",
                    f"家族成员关系非法：{relation or '（空）'}（允许 equivalent/decomposed/extension）",
                )
            )
    level = family.get("difficultyLevel")
    if level is not None:
        try:
            numeric_level = int(level)
        except (TypeError, ValueError):
            numeric_level = -1
        if not 1 <= numeric_level <= 4:
            issues.append(
                _question_issue(
                    question_id,
                    "metadata.questionFamily.difficultyLevel",
                    "FAMILY_LEVEL_INVALID",
                    "题目家族诊断层级必须是 L1–L4",
                )
            )
    return issues


async def _validate_question_family_batch(
    db: AsyncSession,
    bank: QuestionBank,
    normalized_questions: list[dict[str, Any]],
) -> list[CatalogIssue]:
    """批次级结构校验：同 familyKey 重复母题、成员母题必须在同一 Bank 内存在。

    成员引用的母题不在本批且不在本 Bank 已有题目中（含跨 Bank 引用形态）即阻断。
    """
    issues: list[CatalogIssue] = []
    family_rows = [(str(q.get("id") or ""), _question_family(q)) for q in normalized_questions]
    family_rows = [row for row in family_rows if row[1]]
    if not family_rows:
        return issues

    roots_by_key: dict[str, str] = {}
    batch_ids = {question_id for question_id, _family in family_rows}
    for question_id, family in family_rows:
        if str(family.get("role") or "") != "root":
            continue
        family_key = str(family.get("familyKey") or "").strip()
        if not family_key:
            continue
        if family_key in roots_by_key:
            issues.extend(
                [
                    _question_issue(
                        question_id,
                        "metadata.questionFamily.familyKey",
                        "FAMILY_DUPLICATE_ROOT",
                        f"家族代号重复：{family_key} 存在多个母题（同一 Bank 只能有 1 道母题）",
                    ),
                    _question_issue(
                        roots_by_key[family_key],
                        "metadata.questionFamily.familyKey",
                        "FAMILY_DUPLICATE_ROOT",
                        f"家族代号重复：{family_key} 存在多个母题（同一 Bank 只能有 1 道母题）",
                    ),
                ]
            )
        else:
            roots_by_key[family_key] = question_id

    bank_root_ids = set(roots_by_key.values()) | {
        question_id
        for question_id, family in family_rows
        if str(family.get("role") or "") == "root"
    }
    member_root_ids = {
        question_id: str(family.get("rootQuestionId") or "").strip()
        for question_id, family in family_rows
        if str(family.get("role") or "") == "member"
    }
    unresolved = {
        question_id: root_id
        for question_id, root_id in member_root_ids.items()
        if root_id and root_id not in bank_root_ids and root_id not in batch_ids
    }
    if unresolved:
        existing_rows = (
            await db.execute(
                select(Question.id, Question.content_metadata).where(
                    Question.bank_id == bank.id,
                    Question.id.in_(unresolved.values()),
                )
            )
        ).all()
        existing_root_ids = {
            str(row.id)
            for row in existing_rows
            if str(((row.content_metadata or {}).get("questionFamily") or {}).get("role") or "")
            == "root"
        }
        unresolved = {
            question_id: root_id
            for question_id, root_id in unresolved.items()
            if root_id not in existing_root_ids
        }
    for question_id, root_id in unresolved.items():
        issues.append(
            _question_issue(
                question_id,
                "metadata.questionFamily.rootQuestionId",
                "FAMILY_MEMBER_ROOT_MISSING",
                f"母题 {root_id} 不在本题库中（家族成员只能引用同一题库内的母题）",
            )
        )
    return issues


def _validate_tag_paths(
    normalized: dict[str, Any],
    config: dict[str, Any],
) -> list[CatalogIssue]:
    metadata = normalized.get("metadata") if isinstance(normalized.get("metadata"), dict) else {}
    tag_paths = metadata.get("tagPaths") or []
    question_id = str(normalized.get("id") or "")
    names = config.get("names") if isinstance(config.get("names"), dict) else {}
    aliases = config.get("aliases") if isinstance(config.get("aliases"), dict) else {}
    issues: list[CatalogIssue] = []
    for index, path in enumerate(tag_paths):
        if not isinstance(path, dict):
            issues.append(
                _question_issue(
                    question_id,
                    f"metadata.tagPaths[{index}]",
                    "TAG_PATH_INVALID",
                    "标签路径必须是对象",
                )
            )
            continue
        group_id = str(path.get("groupId") or "")
        category_id = str(path.get("categoryId") or "")
        label = str(path.get("label") or "").strip()
        slot = (group_id, category_id)
        if slot not in BASE_TAG_OPTIONS:
            issues.append(
                _question_issue(
                    question_id,
                    f"metadata.tagPaths[{index}]",
                    "TAG_PATH_UNKNOWN",
                    f"未知标签路径：{group_id}/{category_id}",
                )
            )
            continue
        configured_labels = {
            str(value)
            for key, value in names.items()
            if str(key).startswith(f"{group_id}/{category_id}/") and value
        }
        allowed_labels = BASE_TAG_OPTIONS[slot] | configured_labels
        canonical_label = str(aliases.get(label) or label)
        if not label or canonical_label not in allowed_labels:
            issues.append(
                _question_issue(
                    question_id,
                    f"metadata.tagPaths[{index}].label",
                    "TAG_LABEL_UNKNOWN",
                    f"标签不属于当前配置：{label}",
                )
            )
    return issues


async def _upsert_principles(
    db: AsyncSession,
    actor: _ActorContext,
    container: dict[str, Any],
) -> list[dict[str, str]]:
    changes: list[dict[str, str]] = []
    items = _incoming_items(container)
    ids = [str(item.get("id") or "").strip() for item in items]
    existing_by_id = {
        row.id: row
        for row in (
            await db.execute(
                select(Principle)
                .where(Principle.id.in_(ids))
                .with_for_update()
            )
        ).scalars().all()
    } if ids else {}
    for item in items:
        principle_id = str(item.get("id") or "").strip()
        existing = existing_by_id.get(principle_id)
        values = {
            "name": str(item.get("name") or "").strip(),
            "status": (
                "inactive"
                if str(item.get("status") or "active").lower() == "inactive"
                else "active"
            ),
            "confusable_principle_ids": [
                str(value).strip()
                for value in (item.get("confusablePrincipleIds") or [])
                if str(value).strip()
            ],
        }
        if existing is None:
            db.add(
                Principle(
                    id=principle_id,
                    **values,
                    revision=1,
                    created_by=actor.username,
                    updated_by=actor.username,
                )
            )
            changes.append(
                {"entityType": "principle", "entityId": principle_id, "action": "created"}
            )
        else:
            changed = any(getattr(existing, key) != value for key, value in values.items())
            if changed:
                for key, value in values.items():
                    setattr(existing, key, value)
                existing.revision += 1
                existing.updated_by = actor.username
                changes.append(
                    {"entityType": "principle", "entityId": principle_id, "action": "updated"}
                )
    return changes


async def _upsert_presets(
    db: AsyncSession,
    actor: _ActorContext,
    container: dict[str, Any],
) -> list[dict[str, str]]:
    changes: list[dict[str, str]] = []
    items = _incoming_items(container)
    ids = [str(item.get("id") or "").strip() for item in items]
    existing_by_id = {
        row.id: row
        for row in (
            await db.execute(
                select(SynthesisPreset)
                .where(SynthesisPreset.id.in_(ids))
                .with_for_update()
            )
        ).scalars().all()
    } if ids else {}
    for item in items:
        preset_id = str(item.get("id") or "").strip()
        existing = existing_by_id.get(preset_id)
        values = {
            "principle_id": str(item.get("principleId") or "").strip(),
            "title": str(item.get("title") or "").strip(),
            "content": str(item.get("content") or item.get("description") or "").strip(),
            "status": str(item.get("status") or "draft"),
            "business_version": max(1, int(item.get("version") or 1)),
        }
        if existing is None:
            db.add(
                SynthesisPreset(
                    id=preset_id,
                    **values,
                    revision=1,
                    created_by=actor.username,
                    updated_by=actor.username,
                )
            )
            changes.append(
                {
                    "entityType": "synthesisPreset",
                    "entityId": preset_id,
                    "action": "created",
                }
            )
        else:
            changed = any(getattr(existing, key) != value for key, value in values.items())
            if changed:
                for key, value in values.items():
                    setattr(existing, key, value)
                existing.revision += 1
                existing.updated_by = actor.username
                changes.append(
                    {
                        "entityType": "synthesisPreset",
                        "entityId": preset_id,
                        "action": "updated",
                    }
                )
    return changes


def _tag_config_values(config: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": max(1, int(config.get("schemaVersion") or 1)),
        "names": config.get("names") if isinstance(config.get("names"), dict) else {},
        "group_names": (
            config.get("groupNames") if isinstance(config.get("groupNames"), dict) else {}
        ),
        "category_names": (
            config.get("categoryNames")
            if isinstance(config.get("categoryNames"), dict)
            else {}
        ),
        "aliases": config.get("aliases") if isinstance(config.get("aliases"), dict) else {},
        "slot_schema": {
            key: config[key]
            for key in ("slotSchema", "slotAliases", "looseAliases", "slotIdStrategy")
            if key in config
        },
    }


async def _upsert_tag_config(
    db: AsyncSession,
    actor: _ActorContext,
    config: dict[str, Any],
) -> bool:
    if not config:
        return False
    values = _tag_config_values(config)
    active = (
        await db.execute(
            select(QuestionTagConfig)
            .where(QuestionTagConfig.active.is_(True))
            .with_for_update()
        )
    ).scalar_one_or_none()
    comparable_keys = (
        "schema_version",
        "names",
        "group_names",
        "category_names",
        "aliases",
        "slot_schema",
    )
    if active is not None and all(
        getattr(active, key) == values[key] for key in comparable_keys
    ):
        return False
    if active is not None:
        active.active = False
    await db.flush()
    db.add(
        QuestionTagConfig(
            id=uid("qtc_"),
            **values,
            active=True,
            revision=1,
            created_by=actor.username,
            updated_by=actor.username,
        )
    )
    return True


def _assign_question_fields(
    question: Question,
    normalized: dict[str, Any],
    *,
    content_hash: str,
    creator_id: str | None,
    creator_name: str | None,
    actor_username: str,
    actor_role: str,
    is_new: bool,
) -> None:
    question.title = str(normalized.get("title") or "").strip()
    question.type = str(normalized.get("type") or "single_choice")[:32]
    question.subject = str(normalized.get("subject") or "PMP")[:32]
    question.difficulty = (
        str(normalized["difficulty"])[:32] if normalized.get("difficulty") else None
    )
    question.domain = str(normalized["domain"])[:100] if normalized.get("domain") else None
    question.topic = str(normalized["topic"])[:100] if normalized.get("topic") else None
    question.teacher_number = (
        str(normalized["teacherNumber"])[:64]
        if normalized.get("teacherNumber")
        else None
    )
    question.scope = str(normalized.get("scope") or "internal")
    question.content_hash = content_hash
    question.creator_id = creator_id
    question.creator_name = creator_name
    question.updated_by = actor_username
    if is_new:
        question.created_by = actor_username
    question.tags = normalized.get("tags") or []
    question.stem_parts = normalized.get("stemParts") or []
    question.options = normalized.get("options") or []
    question.correct_answer = str(normalized.get("correctAnswer") or "")[:20] or None
    analysis = normalized.get("analysis")
    question.analysis = str(analysis) if analysis is not None else None
    question.translations = normalized.get("translations") or {}
    metadata = deepcopy(normalized.get("metadata") or {})
    origin = metadata.get("origin") if isinstance(metadata.get("origin"), dict) else {}
    metadata["origin"] = {
        **origin,
        "creatorId": creator_id,
        "creatorName": creator_name,
        "actorUsername": actor_username,
        "actorRole": actor_role,
    }
    question.content_metadata = metadata
    question.key_path = normalized.get("keyPath") or {}
    question.clues = normalized.get("clues") or []
    question.concepts = normalized.get("concepts") or []
    question.reasoning_steps = normalized.get("reasoningSteps") or []
    question.status = normalized.get("status") or {}
    question.lifecycle = normalized.get("lifecycle") or {"status": "active"}


def _add_question_audit(
    db: AsyncSession,
    *,
    action: str,
    actor: _ActorContext,
    creator_id: str | None,
    creator_name: str | None,
    bank_id: str,
    question_id: str,
    batch_id: str,
    before_hash: str | None,
    after_hash: str,
    before_revision: int | None,
    after_revision: int,
) -> None:
    db.add(
        QuestionAuditLog(
            id=uid("qal_"),
            entity_type="question",
            entity_id=question_id,
            action=action,
            actor_username=actor.username,
            actor_role=actor.role,
            creator_id=creator_id,
            creator_name=creator_name,
            bank_id=bank_id,
            question_id=question_id,
            batch_id=batch_id,
            before_hash=before_hash,
            after_hash=after_hash,
            before_revision=before_revision,
            after_revision=after_revision,
            outcome="success",
            detail={},
        )
    )


async def _prepare_questions(
    db: AsyncSession,
    actor: _ActorContext,
    bank: QuestionBank,
    request: ContentPrepBatchRequest,
) -> tuple[list[_PreparedQuestion], list[CatalogIssue]]:
    ids = [item.question.id for item in request.questions]
    duplicate_ids = {question_id for question_id in ids if ids.count(question_id) > 1}
    if duplicate_ids:
        raise ContentPrepOperationError(
            "QUESTION_VALIDATION_FAILED",
            "题目内容校验失败",
            issues=[
                _question_issue(
                    question_id,
                    "id",
                    "DUPLICATE_QUESTION_ID",
                    "同一批次不能包含重复题目 ID",
                )
                for question_id in sorted(duplicate_ids)
            ],
        )

    existing_rows = (
        await db.execute(
            select(Question).where(Question.id.in_(ids)).with_for_update()
        )
    ).scalars().all()
    existing_by_id = {question.id: question for question in existing_rows}
    # 内容签名覆盖（2026-08 录入需求）：ID 未命中的题，若题干+选项+答案与库内已有题
    # 完全相同，则覆盖那条已有题（沿用其稳定 ID），避免同内容题目重复入库。
    existing_by_signature: dict[str, Question] = {}
    missing_id_rows = [qid for qid in ids if qid not in existing_by_id]
    if missing_id_rows:
        requested_ids = set(ids)
        bank_rows = (
            await db.execute(select(Question).where(Question.bank_id == bank.id))
        ).scalars().all()
        for bank_question in bank_rows:
            if bank_question.id in requested_ids:
                # 本批次已按 ID 显式命中(更新/跳过)的题不进签名池,
                # 避免同批另一道内容相同的新题被映射到同一 ID 造成双写。
                continue
            existing_by_signature[
                duplicate_question_signature(
                    question_catalog_service.question_to_payload(bank_question)
                )
            ] = bank_question
    prepared: list[_PreparedQuestion] = []
    issues: list[CatalogIssue] = []
    effective_tag_config = await _effective_tag_config(db, request.tag_config)

    for index, item in enumerate(request.questions):
        raw = item.question.model_dump(by_alias=True)
        normalized = normalize_question_payload(raw, subject=bank.subject)
        question_id = normalized["id"]
        existing = existing_by_id.get(question_id)
        if existing is not None and existing.bank_id != bank.id:
            raise ContentPrepOperationError(
                "QUESTION_BANK_MOVE_FORBIDDEN",
                "同一题目 ID 不能移动到其他题库",
                status_code=409,
            )
        duplicate_override = False
        if existing is None:
            signature = duplicate_question_signature(normalized)
            matched = existing_by_signature.get(signature)
            if matched is not None:
                normalized["id"] = matched.id
                question_id = matched.id
                existing = matched
                duplicate_override = True
        content_hash = canonical_question_hash(normalized)
        status = (
            "created"
            if existing is None
            else "skipped"
            if existing.content_hash == content_hash
            else "updated"
        )
        issues.extend(_validate_question_content(normalized, is_new=existing is None))
        issues.extend(_validate_question_family(normalized))
        issues.extend(_validate_tag_paths(normalized, effective_tag_config))
        prepared.append(
            _PreparedQuestion(
                item_index=index,
                normalized=normalized,
                content_hash=content_hash,
                existing=existing,
                status=status,
                duplicate_override=duplicate_override,
            )
        )

    issues.extend(
        await _validate_question_family_batch(db, bank, [item.normalized for item in prepared])
    )

    incoming_principle_ids, input_issues = await _validate_principle_and_preset_inputs(
        db,
        request,
    )
    issues.extend(input_issues)
    for prepared_question in prepared:
        issues.extend(
            await content_reference_service.validate_question_references(
                db,
                actor.username,
                bank.subject,
                prepared_question.normalized,
                incoming_principle_ids=incoming_principle_ids,
                recall_library=request.recall_library,
            )
        )
    return prepared, issues


async def _remove_own_skipped_lock(
    db: AsyncSession,
    actor: _ActorContext,
    request: ContentPrepBatchRequest,
    question_id: str,
) -> None:
    lock = (
        await db.execute(
            select(QuestionEditLock)
            .where(QuestionEditLock.question_id == question_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if (
        lock is not None
        and lock.locked_by == actor.username
        and lock.client_instance_id == request.client_instance_id
    ):
        await db.delete(lock)


async def _execute_upload(
    db: AsyncSession,
    actor: _ActorContext,
    request: ContentPrepBatchRequest,
    manifest_hash: str,
    *,
    require_existing_locks: bool,
) -> ContentPrepBatchResult:
    from app.services import question_lock_service

    await teaching_content_revision_service.acquire_lock(db)
    await idempotency_service.lock(db, actor.username, request.idempotency_key)
    existing_batch = await _existing_batch_for_update(
        db,
        actor.username,
        request.idempotency_key,
    )
    if existing_batch is not None:
        if existing_batch.manifest_hash != manifest_hash:
            raise ContentPrepOperationError(
                "IDEMPOTENCY_PAYLOAD_CONFLICT",
                "相同幂等键不能用于不同上传内容",
                status_code=409,
                batch_id=existing_batch.id,
                record_failure=False,
            )
        if existing_batch.status == "committed":
            replayed = dict(existing_batch.result or {})
            if "contentRevision" not in replayed:
                replayed["contentRevision"] = int(
                    (await teaching_content_revision_service.current(db))["revision"]
                )
            replayed["replayed"] = True
            return ContentPrepBatchResult.model_validate(replayed)
        if existing_batch.status == "rolled_back":
            raise _error_from_failed_batch(existing_batch)

    creator_id, creator_name = resolve_creator(request.creator_id)
    bank = await _locked_writable_bank(db, actor, request.target_bank_id)
    await _lock_configuration_inputs(db, request)
    batch_id = uid("qub_")
    batch = QuestionUploadBatch(
        id=batch_id,
        idempotency_key=request.idempotency_key,
        bank_id=bank.id,
        actor_username=actor.username,
        actor_role=actor.role,
        creator_id=creator_id,
        creator_name=creator_name,
        client_instance_id=request.client_instance_id,
        prep_version=request.prep_version,
        workspace_version=request.workspace_version,
        manifest_hash=manifest_hash,
        input_count=len(request.questions),
        status="pending",
    )
    db.add(batch)
    await db.flush()

    prepared, issues = await _prepare_questions(db, actor, bank, request)
    if issues:
        if settings.CONTENT_PREP_VALIDATION_DISABLED:
            # 校验临时关闭（CONTENT_PREP_VALIDATION_DISABLED）：只记日志不阻断，便于事后审计。
            logger.warning(
                "CONTENT_PREP_VALIDATION_DISABLED=true: skipping %d question validation issues (batch %s)",
                len(issues),
                batch_id,
            )
        else:
            raise ContentPrepOperationError(
                "QUESTION_VALIDATION_FAILED",
                "题目内容校验失败",
                issues=issues,
                batch_id=batch_id,
            )

    for prepared_question in prepared:
        if prepared_question.existing is None or (
            prepared_question.status != "updated" and not require_existing_locks
        ):
            continue
        if prepared_question.duplicate_override:
            # 内容签名覆盖：请求里携带的是新 ID 的锁，服务器已有题未被本请求锁定，跳过锁校验直接覆盖
            continue
        item = request.questions[prepared_question.item_index]
        try:
            prepared_question.lock = await question_lock_service.assert_lock_and_revision(
                db,
                prepared_question.existing,
                actor,
                client_instance_id=request.client_instance_id,
                lock_token=str(item.lock_token or ""),
                base_revision=item.base_revision,
            )
        except question_lock_service.QuestionLockError as error:
            raise ContentPrepOperationError(
                error.code,
                error.message,
                status_code=error.status_code,
                batch_id=batch_id,
            ) from error

    content_changes = await _upsert_principles(db, actor, request.principles)
    await db.flush()
    content_changes.extend(
        await _upsert_presets(db, actor, request.synthesis_presets)
    )
    tag_changed = await _upsert_tag_config(db, actor, request.tag_config)
    from app.services import content_prep_shared_service

    content_changes.extend(
        await content_prep_shared_service.apply_auxiliary_assets(
            db,
            actor_username=actor.username,
            subject_id=request.subject_id,
            knowledge_tree=request.knowledge_tree,
            recall_library=request.recall_library,
            tag_config=request.tag_config,
        )
    )
    if tag_changed and not any(
        change.get("entityType") == "tagConfig" for change in content_changes
    ):
        content_changes.append(
            {"entityType": "tagConfig", "entityId": "active", "action": "upserted"}
        )
    if content_changes or not await (
        teaching_content_projection_service.projection_rows_present(db)
    ):
        await teaching_content_projection_service.write_principle_projection(
            db,
            actor.username,
        )

    question_results: list[ContentPrepQuestionResult] = []
    created_count = 0
    updated_count = 0
    skipped_count = 0
    for prepared_question in prepared:
        normalized = prepared_question.normalized
        question_id = normalized["id"]
        if prepared_question.status == "created":
            question = Question(
                id=question_id,
                bank_id=bank.id,
                title=str(normalized.get("title") or ""),
                revision=1,
            )
            _assign_question_fields(
                question,
                normalized,
                content_hash=prepared_question.content_hash,
                creator_id=creator_id,
                creator_name=creator_name,
                actor_username=actor.username,
                actor_role=actor.role,
                is_new=True,
            )
            db.add(question)
            revision = 1
            before_hash = None
            before_revision = None
            action = "question_created"
            created_count += 1
            content_changes.append(
                {"entityType": "question", "entityId": question_id, "action": "created"}
            )
        elif prepared_question.status == "updated":
            question = prepared_question.existing
            assert question is not None
            before_hash = question.content_hash
            before_revision = question.revision
            question.revision += 1
            _assign_question_fields(
                question,
                normalized,
                content_hash=prepared_question.content_hash,
                creator_id=creator_id,
                creator_name=creator_name,
                actor_username=actor.username,
                actor_role=actor.role,
                is_new=False,
            )
            revision = question.revision
            action = "question_updated"
            updated_count += 1
            content_changes.append(
                {"entityType": "question", "entityId": question_id, "action": "updated"}
            )
            if prepared_question.lock is not None:
                await db.delete(prepared_question.lock)
        else:
            question = prepared_question.existing
            assert question is not None
            before_hash = question.content_hash
            before_revision = question.revision
            revision = question.revision
            action = "question_skipped"
            skipped_count += 1
            if prepared_question.lock is not None:
                await db.delete(prepared_question.lock)
            else:
                await _remove_own_skipped_lock(db, actor, request, question_id)

        _add_question_audit(
            db,
            action=action,
            actor=actor,
            creator_id=creator_id,
            creator_name=creator_name,
            bank_id=bank.id,
            question_id=question_id,
            batch_id=batch_id,
            before_hash=before_hash,
            after_hash=prepared_question.content_hash,
            before_revision=before_revision,
            after_revision=revision,
        )
        question_results.append(
            ContentPrepQuestionResult(
                questionId=question_id,
                status=prepared_question.status,
                revision=revision,
                contentHash=prepared_question.content_hash,
            )
        )

    if created_count or updated_count:
        bank.revision += 1
        bank.updated_by = actor.username
        content_changes.append(
            {"entityType": "bank", "entityId": bank.id, "action": "updated"}
        )
    content_revision = await teaching_content_revision_service.bump(
        db,
        actor.username,
        content_changes,
    )
    result = ContentPrepBatchResult(
        batchId=batch_id,
        bankId=bank.id,
        bankRevision=bank.revision,
        contentRevision=content_revision["revision"],
        replayed=False,
        questions=question_results,
    )
    batch.created_count = created_count
    batch.updated_count = updated_count
    batch.skipped_count = skipped_count
    batch.status = "committed"
    batch.result = result.model_dump(by_alias=True)
    batch.error_summary = {}
    batch.committed_at = now_utc()
    await db.flush()
    return result


async def save_legacy_question_without_creator(
    db: AsyncSession,
    actor: User,
    request: ContentPrepQuestionSaveRequest,
) -> dict[str, Any]:
    """Save a locked historical question while preserving its null attribution.

    Batch uploads still require an allowlisted creator. This narrow path exists
    only for a pre-migration question whose creator was never recorded.
    """

    from app.services import question_lock_service

    actor_context = _actor_context(actor)
    if db.in_transaction():
        await db.rollback()
    async with db.begin():
        await teaching_content_revision_service.acquire_lock(db)
        await idempotency_service.lock(
            db,
            actor_context.username,
            request.idempotency_key,
        )
        existing_batch = await _existing_batch_for_update(
            db,
            actor_context.username,
            request.idempotency_key,
        )
        if existing_batch is not None:
            manifest_hash = _legacy_save_manifest_hash(
                request,
                existing_batch.bank_id,
            )
            if existing_batch.manifest_hash != manifest_hash:
                raise ContentPrepOperationError(
                    "IDEMPOTENCY_PAYLOAD_CONFLICT",
                    "相同幂等键不能用于不同上传内容",
                    status_code=409,
                    batch_id=existing_batch.id,
                    record_failure=False,
                )
            if existing_batch.status == "committed":
                return dict(existing_batch.result or {})
            if existing_batch.status == "rolled_back":
                raise _error_from_failed_batch(existing_batch)
        actor_row = await db.get(User, actor_context.username)
        if actor_row is None:
            raise ContentPrepOperationError(
                "ACTOR_NOT_FOUND",
                "当前登录账号不存在",
                status_code=401,
                record_failure=False,
            )
        question = (
            await db.execute(
                select(Question)
                .where(Question.id == request.question.id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if question is None:
            raise ContentPrepOperationError(
                "QUESTION_NOT_FOUND",
                "题目不存在",
                status_code=404,
                record_failure=False,
            )
        manifest_hash = _legacy_save_manifest_hash(request, question.bank_id)
        await question_access_service.require_bank_access(
            db,
            actor_row,
            question.bank_id,
            edit=True,
        )
        try:
            lock = await question_lock_service.assert_lock_and_revision(
                db,
                question,
                actor_row,
                client_instance_id=request.client_instance_id,
                lock_token=request.lock_token,
                base_revision=request.base_revision,
            )
        except question_lock_service.QuestionLockError as error:
            raise ContentPrepOperationError(
                error.code,
                error.message,
                status_code=error.status_code,
                record_failure=False,
            ) from error

        if request.creator_id or question.creator_id:
            raise ContentPrepOperationError(
                "CREATOR_REQUIRED_FOR_BATCH_PATH",
                "已有制作人的题目必须使用标准制作人保存路径",
                status_code=409,
                record_failure=False,
            )

        normalized = normalize_question_payload(
            request.question.model_dump(by_alias=True),
            subject=question.subject or "PMP",
        )
        reference_issues = await content_reference_service.validate_recall_references(
            db,
            question.subject or "PMP",
            normalized,
        )
        if reference_issues:
            if settings.CONTENT_PREP_VALIDATION_DISABLED:
                # 校验临时关闭（CONTENT_PREP_VALIDATION_DISABLED）：只记日志不阻断。
                logger.warning(
                    "CONTENT_PREP_VALIDATION_DISABLED=true: skipping %d reference validation issues (question %s)",
                    len(reference_issues),
                    question.id,
                )
            else:
                raise ContentPrepOperationError(
                    "QUESTION_VALIDATION_FAILED",
                    "题目内容校验失败",
                    issues=reference_issues,
                    record_failure=False,
                )
        content_hash = canonical_question_hash(normalized)
        before_hash = question.content_hash
        before_revision = question.revision
        question.revision += 1
        _assign_question_fields(
            question,
            normalized,
            content_hash=content_hash,
            creator_id=None,
            creator_name=None,
            actor_username=actor_context.username,
            actor_role=actor_context.role,
            is_new=False,
        )
        batch_id = uid("qsave_")
        _add_question_audit(
            db,
            action="question_updated",
            actor=actor_context,
            creator_id=None,
            creator_name=None,
            bank_id=question.bank_id,
            question_id=question.id,
            batch_id=batch_id,
            before_hash=before_hash,
            after_hash=content_hash,
            before_revision=before_revision,
            after_revision=question.revision,
        )
        bank = (
            await db.execute(
                select(QuestionBank)
                .where(QuestionBank.id == question.bank_id)
                .with_for_update()
            )
        ).scalar_one()
        bank.revision += 1
        bank.updated_by = actor_context.username
        await db.delete(lock)
        content_revision = await teaching_content_revision_service.bump(
            db,
            actor_context.username,
            [
                {
                    "entityType": "question",
                    "entityId": question.id,
                    "action": "updated",
                },
                {"entityType": "bank", "entityId": bank.id, "action": "updated"},
            ],
        )
        await db.flush()
        await db.refresh(question)
        await db.refresh(bank)
        result = {
            "batchId": batch_id,
            "bankId": bank.id,
            "bankRevision": bank.revision,
            "contentRevision": content_revision["revision"],
            "question": question_catalog_service.question_to_payload(question),
        }
        db.add(
            QuestionUploadBatch(
                id=batch_id,
                idempotency_key=request.idempotency_key,
                bank_id=bank.id,
                actor_username=actor_context.username,
                actor_role=actor_context.role,
                creator_id=None,
                creator_name=None,
                client_instance_id=request.client_instance_id,
                prep_version=request.prep_version,
                workspace_version=request.workspace_version,
                manifest_hash=manifest_hash,
                input_count=1,
                created_count=0,
                updated_count=1,
                skipped_count=0,
                status="committed",
                result=result,
                error_summary={},
                committed_at=now_utc(),
            )
        )
        await db.flush()
        return result


async def replay_single_question_save(
    db: AsyncSession,
    actor: User,
    request: ContentPrepQuestionSaveRequest,
) -> dict[str, Any] | None:
    """Replay a committed single-save before consulting mutable question state."""

    actor_context = _actor_context(actor)
    if db.in_transaction():
        await db.rollback()
    async with db.begin():
        await teaching_content_revision_service.acquire_lock(db)
        await idempotency_service.lock(
            db,
            actor_context.username,
            request.idempotency_key,
        )
        batch = await _existing_batch_for_update(
            db,
            actor_context.username,
            request.idempotency_key,
        )
        if batch is None:
            return None
        if batch.manifest_hash != _single_save_manifest_hash(request, batch):
            raise ContentPrepOperationError(
                "IDEMPOTENCY_PAYLOAD_CONFLICT",
                "相同幂等键不能用于不同上传内容",
                status_code=409,
                batch_id=batch.id,
                record_failure=False,
            )
        if batch.status == "rolled_back":
            raise _error_from_failed_batch(batch)
        if batch.status != "committed":
            raise ContentPrepOperationError(
                "BATCH_IN_PROGRESS",
                "该幂等请求正在处理中",
                status_code=409,
                batch_id=batch.id,
                record_failure=False,
            )
        if batch.creator_id is None:
            return dict(batch.result or {})
        result = ContentPrepBatchResult.model_validate(batch.result or {})
        return {
            "batchId": result.batch_id,
            "bankId": result.bank_id,
            "bankRevision": result.bank_revision,
            "contentRevision": result.content_revision,
            "question": result.questions[0].model_dump(by_alias=True),
        }


async def record_failed_batch(
    db: AsyncSession,
    actor: User | _ActorContext,
    request: ContentPrepBatchRequest,
    error: ContentPrepOperationError,
) -> None:
    actor_context = actor if isinstance(actor, _ActorContext) else _actor_context(actor)
    try:
        creator_id, creator_name = resolve_creator(request.creator_id)
    except ContentPrepInputError:
        return
    manifest_hash = _manifest_hash(request)
    if db.in_transaction():
        await db.rollback()
    async with db.begin():
        await teaching_content_revision_service.acquire_lock(db)
        await idempotency_service.lock(
            db,
            actor_context.username,
            request.idempotency_key,
        )
        existing = await _existing_batch_for_update(
            db,
            actor_context.username,
            request.idempotency_key,
        )
        if existing is not None:
            return
        bank = await db.get(QuestionBank, request.target_bank_id)
        if bank is None:
            return
        batch_id = error.batch_id or uid("qub_")
        error.batch_id = batch_id
        summary = error.error_payload()
        summary["statusCode"] = error.status_code
        db.add(
            QuestionUploadBatch(
                id=batch_id,
                idempotency_key=request.idempotency_key,
                bank_id=request.target_bank_id,
                actor_username=actor_context.username,
                actor_role=actor_context.role,
                creator_id=creator_id,
                creator_name=creator_name,
                client_instance_id=request.client_instance_id,
                prep_version=request.prep_version,
                workspace_version=request.workspace_version,
                manifest_hash=manifest_hash,
                input_count=len(request.questions),
                status="rolled_back",
                result={},
                error_summary=summary,
            )
        )


async def upload_bundle(
    db: AsyncSession,
    actor: User,
    request: ContentPrepBatchRequest,
    *,
    require_existing_locks: bool = False,
) -> ContentPrepBatchResult:
    # A request-scoped SELECT may already have started a transaction.  Capture
    # the authenticated identity before rolling it back, because rollback
    # expires SQLAlchemy ORM attributes in async sessions.
    actor_context = _actor_context(actor)
    if db.in_transaction():
        await db.rollback()
    try:
        async with db.begin():
            return await upload_bundle_in_transaction(
                db,
                actor_context,
                request,
                require_existing_locks=require_existing_locks,
            )
    except ContentPrepInputError as error:
        raise ContentPrepOperationError(
            error.code,
            error.message,
            status_code=422,
            record_failure=False,
        ) from error
    except ContentPrepOperationError as error:
        if error.record_failure:
            await record_failed_batch(db, actor_context, request, error)
        raise
    except Exception as unexpected:
        error = ContentPrepOperationError(
            "BATCH_TRANSACTION_FAILED",
            "上传事务执行失败",
            status_code=500,
        )
        await record_failed_batch(db, actor_context, request, error)
        raise error from unexpected


async def upload_bundle_in_transaction(
    db: AsyncSession,
    actor: User | _ActorContext,
    request: ContentPrepBatchRequest,
    *,
    require_existing_locks: bool = False,
) -> ContentPrepBatchResult:
    """Run a bundle upload inside a caller-owned database transaction.

    Content Prep drafts use this to remove the draft only when the formal
    upload commits.  The public upload route continues to own its transaction
    through :func:`upload_bundle`.
    """

    actor_context = _actor_context(actor)
    manifest_hash = _manifest_hash(request)
    try:
        return await _execute_upload(
            db,
            actor_context,
            request,
            manifest_hash,
            require_existing_locks=require_existing_locks,
        )
    except ContentPrepInputError as error:
        raise ContentPrepOperationError(
            error.code,
            error.message,
            status_code=422,
            record_failure=False,
        ) from error


async def get_batch(
    db: AsyncSession,
    actor: User,
    batch_id: str,
) -> dict[str, Any]:
    batch = await db.get(QuestionUploadBatch, batch_id)
    if batch is None or (
        actor.role != "admin" and batch.actor_username != actor.username
    ):
        raise HTTPException(
            status_code=404,
            detail={"code": "BATCH_NOT_FOUND", "message": "上传批次不存在"},
        )
    return {
        "id": batch.id,
        "idempotencyKey": batch.idempotency_key,
        "bankId": batch.bank_id,
        "actorUsername": batch.actor_username,
        "actorRole": batch.actor_role,
        "creatorId": batch.creator_id,
        "creatorName": batch.creator_name,
        "status": batch.status,
        "result": batch.result or {},
        "errorSummary": batch.error_summary or {},
        "createdAt": batch.created_at.isoformat() if batch.created_at else None,
        "committedAt": batch.committed_at.isoformat() if batch.committed_at else None,
    }
