#!/usr/bin/env python3
"""Verify visible workspace tools with real drawing and shared history on desktop.
Run against the disposable canvas_ink_server.py; --source-overrides tests source without syncing.
"""
import argparse
import re
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/uat-canvas-text-fixes'
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url',required=True)
parser.add_argument('--source-overrides',action='store_true')
args=parser.parse_args()
assert urlparse(args.base_url).hostname in ('127.0.0.1','localhost')
OUT.mkdir(parents=True,exist_ok=True)

def override(route):
    relative=urlparse(route.request.url).path.lstrip('/')
    source=ROOT/'new-legacy'/relative
    if relative=='question-workspace.html':
        body=route.fetch().text()
        source_html=source.read_text()
        for id in ('qwUndoBtn','qwRedoBtn','qwInkBtn'):
            pattern=r'<button\b[^>]*\bid="'+id+r'"[^>]*>.*?</button>'
            button=re.search(pattern,source_html,re.S).group()
            body=re.sub(pattern,lambda _:button,body,flags=re.S)
        route.fulfill(body=body,content_type='text/html')
    elif source.is_file() and relative.endswith(('.js','.css')):
        route.fulfill(path=str(source))
    else:
        route.continue_()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
    for name,width,touch in [('desktop',1440,False),('compact-desktop',1024,False)]:
        context=browser.new_context(viewport={'width':width,'height':1000},has_touch=touch,is_mobile=touch)
        login=context.request.post(args.base_url+'/api/v1/auth/login',data={'username':'ink-browser','password':'ink-browser-test'})
        assert login.ok
        if args.source_overrides:context.route('**/*',override)
        page=context.new_page()
        page.goto(args.base_url+'/question-workspace.html?paperId=ink-paper&releaseId=ink-release',wait_until='networkidle')
        page.wait_for_function('!!window.KGWorkspaceInk && !!window.KGMultiQuestionWorkspace')
        ink=page.locator('#qwInkBtn');undo=page.locator('#qwUndoBtn');redo=page.locator('#qwRedoBtn')
        expect(ink).to_be_visible();expect(undo).to_be_visible();expect(redo).to_be_visible()
        assert page.evaluate('getComputedStyle(document.querySelector("#qwInkBtn"),"::after").content')=='"画笔·文字"'
        page.locator('#qwQuestionDockBtn').click()
        page.locator('[data-add-index]').first.click()
        page.keyboard.press('Escape')
        page.evaluate('window.KGMultiQuestionWorkspace.closeQuestionDrawer()')
        expect(page.locator('.qw-question-card').first).to_be_visible()
        page.wait_for_timeout(500)
        ink.click()
        toolbar=page.locator('.canvas-ink-toolbar')
        for tool in ('pen','highlighter','eraser','text'):
            toolbar.locator('[data-ink-tool='+tool+']').click()
            expect(toolbar.locator('[data-ink-tool='+tool+']')).to_have_attribute('aria-pressed','true')
        toolbar.locator('[data-ink-tool=pen]').click()
        expect(toolbar.locator('[data-ink-action=undo]')).to_be_visible()
        expect(toolbar.locator('[data-ink-action=redo]')).to_be_visible()
        n=page.locator('.canvas-ink-layer path').count()
        box=page.locator('.qw-question-card').first.bounding_box()
        x=box['x']+min(55,box['width']/5);y=box['y']+min(100,box['height']/2)
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+50,y+30,steps=10);page.mouse.up()
        expect(page.locator('.canvas-ink-layer path')).to_have_count(n+1)
        expect(undo).to_be_enabled();undo.click();expect(page.locator('.canvas-ink-layer path')).to_have_count(n)
        expect(redo).to_be_enabled();redo.click();expect(page.locator('.canvas-ink-layer path')).to_have_count(n+1)
        toolbar.locator('[data-ink-action=undo]').click();expect(page.locator('.canvas-ink-layer path')).to_have_count(n)
        toolbar.locator('[data-ink-action=redo]').click();expect(page.locator('.canvas-ink-layer path')).to_have_count(n+1)
        toolbar.locator('[data-ink-tool=highlighter]').click()
        page.mouse.move(x,y+40);page.mouse.down();page.mouse.move(x+50,y+60,steps=10);page.mouse.up()
        expect(page.locator('.canvas-ink-layer path')).to_have_count(n+2)
        expect(page.locator('.canvas-ink-layer path').last).to_have_attribute('opacity','0.3')
        toolbar.locator('[data-ink-tool=eraser]').dblclick()
        expect(page.locator('.canvas-ink-layer path')).to_have_count(0)
        toolbar.locator('[data-ink-action=undo]').click()
        expect(page.locator('.canvas-ink-layer path')).to_have_count(n+2)
        toolbar.locator('[data-ink-tool=pen]').click()
        page.screenshot(path=str(OUT/f'workspace-tools-{name}.png'))
        print('PASS '+name+': visible tools, pen/highlighter drawing, eraser clear, shared undo/redo')
        context.close()
    browser.close()
