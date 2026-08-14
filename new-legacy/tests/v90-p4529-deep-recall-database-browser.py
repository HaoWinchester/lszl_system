"""Browser E2E for the database-authoritative learner Deep Recall flow.

This test owns a disposable PostgreSQL database and a disposable candidate
release through the shared isolated E2E harness. It never mutates the active
release or the developer database.
"""

from __future__ import annotations

import atexit
import getpass
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import urlopen
from uuid import uuid4

from playwright.sync_api import BrowserContext, Page, sync_playwright


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
ACTIVE_RELEASE_ROOT = REPO_ROOT / "frontend" / "new-legacy-releases"
SOURCE_ROOT = REPO_ROOT / "new-legacy"


QUESTION_ID = "deep-recall-browser-question"
BANK_ID = "deep-recall-browser-bank"
STUDENT = "deep-recall-browser-student"
PASSWORD = "DeepRecallBrowser-111111"


def file_count(root: Path) -> int:
    return sum(1 for path in root.rglob("*") if path.is_file())


class IsolatedDeepRecallHarness:
    def __init__(self) -> None:
        self.database_name = f"kg_deep_recall_e2e_{os.getpid()}_{uuid4().hex[:12]}"
        self.pg_host = os.environ.get("KG_E2E_PGHOST", "/tmp")
        self.pg_user = os.environ.get("KG_E2E_PGUSER", getpass.getuser())
        self.release_temp: tempfile.TemporaryDirectory[str] | None = None
        self.server: subprocess.Popen[bytes] | None = None
        self.database_created = False
        self.closed = False
        atexit.register(self.close)

    def _postgres(self, command: str, *, check: bool = True) -> subprocess.CompletedProcess[str]:
        arguments = [command, "--host", self.pg_host, "--username", self.pg_user]
        if command == "dropdb":
            arguments.extend(["--if-exists", "--force"])
        arguments.append(self.database_name)
        return subprocess.run(
            arguments,
            cwd=BACKEND_ROOT,
            check=check,
            capture_output=True,
            text=True,
        )

    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{quote(self.pg_user, safe='')}@/"
            f"{self.database_name}?host={quote(self.pg_host, safe='/')}"
        )

    @staticmethod
    def _free_port() -> int:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            return int(listener.getsockname()[1])

    def start(self) -> str:
        try:
            self._postgres("createdb")
            self.database_created = True
            environment = dict(os.environ)
            environment["DATABASE_URL"] = self.database_url()
            subprocess.run(
                [str(BACKEND_ROOT / ".venv" / "bin" / "alembic"), "upgrade", "head"],
                cwd=BACKEND_ROOT,
                env=environment,
                check=True,
                capture_output=True,
                text=True,
            )

            self.release_temp = tempfile.TemporaryDirectory(prefix="kg-deep-recall-release-")
            release_root = Path(self.release_temp.name)
            subprocess.run(
                [
                    "node",
                    str(REPO_ROOT / "frontend" / "scripts" / "manage-new-legacy.js"),
                    "update",
                    str(SOURCE_ROOT),
                    "--root",
                    str(release_root),
                    "--skip-browser",
                ],
                cwd=REPO_ROOT,
                check=True,
                capture_output=True,
                text=True,
            )
            pointer = json.loads((release_root / "current.json").read_text(encoding="utf-8"))
            candidate_site = release_root / pointer["site"]
            active_pointer = json.loads(
                (ACTIVE_RELEASE_ROOT / "current.json").read_text(encoding="utf-8")
            )
            active_site = ACTIVE_RELEASE_ROOT / active_pointer["site"]
            candidate_files = file_count(candidate_site)
            active_files = file_count(active_site)
            assert candidate_files >= active_files, (candidate_files, active_files)
            for relative in (
                "admin-console.html",
                "knowledge-recall.html",
                "src/99-deep-recall-server-adapter.js",
                "content-prep-studio/dist/content-prep.html",
            ):
                assert (candidate_site / relative).is_file(), relative

            port = self._free_port()
            base = f"http://127.0.0.1:{port}"
            environment["NEW_LEGACY_RELEASE_ROOT"] = str(release_root)
            self.server = subprocess.Popen(
                [
                    str(BACKEND_ROOT / ".venv" / "bin" / "uvicorn"),
                    "app.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(port),
                ],
                cwd=BACKEND_ROOT,
                env=environment,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                if self.server.poll() is not None:
                    raise RuntimeError(f"isolated backend exited with {self.server.returncode}")
                try:
                    with urlopen(base + "/api/v1/health", timeout=1) as response:
                        if response.status == 200:
                            break
                except (OSError, URLError):
                    time.sleep(0.1)
            else:
                raise RuntimeError("isolated backend did not become healthy")
            print(
                "deep-recall-isolated-server "
                f"db={self.database_name} version={pointer['version']} "
                f"candidateFiles={candidate_files} activeFiles={active_files} base={base}",
                flush=True,
            )
            return base
        except BaseException:
            self.close()
            raise

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        errors: list[str] = []
        if self.server is not None and self.server.poll() is None:
            self.server.terminate()
            try:
                self.server.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.server.kill()
                self.server.wait(timeout=5)
        if self.database_created:
            result = self._postgres("dropdb", check=False)
            if result.returncode != 0:
                errors.append(result.stderr.strip() or "dropdb failed")
            self.database_created = False
        if self.release_temp is not None:
            release_path = Path(self.release_temp.name)
            self.release_temp.cleanup()
            if release_path.exists():
                errors.append(f"release root remains: {release_path}")
            self.release_temp = None
        if errors:
            raise RuntimeError("; ".join(errors))


SEED_CODE = f"""
import asyncio
import json
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.question import Question, QuestionBank
from app.models.shared_runtime_state import SharedRuntimeState
from app.models.user import User

async def main():
    async with AsyncSessionLocal() as db:
        db.add(User(username={STUDENT!r}, password_hash=hash_password({PASSWORD!r}), role='student', status='active', subject='PMP'))
        await db.flush()
        db.add(QuestionBank(id={BANK_ID!r}, owner_id='admin', name='深度回忆浏览器题库', subject='PMP', visibility='published'))
        await db.flush()
        db.add(Question(
            id={QUESTION_ID!r}, bank_id={BANK_ID!r}, title='风险发生后先做什么？', subject='PMP',
            scope='public', revision=1, content_hash='a' * 64,
            stem_parts=[{{'text':'项目出现重大风险后，需要先做影响分析。','clue':'clue-risk'}}],
            options=[],
            clues=[{{'id':'clue-risk','text':'重大风险','conceptIds':['concept-impact'],'recallNodeId':'recall:risk','isCore':True}}],
            concepts=[{{'id':'concept-impact','title':'影响分析','recallNodeId':'recall:impact','isCore':True,'keywordLevel':'core'}}],
        ))
        library={{
            'schemaVersion':1,
            'nodes':[
                {{'id':'recall:risk','title':'重大风险','titleEn':'Major risk','aliases':['风险事件'],'prompt':'风险出现后先想到什么？'}},
                {{'id':'recall:impact','title':'影响分析','titleEn':'Impact analysis','aliases':['影响评估'],'prompt':'分析影响后还要做什么？'}},
                {{'id':'recall:response','title':'风险应对','titleEn':'Risk response','aliases':['应对措施']}},
            ],
            'edges':[
                {{'from':'recall:risk','to':'recall:impact','priority':2}},
                {{'from':'recall:impact','to':'recall:response','priority':1}},
            ],
            'updatedAt':'2026-08-14T00:00:00Z',
        }}
        db.add(SharedRuntimeState(
            key='kg_recall_association_library_v1__subject__subject-pmp',
            value=json.dumps(library, ensure_ascii=False),
            updated_by='admin',
        ))
        await db.commit()

asyncio.run(main())
"""


BUMP_CODE = f"""
import asyncio
from app.db.session import AsyncSessionLocal
from app.models.question import Question

async def main():
    async with AsyncSessionLocal() as db:
        question=await db.get(Question, {QUESTION_ID!r})
        assert question is not None
        question.title='风险发生后的新版题目'
        question.revision=2
        question.content_hash='b' * 64
        question.stem_parts=[{{'text':'新版：风险发生后先确认影响范围。','clue':'clue-risk'}}]
        await db.commit()

asyncio.run(main())
"""


def run_backend_code(database_url: str, code: str) -> None:
    environment = dict(os.environ)
    environment["DATABASE_URL"] = database_url
    subprocess.run(
        [str(BACKEND_ROOT / ".venv" / "bin" / "python"), "-c", code],
        cwd=BACKEND_ROOT,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )


def assert_ok(response, label: str) -> dict:
    assert response.ok, (label, response.status, response.text())
    return response.json()


def login(context: BrowserContext, base: str) -> None:
    assert_ok(
        context.request.post(
            base + "/api/v1/auth/login",
            data={
                "username": STUDENT,
                "password": PASSWORD,
                "acceptedTermsVersion": "2026-08-13-v1",
            },
        ),
        "student login",
    )


def wait_saved(page: Page) -> None:
    page.locator("#krSaveStatus[data-state='saved']").wait_for(timeout=10_000)


def exercise(page: Page, context: BrowserContext, base: str, database_url: str) -> None:
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
    page.on(
        "console",
        lambda message: errors.append(f"console: {message.text}")
        if message.type == "error"
        else None,
    )

    page.goto(
        f"{base}/knowledge-recall.html?questionId={QUESTION_ID}&bankId={BANK_ID}",
        wait_until="networkidle",
    )
    page.locator("#krQuestionCard").wait_for()
    assert "项目出现重大风险" in page.locator("#krQuestionCard").inner_text()
    assert page.locator(".kr-keyword-token").count() == 0

    page.locator("#krRevealKeywordsBtn").click()
    keyword = page.locator(".kr-keyword-token")
    assert keyword.count() == 1
    assert "is-core" not in (keyword.get_attribute("class") or "")
    assert keyword.get_attribute("data-core") is None
    page.screenshot(path="/tmp/deep-recall-p4529-revealed.png", full_page=True)
    keyword_box = keyword.bounding_box()
    assert keyword_box is not None
    page.mouse.click(
        keyword_box["x"] + keyword_box["width"] / 2,
        keyword_box["y"] + keyword_box["height"] / 2,
    )
    page.locator(".kr-node").wait_for()

    page.locator(".kr-node button").first.click()
    first_choice = page.locator("#krGuide [data-choice-index]").first
    first_choice.wait_for()
    assert "影响分析" in first_choice.inner_text()
    first_choice.click()
    page.locator(".kr-node").nth(1).wait_for()

    custom_input = page.locator("#krCustomInput")
    custom_input.wait_for()
    custom_input.fill("我的风险口诀")
    page.locator("#krCustomSaveBtn").click()
    page.locator(".kr-node").nth(2).wait_for()
    wait_saved(page)
    assert page.locator(".kr-node").count() == 3

    page.locator("#krNodeSearchBtn").click()
    page.locator("#krNodeSearchInput").fill("我的风险口诀")
    page.wait_for_timeout(500)
    search_result = page.locator("#krNodeSearchResults .kr-node-search-result")
    assert search_result.count() == 1
    search_result.click()

    page.screenshot(path="/tmp/deep-recall-p4529-before-reload.png", full_page=True)
    session = assert_ok(
        context.request.get(base + f"/api/v1/recall/session/{QUESTION_ID}"),
        "saved session",
    )
    assert session["progressRevision"] >= 1
    assert len(session["progress"]["nodes"]) == 3
    assert any(node.get("custom") for node in session["progress"]["nodes"])

    progress_keys = page.evaluate(
        "Object.keys(localStorage).filter(key => key.startsWith('kg_deep_recall_progress'))"
    )
    assert progress_keys == [], progress_keys

    page.reload(wait_until="networkidle")
    page.locator(".kr-node").nth(2).wait_for()
    assert page.locator(".kr-node").count() == 3
    assert page.locator(".kr-keyword-token").count() == 0

    run_backend_code(database_url, BUMP_CODE)
    page.reload(wait_until="networkidle")
    version_choice = page.locator("#krVersionChoice")
    version_choice.wait_for(state="visible")
    page.locator("#krViewHistoryBtn").click()
    page.locator(".kr-node").nth(2).wait_for()
    assert page.locator("body.kr-readonly").count() == 1
    assert page.locator(".kr-node").count() == 3
    assert page.locator("#krResetBtn").is_enabled()

    page.once("dialog", lambda dialog: dialog.accept())
    page.locator("#krResetBtn").click()
    page.wait_for_function("document.querySelectorAll('.kr-node').length === 0")
    wait_saved(page)
    assert "新版：风险发生后" in page.locator("#krQuestionCard").inner_text()
    current = assert_ok(
        context.request.get(base + f"/api/v1/recall/session/{QUESTION_ID}"),
        "reset session",
    )
    assert current["versionState"] == "current"
    assert current["currentQuestion"]["revision"] == 2
    assert current["progress"]["nodes"] == []
    assert errors == [], errors


def main() -> None:
    harness = IsolatedDeepRecallHarness()
    try:
        base = harness.start()
        database_url = harness.database_url()
        run_backend_code(database_url, SEED_CODE)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            try:
                login(context, base)
                exercise(context.new_page(), context, base, database_url)
            finally:
                context.close()
                browser.close()
        print("v90-p4529-deep-recall-database-browser-ok")
    finally:
        harness.close()


if __name__ == "__main__":
    main()
