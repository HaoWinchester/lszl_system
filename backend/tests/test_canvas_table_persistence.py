"""TableV1 三页持久化：图谱 graphData.tables、多题 workspace payload.tables、回忆 JSONB tables。"""
import asyncio
import json
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.file import FileContent, GraphFile
from app.models.question import Question, QuestionBank
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.teaching_content import ContentSubject, RecallAssociationLibrary
from app.models.training import RecallLibrarySnapshot, RecallProgress, RecallQuestionSnapshot
from app.models.user import User
from app.services.teaching_content_current_service import set_current_recall_library

RECALL_PASSWORD = "deep-recall-pass"
RECALL_KEY = "kg_recall_association_library_v1__subject__subject-pmp"


def _table(table_id="tb_1", rows=3, cols=3, cells=None, merges=()):
    return {"id": table_id, "schemaVersion": 1, "x": 10, "y": 20, "rows": rows, "cols": cols,
            "columnWidths": [140.0] * cols, "rowHeights": [40.0] * rows,
            "cells": cells if cells is not None else {"0,0": "中文"}, "merges": list(merges)}


# ---------- 图谱页 ----------

def _student(name):
    async def run():
        async with AsyncSessionLocal() as db:
            db.add(User(username=name, password_hash=hash_password("pass-1234"), role="student", status="active"))
            await db.commit()
    asyncio.run(run())


def _login(client, name, password="pass-1234"):
    assert client.post("/api/v1/auth/login", json={"username": name, "password": password}).status_code == 200


def test_graph_file_tables_round_trip_and_reject_invalid():
    user = "tbl-graph-" + uuid4().hex[:8]
    _student(user)
    try:
        with TestClient(app) as c:
            _login(c, user)
            created = c.post("/api/v1/files", json={"name": "表格图谱", "graphData": {"nodes": [], "tables": [_table()]}})
            assert created.status_code == 200, created.text
            file_id = created.json()["file"]["id"]
            reopened = c.get(f"/api/v1/files/{file_id}").json()["graphData"]
            assert reopened["tables"] == [_table()]
            # 旧文件（无 tables 键）保存不受影响。
            saved = c.put(f"/api/v1/files/{file_id}", json={"graphData": {"nodes": []}, "expectedRevision": 1})
            assert saved.status_code == 200
            assert c.get(f"/api/v1/files/{file_id}").json()["graphData"].get("tables") in (None, [])
            # 非法 tables 整体拒绝（422 GRAPH_TABLES_INVALID），原内容不变。
            bad = _table(rows=1000)
            for tables in ([bad], "nope", [_table(cells={"9,9": "x"})]):
                r = c.put(f"/api/v1/files/{file_id}", json={"graphData": {"tables": tables}, "expectedRevision": 2})
                assert r.status_code == 422, (tables, r.text)
                assert r.json()["detail"]["code"] == "GRAPH_TABLES_INVALID"
            # 超出画布 20000 格整体拒绝：5 张满额表（各 5000）之外的增量。
            big = _table(table_id="tb_big", rows=100, cols=50)
            r = c.put(f"/api/v1/files/{file_id}", json={"graphData": {"nodes": [], "tables": [big] * 5 + [_table(table_id="tb_x")]}, "expectedRevision": 2})
            assert r.status_code == 422
            # 画布级恰好 20000 合法。
            r = c.put(f"/api/v1/files/{file_id}", json={"graphData": {"nodes": [], "tables": [big] * 4}, "expectedRevision": 2})
            assert r.status_code == 200, r.text
            assert len(c.get(f"/api/v1/files/{file_id}").json()["graphData"]["tables"]) == 4
    finally:
        async def cleanup():
            async with AsyncSessionLocal() as db:
                await db.execute(delete(FileContent).where(FileContent.file_id.in_(select(GraphFile.id).where(GraphFile.owner_id == user))))
                await db.execute(delete(GraphFile).where(GraphFile.owner_id == user))
                await db.execute(delete(User).where(User.username == user))
                await db.commit()
        asyncio.run(cleanup())


