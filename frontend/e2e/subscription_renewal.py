"""Exercise expired memberships through real browser checkout controls.

Use dedicated, already-expired student accounts: creating an order invalidates
that account's older pending orders on the server. This script never pays,
activates membership, changes accounts, or changes payment configuration.

Private accounts JSON (keep it untracked and mode 600)::

  {"baseUrl": "https://your-uat-host", "accounts": [
    {"planId": "monthly", "username": "...", "password": "..."},
    {"planId": "quarterly", "username": "...", "password": "..."},
    {"planId": "half_year", "username": "...", "password": "..."}
  ]}

Usage (the system Python already has Playwright)::

  python3 frontend/e2e/subscription_renewal.py \
    --base-url http://127.0.0.1:5173 --accounts-file artifacts/private-accounts.json \
    --output-dir artifacts/subscription-renewal

Add --expect-unavailable when UAT intentionally has no payment credentials.
That mode still posts to the real order API and checks failed/cancelled orders,
visible errors, unlocked buttons, retries, and unchanged subscription state.
Default mode requires a real QR image GET and a loaded, visible image. Both modes
cover six isolated contexts (three plans, desktop home and mobile practice), one
injected HTTP 503, and switching away from and back to the original plan. The
mobile home is read-only and has no account entry, so it is outside this matrix.

Only this run's pending orders are self-cancelled before each context closes.
Screenshots mask QR images; no passwords, cookies, codeUrl, or payment tokens
are written to the report. TLS verification uses Playwright's normal defaults.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
from urllib.parse import quote, urljoin, urlsplit

from playwright.sync_api import expect, sync_playwright


WORKSPACE = Path(__file__).resolve().parents[2]
PLAN_IDS = ("monthly", "quarterly", "half_year")
LEGAL_VERSION = "2026-08-13-v1"
HTTP_503_MESSAGE = "支付服务暂时不可用，请重试。"
NO_QR_MESSAGE = "支付二维码生成失败，请重试。"
ORDERS_PATH = "/api/v1/subscriptions/orders"
MODAL = "#userSubscriptionDetailModal.show"


class RegressionFailure(Exception):
    """An intentionally safe error message, without server payloads or secrets."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RegressionFailure(message)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", help="Local/UAT origin; overrides accounts JSON baseUrl")
    parser.add_argument("--accounts-file", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=Path("artifacts/subscription-renewal"))
    parser.add_argument("--expect-unavailable", action="store_true", help="Expect real orders without a QR because payment is unconfigured")
    parser.add_argument("--fail-fast", action="store_true", help="Stop after the first failing context (useful when reproducing an old release)")
    parser.add_argument("--timeout-ms", type=int, default=30000)
    return parser.parse_args()


