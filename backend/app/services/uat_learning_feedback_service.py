"""Explicit, idempotent preparation of one UAT acceptance paper/question."""
from copy import deepcopy
from hashlib import sha256
from uuid import uuid4

from sqlalchemy import func, select
from app.core.config import settings
from app.models.paper_release import PaperRelease, PaperReleaseQuestion
from app.models.question import Question
from app.models.question_comment import QuestionComment, HIDDEN
from app.models.user import User
from app.services import paper_release_service

MODES = ('practice_mode', 'multi_question_canvas', 'deep_recall')
TARGET = 200


async def prepare(db, *, release_id: str, question_id: str, apply: bool = False) -> dict:
    if settings.ENV != 'uat':
        raise ValueError('Only the UAT environment may prepare acceptance data')
    selected = await db.get(PaperRelease, release_id)
    if not selected:
        raise ValueError('Selected release does not exist')
    active = await db.scalar(select(PaperRelease).where(
        PaperRelease.paper_id == selected.paper_id, PaperRelease.status == 'published'
    ).with_for_update())
    if not active:
        raise ValueError('Selected paper has no active release')
    rows = list((await db.scalars(select(PaperReleaseQuestion).where(
        PaperReleaseQuestion.release_id == active.id
    ).order_by(PaperReleaseQuestion.order_index))).all())
    if not any(row.question_id == question_id for row in rows):
        raise ValueError('Selected question must belong to the selected paper')
    question = await db.get(Question, question_id)
    actor = await db.get(User, active.publisher_id)
    if not question or not actor or actor.role not in {'teacher', 'admin'}:
        raise ValueError('Question and original publisher must still exist')
    # Serialize concurrent runs for this one question as well as its release.
    await db.scalar(select(Question.id).where(Question.id == question_id).with_for_update())
    eligible = int(await db.scalar(select(func.count()).select_from(QuestionComment).where(
        QuestionComment.question_id == question_id,
        QuestionComment.status != HIDDEN,
        func.char_length(QuestionComment.content) <= 30,
    )) or 0)
    if eligible > TARGET:
        raise ValueError('More than 200 eligible comments already exist; no user comments will be removed')
    missing = [mode for mode in MODES if mode not in (active.enabled_modes or [])]
    result = {'paperId': active.paper_id, 'paperName': active.name, 'releaseId': active.id,
              'questionId': question_id, 'modesToAdd': missing,
              'commentsToAdd': TARGET-eligible, 'eligibleComments': eligible, 'applied': apply}
    if not apply:
        await db.rollback()
        return result
    if missing:
        refs = [{'order': row.order_index+1, 'bankId': row.bank_id,
                 'questionId': row.question_id, 'score': row.snapshot.get('releaseScore', 1),
                 'question': deepcopy(row.snapshot)} for row in rows]
        # Publish a new version through the normal service. Prior frozen releases
        # remain available to historical sessions; never rewrite their snapshots.
        payload = {'releaseId': 'pr_'+uuid4().hex, 'paperId': active.paper_id,
                   'version': active.version+1, 'name': active.name, 'subject': active.subject,
                   'description': active.description, 'paperType': active.paper_type,
                   'publishedBy': active.publisher_id, 'accessLevel': active.access_level,
                   'allowedRoles': deepcopy(active.allowed_roles),
                   'enabledModes': list(dict.fromkeys([*(active.enabled_modes or []), *MODES])),
                   'metadata': deepcopy(active.release_metadata), 'questions': refs,
                   'questionSnapshots': deepcopy(refs)}
        active = await paper_release_service.publish_from_payload(db, actor, payload)
        result['releaseId'] = active.id
    # Service publication commits its transaction. Lock/recount before adding data.
    await db.scalar(select(Question.id).where(Question.id == question_id).with_for_update())
    current = int(await db.scalar(select(func.count()).select_from(QuestionComment).where(
        QuestionComment.question_id == question_id, QuestionComment.status != HIDDEN,
        func.char_length(QuestionComment.content) <= 30,
    )) or 0)
    added = 0
    for index in range(1, TARGET+1):
        if current+added >= TARGET:
            break
        comment_id = 'uat-feedback-'+sha256(f'{question_id}:{index}'.encode()).hexdigest()[:40]
        if await db.get(QuestionComment, comment_id):
            continue
        db.add(QuestionComment(id=comment_id, question_id=question_id,
                               owner_id=actor.username, content=f'[UAT测试{index:03d}] 先分析影响再采取行动'))
        added += 1
    await db.commit()
    result.update(commentsToAdd=added, eligibleComments=current+added)
    return result
