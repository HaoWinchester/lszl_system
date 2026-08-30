from __future__ import annotations

import argparse
from contextlib import nullcontext
import importlib.util
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import patch


try:
    import playwright.sync_api  # noqa: F401
except ModuleNotFoundError:
    playwright_module = ModuleType("playwright")
    sync_api_module = ModuleType("playwright.sync_api")
    sync_api_module.BrowserContext = object
    sync_api_module.Page = object

    def unavailable_sync_playwright():
        raise AssertionError("main orchestration tests must replace the Playwright runtime")

    sync_api_module.sync_playwright = unavailable_sync_playwright
    playwright_module.sync_api = sync_api_module
    sys.modules["playwright"] = playwright_module
    sys.modules["playwright.sync_api"] = sync_api_module


MODULE_PATH = Path(__file__).with_name("admin_runtime_retirement.py")
SPEC = importlib.util.spec_from_file_location("admin_runtime_retirement", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class EvaluatePage:
    def __init__(self, result: dict) -> None:
        self.result = result

    def evaluate(self, _script: str) -> dict:
        return self.result


class ForbiddenSubjectPage:
    def __getattribute__(self, name: str):
        if name.startswith("__"):
            return super().__getattribute__(name)
        raise AssertionError(f"external mode touched the existing subject page through {name}")


class DraftSelectionPage:
    def __init__(self) -> None:
        self.selected: list[str] = []
        self.waited_for_name: str | None = None

    def locator(self, selector: str):
        if selector != "#caCourseSelect":
            raise AssertionError(f"unexpected selector {selector}")
        return self

    def select_option(self, draft_id: str) -> None:
        self.selected.append(draft_id)

    def wait_for_function(self, _script: str, *, arg: str) -> None:
        self.waited_for_name = arg


class MainContext:
    def close(self) -> None:
        pass


class MainBrowser:
    def __init__(self) -> None:
        self.contexts: list[MainContext] = []

    def new_context(self, **_kwargs) -> MainContext:
        context = MainContext()
        self.contexts.append(context)
        return context

    def close(self) -> None:
        pass


class MainChromium:
    def __init__(self, browser: MainBrowser) -> None:
        self.browser = browser

    def launch(self, **_kwargs) -> MainBrowser:
        return self.browser


class MainPlaywright:
    def __init__(self, browser: MainBrowser) -> None:
        self.chromium = MainChromium(browser)

    def stop(self) -> None:
        pass


class MainPlaywrightStarter:
    def __init__(self, browser: MainBrowser) -> None:
        self.playwright = MainPlaywright(browser)

    def start(self) -> MainPlaywright:
        return self.playwright


class MainHarness:
    def start(self) -> str:
        return "http://127.0.0.1:59999"

    def close(self) -> None:
        pass


class AdminRuntimeRetirementTest(unittest.TestCase):
    def test_native_management_write_matrix_is_present(self) -> None:
        source = MODULE_PATH.read_text(encoding="utf-8")
        contracts = {
            "question-bank.html": ("#bankName", "#qbSaveBankBtn", "/api/v1/banks/"),
            "paper-management.html": ("#paperNameInput", "#qbSavePaperBtn", "/api/v1/papers/"),
            "feedback-management.html": ("#feedbackDetailStatus", "#feedbackSaveStatusBtn", "/api/v1/engagement/admin/feedback/"),
            "message-management.html": ("#messageTitle", "#messageEditorForm", "/api/v1/engagement/admin/messages/"),
            "system-settings.html": ('data-theme-field=\\"primary\\"', '[data-save-theme="admin"]', "/api/v1/system/themes/admin"),
        }

        for page_name, markers in contracts.items():
            with self.subTest(page_name=page_name):
                for marker in markers:
                    self.assertIn(marker, source)
                self.assertIn(page_name + " edited reload", source)

    def test_external_mode_skips_non_fixture_management_writes(self) -> None:
        forbidden = ForbiddenSubjectPage()
        MODULE.verify_question_bank_dom_persistence(forbidden, object(), "https://example.invalid", {})
        MODULE.verify_paper_dom_persistence(forbidden, object(), "https://example.invalid", {})
        MODULE.verify_feedback_dom_persistence(forbidden, object(), "https://example.invalid", {})
        MODULE.verify_system_settings_dom_persistence(forbidden, object(), "https://example.invalid", {})

    def test_storage_audit_rejects_each_retired_direct_bootstrap_field(self) -> None:
        valid = {
            "keys": [],
            "forbiddenKeys": [],
            "sessionKeys": [],
            "indexedDbAuditSupported": True,
            "indexedDbNames": [],
            "nativeSet": True,
            "nativeGet": True,
            "legacyStorage": "undefined",
            "directBootstrap": {
                "present": True,
                "runtimeFields": [],
            },
        }
        MODULE.storage_audit(EvaluatePage(valid), "admin-console.html")

        for field in ("storage", "revision", "contentRevision", "namespace"):
            with self.subTest(field=field):
                invalid = {
                    **valid,
                    "directBootstrap": {
                        **valid["directBootstrap"],
                        "runtimeFields": [field],
                    },
                }
                with self.assertRaises(AssertionError):
                    MODULE.storage_audit(EvaluatePage(invalid), "admin-console.html")

    def test_storage_audit_rejects_non_device_local_session_and_indexeddb_state(self) -> None:
        valid = {
            "keys": [],
            "forbiddenKeys": [],
            "sessionKeys": [],
            "indexedDbAuditSupported": True,
            "indexedDbNames": [],
            "nativeSet": True,
            "nativeGet": True,
            "legacyStorage": "undefined",
            "directBootstrap": {"present": True, "runtimeFields": []},
        }
        invalid_results = [
            {**valid, "keys": ["kg_remote_auth_session_v1"], "forbiddenKeys": ["kg_remote_auth_session_v1"]},
            {**valid, "sessionKeys": ["kg_remote_auth_session_v1"]},
            {**valid, "indexedDbNames": ["future-business-cache"]},
        ]
        for result in invalid_results:
            with self.subTest(result=result), self.assertRaises(AssertionError):
                MODULE.storage_audit(EvaluatePage(result), "admin-console.html")

        MODULE.storage_audit(
            EvaluatePage({**valid, "indexedDbNames": ["pmp_content_prep_studio_v1"]}),
            "content-prep.html",
        )

    def test_storage_audit_allows_absent_bootstrap_only_for_server_denial_page(self) -> None:
        page = EvaluatePage(
            {
                "keys": [],
                "forbiddenKeys": [],
                "sessionKeys": [],
                "indexedDbAuditSupported": True,
                "indexedDbNames": [],
                "nativeSet": True,
                "nativeGet": True,
                "legacyStorage": "undefined",
                "directBootstrap": {
                    "present": False,
                    "runtimeFields": [],
                },
            }
        )

        with self.assertRaises(AssertionError):
            MODULE.storage_audit(page, "admin-console.html")
        MODULE.storage_audit(
            page,
            "student admin-console 403",
            allow_absent_direct_bootstrap=True,
        )

    def test_external_mode_skips_existing_subject_dom_write(self) -> None:
        MODULE.verify_existing_subject_dom_persistence(
            ForbiddenSubjectPage(),
            allow_existing_subject_write=False,
        )

    def test_course_dom_write_selects_the_random_fixture_first(self) -> None:
        page = DraftSelectionPage()

        MODULE.select_course_fixture(
            page,
            {"id": "random-teacher-draft", "name": "Task7 教师课程 random"},
        )

        self.assertEqual(page.selected, ["random-teacher-draft"])
        self.assertEqual(page.waited_for_name, "Task7 教师课程 random")

    def test_partial_fixture_creation_is_cleaned_when_the_run_fails(self) -> None:
        cleaned: list[dict] = []

        def fail_after_first_fixture(_admin, _teacher, _base, fixture, *, disposable_environment):
            self.assertFalse(disposable_environment)
            fixture["draft"] = {"id": "random-draft"}
            raise RuntimeError("planned fixture failure")

        def record_cleanup(_admin, _teacher, _base, fixture):
            cleaned.append(dict(fixture))

        with (
            patch.object(MODULE, "create_domain_fixtures", fail_after_first_fixture),
            patch.object(MODULE, "cleanup", record_cleanup),
        ):
            with self.assertRaisesRegex(RuntimeError, "planned fixture failure"):
                with MODULE.domain_fixture_scope(
                    object(),
                    object(),
                    "https://example.invalid",
                    disposable_environment=False,
                ):
                    self.fail("fixture scope yielded after creation failed")

        self.assertEqual(cleaned, [{"draft": {"id": "random-draft"}}])

    def test_main_wires_existing_subject_write_only_for_isolated_mode(self) -> None:
        observed: list[tuple[bool, bool]] = []

        for isolated in (False, True):
            with self.subTest(isolated=isolated):
                browser = MainBrowser()
                args = argparse.Namespace(
                    isolated=isolated,
                    base_url=None if isolated else "https://uat.example.invalid",
                    all_pages=True,
                )

                def fixture_scope(_admin, _teacher, _base, *, disposable_environment):
                    self.assertEqual(disposable_environment, isolated)
                    return nullcontext({})

                def verify_admin_pages(_context, _base, _fixture, _all_pages, *, allow_existing_subject_write):
                    observed.append((isolated, allow_existing_subject_write))

                with (
                    patch.dict(
                        MODULE.os.environ,
                        {
                            "E2E_ADMIN_PASSWORD": "admin-password",
                            "E2E_TEACHER_USERNAME": "task7-teacher",
                            "E2E_TEACHER_PASSWORD": "teacher-password",
                            "E2E_STUDENT_USERNAME": "task7-student",
                            "E2E_STUDENT_PASSWORD": "student-password",
                        },
                        clear=False,
                    ),
                    patch.object(MODULE, "parse_args", return_value=args),
                    patch.object(MODULE, "IsolatedE2EHarness", MainHarness),
                    patch.object(MODULE, "sync_playwright", return_value=MainPlaywrightStarter(browser)),
                    patch.object(MODULE, "bind"),
                    patch.object(MODULE, "admin_login", return_value="admin-password"),
                    patch.object(MODULE, "create_user"),
                    patch.object(MODULE, "exercise_login_logout"),
                    patch.object(MODULE, "exercise_native_login_logout"),
                    patch.object(MODULE, "domain_fixture_scope", fixture_scope),
                    patch.object(MODULE, "verify_admin_pages", verify_admin_pages),
                    patch.object(MODULE, "verify_failure_recovery"),
                    patch.object(MODULE, "verify_teacher_and_student"),
                ):
                    MODULE.main()

        self.assertEqual(observed, [(False, False), (True, True)])


if __name__ == "__main__":
    unittest.main()
