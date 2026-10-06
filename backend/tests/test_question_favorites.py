"""题目收藏 API 契约：toggle 幂等、owner 隔离、列表带题干与解析、批量状态。"""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.question import Question, QuestionBank
from app.models.question_favorite import QuestionFavorite
from app.models.user import User

PASSWORD = "question-favorite-pass"


def _ids() -> dict[str, str]:
    token = uuid4().hex[:10]
    return {
        "student": f"qf-student-{token}",
        "other": f"qf-other-{token}",
        "teacher": f"qf-teacher-{token}",
        "bank": f"qf-bank-{token}",
        "question": f"qf-question-{token}",
        "other_question": f"qf-other-question-{token}",
        "private_question": f"qf-private-{token}",
        "private_bank": f"qf-private-bank-{token}",
    }


async def _seed(ids: dict[str, str]) -> None:
    async with AsyncSessionLocal() as db:
        password_hash = hash_password(PASSWORD)
        db.add_all(
            [
                User(username=ids["student"], password_hash=password_hash, role="student", status="active"),
                User(username=ids["other"], password_hash=password_hash, role="student", status="active"),
                User(username=ids["teacher"], password_hash=password_hash, role="teacher", status="active"),
            ]
        )
        await db.flush()
        db.add(
            QuestionBank(id=ids["bank"], owner_id=ids["teacher"], name="收藏测试题库", visibility="published")
        )
        db.add(
            QuestionBank(id=ids["private_bank"], owner_id=ids["teacher"], name="私有题库", visibility="private")
        )
        await db.flush()
        db.add_all(
            [
                Question(
                    id=ids["question"],
                    bank_id=ids["bank"],
                    title="收藏测试题",
                    type="single_choice",
                    scope="public",
                    stem_parts=[{"text": "以下哪个是正确选项？"}, {"text": "请仔细分析。", "clue": "提示"}],
                    analysis="A 是正确答案，因为……",
                ),
                Question(id=ids["other_question"], bank_id=ids["bank"], title="另一道收藏测试题", scope="public"),
                Question(id=ids["private_question"], bank_id=ids["private_bank"], title="私有题", scope="public"),
            ]
        )
        await db.commit()


def _cleanup(ids: dict[str, str]) -> None:
    async def _run() -> None:
        async with AsyncSessionLocal() as db:
            for question_id in (ids["question"], ids["other_question"], ids["private_question"]):
                for favorite in (
                    await db.execute(select(QuestionFavorite).where(QuestionFavorite.question_id == question_id))
                ).scalars().all():
                    await db.delete(favorite)
                question = await db.get(Question, question_id)
                if question:
                    await db.delete(question)
            for key in ("bank", "private_bank", "student", "other", "teacher"):
                obj = await db.get({"bank": QuestionBank, "private_bank": QuestionBank, "student": User,
                                    "other": User, "teacher": User}[key], ids[key])
                if obj:
                    await db.delete(obj)
            await db.commit()

    asyncio.run(_run())


def _login(client: TestClient, username: str) -> None:
    assert client.post(
        "/api/v1/auth/login", json={"username": username, "password": PASSWORD}
    ).status_code == 200


def test_favorite_toggle_list_and_status() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))
    try:
        with TestClient(app) as client:
            _login(client, ids["student"])

            # 收藏：带题干与解析
            toggled = client.post(f"/api/v1/question-favorites/{ids['question']}/toggle")
            assert toggled.status_code == 200, toggled.text
            assert toggled.json() == {"questionId": ids["question"], "favorited": True}

            listed = client.get("/api/v1/question-favorites")
            assert listed.status_code == 200
            favorites = listed.json()["favorites"]
            assert len(favorites) == 1
            item = favorites[0]
            assert item["questionId"] == ids["question"]
            assert item["stemText"] == "以下哪个是正确选项？请仔细分析。"
            assert item["analysis"] == "A 是正确答案，因为……"
            assert item["type"] == "single_choice"
            assert item["favoritedAt"]

            # 重复 toggle 幂等（取消）
            again = client.post(f"/api/v1/question-favorites/{ids['question']}/toggle")
            assert again.json() == {"questionId": ids["question"], "favorited": False}
            assert client.get("/api/v1/question-favorites").json()["favorites"] == []

            # PUT / DELETE 等价开关
            assert client.put(f"/api/v1/question-favorites/{ids['question']}").json()["favorited"] is True
            assert client.put(f"/api/v1/question-favorites/{ids['question']}").json()["favorited"] is True
            assert client.delete(f"/api/v1/question-favorites/{ids['question']}").json()["favorited"] is False
            assert client.delete(f"/api/v1/question-favorites/{ids['question']}").json()["favorited"] is False

            # 批量状态：只有已收藏的为 True
            client.post(f"/api/v1/question-favorites/{ids['question']}/toggle")
            client.post(f"/api/v1/question-favorites/{ids['other_question']}/toggle")
            status = client.get(
                f"/api/v1/question-favorites/status?ids={ids['question']},{ids['other_question']},missing"
            )
            assert status.status_code == 200
            assert status.json()["status"] == {ids["question"]: True, ids["other_question"]: True, "missing": False}
    finally:
        _cleanup(ids)


