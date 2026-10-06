"""题目收藏业务：收藏/取消收藏、批量状态、收藏列表（题目+解析）。"""
import base64
import json
from datetime import datetime
from sqlalchemy import String, cast, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from app.models.question import Question, QuestionBank
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

async def question_favorite_counts(db, viewer, question_ids):
    """批量题目收藏总数（全站维度，侧栏角标用）；无权访问的题目不返回。"""
    ids = [i for i in (_clean(item) for item in question_ids) if i][:200]
    accessible = []
    for identifier in ids:
        try:
            await require_question_access(db, viewer, identifier)
            accessible.append(identifier)
        except (QuestionCommentPermissionError, QuestionCommentNotFoundError):
            pass
    if not accessible: return {}
    rows = dict((await db.execute(select(QuestionFavorite.question_id, func.count()).where(QuestionFavorite.question_id.in_(accessible)).group_by(QuestionFavorite.question_id))).all())
    return {identifier: int(rows.get(identifier, 0)) for identifier in accessible}

def _serialize(question, created_at, bank=None):
    return {
        'questionId': question.id,
        'stemText': _stem_text(question),
        'analysis': (question.analysis or '').strip(),
        'type': question.type,
        'favoritedAt': created_at.isoformat() if isinstance(created_at, datetime) else created_at,
        'source': {
            'bankName': (bank.name if bank is not None else '') or '',
            'subject': _clean(question.subject) or _clean(bank.subject if bank is not None else ''),
            'difficulty': _clean(question.difficulty),
        },
    }

def _search_pattern(raw):
    text = _clean(raw)
    if not text:
        return None
    return '%' + text.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'

async def list_favorites(db, viewer, cursor=None, limit=MAX_LIST_SIZE, search=None):
    """收藏列表：按收藏时间倒序，逐题过访问校验（无权项跳过）；search 匹配标题/题干/解析。"""
    query = (
        select(QuestionFavorite, Question, QuestionBank)
        .join(Question, Question.id == QuestionFavorite.question_id)
        .join(QuestionBank, QuestionBank.id == Question.bank_id)
        .where(QuestionFavorite.owner_id == viewer.username)
    )
    pattern = _search_pattern(search)
    if pattern:
        query = query.where(or_(
            Question.title.ilike(pattern, escape='\\'),
            cast(Question.stem_parts, String).ilike(pattern, escape='\\'),
            Question.analysis.ilike(pattern, escape='\\'),
        ))
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
    for favorite, question, bank in rows:
        try:
            await require_question_access(db, viewer, question.id)
        except (QuestionCommentPermissionError, QuestionCommentNotFoundError):
            continue
        items.append(_serialize(question, favorite.created_at, bank))
    return {'favorites': items, 'nextCursor': next_cursor}

async def favorite_detail(db, viewer, question_id):
    """收藏题目详情：完整题干/选项（含正确项）/解析/来源，供收藏抽屉查看。"""
    question = await db.get(Question, _clean(question_id))
    if question is None:
        raise QuestionCommentNotFoundError('题目不存在')
    await require_question_access(db, viewer, question.id)
    favorite = await db.get(QuestionFavorite, {'question_id': question.id, 'owner_id': viewer.username})
    bank = await db.get(QuestionBank, question.bank_id)
    return {
        'questionId': question.id,
        'title': question.title,
        'stemParts': question.stem_parts or [],
        'type': question.type,
        'options': [
            {
                'id': option.get('id'),
                'text': option.get('text'),
                'correct': bool(option.get('correct')),
            }
            for option in (question.options or [])
            if isinstance(option, dict)
        ],
        'correctAnswer': question.correct_answer,
        'correctAnswerIds': question.correct_answer_ids or [],
        'analysis': (question.analysis or '').strip(),
        'clues': question.clues or [],
        'concepts': question.concepts or [],
        'source': {
            'bankName': (bank.name if bank is not None else '') or '',
            'subject': _clean(question.subject) or _clean(bank.subject if bank is not None else ''),
            'difficulty': _clean(question.difficulty),
        },
        'favorited': favorite is not None,
        'favoritedAt': favorite.created_at.isoformat() if favorite is not None and isinstance(favorite.created_at, datetime) else None,
    }
