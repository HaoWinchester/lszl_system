"""单题留言（评论）API 契约：公共讨论、点赞幂等、删除权限。"""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.question import Question, QuestionBank
from app.models.question_comment import QuestionComment, QuestionCommentLike
from app.models.user import User
from app.services import question_comment_service

PASSWORD = "question-comment-pass"


def _ids() -> dict[str, str]:
    token = uuid4().hex[:10]
    return {
        "student": f"qc-student-{token}",
        "other": f"qc-other-{token}",
        "teacher": f"qc-teacher-{token}",
        "bank": f"qc-bank-{token}",
        "question": f"qc-question-{token}",
        "other_question": f"qc-other-question-{token}",
    }


async def _seed(ids: dict[str, str]) -> None:
    async with AsyncSessionLocal() as db:
        password_hash = hash_password(PASSWORD)
        db.add_all(
            [
                User(
                    username=ids["student"],
                    password_hash=password_hash,
                    role="student",
                    status="active",
                ),
                User(
                    username=ids["other"],
                    password_hash=password_hash,
                    role="student",
                    status="active",
                ),
                User(
                    username=ids["teacher"],
                    password_hash=password_hash,
                    role="teacher",
                    status="active",
                ),
            ]
        )
        await db.flush()
        db.add(
            QuestionBank(
                id=ids["bank"],
                owner_id=ids["teacher"],
                name="评论测试题库",
                visibility="published",
            )
        )
        await db.flush()
        db.add_all(
            [Question(
                id=ids["question"],
                bank_id=ids["bank"],
                title="评论测试题",
                scope="public",
            ), Question(
                id=ids["other_question"],
                bank_id=ids["bank"],
                title="另一道评论测试题",
                scope="public",
            )]
        )
        await db.commit()


def _cleanup(ids: dict[str, str]) -> None:
    async def _run() -> None:
        async with AsyncSessionLocal() as db:
            comments = (
                await db.execute(
                    select(QuestionComment).where(
                        QuestionComment.question_id == ids["question"]
                    )
                )
            ).scalars().all()
            for comment in comments:
                await db.delete(comment)
            for key in ("question", "other_question", "bank", "student", "other", "teacher"):
                obj = await db.get(
                    {"question": Question, "other_question": Question,
                     "bank": QuestionBank, "student": User,
                     "other": User, "teacher": User}[key],
                    ids[key],
                )
                if obj:
                    await db.delete(obj)
            await db.commit()

    asyncio.run(_run())


def _login(client: TestClient, username: str) -> None:
    assert client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": PASSWORD},
    ).status_code == 200


def _comments_url(ids: dict[str, str]) -> str:
    return f"/api/v1/questions/{ids['question']}/comments"


