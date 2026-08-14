"""Browser E2E for P4.5.29 G5: workspace autosave to DB shared draft (diff 22-23).

Stubs window.fetch for /content-prep/drafts and asserts:

1. editing schedules a debounced autosave that PUTs the shared draft to the server
2. a failing autosave keeps dirty state and shows a retryable error (never "saved")
3. a 409 revision conflict offers copy-as-new-draft recovery instead of silent overwrite
4. reloading the page restores the last open draft from the server
"""

from __future__ import annotations

from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "content-prep-studio" / "dist" / "content-prep.html"

STUB = """
window.__KG_DIRECT_BOOTSTRAP__ = Object.assign({}, window.__KG_DIRECT_BOOTSTRAP__, { authenticated: true, authUser: { username: 'teacher-a', role: 'teacher' } });
window.__draftCalls = [];
window.__draftMode = 'ok';
window.__draftStore = { 'draft-1': { id: 'draft-1', title: '上次草稿', revision: 4,
  payload: { prepStudioWorkspaceVersion: 4, savedAt: '', schema: {}, questionBank: { questions: [] },
    principles: {}, synthesisPresets: {}, tagConfig: {} } } };
const realFetch = window.fetch.bind(window);
window.fetch = async (url, options) => {
  const href = String(url);
  if (!href.includes('/content-prep/drafts')) return realFetch(url, options);
  const method = String((options || {}).method || 'GET').toUpperCase();
  window.__draftCalls.push({ method, href });
  if (method === 'GET') {
    const found = window.__draftStore['draft-1'];
    return new Response(JSON.stringify(found ? { draft: found } : {}), { status: found ? 200 : 404,
      headers: { 'content-type': 'application/json' } });
  }
  if (method === 'PUT' && window.__draftMode === 'conflict') {
    return new Response(JSON.stringify({ detail: { code: 'CONFLICT', message: '服务器数据已变化，请重新载入后再试。' } }),
      { status: 409, headers: { 'content-type': 'application/json' } });
  }
  if (method === 'PUT') {
    window.__draftStore['draft-1'] = { id: 'draft-1', title: '当前草稿', revision: 5, payload: {} };
    return new Response(JSON.stringify({ draft: { id: 'draft-1', title: '当前草稿', revision: 5 } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (method === 'POST') {
    window.__draftStore['draft-copy'] = { id: 'draft-copy', title: '冲突副本', revision: 1, payload: {} };
    window.__draftCalls.push({ method: 'POST-CREATED' });
    return new Response(JSON.stringify({ draft: { id: 'draft-copy', title: '冲突副本', revision: 1 } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};
"""


def goto_prep(page):
    page.goto(DIST.as_uri())
    page.wait_for_timeout(400)
    if page.locator("#creatorGate").is_visible():
        page.click('#creatorGate button[data-creator-key="peiqi"]')
        page.wait_for_timeout(300)
    page.evaluate("() => { document.getElementById('sharedDraftGate')?.classList.add('hidden'); }")