def load_inputs(args: argparse.Namespace) -> tuple[str, list[dict], Path]:
    try:
        payload = json.loads(args.accounts_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise RegressionFailure("Accounts file is unreadable or is not valid JSON") from None
    config = payload if isinstance(payload, dict) else {}
    accounts = config.get("accounts", payload if isinstance(payload, list) else None)
    require(isinstance(accounts, list) and len(accounts) == 3, "Supply exactly three expired test accounts")
    require(all(isinstance(account, dict) for account in accounts), "Each account must be an object")
    require({account.get("planId") for account in accounts} == set(PLAN_IDS), "Supply one account for each finite paid plan")
    for account in accounts:
        require(all(isinstance(account.get(key), str) and account[key].strip() for key in ("username", "password")), "Each account needs a username and password")
    require(len({account["username"] for account in accounts}) == 3, "Use three distinct test accounts")
    base_url = args.base_url or config.get("baseUrl")
    require(isinstance(base_url, str) and bool(base_url), "Supply --base-url or accounts JSON baseUrl")
    parsed = urlsplit(base_url)
    require(parsed.scheme in {"http", "https"} and bool(parsed.hostname), "Base URL must be an HTTP(S) origin")
    require(not parsed.username and not parsed.password and not parsed.query and not parsed.fragment and parsed.path in {"", "/"}, "Base URL must contain only the origin, without credentials or query parameters")
    require(args.timeout_ms > 0, "Timeout must be positive")
    output_dir = args.output_dir.expanduser()
    if not output_dir.is_absolute():
        output_dir = WORKSPACE / output_dir
    output_dir = output_dir.resolve()
    require(output_dir.is_relative_to(WORKSPACE / "artifacts"), "Output directory must be inside this workspace's artifacts directory")
    output_dir.mkdir(parents=True, exist_ok=True)
    ordered = sorted(accounts, key=lambda account: PLAN_IDS.index(account["planId"]))
    return base_url.rstrip("/"), ordered, output_dir


def subscription_snapshot(context, base_url: str) -> dict:
    response = context.request.get(base_url + "/api/v1/subscriptions/me")
    require(response.ok, "Could not read the account's subscription")
    payload = response.json()
    require(isinstance(payload.get("subscription"), dict), "Subscription response is missing its record")
    return payload


def assert_expired(snapshot: dict, account: dict) -> None:
    subscription = snapshot["subscription"]
    require(subscription.get("username") == account["username"], "Subscription belongs to a different account")
    require(subscription.get("planId") == account["planId"], "Test account has the wrong plan")
    try:
        expires_at = datetime.fromisoformat(str(subscription.get("expiresAt", "")).replace("Z", "+00:00"))
    except ValueError:
        raise RegressionFailure("Test account needs a finite expiry date") from None
    require(expires_at.tzinfo is not None and expires_at < datetime.now(timezone.utc), "Test membership is not expired")
    require(subscription.get("status") in {"active", "trial", "manual", "expired"}, "Use an expired membership, rather than a suspended or cancelled account")
    require(snapshot.get("entitlements", {}).get("allExamPapers") is False, "Expired membership unexpectedly has paid entitlements")


def assert_unchanged(context, base_url: str, baseline: dict) -> None:
    require(subscription_snapshot(context, base_url) == baseline, "Unpaid order changed subscription or entitlements")


def dismiss_onboarding(page) -> None:
    chooser = page.locator("#learningEntryModal")
    if chooser.count() and chooser.is_visible():
        chooser.locator('[data-learning-entry-choice="知识图谱"]').click()
        expect(chooser).to_be_hidden()
    tour = page.locator("#guidedTourLayer.show")
    if tour.count() and tour.is_visible():
        tour.locator(".tour-skip").click()
        expect(tour).to_be_hidden()


def open_membership(page, base_url: str, entry: str, account: dict) -> None:
    path = "/index.html?mode=free" if entry == "index" else "/practice-mode.html"
    page.goto(base_url + path, wait_until="networkidle")
    dismiss_onboarding(page)
    def click_entry() -> None:
        if entry == "index" and page.locator("#upgradeMemberBtn").is_visible():
            page.locator("#upgradeMemberBtn").click()
        else:
            # Mobile home hides the toolbar upgrade button. Practice reaches
            # the shared modal through its lazily loaded user center.
            page.locator("#authStatus").click()
            if entry == "index":
                page.locator("#accountMenuUpgradeBtn").click()
            else:
                page.locator("#accountMenuUserCenterBtn").click()
                expect(page.locator("#userCenterModal.show")).to_be_visible()
                page.locator("#ucSubscriptionRenewBtn").click()

    click_entry()
    expect(page.locator(MODAL + " .plans-grid")).to_be_visible()
    page.wait_for_function("""expected => {
      const subscription = window.KGSubscription?.currentSubscription?.();
      return subscription?.planId === expected.planId && subscription.status === 'expired';
    }""", arg={"planId": account["planId"]})
    page.wait_for_load_state("networkidle")
    # The first lazy render may precede the server subscription hydration.
    # Reopening through ordinary controls tests the persisted expired plan,
    # rather than accidentally testing the temporary default-free plan.
    page.locator("#userSubscriptionDetailCloseBtn").click()
    expect(page.locator(MODAL)).to_have_count(0)
    click_entry()
    expect(page.locator(MODAL + " .plans-grid")).to_be_visible()


def plan_button(page, plan_id: str):
    button = page.locator(f'{MODAL} .plan-card[data-plan-id="{plan_id}"] button[data-buy-plan="{plan_id}"]')
    expect(button).to_be_visible()
    expect(button).to_be_enabled()
    return button


def assert_buttons_unlocked(page) -> None:
    page.wait_for_function("""() => {
      const buttons = [...document.querySelectorAll('#userSubscriptionDetailModal.show [data-buy-plan]')];
      return buttons.length > 0 && buttons.every(button => !button.disabled && button.getAttribute('aria-disabled') !== 'true');
    }""")


def assert_error(page, message: str) -> None:
    alert = page.locator(MODAL + " #membershipPaymentMsg")
    expect(alert).to_be_visible()
    expect(alert).to_have_text(message)
    assert_buttons_unlocked(page)


def is_order_response(response, base_url: str) -> bool:
    return response.request.method == "POST" and response.url == base_url + ORDERS_PATH


def inject_one_503(page, base_url: str, plan_id: str, result: dict) -> None:
    route_url = base_url + ORDERS_PATH
    intercepted = []

    def fail_once(route) -> None:
        if route.request.method != "POST" or intercepted:
            route.continue_()
            return
        intercepted.append(route.request.post_data_json.get("planId"))
        route.fulfill(status=503, content_type="application/json", body=json.dumps({"detail": HTTP_503_MESSAGE}))

    page.route(route_url, fail_once)
    try:
        with page.expect_response(lambda response: is_order_response(response, base_url)) as pending:
            plan_button(page, plan_id).click()
        require(pending.value.status == 503 and intercepted == [plan_id], "The single 503 did not target the selected checkout request")
        assert_error(page, HTTP_503_MESSAGE)
        result["injectedHttp503"] = True
    finally:
        page.unroute(route_url, fail_once)


def select_plan(page, context, base_url: str, plan_id: str, baseline: dict,
                result: dict, qr_responses: dict, unavailable: bool) -> str:
    with page.expect_response(lambda response: is_order_response(response, base_url)) as pending:
        plan_button(page, plan_id).click()
    response = pending.value
    require(response.request.post_data_json.get("planId") == plan_id, "Order POST used a different plan")
    require(response.ok, "Real order API returned an HTTP error")
    payload = response.json()
    order = payload.get("order") or {}
    order_id = order.get("id")
    require(isinstance(order_id, str) and bool(order_id), "Order API returned no order ID")
    require(order.get("planId") == plan_id, "Order API returned a different plan")
    require(order_id not in result["checkedOrderIds"], "Changing/retrying a plan reused a previous order")
    result["checkedOrderIds"].append(order_id)
    if unavailable:
        require(order.get("status") == "cancelled" and order.get("payStatus") == "failed" and not order.get("codeUrl"), "Expected an unavailable payment order without a QR")
        assert_error(page, NO_QR_MESSAGE)
        expect(page.locator(MODAL + " .kg-native-pay-qr")).to_have_count(0)
    else:
        require(order.get("status") == "pending" and order.get("payStatus") == "pending" and bool(order.get("codeUrl")), "Real payment order has no pending QR checkout")
        checkout = page.locator(MODAL + " .membership-checkout")
        expect(checkout).to_be_visible()
        expect(checkout.locator(".checkout-plan-name")).to_have_text(order["planName"])
        expect(page.locator(f'{MODAL} .plan-card.checkout-selected[data-plan-id="{plan_id}"]')).to_have_count(1)
        image = checkout.locator(".kg-native-pay-qr")
        expect(image).to_be_visible()
        expected_qr_url = base_url + ORDERS_PATH + "/" + quote(order_id, safe="") + "/qrcode"
        require(urljoin(page.url, image.get_attribute("src") or "") == expected_qr_url, "Checkout QR belongs to a different order")
        page.wait_for_function("""() => {
          const image = document.querySelector('#userSubscriptionDetailModal.show .kg-native-pay-qr');
          return !!image && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
        }""")
        qr_get = qr_responses.get(order_id, {})
        require(qr_get.get("status") == 200 and qr_get.get("image") and not qr_get.get("serviceWorker"), "QR image did not complete a successful real browser GET")
        result["realQrImagesLoaded"] += 1
        assert_buttons_unlocked(page)
    assert_unchanged(context, base_url, baseline)
    return order_id


def capture_screenshot(page, output_dir: Path, case_id: str, suffix: str) -> str:
    name = f"{case_id}-{suffix}.png"
    page.screenshot(path=str(output_dir / name), full_page=False, mask=[page.locator(
        ".kg-native-pay-qr,#authStatus,#ucUsername,#ucDisplayName,#ucEmail,#ucPhone,"
        "#ucReferralCode,#ucReferralLink,input[type=password]"
    )])
    return name


def cleanup_orders(context, base_url: str, created_order_ids: set[str]) -> list[dict]:
    cleanup = []
    for order_id in sorted(created_order_ids):
        prefix = base_url + ORDERS_PATH + "/" + quote(order_id, safe="")
        status = context.request.get(prefix + "/status")
        require(status.ok, "Could not read this run's order for cleanup")
        order = status.json()
        require(order.get("payStatus") != "paid" and order.get("status") != "approved", "An order was paid outside this script; cleanup stopped")
        if order.get("status") == "pending" and order.get("payStatus") in {None, "pending"}:
            cancelled = context.request.post(prefix + "/self-cancel")
            require(cancelled.ok and cancelled.json().get("order", {}).get("status") == "cancelled", "Self-cancel failed for this run's pending order")
            cleanup.append({"orderId": order_id, "action": "self-cancelled"})
        else:
            cleanup.append({"orderId": order_id, "action": "already-processed"})
    return cleanup


def run_case(browser, base_url: str, account: dict, entry: str, mobile: bool,
             extended: bool, args: argparse.Namespace, output_dir: Path) -> dict:
    case_id = f"{account['planId']}-{entry}-{'mobile' if mobile else 'desktop'}"
    result = {"case": case_id, "planId": account["planId"], "entry": entry,
              "viewport": "mobile" if mobile else "desktop", "status": "running",
              "phase": "login", "injectedHttp503": False, "realQrImagesLoaded": 0,
              "checkedOrderIds": [], "orders": [], "cleanup": []}
    context = browser.new_context(viewport={"width": 390, "height": 844} if mobile else {"width": 1440, "height": 1000}, is_mobile=mobile, has_touch=mobile)
    context.set_default_timeout(args.timeout_ms)
    context.set_default_navigation_timeout(args.timeout_ms)
    created_order_ids: set[str] = set()
    qr_responses: dict = {}
    page = None
    baseline = None

    def observe_response(response) -> None:
        if is_order_response(response, base_url) and response.ok:
            try:
                order = response.json().get("order") or {}
            except (ValueError, TypeError):
                return
            if isinstance(order.get("id"), str) and order["id"] not in created_order_ids:
                created_order_ids.add(order["id"])
                result["orders"].append({key: order.get(key) for key in ("id", "planId", "status", "payStatus")})
        parsed = urlsplit(response.url)
        match = re.fullmatch(r"/api/v1/subscriptions/orders/([^/]+)/qrcode", parsed.path)
        if match and response.request.method == "GET" and parsed.netloc == urlsplit(base_url).netloc:
            qr_responses[match.group(1)] = {"status": response.status, "image": response.headers.get("content-type", "").startswith("image/"), "serviceWorker": response.from_service_worker}

    try:
        login = context.request.post(base_url + "/api/v1/auth/login", data={
            "username": account["username"], "password": account["password"],
            "acceptedTermsVersion": LEGAL_VERSION,
        })
        require(login.ok, "Test-account login failed")
        user = login.json().get("user") or {}
        require(user.get("username") == account["username"] and user.get("role") == "student", "Use the expected student test account")
        baseline = subscription_snapshot(context, base_url)
        assert_expired(baseline, account)
        result["initialSubscription"] = {key: baseline["subscription"].get(key) for key in ("planId", "status", "startedAt", "expiresAt")}
        page = context.new_page()
        page.on("response", observe_response)
        result["phase"] = "visible-membership-entry"
        open_membership(page, base_url, entry, account)
        result["phase"] = "expired-same-plan-enabled"
        plan_button(page, account["planId"])
        if extended:
            result["phase"] = "http-503-button-recovery"
            inject_one_503(page, base_url, account["planId"], result)
            result["recoveryScreenshot"] = capture_screenshot(page, output_dir, case_id, "503-recovered")
            assert_unchanged(context, base_url, baseline)
        result["phase"] = "real-same-plan-order"
        select_plan(page, context, base_url, account["planId"], baseline, result, qr_responses, args.expect_unavailable)
        if args.expect_unavailable:
            result["phase"] = "real-unavailable-order-retry"
            select_plan(page, context, base_url, account["planId"], baseline, result, qr_responses, True)
        if extended:
            other_plan = next(plan_id for plan_id in PLAN_IDS if plan_id != account["planId"])
            for phase, plan_id in (("switch-other-plan", other_plan), ("return-original-plan", account["planId"])):
                result["phase"] = phase
                select_plan(page, context, base_url, plan_id, baseline, result, qr_responses, args.expect_unavailable)
        result["screenshot"] = capture_screenshot(page, output_dir, case_id, "checkout")
        result["subscriptionUnchanged"] = True
        result["status"] = "passed"
    except Exception as error:
        result["status"] = "failed"
        # Raw Playwright exceptions and server payloads can contain URLs or
        # credentials. The phase plus a masked screenshot is the safe diagnostic.
        result["error"] = str(error) if isinstance(error, RegressionFailure) else type(error).__name__
        if page and not page.is_closed():
            try:
                result["screenshot"] = capture_screenshot(page, output_dir, case_id, "failed")
            except Exception:
                result["screenshotUnavailable"] = True
    finally:
        if page and not page.is_closed():
            page.close()
        try:
            result["cleanup"] = cleanup_orders(context, base_url, created_order_ids)
            if baseline is not None:
                assert_unchanged(context, base_url, baseline)
        except Exception as error:
            result["status"] = "failed"
            result["cleanupError"] = str(error) if isinstance(error, RegressionFailure) else type(error).__name__
        context.close()
    if result["status"] == "passed":
        result["phase"] = "complete"
    return result


def main() -> int:
    args = parse_args()
    try:
        base_url, accounts, output_dir = load_inputs(args)
    except RegressionFailure as error:
        print(f"subscription-renewal: {error}", file=sys.stderr)
        return 2
    report = {"baseUrl": base_url, "mode": "real-payment-unavailable" if args.expect_unavailable else "real-qr-checkout",
              "fixtureCheckout": False, "startedAt": datetime.now(timezone.utc).isoformat(),
              "paymentActivationAttempted": False, "cases": []}
    exit_code = 0
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                for index, account in enumerate(accounts):
                    for entry in ("index", "practice"):
                        result = run_case(browser, base_url, account, entry, entry == "practice",
                                          index == 0 and entry == "index", args, output_dir)
                        report["cases"].append(result)
                        print(f"{result['status'].upper()}: {result['case']} phase={result['phase']}", flush=True)
                        if result["status"] != "passed":
                            exit_code = 1
                        (output_dir / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                        if args.fail_fast and exit_code:
                            break
                    if args.fail_fast and exit_code:
                        break
            finally:
                browser.close()
    except Exception as error:
        report["runtimeError"] = type(error).__name__
        exit_code = 1
    report["finishedAt"] = datetime.now(timezone.utc).isoformat()
    report["status"] = "passed" if exit_code == 0 and len(report["cases"]) == 6 else "failed"
    (output_dir / "results.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"subscription-renewal: {report['status'].upper()} mode={report['mode']} report={output_dir / 'results.json'}")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
