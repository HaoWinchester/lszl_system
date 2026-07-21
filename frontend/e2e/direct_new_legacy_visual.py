import argparse
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright


CASES = [
    ("learning", "/", "/learning-path.html", ".gl-app"),
    ("free", "/index.html?mode=free", "/index.html?mode=free", ".app"),
]
VIEWPORTS = {
    "desktop": {"width": 1440, "height": 900},
    "mobile": {"width": 390, "height": 844},
}
DISABLE_MOTION = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}"


def difference_ratio(left_path: Path, right_path: Path, threshold: int = 20) -> float:
    left = Image.open(left_path).convert("RGB")
    right = Image.open(right_path).convert("RGB")
    assert left.size == right.size, (left.size, right.size)
    left_pixels = left.load()
    right_pixels = right.load()
    different = 0
    for y in range(left.height):
        for x in range(left.width):
            if max(abs(a - b) for a, b in zip(left_pixels[x, y], right_pixels[x, y])) > threshold:
                different += 1
    return different / (left.width * left.height)


parser = argparse.ArgumentParser()
parser.add_argument("--integrated", default="http://127.0.0.1:5173")
parser.add_argument("--raw", default="http://127.0.0.1:8011")
parser.add_argument("--output", default="/tmp/new-legacy-visual")
args = parser.parse_args()
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        for viewport_name, viewport in VIEWPORTS.items():
            for case_name, integrated_path, raw_path, selector in CASES:
                paths = []
                stylesheets = []
                for label, base, path in [
                    ("integrated", args.integrated.rstrip("/"), integrated_path),
                    ("raw", args.raw.rstrip("/"), raw_path),
                ]:
                    context = browser.new_context(viewport=viewport)
                    page = context.new_page()
                    page.goto(base + path, wait_until="networkidle")
                    page.locator(selector).wait_for(state="visible")
                    page.add_style_tag(content=DISABLE_MOTION)
                    page.wait_for_timeout(150)
                    assert page.locator("iframe").count() == 0
                    stylesheets.append(
                        page.evaluate(
                            "Array.from(document.querySelectorAll('link[rel=stylesheet]')).map(link => new URL(link.href).pathname.split('/').pop())"
                        )
                    )
                    screenshot = output / f"{case_name}-{viewport_name}-{label}.png"
                    page.screenshot(path=str(screenshot), full_page=False)
                    paths.append(screenshot)
                    context.close()

                assert stylesheets[0] == stylesheets[1], (case_name, viewport_name, stylesheets)
                ratio = difference_ratio(paths[0], paths[1])
                assert ratio <= 0.01, f"{case_name}/{viewport_name} visual difference {ratio:.3%}"
                print(f"visual: {case_name}/{viewport_name} difference={ratio:.3%}", flush=True)
    finally:
        browser.close()