def test_template_publish_and_load_preserve_tables():
    from test_graph_question_access import data as source_fixture, login, PASSWORD
    teacher = "tbl-teacher-" + uuid4().hex[:8]
    async def seed():
        async with AsyncSessionLocal() as db:
            db.add(User(username=teacher, password_hash=hash_password(PASSWORD), role="teacher", status="active"))
            await db.commit()
    asyncio.run(seed())
    value = source_fixture.__wrapped__()
    try:
        with TestClient(app) as c:
            login(c, value, "teacher")
            _login(c, teacher, PASSWORD)
            login(c, value, "teacher")
            graph = {"nodes": [{"id": "n", "title": "card", "x": 0, "y": 0}],
                     "tables": [_table(cells={"0,0": "合并源"})]}
            source = c.post("/api/v1/files", json={"name": "t-source", "graphData": graph}).json()["file"]["id"]
            revision = c.get(f"/api/v1/files/{source}").json()["meta"]["revision"]
            published = c.post("/api/v1/graph-templates", json={
                "sourceFileId": source, "expectedFileRevision": revision,
                "name": "表格模板", "description": "tables 往返", "memberOnly": False}).json()["template"]
            # 非法 tables 源发布被拒（422 GRAPH_TABLES_INVALID；PUT 用正确 revision 写入坏数据）。
            put_bad = c.put(f"/api/v1/files/{source}", json={"graphData": {"nodes": [], "tables": [{"bad": 1}]}, "expectedRevision": revision})
            assert put_bad.status_code == 422, put_bad.text
            # 坏表格绕过文件接口直接落库后发布也必须被拒——直接验证 publish 校验：
            from app.services import file_service as fs
            async def force_bad():
                async with AsyncSessionLocal() as db:
                    from app.models.file import FileContent as FC
                    row = await db.get(FC, source)
                    row.graph_data = {"nodes": [], "tables": [{"bad": 1}]}
                    await db.commit()
            asyncio.run(force_bad())
            r = c.post("/api/v1/graph-templates", json={
                "sourceFileId": source, "expectedFileRevision": revision,
                "name": "坏表格模板", "description": "x", "memberOnly": False})
            assert r.status_code == 422, r.text
            # remap 先报 TEMPLATE_GRAPH_INVALID；无论走哪个校验，发布都被拒绝。
            assert r.json()["detail"]["code"] in ("GRAPH_TABLES_INVALID", "TEMPLATE_GRAPH_INVALID")
            # 学生加载副本：tables 保留（id 已重映射）。
            login(c, value, "student")
            loaded = c.post(f"/api/v1/graph-templates/{published['id']}/loads",
                            json={"version": published["version"], "requestId": "tbl-" + uuid4().hex})
            assert loaded.status_code == 201, loaded.text
            copy = c.get("/api/v1/files/" + loaded.json()["fileId"]).json()["graphData"]
            assert copy["tables"][0]["cells"] == {"0,0": "合并源"}
            assert copy["tables"][0]["id"] != "tb_1"
    finally:
        async def cleanup2():
            async with AsyncSessionLocal() as db:
                await db.execute(delete(User).where(User.username == teacher))
                await db.commit()
        asyncio.run(cleanup2())


# ---------- 多题归纳页 ----------

def test_workspace_payload_tables_round_trip_and_reject_invalid():
    user = "tbl-ws-" + uuid4().hex[:8]
    _student(user)
    try:
        with TestClient(app) as c:
            _login(c, user)
            created = c.post("/api/v1/workspaces", json={
                "title": "表格归纳", "schemaVersion": 6,
                "payload": {"nodes": {}, "edges": [], "tables": [_table()]}})
            assert created.status_code == 200, created.text
            payload = created.json()["workspace"]["payload"]
            assert payload["tables"] == [_table()]
            workspace_id = created.json()["workspace"]["id"]
            assert c.get(f"/api/v1/workspaces/{workspace_id}").json()["workspace"]["payload"]["tables"] == [_table()]
            for bad in ([_table(rows=1000)], "nope", [_table(cells={"0,0": "x" * 3001})]):
                r = c.put(f"/api/v1/workspaces/{workspace_id}", json={"title": "t", "payload": {"tables": bad}})
                assert r.status_code == 400, (bad, r.text)
            assert c.get(f"/api/v1/workspaces/{workspace_id}").json()["workspace"]["payload"]["tables"] == [_table()]
    finally:
        async def cleanup3():
            async with AsyncSessionLocal() as db:
                from app.models.training import CanvasWorkspace
                await db.execute(delete(CanvasWorkspace).where(CanvasWorkspace.owner_id == user))
                await db.execute(delete(User).where(User.username == user))
                await db.commit()
        asyncio.run(cleanup3())


# ---------- 深度回忆页 ----------

