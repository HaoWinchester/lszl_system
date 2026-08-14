import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models.content_prep import Principle, SynthesisPreset


ADMIN_PASSWORD = "jbgsnmm~123"


def _principle(principle_id: str, name: str) -> dict:
    return {
        "id": principle_id,
        "name": name,
        "status": "active",
        "confusablePrincipleIds": [],
    }


def _preset(preset_id: str, principle_id: str, content: str) -> dict:
    return {
        "id": preset_id,
        "principleId": principle_id,
        "title": "会由服务器规范化",
        "content": content,
        "status": "active",
        "version": 1,
    }


def test_safe_merge_requires_explicit_conflict_resolution_and_keeps_unrelated_rows() -> None:
    suffix = uuid4().hex[:10]
    existing_id = f"existing-{suffix}"
    added_id = f"added-{suffix}"
    existing_preset_id = f"card-existing-{suffix}"
    added_preset_id = f"card-added-{suffix}"

    async def cleanup() -> None:
        async with AsyncSessionLocal() as db:
            await db.execute(
                delete(SynthesisPreset).where(
                    SynthesisPreset.id.in_([existing_preset_id, added_preset_id])
                )
            )
            await db.execute(
                delete(Principle).where(Principle.id.in_([existing_id, added_id]))
            )
            await db.commit()

    try:
        with TestClient(app) as client:
            login = client.post(
                "/api/v1/auth/login",
                json={"username": "admin", "password": ADMIN_PASSWORD},
            )
            assert login.status_code == 200, login.text
            revision = client.get(
                "/api/v1/question-catalog/revision"
            ).json()["revision"]
            created = client.post(
                "/api/v1/content-prep/principles",
                json={
                    "contentRevision": revision,
                    "principle": _principle(existing_id, "保留名称"),
                    "preset": _preset(
                        existing_preset_id, existing_id, "保留内容"
                    ),
                },
            )
            assert created.status_code == 200, created.text
            bundle = {
                "format": "pmp-principle-preset-bundle-v1",
                "principles": [
                    _principle(existing_id, "冲突名称"),
                    _principle(added_id, "新增原则"),
                ],
                "presets": [
                    _preset(existing_preset_id, existing_id, "冲突内容"),
                    _preset(added_preset_id, added_id, "新增内容"),
                ],
            }

            preview = client.post(
                "/api/v1/content-prep/principle-merges/preview",
                json={"bundle": bundle},
            )
            assert preview.status_code == 200, preview.text
            plan = preview.json()["plan"]
            assert [item["id"] for item in plan["added"]] == [added_id]
            assert [item["type"] for item in plan["conflicts"]] == [
                "same-id-different-name"
            ]

            unresolved = client.post(
                "/api/v1/content-prep/principle-merges/apply",
                json={
                    "contentRevision": preview.json()["contentRevision"],
                    "bundle": bundle,
                    "resolutions": [],
                },
            )
            assert unresolved.status_code == 422, unresolved.text
            assert unresolved.json()["detail"]["code"] == "UNRESOLVED_PRINCIPLE_CONFLICT"

            applied = client.post(
                "/api/v1/content-prep/principle-merges/apply",
                json={
                    "contentRevision": preview.json()["contentRevision"],
                    "bundle": bundle,
                    "resolutions": [
                        {
                            "conflictId": plan["conflicts"][0]["conflictId"],
                            "resolution": "keep-existing",
                        }
                    ],
                },
            )
            assert applied.status_code == 200, applied.text
            by_id = {
                item["id"]: item
                for item in applied.json()["principles"]["items"]
            }
            assert by_id[existing_id]["name"] == "保留名称"
            assert by_id[added_id]["name"] == "新增原则"
    finally:
        asyncio.run(cleanup())
