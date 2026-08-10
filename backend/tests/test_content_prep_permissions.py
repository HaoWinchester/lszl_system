import asyncio
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import delete
from starlette.requests import Request

from app.core import auth
from app.db.session import AsyncSessionLocal
from app.models.content_prep import QuestionBankCollaborator
from app.models.question import QuestionBank
from app.models.user import User


def user_with_role(role: str) -> User:
    return User(username=f"permission-{role}", password_hash="unused", role=role, status="active")


def test_required_permissions_accept_an_actor_with_every_capability() -> None:
    dependency = auth.require_permissions(
        "accessQuestionBank",
        "importData",
        "editQuestions",
    )

    resolved = asyncio.run(dependency(user_with_role("teacher")))

    assert resolved.role == "teacher"


def test_required_permissions_reject_an_actor_missing_any_capability() -> None:
    dependency = auth.require_permissions(
        "accessQuestionBank",
        "importData",
        "editQuestions",
    )

    with pytest.raises(HTTPException) as error:
        asyncio.run(dependency(user_with_role("student")))

    assert error.value.status_code == 403
    assert error.value.detail == {
        "code": "PERMISSION_DENIED",
        "message": "当前账号缺少所需权限",
        "permissions": ["accessQuestionBank", "importData", "editQuestions"],
    }


def test_optional_current_user_returns_none_without_a_session() -> None:
    async def scenario() -> None:
        request = Request({"type": "http", "session": {}})
        async with AsyncSessionLocal() as db:
            assert await auth.optional_current_user(request, db) is None

    asyncio.run(scenario())


def test_optional_current_user_resolves_an_active_session() -> None:
    async def scenario() -> None:
        request = Request({"type": "http", "session": {"username": "admin"}})
        async with AsyncSessionLocal() as db:
            user = await auth.optional_current_user(request, db)

        assert user is not None
        assert user.username == "admin"
        assert user.status == "active"

    asyncio.run(scenario())


def test_question_bank_access_is_shared_by_all_managers_and_denied_to_learners() -> None:
    async def scenario() -> None:
        from app.services import question_access_service

        suffix = uuid4().hex[:10]
        usernames = {
            "owner": f"access-owner-{suffix}",
            "editor": f"access-editor-{suffix}",
            "legacy_viewer": f"access-viewer-{suffix}",
            "other_teacher": f"access-other-{suffix}",
            "student": f"access-student-{suffix}",
            "viewer": f"access-guest-{suffix}",
        }
        bank_id = f"access-bank-{suffix}"
        users = {
            name: User(
                username=username,
                password_hash="unused",
                role=name if name in {"student", "viewer"} else "teacher",
                status="active",
            )
            for name, username in usernames.items()
        }

        async with AsyncSessionLocal() as db:
            try:
                db.add_all(users.values())
                await db.flush()
                bank = QuestionBank(
                    id=bank_id,
                    owner_id=usernames["owner"],
                    name="access matrix bank",
                    subject="PMP",
                )
                db.add(bank)
                await db.flush()
                db.add_all([
                    QuestionBankCollaborator(
                        id=f"collab-edit-{suffix}",
                        bank_id=bank_id,
                        username=usernames["editor"],
                        permission="edit",
                        granted_by=usernames["owner"],
                    ),
                    QuestionBankCollaborator(
                        id=f"collab-view-{suffix}",
                        bank_id=bank_id,
                        username=usernames["legacy_viewer"],
                        permission="view",
                        granted_by=usernames["owner"],
                    ),
                ])
                await db.commit()

                admin = await db.get(User, "admin")
                assert admin is not None
                expected = {
                    "owner": (True, True),
                    "editor": (True, True),
                    "legacy_viewer": (True, True),
                    "other_teacher": (True, True),
                    "student": (False, False),
                    "viewer": (False, False),
                }
                for name, (can_view, can_edit) in expected.items():
                    assert await question_access_service.can_view_bank(db, users[name], bank) is can_view
                    assert await question_access_service.can_edit_bank(db, users[name], bank) is can_edit
                assert await question_access_service.can_view_bank(db, admin, bank) is True
                assert await question_access_service.can_edit_bank(db, admin, bank) is True

                resolved = await question_access_service.require_bank_access(
                    db,
                    users["editor"],
                    bank_id,
                    edit=True,
                )
                assert resolved.id == bank_id

                with pytest.raises(HTTPException) as forbidden:
                    await question_access_service.require_bank_access(
                        db,
                        users["viewer"],
                        bank_id,
                        edit=False,
                    )
                assert forbidden.value.status_code == 403

                with pytest.raises(HTTPException) as missing:
                    await question_access_service.require_bank_access(
                        db,
                        users["owner"],
                        f"missing-{suffix}",
                        edit=False,
                    )
                assert missing.value.status_code == 404
            finally:
                await db.rollback()
                await db.execute(
                    delete(QuestionBankCollaborator).where(
                        QuestionBankCollaborator.bank_id == bank_id
                    )
                )
                await db.execute(delete(QuestionBank).where(QuestionBank.id == bank_id))
                await db.execute(delete(User).where(User.username.in_(usernames.values())))
                await db.commit()

    asyncio.run(scenario())