def run() -> None:
    dialogs: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1360, "height": 900})
        page.on("dialog", lambda dialog: (dialogs.append(dialog.message), dialog.accept()))
        page.add_init_script(STUB)
        goto_prep(page)

        # 进入编辑状态：已有草稿 + dirty
        page.evaluate("() => { prepRuntime.draftId='draft-1'; prepRuntime.draftRevision=4; prepRuntime.draftTitle='当前草稿'; prepRuntime.dirty=false; }")
        page.click('button[data-tab="questions"]')
        page.wait_for_timeout(150)
        page.click("#btnNewQuestion")
        page.wait_for_timeout(2600)  # 超过 1.5s 防抖窗口

        puts = page.evaluate("() => window.__draftCalls.filter(c => c.method === 'PUT').length")
        assert puts >= 1, "编辑后应防抖自动保存共享草稿到服务器"
        dirty_after = page.evaluate("() => prepRuntime.dirty")
        assert dirty_after in (False, None) or dirty_after == False or not dirty_after, dirty_after

        # 2) 网络失败：保留 dirty + 可重试提示
        page.evaluate("() => { window.fetch = async (url, options) => { if (String(url).includes('/content-prep/drafts') && String((options||{}).method||'').toUpperCase()==='PUT') { window.__draftCalls.push({method:'PUT-FAILED'}); throw new TypeError('Failed to fetch'); } return new Response('{}', {status:200}); }; }")
        page.evaluate("async () => { prepRuntime.dirty = true; try { await window.PMPPrepAutosave.runNow(); } catch (e) {} }")
        status_text = page.evaluate("() => document.getElementById('hdrSaveStatus')?.textContent || ''")
        assert "自动保存失败" in status_text and "重试" in status_text, status_text
        assert page.evaluate("() => prepRuntime.dirty") is True, "失败后必须保留 dirty"

        # 3) 409 冲突：复制本地为新草稿，不静默覆盖
        page.evaluate("""() => {
          const store = window.__draftStore;
          window.fetch = async (url, options) => {
            const href = String(url), method = String((options||{}).method||'GET').toUpperCase();
            window.__draftCalls.push({ method, href });
            if (method === 'PUT') return new Response(JSON.stringify({detail:{code:'CONFLICT',message:'服务器数据已变化，请重新载入后再试。'}}), {status:409, headers:{'content-type':'application/json'}});
            if (method === 'GET') return new Response(JSON.stringify({draft:store['draft-1']||{}}), {status:200, headers:{'content-type':'application/json'}});
            if (method === 'POST') { store['draft-copy'] = {id:'draft-copy',title:'冲突副本',revision:1,payload:{}}; return new Response(JSON.stringify({draft:{id:'draft-copy',title:'冲突副本',revision:1}}), {status:200, headers:{'content-type':'application/json'}}); }
            return new Response('{}', {status:200});
          };
          prepRuntime.draftId = 'draft-1'; prepRuntime.draftRevision = 4; prepRuntime.draftTitle = '当前草稿';
        }""")
        page.evaluate("() => { window.__promptAnswer = '冲突副本'; }")
        page.evaluate("""() => {
          window.__confirmMessages = [];
          window.confirm = message => { window.__confirmMessages.push(String(message)); return true; };
          window.prompt = () => window.__promptAnswer;
        }""")
        page.evaluate("async () => { prepRuntime.dirty = true; try { await window.PMPPrepAutosave.runNow(); } catch (e) {} }")
        page.wait_for_timeout(200)
        posts = page.evaluate("() => window.__draftCalls.filter(c => c.method === 'POST').length")
        assert posts >= 1, "409 选择复制副本时应 POST 新草稿"
        conflict_messages = page.evaluate("() => window.__confirmMessages || []")
        conflict_dialog = any("复制为新草稿" in message for message in [*dialogs, *conflict_messages])
        assert conflict_dialog, "冲突必须显式提示，不允许静默覆盖"
        assert page.evaluate("() => prepRuntime.draftId") == "draft-copy"

        # 4) 刷新后按 lastDraftId 自动恢复
        page.evaluate("() => { localStorage.setItem('prep.lastDraftId', 'draft-1'); }")
        page.reload()
        page.wait_for_timeout(600)
        if page.locator("#creatorGate").is_visible():
            page.click('#creatorGate button[data-creator-key="peiqi"]')
            page.wait_for_timeout(300)
        page.wait_for_timeout(500)
        draft_id = page.evaluate("() => prepRuntime.draftId")
        assert draft_id == "draft-1", f"刷新后应恢复上次草稿，实际 {draft_id}"
        gets = page.evaluate("() => window.__draftCalls.filter(c => c.method === 'GET').length")
        assert gets >= 1

        browser.close()
    print("v90-p4529 workspace autosave browser: passed")


if __name__ == "__main__":
    run()
