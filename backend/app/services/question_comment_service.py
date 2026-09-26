"""Shared discussion policy, stable paging, replies and private favorites."""
import base64
import json
import uuid
from datetime import datetime
from sqlalchemy import and_, or_, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from app.models.question import Question, QuestionBank
from app.models.question_comment import HIDDEN, QuestionComment, QuestionCommentLike, QuestionCommentFavorite
from app.models.user import User
MAX_CONTENT_LENGTH = 200
MAX_LIST_SIZE = 50
DANMAKU_MAX_LENGTH = 30
MANAGER_ROLES = ('admin', 'teacher')
class QuestionCommentNotFoundError(ValueError): pass
class QuestionCommentPermissionError(ValueError): pass
class QuestionCommentValidationError(ValueError): pass

def _clean(value): return str(value or '').strip()

async def require_question_access(db, viewer, question_id):
    question = await db.get(Question, question_id)
    if not question: raise QuestionCommentNotFoundError('题目不存在')
    bank = await db.get(QuestionBank, question.bank_id)
    from app.services import question_access_service, published_paper_access_service
    if viewer and bank and await question_access_service.can_view_bank(db, viewer, bank): return question
    if viewer and bank and bank.visibility == 'published' and question.scope == 'public': return question
    if viewer:
        from app.models.paper_release import PaperRelease, PaperReleaseQuestion
        releases = (await db.execute(select(PaperRelease).join(PaperReleaseQuestion, PaperReleaseQuestion.release_id == PaperRelease.id).where(PaperReleaseQuestion.question_id == question_id, PaperRelease.status.in_(['published','superseded'])))).scalars().all()
        for release in releases:
            for mode in release.enabled_modes or []:
                if await published_paper_access_service.load_published_question_snapshot(db, viewer, release.id, question_id, mode=mode): return question
    raise QuestionCommentPermissionError('当前账号无权访问该题目')

async def get_comment(db, comment_id, question_id):
    return (await db.execute(select(QuestionComment).where(QuestionComment.id == comment_id, QuestionComment.question_id == question_id))).scalar_one_or_none()

async def _target(db, user, question_id, comment_id):
    await require_question_access(db, user, question_id)
    comment = await get_comment(db, comment_id, question_id)
    if not comment or comment.status == HIDDEN: raise QuestionCommentNotFoundError('留言不存在')
    return comment

async def _serialize_many(db, viewer, comments):
    ids = [c.id for c in comments]
    profiles = dict((await db.execute(select(User.username, User.display_name).where(User.username.in_({c.owner_id for c in comments})))).all()) if ids else {}
    liked = set((await db.execute(select(QuestionCommentLike.comment_id).where(QuestionCommentLike.owner_id == viewer.username, QuestionCommentLike.comment_id.in_(ids)))).scalars()) if viewer and ids else set()
    favorites = set((await db.execute(select(QuestionCommentFavorite.comment_id).where(QuestionCommentFavorite.owner_id == viewer.username, QuestionCommentFavorite.comment_id.in_(ids)))).scalars()) if viewer and ids else set()
    return [dict(id=c.id, questionId=c.question_id, parentId=c.parent_id, content=c.content, likeCount=c.like_count, createdAt=c.created_at.isoformat(), author=profiles.get(c.owner_id) or c.owner_id, isMine=bool(viewer and c.owner_id == viewer.username), myLike=c.id in liked, myFavorite=c.id in favorites, danmakuEligible=len(c.content)<=DANMAKU_MAX_LENGTH, canDelete=bool(viewer and (c.owner_id == viewer.username or viewer.role in MANAGER_ROLES))) for c in comments]

async def _page(db, viewer, query, cursor=None, limit=50, filter_access=False):
    if cursor:
        try:
            stamp, identifier = json.loads(base64.urlsafe_b64decode(cursor + '=' * (-len(cursor) % 4)))
            stamp = datetime.fromisoformat(stamp)
            if stamp.tzinfo is None or not isinstance(identifier, str): raise ValueError()
        except (ValueError, TypeError, UnicodeError): raise QuestionCommentValidationError('分页游标无效')
        query = query.where(or_(QuestionComment.created_at < stamp, and_(QuestionComment.created_at == stamp, QuestionComment.id < identifier)))
    rows = list((await db.execute(query.order_by(QuestionComment.created_at.desc(), QuestionComment.id.desc()).limit(limit+1))).scalars())
    next_cursor = None
    if len(rows)>limit:
        last=rows[limit-1]
        next_cursor=base64.urlsafe_b64encode(json.dumps([last.created_at.isoformat(),last.id]).encode()).decode().rstrip('=')
    rows=rows[:limit]
    if filter_access:
        visible=[]
        for row in rows:
            try:
                await require_question_access(db,viewer,row.question_id)
                visible.append(row)
            except (QuestionCommentPermissionError,QuestionCommentNotFoundError): pass
        rows=visible
    return {'comments':await _serialize_many(db,viewer,rows),'nextCursor':next_cursor}

