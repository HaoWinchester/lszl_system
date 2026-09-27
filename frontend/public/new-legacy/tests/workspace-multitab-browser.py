#!/usr/bin/env python3
"""Cross-tab paper preferences must not rebuild selected cards in other tabs.

Run helpers/canvas_ink_server.py --multiple-papers, then this script with
--base-url http://127.0.0.1:5189. Uses only disposable local fixture accounts.
"""
import argparse
import json
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    assert urlparse(base).hostname in ('localhost', '127.0.0.1'), 'Local disposable server only'
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless=True)
        context = browser.new_context(viewport={'width':1440, 'height':1000})
        response = context.request.post(base+'/api/v1/auth/login', data={'username':'ink-browser', 'password':'ink-browser-test'})
        assert response.ok, response.text()
        pages = []
        errors = []
        for suffix in ('', '-2'):
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(base+f'/question-workspace.html?paperId=ink-paper{suffix}&releaseId=ink-release{suffix}&workspace=multitab{suffix}', wait_until='domcontentloaded')
            page.wait_for_function('window.KGWorkspaceInk && window.KGMultiQuestionWorkspace?.getState().questionCount > 0')
            page.evaluate('(ref) => KGMultiQuestionWorkspace.addQuestionByReference(ref)', {'paperId':'ink-paper'+suffix, 'releaseId':'ink-release'+suffix, 'bankId':'ink-bank', 'questionId':'ink-question-'+('2' if suffix else '1')})
            expect(page.locator('.qw-question-card')).to_have_count(1)
            page.evaluate('KGMultiQuestionWorkspace.selectNodes(Object.keys(KGMultiQuestionWorkspace.activeWorkspace().nodes))')
            pages.append(page)
            if not suffix:
                # One foreign preference write isolates the trigger before testing
                # two live workspace tabs (old code can starve their event loops).
                page.wait_for_timeout(1000)
                page.evaluate('window.observedCard = document.querySelector(".qw-question-card")')
                other = context.new_page()
                other.goto(base+'/VERSION')
                other.evaluate("localStorage.setItem('kg_multi_question_paper_selection_v1__ink-browser', 'ink-paper-2')")
                page.wait_for_timeout(1500)
                same = page.evaluate('observedCard === document.querySelector(".qw-question-card")')
                other.close()
                assert same, 'A foreign paper preference replaced the selected card'
                print('PASS: foreign paper preference does not replace the selected card', flush=True)
        # Allow initial page-entry/focus work to finish, then watch DOM identity.
        pages[0].wait_for_timeout(1500)
        for page in pages:
            page.evaluate("""() => {
                window.observedCard = document.querySelector('.qw-question-card');
                window.detachedCards = 0;
                window.cardObserver = new MutationObserver(records => {
                    for (const r of records) for (const n of r.removedNodes)
                        if (n.nodeType === 1 && (n.matches('.qw-question-card') || n.querySelector('.qw-question-card'))) detachedCards++;
                });
                cardObserver.observe(observedCard.parentElement, {childList:true});
            }""")
        pages[0].wait_for_timeout(3000)
        for page, paper in zip(pages, ('ink-paper', 'ink-paper-2')):
            result = page.evaluate("""() => ({paper:KGMultiQuestionWorkspace.getState().paperId,
                selected:KGMultiQuestionWorkspace.getState().selectedNodeIds.length,
                replaced:detachedCards, sameCard:observedCard === document.querySelector('.qw-question-card')})""")
            print(json.dumps(result), flush=True)
            assert result['replaced'] == 0 and result['sameCard'], 'Idle tabs repeatedly replace selected cards'
            assert result['paper'] == paper and result['selected'] == 1, 'Another tab changed this tab selection'
        print('PASS: different papers stay selected without idle card reconstruction', flush=True)
        # Genuine published-catalog storage updates still reach the other tab.
        for key in ('kg_exam_papers_published_v1', 'kg_exam_paper_release_history_v1'):
            pages[0].evaluate('window.observedCard = document.querySelector(".qw-question-card")')
            pages[1].evaluate('(key) => localStorage.setItem(key, JSON.stringify([]))', key)
            pages[0].wait_for_function('observedCard !== document.querySelector(".qw-question-card")')
        print('PASS: published catalog and release-history updates still refresh cards', flush=True)
        assert not errors, errors
        browser.close()


if __name__ == '__main__':
    main()