def test_comment_create_list_like_delete_lifecycle() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))
    try:
        with TestClient(app) as client:
            _login(client, ids["student"])

            # 空内容 422，题目不存在 404
            empty = client.post(_comments_url(ids), json={"content": "   "})
            assert empty.status_code == 422
            missing = client.post(
                f"/api/v1/questions/{uuid4().hex}/comments",
                json={"content": "hi"},
            )
            assert missing.status_code == 404

            created = client.post(
                _comments_url(ids), json={"content": "这题D选项有争议"}
            )
            assert created.status_code == 201, created.text
            comment = created.json()["comment"]
            assert comment["content"] == "这题D选项有争议"
            assert comment["isMine"] is True
            assert comment["likeCount"] == 0
            assert comment["danmakuEligible"] is True

            # URL 中的题目必须与留言所属题一致，不能借另一道题的路径操作。
            wrong_question_url = (
                f"/api/v1/questions/{ids['other_question']}/comments/{comment['id']}"
            )
            assert client.post(f"{wrong_question_url}/like").status_code == 404
            assert client.delete(f"{wrong_question_url}/like").status_code == 404
            assert client.delete(wrong_question_url).status_code == 404

            # 另一个学员可见（公共讨论）并可点赞
            with TestClient(app) as other_client:
                _login(other_client, ids["other"])
                listed = other_client.get(_comments_url(ids))
                assert listed.status_code == 200
                comments = listed.json()["comments"]
                assert len(comments) == 1
                assert comments[0]["isMine"] is False
                assert comments[0]["author"] == ids["student"]

                liked = other_client.post(
                    f"{_comments_url(ids)}/{comment['id']}/like"
                )
                assert liked.status_code == 200
                assert liked.json()["comment"]["likeCount"] == 1
                assert liked.json()["comment"]["myLike"] is True

                # 重复点赞幂等
                again = other_client.post(
                    f"{_comments_url(ids)}/{comment['id']}/like"
                )
                assert again.json()["comment"]["likeCount"] == 1

                # 取消点赞
                unliked = other_client.delete(
                    f"{_comments_url(ids)}/{comment['id']}/like"
                )
                assert unliked.json()["comment"]["likeCount"] == 0
                # 再取消不报错也不为负
                unliked_again = other_client.delete(
                    f"{_comments_url(ids)}/{comment['id']}/like"
                )
                assert unliked_again.status_code == 200
                assert unliked_again.json()["comment"]["likeCount"] == 0

                # 非本人且非管理不能删
                forbidden = other_client.delete(
                    f"{_comments_url(ids)}/{comment['id']}"
                )
                assert forbidden.status_code == 403

            # 本人可删（软删后列表不可见）
            deleted = client.delete(f"{_comments_url(ids)}/{comment['id']}")
            assert deleted.status_code == 204
            after = client.get(_comments_url(ids))
            assert after.json()["comments"] == []
    finally:
        _cleanup(ids)


def test_teacher_can_delete_any_comment() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))
    try:
        with TestClient(app) as client:
            _login(client, ids["student"])
            created = client.post(_comments_url(ids), json={"content": "会被老师删掉"})
            comment = created.json()["comment"]

        with TestClient(app) as teacher_client:
            _login(teacher_client, ids["teacher"])
            listed = teacher_client.get(_comments_url(ids))
            target = listed.json()["comments"][0]
            assert target["canDelete"] is True
            response = teacher_client.delete(f"{_comments_url(ids)}/{comment['id']}")
            assert response.status_code == 204
            assert teacher_client.get(_comments_url(ids)).json()["comments"] == []
    finally:
        _cleanup(ids)


def test_comments_require_login() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))
    try:
        with TestClient(app) as client:
            assert client.get(_comments_url(ids)).status_code == 401
            assert (
                client.post(_comments_url(ids), json={"content": "x"}).status_code == 401
            )
            assert client.get(
                f"/api/v1/question-comments/counts?ids={ids['question']}"
            ).status_code == 401
    finally:
        _cleanup(ids)


def test_comment_counts_batch_endpoint() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))
    try:
        with TestClient(app) as client:
            _login(client, ids["student"])
            client.post(_comments_url(ids), json={"content": "第一条"})
            second = client.post(_comments_url(ids), json={"content": "第二条"})
            client.post(f"{_comments_url(ids)}/{second.json()['comment']['id']}/like")
            response = client.get(
                f"/api/v1/question-comments/counts?ids={ids['question']},nonexistent"
            )
            assert response.status_code == 200
            counts = response.json()["counts"]
            assert counts[ids["question"]] == 2
            assert counts.get("nonexistent") is None
    finally:
        _cleanup(ids)


def test_concurrent_duplicate_like_is_idempotent() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))
    try:
        with TestClient(app) as client:
            _login(client, ids["student"])
            created = client.post(_comments_url(ids), json={"content": "并发点赞测试"})
            comment_id = created.json()["comment"]["id"]

        async def like_once() -> None:
            async with AsyncSessionLocal() as db:
                user = await db.get(User, ids["other"])
                assert user is not None
                await question_comment_service.add_like(
                    db, user, ids["question"], comment_id
                )

        async def run_concurrently() -> tuple[int, int]:
            await asyncio.gather(like_once(), like_once())
            async with AsyncSessionLocal() as db:
                comment = await db.get(QuestionComment, comment_id)
                likes = (
                    await db.execute(
                        select(QuestionCommentLike).where(
                            QuestionCommentLike.comment_id == comment_id
                        )
                    )
                ).scalars().all()
                assert comment is not None
                return comment.like_count, len(likes)

        assert asyncio.run(run_concurrently()) == (1, 1)
    finally:
        _cleanup(ids)


