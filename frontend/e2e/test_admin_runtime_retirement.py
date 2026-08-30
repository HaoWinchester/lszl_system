from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


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


class AdminRuntimeRetirementTest(unittest.TestCase):
    def test_storage_audit_rejects_nonzero_direct_bootstrap_state(self) -> None:
        page = EvaluatePage(
            {
                "keys": [],
                "nativeSet": True,
                "nativeGet": True,
                "legacyStorage": "undefined",
                "directBootstrap": {
                    "storage": {"legacy": True},
                    "revision": 9,
                    "contentRevision": 4,
                },
            }
        )

        with self.assertRaises(AssertionError):
            MODULE.storage_audit(page, "admin-console.html")

    def test_storage_audit_allows_absent_bootstrap_only_for_server_denial_page(self) -> None:
        page = EvaluatePage(
            {
                "keys": [],
                "nativeSet": True,
                "nativeGet": True,
                "legacyStorage": "undefined",
                "directBootstrap": {
                    "present": False,
                    "storage": None,
                    "revision": None,
                    "contentRevision": None,
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


if __name__ == "__main__":
    unittest.main()
