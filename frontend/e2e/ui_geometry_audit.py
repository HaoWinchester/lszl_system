"""Audit visual grouping and control-content centering across new-legacy pages.

The audit intentionally excludes menu and list rows because their text is
semantically start-aligned. Every other selected visible control must center
its text and inline icon group inside its own hit target within four CSS pixels.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright


PAGES = [
    ("index", "/index.html?mode=free", ".app"),
    ("learning-path", "/learning-path.html", ".gl-app"),
    ("question-training", "/question-training.html", ".question-training-app"),
    ("question-workspace", "/question-workspace.html", ".qw-app"),
    ("file-manager", "/file-manager.html", ".fm-app"),
    ("question-bank", "/question-bank.html", ".qb-app"),
    ("knowledge-recall", "/knowledge-recall.html", ".kr-app"),
    ("user-management", "/user-management.html", ".um-app"),
    ("system-settings", "/system-settings.html", ".ss-app"),
]
VIEWPORTS = {
    "mobile": {"width": 390, "height": 844},
    "mid": {"width": 944, "height": 768},
    "desktop": {"width": 1440, "height": 900},
}
CENTERED_SELECTOR = ", ".join(
    [
        "button",
        ".auth-status",
        ".qt-nav-btn",
        ".um-nav-btn",
        ".qw-tool-btn",
        ".qw-overlay-right button",
        ".fm-avatar",
        ".gl-mode-nav a",
        ".learning-mode-entry",
    ]
)
EXCLUDED_SELECTOR = ", ".join(
    [
        "[role='menuitem']",
        ".account-menu-item",
        ".fm-account-menu > *",
        ".qw-question-item",
        ".qt-question-list-item",
        ".qb-question-row",
        ".um-user-row",
        ".kr-question-card",
        ".q-option",
        ".fm-nav-item",
        ".fm-folder-tree-static",
        ".qt-workflow-step",
        ".qt-teacher-menu-panel .qt-nav-btn",
        "[data-geometry-align='start']",
    ]
)
DISABLE_MOTION = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}"

GEOMETRY_SCRIPT = """
({ selector, excluded, tolerance }) => {
  const visible = element => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0
  }
  const union = rects => {
    if (!rects.length) return null
    const left = Math.min(...rects.map(rect => rect.left))
    const top = Math.min(...rects.map(rect => rect.top))
    const right = Math.max(...rects.map(rect => rect.right))
    const bottom = Math.max(...rects.map(rect => rect.bottom))
    return { left, top, right, bottom, width: right - left, height: bottom - top }
  }
  const contentRect = control => {
    const rects = []
    const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue
      const parent = node.parentElement
      if (!parent || !visible(parent)) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) rects.push(rect)
    }
    for (const element of control.querySelectorAll('svg,img,canvas,.role-dot')) {
      if (!visible(element) || getComputedStyle(element).position === 'absolute') continue
      const rect = element.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) rects.push(rect)
    }
    // 用户中心会为状态胶囊附加一个 CSS 三角箭头。它也是按钮内容的一部分，
    // 但 Range 无法拿到伪元素的矩形；按其已知的流式 margin/border 尺寸补入。
    if (control.matches('.auth-status') && rects.length) {
      const after = getComputedStyle(control, '::after')
      const marginLeft = parseFloat(after.marginLeft) || 0
      const pseudoWidth = (parseFloat(after.width) || 0)
        + (parseFloat(after.borderLeftWidth) || 0)
        + (parseFloat(after.borderRightWidth) || 0)
      const pseudoHeight = (parseFloat(after.height) || 0)
        + (parseFloat(after.borderTopWidth) || 0)
        + (parseFloat(after.borderBottomWidth) || 0)
      if (after.display !== 'none' && after.visibility !== 'hidden' && pseudoWidth > 0 && pseudoHeight > 0) {
        const current = union(rects)
        const box = control.getBoundingClientRect()
        rects.push({
          left: current.right + marginLeft,
          right: current.right + marginLeft + pseudoWidth,
          top: (box.top + box.bottom - pseudoHeight) / 2,
          bottom: (box.top + box.bottom + pseudoHeight) / 2,
          width: pseudoWidth,
          height: pseudoHeight,
        })
      }
    }
    return union(rects)
  }
  const selectorFor = control => {
    if (control.id) return `#${CSS.escape(control.id)}`
    const classes = [...control.classList].slice(0, 3).map(name => `.${CSS.escape(name)}`).join('')
    return `${control.tagName.toLowerCase()}${classes}`
  }
  const failures = []
  const audited = []
  for (const control of document.querySelectorAll(selector)) {
    if (!visible(control) || control.closest(excluded)) continue
    const controlRect = control.getBoundingClientRect()
    const visualRect = contentRect(control)
    if (!visualRect) continue
    const deltaX = (visualRect.left + visualRect.right) / 2 - (controlRect.left + controlRect.right) / 2
    const deltaY = (visualRect.top + visualRect.bottom) / 2 - (controlRect.top + controlRect.bottom) / 2
    const entry = {
      selector: selectorFor(control),
      text: control.innerText.trim().replace(/\\s+/g, ' ').slice(0, 80),
      deltaX: Number(deltaX.toFixed(2)),
      deltaY: Number(deltaY.toFixed(2)),
      controlRect: { left: controlRect.left, top: controlRect.top, width: controlRect.width, height: controlRect.height },
      contentRect: visualRect,
    }
    audited.push(entry)
    if (Math.abs(deltaX) > tolerance || Math.abs(deltaY) > tolerance) failures.push(entry)
  }
  return { audited, failures }
}
"""


def audit_page(page: Page, page_name: str, path: str, ready: str, viewport_name: str, output: Path, tolerance: float) -> dict:
    page.goto(path, wait_until="networkidle")
    page.locator(ready).wait_for(state="visible")
    page.add_style_tag(content=DISABLE_MOTION)
    page.wait_for_timeout(120)
    result = page.evaluate(
        GEOMETRY_SCRIPT,
        {"selector": CENTERED_SELECTOR, "excluded": EXCLUDED_SELECTOR, "tolerance": tolerance},
    )
    record = {"page": page_name, "viewport": viewport_name, **result}
    if result["failures"]:
        page.screenshot(path=str(output / f"{page_name}-{viewport_name}.png"), full_page=False)
    return record


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:5173")
    parser.add_argument("--output", default="/tmp/ui-geometry-audit")
    parser.add_argument("--tolerance", type=float, default=4.0)
    parser.add_argument("--allow-failures", action="store_true")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    records: list[dict] = []

    with sync_playwright() as playwright:
        browser: Browser = playwright.chromium.launch(headless=True)
        try:
            for viewport_name, viewport in VIEWPORTS.items():
                context = browser.new_context(viewport=viewport)
                page = context.new_page()
                for page_name, path, ready in PAGES:
                    record = audit_page(page, page_name, args.base_url.rstrip("/") + path, ready, viewport_name, output, args.tolerance)
                    records.append(record)
                    print(f"geometry: {page_name}/{viewport_name} audited={len(record['audited'])} failures={len(record['failures'])}", flush=True)
                context.close()
        finally:
            browser.close()

    report = {"tolerance": args.tolerance, "records": records}
    (output / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    failures = [failure for record in records for failure in record["failures"]]
    print(f"geometry: total-failures={len(failures)} report={output / 'report.json'}", flush=True)
    return 0 if args.allow_failures or not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
