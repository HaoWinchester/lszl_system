#!/usr/bin/env python3
"""Browser acceptance checks for the manual learning entry and answer feedback."""

import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        return


def runtime_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_port}/"


def published_release():
    question = {
        "id": "practice-feedback-question",
        "title": "作答反馈验收题",
        "type": "single_choice",
        "subject": "PMP",
        "stemParts": [{"text": "请选择正确答案。"}],
        "options": [
            {"id": "A", "text": "错误选项"},
            {"id": "B", "text": "正确选项", "correct": True},
        ],
        "correctAnswer": "B",
    }
    return {
        "id": "practice-feedback-release",
        "paperId": "practice-feedback-paper",
        "releaseId": "practice-feedback-release",
        "version": 1,
        "name": "作答反馈试卷",
        "subject": "PMP",
        "status": "published",
        "publishedAt": 1,
        "enabledModes": ["practice_mode"],
        "questions": [{"bankId": "practice-feedback-bank", "questionId": question["id"], "order": 1}],
        "questionSnapshots": [{"bankId": "practice-feedback-bank", "questionId": question["id"], "question": question}],
    }


with sync_playwright() as playwright:
    server, base_url = runtime_server()
    browser = playwright.chromium.launch(headless=True, args=["--no-sandbox", "--disable-gpu"])
    try:
        page = browser.new_page(viewport={"width": 1366, "height": 820})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        release_json = json.dumps(published_release(), ensure_ascii=False)
        page.add_init_script(
            """() => {
              const release = %s;
              localStorage.setItem('kg_exam_papers_published_v1', JSON.stringify([release]));
              localStorage.setItem('kg_local_current_user_v1', 'feedback-student');
              localStorage.setItem('kg_local_users_v1', JSON.stringify({
                'feedback-student': {username:'feedback-student', displayName:'验收用户', role:'student', status:'active', subject:'PMP', salt:'x', hash:'x'}
              }));
            }""" % release_json,
        )

        page.goto(base_url + "index.html", wait_until="networkidle")
        page.locator("#learningEntryBtn").click()
        chooser = page.locator("#learningEntryChooserRoot")
        assert chooser.is_visible(), "manual learning entry did not open"
        assert chooser.locator("[data-learning-entry-choice]").count() == 4
        assert chooser.locator("[data-learning-entry-choice]").all_text_contents() == [
            "知识图谱进入知识图谱",
            "知识回忆深度回忆",
            "知识归纳归纳",
            "知识巩固刷题",
        ]
        page.locator("[data-learning-entry-choice='知识图谱']").click()
        assert not chooser.is_visible(), "graph choice should close the manual chooser"

        page.goto(base_url + "practice-mode.html", wait_until="networkidle")
        page.locator("[data-practice-start='challenge']").click()
        wrong = page.locator(".practice-option[data-option-id='A']")
        right = page.locator(".practice-option[data-option-id='B']")
        wrong.click()
        assert wrong.evaluate("element => element.classList.contains('is-wrong')")
        assert right.evaluate("element => element.classList.contains('is-correct')")
        assert page.locator(".practice-option:disabled").count() == 2
        assert page.locator(".practice-option.is-wrong").count() == 1
        assert page.locator(".practice-option.is-correct").count() == 1
        assert not errors, errors
    finally:
        browser.close()
        server.shutdown()
        server.server_close()

print("learning-entry-answer-feedback-browser-ok")
