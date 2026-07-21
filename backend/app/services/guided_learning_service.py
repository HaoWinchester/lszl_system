"""引导式学习课程导入、公开读取与服务端解锁规则。"""

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import uid
from app.models.guided_learning import (
    GuidedActivity,
    GuidedCourse,
    GuidedCourseActivity,
    GuidedLearningProgress,
)

SEED_PATH = Path(__file__).parents[1] / "seed" / "guided_course_v8_6_0.json"
PROGRESS_SCHEMA_VERSION = 4


class CourseNotFoundError(LookupError):
    pass


class LockedNodeError(ValueError):
    pass


class PreviewWriteError(ValueError):
    pass


def _now_ms() -> int:
    return int(datetime.now(UTC).timestamp() * 1000)


def _canonical_json(value: dict) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _content_hash(package: dict) -> str:
    payload = {key: value for key, value in package.items() if key != "contentHash"}
    return "sha256:" + hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()


def validate_package(package: dict, *, verify_hash: bool = True) -> list[str]:
    errors: list[str] = []
    if not isinstance(package, dict):
        return ["课程包必须是对象"]
    if int(package.get("packageSchemaVersion") or 0) != 1:
        errors.append("packageSchemaVersion 必须为 1")
    if int(package.get("activitySchemaVersion") or 0) != 1:
        errors.append("activitySchemaVersion 必须为 1")
    if verify_hash and package.get("contentHash") != _content_hash(package):
        errors.append("课程包 contentHash 校验失败")

    course = package.get("course") if isinstance(package.get("course"), dict) else {}
    stages = course.get("stages") if isinstance(course.get("stages"), list) else []
    parts = course.get("parts") if isinstance(course.get("parts"), list) else []
    nodes = course.get("nodes") if isinstance(course.get("nodes"), list) else []
    activities = package.get("activities") if isinstance(package.get("activities"), list) else []
    placement_tests = course.get("placementTests") if isinstance(course.get("placementTests"), dict) else {}

    def ids(items: list, label: str) -> set[str]:
        values = [str(item.get("id") or "") for item in items if isinstance(item, dict)]
        missing = len(items) - len([value for value in values if value])
        if missing:
            errors.append(f"{label} 存在 {missing} 个缺少 ID 的记录")
        duplicates = sorted({value for value in values if value and values.count(value) > 1})
        if duplicates:
            errors.append(f"{label} ID 重复: {', '.join(duplicates)}")
        return {value for value in values if value}

    stage_ids = ids(stages, "stage")
    part_ids = ids(parts, "part")
    node_ids = ids(nodes, "node")
    activity_ids = ids(activities, "activity")
    for part in parts:
        if str(part.get("stageId") or "") not in stage_ids:
            errors.append(f"part {part.get('id')} 引用了不存在的 stage {part.get('stageId')}")
    for node in nodes:
        if str(node.get("partId") or "") not in part_ids:
            errors.append(f"node {node.get('id')} 引用了不存在的 part {node.get('partId')}")
        for activity_id in node.get("activityIds") or []:
            if str(activity_id) not in activity_ids:
                errors.append(f"node {node.get('id')} 引用了不存在的 activity {activity_id}")
        challenge = node.get("challengeConfig") if isinstance(node.get("challengeConfig"), dict) else {}
        for activity_id in challenge.get("activityIds") or []:
            if str(activity_id) not in activity_ids:
                errors.append(f"challenge {node.get('id')} 引用了不存在的 activity {activity_id}")
        for source_id in challenge.get("sourceNodeIds") or []:
            if str(source_id) not in node_ids:
                errors.append(f"challenge {node.get('id')} 引用了不存在的 node {source_id}")
    for part_id, config in placement_tests.items():
        if part_id not in part_ids or not isinstance(config, dict):
            errors.append(f"跳级测试引用了不存在的 part {part_id}")
            continue
        for activity_id in config.get("activityIds") or []:
            if str(activity_id) not in activity_ids:
                errors.append(f"跳级测试 {part_id} 引用了不存在的 activity {activity_id}")
        for source_id in config.get("sourceNodeIds") or []:
            if str(source_id) not in node_ids:
                errors.append(f"跳级测试 {part_id} 引用了不存在的 node {source_id}")
    validation = package.get("validation") if isinstance(package.get("validation"), dict) else {}
    if validation.get("valid") is not True:
        errors.append("Activity Schema 活动库未通过校验")
    return errors


