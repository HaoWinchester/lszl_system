#!/usr/bin/env python3
from pathlib import Path
import re
import shutil

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]


def source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def page_parts() -> tuple[str, str, list[str]]:
    html = source("question-workspace.html")
    assert html.count('href="styles/learning-loading.css"') == 1
    assert html.count('src="src/110-learning-loading.js"') == 1
    match = re.search(r"<body([^>]*)>([\s\S]*)</body>", html, re.I)
    assert match
    body = re.sub(r"<script[\s\S]*?</script>", "", match.group(2), flags=re.I)
    scripts = re.findall(r'<script[^>]+src="([^"]+)"', html, re.I)
    return match.group(1), body, scripts


with sync_playwright() as playwright:
    candidates = [
        shutil.which("chromium"),
        shutil.which("google-chrome"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        playwright.chromium.executable_path,
    ]
    executable = next(path for path in candidates if path and Path(path).exists())
    browser = playwright.chromium.launch(headless=True, executable_path=executable, args=ARGS)
    page = browser.new_page(viewport={"width": 1366, "height": 860})
    page.set_default_timeout(10_000)
    attrs, body, scripts = page_parts()
    page.set_content(
        f'<!doctype html><html><head><base href="http://localhost/"></head><body{attrs}>{body}</body></html>'
    )
    page.add_style_tag(content=source("styles/learning-loading.css"))

    skipped = (
        "src/59-published-paper-repository.js",
        "src/59a-published-question-resolver.js",
        "src/60-question-bank.js",
        "src/77-multi-question-workspace.js",
        "src/94-practice-navigation.js",
        "src/99-learning-practice-shell.js",
        "src/108-multi-question-learning-assets.js",
        "src/110-learning-loading.js",
    )
    for script in scripts:
        if script not in skipped:
            page.add_script_tag(content=source(script))

    page.add_script_tag(content=source("src/110-learning-loading.js"))
    page.evaluate(
        """() => {
          const rows=[
            {paperId:'paper-1',id:'paper-1',releaseId:'release-1',version:1,name:'第一份试卷',title:'第一份试卷',subject:'PMP',publishedAt:2,totalCount:2,enabledModes:['multi_question_canvas'],access:{allowed:true}},
            {paperId:'paper-2',id:'paper-2',releaseId:'release-2',version:1,name:'第二份试卷',title:'第二份试卷',subject:'PMP',publishedAt:1,totalCount:2,enabledModes:['multi_question_canvas'],access:{allowed:true}}
          ];
          const entry=releaseId=>{
            const row=rows.find(item=>item.releaseId===releaseId);
            const items=[1,2].map(index=>({
              paperIndex:index-1,
              ref:{bankId:'bank-'+releaseId,questionId:'question-'+releaseId+'-'+index},
              bank:{id:'bank-'+releaseId,name:row.name,questions:[]},
              question:{id:'question-'+releaseId+'-'+index,title:row.name+'题目 '+index,stemParts:[{text:'题目 '+index}],options:[{id:'A',text:'A'}],sourceReleaseId:releaseId,sourcePaperId:row.paperId}
            }));
            items.forEach(item=>item.bank.questions=items.map(source=>source.question));
            return {ok:true,paper:{...row,status:'published',availability:'published'},release:{...row,status:'published',availability:'published'},items,configuredCount:2,availableCount:2,missingCount:0,damagedCount:0,blockedCount:0,issues:[]};
          };
          window.__paperRows=rows;
          window.__resolvedEntries={};
          window.__resolverCalls=[];
          window.__resolverPending=[];
          window.__listPapersCalls=0;
          window.__listPublishedPapersCalls=0;
          window.__entry=entry;
          window.KGAuthCore={currentUser:()=>({username:'student',role:'student'}),currentUsername:()=> 'student'};
          window.KGRolePermissions={currentRole:()=> 'student',canAccessPublishedPaper:()=>true,canOperateQuestion:()=>true};
          window.KGQuestionCatalogAdapter={ready:Promise.resolve()};
          window.KGPublishedPaperRepository={
            ready:async()=>rows,
            listCatalogEntries:()=>rows.map(item=>({...item})),
            inspectRelease:()=>({ok:true}),
            peekResolved:releaseId=>window.__resolvedEntries[releaseId]||null,
            listPublishedPapers:async()=>{window.__listPublishedPapersCalls+=1;return rows.map(item=>entry(item.releaseId))}
          };
          window.KGPublishedQuestionResolver={
            listPapers:async()=>{window.__listPapersCalls+=1;return rows.map(item=>entry(item.releaseId));},
            resolvePaper:identifier=>{
              const releaseId=String(identifier?.releaseId||'');
              window.__resolverCalls.push(releaseId);
              return new Promise((resolve,reject)=>window.__resolverPending.push({releaseId,resolve:value=>{if(value?.ok)window.__resolvedEntries[releaseId]=value;resolve(value)},reject}));
            },
            message:(result,fallback)=>result?.message||fallback
          };
        }"""
    )
    page.add_script_tag(content=source("src/96-recall-question-source.js"))
    page.add_script_tag(content=source("src/77-multi-question-workspace.js"))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    page.wait_for_timeout(150)

    assert page.evaluate("window.__listPapersCalls") == 0
    assert page.evaluate("window.__listPublishedPapersCalls") == 0
    assert page.evaluate("window.__resolverCalls") == ["release-1"]
    loading = page.locator("[data-learning-loading]")
    assert page.locator("[data-learning-loading]").count() == 1
    assert loading.is_visible()
    assert loading.locator("[data-learning-loading-title]").inner_text() == "正在加载试卷"
    assert loading.locator("[data-learning-loading-message]").inner_text() == "正在读取试题…"

    page.evaluate("window.__resolverPending.shift().resolve(window.__entry('release-1'))")
    page.wait_for_function("KGMultiQuestionWorkspace.getState().releaseId === 'release-1'")
    assert loading.is_hidden()
    assert page.locator("#qwPaperSelect").input_value() == "release-1"
    assert page.evaluate("KGMultiQuestionWorkspace.getState().questionCount") == 2

    page.locator("#qwPaperSelect").select_option("release-2")
    page.wait_for_function("window.__resolverCalls.length === 2")
    assert loading.is_visible()
    assert page.locator("#qwPaperSelect").is_disabled()
    page.evaluate("document.querySelector('#qwPaperSelect').dispatchEvent(new Event('change', {bubbles:true}))")
    page.wait_for_timeout(30)
    assert page.evaluate("window.__resolverCalls") == ["release-1", "release-2"]

    page.evaluate("window.__resolverPending.shift().reject(new Error('network unavailable'))")
    page.wait_for_function("document.querySelector('[data-learning-loading]').hidden")
    assert page.evaluate("KGMultiQuestionWorkspace.getState().releaseId") == "release-1"
    assert page.locator("#qwPaperSelect").input_value() == "release-1"

    page.locator("#qwPaperSelect").select_option("release-2")
    page.wait_for_function("window.__resolverCalls.length === 3")
    page.evaluate("window.__resolverPending.shift().resolve(window.__entry('release-2'))")
    page.wait_for_function("KGMultiQuestionWorkspace.getState().releaseId === 'release-2'")
    assert loading.is_hidden()
    assert page.evaluate("window.__resolverCalls") == ["release-1", "release-2", "release-2"]
    assert page.locator("#qwPaperSelect").input_value() == "release-2"
    assert page.evaluate("KGMultiQuestionWorkspace.getState().questionCount") == 2

    browser.close()

print("multi-question-demand-loading-browser-ok")
