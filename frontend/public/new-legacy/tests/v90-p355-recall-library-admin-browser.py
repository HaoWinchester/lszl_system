#!/usr/bin/env python3
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARGS=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=ARGS)
    page=browser.new_page(viewport={'width':1280,'height':900});page.set_default_timeout(10000)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content('''<!doctype html><html><body>
      <section id="ccRecallLibraryPanel">
        <div id="ccRecallLibraryMeta"></div>
        <button id="ccRecallLibraryLoadBtn"></button><button id="ccRecallLibraryImportBtn"></button>
        <input id="ccRecallLibraryFile" type="file"><button id="ccRecallLibraryParseBtn"></button><button id="ccRecallLibrarySaveBtn"></button>
        <textarea id="ccRecallLibraryText"></textarea><select id="ccRecallLibraryMode"><option value="merge">merge</option><option value="replace">replace</option></select>
        <div id="ccRecallLibraryReport"></div>
      </section><div id="ccToast"></div>
    </body></html>''')
    page.evaluate("""()=>{
      const data=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k),clear:()=>data.clear()}});
      window.confirm=()=>true;window.__subject='subject-pmp';
      window.KGLearningContent={subjectById:id=>id==='subject-acp'?{id,code:'ACP',name:{zh:'敏捷项目管理'}}:{id:'subject-pmp',code:'PMP',name:{zh:'项目管理专业人士'}}};
      window.KGContentCenterApp={getSubjectId:()=>window.__subject,toast:message=>{document.getElementById('ccToast').textContent=message}};
    }""")
    page.add_script_tag(content=(ROOT/'src/95-recall-association-library.js').read_text(encoding='utf-8'))
    page.add_script_tag(content=(ROOT/'src/96-recall-association-admin.js').read_text(encoding='utf-8'))
    page.evaluate("document.dispatchEvent(new Event('DOMContentLoaded'))");page.wait_for_timeout(80)

    assert 'PMP' in page.locator('#ccRecallLibraryMeta').inner_text()
    page.locator('#ccRecallLibraryText').fill('关键干系人 -> 项目章程 | 开工大会')
    page.locator('#ccRecallLibraryParseBtn').click();page.wait_for_timeout(30)
    assert '3 个知识点' in page.locator('#ccRecallLibraryReport').inner_text()
    page.locator('#ccRecallLibrarySaveBtn').click();page.wait_for_timeout(30)
    saved=page.evaluate("JSON.parse(localStorage.getItem('kg_recall_association_library_v1__subject__PMP'))")
    assert len(saved['nodes'])==3 and len(saved['edges'])==2,saved

    page.evaluate("window.__subject='subject-acp';document.dispatchEvent(new CustomEvent('kg-content-center-subject-change',{detail:{subjectId:'subject-acp'}}))")
    page.wait_for_timeout(40)
    assert 'ACP' in page.locator('#ccRecallLibraryMeta').inner_text()
    assert page.locator('#ccRecallLibraryText').input_value()==''
    assert not errors,errors
    browser.close()
print('v90-p355-recall-library-admin-browser-ok')
