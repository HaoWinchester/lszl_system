#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from urllib.parse import urljoin

from playwright.sync_api import sync_playwright


PAGES = {
    'practice': (
        '/practice-mode.html',
        [
            '.practice-header',
            '.practice-main',
            '.practice-setup-card',
            '.practice-mode-grid',
            '.practice-mode-card.challenge',
            '.practice-mode-card.scholar',
        ],
    )
}
VIEWPORTS = [(1440, 900), (1366, 768), (390, 844)]
GEOMETRY_PROPERTIES = ('x', 'y', 'width', 'height')
MAX_GEOMETRY_DELTA = 4.0
LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
DISABLE_MOTION_CSS = '''
*, *::before, *::after {
  animation-delay: 0s !important;
  animation-duration: 0s !important;
  scroll-behavior: auto !important;
  transition-delay: 0s !important;
  transition-duration: 0s !important;
}
'''
PUBLISHED_PAPERS = [
    {
        'id': 'focus-vega-release-1',
        'paperId': 'focus-vega-paper-1',
        'version': 1,
        'name': 'Focus / Vega 视觉验收试卷',
        'subject': 'PMP',
        'status': 'published',
        'publishedAt': 1,
        'questions': [
            {'bankId': 'b1', 'questionId': f'q{index}', 'order': index}
            for index in range(1, 21)
        ],
        'questionSnapshots': [
            {
                'bankId': 'b1',
                'bankName': '视觉验收题库',
                'bankSubject': 'PMP',
                'questionId': f'q{index}',
                'question': {
                    'id': f'q{index}',
                    'title': f'题目 {index}',
                    'type': 'single_choice',
                    'stemParts': [{'text': f'这是第 {index} 道题的题干'}],
                    'options': [
                        {'id': 'A', 'text': '正确选项', 'correct': True},
                        {'id': 'B', 'text': '错误选项'},
                    ],
                    'correctAnswer': 'A',
                },
            }
            for index in range(1, 21)
        ],
    }
]


def parse_args():
    parser = argparse.ArgumentParser(
        description='Compare Focus / Vega practice-mode geometry and capture screenshots.'
    )
    parser.add_argument('--baseline', required=True, help='Baseline site origin')
    parser.add_argument('--candidate', required=True, help='Candidate site origin')
    parser.add_argument('--output', required=True, type=Path, help='Screenshot output directory')
    return parser.parse_args()


def install_stable_state(page):
    papers_json = json.dumps(PUBLISHED_PAPERS, ensure_ascii=False)
    page.add_init_script(
        script=f'''(() => {{
          localStorage.clear();
          localStorage.setItem('kg_exam_papers_published_v1', {json.dumps(papers_json)});
        }})()'''
    )
    page.emulate_media(reduced_motion='reduce')


def capture(page, origin, path, selectors, screenshot_path, validate_icons):
    console_errors = []
    page_errors = []
    page.on(
        'console',
        lambda message: console_errors.append(message.text)
        if message.type == 'error'
        else None,
    )
    page.on(
        'pageerror',
        lambda error: page_errors.append(getattr(error, 'stack', None) or str(error)),
    )
    install_stable_state(page)
    page.goto(urljoin(origin.rstrip('/') + '/', path.lstrip('/')), wait_until='domcontentloaded')
    page.wait_for_load_state('networkidle')
    page.add_style_tag(content=DISABLE_MOTION_CSS)
    page.wait_for_timeout(50)

    geometry = {}
    for selector in selectors:
        locator = page.locator(selector)
        if locator.count() != 1:
            raise AssertionError(
                f'{origin}{path}: expected exactly one {selector}, found {locator.count()}'
            )
        box = locator.bounding_box()
        if box is None:
            raise AssertionError(f'{origin}{path}: {selector} has no visible bounding box')
        geometry[selector] = box

    icon_result = {'slots': 0, 'withSvg': 0, 'missing': []}
    if validate_icons:
        icon_result = page.evaluate(
            '''() => {
              const slots = Array.from(document.querySelectorAll('[data-kg-icon]'));
              const missing = slots.filter((slot) => !slot.querySelector('svg.kg-icon'));
              return {
                slots: slots.length,
                withSvg: slots.length - missing.length,
                missing: missing.map((slot) => slot.outerHTML.slice(0, 160)),
              };
            }'''
        )
    page.screenshot(path=str(screenshot_path), full_page=True)
    return {
        'geometry': geometry,
        'consoleErrors': console_errors,
        'pageErrors': page_errors,
        'icons': icon_result,
    }