def load_seed_package() -> dict:
    package = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    errors = validate_package(package)
    if errors:
        raise ValueError("；".join(errors))
    return package


async def ensure_seeded(db: AsyncSession) -> GuidedCourse:
    package = load_seed_package()
    structure = package["course"]
    course_id = str(structure["id"])
    course = await db.get(GuidedCourse, course_id)
    if course is not None and course.content_hash == package["contentHash"]:
        return course
    if course is None:
        course = GuidedCourse(
            id=course_id,
            version=package["version"],
            schema_version=int(structure.get("schemaVersion") or 1),
            title=str(structure.get("title") or course_id),
            structure=structure,
            content_hash=package["contentHash"],
            published=True,
        )
        db.add(course)
        await db.flush()
    else:
        course.version = package["version"]
        course.schema_version = int(structure.get("schemaVersion") or 1)
        course.title = str(structure.get("title") or course_id)
        course.structure = structure
        course.content_hash = package["contentHash"]
        course.published = True

    await db.execute(delete(GuidedCourseActivity).where(GuidedCourseActivity.course_id == course_id))
    await db.flush()
    for position, record in enumerate(package["activities"]):
        activity_id = str(record["id"])
        activity = await db.get(GuidedActivity, activity_id)
        if activity is None:
            activity = GuidedActivity(
                id=activity_id,
                version=package["version"],
                schema_version=int(record.get("schemaVersion") or 1),
                activity_type=str(record.get("type") or "unknown"),
                record=record,
            )
            db.add(activity)
        else:
            activity.version = package["version"]
            activity.schema_version = int(record.get("schemaVersion") or 1)
            activity.activity_type = str(record.get("type") or "unknown")
            activity.record = record
        await db.flush()
        db.add(GuidedCourseActivity(course_id=course_id, activity_id=activity_id, position=position))
    await db.commit()
    await db.refresh(course)
    return course


async def default_course_package(db: AsyncSession) -> dict:
    await ensure_seeded(db)
    result = await db.execute(
        select(GuidedCourse).where(GuidedCourse.published.is_(True)).order_by(GuidedCourse.updated_at.desc())
    )
    course = result.scalars().first()
    if course is None:
        raise CourseNotFoundError("暂无已发布的引导学习课程")
    activities = (
        await db.execute(
            select(GuidedActivity)
            .join(GuidedCourseActivity, GuidedCourseActivity.activity_id == GuidedActivity.id)
            .where(GuidedCourseActivity.course_id == course.id)
            .order_by(GuidedCourseActivity.position)
        )
    ).scalars().all()
    return {
        "version": course.version,
        "activitySchemaVersion": course.schema_version,
        "contentHash": course.content_hash,
        "course": course.structure,
        "activities": [activity.record for activity in activities],
    }


async def _course(db: AsyncSession, course_id: str) -> GuidedCourse:
    course = await db.get(GuidedCourse, course_id)
    if course is None or not course.published:
        await ensure_seeded(db)
        course = await db.get(GuidedCourse, course_id)
    if course is None or not course.published:
        raise CourseNotFoundError("课程不存在")
    return course


def _empty_progress(course: dict, owner: str) -> dict:
    nodes = {
        str(node["id"]): {"status": "available" if index == 0 else "locked", "completedAt": None, "metrics": None}
        for index, node in enumerate(course.get("nodes") or [])
    }
    now = _now_ms()
    return {
        "schemaVersion": PROGRESS_SCHEMA_VERSION,
        "userId": owner,
        "courseId": str(course.get("id") or ""),
        "currentNodeId": str((course.get("nodes") or [{}])[0].get("id") or "") if course.get("nodes") else "",
        "nodes": nodes,
        "placementTests": {},
        "preferences": {"languageMode": "zh", "defaultMode": "learning"},
        "createdAt": now,
        "updatedAt": now,
    }


