#!/usr/bin/env python3
"""Floating answer tools: real pointer/keyboard, layout, shared settings/save retry.
Synthetic routed APIs only; no app/server/database/account mutation.
"""
from pathlib import Path
import importlib.util
import json
from playwright.sync_api import sync_playwright, expect
from helpers.practice_tools import click_tool, open_tools

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('sound_harness',ROOT/'tests/practice-sound-browser.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True)
    for width,height in [(1360,960),(768,960),(390,844),(320,700)]:
        page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
        page.set_default_timeout(10000)
        errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        fixture.harness(page)
        page.add_style_tag(content=(ROOT/'styles/question-comments.css').read_text())
        page.add_script_tag(content=(ROOT/'src/119-question-comments.js').read_text())
        toggle=page.locator('#practiceSideToggle');nav=page.locator('#practiceSideNav')
        expect(nav).to_be_hidden()
        expect(toggle).to_have_attribute('aria-expanded','false')
        assert nav.evaluate('e=>e.inert'), 'closed menu must be excluded from keyboard navigation'
        geometry=page.evaluate('''()=>{const a=document.querySelector('#practiceSideToggle'),b=document.querySelector('#practiceAnswerSheetMobileBtn'),x=a.getBoundingClientRect(),y=b.getBoundingClientRect(),style=getComputedStyle(a);return{a:x.toJSON(),b:y.toJSON(),color:style.backgroundColor,radius:style.borderRadius,fixed:style.position,overflow:document.documentElement.scrollWidth>innerWidth}}''')
        a,b=geometry['a'],geometry['b']
        assert abs(a['width']-56)<=1 and abs(a['height']-56)<=1,(width,geometry)
        assert abs(b['width']-56)<=1 and abs(b['height']-56)<=1,(width,geometry)
        assert 16<=a['x']<=24 and 16<=width-b['right']<=24,(width,geometry)
        assert 16<=height-a['bottom']<=24 and abs(a['bottom']-b['bottom'])<=1,(width,geometry)
        assert a['right']<b['left'] and not geometry['overflow'],(width,geometry)
        assert geometry['color']=='rgb(75, 83, 96)' and geometry['radius']=='50%' and geometry['fixed']=='fixed',geometry
        # Closed controls cannot receive Tab focus; Enter opens, Escape closes and restores FAB focus.
        toggle.focus();page.keyboard.press('Tab')
        assert not nav.evaluate('e=>e.contains(document.activeElement)')
        toggle.focus();page.keyboard.press('Enter');expect(nav).to_be_visible()
        assert not nav.evaluate('e=>e.inert')
        menu=nav.bounding_box();assert 0<=menu['x'] and menu['x']+menu['width']<=width and 0<=menu['y'] and menu['y']+menu['height']<=height-70,(width,menu)
        for selector in ['#practiceExitBtn','#practiceMenuSaveBtn','#practiceDanmakuSettingsBtn','#practiceSoundToggle']:
            expect(page.locator(selector)).to_be_visible()
        assert page.locator('#practiceMenuSaveBtn use').get_attribute('href').endswith('#save')
        page.screenshot(path=ROOT/f'../artifacts/remaining-learning-requirements/menu-full-skin-{width}.png')
        page.keyboard.press('Escape');expect(nav).to_be_hidden();expect(toggle).to_be_focused()
        toggle.press('Space');expect(nav).to_be_visible();page.locator('#practiceQuestionStem').click();expect(nav).to_be_hidden()
        # New and old entry points share the same actual settings module.
        click_tool(page,'#practiceDanmakuSettingsBtn')
        dialog=page.locator('#questionDanmakuSettings');expect(dialog).to_be_visible()
        dialog.locator('[name=count]').select_option('4');dialog.locator('[name=duration]').fill('12');dialog.locator('[name=opacity]').fill('55')
        dialog.locator('[type=submit]').click();expect(dialog).to_have_count(0)
        assert page.evaluate('KGQuestionComments.getDanmakuSettings()')=={'count':4,'duration':12,'opacity':55}
        click_tool(page,'#practiceDanmakuSettingsBtn');expect(dialog).to_be_visible();page.keyboard.press('Escape');expect(dialog).to_have_count(0)
        # Dirty answer, actual async failure/retry through menu, exact whole-paper payload retained.
        page.evaluate('''()=>{window.__pauseInputs=[];window.__failMenuSave=true;const pause=KGPracticeLearningApi.pauseSession;KGPracticeLearningApi.pauseSession=async(id,input)=>{__pauseInputs.push(JSON.parse(JSON.stringify(input)));if(__failMenuSave)throw new Error('injected menu save failure');return pause(id,input)}}''')
        page.locator('[data-option-id=A]').click();open_tools(page)
        expect(page.locator('#practiceMenuSaveBtn')).to_be_enabled()
        click_tool(page,'#practiceMenuSaveBtn');expect(page.locator('#practiceSaveStatusText')).to_contain_text('保存失败')
        assert page.evaluate('KGPracticeMode.snapshot().answered')==1
        open_tools(page);expect(page.locator('#practiceMenuSaveBtn')).to_have_text('重试保存');page.keyboard.press('Escape')
        page.evaluate('__failMenuSave=false');click_tool(page,'#practiceMenuSaveBtn')
        expect(page.locator('#practiceSaveStatusText')).to_contain_text('已保存 1/10')
        assert page.evaluate('__pauseInputs.length===2&&JSON.stringify(__pauseInputs[0].answers)===JSON.stringify(__pauseInputs[1].answers)')
        expect(page.locator('#practiceSaveProgressBtn')).to_be_disabled()
        open_tools(page);expect(page.locator('#practiceMenuSaveBtn')).to_be_disabled();page.keyboard.press('Escape')
        # Existing save status banner remains present; leaving/re-entering never resurrects open tools.
        expect(page.locator('#practiceSessionUnsaved')).to_be_visible()
        click_tool(page,'#practiceExitBtn');expect(page.locator('#practiceExitConfirm')).to_be_visible()
        page.locator('#practiceExitCancel').click();expect(nav).to_be_hidden()
        open_tools(page);page.evaluate('KGPracticeMode.showLobby()');expect(nav).to_be_hidden()
        expect(toggle).to_have_attribute('aria-expanded','false')
        page.locator('[data-practice-start=practice]').click();expect(page.locator('#practiceGame')).to_be_visible();expect(nav).to_be_hidden()
        assert not errors,json.dumps(errors,ensure_ascii=False)
        print('practice-floating-menu-browser-pass',width,flush=True)
        page.close()
    browser.close()