def test_recall_progress_tables_save_reset_and_default_empty():
    suffix = uuid4().hex[:10]
    teacher = f"tbl-recall-teacher-{suffix}"
    student = f"tbl-recall-student-{suffix}"
    bank_id = f"tbl-recall-bank-{suffix}"
    question_id = f"tbl-recall-question-{suffix}"
    library_id = f"tbl-recall-library-{suffix}"
    previous_subject_metadata: dict | None = None

    async def seed():
        nonlocal previous_subject_metadata
        async with AsyncSessionLocal() as db:
            db.add_all([
                User(username=teacher, password_hash=hash_password(RECALL_PASSWORD), role="teacher", status="active", subject="PMP"),
                User(username=student, password_hash=hash_password(RECALL_PASSWORD), role="student", status="active", subject="PMP"),
            ])
            await db.flush()
            db.add(QuestionBank(id=bank_id, owner_id=teacher, name="表格回忆题库", subject="PMP", visibility="published"))
            await db.flush()
            db.add(Question(id=question_id, bank_id=bank_id, title="表格回忆题目", subject="PMP", scope="public",
                            revision=1, content_hash="a" * 64,
                            stem_parts=[{"text": "题干"}],
                            concepts=[{"id": "keyword-1", "title": "分析影响", "isCore": True}]))
            subject = await db.get(ContentSubject, "subject-pmp")
            if subject is None:
                subject = ContentSubject(id="subject-pmp", code="PMP", name="PMP", content_metadata={})
                db.add(subject)
                await db.flush()
            previous_subject_metadata = dict(subject.content_metadata or {})
            latest = int((await db.execute(
                select(func.max(RecallAssociationLibrary.version)).where(RecallAssociationLibrary.subject_id == "subject-pmp")
            )).scalar_one_or_none() or 0)
            db.add(RecallAssociationLibrary(id=library_id, subject_id="subject-pmp", version=latest + 1,
                                            status="published", nodes=[{"id": "recall:t", "title": "影响分析"}],
                                            edges=[], content_metadata={}, updated_by=teacher))
            set_current_recall_library(subject, library_id)
            await db.commit()

    async def cleanup():
        async with AsyncSessionLocal() as db:
            await db.execute(delete(RecallProgress).where(RecallProgress.question_id == question_id))
            await db.execute(delete(RecallQuestionSnapshot).where(RecallQuestionSnapshot.question_id == question_id))
            await db.execute(delete(RecallLibrarySnapshot).where(RecallLibrarySnapshot.subject == "subject-pmp"))
            await db.execute(delete(Question).where(Question.id == question_id))
            await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
            await db.execute(delete(RecallAssociationLibrary).where(RecallAssociationLibrary.id == library_id))
            subject = await db.get(ContentSubject, "subject-pmp")
            if subject is not None and previous_subject_metadata is not None:
                subject.content_metadata = previous_subject_metadata
            await db.execute(delete(User).where(User.username.in_([teacher, student])))
            await db.commit()

    asyncio.run(seed())
    try:
        with TestClient(app) as c:
            assert c.post("/api/v1/auth/login", json={"username": student, "password": RECALL_PASSWORD}).status_code == 200
            session = c.get(f"/api/v1/recall/session/{question_id}").json()
            # 旧记录语义：无保存时 tables 默认空。
            assert session["progress"]["tables"] == []
            table = _table(cells={"0,0": "回忆表格", "1,1": "第二格"}, merges=[{"row": 0, "column": 0, "rowSpan": 1, "columnSpan": 2}])
            body = {"expectedRevision": session["progressRevision"],
                    "questionRevision": session["currentQuestion"]["revision"],
                    "libraryHash": session["library"]["contentHash"],
                    "graphSchemaVersion": 3, "nodes": [], "edges": [],
                    "strokes": [], "tables": [table],
                    "customNodes": {}, "activeKeywords": [], "choiceOffsets": {},
                    "transform": {"x": 0, "y": 0, "scale": 1}, "metrics": {}}
            saved = c.put(f"/api/v1/recall/progress/{question_id}", json=body)
            assert saved.status_code == 200, saved.text
            assert saved.json()["tables"] == [table]
            again = c.get(f"/api/v1/recall/session/{question_id}").json()
            assert again["progress"]["tables"] == [table]
            # 非法表格整体拒绝（422），已存内容不变。
            bad = {**body, "expectedRevision": again["progressRevision"], "tables": [_table(rows=1000)]}
            r = c.put(f"/api/v1/recall/progress/{question_id}", json=bad)
            assert r.status_code == 422, r.text
            assert c.get(f"/api/v1/recall/session/{question_id}").json()["progress"]["tables"] == [table]
            # 重置清空 tables；撤销取消不重置则保留（前端取消不发起请求——服务端 reset 即清空契约）。
            reset = c.post(f"/api/v1/recall/progress/{question_id}/reset",
                           json={"expectedRevision": again["progressRevision"],
                                 "targetQuestionRevision": session["currentQuestion"]["revision"]})
            assert reset.status_code == 200, reset.text
            assert reset.json()["tables"] == []
    finally:
        asyncio.run(cleanup())