async def list_comments_page(db, viewer, question_id, cursor=None, limit=50):
    await require_question_access(db,viewer,question_id)
    return await _page(db,viewer,select(QuestionComment).where(QuestionComment.question_id==question_id,QuestionComment.status!=HIDDEN),cursor,limit)

async def list_comments(db, viewer, question_id): return (await list_comments_page(db,viewer,question_id))['comments']

async def list_favorites(db,viewer,cursor=None,limit=50):
    page=await _page(db,viewer,select(QuestionComment).join(QuestionCommentFavorite,QuestionCommentFavorite.comment_id==QuestionComment.id).where(QuestionCommentFavorite.owner_id==viewer.username,QuestionComment.status!=HIDDEN),cursor,limit,True)
    from app.services.question_service import question_to_dict
    for c in page['comments']:
        question = await db.get(Question, c['questionId'])
        c['questionTitle'] = question.title
        c['question'] = question_to_dict(question)
    return page

async def create_comment(db,user,question_id,content,parent_id=None):
    text=_clean(content)
    if not text: raise QuestionCommentValidationError('留言内容不能为空')
    if len(text)>MAX_CONTENT_LENGTH: raise QuestionCommentValidationError('留言内容不能超过 200 字')
    await require_question_access(db,user,question_id)
    if parent_id:
        parent=await get_comment(db,_clean(parent_id),question_id)
        if not parent or parent.status==HIDDEN: raise QuestionCommentValidationError('回复必须属于本题的可见留言')
    comment=QuestionComment(id=f'qc-{uuid.uuid4().hex}',question_id=question_id,owner_id=user.username,content=text,parent_id=_clean(parent_id) or None)
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return (await _serialize_many(db,user,[comment]))[0]

async def set_favorite(db,user,question_id,comment_id,enabled):
    comment=await _target(db,user,question_id,comment_id)
    if enabled: await db.execute(insert(QuestionCommentFavorite).values(comment_id=comment_id,owner_id=user.username).on_conflict_do_nothing(index_elements=['comment_id','owner_id']))
    else: await db.execute(delete(QuestionCommentFavorite).where(QuestionCommentFavorite.comment_id==comment_id,QuestionCommentFavorite.owner_id==user.username))
    await db.commit()
    await db.refresh(comment)
    return (await _serialize_many(db,user,[comment]))[0]

async def _like(db,user,question_id,comment_id,enabled):
    comment=await _target(db,user,question_id,comment_id)
    if enabled:
        result=await db.execute(insert(QuestionCommentLike).values(comment_id=comment_id,owner_id=user.username).on_conflict_do_nothing(index_elements=['comment_id','owner_id']))
    else:
        result=await db.execute(delete(QuestionCommentLike).where(QuestionCommentLike.comment_id==comment_id,QuestionCommentLike.owner_id==user.username))
    if result.rowcount:
        await db.execute(update(QuestionComment).where(QuestionComment.id==comment_id).values(like_count=func.greatest(0,QuestionComment.like_count+(1 if enabled else -1))))
    await db.commit()
    await db.refresh(comment)
    return (await _serialize_many(db,user,[comment]))[0]
async def add_like(db,user,question_id,comment_id): return await _like(db,user,question_id,comment_id,True)
async def remove_like(db,user,question_id,comment_id): return await _like(db,user,question_id,comment_id,False)

async def delete_comment(db,user,question_id,comment_id):
    await require_question_access(db,user,question_id)
    comment=await get_comment(db,comment_id,question_id)
    if not comment: raise QuestionCommentNotFoundError('留言不存在')
    if comment.owner_id!=user.username and user.role not in MANAGER_ROLES: raise QuestionCommentPermissionError('只能删除自己的留言')
    comment.status=HIDDEN
    await db.commit()
    await db.refresh(comment)

async def count_comments(db,question_ids):
    if not question_ids: return {}
    return dict((await db.execute(select(QuestionComment.question_id,func.count()).where(QuestionComment.question_id.in_(question_ids),QuestionComment.status!=HIDDEN).group_by(QuestionComment.question_id))).all())