def _normalize_progress(raw: dict | None, course: dict, owner: str) -> dict:
    base = _empty_progress(course, owner)
    source = raw if isinstance(raw, dict) else {}
    result = {
        **base,
        "createdAt": int(source.get("createdAt") or base["createdAt"]),
        "updatedAt": int(source.get("updatedAt") or base["updatedAt"]),
        "placementTests": source.get("placementTests") if isinstance(source.get("placementTests"), dict) else {},
        "preferences": source.get("preferences") if isinstance(source.get("preferences"), dict) else base["preferences"],
    }
    first_incomplete = False
    for node in course.get("nodes") or []:
        node_id = str(node["id"])
        entry = source.get("nodes", {}).get(node_id, {}) if isinstance(source.get("nodes"), dict) else {}
        completed = isinstance(entry, dict) and entry.get("status") == "completed"
        if completed:
            result["nodes"][node_id] = {
                "status": "completed",
                "completedAt": int(entry.get("completedAt") or _now_ms()),
                "metrics": entry.get("metrics") if isinstance(entry.get("metrics"), dict) else None,
            }
        else:
            result["nodes"][node_id] = {
                "status": "locked" if first_incomplete else "available",
                "completedAt": None,
                "metrics": None,
            }
            first_incomplete = True
    available = next((node_id for node_id, item in result["nodes"].items() if item["status"] == "available"), None)
    ordered = course.get("nodes") or []
    result["currentNodeId"] = available or (str(ordered[-1]["id"]) if ordered else "")
    return result


async def _progress_row(db: AsyncSession, owner: str, course_id: str) -> GuidedLearningProgress | None:
    result = await db.execute(
        select(GuidedLearningProgress).where(
            GuidedLearningProgress.owner_id == owner,
            GuidedLearningProgress.course_id == course_id,
        )
    )
    return result.scalar_one_or_none()


async def get_progress(db: AsyncSession, owner: str, course_id: str) -> tuple[dict, int]:
    course = await _course(db, course_id)
    row = await _progress_row(db, owner, course_id)
    return _normalize_progress(row.progress if row else None, course.structure, owner), row.revision if row else 0


def preview_progress(course: dict, owner: str) -> dict:
    progress = _empty_progress(course, owner)
    for entry in progress["nodes"].values():
        entry["status"] = "available"
    progress["adminPreview"] = True
    return progress


async def get_preview_progress(db: AsyncSession, owner: str, course_id: str) -> dict:
    course = await _course(db, course_id)
    return preview_progress(course.structure, owner)


async def _save_progress(
    db: AsyncSession,
    owner: str,
    course: GuidedCourse,
    progress: dict,
) -> tuple[dict, int]:
    normalized = _normalize_progress({**progress, "updatedAt": _now_ms()}, course.structure, owner)
    row = await _progress_row(db, owner, course.id)
    if row is None:
        row = GuidedLearningProgress(
            id=uid("glp_"),
            owner_id=owner,
            course_id=course.id,
            schema_version=PROGRESS_SCHEMA_VERSION,
            progress=normalized,
            revision=1,
        )
        db.add(row)
    else:
        row.progress = normalized
        row.schema_version = PROGRESS_SCHEMA_VERSION
        row.revision += 1
    await db.commit()
    await db.refresh(row)
    return row.progress, row.revision


async def update_progress(db: AsyncSession, owner: str, course_id: str, data: dict) -> tuple[dict, int]:
    course = await _course(db, course_id)
    existing, revision = await get_progress(db, owner, course_id)
    expected = data.get("revision")
    if expected is not None and int(expected) != revision:
        raise ValueError("进度已更新，请重新加载")
    if data.get("reset") is True:
        reset = _empty_progress(course.structure, owner)
        reset["preferences"] = existing.get("preferences", reset["preferences"])
        return await _save_progress(db, owner, course, reset)
    incoming = data.get("progress") if isinstance(data.get("progress"), dict) else data
    for node_id, entry in existing["nodes"].items():
        patch = incoming.get("nodes", {}).get(node_id, {}) if isinstance(incoming.get("nodes"), dict) else {}
        if entry["status"] == "completed" and isinstance(patch, dict) and isinstance(patch.get("metrics"), dict):
            entry["metrics"] = patch["metrics"]
    preferences = incoming.get("preferences") if isinstance(incoming.get("preferences"), dict) else {}
    language_mode = str(preferences.get("languageMode") or existing["preferences"]["languageMode"])
    default_mode = str(preferences.get("defaultMode") or existing["preferences"]["defaultMode"])
    existing["preferences"] = {
        "languageMode": language_mode if language_mode in {"zh", "en", "bilingual"} else "zh",
        "defaultMode": default_mode if default_mode in {"learning", "free"} else "learning",
    }
    return await _save_progress(db, owner, course, existing)


