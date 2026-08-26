#!/usr/bin/env python3
from pathlib import Path
import re
import shutil

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]


def source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def body_parts() -> tuple[str, str]:
    html = source("knowledge-recall.html")
    assert html.count('href="styles/learning-loading.css"') == 1
    assert html.count('src="src/110-learning-loading.js"') == 1
    match = re.search(r"<body([^>]*)>([\s\S]*)</body>", html, re.I)
    assert match
    return match.group(1), re.sub(r"<script[\s\S]*?</script>", "", match.group(2), flags=re.I)


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
    attrs, body = body_parts()
    page.set_content(f'<!doctype html><html><body{attrs}>{body}</body></html>')
    page.add_style_tag(content=source("styles/knowledge-recall.css"))
    page.add_style_tag(content=source("styles/learning-loading.css"))
    for script in (
        "src/28-app-storage.js",
        "src/50-question-data.js",
        "src/86-activity-schema-v1.js",
        "src/86-free-mode-language.js",
        "src/85-knowledge-recall-data.js",
        "src/95-recall-association-library.js",
        "src/97-recall-storage.js",
        "src/98-recall-graph-model.js",
        "src/110-learning-loading.js",
    ):
        page.add_script_tag(content=source(script))
    page.evaluate(
        """() => {
          const question=(releaseId,index)=>({
            id:'question-'+releaseId+'-'+index,title:'题目 '+releaseId+' '+index,topic:'PMP',difficulty:'中等',bankId:'bank-'+releaseId,
            paperId:'paper-'+releaseId,releaseId,question:{id:'question-'+releaseId+'-'+index,title:'题目 '+releaseId+' '+index,sourceCollectionId:'paper-release:'+releaseId,sourcePaperId:'paper-'+releaseId,sourceReleaseId:releaseId,sourceBankId:'bank-'+releaseId,stemParts:[],options:[],clues:[],concepts:[]}
          });
          const first={id:'paper-release:release-1',paperId:'paper-1',releaseId:'release-1',name:'第一份试卷 · v1',configuredCount:1,availableCount:1,questions:[question('release-1',1)]};
          const second={id:'paper-release:release-2',paperId:'paper-2',releaseId:'release-2',name:'第二份试卷 · v1',configuredCount:1,availableCount:1,questions:[]};
          const third={id:'paper-release:release-3',paperId:'paper-3',releaseId:'release-3',name:'第三份试卷 · v1',configuredCount:1,availableCount:1,questions:[]};
          window.__recallCollections=[first,second,third];
          window.__recallLoadCalls=[];
          window.__recallPending=[];
          window.__initialRecallLoad=new Promise(resolve=>{window.__resolveInitialRecall=()=>resolve({collection:first,bank:first,item:first.questions[0],question:first.questions[0].question})});
          window.KGRecallQuestionSource={
            list:()=>window.__recallCollections,
            findPublished:()=>window.__initialRecallLoad,
            loadCollection:identifier=>{
              window.__recallLoadCalls.push(String(identifier||''));
              return new Promise((resolve,reject)=>window.__recallPending.push({resolve,reject}));
            },
            activate:async()=>({valid:false,errors:['not used']}),
            emptyQuestion:()=>({id:'unavailable',title:'暂无题目',stemParts:[],options:[],clues:[],concepts:[]})
          };
        }"""
    )
    page.add_script_tag(content=source("src/86-knowledge-recall.js"))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    loading = page.locator("[data-learning-loading]")
    page.wait_for_timeout(80)
    assert loading.is_visible()
    assert loading.locator("[data-learning-loading-title]").inner_text() == "正在加载试卷"
    page.evaluate("window.__resolveInitialRecall()")
    page.wait_for_function("document.querySelector('[data-learning-loading]').hidden")
    page.locator("#krQuestionListBtn").click()
    page.locator("#krBankSelect").select_option("paper-release:release-2")
    page.wait_for_timeout(50)

    assert page.evaluate("window.__recallLoadCalls") == ["paper-release:release-2"]
    assert loading.is_visible()
    assert loading.locator("[data-learning-loading-title]").inner_text() == "正在加载试卷"
    assert page.locator("#krBankSelect").is_disabled()

    page.evaluate(
        """() => {
          const target=window.__recallCollections[1];
          target.questions=[{id:'question-release-2-1',title:'第二份试卷题目',topic:'PMP',difficulty:'中等',bankId:'bank-release-2',paperId:'paper-2',releaseId:'release-2',question:{id:'question-release-2-1',title:'第二份试卷题目',sourceCollectionId:target.id,sourcePaperId:'paper-2',sourceReleaseId:'release-2',sourceBankId:'bank-release-2',stemParts:[],options:[],clues:[],concepts:[]}}];
          window.__recallPending.shift().resolve(target);
        }"""
    )
    page.wait_for_function("document.querySelector('[data-learning-loading]').hidden")
    assert page.locator("#krBankSelect").input_value() == "paper-release:release-2"
    assert page.locator("#krQuestionList .kr-question-item").count() == 1

    page.locator("#krBankSelect").select_option("paper-release:release-3")
    page.wait_for_function("window.__recallLoadCalls.length === 2")
    assert loading.is_visible()
    page.evaluate("window.__recallPending.shift().reject(new Error('network unavailable'))")
    page.wait_for_function("document.querySelector('[data-learning-loading]').hidden")
    assert page.locator("#krBankSelect").input_value() == "paper-release:release-2"
    assert page.locator("#krBankSelect").is_enabled()

    entry = browser.new_page(viewport={"width": 1366, "height": 860})
    entry.set_default_timeout(10_000)
    entry.set_content(f'<!doctype html><html><body{attrs}>{body}</body></html>')
    entry.add_style_tag(content=source("styles/knowledge-recall.css"))
    entry.add_style_tag(content=source("styles/learning-loading.css"))
    for script in (
        "src/28-app-storage.js",
        "src/50-question-data.js",
        "src/86-activity-schema-v1.js",
        "src/86-free-mode-language.js",
        "src/85-knowledge-recall-data.js",
        "src/95-recall-association-library.js",
        "src/97-recall-storage.js",
        "src/98-recall-graph-model.js",
        "src/110-learning-loading.js",
    ):
        entry.add_script_tag(content=source(script))
    entry.evaluate(
        """() => {
          const question={
            id:'question-entry',title:'直接进入题目',sourceCollectionId:'paper-release:release-entry',
            sourcePaperId:'paper-entry',sourceReleaseId:'release-entry',sourceBankId:'bank-entry',
            stemParts:[{text:'直接进入时也应显示这段题干'}],options:[],clues:[],concepts:[]
          };
          const item={id:question.id,title:question.title,bankId:'bank-entry',paperId:'paper-entry',releaseId:'release-entry',question};
          const collection={id:'paper-release:release-entry',paperId:'paper-entry',releaseId:'release-entry',name:'直接进入试卷',configuredCount:1,availableCount:1,questions:[item]};
          window.__entryCollections=[];
          window.__entryAdapterCreates=[];
          window.KGLearningRouteContext={
            parse:()=>({paperId:'',releaseId:'',questionId:'question-entry',bankId:'bank-entry',returnUrl:'index.html'}),
            normalize:value=>({...value}),replace:()=>{},remember:()=>{}
          };
          window.KGRecallQuestionSource={
            list:()=>window.__entryCollections,
            findPublished:async input=>{
              window.__entryCollections=[collection];
              return {collection,bank:collection,item,question};
            },
            emptyQuestion:()=>({id:'unavailable',title:'暂无题目',stemParts:[],options:[],clues:[],concepts:[]})
          };
          window.KGDeepRecallServerAdapter={create:options=>{
            window.__entryAdapterCreates.push({...options});
            const session={
              versionState:'current',currentQuestion:question,progress:{},
              currentLibrary:{payload:{},contentHash:''},library:{payload:{},contentHash:''},
              permissions:{canWrite:true,canReveal:true,readOnly:false}
            };
            return {
              subscribe:()=>{},
              loadSession:async()=>{
                if(!options.releaseId)throw new Error('题目不存在或当前不可学习');
                return session;
              },
              getState:()=>({session,saveState:'idle',graph:{}}),
              saveGraph:async()=>true
            };
          }};
        }"""
    )
    entry.add_script_tag(content=source("src/86-knowledge-recall.js"))
    entry.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    entry.wait_for_function("document.querySelector('[data-learning-loading]').hidden")

    assert entry.locator("#krQuestionCard").inner_text().find("直接进入时也应显示这段题干") >= 0
    assert entry.evaluate("window.__entryAdapterCreates") == [
        {"questionId": "question-entry", "releaseId": "release-entry"}
    ]

    auth = browser.new_page(viewport={"width": 1366, "height": 860})
    auth.set_default_timeout(10_000)
    auth.set_content(f'<!doctype html><html><body{attrs}>{body}</body></html>')
    auth.add_style_tag(content=source("styles/knowledge-recall.css"))
    auth.add_style_tag(content=source("styles/learning-loading.css"))
    for script in (
        "src/28-app-storage.js",
        "src/50-question-data.js",
        "src/86-activity-schema-v1.js",
        "src/86-free-mode-language.js",
        "src/85-knowledge-recall-data.js",
        "src/95-recall-association-library.js",
        "src/97-recall-storage.js",
        "src/98-recall-graph-model.js",
        "src/110-learning-loading.js",
    ):
        auth.add_script_tag(content=source(script))
    auth.evaluate(
        """() => {
          const question={
            id:'question-auth',title:'登录恢复题目',sourceCollectionId:'paper-release:release-auth',
            sourcePaperId:'paper-auth',sourceReleaseId:'release-auth',sourceBankId:'bank-auth',
            stemParts:[{text:'登录成功后无需刷新即可显示题目'}],options:[],clues:[],concepts:[]
          };
          const item={id:question.id,title:question.title,bankId:'bank-auth',paperId:'paper-auth',releaseId:'release-auth',question};
          const collection={id:'paper-release:release-auth',paperId:'paper-auth',releaseId:'release-auth',name:'登录恢复试卷',configuredCount:1,availableCount:1,questions:[item]};
          window.__authReady=false;
          window.__authLoadCount=0;
          window.KGLearningRouteContext={
            parse:()=>({paperId:'paper-auth',releaseId:'release-auth',questionId:'question-auth',bankId:'bank-auth',returnUrl:'index.html'}),
            normalize:value=>({...value}),replace:()=>{},remember:()=>{}
          };
          window.KGRecallQuestionSource={
            list:()=>[collection],
            findPublished:async()=>({collection,bank:collection,item,question}),
            emptyQuestion:()=>({id:'unavailable',title:'暂无题目',stemParts:[],options:[],clues:[],concepts:[]})
          };
          window.KGAuthCore={currentUsername:()=>window.__authReady?'student-auth':''};
          window.KGDeepRecallServerAdapter={create:()=>{
            const session={
              versionState:'current',currentQuestion:question,progress:{},
              currentLibrary:{payload:{},contentHash:''},library:{payload:{},contentHash:''},
              permissions:{canWrite:true,canReveal:true,readOnly:false}
            };
            return {
              subscribe:()=>{},
              loadSession:async()=>{
                window.__authLoadCount+=1;
                if(!window.__authReady)throw new Error('请先登录');
                return session;
              },
              getState:()=>({session,saveState:'idle',graph:{}}),
              saveGraph:async()=>true
            };
          }};
        }"""
    )
    auth.add_script_tag(content=source("src/86-knowledge-recall.js"))
    auth.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))")
    auth.wait_for_function("document.querySelector('[data-learning-loading]').hidden")
    assert "请先登录" in auth.locator("#krQuestionCard").inner_text()

    auth.evaluate(
        """() => {
          window.__authReady=true;
          window.dispatchEvent(new CustomEvent('kg:auth-session-changed',{detail:{authenticated:true,username:'student-auth'}}));
        }"""
    )
    auth.wait_for_function(
        "document.querySelector('#krQuestionCard').innerText.includes('登录成功后无需刷新即可显示题目')"
    )
    assert auth.evaluate("window.__authLoadCount") == 2

    browser.close()

print("deep-recall-demand-loading-browser-ok")
