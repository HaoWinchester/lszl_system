"""题目留言（评论）业务：公共讨论内容，读不限 owner；点赞幂等；管理删除走软删。"""

import uuid

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.question import Question
from app.models.question_comment import HIDDEN, QuestionComment, QuestionCommentLike
from app.models.user import User

MAX_CONTENT_LENGTH = 200
MAX_LIST_SIZE = 50
DANMAKU_MAX_LENGTH = 30

MANAGER_ROLES = ("admin", "teacher")


class QuestionCommentNotFoundError(ValueError):
    pass


class QuestionCommentPermissionError(ValueError):
    pass


class QuestionCommentValidationError(ValueError):
    pass


def _clean(value) -> str:
    return str(value or "").strip()


def _is_manager(user: User) -> bool:
    return user.role in MANAGER_ROLES


def _display_name(user: User) -> str:
    return user.display_name or user.username


async def get_comment(
    db: AsyncSession, comment_id: str, question_id: str
) -> QuestionComment | None:
    return (
        await db.execute(
            select(QuestionComment).where(
                QuestionComment.id == comment_id,
                QuestionComment.question_id == question_id,
            )
        )
    ).scalar_one_or_none()


def _visible(comment: QuestionComment) -> bool:
    return comment.status != HIDDEN


async def _load_profiles(db: AsyncSession, usernames: set[str]) -> dict[str, str]:
    if not usernames:
        return {}
    rows = await db.execute(
        select(User.username, User.display_name).where(User.username.in_(usernames))
    )
    return {username: (display_name or username) for username, display_name in rows.all()}


def _serialize(
    comment: QuestionComment,
    *,
    profiles: dict[str, str],
    viewer: User | None,
    liked_comment_ids: set[str],
) -> dict:
    return {
        "id": comment.id,
        "questionId": comment.question_id,
        "content": comment.content,
        "likeCount": comment.like_count,
        "createdAt": comment.created_at.isoformat() if comment.created_at else None,
        "author": profiles.get(comment.owner_id, comment.owner_id),
        "isMine": bool(viewer and comment.owner_id == viewer.username),
        "myLike": comment.id in liked_comment_ids,
        "danmakuEligible": len(comment.content) <= DANMAKU_MAX_LENGTH,
        "canDelete": bool(
            viewer and (comment.owner_id == viewer.username or _is_manager(viewer))
        ),
    }


async def _liked_comment_ids(db: AsyncSession, viewer: User, comment_ids: list[str]) -> set[str]:
    if not viewer or not comment_ids:
        return set()
    rows = await db.execute(
        select(QuestionCommentLike.comment_id).where(
            QuestionCommentLike.owner_id == viewer.username,
            QuestionCommentLike.comment_id.in_(comment_ids),
        )
    )
    return {row for row in rows.scalars()}


async def list_comments(
    db: AsyncSession, viewer: User | None, question_id: str
) -> list[dict]:
    """最近 50 条倒序（新→旧）。仅返回可见留言。"""
    rows = await db.execute(
        select(QuestionComment)
        .where(
            QuestionComment.question_id == question_id,
            QuestionComment.status != HIDDEN,
        )
        .order_by(QuestionComment.created_at.desc(), QuestionComment.id.desc())
        .limit(MAX_LIST_SIZE)
    )
    comments = list(rows.scalars())
    profiles = await _load_profiles(db, {comment.owner_id for comment in comments})
    liked = await _liked_comment_ids(db, viewer, [comment.id for comment in comments])
    return [
        _serialize(comment, profiles=profiles, viewer=viewer, liked_comment_ids=liked)
        for comment in comments
    ]


async def create_comment(db: AsyncSession, user: User, question_id: str, content) -> dict:
    text = _clean(content)
    if not text:
        raise QuestionCommentValidationError("留言内容不能为空")
    if len(text) > MAX_CONTENT_LENGTH:
        raise QuestionCommentValidationError(f"留言内容不能超过 {MAX_CONTENT_LENGTH} 字")

    question = await db.get(Question, question_id)
    if not question:
        raise QuestionCommentNotFoundError("题目不存在")

    comment = QuestionComment(
        id=f"qc-{uuid.uuid4().hex}",
        question_id=question_id,
        owner_id=user.username,
        content=text,
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return _serialize(
        comment,
        profiles={user.username: _display_name(user)},
        viewer=user,
        liked_comment_ids=set(),
    )


async def add_like(
    db: AsyncSession, user: User, question_id: str, comment_id: str
) -> dict:
    comment = await get_comment(db, comment_id, question_id)
    if not comment or not _visible(comment):
        raise QuestionCommentNotFoundError("留言不存在")

    inserted = await db.execute(
        insert(QuestionCommentLike)
        .values(comment_id=comment_id, owner_id=user.username)
        .on_conflict_do_nothing(
            index_elements=[
                QuestionCommentLike.comment_id,
                QuestionCommentLike.owner_id,
            ]
        )
    )
    if inserted.rowcount:
        # 只有真正插入点赞记录的请求才增加计数，并发重复请求保持幂等。
        await db.execute(
            update(QuestionComment)
            .where(QuestionComment.id == comment_id)
            .values(like_count=QuestionComment.like_count + 1)
        )
        await db.commit()
        await db.refresh(comment)
    profiles = await _load_profiles(db, {comment.owner_id})
    return _serialize(
        comment,
        profiles=profiles,
        viewer=user,
        liked_comment_ids={comment.id},
    )


async def remove_like(
    db: AsyncSession, user: User, question_id: str, comment_id: str
) -> dict:
    comment = await get_comment(db, comment_id, question_id)
    if not comment or not _visible(comment):
        raise QuestionCommentNotFoundError("留言不存在")

    result = await db.execute(
        delete(QuestionCommentLike).where(
            QuestionCommentLike.comment_id == comment_id,
            QuestionCommentLike.owner_id == user.username,
        )
    )
    if result.rowcount:
        await db.execute(
            update(QuestionComment)
            .where(QuestionComment.id == comment_id, QuestionComment.like_count > 0)
            .values(like_count=QuestionComment.like_count - 1)
        )
        await db.commit()
        await db.refresh(comment)
    profiles = await _load_profiles(db, {comment.owner_id})
    return _serialize(
        comment,
        profiles=profiles,
        viewer=user,
        liked_comment_ids=set(),
    )


async def delete_comment(
    db: AsyncSession, user: User, question_id: str, comment_id: str
) -> None:
    comment = await get_comment(db, comment_id, question_id)
    if not comment:
        raise QuestionCommentNotFoundError("留言不存在")
    if comment.owner_id != user.username and not _is_manager(user):
        raise QuestionCommentPermissionError("只能删除自己的留言")

    comment.status = HIDDEN
    await db.commit()
    await db.refresh(comment)


async def count_comments(db: AsyncSession, question_ids: list[str]) -> dict[str, int]:
    """批量取题目可见留言数，供列表页徽标等后续复用。"""
    if not question_ids:
        return {}
    rows = await db.execute(
        select(QuestionComment.question_id, func.count())
        .where(
            QuestionComment.question_id.in_(question_ids),
            QuestionComment.status != HIDDEN,
        )
        .group_by(QuestionComment.question_id)
    )
    return {question_id: count for question_id, count in rows.all()}
