"""Learner/release coverage from accepted answers; never infer learning from opens."""
from sqlalchemy import text


async def answered_question_ids(db, owner: str, release_id: str) -> set[str]:
    # The append-only session history survives hiding a report. Read only keys,
    # avoiding question bodies and duplicated answer JSON in Python memory.
    result = await db.execute(text('''
        SELECT DISTINCT answer.key
        FROM practice_sessions AS session
        CROSS JOIN LATERAL jsonb_each(session.answers) AS answer
        WHERE session.owner_id = :owner AND session.release_id = :release
          AND jsonb_typeof(answer.value) = 'object'
          AND (answer.value ->> 'timedOut') IS DISTINCT FROM 'true'
          AND (answer.value ->> 'draft') IS DISTINCT FROM 'true'
          AND (
            COALESCE(answer.value ->> 'selectedAnswer', '') NOT IN ('', '__timeout__')
            OR (jsonb_typeof(answer.value -> 'selectedAnswerIds') = 'array'
                AND answer.value -> 'selectedAnswerIds' <> '[]'::jsonb)
            OR (jsonb_typeof(answer.value -> 'selectedPairs') = 'object'
                AND answer.value -> 'selectedPairs' <> '{}'::jsonb)
          )
    '''), {'owner': owner, 'release': release_id})
    return set(result.scalars())


def selection_summary(question_order: list[dict], all_ids: set[str], answered_ids: set[str], requested: int) -> dict:
    unseen = all_ids - answered_ids
    new_count = sum(ref['questionId'] in unseen for ref in question_order)
    return dict(requestedCount=requested, actualCount=len(question_order),
                unseenCount=new_count, reviewCount=len(question_order)-new_count,
                totalCount=len(all_ids), completedCount=len(all_ids & answered_ids),
                remainingUnseen=len(unseen))
