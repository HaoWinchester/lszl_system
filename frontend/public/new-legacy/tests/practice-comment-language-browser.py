"""Actual practice DOM/language helpers: translations never restart same-question danmaku."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
fixture=ROOT/'tests/practice-side-nav-comments-browser.py'
setup=fixture.read_text().split("        assert page.locator('#practiceSideToggle')")[0]
setup=setup.replace('"src/119-question-comments.js",','"src/86-free-mode-language.js",\n    "src/119-question-comments.js",')
setup=setup.replace('for viewport in [{"width": 1440, "height": 960}, {"width": 390, "height": 844}]:','for viewport in [{"width": 1440, "height": 960}, {"width": 390, "height": 844}, {"width":320,"height":740}]:')
setup=setup.replace("getLanguageMode:()=>'zh',setPracticeAutoExplain:()=>{},setLanguageMode:()=>{}", "getLanguageMode:()=>window.__lang||'zh',setPracticeAutoExplain:()=>{},setLanguageMode:value=>{window.__lang=value;window.dispatchEvent(new CustomEvent('kg:question-language-mode'))}")
setup=setup.replace("analysis:'第 '+index+' 题解析'", "analysis:'第 '+index+' 题解析',translations:{en:{stem:'English question '+index,options:[{id:'A',text:'First option'},{id:'B',text:'Second option'}],analysis:'English explanation '+index}}")
scenario='''
        comment_requests=[]
        page.on('request',lambda request:comment_requests.append(request.url) if request.url.endswith('/q1/comments') else None)
        page.evaluate("KGActivitySchemaV1.getPracticeAutoExplain=()=>true")
        page.locator('[data-option-id=B]').click()
        page.wait_for_selector('body>.q-danmaku .q-danmaku-item',state='attached')
        page.locator('#practiceLanguageCycle').scroll_into_view_if_needed()
        page.wait_for_function("document.querySelector('.q-danmaku').getBoundingClientRect().top>=document.querySelector('#practiceLanguageCycle').getBoundingClientRect().bottom+12")
        page.evaluate("window.originalOverlay=document.querySelector('.q-danmaku');window.originalChip=originalOverlay.querySelector('.q-danmaku-item');window.animation=originalChip.getAnimations()[0];window.initialTime=animation.currentTime")
        initial_count=len(comment_requests)
        for label in ['EN','双','中']:
            page.locator('#practiceLanguageCycle').click()
            assert page.locator('#practiceLanguageCycle').inner_text()==label
            if label=='EN':assert 'English question' in page.locator('#practiceQuestionStem').inner_text()
            if label=='双':assert page.locator('#practiceQuestionStem .practice-bilingual-en').count()==1
            if label=='中':assert '这是第' in page.locator('#practiceQuestionStem').inner_text()
            assert page.evaluate("originalOverlay===document.querySelector('.q-danmaku')&&originalChip===originalOverlay.querySelector('.q-danmaku-item')")
            assert page.evaluate('animation.currentTime>=initialTime')
        assert len(comment_requests)==initial_count==1,comment_requests
        page.locator('#practiceLanguageCycle').scroll_into_view_if_needed()
        out=ROOT.parent/'artifacts/ui-polish-20261020';out.mkdir(parents=True,exist_ok=True)
        page.screenshot(path=str(out/('practice-language-'+str(viewport['width'])+'.png')))
        click_tool(page,'#practiceExitBtn')
        page.locator('#practiceSaveExitBtn').click()
        page.wait_for_function("document.body.dataset.practiceView==='lobby'")
        assert page.locator('.q-danmaku').count()==0
        assert not errors,errors
        print('PASS real translated practice/DOM identity/animation/API count/exit cleanup',viewport)
        page.close()
    browser.close()
'''
exec(compile(setup+scenario,str(fixture),'exec'),{'__file__':str(fixture)})