def test_deleting_question_cascades_comments_and_likes() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))
    try:
        with TestClient(app) as client:
            _login(client, ids["student"])
            created = client.post(_comments_url(ids), json={"content": "随题目一起清理"})
            comment_id = created.json()["comment"]["id"]

        with TestClient(app) as other_client:
            _login(other_client, ids["other"])
            liked = other_client.post(f"{_comments_url(ids)}/{comment_id}/like")
            assert liked.status_code == 200

        async def delete_question_and_count_children() -> tuple[int, int]:
            async with AsyncSessionLocal() as db:
                question = await db.get(Question, ids["question"])
                assert question is not None
                await db.delete(question)
                await db.commit()
            async with AsyncSessionLocal() as db:
                comments = (
                    await db.execute(
                        select(QuestionComment).where(
                            QuestionComment.question_id == ids["question"]
                        )
                    )
                ).scalars().all()
                likes = (
                    await db.execute(
                        select(QuestionCommentLike).where(
                            QuestionCommentLike.comment_id == comment_id
                        )
                    )
                ).scalars().all()
                return len(comments), len(likes)

        assert asyncio.run(delete_question_and_count_children()) == (0, 0)
    finally:
        _cleanup(ids)


def test_favorites_replies_paging_and_access():
    ids = _ids()
    asyncio.run(_seed(ids))
    try:
        with TestClient(app) as client:
            _login(client, ids['student'])
            url = _comments_url(ids)
            comment = client.post(url, json={'content': '收藏与回复'}).json()['comment']
            target = f"{url}/{comment['id']}/favorite"
            assert client.put(target).status_code == 200
            assert client.put(target).status_code == 200
            assert len(client.get('/api/v1/question-comments/favorites').json()['comments']) == 1
            assert client.get(url).json()['comments'][0]['myFavorite'] is True
            with TestClient(app) as other:
                _login(other, ids['other'])
                assert other.get('/api/v1/question-comments/favorites').json()['comments'] == []
            reply = client.post(url, json={'content': '回复', 'parentId': comment['id']})
            assert reply.status_code == 201
            assert reply.json()['comment']['parentId'] == comment['id']
            wrong = client.post(f"/api/v1/questions/{ids['other_question']}/comments", json={'content': '跨题回复', 'parentId': comment['id']})
            assert wrong.status_code == 422
            first = client.get(url+'?limit=1').json()
            assert len(first['comments']) == 1 and first['nextCursor']
            second = client.get(url+'?limit=1&cursor='+first['nextCursor']).json()
            assert second['comments'][0]['id'] != first['comments'][0]['id']
            assert client.get(url+'?cursor=bad').status_code == 422
            assert client.delete(target).status_code == 200
            assert client.get('/api/v1/question-comments/favorites').json()['comments'] == []
    finally:
        _cleanup(ids)


def test_discussion_denies_private_question_and_hidden_reply():
    ids = _ids()
    asyncio.run(_seed(ids))
    try:
        with TestClient(app) as client:
            _login(client, ids['student'])
            url=_comments_url(ids)
            comment=client.post(url,json={'content':'父留言'}).json()['comment']
            client.delete(f"{url}/{comment['id']}")
            assert client.post(url,json={'content':'回复已删', 'parentId':comment['id']}).status_code==422
            async def make_private():
                async with AsyncSessionLocal() as db:
                    question=await db.get(Question,ids['question'])
                    question.scope='internal'
                    await db.commit()
            asyncio.run(make_private())
            assert client.get(url).status_code==403
            assert client.post(url,json={'content':'绕过题目权限'}).status_code==403
            assert client.put(f"{url}/{comment['id']}/favorite").status_code==403
            assert client.get('/api/v1/question-comments/counts?ids='+ids['question']).json()['counts']=={}
    finally:
        _cleanup(ids)
