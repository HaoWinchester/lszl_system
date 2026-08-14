#!/usr/bin/env python3
"""Browser acceptance checks for the manual learning entry and answer feedback."""

import json
import re
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
        page.locator("#learningEntryTopBtn").click()
        chooser = page.locator("#learningEntryModal")
        assert chooser.is_visible(), "manual learning entry did not open"
        assert chooser.locator("[data-learning-entry-choice]").count() == 4
        choice_text = chooser.locator("[data-learning-entry-choice]").all_text_contents()
        assert all(
            label in text
            for label, text in zip(
                ("知识图谱", "知识回忆", "知识归纳", "知识巩固"), choice_text
            )
        ), choice_text
        page.locator("[data-learning-entry-choice='知识图谱']").click()
        assert not chooser.is_visible(), "graph choice should close the manual chooser"

        practice_source = (ROOT / "practice-mode.html").read_text(encoding="utf-8")
        body_match = re.search(r"<body([^>]*)>([\s\S]*)</body>", practice_source, re.I)
        assert body_match
        practice_body = re.sub(
            r"<script[\s\S]*?</script>", "", body_match.group(2), flags=re.I
        )
        practice_page = browser.new_page(viewport={"width": 1280, "height": 900})
        practice_errors = []
        practice_page.on("pageerror", lambda error: practice_errors.append(str(error)))
        practice_page.set_content(
            f'<!doctype html><html><head><base href="http://localhost/"></head><body{body_match.group(1)}>{practice_body}</body></html>'
        )
        practice_page.evaluate(
            """() => {
              const question={id:'practice-feedback-question',title:'作答反馈验收题',stemParts:[{text:'请选择正确答案。'}],options:[{id:'A',text:'错误选项'},{id:'B',text:'正确选项',correct:true}],correctAnswer:'B'};
              const release={id:'practice-feedback-paper',paperId:'practice-feedback-paper',releaseId:'practice-feedback-release',version:1,name:'作答反馈试卷',subject:'PMP',status:'published',questionCount:1,totalCount:1,accessPolicy:{accessLevel:'free'}};
              window.KGAuthCore={currentUser:()=>({username:'feedback-student',role:'student'})};
              window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
              window.KGPaperAccessService={inspect:()=>({allowed:true,accessLevel:'free',state:'free'})};
              window.KGPaperLearningModes={supports:()=>true,isPublishedStatus:()=>true};
              window.KGPublishedPaperRepository={listCatalogEntries:()=>[release],resolvePublishedPaper:()=>({ok:true,items:[{ref:{bankId:'practice-feedback-bank',questionId:question.id},question}]})};
              window.KGPracticeLearningApi={stats:()=>({active:0,pending:0,needsRemediation:0,mastered:0}),active:()=>[],refresh:async()=>({}),answer:async input=>({correct:input.selectedAnswer==='B',mistake:{id:'mistake-1',status:'pending'}}),recordSession:async()=>({}),listSessions:async()=>[],clearSessions:async()=>{}};
              window.confirm=()=>true;window.alert=()=>{};
            }"""
        )
        practice_page.add_script_tag(
            content=(ROOT / "src" / "100-practice-mode.js").read_text(encoding="utf-8")
        )
        practice_page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
        practice_page.locator("[data-practice-start='challenge']").click()
        wrong = practice_page.locator(".practice-option[data-option-id='A']")
        right = practice_page.locator(".practice-option[data-option-id='B']")
        wrong.click()
        practice_page.wait_for_timeout(100)
        assert wrong.evaluate("element => element.classList.contains('is-wrong')")
        assert right.evaluate("element => element.classList.contains('is-correct')")
        assert practice_page.locator(".practice-option:disabled").count() == 2
        assert practice_page.locator(".practice-option.is-wrong").count() == 1
        assert practice_page.locator(".practice-option.is-correct").count() == 1
        assert not practice_errors, practice_errors
        assert not errors, errors
    finally:
        browser.close()
        server.shutdown()
        server.server_close()

print("learning-entry-answer-feedback-browser-ok")