async def complete_node(
    db: AsyncSession,
    owner: str,
    course_id: str,
    node_id: str,
    data: dict,
    *,
    preview: bool = False,
) -> tuple[dict, int]:
    if preview:
        raise PreviewWriteError("管理员预览不写入学员解锁进度")
    course = await _course(db, course_id)
    if not any(str(node.get("id")) == node_id for node in course.structure.get("nodes") or []):
        raise CourseNotFoundError("节点不存在")
    progress, _ = await get_progress(db, owner, course_id)
    entry = progress["nodes"][node_id]
    if entry["status"] == "locked":
        raise LockedNodeError("当前节点尚未解锁")
    entry["status"] = "completed"
    entry["completedAt"] = entry.get("completedAt") or _now_ms()
    entry["metrics"] = data.get("metrics") if isinstance(data.get("metrics"), dict) else entry.get("metrics")
    return await _save_progress(db, owner, course, progress)


async def placement_attempt(
    db: AsyncSession,
    owner: str,
    course_id: str,
    part_id: str,
    data: dict,
    *,
    preview: bool = False,
) -> tuple[dict, int, dict]:
    if preview:
        raise PreviewWriteError("管理员预览不写入学员解锁进度")
    course = await _course(db, course_id)
    config = (course.structure.get("placementTests") or {}).get(part_id)
    if not isinstance(config, dict):
        raise CourseNotFoundError("跳级测试不存在")
    progress, _ = await get_progress(db, owner, course_id)
    part_nodes = [node for node in course.structure.get("nodes") or [] if str(node.get("partId")) == part_id]
    if not part_nodes or progress["nodes"][str(part_nodes[0]["id"])]["status"] == "locked":
        raise LockedNodeError("当前部分尚未解锁")
    total = max(1, int(data.get("total") or config.get("expectedActivityCount") or 1))
    correct = max(0, min(total, int(data.get("correct") or 0)))
    percent = round(correct / total * 100)
    passed = correct >= int(config.get("requiredCorrect") or total) and percent >= int(config.get("passPercent") or 100)
    completed_at = _now_ms()
    attempt = {
        "testId": str(config.get("id") or ""),
        "partId": part_id,
        "correct": correct,
        "total": total,
        "percent": percent,
        "passed": passed,
        "activeDurationSeconds": max(1, int(data.get("activeDurationSeconds") or 1)),
        "completedAt": completed_at,
        "answers": data.get("answers") if isinstance(data.get("answers"), list) else [],
    }
    previous = progress["placementTests"].get(part_id) or {}
    history = [*(previous.get("history") or []), attempt][-10:]
    progress["placementTests"][part_id] = {
        "partId": part_id,
        "attemptCount": int(previous.get("attemptCount") or 0) + 1,
        "passed": bool(previous.get("passed") or passed),
        "passedAt": previous.get("passedAt") or (completed_at if passed else None),
        "bestCorrect": max(int(previous.get("bestCorrect") or 0), correct),
        "bestPercent": max(int(previous.get("bestPercent") or 0), percent),
        "latest": attempt,
        "history": history,
    }
    if passed:
        for node in part_nodes:
            node_id = str(node["id"])
            if progress["nodes"][node_id]["status"] != "completed":
                progress["nodes"][node_id] = {"status": "completed", "completedAt": completed_at, "metrics": None}
    saved, revision = await _save_progress(db, owner, course, progress)
    return saved, revision, attempt