def compare_geometry(page_name, viewport_name, selectors, baseline, candidate):
    max_delta = {'delta': -1.0, 'selector': '', 'property': ''}
    failures = []
    for selector in selectors:
        for prop in GEOMETRY_PROPERTIES:
            before = baseline[selector][prop]
            after = candidate[selector][prop]
            delta = abs(before - after)
            if delta > max_delta['delta']:
                max_delta = {'delta': delta, 'selector': selector, 'property': prop}
            if delta > MAX_GEOMETRY_DELTA:
                failures.append(
                    f'{page_name} {viewport_name} {selector}.{prop}: '
                    f'baseline={before:.2f}, candidate={after:.2f}, delta={delta:.2f}px'
                )
    return max_delta, failures


def main():
    args = parse_args()
    output_dir = args.output.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    summaries = []
    failures = []

    with sync_playwright() as playwright:
        launch_options = {'headless': True, 'args': LAUNCH_ARGS}
        if Path('/usr/bin/chromium').exists():
            launch_options['executable_path'] = '/usr/bin/chromium'
        browser = playwright.chromium.launch(**launch_options)
        try:
            for width, height in VIEWPORTS:
                viewport_name = f'{width}x{height}'
                for page_name, (path, selectors) in PAGES.items():
                    baseline_path = output_dir / f'{page_name}-baseline-{viewport_name}.png'
                    candidate_path = output_dir / f'{page_name}-candidate-{viewport_name}.png'

                    baseline_page = browser.new_page(viewport={'width': width, 'height': height})
                    try:
                        baseline = capture(
                            baseline_page,
                            args.baseline,
                            path,
                            selectors,
                            baseline_path,
                            validate_icons=False,
                        )
                    finally:
                        baseline_page.close()

                    candidate_page = browser.new_page(viewport={'width': width, 'height': height})
                    try:
                        candidate = capture(
                            candidate_page,
                            args.candidate,
                            path,
                            selectors,
                            candidate_path,
                            validate_icons=True,
                        )
                    finally:
                        candidate_page.close()

                    if candidate['consoleErrors'] or candidate['pageErrors']:
                        failures.append(
                            f'{page_name} {viewport_name} candidate browser errors: '
                            f'{json.dumps({"console": candidate["consoleErrors"], "page": candidate["pageErrors"]}, ensure_ascii=False)}'
                        )
                    if candidate['icons']['slots'] == 0 or candidate['icons']['missing']:
                        failures.append(
                            f'{page_name} {viewport_name} icon hydration failed: '
                            f'{json.dumps(candidate["icons"], ensure_ascii=False)}'
                        )
                    max_delta, geometry_failures = compare_geometry(
                        page_name,
                        viewport_name,
                        selectors,
                        baseline['geometry'],
                        candidate['geometry'],
                    )
                    failures.extend(geometry_failures)
                    summary = {
                        'page': page_name,
                        'viewport': viewport_name,
                        'maxDelta': round(max_delta['delta'], 3),
                        'selector': max_delta['selector'],
                        'property': max_delta['property'],
                        'consoleErrors': len(candidate['consoleErrors']),
                        'pageErrors': len(candidate['pageErrors']),
                        'baselineConsoleErrors': len(baseline['consoleErrors']),
                        'baselinePageErrors': len(baseline['pageErrors']),
                        'iconSlots': candidate['icons']['slots'],
                        'hydratedIcons': candidate['icons']['withSvg'],
                        'baselineScreenshot': str(baseline_path),
                        'candidateScreenshot': str(candidate_path),
                    }
                    summaries.append(summary)
                    print(json.dumps(summary, ensure_ascii=False))
        finally:
            browser.close()

    expected_screenshots = len(VIEWPORTS) * len(PAGES) * 2
    actual_screenshots = len(list(output_dir.glob('*.png')))
    if actual_screenshots != expected_screenshots:
        failures.append(
            f'Expected {expected_screenshots} screenshots, found {actual_screenshots} in {output_dir}'
        )
    if failures:
        raise AssertionError('\n'.join(failures))
    print(
        json.dumps(
            {
                'status': 'learning-focus-vega-visual-ok',
                'output': str(output_dir),
                'screenshots': actual_screenshots,
                'viewports': len(summaries),
            },
            ensure_ascii=False,
        )
    )


if __name__ == '__main__':
    main()
