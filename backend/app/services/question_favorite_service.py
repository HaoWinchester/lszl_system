"""题目收藏业务：收藏/取消收藏、批量状态、收藏列表（题目+解析）。"""
import base64
import json
from datetime import datetime
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from app.models.question import Question
from app.models.question_favorite import QuestionFavorite
from app.services.question_comment_service import (
    QuestionCommentNotFoundError,
    QuestionCommentPermissionError,
    QuestionCommentValidationError,
    require_question_access,
)
MAX_LIST_SIZE = 50

def _clean(value): return str(value or '').strip()

def _stem_text(question):
    parts = question.stem_parts or []
    texts = [_clean(part.get('text') if isinstance(part, dict) else part) for part in parts]
    return ''.join(text for text in texts if text) or question.title

async def toggle_favorite(db, user, question_id):
    row = await db.get(QuestionFavorite, {'question_id': question_id, 'owner_id': user.username})
    if row:
        await db.delete(row)
        await db.commit()
        return {'questionId': question_id, 'favorited': False}
    await require_question_access(db, user, question_id)
    await db.execute(insert(QuestionFavorite).values(question_id=question_id, owner_id=user.username).on_conflict_do_nothing(index_elements=['question_id', 'owner_id']))
    await db.commit()
    return {'questionId': question_id, 'favorited': True}

async def set_favorite(db, user, question_id, enabled):
    if enabled:
        await require_question_access(db, user, question_id)
        await db.execute(insert(QuestionFavorite).values(question_id=question_id, owner_id=user.username).on_conflict_do_nothing(index_elements=['question_id', 'owner_id']))
    else:
        await db.execute(delete(QuestionFavorite).where(QuestionFavorite.question_id == question_id, QuestionFavorite.owner_id == user.username))
    await db.commit()
    return {'questionId': question_id, 'favorited': bool(enabled)}

async def favorite_status(db, user, question_ids):
    ids = [i for i in (_clean(item) for item in question_ids) if i][:200]
    if not ids: return {}
    favorited = set((await db.execute(select(QuestionFavorite.question_id).where(QuestionFavorite.owner_id == user.username, QuestionFavorite.question_id.in_(ids)))).scalars())
    return {i: i in favorited for i in ids}

def _serialize(question, created_at):
    return {
        'questionId': question.id,
        'stemText': _stem_text(question),
        'analysis': (question.analysis or '').strip(),
        'type': question.type,
        'favoritedAt': created_at.isoformat() if isinstance(created_at, datetime) else created_at,
    }

async def list_favorites(db, viewer, cursor=None, limit=MAX_LIST_SIZE):
    """收藏列表：按收藏时间倒序，逐题过访问校验（无权项跳过）。"""
    query = select(QuestionFavorite, Question).join(Question, Question.id == QuestionFavorite.question_id).where(QuestionFavorite.owner_id == viewer.username)
    if cursor:
        try:
            stamp, identifier = json.loads(base64.urlsafe_b64decode(cursor + '=' * (-len(cursor) % 4)))
            stamp = datetime.fromisoformat(stamp)
            if stamp.tzinfo is None or not isinstance(identifier, str): raise ValueError()
        except (ValueError, TypeError, UnicodeError): raise QuestionCommentValidationError('分页游标无效')
        query = query.where((QuestionFavorite.created_at < stamp) | ((QuestionFavorite.created_at == stamp) & (QuestionFavorite.question_id < identifier)))
    rows = list((await db.execute(query.order_by(QuestionFavorite.created_at.desc(), QuestionFavorite.question_id.desc()).limit(limit + 1))).all())
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = base64.urlsafe_b64encode(json.dumps([last[0].created_at.isoformat(), last[0].question_id]).encode()).decode().rstrip('=')
    rows = rows[:limit]
    items = []
    for favorite, question in rows:
        try:
            await require_question_access(db, viewer, question.id)
        except (QuestionCommentPermissionError, QuestionCommentNotFoundError):
            continue
        items.append(_serialize(question, favorite.created_at))
    return {'favorites': items, 'nextCursor': next_cursor}
