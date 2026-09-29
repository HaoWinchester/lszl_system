"""Learner/release coverage from accepted answers; never infer learning from opens."""
from sqlalchemy import text


_ANSWERED_QUERY = """
SELECT DISTINCT session.release_id, answer.key AS question_id
        FROM practice_sessions AS session
        CROSS JOIN LATERAL jsonb_each(session.answers) AS answer
        WHERE session.owner_id = :owner AND session.release_id = ANY(CAST(:release_ids AS text[]))
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
    """


async def answered_question_ids(db, owner: str, release_id: str) -> set[str]:
    result = await db.execute(text(_ANSWERED_QUERY), {'owner': owner, 'release_ids': [release_id]})
    return {row.question_id for row in result}


async def coverage_summaries(db, owner: str, release_ids: list[str]) -> dict[str, dict]:
    """One batch query; count distinct accepted answers against frozen question IDs."""
    if not release_ids:
        return {}
    result = await db.execute(text(f"""
        WITH answered AS ({_ANSWERED_QUERY})
        SELECT q.release_id, COUNT(DISTINCT q.question_id) AS total,
               COUNT(DISTINCT a.question_id) AS completed
        FROM paper_release_questions q
        LEFT JOIN answered a ON a.release_id = q.release_id AND a.question_id = q.question_id
        WHERE q.release_id = ANY(CAST(:release_ids AS text[]))
        GROUP BY q.release_id
    """), {'owner': owner, 'release_ids': release_ids})
    return {row.release_id: dict(releaseId=row.release_id, totalCount=row.total,
                                completedCount=row.completed, remainingUnseen=row.total-row.completed)
            for row in result}


def selection_summary(question_order: list[dict], all_ids: set[str], answered_ids: set[str], requested: int) -> dict:
    unseen = all_ids - answered_ids
    new_count = sum(ref['questionId'] in unseen for ref in question_order)
    return dict(requestedCount=requested, actualCount=len(question_order),
                unseenCount=new_count, reviewCount=len(question_order)-new_count,
                totalCount=len(all_ids), completedCount=len(all_ids & answered_ids),
                remainingUnseen=len(unseen))
