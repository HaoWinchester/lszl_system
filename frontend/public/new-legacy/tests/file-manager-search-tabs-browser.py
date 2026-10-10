"""Real file-manager/editor flows against the disposable canvas fixture server."""
import argparse
import uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/file-manager-search-tabs'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--section', choices=['all', 'search', 'tabs'], default='all')
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    assert urlparse(base).hostname in ('localhost', '127.0.0.1'), 'Disposable server only'
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(viewport={'width':1440, 'height':1000})
        assert context.request.post(base+'/api/v1/auth/login', data={'username':'ink-browser','password':'ink-browser-test'}).ok
        suffix = uuid.uuid4().hex[:8]
        files = []
        for index in range(3):
            name = f'页签回归{index+1}-{suffix}'
            graph = {'meta':{'title':name},'viewport':{'x':100,'y':100,'scale':1},'nodes':[{'id':f'n{index}','title':f'文件内容{index+1}','x':100,'y':100}], 'links':[]}
            response = context.request.post(base+'/api/v1/files', data={'name':name,'graphData':graph})
            assert response.ok, response.text()
            files.append(response.json()['file'])
        assert context.request.put(base+'/api/v1/files/current',data={'fileId':files[0]['id']}).ok
        page = context.new_page()
        errors = []
        page.on('pageerror',lambda error:errors.append(str(error)))
        def manager():
            page.goto(base+'/file-manager.html',wait_until='networkidle')
            expect(page.locator('.fm-file-card[data-file-id="'+files[0]['id']+'"]')).to_be_visible()
        manager()
        if args.section in ('all','search'):
            search = page.locator('#fmSearchInput')
            # Model a browser/password-manager fill without a preceding user edit.
            search.evaluate("e=>{e.value='佩奇007';e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertReplacementText'}))}")
            expect(search).to_have_value('')
            for file in files: expect(page.locator('.fm-file-card[data-file-id="'+file['id']+'"]')).to_be_visible()
            search.fill(files[1]['name'])
            expect(page.locator('.fm-file-card[data-file-id="'+files[1]['id']+'"]')).to_be_visible()
            expect(page.locator('.fm-file-card[data-file-id="'+files[0]['id']+'"]')).to_have_count(0)
            # Late non-user input cannot replace a deliberate query.
            search.evaluate("e=>{e.value='佩奇007';e.dispatchEvent(new Event('input',{bubbles:true}))}")
            expect(search).to_have_value(files[1]['name'])
            search.fill('不存在的回归文件')
            expect(page.get_by_role('button',name='清除搜索',exact=True)).to_be_visible()
            page.get_by_role('button',name='清除搜索',exact=True).click()
            expect(search).to_have_value('')
            for file in files: expect(page.locator('.fm-file-card[data-file-id="'+file['id']+'"]')).to_be_visible()
            search.fill(files[2]['name']); search.press('ControlOrMeta+A'); search.press('Backspace')
            expect(search).to_have_value('')
            search.evaluate("e=>{e.value='佩奇007';window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))}")
            expect(search).to_have_value('')
            page.screenshot(path=str(OUT/'file-manager-search.png'))
            print('PASS search: autofill isolation, explicit input, late fill, no-results clear, keyboard clear and pageshow',flush=True)
        if args.section in ('all','tabs'):
            requested = []
            page.on('request',lambda request:requested.append((request.method,request.url)))
            page.locator('.fm-file-card[data-file-id="'+files[0]['id']+'"]').dblclick()
            page.wait_for_url('**/index.html*')
            for file in files: expect(page.locator('.graph-file-tab[data-file-id="'+file['id']+'"]')).to_be_visible(timeout=10000)
            assert not any(method=='GET' and urlparse(url).path=='/api/v1/files/'+files[2]['id'] for method,url in requested), 'Unopened graph body was eagerly fetched'
            for selector in ['#learningEntryDismissBtn','.tour-skip']:
                if page.locator(selector).is_visible():page.locator(selector).click()
            for index in [1,2,0]:
                file = files[index]
                page.locator('.graph-file-tab[data-file-id="'+file['id']+'"] .graph-file-tab-title').click()
                expect(page.locator('#appTitle')).to_have_text(file['name'])
                assert page.evaluate('state.nodes[0].title')==f'文件内容{index+1}'
            page.locator('.graph-file-tab[data-file-id="'+files[1]['id']+'"]').hover()
            page.locator('[data-close-file-id="'+files[1]['id']+'"]').click()
            expect(page.locator('.graph-file-tab[data-file-id="'+files[1]['id']+'"]')).to_have_count(0)
            page.reload(wait_until='networkidle')
            expect(page.locator('.graph-file-tab[data-file-id="'+files[0]['id']+'"]')).to_be_visible()
            expect(page.locator('.graph-file-tab[data-file-id="'+files[2]['id']+'"]')).to_be_visible()
            expect(page.locator('.graph-file-tab[data-file-id="'+files[1]['id']+'"]')).to_have_count(0)
            assert context.request.get(base+'/api/v1/files/'+files[1]['id']).ok, 'Closing a tab deleted its file'
            page.locator('#graphFileHomeBtn').click();page.wait_for_url('**/file-manager.html*')
            expect(page.locator('#fmSearchInput')).to_have_value('')
            page.locator('.fm-file-card[data-file-id="'+files[1]['id']+'"]').dblclick();page.wait_for_url('**/index.html*')
            for file in files: expect(page.locator('.graph-file-tab[data-file-id="'+file['id']+'"]')).to_be_visible()
            expect(page.locator('#appTitle')).to_have_text(files[1]['name'])
            page.screenshot(path=str(OUT/'graph-multiple-tabs.png'))
            print('PASS tabs: metadata index, lazy bodies, UI switching, content isolation, close/reload/reopen and manager round trip',flush=True)
            # Exercise the actual same-page auth event chain, not a manual store reset.
            second = browser.new_context()
            username = 'tabs_owner_'+suffix
            password = 'Tabs-owner-test-123'
            assert second.request.post(base+'/api/v1/auth/register',data={'username':username,'password':password}).ok
            assert second.request.post(base+'/api/v1/auth/login',data={'username':username,'password':password}).ok
            response = second.request.post(base+'/api/v1/files',data={'name':'另一账号图谱-'+suffix,'graphData':{'meta':{'title':'另一账号图谱-'+suffix},'nodes':[],'links':[]}})
            assert response.ok,response.text()
            other = response.json()['file']
            assert second.request.put(base+'/api/v1/files/current',data={'fileId':other['id']}).ok
            second.close()
            page.locator('[data-account-menu-trigger]').click()
            page.locator('[aria-label="退出登录"]').click()
            page.wait_for_function('!KGAuthCore.currentUser()')
            for file in files:expect(page.locator('.graph-file-tab[data-file-id="'+file['id']+'"]')).to_have_count(0)
            page.locator('[data-account-menu-trigger]').click()
            page.locator('#accountMenuSessionBtn').click()
            expect(page.locator('#authModal')).to_be_visible()
            page.locator('#authUsername').fill(username);page.locator('#authPassword').fill(password)
            if page.locator('#authLegalConsent').is_visible():page.locator('#authLegalConsent').check()
            page.locator('#authDoLoginBtn').click()
            page.wait_for_function('(name)=>KGAuthCore.currentUser()?.username===name',arg=username)
            expect(page.locator('.graph-file-tab[data-file-id="'+other['id']+'"]')).to_be_visible()
            for file in files:expect(page.locator('.graph-file-tab[data-file-id="'+file['id']+'"]')).to_have_count(0)
            expect(page.locator('#appTitle')).to_have_text(other['name'])
            if page.locator('#learningEntryDismissBtn').is_visible():page.locator('#learningEntryDismissBtn').click()
            page.locator('#graphFileHomeBtn').click();page.wait_for_url('**/file-manager.html*')
            expect(page.locator('.fm-file-card[data-file-id="'+other['id']+'"]')).to_be_visible()
            for file in files:expect(page.locator('.fm-file-card[data-file-id="'+file['id']+'"]')).to_have_count(0)
            print('PASS owner: actual logout/login clears old tabs and bodies; manager shows only new owner',flush=True)
        assert not errors, errors
        browser.close()

if __name__=='__main__':main()