def test_favorites_are_owner_isolated() -> None:
    ids = _ids()
    asyncio.run(_seed(ids))
    try:
        with TestClient(app) as client:
            _login(client, ids["student"])
            client.post(f"/api/v1/question-favorites/{ids['question']}/toggle")

        with TestClient(app) as other_client:
            _login(other_client, ids["other"])
            assert other_client.get("/api/v1/question-favorites").json()["favorites"] == []
            status = other_client.get(f"/api/v1/question-favorites/status?ids={ids['question']}")
            assert status.json()["status"] == {ids["question"]: False}

        # 未登录不可访问
        with TestClient(app) as anonymous:
            assert anonymous.get("/api/v1/question-favorites").status_code == 401
            assert anonymous.post(f"/api/v1/question-favorites/{ids['question']}/toggle").status_code == 401
    finally:
        _cleanup(ids)


def test_favorite_requires_question_access() -> None:
    """无权访问的题目不能收藏；列表也会过滤掉无权项。"""
    ids = _ids()
    asyncio.run(_seed(ids))
    try:
        with TestClient(app) as client:
            _login(client, ids["student"])
            denied = client.post(f"/api/v1/question-favorites/{ids['private_question']}/toggle")
            assert denied.status_code == 403

            # 先直接落库一条私有收藏，再验证列表读取时被过滤
            async def seed_private_favorite() -> None:
                async with AsyncSessionLocal() as db:
                    db.add(QuestionFavorite(question_id=ids["private_question"], owner_id=ids["student"]))
                    await db.commit()

            asyncio.run(seed_private_favorite())
            listed = client.get("/api/v1/question-favorites").json()["favorites"]
            assert all(item["questionId"] != ids["private_question"] for item in listed)
    finally:
        _cleanup(ids)


def test_favorite_counts_batch() -> None:
    """收藏总数角标：全站维度计数、跨用户聚合、无权题目不返回。"""
    ids = _ids()
    asyncio.run(_seed(ids))
    try:
        with TestClient(app) as client:
            _login(client, ids["student"])
            client.post(f"/api/v1/question-favorites/{ids['question']}/toggle")
        with TestClient(app) as other_client:
            _login(other_client, ids["other"])
            other_client.post(f"/api/v1/question-favorites/{ids['question']}/toggle")

            async def seed_private_favorite() -> None:
                async with AsyncSessionLocal() as db:
                    db.add(QuestionFavorite(question_id=ids["private_question"], owner_id=ids["other"]))
                    await db.commit()

            asyncio.run(seed_private_favorite())
            counts = other_client.get(
                f"/api/v1/question-favorites/counts?ids={ids['question']},{ids['other_question']},{ids['private_question']}"
            )
            assert counts.status_code == 200
            data = counts.json()["counts"]
            assert data[ids["question"]] == 2
            assert data[ids["other_question"]] == 0
            assert ids["private_question"] not in data
    finally:
        _cleanup(ids)


def test_favorite_list_search_source_and_detail() -> None:
    """收藏列表来源字段、search 过滤与详情端点（选项/正确项/解析）。"""
    ids = _ids()
    asyncio.run(_seed(ids))
    try:
        with TestClient(app) as client:
            _login(client, ids["student"])
            client.post(f"/api/v1/question-favorites/{ids['question']}/toggle")
            client.post(f"/api/v1/question-favorites/{ids['other_question']}/toggle")

            # 来源：题库名 + 学科（题库默认 PMP）
            listed = client.get("/api/v1/question-favorites").json()["favorites"]
            assert len(listed) == 2
            item = next(entry for entry in listed if entry["questionId"] == ids["question"])
            assert item["source"]["bankName"] == "收藏测试题库"
            assert item["source"]["subject"] == "PMP"

            # search：匹配题干文本；另一题不含该词被过滤
            matched = client.get("/api/v1/question-favorites", params={"search": "正确选项"}).json()["favorites"]
            assert [entry["questionId"] for entry in matched] == [ids["question"]]
            assert client.get(
                "/api/v1/question-favorites", params={"search": "绝不存在的关键词xyz"}
            ).json()["favorites"] == []

            # 详情：完整题干/选项/解析/来源；未收藏题目不返回 favoritedAt
            detail = client.get(
                "/api/v1/question-favorites/detail", params={"question_id": ids["question"]}
            )
            assert detail.status_code == 200, detail.text
            data = detail.json()
            assert data["questionId"] == ids["question"]
            assert data["stemParts"][0]["text"] == "以下哪个是正确选项？"
            assert data["analysis"] == "A 是正确答案，因为……"
            assert data["source"]["bankName"] == "收藏测试题库"
            assert data["favorited"] is True and data["favoritedAt"]
            assert data["options"] == []  # 种子题未带选项，不伪造字段

            # 不存在的题目 → 404
            assert client.get(
                "/api/v1/question-favorites/detail", params={"question_id": "missing-id"}
            ).status_code == 404
    finally:
        _cleanup(ids)
