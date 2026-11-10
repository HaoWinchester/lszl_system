"""Exercise short-window authentication against the disposable canvas API server.

Only the external WeChat SDK/iframe are fixtures. Login, session, logout and
OAuth authorization-address requests use the real FastAPI/PostgreSQL backend.
Pass --source to overlay authored CSS onto the actual served stylesheet list.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from urllib.parse import parse_qsl, unquote, urlencode, urlparse, urlunparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "new-legacy"
PAGES = ("/graph", "/index.html", "/workbench.html", "/practice-mode.html",
         "/knowledge-recall.html", "/question-workspace.html")
VIEWPORTS = ((970, 530), (800, 450), (800, 320), (390, 600), (320, 320))
LEGAL_VERSION = "2026-08-13-v1"
SDK = "https://res.wx.qq.com/connect/zh_CN/htmledition/js/wxLogin.js"
SDK_FIXTURE = """window.WxLogin=function(options){
 const target=document.getElementById(options.id),frame=document.createElement('iframe');
 frame.title='微信扫码登录布局测试';frame.width='300';frame.height='400';
 frame.style.cssText='width:300px;height:400px;border:0';
 frame.src='https://open.weixin.qq.com/connect/qrconnect?viewport_fixture=1';
 target.replaceChildren(frame);
};"""
FRAME_FIXTURE = """<!doctype html><html><head><style>
html,body{margin:0;width:300px;height:400px;background:white;overflow:hidden}
[data-qr-square]{position:absolute;left:10px;top:50px;width:280px;height:280px;
 box-sizing:border-box;border:8px solid #111;background:repeating-conic-gradient(#111 0 25%,#fff 0 50%) 0/20px 20px}
[data-frame-bottom]{position:absolute;left:0;right:0;top:380px;height:20px;text-align:center}
</style></head><body><div data-frame-top>微信授权 iframe 上边界</div>
<div data-qr-square></div><div data-frame-bottom>iframe 下边界</div></body></html>"""


def source_css(route, seen):
    """Use the bundle's own style markers, preserving its exact order."""
    path = unquote(urlparse(route.request.url).path).lstrip("/")
    authored = SOURCE / path
    if authored.is_file() and authored.suffix == ".css":
        seen.add(path)
        route.fulfill(status=200, content_type="text/css", body=authored.read_text())
        return
    response = route.fetch()
    text = response.text()
    if path.startswith("bundles/") and path.endswith(".css"):
        marker = re.compile(r"(/\* style: ([^*\r\n]+) \*/\n)(.*?)(?=/\* style: |\Z)", re.S)

        def replace(match):
            filename = match.group(2).strip()
            file = SOURCE / filename
            if file.is_file() and file.suffix == ".css":
                seen.add(filename)
                return match.group(1) + file.read_text().rstrip() + "\n"
            return match.group(0)

        text = marker.sub(replace, text)
    route.fulfill(response=response, body=text)


def new_context(browser, args, width, height, overlay=None):
    # 390px represents a phone; 320px explicitly represents a narrow PC window.
    context = browser.new_context(viewport={"width": width, "height": height},
                                  has_touch=width <= 640 and width != 320)
    seen = set()
    if args.source if overlay is None else overlay:
        context.route(re.compile(r".*\.css(?:\?.*)?$"), lambda route: source_css(route, seen))
    context.route(SDK, lambda route: route.fulfill(
        status=200, content_type="application/javascript", body=SDK_FIXTURE))
    context.route("https://open.weixin.qq.com/connect/qrconnect?viewport_fixture=1",
                  lambda route: route.fulfill(status=200, content_type="text/html", body=FRAME_FIXTURE))
    return context, seen


def state(page, selector):
    return page.locator(selector).evaluate("""element=>{
      const r=element.getBoundingClientRect();
      let left=0,top=0,right=innerWidth,bottom=innerHeight;
      const ancestors=[];
      for(let p=element.parentElement;p;p=p.parentElement){
        const s=getComputedStyle(p),b=p.getBoundingClientRect();
        ancestors.push({tag:p.id||p.className||p.tagName,top:p.scrollTop,
          height:p.clientHeight,scrollHeight:p.scrollHeight,overflow:s.overflowY});
        if(/hidden|clip|auto|scroll/.test(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right)}
        if(/hidden|clip|auto|scroll/.test(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom)}
      }
      const x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);
      return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},clip:{left,top,right,bottom},
        reachable:r.width>0&&r.height>0&&x>left&&x<right&&y>top&&y<bottom&&
          !!hit&&(hit===element||element.contains(hit)),ancestors};
    }""")


def scroll_positions(page):
    return page.locator("#authModal").evaluate("""root=>[root,...root.querySelectorAll('*')]
      .filter(e=>e.scrollHeight>e.clientHeight+1)
      .map(e=>({name:e.id||e.className,top:e.scrollTop,height:e.clientHeight,
        scrollHeight:e.scrollHeight,overflow:getComputedStyle(e).overflowY}))""")


def scroll_input(page, direction, touch, magnitude=240):
    box = page.locator("#authModal .auth-body").bounding_box()
    viewport = page.viewport_size
    left, right = max(1, box["x"]), min(viewport["width"] - 1, box["x"] + box["width"])
    top, bottom = max(12, box["y"]), min(viewport["height"] - 12, box["y"] + box["height"])
    assert right > left and bottom > top, "No visible authentication body to scroll"
    x, y = (left + right) / 2, (top + bottom) / 2
    if touch:
        session = page.context.new_cdp_session(page)
        distance = min(140, (bottom - top) * .55)
        start = y + direction * distance / 2
        session.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": start}]})
        for i in range(1, 7):
            session.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": start - direction * distance * i / 6}]})
        session.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        session.detach()
    else:
        page.mouse.move(x, y)
        page.mouse.wheel(0, direction * magnitude)
    page.wait_for_timeout(100)


def reach(page, selector, report, touch=False):
    """Reach controls with real scroll input; never scrollIntoView or force."""
    for _ in range(18):
        current = state(page, selector)
        if current["reachable"]:
            return current
        before = scroll_positions(page)
        center = current["rect"]["y"] + current["rect"]["height"] / 2
        direction = -1 if center <= current["clip"]["top"] else 1
        scroll_input(page, direction, touch)
        after = scroll_positions(page)
        changed = before != after
        report["scrolls"].append({"target": selector, "input": "touch" if touch else "wheel",
                                  "changed": changed, "before": before, "after": after})
        if not changed:
            raise AssertionError(f"Natural scroll cannot reach {selector}: {json.dumps(current)}")
    raise AssertionError(f"Control remains unreachable after natural scroll: {selector}")


def click(page, selector, report, touch=False):
    reach(page, selector, report, touch)
    page.locator(selector).click()


def prepare_page(page, report):
    page.wait_for_function("!!window.KGAuthCore && typeof window.authOpen==='function'")
    if page.locator("body.knowledge-graph-page").count():
        page.wait_for_function("!!window.KGHomepageGraphBootstrap")
        page.evaluate("async()=>{await window.KGHomepageGraphBootstrap;return true}")
    notice = page.locator("[data-home-mobile-readonly-confirm]:visible")
    if notice.count():
        notice.click()
        report.setdefault("preparations", []).append("closed-mobile-reading-notice")
    # The existing draggable shortcuts can overlap the account menu in a short
    # landscape window. Move them through their visible drag handle, as a user can.
    shortcuts = page.locator("#kgGlobalShortcuts:visible")
    if shortcuts.count():
        box = shortcuts.bounding_box()
        handle = page.locator("#kgGlobalShortcutsHandle").bounding_box()
        if box["x"] > page.viewport_size["width"] / 2:
            x, y = handle["x"] + handle["width"] / 2, handle["y"] + handle["height"] / 2
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.move(x - box["x"] + 12, y, steps=12)
            page.mouse.up()
            report.setdefault("preparations", []).append("dragged-global-shortcuts-left")


def open_dialog(page, report, touch=False):
    page.wait_for_function("!!window.KGAuthCore && !!document.querySelector('[data-account-menu-trigger]')")
    if not page.locator("#authModal.show").count():
        trigger = page.locator("[data-account-menu-trigger]").first
        if not trigger.is_visible() and page.locator("body.graph-phone-reading").count():
            # Phone graph mode intentionally hides the entire editor toolbar.
            # Exercise its supported login-return URL rather than exposing it.
            url = urlparse(page.url)
            query = dict(parse_qsl(url.query))
            query["auth"] = "login"
            page.goto(urlunparse(url._replace(query=urlencode(query))), wait_until="domcontentloaded")
            report.setdefault("preparations", []).append("phone-graph-used-existing-auth-login-url")
        else:
            trigger.click()
            page.locator("#accountMenuSessionBtn").click()
    else:
        report.setdefault("preparations", []).append("page-requested-authentication")
    page.locator("#authModal.show").wait_for(state="visible")
    # The real referral field changes the dialog height substantially.
    page.locator("#authReferralCode").wait_for(state="attached")
    page.locator("#authReferralRewardNote").wait_for(state="attached")
    page.wait_for_function("!document.querySelector('.auth-modal').getAnimations().some(a=>a.playState==='running')")
    page.wait_for_function("!!document.querySelector('.wechat-login-entry')")


def fill(page, selector, value, report, touch=False):
    reach(page, selector, report, touch)
    page.locator(selector).fill(value)


def configure_wechat(browser, args):
    context = browser.new_context()
    try:
        response = context.request.post(args.base_url + "/api/v1/auth/login", data={
            "username": args.admin_username, "password": args.admin_password,
            "acceptedTermsVersion": LEGAL_VERSION})
        assert response.ok, "Use the isolated --role-matrix fixture admin account"
        response = context.request.put(args.base_url + "/api/v1/system/wechat-config", data={
            "enableOfficial": True, "enableDemo": False, "appId": "auth-viewport-test",
            "redirectUri": args.base_url + "/api/v1/auth/wechat/callback", "scope": "snsapi_login"})
        assert response.ok, "Could not configure disposable WeChat public settings"
        response = context.request.get(args.base_url + "/api/v1/auth/wechat/config")
        assert response.ok and response.json()["mode"] == "official", (
            "Start the disposable fixture with fake WECHAT_APP_SECRET, WECHAT_APP_ID, "
            "WECHAT_ENABLE_OFFICIAL=true and WECHAT_ENABLE_DEMO=false")
        assert context.request.post(args.base_url + "/api/v1/auth/logout").ok
    finally:
        context.close()


def exercise(browser, args, route, width, height):
    context, seen = new_context(browser, args, width, height)
    page = context.new_page()
    page.set_default_timeout(12_000)
    touch = width <= 640 and width != 320
    report = {"route": route, "width": width, "height": height,
              "pointer": "coarse" if touch else "fine", "scrolls": [], "passed": False}
    login_requests = []
    oauth_requests = []
    page.on("request", lambda request: login_requests.append(request) if
            request.method == "POST" and urlparse(request.url).path == "/api/v1/auth/login" else None)
    page.on("request", lambda request: oauth_requests.append(request) if
            urlparse(request.url).path == "/api/v1/auth/wechat/auth-url" else None)
    try:
        page.goto(args.base_url + route, wait_until="domcontentloaded")
        prepare_page(page, report)
        open_dialog(page, report, touch)
        report["initial_login"] = state(page, "#authDoLoginBtn")
        report["initial_legal"] = state(page, "#authLegalConsent")
        # An actual wheel/touch movement must change scrollTop in short windows.
        before = scroll_positions(page)
        scroll_input(page, 1, touch)
        after = scroll_positions(page)
        report["scrolls"].append({"target": "initial-short-window", "input": "touch" if touch else "wheel",
                                  "changed": before != after, "before": before, "after": after})
        assert before != after, "Short-window authentication content cannot naturally scroll"

        fill(page, "#authUsername", args.username, report, touch)
        fill(page, "#authPassword", "incorrect-auth-viewport-password", report, touch)
        click(page, "#authDoLoginBtn", report, touch)
        assert "请先阅读并勾选同意" in page.locator("#authMsg").inner_text()
        assert not login_requests, "Consent failure sent an authentication request"
        click(page, "#authLegalConsent", report, touch)
        assert page.locator("#authLegalConsent").is_checked()
        with page.expect_response(lambda response: urlparse(response.url).path == "/api/v1/auth/login") as failed:
            click(page, "#authDoLoginBtn", report, touch)
        assert failed.value.status == 401
        page.wait_for_function("!document.getElementById('authDoLoginBtn').disabled")
        assert context.request.get(args.base_url + "/api/v1/auth/me").json().get("user") is None
        report["invalid_password_status"] = failed.value.status

        click(page, ".wechat-login-entry", report, touch)
        page.locator("#authModal.wechat-login-mode").wait_for(state="visible")
        if touch:
            page.locator(".wechat-login-copy").get_by_text("手机登录", exact=True).wait_for()
            assert not page.locator(".wechat-login-qr iframe").count()
            assert not oauth_requests, "Mobile guidance must not request a self-scan QR"
            report["wechat_mode"] = "mobile-guidance"
        else:
            iframe = page.locator(".wechat-login-qr iframe")
            iframe.wait_for(state="attached")
            frame = page.frame_locator(".wechat-login-qr iframe")
            frame.locator("[data-frame-bottom]").wait_for()
            intrinsic = iframe.evaluate("element=>({width:element.clientWidth,height:element.clientHeight})")
            assert intrinsic == {"width": 300, "height": 400}, ("WeChat iframe layout viewport changed", intrinsic)
            qr = frame.locator("[data-qr-square]").bounding_box()
            assert abs(qr["width"] - qr["height"]) < 1, "QR square was distorted"
            assert abs(qr["width"] - 224) < 1, "The conservative QR must retain its 0.8 scale"
            reach(page, ".wechat-login-qr iframe", report, touch)
            # A real scan requires the whole QR at once. Seeing the frame's top
            # and bottom on separate scroll positions is insufficient proof.
            for _ in range(20):
                qr = frame.locator("[data-qr-square]").bounding_box()
                clip = state(page, ".wechat-login-qr iframe")["clip"]
                assert qr["x"] >= clip["left"] - 1 and qr["x"] + qr["width"] <= clip["right"] + 1, (
                    "QR is horizontally clipped", qr, clip)
                if qr["y"] >= clip["top"] - 1 and qr["y"] + qr["height"] <= clip["bottom"] + 1:
                    report["complete_qr_visible"] = True
                    report["qr_visible_geometry"] = {"rect": qr, "clip": clip, "iframe_layout": intrinsic}
                    if height == 320 or width == 320:
                        page.screenshot(path=str(args.output / f"{route.strip('/').replace('.', '-')}-{width}x{height}-complete-qr.png"))
                    break
                delta = qr["y"] - clip["top"] if qr["y"] < clip["top"] else qr["y"] + qr["height"] - clip["bottom"]
                before = scroll_positions(page)
                scroll_input(page, -1 if delta < 0 else 1, touch, min(160, max(8, abs(delta))))
                after = scroll_positions(page)
                report["scrolls"].append({"target": "complete-qr", "input": "wheel", "changed": before != after,
                                          "before": before, "after": after})
                assert before != after, "Natural scroll cannot reveal the complete QR"
            else:
                raise AssertionError("Complete QR remains clipped after natural scrolling")
            # Both iframe edges must be reachable, even when it cannot fit at once.
            for edge, direction in (("top", -1), ("bottom", 1)):
                for _ in range(12):
                    box = iframe.bounding_box()
                    current = state(page, ".wechat-login-qr iframe")
                    y = box["y"] + (1 if edge == "top" else box["height"] - 1)
                    if current["clip"]["top"] <= y <= current["clip"]["bottom"]:
                        break
                    before = scroll_positions(page)
                    scroll_input(page, direction, touch)
                    after = scroll_positions(page)
                    report["scrolls"].append({"target": "iframe-" + edge, "input": "wheel",
                                              "changed": before != after, "before": before, "after": after})
                    assert before != after, f"Cannot naturally reach iframe {edge}"
                else:
                    raise AssertionError(f"QR iframe {edge} remains clipped")
            assert len(oauth_requests) == 1
            assert oauth_requests[0].response().ok
            report["wechat_mode"] = "official-api-with-external-iframe-fixture"
            report["qr_square"] = {"width": qr["width"], "height": qr["height"]}
        click(page, ".wechat-login-back", report, touch)
        page.wait_for_function("!document.getElementById('authModal').classList.contains('wechat-login-mode')")
        click(page, "#authCloseBtn", report, touch)
        page.locator("#authModal").wait_for(state="hidden")
        open_dialog(page, report, touch)
        page.keyboard.press("Escape")
        page.locator("#authModal").wait_for(state="hidden")
        open_dialog(page, report, touch)
        fill(page, "#authUsername", args.username, report, touch)
        fill(page, "#authPassword", args.password, report, touch)
        if not page.locator("#authLegalConsent").is_checked():
            click(page, "#authLegalConsent", report, touch)
        with page.expect_response(lambda response: urlparse(response.url).path == "/api/v1/auth/login") as success:
            click(page, "#authDoLoginBtn", report, touch)
        assert success.value.status == 200
        page.locator("#authModal").wait_for(state="hidden")
        page.wait_for_function("!!KGAuthCore.currentUser()")
        assert context.request.get(args.base_url + "/api/v1/auth/me").json()["user"]["username"] == args.username
        assert login_requests[-1].post_data_json["acceptedTermsVersion"] == LEGAL_VERSION
        report["valid_password_status"] = success.value.status
        phone_graph = bool(page.locator("body.graph-phone-reading").count())
        if page.evaluate("!!window.KGLearningEntryChooser"):
            page.locator("#learningEntryModal.show").wait_for(state="visible")
            if phone_graph:
                # The phone graph has no account toolbar; use a real learning
                # destination that has one, then verify the original route too.
                page.locator('[data-learning-entry-choice][data-destination="knowledge-recall.html"]').click()
                page.wait_for_url("**/knowledge-recall.html")
                prepare_page(page, report)
                report["logout_via"] = "/knowledge-recall.html"
            else:
                page.locator("#learningEntryDismissBtn").click()
        if page.locator(".tour-skip:visible").count():
            page.locator(".tour-skip").click()
        page.locator("[data-account-menu-trigger]").first.click()
        with page.expect_response(lambda response: urlparse(response.url).path == "/api/v1/auth/logout") as logout:
            page.locator("#accountMenuSessionBtn").click()
        assert logout.value.ok
        page.wait_for_function("!KGAuthCore.currentUser()")
        assert context.request.get(args.base_url + "/api/v1/auth/me").json().get("user") is None
        if phone_graph:
            page.goto(args.base_url + route, wait_until="domcontentloaded")
            prepare_page(page, report)
            page.wait_for_function("!KGAuthCore.currentUser()")
        assert any(item["changed"] for item in report["scrolls"])
        report["source_styles"] = sorted(seen)
        if args.source:
            assert "styles/dialogs.css" in seen, "Actual shared-dialog CSS was not overlaid"
        report["passed"] = True
    except Exception as error:
        report["error"] = str(error)
        report["source_styles"] = sorted(seen)
        try:
            report["failure_login"] = state(page, "#authDoLoginBtn")
            page.screenshot(path=str(args.output / f"{route.strip('/').replace('.', '-')}-{width}x{height}-failure.png"))
        except Exception:
            pass
    finally:
        context.close()
    return report


def desktop_baseline(browser, args):
    results = []
    for overlay in ([False, True] if args.source else [False]):
        context, _ = new_context(browser, args, 1440, 1000, overlay=overlay)
        try:
            page = context.new_page()
            page.goto(args.base_url + "/graph", wait_until="domcontentloaded")
            prepare_page(page, {"scrolls": []})
            open_dialog(page, {"scrolls": []})
            geometry = {selector: page.locator(selector).bounding_box() for selector in
                        (".auth-modal", ".auth-head", "#authUsername", "#authPassword", "#authDoLoginBtn", "#authLegalConsent")}
            page.screenshot(path=str(args.output / ("desktop-source.png" if overlay else "desktop-served.png")))
            results.append({"source": overlay, "geometry": geometry})
        finally:
            context.close()
    if len(results) == 2:
        for selector, before in results[0]["geometry"].items():
            after = results[1]["geometry"][selector]
            assert all(abs(before[key] - after[key]) <= 1 for key in before), (
                "Normal desktop authentication geometry changed", selector, before, after)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--source", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/auth-dialog-small-window")
    parser.add_argument("--username", default="ink-browser")
    parser.add_argument("--password", default="ink-browser-test")
    parser.add_argument("--admin-username", default="ink-admin")
    parser.add_argument("--admin-password", default="ink-browser-test")
    parser.add_argument("--pages", nargs="+", default=PAGES)
    parser.add_argument("--viewports", nargs="+", help="Optional focused diagnostic, e.g. 970x530")
    args = parser.parse_args()
    args.base_url = args.base_url.rstrip("/")
    assert urlparse(args.base_url).hostname == "127.0.0.1", "Disposable local fixture only"
    args.output.mkdir(parents=True, exist_ok=True)
    viewports = [tuple(map(int, value.split("x"))) for value in args.viewports] if args.viewports else VIEWPORTS
    summary = {"source": args.source, "cases": []}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            configure_wechat(browser, args)
            summary["desktop_baseline"] = desktop_baseline(browser, args)
            for route in args.pages:
                for width, height in viewports:
                    result = exercise(browser, args, route, width, height)
                    summary["cases"].append(result)
                    print(f"{route} {width}x{height}: {'PASS' if result['passed'] else 'FAIL ' + result['error']}", flush=True)
                    (args.output / "results.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
        finally:
            browser.close()
    assert all(case["passed"] for case in summary["cases"]), "Authentication viewport matrix failed; see results.json"
    print(f"AUTH_DIALOG_VIEWPORT_OK ({len(summary['cases'])} cases)")


if __name__ == "__main__":
    main()
