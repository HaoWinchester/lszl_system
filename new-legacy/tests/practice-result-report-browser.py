#!/usr/bin/env python3
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]

report = {
    "sessionId": "ps-1",
    "resultLabel": "模拟考试结果：PASS",
    "passed": True,
    "scorePercent": 76.67,
    "passPercent": 60,
    "overallBand": "target",
    "counts": {"total": 60, "answered": 58, "correct": 46, "wrong": 12, "unanswered": 2},
    "domainWeights": {"people": 42, "process": 50, "business-environment": 8},
    "domains": {
        "people": {"weight": 42, "total": 25, "answered": 25, "correct": 21, "wrong": 4, "unanswered": 0, "scorePercent": 84, "performanceBand": "aboveTarget"},
        "process": {"weight": 50, "total": 30, "answered": 28, "correct": 22, "wrong": 6, "unanswered": 2, "scorePercent": 73.33, "performanceBand": "target"},
        "business-environment": {"weight": 8, "total": 5, "answered": 5, "correct": 3, "wrong": 2, "unanswered": 0, "scorePercent": 60, "performanceBand": "target"},
    },
    "wrongQuestionIds": ["q7", "q19"],
    "durationMs": 3723000,
    "official": False,
    "disclaimer": "幻谱模拟判定，不代表 PMI 官方考试成绩",
    "completedAt": "2026-08-26T10:00:00+08:00",
}

with sync_playwright() as playwright:
    launch = {"headless": True, "args": ARGS}
    if Path("/usr/bin/chromium").exists():
        launch["executable_path"] = "/usr/bin/chromium"
    browser = playwright.chromium.launch(**launch)
    page = browser.new_page(viewport={"width": 1280, "height": 1100})
    page.set_content('<!doctype html><html><body><section id="report"></section></body></html>')
    page.add_style_tag(content=(ROOT / "styles/practice-mode.css").read_text(encoding="utf-8"))
    page.add_script_tag(content=(ROOT / "src/113-practice-result-report.js").read_text(encoding="utf-8"))
    page.evaluate(
        """report=>{
          window.reviewed='';
          KGPracticeResultReport.render(document.querySelector('#report'),report,{onReviewWrong:id=>window.reviewed=id});
        }""",
        report,
    )
    assert page.locator('.practice-report-logo[src="/assets/logo.jpg"]').count() == 1
    assert "幻谱 PMP 模拟成绩分析报告" in page.locator("#report").inner_text()
    assert "模拟考试结果：PASS" in page.locator("#report").inner_text()
    assert "76.67" in page.locator(".practice-report-score").inner_text()
    assert page.locator(".practice-report-band-segment").count() == 4
    assert page.locator(".practice-report-legend li").count() == 4
    assert page.locator(".practice-report-domain-table tbody tr").count() == 3
    chart_text = page.locator(".practice-report-pie").text_content()
    assert "人员 42%" in chart_text and "流程 50%" in chart_text and "商业环境 8%" in chart_text
    assert page.locator(".practice-report-pie path").count() == 3
    assert page.locator("[data-review-question]").count() == 2
    assert "不代表 PMI 官方考试成绩" in page.locator(".practice-report-disclaimer").inner_text()
    page.locator('[data-review-question="q7"]').click()
    assert page.evaluate("window.reviewed") == "q7"

    assert page.locator('[data-report-review-all]').count() == 0
    page.evaluate("""report=>KGPracticeResultReport.render(document.querySelector('#report'),report,
      {experience:42,onReviewAll:()=>window.reviewed='all'})""", report)
    assert "本次经验" in page.locator('.practice-report-counts').inner_text()
    assert "42" in page.locator('.practice-report-counts').inner_text()
    page.locator('[data-report-review-all]').click()
    assert page.evaluate("window.reviewed") == "all"

    incomplete = {**report, "domainDataComplete": False}
    page.evaluate(
        """report=>KGPracticeResultReport.render(document.querySelector('#report'),report)""",
        incomplete,
    )
    assert page.locator(".practice-report-domain-unavailable").count() == 1
    assert page.locator(".practice-report-pie").count() == 0
    assert page.locator(".practice-report-domain-table").count() == 0
    assert "总体成绩仍按全部题目计算" in page.locator(".practice-report-domain-unavailable").inner_text()

    source = (ROOT / "src/100-practice-mode.js").read_text(encoding="utf-8")
    html = (ROOT / "practice-mode.html").read_text(encoding="utf-8")
    assert "function reviewWrongQuestion(" in source
    assert "function returnToFrozenReport(" in source
    assert "KGPracticeResultReport.render" in source
    assert 'id="practiceReviewBackBtn"' in html
    assert "src/113-practice-result-report.js" in html
    browser.close()

print("practice-result-report-browser-ok")
